import { trustedMeasurement } from "./quality.js";
import { listProfiles } from "./profiles.js";

export function gateways(db, now = Date.now()) {
  const rows = db
    .prepare(
      `SELECT g.*,
    (SELECT COUNT(*) FROM sensors s WHERE s.gateway_id=g.id) AS sensor_count,
    (SELECT MAX(e.occurred_at) FROM device_events e WHERE e.gateway_id=g.id AND e.event_type IN ('heartbeat','telemetry_received')) AS last_contact,
    (SELECT e.event_type FROM device_events e WHERE e.gateway_id=g.id AND e.event_type IN ('heartbeat','telemetry_received','communication_error') ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS last_event
    FROM gateways g ORDER BY g.id`,
    )
    .all();
  return rows.map((row) => {
    let status = "pending";
    if (row.last_event === "communication_error")
      status = "communication_error";
    else if (row.last_contact)
      status =
        row.timeout_seconds === null
          ? "timeout_unconfigured"
          : now - Date.parse(row.last_contact) > row.timeout_seconds * 1000
            ? "offline"
            : "online";
    return { ...row, status };
  });
}
// Data freshness belongs to a metric. A healthy sibling never certifies a
// missing/invalid required metric, and arrival time never replaces device time.
export function sensors(db, now = Date.now()) {
  const gatewayMap = new Map(gateways(db, now).map((g) => [g.id, g]));
  const valid = db.prepare(
    `SELECT m.* FROM telemetry_measurements m WHERE m.sensor_id=? AND ${trustedMeasurement()} ORDER BY COALESCE(m.measured_at,m.received_at) DESC,m.id DESC LIMIT 1`,
  );
  const validMetric = db.prepare(
    `SELECT m.*,r.profile_id FROM telemetry_measurements m JOIN telemetry_raw r ON r.id=m.raw_id WHERE m.sensor_id=? AND m.measurement_code=? AND m.unit=? AND ${trustedMeasurement()} ORDER BY COALESCE(m.measured_at,m.received_at) DESC,m.id DESC LIMIT 1`,
  );
  const attemptedMetric = db.prepare(
    `SELECT m.* FROM telemetry_measurements m WHERE m.sensor_id=? AND m.measurement_code=? AND m.unit=? ORDER BY m.received_at DESC,m.id DESC LIMIT 1`,
  );
  const series = db.prepare("SELECT DISTINCT measurement_code,unit FROM telemetry_measurements WHERE sensor_id=?");
  const lastAttempt = db.prepare(
    `SELECT * FROM telemetry_raw WHERE sensor_id=? AND gateway_id=? AND communication_quality='verified' AND parse_status NOT IN ('duplicate','rejected') ORDER BY received_at DESC,id DESC LIMIT 1`,
  );
  return db.prepare("SELECT * FROM sensors ORDER BY id").all().map((row) => {
    const gateway = gatewayMap.get(row.gateway_id), latest = valid.get(row.id),
      attempt = lastAttempt.get(row.id, row.gateway_id), profile = listProfiles(db, row.id)[0];
    const definitions = new Map((profile?.definitions ?? []).map((d) => [JSON.stringify([d.measurement_code, d.unit]), d]));
    const metricMap = new Map(definitions);
    for (const metric of series.all(row.id)) {
      const key = JSON.stringify([metric.measurement_code, metric.unit]);
      if (!metricMap.has(key)) metricMap.set(key, metric);
    }
    const metrics = [...metricMap.values()].map((metric) => {
      const good = validMetric.get(row.id, metric.measurement_code, metric.unit);
      const last = attemptedMetric.get(row.id, metric.measurement_code, metric.unit);
      const freshness = metric.freshness_seconds ?? row.freshness_seconds;
      let state = "no_data";
      if (good) state = freshness === null ? "freshness_unconfigured" :
        now - Date.parse(good.measured_at || good.received_at) > freshness * 1000 ? "stale" : "fresh";
      if (last && (last.value_quality !== "valid" || last.protocol_quality !== "valid" ||
        last.communication_quality !== "verified" || !["valid", "missing"].includes(last.time_quality))) state = "invalid_data";
      return { measurement_code: metric.measurement_code, unit: metric.unit,
        semantics: good?.semantics ?? last?.semantics ?? metric.semantics ?? "unknown",
        configured_semantics: metric.semantics ?? "unknown",
        required: metric.required ?? false, freshness_seconds: freshness,
        freshness_profile_id: metric.freshness_seconds != null ? profile.id : null,
        freshness_basis: metric.freshness_seconds != null ? "current_profile" : "sensor",
        latest_profile_id: good?.profile_id ?? null,
        data_status: state, latest_value: good?.value ?? null,
        last_valid_at: good ? good.measured_at || good.received_at : null,
        last_valid_received_at: good?.received_at ?? null,
        last_raw_id: last?.raw_id ?? null, latest_valid_raw_id: good?.raw_id ?? null,
        time_basis: good ? good.measured_at ? "device_timestamp" : "received_at" : null,
        time_quality: good?.time_quality ?? null };
    });
    const required = metrics.filter((m) => m.required);
    const assessed = required.length ? required : metrics.filter((m) => m.last_raw_id !== null);
    let dataStatus = "no_data";
    if (assessed.length && !assessed.some((m) => m.data_status === "no_data")) {
      dataStatus = assessed.some((m) => m.data_status === "stale") ? "stale" :
        assessed.some((m) => m.data_status === "freshness_unconfigured") ? "freshness_unconfigured" : "fresh";
    }
    if (metrics.some((m) => m.data_status === "invalid_data") ||
      (attempt && (attempt.parse_status !== "parsed" || ["invalid", "future"].includes(attempt.time_quality)))) dataStatus = "invalid_data";
    return { ...row, gateway_name: gateway.name, gateway_status: gateway.status,
      data_status: dataStatus, metrics, profile_id: profile?.id ?? null,
      last_valid_at: latest ? latest.measured_at || latest.received_at : null,
      last_valid_received_at: latest?.received_at ?? null,
      time_basis: latest ? latest.measured_at ? "device_timestamp" : "received_at" : null,
      last_received_at: attempt?.received_at ?? null, last_raw_id: attempt?.id ?? null };
  });
}
