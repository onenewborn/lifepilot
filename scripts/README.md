# scripts

这个目录预留给仓库级脚本。当前主要检查和 smoke 流程都通过 `package.json` 中的 npm scripts 调用，暂时没有必须放在这里的脚本。

## 适合放什么

- 一次性但可复用的部署辅助脚本。
- 数据检查、资产校验、批量迁移等仓库级工具。
- 不属于 OpenClaw skill 的本地维护脚本。

## 不适合放什么

- 产品后端运行时代码。
- OpenClaw skill 脚本，这类脚本应放在 `openclaw-workspace/skills/*/scripts/`。
- 带密钥、运行态数据或私有路径的临时文件。

