# ADR-0001 Runtime Boundary

Date: 2026-05-30

## Status

Accepted.

## Context

The old `~/.openclaw/workspace` mixed product frontend, backend, data, assets, OpenClaw runtime config, skills, outputs, and historical experiments.

This made OpenClaw startup context too large and made product refactoring risky.

## Decision

Move product frontend/backend/data/contracts into a standalone product repository:

```text
/Users/mona/Documents/lifepilot
```

Keep OpenClaw runtime in:

```text
/Users/mona/.openclaw/workspace
```

OpenClaw accesses product state through backend APIs.

## Consequences

Positive:

- cleaner product architecture
- faster realtime AI path
- less OpenClaw context pollution
- clearer competition narrative

Tradeoffs:

- must maintain API bridge between OpenClaw and product backend
- need explicit contracts for session, memory, assets, and jobs
- cannot rely on OpenClaw implicitly reading product files

