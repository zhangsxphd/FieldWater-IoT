import React from "react";
import { Empty, fmt } from "../shared.jsx";
export default function Trend({ rows, timeBasis = "received_at", gapSeconds }) {
  const basis = timeBasis === "measured_at" ? "measured_at" : "received_at";
  const label = basis === "measured_at" ? "设备采集时间" : "服务器接收时间";
  const points = rows
    .filter(
      (r) => Number.isFinite(r.value) && Number.isFinite(Date.parse(r[basis])),
    )
    .sort((a, b) => Date.parse(a[basis]) - Date.parse(b[basis]));
  if (points.length < 2)
    return (
      <Empty hint="同一仪器、指标及单位至少需要两条有此时间口径的有效记录">
        {points.length ? "记录不足，暂不连线" : "暂无有效测量记录"}
      </Empty>
    );
  const start = Date.parse(points[0][basis]),
    end = Date.parse(points.at(-1)[basis]);
  if (start === end) return <Empty>记录时间相同，暂无法绘制时间趋势</Empty>;
  const min = Math.min(...points.map((p) => p.value)),
    max = Math.max(...points.map((p) => p.value));
  const padding = min === max ? Math.max(Math.abs(min) * 0.05, 0.1) : 0,
    lo = min - padding,
    hi = max + padding;
  const x = (p) => 65 + ((Date.parse(p[basis]) - start) * 595) / (end - start),
    y = (p) => 160 - ((p.value - lo) * 125) / (hi - lo);
  // Without a confirmed continuity threshold only show observed points, never imply continuous sampling.
  const segments = [];
  if (gapSeconds > 0)
    for (let i = 1; i < points.length; i++)
      if (
        Date.parse(points[i][basis]) - Date.parse(points[i - 1][basis]) <=
        gapSeconds * 1000
      )
        segments.push([points[i - 1], points[i]]);
  return (
    <div className="chart">
      <svg
        viewBox="0 0 700 205"
        role="img"
        aria-label={"按" + label + "绘制的有效测量记录"}
      >
        <line x1="65" y1="160" x2="660" y2="160" stroke="#cbd8d3" />
        <line x1="65" y1="35" x2="65" y2="160" stroke="#cbd8d3" />
        {segments.map(([a, b], i) => (
          <line
            key={i}
            x1={x(a)}
            x2={x(b)}
            y1={y(a)}
            y2={y(b)}
            stroke="#168850"
            strokeWidth="1.5"
          />
        ))}
        {points.map((p) => (
          <circle key={p.id} cx={x(p)} cy={y(p)} r="3" fill="#168850">
            <title>
              {fmt(p[basis])} · {p.value} {p.unit} · 原始记录 #{p.raw_id}
            </title>
          </circle>
        ))}
        <text x="4" y="40">
          {Number(hi.toPrecision(5))}
        </text>
        <text x="4" y="165">
          {Number(lo.toPrecision(5))}
        </text>
      </svg>
      <div className="chart-caption">
        <span>{fmt(points[0][basis])}</span>
        <span>
          {points[0].unit} · {label}
        </span>
        <span>{fmt(points.at(-1)[basis])}</span>
      </div>
      <p className="form-note">
        {gapSeconds > 0
          ? "超出已配置连续间隔时断开连线。"
          : "连续采样间隔尚未定义，以观测点显示趋势。"}{" "}
        不补齐缺失记录，不用接收时间替代采集时间。
      </p>
    </div>
  );
}
