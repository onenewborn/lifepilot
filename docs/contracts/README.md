# contracts

这个目录保存跨模块合同。合同文档定义前端、后端、数据、OpenClaw skill 和 Memory Intelligence 之间如何交换信息。

## 支持能力

- `session-api.md`：饭点 session、day context 和状态机。
- `memory.md`：记忆账本、候选记忆、已确认偏好和 Memory Intelligence。
- `food-cards.md`：方向卡、商户卡和兼容字段。
- `ai-provider.md`：Ark/AI prompt 和结构化输出约定。
- `assets.md`：图片、视频和 COS 资产规则。
- `config.md`：端口、环境变量和部署配置。
- `api-errors.md`：错误响应形态。

## 产品价值

LifePilot 的优势在于 AI、滑卡和记忆能形成闭环。合同文档保证这个闭环不是靠隐式约定拼起来，而是每一层都有明确输入输出和权威边界。

## 维护原则

- 合同变化要同步代码和 smoke tests。
- 不再使用的历史合同应移到 `docs/archive/`。
- 用户记忆、商户证据和推荐排序的权威归属必须写清楚。

