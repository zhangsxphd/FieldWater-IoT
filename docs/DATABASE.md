# 数据模型、状态与查询边界

本文描述当前代码实现。数据库是独立 SQLite；默认文件由 `backend/src/server.js` 选择为 `backend/data/fieldwater.sqlite`（从项目 README 所述启动命令运行时）。不引用 LanSense 数据库，不初始化网关、仪器或测量记录。设备通信适配器和设备身份认证尚未开放，`ingest` 仅为内部接口。

## 迁移与历史兼容

`backend/src/db.js` 使用 `schema_migrations` 按版本记录，每个迁移在事务中执行，启用外键。

1. 迁移 1 兼容项目最初版本已有的 gateways / sensors 表，不删除原记录。
2. 迁移 2 增加档案字段、原始接收、测量、设备事件和告警表。
3. 迁移 3 增加独立网关元数据、传感器时效、四种质量字段及投递关联字段。旧记录的新增质量默认值为 `legacy_unknown`，不能未经复核自动当作有效实测。原始消息 ID 唯一索引替换为普通索引，以保留重复投递证据；旧记录仍保留。

4. 迁移 4 新增不可更新/删除的 `protocol_profiles`、原始记录的 `profile_id/profile_snapshot`、测量指标 `semantics` 和采集时间索引。旧记录语义为 `unknown`。
5. 迁移 5 新增试验、小区、安装履历、操作审计和告警处置表，保留原有告警。
6. 迁移 6 给告警添加具体指标、单位和观测时间依据，防止其他指标更新或配置调整误触发恢复。

目前没有自动重解析或升级历史质量的功能。旧数据若不再出现在有效测量查询里，不表示已被删除；需通过原始接收及关联解码结果复核，不能直接批量改成“有效”。

## 表及关系

| 表 | 主要内容 | 关系与索引 |
|---|---|---|
| `gateways` | ID、名称、厂家、型号、固件、通信方式、通信超时秒数、位置、备注 | ID 主键；通信配置仅在网关接口修改。 |
| `sensors` | ID、类型、名称、厂家、型号、位置、单位、备注、`freshness_seconds` | `gateway_id` 外键；网关关系索引。一网关可关联多仪器。 |
| `telemetry_raw` | 每次投递的字节 BLOB、设备标识、消息 ID、来源、传输方式、服务器时间、设备时间原文、解析结果、四种质量、`duplicate_of` | ID 主键；网关/消息 ID、网关/时间、传感器/时间索引。设备标识不设外键，允许保留未知身份或错误绑定报文作为诊断证据。 |
| `telemetry_measurements` | 解码值、指标代码、单位、质量、时间与来源 | 引用 raw ID 和 sensor ID；传感器/时间、指标/时间及传感器/指标/单位/时间索引。此表包含待核实或异常解码结果，不能无条件作为有效测量查询。 |
| `device_events` | 网关与可选传感器、事件类型、事件时间和详情 | 引用网关/仪器；网关/时间索引。当前只由内部逻辑或隔离测试生成；无公开写事件接口。 |
| `protocol_profiles` | 仪器、不可重复版本、协议名称、解析/校准版本、证据引用、指标定义 JSON | sensor/version 唯一；更新和删除触发器拒绝覆盖。档案不等于验证通过。 |
| `experiments` / `plots` | 试验、小区、处理说明 | 小区引用试验，ID 唯一。 |
| `sensor_installations` | 仪器、小区、起止时间 | 非重叠半开区间；只能结束尚未结束的安装，不能直接改写起点/归属或已结束记录。 |
| `operation_audit` | 行为、对象、前后值、时间、操作来源 | 对象/时间索引；`local_operator` 不是真实身份认证。 |
| `alarms` | 对象、指标、条件、发生/确认/恢复时间及原始证据 | 活动 condition_key 唯一；具体指标的新观测才可恢复其告警。 |
| `alarm_actions` | 触发、确认、备注、恢复及证据 | 引用告警，按 ID 保留处置顺序。 |
| `schema_migrations` | 已执行版本及应用时间 | 版本主键。 |

传感器登记只允许选择已登记网关，不再隐式创建网关。传感器修改不能更改通信方式或网关通信超时；已有传感器的编号、类型和网关关联不可直接改写，以保护历史归属。网关通信配置变化只改变该网关的通信判断，不修改各传感器的数据时效。

## 内部接收处理

`backend/src/ingest.js` 按以下顺序工作：

