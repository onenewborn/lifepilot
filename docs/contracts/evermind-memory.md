# Evermind 记忆接入合同

更新时间：2026-05-30

## 定位

LifePilot 后端是记忆权威，Evermind 是外部记忆 provider。

也就是说：

- 用户真正确认过的长期偏好，存在 LifePilot 的 `confirmed_preferences`。
- OpenClaw dreaming、小汪聊天、餐后反馈只能提出候选记忆，默认不能直接写长期偏好。
- Evermind 可以保存和检索外部记忆，用来帮助理解跨会话规律，但它的自动 profile / episodic 结果不能直接当成本地 confirmed preference。

## 当前 P5.8 范围

本阶段只做 confirmed preference 的外部同步最小闭环：

| LifePilot 操作 | Evermind 操作 |
| --- | --- |
| `POST /api/memory/preferences` | 默认 add + flush |
| `POST /api/memory/candidates/:id/confirm` | 默认 add + flush |
| `PATCH /api/memory/preferences/:id` | 有旧 memory id 时 replace；没有旧 id 时 add |
| `DELETE /api/memory/preferences/:id` | 有旧 memory id 时 delete；没有旧 id 时只标本地删除 |
| `POST /api/memory/preferences/:id/pause` | 暂不改 Evermind，只让本地推荐上下文不再使用 |
| `POST /api/session/finalize` | 写入一条饭点 session summary，标记 `confirmed_preference=false` |

如果请求体传 `sync_evermind: false`，本次操作只写本地。

如果 session finalize 请求体传 `sync_evermind_session: false`，本次饭点摘要不写 Evermind。

## 同步内容

同步到 Evermind 的内容是“已确认偏好”的摘要，不是完整用户隐私档案：

```text
LifePilot confirmed preference: 以后少推荐明显重油或油腻的餐食。
Category: food_oiliness
Polarity: negative
Scope: food
Confidence: 0.78
Evidence: 这家太油了，下次别给我推这种。
This is a user-confirmed LifePilot preference. LifePilot backend remains the source of truth.
```

metadata 会包含：

```json
{
  "lifepilot_preference_id": "pref_...",
  "lifepilot_user_id": "demo_weiyingru",
  "lifepilot_category": "food_oiliness",
  "lifepilot_operation": "candidate_confirm",
  "source_candidate_id": "cand_...",
  "confirmed_preference": true
}
```

## 失败策略

Evermind 失败不影响本地记忆。

原因是前端推荐、滑卡、小汪解释都必须首先相信 LifePilot 后端的本地账本。Evermind 只是增强检索和跨会话理解，一旦网络、权限、429、超时或格式变动导致同步失败，产品链路仍然继续。

同步结果写入 `preference.sync`：

```json
{
  "provider": "evermind",
  "evermind_memory_id": null,
  "sync_status": "not_configured",
  "last_synced_at": null,
  "last_sync_error": "EVEROS_API_KEY or EVERMIND_API_KEY is not configured"
}
```

## 检索使用边界

P5.8 起，方向小结和商户解释会尝试检索 Evermind：

```json
{
  "memory_context": {
    "confirmed_preferences": 1,
    "evermind_memories": 3,
    "policy": "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context"
  }
}
```

使用规则：

- 本地 active confirmed preferences 是强依据，可以影响解释和排序。
- Evermind 检索结果只作为弱上下文，帮助小汪理解最近场景和跨会话线索。
- Evermind 结果不能直接写成“主人已确认喜欢/讨厌……”。
- 如果 Evermind 未配置、超时、429 或返回异常，主链路继续，`evermind_warning` 仅用于调试。

## 饭点摘要写入

饭点 finalize 后，后端会向 Evermind 写一条 session/episodic summary：

```text
LifePilot meal session memory.
Session: sess_...
User goal: 今晚一个人吃，预算 50 内，不想太油。
Kept food directions this round: 热汤粉面、川湘小炒
Disliked food directions this round: 椰子鸡、轻食沙拉
Final primary recommendation: xxx · 招牌云吞面
This is session/episodic context only. It is not a confirmed long-term preference unless the user explicitly confirms it.
```

这条摘要是“当天/本顿饭发生了什么”，不是长期偏好。后续 OpenClaw dreaming 可以结合最近几天摘要和本地 confirmed preferences 生成新的候选记忆。

## 环境变量

```text
EVERMIND_API_KEY=
EVEROS_API_KEY=
EVERMIND_API_BASE_URL=https://api.evermind.ai
EVEROS_API_BASE_URL=https://api.evermind.ai
```

`EVEROS_*` 和 `EVERMIND_*` 都支持；如果两者同时存在，当前代码优先读 `EVEROS_*`。

## 后续边界

后续可以继续接三件事：

1. OpenClaw dreaming 产出的日总结同步到 Evermind，作为更高层的 episodic context。
2. 小汪聊天写入 Evermind session memory，但必须标记 `confirmed_preference=false`。
3. 对 Evermind 检索结果做去重和摘要压缩，避免把太多外部上下文塞进 prompt。
