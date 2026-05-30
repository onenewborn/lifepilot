import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 4331),
  runtimeName: "lifepilot-next",
  assetBaseUrl: process.env.LIFEPILOT_ASSET_BASE_URL || "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com",
};
