# Evermind 记忆接入合同（已废弃）

更新时间：2026-06-04

## 状态

当前比赛版本已移除 Evermind 主链路。

LifePilot 不再：

```text
同步 confirmed preference 到 Evermind
在 session finalize 时写 Evermind session summary
在推荐、问小汪或商户解释 prompt 中检索 Evermind weak memories
在 memory ledger 中暴露 Evermind provider status
```

## 当前权威

LifePilot 后端本地 JSON 账本是唯一记忆权威。

```text
data/runtime/memory/users/<user_id>/preferences.json
data/runtime/memory/users/<user_id>/memory_candidates.json
data/runtime/memory/users/<user_id>/memory_observations.json
data/runtime/memory/users/<user_id>/food_insight_profile.json
data/runtime/memory/users/<user_id>/recommendation_signals.json
```

## 历史说明

本文件保留为历史合同占位，避免误以为 Evermind 仍是当前架构的一部分。

未来如果需要外部 memory provider，应作为独立插件重新设计，并且不得替代 LifePilot 本地 confirmed preferences 的权威地位。
