import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getAdminCatalog, createAdminItem, updateAdminItem, deleteAdminItem, uploadAdminAsset, adminHttpError } from "./admin-data.mjs";
import { buildFoodDirectionCards, filterFoodDirectionCards } from "./cards.mjs";
import { config } from "./config.mjs";
import { REPO_ROOT } from "./config.mjs";
import { buildDirectionSummary } from "./direction-summary.mjs";
import { parseEntry } from "./entry-parser.mjs";
import { buildFoodOffers, explainOneOfferCard, selectFinalDecisionWithContext } from "./offer-cards.mjs";
import { queuePayload, routePayload, weatherPayload } from "./context-providers.mjs";
import { fail, ok, readBody, sendJson } from "./http.mjs";
import { appendMemoryCandidatesToDayContext, appendSwipeEvent, applyDirectionSummary, applyFinalDecision, applyOfferCards, createDayId, createSession, getDayContext, getSession, normalizeSwipeEvent, setSessionMemoryContext, updateCurrentOfferCard, updateSessionEntry } from "./session-store.mjs";
import {
  confirmMemoryCandidate,
  createMemoryCandidate,
  createConfirmedPreference,
  createPostMealMemoryCandidates,
  listConfirmedPreferences,
  listMemoryCandidates,
  readUserMemoryContext,
  readRecommendationMemoryContext,
  rejectMemoryCandidate,
  setConfirmedPreferenceStatus,
  updateConfirmedPreference,
} from "./memory-store.mjs";
import { executeMemoryManageOperation } from "./memory-manager.mjs";
import { recordMerchantFeedback } from "./merchant-feedback-store.mjs";
import { buildDealSearchContext, buildMerchantCompareContext, buildMerchantIntelContext, resolveMerchantsFromText, searchMerchantCandidates } from "./merchant-tools.mjs";
import { buildOpenClawDreamInput, getOpenClawJob, getOpenClawJobByDreamId, storeOpenClawDreamResult } from "./openclaw-store.mjs";
import { getXiaowangChatJob, getXiaowangChatSession, handleXiaowangChat, listXiaowangChatSessions, listXiaowangSkills, readXiaowangDiary, startXiaowangChatJob } from "./xiaowang-store.mjs";
import {
  buildMemoryIntelligenceInput,
  createMemoryObservation,
  listMemoryIntelligenceJobs,
  listMemoryObservations,
  readFoodInsightProfile,
  runMemoryIntelligence,
  storeMemoryIntelligenceResult,
} from "./memory-intelligence-store.mjs";

let latestLocationProbe = null;

function publicSession(session) {
  return session;
}

function memoryContextMeta(memoryContext = {}, source = "") {
  return {
    ...(source ? {source} : {}),
    confirmed_preferences: memoryContext.preference_count || 0,
    policy: memoryContext.policy || "local_active_confirmed_preferences_are_strong",
  };
}

