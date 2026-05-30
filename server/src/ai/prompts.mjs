function compactEvent(event = {}) {
  return {
    direction_id: event.direction_id,
    title: event.title,
    action: event.action,
    tags: event.tags || [],
    budget_band: event.budget_band || "",
    hook: event.hook || "",
    fit: event.fit || [],
    avoid_for: event.avoid_for || [],
  };
}

export const ENTRY_DIMENSIONS = [
  "flavor",
  "budget",
  "distance",
  "environment",
  "energy",
  "party",
  "time_pressure",
  "health_load",
  "novelty",
  "certainty",
  "emotional_reward",
  "social_friction",
];

export function buildParseEntryPrompt({entryForm = {}} = {}) {
  return [
    "请扮演饭点定了小程序的入口需求解析器。",
    "只返回一个 JSON 对象，不要 markdown，不要解释。",
    "",
    "任务：",
    "把用户入口阶段的按钮选择和聊天框原文，解析成固定维度的用餐需求。",
    "你不能直接决定推荐哪些卡，也不能调用工具；只负责解释用户需求。",
    "",
    "重要规则：",
    "- 不要为了填满 schema 乱猜。",
    "- 某个维度只有在 confidence >= 0.8 且有 evidence 时才填写，否则返回 null。",
    "- hard_constraints 只有在用户明确表达、confidence >= 0.9 且有 evidence 时才填写。",
    "- soft_preferences 只有在 confidence >= 0.8 且有 evidence 时才填写。",
    "- 低于置信度门槛的信息不要交给 AI 或规则继续猜；保持为空，必要时写入 missing_info，让用户通过后续滑卡或显式选择表达。",
    "- intent 必须写成后端能用于排序的可执行偏好，不要只写抽象解释。",
    "- energy 维度不要写“缓解疲惫”这种不可执行描述；要落成“省心/低决策成本/少走路/少排队/热乎舒服”等可用于挑方向和商家的信号。",
    "- emotional_reward 维度不要只写“需要被安慰”；要落成“有满足感/热乎/不太克制/下饭/犒劳感”等食物和体验信号。",
    "- social_friction 维度要落成“少尴尬/不狼狈/不容易身上有味/适合聊天/点单不复杂”等可执行信号。",
    "- certainty 只表示风险偏好，例如想稳、不踩雷、熟悉、愿意尝鲜、想试新店；不要把省钱、预算紧、月底了写进 certainty。",
    "- 用户没有说的位置、预算、禁忌、偏好，不要编。",
    "- 如果用户表达疲惫、下班、压力、想被犒劳、想省心等情绪，可以放进 energy 或 emotional_reward。",
    "- 如果用户表达约会、朋友、同事、不熟的人、怕尴尬、吃相、身上有味等社交顾虑，可以放进 social_friction。",
    "- 输出里的 evidence 必须是字符串数组，来自用户输入或按钮值，不能来自你的常识脑补。",
    "- 按钮值也必须写成字符串，例如 \"party_size=2\"、\"budget_per_person_max=180\"、\"radius_km=4\"；绝对不要写成对象或键值片段。",
    "",
    "固定维度：",
    ENTRY_DIMENSIONS.join(", "),
    "",
    "输出 JSON schema：",
    JSON.stringify({
      normalized_goal: "",
      dimensions: Object.fromEntries(ENTRY_DIMENSIONS.map((key) => [key, {
        intent: "",
        strength: "low|medium|high",
        confidence: 0.0,
        evidence: [],
      }])),
      hard_constraints: [{
        facet: "",
        operator: "",
        value: "",
        confidence: 0.0,
        evidence: [],
      }],
      soft_preferences: [{
        facet: "",
        value: "",
        weight: "low|medium|high",
        confidence: 0.0,
        evidence: [],
      }],
      special_signals: [{
        signal: "",
        confidence: 0.0,
        evidence: [],
      }],
      missing_info: [],
      confidence: 0.0,
    }, null, 2),
    "",
    `入口表单：${JSON.stringify(entryForm, null, 2)}`,
  ].join("\n");
}

function compactEntryContext(entryContext = {}) {
  const entryForm = entryContext.entry_form || entryContext.entryForm || {};
  const understanding = entryContext.understanding || {};
  return {
    entry_form: {
      raw_query: entryForm.raw_query || entryForm.rawQuery || entryForm.free_text || entryForm.freeText || entryForm.text || entryForm.goal || "",
      party_size: entryForm.party_size || entryForm.partySize || null,
      budget_per_person_max: entryForm.budget_per_person_max || entryForm.budget || null,
      area: entryForm.area || "",
      radius_km: entryForm.radius_km || entryForm.radiusKm || null,
      meal_time: entryForm.meal_time || entryForm.mealTime || "",
      flavor: entryForm.flavor || entryForm.flavor_preference || entryForm.flavorPreference || "",
    },
    parsed: {
      constraints: understanding.constraints || {},
      requirements: understanding.requirements || [],
      assistant_text: understanding.assistant_text || "",
      confidence: understanding.confidence || null,
    },
  };
}

