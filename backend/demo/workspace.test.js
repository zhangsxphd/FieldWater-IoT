import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDemoApp } from "./workspace.js";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";

function demo(t) {
  const app = createDemoApp();
  t.after(() => app.close());
  return app;
}
async function get(app, url) {
  const res = await app.inject(url);
  assert.equal(res.statusCode, 200, url);
  return res.json();
}
const post = (app, url, payload) => app.inject({ method: "POST", url, payload });

test("the demo ignores the business DB path and the live API has no exercise endpoints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fieldwater-demo-test-"));
  const file = join(dir, "business.sqlite");
  const previous = process.env.FIELDWATER_DB;
  process.env.FIELDWATER_DB = file;
  const business = openDatabase(file);
  const live = buildApp(business, { logger: false });
  let app;
  try {
    assert.throws(() => buildApp(business, { mode: "demo" }), /in-memory/);
    app = createDemoApp();
    assert.deepEqual(await get(app, "/api/health"), { status: "ok", mode: "demo" });
    assert.equal((await get(live, "/api/health")).mode, "live");
    assert.equal((await live.inject("/api/demo/scenario")).statusCode, 404);
    assert.equal((await post(live, "/api/demo/rain-sample", { quality: "valid" })).statusCode, 404);
    assert.equal((await post(app, "/api/demo/rain-sample", { quality: "valid" })).statusCode, 200);
    for (const table of ["gateways","sensors","experiments","alarms","operation_audit","telemetry_raw","telemetry_measurements"])
      assert.equal(business.prepare("SELECT count(*) AS n FROM " + table).get().n, 0, table);
  } finally {
    if (previous === undefined) delete process.env.FIELDWATER_DB;
    else process.env.FIELDWATER_DB = previous;
    await app?.close();
    await live.close();
    business.close();
    rmSync(dir, { recursive: true });
  }
});

test("three instruments have attributable history, raw evidence and labeled exports", async t => {
  const app = demo(t);
  const sensors = await get(app, "/api/devices");
  assert.equal(new Set(sensors.map(s => s.gateway_id)).size, 3);
  assert.equal(sensors.find(s => s.type === "rainfall").data_status, "invalid_data");
  assert.equal(sensors.filter(s => s.data_status === "fresh").length, 2);
  const rows = (await get(app, "/api/telemetry/history?limit=100")).rows;
  assert.equal(rows.length, 52);
  assert.ok(rows.every(r => r.source === "demo" && r.experiment_id === "demo-irrigation" && r.plot_id));
  assert.equal(new Set(rows.map(r => r.measurement_code)).size, 4);
  const raw = await get(app, "/api/telemetry/raw/" + rows[0].raw_id);
  assert.equal(JSON.parse(Buffer.from(raw.raw_payload, "hex")).source, "demo");
  assert.equal(raw.measurements[0].source, "demo");
  const scope = new URLSearchParams({ sensor_id: "demo-flow", measurement_code: "累计流量", unit: "m³" });
  const exported = await app.inject("/api/telemetry/export.json?" + scope);
  const { manifest } = exported.json();
  assert.equal(manifest.count, 13);
  assert.equal(manifest.data_mode, "demo");
  assert.equal(manifest.statistics.mean_allowed, false);
  assert.match(exported.headers["content-disposition"], /fieldwater-demo-/);
  const csv = await app.inject("/api/telemetry/history.csv?" + scope);
  assert.match(csv.headers["content-disposition"], /fieldwater-demo-/);
  assert.match(csv.payload, /"demo","local-demo"/);
});

test("elapsed wall time does not change scenario freshness or raise extra alarms", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const app = demo(t);
  const before = await get(app, "/api/dashboard/summary");
  t.mock.timers.tick(3 * 86400000);
  assert.deepEqual(await get(app, "/api/dashboard/summary"), before);
  assert.equal((await get(app, "/api/alarms")).length, 1);
  assert.equal((await get(app, "/api/devices/demo-level")).data_status, "fresh");
});

test("acknowledgement, evidence-based recovery and repeat practice stay inside one session", async t => {
  const app = demo(t);
  const url = "/api/demo/rain-sample";
  const alarms = () => get(app, "/api/alarms");
  const [opened] = await alarms();
  assert.equal(opened.status, "open");
  assert.equal((await post(app, url, { quality: "unknown" })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url, headers: { origin: "http://127.0.0.1:5181" }, payload: { quality: "valid" } })).statusCode, 403);
  await post(app, "/api/alarms/" + opened.id + "/ack", { note: "演练复核" });
  assert.equal((await alarms())[0].status, "acknowledged");
  const recovered = (await post(app, url, { quality: "valid" })).json();
  assert.deepEqual((await post(app, url, { quality: "valid" })).json(), recovered);
  let [alarm] = await alarms();
  assert.deepEqual(alarm.actions.map(a => a.action), ["opened", "acknowledged", "resolved"]);
  assert.equal(alarm.actions.at(-1).raw_id, recovered.raw_id);
  assert.ok(alarm.resolved_at >= alarm.acknowledged_at);
  const reopened = (await post(app, url, { quality: "invalid" })).json();
  assert.ok(reopened.raw_id > recovered.raw_id);
  assert.deepEqual((await alarms()).map(a => a.status), ["open", "resolved"]);
  const fresh = demo(t);
  assert.deepEqual((await get(fresh, "/api/alarms")).map(a => a.status), ["open"]);
  assert.equal((await get(fresh, "/api/demo/scenario")).raw_id, opened.raw_id);
});
