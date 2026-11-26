import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db.js";
import { ingest } from "../src/ingest.js";
import { createProfile } from "../src/profiles.js";
import { createExperiment, createPlot, createInstallation } from "../src/research.js";
import { evaluateAlarms } from "../src/alarms.js";
import { fail } from "../src/validation.js";

const instruments = [
  { id: "demo-level", type: "water_level", name: "田面水位计", location: "观测田 A", plot: "demo-field",
    metrics: [["田面水位", "cm", "instantaneous"]] },
  { id: "demo-flow", type: "electromagnetic_flow", name: "进水口流量计", location: "进水口", plot: "demo-inlet",
    metrics: [["瞬时流量", "m³/h", "instantaneous"], ["累计流量", "m³", "cumulative"]] },
  { id: "demo-rain", type: "rainfall", name: "田边雨量计", location: "观测田 A", plot: "demo-field",
    metrics: [["雨量示值", "mm", "unknown"]] },
];
const [level, flow, rain] = instruments;
const minute = 60_000;
// Each row is an authored ten-minute observation: level, flow rate, meter total, rain reading.
// Values and semantics belong only to this exercise, independent of any device or RS485 protocol.
const readings = [
  [2.1, 0, 124.0, 0], [2.1, 2.4, 124.2, 0], [2.3, 4.8, 124.8, 0],
  [2.6, 6.0, 125.7, 0], [2.9, 6.0, 126.7, 0], [3.2, 6.0, 127.7, 0.2],
  [3.5, 5.4, 128.65, 0.4], [3.8, 4.2, 129.45, 0.8], [4.0, 3.0, 130.05, 1.2],
  [4.2, 1.8, 130.45, 1.6], [4.3, 0.6, 130.65, 1.8], [4.2, 0, 130.70, 1.8],
  [4.1, 0, 130.70, 1.8],
];

function registerScenario(db, startedAt) {
  createExperiment(db, { id: "demo-irrigation", name: "稻田灌溉观测（演示）",
    description: "一次灌水过程中田面水位、进水口流量与田边雨量的编排样例。" });
  for (const [id, name, treatment] of [
    ["demo-field", "观测田 A", "间歇灌溉示例"], ["demo-inlet", "进水口", "供水观测示例"],
  ]) createPlot(db, { id, name, treatment, experiment_id: "demo-irrigation" });

  const gateway = db.prepare("INSERT INTO gateways (id,name,transport,location,timeout_seconds) VALUES (?,?,?,?,?)");
  const sensor = db.prepare("INSERT INTO sensors (id,gateway_id,type,name,location,freshness_seconds) VALUES (?,?,?,?,?,?)");
  const profiles = new Map();
  for (const instrument of instruments) {
    const { id, type, name, location, metrics } = instrument;
    const gatewayId = id + "-gw";
    gateway.run(gatewayId, name + "演示网关", "local-demo", location, 1800);
    sensor.run(id, gatewayId, type, name, location, 1800);
    const profile = createProfile(db, id, { version: "demo-v1", protocol_name: "本地演示 JSON",
      parser_version: "demo-json-v1", evidence_ref: "编排示例，仅供演练",
      definitions: metrics.map(([measurement_code, unit, semantics]) => ({ measurement_code, unit, semantics, required: true })) });
    profiles.set(id, profile.id);
    createInstallation(db, { sensor_id: id, plot_id: instrument.plot, start_at: startedAt });
  }
  return profiles;
}

function receive(db, profiles, instrument, values, at, quality = "valid") {
  const timestamp = new Date(at).toISOString();
  const measurements = instrument.metrics.map(([measurement_code, unit], i) => ({
    measurement_code, unit, value: values[i], value_quality: quality,
  }));
  const payload = { source: "demo", sensor_id: instrument.id, device_timestamp: timestamp, measurements };
  const result = ingest(db, {
    gatewayId: instrument.id + "-gw", sensorId: instrument.id, messageId: instrument.id + "/" + timestamp,
    receivedAt: timestamp, deviceTimestamp: timestamp, transport: "local-demo", source: "demo",
    profileId: profiles.get(instrument.id), rawPayload: Buffer.from(JSON.stringify(payload)),
    communicationVerified: true, parse: bytes => JSON.parse(bytes.toString("utf8")).measurements,
  });
  if (result.measurementCount !== measurements.length) throw new Error("Could not record demo observation");
}

// This is the only entry point: no database argument, file path, environment override or hardware adapter.
export function createDemoApp() {
  const db = openDatabase(":memory:");
  try {
    const start = Math.floor(Date.now() / minute) * minute;
    const first = start - (readings.length - 1) * 10 * minute - minute;
    const profiles = db.transaction(() => {
      const profiles = registerScenario(db, new Date(first - minute).toISOString());
      readings.forEach(([depth, rate, total, rainfall], i) => {
        const at = first + i * 10 * minute;
        receive(db, profiles, level, [depth], at);
        receive(db, profiles, flow, [rate, total], at);
        receive(db, profiles, rain, [rainfall], at);
      });
      receive(db, profiles, rain, [-0.2], start, "invalid");
      evaluateAlarms(db, start);
      return profiles;
    })();

    // Scenario time follows the last sample, so leaving a tab overnight does not invent outages.
    const lastRain = db.prepare("SELECT id,received_at,value_quality FROM telemetry_raw WHERE sensor_id=? ORDER BY id DESC LIMIT 1");
    const now = () => Date.parse(lastRain.get(rain.id).received_at);
    const app = buildApp(db, { mode: "demo", now, developmentUi: false, logger: false });
    app.addHook("onClose", async () => db.close());
    function scenario() {
      const sample = lastRain.get(rain.id);
      return { sensor_id: rain.id, sample_at: sample.received_at, raw_id: sample.id, quality: sample.value_quality };
    }
    app.get("/api/demo/scenario", async () => scenario());
    app.post("/api/demo/rain-sample", async req => {
      const quality = req.body?.quality;
      if (!["valid", "invalid"].includes(quality)) fail("请选择有效或异常演示样本");
      return db.transaction(() => {
        if (scenario().quality !== quality) {
          const at = now() + 1000;
          receive(db, profiles, rain, [quality === "valid" ? 1.8 : -0.2], at, quality);
          evaluateAlarms(db, at);
        }
        return scenario();
      })();
    });
    return app;
  } catch (error) {
    db.close();
    throw error;
  }
}
