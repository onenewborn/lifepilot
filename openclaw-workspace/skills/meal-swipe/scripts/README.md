# scripts

这个目录保存 `meal-swipe` 的可执行脚本。

## 当前脚本

- `start_offer_flow.py`：调用 `/api/meal/primitive/start-offers`，创建商户阶段滑卡 session，并可结合记忆搜索和候选商户。

## 使用原则

脚本必须使用当前用户的 `--user-id`。如果用户说“按我之前的偏好”，应先检索记忆，并把可用偏好转成当前轮的软偏好。

