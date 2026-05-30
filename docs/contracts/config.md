# 配置合同

更新时间：2026-05-30

## 后端运行配置

```text
HOST=127.0.0.1
PORT=4331
NODE_ENV=development
```

旧后端默认端口：

```text
PORT=4321
```

迁移期间新后端使用 `4331`，避免打扰旧小程序流程。

## P1 双跑验证

现有小程序不会自动调用新后端。P1 验证时，需要通过 `getApp().globalData.apiBaseUrl` 或临时修改小程序配置，把 API base 指到：

```text
http://127.0.0.1:4331
```

旧后端继续保留在：

```text
http://127.0.0.1:4321
```

如果 smoke test 看起来通过，必须确认 `/api/health` 响应里有新后端 marker，避免误测到旧服务。

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

Provider 可选值：

```text
ark
local
openclaw
```

P1 不依赖 `ARK_API_KEY`。如果 provider 不可用，AI 路由必须走本地 fallback。

## OpenClaw Bridge

```text
OPENCLAW_API_BASE=http://127.0.0.1:4331
OPENCLAW_JOB_SHARED_SECRET=
```

P5 再细化认证和 job 提交流程。

## 资产分发

小程序 COS base：

```text
LIFEPILOT_ASSET_BASE_URL=https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com
```

本地 fallback：

```text
http://127.0.0.1:4331/assets
```

## Fallback 触发条件

以下情况使用确定性 fallback：

- provider 环境变量缺失
- provider 请求超时
- provider 返回非 2xx
- JSON 合同任务中 provider 返回无效 JSON
- provider 输出无法通过 normalize

Fallback 要体现在响应 timing/meta 中，但不能打断主卡流。
