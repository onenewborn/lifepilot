# 项目驾驶舱

更新时间：2026-05-30

## 一句话

LifePilot 正在从 `~/.openclaw/workspace` 中拆出，重建为一个干净的产品 runtime；OpenClaw 继续作为小汪的 agent runtime，负责 skills、后台智能、记忆复盘和互动生成。

## 当前核心决策

采用双 runtime 架构：

```text
小程序 / 产品后端
  负责 meal session、chat thread、memory CRUD、推荐规则、数据合同、COS 资产解析、低延迟 Ark/Doubao AI 调用

OpenClaw Runtime
  负责 AGENTS/SOUL/skills、后台任务、小汪互动内容、视频/内容生成、候选记忆复盘
```

OpenClaw 必须通过产品后端 API 访问产品状态，不能直接读取或修改产品 runtime 文件。

## 旧 Workspace 安全状态

旧 workspace 保持原路径不动：

```text
/Users/mona/.openclaw/workspace
```

完整备份：

```text
/Users/mona/.openclaw/backups/lifepilot-workspace-20260530-120256
```

旧 workspace git checkpoint：

```text
commit: d741a9e chore: checkpoint before lifepilot rebuild
tag: lifepilot-rebuild-base-20260530
```

checkpoint 后旧 workspace 仍有两个未跟踪目录：

```text
?? memory/users/smoke_test_evermind_1780043397065/
?? memory/users/smoke_test_evermind_ipv4_1780044939954/
```

它们看起来是 smoke test 残留，没有进入 checkpoint commit。

## 产品范围

当前主产品：

```text
饭点定了小程序
```

主流程：

```text
入口表单
→ 餐饮方向卡
→ 方向卡左右滑
→ 低延迟 AI 方向总结
→ Offer 卡
→ Offer 卡左右滑
→ 最终推荐
→ 天气 / 排队 / 路线上下文
→ 反馈 / 候选记忆
→ 小汪互动
```

## AI 边界

实时卡流：

```text
Ark Doubao Seed 1.6 Flash API
```

后台 / agentic intelligence：

```text
OpenClaw skills
```

权威记忆：

```text
产品后端 memory service
```

LLM 和 OpenClaw 可以提出候选记忆。只有产品后端 memory service 可以创建、更新、暂停、删除、确认或拒绝权威 memory 记录。

## 当前进展

P0.5 实施合同已完成：

```text
docs/contracts/api-errors.md
docs/contracts/food-cards.md
docs/contracts/config.md
docs/contracts/legacy-api-map.md
```

P1 最小后端已完成：

```text
GET /api/health
GET /api/food-directions
POST /api/session/start
POST /api/session/swipe
GET /api/session/:id
```

已完成验证：

```text
npm run check
npm run smoke:session
```

Smoke 结果：

```text
18 张方向卡
marker: lifepilot-next-p1
session start/swipe/view 通过
缺失 session 返回 error.code=session_not_found
skip 等非 canonical action 被拒绝
```

## 产品语义校正

饭点卡流只有两个 canonical swipe action：

```text
keep     右滑保留
dislike  左滑放弃
```

`skip` 和 `super_like` 不再作为用户滑卡事件进入 `direction_events`。用户非常喜欢某个方向时，应走“看这个方向的店”这类推进意图，而不是写成特殊 swipe action。

## 下一步

P2 增加 Ark/Doubao realtime AI provider，并迁移方向总结：

```text
POST /api/session/advance
```

当 session 处于 `stage=direction` 时，第一次 `advance` 应生成 `direction_summary`，把 session 推进到 `stage=direction_summary`，并把确定性本地 fallback 当成一等路径。

## 硬规则

每个实施阶段结束时必须回答：

```text
1. 哪个旧职责已经迁入新产品仓库？
2. 哪个新路由/模块开始承接真实行为？
3. 哪个 smoke test 证明旧用户体验没有被悄悄打断？
```