1. 要求原始字节、网关标识、来源和传输方式，标准化服务器接收时间；先保存一条原始投递。
2. `communicationVerified` 默认为 false。适配器必须在验证来源身份后明确传入 true；此布尔值本身不是认证机制，也不是外部报文可自行声明的字段。
3. 未验证来源或传感器绑定不匹配时，原始记录标记 `rejected`，不调用解析器，不产生有效测量或在线事件。
4. 对已验证、正确绑定且提供消息 ID 的投递检查重复。首次候选记录来自同网关、相同 ID 的已验证且非 rejected / duplicate / conflict 投递。传感器、原始字节和设备时间原文均相同时标记 `duplicate`；不同则标记 `conflict`。两者保留本次原文并通过 `duplicate_of` 引用首个记录，不重复解码或入测量表。无可靠消息 ID 时不去重。
5. 非重复的已验证接收写入 `telemetry_received` 事件。通信接收有效不代表协议或测量有效。
6. 可选 `profileId` 必须属于当前仪器，整份档案快照保存到本次原始记录。重复投递沿用首次快照，不因调用新版本而重解析。
7. 解析器返回单指标对象或 1–64 个指标对象数组。空批次、重复代码/单位、结构错误或非有限值会拒绝整个测量批次，但原文保留。
8. 结构正确的多指标批次在同一事务写入。各指标独立 `value_quality`；合法但 invalid/unverified 的解码值留在审计库，valid 兄弟指标仍可通过有效筛选。语义只来自匹配档案，未匹配为 unknown。原文的总体值质量取最保守状态。
9. 写测量事务失败回滚全部测量并记录失败；不把部分成功当成整个报文成功。档案元数据不会自动提升质量。

重复与冲突投递当前不刷新通信事件；未知消息 ID 的重复无法可靠识别。该内部接口未包含网络认证、连接限流或真实协议映射；相关设计见 [接入安全设计](SECURE_INGESTION.md)。存储异常不会被当作成功接收。

## 四种质量及有效测量筛选

`backend/src/quality.js` 的有效查询条件为：

- `communication_quality = verified`
- `protocol_quality = valid`
- `value_quality = valid`
- `time_quality` 为 `valid` 或 `missing`

CRC 正确只是协议条件之一，不能证明传输身份或仪器物理准确性。值的单位、倍率、测量语义和质量规则必须先有依据；不依据数值看似合理而自动通过。旧质量 `legacy_unknown`、未核实值、无效/未来设备时间不进入常规监测、趋势、统计和 CSV。

`GET /api/telemetry/raw/:id` 返回原始十六进制字节和该记录的全部解码结果，包括未通过有效测量筛选的结果。诊断视图会标明其质量，不能把这些结果展示为正常实测指标。

## 时间的保存与使用

- `received_at` 是服务器接收时间，规范为 UTC ISO 字符串。内部测试可注入时间；今后的网络适配器必须自己生成它，不能接受外部报文指定的服务器时间。
- `device_timestamp` 保留报文提供的时间原文；`measured_at` 仅存通过当前时间检查后标准化的设备时间。
- 时间缺失：`time_quality = missing`，`measured_at = null`。如果其他质量通过，仍允许查询此测量，但界面明确标记设备时间缺失。
- 时间格式不能解释或未含时区：标记 `invalid`。当前实现将比接收时间晚超过 300 秒的时间标记 `future`；300 秒是当前软件容忍值，不是设备时钟已验证的证据。无效或未来时间的 `measured_at` 保持空。
- 接收时间与设备时间分别显示。历史筛选、排序、趋势横轴和导出使用明确的 `time_basis=received_at|measured_at`，默认接收时间。选择采集时间时排除 null，绝不使用混合回退时间轴。
- 传感器时效优先使用有效设备时间，缺失时才使用接收时间，并在返回的 `time_basis` 中说明依据。缺失设备时间时，“数据新鲜”只能说明最近收到了有效记录，不能排除设备补传历史测量。

## 网关通信状态与传感器数据状态

`backend/src/status.js` 分别计算两层状态，不用一个在线字段代表所有仪器。

| 网关状态 | 当前判定 |
|---|---|
| `pending` | 尚无有效通信或明确通信异常事件。 |
| `communication_error` | 最近相关事件为通信异常；后续有效通信事件可解除。 |
| `timeout_unconfigured` | 有有效通信记录，但未配置网关超时。 |
| `online` | 最近有效通信未超过该网关超时。 |
| `offline` | 最近有效通信超过该网关超时。 |

逐指标从自身最新有效测量判断时效（有设备时间时以其排序），另用最新解码结果保留异常。每个指标返回当前状态、上次有效值及原文、最近解码原文、版本和时间依据。最新档案定义的必需指标没有值时为 no_data，不能被兄弟指标掩盖。

仪器摘要优先提示任一指标异常或最近已验证报文解析/时间失败；否则基于必需指标集合检查无数据、过期和未配置时效；没有必需集合时检查实际出现的指标。旧值的语义和快照保持原样，当前时效阈值采用最新档案的指标配置，缺省回退仪器配置。返回 `latest_profile_id`、`freshness_profile_id`、`freshness_basis` 区分值来源与当前判断依据。未验证来源、拒绝绑定和重复投递不生成有效观测。

