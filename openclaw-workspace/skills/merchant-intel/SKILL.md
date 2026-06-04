---
name: merchant-intel
description: 当用户询问单个 LifePilot 商户时使用，包括特色菜、口味、排队、环境、适合人数、怎么点，以及这家店是否符合用户当前需求和长期偏好。
category: local-life
summary: 单店商户理解与证据解释。
---

# 单店商户理解

## 何时使用

- 用户问“这家有什么特色菜”“这家怎么样”“这家适合我吗”。
- 用户问“一人/两人怎么吃”“有什么要避雷”“排队环境如何”。
- 用户在商家卡或最终确认页里追问当前店。

## Agent Loop

这个 skill 必须在同一次 OpenClaw agent loop 内完成：

```text
理解用户问题
→ 调用 LifePilot merchant_intel_context 工具/API
→ 读取评分、评论分布、口碑标签、特色菜、风险、用户记忆
→ 生成小汪最终推荐语
→ 返回可渲染卡片数据和 trace
```

LifePilot 后端只提供证据。OpenClaw 负责解释、取舍和最终小汪口吻。

## LifePilot 工具契约

优先用 OpenClaw 的执行工具运行本 skill 附带脚本，让工具调用发生在同一次 agent loop 内：

```bash
python3 skills/merchant-intel/scripts/merchant_intel_tool.py \
  --api-base "http://127.0.0.1:4331" \
  --merchant-id m_futian_006 \
  --user-id demo_weiyingru \
  --session-id meal_xxx \
  --question "这家有什么特色菜"
```

如果只知道店名，可以用：

```bash
python3 skills/merchant-intel/scripts/merchant_intel_tool.py \
  --api-base "http://127.0.0.1:4331" \
  --merchant-name "汪记豆花" \
  --question "这家有什么特色菜"
```

脚本会调用 LifePilot 后端工具 API，返回：

```text
context              原始证据上下文
skill_result_card    前端可渲染证据卡
trace                工具调用轨迹
```

`LIFEPILOT_API_BASE` 必须是 OpenClaw 工具执行环境可访问的 LifePilot 后端地址。云端默认使用 `http://127.0.0.1:4331`，因为 OpenClaw gateway 和 LifePilot 后端运行在同一台服务器上。

如果工具/API 调用失败，必须报告失败；禁止改读 workspace 本地文件或原型文件来替代 merchant-intel 证据。

当前后端 endpoint：

```text
POST /api/tools/merchant-intel-context
```

当前后端兼容 id：

```text
merchant_intel
```

必需输入：

```json
{
  "user_id": "demo_weiyingru",
  "merchant_id": "m_futian_006",
  "session_id": "meal_xxx",
  "question": "这家有什么特色菜"
}
```

工具结果只能作为证据，不是最终答案。不要编造评分、评论数、排队状态、平台事实或实时可用性。

## 输出要求

小汪回复应包含：

- 一句自然总结。
- 最强的一条证据理由。
- 必要时说明一个风险或不确定性。
- 说明用户长期偏好或当前状态如何影响推荐。
- 当前端可渲染时，返回结构化 `merchant_intel_card`。

最终给 LifePilot 后端的 JSON 中，商户类问题应尽量返回：

```json
{
  "message": "小汪基于工具证据生成的自然回复。",
  "skill_calls": [],
  "skill_result_cards": [],
  "memory_prompts": []
}
```

`skill_result_cards` 可以直接使用脚本输出里的 `skill_result_card`。不要再让后端根据 `skill_calls` 替你执行商户判断。
