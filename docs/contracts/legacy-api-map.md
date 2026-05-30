# Legacy API Map

Updated: 2026-05-30

## Purpose

This file maps the old H5 backend and mini program expectations to the new product backend.

During migration, preserve these routes and key fields unless a compatibility adapter is added.

## Old Backend Source

```text
/Users/mona/.openclaw/workspace/apps/lifepilot-h5/server.mjs
```

## Main Mini Program Source

```text
/Users/mona/.openclaw/workspace/apps/lifepilot-miniprogram/pages/index/index.js
/Users/mona/.openclaw/workspace/apps/lifepilot-miniprogram/utils/config.js
```

## Route Map

| Old route | New route | P1/P2 status | Notes |
| --- | --- | --- | --- |
| `GET /api/health` | same | P1 | Must return `ok: true`. |
| `GET /api/food-directions` | same | P1 | Returns `{ok:true,cards:[...]}`. |
| `POST /api/session/start` | same | P1 | Creates meal session and direction cards. |
| `POST /api/session/swipe` | same | P1 | Records swipe event. |
| `GET /api/session/:id` | same | P1 | Returns public session. |
| `POST /api/session/advance` | same | P2/P3 | Direction summary first, offer transition second. |
| `POST /api/session/finalize` | same | P3 | Builds final recommendation. |
| `POST /api/food-offers` | same | P3 | Compatibility route for offer cards. |
| `POST /api/agent/parse-entry` | same or adapter | P2 | May be internal after session start is stable. |
| `POST /api/agent/direction-summary` | same or adapter | P2 | Must support direct smoke/debug. |
| `GET /api/memory/ledger` | same | P4 | Memory ledger. |
| `POST /api/xiaowang/chat` | same | P5/P6 | OpenClaw-backed or hybrid. |

## Legacy Success Shapes

Food directions:

```json
{
  "ok": true,
  "cards": []
}
```

Session start:

```json
{
  "ok": true,
  "session": {}
}
```

Session swipe:

```json
{
  "ok": true,
  "event": {},
  "session": {}
}
```

Session advance:

```json
{
  "ok": true,
  "session": {},
  "offer_payload": {}
}
```

## Key Compatibility Fields

Session:

```text
session_id
user_id
stage
next_step
goal
understanding
direction_events
offer_events
direction_summary
current_cards
offer_payload_meta
result
synthetic_only
created_at
updated_at
```

Direction card:

```text
card_id
direction_id
service_id
title
tags
budget_band
hook
fit
avoid_for
image_url
video_url
poster_url
video_version
has_sound
media_type
```

Offer card:

```text
card_id
offer_id
merchant_id
merchant_name
title
tags
score
image_url
video_url
poster_url
facts
explanation
```

## Known Hidden Behavior To Preserve

- Relative `/assets/...` paths must work in data and be resolved by mini program to COS.
- `service_id` is still read by old direction-card UI paths.
- `local_only` / `localOnly` request flags should force local fallback.
- `timeout_ms` request field may be supplied by mini program and should be honored when practical.
- Session `current_cards` drives swipe card lookup, so cards must remain in session response.

