const { getApiBaseUrl } = require("./config/api");
const { ASSET_BASE_URL } = require("./config/assets");

App({
  globalData: {
    apiBaseUrl: getApiBaseUrl(),
    assetBaseUrl: ASSET_BASE_URL
  }
});
