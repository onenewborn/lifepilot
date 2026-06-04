# LifePilot Memory System Implementation Plan

更新时间：2026-06-04

## 1. 目标

把 LifePilot 记忆系统从当前的 OpenClaw Dreaming、Memory Intelligence、Evermind、后端规则混合状态，收束成一个清晰、可实现、可向评委解释的架构：

```text
LifePilot 本地 JSON 账本 = 唯一记忆权威
Memory Intelligence = 统一记忆加工系统
OpenClaw / Ark / local_policy = Memory Intelligence 的执行器
Agent tools = 通过后端 API 读写结构化记忆
Recommendation Signals = 快速滑卡链路使用的机器可执行记忆
Evermind = 当前比赛版本移除
```

核心原则：

```text
Agent 负责理解和提出记忆
后端负责校验和落库
用户确认后才成为长期记忆
快速推荐不实时翻历史，只读加工好的 signals
慢链路对话、复盘、汪记本可以让 agent 按需搜索历史
```

当前复盘触发原则：

```text
day_dreaming 和 week_dreaming 当前先做手动触发
不在本阶段注册 cron、systemd timer 或 OpenClaw heartbeat
等手动复盘、输入压缩、结果落库和前端展示全部稳定后，再单独设计定期触发
```

## 2. 当前问题

### 2.1 系统概念半合并

现在代码里同时存在两套入口：

```text
OpenClaw Dreaming
- /api/openclaw/dream-input
- /api/openclaw/run-dream
- /api/openclaw/dream-result
- openclaw-workspace/skills/lifepilot-dreaming

Memory Intelligence
- /api/memory/intelligence/input
- /api/memory/intelligence/run
- /api/memory/intelligence/result
- /api/memory/intelligence/jobs
- openclaw-workspace/skills/lifepilot-memory-intelligence
```

产品概念上已经希望把 dreaming 归入 Memory Intelligence，但工程实现上还没有完全收口。

### 2.2 Evermind 增加了不必要复杂度

当前文档和代码仍把 Evermind 作为外部记忆 provider：

```text
confirmed preference 同步 Evermind
session finalize 写 Evermind summary
推荐解释读取 Evermind weak memories
```

但比赛交付不需要外部 provider。它会带来：

```text
外部服务失败风险
记忆权威边界不清
prompt 里多一层 weak memory 解释
代码和文档复杂度上升
```

当前决定：比赛版本移除 Evermind 主链路。

### 2.3 后端仍有自然语言规则兜底

例如餐后反馈里出现“太油”“排队久”“太辣”“喜欢吃面”，后端会用关键词生成 memory candidate。这可以保留为 demo fallback，但不能作为主设计。

主设计应是：

```text
Agent / Ark / OpenClaw 理解自然语言
-> 输出结构化操作
-> 后端校验后落库
```

### 2.4 Session 记忆和长期记忆边界不清

需要明确：

```text
session memory = 发生过什么
long-term memory = 用户确认过什么
weak hypotheses = 系统猜测但未确认
food insight profile = 画像摘要
recommendation signals = 快速推荐可执行信号
```

## 3. 目标架构

### 3.1 记忆分层

```text
Raw Evidence
- 用户对话
- 滑卡行为
- session final decision
- 餐后反馈
- 商户反馈
- 小汪互动
- 日/周复盘输入

Memory Artifacts
- memory_observations
- weak_hypotheses
- memory_candidates
- confirmed_preferences
- food_insight_profile
- recommendation_signals
- next_interaction_ideas

Execution
- 问小汪对话
- 滑卡第一阶段
- 滑卡第二阶段
- 商户解释文案
- 汪记本
- 主动追问
```

### 3.2 快慢链路分离

慢链路可以用 agent 按需读取历史：

```text
问小汪对话
主动追问
汪记本分析
日复盘
周复盘
复杂记忆管理
```

快链路不能实时翻历史：

```text
方向卡
商户排序
商户解释
```

快链路只读取：

