# 开发批次记录

## 2026-11-14：可信数据与科研工作流程

用户明确要求只保留 main。原开发分支已快进合并到 main，保留至 `0509225f49fbc94536d73cde3bc2a4b8b1658a53` 的全部历史，再删除本地及远程开发分支。未强推、未重写历史、未新建分支。

| Commit Message | SHA / GitHub | 验证 |
|---|---|---|
| `docs: keep FieldWater development on main` | [f719fbe](https://github.com/zhangsxphd/FieldWater-IoT/commit/f719fbe7683ba33ca5e028a958dfbc5cbcd43f80) | 核对远程分支、快进合并历史、差异与远端 SHA |
| `feat: add verified SQLite backup and restore` | [66c691b](https://github.com/zhangsxphd/FieldWater-IoT/commit/66c691b96146ab7654adfc90e755281d9baf697b) | 临时 WAL 数据库备份、恢复、拒绝覆盖与损坏清单测试通过 |
| `feat: preserve multi-metric telemetry and protocol provenance` | [89083c6](https://github.com/zhangsxphd/FieldWater-IoT/commit/89083c61a31defc1bc979309e8f3c186748cab01) | 从暂存区独立导出运行后端 24 项测试通过 |
| `feat: add research installation history and alarm workflows` | [50c8ad4](https://github.com/zhangsxphd/FieldWater-IoT/commit/50c8ad4e3b7617a42bbe173b4307c99b6f6483c7) | 从暂存区独立导出运行后端 30 项测试通过 |
| `feat: add full-scope statistics and reproducible telemetry exports` | [9e44832](https://github.com/zhangsxphd/FieldWater-IoT/commit/9e44832bbbdb2ba577131cbb61226a5ed720d41a) | 集成后端 35 项测试通过，含 601 条全范围统计 |
| `fix: require metric-specific evidence for alarm recovery` | [4131a98](https://github.com/zhangsxphd/FieldWater-IoT/commit/4131a985b050d58714ab683cb666ffb34804e68a) | 后端 36 项测试通过，新增兄弟指标/调参/旧观测回归 |
| `feat: connect instrument research and alarm workbenches` | [5a4bad2](https://github.com/zhangsxphd/FieldWater-IoT/commit/5a4bad23661841d37ac85c1ce39d42e10a9289c4) | 生产构建、查询 API 回归、桌面/手机浏览器流程通过 |
| `ci: verify main with isolated backend and browser tests` | [2ce9b25](https://github.com/zhangsxphd/FieldWater-IoT/commit/2ce9b25e395dc2f5d9ff02fa7336050f219e40e6) | 本地流程通过；首次远程运行在 Ubuntu 26.04 浏览器安装失败 |
| `ci: pin Ubuntu runtime supported by Playwright` | [c7515c6](https://github.com/zhangsxphd/FieldWater-IoT/commit/c7515c617ebc59bb54932e5d3b64b4caa406247d) | 依据锁定 Playwright 支持列表固定 Ubuntu 24.04；实际远程状态见 Actions |

上述每个批次均检查差异、敏感文件/凭据、暂存内容，提交后立即推送并核对远端 main SHA。后续文档提交的准确 SHA 由 `git log --oneline` 或 GitHub main 历史查询，避免在文档中预填自身尚不存在的哈希。

本轮保留既有 Node.js / Fastify / SQLite / React / Vite 技术栈。多轮检查修正了告警跨指标恢复、有效值原文链接、统计范围、试验筛选联动与 CI 系统兼容性。所有测试向量在临时数据库，未启动业务数据库、设备模拟器、MQTT Broker 或真实设备连接；未修改 LanSense，未部署生产。

仍待实际硬件：完整协议和铭牌、DTU 传输/认证/缓存能力、各仪器寄存器和倍率、雨量计累计/时段/清零/溢出、用户认证和生产授权、长期采集稳定性。没有将软件测试通过解释为实机接入成功。