| 传感器状态 | 当前判定 |
|---|---|
| `no_data` | 自身没有有效测量或必需指标缺失，且没有需优先提示的异常。 |
| `freshness_unconfigured` | 已有有效记录，但未配置该仪器的数据有效期。 |
| `fresh` | 自身最近有效记录在数据有效期内。 |
| `stale` | 自身最近有效记录已过期。 |
| `invalid_data` | 自身最近符合诊断范围的尝试存在解析、值或时间异常；不等同于网关断线。 |

API 返回 `gateway_status`、`data_status`、`last_valid_at`、`last_valid_received_at`、`time_basis` 和最近接收/原始记录标识。网关心跳不为所有关联传感器生成有效测量。总览在线率以已登记网关为分母，空库为 null；传感器状态数量另外统计。

## 查询与本地接口

- `GET/POST /api/gateways`、`GET/PUT /api/gateways/:id`：独立网关登记、修改、状态及关联仪器。
- `GET /api/devices`、`GET /api/sensors`、`POST /api/devices`、`PUT /api/devices/:id`：传感器及其独立数据状态。
- `GET /api/dashboard/summary`：嵌套的 `gateways`、`sensors` 统计及最后有效数据接收时间。
- `GET /api/telemetry/series`：有效测量中已有的设备/指标/单位组合；不自动发明指标。
- `GET /api/telemetry/latest`：按传感器、指标和单位分别返回最新有效记录。
- `GET /api/telemetry/history` 与 `.csv`：先在服务端按仪器、指标、单位及选定时间口径筛选，再排序/分页；避免先截取所有仪器再在前端过滤。分页每次最多 500 条，CSV 单次超过 50000 条时要求缩小范围。
- `GET /api/telemetry/raw`：原始接收分页，支持网关、仪器、处理状态和接收时间范围；包含失败、拒绝、重复及冲突。
- `GET /api/telemetry/raw/:id`：原始字节、质量与关联解码结果；`GET /api/events`：按网关或仪器过滤事件分页。
- `GET /api/devices/:id`：仪器、关联网关、各指标、协议档案、安装、最近报文/事件及仪器/网关关联告警。
- `GET/POST /api/devices/:id/profiles`：不可覆盖的档案版本（definitions 含 measurement_code/unit/semantics/required/freshness_seconds）。
- `GET /api/telemetry/statistics`：必须指定仪器/指标/单位，完整范围统计、语义、版本组成、排除数与各计数口径。均值仅全部有效记录为 instantaneous 时开放，不计算派生总量。
- `GET /api/telemetry/export.json`：同一读取事务中的数据、筛选、统计、SHA-256；CSV 与 JSON 最大 50000 条。
- `GET/POST /api/experiments`、`GET/POST /api/plots`：试验和小区；`GET/POST /api/installations`、`POST /api/installations/:id/close`：非重叠安装履历。
- `GET /api/alarms`：评估并返回真实证据产生的告警，可按 sensor_id/gateway_id/status 筛选；`POST /api/alarms/:id/ack`、`…/:id/notes`：要求非空处理说明，确认不解除故障。
- `GET /api/audit`：操作审计分页，支持 entity_type/entity_id 筛选。

时间参数须包含时区，起止范围、分页和排序经验证。空库返回合法空数组、null 和实际计数。服务绑定本机，并拒绝来自非本地 UI Origin 的浏览器修改请求；这不代替用户认证。当前未开放任何设备数据接收接口，不得将这些开发管理接口暴露公网。

## 查询、归属与告警一致性

历史、统计和导出共用范围生成器：sensor_id、measurement_code、unit、from/to、time_basis、experiment_id、plot_id，先筛选后分页。试验归属 LEFT JOIN 安装时段，要求有效 measured_at 存在；缺失设备时间保留 null。不同单位或不同指标不能合并统计。分析对全匹配记录聚合，图表限制不会截断统计。

`missing_device_time_count` 在接收口径下限本次范围，在采集口径下统计所选系列全部时间的缺钟记录（不能推测其所属采集时段）；API 同时返回说明。`excluded_count` 是同一范围已解码而未通过质量筛选的记录，不包含没有解码值的原始报文。

告警每 30 秒或读取时评估一次，同一活动条件只创建一次。指标过期/异常与网关通信分别记录；确认变为 acknowledged，只有新通信或对应指标更晚的有效观测满足恢复条件才变为 resolved。扩大有效期、更新其他指标、给同一旧观测换消息 ID 均不算恢复。解析结构失败时保留传感器级条件。规则不对空库、待接入或没有历史观测的指标制造离线/过期事实。
