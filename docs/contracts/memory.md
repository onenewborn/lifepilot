# Memory Contract

Updated: 2026-05-30

## Meaning

Memory is the audited product ledger for what Xiaowang is allowed to remember and use.

## Authority

The product backend memory service is the only authority for memory CRUD.

OpenClaw, Ark/Doubao, and Xiaowang chat can propose candidate memories, but they do not directly write authoritative long-term preferences.

## Layers

```text
session_events
memory_candidates
confirmed_preferences
profile_summary
recommendation_context
```

## Candidate

```json
{
  "candidate_id": "memcand_...",
  "user_id": "demo_weiyingru",
  "type": "food_preference",
  "polarity": "negative",
  "statement": "不喜欢明显重油的餐食",
  "evidence": [
    {
      "source": "post_meal_feedback",
      "session_id": "sess_...",
      "text": "这家太油了，下次别推这种"
    }
  ],
  "confidence": 0.82,
  "status": "pending",
  "needs_confirmation": true,
  "created_at": "2026-05-30T00:00:00.000Z"
}
```

## Confirmed Preference

```json
{
  "preference_id": "pref_...",
  "user_id": "demo_weiyingru",
  "category": "food_oiliness",
  "scope": "restaurant_recommendation",
  "statement": "不喜欢明显重油的餐食",
  "polarity": "negative",
  "strength": 0.8,
  "confidence": 0.82,
  "status": "active",
  "evidence_candidate_id": "memcand_...",
  "sync": {
    "provider": "evermind",
    "status": "not_configured",
    "memory_id": null
  },
  "created_at": "2026-05-30T00:00:00.000Z",
  "updated_at": "2026-05-30T00:00:00.000Z"
}
```

## CRUD Rules

- View, create, update, pause, delete, confirm, and reject are backend operations.
- Sensitive text must be rejected before persistence.
- Single swipe events must not directly become confirmed preferences.
- OpenClaw-generated memory must enter as candidates.
- Evermind is an external memory provider, not the product authority.

## OpenClaw Boundary

OpenClaw can:

- request memory context
- submit memory candidates
- submit interaction summaries
- ask backend to record job evidence

OpenClaw cannot:

- directly update confirmed preferences
- directly delete product memory
- bypass user confirmation

