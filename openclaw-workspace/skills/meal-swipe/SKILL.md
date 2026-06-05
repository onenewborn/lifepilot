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

## 记忆预检

当饭点请求明显依赖历史偏好时，先读取记忆，再创建滑卡 session。

调用任何脚本时都必须显式传入当前会话的真实 `--user-id`。不要使用 `demo_weiyingru`，也不要省略 `--user-id`。

需要预检的表达：

- “按我之前说过的来”
- “按我的偏好”
- “你记得我喜欢/不喜欢什么”
- “别再推太油/排队久/太辣”
- “像上次那样”
- “之前不是说过川菜/面/少排队吗”

不需要每次都预检。用户只是直接说“我想吃川菜”“附近有什么”“今天吃面”时，如果当前需求已经足够明确，可以直接创建商户卡。

可以显式预检：

```bash
python3 skills/memory-search/scripts/memory_search_tool.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id "<当前 user_id>" \
  --query "川菜 少油 少排队" \
  --type all \
  --limit 6
```

`start_offer_flow.py` 也会自动预检：当 `--source-message` 包含“之前/上次/记得/按我的偏好/别再”等历史线索时，它会调用 `/api/memory/search`，并把可识别偏好注入到 `understanding.soft_preferences` 和 `openclaw.memory_search`。

如果查到相关 confirmed preference 或 pending candidate：

- 在给用户的 `message` 中自然引用，例如“我记得你之前说过川菜更想少油、少排队”。
- 创建商户卡时，把记忆转成当前轮的软偏好，而不是只写在回复里；工具会自动处理“少油/少排队/附近/不要辣/热乎”等常见偏好。
- 如果已经手动解析出更精确的记忆偏好，也可以通过 `--understanding-json` 增加 `soft_preferences`，并通过 `--openclaw-json` 保存 memory trace。

示例：

```bash
python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id "<当前 user_id>" \
  --source-message "我想吃川菜，按我之前说过的来" \
  --entry-mode offer_only
```

如果没有查到相关记忆，不要编造。可以说“小汪还没找到相关长期偏好，我先按你这次说的来”。

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
  --user-id "<当前 user_id>" \
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
  --user-id "<当前 user_id>" \
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
