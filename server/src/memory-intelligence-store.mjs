import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { getDayContext, getSession, createDayId } from "./session-store.mjs";
import {
  createMemoryCandidatesFromIntelligence,
  ensureMemoryUser,
  listConfirmedPreferences,
  listMemoryCandidates,
} from "./memory-store.mjs";
import { runMemoryIntelligenceExternalEngine } from "./memory-intelligence-engines.mjs";

const OBSERVATIONS_SCHEMA = "lifepilot.memory_observations.v1";
const OBSERVATION_SCHEMA = "lifepilot.memory_observation.v1";
const PROFILE_SCHEMA = "lifepilot.food_insight_profile.v1";
const JOB_SCHEMA = "lifepilot.memory_intelligence_job.v1";
const DEFAULT_USER_ID = "demo_weiyingru";
const MODE_ALIASES = {
  manual_day_review: "manual_daily_review",
  manual_week_review: "manual_weekly_review",
};
const VALID_MODES = new Set(["instant_review", "manual_daily_review", "manual_weekly_review", "session_reflection", "profile_update", "signal_refresh"]);
const VALID_ENGINES = new Set(["local_policy", "openclaw_agent", "ark"]);
const SENSITIVE_PATTERNS = [
  /\b\d{17}[\dXx]\b/,
  /\b1[3-9]\d{9}\b/,
  /\b\d{16,19}\b/,
];

const FCQ_LABELS = {
  health: "健康",
  mood: "情绪安慰",
  convenience: "便利",
  sensory: "感官吸引",
  natural_content: "天然成分",
  price: "价格",
  weight_control: "体重控制",
  familiarity: "熟悉感",
  ethical_concern: "伦理关切",
};

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_") || DEFAULT_USER_ID;
}

function compactText(value, max = 260) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeMode(mode = "manual_daily_review") {
  const raw = String(mode || "manual_daily_review");
  const normalized = MODE_ALIASES[raw] || raw;
  return VALID_MODES.has(normalized) ? normalized : "manual_daily_review";
}

function normalizeEngine(engine = "local_policy") {
  const raw = String(engine || "local_policy");
  return VALID_ENGINES.has(raw) ? raw : "local_policy";
}

function isWeeklyMode(mode = "") {
  return normalizeMode(mode) === "manual_weekly_review";
}

function jsonCharCount(value) {
  return JSON.stringify(value || {}).length;
}

function estimateTokensFromChars(charCount = 0) {
  return Math.ceil(Number(charCount || 0) / 2);
}

function buildInputMetrics(input = {}) {
  const sections = {
    observation: jsonCharCount(input.observation),
    observations: jsonCharCount(input.observations),
    day_context: jsonCharCount(input.day_context),
    meal_sessions: jsonCharCount(input.meal_sessions),
    pending_memory_candidates: jsonCharCount(input.pending_memory_candidates),
    confirmed_preferences: jsonCharCount(input.confirmed_preferences),
    food_insight_profile: jsonCharCount(input.food_insight_profile),
  };
  const charCount = jsonCharCount(input);
  const thresholdChars = isWeeklyMode(input.mode) ? 80000 : (input.mode === "profile_update" ? 50000 : 60000);
  return {
    char_count: charCount,
    estimated_tokens: estimateTokensFromChars(charCount),
    section_counts: sections,
    threshold_chars: thresholdChars,
    over_threshold: charCount > thresholdChars,
  };
}

function hasSensitiveText(text) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(String(text || "")));
}

function observationId() {
  return `obs_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function jobId() {
  return `mi_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function jobsRoot() {
  return path.join(config.storage.runtimeRoot, "memory_intelligence_jobs");
}

function jobPath(id) {
  return path.join(jobsRoot(), `${safeId(id)}.json`);
}

async function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
  return payload;
}

async function memoryIntelligencePaths({userId}) {
  const user = await ensureMemoryUser({userId});
  return {
    ...user,
    observationsPath: path.join(user.directory, "memory_observations.json"),
    profilePath: path.join(user.directory, "food_insight_profile.json"),
  };
}

function defaultObservationStore(userId) {
  return {
    schema_version: OBSERVATIONS_SCHEMA,
    user_id: userId,
    observations: [],
  };
}

