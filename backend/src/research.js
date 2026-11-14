import { id, text, fail } from "./validation.js";
import { parseIsoTime } from "./quality.js";
import { recordAudit } from "./audit.js";

export function objectBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("请求必须为 JSON 对象");
  return value;
}
function timestamp(value, label) {
  const normalized = parseIsoTime(value);
  if (!normalized) fail(`${label}必须是包含时区的有效日期时间`);
  return normalized;
}
export function positiveId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail("记录编号无效");
  return Number(value);
}
export function listExperiments(db) {
  return db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM plots p WHERE p.experiment_id=e.id) AS plot_count
    FROM experiments e ORDER BY e.id`).all();
}
export function createExperiment(db, input) {
  const b = objectBody(input), row = { id: id(b.id, "试验编号"), name: text(b.name, "试验名称", true),
    description: text(b.description, "试验说明"), created_at: new Date().toISOString() };
  return db.transaction(() => {
    db.prepare("INSERT INTO experiments (id,name,description,created_at) VALUES (?,?,?,?)")
      .run(row.id, row.name, row.description, row.created_at);
    recordAudit(db, { action: "create", entityType: "experiment", entityId: row.id,
      after: row, source: "/api/experiments" });
    return row;
  })();
}
export function listPlots(db, query = {}) {
  return db.prepare(`SELECT p.*,e.name AS experiment_name FROM plots p JOIN experiments e ON e.id=p.experiment_id
    ${query.experiment_id ? "WHERE p.experiment_id=?" : ""} ORDER BY p.id`)
    .all(...(query.experiment_id ? [query.experiment_id] : []));
}
export function createPlot(db, input) {
  const b = objectBody(input), row = { id: id(b.id, "小区编号"),
    experiment_id: id(b.experiment_id, "试验编号"), name: text(b.name, "小区名称", true),
    treatment: text(b.treatment, "处理说明"), created_at: new Date().toISOString() };
  if (!db.prepare("SELECT id FROM experiments WHERE id=?").get(row.experiment_id)) fail("请先建立试验");
  return db.transaction(() => {
    db.prepare("INSERT INTO plots (id,experiment_id,name,treatment,created_at) VALUES (?,?,?,?,?)")
      .run(row.id, row.experiment_id, row.name, row.treatment, row.created_at);
    recordAudit(db, { action: "create", entityType: "plot", entityId: row.id,
      after: row, source: "/api/plots" });
    return row;
  })();
}
const installationSelect = `SELECT i.*,s.name AS sensor_name,p.name AS plot_name,p.treatment,
  p.experiment_id,e.name AS experiment_name FROM sensor_installations i
  JOIN sensors s ON s.id=i.sensor_id JOIN plots p ON p.id=i.plot_id
  JOIN experiments e ON e.id=p.experiment_id`;
export function listInstallations(db, query = {}) {
  const params = [], clauses = [];
  for (const field of ["sensor_id", "plot_id"])
    if (query[field]) { clauses.push(`i.${field}=?`); params.push(query[field]); }
  if (query.experiment_id) { clauses.push("p.experiment_id=?"); params.push(query.experiment_id); }
  return db.prepare(`${installationSelect} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY i.start_at DESC,i.id DESC`).all(...params);
}
export function createInstallation(db, input) {
  const b = objectBody(input), row = { sensor_id: id(b.sensor_id, "仪器编号"), plot_id: id(b.plot_id, "小区编号"),
    start_at: timestamp(b.start_at, "安装开始时间"),
    end_at: b.end_at === undefined || b.end_at === null || b.end_at === "" ? null : timestamp(b.end_at, "安装结束时间"),
    created_at: new Date().toISOString() };
  if (row.end_at !== null && row.end_at <= row.start_at) fail("结束时间必须晚于开始时间");
  if (!db.prepare("SELECT id FROM sensors WHERE id=?").get(row.sensor_id)) fail("请先登记仪器");
  if (!db.prepare("SELECT id FROM plots WHERE id=?").get(row.plot_id)) fail("请先建立试验小区");
  return db.transaction(() => {
    const overlap = db.prepare(`SELECT id FROM sensor_installations WHERE sensor_id=?
      AND (end_at IS NULL OR ?<end_at) AND (? IS NULL OR start_at<?) LIMIT 1`)
      .get(row.sensor_id, row.start_at, row.end_at, row.end_at);
    if (overlap) fail("同一仪器的安装时段不能重叠；请先结束已有安装记录", 409);
    row.id = Number(db.prepare(`INSERT INTO sensor_installations
      (sensor_id,plot_id,start_at,end_at,created_at) VALUES (?,?,?,?,?)`)
      .run(row.sensor_id, row.plot_id, row.start_at, row.end_at, row.created_at).lastInsertRowid);
    recordAudit(db, { action: "install", entityType: "installation", entityId: row.id,
      after: row, source: "/api/installations" });
    return row;
  })();
}
export function closeInstallation(db, installationId, input) {
  const iid = positiveId(installationId), b = objectBody(input), endAt = timestamp(b.end_at, "安装结束时间"),
    note = text(b.note, "结束安装说明");
  return db.transaction(() => {
    const before = db.prepare("SELECT * FROM sensor_installations WHERE id=?").get(iid);
    if (!before) fail("安装记录不存在", 404);
    if (before.end_at !== null) fail("已结束的安装记录不可重写", 409);
    if (endAt <= before.start_at) fail("结束时间必须晚于开始时间");
    db.prepare("UPDATE sensor_installations SET end_at=? WHERE id=?").run(endAt, iid);
    const after = { ...before, end_at: endAt };
    recordAudit(db, { action: "close", entityType: "installation", entityId: iid,
      before, after: { ...after, note }, source: `/api/installations/${iid}/close` });
    return after;
  })();
}
// Unknown acquisition time deliberately has no inferred research attribution.
export function installationAt(db, sensorId, measuredAt) {
  const time = parseIsoTime(measuredAt);
  if (!time) return null;
  return db.prepare(`${installationSelect} WHERE i.sensor_id=? AND i.start_at<=?
    AND (i.end_at IS NULL OR ?<i.end_at)`).get(sensorId, time, time) ?? null;
}
