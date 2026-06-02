import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import { resetFoodDirectionCache } from "./cards.mjs";
import { resetFoodOfferCache } from "./offer-cards.mjs";
import { resetMerchantReputationCache } from "./merchant-reputation-store.mjs";
import { resetMerchantToolCache } from "./merchant-tools.mjs";

const DATA_ROOT = path.join(REPO_ROOT, "data", "synthetic_food_futian");
const PATHS = {
  directions: path.join(DATA_ROOT, "food_directions.json"),
  merchants: path.join(DATA_ROOT, "merchants.json"),
  offers: path.join(DATA_ROOT, "offers.json"),
  deals: path.join(DATA_ROOT, "deals.json"),
  reputations: path.join(REPO_ROOT, "data", "merchant_reputation", "seed.json"),
};
const COLLECTION_KEYS = {
  directions: "directions",
  merchants: "merchants",
  offers: "offers",
  deals: "deals",
  reputations: "reputations",
};
const ID_KEYS = {
  directions: "direction_id",
  merchants: "merchant_id",
  offers: "offer_id",
  deals: "deal_id",
  reputations: "merchant_id",
};

const ENUMS = {
  queue_risk: ["low", "medium", "high"],
  meal_service_type: ["quick_snack", "quick_meal", "standard_dine_in", "popular_dine_in", "reservation_destination"],
  reservation_mode: ["none", "recommended", "required"],
  oil_level: ["low", "medium", "high"],
  spice_level: ["none", "low", "medium", "high"],
  meal_style: ["quick_meal", "casual_meal", "light_meal", "solo_treat", "group_meal", "special_occasion"],
  service_speed: ["fast", "normal", "slow"],
  portion_size: ["light", "normal", "filling", "share"],
  temperature: ["hot", "warm", "mixed"],
  satisfaction_level: ["light", "steady", "satisfying", "indulgent"],
  noise_level: ["low", "medium", "high"],
  comfort_level: ["basic", "standard", "comfortable", "premium"],
  deal_type: ["set_meal", "coupon", "threshold_discount", "cash_voucher", "other"],
  platform: ["demo_group_buy", "meituan", "dianping", "douyin", "manual_seed", "other"],
  source_type: ["demo_seed_deal", "public_web_curated", "manual_seed", "mixed_public_and_demo_constructed", "demo_constructed_from_public_listing_context", "other"],
  evidence_confidence: ["low", "medium", "high", "unknown"],
  sentiment: ["positive", "neutral", "negative", "mixed"],
  severity: ["low", "medium", "high"],
  video_source_type: ["official", "user_upload", "other"],
};

const LABELS = {
  low: "低",
  medium: "中",
  high: "高",
  none: "无/不辣",
  quick_snack: "快吃小吃",
  quick_meal: "快速正餐",
  standard_dine_in: "普通堂食",
  popular_dine_in: "热门堂食",
  reservation_destination: "建议预约目的地",
  recommended: "建议预约",
  required: "必须预约",
  fast: "快",
  normal: "正常",
  slow: "慢",
  light: "轻量",
  filling: "管饱",
  share: "适合分享",
  hot: "热",
  warm: "温热",
  mixed: "混合",
  official: "官方视频",
  user_upload: "用户探店",
  steady: "稳定",
  satisfying: "有满足感",
  indulgent: "犒赏感",
  basic: "基础",
  standard: "标准",
  comfortable: "舒适",
  premium: "精致",
  set_meal: "套餐",
  coupon: "优惠券",
  threshold_discount: "满减",
  cash_voucher: "代金券",
  demo_group_buy: "Demo 团购",
  meituan: "美团",
  dianping: "大众点评",
  douyin: "抖音",
  manual_seed: "手工种子",
  positive: "正面",
  neutral: "中性",
  negative: "负面",
  unknown: "未知",
  other: "其他",
  demo_seed_deal: "Demo 优惠种子",
  public_web_curated: "公开网页整理",
  mixed_public_and_demo_constructed: "公开信息 + Demo 构造",
  demo_constructed_from_public_listing_context: "基于公开列表语境构造",
};

