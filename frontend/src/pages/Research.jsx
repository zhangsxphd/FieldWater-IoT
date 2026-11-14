import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useData,
  State,
  Panel,
  Title,
  Empty,
  Refresh,
  fmt,
  query,
  post,
} from "../shared.jsx";
export default function Research() {
  const [params] = useSearchParams(),
    experiments = useData("/experiments"),
    plots = useData("/plots"),
    devices = useData("/devices"),
    installations = useData("/installations");
  const [editor, setEditor] = useState(null),
    [closing, setClosing] = useState(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  function reload() {
    experiments.reload();
    plots.reload();
    devices.reload();
    installations.reload();
  }
  function edit(kind) {
    setEditor(kind);
    setClosing(null);
    setError("");
    setSuccess("");
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    for (const k of ["start_at", "end_at"])
      if (body[k]) body[k] = new Date(body[k]).toISOString();
      else if (k in body) body[k] = null;
    try {
      await post(
        closing ? "/installations/" + closing.id + "/close" : "/" + editor,
        body,
      );
      setSuccess(closing ? "旧安装记录已结束，历史归属保留。" : "记录已保存。");
      setEditor(null);
      setClosing(null);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title
        title="试验与安装履历"
        description="按试验、小区和仪器安装时段组织数据；迁移仪器不会重写历史归属。"
      >
        <Refresh onClick={reload} />
      </Title>
      <div className="workflow-strip">
        <span>
          <b>01</b> 建立试验
        </span>
        <span>
          <b>02</b> 划分小区与处理
        </span>
        <span>
          <b>03</b> 记录安装时段
        </span>
        <span>
          <b>04</b> 按归属查询与导出
        </span>
      </div>
      <p className="notice">
        安装区间包含开始时刻、不包含结束时刻。同一仪器不能存在重叠安装；缺失设备采集时间的测量保持归属未知。
      </p>
      {success && (
        <p role="status" className="success">
          {success}
        </p>
      )}
      {(editor || closing) && (
        <Panel
          title={
            closing
              ? "结束安装记录"
              : {
                  experiments: "新建试验",
                  plots: "新建小区",
                  installations: "记录仪器安装",
                }[editor]
          }
          extra={
            <button
              onClick={() => {
                setEditor(null);
                setClosing(null);
                setError("");
              }}
            >
              取消
            </button>
          }
        >
          <form
            onSubmit={submit}
            className="form-grid"
            key={editor || closing.id}
          >
            {editor === "experiments" && (
              <>
                <label>
                  试验编号 *<input name="id" required maxLength={100} />
                </label>
                <label>
                  试验名称 *<input name="name" required maxLength={200} />
                </label>
                <label className="wide">
                  试验说明
                  <input name="description" maxLength={2000} />
                </label>
              </>
            )}
            {editor === "plots" && (
              <>
                <label>
                  所属试验 *
                  <select name="experiment_id" required defaultValue="">
                    <option value="">选择试验</option>
                    {(experiments.data || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  小区编号 *<input name="id" required maxLength={100} />
                </label>
                <label>
                  小区名称 *<input name="name" required maxLength={200} />
                </label>
                <label>
                  处理说明
                  <input name="treatment" maxLength={2000} />
                </label>
              </>
            )}
            {editor === "installations" && (
              <>
                <label>
                  仪器 *
                  <select
                    name="sensor_id"
                    required
                    defaultValue={params.get("sensor_id") || ""}
                  >
                    <option value="">选择仪器</option>
                    {(devices.data || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · {r.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  试验 / 小区 *
                  <select name="plot_id" required defaultValue="">
                    <option value="">选择小区</option>
                    {(plots.data || []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.experiment_name} / {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  开始时间（本地）*
                  <input name="start_at" type="datetime-local" required />
                </label>
                <label>
                  结束时间（本地，可留空）
                  <input name="end_at" type="datetime-local" />
                </label>
              </>
            )}
            {closing && (
              <>
                <p className="wide">
                  {closing.sensor_name} · {closing.plot_name}，开始于{" "}
                  {fmt(closing.start_at)}
                  。结束后此记录不可覆盖，后续安装请新建。
                </p>
                <label>
                  结束时间（本地）*
                  <input name="end_at" type="datetime-local" required />
                </label>
                <label>
                  备注
                  <input name="note" maxLength={2000} />
                </label>
              </>
            )}
            {error && (
              <p className="error wide" role="alert">
                {error}
              </p>
            )}
            <div className="wide">
              <button className="primary" disabled={busy}>
                {busy ? "保存中…" : closing ? "确认结束安装" : "保存记录"}
              </button>
            </div>
          </form>
        </Panel>
      )}
      <div className="dashboard-grid">
        <Panel
          title="试验档案"
          extra={<button onClick={() => edit("experiments")}>新建试验</button>}
        >
          <State state={experiments}>
            {(rows) =>
              rows.length ? (
                <div className="device-list">
                  {rows.map((r) => (
                    <div key={r.id}>
                      <span>
                        <strong>{r.name}</strong>
                        <small>{r.id}</small>
                        <small>{r.description || "未填写说明"}</small>
                      </span>
                      <Link
                        to={
                          "/history?" +
                          query({
                            experiment_id: r.id,
                            time_basis: "measured_at",
                          })
                        }
                      >
                        查询数据 →
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty hint="登记真实试验信息，不会生成仪器或测量数据。">
                  暂无试验档案
                </Empty>
              )
            }
          </State>
        </Panel>
        <Panel
          title="小区与处理"
          extra={
            <button
              disabled={!experiments.data?.length}
              onClick={() => edit("plots")}
            >
              新建小区
            </button>
          }
        >
          <State state={plots}>
            {(rows) =>
              rows.length ? (
                <div className="device-list">
                  {rows.map((r) => (
                    <div key={r.id}>
                      <span>
                        <strong>{r.name}</strong>
                        <small>
                          {r.experiment_name} · {r.id}
                        </small>
                        <small>处理：{r.treatment || "未记录"}</small>
                      </span>
                      <Link
                        to={
                          "/history?" +
                          query({
                            experiment_id: r.experiment_id,
                            plot_id: r.id,
                            time_basis: "measured_at",
                          })
                        }
                      >
                        查询数据 →
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty hint="先建立试验，再添加小区及处理说明。">
                  暂无小区
                </Empty>
              )
            }
          </State>
        </Panel>
      </div>
      <Panel
        title="仪器安装记录"
        extra={
          <button
            disabled={!plots.data?.length || !devices.data?.length}
            onClick={() => edit("installations")}
          >
            记录安装
          </button>
        }
      >
        {devices.error && (
          <p className="error" role="alert">
            无法读取仪器列表。<button onClick={devices.reload}>重试</button>
          </p>
        )}
        {!devices.loading && !devices.error && !devices.data?.length && (
          <p className="notice">
            先在<Link to="/devices?tab=sensors">设备管理</Link>
            登记实际仪器，再建立安装关系。
          </p>
        )}
        {params.get("sensor_id") && (
          <p className="scope-text">
            当前仪器：{params.get("sensor_id")} ·{" "}
            <Link to="/research">查看全部安装</Link>
          </p>
        )}
        <State state={installations}>
          {(all) => {
            const rows = params.get("sensor_id")
              ? all.filter((r) => r.sensor_id === params.get("sensor_id"))
              : all;
            return rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>仪器</th>
                      <th>试验 / 小区</th>
                      <th>处理</th>
                      <th>开始时间</th>
                      <th>结束时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link
                            to={"/devices/" + encodeURIComponent(r.sensor_id)}
                          >
                            {r.sensor_name}
                          </Link>
                          <small>{r.sensor_id}</small>
                        </td>
                        <td>
                          {r.experiment_name}
                          <small>{r.plot_name}</small>
                        </td>
                        <td>{r.treatment || "未记录"}</td>
                        <td>{fmt(r.start_at)}</td>
                        <td>{r.end_at ? fmt(r.end_at) : "尚未结束"}</td>
                        <td>
                          <div className="row-actions">
                            {!r.end_at && (
                              <button
                                onClick={() => {
                                  setClosing(r);
                                  setEditor(null);
                                  setError("");
                                  setSuccess("");
                                }}
                              >
                                结束安装
                              </button>
                            )}
                            <Link
                              to={
                                "/history?" +
                                query({
                                  sensor_id: r.sensor_id,
                                  experiment_id: r.experiment_id,
                                  plot_id: r.plot_id,
                                  time_basis: "measured_at",
                                  from: r.start_at,
                                  to: r.end_at,
                                })
                              }
                            >
                              查看数据
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty hint="记录真实安装时间；系统不会把登记时间自动作为安装时间。">
                暂无安装记录
              </Empty>
            );
          }}
        </State>
      </Panel>
    </>
  );
}
