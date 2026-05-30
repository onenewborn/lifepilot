import { createServer } from "node:http";
import { buildFoodDirectionCards, filterFoodDirectionCards, localParseEntry } from "./cards.mjs";
import { config } from "./config.mjs";
import { fail, ok, readBody } from "./http.mjs";
import { appendSwipeEvent, createSession, getSession, normalizeSwipeEvent } from "./session-store.mjs";

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
  const parsed = localParseEntry(entryForm);
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
    if (req.method === "POST" && url.pathname === "/api/session/swipe") {
      await handleSessionSwipe(req, res);
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
