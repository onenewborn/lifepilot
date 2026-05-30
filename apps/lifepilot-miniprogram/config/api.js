const DEVTOOLS_API_BASE_URL = "http://127.0.0.1:4331";
const LAN_API_BASE_URL = "http://127.0.0.1:4331";
const TUNNEL_API_BASE_URL = "";

function getApiBaseUrl() {
  try {
    const info = wx.getSystemInfoSync();
    const platform = String(info.platform || "").toLowerCase();
    const system = String(info.system || "").toLowerCase();
    const isDesktopPreview = platform === "devtools" || platform === "mac" || system.includes("macos");
    if (isDesktopPreview) return DEVTOOLS_API_BASE_URL;
    return TUNNEL_API_BASE_URL || LAN_API_BASE_URL;
  } catch (error) {
    return TUNNEL_API_BASE_URL || LAN_API_BASE_URL;
  }
}

module.exports = {
  DEVTOOLS_API_BASE_URL,
  getApiBaseUrl
};
