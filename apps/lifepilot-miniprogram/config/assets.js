const ASSET_BASE_URL = "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com";

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${ASSET_BASE_URL}${String(path).startsWith("/") ? "" : "/"}${path}`;
}

module.exports = {
  ASSET_BASE_URL,
  assetUrl
};
