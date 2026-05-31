# 小汪食探 Skills 与商家口碑方案

更新时间：2026-05-31

## 一句话

LifePilot 接下来要补齐“商家理解与口碑判断”能力：后端负责沉淀可验证证据，OpenClaw 小汪负责基于证据做可解释判断，前端把判断展示成用户能直接行动的 skill card。

这不是把 LifePilot 做成普通推荐系统，而是把它推进成一个 OpenClaw 驱动的吃饭决策 agent：

```text
用户自然提问
  → OpenClaw 小汪判断需要哪个 skill
  → LifePilot 后端返回商家/区域/记忆证据包
  → OpenClaw 小汪做判断、排序和解释
  → LifePilot 后端落库 skill run / 候选记忆 / 复盘结果
  → 小程序展示小汪结果卡
```

## 核心原则

### OpenClaw First

问小汪的实时回答和 skill 调度应尽量 OpenClaw-first。LifePilot 后端不做“小汪的大脑”，只做：

```text
证据库
工具运行时
缓存/落库层
安全边界
失败兜底
```

后端可以清洗、聚合、归一化事实，但最终“哪家更好吃”“哪家更适合主人”“附近榜单怎么排”，由 OpenClaw 小汪基于证据判断。

### Evidence First

任何“更好吃 / 更推荐 / 排名更高”的结论，都必须引用证据。至少引用一种量化证据：

```text
5 星评分
评论数
好评 / 中评 / 差评数量和占比
标签提及数和占比
用户自己的选择 / 反馈 / 复访信号
```

小汪不能凭空说“这家更好吃”。如果证据不足，要说“我现在证据不够，只能按当前标签和主人偏好做初步判断”。

### 区分三种“更好”

商家判断不能只有一个“最好”。小汪需要区分：

```text
大众口碑更稳：评分、评论量、好评占比、差评风险更好。
更适合主人：更匹配长期偏好、待确认倾向、历史反馈。
更适合今天：更匹配当前需求，例如热乎、省心、近、少排队、两个人吃。
```

例如：

```text
瑞幸大众口碑和稳定性更好，幸运咖低价优势更明显。
如果主人今天只是想便宜解馋，幸运咖可以；如果要省心稳定，我会选瑞幸。
```

### 未确认记忆不能当事实

待确认记忆只能作为“倾向信号”，不能当作 confirmed preference 使用。

小汪可以说：

```text
我看到你可能有“少推荐排队久的店”的倾向，还没正式确认。
```

不能说：

```text
你已经确定不喜欢排队久的店。
```

## 为什么必须补商家口碑层

现在 LifePilot 已经能根据距离、预算、标签、排队、长期偏好做筛选，但还难以回答这类问题：

```text
都是咖啡店，为什么选瑞幸不选幸运咖？
都是川菜，为什么选汪记豆花不选四川小炒？
都是热汤粉面，哪家是真的更值得吃？
附近有什么必吃？
两家看起来差不多，哪家更适合我？
```

这些问题需要的不只是“商家标签”，而是商家评价和口碑证据：

```text
平台评分
评论量
好评 / 中评 / 差评分布
用户反复提到的正负标签
招牌菜和踩雷点
服务、排队、环境、出品稳定性
用户自己的饭后反馈和行为信号
```

## 新增 Skills

第一批新增 5 个小汪食探 skills。

### 1. merchant_intel

用途：

```text
理解单个商家：特色菜、新菜、口碑、适合场景、注意事项、到店小抄。
```

用户会这样问：

```text
这家有什么特色菜？
这家怎么吃？
这家是不是出了新菜？
这家适合我吗？
这家有什么要避雷的？
```

挑饭流程插入点：

```text
商家卡：问小汪这家
最终确认页：到店小抄 / 查特色菜 / 查排队风险 / 查优惠
```

后端 tool context：

```text
POST /api/tools/merchant-intel-context
```

输入：

```json
{
  "user_id": "demo_weiyingru",
  "merchant_id": "m_futian_006",
  "session_id": "meal_xxx",
  "question": "这家有什么特色菜"
}
```

输出给 OpenClaw 的证据：

