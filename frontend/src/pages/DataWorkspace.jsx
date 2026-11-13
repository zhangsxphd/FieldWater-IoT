import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useData,
  State,
  Panel,
  Title,
  Empty,
  Status,
  Pagination,
  MeasurementTable,
  ExportCsv,
  types,
  query,
} from "../shared.jsx";
import Trend from "../components/Trend.jsx";
function localInput(value) {
  const d = new Date(value || "");
  return Number.isFinite(d.getTime())
    ? new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
    : "";
}
export default function DataWorkspace({ mode }) {
  const [params, setParams] = useSearchParams(),
    devices = useData("/devices"),
    series = useData("/telemetry/series");
  const sensor = params.get("sensor_id") || "",
    code = params.get("measurement_code") || "",
    unit = params.get("unit") || "";
  const [error, setError] = useState("");
  const title = {
    monitor: "实时监测",
    history: "历史数据",
    analysis: "数据分析",
  }[mode];
  const options = series.data?.filter((r) => r.sensor_id === sensor) || [],
    selected = devices.data?.find((r) => r.id === sensor);
  function apply(e) {
    e.preventDefault();
    setError("");
    const v = Object.fromEntries(new FormData(e.currentTarget));
    if (!v.sensor_id || !v.series) {
      setError("请选择仪器及其已有的有效指标。");
      return;
    }
    const [measurement_code, unit] = JSON.parse(v.series);
    for (const k of ["from", "to"])
      if (v[k]) v[k] = new Date(v[k]).toISOString();
    if (v.from && v.to && v.from > v.to) {
      setError("开始时间不能晚于结束时间。");
      return;
    }
    setParams(
      query({
        sensor_id: v.sensor_id,
        measurement_code,
        unit,
        from: v.from,
        to: v.to,
        order: v.order,
      }),
    );
  }
  return (
    <>
      <div className="tabs context-tabs">
        {[
          ["monitor", "实时监测"],
          ["history", "历史数据"],
          ["analysis", "数据分析"],
        ].map(([key, name]) => (
          <Link
            className={mode === key ? "active" : ""}
            key={key}
            to={"/" + key + "?" + params.toString()}
          >
            {name}
          </Link>
        ))}
      </div>
      <Title
        title={title}
        description="先选择仪器及指标，再查询；不同单位不混合。有效测量来自已验证记录。"
      />
      <State state={devices}>
        {(rows) => (
          <State state={series}>
            {() =>
              rows.length ? (
                <>
                  <Panel title="查询范围">
                    <form onSubmit={apply} className="filters" key={sensor}>
                      <label>
                        仪器
                        <select
                          name="sensor_id"
                          required
                          value={sensor}
                          onChange={(e) =>
                            setParams({ sensor_id: e.target.value })
                          }
                        >
                          <option value="">选择仪器</option>
                          {rows.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} · {types[d.type]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        指标及单位
                        <select
                          name="series"
                          required
                          defaultValue={
                            code ? JSON.stringify([code, unit]) : ""
                          }
                        >
                          <option value="">
                            {options.length ? "选择指标" : "尚无有效指标"}
                          </option>
                          {options.map((r) => (
                            <option
                              key={JSON.stringify([r.measurement_code, r.unit])}
                              value={JSON.stringify([
                                r.measurement_code,
                                r.unit,
                              ])}
                            >
                              {r.measurement_code} ({r.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        接收时间起
                        <input
                          name="from"
                          type="datetime-local"
                          defaultValue={localInput(params.get("from"))}
                        />
                      </label>
                      <label>
                        接收时间止
                        <input
                          name="to"
                          type="datetime-local"
                          defaultValue={localInput(params.get("to"))}
                        />
                      </label>
                      <label>
                        排序
                        <select
                          name="order"
                          defaultValue={params.get("order") || "desc"}
                        >
                          <option value="desc">最新优先</option>
                          <option value="asc">最早优先</option>
                        </select>
                      </label>
                      <button className="primary">查询</button>
                    </form>
                    {error && (
                      <p role="alert" className="error">
                        {error}
                      </p>
                    )}
                    {selected && (
                      <div className="scope">
                        <span>
                          网关通信 <Status value={selected.gateway_status} />
                        </span>
                        <span>
                          仪器数据 <Status value={selected.data_status} />
                        </span>
                        <span>
                          时效依据：
                          {selected.time_basis === "device_timestamp"
                            ? "设备时间"
                            : selected.time_basis === "received_at"
                              ? "接收时间（设备时间缺失）"
                              : "暂无有效记录"}
                        </span>
                        <Link
                          to={
                            "/diagnostics?sensor_id=" +
                            encodeURIComponent(sensor)
                          }
                        >
                          查看接收及解析记录
                        </Link>
                      </div>
                    )}
                    {selected?.type === "rainfall" && (
                      <p className="notice">
                        雨量寄存器的累计 /
                        时段含义、清零和溢出行为尚未核实。不计算 24
                        小时降雨量或跨记录差分。
                      </p>
                    )}
                  </Panel>
                  {sensor && code ? (
                    <Results
                      key={params.toString() + mode}
                      params={params}
                      mode={mode}
                    />
                  ) : (
                    <Panel>
                      <Empty
                        hint={
                          sensor && !options.length
                            ? "仪器尚无通过验证的测量。可以查看原始接收记录和失败原因。"
                            : "选择仪器、指标与单位后开始查询。"
                        }
                        to={
                          sensor
                            ? "/diagnostics?sensor_id=" +
                              encodeURIComponent(sensor)
                            : undefined
                        }
                        action="检查接收记录"
                      >
                        {sensor && !options.length
                          ? "暂无有效测量记录"
                          : "选择查询范围"}
                      </Empty>
                    </Panel>
                  )}
                </>
              ) : (
                <Panel>
                  <Empty
                    to="/devices?tab=gateways"
                    action="开始登记"
                    hint="先登记实际网关并关联仪器，不会填充演示数据。"
                  >
                    暂无已登记仪器
                  </Empty>
                </Panel>
              )
            }
          </State>
        )}
      </State>
    </>
  );
}
function Results({ params, mode }) {
  const [page, setPage] = useState(0),
    limit = mode === "history" ? 25 : 500;
  const filters = Object.fromEntries(params),
    data = useData(
      "/telemetry/history?" +
        query({ ...filters, limit, offset: page * limit }),
    );
  return (
    <Panel
      title={mode === "analysis" ? "选定记录的描述统计" : "有效测量记录"}
      extra={
        <ExportCsv href={"/api/telemetry/history.csv?" + query(filters)} />
      }
    >
      <State state={data}>
        {(d) => {
          const values = d.rows.map((r) => r.value);
          return (
            <>
              <p className="scope-text">
                范围：{filters.from || "不限起始时间"} 至{" "}
                {filters.to || "不限结束时间"}；以服务器接收时间筛选。匹配{" "}
                {d.total} 条，本次返回 {d.rows.length} 条
                {d.total > limit ? "，当前视图为分页 / 截取结果" : ""}。
              </p>
              {d.rows.length ? (
                <>
                  {mode !== "history" && <Trend rows={d.rows} />}{" "}
                  {mode === "analysis" &&
                    (values.length >= 2 ? (
                      <>
                        <div className="analysis-stats">
                          <span>
                            样本数 <strong>{values.length}</strong>
                          </span>
                          <span>
                            最小读数{" "}
                            <strong>
                              {Math.min(...values)} {filters.unit}
                            </strong>
                          </span>
                          <span>
                            最大读数{" "}
                            <strong>
                              {Math.max(...values)} {filters.unit}
                            </strong>
                          </span>
                          <span>
                            算术均值{" "}
                            <strong>
                              {Number(
                                (
                                  values.reduce((a, b) => a + b, 0) /
                                  values.length
                                ).toPrecision(6),
                              )}{" "}
                              {filters.unit}
                            </strong>
                          </span>
                        </div>
                        <p className="notice">
                          方法：对下表同一仪器、指标和单位的有效记录逐条计算；均值
                          = 数值之和 /
                          记录数，非时间加权，不代表时段累计量。分析仅涵盖当前返回记录。逐条来源可由原始记录链接复核。
                        </p>
                      </>
                    ) : (
                      <Empty>仅一条有效记录，暂不计算统计量</Empty>
                    ))}
                  <MeasurementTable rows={d.rows} />
                  {mode === "history" && (
                    <Pagination data={d} page={page} setPage={setPage} />
                  )}
                </>
              ) : (
                <Empty hint="可调整查询时间，或检查接收诊断。">
                  该范围暂无有效测量
                </Empty>
              )}
            </>
          );
        }}
      </State>
    </Panel>
  );
}