```text
current session constraints
confirmed_preferences 摘要
recommendation_signals
food_insight_profile 摘要
```

## 4. 存储设计

统一以 `data/runtime` 下的本地 JSON 为权威。

```text
data/runtime/meal_sessions/<session_id>.json
```

饭点 session 事实，包括入口、滑卡事件、最终推荐、状态。

```text
data/runtime/day_contexts/<day_id>.json
```

每日索引，包含 meal sessions、小汪聊天、memory candidate ids、background jobs。

```text
data/runtime/memory/users/<user_id>/memory_observations.json
```

可被复盘和 agent 分析的观察证据。

```text
data/runtime/memory/users/<user_id>/memory_candidates.json
```

待确认记忆候选。

```text
data/runtime/memory/users/<user_id>/preferences.json
```

用户确认过的长期记忆，唯一权威。

```text
data/runtime/memory/users/<user_id>/food_insight_profile.json
```

食物选择画像，用于汪记本展示和轻量软辅助。

```text
data/runtime/memory/users/<user_id>/recommendation_signals.json
```

快速滑卡排序可执行信号。

```text
data/runtime/merchant_feedback/users/<user_id>/merchant_feedback.json
```

商户体验反馈。

```text
data/runtime/memory_intelligence_jobs/<job_id>.json
```

Memory Intelligence job 结果。

## 5. 移除 Evermind 存储依赖

当前版本不再调用 Evermind：

```text
不再同步 confirmed preference 到 Evermind
不再在 session finalize 时写 Evermind summary
不再在推荐解释中读取 Evermind weak memories
不再在 memory ledger 中暴露 Evermind provider status
```

`preference.sync` 可以暂时保留本地字段以兼容旧数据，但产品展示和新写入不再依赖外部同步状态。

## 6. 后端 API 设计

### 6.1 Agent 读工具

```text
GET /api/memory/search
```

给 agent 搜索本地记忆和 session 摘要。

建议输入：

```json
{
  "user_id": "demo_weiyingru",
  "query": "川菜 太油 排队",
  "types": ["preferences", "observations", "sessions", "candidates"],
  "limit": 8
}
```

建议返回：

```json
{
  "ok": true,
  "results": [
    {
      "type": "preference",
      "id": "pref_xxx",
      "summary": "以后少推荐明显重油或油腻的餐食。",
      "evidence": []
    }
  ]
}
```

```text
GET /api/session/memory
```

给 agent 读取压缩 session 记忆，不返回完整商户卡和媒体字段。

建议输入：

```json
{
  "user_id": "demo_weiyingru",
  "lookback_days": 7,
  "query": "川菜"
}
```

返回 compact session summaries。

### 6.2 Agent 写工具

```text
POST /api/memory/observations
```

写 observation。

```json
{
  "user_id": "demo_weiyingru",
  "day_id": "day_20260604_demo_weiyingru",
  "source": "xiaowang_chat",
  "type": "explicit_memory_prompt",
  "text": "用户说以后少推荐排队久的店",
  "summary": "主人表达了排队规避偏好",
  "confidence": 0.78,
  "evidence": []
}
```

```text
POST /api/memory/candidates
```

写 pending candidate。

```json
{
  "user_id": "demo_weiyingru",
  "category": "queue",
  "polarity": "negative",
  "scope": "food",
  "statement": "主人不太能接受饭点排队或等位太久的店。",
  "confirmation_text": "以后少推荐饭点排队或等位太久的店。",
  "confidence": 0.82,
  "evidence": [
    {
      "source": "user_message",
      "reason": "用户说以后少推荐排队久的店"
    }
  ]
}
```

```text
POST /api/memory/manage
```

确认、修改、暂停、删除长期记忆。

支持 operation：

```text
list_memory
create_confirmed_preference
confirm_pending
confirm_latest_pending
reject_pending
update_preference
pause_preference
delete_preference
```

```text
POST /api/memory/intelligence/result
```

提交 Memory Intelligence 结果。

允许提交：

