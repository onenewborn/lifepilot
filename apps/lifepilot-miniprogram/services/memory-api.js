const { request } = require("./request");

function postMealFeedback(data) {
  return request("/api/memory/post-meal-feedback", { data, timeout: 70000 });
}

module.exports = {
  postMealFeedback
};
