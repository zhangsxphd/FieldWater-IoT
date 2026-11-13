import React from "react";
import { Empty, fmt } from "../shared.jsx";
export default function Trend({ rows }) {
  const points = rows
    .filter(
      (r) =>
        Number.isFinite(r.value) && Number.isFinite(Date.parse(r.received_at)),
    )
    .sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));
  if (points.length < 2)
    return (
      <Empty hint="曲线需要同一仪器、指标及单位的至少两条有效记录">
        {points.length ? "记录不足，暂不连线" : "暂无有效测量记录"}
      </Empty>
    );
  const start = Date.parse(points[0].received_at),
    end = Date.parse(points.at(-1).received_at);
  if (start === end) return <Empty>接收时间相同，暂无法绘制时间趋势</Empty>;
  const min = Math.min(...points.map((p) => p.value)),
    max = Math.max(...points.map((p) => p.value)),
    padding = min === max ? Math.max(Math.abs(min) * 0.05, 0.1) : 0;
  const lo = min - padding,
    hi = max + padding,
    x = (p) => 65 + ((Date.parse(p.received_at) - start) * 595) / (end - start),
    y = (p) => 160 - ((p.value - lo) * 125) / (hi - lo);
  return (
    <div className="chart">
      <svg
        viewBox="0 0 700 205"
        role="img"
        aria-label="按服务器接收时间绘制的实测记录"
      >
        <line x1="65" y1="160" x2="660" y2="160" stroke="#cbd8d3" />
        <line x1="65" y1="35" x2="65" y2="160" stroke="#cbd8d3" />
        <polyline
          points={points.map((p) => `${x(p)},${y(p)}`).join(" ")}
          fill="none"
          stroke="#168850"
          strokeWidth="2"
        />
        {points.map((p) => (
          <circle key={p.id} cx={x(p)} cy={y(p)} r="3" fill="#168850">
            <title>
              {fmt(p.received_at)} · {p.value} {p.unit} · 原始记录 #{p.raw_id}
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
        <span>{fmt(points[0].received_at)}</span>
        <span>{points[0].unit} · 接收时间</span>
        <span>{fmt(points.at(-1).received_at)}</span>
      </div>
      <p className="form-note">
        连线仅辅助查看已收到记录，不表示缺失时段有观测，也不替代设备采样时间。
      </p>
    </div>
  );
}
