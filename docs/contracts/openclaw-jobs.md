# OpenClaw Jobs Contract

Updated: 2026-05-30

## Meaning

An OpenClaw job is an agentic background or interactive task performed by Xiaowang's OpenClaw runtime.

It is not a meal session.

## Typical Jobs

- generate proactive Xiaowang message
- draft an interaction card
- write a short article to invite user interaction
- run a mini game skill
- analyze recent sessions for memory candidates
- generate video prompts
- run content production workflows

## Product Context API

OpenClaw should read product context through APIs such as:

```text
GET  /api/openclaw/context?user_id=...
GET  /api/openclaw/session/:session_id
POST /api/openclaw/memory-candidates
POST /api/openclaw/jobs/:job_id/result
```

## Context Levels

Default context:

```text
confirmed_preferences
recent_session_summaries
current_session_snapshot when relevant
```

Avoid default full swipe-event dumps. Detailed event history should be fetched only for explicit review or debugging jobs.

## Result Boundary

OpenClaw job results are suggestions, drafts, or candidates until accepted by the product backend.

Examples:

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

## Authority

The backend decides whether to publish, persist, notify, or convert job output into memory candidates.

