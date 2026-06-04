---
name: lifepilot-memory-intelligence
description: Use this skill when LifePilot needs unified memory intelligence across instant review, day dreaming, week dreaming, or food insight profile updates. It analyzes LifePilot backend evidence and returns observations, weak hypotheses, pending memory candidates, profile updates, and Xiaowang interaction ideas without directly creating confirmed preferences or editing product runtime files.
category: memory
summary: LifePilot 统一记忆智能：即时审查、日/周复盘和食物选择画像。
---

# LifePilot Memory Intelligence

## 定位

这是 LifePilot 统一记忆智能 skill。旧的 `lifepilot-dreaming` 是本 skill 的 `day_dreaming` 兼容入口。

支持四种模式：

```text
instant_review   单条或小窗口 evidence 的即时审查
day_dreaming     日级复盘，合并当天饭点、小汪聊天和 observations
week_dreaming    多日复盘，发现跨天重复模式
profile_update   生成 FCQ / food neophobia / reward profile，供汪记本展示
```

## 权威边界

LifePilot 产品后端仍是唯一权威账本。

本 skill 可以输出：

- observations
- weak_hypotheses
- pending memory_candidates
- preference_update_suggestions
- food_insight_profile
- xiaowang_next_interaction_ideas

本 skill 不能：

- 直接创建 confirmed preference。
- 直接修改、删除、暂停产品 memory。
- 直接修改 meal session。
- 直接读写 `/opt/lifepilot/data/runtime`。
- 把 FCQ 或心理分析写成用户已确认画像。

所有输出都必须提交给 LifePilot 后端，由后端做 policy gate、去重、敏感信息检查和落库。

## 模式边界

### instant_review

输入是一条 observation 或很小的上下文窗口。

目标：

- 判断它是临时状态、短期观察、弱假设，还是待确认长期记忆。
- 识别明确长期意图，例如“以后”“下次”“记住”“少推荐”“别推”。
- 输出 pending candidate 时，必须保留 evidence 和可编辑 confirmation_text。

不要在 `instant_review` 里发现重复模式；重复模式属于 day/week dreaming。

### day_dreaming

输入是一天的 day context、meal sessions、observations、pending candidates、confirmed preferences。

目标：

- 合并当天 observations。
- 发现当天模式和可确认偏好。
- 生成小汪下一次互动建议。
- 可顺手生成 food_insight_profile，但它只用于汪记本展示。

### week_dreaming

输入是多日窗口。

目标：

- 找跨天重复模式。
- 区分稳定偏好、场景偏好和短期状态。
- 对 confirmed preferences 提出更新建议，但不能直接覆盖。

### profile_update

输入是近期 observations、meal summaries 和 confirmed preferences。

目标：

- 生成 FCQ 九维动机画像。
- 生成新奇接受度和 reward profile。
- 只作为“推荐偏好洞察”展示，不进入实时推荐排序。

## 输出 JSON

只输出 JSON，不要 Markdown。

```json
{
  "mode": "instant_review",
  "summary": "",
  "observations": [],
  "weak_hypotheses": [],
  "memory_candidates": [],
  "preference_update_suggestions": [],
  "food_insight_profile": null,
  "xiaowang_next_interaction_ideas": []
}
```

`memory_candidates` 必须符合 LifePilot 候选记忆边界：

```json
{
  "type": "food_preference",
  "category": "queue",
  "polarity": "negative",
  "scope": "food",
  "statement": "主人不太想排队太久。",
  "confirmation_text": "以后少推荐排队或等位太久的店",
  "confidence": 0.82,
  "evidence": [
    {
      "source": "memory_observation",
      "observation_id": "obs_...",
      "reason": "用户说以后少推荐排队久的店"
    }
  ],
  "needs_confirmation": true
}
```

## Demo 策略

当前 LifePilot 是 demo 阶段。pending candidate 可以更积极展示给评委看，但仍然不能绕过用户确认。

弱信号可以进入 observations 和 Food Insight Profile；不要写成 confirmed preference。
