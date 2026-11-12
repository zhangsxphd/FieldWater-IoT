# LanSense 代码复用审计

审计日期：2026-11-12。用户给出的 `/Users/zhangshuxuan/Documents/水位计平台` 不存在；`/Users/zhangshuxuan/Documents/Project/水位计平台` 仅发现依赖残留。下列相对路径均指向只读检查的 `/Users/zhangshuxuan/Documents/Project/Lansense Cloud/LanSense-PR1-work`，其 Git 远端为 LanSense；不能仅凭此断言它与线上运行版本完全一致。未复制任何代码、配置或数据。

后端为 Fastify 5.6.2 系列、Node.js ESM、better-sqlite3 12.11.1 系列，见 `backend/package.json`；前端为 React 19.2.1 系列、Ant Design 6.0.1 系列、React Router 7.18.2、Vite 8.0.16 系列，见 `frontend/package.json`。版本为 package.json 中的声明，并非已独立验证的部署版本。

## A. 可以直接复用

目前没有确认可直接复制且与新项目无业务、配置及安全依赖的代码。可沿用上述框架和数据库驱动的技术选型。

## B. 修改后复用或作为设计参考

| 功能 | 路径 | 原因 |
|---|---|---|
| 认证与权限 | `backend/src/modules/auth/routes.js`、`backend/src/plugins/auth.js`、`backend/src/services/authorization.js`、`frontend/src/App.jsx` | 参考登录与鉴权；用户模型、密钥和权限须独立审查。 |
| 设备注册与状态 | `backend/src/modules/devices/routes.js`、`backend/src/services/device-access.js`、`backend/src/db/schema.js` | 原设备模型耦合站点、租户与设备业务；新项目须分离 gateway/sensor。 |
| 数据库访问 | `backend/src/db/database.js`、`backend/src/db/schema.js`、`backend/src/db/migrations.js` | 参考 SQLite 访问和迁移；不能连接或复制原库。 |
| 历史查询 | `backend/src/modules/readings/routes.js`、`backend/src/services/reading-window.js` | 原数据模型与水位业务耦合，需重新设计。 |
| 告警与离线 | `backend/src/modules/alarms/routes.js`、`backend/src/services/alarm-engine.js` | 参考权限和状态逻辑，需核对网关离线与数据时效。 |
| 前端路由及布局 | `frontend/src/App.jsx`、`frontend/src/layouts/AppLayout.jsx` | 可参考路由结构，视觉设计独立。 |
| 图表 | `frontend/src/components/irrigation/IrrigationChart.jsx`、`frontend/src/components/SoilSynchronizedChart.jsx` | 与原业务存在关联，需检查依赖及改造；不可假设图表库已独立可用。 |
| 水位接收与解析 | `backend/src/modules/device-ingest/routes.js`、`backend/src/services/reading-writer.js` | `/d100l2` 为 HTTP POST，含 Modbus 帧解析；MQTT 需要独立实现。原设备处理不可直接套到其他仪器。 |
| API | `backend/src/app.js`、`backend/src/modules/` | 路由包括认证、设备、读数和告警；接口和数据模型需独立设计。 |

数据库结构见 `backend/src/db/schema.js`：包括 devices、sensor_readings、device_probes、alarms、users 等；其关系与权限依赖不能原样假定适用于新项目。`backend/src/services/collector.js` 也包含外部 API 采集逻辑。

## C. 不需要复用

原项目的第三方水位 API 采集、天气、AI、土壤监测及灌溉业务、生产域名和服务配置等不属于此阶段，不应整体复制。相关入口可见 `backend/src/app.js` 和 `frontend/src/App.jsx`。

## D. 尚未核实

线上实际版本与此工作树的一致性、各功能的线上稳定性、许可证和具体代码依赖尚未逐项验证。当前检查是架构级审计，不代表上述功能已移植、测试或被确认可直接使用。仪器及 DTU 型号和能力见硬件核实文档。