export function defaultFoodInsightProfile(userId = DEFAULT_USER_ID) {
  const createdAt = nowIso();
  const motives = Object.fromEntries(
    Object.entries(FCQ_LABELS).map(([key, label]) => [key, {
      label,
      score: 0,
      confidence: 0,
      evidence_count: 0,
    }])
  );
  return {
    schema_version: PROFILE_SCHEMA,
    user_id: userId,
    food_choice_motives: motives,
    novelty_tolerance: {
      restaurants: {label: "新餐厅探索", score: 0, confidence: 0},
      cuisines: {label: "新菜系探索", score: 0, confidence: 0},
      ingredients: {label: "新食材探索", score: 0, confidence: 0},
    },
    reward_profile: {
      high_fat_sweet: {label: "高脂甜", score: 0, confidence: 0},
      low_fat_sweet: {label: "轻甜", score: 0, confidence: 0},
      high_fat_savory: {label: "高脂咸鲜", score: 0, confidence: 0},
      low_fat_savory: {label: "清爽咸鲜", score: 0, confidence: 0},
    },
    top_motives: [],
    display_cards: [],
    evidence_window: "暂无足够观察",
    confidence: 0,
    confidence_percent: 0,
    generated_by: "lifepilot_memory_intelligence",
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function normalizedObservation({userId, body = {}}) {
  const createdAt = nowIso();
  const text = compactText(body.text || body.summary || body.statement || body.latest_user_message || "");
  const sourceEvent = body.source_event && typeof body.source_event === "object" ? body.source_event : {};
  return {
    observation_id: body.observation_id || body.observationId || observationId(),
    schema_version: OBSERVATION_SCHEMA,
    user_id: userId,
    day_id: body.day_id || body.dayId || sourceEvent.day_id || "",
    source: body.source || sourceEvent.source || "system",
    type: body.type || "general_observation",
    status: body.status || "active",
    review_status: body.review_status || body.reviewStatus || "pending_review",
    strength: Number(body.strength ?? 0),
    confidence: Number(body.confidence ?? 0.5),
    text,
    summary: compactText(body.summary || text),
    tags: Array.isArray(body.tags) ? body.tags.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12) : [],
    evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 8) : [sourceEvent].filter((item) => Object.keys(item).length),
    source_event: sourceEvent,
    review: body.review || null,
    created_at: body.created_at || body.createdAt || createdAt,
    updated_at: createdAt,
  };
}

export async function createMemoryObservation({userId = DEFAULT_USER_ID, body = {}} = {}) {
  const user = await memoryIntelligencePaths({userId});
  const observation = normalizedObservation({userId: user.userId, body});
  if (!observation.text && !observation.summary) {
    return {ok: false, user_id: user.userId, error: "observation_text_required"};
  }
  if (hasSensitiveText(`${observation.text} ${JSON.stringify(observation.evidence)}`)) {
    return {ok: false, user_id: user.userId, error: "sensitive_text_rejected"};
  }
  const store = await readJsonIfExists(user.observationsPath, defaultObservationStore(user.userId));
  const observations = store.observations || [];
  const index = observations.findIndex((item) => item.observation_id === observation.observation_id);
  if (index >= 0) observations[index] = {...observations[index], ...observation};
  else observations.push(observation);
  store.observations = observations.slice(-500);
  await writeJsonAtomic(user.observationsPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    observation,
  };
}

export async function listMemoryObservations({userId = DEFAULT_USER_ID, dayId = "", limit = 50, status = ""} = {}) {
  const user = await memoryIntelligencePaths({userId});
  const store = await readJsonIfExists(user.observationsPath, defaultObservationStore(user.userId));
  const filtered = (store.observations || [])
    .filter((item) => (dayId ? item.day_id === dayId : true))
    .filter((item) => (status ? item.status === status || item.review_status === status : true))
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, Number(limit || 50));
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    observations: filtered,
    count: filtered.length,
  };
}

async function updateObservationReview({userId, observationId: targetId, review}) {
  if (!targetId || !review) return null;
  const user = await memoryIntelligencePaths({userId});
  const store = await readJsonIfExists(user.observationsPath, defaultObservationStore(user.userId));
  const observations = store.observations || [];
  const index = observations.findIndex((item) => item.observation_id === targetId);
  if (index < 0) return null;
  observations[index] = {
    ...observations[index],
    review_status: "reviewed",
    review,
    updated_at: nowIso(),
  };
  store.observations = observations;
  await writeJsonAtomic(user.observationsPath, store);
  return observations[index];
}

export async function readFoodInsightProfile({userId = DEFAULT_USER_ID} = {}) {
  const user = await memoryIntelligencePaths({userId});
  return readJsonIfExists(user.profilePath, defaultFoodInsightProfile(user.userId));
}