```json
{
  "tool": "merchant_intel_context",
  "merchant": {},
  "merchant_reputation": {},
  "merchant_feedback": {},
  "user_memory": {},
  "current_need": {},
  "evidence_policy": {
    "final_judgment_owner": "openclaw",
    "must_cite_quantitative_evidence": true
  }
}
```

OpenClaw 输出卡：

```json
{
  "card_type": "merchant_intel_card",
  "title": "小汪到店小抄",
  "summary": "这家适合想吃热乎、省心的一顿。",
  "signature_dishes": [],
  "best_for": [],
  "watch_out": [],
  "evidence": []
}
```

### 2. merchant_compare

用途：

```text
比较 2-3 家类似店，判断哪家更好吃、哪家更适合主人、哪家更适合今天。
```

用户会这样问：

```text
瑞幸和幸运咖选哪个？
汪记豆花和四川小炒哪家更好吃？
这两家都像川菜，哪家更适合我？
这三家帮我比一下。
```

挑饭流程插入点：

```text
商家卡：加入对比
最终确认前：和刚才那家比一比
用户连续保留两三家类似商家时：小汪主动提示“要不要我帮你比一下”
```

后端 tool context：

```text
POST /api/tools/merchant-compare-context
```

OpenClaw 必须输出：

```text
更适合主人
大众口碑更稳
今天更稳
如果换场景，另一家什么时候更合适
引用证据
```

示例结论：

```text
如果按主人今天“有点累、想吃热乎下饭、省心”的需求，我会选汪记豆花。
它虽然不是评分唯一最高，但“下饭、锅气、两人好点菜”的评价更集中；四川小炒更像工作餐，胜在快和便宜。
```

### 3. party_ordering

用途：

```text
按人数给点菜建议：一个人、两个人、三个人怎么吃，预算怎么控，哪些菜适合共享。
```

用户会这样问：

```text
两个人怎么吃？
三个人怎么点不踩雷？
一个人来这家点什么？
预算 100 两个人怎么点？
```

挑饭流程插入点：

```text
最终确认页后：要不要小汪帮你看这家怎么点？
商家卡内：适合几个人吃
```

OpenClaw 输出卡：

```json
{
  "card_type": "party_ordering_card",
  "party_size": 2,
  "budget_hint": "人均 60-80",
  "ordering_plan": [],
  "avoid": [],
  "evidence": []
}
```

### 4. area_ranking

用途：

```text
生成附近吃饭排行榜，不是泛评分榜，而是按用户需求和口味生成多种榜。
```

用户会这样问：

```text
附近有什么必吃？
附近好吃的店排个榜。
附近热乎下饭榜。
附近适合一个人快吃的店。
```

榜单类型：

```text
适合主人榜
稳妥不踩雷榜
热乎下饭榜
清爽低负担榜
省心快吃榜
探索榜
```

后端提供候选和证据，OpenClaw 做最终排序和解释。

### 5. deal_search

用途：

```text
查团购、套餐、优惠券、券后人均、优惠适配场景。
```

短期先做 seed/mock 证据，不接实时外部平台。中期再接外部搜索和缓存。

用户会这样问：

```text
这家有团购吗？
有没有优惠？
哪家券后更划算？
两个人有没有套餐？
```

## 数据模型

### merchant_reputation

`merchant_reputation` 是商家口碑证据层，只存事实证据，不存后端主观综合分。

建议路径：

```text
data/runtime/merchant_reputation/{merchant_id}.json
```

结构：

