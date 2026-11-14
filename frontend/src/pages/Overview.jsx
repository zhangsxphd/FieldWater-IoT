import React from "react";
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
} from "../shared.jsx";
export default function Overview() {
  const summary = useData("/dashboard/summary"),
    sensors = useData("/devices"),
    gateways = useData("/gateways");
  return (
    <>
      <Title
        title="数据总览"
        description="通信是否正常、仪器是否有新数据，是两个不同的问题。"
      >
        <Refresh
          onClick={() => {
            summary.reload();
            sensors.reload();
            gateways.reload();
          }}
        />
      </Title>
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
              return (
                <section className="metric" key={type}>
                  <span className={"metric-icon " + type}>
                    <Icon />
                  </span>
                  <div>
                    <h2>{title}</h2>
                    <div className="no-value">
                      {found.length
                        ? `${found.length} 台已登记仪器`
                        : "尚未登记仪器"}
                    </div>
                    <p>
                      {found.length
                        ? "每个指标独立查看，保留单位与来源"
                        : "登记实际仪器后开始管理"}
                    </p>
                    <Link
                      to={
                        found.length
                          ? "/monitor?sensor_id=" +
                            encodeURIComponent(found[0].id)
                          : "/devices?tab=sensors"
                      }
                    >
                      {found.length ? "选择仪器与指标 →" : "前往登记 →"}
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
