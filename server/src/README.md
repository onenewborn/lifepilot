# src

这个目录保存 LifePilot 后端源码。它把饭点状态机、推荐卡片、记忆账本、OpenClaw Gateway 和管理工具组织在一起，是产品 runtime 的核心。

## 主要模块

- `app.mjs`：HTTP 路由和 handler 入口。
- `session-store.mjs`：meal session 和 day context 持久化。
- `offer-cards.mjs` / `cards.mjs`：商户卡和方向卡生成。
- `xiaowang-store.mjs`：问小汪聊天、skill action、汪记本展示。
- `memory-store.mjs` / `memory-manager.mjs`：候选记忆和长期偏好。
- `memory-intelligence-store.mjs` / `memory-intelligence-engines.mjs`：日/周复盘、画像刷新和外部 engine。
- `merchant-tools.mjs`：OpenClaw 商户证据工具上下文。
- `openclaw-gateway-client.mjs`：连接 OpenClaw Gateway。
- `admin-data.mjs`：后台数据维护。

## 产品价值

这里体现了 LifePilot 的核心工程原则：后端是状态和证据权威，agent 是自然语言理解和工具编排者。所有长期记忆和推荐证据都要通过后端合同，而不是让模型自由读写文件。

## 维护原则

- 新增业务能力时优先明确权威归属。
- 不要让 `app.mjs` 继续无限膨胀，后续适合按 domain 拆 routes。
- 重要行为应补 smoke test。