```text
observations
weak_hypotheses
memory_candidates
preference_update_suggestions
food_insight_profile
recommendation_signals
xiaowang_next_interaction_ideas
```

后端负责：

```text
schema 校验
敏感信息检查
去重
状态检查
写入对应 JSON
```

## 7. Agent Tool 设计

OpenClaw 工具分两层：

```text
Skill 文档：告诉 agent 什么时候用、输出什么结构
Python 脚本：调用后端 API 的包装器
后端 API：真正的数据权威
```

不要让 agent 直接写：

```text
data/runtime/*.json
```

必备工具：

```text
memory_search
session_memory_read
memory_observation_create
memory_candidate_create
memory_manage
memory_intelligence_submit
```

Agent 可以：

```text
搜索历史
读取 session 摘要
提出候选
提出更新建议
生成 signals
生成 next interaction ideas
```

Agent 不能：

```text
绕过用户确认直接创建 confirmed preference
直接修改 runtime JSON
直接把 weak hypothesis 当成 confirmed preference
直接让外部 provider 成为权威
```

## 8. Memory Intelligence 设计

Memory Intelligence 是唯一记忆加工系统。

```text
POST /api/memory/intelligence/run
```

支持模式：

```text
instant_review
day_dreaming
week_dreaming
profile_update
signal_refresh
```

支持执行器：

```text
local_policy
ark
openclaw_agent
```

### 8.1 instant_review

输入：单条 observation 或小窗口对话。

输出：

```text
observation review
weak hypothesis
memory candidate
```

### 8.2 day_dreaming

输入：当天 compact day context、compact sessions、observations、pending candidates、confirmed preferences。

输出：

```text
daily summary
memory candidates
preference update suggestions
next interaction ideas
```

触发方式：

```text
当前阶段只通过汪记本“复盘”按钮、后台调试接口或手动 API 调用触发
不做自动定时触发
```

### 8.3 week_dreaming

输入：近 7 天 summaries 和 compact sessions。

输出：

```text
weekly summary
cross-day weak hypotheses
memory candidates
profile suggestions
```

触发方式：

```text
当前阶段只提供手动触发入口
不做每周 cron
不做 systemd timer
不做 OpenClaw heartbeat
等文档、接口、输入压缩、展示口径稳定后，再把定期复盘作为独立任务设计
```

### 8.4 profile_update

输入：observations、confirmed preferences、session summaries。

输出：

```text
food_insight_profile
```

### 8.5 signal_refresh

输入：

```text
confirmed_preferences
food_insight_profile
selected weak_hypotheses
```

输出：

```text
recommendation_signals
```

### 8.6 执行器策略

```text
local_policy
```

只做兜底，不作为主智能。

```text
ark
```

轻量语义解析，适合 instant review 和 signal refresh。

```text
openclaw_agent
```

深度复盘，适合 day/week dreaming 和汪记本复杂分析。

## 9. Recommendation Signals 设计

Signals 可以来自：

```text
confirmed_preferences
food_insight_profile
selected weak_hypotheses
manual system rules
```

但快推荐使用时必须已经结构化。

建议 schema：

```json
{
  "signal_id": "sig_pref_xxx_avoid_queue",
  "source_type": "confirmed_preference",
  "source_id": "pref_xxx",
  "status": "active",
  "category": "queue",
  "polarity": "negative",
  "confidence": 0.82,
  "strength": -0.68,
  "target": {
    "entity": "merchant",
    "field": "merchant.queue_risk",
    "operator": "in",
    "values": ["high"]
  },
  "score_delta": -6,
  "reason": "长期记忆：主人不太能接受饭点排队或等位太久的店。"
}
```

快速推荐读取规则：

```text
第一阶段方向卡：
读取 current_need + recommendation_signals + profile summary

第二阶段商户排序：
先硬过滤 current_need
再用 scoring_features 累加 signals

商户解释：
Ark 只看当前卡事实、rank、score、scoring_features、命中的 memory signals
不让 Ark 搜索历史
不让 Ark 改排序
```

