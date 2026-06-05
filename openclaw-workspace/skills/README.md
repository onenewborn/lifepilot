# skills

这个目录保存 LifePilot 当前可用的 OpenClaw skills。每个 skill 都是一项可被小汪调用的产品能力，负责把自然语言请求转成后端可审计的工具调用或结构化动作。

## 当前 skills

- `meal-swipe`：创建饭点滑卡入口。
- `merchant-intel`：单店商户理解。
- `merchant-compare`：多店对比和候选发现。
- `deal-search`：优惠和团购线索。
- `memory-search`：只读检索记忆账本。
- `session-memory`：读取饭点 session 和 day context 摘要。
- `memory-capture`：生成待确认记忆候选。
- `memory-manager`：执行用户明确授权的记忆管理操作。
- `diary-review`：读取汪记本上下文。
- `lifepilot-memory-intelligence`：统一记忆智能和复盘规则。

## 产品价值

这些 skills 让小汪从“能聊天”变成“能行动”。但行动不是越权：商户事实来自后端工具，长期记忆必须确认，优惠只说可控线索，不伪装成实时平台数据。

## 维护原则

- 每个 skill 应有清楚的使用时机和禁止事项。
- 需要脚本调用的 skill，把脚本放在自己的 `scripts/` 目录。
- 不再属于饭点 runtime 的 skill 不应放在这里。

