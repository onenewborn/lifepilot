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
    "- 用户没有说的位置、预算、禁忌、偏好，不要编。",
    "- 如果用户表达疲惫、下班、压力、想被犒劳、想省心等情绪，可以放进 energy 或 emotional_reward。",
    "- 如果用户表达约会、朋友、同事、不熟的人、怕尴尬、吃相、身上有味等社交顾虑，可以放进 social_friction。",
    "- 输出里的 evidence 必须是字符串数组，来自用户输入或按钮值，不能来自你的常识脑补。",
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
    "- 如果存在 confirmed memory，可结合长期口味偏好解释本次选择；pending memory 不能当作已确认偏好。",
    "",
    `用户今日目标：${goal || "今天想找一顿合适的饭"}`,
    `入口上下文：${JSON.stringify(compactEntryContext(entryContext || {}), null, 2)}`,
    `保留方向数量：${kept.length}`,
    `放弃方向数量：${disliked.length}`,
    `保留方向：${JSON.stringify(kept.map(compactEvent), null, 2)}`,
    `放弃方向：${JSON.stringify(disliked.map(compactEvent), null, 2)}`,
    `长期记忆上下文：${JSON.stringify(memoryContext || {confirmed_preferences: []})}`,
  ].join("\n");
}
