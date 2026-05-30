const { getApiBaseUrl } = require("../config/api");

function request(path, options = {}) {
  const method = options.method || "POST";
  const timeout = options.timeout || 70000;
  const data = options.data || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${path}`,
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
            message: payload.error && payload.error.message ? payload.error.message : "后端接口返回异常"
          });
          return;
        }
        resolve(payload);
      },
      fail(error) {
        reject({
          statusCode: 0,
          payload: null,
          message: error && error.errMsg ? error.errMsg : "后端连接失败"
        });
      }
    });
  });
}

module.exports = {
  request
};
