import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, REPO_ROOT } from "./config.mjs";

const MERCHANTS_PATH = path.join(REPO_ROOT, "data/synthetic_food_futian/merchants.json");
let cachedMerchants = null;

async function readMerchants() {
  if (!cachedMerchants) {
    const rows = JSON.parse(await readFile(MERCHANTS_PATH, "utf8")).merchants || [];
    cachedMerchants = new Map(rows.map((item) => [item.merchant_id, item]));
  }
  return cachedMerchants;
}

function withTimeout(ms = config.context.timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(ms || config.context.timeoutMs));
  return {controller, done: () => clearTimeout(timer)};
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeLocation(value = null, fallback = null) {
  if (!value || typeof value !== "object") return fallback;
  const latitude = numberOrNull(value.latitude || value.lat);
  const longitude = numberOrNull(value.longitude || value.lng || value.lon);
  if (latitude === null || longitude === null) return fallback;
  return {
    label: value.label || value.name || value.address || fallback?.label || "",
    latitude,
    longitude,
    coordinate_type: value.coordinate_type || value.coordinateType || "gcj02",
    source: value.source || fallback?.source || "",
    address: value.address || fallback?.address || "",
    adcode: value.adcode || fallback?.adcode || "",
    defaulted: Boolean(value.defaulted || fallback?.defaulted),
  };
}

function locationPair(location) {
  if (!location) return "";
  return `${location.longitude},${location.latitude}`;
}

function distanceText(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "距离待确认";
  return `${distanceKm.toFixed(1)}km`;
}

function fallbackWeather(location, reason = "") {
  const resolved = normalizeLocation(location, config.context.defaultLocation) || config.context.defaultLocation;
  return {
    ok: true,
    provider: "mock",
    synthetic_only: true,
    location: resolved,
    condition: "cloudy",
    text: resolved.defaulted ? "多云，当前使用默认位置的 mock 天气。" : "多云，当前使用 mock 天气。",
    affects_recommendation: false,
    fallback_used: Boolean(reason),
    fallback_reason: reason || null,
  };
}

function fallbackRoute(body = {}, reason = "") {
  const distanceKm = Number(body.distance_km || body.distanceKm || body.facts?.distance_km || body.destination?.distance_km || 1.0);
  const safeDistance = Number.isFinite(distanceKm) ? distanceKm : 1.0;
  return {
    ok: true,
    provider: "mock",
    synthetic_only: true,
    origin: normalizeLocation(body.origin || body.location || body.user_location, {label: "当前位置"}),
    destination: body.destination || {merchant_id: body.merchant_id || body.merchantId || ""},
    recommended: {
      mode: body.mode || "walk_or_transit",
      distance_km: safeDistance,
      distance_text: distanceText(safeDistance),
      eta: "以真实地图为准",
    },
    fallback_used: Boolean(reason),
    fallback_reason: reason || null,
  };
}

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

function weatherAffectsRecommendation(weather = {}) {
  const text = `${weather.weather || ""} ${weather.temperature || ""}`;
  if (/[雨雪雷暴台风]/.test(text)) return true;
  const temperature = Number(weather.temperature);
  return Number.isFinite(temperature) && (temperature <= 8 || temperature >= 34);
}

async function amapJson(pathname, params) {
  const url = new URL(pathname, config.context.amapBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const {controller, done} = withTimeout();
  try {
    const response = await fetch(url, {signal: controller.signal});
    const payload = await response.json();
    if (!response.ok || payload.status !== "1") {
      const error = new Error(payload.info || `amap_http_${response.status}`);
      error.code = payload.infocode || response.status;
      throw error;
    }
    return payload;
  } finally {
    done();
  }
}

async function amapAdcode(location) {
  if (location.adcode) return location.adcode;
  const payload = await amapJson("/v3/geocode/regeo", {
    key: config.context.amapApiKey,
    location: locationPair(location),
    extensions: "base",
  });
  return payload.regeocode?.addressComponent?.adcode || "";
}

export async function weatherPayload(body = {}) {
  const location = normalizeLocation(body.location || body.user_location || body.userLocation, config.context.defaultLocation);
  if (config.context.weatherProvider !== "amap" || !config.context.amapApiKey) {
    return fallbackWeather(location, "");
  }
  try {
    const city = body.adcode || body.city || await amapAdcode(location);
    if (!city) return fallbackWeather(location, "location_without_adcode");
    const payload = await amapJson("/v3/weather/weatherInfo", {
      key: config.context.amapApiKey,
      city,
      extensions: "base",
    });
    const live = payload.lives?.[0] || {};
    return {
      ok: true,
      provider: "amap",
      synthetic_only: false,
      location: {...location, adcode: city},
      condition: live.weather || "",
      text: `${live.city || location.label || "当前位置"}：${live.weather || "天气待确认"}，${live.temperature ? `${live.temperature}℃，` : ""}湿度${live.humidity || "待确认"}%。`,
      temperature: live.temperature ? Number(live.temperature) : null,
      wind_direction: live.winddirection || "",
      wind_power: live.windpower || "",
      humidity: live.humidity ? Number(live.humidity) : null,
      report_time: live.reporttime || "",
      affects_recommendation: weatherAffectsRecommendation(live),
      fallback_used: false,
    };
  } catch (error) {
    return fallbackWeather(location, error?.code || error?.message || "provider_error");
  }
}

async function destinationFromBody(body = {}) {
  const explicit = normalizeLocation(body.destination?.location || body.destination, null);
  if (explicit) return {...body.destination, ...explicit};
  const merchantId = body.merchant_id || body.merchantId || body.destination?.merchant_id || body.destination?.merchantId;
  if (!merchantId) return body.destination || null;
  const merchants = await readMerchants();
  const merchant = merchants.get(merchantId);
  if (!merchant) return body.destination || {merchant_id: merchantId};
  return {
    merchant_id: merchant.merchant_id,
    label: merchant.name,
    address: merchant.address || "",
    distance_km: merchant.distance_km,
    ...normalizeLocation(merchant.location, null),
  };
}

export async function routePayload(body = {}) {
  const origin = normalizeLocation(body.origin || body.location || body.user_location || body.userLocation, null);
  const destination = await destinationFromBody(body);
  const destinationLocation = normalizeLocation(destination?.location || destination, null);
  if (config.context.mapProvider !== "amap" || !config.context.amapApiKey) {
    return fallbackRoute({...body, origin, destination}, "");
  }
  if (!origin || !destinationLocation) {
    return fallbackRoute({...body, origin, destination}, "missing_origin_or_destination_location");
  }
  try {
    const payload = await amapJson("/v3/direction/walking", {
      key: config.context.amapApiKey,
      origin: locationPair(origin),
      destination: locationPair(destinationLocation),
    });
    const path = payload.route?.paths?.[0] || {};
    const meters = Number(path.distance || 0);
    const seconds = Number(path.duration || 0);
    const distanceKm = Number.isFinite(meters) && meters > 0 ? Math.round((meters / 1000) * 10) / 10 : null;
    const minutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : null;
    return {
      ok: true,
      provider: "amap",
      synthetic_only: false,
      origin,
      destination: destinationLocation,
      recommended: {
        mode: "walk",
        distance_km: distanceKm,
        distance_text: distanceText(distanceKm),
        eta: minutes ? `约 ${minutes} 分钟` : "时间待确认",
      },
      fallback_used: false,
    };
  } catch (error) {
    return fallbackRoute({...body, origin, destination}, error?.code || error?.message || "provider_error");
  }
}

export function locationFromRequest(body = {}) {
  return {
    location: normalizeLocation(body.location || body.user_location || body.userLocation, null),
  };
}
