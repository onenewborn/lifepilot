const { getApiBaseUrl, getApiMode } = require("../config/api");

function request(path, options = {}) {
  const method = options.method || "POST";
  const timeout = options.timeout || 70000;
  const data = options.data || {};
  const apiBaseUrl = getApiBaseUrl();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBaseUrl}${path}`,
      method,
      data,
      timeout,
      success(response) {
        const statusCode = Number(response.statusCode || 0);
        const payload = response.data || {};
        if (statusCode < 200 || statusCode >= 300 || payload.ok === false) {
          reject({
            statusCode,
            payload,
            message: payload.error && payload.error.message ? payload.error.message : "后端接口返回异常",
            apiBaseUrl,
            apiMode: getApiMode(),
            path
          });
          return;
        }
        resolve(payload);
      },
      fail(error) {
        reject({
          statusCode: 0,
          payload: null,
          message: error && error.errMsg ? error.errMsg : "后端连接失败",
          apiBaseUrl,
          apiMode: getApiMode(),
          path
        });
      }
    });
  });
}

module.exports = {
  request
};
