# AI Provider 合同

更新时间：2026-05-30

## Provider 分类

```text
realtime_ai
  用于卡流里的低延迟调用。默认目标：Ark Doubao Seed 1.6 Flash。

agent_ai
  用于后台、互动和 skill-based 任务。默认目标：OpenClaw。

local_fallback
  AI 不可用或超时时使用的确定性产品规则。
```

## Realtime AI 职责

Realtime AI 可以处理：

- 入口理解
- 方向总结
- Offer 卡解释
- 最终推荐解释

Realtime AI 不能：

- 调用工具
- 修改 memory
- 声称查询了真实平台
- 拥有 session 状态

## Agent AI 职责

OpenClaw 可以处理：

- 小汪聊天和互动 skills
- 主动触达内容草稿
- 记忆复盘和候选记忆生成
- 视频/内容生产工作流
- 后台分析任务

OpenClaw 必须通过产品后端 API 获取产品上下文。

## 标准响应 Envelope

```json
{
  "ok": true,
  "provider": "ark_doubao",
  "model": "doubao-seed-1-6-flash-250828",
  "text": "",
  "json": {},
  "raw": {},
  "timing": {
    "total_ms": 800
  },
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  },
  "fallback_reason": null
}
```

## Ark 默认配置

```json
{
  "model": "doubao-seed-1-6-flash-250828",
  "thinking": {
    "type": "disabled"
  },
  "temperature": 0.2,
  "max_tokens": 256
}
```

## Fallback 规则

如果 AI 失败、超时或返回无效 JSON，产品流程必须继续使用本地确定性 fallback。

## P2.5 入口需求解析

入口解析用于把按钮选择和聊天框原文解释成固定维度，但不能直接控制主链路。

请求：

```text
POST /api/agent/parse-entry
```

输出会进入 `session.understanding`：

```json
{
  "normalized_goal": "今天下班有点累，想吃一顿下饭、省心、距离不要太远的饭。",
  "raw_entry_text": "今天下班有点累，想吃点下饭的",
  "dimensions": {
    "flavor": {
      "intent": "想吃下饭、有满足感",
      "strength": "medium",
      "confidence": 0.86,
      "evidence": ["想吃点下饭的"]
    },
    "energy": null
  },
  "hard_constraints": [],
  "soft_preferences": [],
  "special_signals": [],
  "missing_info": [],
  "confidence": 0.82,
  "parse_mode": "ark"
}
```

固定维度：

```text
flavor
budget
distance
environment
energy
party
time_pressure
health_load
novelty
certainty
emotional_reward
social_friction
```

置信度规则：

```text
dimension confidence >= 0.8 且有 evidence 才保留，否则置为 null。
soft_preferences confidence >= 0.8 且有 evidence 才保留。
hard_constraints confidence >= 0.9 且有 evidence 才保留。
special_signals confidence >= 0.8 且有 evidence 才保留。
```

低置信度信息不能进入硬筛选或软排序，也不能交给后续 AI 自行补全。`raw_entry_text` 继续保留为用户原始表达，用于展示、审计和让用户通过后续滑卡或显式选择继续表达；规则层只读取高置信度结构化字段。

维度必须能连接后续卡片排序。AI 不应只输出“缓解疲惫”“需要安慰”这类抽象解释；应落成可执行偏好，例如：

```text
省心
低决策成本
少走路
少排队
热乎舒服
下饭、有满足感
清爽低负担
适合坐下来聊天
```

后端会从高置信度维度派生 `soft_preferences`，例如 `energy` 里的“下班累”会转成 `convenience=省心、低决策成本`、`distance=附近、省心、少走路`、`queue=少排队`、`temperature=热乎舒服`，再进入方向卡和商家卡排序。

## P2 方向总结输出

方向总结 AI 只需要返回：

```json
{
  "summary_text": "..."
}
```

`confidence` 不是 P2 必需字段，不进入核心合同。

方向总结 prompt 必须强调：

- 分析 `keep` 和 `dislike` 之间的食物/口味/场景差异，而不是简单复述。
- 正常情况下不道歉；只有没有保留方向、信号太少或选择矛盾时，才可以轻微抱歉但不卑微。
- 如果后续接入 confirmed memory，可以结合长期口味偏好解释本次选择。
- P2 实现先预留 `memoryContext`，暂不接完整 memory 系统。
- 入口阶段的预算、人数、距离、区域、口味选择和聊天框自定义输入必须作为强上下文传入 prompt；如果用户表达疲惫、下班、压力、想被犒劳、想省心等情绪或场景，小结开头要给出简短情绪确认。
- 本地 fallback 文案只用于后端兜底，不作为 AI prompt 输入；prompt 只传用户目标、入口上下文、keep/dislike 结构化事件和可选 memoryContext。