## 10. 产品场景定义

### 10.1 用户说“记住 / 以后 / 下次 / 别再”

```text
问小汪
-> agent 使用 memory_candidate_create
-> 后端写 pending candidate
-> 前端展示确认
-> 用户确认
-> 后端写 confirmed preference
-> signal_refresh 生成 recommendation signals
```

### 10.2 用户说“就这么记吧”

```text
问小汪
-> agent 使用 memory_manage confirm_latest_pending
-> 后端把 candidate 转 confirmed preference
-> signal_refresh 更新 signals
```

### 10.3 Session Finalize

当前含义：

```text
session final decision
```

不是：

```text
用户真实吃了这家
```

流程：

```text
POST /api/session/finalize
-> 写 session.result
-> 更新 day_context
-> 写 memory_observation
-> 不直接写 confirmed preference
-> 不调用 Evermind
```

### 10.4 餐后反馈

当前前端还没有完整评分场景。

后续设计：

```text
用户吃完后反馈文本/评分
-> 写 merchant_feedback
-> 写 observation
-> agent / memory intelligence 判断是否生成 candidate
```

后端不应只靠关键词作为主逻辑。

### 10.5 问小汪对话

理想流程：

```text
用户问题
-> agent 判断是否需要记忆
-> 按需调用 memory_search / session_memory_read
-> 生成回复或 skill action
```

例子：

```text
用户：我想吃川菜，有什么推荐吗？
agent:
- search_memory("川菜 油 排队")
- 发现用户之前嫌某家川菜太油
- 调用 meal_swipe 创建川菜滑卡，同时带上“不太油/少排队”的结构化约束
```

### 10.6 汪记本

理想流程：

```text
agent 可读取 memory ledger、session summaries、day/week jobs
自主判断展示：
- 今日小结
- 本周小结
- 食物选择画像
- 待确认记忆
- 已确认记忆
```

## 11. 实施步骤

### Phase 1：主指导文件落地

当前先完成：

```text
docs/MEMORY_SYSTEM_IMPLEMENTATION_PLAN.md
```

暂缓更新，等 Phase 3/4 的 API 和 tool schema 定稿后再同步：

```text
docs/contracts/memory.md
docs/contracts/openclaw-dreaming.md
docs/PROJECT_STATE.md
openclaw-workspace/TOOLS.md
openclaw-workspace/BOOT.md
```

原因：

```text
TOOLS.md 和 BOOT.md 是 OpenClaw 实际操作约束
在 memory_search、session_memory_read、memory_candidate_create 等工具 schema 未定前不应提前改
否则 agent 会看到一套尚未实现的工具说明
```

待 Phase 2-4 完成后再更新：

```text
docs/contracts/memory.md：更新权威账本、API、Evermind 移除后的正式合同
docs/contracts/openclaw-dreaming.md：改为 Memory Intelligence day_dreaming 兼容入口说明
docs/PROJECT_STATE.md：同步项目状态
openclaw-workspace/TOOLS.md：只写已经存在且可调用的工具
openclaw-workspace/BOOT.md：只写已经确定的运行边界
```

待后续废弃：

```text
docs/contracts/evermind-memory.md
```

### Phase 2：移除 Evermind 主链路

后端目标：

```text
不再 import evermind
不再同步 external memory
不再返回 evermind provider status
不再把 evermind_weak_memories 放进 prompt
```

涉及模块：

```text
server/src/memory-store.mjs
server/src/offer-cards.mjs
server/src/ai/prompts.mjs
server/src/app.mjs
server/src/memory-manager.mjs
```

### Phase 3：补齐本地记忆搜索 API

新增或整理：

```text
GET /api/memory/search
GET /api/session/memory
POST /api/memory/observations
POST /api/memory/candidates
```

要求：

```text
返回 compact objects
不返回完整媒体和商户卡
支持 query / type / limit
```

### Phase 4：OpenClaw 工具化

