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

export function buildDirectionSummaryPrompt({goal, events = [], fallbackSummary = {}, memoryContext = null}) {
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
    "- 要比较 keep 和 dislike 的差异，重点观察重口/清淡、辣味/鲜甜、低油/厚重、粉面/米饭、快吃/久坐、独食/聚餐、预算压力、锅物/炒菜等维度。",
    "- 不要把今天的选择写成长期偏好。",
    "- 不要声称查询了真实美团、大众点评、订单、支付、营业状态或真实排队。",
    "- 语气亲近、认真、聪明，不要幼稚。",
    "- 正常情况下不需要道歉。",
    "- 只有在没有保留方向、信号很少或选择明显矛盾时，才可以轻微抱歉但不卑微。",
    "- 称呼用户为主人。",
    "- summary_text 写 1 到 2 句中文，不要列表，不要换行。",
    "- 如果存在 confirmed memory，可结合长期口味偏好解释本次选择；pending memory 不能当作已确认偏好。",
    "",
    `用户今日目标：${goal || "今天想找一顿合适的饭"}`,
    `保留方向数量：${kept.length}`,
    `放弃方向数量：${disliked.length}`,
    `保留方向：${JSON.stringify(kept.map(compactEvent), null, 2)}`,
    `放弃方向：${JSON.stringify(disliked.map(compactEvent), null, 2)}`,
    `本地 fallback 总结：${JSON.stringify(fallbackSummary)}`,
    `长期记忆上下文：${JSON.stringify(memoryContext || {confirmed_preferences: []})}`,
  ].join("\n");
}