function compactMemoryContext(memoryContext = {}) {
  return {
    local_active_confirmed_preferences: memoryContext.confirmed_preferences || [],
    evermind_weak_memories: (memoryContext.evermind_weak_memories || []).slice(0, 8),
    policy: memoryContext.policy || "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context",
  };
}

export function buildDirectionSummaryPrompt({goal, events = [], entryContext = null, memoryContext = null}) {
  const kept = events.filter((event) => event.action === "keep");
  const disliked = events.filter((event) => event.action === "dislike");
  return [
    "请扮演微信小程序里的 AI 助手小汪。",
    "用户刚刚完成第一阶段餐饮方向卡左右滑，现在要展示一张方向总结卡。",
    "只返回一个 JSON 对象，不要 markdown，不要解释。",
    "输出字段只需要 summary_text。",
    "",
    "任务：",
    "根据用户保留和放弃的餐饮方向，敏锐分析两边食物、口味、场景和负担感的细微差别。",
    "不要只复述保留了什么、放弃了什么；要说清楚这些选择说明主人今天更可能想吃什么，以及小汪接下来会如何按这个口味边界继续筛具体商家。",
    "",
    "要求：",
    "- 保留方向就是主人愿意继续看的方向，不能写成应该避开。",
    "- 放弃方向就是主人暂时不想看的方向，不能写成主人偏好。",
    "- 入口阶段的预算、人数、距离、区域、口味选择和聊天框自定义输入都是强上下文，要和滑卡结果一起理解。",
    "- 如果聊天框自定义输入表达了疲惫、下班、压力、想被犒劳、想省心等情绪或场景，开头的情绪确认要顺势回应，但不要把小结写成心理安慰长文。",
    "- 要比较 keep 和 dislike 的差异，重点观察重口/清淡、辣味/鲜甜、低油/厚重、粉面/米饭、快吃/久坐、独食/聚餐、预算压力、锅物/炒菜等维度。",
    "- 不要把今天的选择写成长期偏好。",
    "- 不要声称查询了真实美团、大众点评、订单、支付、营业状态或真实排队。",
    "- 语气亲近、认真、聪明，不要幼稚。",
    "- summary_text 开头要先给一点情绪确认，例如“我 get 到啦！”或“我明白啦！”。",
    "- tags 只是分析依据，面向用户时要改写成自然口语；不要机械拼接标签，不要写“清淡麻辣烫”“低油少”这类不自然短语。",
    "- 如果提到麻辣烫的轻负担属性，优先说“辣度和汤底可调”“能吃得轻一点”，不要说“清淡麻辣烫”。",
    "- 正常情况下不需要道歉。",
    "- 只有在没有保留方向、信号很少或选择明显矛盾时，才可以轻微抱歉但不卑微。",
    "- 称呼用户为主人。",
    "- summary_text 写 1 到 2 句中文，不要列表，不要换行。",
    "- 如果存在 confirmed memory，只有在它和本次 keep/dislike、入口需求高度相关时，才自然带一句“我记得主人喜欢……”来帮助解释本次选择。",
    "- Evermind 外部记忆只能作为弱上下文，不能当作用户已确认偏好；只有和本次选择高度相关时才自然参考。",
    "- 面向用户时不要写“长期喜欢”“长期偏好”“confirmed memory”“记忆上下文”这类系统化表述。",
    "- pending memory 不能当作已确认偏好。",
    "",
    `用户今日目标：${goal || "今天想找一顿合适的饭"}`,
    `入口上下文：${JSON.stringify(compactEntryContext(entryContext || {}), null, 2)}`,
    `保留方向数量：${kept.length}`,
    `放弃方向数量：${disliked.length}`,
    `保留方向：${JSON.stringify(kept.map(compactEvent), null, 2)}`,
    `放弃方向：${JSON.stringify(disliked.map(compactEvent), null, 2)}`,
    `记忆上下文：${JSON.stringify(compactMemoryContext(memoryContext || {}), null, 2)}`,
  ].join("\n");
}

