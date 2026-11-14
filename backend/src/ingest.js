import { deviceTime } from "./quality.js";
import { getProfile } from "./profiles.js";

// Internal adapter contract, NOT an authentication endpoint. The adapter must first
// verify gateway identity and binding. No network transport is enabled here.
export function ingest(
  db,
  {
    gatewayId,
    sensorId = null,
    messageId = null,
    rawPayload,
    transport,
    source,
    deviceTimestamp = null,
    receivedAt = new Date().toISOString(),
    communicationVerified = false,
    profileId = null,
    parse,
  },
) {
  if (!gatewayId || !transport || !source || !Buffer.isBuffer(rawPayload))
    throw new Error("gateway, transport, source and raw bytes required");
  if (!Number.isFinite(Date.parse(receivedAt)))
    throw new Error("invalid server receipt time");
  receivedAt = new Date(receivedAt).toISOString();
  const time = deviceTime(deviceTimestamp, receivedAt);
  const comm = communicationVerified === true ? "verified" : "unverified";
  const result = db
    .prepare(
      `INSERT INTO telemetry_raw (gateway_id,sensor_id,message_id,raw_payload,received_at,device_timestamp,transport,source,parse_status,communication_quality,protocol_quality,value_quality,time_quality)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      gatewayId,
      sensorId,
      messageId,
      rawPayload,
      receivedAt,
      deviceTimestamp == null ? null : String(deviceTimestamp),
      transport,
      source,
      "pending",
      comm,
      "not_checked",
      "not_checked",
      time.time_quality,
    );
  const rawId = result.lastInsertRowid;
  const mark = (
    status,
    error,
    protocol = "not_checked",
    value = "not_checked",
  ) =>
    db
      .prepare(
        "UPDATE telemetry_raw SET parse_status=?,parse_error=?,protocol_quality=?,value_quality=? WHERE id=?",
      )
      .run(status, error, protocol, value, rawId);
  if (comm !== "verified") {
    mark("rejected", "gateway identity / communication not verified");
    return { rawId, rejected: true };
  }
  const sensor = db
    .prepare("SELECT * FROM sensors WHERE id=? AND gateway_id=?")
    .get(sensorId, gatewayId);
  if (!sensor) {
    db.prepare(
      "UPDATE telemetry_raw SET communication_quality='invalid' WHERE id=?",
    ).run(rawId);
    mark("rejected", "unknown sensor or gateway binding");
    return { rawId, rejected: true };
  }
  // Duplicate lookup is scoped to verified, correctly bound deliveries, never to unauthenticated traffic.
  if (messageId) {
    const previous = db
      .prepare(
        `SELECT * FROM telemetry_raw WHERE gateway_id=? AND message_id=? AND id<>?
      AND communication_quality='verified' AND parse_status NOT IN ('rejected','duplicate','conflict') ORDER BY id LIMIT 1`,
      )
      .get(gatewayId, messageId, rawId);
    if (previous) {
      const same =
        previous.sensor_id === sensorId &&
        previous.raw_payload.equals(rawPayload) &&
        previous.device_timestamp ===
          (deviceTimestamp == null ? null : String(deviceTimestamp));
      db.prepare("UPDATE telemetry_raw SET duplicate_of=?,profile_id=?,profile_snapshot=? WHERE id=?").run(
        previous.id,
        same ? previous.profile_id : null,
        same ? previous.profile_snapshot : null,
        rawId,
      );
      mark(
        same ? "duplicate" : "conflict",
        same
          ? null
          : "message_id reused with different sensor, bytes or device time",
      );
      return {
        rawId,
        duplicate: same,
        conflict: !same,
        duplicateOf: previous.id,
      };
    }
  }
  // Validated transport receipt is distinct from protocol/value validity.
  db.prepare(
    "INSERT INTO device_events (gateway_id,sensor_id,event_type,occurred_at,details) VALUES (?,?,?,?,?)",
  ).run(
    gatewayId,
    sensorId,
    "telemetry_received",
    receivedAt,
    JSON.stringify({ raw_id: Number(rawId), source, transport }),
  );
  let profile = null;
  if (profileId !== null && profileId !== undefined) {
    try {
      profile = getProfile(db, profileId);
      if (profile.sensor_id !== sensorId) throw new Error("protocol profile belongs to a different sensor");
      db.prepare("UPDATE telemetry_raw SET profile_id=?,profile_snapshot=? WHERE id=?")
        .run(profile.id, JSON.stringify(profile), rawId);
    } catch (error) {
      mark("failed", String(error.message));
      return { rawId };
    }
  }
  if (typeof parse !== "function") {
    mark("failed", "no verified parser configured");
    return { rawId };
  }
  let measurements;
  try {
    const decoded = parse(rawPayload);
    measurements = Array.isArray(decoded) ? decoded : [decoded];
  } catch (error) {
    mark("failed", String(error.message), "invalid");
    return { rawId };
  }
  if (
    measurements.length === 0 || measurements.length > 64
  ) {
    mark("failed", "decoded batch must contain 1–64 measurements", "valid", "invalid");
    return { rawId };
  }
  const seen = new Set();
  for (const measurement of measurements) {
    if (!measurement || typeof measurement !== "object" || Array.isArray(measurement) ||
      !Number.isFinite(measurement.value) ||
      typeof measurement.measurement_code !== "string" || !measurement.measurement_code.trim() || measurement.measurement_code.length > 100 ||
      typeof measurement.unit !== "string" || !measurement.unit.trim() || measurement.unit.length > 64 ||
      (measurement.quality_status != null && (typeof measurement.quality_status !== "string" || measurement.quality_status.length > 2000))) {
      mark("failed", "invalid decoded measurement; entire batch rejected", "valid", "invalid");
      return { rawId };
    }
    const key = JSON.stringify([measurement.measurement_code.trim(), measurement.unit.trim()]);
    if (seen.has(key)) {
      mark("failed", "duplicate metric within decoded batch; entire batch rejected", "valid", "invalid");
      return { rawId };
    }
    seen.add(key);
  }
  // The parser must explicitly supply value validity based on documented device semantics.
  const qualities = measurements.map((m) => ["valid", "invalid", "unverified"].includes(m.value_quality) ? m.value_quality : "unverified");
  const aggregateQuality = qualities.includes("invalid") ? "invalid" : qualities.includes("unverified") ? "unverified" : "valid";
  try {
    db.transaction(() => {
      const insert = db.prepare(
        `INSERT INTO telemetry_measurements (raw_id,sensor_id,measurement_code,value,unit,measured_at,received_at,quality_status,source,communication_quality,protocol_quality,value_quality,time_quality,semantics)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      measurements.forEach((measurement, i) => {
        const code = measurement.measurement_code.trim(), unit = measurement.unit.trim();
        const definition = profile?.definitions.find((d) => d.measurement_code === code && d.unit === unit);
        insert.run(rawId, sensorId, code, measurement.value, unit, time.measured_at, receivedAt,
          measurement.quality_status || qualities[i], source, comm, "valid", qualities[i], time.time_quality,
          definition?.semantics ?? "unknown");
      });
      mark("parsed", null, "valid", aggregateQuality);
    })();
  } catch (error) {
    mark("failed", `measurement batch persistence failed: ${error.message}`, "valid", "not_checked");
    return { rawId };
  }
  return { rawId, measurementCount: measurements.length };
}
