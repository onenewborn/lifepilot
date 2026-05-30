const { request } = require("./request");

function startSession(data) {
  return request("/api/session/start", { data, timeout: 90000 });
}

function getSession(sessionId) {
  return request(`/api/session/${encodeURIComponent(sessionId)}`, { method: "GET" });
}

function swipeSession(data) {
  return request("/api/session/swipe", { data, timeout: 30000 });
}

function updateSessionEntry(data) {
  return request("/api/session/entry", { data, timeout: 90000 });
}

function advanceSession(data) {
  return request("/api/session/advance", { data, timeout: 120000 });
}

function finalizeSession(data) {
  return request("/api/session/finalize", { data, timeout: 90000 });
}

function explainOfferCard(data) {
  return request("/api/session/offer-explanation", { data, timeout: 25000 });
}

module.exports = {
  advanceSession,
  explainOfferCard,
  finalizeSession,
  getSession,
  startSession,
  swipeSession,
  updateSessionEntry
};
