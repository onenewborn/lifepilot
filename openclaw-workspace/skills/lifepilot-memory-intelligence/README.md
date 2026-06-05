# lifepilot-memory-intelligence

这个 skill 定义 LifePilot 统一记忆智能的规则。它覆盖即时观察审查、手动日复盘、手动周复盘和食物选择画像更新。

## 支持能力

- `instant_review`：审查单条 observation 是否值得成为待确认记忆。
- `manual_daily_review`：整理当天饭点、聊天和记忆线索。
- `manual_weekly_review`：发现跨天重复模式和稳定偏好线索。
- `profile_update`：生成汪记本展示用的食物选择画像。

## 产品价值

Memory Intelligence 让 LifePilot 不只是“推荐一次”，而是把选择过程变成下一次更懂用户的输入。它的关键边界是：可以提出候选和建议，但不能绕过后端和用户确认直接写入长期偏好。

## 维护原则

- 输出必须是结构化 JSON。
- 不直接读写产品 runtime 文件。
- 不创建 confirmed preference。
- 周复盘要注意输入压缩，避免超出 agent 上下文。

