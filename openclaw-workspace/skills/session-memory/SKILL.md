---
name: session-memory
description: 当用户询问某次或当天饭点过程、刚才滑卡发生了什么、保留/放弃了哪些方向，或 agent 需要读取 compact session memory 再生成下一步动作时使用。只读，不修改 session。
category: memory
summary: 读取饭点 session 和 day context 摘要。
---

# Session Memory

## 何时使用

- 用户问“刚才那轮滑卡发生了什么”“今天我都怎么挑饭的”。
- 用户说“按刚刚那轮继续”“我们刚才保留了什么方向”。
- agent 需要读取当天 meal sessions 或小汪聊天摘要，再决定是否调用 memory-capture、diary-review 或 meal-swipe。

## 不该使用

- 用户问长期偏好或记忆账本：使用 `memory-search` 或 `diary-review`。
- 用户要写入、确认、修改、删除记忆：使用 `memory-capture` 或 `memory-manager`。
- 用户要创建新滑卡 session：使用 `meal-swipe`。

## 工具调用

必须从当前对话 prompt 中读取 `当前 user_id` 和 `当前 day_id`，并显式传给脚本。不要省略 `--user-id`，不要使用默认 demo 用户代替当前用户。

```bash
python3 skills/session-memory/scripts/session_memory_tool.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --day-id day_20260605_demo_weiyingru \
  --query "川菜"
```

如果已有明确 session id：

```bash
python3 skills/session-memory/scripts/session_memory_tool.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --session-id meal_xxx
```

## 输出要求

只引用脚本返回的 compact session，不要编造最终消费、真实下单或餐后评分。

## 测试提示

显式：

```text
请用 session-memory 查一下今天关于川菜的饭点 session。
```

隐式：

```text
刚刚那轮川菜滑卡发生了什么？
```