export async function writeFoodInsightProfile({userId = DEFAULT_USER_ID, profile = {}} = {}) {
  const user = await memoryIntelligencePaths({userId});
  const previous = await readFoodInsightProfile({userId: user.userId});
  const next = {
    ...previous,
    ...(profile || {}),
    schema_version: PROFILE_SCHEMA,
    user_id: user.userId,
    updated_at: nowIso(),
  };
  if (!next.created_at) next.created_at = nowIso();
  await writeJsonAtomic(user.profilePath, next);
  return {
    ok: true,
    user_id: user.userId,
    profile: next,
  };
}

function compactSessionForInput(session = {}) {
  return {
    session_id: session.session_id,
    user_id: session.user_id,
    day_id: session.day_id,
    meal_slot: session.meal_slot,
    status: session.status,
    stage: session.stage,
    goal: session.goal,
    entry_mode: session.entry_mode || "",
    source_message: session.source_message || "",
    direction_event_count: session.direction_events?.length || 0,
    offer_event_count: session.offer_events?.length || 0,
    final_decision: compactFinalDecisionForInput(session.result || null),
    created_at: session.created_at,
    updated_at: session.updated_at,
    finalized_at: session.finalized_at || null,
  };
}

function compactOfferForInput(offer = {}) {
  if (!offer || typeof offer !== "object") return null;
  return {
    offer_id: offer.offer_id || "",
    card_id: offer.card_id || "",
    merchant_id: offer.merchant_id || "",
    merchant_name: offer.merchant_name || "",
    title: offer.title || offer.display_title || "",
    price_per_person: offer.facts?.price_per_person ?? offer.price_per_person ?? null,
    score: offer.score ?? null,
    tags: Array.isArray(offer.tags) ? offer.tags.slice(0, 8) : [],
    cuisine_tags: Array.isArray(offer.facts?.cuisine_tags) ? offer.facts.cuisine_tags.slice(0, 8) : [],
    decision_tags: Array.isArray(offer.facts?.decision_tags) ? offer.facts.decision_tags.slice(0, 8) : [],
    queue_risk: offer.facts?.queue_risk || "",
    spice_level: offer.facts?.spice_level || "",
    oil_level: offer.facts?.oil_level || "",
    solo_friendly: offer.facts?.solo_friendly ?? null,
    matched_reasons: Array.isArray(offer.explanation?.matched)
      ? offer.explanation.matched.slice(0, 3).map((item) => compactText(item, 180))
      : [],
    watchouts: Array.isArray(offer.explanation?.watchouts)
      ? offer.explanation.watchouts.slice(0, 2).map((item) => compactText(item, 160))
      : [],
    top_scoring_features: Array.isArray(offer.scoring_features)
      ? offer.scoring_features
        .filter((item) => Number(item.score || 0) !== 0)
        .sort((left, right) => Math.abs(Number(right.score || 0)) - Math.abs(Number(left.score || 0)))
        .slice(0, 5)
        .map((item) => ({
          source: item.source || "",
          key: item.key || "",
          score: item.score ?? 0,
          reason: compactText(item.reason || "", 140),
        }))
      : [],
  };
}

function compactFinalDecisionForInput(result = null) {
  if (!result || typeof result !== "object") return null;
  const selected = Array.isArray(result.selected_merchants) ? result.selected_merchants : [];
  const alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
  return {
    has_selection: Boolean(result.hasSelection || result.has_selection),
    primary: compactOfferForInput(result.primary || null),
    selected_merchants: selected.slice(0, 3).map((item) => ({
      merchant_id: item.merchant_id || "",
      merchant_name: item.merchant_name || item.name || "",
      offer_id: item.offer_id || "",
      title: item.title || "",
    })),
    alternatives: alternatives.slice(0, 3).map(compactOfferForInput).filter(Boolean),
    summary_text: compactText(result.summary_text || result.summary || "", 260),
    ranking_basis: Array.isArray(result.ranking_basis)
      ? result.ranking_basis.slice(0, 5).map((item) => compactText(item, 160))
      : [],
  };
}

