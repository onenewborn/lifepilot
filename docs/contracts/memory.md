# Memory 合同

更新时间：2026-05-30

## 含义

Memory 是小汪“允许记住什么、如何使用这些记忆”的可审计产品账本。

## 权威归属

产品后端 memory service 是唯一权威。

OpenClaw、Ark/Doubao 和小汪聊天都可以提出候选记忆，但不能直接写入权威长期偏好。

## 分层

```text
session_events
memory_candidates
confirmed_preferences
profile_summary
recommendation_context
```

## 候选记忆

```json
{
  "candidate_id": "memcand_...",
  "user_id": "demo_weiyingru",
  "type": "food_preference",
  "polarity": "negative",
  "statement": "不喜欢明显重油的餐食",
  "evidence": [
    {
      "source": "post_meal_feedback",
      "session_id": "sess_...",
      "text": "这家太油了，下次别推这种"
    }
  ],
  "confidence": 0.82,
  "status": "pending",
  "needs_confirmation": true,
  "created_at": "2026-05-30T00:00:00.000Z"
}
```

## 已确认偏好

```json
{
  "preference_id": "pref_...",
  "user_id": "demo_weiyingru",
  "category": "food_oiliness",
  "scope": "restaurant_recommendation",
  "statement": "不喜欢明显重油的餐食",
  "polarity": "negative",
  "strength": 0.8,
  "confidence": 0.82,
  "status": "active",
  "evidence_candidate_id": "memcand_...",
  "sync": {
    "provider": "evermind",
    "status": "not_configured",
    "memory_id": null
  },
  "created_at": "2026-05-30T00:00:00.000Z",
  "updated_at": "2026-05-30T00:00:00.000Z"
}
```

## CRUD 规则

- 查看、新增、更新、暂停、删除、确认、拒绝都是后端操作。
- 敏感文本必须在持久化前被拒绝。
- 单次滑卡事件不能直接成为 confirmed preference。
- OpenClaw 生成的记忆必须先进入 candidates。
- Evermind 是外部记忆 provider，不是产品权威账本。

## OpenClaw 边界

OpenClaw 可以：

- 请求 memory context
- 提交候选记忆
- 提交互动摘要
- 请求后端记录 job evidence

OpenClaw 不能：

- 直接更新 confirmed preferences
- 直接删除产品 memory
- 绕过用户确认
