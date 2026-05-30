# Session API Contract

Updated: 2026-05-30

## Meaning

A `meal_session` is one user journey for deciding what to eat.

It is product state. It is not an OpenClaw agent session.

## Owner

The product backend owns meal session creation, mutation, persistence, and validation.

## Core Routes

```text
POST /api/session/start
POST /api/session/swipe
POST /api/session/advance
POST /api/session/finalize
GET  /api/session/:session_id
```

## Minimal Session Shape

```json
{
  "session_id": "sess_...",
  "user_id": "demo_weiyingru",
  "stage": "direction",
  "next_step": "swipe_food_directions",
  "goal": "今晚想找一顿合适的饭",
  "entry_form": {},
  "understanding": {
    "constraints": {},
    "requirements": [],
    "missing_info": [],
    "confidence": 0.7,
    "assistant_text": "",
    "parse_mode": "local_fallback",
    "timing": {}
  },
  "direction_events": [],
  "offer_events": [],
  "direction_summary": null,
  "current_cards": [],
  "result": null,
  "synthetic_only": true,
  "created_at": "2026-05-30T00:00:00.000Z",
  "updated_at": "2026-05-30T00:00:00.000Z"
}
```

## Swipe Event Shape

```json
{
  "event_id": "evt_...",
  "session_id": "sess_...",
  "round": "direction",
  "action": "keep",
  "card_id": "dir_hot_soup_noodles",
  "direction_id": "dir_hot_soup_noodles",
  "offer_id": null,
  "merchant_id": null,
  "title": "热汤粉面",
  "tags": [],
  "dwell_ms": 1200,
  "created_at": "2026-05-30T00:00:00.000Z"
}
```

Allowed actions:

```text
keep
dislike
skip
super_like
```

## OpenClaw Boundary

OpenClaw can read session summaries through OpenClaw bridge APIs.

OpenClaw must not directly mutate meal session state.

