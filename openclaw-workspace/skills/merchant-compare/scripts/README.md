# scripts

这个目录保存 `merchant-compare` 的可执行工具脚本。

## 当前脚本

- `merchant_compare_tool.py`：调用商户解析、候选搜索和 `/api/tools/merchant-compare-context`。

## 使用原则

内部 ID 必须来自上下文或 resolver，不要猜。后端只提供证据，最终解释由小汪基于证据生成。

