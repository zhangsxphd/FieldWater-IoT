import { gateways, sensors } from "./status.js";
import { text, fail } from "./validation.js";
import { recordAudit } from "./audit.js";
import { objectBody, positiveId } from "./research.js";

function action(db, alarmId, type, at, note, actor, evidence = {}) {
  db.prepare(`INSERT INTO alarm_actions
    (alarm_id,action,occurred_at,note,actor,raw_id,event_id) VALUES (?,?,?,?,?,?,?)`)
    .run(alarmId, type, at, note, actor, evidence.raw_id ?? null, evidence.event_id ?? null);
}
function getAlarm(db, alarmId) {
  const row = db.prepare("SELECT * FROM alarms WHERE id=?").get(alarmId);
  if (!row) fail("告警不存在", 404);
  return { ...row, actions: db.prepare("SELECT * FROM alarm_actions WHERE alarm_id=? ORDER BY id").all(alarmId) };
}
function latestEvent(db, gatewayId) {
  return db.prepare(`SELECT * FROM device_events WHERE gateway_id=?
    AND event_type IN ('heartbeat','telemetry_received','communication_error')
    ORDER BY occurred_at DESC,id DESC LIMIT 1`).get(gatewayId);
}

// Conditions come only from retained communication/measurement evidence, not registration alone.
// Reading the local alarm workbench evaluates current conditions; it never sends notifications.
export function evaluateAlarms(db, now = Date.now()) {
  if (!Number.isFinite(now)) fail("告警评估时间无效");
  const at = new Date(now).toISOString();
  return db.transaction(() => {
    const gatewayRows = gateways(db, now), sensorRows = sensors(db, now);
    const gatewayMap = new Map(gatewayRows.map((row) => [row.id, row]));
    const sensorMap = new Map(sensorRows.map((row) => [row.id, row]));
    const desired = [];
    for (const row of gatewayRows) {
      if (!["offline", "communication_error"].includes(row.status)) continue;
      const event = latestEvent(db, row.id);
      if (!event) continue;
      desired.push({ condition_key: `gateway:${row.id}:communication`, kind: "gateway_communication",
        gateway_id: row.id, sensor_id: null, event_id: event.id, raw_id: null,
        message: `${row.name}：${row.status === "offline" ? "通信超时" : "通信异常"}` });
    }
    for (const row of sensorRows) {
      const affected = row.metrics.filter(m => ["stale", "invalid_data"].includes(m.data_status));
      // A structurally failed packet has no decoded metric to identify; retain a sensor-level condition.
      if (row.data_status === "invalid_data" && !affected.length)
        affected.push({ measurement_code: null, unit: null, data_status: "invalid_data", last_raw_id: row.last_raw_id, last_valid_at: row.last_valid_at });
      for (const metric of affected) {
        const rawId = metric.data_status === "stale" ? metric.latest_valid_raw_id : metric.last_raw_id;
        const raw = db.prepare("SELECT * FROM telemetry_raw WHERE id=?").get(rawId ?? null);
        if (!raw || raw.communication_quality !== "verified" || ["rejected", "duplicate"].includes(raw.parse_status)) continue;
        const kind = metric.data_status === "stale" ? "sensor_stale" : "sensor_invalid";
        desired.push({ condition_key: JSON.stringify(["sensor",row.id,metric.measurement_code,metric.unit,kind]), kind,
          gateway_id: row.gateway_id,sensor_id:row.id,raw_id:raw.id,event_id:null,
          measurement_code:metric.measurement_code,unit:metric.unit,observed_at:metric.last_valid_at,
          message: `${row.name}${metric.measurement_code ? ` / ${metric.measurement_code} (${metric.unit})` : ""}：${kind === "sensor_stale" ? "有效测量已过期" : "接收或测量质量异常"}` });
      }
    }
    let opened = 0, resolved = 0;
    for (const condition of desired) {
      if (db.prepare("SELECT id FROM alarms WHERE condition_key=? AND resolved_at IS NULL").get(condition.condition_key)) continue;
      const alarmId = Number(db.prepare(`INSERT INTO alarms
        (sensor_id,gateway_id,raised_at,message,status,condition_key,kind,raw_id,event_id,measurement_code,unit,observed_at)
        VALUES (?,?,?,?,'open',?,?,?,?,?,?,?)`)
        .run(condition.sensor_id, condition.gateway_id, at, condition.message,
          condition.condition_key, condition.kind, condition.raw_id, condition.event_id,
          condition.measurement_code ?? null,condition.unit ?? null,condition.observed_at ?? null).lastInsertRowid);
      action(db, alarmId, "opened", at, condition.message, "system", condition);
      recordAudit(db, { action: "open", entityType: "alarm", entityId: alarmId,
        after: condition, source: "alarm_evaluator", occurredAt: at, actor: "system" });
      opened++;
    }
    for (const alarm of db.prepare("SELECT * FROM alarms WHERE condition_key IS NOT NULL AND resolved_at IS NULL").all()) {
      let evidence = null;
      if (alarm.kind === "gateway_communication") {
        const current = gatewayMap.get(alarm.gateway_id), event = latestEvent(db, alarm.gateway_id);
        // Extending a timeout without a new communication event cannot recover an alarm.
        if (current?.status === "online" && event && event.id > (alarm.event_id ?? 0)
          && ["heartbeat", "telemetry_received"].includes(event.event_type)) evidence = { event_id: event.id };
      } else if (["sensor_stale", "sensor_invalid"].includes(alarm.kind)) {
        const current = sensorMap.get(alarm.sensor_id);
        const metric = alarm.measurement_code == null ? null : current?.metrics.find(m => m.measurement_code === alarm.measurement_code && m.unit === alarm.unit);
        const state = metric || current;
        const rawId = metric ? metric.latest_valid_raw_id : current?.last_raw_id;
        // Recovery belongs to the affected metric, and requires a later observation, not merely a new delivery ID.
        if (state?.data_status === "fresh" && rawId > (alarm.raw_id ?? 0)
          && (!alarm.observed_at || state.last_valid_at > alarm.observed_at)) {
          const raw = db.prepare("SELECT * FROM telemetry_raw WHERE id=?").get(rawId);
          if (raw?.parse_status === "parsed" && raw.communication_quality === "verified"
            && ["valid", "missing"].includes(raw.time_quality)
            && (metric || raw.value_quality === "valid")) evidence = { raw_id: raw.id };
        }
      }
      if (!evidence) continue;
      db.prepare("UPDATE alarms SET status='resolved',resolved_at=? WHERE id=?").run(at, alarm.id);
      action(db, alarm.id, "resolved", at, "已收到新的有效恢复证据", "system", evidence);
      recordAudit(db, { action: "resolve", entityType: "alarm", entityId: alarm.id,
        before: alarm, after: { ...alarm, status: "resolved", resolved_at: at, evidence },
        source: "alarm_evaluator", occurredAt: at, actor: "system" });
      resolved++;
    }
    return { opened, resolved, evaluated_at: at };
  })();
}

