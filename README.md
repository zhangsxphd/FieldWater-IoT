# 田水智联 FieldWater IoT

面向农田灌溉试验和水量监测的独立本地平台。**业务库只管理实际仪器数据，没有实测数据就显示空状态。** 当前未连接真实 DTU，未开放 HTTP / MQTT / TCP 仪器接收服务，未部署阿里云；硬件协议仍需依据实际铭牌、说明书及固件核实。

正式仓库：[zhangsxphd/FieldWater-IoT](https://github.com/zhangsxphd/FieldWater-IoT)。仅保留 `main`，每个开发批次测试后提交并推送，不强推、不重写历史。

## 从登记到科研导出

1. **设备管理**：独立登记网关，再关联仪器；网关通信超时与仪器数据时效分别管理。
2. **仪器详情**：建立不可覆盖的协议/指标档案版本，分别定义指标单位、语义、必需性与时效。未知信息留空或标为待核实，登记不等于通过验证。
3. **试验管理**：建立试验、小区、处理及安装履历。迁移仪器先结束旧安装再新增；旧数据按当时采集时间归属，设备时间缺失则保持未知。
4. **接收诊断**：未来经过认证的适配器调用内部接收模块。原始字节优先保存，一份报文可关联多个指标；失败、重复、冲突、版本快照均可追溯。
5. **监测、历史、分析**：选择仪器、指标、单位及时间口径，可按试验/小区筛选。统计覆盖完整范围，图表最多展示 500 条，历史每页 25 条。
6. **告警管理**：由实际通信、逐指标时效和质量触发本地告警；人工确认和实际恢复分开记录，恢复必须有对应指标的新证据。
7. **导出与复核**：CSV 包含时间、质量、版本和试验归属；JSON 同时包含数据、查询口径、统计方法及数据校验值。

一个指标更新不会把同网关其他仪器或其他指标自动判为正常。未知语义、累计读数及时段增量不计算算术均值或派生总量；当前不计算日降雨量、雨强或灌溉累计用水量。

## 本地启动

需要 Node.js 24、npm。实际本地项目路径：`/Users/zhangshuxuan/Documents/FieldWater-IoT`。

```sh
cd /Users/zhangshuxuan/Documents/FieldWater-IoT
npm ci --prefix backend
npm ci --prefix frontend
npm start --prefix backend
```

另开终端：

```sh
cd /Users/zhangshuxuan/Documents/FieldWater-IoT
npm run dev --prefix frontend
```

前端 [http://127.0.0.1:5181](http://127.0.0.1:5181)，后端 [健康检查](http://127.0.0.1:3181/api/health)。两个服务仅绑定本机；按 Ctrl+C 停止。不复用 LanSense 的端口、环境、数据库、源码或服务配置。

默认数据库 `backend/data/fieldwater.sqlite`（上述 npm 启动方式）；可用 `FIELDWATER_DB` 指定本项目独立路径。首次运行只建表，不填入任何网关、仪器或测量。**升级有实际数据的数据库前，先执行并验证[备份与恢复](docs/BACKUP.md)。** 本次开发只对临时数据库执行迁移与测试。

## 验证

```sh
node scripts/check-repository.mjs
npm test --prefix backend
npm run build --prefix frontend
npm run test:e2e --prefix frontend
```

浏览器测试默认使用本机 Google Chrome，可用 `CHROME_PATH` 指定可执行文件。测试自行创建临时 SQLite，并启动独立服务；3181/5181 被占用时拒绝复用，不停止已有服务。Linux CI 安装 Playwright Chromium，以 `CI=true` 运行相同流程。每次推送 main 后 GitHub Actions 自动检查锁文件安装、仓库文件、后端、构建和浏览器流程，实际状态查看 [Actions](https://github.com/zhangsxphd/FieldWater-IoT/actions)。

测试记录见 [TESTING.md](docs/TESTING.md)。测试向量不是仪器实测，不进入业务库；没有模拟器、演示模式或数据填充按钮。

## 当前边界

- 已实现本地档案、版本化多指标接收内核、双时间口径查询、完整范围统计、试验安装履历、证据驱动告警、操作审计及安全备份恢复。
- 接收内核的 `communicationVerified` 只能由未来可信适配器设置，本身不是身份认证。真实设备接收、凭据发放、用户登录与权限控制尚未实现，不能将本地管理接口暴露公网。
- 操作审计中的 `local_operator` 表示本地操作来源，不证明真实人员身份。
- 雨量 CRC/请求上下文算法经过独立向量测试，厂家完整手册仍缺失。水位、流量寄存器与倍率不作推断；没有实机测试结论。
- 不覆盖旧解析结果，不自动重解析，不实施控制命令、外部告警通知或云部署。

## 目录与文档

```text
backend/src/          数据迁移、接收、档案、状态、查询、告警、试验、审计与测试
backend/scripts/      数据库备份恢复命令
frontend/src/         React 页面、公共组件和样式
scripts/              仓库文件与凭据模式检查
tests/               隔离浏览器工作流
.github/workflows/    main 自动验证
docs/                架构、操作流程、数据结构、硬件及测试说明
```

- [架构与边界](docs/ARCHITECTURE.md)
- [完整操作流程](docs/WORKFLOWS.md)
- [数据库与 API](docs/DATABASE.md)
- [备份恢复](docs/BACKUP.md)
- [开发批次记录](docs/DEVELOPMENT_LOG.md)
- [真实数据政策](docs/REAL_DATA_POLICY.md)
- [硬件协议待核实事项](docs/HARDWARE_PROTOCOLS.md)
- [接入安全设计](docs/SECURE_INGESTION.md)
- [LanSense 复用审计](docs/REUSE_AUDIT.md)
