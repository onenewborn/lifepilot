import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";

const sessions = new Map();
const SESSION_SCHEMA_VERSION = "lifepilot.meal_session.v1";
const DAY_CONTEXT_SCHEMA_VERSION = "lifepilot.day_context.v1";

function sessionsRoot() {
  return path.join(config.storage.runtimeRoot, "meal_sessions");
}

function dayContextsRoot() {
  return path.join(config.storage.runtimeRoot, "day_contexts");
}

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sessionPath(sessionId) {
  return path.join(sessionsRoot(), `${safeId(sessionId)}.json`);
}

function dayContextPath(dayId) {
  return path.join(dayContextsRoot(), `${safeId(dayId)}.json`);
}

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function inferMealSlot(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "dinner";
  return "late_night";
}

export function createSessionId() {
  return `meal_${dateKey()}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function createDayId(userId, value = new Date()) {
  return `day_${dateKey(value)}_${safeId(userId || "demo_weiyingru")}`;
}

async function persistSession(session) {
  await mkdir(sessionsRoot(), {recursive: true});
  const target = sessionPath(session.session_id);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(temp, target);
  sessions.set(session.session_id, session);
  await upsertDayContextFromSession(session);
  return session;
}

function compactMealSession(session) {
  return {
    session_id: session.session_id,
    user_id: session.user_id,
    day_id: session.day_id,
    meal_slot: session.meal_slot,
    status: session.status,
    stage: session.stage,
    next_step: session.next_step,
    goal: session.goal,
    location: session.location || null,
    direction_event_count: session.direction_events?.length || 0,
    offer_event_count: session.offer_events?.length || 0,
    final_offer_id: session.result?.primary?.offer_id || null,
    final_merchant_id: session.result?.primary?.merchant_id || null,
    final_merchant_name: session.result?.primary?.merchant_name || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    finalized_at: session.finalized_at || null,
  };
}

function defaultDayContext(session) {
  const createdAt = nowIso();
  return {
    schema_version: DAY_CONTEXT_SCHEMA_VERSION,
    day_id: session.day_id,
    user_id: session.user_id,
    date: session.day_id?.match(/^day_(\d{8})_/)?.[1] || dateKey(session.created_at),
    timezone: "Asia/Shanghai",
    meal_sessions: [],
    xiaowang_chat_sessions: [],
    push_interactions: [],
    background_jobs: [],
    memory_candidate_ids: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function readDayContext(dayId) {
  try {
    return JSON.parse(await readFile(dayContextPath(dayId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeDayContext(dayContext) {
  await mkdir(dayContextsRoot(), {recursive: true});
  const target = dayContextPath(dayContext.day_id);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(dayContext, null, 2)}\n`, "utf8");
  await rename(temp, target);
  return dayContext;
}

export async function upsertDayContextFromSession(session) {
  if (!session?.day_id) return null;
  const existing = await readDayContext(session.day_id);
  const dayContext = existing || defaultDayContext(session);
  const compact = compactMealSession(session);
  const index = (dayContext.meal_sessions || []).findIndex((item) => item.session_id === session.session_id);
  if (index >= 0) {
    dayContext.meal_sessions[index] = compact;
  } else {
    dayContext.meal_sessions = [...(dayContext.meal_sessions || []), compact];
  }
  dayContext.meal_sessions.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
  dayContext.updated_at = nowIso();
  return writeDayContext(dayContext);
}

export async function getDayContext(dayId) {
  if (!dayId) return null;
  return readDayContext(dayId);
}

export async function appendMemoryCandidatesToDayContext({dayId, candidateIds = []} = {}) {
  const ids = candidateIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!dayId || !ids.length) return null;
  const dayContext = await readDayContext(dayId);
  if (!dayContext) return null;
  dayContext.memory_candidate_ids = [...new Set([...(dayContext.memory_candidate_ids || []), ...ids])];
  dayContext.updated_at = nowIso();
  return writeDayContext(dayContext);
}

export async function createSession({sessionId, userId, entryForm, parsed, cards, dayId, mealSlot, memoryContext = null}) {
  const createdAt = nowIso();
  const safeUserId = userId || "demo_weiyingru";
  const location = entryForm?.location || entryForm?.user_location || entryForm?.userLocation || null;
  const session = {
    schema_version: SESSION_SCHEMA_VERSION,
    session_id: sessionId || createSessionId(),
    user_id: safeUserId,
    day_id: dayId || entryForm?.day_id || entryForm?.dayId || createDayId(safeUserId, createdAt),
    meal_slot: mealSlot || entryForm?.meal_slot || entryForm?.mealSlot || inferMealSlot(new Date(createdAt)),
    status: "active",
    stage: "direction",
    next_step: "swipe_food_directions",
    goal: parsed.normalized_goal || "",
    entry_form: entryForm || {},
    location,
    understanding: {
      constraints: parsed.constraints || {},
      requirements: parsed.requirements || [],
      missing_info: parsed.missing_info || [],
      confidence: parsed.confidence || null,
      assistant_text: parsed.assistant_text || "",
      normalized_goal: parsed.normalized_goal || "",
      raw_entry_text: parsed.raw_entry_text || "",
      dimensions: parsed.dimensions || {},
      hard_constraints: parsed.hard_constraints || [],
      soft_preferences: parsed.soft_preferences || [],
      special_signals: parsed.special_signals || [],
      parse_mode: parsed.parse_mode || "local_fallback",
      timing: parsed.timing || null,
      warning: parsed.warning || null,
    },
    memory_context: memoryContext,
    direction_events: [],
    offer_events: [],
    direction_summary: null,
    current_cards: cards || [],
    offer_payload_meta: null,
    result: null,
    synthetic_only: true,
    created_at: createdAt,
    updated_at: createdAt,
  };
  return persistSession(session);
}

