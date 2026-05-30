import { randomUUID } from "node:crypto";

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

export function createSessionId() {
  return `sess_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function createSession({sessionId, userId, entryForm, parsed, cards}) {
  const createdAt = nowIso();
  const session = {
    session_id: sessionId || createSessionId(),
    user_id: userId || "demo_weiyingru",
    stage: "direction",
    next_step: "swipe_food_directions",
    goal: parsed.normalized_goal || "",
    entry_form: entryForm || {},
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
  sessions.set(session.session_id, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

export function touchSession(session) {
  session.updated_at = nowIso();
  return session;
}

function findCardForEvent(session, body) {
  const raw = body.event && typeof body.event === "object" ? body.event : body;
  const cardId = raw.card_id || raw.cardId;
  const directionId = raw.direction_id || raw.directionId;
  const offerId = raw.offer_id || raw.offerId;
  const merchantId = raw.merchant_id || raw.merchantId;
  return (session.current_cards || []).find((card) => (
    (cardId && (card.card_id === cardId || card.offer_id === cardId || card.direction_id === cardId))
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

export function appendSwipeEvent(session, event) {
  if (event.round === "offer" || session.stage === "offer") {
    session.offer_events.push(event);
  } else {
    session.direction_events.push(event);
  }
  touchSession(session);
  return session;
}

export function applyDirectionSummary(session, summaryPayload) {
  session.stage = "direction_summary";
  session.next_step = "confirm_direction_summary";
  session.direction_summary = {
    summary_text: summaryPayload.summary.summary_text,
    mode: summaryPayload.mode,
    timing: summaryPayload.timing || null,
    warning: summaryPayload.warning || null,
  };
  session.current_cards = [];
  touchSession(session);
  return session;
}
