# OpenClaw Dreaming 合同

更新时间：2026-05-30

## 含义

OpenClaw dreaming 是小汪在后台做的离线复盘任务。

它不参与实时滑卡链路，也不是用户当前正在进行的 `meal_session`。

```text
meal_session = 一顿饭的实时决策
day_context = 一天内多个 meal_session / 小汪互动 / 推送 / 后台任务的索引
dream_job   = OpenClaw 对某个 day_context 的后台复盘
```

## 分工

后端负责事实证据包：

- 当天有哪些 meal session。
- 每顿饭的入口需求、方向滑卡、商家滑卡、最终选择。
- 餐后反馈、商户反馈。
- 已确认记忆和待确认候选。

OpenClaw 负责语义复盘：

- 判断哪些行为可能形成偏好。
- 区分短期状态、场景偏好和长期偏好候选。
- 检查是否和已有记忆冲突。
- 生成小汪后续互动建议。

## 权威边界

OpenClaw 可以提交：

- `summary`
- `memory_candidates`
- `preference_update_suggestions`
- `merchant_feedback_insights`
- `xiaowang_next_interaction_ideas`

OpenClaw 不能：

- 直接创建 confirmed preference。
- 直接修改、删除、暂停产品 memory。
- 直接修改 meal session。
- 直接发布推送、文章、游戏或互动卡片。
- 直接读写产品 runtime 文件。

所有 dream result 进入后端后都只是建议或候选。

## Dream Input API

```text
GET /api/openclaw/dream-input?user_id=demo_weiyingru&day_id=day_20260530_demo_weiyingru
```

如果不传 `day_id`，后端可以用 `date=YYYYMMDD` 和 `user_id` 推导：

```text
GET /api/openclaw/dream-input?user_id=demo_weiyingru&date=20260530
```

返回：

```json
{
  "ok": true,
  "dream_input": {
    "schema_version": "lifepilot.openclaw_dream_input.v1",
    "dream_id": "dream_...",
    "user_id": "demo_weiyingru",
    "day_id": "day_20260530_demo_weiyingru",
    "window": {
      "type": "day",
      "date": "20260530",
      "timezone": "Asia/Shanghai"
    },
    "policy": {
      "openclaw_role": "semantic_reviewer",
      "memory_authority": "lifepilot_backend",
      "may_create_confirmed_preferences": false,
      "may_modify_meal_session": false,
      "may_read_runtime_files": false
    },
    "confirmed_preferences": [],
    "pending_memory_candidates": [],
    "day_context": {},
    "meal_sessions": [],
    "merchant_feedback_summary": {},
    "xiaowang_interactions": [],
    "allowed_outputs": [
      "summary",
      "memory_candidates",
      "preference_update_suggestions",
      "merchant_feedback_insights",
      "xiaowang_next_interaction_ideas"
    ]
  }
}
```

## Meal Session Snapshot

Dream input 里的 meal session 不是完整 session 文件，只是受控快照。

```json
{
  "session_id": "meal_...",
  "meal_slot": "dinner",
  "status": "finalized",
  "stage": "final",
  "goal": "今天下班有点累，想吃热乎下饭的",
  "entry_form": {},
  "understanding": {},
  "direction_events": [],
  "offer_events": [],
  "direction_summary": {},
  "final_decision": {},
  "post_meal_feedback_candidates": []
}
```

默认不要把完整卡组塞给 OpenClaw。只有审计或 debug 任务才单独开更详细的 API。

## Dream Result API

```text
POST /api/openclaw/dream-result
```

请求：

```json
{
  "dream_id": "dream_...",
  "user_id": "demo_weiyingru",
  "day_id": "day_20260530_demo_weiyingru",
  "status": "completed",
  "summary": "今天主人更偏向热乎、有主食感、省心的晚饭。",
  "memory_candidates": [
    {
      "type": "food_preference",
      "category": "meal_context",
      "polarity": "positive",
      "statement": "主人在下班疲惫场景里更偏好热乎、有主食感、低决策成本的选择。",
      "confidence": 0.84,
      "evidence": [
        {
          "source": "meal_session",
          "session_id": "meal_...",
          "reason": "入口说下班累，保留热汤粉面，最终选择云吞面。"
        }
      ],
      "needs_confirmation": true
    }
  ],
  "xiaowang_next_interaction_ideas": [
    {
      "type": "proactive_message",
      "timing_hint": "next_dinner",
      "draft": "主人下次下班累的时候，小汪可以直接帮你走热乎主食路线。"
    }
  ]
}
```

