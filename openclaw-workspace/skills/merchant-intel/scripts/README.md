# scripts

这个目录保存 `merchant-intel` 的单店证据脚本。

## 当前脚本

- `merchant_intel_tool.py`：调用 `/api/tools/merchant-intel-context`，返回商户证据、结果卡和 trace。

## 使用原则

工具失败时应报告失败，不要回退读取本地旧数据。商户评分和口碑必须来自后端证据。

