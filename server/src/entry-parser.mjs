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
  return {
    constraints: local.constraints,
    requirements: local.requirements,
    missing_info: Array.isArray(parsed.missing_info) ? parsed.missing_info.map(String).slice(0, 6) : local.missing_info,
    confidence: confidenceOf(parsed.confidence) || local.confidence,
    assistant_text: local.assistant_text,
    normalized_goal: normalizedGoal || local.normalized_goal,
    raw_entry_text: rawEntryText(entryForm),
    dimensions: normalizeDimensions(parsed.dimensions || {}),
    hard_constraints: normalizeHardConstraints(parsed.hard_constraints || []),
    soft_preferences: normalizeSoftPreferences(parsed.soft_preferences || []),
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