function compactText(value, max = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function queryTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesQuery(value, tokens = []) {
  if (!tokens.length) return true;
  const haystack = JSON.stringify(value || {}).toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function memoryTimestamp(item = {}) {
  return item.updated_at || item.stored_at || item.created_at || item.confirmed_at || item.finalized_at || "";
}

function compactPreferenceForSearch(item = {}) {
  return {
    type: "confirmed_preference",
    id: item.preference_id || "",
    status: item.status || "",
    category: item.category || "",
    polarity: item.polarity || "",
    title: item.statement || item.confirmation_text || "",
    text: item.statement || item.confirmation_text || "",
    confidence: item.confidence ?? null,
    source_id: item.source_candidate_id || "",
    occurred_at: memoryTimestamp(item),
  };
}

function compactCandidateForSearch(item = {}) {
  return {
    type: "memory_candidate",
    id: item.candidate_id || "",
    status: item.status || "",
    category: item.category || "",
    polarity: item.polarity || "",
    title: item.confirmation_text || item.statement || "",
    text: item.statement || item.confirmation_text || "",
    confidence: item.confidence ?? null,
    source_id: item.source_event?.session_id || item.source_event?.dream_id || "",
    occurred_at: memoryTimestamp(item),
  };
}

function compactObservationForSearch(item = {}) {
  return {
    type: "memory_observation",
    id: item.observation_id || "",
    status: item.review_status || item.status || "",
    category: item.type || "",
    polarity: "",
    title: item.summary || item.text || "",
    text: item.summary || item.text || "",
    confidence: item.confidence ?? null,
    source_id: item.source_event?.session_id || item.source_event?.message_id || "",
    day_id: item.day_id || "",
    occurred_at: memoryTimestamp(item),
  };
}

function compactMemoryJobForSearch(item = {}) {
  return {
    type: "memory_intelligence_job",
    id: item.job_id || "",
    status: item.status || "",
    category: item.mode || "",
    polarity: "",
    title: item.summary || `${item.mode || "memory"} job`,
    text: item.summary || "",
    confidence: null,
    source_id: item.source_observation_id || "",
    day_id: item.day_id || "",
    occurred_at: memoryTimestamp(item),
  };
}

function compactMealSessionForMemory(session = {}) {
  return {
    type: "meal_session",
    session_id: session.session_id || "",
    user_id: session.user_id || "",
    day_id: session.day_id || "",
    meal_slot: session.meal_slot || "",
    status: session.status || "",
    stage: session.stage || "",
    goal: session.goal || session.understanding?.normalized_goal || "",
    source_message: session.source_message || "",
    entry_mode: session.entry_mode || "",
    location: session.location || null,
    constraints: session.understanding?.constraints || {},
    hard_constraints: session.understanding?.hard_constraints || [],
    soft_preferences: session.understanding?.soft_preferences || [],
    direction_event_count: session.direction_events?.length || 0,
    offer_event_count: session.offer_events?.length || 0,
    current_card_count: session.current_cards?.length || 0,
    final_offer_id: session.result?.primary?.offer_id || "",
    final_merchant_id: session.result?.primary?.merchant_id || "",
    final_merchant_name: session.result?.primary?.merchant_name || "",
    summary: compactText([
      session.goal || session.understanding?.normalized_goal || "",
      session.result?.summary || session.result?.primary?.merchant_name || "",
    ].filter(Boolean).join("；")),
    created_at: session.created_at || "",
    updated_at: session.updated_at || "",
    finalized_at: session.finalized_at || "",
  };
}

async function handleHealth(res) {
  ok(res, {
    service: "lifepilot-api",
    runtime: config.runtimeName,
    version: "p1",
    marker: "lifepilot-next-p1",
  });
}

async function handleFoodDirections(res) {
  const cards = await buildFoodDirectionCards();
  ok(res, {cards});
}

async function handleSessionStart(req, res) {
  const body = await readBody(req);
  const entryForm = body.entry_form || body.entryForm || {};
  if (body.location || body.user_location || body.userLocation) {
    entryForm.location = body.location || body.user_location || body.userLocation;
  }
  const parsed = await parseEntry({
    entryForm,
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
  });
  const allCards = await buildFoodDirectionCards();
  const cards = filterFoodDirectionCards(allCards, parsed);
  const memoryContext = await readRecommendationMemoryContext({
    userId: body.user_id || body.userId || "demo_weiyingru",
    query: [
      parsed.normalized_goal,
      entryForm.raw_query || entryForm.rawQuery || entryForm.free_text || entryForm.freeText || entryForm.text || entryForm.goal,
      ...(parsed.soft_preferences || []).map((item) => item.value || item.intent || "").filter(Boolean),
    ].filter(Boolean).join("；"),
  });
  const session = await createSession({
    sessionId: body.session_id || body.sessionId,
    userId: body.user_id || body.userId || "demo_weiyingru",
    dayId: body.day_id || body.dayId,
    mealSlot: body.meal_slot || body.mealSlot,
    entryForm,
    parsed,
    cards,
    memoryContext,
  });
  ok(res, {
    session: publicSession(session),
    meta: {
      memory_context: {
        ...memoryContextMeta(memoryContext, "session_start"),
      },
    },
  });
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function mergeUnderstanding(base = {}, override = {}) {
  if (!override || typeof override !== "object") return base;
  return {
    ...base,
    ...override,
    constraints: {
      ...(base.constraints || {}),
      ...(override.constraints || {}),
    },
    dimensions: {
      ...(base.dimensions || {}),
      ...(override.dimensions || {}),
    },
    hard_constraints: Array.isArray(override.hard_constraints || override.hardConstraints)
      ? (override.hard_constraints || override.hardConstraints)
      : (base.hard_constraints || []),
    soft_preferences: Array.isArray(override.soft_preferences || override.softPreferences)
      ? (override.soft_preferences || override.softPreferences)
      : (base.soft_preferences || []),
    special_signals: Array.isArray(override.special_signals || override.specialSignals)
      ? (override.special_signals || override.specialSignals)
      : (base.special_signals || []),
    normalized_goal: override.normalized_goal || override.normalizedGoal || base.normalized_goal || "",
    raw_entry_text: override.raw_entry_text || override.rawEntryText || base.raw_entry_text || "",
  };
}

async function handleMealPrimitiveStartOffers(req, res) {
  const body = await readBody(req);
  const userId = body.user_id || body.userId || "demo_weiyingru";
  const sourceMessage = String(body.source_message || body.sourceMessage || body.query || body.message || "").trim();
  const entryForm = {
    ...(body.entry_form || body.entryForm || {}),
  };
  if (sourceMessage && !entryForm.raw_query && !entryForm.rawQuery && !entryForm.text) {
    entryForm.raw_query = sourceMessage;
    entryForm.text = sourceMessage;
  }
  if (body.location || body.user_location || body.userLocation) {
    entryForm.location = body.location || body.user_location || body.userLocation;
  }
  const parsedBase = await parseEntry({
    entryForm,
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
  });
  const parsed = mergeUnderstanding(parsedBase, body.understanding || body.parsed || {});
  const candidateMerchantIds = normalizeStringArray(body.candidate_merchant_ids || body.candidateMerchantIds);
  const memoryContext = await readRecommendationMemoryContext({
    userId,
    query: [
      parsed.normalized_goal,
      sourceMessage,
      ...(parsed.soft_preferences || []).map((item) => item.value || item.intent || "").filter(Boolean),
    ].filter(Boolean).join("；"),
  });
  const entryMode = body.entry_mode || body.entryMode || (candidateMerchantIds.length ? "merchant_compare" : "offer_only");
  const session = await createSession({
    sessionId: body.session_id || body.sessionId,
    userId,
    dayId: body.day_id || body.dayId,
    mealSlot: body.meal_slot || body.mealSlot,
    entryForm,
    parsed,
    cards: [],
    memoryContext,
    entryMode,
    startedBy: body.started_by || body.startedBy || "openclaw",
    sourceMessage,
    skippedDirectionStage: true,
    candidateMerchantIds,
    openclaw: body.openclaw || null,
    primitiveChain: body.primitive_chain || body.primitiveChain || ["start-offers"],
  });
  const offerPayload = await buildFoodOffers({
    session,
    body: {
      ...body,
      candidate_merchant_ids: candidateMerchantIds,
      ai_explanations: body.ai_explanations ?? body.aiExplanations ?? false,
    },
    limit: body.limit || 10,
  });
  await applyOfferCards(session, offerPayload);
  ok(res, {
    session: publicSession(session),
    offer_payload: offerPayload,
    skill_card: {
      skill: "meal_swipe",
      action: "open_meal_session",
      title: entryMode === "merchant_compare" ? "滑卡比较这几家" : "直接看相关商户",
      description: entryMode === "merchant_compare" ? "小汪已把这几家店放进商户卡。" : "小汪已按你的需求准备好商户卡。",
      cta: "开始滑卡",
      payload: {
        session_id: session.session_id,
        entry_mode: entryMode,
      },
    },
    meta: {
      primitive: "start-offers",
      memory_context: memoryContextMeta(memoryContext),
    },
  });
}

async function handleParseEntry(req, res) {
  const body = await readBody(req);
  const entryForm = body.entry_form || body.entryForm || body;
  const understanding = await parseEntry({
    entryForm,
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
  });
  ok(res, {
    understanding,
    meta: {
      fallback_used: understanding.parse_mode === "local_fallback",
      fallback_reason: understanding.warning?.code || null,
    },
  });
}

async function handleSessionSwipe(req, res) {
  const body = await readBody(req);
  const session = await getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  let event;
  try {
    event = normalizeSwipeEvent(session, body);
  } catch (error) {
    if (error?.code === "card_not_found") {
      fail(res, 404, "card_not_found", "Card not found in current session stack.");
      return;
    }
    throw error;
  }
  if (!event) {
    fail(res, 422, "invalid_payload", "action must be keep or dislike.");
    return;
  }
  await appendSwipeEvent(session, event);
  ok(res, {
    event,
    session: publicSession(session),
  });
}

async function handleSessionEntryUpdate(req, res) {
  const body = await readBody(req);
  const session = await getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  if (!["direction", "direction_summary"].includes(session.stage)) {
    fail(res, 409, "invalid_session_stage", "Entry can only be updated before merchant selection.", {stage: session.stage});
    return;
  }
  const entryForm = {
    ...(session.entry_form || {}),
    ...(body.entry_form || body.entryForm || {}),
  };
  if (body.location || body.user_location || body.userLocation) {
    entryForm.location = body.location || body.user_location || body.userLocation;
  }
  const parsed = await parseEntry({
    entryForm,
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
  });
  const allCards = await buildFoodDirectionCards();
  const cards = filterFoodDirectionCards(allCards, parsed);
  const memoryContext = await readRecommendationMemoryContext({
    userId: session.user_id,
    query: [
      parsed.normalized_goal,
      entryForm.raw_query || entryForm.rawQuery || entryForm.free_text || entryForm.freeText || entryForm.text || entryForm.goal,
      ...(parsed.soft_preferences || []).map((item) => item.value || item.intent || "").filter(Boolean),
    ].filter(Boolean).join("；"),
  });
  await updateSessionEntry({session, entryForm, parsed, cards, memoryContext});
  ok(res, {
    session: publicSession(session),
    meta: {
      fallback_used: parsed.parse_mode === "local_fallback",
      fallback_reason: parsed.warning?.code || null,
      memory_context: {
        ...memoryContextMeta(memoryContext, "session_entry_update"),
      },
    },
  });
}

async function handleSessionView(res, sessionId) {
  const session = await getSession(sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  ok(res, {session: publicSession(session)});
}

async function handleDayContextView(res, dayId) {
  const dayContext = await getDayContext(dayId);
  if (!dayContext) {
    fail(res, 404, "day_context_not_found", "Day context not found.");
    return;
  }
  ok(res, {day_context: dayContext});
}

async function handleSessionAdvance(req, res) {
  const body = await readBody(req);
  const session = await getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  if (session.stage === "direction_summary") {
    const payload = await buildFoodOffers({session, body, limit: body.limit || 10});
    await applyOfferCards(session, payload);
    ok(res, {session: publicSession(session), offer_payload: payload});
    return;
  }
  if (session.stage !== "direction") {
    fail(res, 409, "invalid_session_transition", "Session can only advance from direction in P2.", {
      stage: session.stage,
      supported_transition: "direction -> direction_summary -> offer",
    });
    return;
  }
  let memoryContext = session.memory_context;
  if (!memoryContext || body.refresh_memory === true || body.refreshMemory === true) {
    memoryContext = await readRecommendationMemoryContext({
      userId: session.user_id,
      query: [
        session.goal,
        session.entry_form?.raw_query,
        ...(session.direction_events || []).map((event) => event.title).filter(Boolean),
      ].filter(Boolean).join("；"),
    });
    await setSessionMemoryContext(session, memoryContext);
  }
  const summaryPayload = await buildDirectionSummary({
    goal: session.goal,
    events: session.direction_events,
    entryContext: {
      entry_form: session.entry_form,
      understanding: session.understanding,
    },
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
    memoryContext,
  });
  await applyDirectionSummary(session, summaryPayload);
  ok(res, {
    session: publicSession(session),
    meta: {
      ...(summaryPayload.meta || {fallback_used: false}),
      memory_context: memoryContextMeta(memoryContext),
    },
  });
}

async function handleSessionOfferExplanation(req, res) {
  const body = await readBody(req);
  const session = await getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  if (session.stage !== "offer") {
    fail(res, 409, "invalid_session_stage", "Offer explanation can only run in offer stage.", {stage: session.stage});
    return;
  }
  const cardId = body.card_id || body.cardId;
  const offerId = body.offer_id || body.offerId;
  const card = (session.current_cards || []).find((item) => (
    (offerId && item.offer_id === offerId) || (cardId && (item.card_id === cardId || item.offer_id === cardId))
  ));
  if (!card) {
    fail(res, 404, "card_not_found", "Card not found in current session stack.");
    return;
  }
  const payload = await explainOneOfferCard({
    session,
    card,
    body: {
      ...body,
      offer_ai_timeout_ms: body.offer_ai_timeout_ms || body.offerAiTimeoutMs || 7000,
    },
  });
  await updateCurrentOfferCard(session, payload.card);
  ok(res, {card: payload.card, meta: payload.meta});
}

async function handleFoodOffers(req, res) {
  const body = await readBody(req);
  const session = body.session_id || body.sessionId ? await getSession(body.session_id || body.sessionId) : null;
  const payload = await buildFoodOffers({session: session || {}, body, limit: body.limit || 10});
  ok(res, payload);
}

async function handleSessionFinalize(req, res) {
  const body = await readBody(req);
  const session = await getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  if (session.stage === "final") {
    ok(res, {
      session: publicSession(session),
      result: session.result || await selectFinalDecisionWithContext(session),
      session_summary: {
        ok: true,
        provider: "local",
        skipped: "already_finalized",
      },
    });
    return;
  }
  let recoveredFrom = "";
  if (session.stage === "direction_summary") {
    const offerPayload = await buildFoodOffers({session, body, limit: body.limit || 10});
    await applyOfferCards(session, offerPayload);
    recoveredFrom = "direction_summary";
  }
  if (session.stage !== "offer") {
    fail(res, 409, "invalid_session_transition", "Session can only finalize from offer in P3.", {stage: session.stage});
    return;
  }
  const result = await selectFinalDecisionWithContext(session);
  await applyFinalDecision(session, result);
  const observationResult = await createMemoryObservation({
    userId: session.user_id,
    body: {
      day_id: session.day_id,
      source: "meal_session_finalize",
      type: "finalized_meal_session",
      text: [
        `主人完成了一轮饭点选择：${session.goal || ""}`,
        result?.primary?.merchant_name ? `最终推荐：${result.primary.merchant_name} ${result.primary.title || ""}` : "",
      ].filter(Boolean).join("。"),
      summary: result?.primary?.merchant_name
        ? `主人最后选了 ${result.primary.merchant_name}。`
        : "主人完成了一轮饭点选择。",
      confidence: 0.7,
      source_event: {
        source: "meal_session",
        session_id: session.session_id,
        day_id: session.day_id,
        final_merchant_id: result?.primary?.merchant_id || "",
        final_merchant_name: result?.primary?.merchant_name || "",
      },
    },
  });
  ok(res, {
    session: publicSession(session),
    result,
    session_summary: {
      ok: true,
      provider: "local",
      observation_id: observationResult.ok ? observationResult.observation.observation_id : null,
    },
    meta: {
      recovered_from_stage: recoveredFrom || null,
      memory_observation: observationResult.ok ? {
        observation_id: observationResult.observation.observation_id,
        review_status: observationResult.observation.review_status,
      } : null,
    },
  });
}

async function handleQueueStatus(req, res) {
  const body = req.method === "POST" ? await readBody(req) : {};
  ok(res, queuePayload(body.merchant || body));
}

async function handleMerchantIntelContext(req, res) {
  const body = await readBody(req);
  const payload = await buildMerchantIntelContext({
    userId: body.user_id || body.userId || "demo_weiyingru",
    merchantId: body.merchant_id || body.merchantId,
    sessionId: body.session_id || body.sessionId || "",
    question: body.question || body.query || "",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "merchant_not_found", payload.error || "Merchant not found.", payload);
    return;
  }
  ok(res, payload);
}

async function handleMerchantCompareContext(req, res) {
  const body = await readBody(req);
  const payload = await buildMerchantCompareContext({
    userId: body.user_id || body.userId || "demo_weiyingru",
    merchantIds: body.merchant_ids || body.merchantIds || [body.left_merchant_id || body.leftMerchantId, body.right_merchant_id || body.rightMerchantId],
    sessionId: body.session_id || body.sessionId || "",
    question: body.question || body.query || "",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "merchant_not_found", payload.error || "Merchant not found.", payload);
    return;
  }
  ok(res, payload);
}

async function handleDealSearchContext(req, res) {
  const body = await readBody(req);
  const current = body.current_merchant || body.currentMerchant || {};
  const payload = await buildDealSearchContext({
    userId: body.user_id || body.userId || "demo_weiyingru",
    merchantId: body.merchant_id || body.merchantId || "",
    merchantIds: body.merchant_ids || body.merchantIds || [],
    merchantNames: body.merchant_names || body.merchantNames || body.merchant_name || body.merchantName || [],
    sessionId: body.session_id || body.sessionId || "",
    question: body.question || body.query || "",
    partySize: body.party_size || body.partySize,
    budget: body.budget || body.budget_per_person || body.budgetPerPerson || body.max_price_per_person || body.maxPricePerPerson,
    mealTime: body.meal_time || body.mealTime || "",
    currentMerchantId: current.merchant_id || current.merchantId || "",
  });
  if (!payload.ok) {
    fail(res, payload.error === "merchant_not_found" ? 404 : 422, payload.error || "deal_search_failed", payload.hint || payload.error || "Deal search failed.", payload);
    return;
  }
  ok(res, payload);
}

async function handleMerchantCandidateSearch(req, res, url) {
  const body = req.method === "POST" ? await readBody(req) : {};
  const payload = await searchMerchantCandidates({
    userId: body.user_id || body.userId || "demo_weiyingru",
    query: body.query || body.text || url.searchParams.get("query") || url.searchParams.get("text") || "",
    preferences: body.preferences || body.structured_preferences || body.structuredPreferences || {},
    limit: body.limit || url.searchParams.get("limit") || 4,
  });
  ok(res, payload);
}

async function handleMerchantResolve(req, res, url) {
  const body = req.method === "POST" ? await readBody(req) : {};
  const query = body.query || body.text || body.merchant_name || body.merchantName || url.searchParams.get("query") || url.searchParams.get("text") || "";
  const limit = body.limit || url.searchParams.get("limit") || 4;
  const payload = await resolveMerchantsFromText(query, {
    limit,
  });
  ok(res, payload);
}

async function handleWeatherForecast(req, res) {
  const body = req.method === "POST" ? await readBody(req) : {};
  const session = body.session_id || body.sessionId ? await getSession(body.session_id || body.sessionId) : null;
  ok(res, await weatherPayload({
    ...body,
    location: body.location || body.user_location || body.userLocation || session?.location,
  }));
}

async function handleMapRoute(req, res) {
  const body = await readBody(req);
  const session = body.session_id || body.sessionId ? await getSession(body.session_id || body.sessionId) : null;
  ok(res, await routePayload({
    ...body,
    origin: body.origin || body.location || body.user_location || body.userLocation || session?.location,
  }));
}

async function handleLocationProbe(req, res) {
  const body = await readBody(req);
  latestLocationProbe = {
    received_at: new Date().toISOString(),
    payload: body,
  };
  ok(res, latestLocationProbe);
}

async function handleLatestLocationProbe(res) {
  ok(res, {
    received: Boolean(latestLocationProbe),
    latest: latestLocationProbe,
  });
}

function userIdFromUrl(url, fallback = "demo_weiyingru") {
  return url.searchParams.get("user_id") || url.searchParams.get("userId") || fallback;
}

function memoryEntityTime(entity = {}, fallback = "") {
  return entity.stored_at || entity.updated_at || entity.created_at || entity.confirmed_at || entity.last_synced_at || fallback || "";
}

function memoryEntityDay(entity = {}) {
  return entity.day_id
    || entity.source_event?.day_id
    || entity.input_snapshot?.day_id
    || entity.raw_result?.day_id
    || "";
}

function matchesMemoryDay(entity = {}, dayId = "") {
  if (!dayId) return true;
  if (memoryEntityDay(entity) === dayId) return true;
  const evidence = Array.isArray(entity.evidence) ? entity.evidence : [];
  return evidence.some((item) => item?.day_id === dayId || item?.source_event?.day_id === dayId);
}

function compactMemoryRaw(raw = {}) {
  return raw;
}

function memoryPipelineEvent({type, id, title, subtitle = "", status = "", occurredAt = "", raw = {}, metrics = {}, links = {}}) {
  return {
    event_id: `${type}:${id || title}`,
    type,
    entity_id: id || "",
    title,
    subtitle,
    status,
    occurred_at: occurredAt || memoryEntityTime(raw),
    metrics,
    links,
    raw: compactMemoryRaw(raw),
  };
}

function buildMemoryPipeline({observations = [], jobs = [], candidates = [], preferences = [], foodInsightProfile = null, providerStatus = {}} = {}) {
  const events = [];
  const edges = [];
  const candidateIds = new Set(candidates.map((item) => item.candidate_id).filter(Boolean));
  const preferenceByCandidate = new Map(preferences
    .filter((item) => item.source_candidate_id)
    .map((item) => [item.source_candidate_id, item]));

  for (const observation of observations) {
    events.push(memoryPipelineEvent({
      type: "observation",
      id: observation.observation_id,
      title: observation.summary || observation.text || "Memory observation",
      subtitle: `${observation.source || "unknown"} · ${observation.type || "observation"}`,
      status: observation.review_status || observation.status || "active",
      occurredAt: memoryEntityTime(observation),
      metrics: {
        confidence: observation.confidence ?? null,
        strength: observation.strength ?? null,
        tags: observation.tags || [],
      },
      raw: observation,
    }));
  }

  for (const job of jobs) {
    events.push(memoryPipelineEvent({
      type: "memory_intelligence_job",
      id: job.job_id,
      title: job.summary || `${job.mode || "memory"} job`,
      subtitle: `${job.mode || "unknown"} · ${job.source || "unknown"}`,
      status: job.status || "completed",
      occurredAt: memoryEntityTime(job),
      metrics: {
        accepted_candidates: job.accepted_memory_candidates?.length || 0,
        rejected_candidates: job.rejected_memory_candidates?.length || 0,
        created_observations: job.created_observations?.length || 0,
        profile_updated: Boolean(job.food_insight_profile_updated),
      },
      links: {
        source_observation_id: job.source_observation_id || "",
      },
      raw: job,
    }));
    if (job.source_observation_id) {
      edges.push({
        from: `observation:${job.source_observation_id}`,
        to: `memory_intelligence_job:${job.job_id}`,
        label: "reviewed_by",
      });
    }
    for (const candidate of job.accepted_memory_candidates || []) {
      const candidateId = candidate.candidate_id || "";
      if (candidateId) {
        edges.push({
          from: `memory_intelligence_job:${job.job_id}`,
          to: `memory_candidate:${candidateId}`,
          label: candidateIds.has(candidateId) ? "created_candidate" : "accepted_candidate_snapshot",
        });
      }
    }
  }

  for (const candidate of candidates) {
    const preference = preferenceByCandidate.get(candidate.candidate_id);
    events.push(memoryPipelineEvent({
      type: "memory_candidate",
      id: candidate.candidate_id,
      title: candidate.confirmation_text || candidate.statement || "Memory candidate",
      subtitle: `${candidate.category || "general"} · ${candidate.polarity || "neutral"}`,
      status: candidate.status || "pending",
      occurredAt: memoryEntityTime(candidate),
      metrics: {
        confidence: candidate.confidence ?? null,
        strength: candidate.strength ?? null,
        evidence_count: Array.isArray(candidate.evidence) ? candidate.evidence.length : 0,
        needs_confirmation: candidate.needs_confirmation !== false,
      },
      links: {
        source_candidate_id: "",
        preference_id: preference?.preference_id || "",
        source_observation_id: candidate.source_event?.observation_id || "",
        source_dream_id: candidate.source_event?.dream_id || "",
      },
      raw: candidate,
    }));
    if (candidate.source_event?.observation_id) {
      edges.push({
        from: `observation:${candidate.source_event.observation_id}`,
        to: `memory_candidate:${candidate.candidate_id}`,
        label: "created_candidate",
      });
    }
    if (preference) {
      edges.push({
        from: `memory_candidate:${candidate.candidate_id}`,
        to: `confirmed_preference:${preference.preference_id}`,
        label: "confirmed_as",
      });
    }
  }

  for (const preference of preferences) {
    events.push(memoryPipelineEvent({
      type: "confirmed_preference",
      id: preference.preference_id,
      title: preference.statement || "Confirmed preference",
      subtitle: `${preference.category || "general"} · ${preference.polarity || "neutral"}`,
      status: preference.status || "active",
      occurredAt: memoryEntityTime(preference),
      metrics: {
        confidence: preference.confidence ?? null,
        strength: preference.strength ?? null,
      },
      links: {
        source_candidate_id: preference.source_candidate_id || "",
      },
      raw: preference,
    }));
  }

  if (foodInsightProfile) {
    events.push(memoryPipelineEvent({
      type: "food_insight_profile",
      id: foodInsightProfile.user_id || "profile",
      title: "Food insight profile",
      subtitle: foodInsightProfile.evidence_window || "profile",
      status: foodInsightProfile.confidence_percent ? `${foodInsightProfile.confidence_percent}% confidence` : "low_confidence",
      occurredAt: foodInsightProfile.updated_at || foodInsightProfile.created_at || "",
      metrics: {
        confidence: foodInsightProfile.confidence ?? null,
        confidence_percent: foodInsightProfile.confidence_percent ?? null,
        top_motives: foodInsightProfile.top_motives || [],
      },
      raw: foodInsightProfile,
    }));
    for (const job of jobs.filter((item) => item.food_insight_profile_updated)) {
      edges.push({
        from: `memory_intelligence_job:${job.job_id}`,
        to: `food_insight_profile:${foodInsightProfile.user_id || "profile"}`,
        label: "updated_profile",
      });
    }
  }

  return {
    pipeline_events: events.sort((left, right) => String(right.occurred_at || "").localeCompare(String(left.occurred_at || ""))),
    pipeline_edges: edges,
  };
}

async function handleAdminMemoryPipeline(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const userId = userIdFromUrl(url);
  const dayId = url.searchParams.get("day_id") || url.searchParams.get("dayId") || "";
  const limit = Number(url.searchParams.get("limit") || 80);
  const [candidatesResult, preferencesResult, observationsResult, jobsResult, foodInsightProfile, memoryContext] = await Promise.all([
    listMemoryCandidates({userId}),
    listConfirmedPreferences({userId}),
    listMemoryObservations({userId, dayId, limit}),
    listMemoryIntelligenceJobs({userId, dayId, limit}),
    readFoodInsightProfile({userId}),
    readUserMemoryContext({userId}),
  ]);
  const memoryCandidates = (candidatesResult.candidates || []).filter((item) => matchesMemoryDay(item, dayId));
  const confirmedPreferences = preferencesResult.preferences || [];
  const providerStatus = {local: {configured: true}};
  const pipeline = buildMemoryPipeline({
    observations: observationsResult.observations || [],
    jobs: jobsResult.jobs || [],
    candidates: memoryCandidates,
    preferences: confirmedPreferences,
    foodInsightProfile,
    providerStatus,
  });
  ok(res, {
    user_id: userId,
    day_id: dayId,
    memory_root: memoryContext.memory_root,
    provider_status: providerStatus,
    observations: observationsResult.observations || [],
    memory_intelligence_jobs: jobsResult.jobs || [],
    memory_candidates: memoryCandidates,
    confirmed_preferences: confirmedPreferences,
    food_insight_profile: foodInsightProfile,
    profile_text: memoryContext.profile_text,
    ...pipeline,
  });
}

async function handleMemoryLedger(res, url) {
  const userId = userIdFromUrl(url);
  const [candidates, preferences, context, observations, foodInsightProfile] = await Promise.all([
    listMemoryCandidates({userId}),
    listConfirmedPreferences({userId}),
    readUserMemoryContext({userId}),
    listMemoryObservations({userId, limit: 30}),
    readFoodInsightProfile({userId}),
  ]);
  ok(res, {
    user_id: context.user_id,
    memory_root: context.memory_root,
    provider_status: {
      local: {configured: true},
    },
    candidates: candidates.candidates,
    pending_candidates: candidates.candidates.filter((candidate) => candidate.status === "pending"),
    preferences: preferences.preferences,
    active_preferences: preferences.preferences.filter((preference) => preference.status === "active"),
    observations: observations.observations,
    food_insight_profile: foodInsightProfile,
    profile_text: context.profile_text,
  });
}

async function handleMemorySearch(res, url) {
  const userId = userIdFromUrl(url);
  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  const tokens = queryTokens(query);
  const typeFilter = new Set(normalizeStringArray(url.searchParams.get("type") || "all"));
  const includesType = (type) => typeFilter.has("all") || typeFilter.has(type);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 80));
  const dayId = url.searchParams.get("day_id") || url.searchParams.get("dayId") || "";
  const [candidates, preferences, observations, jobs, profile] = await Promise.all([
    includesType("memory_candidate") || includesType("candidate")
      ? listMemoryCandidates({userId, status: url.searchParams.get("status") || ""})
      : {candidates: []},
    includesType("confirmed_preference") || includesType("preference")
      ? listConfirmedPreferences({userId, status: url.searchParams.get("preference_status") || url.searchParams.get("status") || ""})
      : {preferences: []},
    includesType("memory_observation") || includesType("observation")
      ? listMemoryObservations({userId, dayId, limit: 120, status: url.searchParams.get("observation_status") || ""})
      : {observations: []},
    includesType("memory_intelligence_job") || includesType("job")
      ? listMemoryIntelligenceJobs({userId, dayId, mode: url.searchParams.get("mode") || "", limit: 80})
      : {jobs: []},
    includesType("food_insight_profile") || includesType("profile")
      ? readFoodInsightProfile({userId})
      : null,
  ]);
  const results = [
    ...(preferences.preferences || []).map(compactPreferenceForSearch),
    ...(candidates.candidates || []).map(compactCandidateForSearch),
    ...(observations.observations || []).map(compactObservationForSearch),
    ...(jobs.jobs || []).map(compactMemoryJobForSearch),
    profile ? {
      type: "food_insight_profile",
      id: profile.user_id || userId,
      status: "active",
      category: "profile",
      polarity: "",
      title: "食物选择画像",
      text: compactText(JSON.stringify({
        top_motives: profile.top_motives || [],
        novelty_tolerance: profile.novelty_tolerance || {},
        reward_profile: profile.reward_profile || {},
      }), 320),
      confidence: profile.confidence ?? null,
      source_id: "",
      occurred_at: profile.updated_at || profile.generated_at || "",
    } : null,
  ].filter(Boolean)
    .filter((item) => matchesQuery(item, tokens))
    .sort((left, right) => String(right.occurred_at || "").localeCompare(String(left.occurred_at || "")))
    .slice(0, limit);
  ok(res, {
    user_id: userId,
    query,
    type: [...typeFilter],
    results,
    count: results.length,
  });
}

async function handleSessionMemory(res, url) {
  const userId = userIdFromUrl(url);
  const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
  const dayId = url.searchParams.get("day_id") || url.searchParams.get("dayId") || createDayId(userId, new Date());
  const tokens = queryTokens(url.searchParams.get("query") || url.searchParams.get("q") || "");
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 20), 80));
  let sessions = [];
  if (sessionId) {
    const session = await getSession(sessionId);
    if (!session || session.user_id !== userId) {
      fail(res, 404, "session_not_found", "Session not found.");
      return;
    }
    sessions = [compactMealSessionForMemory(session)];
  } else {
    const dayContext = await getDayContext(dayId);
    const refs = (dayContext?.meal_sessions || []).slice(-limit);
    const loaded = [];
    for (const ref of refs) {
      const session = await getSession(ref.session_id);
      loaded.push(session ? compactMealSessionForMemory(session) : {
        type: "meal_session",
        ...ref,
        summary: compactText([ref.goal, ref.final_merchant_name].filter(Boolean).join("；")),
      });
    }
    sessions = loaded;
  }
  sessions = sessions.filter((item) => matchesQuery(item, tokens)).slice(0, limit);
  const dayContext = await getDayContext(dayId);
  ok(res, {
    user_id: userId,
    day_id: dayId,
    session_id: sessionId,
    query: url.searchParams.get("query") || url.searchParams.get("q") || "",
    sessions,
    xiaowang_chat_sessions: (dayContext?.xiaowang_chat_sessions || [])
      .filter((item) => matchesQuery(item, tokens))
      .slice(-limit)
      .map((item) => ({
        type: "xiaowang_chat_session",
        session_id: item.session_id || "",
        title: item.title || "",
        summary: item.summary || "",
        latest_user_message: item.latest_user_message || "",
        message_count: item.message_count || 0,
        skill_calls: item.skill_calls || [],
        created_at: item.created_at || "",
        updated_at: item.updated_at || "",
      })),
    count: sessions.length,
  });
}

