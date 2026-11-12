# 田水智联 FieldWater IoT

面向农田水量监测与灌溉试验的独立物联网平台。本仓库正在开发，当前仅有本机后端基础接口，尚不能接收或展示设备数据。

- [LanSense 代码复用审计](docs/REUSE_AUDIT.md)
- [硬件与通信协议核实](docs/HARDWARE_PROTOCOLS.md)

仅在本地开发和测试；不连接真实设备或部署生产服务器。模拟数据与真实数据必须明确区分。数据库、服务、凭据和端口均独立于 LanSense。

## 本地后端（开发中）

运行 `npm ci --prefix backend`，然后 `npm start --prefix backend`；健康检查为 `http://127.0.0.1:3181/api/health`。运行 `npm test --prefix backend` 执行测试。数据库默认保存在 `backend/data/fieldwater.sqlite`，不应连接 LanSense 数据库。接口目前没有认证，只供本机开发，不能用于生产环境。
