# API Errors Contract

Updated: 2026-05-30

## Response Envelope

All JSON API responses use one of these shapes.

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {}
}
```

Legacy-compatible success may return top-level fields during migration:

```json
{
  "ok": true,
  "session": {},
  "cards": [],
  "timing": {}
}
```

P1 may preserve legacy-compatible top-level fields for the mini program. New internal routes should prefer `data`.

Error:

```json
{
  "ok": false,
  "error": {
    "code": "session_not_found",
    "message": "Session not found.",
    "details": {}
  },
  "meta": {
    "request_id": "req_...",
    "fallback_used": false
  }
}
```

## HTTP Status

```text
400 invalid_request
404 session_not_found / route_not_found
409 invalid_session_transition
422 invalid_payload
429 rate_limited
500 internal_error
502 provider_error
504 provider_timeout
```

## Required Error Codes

```text
invalid_json
invalid_request
invalid_payload
session_not_found
invalid_session_transition
card_not_found
provider_error
provider_timeout
invalid_ai_json
fallback_unavailable
route_not_found
internal_error
```

## Fallback Responses

When AI fails but deterministic fallback succeeds, the response remains `ok: true`.

Fallback responses must set `meta.fallback_used=true`. Legacy-compatible routes may also expose top-level `mode`, `warning`, and `timing`, but `meta.fallback_used` is required.

```json
{
  "ok": true,
  "meta": {
    "fallback_used": true,
    "fallback_reason": "provider_timeout"
  },
  "mode": "local_fallback",
  "warning": {
    "code": "provider_timeout",
    "message": "AI provider timed out; local fallback was used."
  },
  "timing": {
    "total_ms": 1200,
    "ai": {
      "ok": false,
      "provider": "ark_doubao",
      "error_code": "provider_timeout"
    }
  }
}
```

The card flow should not fail only because realtime AI failed.
