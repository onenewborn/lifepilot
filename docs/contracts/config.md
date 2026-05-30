# Config Contract

Updated: 2026-05-30

## Backend Runtime

```text
HOST=127.0.0.1
PORT=4331
NODE_ENV=development
```

Old backend default:

```text
PORT=4321
```

New backend should use `4331` during migration to avoid disrupting the old mini program flow.

## Realtime AI

```text
LIFEPILOT_AI_PROVIDER=ark
ARK_API_KEY=ark-...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-1-6-flash-250828
ARK_TIMEOUT_MS=5000
ARK_MAX_TOKENS=256
ARK_TEMPERATURE=0.2
```

Provider values:

```text
ark
local
openclaw
```

P1 can run without `ARK_API_KEY`; AI routes must use local fallback when provider is unavailable.

## OpenClaw Bridge

```text
OPENCLAW_API_BASE=http://127.0.0.1:4331
OPENCLAW_JOB_SHARED_SECRET=
```

P5 will define authentication and job submission in more detail.

## Asset Delivery

Mini program COS base:

```text
LIFEPILOT_ASSET_BASE_URL=https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com
```

Local fallback:

```text
http://127.0.0.1:4331/assets
```

## Fallback Triggers

Use deterministic fallback when:

- provider env is missing
- provider request times out
- provider returns non-2xx
- provider returns invalid JSON for a JSON contract task
- provider output fails normalization

Fallback should be visible in response timing/meta, but should not break the main card flow.

