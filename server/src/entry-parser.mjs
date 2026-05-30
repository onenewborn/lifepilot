import { config } from "./config.mjs";
import { parseJsonObjectFromText } from "./json-utils.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";
import { buildParseEntryPrompt, ENTRY_DIMENSIONS } from "./ai/prompts.mjs";
import { localParseEntry } from "./cards.mjs";

const DIMENSION_THRESHOLD = 0.8;
const HARD_CONSTRAINT_THRESHOLD = 0.9;
const SOFT_PREFERENCE_THRESHOLD = 0.8;

function rawEntryText(entryForm = {}) {
  return [
    entryForm.raw_query,
    entryForm.rawQuery,
    entryForm.free_text,
    entryForm.freeText,
    entryForm.text,
    entryForm.goal,
  ].filter(Boolean).join(" ");
}

function evidenceList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item).trim();
    if (item && typeof item === "object") return JSON.stringify(item);
    return "";
  }).filter(Boolean).slice(0, 6);
}

function confidenceOf(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? confidence : 0;
}

function normalizeStrength(value) {
  const raw = String(value || "").trim();
  return ["low", "medium", "high"].includes(raw) ? raw : "medium";
}

function normalizeDimensions(dimensions = {}) {
  const result = {};
  for (const key of ENTRY_DIMENSIONS) {
    const item = dimensions?.[key];
    const confidence = confidenceOf(item?.confidence);
    const evidence = evidenceList(item?.evidence);
    const intent = String(item?.intent || "").trim();
    if (!item || confidence < DIMENSION_THRESHOLD || !evidence.length || !intent) {
      result[key] = null;
      continue;
    }
    result[key] = {
      intent,
      strength: normalizeStrength(item.strength),
      confidence,
      evidence,
    };
  }
  return result;
}

function normalizeHardConstraints(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const confidence = confidenceOf(item?.confidence);
    const evidence = evidenceList(item?.evidence);
    const facet = String(item?.facet || "").trim();
    if (confidence < HARD_CONSTRAINT_THRESHOLD || !evidence.length || !facet) return null;
    return {
      facet,
      operator: String(item?.operator || "").trim() || "equals",
      value: item?.value ?? "",
      confidence,
      evidence,
    };
  }).filter(Boolean).slice(0, 8);
}

function normalizeSoftPreferences(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const confidence = confidenceOf(item?.confidence);
    const evidence = evidenceList(item?.evidence);
    const facet = String(item?.facet || "").trim();
    if (confidence < SOFT_PREFERENCE_THRESHOLD || !evidence.length || !facet) return null;
    return {
      facet,
      value: item?.value ?? "",
      weight: normalizeStrength(item?.weight),
      confidence,
      evidence,
    };
  }).filter(Boolean).slice(0, 12);
}

function preference(facet, value, dimension) {
  return {
    facet,
    value,
    weight: dimension.strength || "medium",
    confidence: dimension.confidence,
    evidence: dimension.evidence || [],
  };
}

function textOf(dimension = {}) {
  return [dimension.intent, ...(dimension.evidence || [])].join(" ");
}

function derivePreferencesFromDimensions(dimensions = {}) {
  const preferences = [];
  const flavor = dimensions.flavor;
  if (flavor) {
    const text = textOf(flavor);
    if (/下饭|米饭|正餐|满足|重口|犒劳/.test(text)) preferences.push(preference("flavor.satisfaction", "下饭、有满足感", flavor));
    if (/辣|麻辣|香辣|川|湘|重口/.test(text)) preferences.push(preference("flavor.intensity", "想吃辣或重口", flavor));
    if (/清淡|清爽|低油|不油|轻/.test(text)) preferences.push(preference("health_load", "清爽低负担", flavor));
    if (/热乎|热汤|汤|暖/.test(text)) preferences.push(preference("temperature", "热乎舒服", flavor));
  }

  const budget = dimensions.budget;
  if (budget) preferences.push(preference("budget", budget.intent, budget));

  const distance = dimensions.distance;
  if (distance) {
    const text = textOf(distance);
    if (/近|附近|少走|不远|公里|地铁|方便/.test(text)) preferences.push(preference("distance", "附近、省心、少走路", distance));
  }

  const environment = dimensions.environment;
  if (environment) {
    const text = textOf(environment);
    if (/聊天|安静|坐|久坐/.test(text)) preferences.push(preference("environment", "适合坐下来聊天", environment));
    if (/热闹|氛围|商场|环境/.test(text)) preferences.push(preference("environment", environment.intent, environment));
  }

  const energy = dimensions.energy;
  if (energy) {
    const text = textOf(energy);
    if (/累|疲惫|省心|低决策|少走|少排队|不折腾|简单|热乎|舒服/.test(text)) {
      preferences.push(preference("convenience", "省心、低决策成本", energy));
      preferences.push(preference("distance", "附近、省心、少走路", energy));
      preferences.push(preference("queue", "少排队", energy));
      preferences.push(preference("temperature", "热乎舒服", energy));
    }
  }

  const party = dimensions.party;
  if (party) preferences.push(preference("party", party.intent, party));

  const timePressure = dimensions.time_pressure;
  if (timePressure) {
    const text = textOf(timePressure);
    if (/快|赶|马上|时间/.test(text)) {
      preferences.push(preference("service_speed", "快吃、少等待", timePressure));
      preferences.push(preference("queue", "少排队", timePressure));
    }
  }

  const healthLoad = dimensions.health_load;
  if (healthLoad) {
    const text = textOf(healthLoad);
    if (/轻|清爽|低油|不油|养胃|不撑/.test(text)) preferences.push(preference("health_load", "清爽低负担", healthLoad));
  }

  const emotionalReward = dimensions.emotional_reward;
  if (emotionalReward) {
    const text = textOf(emotionalReward);
    if (/满足|犒劳|热乎|下饭|舒服|不克制/.test(text)) preferences.push(preference("emotional_reward", "有满足感、热乎、不过分克制", emotionalReward));
  }

  const socialFriction = dimensions.social_friction;
  if (socialFriction) preferences.push(preference("social_friction", socialFriction.intent, socialFriction));

  return preferences;
}

