import { config } from "./config.mjs";
import { parseJsonObjectFromText } from "./json-utils.mjs";
import { buildDirectionSummaryPrompt } from "./ai/prompts.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";

function includesAny(text, words) {
  return words.some((word) => String(text || "").includes(word));
}

function eventText(event = {}) {
  return [
    event.title,
    event.hook,
    event.budget_band,
    ...(event.tags || []),
    ...(event.fit || []),
    ...(event.avoid_for || []),
  ].join(" ");
}

function names(events) {
  return events.map((event) => event.title).filter(Boolean);
}

function tasteSignals(kept = [], disliked = []) {
  const keptText = kept.map(eventText).join(" ");
  const dislikedText = disliked.map(eventText).join(" ");
  const signals = [];
  const dimensions = [
    {label: "更想吃重口、有刺激感的选择", keep: ["辣", "麻辣", "香辣", "重口", "川菜", "湘菜", "牛油"], dislike: ["清淡", "清爽", "椰子鸡", "粿条", "不太油"]},
    {label: "更偏清爽、低负担", keep: ["清淡", "清爽", "不太油", "低负担", "粉", "粿条", "日式"], dislike: ["牛油", "偏油", "重油", "猪脚", "烧腊", "麻辣"]},
    {label: "更适合一个人快速解决", keep: ["独食", "一个人", "快", "工作餐"], dislike: ["聚餐", "组局", "久坐", "两人"]},
    {label: "更想要米饭正餐的满足感", keep: ["米饭", "下饭", "小炒", "烧腊", "猪脚"], dislike: ["粉", "粿条", "轻食", "沙拉"]},
    {label: "更偏热汤和舒服收尾", keep: ["热汤", "汤", "粉面", "面"], dislike: ["干饭", "烧腊", "小炒", "炸"]},
  ];
  for (const item of dimensions) {
    if (includesAny(keptText, item.keep) && (!disliked.length || includesAny(dislikedText, item.dislike))) {
      signals.push(item.label);
    }
  }
  return signals.slice(0, 2);
}

export function localDirectionSummary({goal, events = []} = {}) {
  const kept = events.filter((event) => event.action === "keep");
  const disliked = events.filter((event) => event.action === "dislike");
  const keptNames = names(kept).slice(0, 4);
  const dislikedNames = names(disliked).slice(0, 4);
  const signals = tasteSignals(kept, disliked);
  const keptText = keptNames.length ? `保留了「${keptNames.join("、")}」` : "还没有明确保留方向";
  const dislikedText = dislikedNames.length ? `，排除了「${dislikedNames.join("、")}」` : "";
  if (!keptNames.length) {
    return {
      summary_text: `小汪还没抓到特别明确的保留方向，但已经知道主人${dislikedText ? `先不想看「${dislikedNames.join("、")}」` : "还在试探口味边界"}，我会根据入口需求继续帮主人缩小下一轮商家。`,
    };
  }
  const signalText = signals.length ? `，这说明主人今天${signals.join("，")}` : "";
  return {
    summary_text: `主人刚刚${keptText}${dislikedText}${signalText}。小汪会基于这个口味边界，继续给主人推荐更合适的具体商家。`,
  };
}

function normalizeDirectionSummary(parsed, fallback) {
  const text = typeof parsed?.summary_text === "string" ? parsed.summary_text.trim() : "";
  if (!text) return fallback;
  return {summary_text: text.replace(/\s+/g, " ").slice(0, 220)};
}

export async function buildDirectionSummary({goal, events, timeoutMs, forceLocal = false, memoryContext = null} = {}) {
  const startedAt = Date.now();
  const fallback = localDirectionSummary({goal, events});
  if (forceLocal || config.ai.provider === "local") {
    return {
      ok: true,
      mode: "local_fallback",
      summary: fallback,
      meta: {fallback_used: true, fallback_reason: "forced_local"},
      timing: {total_ms: Date.now() - startedAt, ai: null},
    };
  }

  const prompt = buildDirectionSummaryPrompt({
    goal,
    events,
    fallbackSummary: fallback,
    memoryContext,
  });
  const ai = await callArkChat({
    timeoutMs,
    messages: [
      {role: "system", content: "你是饭点定了小程序里的小汪，只输出符合要求的 JSON。"},
      {role: "user", content: prompt},
    ],
  });
  if (!ai.ok) {
    return {
      ok: true,
      mode: "local_fallback",
      summary: fallback,
      warning: {code: ai.error_code, message: "AI provider failed; local fallback was used."},
      meta: {fallback_used: true, fallback_reason: ai.error_code},
      timing: {total_ms: Date.now() - startedAt, ai},
    };
  }
  const parsed = parseJsonObjectFromText(ai.text);
  const normalized = normalizeDirectionSummary(parsed, fallback);
  const usedFallback = normalized === fallback;
  return {
    ok: true,
    mode: usedFallback ? "local_fallback" : "ark",
    summary: normalized,
    warning: usedFallback ? {code: "invalid_ai_json", message: "AI returned invalid JSON; local fallback was used."} : null,
    meta: {fallback_used: usedFallback, fallback_reason: usedFallback ? "invalid_ai_json" : null},
    timing: {total_ms: Date.now() - startedAt, ai},
  };
}
