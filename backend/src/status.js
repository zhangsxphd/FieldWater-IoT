import { trustedMeasurement } from "./quality.js";

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
export function sensors(db, now = Date.now()) {
  const gatewayMap = new Map(gateways(db, now).map((g) => [g.id, g]));
  const valid = db.prepare(
    `SELECT m.* FROM telemetry_measurements m WHERE m.sensor_id=? AND ${trustedMeasurement()} ORDER BY COALESCE(m.measured_at,m.received_at) DESC,m.id DESC LIMIT 1`,
  );
  const lastAttempt = db.prepare(
    `SELECT * FROM telemetry_raw WHERE sensor_id=? AND gateway_id=? AND communication_quality='verified' AND parse_status NOT IN ('duplicate','rejected') ORDER BY received_at DESC,id DESC LIMIT 1`,
  );
  return db
    .prepare("SELECT * FROM sensors ORDER BY id")
    .all()
    .map((row) => {
      const gateway = gatewayMap.get(row.gateway_id),
        latest = valid.get(row.id),
        attempt = lastAttempt.get(row.id, row.gateway_id);
      let dataStatus = "no_data";
      if (latest)
        dataStatus =
          row.freshness_seconds === null
            ? "freshness_unconfigured"
            : now - Date.parse(latest.measured_at || latest.received_at) >
                row.freshness_seconds * 1000
              ? "stale"
              : "fresh";
      if (
        attempt &&
        (attempt.parse_status !== "parsed" ||
          attempt.value_quality !== "valid" ||
          ["invalid", "future"].includes(attempt.time_quality))
      )
        dataStatus = "invalid_data";
      return {
        ...row,
        gateway_name: gateway.name,
        gateway_status: gateway.status,
        data_status: dataStatus,
        last_valid_at: latest ? latest.measured_at || latest.received_at : null,
        last_valid_received_at: latest?.received_at ?? null,
        time_basis: latest
          ? latest.measured_at
            ? "device_timestamp"
            : "received_at"
          : null,
        last_received_at: attempt?.received_at ?? null,
        last_raw_id: attempt?.id ?? null,
      };
    });
}