function compactDayContextForInput(dayContext = {}) {
  const mealSessions = Array.isArray(dayContext.meal_sessions) ? dayContext.meal_sessions : [];
  const xiaowangChats = Array.isArray(dayContext.xiaowang_chat_sessions) ? dayContext.xiaowang_chat_sessions : [];
  const memoryEvents = Array.isArray(dayContext.memory_events) ? dayContext.memory_events : [];
  return {
    day_id: dayContext.day_id || dayContext.id || "",
    user_id: dayContext.user_id || "",
    date: dayContext.date || "",
    timezone: dayContext.timezone || "Asia/Shanghai",
    meal_session_count: mealSessions.length,
    meal_sessions: mealSessions.slice(-8).map((item) => ({
      session_id: item.session_id || "",
      stage: item.stage || "",
      status: item.status || "",
      goal: compactText(item.goal || item.entry_summary || item.summary || "", 160),
      summary: compactText(item.summary || item.diary_text || "", 180),
      created_at: item.created_at || "",
      updated_at: item.updated_at || "",
    })),
    xiaowang_chat_count: xiaowangChats.length,
    xiaowang_chat_sessions: xiaowangChats.slice(-8).map((item) => ({
      session_id: item.session_id || "",
      title: compactText(item.title || "", 80),
      summary: compactText(item.summary || item.latest_message || "", 180),
      message_count: item.message_count || 0,
      created_at: item.created_at || "",
      updated_at: item.updated_at || "",
    })),
    memory_event_count: memoryEvents.length,
    memory_events: memoryEvents.slice(-12).map((item) => ({
      type: item.type || "",
      summary: compactText(item.summary || item.text || item.statement || "", 180),
      created_at: item.created_at || "",
    })),
  };
}

async function sessionsForDay(dayContext = {}) {
  const sessions = [];
  for (const item of dayContext.meal_sessions || []) {
    const session = await getSession(item.session_id);
    if (session) sessions.push(compactSessionForInput(session));
  }
  return sessions;
}

function compactObservationsForInput(observations = [], limit = 40) {
  return (Array.isArray(observations) ? observations : []).slice(0, limit).map((item) => ({
    observation_id: item.observation_id || "",
    day_id: item.day_id || "",
    source: item.source || "",
    type: item.type || "",
    review_status: item.review_status || "",
    confidence: item.confidence ?? 0.5,
    text: compactText(item.text || item.summary || "", 220),
    summary: compactText(item.summary || item.text || "", 180),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 3).map((evidence) => ({
      source: evidence.source || "",
      session_id: evidence.session_id || "",
      reason: compactText(evidence.reason || evidence.text || evidence.summary || "", 160),
    })) : [],
    created_at: item.created_at || "",
  }));
}

function compactPreferencesForInput(preferences = [], limit = 24) {
  return (Array.isArray(preferences) ? preferences : []).slice(0, limit).map((item) => ({
    preference_id: item.preference_id || "",
    category: item.category || "",
    scope: item.scope || "",
    polarity: item.polarity || "",
    strength: item.strength ?? 0,
    confidence: item.confidence ?? 0,
    status: item.status || "",
    statement: compactText(item.statement || item.confirmation_text || "", 220),
  }));
}

function compactCandidatesForInput(candidates = [], limit = 20) {
  return (Array.isArray(candidates) ? candidates : []).slice(0, limit).map((item) => ({
    candidate_id: item.candidate_id || "",
    type: item.type || "",
    category: item.category || "",
    polarity: item.polarity || "",
    confidence: item.confidence ?? 0,
    status: item.status || "",
    statement: compactText(item.statement || "", 220),
    confirmation_text: compactText(item.confirmation_text || "", 160),
  }));
}

export async function buildMemoryIntelligenceInput({
  mode = "manual_daily_review",
  userId = DEFAULT_USER_ID,
  dayId = "",
  lookbackDays = 7,
  observationId: targetObservationId = "",
} = {}) {
  const resolvedMode = normalizeMode(mode);
  const resolvedDayId = dayId || createDayId(userId, new Date());
  const [pending, preferences, observationsResult] = await Promise.all([
    listMemoryCandidates({userId, status: "pending"}),
    listConfirmedPreferences({userId, status: "active"}),
    listMemoryObservations({userId, dayId: isWeeklyMode(resolvedMode) ? "" : resolvedDayId, limit: 80}),
  ]);
  const observations = observationsResult.observations || [];
  const compactObservations = compactObservationsForInput(observations, isWeeklyMode(resolvedMode) ? 80 : 40);
  const observation = targetObservationId
    ? observations.find((item) => item.observation_id === targetObservationId) || null
    : compactObservations[0] || null;
  const dayContext = await getDayContext(resolvedDayId);
  const mealSessions = dayContext ? await sessionsForDay(dayContext) : [];
  const input = {
    schema_version: "lifepilot.memory_intelligence_input.v1",
    mode: resolvedMode,
    user_id: userId,
    day_id: resolvedDayId,
    lookback_days: Number(lookbackDays || 7),
    generated_at: nowIso(),
    policy: {
      memory_authority: "lifepilot_backend",
      may_create_confirmed_preferences: false,
      may_modify_meal_session: false,
      fcq_for_diary_only: true,
      demo_pending_candidates_can_be_visible: true,
    },
    observation,
    observations: compactObservations,
    day_context: dayContext ? compactDayContextForInput(dayContext) : null,
    meal_sessions: mealSessions,
    pending_memory_candidates: compactCandidatesForInput(pending.candidates || []),
    confirmed_preferences: compactPreferencesForInput(preferences.preferences || []),
  };
  return {
    ok: true,
    input,
    input_metrics: buildInputMetrics(input),
  };
}

