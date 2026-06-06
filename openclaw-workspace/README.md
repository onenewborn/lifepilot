# openclaw-workspace

这个目录是 LifePilot 提供给 OpenClaw agent runtime 的 workspace 快照。它不包含产品源码的权威实现，而是包含小汪的行为边界、工具说明、记忆原则和可执行 skills。

## 支持能力

- 小汪人格和回复风格：`SOUL.md`、`IDENTITY.md`、`USER.md`。
- Agent 操作规则：`AGENTS.md`、`TOOLS.md`、`BOOT.md`。
- 记忆边界：`MEMORY.md`。
- 当前运行时 skills：饭点滑卡、商户理解、商户对比、优惠查询、记忆搜索、记忆管理、汪记本和 Memory Intelligence。

## 如何放进 OpenClaw

这个目录可以直接作为 OpenClaw workspace 使用。迁移时建议先备份原 workspace，再用本目录替换：

```bash
mv ~/.openclaw/workspace ~/.openclaw/workspace.backup
cp -R /path/to/lifepilot/openclaw-workspace ~/.openclaw/workspace
```

OpenClaw 模型建议选择 Kimi coding 模型：

```text
kimi/kimi-for-coding
```

工具执行环境需要能访问 LifePilot 后端。OpenClaw 和后端在同一台机器时：

```bash
export LIFEPILOT_API_BASE=http://127.0.0.1:4331
export LIFEPILOT_OPENCLAW_API_BASE=http://127.0.0.1:4331
```

如果 OpenClaw 和后端不在同一台机器，把上面的地址改成 LifePilot 后端公网地址。

## 产品价值

LifePilot 的 AI agent 不是一个黑盒聊天模型。OpenClaw workspace 让小汪知道什么时候该调用工具、什么时候不能编造证据、什么时候必须请求用户确认记忆。它把“陪伴感”和“可审计性”放在同一个系统里。

## 运行边界

- 产品后端是 session、商户证据和记忆账本的权威。
- OpenClaw 负责自然语言理解、工具编排和小汪口吻解释。
- Skills 必须通过 LifePilot 后端 API 获取证据，不直接读取产品数据文件。
- 内容/视频生产线不属于当前运行时 workspace。
