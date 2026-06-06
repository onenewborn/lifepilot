# docs

这个目录保存 LifePilot 的架构、合同、计划和交接文档。它帮助新会话快速理解项目边界，也让前端、后端、OpenClaw 和记忆系统之间的协作有明确依据。

## 支持能力

- 项目交接：`HANDOFF_2026-06-05.md` 记录当前准源、部署方式和下一步。
- 系统计划：Memory Intelligence、商户口碑、COS 等方案文档。
- 合同文档：API、配置、卡片、记忆、资产等跨模块约定。
- 决策记录：记录为什么要拆分产品 runtime 和 OpenClaw runtime。
- 历史归档：`archive/` 保存迁移期和旧阶段资料。

## 推荐阅读顺序

如果是评审或新接手的人，建议按这个顺序读：

1. `../README.md`：产品亮点、架构图、部署和目录地图。
2. `HANDOFF_2026-06-05.md`：当前云端、本地、GitHub 和 OpenClaw workspace 状态。
3. `contracts/session-api.md`：饭点 session 和 day context 如何流转。
4. `contracts/memory.md`：记忆账本、待确认记忆、长期偏好和 Memory Intelligence。
5. `PHASE5_MEMORY_INTELLIGENCE_PLAN.md`：为什么统一 Memory Intelligence，手动日/周复盘怎么做。
6. `MERCHANT_REPUTATION_SKILLS_PLAN.md`：商户证据和 agent skills 如何支持解释。

## 文档分类

| 子目录/文件 | 用途 |
| --- | --- |
| `contracts/` | 前端、后端、数据、agent 之间的接口合同 |
| `decisions/` | 关键架构决策记录 |
| `archive/` | 历史迁移记录和旧问题总结 |
| `lifepilot-academic-architecture.svg` | README 顶部的学术架构图 |
| `HANDOFF_2026-06-05.md` | 当前项目交接入口 |

## 产品价值

LifePilot 是一个多 runtime 项目，不只是一个小程序页面。文档让复杂系统保持可解释：用户体验、推荐证据、记忆权威、agent 工具和部署流程都能被追踪。

## 维护原则

- 新的权威状态优先写入最新 handoff 或合同文档。
- 旧阶段资料放入 `archive/`，不要让历史判断干扰当前主线。
- 合同文档应描述真实已实现或明确计划的边界，避免空泛愿景。
