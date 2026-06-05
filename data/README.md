# data

这个目录保存 LifePilot 当前可控的数据资产。它是 demo 阶段推荐、商户证据和优惠线索的基础，不等同于真实平台的实时数据。

## 支持能力

- `synthetic_food_futian/`：深圳福田饭点方向、商户、套餐/offer 和优惠数据。
- `merchant_reputation/`：商户口碑、评分、评论分布和特色菜等证据 seed。
- `runtime/`：本地运行态目录，已被 `.gitignore` 忽略，不应提交。

## 产品价值

LifePilot 强调“有证据的 AI 推荐”。这些数据让小汪可以解释为什么推荐某家店、有什么优惠线索、排队风险如何、适合一个人还是多人。它们也给 agent 工具提供可审计证据，避免模型凭空编造。

## 维护原则

- 商户事实和优惠线索要尽量结构化，便于后端排序和 OpenClaw 工具读取。
- 不声称 seed 数据来自实时平台。
- 运行时用户记忆、session 和 chat 只放 `data/runtime/`，不要提交。

