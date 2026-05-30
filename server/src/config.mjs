import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.mjs";

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4331),
  runtimeName: "lifepilot-next",
  assetBaseUrl: process.env.LIFEPILOT_ASSET_BASE_URL || "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com",
  ai: {
    provider: process.env.LIFEPILOT_AI_PROVIDER || "ark",
    arkApiKey: process.env.ARK_API_KEY || "",
    arkBaseUrl: process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3",
    arkModel: process.env.ARK_MODEL || "doubao-seed-1-6-flash-250828",
    timeoutMs: Number(process.env.ARK_TIMEOUT_MS || 5000),
    maxTokens: Number(process.env.ARK_MAX_TOKENS || 256),
    temperature: Number(process.env.ARK_TEMPERATURE || 0.2),
  },
  context: {
    weatherProvider: process.env.LIFEPILOT_WEATHER_PROVIDER || "amap",
    mapProvider: process.env.LIFEPILOT_MAP_PROVIDER || "amap",
    amapApiKey: process.env.LIFEPILOT_AMAP_KEY || process.env.AMAP_API_KEY || "",
    amapBaseUrl: process.env.LIFEPILOT_AMAP_BASE_URL || "https://restapi.amap.com",
    timeoutMs: Number(process.env.LIFEPILOT_CONTEXT_TIMEOUT_MS || 2500),
    defaultLocation: {
      label: "深圳福田 CBD 默认位置",
      latitude: 22.5431,
      longitude: 114.0579,
      coordinate_type: "gcj02",
      defaulted: true,
    },
  },
  storage: {
    runtimeRoot: process.env.LIFEPILOT_RUNTIME_ROOT || path.join(REPO_ROOT, "data", "runtime"),
  },
};
