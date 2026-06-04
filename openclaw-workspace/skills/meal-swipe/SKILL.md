---
name: meal-swipe
description: 当用户希望小汪帮忙决定吃什么、进入饭点滑卡流程，或需要把明确需求/点名商户变成 LifePilot 商户滑卡时使用。本 skill 由 OpenClaw 判断入口类型；LifePilot 后端只执行结构化 primitive。
category: local-life
summary: 编排饭点滑卡入口。
---

# 饭点滑卡

## 核心边界

OpenClaw 负责判断用户该进入哪种产品入口。LifePilot 后端不根据固定自然语言话术路由，只执行本 skill 传入的结构化参数。

不要读取 workspace 本地商户 JSON、offer JSON、app 源码或旧原型文件。滑卡数据和状态都以 LifePilot 产品后端为准。

## 三类入口

### 泛需求：打开需求确认页

当用户说“不知道吃什么”“今天中午吃啥”“帮我选饭”“没想法”等泛需求，且还需要确认人数、预算、口味时，不要创建后端 session。

在问小汪 JSON 中返回：

```json
{
  "skill_cards": [
    {
      "skill": "meal_swipe",
      "title": "先确认今天怎么吃",
      "description": "补一下人数、预算和口味，小汪再带你滑方向卡。",
      "cta": "去确认需求",
      "action": "open_meal_entry",
      "payload": {
        "prefill_text": "用户原话"
      }
    }
  ]
}
```

### 明确需求：直接创建商户卡

当用户已有明确筛选条件，例如“想吃川菜”“找环境好一点的店”“少排队”“附近一点”“适合聊天”，可以直接创建第二阶段商户卡。

运行脚本：

```bash
python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --source-message "我想吃川菜" \
  --entry-mode offer_only \
  --understanding-json '{"food_preferences":{"cuisine_tags":["川菜"]}}'
```

把脚本输出里的 `skill_card` 放入问小汪 JSON 的 `skill_cards`。

### 点名商户对比：证据对比 + 只滑这些商户

当用户说“两家怎么选”“川香楼和汪记豆花该吃哪家”，先使用 `merchant-compare` 取得证据卡；如果要给滑卡入口，再调用本 skill 脚本，传入已解析的商户 id 或店名。

```bash
python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --source-message "川香楼和汪记豆花这两家我该选哪家" \
  --entry-mode merchant_compare \
  --merchant-names "川香楼,汪记豆花"
```

返回的商户卡 session 只能包含这些点名商户，不要扩展相似候选。

## 输出要求

面向用户的回复要简短自然，不暴露 primitive、session schema、gateway、sandbox、transport 等内部实现。

正常 JSON 形态：

```json
{
  "message": "可以，我给你准备一组相关商户卡，直接滑就行。",
  "skill_calls": [],
  "skill_cards": [],
  "skill_result_cards": [],
  "memory_prompts": []
}
```

如果脚本失败，直接说明工具失败，不要编造 session_id 或商户卡。
