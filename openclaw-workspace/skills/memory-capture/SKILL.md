---
name: memory-capture
description: 当用户明确要求小汪记住某个饮食偏好、以后避开某类选择、多推荐某类选择，或需要把重复饭点证据整理成待确认长期记忆候选时使用。
category: memory
summary: 待确认长期记忆候选生成。
---

# 记忆候选生成

## 何时使用

- 用户说“记住”“以后”“下次”“别再推荐”“多推荐”“少推荐”。
- 用户明确表达长期饮食偏好或踩雷反馈。
- OpenClaw reviewing diary/dreaming evidence finds a candidate preference that should be confirmed by the user.

## 记忆边界

OpenClaw 可以提出记忆候选，但本 skill 不能直接创建 confirmed preference。

如果用户已经在当前对话里明确要求“确认下来、就这么记、改一下、删掉、先不记”，应改用 `memory-manager`，由 agent 输出结构化 `memory_manage` 操作，再交给 LifePilot 后端执行。

LifePilot 后端负责：

- 创建 pending candidate
- 去重
- 冲突检测
- 用户确认后的 confirmed preference 写入

OpenClaw 负责：

- 判断这句话是否值得沉淀为长期记忆
- 组织确认问题的口吻
- 保留不确定性和证据

## 问小汪即时输出

当用户在问小汪里说“以后少推荐排队久的店”“下次别给我推太油的”“多推荐清淡一点”这类长期偏好时，不能回复成已经写入长期记忆。正确口径是“我先整理成待确认偏好，等你确认后再记住”。

最终 JSON 必须至少返回一个可被 LifePilot 后端识别的待确认候选：

```json
{
  "message": "好，我先把它整理成待确认偏好：以后少推荐排队久的店。你确认后我再长期记住。",
  "skill_calls": [
    {
      "skill": "memory_capture",
      "reason": "用户表达了长期饭点推荐偏好，需要生成待确认记忆候选。",
      "args": {
        "text": "主人，要不要让我以后少推荐排队久的店？",
        "confirmation_text": "以后少推荐排队久的店",
        "evidence": {
          "source": "user_message",
          "message": "以后少推荐排队久的店"
        }
      }
    }
  ],
  "skill_cards": [],
  "skill_result_cards": [],
  "memory_prompts": [
    {
      "text": "主人，要不要让我以后少推荐排队久的店？",
      "confirmation_text": "以后少推荐排队久的店"
    }
  ]
}
```

`skill_calls` 是给后端创建 pending candidate 的结构化入口；`memory_prompts` 是给前端展示确认问题的兼容入口。两者可以同时返回。不要直接调用 confirmed preference 写入，也不要声称“已经记住了”。

## LifePilot 工具契约

未来原生工具：

```text
memory_candidate_create
```

当前后端兼容 id：

```text
memory_capture
```

期望候选结构：

```json
{
  "text": "主人，要不要让我以后少推荐排队久的店？",
  "confirmation_text": "工作日中午少推荐排队久的店",
  "evidence": {
    "source": "user_message",
    "message": "以后别给我推排队久的"
  }
}
```

候选记忆必须具体、可编辑、可撤回。
