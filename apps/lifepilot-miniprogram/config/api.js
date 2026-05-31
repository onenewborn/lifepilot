const DEVTOOLS_API_BASE_URL = "http://127.0.0.1:4331";
const LAN_API_BASE_URL = "http://127.0.0.1:4331";
const TUNNEL_API_BASE_URL = "https://advisors-mailman-philosophy-prix.trycloudflare.com";

// 手机真机预览时用 tunnel；本机开发者工具调试时可以改成 local。
const API_MODE = "tunnel"; // "local" | "lan" | "tunnel"

const API_BASE_URLS = {
  local: DEVTOOLS_API_BASE_URL,
  lan: LAN_API_BASE_URL,
  tunnel: TUNNEL_API_BASE_URL,
};

function getApiMode() {
  return API_BASE_URLS[API_MODE] ? API_MODE : "local";
}

function getApiBaseUrl() {
  return API_BASE_URLS[getApiMode()];
}

module.exports = {
  API_MODE,
  DEVTOOLS_API_BASE_URL,
  LAN_API_BASE_URL,
  TUNNEL_API_BASE_URL,
  getApiMode,
  getApiBaseUrl
};
