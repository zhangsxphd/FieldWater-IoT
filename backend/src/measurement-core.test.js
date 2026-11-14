import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { createProfile, listProfiles, getProfile } from "./profiles.js";
import { ingest } from "./ingest.js";
import { sensors } from "./status.js";
import { trustedMeasurement } from "./quality.js";

// Deterministic isolated vectors, NOT real instrument definitions or samples.
const receipt = "2026-01-01T12:00:00.000Z";
const metric = (code, quality = "valid", value = 3) => ({ measurement_code: code, value, unit: "test_unit", value_quality: quality });
function setup(t) {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  db.exec(`INSERT INTO gateways(id,name,timeout_seconds) VALUES('g','isolated gateway',60);
    INSERT INTO sensors(id,gateway_id,type,name,freshness_seconds) VALUES('s','g','electromagnetic_flow','isolated instrument',60),('other','g','rainfall','other isolated instrument',60);`);
  return db;
}
function profile(db, version = "isolated-v1", overrides = {}) {
  return createProfile(db, "s", { version, protocol_name: "isolated-test-vector", parser_version: "test-parser-v1", calibration_version: "test-calibration-v1", evidence_ref: "isolated test, not manufacturer documentation",
    definitions: [{ measurement_code: "instant", unit: "test_unit", semantics: "instantaneous", required: true }, { measurement_code: "total", unit: "test_unit", semantics: "cumulative", required: true }], ...overrides });
}
function receive(db, extra = {}) {
  return ingest(db, { gatewayId: "g", sensorId: "s", rawPayload: Buffer.from([1, 2]), transport: "isolated-test", source: "isolated-test", communicationVerified: true, receivedAt: receipt, parse: () => metric("instant"), ...extra });
}