export function buildOfferExplanationPrompt({goal, directionSummary = {}, understanding = {}, directionContext = {}, memoryContext = null, cards = []} = {}) {
  const compactUnderstanding = {
    constraints: understanding.constraints || {},
    dimensions: understanding.dimensions || {},
    hard_constraints: understanding.hard_constraints || [],
    soft_preferences: understanding.soft_preferences || [],
    special_signals: understanding.special_signals || [],
    missing_info: understanding.missing_info || [],
    parse_mode: understanding.parse_mode || "",
  };
  return [
    "请扮演微信小程序里的 AI 助手小汪。",
    "用户已经进入第二阶段商家卡，后端已经完成商家召回、硬筛选和软排序。",
    "你不能改变卡片顺序，不能新增或删除商家，只能基于事实改写每张卡的解释文案。",
    "只返回一个 JSON 对象，不要 markdown，不要解释。",
    "",
    "当前产品逻辑：",
    "- 第一阶段用户通过左右滑选择餐饮方向；keep 表示主人愿意继续看这个方向，dislike 表示主人暂时不想看这个方向。",
    "- 第二阶段展示具体商家时，要让主人感觉这家店是从刚刚的方向选择自然收束出来的，而不是凭空出现。",
    "- 如果商家命中了主人刚刚保留的方向，要点名这个方向或用自然口语解释它，例如“你刚刚保留了热汤粉面这一类，所以这家更贴近今天想要的热乎感”。",
    "- 不要把主人刚刚放弃的方向写成偏好；如果商家和放弃方向有关，只能在明确事实冲突时写进 conflicts。",
    "",
    "要求：",
    "- 每张输入卡都要返回一项。",
    "- matched 写 1-3 条，说明为什么选这家店：优先连接“主人第一阶段保留的方向”，再结合入口需求，最后突出这家店自己的特点。",
    "- matched 要亲近、具体、像小汪在帮主人做决定；可以写“小汪觉得这家……”“主人不用太担心……”“这家刚好……”。",
    "- 不要写成生硬规则，例如不要只写“命中方向”“符合预算”“适合一个人吃”。",
    "- 预算、距离、排队这类事实要转成自然口语，例如“主人不用太担心钱包”“离得不远”“不用把时间耗在排队上”。",
    "- watchouts 写 0-2 条，说明到店前需要注意什么；语气轻一点，不要像风险报告。",
    "- conflicts 只在事实明确冲突时填写。",
    "- 如果用户最初需求里有疲惫、下班、想省心、想犒劳、想下饭、预算、距离、人数、聊天等信息，要自然体现在 matched 或 watchouts 里。",
    "- 要突出这家店相对其他店的具体特点，例如近、热乎、下饭、独食友好、适合聊天、排队少、价格稳、招牌菜明确。",
    "- 只能引用当前商家卡 matched_directions 里的方向；不要引用用户保留过但这张卡没有命中的方向。",
    "- 可以称呼用户为主人，但不要每条都重复称呼。",
    "- 不要编造真实美团、大众点评、订单、支付、营业、实时排队或真实路线。",
    "- 不要说“实时情况”“走过去就能到”这类暗示已经查过真实路线或实时数据的话；可以说“距离不远”“出发前再确认一下”。",
    "- 距离使用 facts.distance_text，例如 0.9km，不要写 subway_walk_min。",
    "- 如果存在记忆上下文，本地 confirmed preferences 是强依据；Evermind 外部记忆只能作为弱上下文，pending candidates 不是已确认偏好，不能当作推荐依据。",
    "- 只有当 confirmed_preferences 和当前商家卡事实高度相关时，才自然带一句“我记得主人喜欢……”；不要为了展示记忆而强行提。",
    "- Evermind 外部记忆如果和当前商家卡高度相关，可以辅助理解用户最近场景，但不要说成小汪已经确认记住。",
    "- 面向用户时不要写“长期喜欢”“长期偏好”“confirmed memory”“记忆上下文”这类系统化表述。",
    "- 文案短，适合卡片展示。",
    "",
    "输出 JSON schema：",
    JSON.stringify({
      cards: [{
        offer_id: "",
        matched: [],
        watchouts: [],
        conflicts: [],
      }],
    }, null, 2),
    "",
    `用户目标：${goal || ""}`,
    `入口理解：${JSON.stringify(compactUnderstanding, null, 2)}`,
    `第一阶段方向选择：${JSON.stringify({
      kept: directionContext.kept || [],
      disliked: directionContext.disliked || [],
    }, null, 2)}`,
    `方向小结：${JSON.stringify(directionSummary || {}, null, 2)}`,
    `记忆上下文：${JSON.stringify(compactMemoryContext(memoryContext || {}), null, 2)}`,
    `商家卡事实：${JSON.stringify(cards.map((card) => ({
      offer_id: card.offer_id,
      merchant_name: card.merchant_name,
      title: card.title,
      matched_directions: card.matched_directions || [],
      tags: card.tags,
      facts: card.facts,
    })), null, 2)}`,
  ].join("\n");
}
