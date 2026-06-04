const { request } = require("./request");

function chat(data) {
  return request("/api/xiaowang/chat", { data, timeout: 70000 });
}

function chatAsync(data) {
  return request("/api/xiaowang/chat-async", { data, timeout: 10000 });
}

function getChatJob(jobId) {
  return request(`/api/xiaowang/chat-jobs/${encodeURIComponent(jobId)}`, { method: "GET", timeout: 10000 });
}

function listChatSessions(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return request(`/api/xiaowang/chat-sessions${query ? `?${query}` : ""}`, { method: "GET", timeout: 15000 });
}

function getChatSession(sessionId, params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return request(`/api/xiaowang/chats/${encodeURIComponent(sessionId)}${query ? `?${query}` : ""}`, { method: "GET", timeout: 15000 });
}

function getDiary(params = {}) {
  const queryParams = {...params, compact: params.compact === undefined ? "1" : params.compact};
  const query = Object.keys(queryParams)
    .filter((key) => queryParams[key] !== undefined && queryParams[key] !== null && queryParams[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
    .join("&");
  return request(`/api/xiaowang/diary${query ? `?${query}` : ""}`, { method: "GET", timeout: 30000 });
}

function runDreaming(data = {}) {
  return request("/api/openclaw/run-dream", { data, timeout: 320000 });
}

module.exports = {
  chat,
  chatAsync,
  getChatJob,
  getChatSession,
  getDiary,
  listChatSessions,
  runDreaming
};
