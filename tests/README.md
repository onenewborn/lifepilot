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

## 产品价值

LifePilot 的体验链路很长，单靠手点小程序很难保证稳定。smoke tests 让“问小汪、挑饭、汪记本、记忆复盘”这些核心能力可以被快速验证，也防止清理旧代码时误伤主线。

## 运行方式

```bash
npm run check
npm run smoke:session
npm run smoke:memory-intelligence
```

