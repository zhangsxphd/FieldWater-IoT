import React from "react";
import { Link } from "react-router-dom";
import { useData, State, Title, Panel, Empty, fmt } from "../shared.jsx";
export function Alarms() {
  const data = useData("/alarms");
  return (
    <>
      <Title title="告警管理" description="规则告警与接收诊断分开查看。" />
      <p className="notice">
        自动告警规则尚未启用。没有告警记录不代表通信或测量正常。
        <Link to="/diagnostics">检查原始接收与数据质量 →</Link>
      </p>
      <Panel title="已有告警记录">
        <State state={data}>
          {(rows) =>
            rows.length ? (
              <div className="device-list">
                {rows.map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.message}
                      <small>
                        {fmt(r.raised_at)} ·{" "}
                        {r.sensor_id || r.gateway_id || "未关联"}
                      </small>
                    </span>
                    {r.status}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>暂无告警记录</Empty>
            )
          }
        </State>
      </Panel>
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
        description="只展示已具备的能力，未配置的接收服务不会显示为运行中。"
      />
      <Panel title="当前运行边界">
        <div className="settings-row">
          <strong>网络范围</strong>
          <span>本机开发服务 · 127.0.0.1</span>
        </div>
        <div className="settings-row">
          <strong>HTTP / MQTT / TCP 设备接收</strong>
          <span>尚未开放</span>
        </div>
        <div className="settings-row">
          <strong>设备身份验证与用户认证</strong>
          <span>设计待实机确认，尚未启用</span>
        </div>
        <div className="settings-row">
          <strong>自动告警规则</strong>
          <span>尚未启用</span>
        </div>
      </Panel>
      <Panel title="配置检查">
        <State state={gateways}>
          {(gs) => (
            <State state={sensors}>
              {(ss) => (
                <div className="readiness">
                  <div>
                    <strong>网关档案</strong>
                    <p>
                      {gs.length} 台已登记；
                      {gs.filter((g) => !g.timeout_seconds).length}{" "}
                      台尚未配置通信超时。
                    </p>
                    <Link to="/devices?tab=gateways">管理网关 →</Link>
                  </div>
                  <div>
                    <strong>仪器数据时效</strong>
                    <p>
                      {ss.length} 台已关联；
                      {ss.filter((s) => !s.freshness_seconds).length}{" "}
                      台尚未配置时效。
                    </p>
                    <Link to="/devices?tab=sensors">管理仪器 →</Link>
                  </div>
                  <div>
                    <strong>硬件与协议证据</strong>
                    <p>
                      实际铭牌、完整说明书、固件与串口参数仍待取得。雨量累计 /
                      时段语义待核实。
                    </p>
                    <Link to="/diagnostics">查看当前接收记录 →</Link>
                  </div>
                </div>
              )}
            </State>
          )}
        </State>
      </Panel>
      <Panel title="接入前需要准备">
        <ol className="checklist">
          <li>核对实际网关与仪器型号、固件、串口配置，保留说明书版本。</li>
          <li>分别确认各指标的寄存器、倍率、单位、时间和质量规则。</li>
          <li>
            依据 DTU 实际能力选择身份验证与传输方式，不能把设备编号当作密码。
          </li>
          <li>在隔离联调库验证原文、解析、异常和重复，再另行确认正式采集。</li>
        </ol>
      </Panel>
    </>
  );
}
