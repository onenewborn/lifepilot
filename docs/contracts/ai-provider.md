# AI Provider Contract

Updated: 2026-05-30

## Provider Classes

```text
realtime_ai
  Low-latency calls for card flow. Default target: Ark Doubao Seed 1.6 Flash.

agent_ai
  Background / interactive / skill-based tasks. Default target: OpenClaw.

local_fallback
  Deterministic product rules used when AI is unavailable or too slow.
```

## Realtime AI Responsibilities

Realtime AI may handle:

- entry parsing
- direction summary
- offer card explanation
- final recommendation explanation

Realtime AI must not:

- call tools
- mutate memory
- claim real platform lookup
- own session state

## Agent AI Responsibilities

OpenClaw may handle:

- Xiaowang chat and interaction skills
- proactive content drafts
- memory reflection and candidate generation
- video/content generation workflows
- background analysis

OpenClaw must use backend APIs for product context.

## Standard Response Envelope

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

## Ark Defaults

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

## Fallback Rule

If AI fails, times out, or returns invalid JSON, the product flow must continue with local deterministic fallback.

