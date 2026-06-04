import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";
import { buildOfferExplanationPrompt } from "./ai/prompts.mjs";
import { queuePayload, routePayload, weatherPayload } from "./context-providers.mjs";
import { parseJsonObjectFromText } from "./json-utils.mjs";
import { buildDealSearchContext } from "./merchant-tools.mjs";
import { readRecommendationMemoryContext } from "./memory-store.mjs";
import { readMerchantFeedbackContext } from "./merchant-feedback-store.mjs";
import { readRecommendationSignalsForScoring, scoreMemorySignalsForOffer } from "./recommendation-signals.mjs";

const DATA_ROOT = path.join(REPO_ROOT, "data/synthetic_food_futian");
const DIRECTIONS_PATH = path.join(DATA_ROOT, "food_directions.json");
const OFFERS_PATH = path.join(DATA_ROOT, "offers.json");
const MERCHANTS_PATH = path.join(DATA_ROOT, "merchants.json");
const DEFAULT_OFFER_LIMIT = 10;

let cachedDirections = null;
let cachedOffers = null;
let cachedMerchants = null;

export function resetFoodOfferCache() {
  cachedDirections = null;
  cachedOffers = null;
  cachedMerchants = null;
}

const OIL_RANK = {low: 0, medium: 1, high: 2};
const SPICE_RANK = {none: 0, low: 1, medium: 2, high: 3};
const QUEUE_LABELS = {low: "排队风险低", medium: "饭点可能有一点排队", high: "饭点排队风险高"};
const CUISINE_ALIASES = {
  川菜: ["川菜", "四川", "sichuan", "classic_sichuan", "fine_sichuan", "creative_sichuan", "chengdu", "zigong", "yanbang"],
  四川: ["川菜", "四川", "sichuan", "classic_sichuan", "fine_sichuan", "creative_sichuan", "chengdu", "zigong", "yanbang"],
  sichuan: ["川菜", "四川", "sichuan", "classic_sichuan", "fine_sichuan", "creative_sichuan", "chengdu", "zigong", "yanbang"],
  湘菜: ["湘菜", "湖南", "hunan", "xiang"],
  湖南: ["湘菜", "湖南", "hunan", "xiang"],
  粤菜: ["粤菜", "广东", "cantonese", "guangdong"],
  广东: ["粤菜", "广东", "cantonese", "guangdong"],
  日料: ["日料", "日本", "japanese", "sushi"],
  日本: ["日料", "日本", "japanese", "sushi"],
};

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

async function readOffers() {
  if (!cachedOffers) cachedOffers = JSON.parse(await readFile(OFFERS_PATH, "utf8")).offers || [];
  return cachedOffers;
}

async function readDirections() {
  if (!cachedDirections) {
    const rows = JSON.parse(await readFile(DIRECTIONS_PATH, "utf8")).directions || [];
    cachedDirections = new Map(rows.map((item) => [item.direction_id, item]));
  }
  return cachedDirections;
}

async function readMerchants() {
  if (!cachedMerchants) {
    const rows = JSON.parse(await readFile(MERCHANTS_PATH, "utf8")).merchants || [];
    cachedMerchants = new Map(rows.map((item) => [item.merchant_id, item]));
  }
  return cachedMerchants;
}

function cleanMerchantName(name = "") {
  return String(name).replace("合成候选·", "");
}

