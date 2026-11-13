import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";
import { ingest } from "./ingest.js";
import { gateways, sensors } from "./status.js";
import { crc16, parseRainGauge } from "./modules/protocols/rain-gauge/index.js";

// Independent algorithm vector only, not a manufacturer example or field observation.
const frame = Buffer.from([1, 3, 2, 0, 10, 56, 67]);
const testParser = () => ({
  measurement_code: "test_metric",
  value: 0,
  unit: "test_unit",
  value_quality: "valid",
  quality_status: "isolated-test",
});
const input = (overrides = {}) => ({
  gatewayId: "g",
  sensorId: "s",
  rawPayload: frame,
  transport: "isolated-test",
  source: "isolated-test",
  communicationVerified: true,
  parse: testParser,
  ...overrides,
});
function register(db) {
  db.prepare(
    "INSERT INTO gateways(id,name,timeout_seconds) VALUES (?,?,?)",
  ).run("g", "Isolated gateway", 60);
  for (const sid of ["s", "s2"])
    db.prepare(
      "INSERT INTO sensors(id,gateway_id,type,name,freshness_seconds) VALUES (?,?,?,?,?)",
    ).run(sid, "g", "rainfall", "Isolated sensor", 60);
}
async function fixture(fn) {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  try {
    await fn(db, app);
  } finally {
    await app.close();
    db.close();
  }
}

test("rainfall algorithm validates CRC, slave and explicit request context without asserting value semantics", () => {
  assert.equal(crc16(frame.subarray(0, 5)), frame.readUInt16LE(5));
  assert.equal(
    parseRainGauge(frame, { address: 1, register: 0, quantity: 1 }).value,
    1,
  );
  assert.throws(() =>
    parseRainGauge(frame, { address: 2, register: 0, quantity: 1 }),
  );
  assert.throws(() =>
    parseRainGauge(frame, { address: 1, register: 1, quantity: 1 }),
  );
  assert.throws(() =>
    parseRainGauge(Buffer.from([1, 3, 2, 0, 10, 0, 0]), {
      address: 1,
      register: 0,
      quantity: 1,
    }),
  );
});

test("empty APIs return empty records and gateway rate null", () =>
  fixture(async (db, app) => {
    const summary = (await app.inject("/api/dashboard/summary")).json();
    assert.equal(summary.gateways.online_rate, null);
    assert.equal(summary.sensors.total, 0);
    for (const url of [
      "/api/gateways",
      "/api/devices",
      "/api/telemetry/latest",
      "/api/telemetry/series",
      "/api/alarms",
    ])
      assert.deepEqual((await app.inject(url)).json(), []);
    for (const url of [
      "/api/telemetry/history",
      "/api/telemetry/raw",
      "/api/events",
    ])
      assert.equal((await app.inject(url)).json().total, 0);
  }));

test("gateway registration is independent and sensor edits cannot mutate shared gateway settings", () =>
  fixture(async (db, app) => {
    const post = (url, payload) => app.inject({ method: "POST", url, payload });
    let response = await post("/api/devices", {
      id: "s",
      name: "sensor",
      gateway_id: "g",
      type: "rainfall",
    });
    assert.equal(response.statusCode, 400);
    assert.equal(db.prepare("SELECT count(*) n FROM gateways").get().n, 0);
    response = await post("/api/gateways", {
      id: "g",
      name: "gateway",
      manufacturer: "Declared manufacturer",
      timeout_seconds: 60,
    });
    assert.equal(response.statusCode, 201);
    for (const id of ["s", "s2"])
      assert.equal(
        (
          await post("/api/devices", {
            id,
            name: id,
            gateway_id: "g",
            type: "rainfall",
            freshness_seconds: 60,
          })
        ).statusCode,
        201,
      );
    response = await app.inject({
      method: "PUT",
      url: "/api/devices/s",
      payload: { name: "changed", timeout_seconds: 10 },
    });
    assert.equal(response.statusCode, 400);
    response = await app.inject({
      method: "PUT",
      url: "/api/devices/s",
      payload: { name: "changed", freshness_seconds: 120 },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(
      db.prepare("SELECT timeout_seconds FROM gateways").get().timeout_seconds,
      60,
    );
    assert.equal(
      db.prepare("SELECT freshness_seconds FROM sensors WHERE id='s2'").get()
        .freshness_seconds,
      60,
    );
    response = await app.inject({
      method: "PUT",
      url: "/api/gateways/g",
      payload: { timeout_seconds: 120 },
    });
    assert.equal(response.statusCode, 200);
    const related = (await app.inject("/api/gateways/g")).json();
    assert.equal(related.sensor_count, 2);
    assert.equal(related.sensors.length, 2);
    assert.equal(
      (await post("/api/gateways", { id: "g", name: "duplicate" })).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/api/devices/s",
          payload: { type: "water_level" },
        })
      ).statusCode,
      400,
    );
  }));