export function listAlarms(db, query = {}, now = Date.now()) {
  evaluateAlarms(db, now);
  const clauses = [], params = [];
  if (query.status && !["open", "acknowledged", "resolved"].includes(query.status)) fail("告警状态无效");
  for (const field of ["sensor_id", "gateway_id", "status"])
    if (query[field]) { clauses.push(`${field}=?`); params.push(query[field]); }
  return db.prepare(`SELECT id FROM alarms ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY raised_at DESC,id DESC`).all(...params).map((row) => getAlarm(db, row.id));
}
export function acknowledgeAlarm(db, alarmId, input) {
  const aid = positiveId(alarmId), b = objectBody(input), note = text(b.note, "处理说明", true);
  return db.transaction(() => {
    const before = getAlarm(db, aid);
    if (before.status !== "open" || before.resolved_at) fail("仅待确认的活动告警可以确认", 409);
    const at = new Date().toISOString();
    db.prepare("UPDATE alarms SET status='acknowledged',acknowledged_at=? WHERE id=?").run(at, aid);
    action(db, aid, "acknowledged", at, note, "local_operator");
    const after = getAlarm(db, aid);
    recordAudit(db, { action: "acknowledge", entityType: "alarm", entityId: aid,
      before, after, source: `/api/alarms/${aid}/ack`, occurredAt: at });
    return after;
  })();
}
export function addAlarmNote(db, alarmId, input) {
  const aid = positiveId(alarmId), b = objectBody(input), note = text(b.note, "处理说明", true);
  return db.transaction(() => {
    const before = getAlarm(db, aid), at = new Date().toISOString();
    action(db, aid, "note", at, note, "local_operator");
    recordAudit(db, { action: "note", entityType: "alarm", entityId: aid,
      before: { status: before.status }, after: { note }, source: `/api/alarms/${aid}/notes`, occurredAt: at });
    return getAlarm(db, aid);
  })();
}
