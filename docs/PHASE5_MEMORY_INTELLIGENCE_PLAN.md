# Phase 5: Memory Intelligence Unification Plan

更新时间：2026-06-05

## 目标

Phase 5 的目标是把 LifePilot 的记忆加工能力统一成一条产品能力：

```text
Memory Intelligence = 小汪对用户行为、会话、滑卡、餐后反馈和汪记本复盘材料做语义加工的统一系统
```

工程主路径统一为：

```text
POST /api/memory/intelligence/run
GET  /api/memory/intelligence/input
POST /api/memory/intelligence/result
GET  /api/memory/intelligence/jobs
```

产品文案仍然可以叫“小汪复盘”“今日复盘”“本周复盘”，但代码、接口、skill 和文档都使用 Memory Intelligence。

## 产品定位

用户看到的是：

```text
汪记本手动复盘今天
汪记本手动复盘本周
小汪根据今天/本周行为生成小结、画像、候选记忆和下一次互动建议
```

用户不需要知道 `memory_intelligence`、`local_policy`、`openclaw_agent` 的区别。

产品输出统一为：

```text
daily_summary
weekly_summary
food_insight_profile
weak_hypotheses
memory_candidates
preference_update_suggestions
recommendation_signals
next_interaction_ideas
```

当前阶段不做 cron、heartbeat 或 systemd timer。当天复盘和每周复盘先保持手动触发。

## 工程原则

- GitHub main 是准源。
- 本地 `/Users/mona/Documents/lifepilot` 做产品后端和前端代码。
- 云端 `/opt/lifepilot` 只负责运行后端，改完后从 GitHub pull。
- 云端 `/root/.openclaw/workspace` 是 OpenClaw 真实运行 workspace。
- `openclaw-workspace/` 是交付快照，不等于云端实时 workspace。

## 当前模式

```text
instant_review        小汪聊天、餐后反馈、session finalize 后的即时 observation 审查
manual_daily_review   日级复盘，合并当天饭点、小汪聊天和 observations
manual_weekly_review  多日复盘，发现跨天重复模式
profile_update        FCQ / food neophobia / reward profile 汪记本画像
signal_refresh        把长期记忆和画像转成推荐可执行 signals
```

## Engine 策略

```text
local_policy      后端快速规则复盘，低延迟兜底
openclaw_agent    通过常驻 OpenClaw Gateway client 做深度复盘
ark               保留为后续可选引擎，当前未接入
```

外部 engine 失败、超时或输出不合法时，后端不会让汪记本直接 failed，而是 fallback 到 `local_policy`，并在 job 中记录：

```text
requested_engine
engine
fallback_reason
engine_run
timing.agent_ms
input_metrics
```

## 汪记本读取逻辑

汪记本只读取 Memory Intelligence job：

```text
memory_intelligence_jobs
```

没有当天 job 时，才使用当前 day_context 和记忆账本生成规则摘要。旧的独立复盘 job 账本和接口不再作为产品读取来源。

## 验证

本地：

```bash
npm run check
node tests/smoke-memory-intelligence.mjs
node tests/smoke-session.mjs
```

云端：

```bash
curl -s -X POST http://110.42.208.125/api/memory/intelligence/run \
  -H 'content-type: application/json' \
  -d '{"user_id":"demo_weiyingru","day_id":"day_20260605_demo_weiyingru","mode":"manual_daily_review","engine":"local_policy"}'

curl -s 'http://110.42.208.125/api/xiaowang/diary?user_id=demo_weiyingru&compact=1'
```

验收标准：

```text
新入口可用
汪记本手动复盘可用
汪记本 daily_summary.source 为 memory_intelligence 或 rule
job 文件能看出 input_metrics、timing、engine_run
OpenClaw engine 超时时有 fallback_reason，不让前端直接 failed
```
