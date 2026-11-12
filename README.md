# 田水智联 FieldWater IoT

面向农田水量监测与灌溉试验的独立物联网平台。本仓库正在开发，支持手动登记设备、查看真实数据与空状态；真实设备通信接入尚未启用。

- [LanSense 代码复用审计](docs/REUSE_AUDIT.md)
- [硬件与通信协议核实](docs/HARDWARE_PROTOCOLS.md)
- [真实数据政策](docs/REAL_DATA_POLICY.md)

仅在本地开发和测试；不连接真实设备或部署生产服务器。只使用真实仪器数据；没有数据时如实显示空状态。数据库、服务、凭据和端口均独立于 LanSense。

## 本地后端（开发中）

运行 `npm ci --prefix backend`，然后 `npm start --prefix backend`；健康检查为 `http://127.0.0.1:3181/api/health`。运行 `npm test --prefix backend` 执行测试。数据库默认保存在 `backend/data/fieldwater.sqlite`，不应连接 LanSense 数据库。接口目前没有认证，只供本机开发，不能用于生产环境。

## 本地前端

在另一个终端运行 `npm ci --prefix frontend`，再运行 `npm run dev --prefix frontend`；访问 http://127.0.0.1:5181。前端通过本地代理访问后端，先启动后端。构建命令为 `npm run build --prefix frontend`。

历史数据按服务器接收时间筛选，可导出 CSV；数据时间未知时不填造设备时间。设备必须手动登记，通信超时需按实际设备配置。雨量协议解析仅为独立模块，还没有接入已核实的现场数据；分析方法、告警产生与用户认证尚未实现，系统不能用于生产。详见 [数据模型](docs/DATABASE.md)。