```json
{
  "schema_version": "lifepilot.merchant_reputation.v1",
  "merchant_id": "m_futian_luckin_001",
  "merchant_name": "瑞幸咖啡",
  "updated_at": "2026-05-31T12:00:00.000Z",
  "sources": [
    {
      "source": "manual_seed",
      "url": "",
      "collected_at": "2026-05-31T12:00:00.000Z",
      "confidence": 0.8
    }
  ],
  "rating": {
    "score": 4.6,
    "scale": 5,
    "review_count": 1284,
    "source": "manual_seed",
    "confidence": 0.85
  },
  "review_distribution": {
    "positive": { "count": 930, "ratio": 0.724 },
    "neutral": { "count": 230, "ratio": 0.179 },
    "negative": { "count": 124, "ratio": 0.097 }
  },
  "reputation_tags": [
    {
      "tag": "出杯快",
      "sentiment": "positive",
      "count": 168,
      "ratio": 0.58,
      "evidence_text": "168 个用户提到出杯快，占可解析评价的 58%",
      "confidence": 0.78
    },
    {
      "tag": "奶味偏重",
      "sentiment": "mixed",
      "count": 200,
      "ratio": 0.7,
      "evidence_text": "200 个用户提到奶味偏重，占可解析评价的 70%",
      "confidence": 0.82
    }
  ],
  "signature_dishes": [
    {
      "name": "生椰拿铁",
      "sentiment": "positive",
      "count": 320,
      "ratio": 0.42,
      "reason": "提及量高，评价集中在稳定和券后便宜",
      "confidence": 0.84
    }
  ],
  "new_dishes": [],
  "negative_signals": [
    {
      "tag": "环境一般",
      "severity": "medium",
      "count": 88,
      "ratio": 0.11,
      "reason": "更适合外带，不适合久坐"
    }
  ],
  "queue_profile": {
    "risk": "medium",
    "evidence": "午间高峰等待较明显"
  },
  "deal_summary": [
    {
      "title": "券后奶咖更划算",
      "source": "manual_seed",
      "updated_at": "2026-05-31T12:00:00.000Z",
      "confidence": 0.6
    }
  ],
  "scenario_fit": {
    "solo_quick": { "level": "high", "reason": "出杯快、外带稳定" },
    "sit_down": { "level": "low", "reason": "门店环境和座位不稳定" },
    "two_people": { "level": "medium", "reason": "适合一人一杯，不适合正餐共享" }
  },
  "evidence": []
}
```

### merchant_skill_runs

用于缓存和回看 skill 结果。

```text
data/runtime/merchant_skill_runs/{run_id}.json
```

结构：

```json
{
  "schema_version": "lifepilot.merchant_skill_run.v1",
  "run_id": "msr_...",
  "skill": "merchant_compare",
  "user_id": "demo_weiyingru",
  "input": {},
  "context": {},
  "openclaw_result": {},
  "cards": [],
  "created_at": "2026-05-31T12:00:00.000Z"
}
```

## 后端文件设计

新增文件：

```text
server/src/merchant-reputation-store.mjs
server/src/merchant-tools.mjs
server/src/merchant-skill-runs.mjs
```

修改文件：

```text
server/src/app.mjs
server/src/xiaowang-store.mjs
server/src/openclaw-runner.mjs
```

### merchant-reputation-store.mjs

职责：

```text
读取商家 reputation
写入 / 更新手工 seed 或 OpenClaw 整理后的 reputation
按 merchant_id 批量读取
把用户反馈聚合成 reputation evidence
```

后端不输出“综合推荐分”。可以输出事实归一化字段：

```text
rating_level: high / medium / low / unknown
review_volume_level: large / medium / small / unknown
negative_risk_level: low / medium / high / unknown
evidence_confidence: high / medium / low
```

这些只是事实摘要，不代表最终判断。

### merchant-tools.mjs

职责：

```text
构造 merchant_intel_context
构造 merchant_compare_context
构造 party_ordering_context
构造 area_ranking_context
构造 deal_search_context
```

API：

```text
POST /api/tools/merchant-intel-context
POST /api/tools/merchant-compare-context
POST /api/tools/party-ordering-context
POST /api/tools/area-ranking-context
POST /api/tools/deal-search-context
```

### merchant-skill-runs.mjs

职责：

```text
存 OpenClaw skill 结果
给前端读取历史结果
给汪记本 / dreaming 复盘引用
```

## OpenClaw 设计

### lifepilot-xiaowang/SKILL.md

需要新增食探 skill 定义：

```text
merchant_intel
merchant_compare
party_ordering
area_ranking
deal_search
```

每个 skill 都要写：

```text
何时触发
需要哪些参数
调用哪个 LifePilot tool API
输出什么 card_type
必须引用哪些证据
禁止凭空判断
不能直接写产品 runtime 文件
```

### SOUL.md

需要强化小汪身份：

```text
小汪不是菜单搜索器，而是懂主人口味的吃饭决策伙伴。
先给判断，再给理由。
说人话，不堆报告。
证据不足时要承认不确定。
未确认记忆不能当事实。
```

