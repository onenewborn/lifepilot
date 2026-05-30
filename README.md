# LifePilot

LifePilot is the product workspace for the "饭点定了" mini program and backend.

This repository is intentionally separate from the OpenClaw runtime workspace.

## Runtime Boundary

- This repo owns product runtime: mini program, backend API, session state, memory CRUD, recommendation rules, data contracts, and asset contracts.
- OpenClaw owns agent runtime: `AGENTS.md`, `SOUL.md`, skills, background jobs, content generation, memory reflection, and interactive Xiaowang tasks.
- OpenClaw reads and writes product context through backend APIs. It should not directly mutate product database files.

## Current Status

Start every work session by reading:

- [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)
- [docs/MIGRATION_PHASES.json](docs/MIGRATION_PHASES.json)
- [docs/contracts/session-api.md](docs/contracts/session-api.md)
- [docs/contracts/api-errors.md](docs/contracts/api-errors.md)
- [docs/contracts/food-cards.md](docs/contracts/food-cards.md)
- [docs/contracts/memory.md](docs/contracts/memory.md)
- [docs/contracts/ai-provider.md](docs/contracts/ai-provider.md)
- [docs/contracts/config.md](docs/contracts/config.md)
- [docs/contracts/assets.md](docs/contracts/assets.md)
- [docs/contracts/legacy-api-map.md](docs/contracts/legacy-api-map.md)
- [docs/contracts/openclaw-jobs.md](docs/contracts/openclaw-jobs.md)