function adminError(code, message, details = {}, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function bool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = text(value).toLowerCase();
  if (["true", "1", "yes", "y", "是"].includes(raw)) return true;
  if (["false", "0", "no", "n", "否"].includes(raw)) return false;
  return fallback;
}

function number(value, {min = -Infinity, max = Infinity, fallback = null, integer = false} = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const clamped = Math.max(min, Math.min(max, numeric));
  return integer ? Math.round(clamped) : clamped;
}

function list(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return String(value).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function objects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function enumValue(value, key, fallback = "") {
  const raw = text(value);
  return ENUMS[key]?.includes(raw) ? raw : fallback;
}

function assertId(id, field) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw adminError("invalid_id", `${field} 只能包含英文、数字、下划线、短横线。`, {field, example: "m_futian_029"});
  }
}

function pathValue(value, fallback = "") {
  const raw = text(value, fallback);
  if (!raw) return "";
  if (raw.startsWith("/assets/") || /^https?:\/\//i.test(raw)) return raw;
  throw adminError("invalid_asset_path", "图片/视频路径必须是 /assets/... 或 https://...。", {value: raw});
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
  resetAdminCaches();
}

function resetAdminCaches() {
  resetFoodDirectionCache();
  resetFoodOfferCache();
  resetMerchantToolCache();
  resetMerchantReputationCache();
}

async function readCollection(type) {
  const filePath = PATHS[type];
  if (!filePath) throw adminError("unknown_collection", "未知数据集合。", {type}, 404);
  const payload = await readJson(filePath);
  return {payload, rows: payload[COLLECTION_KEYS[type]] || []};
}

async function writeCollection(type, payload, rows) {
  await writeJson(PATHS[type], {...payload, [COLLECTION_KEYS[type]]: rows});
}

function defaultDirection(id) {
  return {
    direction_id: id,
    title: "新餐饮方向",
    hook: "待补充方向描述。",
    budget_band: "50-100",
    tags: [],
    fit: [],
    avoid_for: [],
    match_rules: {cuisine_tags: []},
    media: {type: "image", url: "", poster_url: "", video_url: "", video_version: "", has_sound: false, future_video_prompt: ""},
    synthetic: true,
  };
}

function defaultMerchant(id) {
  return {
    merchant_id: id,
    name: "新商家",
    area: "深圳福田",
    neighborhood: "待补商圈",
    scene: "待补充商家场景。",
    environment: {space_type: "普通堂食店", noise_level: "medium", solo_friendly: true, chat_friendly: false, comfort_level: "standard"},
    queue_risk: "medium",
    subway_walk_min: 8,
    opening_hours: {weekday: ["10:30", "22:00"], weekend: ["10:30", "22:00"]},
    synthetic: true,
    meal_service_type: "standard_dine_in",
    reservation_mode: "none",
    address: "",
    location: {latitude: null, longitude: null, coordinate_type: "gcj02", source: "manual_admin"},
    distance_km: null,
    source_type: "manual_seed",
    specialties: [],
    public_sources: [],
    media: {poster_url: "", video_sources: [], image_urls: [], danmaku: []},
  };
}

function defaultOffer(id, merchantId = "", directionId = "") {
  return {
    offer_id: id,
    merchant_id: merchantId,
    direction_ids: directionId ? [directionId] : [],
    title: "新吃法",
    display_title: "新商家 · 新吃法",
    hook: "待补充一句话卖点。",
    price_per_person: 50,
    oil_level: "medium",
    spice_level: "low",
    solo_friendly: true,
    signature_items: [],
    environment_note: "待补充环境说明。",
    avoid_for: [],
    media: {type: "image", image_url: "", poster_url: "", video_url: "", caption: "", video_sources: []},
    synthetic: true,
    cuisine_tags: [],
    meal_style: "casual_meal",
    service_speed: "normal",
    portion_size: "normal",
    temperature: "hot",
    satisfaction_level: "steady",
    flavor_label: "",
    decision_tags: [],
    danmaku: [],
    source_type: "manual_seed",
  };
}

function defaultDeal(id, merchantId = "", offerId = "") {
  return {
    deal_id: id,
    merchant_id: merchantId,
    offer_id: offerId,
    platform: "demo_group_buy",
    external_shop_name: "",
    deal_type: "set_meal",
    title: "新优惠线索",
    deal_price: 0,
    original_price: 0,
    party_size_min: 1,
    party_size_max: 1,
    included_items: [],
    best_for: [],
    restrictions: ["原型优惠线索，需到店前二次确认"],
    valid_time: "",
    source_type: "demo_seed_deal",
    source_label: "LifePilot 可控种子优惠",
    source_url: "",
    data_checked_at: new Date().toISOString().slice(0, 10),
    confidence: 0.6,
  };
}

function defaultReputation(merchantId = "") {
  return {
    merchant_id: merchantId,
    merchant_name: "",
    source_type: "mixed_public_and_demo_constructed",
    evidence_confidence: "medium",
    rating: {value: null, scale: 5, source: "manual_admin"},
    review_stats: {review_count: 0, positive_count: 0, positive_ratio: 0, neutral_count: 0, neutral_ratio: 0, negative_count: 0, negative_ratio: 0, source: "manual_admin"},
    reputation_tags: [],
    signature_dishes: [],
    scenario_fit: {solo: true, friends: false, quick_meal: false, reservation_preferred: false, queue_risk: "medium"},
    negative_signals: [],
    evidence: [],
    updated_at: new Date().toISOString(),
  };
}

function normalizeDirection(patch, existing = defaultDirection(patch.direction_id || "")) {
  const next = {...existing, media: {...(existing.media || {})}, match_rules: {...(existing.match_rules || {})}};
  for (const key of ["title", "hook", "budget_band"]) if (patch[key] !== undefined) next[key] = text(patch[key]);
  for (const key of ["tags", "fit", "avoid_for"]) if (patch[key] !== undefined) next[key] = list(patch[key]);
  if (patch.match_rules) {
    next.match_rules = {
      ...next.match_rules,
      cuisine_tags: patch.match_rules.cuisine_tags !== undefined ? list(patch.match_rules.cuisine_tags) : (next.match_rules.cuisine_tags || []),
      spice_level_min: enumValue(patch.match_rules.spice_level_min, "spice_level", next.match_rules.spice_level_min || ""),
      oil_level_min: enumValue(patch.match_rules.oil_level_min, "oil_level", next.match_rules.oil_level_min || ""),
      oil_level_max: enumValue(patch.match_rules.oil_level_max, "oil_level", next.match_rules.oil_level_max || ""),
      budget_max: number(patch.match_rules.budget_max, {min: 0, max: 9999, fallback: next.match_rules.budget_max ?? null, integer: true}),
      solo_friendly: patch.match_rules.solo_friendly === undefined ? next.match_rules.solo_friendly : bool(patch.match_rules.solo_friendly),
    };
  }
  if (patch.media) {
    next.media = {
      ...next.media,
      type: enumValue(patch.media.type, "media_type", patch.media.type || next.media.type || "image"),
      url: patch.media.url !== undefined ? pathValue(patch.media.url) : (next.media.url || ""),
      poster_url: patch.media.poster_url !== undefined ? pathValue(patch.media.poster_url) : (next.media.poster_url || ""),
      video_url: patch.media.video_url !== undefined ? pathValue(patch.media.video_url) : (next.media.video_url || ""),
      video_version: patch.media.video_version !== undefined ? text(patch.media.video_version) : (next.media.video_version || ""),
      has_sound: patch.media.has_sound === undefined ? Boolean(next.media.has_sound) : bool(patch.media.has_sound),
      future_video_prompt: patch.media.future_video_prompt !== undefined ? text(patch.media.future_video_prompt) : (next.media.future_video_prompt || ""),
    };
  }
  next.synthetic = existing.synthetic !== false;
  return next;
}

function normalizeMerchant(patch, existing = defaultMerchant(patch.merchant_id || "")) {
  const next = {
    ...existing,
    environment: {...(existing.environment || {})},
    opening_hours: {...(existing.opening_hours || {})},
    location: {...(existing.location || {})},
    media: {...(existing.media || {})},
  };
  for (const key of ["name", "area", "neighborhood", "scene", "address", "source_type", "data_checked_at"]) {
    if (patch[key] !== undefined) next[key] = text(patch[key]);
  }
  next.queue_risk = patch.queue_risk !== undefined ? enumValue(patch.queue_risk, "queue_risk", next.queue_risk || "medium") : next.queue_risk;
  next.meal_service_type = patch.meal_service_type !== undefined ? enumValue(patch.meal_service_type, "meal_service_type", next.meal_service_type || "standard_dine_in") : next.meal_service_type;
  next.reservation_mode = patch.reservation_mode !== undefined ? enumValue(patch.reservation_mode, "reservation_mode", next.reservation_mode || "none") : next.reservation_mode;
  if (patch.subway_walk_min !== undefined) next.subway_walk_min = number(patch.subway_walk_min, {min: 0, max: 60, fallback: next.subway_walk_min || 0, integer: true});
  if (patch.distance_km !== undefined) next.distance_km = number(patch.distance_km, {min: 0, max: 99, fallback: null});
  if (patch.opening_hours) {
    next.opening_hours = {
      weekday: list(patch.opening_hours.weekday).slice(0, 2),
      weekend: list(patch.opening_hours.weekend).slice(0, 2),
    };
  }
  if (patch.environment) {
    next.environment = {
      ...next.environment,
      space_type: patch.environment.space_type !== undefined ? text(patch.environment.space_type) : (next.environment.space_type || ""),
      noise_level: patch.environment.noise_level !== undefined ? enumValue(patch.environment.noise_level, "noise_level", next.environment.noise_level || "medium") : next.environment.noise_level,
      solo_friendly: patch.environment.solo_friendly === undefined ? Boolean(next.environment.solo_friendly) : bool(patch.environment.solo_friendly),
      chat_friendly: patch.environment.chat_friendly === undefined ? Boolean(next.environment.chat_friendly) : bool(patch.environment.chat_friendly),
      comfort_level: patch.environment.comfort_level !== undefined ? enumValue(patch.environment.comfort_level, "comfort_level", next.environment.comfort_level || "standard") : next.environment.comfort_level,
    };
  }
  if (patch.location) {
    next.location = {
      ...next.location,
      latitude: number(patch.location.latitude, {min: -90, max: 90, fallback: null}),
      longitude: number(patch.location.longitude, {min: -180, max: 180, fallback: null}),
      coordinate_type: text(patch.location.coordinate_type, next.location.coordinate_type || "gcj02"),
      source: text(patch.location.source, next.location.source || "manual_admin"),
    };
  }
  for (const key of ["specialties", "public_sources"]) if (patch[key] !== undefined) next[key] = list(patch[key]);
  if (patch.media) {
    next.media = {
      ...next.media,
      poster_url: patch.media.poster_url !== undefined ? pathValue(patch.media.poster_url) : (next.media.poster_url || ""),
      video_sources: patch.media.video_sources !== undefined ? normalizeVideoSources(patch.media.video_sources) : (next.media.video_sources || []),
      image_urls: patch.media.image_urls !== undefined ? list(patch.media.image_urls).map((item) => pathValue(item)).filter(Boolean) : (next.media.image_urls || []),
      danmaku: patch.media.danmaku !== undefined ? list(patch.media.danmaku).slice(0, 12) : (next.media.danmaku || []),
    };
  }
  next.synthetic = existing.synthetic !== false;
  return next;
}

function normalizeVideoSources(value) {
  return objects(value).map((source, index) => ({
    key: text(source.key, `video_${index + 1}`),
    type: enumValue(source.type, "video_source_type", source.type === "user_upload" ? "user_upload" : (source.type === "official" ? "official" : "other")),
    label: text(source.label, `视频 ${index + 1}`),
    url: pathValue(source.url || ""),
    poster_url: source.poster_url ? pathValue(source.poster_url) : "",
    has_sound: bool(source.has_sound),
    mobile_optimized: bool(source.mobile_optimized),
  })).filter((source) => source.url);
}

function normalizeOffer(patch, existing = defaultOffer(patch.offer_id || "", patch.merchant_id || "", list(patch.direction_ids)[0] || "")) {
  const next = {...existing, media: {...(existing.media || {})}};
  for (const key of ["merchant_id", "title", "display_title", "hook", "environment_note", "flavor_label", "parking_note", "source_type"]) {
    if (patch[key] !== undefined) next[key] = text(patch[key]);
  }
  if (patch.price_per_person !== undefined) next.price_per_person = number(patch.price_per_person, {min: 0, max: 9999, fallback: next.price_per_person || 0, integer: true});
  for (const key of ["oil_level", "spice_level", "meal_style", "service_speed", "portion_size", "temperature", "satisfaction_level"]) {
    if (patch[key] !== undefined) next[key] = enumValue(patch[key], key, next[key] || ENUMS[key][0]);
  }
  if (patch.solo_friendly !== undefined) next.solo_friendly = bool(patch.solo_friendly, next.solo_friendly !== false);
  for (const key of ["direction_ids", "signature_items", "avoid_for", "cuisine_tags", "decision_tags", "danmaku"]) {
    if (patch[key] !== undefined) next[key] = list(patch[key]);
  }
  if (patch.media) {
    next.media = {
      ...next.media,
      type: text(patch.media.type, next.media.type || "image"),
      image_url: patch.media.image_url !== undefined ? pathValue(patch.media.image_url) : (next.media.image_url || ""),
      poster_url: patch.media.poster_url !== undefined ? pathValue(patch.media.poster_url) : (next.media.poster_url || ""),
      video_url: patch.media.video_url !== undefined ? pathValue(patch.media.video_url) : (next.media.video_url || ""),
      caption: patch.media.caption !== undefined ? text(patch.media.caption) : (next.media.caption || ""),
      inherit_from_direction: patch.media.inherit_from_direction !== undefined ? text(patch.media.inherit_from_direction) : (next.media.inherit_from_direction || ""),
      video_sources: patch.media.video_sources !== undefined ? normalizeVideoSources(patch.media.video_sources) : (next.media.video_sources || []),
    };
  }
  next.synthetic = existing.synthetic !== false;
  return next;
}

function normalizeDeal(patch, existing = defaultDeal(patch.deal_id || "", patch.merchant_id || "", patch.offer_id || "")) {
  const next = {...existing};
  for (const key of ["merchant_id", "offer_id", "external_shop_name", "title", "valid_time", "source_label", "source_url", "data_checked_at"]) {
    if (patch[key] !== undefined) next[key] = text(patch[key]);
  }
  if (patch.platform !== undefined) next.platform = enumValue(patch.platform, "platform", next.platform || "demo_group_buy");
  if (patch.deal_type !== undefined) next.deal_type = enumValue(patch.deal_type, "deal_type", next.deal_type || "set_meal");
  if (patch.source_type !== undefined) next.source_type = enumValue(patch.source_type, "source_type", next.source_type || "demo_seed_deal");
  for (const [key, opts] of Object.entries({
    deal_price: {min: 0, max: 99999},
    original_price: {min: 0, max: 99999},
    party_size_min: {min: 1, max: 99, integer: true},
    party_size_max: {min: 1, max: 99, integer: true},
    confidence: {min: 0, max: 1},
  })) {
    if (patch[key] !== undefined) next[key] = number(patch[key], {...opts, fallback: next[key] ?? 0});
  }
  for (const key of ["included_items", "best_for", "restrictions"]) if (patch[key] !== undefined) next[key] = list(patch[key]);
  return next;
}

function normalizeReputation(patch, existing = defaultReputation(patch.merchant_id || "")) {
  const next = {...existing, rating: {...(existing.rating || {})}, review_stats: {...(existing.review_stats || {})}, scenario_fit: {...(existing.scenario_fit || {})}};
  for (const key of ["merchant_name", "updated_at"]) if (patch[key] !== undefined) next[key] = text(patch[key]);
  if (patch.source_type !== undefined) next.source_type = enumValue(patch.source_type, "source_type", next.source_type || "mixed_public_and_demo_constructed");
  if (patch.evidence_confidence !== undefined) next.evidence_confidence = enumValue(patch.evidence_confidence, "evidence_confidence", next.evidence_confidence || "medium");
  if (patch.rating) {
    next.rating = {
      value: number(patch.rating.value, {min: 0, max: 5, fallback: null}),
      scale: number(patch.rating.scale, {min: 1, max: 10, fallback: 5}),
      source: text(patch.rating.source, next.rating.source || "manual_admin"),
    };
  }
  if (patch.review_stats) {
    next.review_stats = {
      review_count: number(patch.review_stats.review_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      positive_count: number(patch.review_stats.positive_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      positive_ratio: number(patch.review_stats.positive_ratio, {min: 0, max: 1, fallback: 0}),
      neutral_count: number(patch.review_stats.neutral_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      neutral_ratio: number(patch.review_stats.neutral_ratio, {min: 0, max: 1, fallback: 0}),
      negative_count: number(patch.review_stats.negative_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      negative_ratio: number(patch.review_stats.negative_ratio, {min: 0, max: 1, fallback: 0}),
      source: text(patch.review_stats.source, next.review_stats.source || "manual_admin"),
    };
  }
  if (patch.scenario_fit) {
    next.scenario_fit = {
      solo: bool(patch.scenario_fit.solo),
      friends: bool(patch.scenario_fit.friends),
      quick_meal: bool(patch.scenario_fit.quick_meal),
      reservation_preferred: bool(patch.scenario_fit.reservation_preferred),
      queue_risk: enumValue(patch.scenario_fit.queue_risk, "queue_risk", "medium"),
    };
  }
  if (patch.reputation_tags !== undefined) {
    next.reputation_tags = objects(patch.reputation_tags).map((tag) => ({
      tag: text(tag.tag),
      sentiment: enumValue(tag.sentiment, "sentiment", "neutral"),
      mention_count: number(tag.mention_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      mention_ratio: number(tag.mention_ratio, {min: 0, max: 1, fallback: 0}),
      evidence_text: text(tag.evidence_text),
      source: text(tag.source, "manual_admin"),
    })).filter((tag) => tag.tag);
  }
  if (patch.signature_dishes !== undefined) {
    next.signature_dishes = objects(patch.signature_dishes).map((dish) => ({
      name: text(dish.name),
      confidence: number(dish.confidence, {min: 0, max: 1, fallback: null}),
      source: text(dish.source, "manual_admin"),
    })).filter((dish) => dish.name);
  }
  if (patch.negative_signals !== undefined) {
    next.negative_signals = objects(patch.negative_signals).map((signal) => ({
      signal: text(signal.signal),
      severity: enumValue(signal.severity, "severity", "medium"),
      mention_count: number(signal.mention_count, {min: 0, max: 999999, fallback: 0, integer: true}),
      mention_ratio: number(signal.mention_ratio, {min: 0, max: 1, fallback: 0}),
    })).filter((signal) => signal.signal);
  }
  if (patch.evidence !== undefined) {
    next.evidence = objects(patch.evidence).map((item) => ({
      type: text(item.type, "manual_note"),
      url: item.url ? pathValue(item.url) : "",
      note: text(item.note),
    })).filter((item) => item.type || item.url || item.note);
  }
  return next;
}

const NORMALIZERS = {
  directions: normalizeDirection,
  merchants: normalizeMerchant,
  offers: normalizeOffer,
  deals: normalizeDeal,
  reputations: normalizeReputation,
};
const DEFAULTS = {
  directions: defaultDirection,
  merchants: defaultMerchant,
  offers: defaultOffer,
  deals: defaultDeal,
  reputations: defaultReputation,
};

export async function getAdminCatalog() {
  const [directionsPayload, merchantsPayload, offersPayload, dealsPayload, reputationsPayload] = await Promise.all([
    readJson(PATHS.directions),
    readJson(PATHS.merchants),
    readJson(PATHS.offers),
    readJson(PATHS.deals),
    readJson(PATHS.reputations),
  ]);
  const directions = directionsPayload.directions || [];
  const merchants = merchantsPayload.merchants || [];
  const offers = offersPayload.offers || [];
  const deals = dealsPayload.deals || [];
  const reputations = reputationsPayload.reputations || [];
  const merchantNames = new Map(merchants.map((merchant) => [merchant.merchant_id, merchant.name || merchant.merchant_id]));
  const directionTitles = new Map(directions.map((direction) => [direction.direction_id, direction.title || direction.direction_id]));
  const offerTitles = new Map(offers.map((offer) => [offer.offer_id, offer.title || offer.offer_id]));
  return {
    ok: true,
    synthetic_only: true,
    directions,
    merchants,
    offers: offers.map((offer) => ({
      ...offer,
      merchant_name: merchantNames.get(offer.merchant_id) || offer.merchant_id,
      direction_titles: (offer.direction_ids || []).map((id) => directionTitles.get(id) || id),
    })),
    deals: deals.map((deal) => ({
      ...deal,
      merchant_name: merchantNames.get(deal.merchant_id) || deal.merchant_id,
      offer_title: offerTitles.get(deal.offer_id) || deal.offer_id,
    })),
    reputations: reputations.map((reputation) => ({
      ...reputation,
      merchant_name_display: merchantNames.get(reputation.merchant_id) || reputation.merchant_name || reputation.merchant_id,
    })),
    options: Object.fromEntries(Object.entries(ENUMS).map(([key, values]) => [
      key,
      values.map((value) => ({value, label: LABELS[value] || value})),
    ])),
    asset_policy: {
      local_upload_root: path.join(REPO_ROOT, "assets"),
      stored_path_prefix: "/assets/",
      cos_base_url: "https://lifepilot-assets-1331466052.cos.ap-guangzhou.myqcloud.com",
      note: "本地上传只保证本地预览；生产小程序需要把同路径文件同步到腾讯 COS。",
    },
  };
}

export async function createAdminItem(type, body = {}) {
  const {payload, rows} = await readCollection(type);
  const idKey = ID_KEYS[type];
  const id = text(body[idKey] || `${idKey.replace(/_id$/, "")}_custom_${Date.now()}`);
  assertId(id, idKey);
  if (rows.some((row) => row[idKey] === id)) throw adminError("duplicate_id", `${idKey} 已存在。`, {id}, 409);
  const base = DEFAULTS[type](id, body.merchant_id || "", list(body.direction_ids)[0] || body.offer_id || "");
  const item = NORMALIZERS[type]({...body, [idKey]: id}, base);
  item[idKey] = id;
  rows.push(item);
  await writeCollection(type, payload, rows);
  return {[singular(type)]: item};
}

export async function updateAdminItem(type, id, body = {}) {
  assertId(id, ID_KEYS[type]);
  const {payload, rows} = await readCollection(type);
  const idKey = ID_KEYS[type];
  const index = rows.findIndex((row) => row[idKey] === id);
  if (index < 0) throw adminError("not_found", "没有找到要更新的数据。", {type, id}, 404);
  if (body[idKey] !== undefined && body[idKey] !== id) {
    throw adminError("id_readonly", "主键 ID 不允许修改；请新建一条再删除旧条目。", {idKey, id});
  }
  rows[index] = NORMALIZERS[type]({...body, [idKey]: id}, rows[index]);
  rows[index][idKey] = id;
  await writeCollection(type, payload, rows);
  return {[singular(type)]: rows[index]};
}

export async function deleteAdminItem(type, id) {
  assertId(id, ID_KEYS[type]);
  await assertCanDelete(type, id);
  const {payload, rows} = await readCollection(type);
  const idKey = ID_KEYS[type];
  const nextRows = rows.filter((row) => row[idKey] !== id);
  if (nextRows.length === rows.length) throw adminError("not_found", "没有找到要删除的数据。", {type, id}, 404);
  await writeCollection(type, payload, nextRows);
  return {deleted_id: id};
}

async function assertCanDelete(type, id) {
  const [offersPayload, dealsPayload, reputationsPayload] = await Promise.all([
    readJson(PATHS.offers),
    readJson(PATHS.deals),
    readJson(PATHS.reputations),
  ]);
  if (type === "merchants") {
    const linkedOffers = (offersPayload.offers || []).filter((offer) => offer.merchant_id === id).map((offer) => offer.offer_id);
    const linkedDeals = (dealsPayload.deals || []).filter((deal) => deal.merchant_id === id).map((deal) => deal.deal_id);
    const linkedReputations = (reputationsPayload.reputations || []).filter((item) => item.merchant_id === id).map((item) => item.merchant_id);
    if (linkedOffers.length || linkedDeals.length || linkedReputations.length) {
      throw adminError("linked_records", "这个商家还有关联数据，请先删除或转移关联 Offer、优惠和口碑。", {linked_offer_ids: linkedOffers, linked_deal_ids: linkedDeals, linked_reputation_ids: linkedReputations}, 409);
    }
  }
  if (type === "directions") {
    const linkedOffers = (offersPayload.offers || []).filter((offer) => (offer.direction_ids || []).includes(id)).map((offer) => offer.offer_id);
    if (linkedOffers.length) throw adminError("linked_records", "这个方向仍被 Offer 使用，请先从 Offer 里移除。", {linked_offer_ids: linkedOffers}, 409);
  }
  if (type === "offers") {
    const linkedDeals = (dealsPayload.deals || []).filter((deal) => deal.offer_id === id).map((deal) => deal.deal_id);
    if (linkedDeals.length) throw adminError("linked_records", "这个 Offer 仍被优惠使用，请先删除或转移优惠。", {linked_deal_ids: linkedDeals}, 409);
  }
}

function singular(type) {
  return ({directions: "direction", merchants: "merchant", offers: "offer", deals: "deal", reputations: "reputation"})[type] || "item";
}

function safeAssetName(name = "") {
  const ext = path.extname(name).toLowerCase();
  const stem = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
  return `${stem}${ext}`;
}

function assetFolder(kind = "offer_cover", slug = "general") {
  const safeSlug = text(slug, "general").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "general";
  if (kind === "direction_video") return ["food-direction-videos"];
  if (kind === "direction_cover") return ["food-directions"];
  if (kind === "offer_video" || kind === "offer_cover" || kind === "offer_poster") return ["offer-media", safeSlug];
  return ["admin-uploads", safeSlug];
}

export async function uploadAdminAsset(body = {}) {
  const filename = safeAssetName(body.filename || "asset.bin");
  const dataUrl = text(body.data_url || body.dataUrl);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() : text(body.base64);
  if (!base64) throw adminError("missing_asset_data", "缺少上传文件内容。");
  const relativeParts = assetFolder(body.asset_kind || body.assetKind, body.slug || body.merchant_slug || body.merchantSlug);
  const relativePath = path.posix.join("assets", ...relativeParts, filename);
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!absolutePath.startsWith(path.join(REPO_ROOT, "assets"))) {
    throw adminError("invalid_asset_path", "上传路径不安全。");
  }
  await mkdir(path.dirname(absolutePath), {recursive: true});
  await writeFile(absolutePath, Buffer.from(base64, "base64"));
  return {
    path: `/${relativePath}`,
    local_path: absolutePath,
    cos_required: true,
    cos_note: "本地上传已完成；生产小程序可见前，需要把同一路径文件同步到腾讯 COS。",
  };
}

export function adminHttpError(error) {
  return {
    status: error?.status || 500,
    code: error?.code || "admin_error",
    message: error instanceof Error ? error.message : String(error),
    details: error?.details || {},
  };
}
