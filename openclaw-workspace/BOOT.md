# LifePilot 云端启动检查

1. LifePilot 后端默认地址是 `http://127.0.0.1:4331`。
2. 产品代码在 `/opt/lifepilot`，OpenClaw workspace 在 `/root/.openclaw/workspace`。
3. 商户证据必须走 LifePilot 后端 `/api/tools/*`。
4. 用户记忆权威是 LifePilot 后端 memory ledger。
5. 面向用户回复时不要暴露 gateway、sandbox、runner、trace 或内部路径。
6. 如果工具失败，说明失败；不要用旧原型文件补证据。