function inferCandidateFromObservation(observation = {}) {
  const text = `${observation.text || ""} ${observation.summary || ""}`;
  if (!/(以后|下次|记住|少推荐|多推荐|别推|不要再推|一般|通常)/.test(text)) return null;
  let category = "general";
  let polarity = /(少推荐|别推|不要|不喜欢|讨厌|避开)/.test(text) ? "negative" : "positive";
  let confirmationText = compactText(observation.text || observation.summary, 120);
  if (/排队|等位|等待/.test(text)) {
    category = "queue";
    polarity = "negative";
    confirmationText = /中午/.test(text) ? "中午少推荐排队或等位太久的店" : "以后少推荐排队或等位太久的店";
  } else if (/太油|油腻|重油|偏油/.test(text)) {
    category = "food_oiliness";
    polarity = "negative";
    confirmationText = "以后少推荐明显重油或油腻的餐食";
  } else if (/太辣|过辣|辣到/.test(text)) {
    category = "spice";
    polarity = "negative";
    confirmationText = "以后少推荐辣度过高的餐食";
  } else if (/面条|热汤面|汤面/.test(text)) {
    category = "cuisine";
    polarity = "positive";
    confirmationText = "以后可以多推荐面条或热汤面类餐食";
  } else if (/轻食/.test(text)) {
    category = "cuisine";
    polarity = "negative";
    confirmationText = /今天/.test(text) && !/(以后|下次|一般|通常)/.test(text) ? "" : "以后少推荐轻食类餐食";
  }
  if (!confirmationText) return null;
  return {
    type: "food_preference",
    category,
    polarity,
    scope: "food",
    strength: polarity === "negative" ? -0.62 : 0.62,
    confidence: 0.82,
    statement: `主人表达了可用于推荐的偏好：${confirmationText}`,
    confirmation_text: confirmationText,
    evidence: [{
      source: observation.source || "memory_observation",
      observation_id: observation.observation_id || "",
      session_id: observation.source_event?.session_id || "",
      reason: observation.text || observation.summary || "",
    }],
    needs_confirmation: true,
  };
}

function localFoodInsightProfile({userId, observations = [], preferences = []} = {}) {
  const profile = defaultFoodInsightProfile(userId);
  const evidenceTexts = [
    ...observations.map((item) => `${item.text || ""} ${item.summary || ""}`),
    ...preferences.map((item) => `${item.statement || ""} ${item.confirmation_text || ""}`),
  ];
  const joined = evidenceTexts.join(" ");
  const boosts = {
    convenience: /(省心|快点|不折腾|少排队|附近|赶时间|中午)/.test(joined) ? 82 : 42,
    sensory: /(川菜|辣|香|锅气|下饭|好吃|口味)/.test(joined) ? 76 : 48,
    familiarity: /(熟悉|常去|老店|稳妥|不要新|别试)/.test(joined) ? 68 : 46,
    mood: /(累|疲惫|安慰|热乎|今天状态|压力)/.test(joined) ? 55 : 36,
    health: /(清淡|低油|健康|轻负担|少油)/.test(joined) ? 58 : 42,
    price: /(便宜|划算|预算|贵|性价比|团购|优惠)/.test(joined) ? 62 : 36,
    weight_control: /(减脂|体重|热量|轻食)/.test(joined) ? 52 : 20,
    natural_content: /(天然|有机|少添加)/.test(joined) ? 40 : 12,
    ethical_concern: /(环保|动物|素食|伦理)/.test(joined) ? 42 : 5,
  };
  profile.food_choice_motives = Object.fromEntries(
    Object.entries(profile.food_choice_motives).map(([key, value]) => [key, {
      ...value,
      score: boosts[key] ?? 0,
      confidence: evidenceTexts.length ? 0.68 : 0.2,
      evidence_count: evidenceTexts.length,
    }])
  );
  profile.novelty_tolerance = {
    restaurants: {label: "新餐厅探索", score: /(新店|试试|没吃过)/.test(joined) ? 64 : 42, confidence: 0.52},
    cuisines: {label: "新菜系探索", score: /(新菜系|没吃过|异国|尝鲜)/.test(joined) ? 58 : 48, confidence: 0.46},
    ingredients: {label: "新食材探索", score: /(内脏|发酵|昆虫|生食|奇怪)/.test(joined) ? 38 : 45, confidence: 0.38},
  };
  profile.reward_profile = {
    high_fat_sweet: {label: "高脂甜", score: /(蛋糕|奶茶|甜品|冰淇淋)/.test(joined) ? 66 : 32, confidence: 0.42},
    low_fat_sweet: {label: "轻甜", score: /(水果|酸奶|轻甜)/.test(joined) ? 52 : 36, confidence: 0.38},
    high_fat_savory: {label: "高脂咸鲜", score: /(炸|烧烤|红烧|披萨|重油|下饭)/.test(joined) ? 72 : 50, confidence: 0.58},
    low_fat_savory: {label: "清爽咸鲜", score: /(清淡|汤|粉面|低油|蒸)/.test(joined) ? 64 : 46, confidence: 0.52},
  };
  profile.top_motives = Object.entries(profile.food_choice_motives)
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, 4)
    .map(([key, value]) => ({key, label: value.label, score: value.score}));
  profile.display_cards = profile.top_motives.map((item) => ({
    title: item.label,
    score: item.score,
    text: `最近这个动机在推荐偏好里更明显，适合用于汪记本展示。`,
  }));
  profile.evidence_window = evidenceTexts.length ? `近 ${Math.min(evidenceTexts.length, 30)} 条饭点和小汪观察` : "暂无足够观察";
  profile.confidence = evidenceTexts.length ? Math.min(0.82, 0.42 + evidenceTexts.length * 0.04) : 0.2;
  profile.confidence_percent = Math.round(profile.confidence * 100);
  return profile;
}

