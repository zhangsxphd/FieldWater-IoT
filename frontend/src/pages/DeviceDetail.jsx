import React, { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useData,
  State,
  Panel,
  Title,
  Empty,
  Status,
  Refresh,
  fmt,
  types,
  query,
  post,
  semanticsLabels,
} from "../shared.jsx";
export default function DeviceDetail() {
  const { id } = useParams(),
    data = useData("/devices/" + encodeURIComponent(id));
  const [showProfile, setShowProfile] = useState(false),
    [saved, setSaved] = useState("");
  return (
    <>
      <div className="breadcrumbs">
        <Link to="/devices?tab=sensors">设备管理</Link>
        <span>/</span>
        <span>仪器详情</span>
      </div>
      <State state={data}>
        {(d) => (
          <>
            <Title
              title={d.name}
              description={`${types[d.type]} · ${d.id} · ${d.location || "安装位置待填写"}`}
            >
              <Refresh onClick={data.reload} />
            </Title>
            <Panel>
              <div className="device-health">
                <div>
                  <span className="eyebrow">网关通信</span>
                  <Status value={d.gateway_status} />
                  <p>
                    {d.gateway?.name || d.gateway_name} · 最近通信{" "}
                    {fmt(d.gateway?.last_contact)}
                  </p>
                </div>
                <div>
                  <span className="eyebrow">仪器数据</span>
                  <Status value={d.data_status} />
                  <p>最近有效接收 {fmt(d.last_valid_received_at)}</p>
                </div>
                <div className="row-actions">
                  <Link
                    className="secondary"
                    to={"/monitor?" + query({ sensor_id: d.id })}
                  >
                    查看监测
                  </Link>
                  <Link
                    className="secondary"
                    to={"/diagnostics?" + query({ sensor_id: d.id })}
                  >
                    接收诊断
                  </Link>
                  <Link className="secondary" to="/research">
                    安装履历
                  </Link>
                </div>
              </div>
            </Panel>
            <Panel
              title="各指标独立状态"
              extra={
                <span className="scope-text">有效值与异常状态同时保留</span>
              }
            >
              {d.metrics?.length ? (
                <div className="indicator-grid">
                  {d.metrics.map((m) => (
                    <article
                      className="indicator"
                      key={JSON.stringify([m.measurement_code, m.unit])}
                    >
                      <div className="indicator-head">
                        <strong>{m.measurement_code}</strong>
                        <Status value={m.data_status} />
                      </div>
                      <div className="indicator-value">
                        {m.latest_value ?? "—"}
                        <span>{m.unit}</span>
                      </div>
                      <p>
                        {m.latest_value == null
                          ? "暂无有效测量"
                          : "最近有效值；状态异常时不代表当前实测值"}
                      </p>
                      <dl className="compact-dl">
                        <dt>指标语义</dt>
                        <dd>{semanticsLabels[m.semantics] || "待核实"}</dd>
                        <dt>数据时间</dt>
                        <dd>{fmt(m.last_valid_at)}</dd>
                        <dt>时效依据</dt>
                        <dd>
                          {m.time_basis === "device_timestamp"
                            ? "设备采集时间"
                            : m.time_basis === "received_at"
                              ? "接收时间（设备时间缺失）"
                              : "暂无有效记录"}
                        </dd>
                        <dt>有效值档案</dt>
                        <dd>
                          {d.profiles.find((p) => p.id === m.latest_profile_id)
                            ?.version || "未记录"}
                        </dd>
                        <dt>当前时效配置</dt>
                        <dd>
                          {d.profiles.find(
                            (p) => p.id === m.freshness_profile_id,
                          )?.version || "仪器默认配置"}
                        </dd>
                        <dt>数据有效期</dt>
                        <dd>
                          {m.freshness_seconds
                            ? m.freshness_seconds + " 秒"
                            : "未配置"}
                          {m.required ? " · 必需指标" : ""}
                        </dd>
                      </dl>
                      <div className="row-actions">
                        <Link
                          to={
                            "/monitor?" +
                            query({
                              sensor_id: d.id,
                              measurement_code: m.measurement_code,
                              unit: m.unit,
                              time_basis: "received_at",
                            })
                          }
                        >
                          趋势与历史 →
                        </Link>
                        {m.latest_valid_raw_id && (
                          <Link
                            to={"/diagnostics?raw_id=" + m.latest_valid_raw_id}
                          >
                            有效值来源 #{m.latest_valid_raw_id}
                          </Link>
                        )}
                        {m.last_raw_id &&
                          m.last_raw_id !== m.latest_valid_raw_id && (
                            <Link to={"/diagnostics?raw_id=" + m.last_raw_id}>
                              最近解码记录 #{m.last_raw_id}
                            </Link>
                          )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty hint="创建有依据的指标档案，或在真实接收后查看各指标状态。没有测量时不生成读数。">
                  尚无指标记录
                </Empty>
              )}
            </Panel>
            <div className="dashboard-grid">
              <Panel
                title="最近接收证据"
                extra={
                  <Link to={"/diagnostics?" + query({ sensor_id: d.id })}>
                    查看全部 →
                  </Link>
                }
              >
                {d.recent_raw?.rows?.length ? (
                  <div className="device-list">
                    {d.recent_raw.rows.map((r) => (
                      <div key={r.id}>
                        <span>
                          <Link to={"/diagnostics?raw_id=" + r.id}>
                            原始记录 #{r.id}
                          </Link>
                          <small>
                            {fmt(r.received_at)} · {r.source}
                          </small>
                          {r.parse_error && (
                            <small className="error">{r.parse_error}</small>
                          )}
                        </span>
                        <Status value={r.parse_status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty>暂无接收记录</Empty>
                )}
              </Panel>
              <Panel
                title="告警与处置"
                extra={
                  <Link to={"/alarms?" + query({ sensor_id: d.id })}>
                    处理告警 →
                  </Link>
                }
              >
                {d.alarms?.length ? (
                  <div className="device-list">
                    {d.alarms.slice(0, 5).map((a) => (
                      <div key={a.id}>
                        <span>
                          {a.message}
                          <small>{fmt(a.raised_at)}</small>
                        </span>
                        <Status value={a.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty hint="规则依据真实通信及数据状态判断；没有接收记录不意味着测量正常。">
                    暂无关联告警
                  </Empty>
                )}
              </Panel>
            </div>
            <Panel
              title="协议与指标档案"
              extra={
                <button
                  onClick={() => {
                    setShowProfile(!showProfile);
                    setSaved("");
                  }}
                >
                  {showProfile ? "取消新增" : "新增档案版本"}
                </button>
              }
            >
              <p className="scope-text">
                每次修改创建新版本。历史报文保留采集时使用的档案快照；登记档案不等于协议已验证，也不会启用真实设备接收。
              </p>
              {saved && (
                <p role="status" className="success">
                  {saved}
                </p>
              )}
              {showProfile && (
                <ProfileForm
                  sensorId={d.id}
                  onSaved={() => {
                    setShowProfile(false);
                    setSaved("档案版本已保存，历史解析结果保持不变。");
                    data.reload();
                  }}
                />
              )}
              {d.profiles?.length ? (
                <div className="profile-list">
                  {d.profiles.map((p) => (
                    <details key={p.id}>
                      <summary>
                        <strong>版本 {p.version}</strong>
                        <span>
                          {p.protocol_name || "协议待核实"} ·{" "}
                          {fmt(p.created_at)}
                        </span>
                      </summary>
                      <dl className="compact-dl">
                        <dt>解析程序版本</dt>
                        <dd>{p.parser_version || "未记录"}</dd>
                        <dt>校准版本</dt>
                        <dd>{p.calibration_version || "未记录"}</dd>
                        <dt>证据说明</dt>
                        <dd>{p.evidence_ref || "尚未提供"}</dd>
                      </dl>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>指标</th>
                              <th>单位</th>
                              <th>语义</th>
                              <th>时效</th>
                              <th>必需</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(p.definitions || []).map((m) => (
                              <tr
                                key={JSON.stringify([
                                  m.measurement_code,
                                  m.unit,
                                ])}
                              >
                                <td>{m.measurement_code}</td>
                                <td>{m.unit}</td>
                                <td>{semanticsLabels[m.semantics]}</td>
                                <td>
                                  {m.freshness_seconds
                                    ? m.freshness_seconds + " 秒"
                                    : "沿用仪器配置"}
                                </td>
                                <td>{m.required ? "是" : "否"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                !showProfile && (
                  <Empty hint="未知参数保留空缺。不要用其他型号的寄存器、倍率或单位代替实际依据。">
                    暂无版本化档案
                  </Empty>
                )
              )}
            </Panel>
            <Panel
              title="试验安装履历"
              extra={
                <Link to={"/research?" + query({ sensor_id: d.id })}>
                  管理安装记录 →
                </Link>
              }
            >
              {d.installations?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>试验 / 小区</th>
                        <th>处理</th>
                        <th>生效起止</th>
                        <th>数据</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.installations.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.experiment_name}
                            <small>{r.plot_name}</small>
                          </td>
                          <td>{r.treatment || "未记录"}</td>
                          <td>
                            {fmt(r.start_at)}
                            <small>
                              至 {r.end_at ? fmt(r.end_at) : "尚未结束"}
                            </small>
                          </td>
                          <td>
                            <Link
                              to={
                                "/history?" +
                                query({
                                  sensor_id: d.id,
                                  experiment_id: r.experiment_id,
                                  plot_id: r.plot_id,
                                  time_basis: "measured_at",
                                  from: r.start_at,
                                  to: r.end_at,
                                })
                              }
                            >
                              查看对应数据 →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty hint="仪器迁移时结束旧安装记录，再建立新记录，保留过去数据的归属。">
                  暂无试验安装记录
                </Empty>
              )}
            </Panel>
            <Panel title="最近通信事件">
              {d.recent_events?.rows?.length ? (
                <div className="device-list">
                  {d.recent_events.rows.map((e) => (
                    <div key={e.id}>
                      <span>
                        {{
                          telemetry_received: "已验证遥测接收",
                          heartbeat: "网关心跳",
                          communication_error: "通信异常",
                        }[e.event_type] || e.event_type}
                        <small>{e.sensor_id || "网关级事件"}</small>
                      </span>
                      <span>{fmt(e.occurred_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>暂无通信事件</Empty>
              )}
            </Panel>
          </>
        )}
      </State>
    </>
  );
}
function ProfileForm({ sensorId, onSaved }) {
  const [count, setCount] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(
      [
        "version",
        "protocol_name",
        "parser_version",
        "calibration_version",
        "evidence_ref",
      ].map((k) => [k, f.get(k) || null]),
    );
    body.definitions = Array.from({ length: count }, (_, i) => ({
      measurement_code: f.get("code_" + i),
      unit: f.get("unit_" + i),
      semantics: f.get("semantics_" + i),
      required: f.has("required_" + i),
      freshness_seconds: f.get("freshness_" + i)
        ? Number(f.get("freshness_" + i))
        : null,
    }));
    try {
      await post(
        "/devices/" + encodeURIComponent(sensorId) + "/profiles",
        body,
      );
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="profile-form" onSubmit={submit}>
      <div className="form-grid">
        {[
          ["version", "档案版本 *", true],
          ["protocol_name", "协议名称"],
          ["parser_version", "解析程序版本"],
          ["calibration_version", "校准版本"],
          ["evidence_ref", "依据（说明书名称、页码或校准记录）"],
        ].map(([name, label, required]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              required={required}
              maxLength={name === "evidence_ref" ? 2000 : 100}
            />
          </label>
        ))}
      </div>
      {Array.from({ length: count }, (_, i) => (
        <fieldset className="definition-row" key={i}>
          <legend>指标 {i + 1}</legend>
          <label>
            指标代码 *<input name={"code_" + i} required maxLength={100} />
          </label>
          <label>
            单位 *<input name={"unit_" + i} required maxLength={64} />
          </label>
          <label>
            指标语义
            <select name={"semantics_" + i} defaultValue="unknown">
              {Object.entries(semanticsLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            有效期（秒）
            <input
              name={"freshness_" + i}
              type="number"
              min={1}
              max={31536000}
              step={1}
            />
          </label>
          <label className="check-label">
            <input type="checkbox" name={"required_" + i} /> 必需指标
          </label>
        </fieldset>
      ))}
      <p className="form-note">
        仅填写已确认的信息。语义未知可保留“待核实”；有效期留空沿用仪器配置。必需指标缺失会显示为无有效数据。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button
          type="button"
          disabled={count >= 64 || busy}
          onClick={() => setCount((v) => v + 1)}
        >
          增加指标
        </button>
        <button
          type="button"
          disabled={count <= 1 || busy}
          onClick={() => setCount((v) => v - 1)}
        >
          移除末项
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "保存中…" : "保存新版本"}
        </button>
      </div>
    </form>
  );
}
