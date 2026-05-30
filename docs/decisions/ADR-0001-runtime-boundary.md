# ADR-0001 Runtime 边界

日期：2026-05-30

## 状态

已接受。

## 背景

旧的 `~/.openclaw/workspace` 混在了一起：

```text
产品前端
产品后端
数据
资产
OpenClaw runtime 配置
skills
outputs
历史实验
```

这会导致 OpenClaw 启动上下文过大，也让产品重构风险变高。

## 决策

把产品前端、后端、数据和合同迁到独立产品仓库：

```text
/Users/mona/Documents/lifepilot
```

OpenClaw runtime 保持在：

```text
/Users/mona/.openclaw/workspace
```

OpenClaw 通过产品后端 API 访问产品状态。

## 影响

好处：

- 产品架构更清楚
- 实时 AI 路径更快
- OpenClaw 上下文污染更少
- 比赛叙事更明确

代价：

- 需要维护 OpenClaw 和产品后端之间的 API bridge
- session、memory、assets、jobs 必须有明确合同
- 不能再依赖 OpenClaw 隐式读取产品文件
