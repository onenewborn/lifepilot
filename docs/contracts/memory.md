# Memory 合同

更新时间：2026-06-04

## 含义

Memory 是小汪“允许记住什么、如何使用这些记忆”的可审计产品账本。

LifePilot 后端 memory service 是记忆读写、状态校验和可审计记录的唯一权威。

## 权威归属

产品后端 memory service 是唯一权威。

OpenClaw、Ark 和小汪聊天可以提出候选记忆；当用户在当前对话里明确表达“确认、记住、修改、删除、暂停”等记忆操作意图时，agent 可以把自然语言理解成结构化 `memory_manage` 操作，由 LifePilot 后端执行。

后端不负责用自然语言猜长期偏好。后端只接收结构化记忆操作，做安全校验、状态校验、去重和本地落库。

## 存储分层

```text
meal_sessions
day_contexts
memory_observations
memory_candidates
confirmed_preferences
food_insight_profile
recommendation_signals
merchant_feedback
memory_intelligence_jobs
```

核心路径：

```text
data/runtime/meal_sessions/<session_id>.json
data/runtime/day_contexts/<day_id>.json
data/runtime/memory/users/<user_id>/memory_observations.json
data/runtime/memory/users/<user_id>/memory_candidates.json
data/runtime/memory/users/<user_id>/preferences.json
data/runtime/memory/users/<user_id>/food_insight_profile.json
data/runtime/memory/users/<user_id>/recommendation_signals.json
data/runtime/merchant_feedback/users/<user_id>/merchant_feedback.json
data/runtime/memory_intelligence_jobs/<job_id>.json
```

## 统一 Memory Intelligence

Reviewer 和 dreaming 统一为 LifePilot Memory Intelligence，只是触发窗口不同：

```text
instant_review   小汪聊天、餐后反馈、session finalize 后的即时 observation 审查
day_dreaming     日级复盘，兼容旧 openclaw dreaming
week_dreaming    跨天重复模式分析
profile_update   FCQ / food neophobia / reward profile 汪记本画像
signal_refresh   把长期记忆和画像转成推荐可执行 signals
```

当前阶段 day/week dreaming 只做手动触发，不注册 cron、systemd timer 或 OpenClaw heartbeat。

## 候选记忆

```json
{
  "candidate_id": "cand_...",
  "user_id": "demo_weiyingru",
  "type": "food_preference",
  "category": "food_oiliness",
  "polarity": "negative",
  "scope": "food",
  "statement": "主人不太喜欢明显重油或油腻的餐食。",
  "confirmation_text": "以后少推荐明显重油或油腻的餐食。",
  "evidence": [
    {
      "source": "post_meal_feedback",
      "session_id": "meal_...",
      "reason": "这家太油了，下次别推这种"
    }
  ],
  "confidence": 0.82,
  "status": "pending",
  "needs_confirmation": true
}
```

候选记忆不是长期记忆，不能进入快速推荐排序，也不能在文案中说成“小汪已经记住”。

## 已确认偏好

```json
{
  "preference_id": "pref_...",
  "user_id": "demo_weiyingru",
  "category": "food_oiliness",
  "scope": "food",
  "statement": "以后少推荐明显重油或油腻的餐食。",
  "polarity": "negative",
  "strength": -0.72,
  "confidence": 0.82,
  "status": "active",
  "source_candidate_id": "cand_..."
}
```

## CRUD 规则

- 查看、新增、更新、暂停、删除、确认、拒绝都是后端操作。
- 问小汪聊天里的自然语言 CRUD 必须先由 agent 转成结构化 `memory_manage`，后端不根据用户原话做写操作。
- 敏感文本必须在持久化前被拒绝。
- 单次滑卡事件不能直接成为 confirmed preference。
- Agent 推断出的记忆必须先进入 candidates。
- 用户明确确认或明确要求记住的内容可以通过 `memory_manage` 写入 confirmed preference。
- `delete_preference` 使用 `forgotten` 状态，不物理删除记录。

