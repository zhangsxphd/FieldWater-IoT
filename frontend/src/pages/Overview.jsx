import React, { useContext } from "react";
import { DemoOverview } from "../components/DemoWorkspace.jsx";
import { Link } from "react-router-dom";
import { Waves, Droplets, CloudRain } from "lucide-react";
import {
  useData,
  State,
  Title,
  Panel,
  Empty,
  Status,
  fmt,
  Refresh,
  RuntimeMode,
  query,
} from "../shared.jsx";
export default function Overview() {
  const demo = useContext(RuntimeMode) === "demo";
  const summary = useData("/dashboard/summary"),
    sensors = useData("/devices"),
    gateways = useData("/gateways");
  return (
    <>
      <Title
        title="数据总览"
        description={demo ? "本地演示场景 · 网关通信、仪器读数与试验记录" : "查看网关通信、仪器最近有效读数和待处理异常。"}
      >
        <Refresh
          onClick={() => {
            summary.reload();
            sensors.reload();
            gateways.reload();
          }}
        />
      </Title>
      {demo && <DemoOverview />}
      <State state={summary}>
        {(d) => (
          <>
            <Panel>
              <div className="stats-grid">
                {[
                  ["在线网关", d.gateways.online],
                  ["网关总数", d.gateways.total],
                  [
                    "网关在线率",
                    d.gateways.online_rate == null
                      ? "—"
                      : (100 * d.gateways.online_rate).toFixed(1) + "%",
                  ],
                  ["已登记仪器", d.sensors.total],
                ].map(([label, value]) => (
                  <div className="stat" key={label}>
                    <span>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
              <div className="summary-foot">
                仪器：{d.sensors.fresh} 台数据新鲜 · {d.sensors.no_data}{" "}
                台无有效数据 · {d.sensors.stale} 台过期 ·{" "}
                {d.sensors.invalid_data} 台数据异常 ·{" "}
                {d.sensors.freshness_unconfigured} 台时效未配置
              </div>
            </Panel>
            {(!d.gateways.total || !d.sensors.total) && (
              <Panel title="开始建立你的监测系统">
                <div className="onboarding">
                  <Link to="/devices?tab=gateways">
                    <b>01</b>
                    <strong>登记实际网关</strong>
                    <span>填写型号与通信配置</span>
                  </Link>
                  <Link to="/devices?tab=sensors">
                    <b>02</b>
                    <strong>关联传感器</strong>
                    <span>独立配置数据时效</span>
                  </Link>
                  <Link to="/settings">
                    <b>03</b>
                    <strong>核实接入资料</strong>
                    <span>协议与身份认证待确认</span>
                  </Link>
                  <Link to="/diagnostics">
                    <b>04</b>
                    <strong>检查接收链路</strong>
                    <span>原文、质量、有效测量</span>
                  </Link>
                </div>
                {!demo && <details className="demo-entry">
                  <summary>尚无仪器？体验本地演示</summary>
                  <p>在项目根目录运行 <code>npm run demo --prefix frontend</code>，然后<a href="http://127.0.0.1:5182/">打开演示平台 ↗</a>。</p>
                </details>}
              </Panel>
            )}
            <p className="scope-text">
              最后有效数据接收：
              {d.last_received_at ? fmt(d.last_received_at) : "暂无实测数据"}
              。网关在线率按已登记网关计算，不代表仪器数据完整率。
            </p>
          </>
        )}
      </State>
      <State state={sensors}>
        {(rows) => (
          <div className="measure-grid">
            {[
              ["water_level", "水位监测", Waves],
              ["electromagnetic_flow", "流量监测", Droplets],
              ["rainfall", "雨量监测", CloudRain],
            ].map(([type, title, Icon]) => {
              const found = rows.filter((r) => r.type === type);
              const device = found.filter(s => s.last_valid_at).sort((a, b) => b.last_valid_at.localeCompare(a.last_valid_at))[0] || found[0];
              const metrics = device?.metrics.filter(m => m.latest_value != null) || [];
              const metric = metrics.find(m => m.semantics === "instantaneous") || metrics[0];
              const total = metrics.find(m => m !== metric && m.semantics === "cumulative");
              const scope = metric && query({ sensor_id: device.id, measurement_code: metric.measurement_code,
                unit: metric.unit, time_basis: metric.time_basis === "device_timestamp" ? "measured_at" : "received_at" });
              return (
                <section className="metric" key={type}>
                  <span className={"metric-icon " + type}><Icon /></span>
                  <div>
                    <h2>{title}</h2>
                    {metric ? <>
                      <div className="metric-value">{metric.latest_value} <small>{metric.unit}</small></div>
                      <p>{device.name} · 最近有效{metric.measurement_code}</p>
                      {total && <p>最近有效{total.measurement_code} {total.latest_value} {total.unit}
                        {total.data_status !== "fresh" && <Status value={total.data_status} />}</p>}
                      {metric.data_status !== "fresh" && <Status value={metric.data_status} />}
                    </> : <div className="no-value">{device ? "暂无有效读数" : "尚未登记仪器"}</div>}
                    <Link to={scope ? "/monitor?" + scope : device ? "/devices/" + encodeURIComponent(device.id) : "/devices?tab=sensors"}>
                      {scope ? "查看指标趋势 →" : device ? "查看仪器 →" : "前往登记 →"}
                    </Link>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </State>
      <Panel
        title="需要关注"
        extra={<Link to="/alarms?status=open">待处理告警 →</Link>}
      >
        <State state={sensors}>
          {(rows) => {
            const needs = rows.filter((r) => r.data_status !== "fresh");
            return needs.length ? (
              <div className="attention-list">
                {needs.map((s) => (
                  <Link key={s.id} to={"/devices/" + encodeURIComponent(s.id)}>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {s.data_status === "no_data"
                          ? "查看指标定义与接收证据"
                          : s.data_status === "freshness_unconfigured"
                            ? "核实并配置数据有效期"
                            : "查看异常指标及原始记录"}
                      </small>
                    </span>
                    <Status value={s.data_status} />
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="scope-text">
                {rows.length
                  ? "当前未发现需要处理的仪器数据状态；仍可查看接收诊断及协议档案。"
                  : "先登记网关与仪器，再核实协议并建立试验安装记录。"}
              </p>
            );
          }}
        </State>
      </Panel>
      <div className="dashboard-grid">
        <Panel title="网关通信">
          <State state={gateways}>
            {(rows) =>
              rows.length ? (
                <div className="device-list">
                  {rows.map((g) => (
                    <div key={g.id}>
                      <span>
                        <Link
                          to={
                            "/devices?tab=sensors&gateway_id=" +
                            encodeURIComponent(g.id)
                          }
                        >
                          {g.name}
                        </Link>
                        <small>
                          {g.id} · {g.sensor_count} 台仪器
                        </small>
                      </span>
                      <Status value={g.status} />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty to="/devices?tab=gateways" action="登记网关">
                  暂无网关通信记录
                </Empty>
              )
            }
          </State>
        </Panel>
        <Panel
          title="仪器数据检查"
          extra={<Link to="/diagnostics">接收诊断 →</Link>}
        >
          <State state={sensors}>
            {(rows) =>
              rows.length ? (
                <div className="device-list">
                  {rows.map((s) => (
                    <div key={s.id}>
                      <span>
                        <Link to={"/devices/" + encodeURIComponent(s.id)}>
                          {s.name}
                        </Link>
                        <small>
                          最近有效接收 {fmt(s.last_valid_received_at)}
                        </small>
                      </span>
                      <Status value={s.data_status} />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty hint="同网关内每台仪器分别判断，不会共享数据状态。">
                  暂无已登记仪器
                </Empty>
              )
            }
          </State>
        </Panel>
      </div>
    </>
  );
}
