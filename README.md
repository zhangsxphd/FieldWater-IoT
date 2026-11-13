# 田水智联 FieldWater IoT

面向农业灌溉试验与水量监测的独立平台。**只管理真实仪器数据；没有实测数据就显示空状态。** 当前为本地开发阶段，尚未开放真实设备接收接口，也未部署阿里云。

## 当前工作流程

1. 在“设备管理 → 网关管理”登记实际网关及通信超时。
2. 在“传感器管理”选择已登记网关，填写仪器信息与独立数据时效；不会自动创建网关。
3. 在“系统设置”检查登记状态，并准备铭牌、完整说明书、固件和通信配置。
4. 未来适配器接入后，从“接收诊断”检查原始报文、身份、协议、测量与时间质量，包括失败、重复与冲突。
5. 通过验证的测量进入监测、历史和分析。先选仪器、指标、单位，再按接收时间查询，不能混用累计与瞬时指标。
6. 从测量记录打开原始报文，复核来源；历史数据支持分页和 CSV 导出。

网关通信状态与传感器数据状态分别判断。网关在线不代表每台仪器都有有效数据；未经验证的报文不能改变状态。无网关时在线率为空。重复记录保留接收痕迹，但不重复生成测量或刷新仪器数据时效。

## 本地运行

需要 Node.js（本机测试版本为 24.22.2）、npm。两个终端均先进入本项目：

```bash
cd /Users/zhangshuxuan/Documents/FieldWater-IoT
npm ci --prefix backend
npm start --prefix backend
```

```bash
cd /Users/zhangshuxuan/Documents/FieldWater-IoT
npm ci --prefix frontend
npm run dev --prefix frontend
```

访问 [本地界面](http://127.0.0.1:5181)，后端健康检查为 [本地 API](http://127.0.0.1:3181/api/health)。两个服务仅绑定 `127.0.0.1`；前端代理访问后端。按 Ctrl+C 分别停止。

默认数据库为 `backend/data/fieldwater.sqlite`，可通过 `FIELDWATER_DB` 指定独立路径。**禁止指向 LanSense 数据库。** 数据库和真实凭据不提交 GitHub。升级有真实数据的数据库前应先备份并验证恢复；迁移保留历史记录，但缺少质量证据的旧测量标为 `legacy_unknown`，不会自动认定为可信。

## 检查与测试

```bash
npm test --prefix backend
npm run build --prefix frontend
npm run test:e2e --prefix frontend
```

端到端测试使用 Playwright 和本机 Google Chrome（或用 `CHROME_PATH` 指定路径）。运行前停止占用 3181/5181 的开发服务；测试会拒绝复用已有服务，不会擅自停止它们。测试自行创建临时 SQLite、启动独立服务并在结束时清理。测试向量不进入项目数据库。详见 [测试说明](docs/TESTING.md)。

## 已实现与边界

- Fastify + SQLite 迁移；网关与仪器独立管理、双层状态、四类质量信息。
- React + Vite 界面：总览、设备管理、实时监测、历史、分析、接收诊断、告警记录、接入准备。
- 内部接收接口优先保存原文，失败/重复/冲突可追溯；尚未开放 HTTP/MQTT/TCP 仪器接收。
- 雨量解析具备 CRC 与请求上下文校验，但手册与实际型号未核实，解码值默认不进入可信测量。水位与流量寄存器尚未实现。
- 分析针对当前选定范围内最多 500 条返回记录进行描述统计，明确显示匹配总数、截取范围和来源；不是完整时段或时间加权统计。不计算 24 小时雨量。
- 用户认证、自动告警规则及公网部署尚未实现。跨站浏览器修改请求被限制，但这不替代生产认证。不能将此开发服务暴露公网。

## 文档

- [完整操作流程](docs/WORKFLOWS.md)
- [数据库、状态与数据质量](docs/DATABASE.md)
- [真实数据政策](docs/REAL_DATA_POLICY.md)
- [硬件协议与待核实事项](docs/HARDWARE_PROTOCOLS.md)
- [真实设备接入安全设计](docs/SECURE_INGESTION.md)
- [LanSense 复用审计](docs/REUSE_AUDIT.md)

所有功能批次单独验证、提交并推送。当前改造在 `codex/real-device-readiness` 分支，未合并至 `main`。不连接真实设备、不发写命令、不修改 LanSense。
