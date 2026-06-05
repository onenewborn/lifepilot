# Session API 合同

更新时间：2026-05-30

## 含义

`meal_session` 表示用户完成一次饭点决策的产品会话。

它是产品状态，不是 OpenClaw agent session。

一次 `meal_session` 对应一顿饭，不对应一天，也不对应一次 OpenClaw 运行。

```text
meal_session = 入口需求 + 位置 + 方向滑卡 + 商家滑卡 + 最终选择 + 餐后反馈
day_context  = 同一天的多个 meal_session + 小汪互动 + 推送互动 + 记忆加工任务结果
```

Memory Intelligence 按 `day_context` 做手动日/周复盘，但实时推荐主链路只操作当前 `meal_session`。

## 归属

产品后端负责创建、修改、持久化和校验 meal session。

前端刷新后不应重新开始一顿饭；应从本地 storage 取回 `session_id`，调用：

```text
GET /api/session/:session_id
```

如果后端返回 200，继续当前饭点流程；如果返回 `session_not_found`、`expired` 或 `finalized`，前端再创建新的 meal session。

## 持久化

P5 第一刀使用 JSON 文件持久化 meal session：

```text
data/runtime/meal_sessions/<session_id>.json
data/runtime/day_contexts/<day_id>.json
```

`data/runtime/` 是运行时目录，不提交 git。生产环境可通过：

```text
LIFEPILOT_RUNTIME_ROOT=/path/to/runtime
```

指定持久化目录。

当前实现是“内存缓存 + JSON 落盘”：

- 读取：优先内存，内存没有时读 JSON 文件。
- 写入：start、swipe、advance、finalize 都会落盘。
- 每次 meal session 写入后，同步更新当天 `day_context` 的 session 摘要索引。
- 后续如果并发写入变多，再迁移 SQLite。

## 核心路由

```text
POST /api/session/start
POST /api/session/swipe
POST /api/session/advance
POST /api/session/finalize
GET  /api/session/:session_id
GET  /api/day-context/:day_id
```

## 最小 Session 结构

```json
{
  "schema_version": "lifepilot.meal_session.v1",
  "session_id": "sess_...",
  "user_id": "demo_weiyingru",
  "day_id": "day_20260530_demo_weiyingru",
  "meal_slot": "dinner",
  "status": "active",
  "stage": "direction",
  "next_step": "swipe_food_directions",
  "goal": "今晚想找一顿合适的饭",
  "entry_form": {},
  "understanding": {
    "constraints": {},
    "requirements": [],
    "missing_info": [],
    "confidence": 0.7,
    "assistant_text": "",
    "parse_mode": "local_fallback",
    "timing": {}
  },
  "direction_events": [],
  "offer_events": [],
  "direction_summary": null,
  "current_cards": [],
  "result": null,
  "synthetic_only": true,
  "created_at": "2026-05-30T00:00:00.000Z",
  "updated_at": "2026-05-30T00:00:00.000Z"
}
```

`status` 合法值：

```text
active
finalized
abandoned
expired
```

P5 第一刀只自动写 `active` 和 `finalized`；`abandoned/expired` 后续再补。

## Day Context

`day_context` 是 Memory Intelligence 读取的日级索引，不是实时推荐状态机。

它只保存当天各类活动的索引和摘要，不复制完整 session，避免状态双写不一致。

```json
{
  "schema_version": "lifepilot.day_context.v1",
  "day_id": "day_20260530_demo_weiyingru",
  "user_id": "demo_weiyingru",
  "date": "20260530",
  "timezone": "Asia/Shanghai",
  "meal_sessions": [
    {
      "session_id": "meal_...",
      "meal_slot": "dinner",
      "status": "finalized",
      "stage": "final",
      "goal": "今晚想找一顿合适的饭",
      "direction_event_count": 4,
      "offer_event_count": 3,
      "final_offer_id": "off_...",
      "final_merchant_id": "m_...",
      "final_merchant_name": "福田口岸云吞面",
      "created_at": "",
      "updated_at": "",
      "finalized_at": ""
    }
  ],
  "xiaowang_chat_sessions": [],
  "push_interactions": [],
  "background_jobs": [],
  "memory_candidate_ids": []
}
```

查询：

```text
GET /api/day-context/:day_id
```

如果不存在，返回 `day_context_not_found`。

Memory Intelligence 只能读取 `day_context` 和相关 session，输出 memory candidate 或 job result，不能直接修改 meal session。

## 滑卡事件结构

```json
{
  "event_id": "evt_...",
  "session_id": "sess_...",
  "round": "direction",
  "action": "keep",
  "card_id": "dir_hot_soup_noodles",
  "direction_id": "dir_hot_soup_noodles",
  "offer_id": null,
  "merchant_id": null,
  "title": "热汤粉面",
  "tags": [],
  "dwell_ms": 1200,
  "created_at": "2026-05-30T00:00:00.000Z"
}
```

## 合法滑卡动作

产品只有两个滑动动作：

```text
keep     右滑保留
dislike  左滑放弃
```

`super_like` 不属于饭点卡流动作。用户非常喜欢某个方向时，应通过“看这个方向的店”这类独立意图/路由推进，而不是写入 `direction_events`。

`skip` 不属于用户滑卡动作。P1 后端不应把 `skip` 写入事件账本。

## OpenClaw 边界

OpenClaw 可以通过 OpenClaw bridge API 读取 session 摘要。

OpenClaw 不能直接修改 meal session 状态。

## 卡片不存在

如果 `/api/session/swipe` 找不到请求里的 `card_id` / `direction_id` / `offer_id` / `merchant_id` 对应的当前卡片，后端必须返回：

```json
{
  "ok": false,
  "error": {
    "code": "card_not_found"
  }
}
```

后端不能写入 swipe event。

前端收到 `card_not_found` 时不应中断饭点流程；应静默刷新当前 session/card stack，必要时给轻提示，例如：

```text
这张卡已更新，已为你刷新
```

## P2 Advance 状态机

P2 只实现这一段状态转移：

```text
direction -> direction_summary
```

请求：

```text
POST /api/session/advance
```

成功后：

```text
session.stage = "direction_summary"
session.next_step = "confirm_direction_summary"
session.direction_summary.summary_text 存在
session.current_cards = []
```

如果 session 不在 `direction` 阶段，返回：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_session_transition"
  }
}
```

## P3 Advance 状态机

P3 新增第二段状态转移：

```text
direction_summary -> offer
```

成功后：

```text
session.stage = "offer"
session.next_step = "swipe_food_offers"
session.current_cards = offer cards top10
session.offer_payload_meta 存在
```

如果 session 不在 `direction` 或 `direction_summary` 阶段，返回 `invalid_session_transition`。

## P3 Finalize

请求：

```text
POST /api/session/finalize
```

P3 只支持从 `offer` 阶段 finalize。

成功后：

```text
session.stage = "final"
session.next_step = "done"
session.result.primary 存在
session.result.alternatives 最多 2 个
```
