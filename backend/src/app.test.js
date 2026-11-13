import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";

test("independent gateway and sensor schema and API", async () => {
  const db = openDatabase(":memory:");
  const app = buildApp(db);
  try {
    db.prepare("INSERT INTO gateways (id, name) VALUES (?, ?)").run(
      "gw",
      "Gateway",
    );
    db.prepare(
      "INSERT INTO sensors (id, gateway_id, type, name) VALUES (?, ?, ?, ?)",
    ).run("sensor", "gw", "rainfall", "Rain");
    assert.throws(() =>
      db
        .prepare(
          "INSERT INTO sensors (id, gateway_id, type, name) VALUES (?, ?, ?, ?)",
        )
        .run("bad", "missing", "rainfall", "Bad"),
    );
    const response = await app.inject("/api/sensors");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json()[0].gateway_id, "gw");
  } finally {
    await app.close();
    db.close();
  }
});
