# synthetic_food_futian

这个目录保存当前饭点推荐的核心种子数据，场景集中在深圳福田。它支撑方向卡、商户卡、优惠线索、硬过滤和软排序。

## 文件说明

- `food_directions.json`：第一阶段方向卡，例如热汤粉面、川菜小馆、轻食等。
- `merchants.json`：商户基础信息，包括位置、环境、营业信息、媒体和适用场景。
- `offers.json`：商户卡和推荐吃法，是第二阶段滑卡的主要候选。
- `deals.json`：优惠和团购线索，用于券后人均和“怎么吃更划算”的解释。

## 产品价值

LifePilot 的滑卡机制需要结构化候选：方向帮助用户缩小模糊需求，商户和 offer 帮用户感知具体选择，deal 让价格和性价比进入决策。这个目录让推荐过程既能被 AI 解释，也能被代码稳定排序和测试。

## 维护原则

- 新增商户时要同步 merchant、offer、deal 和 reputation 的关联字段。
- `merchant_id`、`offer_id`、`direction_id` 应稳定，不要随意改名。
- 数据可以是 demo seed，但对外文案不能伪装成实时平台事实。

