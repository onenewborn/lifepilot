---
name: memory-search
description: 当用户询问过去是否提过某个饮食偏好、某类菜系、排队/油腻/辣度等记忆线索，或 agent 需要在下一步行动前检索 LifePilot 记忆账本时使用。只读，不写入记忆。
category: memory
summary: 检索 LifePilot compact memory objects。
---

# Memory Search

## 何时使用

- 用户问“我们之前是不是提过川菜”“你记得我不喜欢什么吗”“我之前是不是说过少排队”。
- 用户当前请求需要结合过去偏好再行动，例如“按我以前说过的川菜偏好推荐”。
- agent 需要在调用 meal-swipe、diary-review 或 memory-capture 前读取相关 confirmed preferences、pending candidates、observations 或 memory jobs。

## 不该使用

- 用户明确要新增、确认、修改、删除或暂停记忆：使用 `memory-manager` 或 `memory-capture`。
- 用户只想打开汪记本总览：使用 `diary-review`。
- 用户问某一次饭点 session 过程：使用 `session-memory`。

## 工具调用

必须通过 LifePilot 后端 API 搜索，不要读取 workspace 本地文件。

```bash
python3 skills/memory-search/scripts/memory_search_tool.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --query "川菜 少排队" \
  --type all \
  --limit 8
```

支持 `--type`：

```text
all
preference / confirmed_preference
candidate / memory_candidate
observation / memory_observation
job / memory_intelligence_job
profile / food_insight_profile
```

## 输出要求

脚本返回 compact objects。回答用户时只能引用工具结果里出现的内容：

```json
{
  "ok": true,
  "tool": "memory_search",
  "query": "川菜 少排队",
  "results": []
}
```

如果没有结果，说明“小汪还没找到相关记忆”，不要编造历史偏好。

## 测试提示

显式：

```text
请用 memory-search 查一下我之前有没有提过川菜和少排队。
```

隐式：

```text
我们之前是不是提过川菜？
```