function buildLocalIntelligenceResult(input = {}) {
  const mode = normalizeMode(input.mode || "manual_daily_review");
  const observation = input.observation || null;
  const observations = input.observations || [];
  const preferences = input.confirmed_preferences || [];
  const result = {
    mode,
    user_id: input.user_id || DEFAULT_USER_ID,
    day_id: input.day_id || "",
    summary: "",
    observations: [],
    weak_hypotheses: [],
    memory_candidates: [],
    preference_update_suggestions: [],
    food_insight_profile: null,
    xiaowang_next_interaction_ideas: [],
  };
  if (mode === "instant_review" && observation) {
    const candidate = inferCandidateFromObservation(observation);
    result.summary = candidate
      ? "这条观察包含明确或强烈的长期偏好信号，适合展示为待确认记忆。"
      : "这条观察更适合作为短期状态或普通观察，暂不升级为长期记忆候选。";
    result.weak_hypotheses = candidate ? [] : [{
      type: "short_term_observation",
      statement: observation.summary || observation.text,
      confidence: observation.confidence || 0.5,
      evidence: [{source: observation.source, observation_id: observation.observation_id}],
    }];
    if (candidate) result.memory_candidates = [candidate];
    return result;
  }
  if (mode === "profile_update") {
    result.summary = "已根据近期饭点和小汪观察更新食物选择画像。";
    result.food_insight_profile = localFoodInsightProfile({
      userId: input.user_id,
      observations,
      preferences,
    });
    return result;
  }
  const repeated = observations
    .map((item) => item.text || item.summary || "")
    .join(" ");
  result.summary = observations.length
    ? `小汪整理了 ${observations.length} 条近期观察，适合在汪记本里展示今日模式。`
    : "今天暂时没有足够观察。";
  if (/排队|等位/.test(repeated)) {
    result.memory_candidates.push({
      type: "food_preference",
      category: "queue",
      polarity: "negative",
      scope: "food",
      strength: -0.62,
      confidence: 0.78,
      statement: "主人最近多次提到排队或等位风险，推荐时应更主动避开排队久的店。",
      confirmation_text: "以后少推荐排队或等位太久的店",
      evidence: observations.slice(0, 5).map((item) => ({
        source: item.source,
        observation_id: item.observation_id,
        reason: item.text || item.summary,
      })),
      needs_confirmation: true,
    });
  }
  result.xiaowang_next_interaction_ideas = observations.length ? [{
    type: "diary_prompt",
    timing_hint: "open_diary",
    text: "主人，要不要看看小汪根据今天记录整理出来的偏好？",
  }] : [];
  if (mode === "manual_daily_review") {
    result.food_insight_profile = localFoodInsightProfile({
      userId: input.user_id,
      observations,
      preferences,
    });
  }
  return result;
}

