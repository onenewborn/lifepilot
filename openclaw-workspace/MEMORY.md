# LifePilot Memory

## 当前定位

长期记忆的目标不是把用户每次滑卡都保存下来，而是让“饭点定了”逐渐更懂用户：

```text
用户餐前表达
→ 小程序滑卡行为
→ 餐后反馈
→ 记忆候选
→ 用户确认
→ confirmed preference
→ 下次推荐时解释性使用
```

当前不预写任何真实长期偏好。demo 用户信息必须明确标记为合成。

## 产品后端权威

当前新 LifePilot 产品后端位于：

```text
/opt/lifepilot
```

产品后端的 memory service 是权威记忆账本。

OpenClaw workspace 里的 `MEMORY.md` 只定义 agent 记忆规则，不存放权威产品记忆。

涉及 `meal_session`、`day_context`、`memory_candidates`、`confirmed_preferences`、商户反馈或记忆复盘时，OpenClaw 必须通过 LifePilot 后端 API 读写：

```text
GET  /api/memory/ledger
GET  /api/memory/candidates
GET  /api/memory/preferences
GET  /api/memory/intelligence/input
POST /api/memory/intelligence/result
POST /api/memory/intelligence/run
GET  /api/memory/intelligence/jobs
```

OpenClaw 不应直接读取或修改：

```text
/opt/lifepilot/data/runtime
```

除非用户明确要求做底层文件调试。

## Memory Intelligence 记忆边界

统一机制是 `skills/lifepilot-memory-intelligence/`。它可以根据 day_context、meal sessions、observations、pending candidates 和 confirmed preferences 做记忆复盘，但只能提交候选和建议。

可以提交：

- pending memory candidates
- preference update suggestions
- merchant feedback insights
- xiaowang next interaction ideas

不能直接提交：

- confirmed preference
- 已发布推送
- 已确认用户画像
- meal session 状态变更

所有 Memory Intelligence 产生的记忆都必须先进入后端 pending candidates，由产品后端和用户确认后才可能成为 confirmed preference。

## 统一记忆智能

统一记忆智能使用同一套 `lifepilot-memory-intelligence` 机制，只是 mode 不同：

```text
instant_review   单条 observation 的即时审查
manual_daily_review   日级 observations 和 meal sessions 复盘
manual_weekly_review  跨天重复模式分析
profile_update   FCQ / novelty / reward profile 更新
```

OpenClaw 负责语义分析；LifePilot 后端负责 policy gate、去重、敏感信息检查和落库。即使 demo 阶段 pending candidate 可以更积极展示，confirmed preference 仍必须由用户确认。

## 记忆分层

LifePilot memory v1 使用六层：

1. `session_events`：单次会话事件，例如入口需求、方向滑卡、Offer 滑卡、最终选择、餐后反馈。
2. `memory_observations`：短期观察、临时状态、弱假设和记忆智能审查结果。
3. `memory_candidates`：系统根据明确反馈或重复模式提出的待确认候选记忆。
4. `confirmed_preferences`：用户确认后才进入长期偏好。
5. `food_insight_profile`：FCQ / 新奇接受度 / reward profile，只用于汪记本展示。
6. `recommendation_context`：推荐时可读取的偏好、禁忌、解释依据和冲突提示。

旧脚本 `scripts/update_user_memory.py` 仍是当前最小可用实现；后续应逐步拆到 memory v1 结构，而不是无限扩成一个大脚本。

## 写入原则

允许进入长期记忆的内容必须满足：

- 有明确来源。
- 有用户表达或确认。
- 与本地生活推荐相关。
- 不包含真实敏感个人信息。
- 可被用户查看、修改、暂停和删除。

禁止直接写入长期记忆：

- 单次滑卡动作。
- 一次临时状态，例如“今天很累”“现在赶时间”。
- LLM 自己猜出来的偏好。
- 未经确认的餐后推断。
- 手机号、详细住址、订单号、支付信息、身份证等敏感信息。

## 问小汪即时记忆请求

当用户在问小汪里说“以后”“下次”“少推荐”“别再推荐”“多推荐”并表达长期偏好时，OpenClaw 应使用 `memory-capture` 生成待确认候选，而不是直接把它说成已经记住。

输出给 LifePilot 后端的 JSON 应包含 `memory_capture` skill call 或 `memory_prompts`，让产品后端创建 pending candidate 并由用户确认。用户确认前，回复语只能说“整理成待确认偏好”“等你确认后再长期记住”，不能说“我已经记住”。

## 餐后反馈规则

餐后负反馈可以生成候选记忆，但不能自动成为 confirmed preference。

例如：

```text
用户：这家太油了，下次别给我推这种。
```

可以生成：

```text
memory_candidate:
  type: food_preference
  polarity: negative
  statement: 不喜欢明显重油的餐食
  evidence: 用户餐后明确负反馈
```

然后小程序应询问用户是否记住。用户确认后，才写入 `confirmed_preferences`。

## 运行时路径

真实运行时长期记忆不应提交进 workspace git。

OpenClaw sandbox 中：

```text
/agent
  只读 workspace

/memory/users
  可写运行时记忆
```

宿主机持久目录：

```text
/Users/mona/.openclaw/lifepilot-memory/users
```

脚本应优先读取 `LIFEPILOT_MEMORY_ROOT`。在 sandbox 中应设置为：

```text
LIFEPILOT_MEMORY_ROOT=/memory/users
```

## 当前最小命令

回答“你对我了解什么/你记得我什么/我的画像是什么”之前，必须先读取运行时结构化记忆：

```bash
LIFEPILOT_MEMORY_ROOT=/memory/users python3 /agent/scripts/update_user_memory.py --user-id demo_weiyingru view
```

本机调试：

```bash
python3 scripts/update_user_memory.py --user-id demo_weiyingru view
```

明确记忆请求可以先作为事件写入：

```bash
python3 scripts/update_user_memory.py --user-id demo_weiyingru append-event --text '<用户原话>' --type memory_request --source openclaw_cli --pending
python3 scripts/update_user_memory.py --user-id demo_weiyingru process-pending --synthesize
```

具体菜系、口味、排队容忍度等偏好，优先用 patch 写入，保留审计动作：

```bash
python3 scripts/update_user_memory.py --user-id demo_weiyingru apply-patch --patch-json '<JSON patch>' --synthesize
```

删除或清空画像时不要直接删文件，使用脚本保留审计痕迹：

```bash
python3 scripts/update_user_memory.py --user-id demo_weiyingru forget-preference --preference-id pref_xxx --reason '<原因>' --synthesize
python3 scripts/update_user_memory.py --user-id demo_weiyingru clear-preferences --reason '<原因>' --synthesize
```
