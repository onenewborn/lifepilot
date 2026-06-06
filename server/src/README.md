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

## API 族群

| API | 由谁支撑 | 作用 |
| --- | --- | --- |
| `/api/health` | `app.mjs` | 部署健康检查 |
| `/api/session/*` | `session-store.mjs`、`offer-cards.mjs` | 饭点 session、滑卡、推进和最终确认 |
| `/api/xiaowang/*` | `xiaowang-store.mjs` | 问小汪聊天、历史会话、汪记本、skills |
| `/api/memory/*` | `memory-store.mjs`、`memory-manager.mjs` | 记忆候选、长期偏好、餐后反馈、记忆管理 |
| `/api/memory/intelligence/*` | `memory-intelligence-store.mjs` | 今日/本周复盘、画像刷新、signals |
| `/api/tools/*` | `merchant-tools.mjs` 等 | 给 OpenClaw skills 使用的证据工具 |
| `/api/admin/*` | `admin-data.mjs` | 管理台维护数据和资产 |

## 关键创新落点

- **硬约束先过滤**：避免用户说想吃川菜却看到大量非川菜商户。
- **可解释评分**：每张商户卡可以携带 `scoring_features`，供排序调试和 Ark 推荐语使用。
- **单卡解释**：商户优缺点按 rank、score 和 feature 差异生成，避免每张卡都像第一名。
- **记忆不直接入 prompt**：Memory Intelligence 先生成候选和 signals，后端校验后参与推荐。
- **Agent 有边界**：OpenClaw 通过 API 使用证据，不直接改 runtime 文件。

## 产品价值

这里体现了 LifePilot 的核心工程原则：后端是状态和证据权威，agent 是自然语言理解和工具编排者。所有长期记忆和推荐证据都要通过后端合同，而不是让模型自由读写文件。

## 维护原则

- 新增业务能力时优先明确权威归属。
- 不要让 `app.mjs` 继续无限膨胀，后续适合按 domain 拆 routes。
- 重要行为应补 smoke test。
