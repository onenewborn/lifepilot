# 配置合同

更新时间：2026-05-30

## 后端运行配置

```text
HOST=127.0.0.1
PORT=4331
NODE_ENV=development
LIFEPILOT_RUNTIME_ROOT=/Users/mona/Documents/lifepilot/data/runtime
```

旧后端默认端口：

```text
PORT=4321
```

迁移期间新后端使用 `4331`，避免打扰旧小程序流程。

`LIFEPILOT_RUNTIME_ROOT` 用于保存运行时状态，例如 P5 的 meal session JSON 文件。默认值是：

```text
data/runtime
```

该目录不进入 git。

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
LIFEPILOT_OPENCLAW_API_BASE=http://127.0.0.1:4331
LIFEPILOT_OPENCLAW_LOCAL=false
```

`/api/openclaw/run-dream` 是本机实验触发接口：

- `LIFEPILOT_OPENCLAW_LOCAL=false`：走默认 OpenClaw Gateway/sandbox，适合模拟真实 OpenClaw 隔离环境，但可能无法访问宿主机后端。
- `LIFEPILOT_OPENCLAW_LOCAL=true`：走 `openclaw agent --local`。注意这不一定关闭工具 sandbox；如果 OpenClaw 配置仍是 `agents.defaults.sandbox.mode=all` 且网络为 `none`，skill 仍访问不到 `127.0.0.1`。
- `LIFEPILOT_OPENCLAW_API_BASE` 是传给 OpenClaw skill 的 LifePilot 后端地址。`local=true` 时通常写 `http://127.0.0.1:4331`。

完整本机闭环验收时，可以临时执行：

```bash
openclaw config set agents.defaults.sandbox.mode off
openclaw gateway restart
```

跑完必须恢复：

```bash
openclaw config set agents.defaults.sandbox.mode all
openclaw gateway restart
```

## 位置、天气和路线

小程序前端应把 `wx.getLocation({ type: "gcj02" })` 的结果传给后端：

```json
{
  "location": {
    "label": "当前位置",
    "latitude": 22.52291,
    "longitude": 114.05454,
    "coordinate_type": "gcj02",
    "source": "wx.getLocation"
  }
}
```

`/api/session/start` 会把这个位置存进 session。`/api/weather/forecast` 和 `/api/map/route` 可以通过 `session_id` 复用这个位置。

真实 provider 使用高德 Web 服务；没有 key 时自动回退 mock，不打断主流程。

```text
LIFEPILOT_WEATHER_PROVIDER=amap
LIFEPILOT_MAP_PROVIDER=amap
LIFEPILOT_AMAP_KEY=
LIFEPILOT_AMAP_BASE_URL=https://restapi.amap.com
LIFEPILOT_CONTEXT_TIMEOUT_MS=2500
```

当前规则：

- queue 继续 mock，只读商家静态 `queue_risk`。
- weather 有 key 时用当前位置逆地理得到 adcode，再查实时天气。
- route 有 key 且起终点都有经纬度时查步行路线。
- 缺 key、缺坐标、超时、provider 报错时回退 mock，并写 `fallback_used` / `fallback_reason`。
- 商户坐标目前是合成估算，字段来源为 `synthetic_neighborhood_estimate`，后续换真实店铺时直接替换。

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
