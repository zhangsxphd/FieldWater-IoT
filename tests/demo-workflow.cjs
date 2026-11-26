const assert = require("node:assert/strict");
const { mkdirSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { chromium } = require("../frontend/node_modules/playwright");

async function run() {
  const { startLocalPreview } = await import("../frontend/scripts/local-preview.mjs");
  const { createDemoApp } = await import("../backend/demo/workspace.js");
  const server = await startLocalPreview(createDemoApp());
  const origin = "http://127.0.0.1:" + server.httpServer.address().port;
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.env.CI ? {} : { channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [], origins = new Set();
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", msg => { if (["error", "warning"].includes(msg.type())) errors.push(msg.text()); });
    page.on("request", request => {
      if (/^https?:/.test(request.url())) origins.add(new URL(request.url()).origin);
    });
    const screenshot = async name => {
      const dir = process.env.FIELDWATER_QA_OUTPUT;
      if (!dir) return;
      const repo = resolve(__dirname, "..");
      assert.ok(resolve(dir) !== repo && !resolve(dir).startsWith(repo + "/"));
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, name + ".png") });
    };
    const open = async path => {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.getByText("演示模式", { exact: true }).waitFor();
      assert.equal(await page.title(), "田水智联 · 演示模式");
      assert.equal(await page.locator("vite-error-overlay").count(), 0);
    };
    const button = name => page.getByRole("button", { name, exact: true });
    const nav = name => page.locator("nav").getByRole("link", { name, exact: true });
    await open("/");
    await page.getByRole("heading", { name: "稻田灌溉观测" }).waitFor();
    assert.equal(await page.locator(".metric-value").count(), 3);
    assert.equal(await page.locator(".demo-preview-chart circle").count(), 13);
    assert.match(await page.locator(".metric").last().innerText(), /1\.8 mm/);
    assert.match(await page.locator(".metric").last().innerText(), /最近数据异常/);
    await screenshot("demo-overview-desktop");
    for (const path of ["/monitor", "/history", "/analysis"]) {
      await open(path);
      await page.locator("tbody tr").first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("sensor_id"), "demo-level");
    }
    for (const path of ["/devices", "/devices/demo-flow", "/diagnostics", "/settings"]) await open(path);
    await open("/");

    for (const [index, metric] of ["田面水位", "瞬时流量", "雨量示值"].entries()) {
      await page.locator(".metric").nth(index).getByRole("link", { name: "查看指标趋势 →" }).click();
      await page.locator(".chart circle").first().waitFor();
      assert.equal(new URL(page.url()).searchParams.get("measurement_code"), metric);
      assert.equal(await page.locator(".chart circle").count(), 13);
      await nav("数据总览").click();
    }
    await page.getByRole("link", { name: "查看水位趋势 →" }).click();
    await page.locator(".context-tabs").getByRole("link", { name: "历史数据" }).click();
    await page.getByRole("heading", { name: "有效测量记录" }).waitFor();
    await page.locator("tbody tr").first().waitFor();
    assert.equal(await page.locator("tbody tr").count(), 13);
    assert.match(await page.locator("tbody tr").first().innerText(), /观测田 A/);
    for (const [label, filename] of [
      ["导出数据与查询说明", "fieldwater-demo-telemetry.json"], ["导出此范围 CSV", "fieldwater-demo-history.csv"],
    ]) {
      const downloading = page.waitForEvent("download");
      await button(label).click();
      const download = await downloading;
      assert.equal(download.suggestedFilename(), filename);
      const chunks = [];
      for await (const chunk of await download.createReadStream()) chunks.push(chunk);
      const content = Buffer.concat(chunks).toString("utf8");
      if (filename.endsWith(".json")) {
        const { manifest, rows } = JSON.parse(content);
        assert.equal(manifest.data_mode, "demo");
        assert.equal(rows.length, 13);
        assert.ok(rows.every(r => r.source === "demo" && r.plot_id === "demo-field"));
      } else assert.match(content, /"demo","local-demo"/);
    }
    await page.getByRole("link", { name: /查看 #/ }).first().click();
    await page.locator(".raw-bytes").waitFor();
    assert.match(await page.locator("main").innerText(), /local-demo/);
    await nav("试验管理").click();
    await page.getByText("观测田 A", { exact: true }).first().waitFor();
    assert.match(await page.locator("main").innerText(), /进水口/);

    await nav("数据总览").click();
    await page.getByRole("link", { name: "练习雨量告警处置 →" }).click();
    await page.getByRole("link", { name: /查看原始证据 #/ }).click();
    await page.locator(".raw-bytes").waitFor();
    assert.match(await page.locator("main").innerText(), /无效/);
    await nav("告警管理").click();
    await button("确认并记录处理").click();
    await page.locator("[name=note]").fill("演练中已复核雨量原文。");
    await button("保存处理记录").click();
    await page.locator(".alarm-item").getByText("已确认 · 故障未恢复", { exact: true }).waitFor();
    await button("补入有效雨量样本").click();
    await page.locator(".alarm-item").getByText("已恢复", { exact: true }).waitFor();
    await page.getByText(/查看处置时间线/).click();
    await page.getByText("收到恢复证据", { exact: true }).waitFor();
    await screenshot("demo-alarm-recovered");
    await button("再次演练异常").click();
    await page.locator(".alarm-item").getByText("待处理", { exact: true }).waitFor();
    assert.equal(await page.locator(".alarm-item").count(), 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await open("/");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await screenshot("demo-overview-mobile");
    assert.deepEqual([...origins], [origin], "all demo operations use only the isolated instance");
    assert.deepEqual(errors, []);
    console.log("PASS: demo labels, three instrument trends, history → raw, trial attribution, two tagged downloads, alarm confirmation → recovery → replay, desktop/mobile, same-origin traffic and healthy console");
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
