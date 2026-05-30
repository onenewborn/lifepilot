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

function advanceSession(data) {
  return request("/api/session/advance", { data, timeout: 120000 });
}

function finalizeSession(data) {
  return request("/api/session/finalize", { data, timeout: 90000 });
}

module.exports = {
  advanceSession,
  finalizeSession,
  getSession,
  startSession,
  swipeSession
};