新增 Python wrapper：

```text
openclaw-workspace/skills/memory-search/scripts/memory_search_tool.py
openclaw-workspace/skills/session-memory/scripts/session_memory_tool.py
openclaw-workspace/skills/memory-capture/scripts/create_candidate.py
openclaw-workspace/skills/memory-manager/scripts/manage_memory.py
```

更新 skill 文档：

```text
memory-capture
memory-manager
lifepilot-memory-intelligence
diary-review
meal-swipe
```

### Phase 5：统一 Memory Intelligence

把：

```text
/api/openclaw/run-dream
```

变成兼容入口，内部转向：

```text
/api/memory/intelligence/run
mode=day_dreaming
engine=openclaw_agent
```

压缩输入：

```text
day_dreaming <= 120k chars
week_dreaming <= 120k chars
profile_update <= 80k chars
```

本阶段只实现手动复盘：

```text
汪记本按钮触发 day_dreaming
后台/调试接口手动触发 week_dreaming
不新增 cron 自动任务
不新增 heartbeat 自动任务
不新增 systemd timer
```

定期触发作为后续独立阶段：

```text
Phase 7：Cron-based Review Scheduling
```

### Phase 6：Signals 生成与使用

实现：

```text
signal_refresh
```

输入：

```text
confirmed_preferences
food_insight_profile
selected weak_hypotheses
```

输出写入：

```text
recommendation_signals.json
```

快推荐只读取 signals，不实时调用 agent。

## 12. 测试计划

### 12.1 静态检查

```bash
npm run check
```

### 12.2 记忆候选

输入：

```text
以后少推荐排队久的店
```

期望：

```text
创建 pending candidate
不创建 confirmed preference
```

### 12.3 记忆确认

输入：

```text
就这么记吧
```

期望：

```text
candidate -> confirmed preference
signals 被刷新
```

### 12.4 Session Finalize

期望：

```text
写 session result
写 observation
不写 confirmed preference
不调用 Evermind
```

### 12.5 问小汪记忆搜索

输入：

```text
我想吃川菜，有什么推荐吗？
```

期望：

```text
agent 能按需搜索本地 session / preferences
生成结构化 meal_swipe action
```

### 12.6 快速商户排序

期望：

```text
商户排序读取 recommendation_signals
scoring_features 包含 memory source
不调用 OpenClaw / Evermind
```

### 12.7 汪记本

期望展示：

```text
今日小结
本周小结
食物选择画像
待确认记忆
已确认记忆
```

## 13. 云端、本地、GitHub 更新流程

本地开发：

```text
/Users/mona/Documents/lifepilot
```

GitHub 准源：

```text
https://github.com/onenewborn/lifepilot
```

云端运行：

```text
/opt/lifepilot
```

云端 OpenClaw workspace：

```text
/root/.openclaw/workspace
```

后端/文档更新流程：

```bash
npm run check
git add docs server openclaw-workspace
git commit -m "Clarify LifePilot memory architecture"
git push origin main
ssh root@110.42.208.125
cd /opt/lifepilot
git pull --ff-only
npm run check
pm2 restart lifepilot-api --update-env
```

OpenClaw skill 更新流程：

```text
云端改 /root/.openclaw/workspace
-> 云端 workspace git commit
-> 同步干净快照到本地 openclaw-workspace/
-> 本地主仓库 commit
-> push GitHub
```

## 14. 决策结论

```text
当前比赛版本抛弃 Evermind
本地 JSON 是唯一记忆权威
Memory Intelligence 是统一记忆加工系统
OpenClaw Dreaming 收敛为 Memory Intelligence 的 day_dreaming engine
当天复盘和每周复盘当前只做手动触发
定期 cron 触发暂不进入当前实施范围
Agent 有记忆工具，但所有写入必须走后端 API
confirmed preference 只能来自用户确认或明确授权
快速滑卡只读 signals，不实时搜索历史
慢链路对话、复盘、汪记本可以让 agent 按需读取历史
```
