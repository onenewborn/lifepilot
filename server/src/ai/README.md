# ai

这个目录保存后端侧 AI provider 和 prompt 构建逻辑。它主要用于入口需求解析、方向总结、商户卡解释和推荐理由生成。

## 支持能力

- `ark-provider.mjs`：调用 Ark/Doubao 兼容接口，提供超时和 JSON 输出支持。
- `prompts.mjs`：构造入口解析、方向总结和商户解释 prompt。

## 产品价值

LifePilot 使用 AI 来解释和收束选择，但不让 AI 接管所有业务判断。后端 prompt 只服务于可控环节：解释、总结、提炼，而商户召回、硬过滤、记忆写入仍由结构化代码和账本控制。

## 维护原则

- prompt 应明确输出 JSON 结构，便于后端校验。
- AI 不能参与硬过滤或直接写入 confirmed preference。
- 超时和 fallback 要可观测，不能让用户体验无声卡住。

