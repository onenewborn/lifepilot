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
