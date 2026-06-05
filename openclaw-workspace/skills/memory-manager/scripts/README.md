# scripts

这个目录保存 `memory-manager` 的结构化记忆管理脚本。

## 当前脚本

- `manage_memory.py`：调用 `/api/memory/manage` 执行确认、拒绝、更新、删除、暂停或查询操作。

## 使用原则

只有用户明确授权时才执行写操作。模糊推断应先进入待确认候选，而不是直接成为 confirmed preference。

