# scripts

这个目录保存 `deal-search` 的可执行工具脚本。

## 当前脚本

- `deal_search_tool.py`：调用 LifePilot 后端 `/api/tools/deal-search-context`，返回优惠证据上下文、结果卡和 trace。

## 使用原则

脚本必须显式传入可访问的 `--api-base` 和当前 `--user-id`。如果没有优惠证据，应返回暂无证据，而不是编造实时团购。

