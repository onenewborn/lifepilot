# OpenClaw Jobs 合同

更新时间：2026-05-30

## 含义

OpenClaw job 是小汪通过 OpenClaw runtime 执行的一次后台或互动任务。

它不是 meal session。

## 典型任务

- 生成小汪主动消息
- 生成互动卡片草稿
- 写一篇邀请用户互动的短文章
- 运行小游戏 skill
- 分析近期 session 并提出候选记忆
- 生成视频 prompt
- 运行内容生产工作流

## 产品上下文 API

OpenClaw 应通过这些 API 读取产品上下文：

```text
GET  /api/openclaw/context?user_id=...
GET  /api/openclaw/session/:session_id
POST /api/openclaw/memory-candidates
POST /api/openclaw/jobs/:job_id/result
```

## 上下文层级

默认上下文：

```text
confirmed_preferences
recent_session_summaries
current_session_snapshot when relevant
```

默认不要把完整 swipe events 全量塞给 OpenClaw。只有明确做复盘、审计或调试任务时，才按需读取详细事件。

## 结果边界

OpenClaw job 结果在产品后端接受之前，只是建议、草稿或候选。

示例：

```json
{
  "job_id": "job_...",
  "type": "xiaowang_proactive_message",
  "status": "completed",
  "draft": {
    "title": "今晚要不要试试轻汤局？",
    "body": "小汪发现主人最近更常保留热汤和低负担选项..."
  },
  "memory_candidates": []
}
```

## 权威归属

是否发布、持久化、通知用户，或把 job output 转成候选记忆，都由产品后端决定。
