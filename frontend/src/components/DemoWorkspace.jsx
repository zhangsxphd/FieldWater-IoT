import React, { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { State, fmt, post, query, useData } from "../shared.jsx";
import Trend from "./Trend.jsx";

export const demoLevelScope = query({ sensor_id: "demo-level", measurement_code: "田面水位", unit: "cm", time_basis: "measured_at" });

export function DemoOverview() {
  const data = useData("/telemetry/history?" + demoLevelScope);
  return (
    <section className="demo-overview" aria-label="演示试验回放">
      <div className="demo-story">
        <span className="demo-kicker"><FlaskConical size={16} />试验回放</span>
        <h2>稻田灌溉观测</h2>
        <p>跟随一次灌水，查看田面水位和进水流量的变化，再复核田边雨量计的一条异常样本。</p>
        <p className="demo-storage">全部读数均为示例。操作只保存在本次演示内存中。</p>
        <div className="demo-links">
          <Link to={"/monitor?" + demoLevelScope}>查看水位趋势 →</Link>
          <Link to="/alarms?sensor_id=demo-rain">练习雨量告警处置 →</Link>
        </div>
      </div>
      <div className="demo-preview-chart">
        <div className="demo-chart-heading"><strong>田面水位</strong><span>观测田 A · 每 10 分钟</span></div>
        <State state={data}>{result => <Trend rows={result.rows} timeBasis="measured_at" gapSeconds={600} compact />}</State>
      </div>
    </section>
  );
}

export function DemoRainExercise({ onSample }) {
  const state = useData("/demo/scenario");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function addSample(quality) {
    setBusy(true);
    setError("");
    try {
      await post("/demo/rain-sample", { quality });
      state.reload();
      onSample();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="demo-exercise" aria-label="雨量告警演练">
      <State state={state}>{sample => (
        <>
          <div>
            <h2>雨量告警演练</h2>
            <p>{sample.quality === "invalid" ? "先查看原始证据并填写确认说明，再补入有效样本，观察告警恢复。" :
              "有效样本已到达。可在处置时间线查看恢复证据，或再次演练。"}</p>
            <small>场景时间 {fmt(sample.sample_at)} · <Link to={"/diagnostics?raw_id=" + sample.raw_id}>最近样本 #{sample.raw_id}</Link></small>
          </div>
          <button type="button" disabled={busy} onClick={() => addSample(sample.quality === "invalid" ? "valid" : "invalid")}>
            {sample.quality === "invalid" ? "补入有效雨量样本" : "再次演练异常"}
          </button>
        </>
      )}</State>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
