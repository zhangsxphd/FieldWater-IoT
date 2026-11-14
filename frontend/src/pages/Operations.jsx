import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useData,
  State,
  Title,
  Panel,
  Empty,
  fmt,
  Status,
  Refresh,
  query,
  post,
  Pagination,
} from "../shared.jsx";
const alarmKinds = {
  gateway_communication: "网关通信异常",
  sensor_stale: "仪器数据过期",
  sensor_invalid: "仪器数据异常",
};
export function Alarms() {
  const [params, setParams] = useSearchParams(),
    data = useData("/alarms?" + params.toString());
  const [editor, setEditor] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const note = new FormData(e.currentTarget).get("note");
    try {
      await post("/alarms/" + editor.id + "/" + editor.action, { note });
      setMessage(
        editor.action === "ack"
          ? "已记录确认；故障状态将继续根据实际证据判断。"
          : "处理备注已保存。",
      );
      setEditor(null);
      data.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="告警管理"
        description="发现异常、复核证据、记录处理，再等待实际恢复。确认告警不会清除故障。"
      >
        <Refresh onClick={data.reload} />
      </Title>
      <Panel title="告警范围">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(query(Object.fromEntries(new FormData(e.currentTarget))));
          }}
          key={params.toString()}
        >
          <label>
            状态
            <select name="status" defaultValue={params.get("status") || ""}>
              <option value="">全部状态</option>
              <option value="open">待处理</option>
              <option value="acknowledged">已确认，等待恢复</option>
              <option value="resolved">已恢复</option>
            </select>
          </label>
          <label>
            仪器编号
            <input
              name="sensor_id"
              defaultValue={params.get("sensor_id") || ""}
            />
          </label>
          <label>
            网关编号
            <input
              name="gateway_id"
              defaultValue={params.get("gateway_id") || ""}
            />
          </label>
          <button className="primary">筛选告警</button>
          <Link to="/alarms">清除筛选</Link>
        </form>
        <p className="form-note">
          本地规则使用网关通信超时、仪器数据时效与最近解析结果；无接收证据或未配置超时时不会制造离线告警。测量阈值告警尚未启用。
        </p>
      </Panel>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {editor && (
        <Panel
          title={editor.action === "ack" ? "确认并记录处理" : "追加处理记录"}
          extra={
            <button
              onClick={() => {
                setEditor(null);
                setError("");
              }}
            >
              取消
            </button>
          }
        >
          <form onSubmit={save} className="form-grid">
            <label className="wide">
              处理说明 *
              <textarea name="note" required maxLength={2000} rows={3} />
            </label>
            {error && (
              <p className="error wide" role="alert">
                {error}
              </p>
            )}
            <div className="wide">
              <button className="primary" disabled={busy}>
                {busy ? "保存中…" : "保存处理记录"}
              </button>
            </div>
          </form>
        </Panel>
      )}
      <State state={data}>
        {(rows) => (
          <Panel title={`告警记录 · ${rows.length}`}>
            {rows.length ? (
              <div className="alarm-list">
                {rows.map((a) => (
                  <article className="alarm-item" key={a.id}>
                    <div className="alarm-head">
                      <div>
                        <span className="eyebrow">
                          {alarmKinds[a.kind] || "历史告警"} · #{a.id}
                        </span>
                        <h3>{a.message}</h3>
                        <p>
                          发生于 {fmt(a.raised_at)} ·{" "}
                          {a.sensor_id || a.gateway_id || "未关联设备"}
                        </p>
                      </div>
                      <Status value={a.status} />
                    </div>
                    <div className="row-actions">
                      {a.sensor_id && (
                        <Link
                          to={"/devices/" + encodeURIComponent(a.sensor_id)}
                        >
                          仪器详情 →
                        </Link>
                      )}
                      <Link
                        to={
                          "/diagnostics?" +
                          query(
                            a.raw_id
                              ? { raw_id: a.raw_id }
                              : {
                                  gateway_id: a.gateway_id,
                                  sensor_id: a.sensor_id,
                                },
                          )
                        }
                      >
                        {a.raw_id
                          ? "查看原始证据 #" + a.raw_id
                          : "查看通信证据"}
                      </Link>
                      {a.status === "open" && (
                        <button
                          onClick={() => {
                            setEditor({ id: a.id, action: "ack" });
                            setError("");
                            setMessage("");
                          }}
                        >
                          确认并记录处理
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditor({ id: a.id, action: "notes" });
                          setError("");
                          setMessage("");
                        }}
                      >
                        追加备注
                      </button>
                    </div>
                    <div className="scope">
                      <span>确认时间：{fmt(a.acknowledged_at)}</span>
                      <span>恢复时间：{fmt(a.resolved_at)}</span>
                      {a.event_id && <span>通信事件 #{a.event_id}</span>}
                    </div>
                    {a.actions?.length > 0 && (
                      <details>
                        <summary>
                          查看处置时间线（{a.actions.length} 条）
                        </summary>
                        <ol className="audit-timeline">
                          {a.actions.map((action) => (
                            <li key={action.id}>
                              <strong>
                                {{
                                  opened: "触发告警",
                                  acknowledged: "人工确认",
                                  note: "处理备注",
                                  resolved: "实际状态恢复",
                                }[action.action] || action.action}
                              </strong>
                              <span>
                                {fmt(action.occurred_at)} ·{" "}
                                {action.actor === "system"
                                  ? "系统规则"
                                  : "本地操作员"}
                              </span>
                              {action.note && <p>{action.note}</p>}
                              {action.raw_id && (
                                <Link
                                  to={"/diagnostics?raw_id=" + action.raw_id}
                                >
                                  原始证据 #{action.raw_id}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                to="/diagnostics"
                action="检查接收诊断"
                hint="空列表不代表测量正常；可检查接收证据、设备状态及超时配置。"
              >
                当前范围暂无告警
              </Empty>
            )}
          </Panel>
        )}
      </State>
    </>
  );
}
export function Settings() {
  const gateways = useData("/gateways"),
    sensors = useData("/devices");
  return (
    <>
      <Title
        title="系统设置与接入准备"
        description="检查真实配置缺项，并追溯本地档案和处置操作。"
      />
      <Panel title="当前运行能力">
        <div className="settings-row">
          <strong>网络范围</strong>
          <span>本机开发服务 · 127.0.0.1</span>
        </div>
        <div className="settings-row">
          <strong>HTTP / MQTT / TCP 设备接收</strong>
          <span>尚未开放</span>
        </div>
        <div className="settings-row">
          <strong>身份认证</strong>
          <span>尚未启用；本地操作记录不等同于实名审计</span>
        </div>
        <div className="settings-row">
          <strong>通信与数据质量告警</strong>
          <span>已启用本地状态规则 · 确认与恢复分开记录</span>
        </div>
        <div className="settings-row">
          <strong>数据分析</strong>
          <span>完整范围统计 · 双时间口径 · 原文及档案版本追溯</span>
        </div>
      </Panel>
      <Panel title="配置检查">
        <State state={gateways}>
          {(gs) => (
            <State state={sensors}>
              {(ss) => (
                <div className="readiness">
                  <div>
                    <strong>网关通信配置</strong>
                    <p>
                      {gs.length} 台已登记；
                      {gs.filter((g) => !g.timeout_seconds).length}{" "}
                      台尚未配置通信超时。
                    </p>
                    <Link to="/devices?tab=gateways">管理网关 →</Link>
                  </div>
                  <div>
                    <strong>仪器指标与时效</strong>
                    <p>
                      {ss.length} 台已关联；
                      {ss.filter((s) => !s.freshness_seconds).length}{" "}
                      台未配置仪器默认时效，指标可单独配置。
                    </p>
                    <Link to="/devices?tab=sensors">管理仪器 →</Link>
                  </div>
                  <div>
                    <strong>试验归属</strong>
                    <p>
                      通过安装履历关联采集时间；未知设备时间不推定试验小区。
                    </p>
                    <Link to="/research">管理试验与安装 →</Link>
                  </div>
                </div>
              )}
            </State>
          )}
        </State>
      </Panel>
      <Panel title="真实接入前核查">
        <ol className="checklist">
          <li>核对实际网关与仪器型号、固件及串口配置，保留完整说明书版本。</li>
          <li>
            建立有依据的指标档案：寄存器语义、倍率、单位、时间和校准记录。
          </li>
          <li>
            依据 DTU 实际能力选择传输和独立身份认证，设备编号不能代替凭据。
          </li>
          <li>
            在隔离联调库验证原文、多指标、异常和重复；通过后再安排真实采集。
          </li>
        </ol>
      </Panel>
      <AuditLog />
    </>
  );
}
function AuditLog() {
  const [page, setPage] = useState(0),
    data = useData("/audit?" + query({ limit: 10, offset: page * 10 }));
  return (
    <Panel title="最近操作审计">
      <State state={data}>
        {(d) =>
          d.rows.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作</th>
                      <th>对象</th>
                      <th>执行来源</th>
                      <th>详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{fmt(r.occurred_at || r.created_at)}</td>
                        <td>{r.action}</td>
                        <td>
                          {r.entity_type}
                          <small>{r.entity_id}</small>
                        </td>
                        <td>
                          {r.actor === "local_operator"
                            ? "本地操作员（未认证）"
                            : r.actor}
                        </td>
                        <td>
                          <details>
                            <summary>查看修改记录</summary>
                            <pre className="audit-json">
                              {JSON.stringify(r, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          ) : (
            <Empty hint="档案、安装履历及告警处置操作将保留审计记录。">
              暂无操作记录
            </Empty>
          )
        }
      </State>
    </Panel>
  );
}
