---
name: memory-manager
description: 当用户在问小汪里明确要求确认、记住、修改、删除、暂停或查询 LifePilot 汪记本记忆时使用。负责把自然语言和上下文里的 pending candidates / confirmed preferences 转成结构化 memory_manage 操作。
category: memory
summary: 汪记本自然语言增删改查。
---

# 汪记本记忆管理

## 何时使用

- 用户说“可以确认下来”“就这么记吧”“刚刚那条记住”。
- 用户说“刚刚那条别记了”“这条先不记”。
- 用户说“以后帮我记住……”，并且语义是明确长期偏好。
- 用户说“把……改成……”“删掉……这条记忆”“先暂停……这个偏好”。
- 用户问“你现在记得我什么”“看看我的偏好”。

## 分工边界

OpenClaw 负责：

- 理解用户自然语言。
- 结合最近对话、pending candidates、confirmed preferences 选择目标。
- 把“刚刚那条”“排队久那条”等表达转成 `candidate_id`、`preference_id` 或 `match_text`。
- 改写出适合长期保存的 `confirmation_text`。

LifePilot 后端负责：

- 执行结构化 `memory_manage`。
- 校验 user_id、目标、状态和敏感文本。
- 写入 memory ledger。

不要让后端用自然语言规则猜用户意图。只有你输出结构化 `memory_manage`，后端才会执行写操作。

## 结构化操作

优先在同一次 agent loop 内运行脚本，让 LifePilot 后端真实执行记忆操作：

```bash
python3 skills/memory-manager/scripts/manage_memory.py \
  --api-base "$LIFEPILOT_API_BASE" \
  --user-id demo_weiyingru \
  --operation confirm_latest_pending
```

在问小汪 JSON 的 `skill_calls` 里也可以使用兼容结构：

```json
{
  "skill": "memory_manage",
  "reason": "用户明确确认最近一条待确认记忆",
  "args": {
    "operation": "confirm_latest_pending"
  }
}
```

支持的 operation：

```text
list_memory
create_confirmed_preference
confirm_pending
confirm_latest_pending
reject_pending
update_preference
delete_preference
pause_preference
```

目标字段：

```json
{
  "target": {
    "candidate_id": "cand_...",
    "preference_id": "pref_...",
    "match_text": "排队久"
  }
}
```

文本字段：

```json
{
  "confirmation_text": "工作日中午少推荐排队久的店",
  "statement": "工作日中午少推荐排队久的店",
  "reason": "用户在问小汪里明确要求修改这条偏好"
}
```

## 判断规则

- 用户说“可以确认下来”且上下文有 pending candidate：用 `confirm_latest_pending`。
- 用户明确要求记住一个新偏好、但上下文没有 pending candidate：用 `create_confirmed_preference`。
- 用户说“不记了/别记了/这条不要”：用 `reject_pending`，优先最近 pending；如果用户指向已确认偏好，则用 `delete_preference`。
- 用户说“改成……”：用 `update_preference`，必须带目标和新的 `confirmation_text`。
- 用户说“删掉/忘掉这个偏好”：用 `delete_preference`；它会标记 forgotten，不物理删除。
- 用户说“先暂停”：用 `pause_preference`。
- 用户询问记忆内容：用 `list_memory` 或 diary-review，不做写操作。

## 安全边界

- 推断、弱上下文、单次滑卡行为不能直接写 confirmed preference。
- 用户没有明确授权时，只能用 memory-capture 生成待确认候选。
- 如果目标不清楚，先用小汪口吻追问，不要编 candidate_id 或 preference_id。

## 测试提示

显式：

```text
请用 memory-manager 确认最近一条待确认记忆。
```

隐式：

```text
刚刚那条可以确认下来。
```