function mergeSoftPreferences(explicitPreferences, derivedPreferences) {
  const seen = new Set();
  return [...explicitPreferences, ...derivedPreferences].filter((item) => {
    const key = `${item.facet}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

function normalizeSpecialSignals(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const confidence = confidenceOf(item?.confidence);
    const evidence = evidenceList(item?.evidence);
    const signal = String(item?.signal || "").trim();
    if (confidence < SOFT_PREFERENCE_THRESHOLD || !evidence.length || !signal) return null;
    return {signal, confidence, evidence};
  }).filter(Boolean).slice(0, 8);
}

function mergeLocalFallback(entryForm, parsed = {}, {mode, warning = null, timing = null, ai = null} = {}) {
  const local = localParseEntry(entryForm);
  const normalizedGoal = String(parsed.normalized_goal || local.normalized_goal || "").trim();
  const dimensions = normalizeDimensions(parsed.dimensions || {});
  const explicitSoftPreferences = normalizeSoftPreferences(parsed.soft_preferences || []);
  const derivedSoftPreferences = derivePreferencesFromDimensions(dimensions);
  return {
    constraints: local.constraints,
    requirements: local.requirements,
    missing_info: Array.isArray(parsed.missing_info) ? parsed.missing_info.map(String).slice(0, 6) : local.missing_info,
    confidence: confidenceOf(parsed.confidence) || local.confidence,
    assistant_text: local.assistant_text,
    normalized_goal: normalizedGoal || local.normalized_goal,
    raw_entry_text: rawEntryText(entryForm),
    dimensions,
    hard_constraints: normalizeHardConstraints(parsed.hard_constraints || []),
    soft_preferences: mergeSoftPreferences(explicitSoftPreferences, derivedSoftPreferences),
    special_signals: normalizeSpecialSignals(parsed.special_signals || []),
    parse_mode: mode,
    timing,
    warning,
    ai,
  };
}

export async function parseEntry({entryForm = {}, timeoutMs, forceLocal = false} = {}) {
  const startedAt = Date.now();
  if (forceLocal || config.ai.provider === "local") {
    return mergeLocalFallback(entryForm, {}, {
      mode: "local_fallback",
      timing: {total_ms: Date.now() - startedAt, ai: null},
    });
  }

  const prompt = buildParseEntryPrompt({entryForm});
  const ai = await callArkChat({
    timeoutMs: timeoutMs || Math.max(config.ai.timeoutMs, 8000),
    maxTokens: 700,
    messages: [
      {role: "system", content: "你是饭点定了小程序的入口需求解析器，只输出符合要求的 JSON。"},
      {role: "user", content: prompt},
    ],
  });
  if (!ai.ok) {
    return mergeLocalFallback(entryForm, {}, {
      mode: "local_fallback",
      warning: {code: ai.error_code, message: "AI provider failed; local parse fallback was used."},
      timing: {total_ms: Date.now() - startedAt, ai},
      ai,
    });
  }
  const parsed = parseJsonObjectFromText(ai.text);
  if (!parsed) {
    return mergeLocalFallback(entryForm, {}, {
      mode: "local_fallback",
      warning: {code: "invalid_ai_json", message: "AI returned invalid JSON; local parse fallback was used."},
      timing: {total_ms: Date.now() - startedAt, ai},
      ai,
    });
  }
  return mergeLocalFallback(entryForm, parsed, {
    mode: "ark",
    timing: {total_ms: Date.now() - startedAt, ai},
    ai,
  });
}
