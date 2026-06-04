import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";
import { ensureMemoryUser, listConfirmedPreferences } from "./memory-store.mjs";

export const RECOMMENDATION_SIGNALS_SCHEMA = "lifepilot.recommendation_signals.v1";

const ALLOWED_OPERATORS = new Set(["equals", "in", "contains_any", "lte", "gte"]);
const ALLOWED_FIELDS = new Set([
  "offer.cuisine_tags",
  "offer.decision_tags",
  "offer.oil_level",
  "offer.spice_level",
  "offer.temperature",
  "offer.service_speed",
  "offer.portion_size",
  "offer.satisfaction_level",
  "offer.solo_friendly",
  "offer.price_per_person",
  "merchant.queue_risk",
  "merchant.environment.noise_level",
  "merchant.environment.chat_friendly",
  "merchant.environment.solo_friendly",
  "merchant.environment.comfort_level",
  "merchant.neighborhood",
  "merchant.specialties",
  "merchant.merchant_id",
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeUserId(userId) {
  return String(userId || "demo_weiyingru").replace(/[^a-zA-Z0-9_-]/g, "_") || "demo_weiyingru";
}

function compactId(text = "") {
  return String(text || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(-15, Math.min(10, Math.round(numeric)));
}

function normalizeValues(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .filter((item) => item !== undefined && item !== null && item !== "")
    .map((item) => (typeof item === "number" || typeof item === "boolean") ? item : String(item).trim())
    .filter((item) => item !== "");
}

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function defaultSignalStore(userId) {
  return {
    schema_version: RECOMMENDATION_SIGNALS_SCHEMA,
    user_id: userId,
    generated_by: "openclaw_memory_intelligence",
    source_job_id: "",
    generated_at: null,
    signals: [],
  };
}

async function signalPath({workspaceRoot = config.storage.runtimeRoot, userId} = {}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  return {
    user,
    filePath: path.join(user.directory, "recommendation_signals.json"),
  };
}

export function normalizeRecommendationSignal(input = {}) {
  const target = input.target || {};
  const field = String(target.field || "").trim();
  const operator = String(target.operator || "").trim();
  if (!ALLOWED_FIELDS.has(field)) {
    return {ok: false, error: "unsupported_signal_target_field", field};
  }
  if (!ALLOWED_OPERATORS.has(operator)) {
    return {ok: false, error: "unsupported_signal_operator", operator};
  }
  const values = normalizeValues(target.values ?? target.value);
  if (!values.length) {
    return {ok: false, error: "missing_signal_target_values", field, operator};
  }
  const category = String(input.category || "general").trim() || "general";
  const scoreDelta = clampScore(input.score_delta ?? input.scoreDelta ?? Number(input.strength || 0) * 10);
  if (!scoreDelta) {
    return {ok: false, error: "zero_signal_score_delta", field, operator};
  }
  const signalId = String(input.signal_id || input.signalId || `sig_${compactId(category)}_${compactId(field)}_${compactId(values.join("_"))}`).trim();
  return {
    ok: true,
    signal: {
      signal_id: signalId,
      preference_id: String(input.preference_id || input.preferenceId || "").trim(),
      status: input.status === "paused" || input.status === "forgotten" ? input.status : "active",
      category,
      polarity: String(input.polarity || (scoreDelta < 0 ? "negative" : "positive")).trim(),
      confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0.7,
      strength: Number.isFinite(Number(input.strength)) ? Number(input.strength) : scoreDelta / 10,
      target: {
        entity: String(target.entity || field.split(".")[0] || "offer").trim(),
        field,
        operator,
        values,
      },
      score_delta: scoreDelta,
      reason: String(input.reason || input.statement || input.confirmation_text || input.confirmationText || "长期记忆影响本次推荐排序。").trim(),
      generated_at: String(input.generated_at || input.generatedAt || nowIso()).trim(),
    },
  };
}

export async function readRecommendationSignals({workspaceRoot = config.storage.runtimeRoot, userId} = {}) {
  const {user, filePath} = await signalPath({workspaceRoot, userId});
  if (!existsSync(filePath)) {
    return {
      ok: true,
      user_id: user.userId,
      signal_path: filePath,
      ...defaultSignalStore(user.userId),
    };
  }
  const store = JSON.parse(await readFile(filePath, "utf8"));
  const accepted = [];
  const rejected = [];
  for (const item of (store.signals || [])) {
    const normalized = normalizeRecommendationSignal(item);
    if (normalized.ok) accepted.push(normalized.signal);
    else rejected.push(normalized);
  }
  return {
    ok: true,
    user_id: user.userId,
    signal_path: filePath,
    schema_version: store.schema_version || RECOMMENDATION_SIGNALS_SCHEMA,
    generated_by: store.generated_by || "openclaw_memory_intelligence",
    source_job_id: store.source_job_id || "",
    generated_at: store.generated_at || null,
    signals: accepted,
    rejected,
  };
}

export async function writeRecommendationSignals({
  workspaceRoot = config.storage.runtimeRoot,
  userId,
  signals = [],
  generatedBy = "openclaw_memory_intelligence",
  sourceJobId = "",
} = {}) {
  const {user, filePath} = await signalPath({workspaceRoot, userId});
  const accepted = [];
  const rejected = [];
  for (const item of (Array.isArray(signals) ? signals : [])) {
    const normalized = normalizeRecommendationSignal(item);
    if (normalized.ok) accepted.push(normalized.signal);
    else rejected.push(normalized);
  }
  const payload = {
    schema_version: RECOMMENDATION_SIGNALS_SCHEMA,
    user_id: user.userId,
    generated_by: generatedBy,
    source_job_id: sourceJobId,
    generated_at: nowIso(),
    signals: accepted,
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    ok: rejected.length === 0,
    user_id: user.userId,
    signal_path: filePath,
    accepted_count: accepted.length,
    rejected_count: rejected.length,
    signals: accepted,
    rejected,
  };
}

function fieldValue({offer = {}, merchant = {}}, field) {
  const lookup = {
    "offer.cuisine_tags": offer.cuisine_tags,
    "offer.decision_tags": offer.decision_tags,
    "offer.oil_level": offer.oil_level,
    "offer.spice_level": offer.spice_level,
    "offer.temperature": offer.temperature,
    "offer.service_speed": offer.service_speed,
    "offer.portion_size": offer.portion_size,
    "offer.satisfaction_level": offer.satisfaction_level,
    "offer.solo_friendly": offer.solo_friendly,
    "offer.price_per_person": offer.price_per_person,
    "merchant.queue_risk": merchant.queue_risk,
    "merchant.environment.noise_level": merchant.environment?.noise_level,
    "merchant.environment.chat_friendly": merchant.environment?.chat_friendly,
    "merchant.environment.solo_friendly": merchant.environment?.solo_friendly,
    "merchant.environment.comfort_level": merchant.environment?.comfort_level,
    "merchant.neighborhood": merchant.neighborhood,
    "merchant.specialties": merchant.specialties,
    "merchant.merchant_id": merchant.merchant_id,
  };
  return lookup[field];
}

function valueMatches(actual, operator, values) {
  const actualArray = Array.isArray(actual) ? actual : [actual];
  const actualText = actualArray.map(normalizedText).filter(Boolean);
  const expectedText = values.map(normalizedText).filter(Boolean);
  if (operator === "equals") {
    return actualArray.some((item) => values.some((value) => item === value || normalizedText(item) === normalizedText(value)));
  }
  if (operator === "in") {
    return actualText.some((item) => expectedText.includes(item));
  }
  if (operator === "contains_any") {
    return actualText.some((item) => expectedText.some((value) => item.includes(value) || value.includes(item)));
  }
  if (operator === "lte" || operator === "gte") {
    const actualNumber = Number(Array.isArray(actual) ? actual[0] : actual);
    const expectedNumber = Number(values[0]);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    return operator === "lte" ? actualNumber <= expectedNumber : actualNumber >= expectedNumber;
  }
  return false;
}

export function scoreMemorySignalsForOffer({signals = [], offer = {}, merchant = {}} = {}) {
  const features = [];
  for (const signal of signals) {
    const normalized = normalizeRecommendationSignal(signal);
    if (!normalized.ok || normalized.signal.status !== "active") continue;
    const clean = normalized.signal;
    const actual = fieldValue({offer, merchant}, clean.target.field);
    if (!valueMatches(actual, clean.target.operator, clean.target.values)) continue;
    features.push({
      source: "memory",
      key: `memory.${clean.category}.${clean.signal_id}`,
      score: clean.score_delta,
      reason: clean.reason,
      signal_id: clean.signal_id,
      preference_id: clean.preference_id,
      target: clean.target,
    });
  }
  return features;
}

function preferenceText(preference = {}) {
  return [
    preference.statement,
    preference.original_statement,
    preference.confirmation_text,
    preference.confirmationText,
    ...(Array.isArray(preference.evidence) ? preference.evidence : []),
  ].filter(Boolean).join(" ");
}

function signalFromPreference(preference, patch) {
  return normalizeRecommendationSignal({
    signal_id: `sig_${compactId(preference.preference_id || "pref")}_${compactId(patch.category)}_${compactId(patch.target.field)}_${compactId(patch.target.values.join("_"))}`,
    preference_id: preference.preference_id || "",
    status: preference.status || "active",
    category: patch.category,
    polarity: patch.polarity,
    confidence: preference.confidence,
    strength: preference.strength,
    target: patch.target,
    score_delta: patch.score_delta,
    reason: patch.reason || preference.statement || "长期记忆影响本次推荐排序。",
    generated_by: "deterministic_confirmed_preference_fallback",
  }).signal;
}

export function deriveRecommendationSignalsFromPreferences(preferences = []) {
  const signals = [];
  for (const preference of preferences) {
    if (!preference || preference.status && preference.status !== "active") continue;
    const category = String(preference.category || "").trim();
    const polarity = String(preference.polarity || "").trim();
    const text = preferenceText(preference);
    const negative = polarity === "negative" || Number(preference.strength || 0) < 0;
    const positive = polarity === "positive" || Number(preference.strength || 0) > 0;
    const patches = [];

    if (category === "food_oiliness" && negative) {
      patches.push({
        category,
        polarity: "negative",
        target: {field: "offer.oil_level", operator: "in", values: ["high"]},
        score_delta: -8,
        reason: preference.statement || "长期记忆：主人不太喜欢明显重油或油腻的餐食。",
      });
    }
    if (category === "spice" && negative) {
      patches.push({
        category,
        polarity: "negative",
        target: {field: "offer.spice_level", operator: "in", values: ["high"]},
        score_delta: -8,
        reason: preference.statement || "长期记忆：主人不太接受辣度过高的餐食。",
      });
    }
    if (category === "queue" && negative) {
      patches.push({
        category,
        polarity: "negative",
        target: {field: "merchant.queue_risk", operator: "in", values: ["high"]},
        score_delta: -6,
        reason: preference.statement || "长期记忆：主人不太能接受饭点排队或等位太久的店。",
      });
    }
    if (category === "ambience" && negative) {
      patches.push({
        category,
        polarity: "negative",
        target: {field: "merchant.environment.noise_level", operator: "in", values: ["high"]},
        score_delta: -5,
        reason: preference.statement || "长期记忆：主人会介意过吵或拥挤的用餐环境。",
      });
    }
    if ((category === "revisit_intent" || category === "taste_quality") && negative && preference.source_event?.merchant_id) {
      patches.push({
        category,
        polarity: "negative",
        target: {field: "merchant.merchant_id", operator: "equals", values: [preference.source_event.merchant_id]},
        score_delta: -14,
        reason: preference.statement || "长期记忆：主人之前对这家有明显负反馈。",
      });
    }
    if (category === "cuisine" && positive && /面条|吃面|汤面|粉面/.test(text)) {
      patches.push({
        category,
        polarity: "positive",
        target: {field: "offer.cuisine_tags", operator: "contains_any", values: ["noodle", "soup_noodle", "beef_noodle", "ramen"]},
        score_delta: 6,
        reason: preference.statement || "长期记忆：主人比较喜欢面条类餐食。",
      });
    }
    if (category === "cuisine" && positive && /川菜|四川|成都|自贡/.test(text)) {
      patches.push({
        category,
        polarity: "positive",
        target: {field: "offer.cuisine_tags", operator: "contains_any", values: ["sichuan", "classic_sichuan", "fine_sichuan", "creative_sichuan", "chengdu", "zigong", "yanbang"]},
        score_delta: 6,
        reason: preference.statement || "长期记忆：主人对川菜有稳定偏好。",
      });
    }

    for (const patch of patches) {
      const signal = signalFromPreference(preference, patch);
      if (signal) signals.push(signal);
    }
  }
  return signals;
}

export async function readRecommendationSignalsForScoring({workspaceRoot = config.storage.runtimeRoot, userId, memoryContext = null} = {}) {
  const safeUserId = normalizeUserId(userId);
  const stored = await readRecommendationSignals({workspaceRoot, userId: safeUserId});
  const contextPreferences = Array.isArray(memoryContext?.confirmed_preferences) ? memoryContext.confirmed_preferences : null;
  const preferences = contextPreferences || (await listConfirmedPreferences({workspaceRoot, userId: safeUserId, status: "active"})).preferences;
  const derived = deriveRecommendationSignalsFromPreferences(preferences);
  const byId = new Map();
  for (const signal of [...derived, ...(stored.signals || [])]) {
    if (!signal?.signal_id) continue;
    byId.set(signal.signal_id, signal);
  }
  return {
    ok: true,
    user_id: safeUserId,
    stored_count: (stored.signals || []).length,
    derived_count: derived.length,
    signals: [...byId.values()].filter((signal) => signal.status === "active"),
    rejected: stored.rejected || [],
  };
}
