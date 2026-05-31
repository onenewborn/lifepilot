const { request } = require("./request");

function chat(data) {
  return request("/api/xiaowang/chat", { data, timeout: 70000 });
}

function getDiary(params = {}) {
  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
  return request(`/api/xiaowang/diary${query ? `?${query}` : ""}`, { method: "GET", timeout: 30000 });
}

function runDreaming(data = {}) {
  return request("/api/openclaw/run-dream", { data, timeout: 320000 });
}

module.exports = {
  chat,
  getDiary,
  runDreaming
};
