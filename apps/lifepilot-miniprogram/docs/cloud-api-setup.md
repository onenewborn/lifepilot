# 小程序云端 API 连接说明

这份说明只覆盖 `apps/lifepilot-miniprogram` 前端如何连接 LifePilot 云端后端。当前比赛调试阶段，稳定入口是腾讯云公网 IP。

## 当前默认配置

当前默认后端地址：

```text
http://110.42.208.125
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
const CLOUD_API_BASE_URL = "http://110.42.208.125";
```

## 模式说明

- `cloud`：当前默认模式，连接腾讯云后端 `http://110.42.208.125`。
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
curl http://110.42.208.125/api/health
curl http://110.42.208.125/api/xiaowang/skills
```

预期：

- `/api/health` 返回 `ok: true`。
- `/api/xiaowang/skills` 返回饭点滑卡、商户、记忆等 skills。

如果这两条命令通，但小程序里失败，优先检查微信开发者工具设置和当前 `API_MODE`。

## 微信开发者工具设置

当前 `project.config.json` 里 `urlCheck` 是 `false`，用于比赛调试阶段访问裸 IP / HTTP。

如果真机预览仍然报连接失败，在微信开发者工具里确认已开启：

```text
不校验合法域名、web-view、TLS 版本以及 HTTPS 证书
```

正式小程序不能长期依赖裸 IP / HTTP。域名、备案、解析和 HTTPS 证书完成后，应切到：

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

- 前端需要收到 `skill_cards` 里的 `action: "start_meal"`。
- 当前版本收到该动作后会自动进入饭点滑卡；如果没有进入，检查 `/api/xiaowang/chat-jobs/:job_id` 的最终返回里是否包含对应 skill card。

## 后续切换到域名

备案、解析和证书完成后：

1. 把 `CLOUD_API_BASE_URL` 或新增的正式 API base 改成 `https://api.lifepilot-xiaowang.cn`。
2. 保持 `API_MODE = "cloud"`，或新增更明确的 `production` 模式。
3. 在微信公众平台配置合法请求域名。
4. 重新跑 `/api/health`、`/api/xiaowang/skills` 和问小汪真机测试。
