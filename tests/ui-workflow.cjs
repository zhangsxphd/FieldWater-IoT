// End-to-end tests only: isolated temporary SQLite, never the project database.
const { chromium } = require("../frontend/node_modules/playwright");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, mkdirSync } = require("node:fs");
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
        : process.env.CI
          ? { headless: true }
          : { channel: "chrome", headless: true },
    );
    const page = await browser.newPage({
        viewport: { width: 1440, height: 960 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const evidence = process.env.FIELDWATER_QA_OUTPUT;
    if (evidence) {
      assert.ok(
        !resolve(evidence).startsWith(root + "/"),
        "QA evidence must stay outside repo",
      );
      mkdirSync(evidence, { recursive: true });
    }
    const shot = async (name) => {
      if (evidence)
        await page.screenshot({
          path: join(evidence, name + ".png"),
          fullPage: false,
        });
    };
    const local = (ms) => {
      const d = new Date(ms);
      return new Date(ms - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    };
    await page.goto("http://127.0.0.1:5181/", { waitUntil: "networkidle" });
    assert.match(
      await page.locator("main").innerText(),
      /开始建立你的监测系统/,
    );
    assert.match(await page.locator("main").innerText(), /网关在线率\n—/);
    assert.match(await page.title(), /田水智联/);
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    await shot("overview-empty-desktop");
    for (const route of [
      "/devices",
      "/research",
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
      assert.ok((await page.locator("main").innerText()).length > 40);
      assert.equal(await page.locator("vite-error-overlay").count(), 0);
    }
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
    // Real form workflows write only into this script's temporary database.
    await page
      .locator("tr")
      .filter({ hasText: "qa-sensor-a" })
      .getByRole("link", { name: "隔离仪器A", exact: true })
      .click();
    await page
      .getByRole("button", { name: "新增档案版本", exact: true })
      .click();
    await page.locator("[name=version]").fill("qa-v1");
    await page.locator("[name=parser_version]").fill("isolated-test-parser");
    await page
      .locator("[name=evidence_ref]")
      .fill("隔离测试定义，非真实硬件说明书");
    await page.locator("[name=code_0]").fill("test_register");
    await page.locator("[name=unit_0]").fill("test_unit");
    await page.locator("[name=semantics_0]").selectOption("instantaneous");
    await page.locator("[name=required_0]").check();
    await page.getByRole("button", { name: "增加指标", exact: true }).click();
    await page.locator("[name=code_1]").fill("test_total");
    await page.locator("[name=unit_1]").fill("test_unit");
    await page.locator("[name=semantics_1]").selectOption("cumulative");
    await page.locator("[name=required_1]").check();
    await page.getByRole("button", { name: "保存新版本", exact: true }).click();
    await page
      .getByText("档案版本已保存，历史解析结果保持不变。", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".indicator").count(), 2);
    const profiles = await (
      await fetch("http://127.0.0.1:3181/api/devices/qa-sensor-a/profiles")
    ).json();
    assert.equal(profiles.length, 1);
    const profileId = profiles[0].id;
    await page.goto("http://127.0.0.1:5181/research", {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "新建试验", exact: true }).click();
    await page.locator("[name=id]").fill("qa-trial");
    await page.locator("[name=name]").fill("隔离试验");
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await page
      .getByRole("button", { name: "新建小区", exact: true })
      .waitFor({ state: "visible" });
    for (const suffix of ["a", "b"]) {
      await page.getByRole("button", { name: "新建小区", exact: true }).click();
      await page.locator("[name=experiment_id]").selectOption("qa-trial");
      await page.locator("[name=id]").fill("qa-plot-" + suffix);
      await page.locator("[name=name]").fill("隔离小区" + suffix);
      await page.locator("[name=treatment]").fill("隔离测试处理");
      await page.getByRole("button", { name: "保存记录", exact: true }).click();
      await page.getByText("隔离小区" + suffix, { exact: true }).waitFor();
    }
    const boundary = local(Date.now() - 3600000);
    await page.getByRole("button", { name: "记录安装", exact: true }).click();
    await page.locator("[name=sensor_id]").selectOption("qa-sensor-a");
    await page.locator("[name=plot_id]").selectOption("qa-plot-a");
    await page.locator("[name=start_at]").fill(local(Date.now() - 7200000));
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await page.getByRole("button", { name: "结束安装", exact: true }).waitFor();
    await page.getByRole("button", { name: "记录安装", exact: true }).click();
    await page.locator("[name=sensor_id]").selectOption("qa-sensor-a");
    await page.locator("[name=plot_id]").selectOption("qa-plot-b");
    await page.locator("[name=start_at]").fill(boundary);
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "不能重叠" }).waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "结束安装", exact: true }).click();
    await page.locator("[name=end_at]").fill(boundary);
    await page
      .getByRole("button", { name: "确认结束安装", exact: true })
      .click();
    await page
      .getByText("旧安装记录已结束，历史归属保留。", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "记录安装", exact: true }).click();
    await page.locator("[name=sensor_id]").selectOption("qa-sensor-a");
    await page.locator("[name=plot_id]").selectOption("qa-plot-b");
    await page.locator("[name=start_at]").fill(boundary);
    await page.getByRole("button", { name: "保存记录", exact: true }).click();
    await page.getByRole("button", { name: "结束安装", exact: true }).waitFor();
    await shot("research-isolated-desktop");
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
          profileId,
          deviceTimestamp: new Date(Date.now() - (1 - i) * 1000).toISOString(),
          rawPayload: Buffer.from([i]),
          transport: "isolated-test",
          source: "isolated-test",
          receivedAt: new Date(Date.now() - (1 - i) * 1000).toISOString(),
          communicationVerified: true,
          parse: () => [
            {
              measurement_code: "test_register",
              value,
              unit: "test_unit",
              value_quality: "valid",
              quality_status: "isolated-test",
            },
            {
              measurement_code: "test_total",
              value: 100 + i,
              unit: "test_unit",
              value_quality: "valid",
            },
          ],
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
    await page.goto("http://127.0.0.1:5181/devices?tab=sensors", {
      waitUntil: "networkidle",
    });
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
    await page
      .locator("[name=series]")
      .selectOption(JSON.stringify(["test_register", "test_unit"]));
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByText("算术均值", { exact: false }).waitFor();
    assert.match(await page.locator("main").innerText(), /1.5 test_unit/);
    await page.locator("[name=time_basis]").selectOption("measured_at");
    await page.locator("[name=experiment_id]").selectOption("qa-trial");
    await page.locator("[name=plot_id]").selectOption("qa-plot-b");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page.getByText("1.5 test_unit", { exact: true }).waitFor();
    assert.match(page.url(), /time_basis=measured_at/);
    assert.match(await page.locator("main").innerText(), /隔离小区b/);
    await shot("analysis-isolated-desktop");
    const jsonDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出数据与查询说明", exact: true })
      .click();
    const jsonFile = await jsonDownload;
    await jsonFile.saveAs(join(dir, "result.json"));
    const exported = JSON.parse(
      require("node:fs").readFileSync(join(dir, "result.json"), "utf8"),
    );
    assert.equal(exported.manifest.count, 2);
    assert.equal(exported.rows[0].plot_id, "qa-plot-b");
    assert.equal(exported.manifest.filters.time_basis, "measured_at");
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
    await page.getByText(/查看本次解析使用的档案快照/).click();
    assert.match(
      await page.locator(".raw-profile").innerText(),
      /isolated-test-parser/,
    );
    await page.goto("http://127.0.0.1:5181/diagnostics?parse_status=rejected", {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("button", { name: /查看 #/ })
      .first()
      .click();
    await page.locator(".raw-bytes").waitFor();
    assert.match(await page.locator("main").innerText(), /not verified/);
    const problemDb = openDatabase(file);
    let invalidRaw;
    try {
      invalidRaw = ingest(problemDb, {
        gatewayId: "qa-gateway",
        sensorId: "qa-sensor-a",
        profileId,
        messageId: "invalid-test-metric",
        rawPayload: Buffer.from("invalid fixture"),
        deviceTimestamp: new Date().toISOString(),
        transport: "isolated-test",
        source: "isolated-test",
        communicationVerified: true,
        parse: () => [
          {
            measurement_code: "test_register",
            value: 9,
            unit: "test_unit",
            value_quality: "invalid",
          },
          {
            measurement_code: "test_total",
            value: 102,
            unit: "test_unit",
            value_quality: "valid",
          },
        ],
      }).rawId;
    } finally {
      problemDb.close();
    }
    await page.goto("http://127.0.0.1:5181/devices/qa-sensor-a", {
      waitUntil: "networkidle",
    });
    const indicator = page
      .locator(".indicator")
      .filter({
        has: page.locator(".indicator-head strong", {
          hasText: "test_register",
        }),
      });
    assert.match(await indicator.innerText(), /最近数据异常/);
    assert.match(await indicator.innerText(), /有效值来源 #2/);
    assert.match(
      await indicator.innerText(),
      new RegExp("最近解码记录 #" + invalidRaw),
    );
    await shot("device-isolated-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".top").count(), 1);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      false,
    );
    await shot("device-isolated-mobile");
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("link", { name: "处理告警 →", exact: true }).click();
    await page
      .getByRole("button", { name: "确认并记录处理", exact: true })
      .first()
      .click();
    await page
      .locator("[name=note]")
      .fill("隔离验收：核对原文，等待新的有效观测");
    await page
      .getByRole("button", { name: "保存处理记录", exact: true })
      .click();
    await page
      .locator(".alarm-item")
      .getByText("已确认 · 故障未恢复", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(".alarm-item")
        .getByText("已恢复", { exact: true })
        .count(),
      0,
    );
    const recoveryDb = openDatabase(file);
    try {
      ingest(recoveryDb, {
        gatewayId: "qa-gateway",
        sensorId: "qa-sensor-a",
        profileId,
        messageId: "recovered-test-metric",
        rawPayload: Buffer.from("recovery fixture"),
        deviceTimestamp: new Date().toISOString(),
        transport: "isolated-test",
        source: "isolated-test",
        communicationVerified: true,
        parse: () => ({
          measurement_code: "test_register",
          value: 3,
          unit: "test_unit",
          value_quality: "valid",
        }),
      });
    } finally {
      recoveryDb.close();
    }
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page
      .locator(".alarm-item")
      .getByText("已恢复", { exact: true })
      .waitFor();
    await shot("alarm-recovered-isolated");
    for (const route of [
      "/monitor",
      "/history",
      "/analysis",
      "/diagnostics",
      "/alarms",
      "/settings",
      "/research",
      "/devices/qa-sensor-a",
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
      "PASS: empty state, gateway→2 sensors, independent edits, A fresh/B no_data, analysis→raw, rejected audit, 10 routes, versioned multi-metric detail, trial/plot move, JSON export, alarm acknowledgement/recovery, mobile and error state",
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
