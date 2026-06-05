# services

这个目录封装小程序访问 LifePilot 后端的 API。页面代码不直接拼接口细节，而是通过 service 层调用 session、问小汪和记忆相关能力。

## 支持能力

- `request.js`：统一封装 `wx.request`，处理 base URL、超时、错误消息和返回结构。
- `session-api.js`：饭点 session 主链路，包括开始、滑卡、推进、最终确认和单卡解释。
- `xiaowang-api.js`：问小汪聊天、异步聊天 job、历史会话、汪记本和 Memory Intelligence 复盘。
- `memory-api.js`：餐后反馈、待确认记忆确认和拒绝。

## 产品价值

LifePilot 的前端体验连接了多个后端能力。service 层让这些能力保持清楚边界：页面负责交互，后端负责权威状态，OpenClaw 和 Memory Intelligence 通过后端接口进入产品闭环。

## 维护原则

- 不在 service 中写 UI 逻辑。
- 不在 service 中推断业务结果。
- 新增接口时先确认是否属于 session、xiaowang、memory 之一，避免接口调用散落到页面。