test("protocol profiles validate bounded definitions and are immutable evidence records", (t) => {
  const db = setup(t), p = profile(db);
  assert.equal(p.definitions[0].freshness_seconds, null);
  assert.equal(listProfiles(db, "s")[0].version, p.version);
  assert.throws(() => db.prepare("UPDATE protocol_profiles SET parser_version='changed' WHERE id=?").run(p.id), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM protocol_profiles WHERE id=?").run(p.id), /immutable/);
  assert.throws(() => profile(db), /UNIQUE/);
  assert.throws(() => profile(db, "bad", { definitions: [{ measurement_code: "x", unit: "u" }, { measurement_code: "x", unit: "u" }] }), /重复/);
  assert.throws(() => profile(db, "bad", { definitions: [{ measurement_code: "x", unit: "u", required: "yes" }] }), /布尔/);
  assert.throws(() => profile(db, "bad", { definitions: [{ measurement_code: "x", unit: "u", freshness_seconds: -1 }] }), /整数秒/);
  assert.throws(() => profile(db, "bad", { definitions: [{ measurement_code: "x", unit: "u", semantics: "daily-rain" }] }), /语义/);
  assert.throws(() => getProfile(db, true), /无效/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_measurements").get().n, 0);
});

test("one raw message preserves two metrics with independent validity and semantics", (t) => {
  const db = setup(t), p = profile(db);
  assert.equal(sensors(db, Date.parse(receipt))[1].data_status, "no_data");
  const result = receive(db, { profileId: p.id, parse: () => [metric("instant"), metric("total", "invalid", -1)] });
  assert.equal(result.measurementCount, 2);
  const rows = db.prepare("SELECT * FROM telemetry_measurements ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.raw_id, r.value_quality, r.semantics]), [[result.rawId, "valid", "instantaneous"], [result.rawId, "invalid", "cumulative"]]);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM telemetry_measurements m WHERE ${trustedMeasurement()}`).get().n, 1);
  const raw = db.prepare("SELECT * FROM telemetry_raw").get();
  assert.equal(raw.parse_status, "parsed");
  assert.equal(raw.value_quality, "invalid");
  const sensor = sensors(db, Date.parse(receipt)).find((s) => s.id === "s");
  assert.equal(sensor.data_status, "invalid_data");
  assert.deepEqual(sensor.metrics.map((m) => m.data_status), ["fresh", "invalid_data"]);
  assert.equal(sensor.metrics[0].latest_value, 3);
  assert.equal(sensor.metrics[1].latest_value, null);
});

test("malformed and database-failed measurement batches are atomic while raw bytes survive", (t) => {
  const db = setup(t);
  for (const batch of [[metric("instant"), metric("total", "valid", NaN)], [metric("instant"), metric("instant")], [], [metric("instant"), null]]) {
    receive(db, { parse: () => batch });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_measurements").get().n, 0);
  }
  db.exec("CREATE TRIGGER isolated_failure BEFORE INSERT ON telemetry_measurements WHEN NEW.measurement_code='total' BEGIN SELECT RAISE(ABORT, 'isolated write failure'); END");
  receive(db, { parse: () => [metric("instant"), metric("total")] });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_measurements").get().n, 0);
  const rows = db.prepare("SELECT * FROM telemetry_raw").all();
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.parse_status === "failed" && r.raw_payload.equals(Buffer.from([1, 2]))));
  assert.match(rows.at(-1).parse_error, /isolated write failure/);
});

test("profile snapshots and original measurements survive version changes and duplicate delivery", (t) => {
  const db = setup(t), p = profile(db);
  const first = receive(db, { profileId: p.id, messageId: "sample-id" });
  const snapshot = db.prepare("SELECT profile_snapshot FROM telemetry_raw WHERE id=?").get(first.rawId).profile_snapshot;
  const next = profile(db, "isolated-v2", { parser_version: "test-parser-v2", definitions: [{ measurement_code: "instant", unit: "test_unit", semantics: "interval", required: true }] });
  const repeated = receive(db, { profileId: next.id, messageId: "sample-id", parse: () => { throw new Error("duplicate must never parse again"); } });
  assert.equal(repeated.duplicate, true);
  assert.equal(db.prepare("SELECT profile_snapshot FROM telemetry_raw WHERE id=?").get(repeated.rawId).profile_snapshot, snapshot);
  assert.equal(db.prepare("SELECT semantics FROM telemetry_measurements").get().semantics, "instantaneous");
  const conflict = receive(db, { profileId: next.id, messageId: "sample-id", rawPayload: Buffer.from([3]) });
  assert.equal(conflict.conflict, true);
  assert.equal(db.prepare("SELECT profile_snapshot FROM telemetry_raw WHERE id=?").get(conflict.rawId).profile_snapshot, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_measurements").get().n, 1);
});

test("missing required metric remains no_data while sibling freshness is independent", (t) => {
  const db = setup(t), p = profile(db, "isolated-v1", { definitions: [{ measurement_code: "instant", unit: "test_unit", semantics: "instantaneous", required: true, freshness_seconds: 10 }, { measurement_code: "total", unit: "test_unit", semantics: "cumulative", required: true, freshness_seconds: 100 }] });
  receive(db, { profileId: p.id });
  let s = sensors(db, Date.parse(receipt) + 5000).find((s) => s.id === "s");
  assert.equal(s.data_status, "no_data");
  assert.deepEqual(s.metrics.map((m) => m.data_status), ["fresh", "no_data"]);
  receive(db, { profileId: p.id, parse: () => metric("total") });
  s = sensors(db, Date.parse(receipt) + 15000).find((s) => s.id === "s");
  assert.equal(s.data_status, "stale");
  assert.deepEqual(s.metrics.map((m) => m.data_status), ["stale", "fresh"]);
});

test("late device timestamps do not become fresh from new receipt and absent clocks remain absent", (t) => {
  const db = setup(t);
  receive(db, { deviceTimestamp: "2026-01-01T10:00:00Z" });
  let s = sensors(db, Date.parse(receipt)).find((s) => s.id === "s");
  assert.equal(s.data_status, "stale");
  assert.equal(s.metrics[0].time_basis, "device_timestamp");
  assert.equal(s.metrics[0].last_valid_at, "2026-01-01T10:00:00.000Z");
  receive(db, { receivedAt: "2026-01-01T12:00:01Z", parse: () => metric("instant", "valid", 4) });
  s = sensors(db, Date.parse(receipt) + 2000).find((s) => s.id === "s");
  assert.equal(s.metrics[0].time_quality, "missing");
  assert.equal(s.metrics[0].time_basis, "received_at");
  assert.equal(db.prepare("SELECT measured_at FROM telemetry_measurements ORDER BY id DESC LIMIT 1").get().measured_at, null);
});

test("unknown provenance never invents semantics or approvals and cross-sensor profiles fail safely", (t) => {
  const db = setup(t), p = profile(db);
  receive(db, { parse: () => ({ ...metric("instant", "unverified"), semantics: "cumulative" }) });
  let m = db.prepare("SELECT * FROM telemetry_measurements").get();
  assert.equal(m.semantics, "unknown");
  assert.equal(m.value_quality, "unverified");
  const result = receive(db, { sensorId: "other", profileId: p.id });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_measurements").get().n, 1);
  const raw = db.prepare("SELECT * FROM telemetry_raw WHERE id=?").get(result.rawId);
  assert.equal(raw.parse_status, "failed");
  assert.match(raw.parse_error, /different sensor/);
  assert.equal(raw.profile_snapshot, null);
});

test("current profile freshness is explicit while sample semantics and snapshot stay at their original version", (t) => {
  const db = setup(t);
  const old = profile(db, "old-profile", { definitions: [{ measurement_code: "instant", unit: "test_unit", semantics: "instantaneous", required: true, freshness_seconds: 10 }] });
  const original = receive(db, { profileId: old.id, deviceTimestamp: receipt });
  const snapshot = db.prepare("SELECT profile_snapshot FROM telemetry_raw WHERE id=?").get(original.rawId).profile_snapshot;
  const next = profile(db, "new-profile", { definitions: [{ measurement_code: "instant", unit: "test_unit", semantics: "interval", required: true, freshness_seconds: 100 }] });
  const result = sensors(db, Date.parse(receipt) + 15000).find((s) => s.id === "s").metrics[0];
  assert.equal(result.data_status, "fresh");
  assert.equal(result.semantics, "instantaneous");
  assert.equal(result.configured_semantics, "interval");
  assert.equal(result.latest_profile_id, old.id);
  assert.equal(result.freshness_profile_id, next.id);
  assert.equal(result.freshness_basis, "current_profile");
  assert.equal(db.prepare("SELECT profile_snapshot FROM telemetry_raw WHERE id=?").get(original.rawId).profile_snapshot, snapshot);
  assert.equal(JSON.parse(snapshot).definitions[0].freshness_seconds, 10);
  assert.equal(db.prepare("SELECT measured_at FROM telemetry_measurements").get().measured_at, receipt);
});
