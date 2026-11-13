# FieldWater IoT 开发约束

田水智联 FieldWater IoT 面向农田水量监测与灌溉试验。架构为独立 Node.js/Fastify 后端、SQLite、React 前端和可扩展的真实数据接入层；网关与传感器分开建模。仅使用实际仪器数据，遵守 `docs/REAL_DATA_POLICY.md`。

目录按功能逐步建立：`backend/`、`frontend/`、`docs/`。后端使用 `npm ci --prefix backend` 安装、`npm start --prefix backend` 启动、`npm test --prefix backend` 测试。前端使用 `npm ci --prefix frontend` 安装、`npm run dev --prefix frontend` 启动、`npm run build --prefix frontend` 构建。浏览器回归使用 `npm run test:e2e --prefix frontend`，必须由脚本创建隔离临时数据库；不得复用正在运行的业务服务。

每个独立功能或文档批次检查敏感信息、运行相关测试、执行 `git diff --check`、检查暂存区，使用英文 Conventional Commits 提交并立即推送；核对远端 SHA。不得强推、擅自重写历史或清理未知文件。保护规则存在时不得绕过。任务结束检查状态。

保留原始报文、来源与解析错误，禁止编造仪器协议或监测数据。测试数据只可进入隔离测试数据库。测试覆盖实际行为，未执行的测试不能报告通过。不得提交 `.env`、凭据、密钥和数据库文件。开发服务仅供本机使用，生产接入需独立安全设计。

禁止修改 LanSense 源码、数据库、配置或服务；不复制其 `.git`、真实环境变量和凭据。本阶段不部署云端、不操作真实 DTU 或仪器。

网关与仪器分别管理，禁止传感器表单修改共享网关配置；通信状态和数据时效独立判断。正常查询只包含通过质量筛选的记录，原始失败/重复/冲突必须可审计。设备时间缺失与服务器接收时间分开标记。先按仪器、指标、单位筛选再分页。当前改造在 `codex/real-device-readiness` 独立分支，未经明确要求不合并 main。
