# Session API 合同

更新时间：2026-05-30

## 含义

`meal_session` 表示用户完成一次饭点决策的产品会话。

它是产品状态，不是 OpenClaw agent session。

## 归属

产品后端负责创建、修改、持久化和校验 meal session。

## 核心路由

```text
POST /api/session/start
POST /api/session/swipe
POST /api/session/advance
POST /api/session/finalize
GET  /api/session/:session_id
```

## 最小 Session 结构

```json
{
  "session_id": "sess_...",
  "user_id": "demo_weiyingru",
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

`direction_summary -> offer` 放到 P3。