async function handleMemoryCandidates(res, url) {
  const payload = await listMemoryCandidates({
    userId: userIdFromUrl(url),
    status: url.searchParams.get("status") || "",
  });
  ok(res, payload);
}

async function handleMemoryCandidateCreate(req, res) {
  const body = await readBody(req);
  const payload = await createMemoryCandidate({
    userId: body.user_id || body.userId || "demo_weiyingru",
    body,
  });
  if (!payload.ok) {
    fail(res, 422, payload.error || "invalid_memory_candidate", payload.error || "Invalid memory candidate.");
    return;
  }
  const dayId = payload.candidate?.source_event?.day_id || body.day_id || body.dayId || "";
  if (dayId) {
    await appendMemoryCandidatesToDayContext({dayId, candidateIds: [payload.candidate.candidate_id]});
  }
  ok(res, payload);
}

async function handleMemoryPostMealFeedback(req, res) {
  const body = await readBody(req);
  const [payload, merchantFeedback] = await Promise.all([
    createPostMealMemoryCandidates({body}),
    recordMerchantFeedback({body}),
  ]);
  const session = body.session_id || body.sessionId ? await getSession(body.session_id || body.sessionId) : null;
  if (session && payload.candidates?.length) {
    await appendMemoryCandidatesToDayContext({
      dayId: session.day_id,
      candidateIds: payload.candidates.map((candidate) => candidate.candidate_id),
    });
  }
  const feedbackText = String(body.feedback_text || body.feedbackText || body.text || "").trim();
  const observationResult = feedbackText ? await createMemoryObservation({
    userId: body.user_id || body.userId || session?.user_id || "demo_weiyingru",
    body: {
      day_id: session?.day_id || body.day_id || body.dayId || "",
      source: "post_meal_feedback",
      type: "post_meal_feedback",
      text: feedbackText,
      summary: feedbackText,
      confidence: 0.76,
      tags: [
        /油|油腻/.test(feedbackText) ? "油腻反馈" : "",
        /排队|等位|等待/.test(feedbackText) ? "排队反馈" : "",
        /辣/.test(feedbackText) ? "辣度反馈" : "",
      ].filter(Boolean),
      source_event: {
        source: body.source || "miniapp",
        session_id: body.session_id || body.sessionId || "",
        day_id: session?.day_id || body.day_id || body.dayId || "",
        merchant_id: body.merchant_id || body.merchantId || "",
        merchant_name: body.merchant_name || body.merchantName || "",
      },
    },
  }) : {ok: false};
  const shouldRunInstantReview = observationResult.ok && !payload.candidates?.length;
  const intelligence = shouldRunInstantReview
    ? await runMemoryIntelligence({
      mode: "instant_review",
      userId: observationResult.user_id,
      dayId: observationResult.observation.day_id,
      observationId: observationResult.observation.observation_id,
    })
    : null;
  ok(res, {
    ...payload,
    merchant_feedback: merchantFeedback,
    memory_observation: observationResult.ok ? observationResult.observation : null,
    memory_intelligence: intelligence ? {
      ok: intelligence.ok,
      job_id: intelligence.job?.job_id || "",
      accepted_memory_candidates: intelligence.job?.accepted_memory_candidates?.length || 0,
    } : null,
  });
}