test("one gateway online does not make its other sensor fresh; stale and communication errors are independent", () =>
  fixture(async (db) => {
    register(db);
    const receivedAt = new Date(Date.now() - 1000).toISOString();
    ingest(db, input({ receivedAt }));
    let rows = sensors(db);
    assert.equal(gateways(db)[0].status, "online");
    assert.equal(rows[0].data_status, "fresh");
    assert.equal(rows[1].data_status, "no_data");
    const future = Date.parse(receivedAt) + 61000;
    assert.equal(gateways(db, future)[0].status, "offline");
    assert.equal(sensors(db, future)[0].data_status, "stale");
    assert.equal(sensors(db, future)[1].data_status, "no_data");
    db.prepare(
      "INSERT INTO device_events(gateway_id,event_type,occurred_at) VALUES('g','communication_error',?)",
    ).run(new Date().toISOString());
    assert.equal(gateways(db)[0].status, "communication_error");
    assert.equal(sensors(db)[0].data_status, "fresh");
    db.prepare("UPDATE gateways SET timeout_seconds=NULL").run();
    db.prepare(
      "DELETE FROM device_events WHERE event_type='communication_error'",
    ).run();
    assert.equal(gateways(db)[0].status, "timeout_unconfigured");
    db.prepare("UPDATE sensors SET freshness_seconds=NULL").run();
    assert.equal(sensors(db)[0].data_status, "freshness_unconfigured");
  }));

test("unverified and wrongly bound traffic is retained but never changes state or trusted history", () =>
  fixture(async (db, app) => {
    register(db);
    ingest(db, input({ communicationVerified: false }));
    ingest(db, input({ gatewayId: "unknown" }));
    assert.equal(db.prepare("SELECT count(*) n FROM telemetry_raw").get().n, 2);
    assert.equal(
      db.prepare("SELECT count(*) n FROM telemetry_measurements").get().n,
      0,
    );
    assert.equal(gateways(db)[0].status, "pending");
    assert.equal(sensors(db)[0].data_status, "no_data");
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 0);
  }));

test("raw bytes survive parse failure and four quality dimensions remain independent", () =>
  fixture(async (db, app) => {
    register(db);
    const first = ingest(db, input());
    const failure = ingest(
      db,
      input({
        rawPayload: Buffer.from([1]),
        parse: () => {
          throw Error("CRC mismatch");
        },
      }),
    );
    assert.equal(sensors(db)[0].data_status, "invalid_data");
    assert.equal(gateways(db)[0].status, "online");
    const raw = (
      await app.inject("/api/telemetry/raw/" + failure.rawId)
    ).json();
    assert.equal(raw.raw_payload, "01");
    assert.equal(raw.communication_quality, "verified");
    assert.equal(raw.protocol_quality, "invalid");
    assert.equal(raw.value_quality, "not_checked");
    assert.equal(raw.time_quality, "missing");
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 1);
    assert.equal(
      (await app.inject("/api/telemetry/raw?parse_status=failed")).json().total,
      1,
    );
    assert.equal(
      (await app.inject("/api/events?gateway_id=g")).json().total,
      2,
    );
    const valid = (
      await app.inject("/api/telemetry/raw/" + first.rawId)
    ).json();
    assert.equal(valid.measurements[0].value, 0);
    assert.equal(valid.measurements[0].measured_at, null);
    assert.match((await app.inject("/api/telemetry/history.csv")).body, /"0"/);
  }));

