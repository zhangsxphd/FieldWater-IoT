import Fastify from "fastify";
import { gateways, sensors } from "./status.js";
import { trustedMeasurement } from "./quality.js";
import { history, rawRecords, events } from "./queries.js";
import { fail, text, id, seconds } from "./validation.js";

const types = ["water_level", "electromagnetic_flow", "rainfall"];
const gatewayFields = [
  "manufacturer",
  "model",
  "firmware_version",
  "transport",
  "location",
  "notes",
];
const sensorFields = ["manufacturer", "model", "location", "unit", "notes"];
function objectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail("请求必须为 JSON 对象");
  return body;
}
function groupCount(rows, key, values) {
  return {
    total: rows.length,
    ...Object.fromEntries(
      values.map((v) => [v, rows.filter((r) => r[key] === v).length]),
    ),
  };
}

export function buildApp(db) {
  const app = Fastify({ logger: true, bodyLimit: 65536 });
  app.setErrorHandler((error, req, reply) => {
    if (
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
      error.code === "SQLITE_CONSTRAINT_UNIQUE"
    )
      return reply.code(409).send({ error: "编号已存在" });
    const status = error.statusCode || 500;
    if (status >= 500) req.log.error(error);
    return reply
      .code(status)
      .send({ error: status >= 500 ? "服务器处理失败" : error.message });
  });
  // Loopback binding is not CSRF protection. Browser writes must originate from our own local UI.
  app.addHook("onRequest", async (req, reply) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      req.headers.origin
    ) {
      if (
        ![
          "http://127.0.0.1:5181",
          "http://localhost:5181",
          "http://127.0.0.1:3181",
          "http://localhost:3181",
        ].includes(req.headers.origin)
      )
        return reply.code(403).send({ error: "不允许跨站修改本地数据" });
    }
  });
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/gateways", async () => gateways(db));
  app.get("/api/gateways/:id", async (req) => {
    const gateway = gateways(db).find((g) => g.id === req.params.id);
    if (!gateway) fail("网关不存在", 404);
    return {
      ...gateway,
      sensors: sensors(db).filter((s) => s.gateway_id === gateway.id),
    };
  });
  app.post("/api/gateways", async (req, reply) => {
    const b = objectBody(req.body),
      gid = id(b.id, "网关编号"),
      name = text(b.name, "网关名称", true);
    db.prepare(
      `INSERT INTO gateways (id,name,${gatewayFields.join(",")},timeout_seconds) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      gid,
      name,
      ...gatewayFields.map((f) => text(b[f], f)),
      seconds(b.timeout_seconds, "通信超时"),
    );
    return reply.code(201).send({ id: gid });
  });
  app.put("/api/gateways/:id", async (req) => {
    const old = db
      .prepare("SELECT * FROM gateways WHERE id=?")
      .get(req.params.id);
    if (!old) fail("网关不存在", 404);
    const b = { ...old, ...objectBody(req.body) };
    if (b.id !== old.id) fail("网关编号不可修改");
    db.prepare(
      `UPDATE gateways SET name=?,${gatewayFields.map((f) => `${f}=?`).join(",")},timeout_seconds=? WHERE id=?`,
    ).run(
      text(b.name, "网关名称", true),
      ...gatewayFields.map((f) => text(b[f], f)),
      seconds(b.timeout_seconds, "通信超时"),
      old.id,
    );
    return { id: old.id };
  });
  for (const url of ["/api/devices", "/api/sensors"])
    app.get(url, async () => sensors(db));
  app.post("/api/devices", async (req, reply) => {
    const b = objectBody(req.body),
      sid = id(b.id, "传感器编号"),
      gid = id(b.gateway_id, "网关编号");
    if ("timeout_seconds" in b || "transport" in b)
      fail("网关通信设置请在网关管理中修改");
    if (!types.includes(b.type)) fail("传感器类型无效");
    if (!db.prepare("SELECT id FROM gateways WHERE id=?").get(gid))
      fail("请先登记网关");
    db.prepare(
      `INSERT INTO sensors (id,gateway_id,type,name,${sensorFields.join(",")},freshness_seconds) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      sid,
      gid,
      b.type,
      text(b.name, "传感器名称", true),
      ...sensorFields.map((f) => text(b[f], f)),
      seconds(b.freshness_seconds, "数据有效期"),
    );
    return reply.code(201).send({ id: sid });
  });
  app.put("/api/devices/:id", async (req) => {
    const old = db
      .prepare("SELECT * FROM sensors WHERE id=?")
      .get(req.params.id);
    if (!old) fail("传感器不存在", 404);
    const input = objectBody(req.body);
    if ("timeout_seconds" in input || "transport" in input)
      fail("网关通信设置请在网关管理中修改");
    const b = { ...old, ...input };
    if (
      b.id !== old.id ||
      b.type !== old.type ||
      b.gateway_id !== old.gateway_id
    )
      fail("已有传感器的编号、类型和网关关联不可直接修改");
    db.prepare(
      `UPDATE sensors SET name=?,${sensorFields.map((f) => `${f}=?`).join(",")},freshness_seconds=? WHERE id=?`,
    ).run(
      text(b.name, "传感器名称", true),
      ...sensorFields.map((f) => text(b[f], f)),
      seconds(b.freshness_seconds, "数据有效期"),
      old.id,
    );
    return { id: old.id };
  });
  app.get("/api/dashboard/summary", async () => {
    const gs = gateways(db),
      ss = sensors(db);
    const gatewayCounts = groupCount(gs, "status", [
      "pending",
      "online",
      "offline",
      "communication_error",
      "timeout_unconfigured",
    ]);
    return {
      gateways: {
        ...gatewayCounts,
        online_rate: gs.length ? gatewayCounts.online / gs.length : null,
      },
      sensors: groupCount(ss, "data_status", [
        "no_data",
        "fresh",
        "stale",
        "invalid_data",
        "freshness_unconfigured",
      ]),
      last_received_at: db
        .prepare(
          `SELECT MAX(m.received_at) value FROM telemetry_measurements m WHERE ${trustedMeasurement()}`,
        )
        .get().value,
    };
  });
  app.get("/api/telemetry/series", async () =>
    db
      .prepare(
        `SELECT DISTINCT m.sensor_id,s.name AS sensor_name,m.measurement_code,m.unit FROM telemetry_measurements m JOIN sensors s ON s.id=m.sensor_id WHERE ${trustedMeasurement()} ORDER BY m.sensor_id,m.measurement_code,m.unit`,
      )
      .all(),
  );
  app.get("/api/telemetry/latest", async () =>
    db
      .prepare(
        `SELECT m.*,s.name AS sensor_name,s.gateway_id,r.transport,r.device_timestamp FROM telemetry_measurements m JOIN sensors s ON s.id=m.sensor_id JOIN telemetry_raw r ON r.id=m.raw_id
    WHERE ${trustedMeasurement()} AND m.id=(SELECT m2.id FROM telemetry_measurements m2 WHERE m2.sensor_id=m.sensor_id AND m2.measurement_code=m.measurement_code AND m2.unit=m.unit AND ${trustedMeasurement("m2")} ORDER BY COALESCE(m2.measured_at,m2.received_at) DESC,m2.id DESC LIMIT 1) ORDER BY m.received_at DESC`,
      )
      .all(),
  );
  app.get("/api/telemetry/history", async (req) => history(db, req.query));
  app.get("/api/telemetry/raw", async (req) => rawRecords(db, req.query));
  app.get("/api/events", async (req) => events(db, req.query));
  app.get("/api/telemetry/raw/:id", async (req) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) fail("原始记录编号无效");
    const row = db
      .prepare("SELECT * FROM telemetry_raw WHERE id=?")
      .get(req.params.id);
    if (!row) fail("原始记录不存在", 404);
    return {
      ...row,
      raw_payload: row.raw_payload.toString("hex"),
      measurements: db
        .prepare("SELECT * FROM telemetry_measurements WHERE raw_id=?")
        .all(row.id),
    };
  });
  app.get("/api/telemetry/history.csv", async (req, reply) => {
    const { rows } = history(db, req.query, false);
    const fields = [
      "sensor_id",
      "sensor_name",
      "gateway_id",
      "measurement_code",
      "value",
      "unit",
      "measured_at",
      "received_at",
      "communication_quality",
      "protocol_quality",
      "value_quality",
      "time_quality",
      "source",
      "transport",
      "raw_id",
    ];
    const cell = (v) =>
      `"${(typeof v === "string" ? v.replace(/^[=+@\t\r-]/, "'$&") : String(v ?? "")).replaceAll('"', '""')}"`;
    return reply
      .type("text/csv; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="fieldwater-history.csv"',
      )
      .send(
        "\uFEFF" +
          [
            fields.join(","),
            ...rows.map((r) => fields.map((f) => cell(r[f])).join(",")),
          ].join("\r\n"),
      );
  });
  app.get("/api/alarms", async () =>
    db.prepare("SELECT * FROM alarms ORDER BY raised_at DESC,id DESC").all(),
  );
  return app;
}
