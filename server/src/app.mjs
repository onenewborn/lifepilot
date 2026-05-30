import { createServer } from "node:http";
import { buildFoodDirectionCards, filterFoodDirectionCards } from "./cards.mjs";
import { config } from "./config.mjs";
import { buildDirectionSummary } from "./direction-summary.mjs";
import { parseEntry } from "./entry-parser.mjs";
import { fail, ok, readBody } from "./http.mjs";
import { appendSwipeEvent, applyDirectionSummary, createSession, getSession, normalizeSwipeEvent } from "./session-store.mjs";

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
  const parsed = await parseEntry({
    entryForm,
    timeoutMs: body.timeout_ms || body.timeoutMs,
    forceLocal: body.local_only === true || body.localOnly === true,
  });
  const allCards = await buildFoodDirectionCards();
  const cards = filterFoodDirectionCards(allCards, parsed);
  const session = createSession({
    sessionId: body.session_id || body.sessionId,
    userId: body.user_id || body.userId || "demo_weiyingru",
    entryForm,
    parsed,
    cards,
  });
  ok(res, {session: publicSession(session)});
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
  const session = getSession(body.session_id || body.sessionId);
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
  appendSwipeEvent(session, event);
  ok(res, {
    event,
    session: publicSession(session),
  });
}

async function handleSessionView(res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  ok(res, {session: publicSession(session)});
}

async function handleSessionAdvance(req, res) {
  const body = await readBody(req);
  const session = getSession(body.session_id || body.sessionId);
  if (!session) {
    fail(res, 404, "session_not_found", "Session not found.");
    return;
  }
  if (session.stage !== "direction") {
    fail(res, 409, "invalid_session_transition", "Session can only advance from direction in P2.", {
      stage: session.stage,
      supported_transition: "direction -> direction_summary",
    });
    return;
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
    memoryContext: null,
  });
  applyDirectionSummary(session, summaryPayload);
  ok(res, {
    session: publicSession(session),
    meta: summaryPayload.meta || {fallback_used: false},
  });
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
    if (req.method === "POST" && url.pathname === "/api/session/advance") {
      await handleSessionAdvance(req, res);
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
    fail(res, 500, "internal_error", error instanceof Error ? error.message : String(error));
  }
}

export function createApp() {
  return createServer(route);
}
