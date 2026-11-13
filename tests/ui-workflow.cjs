// End-to-end tests only: isolated temporary SQLite, never the project database.
const { chromium } = require("../frontend/node_modules/playwright");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const net = require("node:net");
const root = resolve(__dirname, "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function free(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        Error(
          `Port ${port} occupied; stop your local development service before QA`,
        ),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
(async () => {
  await free(3181);
  await free(5181);
  const dir = mkdtempSync(join(tmpdir(), "fieldwater-ui-test-")),
    file = join(dir, "isolated.sqlite");
  let browser;
  const children = [];
  try {
    children.push(
      spawn(process.execPath, ["src/server.js"], {
        cwd: join(root, "backend"),
        env: { ...process.env, FIELDWATER_DB: file, PORT: "3181" },
        stdio: "ignore",
      }),
    );
    children.push(
      spawn(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "--host",
          "127.0.0.1",
          "--port",
          "5181",
          "--strictPort",
        ],
        { cwd: join(root, "frontend"), stdio: "ignore" },
      ),
    );
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (children.some((p) => p.exitCode !== null))
        throw Error("QA service failed to start");
      try {
        const r = await fetch("http://127.0.0.1:5181/api/health");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, "QA services ready");
    browser = await chromium.launch(
      process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH, headless: true }
        : { channel: "chrome", headless: true },
    );
    const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5181/", { waitUntil: "networkidle" });
    assert.match(
      await page.locator("main").innerText(),
      /开始建立你的监测系统/,
    );
    assert.match(await page.locator("main").innerText(), /网关在线率\n—/);
    await page.getByRole("link", { name: "设备管理", exact: true }).click();
    await page.getByRole("button", { name: "网关管理", exact: true }).click();
    await page.getByRole("button", { name: "登记网关", exact: true }).click();
    await page.locator("[name=id]").fill("qa-gateway");
    await page.locator("[name=name]").fill("隔离验收网关");
    await page.locator("[name=timeout_seconds]").fill("3600");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("登记成功。", { exact: false }).waitFor();
    await page.getByRole("button", { name: "传感器管理", exact: true }).click();
    for (const suffix of ["a", "b"]) {
      await page.getByRole("button", { name: "登记仪器", exact: true }).click();
      await page.locator("[name=gateway_id]").selectOption("qa-gateway");
      await page.locator("[name=type]").selectOption("rainfall");
      await page.locator("[name=id]").fill("qa-sensor-" + suffix);
      await page.locator("[name=name]").fill("隔离仪器" + suffix.toUpperCase());
      await page.locator("[name=freshness_seconds]").fill("3600");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .locator("tr")
        .filter({ hasText: "qa-sensor-" + suffix })
        .waitFor();
    }
    assert.equal(
      await page.getByText("无有效数据", { exact: true }).count(),
      2,
    );
    await page
      .locator("tr")
      .filter({ hasText: "qa-sensor-b" })
      .getByRole("button", { name: "修改", exact: true })
      .click();
    assert.equal(await page.locator("[name=timeout_seconds]").count(), 0);
    await page.locator("[name=location]").fill("隔离试验位置");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText("信息已更新", { exact: true }).waitFor();
    const { openDatabase } = await import(
      pathToFileURL(join(root, "backend/src/db.js"))
    );
    const { ingest } = await import(
      pathToFileURL(join(root, "backend/src/ingest.js"))
    );
    const db = openDatabase(file);
    try {
      for (const [i, value] of [1, 2].entries())
        ingest(db, {
          gatewayId: "qa-gateway",
          sensorId: "qa-sensor-a",
          messageId: "fixture-" + i,
          rawPayload: Buffer.from([i]),
          transport: "isolated-test",
          source: "isolated-test",
          receivedAt: new Date(Date.now() - (1 - i) * 1000).toISOString(),
          communicationVerified: true,
          parse: () => ({
            measurement_code: "test_register",
            value,
            unit: "test_unit",
            value_quality: "valid",
            quality_status: "isolated-test",
          }),
        });
      ingest(db, {
        gatewayId: "qa-gateway",
        sensorId: "qa-sensor-a",
        rawPayload: Buffer.from([3]),
        transport: "isolated-test",
        source: "isolated-test",
        communicationVerified: false,
      });
    } finally {
      db.close();
    }
    await page.reload({ waitUntil: "networkidle" });
    assert.match(
      await page.locator("tr").filter({ hasText: "qa-sensor-a" }).innerText(),
      /数据新鲜/,
    );
    assert.match(
      await page.locator("tr").filter({ hasText: "qa-sensor-b" }).innerText(),
      /无有效数据/,
    );
    await page.goto("http://127.0.0.1:5181/analysis?sensor_id=qa-sensor-a", {
      waitUntil: "networkidle",
    });
    await page.locator("[name=series]").selectOption({ index: 1 });
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByText("算术均值", { exact: false }).waitFor();
    assert.match(await page.locator("main").innerText(), /1.5 test_unit/);
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出此范围 CSV", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(join(dir, "result.csv"));
    assert.match(
      require("node:fs").readFileSync(join(dir, "result.csv"), "utf8"),
      /test_register/,
    );
    await page.route("**/api/telemetry/history.csv?**", (r) =>
      r.fulfill({
        status: 413,
        contentType: "application/json",
        body: '{"error":"请缩小导出范围"}',
      }),
    );
    await page
      .getByRole("button", { name: "导出此范围 CSV", exact: true })
      .click();
    await page.getByText("请缩小导出范围", { exact: true }).waitFor();
    assert.match(page.url(), /analysis/);
    await page.unroute("**/api/telemetry/history.csv?**");
    await page
      .getByRole("link", { name: /查看 #/ })
      .first()
      .click();
    await page.locator(".raw-bytes").waitFor();
    assert.match(await page.locator("main").innerText(), /此报文的解码结果/);
    await page.goto("http://127.0.0.1:5181/diagnostics?parse_status=rejected", {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /查看 #/ })
      .first()
      .click();
    await page.locator(".raw-bytes").waitFor();
    assert.match(await page.locator("main").innerText(), /not verified/);
    for (const route of [
      "/monitor",
      "/history",
      "/analysis",
      "/diagnostics",
      "/alarms",
      "/settings",
    ]) {
      await page.goto("http://127.0.0.1:5181" + route, {
        waitUntil: "networkidle",
      });
      assert.ok((await page.locator("h1").textContent()).length > 0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://127.0.0.1:5181/", { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      false,
    );
    await page.route("**/api/telemetry/raw?**", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"isolated error test"}',
      }),
    );
    await page
      .getByRole("link", { name: "接收诊断", exact: true })
      .last()
      .click();
    await page.getByRole("alert").waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: empty state, gateway→2 sensors, independent edits, A fresh/B no_data, analysis→raw, rejected audit, 8 routes, mobile and error state",
    );
  } finally {
    if (browser) await browser.close();
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise((r) => child.once("exit", r)),
      ),
    );
    rmSync(dir, { recursive: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
