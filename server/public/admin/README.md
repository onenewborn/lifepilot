# admin

这个目录保存 LifePilot 后端的浏览器后台页面。它不是用户端产品界面，而是数据维护和调试工具。

## 支持能力

- `merchant-admin.html`：维护方向、商户、offer、deal、口碑和资产上传。
- `memory-debug.html`：只读查看 Memory Pipeline，帮助理解 observations、jobs、candidates 和 preferences 的流转。

## 产品价值

LifePilot 强调“有证据的 AI 推荐”。后台工具让团队可以快速补充和修正商户证据、媒体资产和优惠线索，从而让小汪的解释更可信。

## 安全提醒

云端开启后台接口时应设置 `LIFEPILOT_ADMIN_TOKEN`。后台页面是维护工具，不应暴露给普通用户。

