import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Waves, RefreshCw } from "lucide-react";
export const types = {
  water_level: "水位计",
  electromagnetic_flow: "电磁流量计",
  rainfall: "雨量计",
};
export const labels = {
  pending: "待接入",
  online: "在线",
  offline: "离线",
  communication_error: "通信异常",
  timeout_unconfigured: "通信超时未配置",
  no_data: "无有效数据",
  fresh: "数据新鲜",
  stale: "数据已过期",
  invalid_data: "最近数据异常",
  freshness_unconfigured: "时效未配置",
  parsed: "解析完成",
  failed: "解析失败",
  duplicate: "重复报文",
  pending: "待处理 / 待接入",
  verified: "已验证",
  valid: "有效",
  invalid: "无效",
  unverified: "未核实",
  missing: "时间缺失",
  future: "未来时间",
  not_checked: "未检查",
  unknown: "未知",
  rejected: "拒绝入测量库",
  conflict: "消息编号冲突",
  legacy_unknown: "历史质量未复核",
};
export const fmt = (v) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleString("zh-CN", { hour12: false })
    : "—";
export const query = (o) =>
  new URLSearchParams(
    Object.entries(o).filter(([, v]) => v !== "" && v != null),
  ).toString();
export async function api(path, options = {}) {
  const r = await fetch("/api" + path, options);
  if (!r.ok) {
    let b = {};
    try {
      b = await r.json();
    } catch {}
    throw Error(
      b.error?.message || b.error || b.message || `请求失败 (${r.status})`,
    );
  }
  return r.json();
}
export function useData(path) {
  const [state, set] = useState({ loading: true, data: null, error: null }),
    [version, refresh] = useState(0);
  useEffect(() => {
    let active = true,
      running = false;
    const abort = new AbortController();
    set({ loading: true, data: null, error: null });
    async function run() {
      if (running) return;
      running = true;
      try {
        const data = await api(path, { signal: abort.signal });
        if (active) set({ data, loading: false, error: null });
      } catch (e) {
        if (active && e.name !== "AbortError")
          set({ data: null, loading: false, error: e.message });
      } finally {
        running = false;
      }
    }
    run();
    const timer = setInterval(run, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      abort.abort();
    };
  }, [path, version]);
  return { ...state, reload: () => refresh((v) => v + 1) };
}
export function State({ state, children }) {
  if (state.loading)
    return (
      <div className="empty" role="status">
        正在读取数据…
      </div>
    );
  if (state.error)
    return (
      <div className="empty error" role="alert">
        {state.error}
        <button onClick={state.reload}>重新加载</button>
      </div>
    );
  return children(state.data);
}
export function Empty({ children = "暂无实测数据", hint, to, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Waves size={22} />
      </span>
      <strong>{children}</strong>
      {hint && <p>{hint}</p>}
      {to && (
        <Link className="secondary" to={to}>
          {action || "查看下一步"}
        </Link>
      )}
    </div>
  );
}
export function Panel({ title, extra, children }) {
  return (
    <section className="panel">
      {title && (
        <div className="panel-head">
          <h2>{title}</h2>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}
export function Title({ title, description, children }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Status({ value }) {
  return (
    <span className={"status " + value}>{labels[value] || value || "—"}</span>
  );
}
export function Pagination({ data, page, setPage }) {
  return (
    <div className="pagination">
      <span>
        共 {data.total} 条 · 第 {page + 1} 页
      </span>
      <button disabled={!page} onClick={() => setPage(page - 1)}>
        上一页
      </button>
      <button
        disabled={(page + 1) * data.limit >= data.total}
        onClick={() => setPage(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
export function Refresh({ onClick }) {
  return (
    <button onClick={onClick}>
      <RefreshCw size={15} />
      刷新
    </button>
  );
}
export function MeasurementTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {[
              "仪器 / 指标",
              "测量值",
              "设备时间",
              "接收时间",
              "时间质量",
              "来源",
              "原始记录",
            ].map((x) => (
              <th key={x}>{x}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.sensor_name}
                <small>{r.measurement_code}</small>
              </td>
              <td>
                {r.value} {r.unit}
              </td>
              <td>{fmt(r.measured_at)}</td>
              <td>{fmt(r.received_at)}</td>
              <td>
                <Status value={r.time_quality} />
              </td>
              <td>
                {r.source}
                <small>{r.transport}</small>
              </td>
              <td>
                <Link to={"/diagnostics?raw_id=" + r.raw_id}>
                  查看 #{r.raw_id}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExportCsv({ href }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(href);
      if (!response.ok) {
        let body = {};
        try {
          body = await response.json();
        } catch {}
        throw Error(body.error || `导出失败 (${response.status})`);
      }
      if (!response.headers.get("content-type")?.includes("text/csv"))
        throw Error("返回格式不是 CSV，请重试或检查后端");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "fieldwater-history.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="export-control">
      <button onClick={download} disabled={busy}>
        {busy ? "正在导出…" : "导出此范围 CSV"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
