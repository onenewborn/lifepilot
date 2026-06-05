# openclaw-bridge

这个目录预留给 LifePilot 和 OpenClaw runtime 之间的桥接材料。当前主链路已经通过后端 `openclaw-gateway-client.mjs` 和 `openclaw-workspace/skills` 完成联动，因此这里暂时不承载正式代码。

## 预期用途

- 保存桥接协议实验。
- 放置未来独立网关、代理或同步脚本。
- 记录 OpenClaw 与 LifePilot 后端之间的集成辅助材料。

## 当前边界

当前真实产品运行不要依赖这个目录。OpenClaw 调用产品能力时，应通过后端 API 和 workspace skills 完成，不直接读取产品数据文件。

