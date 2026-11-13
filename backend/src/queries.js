import { trustedMeasurement } from "./quality.js";
import { page, timeRange, fail } from "./validation.js";

export function history(db, query, paginated = true) {
  const clauses = [trustedMeasurement()];
  const params = [];
  const range = timeRange(query);
  const pagination = page(query);
  if (query.order && !["asc", "desc"].includes(query.order))
    fail("排序参数无效");
  for (const [key, column, op] of [
    ["sensor_id", "m.sensor_id", "="],
    ["measurement_code", "m.measurement_code", "="],
    ["unit", "m.unit", "="],
    ["from", "m.received_at", ">="],
    ["to", "m.received_at", "<="],
  ]) {
    const value = key in range ? range[key] : query[key];
    if (value !== undefined && value !== "") {
      clauses.push(`${column} ${op} ?`);
      params.push(value);
    }
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = db
    .prepare(`SELECT COUNT(*) n FROM telemetry_measurements m ${where}`)
    .get(...params).n;
  if (!paginated && total > 50000)
    fail("导出超过 50000 条，请缩小时间范围", 413);
  const order = query.order === "asc" ? "ASC" : "DESC";
  const sql = `SELECT m.*, s.name AS sensor_name, s.gateway_id, r.transport,r.device_timestamp
    FROM telemetry_measurements m JOIN sensors s ON s.id=m.sensor_id JOIN telemetry_raw r ON r.id=m.raw_id
    ${where} ORDER BY m.received_at ${order},m.id ${order}`;
  const rows = paginated
    ? db
        .prepare(sql + " LIMIT ? OFFSET ?")
        .all(...params, pagination.limit, pagination.offset)
    : db.prepare(sql).all(...params);
  return { rows, total, ...pagination, time_basis: "received_at" };
}
export function rawRecords(db, query) {
  const pagination = page(query),
    range = timeRange(query),
    clauses = [],
    params = [];
  for (const [key, column, op] of [
    ["gateway_id", "gateway_id", "="],
    ["sensor_id", "sensor_id", "="],
    ["parse_status", "parse_status", "="],
    ["from", "received_at", ">="],
    ["to", "received_at", "<="],
  ]) {
    const value = key in range ? range[key] : query[key];
    if (value) {
      clauses.push(`${column} ${op} ?`);
      params.push(value);
    }
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const total = db
    .prepare(`SELECT COUNT(*) n FROM telemetry_raw ${where}`)
    .get(...params).n;
  const rows = db
    .prepare(
      `SELECT id,gateway_id,sensor_id,message_id,received_at,device_timestamp,transport,source,parse_status,parse_error,
    communication_quality,protocol_quality,value_quality,time_quality,duplicate_of,length(raw_payload) AS payload_bytes
    FROM telemetry_raw ${where} ORDER BY received_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pagination.limit, pagination.offset);
  return { rows, total, ...pagination };
}
export function events(db, query) {
  const pagination = page(query),
    clauses = [],
    params = [];
  for (const key of ["gateway_id", "sensor_id"])
    if (query[key]) {
      clauses.push(`${key}=?`);
      params.push(query[key]);
    }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const total = db
    .prepare(`SELECT COUNT(*) n FROM device_events ${where}`)
    .get(...params).n;
  const rows = db
    .prepare(
      `SELECT * FROM device_events ${where} ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pagination.limit, pagination.offset);
  return { rows, total, ...pagination };
}
