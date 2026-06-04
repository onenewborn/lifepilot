---
name: merchant-compare
description: 当用户让小汪比较两到四家商户、判断哪家更适合今天、解释同类饭店差异，或按证据和用户偏好匹配度排列附近候选时使用。
category: local-life
summary: 多店商户对比与取舍解释。
---

# 多店商户对比

## 何时使用

- 用户问“两家怎么选”“哪家更好吃”“谁更适合我”。
- 用户提到两个或多个店名。
- 用户问附近同类店、排行榜、必吃榜或类似店对比。

## Agent Loop

这个 skill 必须在同一次 OpenClaw agent loop 内完成：

```text
识别候选商户
→ 调用 LifePilot merchant_compare_context 工具/API
→ 读取每家店的证据
→ 按当前需求、长期偏好、人数、评分、评论量、口碑标签、风险做比较
→ 生成小汪最终推荐语
→ 返回对比卡片数据和 trace
```

LifePilot 后端不能决定 winner，只能返回可比较证据和策略边界字段。

## LifePilot 工具契约

优先用 OpenClaw 的执行工具运行本 skill 附带脚本，让工具调用发生在同一次 agent loop 内：

用户不会知道 LifePilot 内部 `merchant_id`。只有当上下文已经明确给出 `m_futian_025` 这种内部 ID 时，才可以使用 `--merchant-ids`；禁止把中文店名、拼音、slug 或你猜出来的字符串传给 `--merchant-ids`。

```bash
python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --api-base "http://110.42.208.125" \
  --merchant-ids m_futian_006,m_futian_012 \
  --user-id demo_weiyingru \
  --session-id meal_xxx \
  --question "汪记豆花和川香楼怎么选"
```

如果只知道店名，可以用：

```bash
python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --api-base "http://110.42.208.125" \
  --merchant-names "汪记豆花,川香楼" \
  --question "汪记豆花和川香楼怎么选"
```

如果用户没有给明确店名，而是在说自然需求、品类、场景或约束，先把自然语言理解成结构化偏好 JSON，再用 `--preference-json` 和 `--query` 触发候选搜索。OpenClaw 负责自然语言理解；LifePilot 后端只按结构化字段检索候选和返回证据。

```bash
python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --api-base "http://110.42.208.125" \
  --query "想吃辣一点，但别太油，也别排队太久" \
  --preference-json '{"intent":"discover_and_compare_merchants","food_preferences":{"flavor_tags":["spicy"],"spice_level":{"target":"medium","operator":"gte"},"oil_level":{"target":"medium","operator":"lte"}},"constraints":{"max_queue_risk":"medium","solo_friendly":true}}'
```

结构化偏好字段只能使用 LifePilot 当前数据能支持的字段：

```json
{
  "intent": "discover_and_compare_merchants",
  "merchant_refs": [],
  "food_preferences": {
    "cuisine_tags": ["sichuan"],
    "flavor_tags": ["spicy"],
    "spice_level": {"target": "medium", "operator": "gte"},
    "oil_level": {"target": "medium", "operator": "lte"},
    "temperature": "hot"
  },
  "constraints": {
    "max_queue_risk": "medium",
    "max_price_per_person": 80,
    "solo_friendly": true,
    "service_speed": ["fast", "normal"],
    "reservation_mode": ["none", "recommended"]
  },
  "scene": {
    "party_size": 1,
    "meal_style": ["quick_meal", "casual_meal"],
    "chat_friendly": false,
    "neighborhood": ["岗厦"]
  }
}
```

脚本会调用 LifePilot 后端工具 API，返回：

```text
candidate_search      模糊需求时的候选搜索结果
context              原始对比证据上下文
skill_result_card    前端可渲染对比证据卡
trace                工具调用轨迹
```

`LIFEPILOT_API_BASE` 必须是 OpenClaw 工具执行环境可访问的 LifePilot 后端地址。当前默认使用 `http://110.42.208.125`。不要使用 sandbox 内的 `127.0.0.1`，因为它不是 LifePilot 后端。

如果工具/API 调用失败，必须报告失败；禁止改读 workspace 本地文件或原型文件来替代 merchant-compare 证据。

## 和饭点滑卡联动

当用户问“怎么选”“吃哪家”“哪家更适合今天”这类点名商户对比问题时，merchant-compare 负责给证据和建议，但还应给用户一个只比较这些点名商户的滑卡入口，方便用户自己做最终选择。

同一次 agent loop 内必须按这个顺序处理：

```text
识别点名商户
→ 调用 merchant_compare_tool.py 生成对比证据
→ 调用 meal-swipe/scripts/start_offer_flow.py 创建 merchant_compare 商户卡 session
→ skill_result_cards 放入对比证据卡
→ skill_cards 放入饭点滑卡入口卡
```

如果用户只给中文店名，调用 meal-swipe 脚本时使用 `--merchant-names`，不要猜内部 `merchant_id`：

```bash
python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base "http://110.42.208.125" \
  --user-id demo_weiyingru \
  --source-message "川香楼和汪记豆花怎么选" \
  --entry-mode merchant_compare \
  --merchant-names "川香楼,汪记豆花"
```

把 meal-swipe 脚本输出里的 `skill_card` 原样放入最终 JSON 的 `skill_cards`。如果滑卡 session 创建失败，可以只返回对比证据卡，并在 message 里自然说明“滑卡入口暂时没准备好”；禁止编造 session_id。

当前后端 endpoint：

```text
POST /api/tools/merchant-candidate-search
POST /api/tools/merchant-compare-context
```

当前后端兼容 id：

```text
merchant_compare
```

必需输入：

```json
{
  "user_id": "demo_weiyingru",
  "merchant_ids": ["m_futian_006", "m_futian_012"],
  "session_id": "meal_xxx",
  "question": "汪记豆花和川香楼怎么选"
}
```

## 决策策略

OpenClaw 可以说“我更建议 A”，但必须用证据解释取舍。优先使用这类表达：

- “更适合今天”
- “更适合主人现在的状态”
- “更适合多人局”
- “更稳，但记忆点弱一点”

除非工具结果明确标记来源，不要声称使用了真实大众点评/美团数据。

最终给 LifePilot 后端的 JSON 中，商户类问题应尽量返回：

```json
{
  "message": "小汪基于工具证据生成的自然回复。",
  "skill_calls": [],
  "skill_cards": [],
  "skill_result_cards": [],
  "memory_prompts": []
}
```

`skill_result_cards` 可以直接使用脚本输出里的 `skill_result_card`。点名商户对比场景下，`skill_cards` 应包含 meal-swipe 生成的 `open_meal_session` 入口。不要再让后端根据 `skill_calls` 替你执行商户判断或生成 winner。
