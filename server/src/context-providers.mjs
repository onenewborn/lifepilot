import { buildFoodOffers } from "./offer-cards.mjs";

export function queuePayload(merchant = {}) {
  const risk = merchant.queue_risk || "medium";
  const wait = {low: "通常 0-5 分钟", medium: "通常 5-15 分钟", high: "饭点 15-30+ 分钟"}[risk] || "需要到店前确认";
  return {
    ok: true,
    provider: "mock",
    synthetic_only: true,
    queue_risk: risk,
    average_queue_wait: wait,
    fallback_used: false,
  };
}

export function weatherPayload(body = {}) {
  const location = body.location || {
    label: "深圳福田 CBD 默认位置",
    latitude: 22.5431,
    longitude: 114.0579,
    defaulted: true,
  };
  return {
    ok: true,
    provider: "mock",
    synthetic_only: true,
    location,
    condition: "cloudy",
    text: "多云，天气上下文为 mock，真实天气后续接 provider。",
    affects_recommendation: false,
    fallback_used: false,
  };
}

export function routePayload(body = {}) {
  const distanceKm = Number(body.distance_km || body.distanceKm || body.facts?.distance_km || 1.0);
  return {
    ok: true,
    provider: "mock",
    synthetic_only: true,
    origin: body.origin || {label: "当前位置"},
    destination: body.destination || {merchant_id: body.merchant_id || body.merchantId || ""},
    recommended: {
      mode: "walk_or_transit",
      distance_km: Number.isFinite(distanceKm) ? distanceKm : 1.0,
      distance_text: `${(Number.isFinite(distanceKm) ? distanceKm : 1.0).toFixed(1)}km`,
      eta: "以真实地图为准",
    },
    fallback_used: false,
  };
}
