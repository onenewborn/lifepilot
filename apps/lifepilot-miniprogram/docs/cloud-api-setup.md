# 小程序云端 API 连接说明

这份说明只覆盖 `apps/lifepilot-miniprogram` 前端如何连接 LifePilot 云端后端。当前比赛调试阶段，稳定入口是腾讯云 HTTPS API 域名。

## 当前默认配置

当前默认后端地址：

```text
https://api.lifepilot-xiaowang.cn
```

当前配置文件：

```text
config/api.js
```

默认模式：

```js
const API_MODE = "cloud";
```

对应地址：

```js
const CLOUD_API_BASE_URL = "https://api.lifepilot-xiaowang.cn";
```

## 模式说明

- `cloud`：当前默认模式，连接腾讯云后端 `https://api.lifepilot-xiaowang.cn`。
- `local`：开发者工具访问本机后端 `http://127.0.0.1:4331`。
- `lan`：预留给真机访问电脑局域网 IP，使用前需要把 `LAN_API_BASE_URL` 改成电脑的局域网地址。
- `tunnel`：临时隧道模式，只用于排障。旧 Cloudflare tunnel 域名会变，也可能无法解析，不能作为比赛默认配置。

切换模式时，只改：

```js
const API_MODE = "cloud"; // "local" | "lan" | "cloud" | "tunnel"
```

## 云端健康检查

在本机终端验证云端后端：

```bash
curl https://api.lifepilot-xiaowang.cn/api/health
curl https://api.lifepilot-xiaowang.cn/api/xiaowang/skills
```

预期：

- `/api/health` 返回 `ok: true`。
- `/api/xiaowang/skills` 返回饭点滑卡、商户、记忆等 skills。

如果这两条命令通，但小程序里失败，优先检查微信开发者工具设置和当前 `API_MODE`。

## 微信开发者工具设置

当前 `project.config.json` 里 `urlCheck` 是 `false`，便于比赛调试阶段排障。

如果真机预览仍然报连接失败，在微信开发者工具里确认已开启：

```text
不校验合法域名、web-view、TLS 版本以及 HTTPS 证书
```

正式小程序不能依赖裸 IP / HTTP。当前云端 API 已切到：

```text
https://api.lifepilot-xiaowang.cn
```

并把该域名配置到微信小程序合法域名。

## 常见失败原因

`request:fail`

- 当前 `API_MODE` 指向了失效 tunnel。
- 真机预览没有关闭合法域名和 HTTPS 校验。
- 云服务器安全组或后端进程异常。

`后端接口返回异常`

- 请求已经到达后端，但接口返回了非 2xx 或 `ok: false`。
- 看小程序错误气泡里的 `API:` 地址，确认是否打到预期后端。

小汪说启动滑卡但页面不动

- 泛需求应收到 `skill_cards` 里的 `action: "open_meal_entry"`，点击后进入需求确认页。
- 明确需求或点名商户对比应收到 `action: "open_meal_session"`，payload 里必须有 `session_id`，点击后直接打开商户滑卡。
- 如果仍只收到旧的 `action: "start_meal"`，说明云端后端或 OpenClaw workspace 还没有同步到新版。

## 后续提审配置

正式提审前：

1. 保持 `API_MODE = "cloud"`。
2. 在微信公众平台配置合法请求域名：`https://api.lifepilot-xiaowang.cn`。
3. 重新跑 `/api/health`、`/api/xiaowang/skills` 和问小汪真机测试。
