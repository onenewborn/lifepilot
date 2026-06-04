const DEVTOOLS_API_BASE_URL = "http://127.0.0.1:4331";
const LAN_API_BASE_URL = "http://127.0.0.1:4331";
// 当前比赛调试入口：腾讯云 LifePilot 后端 HTTPS 域名。
const CLOUD_API_BASE_URL = "https://api.lifepilot-xiaowang.cn";
// 只用于临时排障。旧 Cloudflare tunnel 可能随时失效，不要作为默认入口。
const TUNNEL_API_BASE_URL = "https://cincinnati-assumptions-addressing-belongs.trycloudflare.com";

// 比赛调试阶段默认走云服务器；本机开发者工具调试时可以改成 local。
const API_MODE = "cloud"; // "local" | "lan" | "cloud" | "tunnel"

const API_BASE_URLS = {
  local: DEVTOOLS_API_BASE_URL,
  lan: LAN_API_BASE_URL,
  cloud: CLOUD_API_BASE_URL,
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
  CLOUD_API_BASE_URL,
  TUNNEL_API_BASE_URL,
  getApiMode,
  getApiBaseUrl
};