test("every duplicate delivery and ID conflict is auditable; replays do not refresh sensor age", () =>
  fixture(async (db, app) => {
    register(db);
    const receivedAt = "2020-01-01T00:00:00.000Z";
    const original = ingest(db, input({ messageId: "one", receivedAt }));
    const replay = ingest(db, input({ messageId: "one" }));
    assert.equal(replay.duplicate, true);
    assert.equal(replay.duplicateOf, original.rawId);
    assert.equal(db.prepare("SELECT count(*) n FROM telemetry_raw").get().n, 2);
    assert.equal(
      db.prepare("SELECT count(*) n FROM telemetry_measurements").get().n,
      1,
    );
    assert.equal(sensors(db)[0].data_status, "stale");
    const conflict = ingest(
      db,
      input({ messageId: "one", rawPayload: Buffer.from([2]) }),
    );
    assert.equal(conflict.conflict, true);
    assert.equal(db.prepare("SELECT count(*) n FROM telemetry_raw").get().n, 3);
    assert.equal(
      (await app.inject("/api/telemetry/raw?parse_status=conflict")).json()
        .rows[0].duplicate_of,
      original.rawId,
    );
  }));

test("missing, malformed, future and valid old device times retain distinct evidence", () =>
  fixture(async (db, app) => {
    register(db);
    for (const deviceTimestamp of [
      null,
      "broken",
      "2999-01-01T00:00:00Z",
      "2020-01-01T00:00:00Z",
    ])
      ingest(db, input({ deviceTimestamp }));
    const raw = db.prepare("SELECT * FROM telemetry_raw ORDER BY id").all();
    assert.deepEqual(
      raw.map((r) => r.time_quality),
      ["missing", "invalid", "future", "valid"],
    );
    assert.equal(raw[1].device_timestamp, "broken");
    const measurements = db
      .prepare("SELECT * FROM telemetry_measurements ORDER BY id")
      .all();
    assert.equal(measurements[1].measured_at, null);
    assert.equal(measurements[2].measured_at, null);
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 2);
    // A delayed old observation cannot replace the newest observation selected by acquisition/receipt basis.
    assert.equal(
      (await app.inject("/api/telemetry/latest")).json()[0].id,
      measurements[0].id,
    );
  }));

test("decoded but unverified values stay in raw audit and outside trusted views", () =>
  fixture(async (db, app) => {
    register(db);
    const { rawId } = ingest(
      db,
      input({
        parse: (b) =>
          parseRainGauge(b, { address: 1, register: 0, quantity: 1 }),
      }),
    );
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 0);
    assert.deepEqual((await app.inject("/api/telemetry/series")).json(), []);
    const audit = (await app.inject("/api/telemetry/raw/" + rawId)).json();
    assert.equal(audit.measurements[0].value, 1);
    assert.equal(audit.value_quality, "unverified");
    assert.equal(sensors(db)[0].data_status, "invalid_data");
  }));

test("history applies series filtering before limits, validates queries and protects local browser writes", () =>
  fixture(async (db, app) => {
    register(db);
    ingest(db, input({ sensorId: "s2" }));
    for (let n = 0; n < 501; n++) ingest(db, input());
    const history = (
      await app.inject(
        "/api/telemetry/history?sensor_id=s2&measurement_code=test_metric&unit=test_unit&limit=1",
      )
    ).json();
    assert.equal(history.total, 1);
    assert.equal(history.rows[0].sensor_id, "s2");
    assert.equal((await app.inject("/api/telemetry/series")).json().length, 2);
    for (const suffix of [
      "?limit=0",
      "?limit=1000",
      "?offset=-1",
      "?from=2026-01-01",
      "?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
      "?order=no",
    ])
      assert.equal(
        (await app.inject("/api/telemetry/history" + suffix)).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/gateways",
          headers: { origin: "https://untrusted.invalid" },
          payload: { id: "bad", name: "bad" },
        })
      ).statusCode,
      403,
    );
  }));