### AGENTS.md

需要写清 workflow：

```text
1. 识别用户是在聊天、挑饭、查商家、比店、查区域榜、复盘。
2. 需要商家证据时，调用 LifePilot tool API。
3. 拿到证据后，由 OpenClaw 做最终判断。
4. 判断必须引用量化证据。
5. 输出结构化 skill result cards。
6. 慢任务和资料整理进入 dreaming，不阻塞实时聊天。
```

## 前端展示设计

统一展示为 skill result card，不把内部 API 暴露给用户。

### merchant_intel_card

展示：

```text
小汪结论
特色菜 / 新菜
适合什么场景
不适合什么场景
量化证据
注意事项
```

### merchant_compare_card

展示：

```text
小汪推荐哪家
更适合主人
大众口碑更稳
今天更稳
2-3 家横向比较
证据：评分、评论数、好评/差评、标签提及
```

### party_ordering_card

展示：

```text
几个人
推荐点法
预算
避雷
为什么这样点
```

### area_ranking_card

展示：

```text
榜单类型
Top 3 商家
每家一句适合理由
量化证据
可一键进入滑卡或对比
```

### deal_card

展示：

```text
优惠摘要
适合几个人
券后人均
来源
更新时间
置信度
```

## 产品入口设计

### 问小汪

问小汪是第一入口，承接开放需求：

```text
这家有什么特色菜？
附近有啥必吃？
瑞幸和幸运咖选哪个？
两个人怎么吃？
这三家哪家最适合我？
```

小汪通过 OpenClaw skills 调 tool API，返回聊天回复和 skill card。

### 挑饭流程

挑饭流程只在关键节点插入，不打断滑卡：

```text
商家卡：问小汪这家 / 加入对比 / 查特色菜
最终确认页：到店小抄 / 查优惠 / 看排队风险 / 两个人怎么点
连续保留两三家类似店：小汪提示“要不要我帮你比一比”
选定后：生成小汪到店小抄
```

## 数据来源路线

### 第一阶段：seed + 现有数据

先覆盖演示区域和典型对比：

```text
瑞幸 vs 幸运咖
云吞面 vs 轻食
汪记豆花 vs 四川小炒
粉面店 vs 快餐店
川菜馆 vs 湘菜馆
咖啡外带 vs 坐下聊天咖啡店
```

数据来源：

```text
手工 seed reputation
现有 merchants/offers
offer tags
用户滑卡行为
饭后反馈
confirmed preferences
pending memory candidates
```

### 第二阶段：OpenClaw dreaming 整理

让 OpenClaw 定期整理：

```text
商家 reputation evidence
用户反馈中的商家质量信号
区域榜单候选
适合主人的 taste profile
下一次互动建议
```

### 第三阶段：外部资料

接入外部搜索/平台摘要：

```text
地图 / 点评 / 小红书 / 团购页面 / 门店菜单
```

外部资料不进实时链路，先缓存、再复盘、再用于 skill。

## 实施路线

### Step 1：商家口碑证据层

目标：

```text
能读取 merchant_reputation，并在 compare/intel context 中返回量化证据。
```

要做：

```text
新增 merchant-reputation-store.mjs
新增 seed 数据 10-20 家
新增 reputation schema 校验/归一化
新增 /api/tools/merchant-intel-context
新增 /api/tools/merchant-compare-context
```

验收：

```text
瑞幸 vs 幸运咖 context 能返回评分、评论数、正中负占比、标签提及。
汪记豆花 vs 四川小炒 context 能返回口味标签、招牌菜、差评风险。
后端不输出最终推荐结论。
```

### Step 2：OpenClaw merchant_intel / merchant_compare

目标：

```text
OpenClaw 小汪能基于后端证据做商家理解和两店比较。
```

要做：

```text
更新 lifepilot-xiaowang/SKILL.md
更新 SOUL.md
更新 AGENTS.md
让 /api/xiaowang/chat 支持返回 skill_result_cards
新增 merchant_intel_card / merchant_compare_card 前端展示
```

验收：

```text
问“瑞幸和幸运咖选哪个”，小汪能区分场景并引用量化证据。
问“这家有什么特色菜”，小汪能输出特色菜和证据。
开发轨迹显示来源为 AI · OpenClaw，skill 为 merchant_compare 或 merchant_intel。
```

