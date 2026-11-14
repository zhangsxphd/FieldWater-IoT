import { trustedMeasurement } from "./quality.js";
import { page, timeRange, fail } from "./validation.js";

// Scientific attribution uses observation time only. Unknown device time stays unassigned.
const measurementFrom = `FROM telemetry_measurements m
  JOIN sensors s ON s.id=m.sensor_id JOIN telemetry_raw r ON r.id=m.raw_id
  LEFT JOIN sensor_installations i ON i.sensor_id=m.sensor_id AND m.measured_at IS NOT NULL
    AND m.measured_at>=i.start_at AND (i.end_at IS NULL OR m.measured_at<i.end_at)
  LEFT JOIN plots p ON p.id=i.plot_id LEFT JOIN experiments x ON x.id=p.experiment_id`;

export function measurementScope(query, { trusted = true, omitTime = false } = {}) {
  const timeBasis = query.time_basis || "received_at";
  if (!["received_at", "measured_at"].includes(timeBasis)) fail("时间口径无效");
  if (query.order && !["asc", "desc"].includes(query.order)) fail("排序参数无效");
  const range = timeRange(query), params = [], clauses = trusted ? [trustedMeasurement()] : [];
  if (timeBasis === "measured_at" && !omitTime) clauses.push("m.measured_at IS NOT NULL");
  for (const [key, column] of [
    ["sensor_id", "m.sensor_id"], ["measurement_code", "m.measurement_code"],
    ["unit", "m.unit"], ["experiment_id", "x.id"], ["plot_id", "p.id"],
  ]) {
    if (query[key] !== undefined && query[key] !== "") {
      if (typeof query[key] !== "string" || query[key].length > 2000) fail("筛选参数无效");
      clauses.push(`${column} = ?`); params.push(query[key]);
    }
  }
  if (!omitTime) for (const [key, op] of [["from", ">="], ["to", "<="]]) {
    if (range[key]) { clauses.push(`m.${timeBasis} ${op} ?`); params.push(range[key]); }
  }
  return { params, timeBasis, range, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
}
const selectedColumns = `m.*,s.name AS sensor_name,s.gateway_id,r.transport,r.device_timestamp,
  r.profile_id,r.profile_snapshot,i.id AS installation_id,i.start_at AS installation_start_at,
  i.end_at AS installation_end_at,p.id AS plot_id,p.name AS plot_name,p.treatment,
  x.id AS experiment_id,x.name AS experiment_name`;

export function history(db, query, paginated = true) {
  const { params, where, timeBasis } = measurementScope(query);
  const pagination = page(query);
  const total = db.prepare(`SELECT COUNT(*) n ${measurementFrom} ${where}`).get(...params).n;
  if (!paginated && total > 50000) fail("导出超过 50000 条，请缩小时间范围", 413);
  const order = query.order === "asc" ? "ASC" : "DESC";
  const sql = `SELECT ${selectedColumns} ${measurementFrom} ${where} ORDER BY m.${timeBasis} ${order},m.id ${order}`;
  const rows = paginated
    ? db.prepare(sql + " LIMIT ? OFFSET ?").all(...params, pagination.limit, pagination.offset)
    : db.prepare(sql).all(...params);
  return { rows, total, ...pagination, time_basis: timeBasis };
}

export function statistics(db, query) {
  // Aggregating unrelated instruments or units would create a meaningless number.
  if (!query.sensor_id || !query.measurement_code || !query.unit)
    fail("统计需要明确选择仪器、指标和单位");
  const scope = measurementScope(query), { params, where, timeBasis } = scope;
  const row = db.prepare(`SELECT COUNT(*) count,MIN(m.value) min,MAX(m.value) max,AVG(m.value) mean,
    MIN(m.${timeBasis}) first_at,MAX(m.${timeBasis}) last_at ${measurementFrom} ${where}`).get(...params);
  const semantics = db.prepare(`SELECT DISTINCT m.semantics ${measurementFrom} ${where} ORDER BY m.semantics`).all(...params).map(r=>r.semantics);
  const provenance = db.prepare(`SELECT r.profile_id,r.profile_snapshot,COUNT(*) count ${measurementFrom} ${where} GROUP BY r.profile_id,r.profile_snapshot`).all(...params);
  const allScope = measurementScope(query, { trusted: false });
  const allCount = db.prepare(`SELECT COUNT(*) n ${measurementFrom} ${allScope.where}`).get(...allScope.params).n;
  const missingScope = measurementScope(query, { omitTime: timeBasis === "measured_at" });
  const missing = db.prepare(`SELECT COUNT(*) n ${measurementFrom} ${missingScope.where} AND m.measured_at IS NULL`).get(...missingScope.params).n;
  const meanAllowed = row.count > 0 && semantics.length === 1 && semantics[0] === "instantaneous";
  return {
    ...row, total: row.count, mean: meanAllowed && Number.isFinite(row.mean) ? row.mean : null,
    mean_allowed: meanAllowed, semantics, provenance, time_basis: timeBasis,
    excluded_count: allCount - row.count,
    exclusion_scope: "同一筛选范围内已解码但未通过质量筛选的测量；未解码报文见接收诊断",
    missing_device_time_count: missing,
    missing_device_time_scope: timeBasis === "measured_at" ? "所选仪器/指标中全部时间的有效记录，不计入本次采集时间范围" : "本次接收时间范围内的有效记录",
    method: "全匹配有效记录的最小/最大读数；仅已定义为瞬时值的指标计算逐条算术均值，非时间加权；不计算累计差分、时段总量或插补缺测",
  };
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
