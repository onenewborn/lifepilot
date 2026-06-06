# services

这个目录封装小程序访问 LifePilot 后端的 API。页面代码不直接拼接口细节，而是通过 service 层调用 session、问小汪和记忆相关能力。

## 支持能力

- `request.js`：统一封装 `wx.request`，处理 base URL、超时、错误消息和返回结构。
- `session-api.js`：饭点 session 主链路，包括开始、滑卡、推进、最终确认和单卡解释。
- `xiaowang-api.js`：问小汪聊天、异步聊天 job、历史会话、汪记本和 Memory Intelligence 复盘。
- `memory-api.js`：餐后反馈、待确认记忆确认和拒绝。

## 服务与用户功能的对应关系

| 文件 | 支持的用户功能 | 后端 API 类型 |
| --- | --- | --- |
| `session-api.js` | 进入挑饭、方向滑卡、商户滑卡、最终确认 | `/api/session/*` |
| `xiaowang-api.js` | 问小汪聊天、打开历史会话、汪记本复盘 | `/api/xiaowang/*`、`/api/memory/intelligence/*` |
| `memory-api.js` | 确认或拒绝待确认记忆、餐后反馈 | `/api/memory/*` |
| `request.js` | 统一请求、错误提示、超时控制 | 所有 API |

## 为什么需要 service 层

LifePilot 的前端不是静态展示，而是同时连接饭点状态机、OpenClaw agent、Memory Intelligence 和记忆账本。service 层把这些 API 统一封装，避免页面直接知道接口细节，也方便在云端 IP、本地后端和临时 tunnel 之间切换。

## 产品价值

LifePilot 的前端体验连接了多个后端能力。service 层让这些能力保持清楚边界：页面负责交互，后端负责权威状态，OpenClaw 和 Memory Intelligence 通过后端接口进入产品闭环。

## 维护原则

- 不在 service 中写 UI 逻辑。
- 不在 service 中推断业务结果。
- 新增接口时先确认是否属于 session、xiaowang、memory 之一，避免接口调用散落到页面。
