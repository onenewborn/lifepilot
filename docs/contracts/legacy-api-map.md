# 旧接口映射

更新时间：2026-05-30

## 目的

这份文件把旧 H5 后端和旧小程序的隐性依赖映射到新产品后端。

迁移期间，除非已经有兼容 adapter，否则不要随意改变这些路由和关键字段。

## 旧后端来源

```text
/Users/mona/.openclaw/workspace/apps/lifepilot-h5/server.mjs
```

## 旧小程序主文件

```text
/Users/mona/.openclaw/workspace/apps/lifepilot-miniprogram/pages/index/index.js
/Users/mona/.openclaw/workspace/apps/lifepilot-miniprogram/utils/config.js
```

## 主链路路由映射

| 旧路由 | 新路由 | 阶段 | 说明 |
| --- | --- | --- | --- |
| `GET /api/health` | 相同 | P1 | 必须返回 `ok: true` 和新后端 marker。 |
| `GET /api/food-directions` | 相同 | P1 | 返回 `{ok:true,cards:[...]}`。 |
| `POST /api/session/start` | 相同 | P1 | 创建 meal session 和方向卡。 |
| `POST /api/session/swipe` | 相同 | P1 | 记录左右滑事件。 |
| `GET /api/session/:id` | 相同 | P1 | 返回 public session。 |
| `POST /api/session/advance` | 相同 | P2/P3 | 第一次用于方向总结，第二次用于进入 Offer。 |
| `POST /api/session/finalize` | 相同 | P3 | 生成最终推荐。 |
| `POST /api/food-offers` | 相同 | P3 | Offer 卡兼容路由。 |
| `POST /api/agent/parse-entry` | 相同或 adapter | P2 | session start 稳定后可以变成内部能力。 |
| `POST /api/agent/direction-summary` | 相同或 adapter | P2 | 保留给 smoke/debug。 |
| `GET /api/memory/ledger` | 相同 | P4 | Memory ledger。 |
| `POST /api/xiaowang/chat` | 相同 | P5/P6 | OpenClaw-backed 或 hybrid。 |

## 已知延后路由

这些路由存在于旧后端，但不属于 P1。它们是被有意延后，不是漏掉。

| 旧路由 | 目标阶段 | 迁移意图 |
| --- | --- | --- |
| `GET /api/cards` | P3 或 archive | 旧 H5 card feed。只有 web preview 仍需要时才保留。 |
| `POST /api/plan` | archive | 旧 planner 兼容路由。默认不进入实时饭点流程。 |
| `POST /api/map/route` | P3 | 最终推荐的上下文 provider。 |
| `GET/POST /api/weather/forecast` | P3 | 最终推荐的天气上下文 provider。 |
| `GET/POST /api/queue/status` | P3 | 最终推荐的 mock 排队 provider。 |
| `GET /api/admin/catalog` | P6+ | 后台管理工具，不影响实时卡流。 |
| `POST/PUT/DELETE /api/admin/merchants/*` | P6+ | 后台管理工具。 |
| `POST/PUT/DELETE /api/admin/offers/*` | P6+ | 后台管理工具。 |
| `POST/PUT/DELETE /api/admin/directions/*` | P6+ | 后台管理工具。 |
| `GET /api/xiaowang/sessions` | P5/P6 | Chat thread 管理。 |
| `POST /api/xiaowang/sessions` | P5/P6 | Chat thread 管理。 |
| `GET /api/xiaowang/sessions/:id` | P5/P6 | Chat thread 管理。 |
| `POST /api/memory/post-meal-feedback` | P4 | 从反馈生成候选记忆。 |
| `POST /api/agent/final-decision-explanation` | P3 | 实时 AI 解释或本地 fallback。 |
| `GET /api/memory/candidates` | P4 | Memory ledger 支持。 |

## 旧成功响应形态

方向卡：

```json
{
  "ok": true,
  "cards": []
}
```

Session start：

```json
{
  "ok": true,
  "session": {}
}
```

Session swipe：

```json
{
  "ok": true,
  "event": {},
  "session": {}
}
```

Session advance：

```json
{
  "ok": true,
  "session": {},
  "offer_payload": {}
}
```

## 关键兼容字段

Session：

```text
session_id
user_id
stage
next_step
goal
understanding
direction_events
offer_events
direction_summary
current_cards
offer_payload_meta
result
synthetic_only
created_at
updated_at
```

方向卡：

```text
card_id
direction_id
service_id
title
tags
budget_band
hook
fit
avoid_for
image_url
video_url
poster_url
video_version
has_sound
media_type
```

Offer 卡：

```text
card_id
offer_id
merchant_id
merchant_name
title
tags
score
image_url
video_url
poster_url
facts
explanation
```

## 需要保留的隐性行为

- 数据里的 `/assets/...` 相对路径必须可用，并由小程序解析到 COS。
- 旧方向卡 UI 仍会读取 `service_id`。
- `local_only` / `localOnly` 请求字段应该强制走本地 fallback。
- 小程序可能传入 `timeout_ms`，后端应在合理范围内尊重。
- Session 的 `current_cards` 驱动滑卡事件里的卡片查找，所以 session 响应里必须保留 cards。
- canonical swipe action 只有 `keep` 和 `dislike`；新产品后端不应把旧的 `skip`、`like`、`super_like` 写入用户滑卡事件。