function distanceKmFromMerchant(merchant = {}) {
  const explicit = Number(merchant.distance_km || merchant.distanceKm || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const walkMin = Number(merchant.subway_walk_min || 0);
  if (!Number.isFinite(walkMin) || walkMin <= 0) return null;
  return Math.max(0.2, Math.round(walkMin * 0.08 * 10) / 10);
}

function distanceText(distanceKm) {
  if (!Number.isFinite(distanceKm)) return "距离待确认";
  return `${distanceKm.toFixed(1)}km`;
}

function normalizeMediaSource(source = {}, index = 0, fallbackPoster = "") {
  const url = String(source.url || "").trim();
  if (!url) return null;
  return {
    key: String(source.key || source.type || `video_${index + 1}`).trim(),
    type: String(source.type || source.key || "video").trim(),
    label: String(source.label || (source.type === "user_upload" ? "用户探店" : "官方视频")).trim(),
    url,
    poster_url: String(source.poster_url || fallbackPoster || "").trim(),
    has_sound: Boolean(source.has_sound),
    mobile_optimized: Boolean(source.mobile_optimized),
  };
}

function mediaForOffer(offer = {}, merchant = {}) {
  const media = offer.media || {};
  const merchantMedia = merchant.media || {};
  const fallbackDirection = media.inherit_from_direction || offer.direction_ids?.[0] || "dir_hot_soup_noodles";
  const fallbackImage = `/assets/food-directions/${fallbackDirection.replace(/^dir_/, "")}.png`;
  const merchantImages = Array.isArray(merchantMedia.image_urls) ? merchantMedia.image_urls.filter(Boolean) : [];
  const offerImages = Array.isArray(media.image_urls) ? media.image_urls.filter(Boolean) : [];
  const imageUrls = [...merchantImages, ...offerImages, media.image_url, media.poster_url, fallbackImage].filter(Boolean);
  const posterUrl = merchantMedia.poster_url || media.poster_url || media.image_url || imageUrls[0] || fallbackImage;
  const merchantVideoSources = Array.isArray(merchantMedia.video_sources) ? merchantMedia.video_sources : [];
  const offerVideoSources = Array.isArray(media.video_sources) ? media.video_sources : [];
  const rawVideoSources = merchantVideoSources.length
    ? merchantVideoSources
    : (offerVideoSources.length ? offerVideoSources : (media.video_url ? [{
      key: "offer_video",
      type: "offer",
      label: "店铺视频",
      url: media.video_url,
      poster_url: posterUrl,
      has_sound: true,
    }] : []));
  const videoSources = rawVideoSources
    .map((source, index) => normalizeMediaSource(source, index, posterUrl))
    .filter(Boolean);
  return {
    image_url: imageUrls[0] || fallbackImage,
    image_urls: imageUrls,
    video_url: videoSources[0]?.url || "",
    poster_url: videoSources[0]?.poster_url || posterUrl,
    media_type: videoSources.length ? "video" : (media.type || merchantMedia.type || "image"),
    video_sources: videoSources,
    danmaku: [
      ...((Array.isArray(merchantMedia.danmaku) ? merchantMedia.danmaku : [])),
      ...((Array.isArray(offer.danmaku) ? offer.danmaku : [])),
    ].filter(Boolean).slice(0, 8),
  };
}

function keptDirectionIds(session = {}, body = {}) {
  const explicit = body.kept_direction_ids || body.keptDirectionIds || body.keptDirections;
  if (Array.isArray(explicit)) return new Set(explicit);
  return new Set((session.direction_events || [])
    .filter((event) => event.action === "keep")
    .map((event) => event.direction_id)
    .filter(Boolean));
}

function dislikedDirectionIds(session = {}, body = {}) {
  const explicit = body.disliked_direction_ids || body.dislikedDirectionIds || body.dislikedDirections;
  if (Array.isArray(explicit)) return new Set(explicit);
  return new Set((session.direction_events || [])
    .filter((event) => event.action === "dislike")
    .map((event) => event.direction_id)
    .filter(Boolean));
}

function compactDirection(direction = {}) {
  return {
    direction_id: direction.direction_id || "",
    title: direction.title || "",
    hook: direction.hook || "",
    tags: direction.tags || [],
    fit: direction.fit || [],
    avoid_for: direction.avoid_for || [],
    budget_band: direction.budget_band || "",
  };
}

function hasPreference(understanding = {}, facet, words = []) {
  const text = [
    ...(understanding.soft_preferences || []).filter((item) => !facet || item.facet === facet).map((item) => `${item.value} ${(item.evidence || []).join(" ")}`),
    ...Object.values(understanding.dimensions || {}).filter(Boolean).map((item) => `${item.intent} ${(item.evidence || []).join(" ")}`),
  ].join(" ");
  return words.some((word) => text.includes(word));
}

function explicitSoloNeed(understanding = {}) {
  const constraints = understanding.constraints || {};
  if (Number(constraints.party_size || 0) !== 1) return false;
  const text = [
    understanding.normalized_goal,
    understanding.raw_entry_text,
    ...(understanding.soft_preferences || []).map((item) => `${item.value || ""} ${(item.evidence || []).join(" ")}`),
    ...Object.values(understanding.dimensions || {}).filter(Boolean).map((item) => `${item.intent || ""} ${(item.evidence || []).join(" ")}`),
  ].filter(Boolean).join(" ");
  return /一个人|1个人|单人|独自|自己吃|独食|solo/i.test(text);
}

function explicitGroupNeed(understanding = {}) {
  const constraints = understanding.constraints || {};
  if (Number(constraints.party_size || 0) < 2) return false;
  const text = [
    understanding.normalized_goal,
    understanding.raw_entry_text,
    ...(understanding.soft_preferences || []).map((item) => `${item.value || ""} ${(item.evidence || []).join(" ")}`),
    ...Object.values(understanding.dimensions || {}).filter(Boolean).map((item) => `${item.intent || ""} ${(item.evidence || []).join(" ")}`),
  ].filter(Boolean).join(" ");
  return /两个人|2个人|多人|朋友|同事|聚餐|一起吃|聊天/i.test(text);
}

function desiredCuisineTags(understanding = {}) {
  const foodPreferences = understanding.food_preferences || understanding.foodPreferences || {};
  const explicit = [
    ...normalizeArray(foodPreferences.cuisine_tags || foodPreferences.cuisineTags || []),
    ...normalizeArray(understanding.cuisine_tags || understanding.cuisineTags || []),
    ...normalizeArray(understanding.cuisine || ""),
    ...normalizeArray(foodPreferences.cuisine || ""),
  ];
  const preferenceText = [
    understanding.normalized_goal,
    understanding.raw_entry_text,
    ...(understanding.soft_preferences || []).map((item) => `${item.value || ""} ${(item.evidence || []).join(" ")}`),
  ].filter(Boolean).join(" ");
  for (const key of Object.keys(CUISINE_ALIASES)) {
    if (preferenceText.includes(key)) explicit.push(key);
  }
  const tags = new Set();
  for (const item of explicit) {
    const key = String(item || "").trim();
    if (!key) continue;
    tags.add(key);
    tags.add(key.toLowerCase());
    for (const alias of (CUISINE_ALIASES[key] || CUISINE_ALIASES[key.toLowerCase()] || [])) {
      tags.add(alias);
      tags.add(String(alias).toLowerCase());
    }
  }
  return tags;
}

function desiredHardCuisineTags(understanding = {}) {
  const foodPreferences = understanding.food_preferences || understanding.foodPreferences || {};
  const explicit = [
    ...normalizeArray(foodPreferences.cuisine_tags || foodPreferences.cuisineTags || []),
    ...normalizeArray(understanding.cuisine_tags || understanding.cuisineTags || []),
    ...normalizeArray(understanding.cuisine || ""),
    ...normalizeArray(foodPreferences.cuisine || ""),
  ];
  const preferenceText = [
    understanding.normalized_goal,
    understanding.raw_entry_text,
    ...(understanding.soft_preferences || []).map((item) => `${item.value || ""} ${(item.evidence || []).join(" ")}`),
  ].filter(Boolean).join(" ");
  for (const key of Object.keys(CUISINE_ALIASES)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(想吃|要吃|吃点|吃个|来点|只看|只要|必须|明确|优先).*${escaped}|${escaped}.*(也行|可以|优先|就行|只看|只要)`);
    if (pattern.test(preferenceText)) explicit.push(key);
  }
  const tags = new Set();
  for (const item of explicit) {
    const key = String(item || "").trim();
    if (!key) continue;
    tags.add(key);
    tags.add(key.toLowerCase());
    for (const alias of (CUISINE_ALIASES[key] || CUISINE_ALIASES[key.toLowerCase()] || [])) {
      tags.add(alias);
      tags.add(String(alias).toLowerCase());
    }
  }
  return tags;
}

function cuisineMatch(offer = {}, merchant = {}, tags = new Set()) {
  if (!tags.size) return false;
  const values = [
    ...(offer.cuisine_tags || []),
    ...(offer.decision_tags || []),
    offer.flavor_label,
    offer.display_title,
    offer.hook,
    merchant.name,
    merchant.scene,
  ].filter(Boolean).map((item) => String(item).toLowerCase());
  return values.some((value) => [...tags].some((tag) => value.includes(String(tag).toLowerCase())));
}

function hardFilterReasons(offer, merchant, context) {
  const reasons = [];
  const constraints = context.understanding?.constraints || {};
  const cuisineTags = desiredHardCuisineTags(context.understanding || {});
  if (cuisineTags.size && !cuisineMatch(offer, merchant, cuisineTags)) {
    reasons.push({
      key: "cuisine.hard_mismatch",
      reason: "没有命中本轮明确想吃的菜系",
    });
  }
  const budgetMax = Number(constraints.budget_per_person_max || 0);
  if (budgetMax && Number(offer.price_per_person) > budgetMax) {
    reasons.push({
      key: "budget.over_max",
      reason: `人均 ${offer.price_per_person} 超过预算 ${budgetMax}`,
    });
  }
  if (explicitSoloNeed(context.understanding || {}) && offer.solo_friendly === false) {
    reasons.push({
      key: "party.solo_blocked",
      reason: "不适合一个人吃",
    });
  }
  if (hasPreference(context.understanding, "", ["不吃辣", "不能吃辣", "不要辣"]) && SPICE_RANK[offer.spice_level] >= SPICE_RANK.medium) {
    reasons.push({
      key: "spice.no_spicy_blocked",
      reason: "辣度和不吃辣冲突",
    });
  }
  if (context.dislikedDirections.size && offer.direction_ids?.some((id) => context.dislikedDirections.has(id)) && !offer.direction_ids?.some((id) => context.keptDirections.has(id))) {
    reasons.push({
      key: "swipe.disliked_direction_only",
      reason: "属于刚刚放弃的方向",
    });
  }
  return reasons;
}

function scoreFeature(source, key, score, reason, extra = {}) {
  return {
    source,
    key,
    score,
    reason,
    ...extra,
  };
}

function addFeature(features, source, key, score, reason, extra = {}) {
  if (!score) return;
  features.push(scoreFeature(source, key, score, reason, extra));
}

function summarizeFeatures(features = [], filterReasons = []) {
  const matched = features
    .filter((item) => Number(item.score || 0) > 0)
    .map((item) => item.reason)
    .filter(Boolean);
  const watchouts = features
    .filter((item) => Number(item.score || 0) < 0)
    .map((item) => item.reason)
    .filter(Boolean);
  if (!matched.length) matched.push("有基础匹配点");
  return {
    matched: [...new Set(matched)].slice(0, 4),
    watchouts: [...new Set(watchouts)].slice(0, 3),
    conflicts: [...new Set(filterReasons.map((item) => item.reason).filter(Boolean))].slice(0, 3),
    unknown: ["真实营业状态和价格需要出发前确认"],
  };
}

function userFeedbackForOffer(offer, merchant, context) {
  const merchantFeedback = context.merchantFeedback || {};
  const offerSummary = merchantFeedback.offer_summaries?.[offer.offer_id] || null;
  const merchantSummary = merchantFeedback.merchant_summaries?.[merchant.merchant_id] || null;
  return {
    score: Number(offerSummary?.score ?? merchantSummary?.score ?? 0),
    feedback_count: Number(offerSummary?.feedback_count ?? merchantSummary?.feedback_count ?? 0),
    positive_tags: [...new Set([...(merchantSummary?.positive_tags || []), ...(offerSummary?.positive_tags || [])])].slice(0, 8),
    negative_tags: [...new Set([...(merchantSummary?.negative_tags || []), ...(offerSummary?.negative_tags || [])])].slice(0, 8),
    last_feedback_text: offerSummary?.last_feedback_text || merchantSummary?.last_feedback_text || "",
    updated_at: offerSummary?.updated_at || merchantSummary?.updated_at || "",
  };
}

function scoreOffer(offer, merchant, context) {
  const features = [];
  const filterReasons = hardFilterReasons(offer, merchant, context);
  const understanding = context.understanding || {};
  const distanceKm = distanceKmFromMerchant(merchant);
  const userFeedback = userFeedbackForOffer(offer, merchant, context);
  const cuisineTags = desiredCuisineTags(understanding);

  if (cuisineTags.size) {
    if (cuisineMatch(offer, merchant, cuisineTags)) {
      addFeature(features, "current_need", "cuisine.match", 18, "命中想吃的菜系");
    }
  }

  if (offer.direction_ids?.some((id) => context.keptDirections.has(id))) {
    addFeature(features, "swipe", "direction.kept", 12, "命中主人刚刚保留的方向");
  }
  if (!context.keptDirections.size) addFeature(features, "default_tiebreaker", "direction.no_kept_baseline", 2, "没有保留方向时保留一点探索空间");

  const budgetMax = Number(understanding.constraints?.budget_per_person_max || 0);
  if (budgetMax) {
    if (Number(offer.price_per_person) <= budgetMax) {
      addFeature(features, "current_need", "budget.within_max", 6, `人均 ${offer.price_per_person}，符合预算`);
    }
  }

  if (explicitSoloNeed(understanding) && offer.solo_friendly) {
    addFeature(features, "current_need", "party.solo_friendly", 5, "适合一个人吃");
  }
  if (explicitGroupNeed(understanding) && merchant.environment?.chat_friendly) {
    addFeature(features, "current_need", "party.chat_friendly", 5, "适合两个人坐下来聊");
  }

  if (hasPreference(understanding, "flavor.satisfaction", ["下饭", "满足"])) {
    if (["large", "generous"].includes(offer.portion_size) || ["high", "steady"].includes(offer.satisfaction_level)) {
      addFeature(features, "current_need", "flavor.satisfaction", 5, "更有满足感");
    }
  }
  if (hasPreference(understanding, "health_load", ["清爽", "低负担"])) {
    if (offer.oil_level === "low") {
      addFeature(features, "current_need", "health.low_oil", 6, "油负担低一些");
    } else if (offer.oil_level === "high") {
      addFeature(features, "current_need", "health.high_oil", -6, "这份会偏油");
    }
  }
  if (hasPreference(understanding, "temperature", ["热乎"])) {
    if (offer.temperature === "hot") {
      addFeature(features, "current_need", "temperature.hot", 4, "是热乎的一顿");
    }
  }
  if (hasPreference(understanding, "queue", ["少排队"])) {
    if (merchant.queue_risk === "low") {
      addFeature(features, "current_need", "queue.low", 4, "排队风险低");
    } else {
      addFeature(features, "current_need", `queue.${merchant.queue_risk || "unknown"}`, merchant.queue_risk === "high" ? -5 : -2, QUEUE_LABELS[merchant.queue_risk] || "排队情况需确认");
    }
  }
  if (hasPreference(understanding, "distance", ["附近", "少走路"]) && Number.isFinite(distanceKm)) {
    if (distanceKm <= 0.8) {
      addFeature(features, "current_need", "distance.near", 5, `距离约 ${distanceText(distanceKm)}，很省脚程`);
    } else if (distanceKm <= 1.5) {
      addFeature(features, "current_need", "distance.ok", 3, `距离约 ${distanceText(distanceKm)}`);
    } else {
      addFeature(features, "current_need", "distance.far", -2, `距离约 ${distanceText(distanceKm)}，不算最近`);
    }
  }
  if (hasPreference(understanding, "social_friction", ["身上味道", "狼狈", "尴尬"])) {
    if (offer.spice_level === "none" && offer.oil_level !== "high" && merchant.environment?.comfort_level !== "basic") {
      addFeature(features, "current_need", "social_friction.low", 5, "吃相和气味压力小一些");
    } else {
      addFeature(features, "current_need", "social_friction.watchout", -1, "可能不够适合低尴尬场景");
    }
  }
  if (hasPreference(understanding, "environment", ["聊天", "舒服", "安静"])) {
    if (merchant.environment?.chat_friendly || merchant.environment?.noise_level === "low") {
      addFeature(features, "current_need", "environment.chat_or_quiet", 5, "环境更适合坐下来聊");
    } else {
      addFeature(features, "current_need", "environment.quick_meal", -1, "环境可能更适合快吃");
    }
  }

  if (merchant.queue_risk === "low") addFeature(features, "default_tiebreaker", "queue.low_baseline", 1, "排队风险低");
  if (offer.service_speed === "fast") addFeature(features, "default_tiebreaker", "service.fast_baseline", 1, "出餐速度快");
  if (userFeedback.score) {
    addFeature(
      features,
      "merchant_feedback",
      userFeedback.score > 0 ? "feedback.positive" : "feedback.negative",
      userFeedback.score,
      userFeedback.score > 0 ? "主人上次反馈不错" : "主人之前对这家有过负反馈",
      {feedback_count: userFeedback.feedback_count}
    );
  }
  for (const memoryFeature of scoreMemorySignalsForOffer({signals: context.recommendationSignals || [], offer, merchant})) {
    features.push(memoryFeature);
  }
  const score = features.reduce((sum, item) => sum + Number(item.score || 0), 0);

  return {
    score,
    scoring_features: features,
    filter_reasons: filterReasons,
    explanation: summarizeFeatures(features, filterReasons),
  };
}

function normalizeOfferCard(offer, merchant, scoring, context = {}) {
  const media = mediaForOffer(offer, merchant);
  const distanceKm = distanceKmFromMerchant(merchant);
  const userFeedback = userFeedbackForOffer(offer, merchant, context);
  return {
    card_id: offer.merchant_id,
    offer_id: offer.offer_id,
    merchant_id: offer.merchant_id,
    merchant_name: cleanMerchantName(merchant.name),
    direction_ids: offer.direction_ids || [],
    title: offer.title,
    display_title: offer.display_title,
    hook: offer.hook,
    tags: offer.decision_tags || [],
    score: scoring.score,
    scoring_features: scoring.scoring_features || [],
    ...media,
    facts: {
      price_per_person: offer.price_per_person,
      neighborhood: merchant.neighborhood,
      address: merchant.address || "",
      location: merchant.location || null,
      distance_km: distanceKm,
      distance_text: distanceText(distanceKm),
      queue_risk: merchant.queue_risk,
      meal_service_type: merchant.meal_service_type,
      reservation_mode: merchant.reservation_mode || "none",
      oil_level: offer.oil_level,
      spice_level: offer.spice_level,
      solo_friendly: Boolean(offer.solo_friendly),
      meal_style: offer.meal_style,
      service_speed: offer.service_speed,
      portion_size: offer.portion_size,
      temperature: offer.temperature,
      satisfaction_level: offer.satisfaction_level,
      signature_items: offer.signature_items || [],
      cuisine_tags: offer.cuisine_tags || [],
      recommended_offer_title: offer.title || "",
      environment: merchant.environment || {},
      environment_note: offer.environment_note,
      decision_tags: offer.decision_tags || [],
      flavor_label: offer.flavor_label || "",
      parking_note: offer.parking_note || "",
      user_feedback: userFeedback.feedback_count ? {
        score: userFeedback.score,
        feedback_count: userFeedback.feedback_count,
        positive_tags: userFeedback.positive_tags,
        negative_tags: userFeedback.negative_tags,
        last_feedback_text: userFeedback.last_feedback_text,
        updated_at: userFeedback.updated_at,
      } : null,
    },
    explanation: scoring.explanation,
    synthetic_only: true,
  };
}

function collapseToMerchantCards(cards) {
  const byMerchant = new Map();
  for (const card of cards) {
    const existing = byMerchant.get(card.merchant_id);
    if (!existing) {
      byMerchant.set(card.merchant_id, {
        ...card,
        alternative_offers: [],
        facts: {
          ...card.facts,
          recommended_items: [card.title].filter(Boolean),
        },
      });
      continue;
    }
    const alternatives = [
      ...(existing.alternative_offers || []),
      {
        offer_id: card.offer_id,
        title: card.title,
        price_per_person: card.facts?.price_per_person || null,
        tags: card.tags || [],
        score: card.score,
      },
    ].sort((left, right) => Number(right.score || 0) - Number(left.score || 0)).slice(0, 4);
    existing.alternative_offers = alternatives;
    existing.facts = {
      ...existing.facts,
      recommended_items: [
        existing.title,
        ...alternatives.map((item) => item.title),
      ].filter(Boolean).slice(0, 5),
    };
  }
  return [...byMerchant.values()];
}

export async function buildFoodOffers({session = {}, body = {}, limit = DEFAULT_OFFER_LIMIT} = {}) {
  const [offers, merchants, directions] = await Promise.all([readOffers(), readMerchants(), readDirections()]);
  const userId = session.user_id || body.user_id || body.userId || "demo_weiyingru";
  const candidateMerchantIds = new Set(normalizeArray(
    body.candidate_merchant_ids ||
    body.candidateMerchantIds ||
    session.candidate_merchant_ids ||
    session.candidateMerchantIds ||
    []
  ));
  const context = {
    understanding: session.understanding || body.understanding || {},
    keptDirections: keptDirectionIds(session, body),
    dislikedDirections: dislikedDirectionIds(session, body),
    merchantFeedback: await readMerchantFeedbackContext({userId}),
  };
  const memoryContext = body.memory_context || body.memoryContext || session.memory_context || null;
  const recommendationSignalContext = await readRecommendationSignalsForScoring({userId, memoryContext});
  context.recommendationSignals = recommendationSignalContext.signals || [];
  const directionContext = {
    kept: [...context.keptDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
    disliked: [...context.dislikedDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
  };
  const cards = [];
  const filteredOffers = [];
  let scannedOfferCount = 0;
  for (const offer of offers) {
    if (candidateMerchantIds.size && !candidateMerchantIds.has(offer.merchant_id)) continue;
    const merchant = merchants.get(offer.merchant_id);
    if (!merchant) continue;
    scannedOfferCount += 1;
    const filterReasons = hardFilterReasons(offer, merchant, context);
    if (filterReasons.length) {
      filteredOffers.push({
        offer_id: offer.offer_id,
        merchant_id: offer.merchant_id,
        reasons: filterReasons,
      });
      continue;
    }
    const scoring = scoreOffer(offer, merchant, context);
    const card = normalizeOfferCard(offer, merchant, scoring, context);
    card.matched_directions = (offer.direction_ids || [])
      .map((id) => directions.get(id))
      .filter(Boolean)
      .map(compactDirection);
    cards.push(card);
  }
  cards.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Number(left.facts.price_per_person || 0) - Number(right.facts.price_per_person || 0);
  });
  const merchantCards = collapseToMerchantCards(cards);
  let topCards = merchantCards.slice(0, Number(limit || DEFAULT_OFFER_LIMIT));
  const aiExplanations = topCards.length
    ? await maybeApplyAiExplanations(topCards, session, body, directionContext)
    : {
      cards: topCards,
      meta: {
        mode: "skipped_empty",
        fallback_used: false,
      },
    };
  topCards = aiExplanations.cards;
  return {
    cards: topCards,
    candidate_count: merchantCards.length,
    raw_offer_count: scannedOfferCount,
    ai_explanations: aiExplanations.meta,
    offer_payload_meta: {
      card_grain: "merchant",
      recommended_offer_policy: "one_best_offer_per_merchant",
      limit: Number(limit || DEFAULT_OFFER_LIMIT),
      filtered_offer_count: filteredOffers.length,
      scored_offer_count: cards.length,
      hard_filter_policy: "filter_before_scoring_no_irrelevant_fill",
      hard_filter_sample: filteredOffers.slice(0, 12),
      recommendation_signals: {
        stored_count: recommendationSignalContext.stored_count || 0,
        derived_count: recommendationSignalContext.derived_count || 0,
        active_count: (recommendationSignalContext.signals || []).length,
        rejected_count: (recommendationSignalContext.rejected || []).length,
      },
      candidate_merchant_ids: [...candidateMerchantIds],
      kept_direction_ids: [...context.keptDirections],
      disliked_direction_ids: [...context.dislikedDirections],
      direction_context: directionContext,
    },
  };
}

function normalizeAiExplanationPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cards)) return new Map();
  const result = new Map();
  for (const item of parsed.cards) {
    if (!item?.offer_id) continue;
    result.set(item.offer_id, {
      matched: Array.isArray(item.matched) ? item.matched.map(String).filter(Boolean).slice(0, 3) : [],
      watchouts: Array.isArray(item.watchouts) ? item.watchouts.map(String).filter(Boolean).slice(0, 2) : [],
      conflicts: Array.isArray(item.conflicts) ? item.conflicts.map(String).filter(Boolean).slice(0, 2) : [],
    });
  }
  return result;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function normalizeAiExplanationPayloadForCards(parsed, cards = []) {
  const byOffer = normalizeAiExplanationPayload(parsed);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cards)) return byOffer;
  const byIndex = new Map();
  parsed.cards.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const key = firstNonEmpty(item.offer_id, item.offerId, item.card_id, item.cardId, item.merchant_id, item.merchantId);
    const target = key
      ? cards.find((card) => [card.offer_id, card.card_id, card.merchant_id].includes(key))
      : cards[index];
    if (!target?.offer_id || byOffer.has(target.offer_id)) return;
    byIndex.set(target.offer_id, {
      matched: Array.isArray(item.matched) ? item.matched.map(String).filter(Boolean).slice(0, 3) : [],
      watchouts: Array.isArray(item.watchouts) ? item.watchouts.map(String).filter(Boolean).slice(0, 2) : [],
      conflicts: Array.isArray(item.conflicts) ? item.conflicts.map(String).filter(Boolean).slice(0, 2) : [],
    });
  });
  for (const [offerId, explanation] of byIndex.entries()) byOffer.set(offerId, explanation);
  return byOffer;
}

function targetOfferIdsFromCards(cards = []) {
  return cards.map((card) => card?.offer_id).filter(Boolean);
}

async function requestAiExplanationBatch(cards, session, body, directionContext, memoryContext, targetCards = cards) {
  const targetOfferIds = targetOfferIdsFromCards(targetCards);
  const ai = await callArkChat({
    timeoutMs: body.offer_ai_timeout_ms || body.offerAiTimeoutMs || 8000,
    maxTokens: Math.max(500, Math.min(1000, 260 + Math.max(1, targetOfferIds.length) * 180)),
    responseFormat: {type: "json_object"},
    messages: [
      {role: "system", content: "你是饭点定了小程序里的小汪，只输出符合要求的 JSON。"},
      {role: "user", content: buildOfferExplanationPrompt({
        goal: session.goal || body.goal || "",
        directionSummary: {
          ...(session.direction_summary || {}),
          ...(body.direction_summary || body.directionSummary || {}),
        },
        understanding: session.understanding || body.understanding || {},
        directionContext,
        memoryContext,
        cards,
        targetOfferIds,
      })},
    ],
  });
  if (!ai.ok) {
    return {
      ok: false,
      reason: ai.error_code,
      status: ai.status || null,
      raw: ai.raw || null,
      usage: null,
      explanations: new Map(),
    };
  }
  const explanations = normalizeAiExplanationPayloadForCards(parseJsonObjectFromText(ai.text), cards);
  const targetExplanations = new Map(
    [...explanations.entries()].filter(([offerId]) => !targetOfferIds.length || targetOfferIds.includes(offerId))
  );
  if (!explanations.size) {
    return {
      ok: false,
      reason: "invalid_ai_json",
      status: null,
      raw: ai.text || null,
      usage: ai.usage || null,
      explanations,
    };
  }
  const expectedCount = targetOfferIds.length || cards.length;
  return {
    ok: targetExplanations.size >= expectedCount,
    reason: targetExplanations.size >= expectedCount ? null : "partial_ai_json",
    status: null,
    raw: null,
    usage: ai.usage || null,
    explanations: targetExplanations,
    explained_count: targetExplanations.size,
  };
}

async function requestAiExplanationForCards(cards, session, body, directionContext, memoryContext, meta, rankContextCards = cards) {
  const explanations = new Map();
  const contextCards = Array.isArray(rankContextCards) && rankContextCards.length ? rankContextCards : cards;
  for (const card of cards) {
    const result = await requestAiExplanationBatch(contextCards, session, body, directionContext, memoryContext, [card]);
    meta.attempts.push({
      card_count: contextCards.length,
      target_count: 1,
      offer_id: card.offer_id,
      depth: 0,
      ok: result.ok,
      reason: result.reason,
      status: result.status,
      raw_text_sample: result.reason === "invalid_ai_json" && result.raw ? String(result.raw).slice(0, 500) : undefined,
    });
    if (result.usage) meta.usage.push(result.usage);
    if (!result.ok) {
      meta.fallback_reasons.push(result.status === 429 ? "provider_429" : result.reason);
    }
    for (const [offerId, explanation] of (result.explanations || new Map()).entries()) {
      explanations.set(offerId, explanation);
    }
  }
  return explanations;
}

function shouldSplitAiBatch(result) {
  return result.status === 429 || ["provider_timeout", "provider_error", "invalid_ai_json", "partial_ai_json"].includes(result.reason);
}

async function explainCardsWithSplitFallback(cards, session, body, directionContext, memoryContext, meta, depth = 0) {
  const result = await requestAiExplanationBatch(cards, session, body, directionContext, memoryContext);
  meta.attempts.push({
    card_count: cards.length,
    depth,
    ok: result.ok,
    reason: result.reason,
    status: result.status,
  });
  if (result.usage) meta.usage.push(result.usage);
  if (result.ok) return result.explanations;
  meta.fallback_reasons.push(result.status === 429 ? "provider_429" : result.reason);

  if (meta.max_attempts && meta.attempts.length >= meta.max_attempts) {
    return result.explanations || new Map();
  }
  if (cards.length <= 1 || !shouldSplitAiBatch(result)) return result.explanations || new Map();

  const midpoint = Math.ceil(cards.length / 2);
  const chunks = [cards.slice(0, midpoint), cards.slice(midpoint)].filter((chunk) => chunk.length);
  const merged = new Map();
  for (const [offerId, explanation] of (result.explanations || new Map()).entries()) {
    merged.set(offerId, explanation);
  }
  for (const chunk of chunks) {
    const missingChunk = chunk.filter((card) => !merged.has(card.offer_id));
    if (!missingChunk.length) continue;
    const partial = await explainCardsWithSplitFallback(missingChunk, session, body, directionContext, memoryContext, meta, depth + 1);
    for (const [offerId, explanation] of partial.entries()) {
      merged.set(offerId, explanation);
    }
  }
  return merged;
}

async function maybeApplyAiExplanations(cards, session, body, directionContext = {kept: [], disliked: []}) {
  const memoryContext = body.memory_context || body.memoryContext || (
    session.memory_context || (session.user_id ? await readRecommendationMemoryContext({
      userId: session.user_id,
      query: [
        session.goal || body.goal,
        session.direction_summary?.summary_text,
        ...(cards || []).slice(0, 8).map((card) => `${card.merchant_name || ""} ${card.title || ""} ${(card.tags || []).join(" ")}`.trim()),
      ].filter(Boolean).join("；"),
    }) : {confirmed_preferences: [], preference_count: 0, evermind_weak_memories: [], evermind_memory_count: 0})
  );
  if (body.ai_explanations === false || body.aiExplanations === false) {
    return {
      cards,
      meta: {
        mode: "disabled",
        fallback_used: false,
        memory_context: {
          confirmed_preferences: memoryContext.preference_count || 0,
          evermind_memories: memoryContext.evermind_memory_count || 0,
          evermind_warning: memoryContext.evermind_warning || "",
          policy: memoryContext.policy || "only_active_confirmed_preferences_are_recommendation_context",
        },
      },
    };
  }
  const startedAt = Date.now();
  const splitMeta = {
    attempts: [],
    fallback_reasons: [],
    usage: [],
    max_attempts: Number(body.offer_ai_max_attempts || body.offerAiMaxAttempts || 0),
  };
  const perCardCount = Number(body.offer_ai_per_card_count || body.offerAiPerCardCount || 0);
  const explanationTargets = perCardCount > 0 ? cards.slice(0, perCardCount) : cards;
  const explanations = await requestAiExplanationForCards(
    explanationTargets,
    session,
    body,
    directionContext,
    memoryContext,
    splitMeta,
    cards
  );
  if (!explanations.size) {
    return {
      cards,
      meta: {
        mode: "local_fallback",
        fallback_used: true,
        fallback_reason: splitMeta.fallback_reasons[0] || "invalid_ai_json",
        total_ms: Date.now() - startedAt,
      attempts: splitMeta.attempts,
      memory_context: {
        confirmed_preferences: memoryContext.preference_count || 0,
        evermind_memories: memoryContext.evermind_memory_count || 0,
        evermind_warning: memoryContext.evermind_warning || "",
        policy: memoryContext.policy || "only_active_confirmed_preferences_are_recommendation_context",
      },
    },
  };
}
  const explainedCount = cards.filter((card) => explanations.has(card.offer_id)).length;
  return {
    cards: cards.map((card) => {
      const explanation = explanations.get(card.offer_id);
      if (!explanation) return card;
      return {
        ...card,
        explanation: {
          matched: explanation.matched.length ? explanation.matched : card.explanation.matched,
          watchouts: explanation.watchouts,
          conflicts: explanation.conflicts,
          unknown: card.explanation.unknown,
        },
        ai_explanation_mode: "ark",
      };
    }),
    meta: {
      mode: "ark",
      fallback_used: explainedCount < cards.length,
      fallback_reason: explainedCount < cards.length ? "partial_ai_explanations" : null,
      strategy: "single_card",
      total_ms: Date.now() - startedAt,
      explained_count: explainedCount,
      requested_count: cards.length,
      attempts: splitMeta.attempts,
      memory_context: {
        confirmed_preferences: memoryContext.preference_count || 0,
        evermind_memories: memoryContext.evermind_memory_count || 0,
        evermind_warning: memoryContext.evermind_warning || "",
        policy: memoryContext.policy || "only_active_confirmed_preferences_are_recommendation_context",
      },
      usage: splitMeta.usage,
    },
  };
}

export async function explainOneOfferCard({session = {}, card = {}, body = {}, directionContext = null} = {}) {
  const keptDirections = keptDirectionIds(session, body);
  const dislikedDirections = dislikedDirectionIds(session, body);
  const directions = await readDirections();
  const resolvedDirectionContext = directionContext || {
    kept: [...keptDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
    disliked: [...dislikedDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
  };
  const memoryContext = body.memory_context || body.memoryContext || session.memory_context || {
    confirmed_preferences: [],
    preference_count: 0,
    evermind_weak_memories: [],
    evermind_memory_count: 0,
  };
  const meta = {attempts: [], fallback_reasons: [], usage: []};
  const rankContextCards = Array.isArray(session.current_cards) && session.current_cards.length
    ? session.current_cards
    : [card];
  const explanations = await requestAiExplanationForCards([card], session, body, resolvedDirectionContext, memoryContext, meta, rankContextCards);
  const explanation = explanations.get(card.offer_id);
  if (!explanation) {
    return {
      card,
      meta: {
        mode: "local_fallback",
        fallback_used: true,
        fallback_reason: meta.fallback_reasons[0] || "invalid_ai_json",
        attempts: meta.attempts,
      },
    };
  }
  return {
    card: {
      ...card,
      explanation: {
        matched: explanation.matched.length ? explanation.matched : card.explanation.matched,
        watchouts: explanation.watchouts,
        conflicts: explanation.conflicts,
        unknown: card.explanation.unknown,
      },
      ai_explanation_mode: "ark",
    },
    meta: {
      mode: "ark",
      fallback_used: false,
      explained_count: 1,
      requested_count: 1,
      strategy: "per_card",
      attempts: meta.attempts,
      usage: meta.usage,
    },
  };
}

export function selectFinalDecision(session = {}) {
  const latestActionByMerchant = new Map();
  for (const event of session.offer_events || []) {
    const merchantId = event.merchant_id || "";
    if (!merchantId) continue;
    latestActionByMerchant.set(merchantId, event.action);
  }
  const keptMerchantIds = new Set([...latestActionByMerchant.entries()]
    .filter(([, action]) => action === "keep")
    .map(([merchantId]) => merchantId));
  const selected = (session.current_cards || []).filter((card) => keptMerchantIds.has(card.merchant_id));
  const primary = selected[0] || null;
  const alternatives = primary ? selected.filter((card) => card.merchant_id !== primary.merchant_id) : [];
  if (!primary) {
    return {
      hasSelection: false,
      primary: null,
      alternatives: [],
      selected_merchants: [],
      ranking_basis: "仅保留用户在商户滑卡阶段右滑的商户；本轮没有右滑保留商户。",
      context_cards: [],
      deal_context: null,
      summary_text: "这轮还没有明确保留的商户。",
    };
  }
  return {
    hasSelection: true,
    primary,
    alternatives,
    selected_merchants: selected,
    ranking_basis: "仅在用户右滑保留的商户中，沿用商户卡阶段的匹配分排序。",
    context_cards: [],
    deal_context: null,
    summary_text: `小汪建议优先看 ${primary.merchant_name}，因为它在你刚刚保留的商户里排序最高，${primary.facts.distance_text}，人均约 ${primary.facts.price_per_person}。真实营业、价格、排队和团购仍建议出发前再确认。`,
  };
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function entryPartySize(session = {}) {
  const constraints = session.understanding?.constraints || {};
  const explicit = numberOrNull(constraints.party_size || session.entry_form?.party_size);
  if (explicit) return explicit;
  const value = String(session.entry_form?.partySize || session.entry_form?.party_size || "").trim();
  if (value === "one") return 1;
  if (value === "two") return 2;
  return null;
}

function entryBudget(session = {}) {
  const constraints = session.understanding?.constraints || {};
  return numberOrNull(
    constraints.budget_per_person_max ||
    session.entry_form?.budget_per_person_max ||
    session.entry_form?.budget
  );
}

async function safeContext(label, fallback, fn) {
  try {
    return await fn();
  } catch (error) {
    return {
      ...fallback,
      ok: false,
      fallback_used: true,
      fallback_reason: error?.message || `${label}_failed`,
    };
  }
}

async function buildDealContextForMerchants({session, merchantIds}) {
  const chunks = [];
  for (let index = 0; index < merchantIds.length; index += 4) {
    chunks.push(merchantIds.slice(index, index + 4));
  }
  const payloads = await Promise.all(chunks.map((ids) => safeContext("deal_context", {
    ok: false,
    merchants: ids.map((merchantId) => ({
      merchant: {merchant_id: merchantId},
      deals: [],
      best_value_hint: null,
      deal_count: 0,
      no_deal_note: "当前种子证据库里暂无这家店的优惠线索；不能据此判断真实平台没有优惠。",
    })),
  }, () => buildDealSearchContext({
    userId: session.user_id || "demo_weiyingru",
    merchantIds: ids,
    sessionId: session.session_id || "",
    question: session.goal || "最终确认页团购线索",
    partySize: entryPartySize(session),
    budget: entryBudget(session),
    mealTime: session.meal_slot || "",
  }))));
  const okPayloads = payloads.filter((payload) => payload && payload.ok);
  return {
    ok: okPayloads.length > 0,
    tool: "deal_search_context",
    merchants: payloads.flatMap((payload) => payload.merchants || []),
    evidence_policy: okPayloads[0]?.evidence_policy || payloads[0]?.evidence_policy || null,
    deal_contract: okPayloads[0]?.deal_contract || payloads[0]?.deal_contract || null,
    fallback_used: payloads.some((payload) => payload.fallback_used || !payload.ok),
    fallback_reason: payloads.find((payload) => payload.fallback_reason)?.fallback_reason || null,
  };
}

function bestDealFromContext(dealContext, merchantId) {
  const merchantContext = (dealContext?.merchants || []).find((item) => item.merchant?.merchant_id === merchantId);
  const bestDeal = merchantContext?.deals?.[0] || null;
  return {
    best_deal: bestDeal,
    deal_count: merchantContext?.deal_count || 0,
    no_deal_note: merchantContext?.no_deal_note || "",
    best_value_hint: merchantContext?.best_value_hint || null,
  };
}

export async function selectFinalDecisionWithContext(session = {}) {
  const result = selectFinalDecision(session);
  if (!result.hasSelection) return result;

  const selected = result.selected_merchants || [result.primary, ...(result.alternatives || [])].filter(Boolean);
  const merchantIds = selected.map((card) => card.merchant_id).filter(Boolean);
  const [weather, dealContext, routeResults] = await Promise.all([
    safeContext("weather", {}, () => weatherPayload({location: session.location})),
    buildDealContextForMerchants({session, merchantIds}),
    Promise.all(selected.map((card) => safeContext("route", {}, () => routePayload({
      origin: session.location,
      location: session.location,
      merchant_id: card.merchant_id,
      destination: {
        merchant_id: card.merchant_id,
        location: card.facts?.location || null,
        distance_km: card.facts?.distance_km || null,
      },
    })))),
  ]);
  const contextByMerchant = new Map(selected.map((card, index) => {
    const queue = queuePayload({
      merchant_id: card.merchant_id,
      queue_risk: card.facts?.queue_risk,
    });
    const deal = bestDealFromContext(dealContext, card.merchant_id);
    return [card.merchant_id, {
      merchant_id: card.merchant_id,
      merchant_name: card.merchant_name,
      weather,
      queue,
      route: routeResults[index],
      ...deal,
    }];
  }));
  const attachContext = (card) => ({
    ...card,
    final_context: contextByMerchant.get(card.merchant_id) || null,
  });
  const primary = attachContext(result.primary);
  const alternatives = (result.alternatives || []).map(attachContext);
  return {
    ...result,
    primary,
    alternatives,
    selected_merchants: [primary, ...alternatives],
    context_cards: [primary, ...alternatives].map((card) => card.final_context).filter(Boolean),
    deal_context: dealContext,
    weather_context: weather,
    summary_text: `小汪建议优先看 ${primary.merchant_name}，这是你右滑保留的商户里综合排序最高的一家。天气、路线、排队和团购线索已经一起放在下面，出发前仍建议再确认真实营业和平台信息。`,
  };
}