export async function storeMemoryIntelligenceResult({
  mode = "manual_daily_review",
  engine = "local_policy",
  requestedEngine = "",
  fallbackReason = "",
  userId = DEFAULT_USER_ID,
  dayId = "",
  observationId: sourceObservationId = "",
  input = null,
  inputMetrics = null,
  timing = null,
  result = {},
  source = "",
} = {}) {
  const resolvedMode = normalizeMode(mode);
  const resolvedEngine = normalizeEngine(engine);
  const resolvedRequestedEngine = requestedEngine ? normalizeEngine(requestedEngine) : resolvedEngine;
  const normalized = {
    mode: normalizeMode(result.mode || resolvedMode),
    user_id: result.user_id || userId,
    day_id: result.day_id || dayId,
    summary: compactText(result.summary || ""),
    observations: Array.isArray(result.observations) ? result.observations : [],
    weak_hypotheses: Array.isArray(result.weak_hypotheses || result.weakHypotheses)
      ? (result.weak_hypotheses || result.weakHypotheses)
      : [],
    memory_candidates: Array.isArray(result.memory_candidates || result.memoryCandidates)
      ? (result.memory_candidates || result.memoryCandidates)
      : [],
    preference_update_suggestions: Array.isArray(result.preference_update_suggestions || result.preferenceUpdateSuggestions)
      ? (result.preference_update_suggestions || result.preferenceUpdateSuggestions)
      : [],
    food_insight_profile: result.food_insight_profile || result.foodInsightProfile || null,
    xiaowang_next_interaction_ideas: Array.isArray(result.xiaowang_next_interaction_ideas || result.xiaowangNextInteractionIdeas)
      ? (result.xiaowang_next_interaction_ideas || result.xiaowangNextInteractionIdeas)
      : [],
  };
  const resolvedJobId = jobId();
  const createdObservations = [];
  for (const item of normalized.observations) {
    const created = await createMemoryObservation({
      userId: normalized.user_id,
      body: {
        ...item,
        day_id: item.day_id || normalized.day_id,
        source: item.source || "memory_intelligence",
        review_status: "reviewed",
      },
    });
    if (created.ok) createdObservations.push(created.observation);
  }
  for (const item of normalized.weak_hypotheses) {
    const created = await createMemoryObservation({
      userId: normalized.user_id,
      body: {
        type: item.type || "weak_hypothesis",
        day_id: normalized.day_id,
        source: "memory_intelligence",
        text: item.statement || item.summary || item.text || "",
        summary: item.statement || item.summary || item.text || "",
        confidence: item.confidence ?? 0.55,
        evidence: item.evidence || [],
        review_status: "weak_hypothesis",
      },
    });
    if (created.ok) createdObservations.push(created.observation);
  }
  const candidateResult = normalized.memory_candidates.length
    ? await createMemoryCandidatesFromIntelligence({
      userId: normalized.user_id,
      jobId: resolvedJobId,
      dayId: normalized.day_id,
      candidates: normalized.memory_candidates,
    })
    : {ok: true, created_count: 0, candidates: [], rejected: []};
  let profileResult = null;
  if (normalized.food_insight_profile) {
    profileResult = await writeFoodInsightProfile({
      userId: normalized.user_id,
      profile: normalized.food_insight_profile,
    });
  }
  const review = {
    mode: normalized.mode,
    engine: resolvedEngine,
    requested_engine: resolvedRequestedEngine,
    fallback_reason: fallbackReason || "",
    source,
    summary: normalized.summary,
    candidate_count: candidateResult.created_count || 0,
    weak_hypothesis_count: normalized.weak_hypotheses.length,
    reviewed_at: nowIso(),
  };
  const reviewedObservation = await updateObservationReview({
    userId: normalized.user_id,
    observationId: sourceObservationId,
    review,
  });
  const job = {
    schema_version: JOB_SCHEMA,
    job_id: resolvedJobId,
    mode: normalized.mode,
    engine: resolvedEngine,
    requested_engine: resolvedRequestedEngine,
    fallback_reason: fallbackReason || "",
    user_id: normalized.user_id,
    day_id: normalized.day_id,
    source,
    status: "completed",
    source_observation_id: sourceObservationId || "",
    summary: normalized.summary,
    created_observations: createdObservations,
    accepted_memory_candidates: candidateResult.candidates || [],
    rejected_memory_candidates: candidateResult.rejected || [],
    preference_update_suggestions: normalized.preference_update_suggestions,
    food_insight_profile_updated: Boolean(profileResult?.ok),
    xiaowang_next_interaction_ideas: normalized.xiaowang_next_interaction_ideas,
    input_metrics: inputMetrics || (input ? buildInputMetrics(input) : null),
    timing: timing || null,
    input_snapshot: input || null,
    raw_result: result,
    stored_at: nowIso(),
  };
  await writeJsonAtomic(jobPath(job.job_id), job);
  return {
    ok: true,
    job,
    reviewed_observation: reviewedObservation,
    created_observations: createdObservations,
    candidate_result: candidateResult,
    profile: profileResult?.profile || null,
  };
}