test("migration adopts legacy database without deletion and does not invent legacy quality", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = mkdtempSync(join(tmpdir(), "fieldwater-migration-test-"));
  const file = join(dir, "test.sqlite");
  const old = new Database(file);
  old.exec(
    "CREATE TABLE gateways(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE sensors(id TEXT PRIMARY KEY,gateway_id TEXT NOT NULL REFERENCES gateways(id),type TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO gateways(id,name) VALUES('g','Existing');INSERT INTO sensors(id,gateway_id,type,name) VALUES('s','g','rainfall','Existing');",
  );
  old.close();
  let db = openDatabase(file);
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM sensors").get().n, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM schema_migrations").get().n,
      3,
    );
    db.close();
    db = openDatabase(file);
    assert.equal(db.prepare("SELECT count(*) n FROM sensors").get().n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("calendar-invalid times are preserved as invalid, not normalized into real observations", () =>
  fixture(async (db, app) => {
    register(db);
    for (const deviceTimestamp of [
      "2026-02-30T00:00:00Z",
      "2026-11-13T24:00:00Z",
      "2026-11-13T10:00:00+24:00",
    ])
      ingest(db, input({ deviceTimestamp }));
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 0);
    assert.deepEqual(
      db
        .prepare("SELECT time_quality FROM telemetry_raw")
        .all()
        .map((r) => r.time_quality),
      ["invalid", "invalid", "invalid"],
    );
    assert.equal(
      (await app.inject("/api/telemetry/history?from=2026-02-30T00:00:00Z"))
        .statusCode,
      400,
    );
  }));
test("CSV escapes formula-like text while retaining negative numeric readings", () =>
  fixture(async (db, app) => {
    register(db);
    db.prepare("UPDATE sensors SET name='-1+2' WHERE id='s'").run();
    ingest(db, input({ parse: () => ({ ...testParser(), value: -1 }) }));
    const csv = (await app.inject("/api/telemetry/history.csv")).body;
    assert.ok(csv.includes('"\'-1+2"'));
    assert.ok(csv.includes('"-1"'));
  }));

test("v2 raw and measurement rows survive migration but are not silently certified", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = mkdtempSync(join(tmpdir(), "fieldwater-v2-test-")),
    file = join(dir, "legacy.sqlite");
  const old = new Database(file);
  old.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT); INSERT INTO schema_migrations VALUES(1,'old'),(2,'old');
    CREATE TABLE gateways(id TEXT PRIMARY KEY,name TEXT,created_at TEXT,transport TEXT,timeout_seconds INTEGER);
    CREATE TABLE sensors(id TEXT PRIMARY KEY,gateway_id TEXT,type TEXT,name TEXT,created_at TEXT,manufacturer TEXT,model TEXT,location TEXT,unit TEXT,notes TEXT);
    CREATE TABLE telemetry_raw(id INTEGER PRIMARY KEY,gateway_id TEXT,sensor_id TEXT,message_id TEXT,raw_payload BLOB,received_at TEXT,device_timestamp TEXT,transport TEXT,source TEXT,parse_status TEXT,parse_error TEXT);
    CREATE UNIQUE INDEX idx_raw_message ON telemetry_raw(gateway_id,message_id) WHERE message_id IS NOT NULL;
    CREATE TABLE telemetry_measurements(id INTEGER PRIMARY KEY,raw_id INTEGER,sensor_id TEXT,measurement_code TEXT,value REAL,unit TEXT,measured_at TEXT,received_at TEXT,quality_status TEXT,source TEXT);
    CREATE TABLE device_events(id INTEGER PRIMARY KEY,gateway_id TEXT,sensor_id TEXT,event_type TEXT,occurred_at TEXT,details TEXT);
    CREATE TABLE alarms(id INTEGER PRIMARY KEY,sensor_id TEXT,gateway_id TEXT,raised_at TEXT,message TEXT,status TEXT);
    INSERT INTO gateways(id,name) VALUES('legacy-g','Legacy');
    INSERT INTO sensors(id,gateway_id,type,name) VALUES('legacy-s','legacy-g','rainfall','Legacy');
    INSERT INTO telemetry_raw VALUES(7,'legacy-g','legacy-s','old',X'010203','2020-01-01T00:00:00Z',NULL,'test','isolated-test','parsed',NULL);
    INSERT INTO telemetry_measurements VALUES(8,7,'legacy-s','old',1,'test',NULL,'2020-01-01T00:00:00Z','unknown','isolated-test');`);
  old.close();
  const db = openDatabase(file),
    app = buildApp(db);
  try {
    const raw = (await app.inject("/api/telemetry/raw/7")).json();
    assert.equal(raw.raw_payload, "010203");
    assert.equal(raw.measurements[0].id, 8);
    assert.equal(raw.measurements[0].value, 1);
    assert.equal(raw.measurements[0].value_quality, "legacy_unknown");
    assert.equal((await app.inject("/api/telemetry/history")).json().total, 0);
  } finally {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true });
  }
});