async function handleMemoryIntelligenceInput(res, url) {
  const payload = await buildMemoryIntelligenceInput({
    mode: url.searchParams.get("mode") || "manual_daily_review",
    userId: userIdFromUrl(url),
    dayId: url.searchParams.get("day_id") || url.searchParams.get("dayId") || "",
    observationId: url.searchParams.get("observation_id") || url.searchParams.get("observationId") || "",
    lookbackDays: url.searchParams.get("lookback_days") || url.searchParams.get("lookbackDays") || 7,
  });
  ok(res, payload);
}

async function handleMemoryIntelligenceRun(req, res) {
  const body = await readBody(req);
  const payload = await runMemoryIntelligence({
    mode: body.mode || "manual_daily_review",
    engine: body.engine || "local_policy",
    userId: body.user_id || body.userId || "demo_weiyingru",
    dayId: body.day_id || body.dayId || "",
    observationId: body.observation_id || body.observationId || "",
    lookbackDays: body.lookback_days || body.lookbackDays || 7,
    source: body.source || "local_policy",
  });
  ok(res, payload);
}

async function handleMemoryIntelligenceResult(req, res) {
  const body = await readBody(req);
  const payload = await storeMemoryIntelligenceResult({
    mode: body.mode || body.result?.mode || "manual_daily_review",
    engine: body.engine || body.result?.engine || "local_policy",
    requestedEngine: body.requested_engine || body.requestedEngine || body.result?.requested_engine || "",
    fallbackReason: body.fallback_reason || body.fallbackReason || body.result?.fallback_reason || "",
    userId: body.user_id || body.userId || body.result?.user_id || "demo_weiyingru",
    dayId: body.day_id || body.dayId || body.result?.day_id || "",
    observationId: body.observation_id || body.observationId || "",
    input: body.input || null,
    result: body.result || body,
    source: body.source || "openclaw_memory_intelligence",
  });
  ok(res, payload);
}

