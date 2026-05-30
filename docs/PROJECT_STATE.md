# Project State

Updated: 2026-05-30

## One Sentence

LifePilot is being rebuilt as a clean product runtime outside `~/.openclaw/workspace`, while OpenClaw remains the agent runtime for skills, background intelligence, memory reflection, and Xiaowang interactions.

## Current Decision

Use a two-runtime architecture:

```text
Mini Program / Product Backend
  owns meal sessions, chat threads, memory CRUD, recommendation rules, data contracts, COS asset resolution, and low-latency Ark/Doubao AI calls

OpenClaw Runtime
  owns AGENTS/SOUL/skills, background jobs, Xiaowang interactive content, video/content generation, and memory-candidate reflection
```

OpenClaw must access product state through backend APIs, not by directly reading or mutating product runtime files.

## Old Workspace Safety

Old workspace remains untouched at:

```text
/Users/mona/.openclaw/workspace
```

Full backup:

```text
/Users/mona/.openclaw/backups/lifepilot-workspace-20260530-120256
```

Old workspace git checkpoint:

```text
commit: d741a9e chore: checkpoint before lifepilot rebuild
tag: lifepilot-rebuild-base-20260530
```

Known old workspace dirty state after checkpoint:

```text
?? memory/users/smoke_test_evermind_1780043397065/
?? memory/users/smoke_test_evermind_ipv4_1780044939954/
```

These look like smoke-test residue and were not included in the empty checkpoint commit.

## Product Scope

Main product:

```text
饭点定了 mini program
```

Main flow:

```text
entry form
→ food direction cards
→ direction swipes
→ low-latency AI direction summary
→ offer cards
→ offer swipes
→ final recommendation
→ weather / queue / route context
→ feedback / memory candidates
→ Xiaowang interaction
```

## AI Boundary

Low-latency card flow:

```text
Ark Doubao Seed 1.6 Flash API
```

Background / agentic intelligence:

```text
OpenClaw skills
```

Memory authority:

```text
Product backend memory service
```

LLMs and OpenClaw can propose memory candidates. Only backend memory service can create, update, pause, delete, confirm, or reject authoritative memory records.

## Immediate Next Step

Phase 0.5 implementation contracts are complete:

```text
docs/contracts/api-errors.md
docs/contracts/food-cards.md
docs/contracts/config.md
docs/contracts/legacy-api-map.md
```

Phase 1 should create the smallest runnable new backend without touching the old workspace:

```text
GET /api/health
GET /api/food-directions
POST /api/session/start
POST /api/session/swipe
GET /api/session/:id
```

Run it on a new port, for example:

```text
4331
```

Old backend remains on:

```text
4321
```

## Hard Rule

Every implementation phase must answer:

```text
1. Which old responsibility moved into the new product repo?
2. Which new route/module now carries real behavior?
3. Which smoke test proves the old user experience was not broken?
```
