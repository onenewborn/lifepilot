# server

这个目录是 LifePilot 的 Node.js 后端。它是产品运行时的权威层，负责饭点 session、推荐数据、记忆账本、Memory Intelligence、OpenClaw Gateway 调用、商户证据工具和后台管理接口。

## 支持能力

- 饭点主链路：`/api/session/start`、`/api/session/swipe`、`/api/session/advance`、`/api/session/finalize`。
- 问小汪：聊天、异步 job、历史会话、汪记本。
- 推荐和卡片：方向卡、商户卡、单卡解释、最终确认上下文。
- 记忆系统：observations、candidates、confirmed preferences、memory manage、Memory Intelligence jobs。
- OpenClaw bridge：通过 Gateway client 请求 agent，并通过 `/api/tools/*` 给 skills 提供证据。
- 管理工具：商户、offer、deal、reputation 和资产管理。

## 服务分层

| 服务层 | 关键文件 | 支持能力 |
| --- | --- | --- |
| HTTP 路由 | `src/app.mjs` | 所有 `/api/*` 入口、错误响应、静态后台页面 |
| 饭点状态机 | `src/session-store.mjs` | meal session、day context、滑卡事件、最终确认 |
| 推荐卡片 | `src/cards.mjs`、`src/offer-cards.mjs` | 方向卡、商户卡、硬约束过滤、feature scoring |
| 小汪聊天 | `src/xiaowang-store.mjs` | OpenClaw 请求、skill card、聊天历史、汪记本聚合 |
| 记忆账本 | `src/memory-store.mjs`、`src/memory-manager.mjs` | observations、candidates、confirmed preferences、用户授权操作 |
| Memory Intelligence | `src/memory-intelligence-store.mjs`、`src/memory-intelligence-engines.mjs` | 即时复盘、日/周复盘、画像刷新、recommendation signals |
| AI provider | `src/ai/` | Ark/Doubao 调用、prompt 构建、商户解释 |
| 商户证据工具 | `src/merchant-tools.mjs`、`src/merchant-feedback-store.mjs` | 商户理解、对比、优惠和反馈权重 |
| 后台管理 | `src/admin-data.mjs`、`public/admin/` | 维护商户、offer、deal、媒体、口碑和 Memory Pipeline 调试 |

## 运行时数据

默认运行态目录是：

```text
data/runtime/
```

它会存储：

```text
meal_sessions
day_contexts
xiaowang_chat_sessions
memory/users
memory_intelligence_jobs
uploaded assets metadata
```

这个目录不提交 Git。部署时可通过 `LIFEPILOT_RUNTIME_ROOT` 改到服务器持久化目录。

## 产品价值

后端让 LifePilot 的 AI 能力保持可审计。模型可以理解和解释，但状态、证据和记忆写入必须经过后端。这个边界保证小汪不会凭空编造商户事实，也不会绕过用户确认写入长期偏好。

## 运行方式

```bash
npm run dev
npm run check
```

默认端口是 `4331`，可通过 `PORT` 环境变量覆盖。
