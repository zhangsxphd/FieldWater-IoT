import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { openDatabase } from "./db.js";
import { migrateOperations } from "./operations-schema.js";
import { createExperiment, createPlot, createInstallation, closeInstallation,
  installationAt, listInstallations } from "./research.js";
import { evaluateAlarms, listAlarms, acknowledgeAlarm, addAlarmNote } from "./alarms.js";
import { listAudit } from "./audit.js";
import { registerOperationsRoutes } from "./operations.js";
import { ingest } from "./ingest.js";

function fixture() {
  const db = openDatabase(":memory:");
  migrateOperations(db);
  db.prepare("INSERT INTO gateways (id,name,timeout_seconds) VALUES ('qa-gateway','隔离网关',60)").run();
  db.prepare(`INSERT INTO sensors (id,gateway_id,type,name,freshness_seconds)
    VALUES ('qa-sensor','qa-gateway','water_level','隔离仪器',60)`).run();
  return db;
}
function reading(db, suffix, receivedAt, parse = () => ({
  measurement_code: "isolated_value", value: 1, unit: "test_unit", value_quality: "valid",
})) {
  return ingest(db, { gatewayId: "qa-gateway", sensorId: "qa-sensor", messageId: suffix,
    rawPayload: Buffer.from(suffix), receivedAt, deviceTimestamp: receivedAt,
    transport: "isolated-test", source: "isolated-test", communicationVerified: true, parse });
}

test("research installation intervals preserve acquisition-time attribution and unknown times", () => {
  const db = fixture();
  try {
    createExperiment(db, { id: "qa-experiment", name: "隔离试验" });
    for (const id of ["a", "b"]) createPlot(db, { id, experiment_id: "qa-experiment", name: id, treatment: "隔离处理" });
    const first = createInstallation(db, { sensor_id: "qa-sensor", plot_id: "a", start_at: "2026-01-01T00:00:00+08:00" });
    assert.throws(() => createInstallation(db, { sensor_id: "qa-sensor", plot_id: "b", start_at: "2026-02-01T00:00:00+08:00" }), /重叠/);
    closeInstallation(db, first.id, { end_at: "2026-02-01T00:00:00+08:00", note: "隔离测试迁移" });
    createInstallation(db, { sensor_id: "qa-sensor", plot_id: "b", start_at: "2026-02-01T00:00:00+08:00" });
    assert.equal(installationAt(db, "qa-sensor", "2026-01-20T00:00:00+08:00").plot_id, "a");
    assert.equal(installationAt(db, "qa-sensor", "2026-02-01T00:00:00+08:00").plot_id, "b");
    assert.equal(installationAt(db, "qa-sensor", null), null);
    assert.equal(installationAt(db, "qa-sensor", "2026-02-30T00:00:00Z"), null);
    assert.equal(installationAt(db, "qa-sensor", "2025-01-01T00:00:00Z"), null);
    assert.throws(() => closeInstallation(db, first.id, { end_at: "2026-03-01T00:00:00Z" }), /不可重写/);
    assert.throws(() => db.prepare("UPDATE sensor_installations SET plot_id='b' WHERE id=?").run(first.id), /immutable/);
    const rows = listInstallations(db, { experiment_id: "qa-experiment" });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].experiment_name, "隔离试验");
    assert.equal(listAudit(db, { entity_type: "installation" }).total, 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_raw").get().n, 0);
  } finally { db.close(); }
});

test("research validation and audit writing are atomic", () => {
  const db = fixture();
  try {
    assert.throws(() => createExperiment(db, []), /JSON/);
    assert.throws(() => createExperiment(db, { id: "bad id", name: "bad" }), /编号/);
    assert.throws(() => createPlot(db, { id: "a", name: "a", experiment_id: "missing" }), /先建立试验/);
    createExperiment(db, { id: "e", name: "e" });
    createPlot(db, { id: "a", name: "a", experiment_id: "e" });
    assert.throws(() => createInstallation(db, { sensor_id: "qa-sensor", plot_id: "a", start_at: "2026-02-30T00:00:00Z" }), /有效日期/);
    assert.throws(() => createInstallation(db, { sensor_id: "qa-sensor", plot_id: "a", start_at: "2026-01-01T00:00:00" }), /时区/);
    assert.throws(() => createInstallation(db, { sensor_id: "qa-sensor", plot_id: "a", start_at: "2026-01-02T00:00:00Z", end_at: "2026-01-01T00:00:00Z" }), /结束时间/);
    db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT,'isolated audit error'); END;");
    assert.throws(() => createExperiment(db, { id: "rollback", name: "rollback" }), /audit error/);
    assert.equal(db.prepare("SELECT id FROM experiments WHERE id='rollback'").get(), undefined);
  } finally { db.close(); }
});

