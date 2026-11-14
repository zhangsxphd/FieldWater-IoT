import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useData,
  State,
  Title,
  Panel,
  Empty,
  Status,
  Pagination,
  labels,
  semanticsLabels,
  fmt,
  query,
} from "../shared.jsx";
export default function Diagnostics() {
  const [params, setParams] = useSearchParams(),
    [page, setPage] = useState(0),
    devices = useData("/devices"),
    gateways = useData("/gateways");
  const filters = {
    gateway_id: params.get("gateway_id"),
    sensor_id: params.get("sensor_id"),
    parse_status: params.get("parse_status"),
  };
  const raw = useData(
    "/telemetry/raw?" + query({ ...filters, limit: 25, offset: page * 25 }),
  );
  function filter(e) {
    e.preventDefault();
    setPage(0);
    setParams(query(Object.fromEntries(new FormData(e.currentTarget))));
  }
  return (
    <>
      <Title
        title="接收诊断"
        description="原始接收 → 身份与通信 → 协议解析 → 测量与时间质量。失败和重复记录同样保留。"
      />
      <Panel title="筛选接收记录">
        <State state={gateways}>
          {(gs) => (
            <State state={devices}>
              {(ss) => (
                <form
                  className="filters"
                  onSubmit={filter}
                  key={params.toString()}
                >
                  <label>
                    网关
                    <select
                      name="gateway_id"
                      defaultValue={filters.gateway_id || ""}
                    >
                      <option value="">全部网关</option>
                      {gs.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    仪器
                    <select
                      name="sensor_id"
                      defaultValue={filters.sensor_id || ""}
                    >
                      <option value="">全部仪器</option>
                      {ss.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    处理状态
                    <select
                      name="parse_status"
                      defaultValue={filters.parse_status || ""}
                    >
                      <option value="">全部状态</option>
                      {[
                        "parsed",
                        "failed",
                        "duplicate",
                        "conflict",
                        "rejected",
                        "pending",
                      ].map((s) => (
                        <option key={s} value={s}>
                          {labels[s] || s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary">筛选</button>
                </form>
              )}
            </State>
          )}
        </State>
      </Panel>
      {params.get("raw_id") && (
        <RawDetail
          id={params.get("raw_id")}
          close={() => {
            const next = new URLSearchParams(params);
            next.delete("raw_id");
            setParams(next);
          }}
        />
      )}
      <Panel title="接收记录">
        <State state={raw}>
          {(d) =>
            d.rows.length ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "接收时间",
                          "网关 / 仪器",
                          "解析",
                          "通信",
                          "测量",
                          "设备时间",
                          "来源",
                          "详情",
                        ].map((x) => (
                          <th key={x}>{x}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{fmt(r.received_at)}</td>
                          <td>
                            {r.gateway_id}
                            <small>{r.sensor_id || "未绑定仪器"}</small>
                          </td>
                          <td>
                            <Status value={r.parse_status} />
                          </td>
                          <td>
                            <Status value={r.communication_quality} />
                          </td>
                          <td>
                            <Status value={r.value_quality} />
                          </td>
                          <td>
                            <Status value={r.time_quality} />
                          </td>
                          <td>{r.source}</td>
                          <td>
                            <button
                              onClick={() => {
                                const next = new URLSearchParams(params);
                                next.set("raw_id", r.id);
                                setParams(next);
                              }}
                            >
                              查看 #{r.id}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination data={d} page={page} setPage={setPage} />
              </>
            ) : (
              <Empty
                hint="当前没有符合条件的接收记录。通信适配器尚未开放，登记设备本身不会产生数据。"
                to="/settings"
                action="查看接入待办"
              >
                暂无接收记录
              </Empty>
            )
          }
        </State>
      </Panel>
      <CommunicationEvents
        key={(filters.gateway_id || "") + "|" + (filters.sensor_id || "")}
        gateway={filters.gateway_id}
        sensor={filters.sensor_id}
      />
    </>
  );
}
function CommunicationEvents({ gateway, sensor }) {
  const [page, setPage] = useState(0);
  const data = useData(
    "/events?" +
      query({
        gateway_id: gateway,
        sensor_id: sensor,
        limit: 25,
        offset: page * 25,
      }),
  );
  return (
    <Panel title="通信事件">
      <p className="scope-text">
        按网关 / 仪器筛选，不受上方解析状态筛选影响；通信事件不能证明测量有效。
      </p>
      <State state={data}>
        {(d) =>
          d.rows.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>网关</th>
                      <th>仪器</th>
                      <th>事件</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((e) => (
                      <tr key={e.id}>
                        <td>{fmt(e.occurred_at)}</td>
                        <td>{e.gateway_id}</td>
                        <td>{e.sensor_id || "网关级事件"}</td>
                        <td>
                          {{
                            heartbeat: "有效心跳",
                            telemetry_received: "已验证通信收到报文",
                            communication_error: "通信错误",
                          }[e.event_type] || e.event_type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination data={d} page={page} setPage={setPage} />
            </>
          ) : (
            <Empty>暂无通信事件</Empty>
          )
        }
      </State>
    </Panel>
  );
}
function RawDetail({ id, close }) {
  const data = useData("/telemetry/raw/" + encodeURIComponent(id));
  return (
    <Panel
      title={"原始记录 #" + id}
      extra={<button onClick={close}>关闭详情</button>}
    >
      <State state={data}>
        {(r) => (
          <>
            <dl className="detail-grid">
              {[
                ["网关", r.gateway_id],
                ["仪器", r.sensor_id],
                ["服务器接收时间", fmt(r.received_at)],
                ["设备原始时间", r.device_timestamp],
                ["来源", r.source],
                ["传输方式", r.transport],
                ["消息编号", r.message_id],
                ["重复引用", r.duplicate_of ? "#" + r.duplicate_of : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="quality-grid">
              {[
                ["通信", r.communication_quality],
                ["协议", r.protocol_quality],
                ["测量值", r.value_quality],
                ["时间", r.time_quality],
              ].map(([k, v]) => (
                <span key={k}>
                  {k} <Status value={v} />
                </span>
              ))}
            </div>
            {r.parse_error && (
              <p className="error" role="status">
                处理原因：{r.parse_error}
              </p>
            )}
            <p className="scope-text">
              原始字节（十六进制），不会覆盖或自动重解析
            </p>
            <pre className="raw-bytes">{r.raw_payload}</pre>
            {r.profile_snapshot ? (
              <details className="raw-profile">
                <summary>查看本次解析使用的档案快照（#{r.profile_id}）</summary>
                <pre className="audit-json">
                  {JSON.stringify(JSON.parse(r.profile_snapshot), null, 2)}
                </pre>
              </details>
            ) : (
              <p className="form-note">
                本报文未记录协议档案版本，不能推定解析或校准依据。
              </p>
            )}
            {r.measurements?.length > 0 && (
              <>
                <h3>此报文的解码结果</h3>
                <p className="notice">
                  解码结果不自动等于有效实测数据。通信、协议、测量与时间质量都需单独核对；未核实的结果不进入正常监测或统计。
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>指标</th>
                        <th>解码数值</th>
                        <th>指标语义</th>
                        <th>测量质量</th>
                        <th>时间质量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.measurements.map((m) => (
                        <tr key={m.id}>
                          <td>{m.measurement_code}</td>
                          <td>
                            {m.value} {m.unit}
                          </td>
                          <td>{semanticsLabels[m.semantics] || "待核实"}</td>
                          <td>
                            <Status value={m.value_quality} />
                          </td>
                          <td>
                            <Status value={m.time_quality} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {r.sensor_id && (
              <Link
                to={"/monitor?sensor_id=" + encodeURIComponent(r.sensor_id)}
              >
                查看该仪器有效测量 →
              </Link>
            )}
          </>
        )}
      </State>
    </Panel>
  );
}
