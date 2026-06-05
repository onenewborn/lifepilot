# LifePilot 工具

## 产品后端

当前产品仓库：

```bash
cd /opt/lifepilot
npm run check
```

OpenClaw skills 使用的公网 API base：

```text
http://110.42.208.125
```

健康检查：

```bash
curl http://110.42.208.125/api/health
```

## 商户证据工具

使用本 workspace 里的 skill 脚本：

```bash
python3 skills/merchant-intel/scripts/merchant_intel_tool.py \
  --api-base http://110.42.208.125 \
  --merchant-name "汪记豆花"

python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --api-base http://110.42.208.125 \
  --merchant-names "汪记豆花,川香楼"

python3 skills/deal-search/scripts/deal_search_tool.py \
  --api-base http://110.42.208.125 \
  --merchant-name "椒香巷川味小馆" \
  --party-size 1 \
  --question "这家一个人有没有优惠，怎么吃更划算"
```

处理模糊需求对比时，OpenClaw 需要先把用户自然语言理解成结构化偏好，再通过 `--preference-json` 传入：

```bash
python3 skills/merchant-compare/scripts/merchant_compare_tool.py \
  --api-base http://110.42.208.125 \
  --query "想吃辣一点，但别太油，也别排队太久" \
  --preference-json '{"food_preferences":{"flavor_tags":["spicy"],"spice_level":{"target":"medium","operator":"gte"},"oil_level":{"target":"medium","operator":"lte"}},"constraints":{"max_queue_risk":"medium","solo_friendly":true}}'
```

硬边界：

- 不要读取 workspace 本地商户 JSON 或 offer JSON 作为 fallback。
- 不要编造内部商户 id。内部 id 必须形如 `m_futian_025`；面向用户的店名应该走 resolver/search。
- 后端工具失败时，直接报告失败。
- `deal-search` 只返回 LifePilot 可控优惠线索；不要声称真实平台实时可领、可核销或已经下单。

## 饭点滑卡触发

当用户想让小汪帮忙决定吃什么、需要进入 LifePilot 卡片流程时，使用 `meal-swipe`。

泛需求不创建 session，只返回打开需求确认页的按钮：

```json
{
  "skill": "meal_swipe",
  "action": "open_meal_entry",
  "cta": "去确认需求",
  "payload": {
    "prefill_text": "今天中午不知道吃什么"
  }
}
```

明确需求或点名商户对比，使用脚本直接创建商户卡 session：

```bash
python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base http://110.42.208.125 \
  --source-message "我想吃川菜" \
  --entry-mode offer_only

python3 skills/meal-swipe/scripts/start_offer_flow.py \
  --api-base http://110.42.208.125 \
  --source-message "川香楼和汪记豆花怎么选" \
  --entry-mode merchant_compare \
  --merchant-names "川香楼,汪记豆花"
```

脚本输出里的 `skill_card` 可以直接放进问小汪 JSON 的 `skill_cards`。

硬边界：

- 如果用户需求已经足够明确，例如“我想吃川菜”“找环境好一点”“附近少排队”“适合一个人”，必须调用 `start_offer_flow.py`，不要只给文字推荐或把入口放进 `skill_result_cards`。
- 如果最终回复里出现“直接滑卡”“开始滑卡”“我给你准备好了商户卡”，则最终 JSON 的 `skill_cards` 必须包含 `action: "open_meal_session"`。
- 只有泛需求、还需要确认人数/预算/口味时，才返回 `action: "open_meal_entry"`。
- 点名商户对比时，merchant-compare 的证据卡放入 `skill_result_cards`，meal-swipe 生成的滑卡入口放入 `skill_cards`。

测试/调试完整产品流程时可用的后端接口：

```text
POST /api/session/start
POST /api/session/swipe
POST /api/session/advance
POST /api/session/finalize
POST /api/meal/primitive/start-offers
```

## 记忆辅助工具

统一记忆智能入口：

```text
lifepilot-memory-intelligence
```

模式：

```text
instant_review   即时单条 observation 审查
day_dreaming     日级复盘，旧 lifepilot-dreaming 兼容入口
week_dreaming    跨天重复模式分析
profile_update   FCQ / 新奇接受度 / reward profile 汪记本画像
```

后端兼容 API：

```text
GET  /api/memory/search
GET  /api/session/memory
POST /api/memory/candidates
GET  /api/memory/intelligence/input
POST /api/memory/intelligence/result
POST /api/memory/intelligence/run
GET  /api/memory/intelligence/jobs
GET  /api/memory/observations
POST /api/memory/observations
POST /api/memory/manage
```

OpenClaw 可以读取 compact 记忆对象、读取 compact session memory、创建 pending candidate、提交 observation、执行用户明确授权的 memory_manage。不能绕过用户确认直接把推断写成 confirmed preference。

结构化记忆辅助脚本：

```bash
python3 skills/memory-search/scripts/memory_search_tool.py \
  --api-base http://110.42.208.125 \
  --query "川菜 少排队"

python3 skills/session-memory/scripts/session_memory_tool.py \
  --api-base http://110.42.208.125 \
  --day-id day_20260605_demo_weiyingru \
  --query "川菜"

python3 skills/memory-capture/scripts/create_candidate.py \
  --api-base http://110.42.208.125 \
  --confirmation-text "以后川菜优先少油少排队" \
  --category cuisine_context \
  --polarity positive

python3 skills/memory-manager/scripts/manage_memory.py \
  --api-base http://110.42.208.125 \
  --operation confirm_latest_pending

python3 skills/diary-review/scripts/diary_context_tool.py \
  --api-base http://110.42.208.125 \
  --include-day-context
```

对应 skills：

```text
memory-search
session-memory
memory-capture
memory-manager
diary-review
```

问小汪即时聊天中的长期偏好，例如“以后少推荐排队久的店”，必须输出结构化待确认候选：

```json
{
  "skill_calls": [
    {
      "skill": "memory_capture",
      "reason": "用户表达长期推荐偏好，需要创建待确认记忆候选。",
      "args": {
        "confirmation_text": "以后少推荐排队久的店",
        "text": "主人，要不要让我以后少推荐排队久的店？",
        "evidence": {
          "source": "user_message",
          "message": "以后少推荐排队久的店"
        }
      }
    }
  ],
  "memory_prompts": [
    {
      "text": "主人，要不要让我以后少推荐排队久的店？",
      "confirmation_text": "以后少推荐排队久的店"
    }
  ]
}
```

如果没有 `skill_calls` 或 `memory_prompts`，LifePilot 前端和后端都不会产生待确认入口。不要只在自然语言里说“我先整理成待确认偏好”。

## 媒体辅助工具

`data/po4.jpg` 只是本地媒体夹具，不是商户证据。

媒体发送测试：

```bash
scripts/send_feishu_image_card_safe.sh
scripts/send_feishu_media_safe.sh
```
