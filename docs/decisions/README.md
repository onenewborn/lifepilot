# decisions

这个目录保存架构决策记录。它解释项目为什么选择某种边界，而不仅仅记录“现在是什么”。

## 当前决策

- `ADR-0001-runtime-boundary.md`：说明为什么把产品前端/后端/数据从旧 OpenClaw workspace 中拆到独立仓库，并让 OpenClaw 通过后端 API 访问产品状态。

## 产品价值

LifePilot 同时包含产品 runtime 和 agent runtime。如果边界不清，agent 很容易直接读取文件、绕过后端账本或污染推荐证据。决策记录帮助项目保持长期可维护。

## 维护原则

- 重要架构转向都应新增 ADR。
- ADR 记录决策背景、取舍和影响，不写成普通待办。

