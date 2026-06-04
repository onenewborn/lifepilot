# LifePilot 小程序 P6 第一版

这个目录是新的模块化小程序工程，不直接复制旧 `pages/index` 巨型页面。

## 当前范围

- 只开放饭点主链路：入口表单、方向滑卡、方向小结、商户滑卡、最终确认、饭后反馈。
- 暂时隐藏“问小汪”“汪记本”“OpenClaw 过程展示”等入口。
- 前端只维护展示状态，饭点 session、卡片、最终结果以后端 `4331` 服务为准。
- 视频资源继续从 COS 地址加载；视频未准备好或加载失败时先显示图片。

## 本地调试

1. 在微信开发者工具里导入这个目录：`apps/lifepilot-miniprogram`。
2. 当前比赛调试默认连接云端后端：`https://api.lifepilot-xiaowang.cn`。
3. API 地址由 `config/api.js` 控制，当前默认是 `API_MODE = "cloud"`。
4. 如果真机预览访问裸 IP / HTTP 失败，在微信开发者工具里开启“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

## 后端连接模式

`config/api.js` 支持四种模式：

- `cloud`：当前默认模式，连接腾讯云后端 `https://api.lifepilot-xiaowang.cn`。
- `local`：开发者工具访问本机后端 `http://127.0.0.1:4331`。
- `lan`：预留给局域网 IP 调试，当前仍指向 `127.0.0.1:4331`，使用前需要改成电脑局域网地址。
- `tunnel`：临时隧道调试用，不是稳定入口；旧 Cloudflare tunnel 失效后会导致 `request:fail`。

正式提审前，还需要在微信公众平台把 `https://api.lifepilot-xiaowang.cn` 配置为 request 合法域名。

更详细的云端连接和排错说明见 `docs/cloud-api-setup.md`。

## 文件分层

- `pages/meal/`：饭点主页面，只做页面状态和用户交互调度。
- `services/`：后端 API 调用封装。
- `utils/`：卡片归一化、滑卡手势、展示格式化。
- `config/`：后端地址和 COS 资产地址。
- `docs/`：小程序工程内的运行配置和调试说明。
