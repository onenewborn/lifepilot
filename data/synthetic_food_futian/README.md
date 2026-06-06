# synthetic_food_futian

这个目录保存当前饭点推荐的核心种子数据，场景集中在深圳福田。它支撑方向卡、商户卡、优惠线索、硬过滤和软排序。

## 文件说明

- `food_directions.json`：第一阶段方向卡，例如热汤粉面、川菜小馆、轻食等。
- `merchants.json`：商户基础信息，包括位置、环境、营业信息、媒体和适用场景。
- `offers.json`：商户卡和推荐吃法，是第二阶段滑卡的主要候选。
- `deals.json`：优惠和团购线索，用于券后人均和“怎么吃更划算”的解释。

## 字段如何支持推荐

- `direction_id`：连接方向卡和 offer，用于第一阶段保留/放弃后的候选过滤。
- `merchant_id`：连接商户事实、offer、deal 和口碑证据。
- `cuisine_tags` / `decision_tags`：支持“想吃川菜”“热乎一点”“清爽点”等硬过滤和软排序。
- `price_per_person`：支持预算上限过滤。
- `solo_friendly` / `chat_friendly`：支持一个人吃或多人吃的场景适配。
- `spice_level` / `oil_level`：支持“不要辣”“少油腻”等偏好和记忆 signals。
- `media`：支撑商户卡的视频/图片内容体验。
- `deal_id`：让小汪能解释优惠和性价比，而不是只说“这家不错”。

## 产品价值

LifePilot 的滑卡机制需要结构化候选：方向帮助用户缩小模糊需求，商户和 offer 帮用户感知具体选择，deal 让价格和性价比进入决策。这个目录让推荐过程既能被 AI 解释，也能被代码稳定排序和测试。

## 维护原则

- 新增商户时要同步 merchant、offer、deal 和 reputation 的关联字段。
- `merchant_id`、`offer_id`、`direction_id` 应稳定，不要随意改名。
- 数据可以是 demo seed，但对外文案不能伪装成实时平台事实。