响应：

```json
{
  "ok": true,
  "job": {
    "job_id": "dreamjob_...",
    "dream_id": "dream_...",
    "status": "completed",
    "accepted_memory_candidates": [],
    "stored_at": "2026-05-30T00:00:00.000Z"
  }
}
```

## Dream Job 查询

```text
GET /api/openclaw/jobs/:job_id
GET /api/openclaw/jobs/by-dream/:dream_id
```

## 实验性 OpenClaw Agent 触发

P5.6 增加一个本机实验接口，用于验证“LifePilot 后端触发 OpenClaw，OpenClaw 调用 skill，再提交回 LifePilot”的完整闭环。

```text
POST /api/openclaw/run-dream
```

请求：

```json
{
  "user_id": "demo_weiyingru",
  "day_id": "day_20260530_demo_weiyingru",
  "api_base": "http://host.docker.internal:4331",
  "timeout_seconds": 240,
  "local": false
}
```

后端会调用本机：

```bash
openclaw agent --agent main --json --message "..."
```

如果传 `local: true`，后端会调用：

```bash
openclaw agent --local --agent main --json --message "..."
```

本机闭环测试可以用 `local: true`，但这只表示 OpenClaw 使用 embedded/local runner；如果 OpenClaw 当前仍启用 `agents.defaults.sandbox.mode=all` 且 Docker sandbox 网络是 `none`，skill 里的 HTTP 请求仍然访问不到 LifePilot 后端。

因此完整闭环需要满足二选一：

- 临时关闭 OpenClaw sandbox：`agents.defaults.sandbox.mode=off`，跑完立即恢复。
- 保持 sandbox，但给 sandbox 配置可访问 LifePilot 后端的网络和最小 exec 权限。

已验证的本机闭环条件：

```text
OpenClaw sandbox.mode=off
LifePilot /api/openclaw/run-dream local=true
OpenClaw exec allowlist 允许 /usr/bin/python3
```

2026-05-30 验证结果：

```text
dream_id: dream_day_20260530_openclaw_local_user_1780132241131_724a80ce
job_id: dreamjob_1780132241136_5a69a63a
candidate_count: 0
total_ms: 108906
```

本次 `candidate_count=0` 是合理结果：测试数据只有一顿饭和一个下班疲惫场景信号，skill 按规则没有把单次临时状态提升为长期记忆候选。

OpenClaw agent 收到消息后应使用：

```bash
python3 skills/lifepilot-dreaming/scripts/run_dream.py --user-id ... --day-id ... --submit
```

这个接口只用于本机 demo / 调试，不作为生产稳定 API。

注意：

- 它依赖本机 OpenClaw Gateway 正在运行。
- 它依赖 OpenClaw main agent 的模型配置可用。
- OpenClaw sandbox 访问宿主机后端时通常需要使用 `host.docker.internal`，不是 `127.0.0.1`。
- 它可能比直接 Python skill 慢很多。
- 它的 stdout/stderr 会作为调试信息返回，不应暴露给真实用户。
- 如果连接失败，OpenClaw 不应启动 mock server 或伪造结果。

## 证据规则

- 单次滑卡不能直接成为长期偏好。
- 明确饭后反馈可以成为候选记忆证据。
- 多次 meal session 里的重复行为可以成为候选记忆证据。
- 当前状态和长期偏好必须区分，例如“今天想清淡”不能覆盖“平时喜欢重口”。
- 与已有 confirmed preference 冲突时，只能提交 `preference_update_suggestions`，不能直接覆盖。
- 所有记忆候选必须带 evidence。
- `confidence < 0.75` 的候选不应提交。

## 第一版实现范围

P5.5 只实现：

- dream input 受控快照。
- dream result 落盘。
- OpenClaw 提交的 memory candidates 保存为 pending。
- job 查询。
- smoke test。

暂不实现：

- 真实 OpenClaw cron。
- OpenClaw skill。
- 自动确认长期记忆。
- 推送发布。
