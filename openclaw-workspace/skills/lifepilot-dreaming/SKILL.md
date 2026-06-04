---
name: lifepilot-dreaming
description: Use this skill when LifePilot needs OpenClaw to run an offline dream review for a user's day_context, compare the day with confirmed memory and recent evidence, produce pending memory candidates, merchant feedback insights, and Xiaowang interaction ideas, then submit the result back to the LifePilot backend. This skill must not directly modify product runtime files or confirmed preferences.
category: memory
summary: LifePilot 后台 dreaming 复盘 skill。
---

# LifePilot Dreaming

## 与统一记忆智能的关系

`lifepilot-dreaming` 是旧兼容入口。新的统一机制是：

```text
lifepilot-memory-intelligence mode=day_dreaming
```

继续使用本 skill 时，语义上等价于运行 day-level memory intelligence：读取当天 day_context、meal sessions、observations、pending candidates 和 confirmed preferences，输出日总结、待确认候选、互动建议和可用于汪记本的洞察。

即时单条审查使用 `lifepilot-memory-intelligence mode=instant_review`；跨天模式使用 `week_dreaming`；FCQ/新奇接受度/reward profile 使用 `profile_update`。

## 何时使用

- 用户要求“小汪做复盘”“dreaming”“后台总结今天饭点”。
- 需要从 day_context、meal_session、餐后反馈和商户反馈里提炼候选记忆。
- 需要给小汪生成下一次主动互动建议。
- 需要检查某一天的饭点轨迹是否形成短期状态、场景偏好或长期偏好候选。

## 核心边界

LifePilot 产品后端是唯一记忆权威。

本 skill 只能：

- 通过 LifePilot 后端 API 读取 dream input。
- 基于输入里的证据做语义复盘。
- 生成 pending memory candidates。
- 生成 preference update suggestions。
- 生成 merchant feedback insights。
- 生成 xiaowang next interaction ideas。
- 通过 LifePilot 后端 API 提交 dream result。

本 skill 不能：

- 直接读写 `/opt/lifepilot/data/runtime`。
- 直接修改 OpenClaw 本地 memory markdown 当作产品记忆。
- 直接创建 confirmed preference。
- 直接改 meal session。
- 直接发送推送、文章、小游戏或互动卡片。
- 把一次滑卡或一次临时状态写成长期偏好。

## 默认后端

默认连接本机 LifePilot 后端：

```bash
export LIFEPILOT_API_BASE=http://127.0.0.1:4331
```

如果后端端口不同，先设置：

```bash
export LIFEPILOT_API_BASE=http://127.0.0.1:<port>
```

## 手动运行

推荐使用总入口：

```bash
python3 skills/lifepilot-dreaming/scripts/run_dream.py \
  --user-id demo_weiyingru \
  --day-id day_20260530_demo_weiyingru \
  --submit
```

只生成本地草稿，不提交：

```bash
python3 skills/lifepilot-dreaming/scripts/run_dream.py \
  --user-id demo_weiyingru \
  --day-id day_20260530_demo_weiyingru \
  --output /tmp/lifepilot-dream-result.json
```

分步运行：

```bash
python3 skills/lifepilot-dreaming/scripts/fetch_dream_input.py \
  --user-id demo_weiyingru \
  --day-id day_20260530_demo_weiyingru \
  --output /tmp/dream-input.json

python3 skills/lifepilot-dreaming/scripts/build_dream_result.py \
  --input /tmp/dream-input.json \
  --output /tmp/dream-result.json

python3 skills/lifepilot-dreaming/scripts/validate_dream_result.py \
  --input /tmp/dream-result.json

python3 skills/lifepilot-dreaming/scripts/submit_dream_result.py \
  --input /tmp/dream-result.json
```

## Dreaming 工作流

1. 读取 `GET /api/openclaw/dream-input`。
2. 检查 schema、policy 和 allowed outputs。
3. 只使用 dream input 里的证据。
4. 按规则提取 daily_summary、stable_signals、situational_signals。
5. 生成 memory_candidates，但所有候选都必须带 evidence。
6. 用脚本校验候选：statement、confidence、evidence、敏感文本、单次滑卡上限。
7. 提交 `POST /api/openclaw/dream-result`。
8. 后端保存 job 和 pending candidates；是否确认由产品后端和用户决定。

## 证据分层

强证据：

- 用户明确餐后反馈。
- 用户明确说“记住”“以后”“下次别”。
- 最终选择 + 正/负评分。

中等证据：

- 多次 meal session 重复出现同类最终选择。
- 同一天 keep 和最终选择方向一致。
- 商户反馈标签多次重复。

弱证据：

- 单次 keep。
- 单次 dislike。
- 入口里的临时状态，例如“今天累”“今天想清淡”。

弱证据只能进入 daily summary 或 situational signal，不能单独生成长期偏好候选。

## 归纳规则

输出分四层：

```text
daily_summary
stable_signals
situational_signals
memory_candidates
```

写 memory candidate 时要区分：

- `long_term_preference`：需要多次证据或用户明确长期意图。
- `situational_preference`：只在特定场景成立，例如下班疲惫时。
- `merchant_experience`：对某家店的体验，不等于全局口味偏好。
- `preference_update_suggestion`：和已有 confirmed preference 有冲突或需要修正。

## 语气

这是后台复盘，不是面向用户的长报告。结果要克制、可审计、便于后端处理。

如果生成小汪互动建议，可以亲近一点，但不要频繁打扰用户，不要用“长期喜欢/长期偏好”这类像读档案的表达。

## 当前限制

- 第一版只用规则权重和轻量归纳，不使用 embedding。
- 不做聚类。
- 不拉 7 天历史；等后端 dream input 支持 `lookback_days` 后再接。
- 不注册 cron；先手动跑通。
