---
name: deal-search
description: 当用户询问 LifePilot 商户的团购、优惠、券后人均、套餐、省钱和“怎么吃更划算”时使用。只查询 LifePilot 可控优惠证据，不做真实平台实时领券。
category: local-life
summary: 商户优惠证据与券后人均解释。
---

# 优惠和团购证据

## 何时使用

- 用户问“这家有团购吗”“这家有没有优惠券”“两个人怎么吃更划算”。
- 用户问“券后多少钱”“有没有适合一个人的套餐”“附近哪家更便宜一点”。
- 用户在商家卡或最终确认页里追问当前店的优惠。

如果用户明确说“帮我领券/帮我下单”，不要冒充真实平台操作。当前 skill 只能查看优惠线索；真实领券是后续独立 `coupon-wallet` 能力。

## Agent Loop

这个 skill 必须在同一次 OpenClaw agent loop 内完成：

```text
理解用户问题
→ 提取商户、人数、预算、餐段
→ 调用 LifePilot deal_search_context 工具/API
→ 读取优惠标题、券后人均、适合人数、限制、来源和置信度
→ 生成小汪最终解释
→ 返回可渲染 deal_card 和 trace
```

LifePilot 后端只提供证据和价格估算。OpenClaw 负责解释、取舍和最终小汪口吻。

## LifePilot 工具契约

优先用 OpenClaw 的执行工具运行本 skill 附带脚本：

```bash
python3 skills/deal-search/scripts/deal_search_tool.py \
  --api-base "http://110.42.208.125" \
  --merchant-name "汪记豆花" \
  --party-size 2 \
  --question "这家两个人怎么吃更划算"
```

如果当前上下文已经有真实 `merchant_id`，直接传 ID：

```bash
python3 skills/deal-search/scripts/deal_search_tool.py \
  --api-base "http://110.42.208.125" \
  --merchant-id m_futian_014 \
  --user-id demo_weiyingru \
  --question "有没有适合一个人的优惠"
```

脚本会调用：

```text
POST /api/tools/deal-search-context
```

并返回：

```text
context              原始优惠证据上下文
skill_result_card    前端可渲染 deal_card
trace                工具调用轨迹
```

`LIFEPILOT_API_BASE` 必须是工具环境可访问的 LifePilot 后端地址。当前默认使用 `http://110.42.208.125`。不要绕过产品后端读取旧 demo data。

## 证据边界

- 只说“当前 LifePilot 可控优惠线索/种子证据显示”。
- 不要说“我查了实时美团/大众点评/抖音/高德”。
- 不要承诺优惠可领取、可核销、还在售或能下单。
- 没有优惠证据时要明确说暂无证据，不要编造团购。
- 用户要领券时，说明当前可以先看优惠线索，真实领券以后由独立能力处理。

## 输出要求

小汪回复应包含：

- 一句自然总结。
- 券后人均或总价。
- 适合人数和一个限制条件。
- 来源/更新时间或“需二次确认”的提醒。

最终给 LifePilot 后端的 JSON 中，优惠类问题应尽量返回：

```json
{
  "message": "小汪基于工具证据生成的自然回复。",
  "skill_calls": [],
  "skill_result_cards": [],
  "memory_prompts": []
}
```

`skill_result_cards` 可以直接使用脚本输出里的 `skill_result_card`。