async function handleMemoryIntelligenceJobs(res, url) {
  const payload = await listMemoryIntelligenceJobs({
    userId: userIdFromUrl(url, ""),
    dayId: url.searchParams.get("day_id") || url.searchParams.get("dayId") || "",
    mode: url.searchParams.get("mode") || "",
    limit: url.searchParams.get("limit") || 20,
  });
  ok(res, payload);
}

async function handleMemoryObservations(res, url) {
  const payload = await listMemoryObservations({
    userId: userIdFromUrl(url),
    dayId: url.searchParams.get("day_id") || url.searchParams.get("dayId") || "",
    limit: url.searchParams.get("limit") || 50,
    status: url.searchParams.get("status") || "",
  });
  ok(res, payload);
}

async function handleMemoryObservationCreate(req, res) {
  const body = await readBody(req);
  const payload = await createMemoryObservation({
    userId: body.user_id || body.userId || "demo_weiyingru",
    body,
  });
  if (!payload.ok) {
    fail(res, 422, payload.error || "invalid_memory_observation", payload.error || "Invalid memory observation.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryPreferencesList(res, url) {
  const payload = await listConfirmedPreferences({
    userId: userIdFromUrl(url),
    status: url.searchParams.get("status") || "",
  });
  ok(res, payload);
}

async function handleMemoryPreferenceCreate(req, res) {
  const body = await readBody(req);
  const payload = await createConfirmedPreference({body});
  if (!payload.ok) {
    fail(res, 422, payload.error || "invalid_memory_preference", payload.error || "Invalid memory preference.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryPreferenceUpdate(req, res, preferenceId) {
  const body = await readBody(req);
  const userId = body.user_id || body.userId || "demo_weiyingru";
  const previous = (await listConfirmedPreferences({userId})).preferences
    .find((preference) => preference.preference_id === preferenceId) || null;
  const payload = await updateConfirmedPreference({userId, preferenceId, patch: body});
  if (!payload.ok) {
    fail(res, 404, payload.error || "preference_not_found", payload.error || "Preference not found.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryPreferenceDelete(req, res, preferenceId) {
  const body = req.method === "DELETE" ? await readBody(req).catch(() => ({})) : {};
  const userId = body.user_id || body.userId || "demo_weiyingru";
  const payload = await setConfirmedPreferenceStatus({
    userId,
    preferenceId,
    status: "forgotten",
    reason: body.reason || "user_delete",
    actor: body.actor || "user",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "preference_not_found", payload.error || "Preference not found.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryPreferencePause(req, res, preferenceId) {
  const body = await readBody(req);
  const payload = await setConfirmedPreferenceStatus({
    userId: body.user_id || body.userId || "demo_weiyingru",
    preferenceId,
    status: "paused",
    reason: body.reason || "user_pause",
    actor: body.actor || "user",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "preference_not_found", payload.error || "Preference not found.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryCandidateConfirm(req, res, candidateId) {
  const body = await readBody(req);
  const payload = await confirmMemoryCandidate({
    userId: body.user_id || body.userId || "demo_weiyingru",
    candidateId,
    actor: body.actor || "user",
    patch: body.patch || {
      confirmation_text: body.confirmation_text || body.confirmationText,
      statement: body.statement,
    },
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "candidate_not_found", payload.error || "Candidate not found.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryCandidateReject(req, res, candidateId) {
  const body = await readBody(req);
  const payload = await rejectMemoryCandidate({
    userId: body.user_id || body.userId || "demo_weiyingru",
    candidateId,
    reason: body.reason || "user_reject",
    actor: body.actor || "user",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "candidate_not_found", payload.error || "Candidate not found.");
    return;
  }
  ok(res, payload);
}

async function handleMemoryManage(req, res) {
  const body = await readBody(req);
  const payload = await executeMemoryManageOperation({body});
  if (!payload.ok) {
    fail(res, 422, payload.error || "memory_manage_failed", payload.error || "Memory operation failed.", {
      operation: payload.operation || body.operation || body.op || "",
      user_id: payload.user_id || body.user_id || body.userId || "demo_weiyingru",
    });
    return;
  }
  ok(res, payload);
}

async function handleOpenClawDreamInput(res, url) {
  const payload = await buildOpenClawDreamInput({
    userId: userIdFromUrl(url),
    dayId: url.searchParams.get("day_id") || url.searchParams.get("dayId") || "",
    date: url.searchParams.get("date") || "",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "dream_input_not_found", payload.error || "Dream input not found.", {
      day_id: payload.day_id,
    });
    return;
  }
  ok(res, payload);
}

async function handleOpenClawDreamResult(req, res) {
  const body = await readBody(req);
  const payload = await storeOpenClawDreamResult({body});
  if (!payload.ok) {
    fail(res, 422, payload.error || "invalid_dream_result", payload.error || "Invalid dream result.");
    return;
  }
  ok(res, payload);
}

async function handleOpenClawJobView(res, jobId) {
  const job = await getOpenClawJob(jobId);
  if (!job) {
    fail(res, 404, "openclaw_job_not_found", "OpenClaw job not found.");
    return;
  }
  ok(res, {job});
}

async function handleOpenClawJobByDreamView(res, dreamId) {
  const job = await getOpenClawJobByDreamId(dreamId);
  if (!job) {
    fail(res, 404, "openclaw_job_not_found", "OpenClaw job not found.");
    return;
  }
  ok(res, {job});
}

async function handleOpenClawRunDream(req, res) {
  const body = await readBody(req);
  const payload = await runMemoryIntelligence({
    mode: body.mode || "manual_daily_review",
    engine: body.engine || "local_policy",
    userId: body.user_id || body.userId || "demo_weiyingru",
    dayId: body.day_id || body.dayId || "",
    observationId: body.observation_id || body.observationId || "",
    lookbackDays: body.lookback_days || body.lookbackDays || 7,
    source: "openclaw_run_dream_adapter",
  });
  if (!payload.ok) {
    fail(res, 502, payload.error || "memory_intelligence_failed", payload.error || "Memory Intelligence failed.", payload);
    return;
  }
  ok(res, {
    run: {
      ok: true,
      adapter: "openclaw_run_dream",
      status: payload.job?.status || "completed",
      job_id: payload.job?.job_id || "",
      mode: payload.job?.mode || "",
      engine: payload.job?.engine || "",
      requested_engine: payload.job?.requested_engine || "",
      fallback_reason: payload.job?.fallback_reason || "",
      timing: payload.job?.timing || null,
      input_metrics: payload.job?.input_metrics || null,
      summary: payload.job?.summary || "",
      candidate_count: payload.job?.accepted_memory_candidates?.length || 0,
      memory_intelligence_job: payload.job || null,
    },
    memory_intelligence: payload,
  });
}

async function handleXiaowangChatRoute(req, res) {
  const body = await readBody(req);
  const payload = await handleXiaowangChat({body});
  ok(res, payload);
}

async function handleXiaowangChatAsyncRoute(req, res) {
  const body = await readBody(req);
  ok(res, startXiaowangChatJob({body}), 202);
}

async function handleXiaowangChatJobRoute(res, jobId) {
  const payload = getXiaowangChatJob(jobId);
  if (!payload.ok) {
    fail(res, 404, payload.error || "chat_job_not_found", payload.error || "Chat job not found.");
    return;
  }
  ok(res, payload);
}

async function handleXiaowangChatSessionsRoute(res, url) {
  const payload = await listXiaowangChatSessions({
    userId: url.searchParams.get("user_id") || url.searchParams.get("userId") || "demo_weiyingru",
    limit: url.searchParams.get("limit") || 24,
  });
  ok(res, payload);
}

async function handleXiaowangChatSessionRoute(res, url, sessionId) {
  const payload = await getXiaowangChatSession({
    sessionId,
    userId: url.searchParams.get("user_id") || url.searchParams.get("userId") || "demo_weiyingru",
  });
  if (!payload.ok) {
    fail(res, 404, payload.error || "chat_session_not_found", payload.error || "Chat session not found.");
    return;
  }
  ok(res, payload);
}

async function handleXiaowangDiaryRoute(res, url) {
  const payload = await readXiaowangDiary({
    userId: url.searchParams.get("user_id") || url.searchParams.get("userId") || "demo_weiyingru",
    date: url.searchParams.get("date") || "",
    includeDayContext: url.searchParams.get("include_day_context") === "1" || url.searchParams.get("includeDayContext") === "1",
  });
  ok(res, payload);
}

async function handleXiaowangSkillsRoute(res) {
  ok(res, listXiaowangSkills());
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
};

function adminTokenFromReq(req) {
  const header = req.headers["x-lifepilot-admin-token"] || req.headers.authorization || "";
  return String(header).replace(/^Bearer\s+/i, "").trim();
}

function requireAdmin(req, res) {
  if (!config.admin.token) return true;
  if (adminTokenFromReq(req) === config.admin.token) return true;
  fail(res, 401, "admin_unauthorized", "需要正确的后台管理口令。");
  return false;
}

function adminTypeFromPath(pathname, prefix) {
  const suffix = pathname.slice(prefix.length);
  const [type, ...rest] = suffix.split("/").filter(Boolean);
  if (!["directions", "merchants", "offers", "deals", "reputations"].includes(type)) {
    return null;
  }
  return {type, id: rest.length ? decodeURIComponent(rest.join("/")) : ""};
}

async function handleAdminCatalog(req, res) {
  if (!requireAdmin(req, res)) return;
  ok(res, await getAdminCatalog());
}

async function handleAdminAssetUpload(req, res) {
  if (!requireAdmin(req, res)) return;
  const body = await readBody(req);
  ok(res, {asset: await uploadAdminAsset(body)}, 201);
}

async function handleAdminCollection(req, res, url) {
  if (!requireAdmin(req, res)) return;
  const match = adminTypeFromPath(url.pathname, "/api/admin/");
  if (!match) {
    fail(res, 404, "admin_collection_not_found", "未知后台数据集合。");
    return;
  }
  const body = ["POST", "PUT", "PATCH"].includes(req.method || "") ? await readBody(req) : {};
  if (req.method === "POST" && !match.id) {
    ok(res, await createAdminItem(match.type, body), 201);
    return;
  }
  if ((req.method === "PUT" || req.method === "PATCH") && match.id) {
    ok(res, await updateAdminItem(match.type, match.id, body));
    return;
  }
  if (req.method === "DELETE" && match.id) {
    ok(res, await deleteAdminItem(match.type, match.id));
    return;
  }
  fail(res, 405, "admin_method_not_allowed", "这个后台接口不支持当前请求方式。", {method: req.method, path: url.pathname});
}

async function serveFile(res, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    fail(res, 404, "static_not_found", "Static file not found.");
    return;
  }
  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

async function serveAdminStatic(res, pathname) {
  const relative = pathname === "/admin" ? "merchant-admin.html" : pathname.slice("/admin/".length);
  const safeRelative = path.normalize(relative).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(REPO_ROOT, "server", "public", "admin", safeRelative);
  const root = path.join(REPO_ROOT, "server", "public", "admin");
  if (!filePath.startsWith(root)) {
    fail(res, 403, "static_forbidden", "Forbidden.");
    return;
  }
  await serveFile(res, filePath);
}

async function serveAssetStatic(res, pathname) {
  const safeRelative = path.normalize(pathname.slice("/assets/".length)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(REPO_ROOT, "assets", safeRelative);
  const root = path.join(REPO_ROOT, "assets");
  if (!filePath.startsWith(root)) {
    fail(res, 403, "static_forbidden", "Forbidden.");
    return;
  }
  await serveFile(res, filePath);
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      await handleHealth(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/catalog") {
      await handleAdminCatalog(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/memory-pipeline") {
      await handleAdminMemoryPipeline(req, res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/admin/assets/upload") {
      await handleAdminAssetUpload(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/admin/")) {
      await handleAdminCollection(req, res, url);
      return;
    }
    if (req.method === "GET" && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) {
      await serveAdminStatic(res, url.pathname);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      await serveAssetStatic(res, url.pathname);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/food-directions") {
      await handleFoodDirections(res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/start") {
      await handleSessionStart(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent/parse-entry") {
      await handleParseEntry(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/swipe") {
      await handleSessionSwipe(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/entry") {
      await handleSessionEntryUpdate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/advance") {
      await handleSessionAdvance(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/finalize") {
      await handleSessionFinalize(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session/offer-explanation") {
      await handleSessionOfferExplanation(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/meal/primitive/start-offers") {
      await handleMealPrimitiveStartOffers(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/food-offers") {
      await handleFoodOffers(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/map/route") {
      await handleMapRoute(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/location/probe") {
      await handleLocationProbe(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/location/probe/latest") {
      await handleLatestLocationProbe(res);
      return;
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/weather/forecast") {
      await handleWeatherForecast(req, res);
      return;
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/queue/status") {
      await handleQueueStatus(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/tools/merchant-intel-context") {
      await handleMerchantIntelContext(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/tools/merchant-compare-context") {
      await handleMerchantCompareContext(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/tools/deal-search-context") {
      await handleDealSearchContext(req, res);
      return;
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/tools/merchant-candidate-search") {
      await handleMerchantCandidateSearch(req, res, url);
      return;
    }
    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/tools/merchant-resolve") {
      await handleMerchantResolve(req, res, url);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/day-context/")) {
      await handleDayContextView(res, decodeURIComponent(url.pathname.slice("/api/day-context/".length)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/openclaw/dream-input") {
      await handleOpenClawDreamInput(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/openclaw/dream-result") {
      await handleOpenClawDreamResult(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/openclaw/run-dream") {
      await handleOpenClawRunDream(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/intelligence/input") {
      await handleMemoryIntelligenceInput(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/intelligence/run") {
      await handleMemoryIntelligenceRun(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/intelligence/result") {
      await handleMemoryIntelligenceResult(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/intelligence/jobs") {
      await handleMemoryIntelligenceJobs(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/search") {
      await handleMemorySearch(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/observations") {
      await handleMemoryObservations(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/observations") {
      await handleMemoryObservationCreate(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/xiaowang/chat") {
      await handleXiaowangChatRoute(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/xiaowang/chat-async") {
      await handleXiaowangChatAsyncRoute(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/xiaowang/chat-jobs/")) {
      await handleXiaowangChatJobRoute(res, decodeURIComponent(url.pathname.slice("/api/xiaowang/chat-jobs/".length)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/xiaowang/chat-sessions") {
      await handleXiaowangChatSessionsRoute(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/xiaowang/chats/")) {
      await handleXiaowangChatSessionRoute(res, url, decodeURIComponent(url.pathname.slice("/api/xiaowang/chats/".length)));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/xiaowang/diary") {
      await handleXiaowangDiaryRoute(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/xiaowang/skills") {
      await handleXiaowangSkillsRoute(res);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/openclaw/jobs/by-dream/")) {
      await handleOpenClawJobByDreamView(res, decodeURIComponent(url.pathname.slice("/api/openclaw/jobs/by-dream/".length)));
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/openclaw/jobs/")) {
      await handleOpenClawJobView(res, decodeURIComponent(url.pathname.slice("/api/openclaw/jobs/".length)));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/post-meal-feedback") {
      await handleMemoryPostMealFeedback(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/ledger") {
      await handleMemoryLedger(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/manage") {
      await handleMemoryManage(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/candidates") {
      await handleMemoryCandidates(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/candidates") {
      await handleMemoryCandidateCreate(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/memory/preferences") {
      await handleMemoryPreferencesList(res, url);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/memory/preferences") {
      await handleMemoryPreferenceCreate(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/memory/preferences/")) {
      const suffix = decodeURIComponent(url.pathname.slice("/api/memory/preferences/".length));
      if (req.method === "PATCH") {
        await handleMemoryPreferenceUpdate(req, res, suffix);
        return;
      }
      if (req.method === "DELETE") {
        await handleMemoryPreferenceDelete(req, res, suffix);
        return;
      }
      if (req.method === "POST" && suffix.endsWith("/pause")) {
        await handleMemoryPreferencePause(req, res, suffix.slice(0, -"/pause".length));
        return;
      }
    }
    if (url.pathname.startsWith("/api/memory/candidates/")) {
      const suffix = decodeURIComponent(url.pathname.slice("/api/memory/candidates/".length));
      if (req.method === "POST" && suffix.endsWith("/confirm")) {
        await handleMemoryCandidateConfirm(req, res, suffix.slice(0, -"/confirm".length));
        return;
      }
      if (req.method === "POST" && suffix.endsWith("/reject")) {
        await handleMemoryCandidateReject(req, res, suffix.slice(0, -"/reject".length));
        return;
      }
    }
    if (req.method === "GET" && url.pathname === "/api/session/memory") {
      await handleSessionMemory(res, url);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/session/")) {
      await handleSessionView(res, decodeURIComponent(url.pathname.slice("/api/session/".length)));
      return;
    }
    fail(res, 404, "route_not_found", "Route not found.", {method: req.method, path: url.pathname});
  } catch (error) {
    if (error?.code === "invalid_json") {
      fail(res, 400, "invalid_json", "Invalid JSON body.");
      return;
    }
    if (error?.code === "ENOENT") {
      fail(res, 404, "static_not_found", "Static file not found.");
      return;
    }
    if (error?.code && error?.status) {
      const adminError = adminHttpError(error);
      sendJson(res, adminError.status, {
        ok: false,
        error: {
          code: adminError.code,
          message: adminError.message,
          details: adminError.details,
        },
      });
      return;
    }
    fail(res, 500, "internal_error", error instanceof Error ? error.message : String(error));
  }
}

export function createApp() {
  return createServer(route);
}
