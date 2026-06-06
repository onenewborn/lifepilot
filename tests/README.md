# tests

这个目录保存 LifePilot 的 smoke tests 和评估脚本。它们覆盖饭点主链路、记忆系统、商户证据、后台工具、媒体字段和 prompt 合同。

## 支持能力

- `smoke-session.mjs`：完整饭点 session，从开始到最终确认，并覆盖记忆和 provider。
- `smoke-memory-intelligence.mjs`：Memory Intelligence 即时复盘、日复盘、周复盘和画像刷新。
- `smoke-memory-api.mjs` / `smoke-memory-manager.mjs`：记忆 API 和自然语言管理操作的结构化执行。
- `smoke-offer-ranking.mjs`：推荐硬过滤和排序逻辑。
- `smoke-deal-search.mjs`：优惠证据工具。
- `smoke-admin.mjs`：后台管理接口和页面。
- `eval-xiaowang-openclaw-prompt.mjs`：问小汪 OpenClaw prompt 行为评估。

## 测试覆盖的产品风险

| 风险 | 对应测试 |
| --- | --- |
| 饭点主链路无法开始、滑卡或最终确认 | `smoke-session.mjs` |
| 用户说川菜却出现大量非川菜候选 | `smoke-offer-ranking.mjs` |
| Memory Intelligence 只能生成空泛总结 | `smoke-memory-intelligence.mjs` |
| 候选记忆/长期偏好写入格式不稳定 | `smoke-memory-api.mjs`、`smoke-memory-manager.mjs` |
| 商户优惠证据断裂 | `smoke-deal-search.mjs` |
| 商户媒体字段缺失导致小程序卡片空白 | `smoke-merchant-media.mjs` |
| 商户解释 prompt 没有 rank/score 差异 | `smoke-offer-explanation-prompt.mjs` |
| 后台数据维护接口误伤数据 | `smoke-admin.mjs` |

## 推荐验证顺序

开发小改动时：

```bash
npm run check
```

改推荐、记忆或问小汪时：

```bash
npm run smoke:session
npm run smoke:offer-ranking
npm run smoke:memory-intelligence
```

上线前或比赛前：

```bash
npm run smoke:session
npm run smoke:deals
npm run smoke:memory
npm run smoke:memory-api
npm run smoke:memory-intelligence
npm run smoke:offer-prompt
```

## 产品价值

LifePilot 的体验链路很长，单靠手点小程序很难保证稳定。smoke tests 让“问小汪、挑饭、汪记本、记忆复盘”这些核心能力可以被快速验证，也防止清理旧代码时误伤主线。

## 运行方式

```bash
npm run check
npm run smoke:session
npm run smoke:memory-intelligence
```
