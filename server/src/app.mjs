import { createServer } from "node:http";
import { buildFoodDirectionCards, filterFoodDirectionCards } from "./cards.mjs";
import { config } from "./config.mjs";
import { buildDirectionSummary } from "./direction-summary.mjs";
import { parseEntry } from "./entry-parser.mjs";
import { buildFoodOffers, explainOneOfferCard, selectFinalDecision } from "./offer-cards.mjs";
import { queuePayload, routePayload, weatherPayload } from "./context-providers.mjs";
import { fail, ok, readBody } from "./http.mjs";
import { appendMemoryCandidatesToDayContext, appendSwipeEvent, applyDirectionSummary, applyFinalDecision, applyOfferCards, createSession, getDayContext, getSession, normalizeSwipeEvent, setSessionMemoryContext, updateCurrentOfferCard, updateSessionEntry } from "./session-store.mjs";
import {
  confirmMemoryCandidate,
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
import { evermindConfigStatus } from "./evermind-memory.mjs";
import {
  evermindSyncAllowed,
  syncPreferenceAddToEvermind,
  syncPreferenceDeleteFromEvermind,
  syncPreferenceReplaceToEvermind,
  writeMealSessionSummaryToEvermind,
} from "./evermind-sync.mjs";
import { recordMerchantFeedback } from "./merchant-feedback-store.mjs";
import { buildMerchantCompareContext, buildMerchantIntelContext } from "./merchant-tools.mjs";
import { buildOpenClawDreamInput, getOpenClawJob, getOpenClawJobByDreamId, storeOpenClawDreamResult } from "./openclaw-store.mjs";
import { runOpenClawDreamAgent } from "./openclaw-runner.mjs";
import { handleXiaowangChat, listXiaowangSkills, readXiaowangDiary } from "./xiaowang-store.mjs";

let latestLocationProbe = null;

function publicSession(session) {
  return session;
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
        source: "session_start",
        confirmed_preferences: memoryContext.preference_count || 0,
        evermind_memories: memoryContext.evermind_memory_count || 0,
        evermind_warning: memoryContext.evermind_warning || "",
        policy: memoryContext.policy,
      },
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
        source: "session_entry_update",
        confirmed_preferences: memoryContext.preference_count || 0,
        evermind_memories: memoryContext.evermind_memory_count || 0,
        evermind_warning: memoryContext.evermind_warning || "",
        policy: memoryContext.policy,
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
      memory_context: {
        confirmed_preferences: memoryContext.preference_count || 0,
        evermind_memories: memoryContext.evermind_memory_count || 0,
        evermind_warning: memoryContext.evermind_warning || "",
        policy: memoryContext.policy,
      },
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
  if (session.stage !== "offer") {
    fail(res, 409, "invalid_session_transition", "Session can only finalize from offer in P3.", {stage: session.stage});
    return;
  }
  const result = selectFinalDecision(session);
  await applyFinalDecision(session, result);
  const evermindSummary = body.sync_evermind_session === false || body.syncEvermindSession === false
    ? {ok: false, skipped: "disabled"}
    : await writeMealSessionSummaryToEvermind(session);
  ok(res, {
    session: publicSession(session),
    result,
    evermind_session_summary: {
      ok: Boolean(evermindSummary.ok),
      skipped: evermindSummary.skipped || null,
      status: evermindSummary.status || null,
      error: evermindSummary.error || null,
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

async function handleMemoryLedger(res, url) {
  const userId = userIdFromUrl(url);
  const [candidates, preferences, context] = await Promise.all([
    listMemoryCandidates({userId}),
    listConfirmedPreferences({userId}),
    readUserMemoryContext({userId}),
  ]);
  ok(res, {
    user_id: context.user_id,
    memory_root: context.memory_root,
    provider_status: {
      local: {configured: true},
      evermind: evermindConfigStatus(),
    },
    candidates: candidates.candidates,
    pending_candidates: candidates.candidates.filter((candidate) => candidate.status === "pending"),
    preferences: preferences.preferences,
    active_preferences: preferences.preferences.filter((preference) => preference.status === "active"),
    profile_text: context.profile_text,
  });
}

async function handleMemoryCandidates(res, url) {
  const payload = await listMemoryCandidates({
    userId: userIdFromUrl(url),
    status: url.searchParams.get("status") || "",
  });
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
  ok(res, {
    ...payload,
    merchant_feedback: merchantFeedback,
  });
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
  if (evermindSyncAllowed(body)) {
    const synced = await syncPreferenceAddToEvermind(payload.preference, {operation: "manual_create"});
    ok(res, {
      ...payload,
      preference: synced.preference || payload.preference,
      evermind_sync: synced.preference?.sync || payload.preference.sync,
    });
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
  if (evermindSyncAllowed(body)) {
    const synced = await syncPreferenceReplaceToEvermind(previous, payload.preference);
    ok(res, {
      ...payload,
      preference: synced.preference || payload.preference,
      evermind_sync: synced.preference?.sync || payload.preference.sync,
    });
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
  if (evermindSyncAllowed(body)) {
    const synced = await syncPreferenceDeleteFromEvermind(payload.preference);
    ok(res, {
      ...payload,
      preference: synced.preference || payload.preference,
      evermind_sync: synced.preference?.sync || payload.preference.sync,
    });
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
  if (evermindSyncAllowed(body)) {
    const synced = await syncPreferenceAddToEvermind(payload.preference, {operation: "candidate_confirm"});
    ok(res, {
      ...payload,
      preference: synced.preference || payload.preference,
      evermind_sync: synced.preference?.sync || payload.preference.sync,
    });
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
  const payload = await runOpenClawDreamAgent({
    userId: body.user_id || body.userId || "demo_weiyingru",
    dayId: body.day_id || body.dayId,
    apiBase: body.api_base || body.apiBase,
    timeoutSeconds: body.timeout_seconds || body.timeoutSeconds,
    sessionId: body.openclaw_session_id || body.openclawSessionId,
    local: body.local,
    transport: body.transport || body.openclaw_transport || body.openclawTransport,
  });
  if (!payload.ok) {
    fail(res, 502, payload.error || "openclaw_agent_failed", payload.error || "OpenClaw agent failed.", payload);
    return;
  }
  ok(res, {
    run: payload,
  });
}

async function handleXiaowangChatRoute(req, res) {
  const body = await readBody(req);
  const payload = await handleXiaowangChat({body});
  ok(res, payload);
}

async function handleXiaowangDiaryRoute(res, url) {
  const payload = await readXiaowangDiary({
    userId: url.searchParams.get("user_id") || url.searchParams.get("userId") || "demo_weiyingru",
    date: url.searchParams.get("date") || "",
  });
  ok(res, payload);
}

async function handleXiaowangSkillsRoute(res) {
  ok(res, listXiaowangSkills());
}

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      await handleHealth(res);
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
    if (req.method === "POST" && url.pathname === "/api/xiaowang/chat") {
      await handleXiaowangChatRoute(req, res);
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
    if (req.method === "GET" && url.pathname === "/api/memory/candidates") {
      await handleMemoryCandidates(res, url);
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
    fail(res, 500, "internal_error", error instanceof Error ? error.message : String(error));
  }
}

export function createApp() {
  return createServer(route);
}