test("empty/no-data installations never create alarms", () => {
  const db = fixture();
  try {
    assert.deepEqual(evaluateAlarms(db).opened, 0);
    assert.deepEqual(listAlarms(db), []);
    ingest(db, { gatewayId: "qa-gateway", sensorId: "qa-sensor", rawPayload: Buffer.from("unverified"),
      transport: "isolated-test", source: "isolated-test", communicationVerified: false });
    assert.deepEqual(listAlarms(db), []);
  } finally { db.close(); }
});

test("alarm acknowledgement preserves active faults and recovery requires new evidence", () => {
  const db = fixture(), now = Date.now();
  try {
    reading(db, "old", new Date(now - 120000).toISOString());
    assert.equal(evaluateAlarms(db, now).opened, 2);
    assert.equal(evaluateAlarms(db, now).opened, 0);
    const original = listAlarms(db, {}, now);
    assert.equal(original.length, 2);
    for (const alarm of original) {
      const ack = acknowledgeAlarm(db, alarm.id, { note: "隔离测试：正在检查连接" });
      assert.equal(ack.status, "acknowledged");
      assert.equal(ack.resolved_at, null);
      assert.equal(ack.actions.length, 2);
      assert.throws(() => acknowledgeAlarm(db, alarm.id, { note: "again" }), /仅待确认/);
    }
    // Enlarging timeouts alone does not provide new recovery evidence.
    db.exec("UPDATE gateways SET timeout_seconds=3600; UPDATE sensors SET freshness_seconds=3600;");
    assert.equal(evaluateAlarms(db, now).resolved, 0);
    db.exec("UPDATE gateways SET timeout_seconds=60; UPDATE sensors SET freshness_seconds=60;");
    reading(db, "new", new Date(now + 1000).toISOString());
    assert.equal(evaluateAlarms(db, now + 1000).resolved, 2);
    for (const alarm of listAlarms(db, {}, now + 1000)) {
      assert.equal(alarm.status, "resolved");
      assert.ok(alarm.acknowledged_at);
      assert.ok(alarm.resolved_at);
      assert.equal(alarm.actions.at(-1).action, "resolved");
      assert.ok(alarm.actions.at(-1).raw_id || alarm.actions.at(-1).event_id);
    }
    assert.equal(evaluateAlarms(db, now + 122000).opened, 2, "new outage starts a new episode");
    assert.equal(listAlarms(db, {}, now + 122000).length, 4);
  } finally { db.close(); }
});

test("protocol failures remain traceable until a valid measurement recovers", () => {
  const db = fixture(), now = Date.now();
  try {
    reading(db, "failure", new Date(now).toISOString(), () => { throw Error("isolated invalid frame"); });
    const [alarm] = listAlarms(db, {}, now);
    assert.equal(alarm.kind, "sensor_invalid");
    assert.ok(alarm.raw_id);
    assert.throws(() => acknowledgeAlarm(db, alarm.id, { note: " " }), /必填/);
    addAlarmNote(db, alarm.id, { note: "隔离测试：检查协议参数" });
    assert.equal(listAlarms(db, {}, now)[0].status, "open");
    reading(db, "good", new Date(now + 1000).toISOString());
    assert.equal(listAlarms(db, {}, now + 1000)[0].status, "resolved");
    const audit = listAudit(db, { entity_type: "alarm", entity_id: String(alarm.id), limit: "1" });
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.total, 3);
    assert.equal(audit.rows[0].actor, "system");
  } finally { db.close(); }
});

test("operations HTTP routes validate and expose only actual saved metadata", async () => {
  const db = fixture(), app = Fastify();
  app.setErrorHandler((error, request, reply) => reply.code(error.statusCode || 500).send({ error: error.message }));
  registerOperationsRoutes(app, db);
  try {
    assert.deepEqual((await app.inject("/api/experiments")).json(), []);
    assert.equal((await app.inject({ method: "POST", url: "/api/experiments", payload: { id: "e", name: "隔离试验" } })).statusCode, 201);
    assert.equal((await app.inject({ method: "POST", url: "/api/plots", payload: { id: "p", name: "隔离小区", experiment_id: "e" } })).statusCode, 201);
    const install = await app.inject({ method: "POST", url: "/api/installations", payload: {
      sensor_id: "qa-sensor", plot_id: "p", start_at: "2026-01-01T00:00:00Z" } });
    assert.equal(install.statusCode, 201);
    assert.equal((await app.inject("/api/installations?sensor_id=qa-sensor")).json()[0].plot_name, "隔离小区");
    assert.equal((await app.inject({ method: "POST", url: `/api/installations/${install.json().id}/close`, payload: { end_at: "2026-02-01T00:00:00Z" } })).statusCode, 200);
    assert.equal((await app.inject("/api/audit")).json().total, 4);
    assert.deepEqual((await app.inject("/api/alarms")).json(), []);
  } finally { await app.close(); db.close(); }
});
