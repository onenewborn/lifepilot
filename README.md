# LifePilot

LifePilot 是“饭点定了”小程序和产品后端的新工程目录。

这个仓库刻意从 OpenClaw runtime workspace 中独立出来。产品工程不再长期放在 `~/.openclaw/workspace` 里，避免前端、后端、数据、素材和旧实验污染 agent 工作上下文。

比赛交付版同时包含一份云端 OpenClaw agent workspace 的干净快照：

```text
openclaw-workspace/
```

这份快照来自云端 `/root/.openclaw/workspace`，只保留 agent 规则、skills、脚本和 schema 文档；不包含 OpenClaw 运行状态、临时输出、用户记忆运行时或密钥。

## Runtime 边界

- 本仓库负责产品 runtime：小程序、后端 API、饭点 session、memory CRUD、推荐规则、数据合同和资产合同。
- OpenClaw 负责 agent runtime：`openclaw-workspace/AGENTS.md`、`SOUL.md`、skills、后台任务、内容生成、记忆复盘和小汪互动。
- OpenClaw 通过产品后端 API 读取和提交产品上下文，不直接修改产品数据库文件。

## 当前状态

每次继续工作前，先读：

- [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)
- [docs/MIGRATION_PHASES.json](docs/MIGRATION_PHASES.json)
- [docs/contracts/session-api.md](docs/contracts/session-api.md)
- [docs/contracts/api-errors.md](docs/contracts/api-errors.md)
- [docs/contracts/food-cards.md](docs/contracts/food-cards.md)
- [docs/contracts/memory.md](docs/contracts/memory.md)
- [docs/contracts/ai-provider.md](docs/contracts/ai-provider.md)
- [docs/contracts/config.md](docs/contracts/config.md)
- [docs/contracts/assets.md](docs/contracts/assets.md)
- [docs/contracts/legacy-api-map.md](docs/contracts/legacy-api-map.md)
- [docs/contracts/openclaw-jobs.md](docs/contracts/openclaw-jobs.md)

## 当前可运行能力

P1 最小后端已经完成：

```text
GET  /api/health
GET  /api/food-directions
POST /api/session/start
POST /api/session/swipe
GET  /api/session/:session_id
```

运行检查：

```bash
npm run check
npm run smoke:session
```
