# server

这个目录是 LifePilot 的 Node.js 后端。它是产品运行时的权威层，负责饭点 session、推荐数据、记忆账本、Memory Intelligence、OpenClaw Gateway 调用、商户证据工具和后台管理接口。

## 支持能力

- 饭点主链路：`/api/session/start`、`/api/session/swipe`、`/api/session/advance`、`/api/session/finalize`。
- 问小汪：聊天、异步 job、历史会话、汪记本。
- 推荐和卡片：方向卡、商户卡、单卡解释、最终确认上下文。
- 记忆系统：observations、candidates、confirmed preferences、memory manage、Memory Intelligence jobs。
- OpenClaw bridge：通过 Gateway client 请求 agent，并通过 `/api/tools/*` 给 skills 提供证据。
- 管理工具：商户、offer、deal、reputation 和资产管理。

## 产品价值

后端让 LifePilot 的 AI 能力保持可审计。模型可以理解和解释，但状态、证据和记忆写入必须经过后端。这个边界保证小汪不会凭空编造商户事实，也不会绕过用户确认写入长期偏好。

## 运行方式

```bash
npm run dev
npm run check
```

默认端口是 `4331`，可通过 `PORT` 环境变量覆盖。