export async function setSessionMemoryContext(session, memoryContext) {
  session.memory_context = memoryContext || null;
  return touchSession(session);
}

export async function getSession(sessionId) {
  if (!sessionId) return null;
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  try {
    const session = JSON.parse(await readFile(sessionPath(sessionId), "utf8"));
    sessions.set(session.session_id, session);
    return session;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function touchSession(session) {
  session.updated_at = nowIso();
  return persistSession(session);
}

function findCardForEvent(session, body) {
  const raw = body.event && typeof body.event === "object" ? body.event : body;
  const cardId = raw.card_id || raw.cardId;
  const directionId = raw.direction_id || raw.directionId;
  const offerId = raw.offer_id || raw.offerId;
  const merchantId = raw.merchant_id || raw.merchantId;
  return (session.current_cards || []).find((card) => (
    (cardId && (card.card_id === cardId || card.offer_id === cardId || card.merchant_id === cardId || card.direction_id === cardId))
    || (directionId && card.direction_id === directionId)
    || (offerId && card.offer_id === offerId)
    || (merchantId && card.merchant_id === merchantId)
  )) || null;
}

function normalizeSwipeAction(action) {
  const value = String(action || "").trim();
  if (["keep", "dislike"].includes(value)) return value;
  return "";
}

export function normalizeSwipeEvent(session, body) {
  const raw = body.event && typeof body.event === "object" ? body.event : body;
  const card = findCardForEvent(session, body);
  const action = normalizeSwipeAction(raw.action);
  if (!action) return null;
  if (!card) {
    const error = new Error("Card not found in current session stack.");
    error.code = "card_not_found";
    throw error;
  }
  const round = raw.round || body.round || (session.stage === "offer" ? "offer" : "direction");
  return {
    event_id: raw.event_id || raw.eventId || `evt_${Date.now()}_${randomUUID().slice(0, 6)}`,
    session_id: session.session_id,
    round,
    action,
    card_id: raw.card_id || raw.cardId || card.card_id || card.offer_id || card.direction_id || null,
    direction_id: raw.direction_id || raw.directionId || card.direction_id || null,
    offer_id: raw.offer_id || raw.offerId || card.offer_id || null,
    merchant_id: raw.merchant_id || raw.merchantId || card.merchant_id || null,
    service_id: raw.service_id || raw.serviceId || card.service_id || null,
    title: raw.title || card.title || card.display_title || card.merchant_name || null,
    tags: raw.tags || card.tags || [],
    budget_band: raw.budget_band || raw.budgetBand || card.budget_band || null,
    hook: raw.hook || card.hook || null,
    fit: raw.fit || card.fit || [],
    avoid_for: raw.avoid_for || raw.avoidFor || card.avoid_for || [],
    dwell_ms: Number(raw.dwell_ms || raw.dwellMs || 0) || 0,
    created_at: nowIso(),
  };
}

export async function appendSwipeEvent(session, event) {
  if (event.round === "offer" || session.stage === "offer") {
    session.offer_events.push(event);
  } else {
    session.direction_events.push(event);
  }
  return touchSession(session);
}

export async function applyDirectionSummary(session, summaryPayload) {
  session.stage = "direction_summary";
  session.next_step = "confirm_direction_summary";
  session.direction_summary = {
    summary_text: summaryPayload.summary.summary_text,
    mode: summaryPayload.mode,
    timing: summaryPayload.timing || null,
    warning: summaryPayload.warning || null,
  };
  session.current_cards = [];
  return touchSession(session);
}

export async function applyOfferCards(session, payload) {
  session.stage = "offer";
  session.next_step = "swipe_food_offers";
  session.current_cards = payload.cards || [];
  session.offer_payload_meta = payload.offer_payload_meta || null;
  return touchSession(session);
}

export async function updateCurrentOfferCard(session, card) {
  if (!session || !card?.offer_id) return session;
  session.current_cards = (session.current_cards || []).map((item) => (
    item.offer_id === card.offer_id ? card : item
  ));
  return touchSession(session);
}

export async function applyFinalDecision(session, result) {
  session.stage = "final";
  session.next_step = "done";
  session.status = "finalized";
  session.result = result;
  session.finalized_at = nowIso();
  return touchSession(session);
}