export async function runMemoryIntelligence({
  mode = "manual_daily_review",
  engine = "local_policy",
  userId = DEFAULT_USER_ID,
  dayId = "",
  observationId: targetObservationId = "",
  lookbackDays = 7,
  timeoutSeconds = 180,
  sessionId = "",
  source = "local_policy",
} = {}) {
  const startedAt = Date.now();
  const requestedEngine = normalizeEngine(engine);
  const resolvedMode = normalizeMode(mode);
  const inputStartedAt = Date.now();
  const inputPayload = await buildMemoryIntelligenceInput({
    mode: resolvedMode,
    userId,
    dayId,
    observationId: targetObservationId,
    lookbackDays,
  });
  if (!inputPayload.ok) return inputPayload;
  const inputBuildMs = Date.now() - inputStartedAt;
  const engineStartedAt = Date.now();
  let resolvedEngine = requestedEngine;
  let fallbackReason = "";
  let result = null;
  let engineMs = 0;
  let engineResult = null;
  if (requestedEngine === "local_policy") {
    result = buildLocalIntelligenceResult(inputPayload.input);
    engineMs = Date.now() - engineStartedAt;
  } else {
    engineResult = await runMemoryIntelligenceExternalEngine({
      engine: requestedEngine,
      input: inputPayload.input,
      userId,
      dayId: inputPayload.input.day_id,
      timeoutSeconds,
      sessionId,
    });
    engineMs = Number(engineResult?.timing?.agent_ms || (Date.now() - engineStartedAt));
    if (engineResult.ok && engineResult.result) {
      result = engineResult.result;
    } else {
      resolvedEngine = "local_policy";
      fallbackReason = engineResult?.error_message || engineResult?.error || `${requestedEngine}_engine_not_connected_yet`;
      result = buildLocalIntelligenceResult(inputPayload.input);
    }
  }
  const storeStartedAt = Date.now();
  const stored = await storeMemoryIntelligenceResult({
    mode: resolvedMode,
    engine: resolvedEngine,
    requestedEngine,
    fallbackReason,
    userId,
    dayId: inputPayload.input.day_id,
    observationId: targetObservationId,
    input: inputPayload.input,
    inputMetrics: inputPayload.input_metrics,
    result,
    source: source || resolvedEngine,
    timing: {
      input_build_ms: inputBuildMs,
      agent_ms: engineMs,
      store_ms: 0,
      total_ms: 0,
    },
  });
  const storeMs = Date.now() - storeStartedAt;
  const totalMs = Date.now() - startedAt;
  if (stored?.job) {
    stored.job.timing = {
      ...(stored.job.timing || {}),
      store_ms: storeMs,
      total_ms: totalMs,
    };
    await writeJsonAtomic(jobPath(stored.job.job_id), stored.job);
  }
  if (stored?.job && engineResult) {
    stored.job.engine_run = {
      ok: Boolean(engineResult.ok),
      engine: requestedEngine,
      session_id: engineResult.session_id || "",
      error: engineResult.ok ? "" : (engineResult.error || ""),
    };
    await writeJsonAtomic(jobPath(stored.job.job_id), stored.job);
  }
  return stored;
}

export async function listMemoryIntelligenceJobs({userId = "", dayId = "", mode = "", limit = 20} = {}) {
  const normalizedMode = mode ? normalizeMode(mode) : "";
  let entries = [];
  try {
    entries = await readdir(jobsRoot());
  } catch (error) {
    if (error?.code === "ENOENT") return {ok: true, jobs: [], count: 0};
    throw error;
  }
  const jobs = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const job = await readJsonIfExists(path.join(jobsRoot(), entry), null);
    if (!job || job.schema_version !== JOB_SCHEMA) continue;
    if (userId && job.user_id !== userId) continue;
    if (dayId && job.day_id !== dayId) continue;
    if (normalizedMode && normalizeMode(job.mode) !== normalizedMode) continue;
    jobs.push(job);
  }
  return {
    ok: true,
    jobs: jobs.sort((left, right) => String(right.stored_at || "").localeCompare(String(left.stored_at || ""))).slice(0, Number(limit || 20)),
    count: jobs.length,
  };
}
