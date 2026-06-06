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

## Skill 与产品功能对应关系

| Skill | 用户会怎么触发 | 输出/动作 |
| --- | --- | --- |
| `meal-swipe` | “今天吃什么”“想吃川菜”“直接帮我选” | 创建饭点 session，返回小程序可打开的滑卡卡片 |
| `memory-search` | “我之前是不是说过喜欢川菜” | 只读检索相关长期记忆和 session 线索 |
| `memory-capture` | 用户明确表达偏好，例如“以后少推荐排队久的店” | 生成待确认记忆候选，不直接写长期偏好 |
| `memory-manager` | “记住这个”“删掉那条偏好” | 在用户明确授权后调用后端记忆管理 API |
| `diary-review` | “看看今天记录”“打开汪记本” | 读取今日小结、本周小结、画像和待确认记忆 |
| `lifepilot-memory-intelligence` | 汪记本复盘、日/周整理 | 约束复盘输出，不把聊天记录粗暴堆进 prompt |
| `merchant-intel` | “这家怎么样” | 基于后端证据解释商户优缺点 |
| `merchant-compare` | “这几家哪家更适合” | 对比候选商户，强调适配场景和风险 |
| `deal-search` | “有什么优惠吗” | 查询 deal seed，解释性价比线索 |
| `session-memory` | agent 需要理解本轮饭点上下文 | 读取 session/day context 摘要 |

## 为什么这些 skills 是创新点

普通聊天助手只能“回答”。这里的 skills 让小汪能在产品边界内“行动”：创建滑卡、检索记忆、提交候选记忆、读取汪记本、查询商户证据。所有行动都经过产品后端 API，因此既有 agent 协作能力，又保留可审计和可控性。

## 产品价值

这些 skills 让小汪从“能聊天”变成“能行动”。但行动不是越权：商户事实来自后端工具，长期记忆必须确认，优惠只说可控线索，不伪装成实时平台数据。

## 维护原则

- 每个 skill 应有清楚的使用时机和禁止事项。
- 需要脚本调用的 skill，把脚本放在自己的 `scripts/` 目录。
- 不再属于饭点 runtime 的 skill 不应放在这里。
