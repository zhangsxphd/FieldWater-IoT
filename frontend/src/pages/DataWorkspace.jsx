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
  localInput,
  semanticsLabels,
  fmt,
} from "../shared.jsx";
import Trend from "../components/Trend.jsx";
export default function DataWorkspace({ mode }) {
  const [params, setParams] = useSearchParams();
  const devices = useData("/devices"),
    series = useData("/telemetry/series"),
    experiments = useData("/experiments"),
    plots = useData("/plots");
  const sensor = params.get("sensor_id") || "",
    code = params.get("measurement_code") || "",
    unit = params.get("unit") || "";
  const [error, setError] = useState("");
  const options = series.data?.filter((r) => r.sensor_id === sensor) || [],
    selected = devices.data?.find((r) => r.id === sensor);
  const titles = {
    monitor: "实时监测",
    history: "历史数据",
    analysis: "数据分析",
  };
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
    delete v.series;
    setParams(query({ ...v, measurement_code, unit }));
  }
  return (
    <>
      <div className="tabs context-tabs">
        {Object.entries(titles).map(([key, name]) => (
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
        title={titles[mode]}
        description="仪器、指标、单位和时间口径贯穿查询、分析与导出。"
      />
      <State state={devices}>
        {(rows) => (
          <State state={series}>
            {() =>
              rows.length ? (
                <>
                  <Panel title="查询范围">
                    <form
                      onSubmit={apply}
                      className="filters measurement-filters"
                      key={params.toString()}
                    >
                      <label>
                        仪器
                        <select
                          name="sensor_id"
                          required
                          value={sensor}
                          onChange={(e) => {
                            const next = new URLSearchParams(params);
                            next.set("sensor_id", e.target.value);
                            next.delete("measurement_code");
                            next.delete("unit");
                            setParams(next);
                          }}
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
                        时间口径
                        <select
                          name="time_basis"
                          defaultValue={
                            params.get("time_basis") || "received_at"
                          }
                        >
                          <option value="received_at">服务器接收时间</option>
                          <option value="measured_at">设备采集时间</option>
                        </select>
                      </label>
                      <label>
                        开始时间（本地）
                        <input
                          name="from"
                          type="datetime-local"
                          defaultValue={localInput(params.get("from"))}
                        />
                      </label>
                      <label>
                        结束时间（本地）
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
                      <ResearchFilters
                        params={params}
                        experiments={experiments}
                        plots={plots}
                      />
                      <button className="primary">查询</button>
                    </form>
                    {(experiments.error || plots.error) && (
                      <p role="alert" className="error">
                        试验筛选暂不可用。
                        <button
                          onClick={() => {
                            experiments.reload();
                            plots.reload();
                          }}
                        >
                          重试
                        </button>
                      </p>
                    )}
                    {error && (
                      <p role="alert" className="error">
                        {error}
                      </p>
                    )}
                    <p className="form-note">
                      设备时间缺失的记录不进入采集时间查询，也不会凭接收时间推定试验归属。表单按浏览器本地时区输入，导出保留
                      UTC 时间。
                    </p>
                    {selected && (
                      <div className="scope">
                        <span>
                          网关通信 <Status value={selected.gateway_status} />
                        </span>
                        <span>
                          仪器数据 <Status value={selected.data_status} />
                        </span>
                        <Link to={"/devices/" + encodeURIComponent(sensor)}>
                          仪器详情 →
                        </Link>
                        <Link
                          to={
                            "/diagnostics?sensor_id=" +
                            encodeURIComponent(sensor)
                          }
                        >
                          接收与解析记录 →
                        </Link>
                      </div>
                    )}
                    {selected?.type === "rainfall" && (
                      <p className="notice">
                        雨量的累计 /
                        时段含义、清零及溢出行为需依据实际说明书确认。当前不计算
                        24 小时降雨量或跨记录差分。
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
                            ? "尚无通过验证的测量，可先检查原始接收记录和失败原因。"
                            : "选择仪器、指标与单位后开始查询。"
                        }
                        to={
                          sensor
                            ? "/devices/" + encodeURIComponent(sensor)
                            : undefined
                        }
                        action="查看仪器详情"
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
    basis = filters.time_basis || "received_at";
  const data = useData(
    "/telemetry/history?" + query({ ...filters, limit, offset: page * limit }),
  );
  return (
    <>
      {mode === "analysis" && <Statistics filters={filters} />}
      <Panel
        title={mode === "history" ? "有效测量记录" : "趋势与测量追溯"}
        extra={
          <div className="row-actions">
            <ExportCsv href={"/api/telemetry/history.csv?" + query(filters)} />
            <ExportCsv
              href={"/api/telemetry/export.json?" + query(filters)}
              format="json"
              label="导出数据与查询说明"
            />
          </div>
        }
      >
        <State state={data}>
          {(d) => (
            <>
              <p className="scope-text">
                范围：{filters.from ? fmt(filters.from) : "不限起始时间"} 至{" "}
                {filters.to ? fmt(filters.to) : "不限结束时间"}；按
                {basis === "measured_at" ? "设备采集" : "服务器接收"}时间。匹配{" "}
                {d.total} 条，本次显示 {d.rows.length} 条
                {d.total > limit
                  ? "；当前图表和明细为截取结果，全范围统计独立计算"
                  : ""}
                。
              </p>
              {d.rows.length ? (
                <>
                  {mode !== "history" && (
                    <Trend rows={d.rows} timeBasis={basis} />
                  )}
                  <MeasurementTable rows={d.rows} />
                  {mode === "history" && (
                    <Pagination data={d} page={page} setPage={setPage} />
                  )}
                </>
              ) : (
                <Empty hint="调整查询范围，或进入仪器详情检查接收和质量。">
                  该范围暂无有效测量
                </Empty>
              )}
            </>
          )}
        </State>
      </Panel>
    </>
  );
}
function Statistics({ filters }) {
  const stats = useData("/telemetry/statistics?" + query(filters));
  const display = (v) =>
    v == null ? "—" : Number(v.toPrecision(7)) + " " + filters.unit;
  return (
    <Panel
      title="完整查询范围统计"
      extra={<span className="scope-text">不受图表点数限制</span>}
    >
      <State state={stats}>
        {(d) => (
          <>
            <div className="analysis-stats">
              <span>
                有效记录数<strong>{d.count ?? d.total}</strong>
              </span>
              <span>
                最小读数<strong>{display(d.min)}</strong>
              </span>
              <span>
                最大读数<strong>{display(d.max)}</strong>
              </span>
              <span>
                算术均值
                <strong>{d.mean_allowed ? display(d.mean) : "不适用"}</strong>
              </span>
            </div>
            <p className="notice">
              {d.mean_allowed
                ? "均值按完整范围内有效记录等权计算，非时间加权平均。"
                : "指标语义未确认、包含累计读数或时段增量时，不计算算术均值或派生累计量。"}{" "}
              指标语义：
              {(d.semantics || [])
                .map((v) => semanticsLabels[v] || v)
                .join("、") || "暂无数据"}
              。
            </p>
            <div className="scope">
              <span>设备时间缺失：{d.missing_device_time_count ?? 0} 条</span>
              <span>质量筛选排除：{d.excluded_count ?? 0} 条</span>
              <span>首条：{fmt(d.first_at)}</span>
              <span>末条：{fmt(d.last_at)}</span>
            </div>
            <p className="form-note">
              设备时间缺失计数口径：{d.missing_device_time_scope}
              。质量排除口径：{d.exclusion_scope}
              。缺失设备时间记录无法判定其采集时段，不等于该时段缺测次数。
            </p>
          </>
        )}
      </State>
    </Panel>
  );
}

function ResearchFilters({ params, experiments, plots }) {
  const [experiment, setExperiment] = useState(
    params.get("experiment_id") || "",
  );
  const [plot, setPlot] = useState(params.get("plot_id") || "");
  const choices = (plots.data || []).filter(
    (p) => !experiment || p.experiment_id === experiment,
  );
  return (
    <>
      <label>
        试验
        <select
          name="experiment_id"
          value={experiment}
          disabled={experiments.loading || !!experiments.error}
          onChange={(e) => {
            setExperiment(e.target.value);
            setPlot("");
          }}
        >
          <option value="">全部试验（含未归属）</option>
          {(experiments.data || []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        小区
        <select
          name="plot_id"
          value={plot}
          disabled={plots.loading || !!plots.error}
          onChange={(e) => {
            setPlot(e.target.value);
            const chosen = choices.find((p) => p.id === e.target.value);
            if (chosen) setExperiment(chosen.experiment_id);
          }}
        >
          <option value="">全部小区（含未归属）</option>
          {choices.map((r) => (
            <option key={r.id} value={r.id}>
              {r.experiment_name} · {r.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
