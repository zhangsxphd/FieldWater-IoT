import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  api,
  useData,
  State,
  Title,
  Panel,
  Empty,
  Status,
  fmt,
  types,
  Refresh,
} from "../shared.jsx";
const gatewayFields = [
  ["id", "网关编号", true],
  ["name", "网关名称", true],
  ["manufacturer", "厂家"],
  ["model", "型号"],
  ["firmware_version", "固件版本"],
  ["transport", "通信方式"],
  ["timeout_seconds", "通信超时（秒）"],
  ["location", "安装位置"],
  ["notes", "备注"],
];
const sensorFields = [
  ["id", "仪器编号", true],
  ["name", "仪器名称", true],
  ["manufacturer", "厂家"],
  ["model", "型号"],
  ["unit", "输出单位"],
  ["freshness_seconds", "有效数据时效（秒）"],
  ["location", "安装位置"],
  ["notes", "备注"],
];
export default function Equipment() {
  const [params, setParams] = useSearchParams(),
    tab = params.get("tab") === "gateways" ? "gateways" : "sensors";
  const gateways = useData("/gateways"),
    sensors = useData("/devices");
  const data = tab === "gateways" ? gateways : sensors;
  const [editor, setEditor] = useState(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState("");
  function changeTab(next) {
    setParams({ tab: next });
    setEditor(null);
    setError("");
    setNotice("");
  }
  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget)),
      editing = Boolean(editor.id);
    try {
      await api(
        (tab === "gateways" ? "/gateways" : "/devices") +
          (editing ? "/" + encodeURIComponent(editor.id) : ""),
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      setEditor(null);
      setNotice(
        editing
          ? "信息已更新"
          : "登记成功。尚无设备通信或测量记录时仍显示待接入。",
      );
      gateways.reload();
      sensors.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Title
        title="设备管理"
        description="先登记网关，再关联仪器；通信与测量时效分别配置。"
      >
        <button
          className="primary"
          disabled={tab === "sensors" && !gateways.data?.length}
          onClick={() => {
            setEditor({});
            setError("");
          }}
        >
          {tab === "gateways" ? "登记网关" : "登记仪器"}
        </button>
      </Title>
      <div className="tabs">
        <button
          className={tab === "gateways" ? "active" : ""}
          onClick={() => changeTab("gateways")}
        >
          网关管理
        </button>
        <button
          className={tab === "sensors" ? "active" : ""}
          onClick={() => changeTab("sensors")}
        >
          传感器管理
        </button>
      </div>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {editor && (
        <Panel
          title={
            (editor.id ? "修改" : "登记") +
            (tab === "gateways" ? "网关" : "仪器")
          }
          extra={<button onClick={() => setEditor(null)}>取消</button>}
        >
          <form
            className="form-grid"
            key={tab + (editor.id || "new")}
            onSubmit={submit}
          >
            {tab === "sensors" && (
              <>
                <label>
                  关联网关 *
                  <select
                    name="gateway_id"
                    required
                    defaultValue={
                      editor.gateway_id || params.get("gateway_id") || ""
                    }
                    disabled={Boolean(editor.id)}
                  >
                    <option value="">选择已登记网关</option>
                    {gateways.data?.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} · {g.id}
                      </option>
                    ))}
                  </select>
                  {editor.id && (
                    <input
                      type="hidden"
                      name="gateway_id"
                      value={editor.gateway_id}
                    />
                  )}
                </label>
                <label>
                  仪器类型 *
                  <select
                    name="type"
                    required
                    defaultValue={editor.type || ""}
                    disabled={Boolean(editor.id)}
                  >
                    <option value="">请选择</option>
                    {Object.entries(types).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  {editor.id && (
                    <input type="hidden" name="type" value={editor.type} />
                  )}
                </label>
              </>
            )}
            {(tab === "gateways" ? gatewayFields : sensorFields).map(
              ([name, label, required]) => (
                <label key={name}>
                  {label}
                  {required ? " *" : ""}
                  <input
                    name={name}
                    defaultValue={editor[name] ?? ""}
                    required={required}
                    readOnly={name === "id" && Boolean(editor.id)}
                    maxLength={name === "notes" ? 2000 : 200}
                    type={name.endsWith("_seconds") ? "number" : "text"}
                    min={name.endsWith("_seconds") ? 1 : undefined}
                    step={name.endsWith("_seconds") ? 1 : undefined}
                  />
                </label>
              ),
            )}
            <p className="form-note">
              {tab === "gateways"
                ? "通信超时只决定网关状态，修改将影响此网关的通信判断，不修改仪器的数据时效。"
                : "数据时效按该仪器自身最近有效记录判断。关联网关、编号和类型保存后不可直接变更，以保护历史归属。"}{" "}
              未核实的字段可留空。
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </button>
          </form>
        </Panel>
      )}
      <Panel
        title={tab === "gateways" ? "已登记网关" : "已登记仪器"}
        extra={<Refresh onClick={data.reload} />}
      >
        <State state={data}>
          {(rows) => {
            const shown =
              tab === "sensors" && params.get("gateway_id")
                ? rows.filter((r) => r.gateway_id === params.get("gateway_id"))
                : rows;
            return (
              <>
                {tab === "sensors" && params.get("gateway_id") && (
                  <p className="note">
                    当前网关：{params.get("gateway_id")}{" "}
                    <button onClick={() => setParams({ tab: "sensors" })}>
                      查看全部
                    </button>
                  </p>
                )}
                {shown.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {(tab === "gateways"
                            ? [
                                "网关",
                                "通信方式",
                                "通信状态",
                                "最近有效通信",
                                "关联仪器",
                                "操作",
                              ]
                            : [
                                "仪器",
                                "网关通信",
                                "自身数据状态",
                                "最近有效数据接收时间",
                                "时效配置",
                                "操作",
                              ]
                          ).map((x) => (
                            <th key={x}>{x}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={r.id}>
                            <td>
                              {r.name}
                              <small>
                                {r.id}
                                {r.type ? " · " + types[r.type] : ""}
                              </small>
                            </td>
                            {tab === "gateways" ? (
                              <>
                                <td>{r.transport || "待核实"}</td>
                                <td>
                                  <Status value={r.status} />
                                </td>
                                <td>{fmt(r.last_contact)}</td>
                                <td>
                                  <Link
                                    to={
                                      "/devices?tab=sensors&gateway_id=" +
                                      encodeURIComponent(r.id)
                                    }
                                  >
                                    {r.sensor_count} 台
                                  </Link>
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  <Link to="/devices?tab=gateways">
                                    {r.gateway_name}
                                  </Link>
                                  <br />
                                  <Status value={r.gateway_status} />
                                </td>
                                <td>
                                  <Status value={r.data_status} />
                                </td>
                                <td>{fmt(r.last_valid_received_at)}</td>
                                <td>
                                  {r.freshness_seconds
                                    ? r.freshness_seconds + " 秒"
                                    : "未配置"}
                                </td>
                              </>
                            )}
                            <td>
                              <div className="row-actions">
                                <button
                                  onClick={() => {
                                    setEditor(r);
                                    setError("");
                                  }}
                                >
                                  修改
                                </button>
                                <Link
                                  to={
                                    "/diagnostics?" +
                                    (tab === "gateways"
                                      ? "gateway_id="
                                      : "sensor_id=") +
                                    encodeURIComponent(r.id)
                                  }
                                >
                                  接收记录
                                </Link>
                                {tab === "sensors" && (
                                  <Link
                                    to={
                                      "/monitor?sensor_id=" +
                                      encodeURIComponent(r.id)
                                    }
                                  >
                                    监测
                                  </Link>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    hint={
                      tab === "gateways"
                        ? "请按照实际设备资料登记。不会自动创建网关。"
                        : "需要先登记网关，再填写实际仪器信息。"
                    }
                    to={tab === "sensors" ? "/devices?tab=gateways" : undefined}
                    action="登记网关"
                  >
                    {tab === "gateways" ? "暂无网关" : "暂无关联仪器"}
                  </Empty>
                )}
              </>
            );
          }}
        </State>
      </Panel>
    </>
  );
}
