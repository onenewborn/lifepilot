# Phase 5: Memory Intelligence Unification Plan

更新时间：2026-06-05

## 目标

Phase 5 的目标不是把接口名字换掉，而是把 LifePilot 的记忆加工能力统一成一条产品能力：

```text
Memory Intelligence = 小汪对用户行为、会话、滑卡和复盘材料做语义加工的统一系统
```

`Dreaming` 不再作为独立系统继续扩张。它在产品文案里可以继续叫“小汪复盘”或“小汪整理”，但工程主路径应收敛到 `memory_intelligence`。

## 产品定位

用户看到的是：

```text
汪记本手动复盘今天
汪记本手动复盘本周
小汪根据今天/本周行为生成小结、画像、候选记忆和下一次互动建议
```

用户不需要知道 `Dreaming`、`Memory Intelligence`、`local_policy`、`OpenClaw agent` 的区别。

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

## Phase 5A: 定义统一边界和可观测性

### 目标

把“Dreaming / Memory Intelligence 到底是什么”讲清楚，并建立每次后续改动必须验证的指标。

### 做什么

- 新增本文件，明确 Phase 5A/B/C。
- 明确命名：
  - 工程主名：`memory_intelligence`
  - 产品文案：`小汪复盘`、`今日复盘`、`本周复盘`
  - 兼容入口：`/api/openclaw/run-dream`
- 明确旧入口暂时只作为 adapter，不再新增独立 Dreaming 能力。
- 明确每阶段必须打印或记录：
  - input prompt 字符数
  - OpenClaw/Kimi 调用耗时
  - result parse 是否成功
  - 创建的候选记忆数量
  - food insight profile 是否更新
  - 汪记本展示是否符合预期

### 不做什么

- 不改 `/api/openclaw/run-dream` 行为。
- 不改汪记本按钮。
- 不改 OpenClaw skill。
- 不新增定时任务。

### 验证

本阶段是文档和验收边界，不改变运行行为。

需要执行：

```bash
npm run check
git diff -- docs/PHASE5_MEMORY_INTELLIGENCE_PLAN.md
```

验收标准：

```text
文档明确 Phase 5A/B/C
文档明确 Dreaming 是兼容入口，不是独立系统
文档明确每阶段需要真实测耗时和 prompt 长度
npm run check 通过
```

## Phase 5B: 输入压缩和 prompt 可观测性

### 目标

解决复盘经常 timeout 的直接原因：输入过长、不可观测、失败后不知道是 prompt 太大、模型慢还是解析失败。

### 做什么

- 为复盘输入增加 compact builder：

```text
buildMemoryIntelligenceCompactInput()
```

- 对 day review 只传压缩材料：

```text
今日小汪对话摘要
今日 meal session 摘要
滑卡保留/放弃摘要
最终确认或缺失状态
待确认记忆摘要
已确认偏好摘要
近期 food insight profile 摘要
```

- 不再把完整商户卡、完整 session JSON、完整 runtime 结构塞给 OpenClaw。
- 在 API result 或 job 里记录：

```json
{
  "input_metrics": {
    "char_count": 0,
    "section_counts": {},
    "estimated_tokens": 0
  },
  "timing": {
    "input_build_ms": 0,
    "agent_ms": 0,
    "store_ms": 0,
    "total_ms": 0
  }
}
```

### 目标阈值

先用字符数做工程阈值，不引入 tokenizer 依赖：

```text
manual_daily_review input <= 60k chars
manual_weekly_review input <= 80k chars
profile_update input <= 50k chars
```

如果超过阈值，后端应继续压缩，而不是直接把超长输入丢给模型。

### 验证

需要真实跑：

```bash
node tests/smoke-memory-intelligence.mjs
curl -s 'http://110.42.208.125/api/memory/intelligence/input?user_id=demo_weiyingru&mode=day_dreaming' | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(s.length))'
```

本地或云端手动复盘至少跑 3 次：

```text
记录每次 input char_count
记录每次 total_ms
记录 parse 是否成功
记录 candidate_count
```

验收标准：

```text
输入长度可见
耗时可见
连续 3 次手动 day review 不 timeout
失败时能区分 input_not_found / agent_timeout / parse_failed / store_failed
汪记本仍能显示今日小结、食物选择画像和待确认记忆
```

## Phase 5C: 接口收拢和兼容入口变薄

### 目标

把 `/api/openclaw/run-dream` 从主逻辑入口变成兼容 adapter，真实主路径收敛到：

```text
POST /api/memory/intelligence/run
```

### 做什么

- 新增或完善 mode 命名：

```text
manual_daily_review
manual_weekly_review
session_reflection
profile_update
signal_refresh
```

- `/api/openclaw/run-dream` 内部映射为兼容 adapter：

```text
/api/openclaw/run-dream
-> runMemoryIntelligence({ mode: "manual_daily_review", engine })
```

`engine` 是统一入口的执行引擎字段，不等于旧接口名称：

```text
local_policy      当前已接入，后端规则复盘
openclaw_agent    可请求，但本阶段只记录 requested_engine，并明确 fallback 到 local_policy
ark               可请求，但本阶段只记录 requested_engine，并明确 fallback 到 local_policy
```

也就是说，Phase 5C 只完成接口收拢和可观测 fallback，不假装 OpenClaw/Ark 复盘引擎已经接入。

- 保留旧 response 字段，避免前端马上大改：

```text
dream_id
candidate_count
job_id
summary
```

- 新 response 同时返回统一字段：

```text
memory_intelligence_job
mode
engine
input_metrics
timing
```

### 不做什么

- 不删除旧接口。
- 不删除旧 skill。
- 不接入真正的 OpenClaw/Ark 复盘执行器。
- 不做 cron 自动触发。
- 不把 confirmed preference 交给 agent 直接写。

### 验证

需要同时测旧入口和新入口：

```bash
curl -s -X POST http://110.42.208.125/api/openclaw/run-dream \
  -H 'content-type: application/json' \
  -d '{"user_id":"demo_weiyingru","day_id":"day_YYYYMMDD_demo_weiyingru","transport":"gateway_client"}'

curl -s -X POST http://110.42.208.125/api/memory/intelligence/run \
  -H 'content-type: application/json' \
  -d '{"user_id":"demo_weiyingru","mode":"manual_daily_review","day_id":"day_YYYYMMDD_demo_weiyingru","engine":"openclaw_agent"}'
```

`engine=openclaw_agent` 的预期结果：

```text
requested_engine=openclaw_agent
engine=local_policy
fallback_reason=openclaw_agent_engine_not_connected_yet
```

至少跑：

```text
旧 run-dream 2 次
新 memory/intelligence/run 3 次
汪记本手动复盘 2 次
```

记录：

```text
input char_count
total_ms
agent_ms
parse_success_rate
candidate_count
profile_updated
diary display result
```

验收标准：

```text
旧入口可用，但内部不再维护独立 Dreaming 主逻辑
新入口可用
汪记本手动复盘可用
连续多次不出现 dream_result_parse_failed
日志或 job 文件能看出 prompt 长度和耗时
```

## 后续阶段，不属于 Phase 5

以下都不在 Phase 5 做：

```text
cron 周期复盘
主动推送
systemd timer
复杂 embedding / vector search
推荐 signals 的完整在线学习
商户反馈闭环 UI
```

这些应拆到后续独立阶段，避免 Phase 5 失控。

## 当前建议执行顺序

```text
Phase 5A: 文档和验收边界
Phase 5B: 输入压缩 + prompt 长度/耗时可观测
Phase 5C: 接口收拢 + run-dream adapter
```

每完成一个阶段，只验证该阶段，不提前做下一阶段。
