# Memory 合同

更新时间：2026-05-30

## 含义

Memory 是小汪“允许记住什么、如何使用这些记忆”的可审计产品账本。

## 权威归属

产品后端 memory service 是唯一权威。

OpenClaw 和小汪聊天可以提出候选记忆；当用户在当前对话里明确表达“确认、记住、修改、删除、暂停”等记忆操作意图时，OpenClaw 可以把自然语言理解成结构化 `memory_manage` 操作，由 LifePilot 后端执行。

后端不负责用关键词规则理解用户自然语言。后端只接收结构化记忆操作、做安全校验、写入权威账本和同步 Evermind。

Evermind 是外部记忆 provider，负责把已确认偏好或会话摘要转成可检索的外部记忆。它可以辅助 OpenClaw 和小汪理解跨会话上下文，但不能替代产品后端的 confirmed preferences。

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

P5 第三刀先只实现 deterministic rules：

- 餐后反馈里出现“太油/油腻/重油”等，生成重油负向候选。
- 出现“排队太久/等位太久”等，生成排队负向候选。
- 出现“太辣/过辣”等，生成辣度负向候选。
- 出现“太贵/不值/性价比低”等，生成预算负向候选。
- 出现“记住我喜欢吃面/多推荐面条”等，生成面食正向候选。

这一步不让 LLM 自动抽长期记忆，避免记忆污染。

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
- 问小汪聊天里的自然语言 CRUD 必须先由 OpenClaw agent 转成结构化 `memory_manage`，后端不根据用户原话做写操作。
- 敏感文本必须在持久化前被拒绝。
- 单次滑卡事件不能直接成为 confirmed preference。
- OpenClaw 推断出的记忆必须先进入 candidates；用户明确确认或明确要求记住的内容可以通过 `memory_manage` 写入 confirmed preference。
- Evermind 是外部记忆 provider，不是产品权威账本。
- 新增 confirmed preference、确认 candidate、更新 preference、删除 preference 时，后端默认尝试同步 Evermind。
- Evermind 未配置或同步失败时，不阻断本地 CRUD；同步状态写回 `preference.sync`，前端可展示“本地已保存 / 外部同步状态”。
- 请求体可传 `sync_evermind: false` 跳过本次外部同步，主要用于测试或离线调试。
- 饭点 finalize 后，后端默认写一条 Evermind session summary；它只表示本顿饭轨迹，不是长期偏好。

## 核心 API

```text
POST /api/memory/post-meal-feedback
GET  /api/memory/ledger
POST /api/memory/manage
GET  /api/memory/candidates
POST /api/memory/candidates/:id/confirm
POST /api/memory/candidates/:id/reject
GET  /api/memory/preferences
POST /api/memory/preferences
PATCH /api/memory/preferences/:id
DELETE /api/memory/preferences/:id
POST /api/memory/preferences/:id/pause
```

### Evermind 同步状态

`preference.sync` 目前使用这些状态：

| 状态 | 含义 | 是否影响本地记忆 |
| --- | --- | --- |
| `not_synced` | 还没有尝试同步 | 不影响 |
| `not_configured` | 没有配置 `EVERMIND_API_KEY` / `EVEROS_API_KEY` | 不影响 |
| `synced` | 已写入 Evermind | 不影响 |
| `failed` | 写入或替换失败 | 不影响 |
| `cleanup_required` | 新记忆已写入，但旧 Evermind 记忆删除失败 | 不影响 |
| `deleted` | 本地删除后，Evermind 对应记忆也已删除 | 不影响 |
| `delete_failed` | 本地删除成功，但 Evermind 删除失败 | 不影响 |
| `local_only_deleted` | 本地删除成功，原本没有 Evermind memory id | 不影响 |

`GET /api/memory/ledger` 会返回 provider 状态：

```json
{
  "provider_status": {
    "local": {"configured": true},
    "evermind": {
      "provider": "evermind",
      "configured": false,
      "base_url": "https://api.evermind.ai"
    }
  }
}
```

餐后反馈请求：

```json
{
  "user_id": "demo_weiyingru",
  "session_id": "meal_...",
  "offer_id": "off_...",
  "merchant_id": "m_...",
  "merchant_name": "福田口岸云吞面",
  "feedback_text": "这家太油了，下次别给我推这种。",
  "rating": 2
}
```

成功后只生成 pending candidate：

```json
{
  "ok": true,
  "created_count": 1,
  "candidates": []
}
```

如果带了 `session_id`，后端会把候选 id 写入对应 `day_context.memory_candidate_ids`，方便后续 OpenClaw dreaming 按天复盘。

确认候选后才创建 active confirmed preference。

### 自然语言汪记本操作

问小汪链路使用 `memory_manage` 执行结构化记忆操作：

```json
{
  "operation": "confirm_latest_pending",
  "user_id": "demo_weiyingru",
  "actor": "openclaw"
}
```

支持的 `operation`：

```text
list_memory
create_confirmed_preference
confirm_pending
confirm_latest_pending
reject_pending
update_preference
delete_preference
pause_preference
```

目标选择可以使用：

```json
{
  "target": {
    "candidate_id": "cand_...",
    "preference_id": "pref_...",
    "match_text": "排队久"
  }
}
```

规则边界：

- OpenClaw 负责理解“刚刚那条”“可以确认下来”“改成工作日中午少推排队久”等自然语言，并输出结构化操作。
- 后端只执行结构化操作；OpenClaw / Ark 失败后的本地 fallback 不执行写操作。
- `delete_preference` 使用 `forgotten` 状态，不物理删除记录。
- `sync_evermind: false` 可跳过本次外部同步。

## 推荐使用边界

P5 第四刀把已确认长期偏好接回 P2/P3；P5.8 增加 Evermind 弱上下文：

- P2 方向小结会读取 active confirmed preferences。
- P3 商户卡解释会读取 active confirmed preferences。
- P2/P3 会尝试检索 Evermind episodic/profile 作为弱上下文。
- pending candidates 不进入推荐、不进入 prompt，不会影响排序或解释。
- paused / forgotten preferences 不进入 recommendation context。
- Evermind 检索结果不能当作已确认偏好，不能直接影响硬筛选和权重排序。

推荐上下文只暴露精简字段：

```json
{
  "policy": "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context",
  "confirmed_preferences": [
    {
      "preference_id": "pref_...",
      "category": "food_oiliness",
      "polarity": "negative",
      "statement": "以后少推荐明显重油或油腻的餐食。",
      "confidence": 0.78
    }
  ],
  "evermind_weak_memories": []
}
```

API 响应的 meta 会带：

```json
{
  "memory_context": {
    "confirmed_preferences": 1,
    "evermind_memories": 0,
    "policy": "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context"
  }
}
```

这用于调试“是否只使用已确认记忆”。

## OpenClaw 边界

OpenClaw 可以：

- 请求 memory context
- 提交候选记忆
- 在用户明确授权时提交结构化 `memory_manage` 操作
- 提交互动摘要
- 请求后端记录 job evidence
- 通过后端接口读取 Evermind 检索结果或同步状态

OpenClaw 不能：

- 绕过 LifePilot 后端直接更新 confirmed preferences
- 绕过 LifePilot 后端直接删除产品 memory
- 绕过用户确认
- 直接把 Evermind 自动抽取出的 profile 当成产品 confirmed preference

后续可以放宽为：

```text
explicit_long_term_intent + confidence >= 0.9 + safe + no_conflict
→ auto_confirmed
```

但 P5 第三刀暂不实现自动确认；所有规则候选都需要确认。
