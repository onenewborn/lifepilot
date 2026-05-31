const { request } = require("./request");

function postMealFeedback(data) {
  return request("/api/memory/post-meal-feedback", { data, timeout: 70000 });
}

function confirmCandidate(candidateId, data = {}) {
  return request(`/api/memory/candidates/${encodeURIComponent(candidateId)}/confirm`, { data, timeout: 30000 });
}

function rejectCandidate(candidateId, data = {}) {
  return request(`/api/memory/candidates/${encodeURIComponent(candidateId)}/reject`, { data, timeout: 30000 });
}

module.exports = {
  confirmCandidate,
  rejectCandidate,
  postMealFeedback
};