### Step 3：party_ordering 与最终确认页小抄

目标：

```text
选定商家后，小汪能告诉用户一人/两人/三人怎么吃。
```

要做：

```text
新增 /api/tools/party-ordering-context
新增 party_ordering_card
最终确认页加“到店小抄”
商家卡加“适合几个人吃”
```

验收：

```text
最终确认页可点击“小汪到店小抄”。
小汪能给两个人/三个人的点法、预算和避雷。
```

### Step 4：area_ranking

目标：

```text
小汪能生成附近排行榜，并解释为什么这些店上榜。
```

要做：

```text
新增 /api/tools/area-ranking-context
新增 area_ranking_card
后端返回候选和证据，OpenClaw 排序
支持“适合主人榜 / 稳妥榜 / 热乎下饭榜 / 省心快吃榜”
```

验收：

```text
问“附近有什么必吃”，返回 Top 3。
每家都有量化证据和适合理由。
可以一键进入滑卡或商家对比。
```

### Step 5：deal_search

目标：

```text
小汪能查优惠/团购，但必须标注来源和更新时间。
```

要做：

```text
新增 /api/tools/deal-search-context
新增 deal_card
第一版用 seed/mock 数据
后续接外部搜索和缓存
```

验收：

```text
问“这家有优惠吗”，能返回优惠摘要和置信度。
不会伪造实时团购信息。
```

### Step 6：OpenClaw merchant reputation dreaming

目标：

```text
OpenClaw 后台整理商家口碑和区域榜单，更新 merchant_reputation 候选。
```

要做：

```text
扩展 lifepilot-dreaming 输出
新增 merchant_reputation_update_suggestions
后端审核后写入 merchant_reputation
汪记本展示小汪复盘出的商家洞察
```

验收：

```text
跑 dreaming 后，能生成商家口碑更新建议。
更新必须可追溯 evidence。
不会直接覆盖人工 seed，除非通过审核策略。
```

## 风险与对策

### 风险 1：OpenClaw 实时调用慢

对策：

```text
OpenClaw-first，但保留 Ark/local fallback。
前端开发轨迹明确显示 OpenClaw / Ark / 后端兜底。
重 skill 走后台 dreaming。
实时 tool API 必须快。
```

### 风险 2：口碑数据不足

对策：

```text
先 seed 关键演示商家。
证据不足时小汪必须承认不确定。
不做无证据排名。
```

### 风险 3：评分误导

对策：

```text
评分不是最终答案。
必须同时看评论量、正中负分布、标签提及、当前需求和用户偏好。
OpenClaw 负责处理“高评分但不适合主人”的冲突。
```

### 风险 4：外部优惠/新菜实时性

对策：

```text
第一版只做 seed/mock 和来源时间。
所有优惠必须标注更新时间。
不确定就说不确定。
```

## 最小可展示 Demo

建议第一版 demo 聚焦 3 个场景：

### Demo 1：瑞幸 vs 幸运咖

用户问：

```text
瑞幸和幸运咖，我今天选哪个？
```

小汪回答应包含：

```text
如果赶时间买奶咖，瑞幸更稳。
如果只追求低价解馋，幸运咖可以。
引用评分、评论数、好评率、出杯快/奶味偏重标签。
```

### Demo 2：汪记豆花 vs 四川小炒

用户问：

```text
这两家川菜哪家更适合我？
```

小汪回答应包含：

```text
按主人热乎下饭、省心、少排队的偏好，选择其中一家。
区分大众口碑和今天适配。
引用招牌菜、好评率、差评集中点、口味标签提及。
```

### Demo 3：最终确认页到店小抄

用户选定一家后：

```text
点击“到店小抄”
```

展示：

```text
特色菜
两个人怎么点
预算
排队/优惠/避雷
为什么适合主人
```

## 最终口径

LifePilot 的商家判断不是“后端算分”，也不是“AI 随口推荐”。

```text
后端提供证据。
OpenClaw 小汪做判断。
用户反馈校准口碑。
汪记本和 dreaming 让判断越来越懂主人。
```

这就是小汪食探 skills 的核心。
