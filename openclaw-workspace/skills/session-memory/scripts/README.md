# scripts

这个目录保存 `session-memory` 的只读 session 检索脚本。

## 当前脚本

- `session_memory_tool.py`：调用 `/api/session/memory`，返回 compact meal sessions 和 day context 摘要。

## 使用原则

只引用工具返回的 session，不要声称用户真实消费、下单或评分，除非后端证据明确存在。