## 核心 API

```text
POST /api/memory/post-meal-feedback
GET  /api/memory/ledger
GET  /api/memory/search
POST /api/memory/manage
GET  /api/memory/candidates
POST /api/memory/candidates
POST /api/memory/candidates/:id/confirm
POST /api/memory/candidates/:id/reject
GET  /api/memory/preferences
POST /api/memory/preferences
PATCH /api/memory/preferences/:id
DELETE /api/memory/preferences/:id
POST /api/memory/preferences/:id/pause
GET  /api/memory/observations
POST /api/memory/observations
GET  /api/session/memory
GET  /api/memory/intelligence/input
POST /api/memory/intelligence/run
POST /api/memory/intelligence/result
GET  /api/memory/intelligence/jobs
```

## Phase 3 Agent API

这些接口给 OpenClaw / 小汪 agent 使用，返回 compact objects，不返回完整媒体、商户卡或长 prompt。

```text
GET /api/memory/search
```

按 `query` / `q`、`type`、`day_id`、`limit` 搜索记忆对象。

支持 type：

```text
all
preference / confirmed_preference
candidate / memory_candidate
observation / memory_observation
job / memory_intelligence_job
profile / food_insight_profile
```

```text
GET /api/session/memory
```

按 `session_id` 或 `day_id` 读取 compact session memory，包括饭点 session 摘要和 day context 里的小汪聊天摘要。支持 `query` 和 `limit`。

```text
POST /api/memory/observations
```

写入一条 observation。适合 agent 在对话、滑卡或汪记本分析后沉淀短期观察；默认 `review_status` 是 `pending_review`。

```text
POST /api/memory/candidates
```

写入一条待确认记忆候选。适合 agent 在用户表达长期偏好但尚未确认时使用；默认 `status` 是 `pending`，不会直接成为 confirmed preference。

## Session Finalize 边界

`POST /api/session/finalize` 表示 session final decision，不等于用户真实吃过该商户。

Finalize 会：

```text
写 session.result
更新 day_context
写 memory_observation
返回 local session_summary
```

Finalize 不会：

```text
直接写 confirmed preference
声称用户真实消费或真实评分
```

## 餐后反馈边界

当前前端还没有完整星级评分场景。后端保留：

```text
POST /api/memory/post-meal-feedback
```

它可以写 merchant_feedback 和 observation。是否生成长期候选，理想上应交给 agent / memory intelligence 判断；现有 deterministic rules 只作为 demo fallback。

## 推荐使用边界

P2/P3 推荐上下文只使用本地 active confirmed preferences 和本地 recommendation signals。

```json
{
  "policy": "local_active_confirmed_preferences_are_strong",
  "confirmed_preferences": [
    {
      "preference_id": "pref_...",
      "category": "food_oiliness",
      "polarity": "negative",
      "statement": "以后少推荐明显重油或油腻的餐食。",
      "confidence": 0.78
    }
  ]
}
```

规则：

- active confirmed preferences 可以进入推荐解释和 signals 派生。
- pending candidates 不进入推荐、不进入 prompt，不影响排序或解释。
- paused / forgotten preferences 不进入 recommendation context。
- 快速滑卡不实时搜索历史 session。
- 快速滑卡不调用 OpenClaw agent。

## OpenClaw / Agent 边界

Agent 可以：

- 请求 memory context。
- 搜索本地历史记忆和 session 摘要。
- 提交 observation。
- 提交 pending memory candidate。
- 在用户明确授权时提交结构化 `memory_manage` 操作。
- 提交 Memory Intelligence result。

Agent 不能：

- 绕过 LifePilot 后端直接更新 confirmed preferences。
- 绕过 LifePilot 后端直接删除产品 memory。
- 绕过用户确认。
- 直接修改 `data/runtime` 文件。

后续要补的 agent 工具以 `docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md` 为准，等 API 和 tool schema 定稿后再同步到 OpenClaw `TOOLS.md` / `BOOT.md`。
