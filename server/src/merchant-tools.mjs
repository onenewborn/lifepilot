import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import { readMerchantFeedbackContext } from "./merchant-feedback-store.mjs";
import { getMerchantReputation, merchantReputationEvidenceSummary } from "./merchant-reputation-store.mjs";
import { readRecommendationMemoryContext } from "./memory-store.mjs";
import { getSession } from "./session-store.mjs";

const DATA_ROOT = path.join(REPO_ROOT, "data/synthetic_food_futian");
const MERCHANTS_PATH = path.join(DATA_ROOT, "merchants.json");
const OFFERS_PATH = path.join(DATA_ROOT, "offers.json");
const DEALS_PATH = path.join(DATA_ROOT, "deals.json");

let cachedMerchants = null;
let cachedOffers = null;
let cachedDeals = null;

export function resetMerchantToolCache() {
  cachedMerchants = null;
  cachedOffers = null;
  cachedDeals = null;
}

async function readMerchants() {
  if (!cachedMerchants) {
    const rows = JSON.parse(await readFile(MERCHANTS_PATH, "utf8")).merchants || [];
    cachedMerchants = new Map(rows.map((merchant) => [merchant.merchant_id, merchant]));
  }
  return cachedMerchants;
}

export async function resolveMerchantIdsFromText(text = "", {limit = 4} = {}) {
  const value = String(text || "").trim();
  if (!value) return [];
  const merchants = await readMerchants();
  const matches = [];
  for (const merchant of merchants.values()) {
    const name = String(merchant.name || "");
    const compactName = name.replace(/[·・\s]/g, "");
    const shortName = compactName.replace(/(川菜馆|牛肉火锅|粉面云吞|兰州牛肉面|客家菜|潮州菜|顺德菜|烧烤|火锅|小馆|饭堂|扒房|肠粉)$/g, "");
    const aliases = [
      name,
      compactName,
      shortName,
      ...(merchant.specialties || []),
    ].filter((alias) => alias && alias.length >= 2);
    const compactValue = value.replace(/[·・\s]/g, "");
    const matched = aliases.some((alias) => compactValue.includes(alias) || alias.includes(compactValue));
    if (matched) matches.push(merchant.merchant_id);
  }
  return [...new Set(matches)].slice(0, limit);
}

export async function resolveMerchantsFromText(text = "", {limit = 4} = {}) {
  const ids = await resolveMerchantIdsFromText(text, {limit});
  const merchants = await readMerchants();
  return {
    ok: true,
    tool: "merchant_resolve",
    query: String(text || ""),
    merchants: ids.map((merchantId) => {
      const merchant = merchants.get(merchantId) || {};
      return {
        merchant_id: merchantId,
        name: merchant.name || "",
        scene: merchant.scene || "",
        neighborhood: merchant.neighborhood || "",
        specialties: merchant.specialties || [],
      };
    }),
  };
}

async function readOffers() {
  if (!cachedOffers) {
    cachedOffers = JSON.parse(await readFile(OFFERS_PATH, "utf8")).offers || [];
  }
  return cachedOffers;
}

async function readDeals() {
  if (!cachedDeals) {
    cachedDeals = JSON.parse(await readFile(DEALS_PATH, "utf8")).deals || [];
  }
  return cachedDeals;
}

function evidencePolicy() {
  return {
    final_judgment_owner: "openclaw",
    backend_must_not_rank: true,
    backend_must_not_choose_winner: true,
    must_cite_quantitative_evidence: true,
    required_evidence_types: ["rating", "review_distribution", "reputation_tags", "user_feedback"],
    note: "后端只返回证据上下文，最终解释、取舍和口吻由 OpenClaw skill 完成。",
  };
}

function compactMerchant(merchant = {}) {
  return {
    merchant_id: merchant.merchant_id,
    name: merchant.name,
    area: merchant.area,
    neighborhood: merchant.neighborhood,
    scene: merchant.scene,
    address: merchant.address,
    distance_km: merchant.distance_km,
    queue_risk: merchant.queue_risk,
    meal_service_type: merchant.meal_service_type,
    reservation_mode: merchant.reservation_mode,
    environment: merchant.environment || {},
    specialties: merchant.specialties || [],
    source_type: merchant.source_type || "",
    public_sources: merchant.public_sources || [],
  };
}

function compactOffer(offer = {}) {
  return {
    offer_id: offer.offer_id,
    merchant_id: offer.merchant_id,
    title: offer.title,
    display_title: offer.display_title,
    hook: offer.hook,
    price_per_person: offer.price_per_person,
    oil_level: offer.oil_level,
    spice_level: offer.spice_level,
    solo_friendly: offer.solo_friendly,
    signature_items: offer.signature_items || [],
    decision_tags: offer.decision_tags || [],
    avoid_for: offer.avoid_for || [],
    flavor_label: offer.flavor_label || "",
    service_speed: offer.service_speed || "",
    portion_size: offer.portion_size || "",
  };
}

function fallbackOfferImageUrl(offer = {}) {
  const media = offer.media || {};
  const fallbackDirection = media.inherit_from_direction || offer.direction_ids?.[0] || "dir_hot_soup_noodles";
  return `/assets/food-directions/${fallbackDirection.replace(/^dir_/, "")}.png`;
}

function compactDeal(deal = {}, {offer = null, partySize = null} = {}) {
  const dealPrice = numberOrNull(deal.deal_price);
  const originalPrice = numberOrNull(deal.original_price);
  const partyMin = numberOrNull(deal.party_size_min);
  const partyMax = numberOrNull(deal.party_size_max);
  const effectivePartySize = partySize || partyMin || partyMax || 1;
  const dealPerPerson = dealPrice !== null && effectivePartySize ? Math.round((dealPrice / effectivePartySize) * 10) / 10 : null;
  const originalPerPerson = originalPrice !== null && effectivePartySize ? Math.round((originalPrice / effectivePartySize) * 10) / 10 : null;
  const offerPerPerson = numberOrNull(offer?.price_per_person);
  const referencePerPerson = originalPerPerson ?? offerPerPerson;
  const estimatedSavings = referencePerPerson !== null && dealPerPerson !== null
    ? Math.round((referencePerPerson - dealPerPerson) * 10) / 10
    : null;
  const discountRate = originalPrice && dealPrice !== null
    ? Math.round((1 - dealPrice / originalPrice) * 100)
    : null;
  return {
    deal_id: deal.deal_id,
    merchant_id: deal.merchant_id,
    offer_id: deal.offer_id || "",
    platform: deal.platform || "",
    external_shop_name: deal.external_shop_name || "",
    deal_type: deal.deal_type || "",
    title: deal.title || "",
    deal_price: dealPrice,
    original_price: originalPrice,
    deal_price_per_person: dealPerPerson,
    original_price_per_person: originalPerPerson,
    reference_offer_price_per_person: offerPerPerson,
    estimated_savings_per_person: estimatedSavings,
    discount_rate_percent: discountRate,
    party_size_min: partyMin,
    party_size_max: partyMax,
    included_items: deal.included_items || [],
    best_for: deal.best_for || [],
    restrictions: deal.restrictions || [],
    valid_time: deal.valid_time || "",
    source_type: deal.source_type || "",
    source_label: deal.source_label || "",
    source_url: deal.source_url || "",
    data_checked_at: deal.data_checked_at || "",
    confidence: numberOrNull(deal.confidence),
    image_url: offer ? (offer.media?.image_url || offer.media?.poster_url || fallbackOfferImageUrl(offer)) : "",
    poster_url: offer ? (offer.media?.poster_url || offer.media?.image_url || fallbackOfferImageUrl(offer)) : "",
  };
}

async function merchantContext({merchantId, merchant, userId, merchantFeedback, offers}) {
  const reputation = await getMerchantReputation({merchantId});
  return {
    merchant: compactMerchant(merchant),
    offers: offers.filter((offer) => offer.merchant_id === merchantId).slice(0, 6).map(compactOffer),
    merchant_reputation: reputation,
    reputation_summary: reputation ? merchantReputationEvidenceSummary(reputation) : null,
    user_feedback: merchantFeedback.merchant_summaries?.[merchantId] || null,
    user_id: userId,
  };
}

function sessionNeed(session = null) {
  if (!session) return null;
  return {
    session_id: session.session_id,
    stage: session.stage,
    goal: session.goal,
    entry_form: session.entry_form || {},
    parsed: session.parsed || {},
    memory_context: session.memory_context || null,
    current_offer_card: session.current_offer_card || null,
  };
}

function notFound(merchantIds = []) {
  return {
    ok: false,
    error: "merchant_not_found",
    missing_merchant_ids: merchantIds,
  };
}

function dealEvidencePolicy() {
  return {
    final_judgment_owner: "openclaw",
    backend_role: "deal_evidence_retrieval_and_price_math",
    backend_must_not_claim_realtime_platform_access: true,
    backend_must_not_claim_coupon_can_be_redeemed: true,
    source_policy: "第一版只返回 LifePilot 可控种子优惠线索，不代表真实平台实时库存、可领取状态或可核销状态。",
    note: "后端返回优惠证据和价格估算；最终推荐、取舍和提醒由 OpenClaw skill 完成。",
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumberOrNull(value) {
  const number = numberOrNull(value);
  return number !== null && number > 0 ? number : null;
}

function normalizeMerchantIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function scoreDeal({deal, offer = null, partySize = null, budget = null, question = ""}) {
  let score = Math.round((numberOrNull(deal.confidence) ?? 0.5) * 100);
  const reasons = [];
  const caveats = [];
  const partyMin = positiveNumberOrNull(deal.party_size_min);
  const partyMax = positiveNumberOrNull(deal.party_size_max);
  const dealPrice = positiveNumberOrNull(deal.deal_price);
  const effectivePartySize = partySize || partyMin || partyMax || 1;
  const dealPerPerson = dealPrice ? dealPrice / effectivePartySize : null;
  if (partySize && partyMin && partyMax) {
    if (partySize >= partyMin && partySize <= partyMax) {
      score += 28;
      reasons.push(`适合 ${partyMin === partyMax ? partyMin : `${partyMin}-${partyMax}`} 人`);
    } else {
      score -= 35;
      caveats.push(`这条更适合 ${partyMin === partyMax ? partyMin : `${partyMin}-${partyMax}`} 人，当前 ${partySize} 人未必划算`);
    }
  }
  if (budget && dealPerPerson !== null) {
    if (dealPerPerson <= budget) {
      score += 18;
      reasons.push(`券后人均约 ${Math.round(dealPerPerson)} 元，在预算内`);
    } else {
      score -= 20;
      caveats.push(`券后人均约 ${Math.round(dealPerPerson)} 元，超过预算 ${budget} 元`);
    }
  }
  if (/一人|一个人|独食|单人/.test(question) && partyMax === 1) {
    score += 12;
    reasons.push("命中单人/独食场景");
  }
  if (/两人|二人|双人|朋友|约会/.test(question) && partyMin && partyMin <= 2 && partyMax && partyMax >= 2) {
    score += 12;
    reasons.push("命中双人场景");
  }
  if (/便宜|划算|省钱|优惠|团购|券后|预算/.test(question)) {
    score += 8;
    reasons.push("命中省钱/优惠问题");
  }
  if (offer?.price_per_person && dealPerPerson !== null && dealPerPerson < offer.price_per_person) {
    score += Math.min(18, Math.max(4, Math.round(offer.price_per_person - dealPerPerson)));
    reasons.push(`比当前参考人均低约 ${Math.round(offer.price_per_person - dealPerPerson)} 元`);
  }
  return {score, reasons, caveats};
}

const ORDERED_LEVELS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function levelValue(value) {
  return ORDERED_LEVELS[String(value || "").toLowerCase()] ?? null;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function compactText(value) {
  return String(value || "").toLowerCase().replace(/[·・\s_-]/g, "");
}

function levelMatches(actual, rule = {}) {
  const actualValue = levelValue(actual);
  const targetValue = levelValue(rule.target ?? rule.value ?? rule);
  if (actualValue === null || targetValue === null) return false;
  const operator = rule.operator || "eq";
  if (operator === "gte") return actualValue >= targetValue;
  if (operator === "lte") return actualValue <= targetValue;
  return actualValue === targetValue;
}

function withinMaxLevel(actual, maxValue) {
  const actualValue = levelValue(actual);
  const targetValue = levelValue(maxValue);
  return actualValue !== null && targetValue !== null && actualValue <= targetValue;
}

function collectMerchantOffers(offers = []) {
  const byMerchant = new Map();
  for (const offer of offers) {
    const rows = byMerchant.get(offer.merchant_id) || [];
    rows.push(offer);
    byMerchant.set(offer.merchant_id, rows);
  }
  return byMerchant;
}

function scoreCandidate({merchant, offers = [], preferences = {}, query = ""}) {
  const food = preferences.food_preferences || preferences.foodPreferences || {};
  const constraints = preferences.constraints || {};
  const scene = preferences.scene || {};
  const requestedCuisine = normalizeArray(food.cuisine_tags || food.cuisineTags);
  const requestedFlavor = normalizeArray(food.flavor_tags || food.flavorTags);
  const requestedMealStyle = normalizeArray(scene.meal_style || scene.mealStyle || constraints.meal_style || constraints.mealStyle);
  const requestedNeighborhood = normalizeArray(scene.neighborhood || constraints.neighborhood);
  const requestedServiceSpeed = normalizeArray(constraints.service_speed || constraints.serviceSpeed);
  const maxPrice = numberOrNull(constraints.max_price_per_person ?? constraints.maxPricePerPerson);
  const soloFriendly = constraints.solo_friendly ?? constraints.soloFriendly ?? scene.solo_friendly ?? scene.soloFriendly;
  const chatFriendly = constraints.chat_friendly ?? constraints.chatFriendly ?? scene.chat_friendly ?? scene.chatFriendly;
  const queryText = compactText(query);

  let bestOffer = null;
  let bestOfferScore = -Infinity;
  let score = 0;
  const reasons = [];
  const caveats = [];

  if (requestedNeighborhood.length) {
    const matched = requestedNeighborhood.some((item) => compactText(merchant.neighborhood).includes(compactText(item)));
    if (matched) {
      score += 16;
      reasons.push(`区域匹配 ${merchant.neighborhood}`);
    } else {
      caveats.push(`不在指定区域 ${requestedNeighborhood.join("/")}`);
    }
  }

  if (constraints.max_queue_risk || constraints.maxQueueRisk) {
    const maxQueueRisk = constraints.max_queue_risk || constraints.maxQueueRisk;
    if (withinMaxLevel(merchant.queue_risk, maxQueueRisk)) {
      score += 16;
      reasons.push(`排队风险 ${merchant.queue_risk}`);
    } else {
      score -= 12;
      caveats.push(`排队风险 ${merchant.queue_risk}`);
    }
  }

  if (soloFriendly === true) {
    if (merchant.environment?.solo_friendly) {
      score += 10;
      reasons.push("一人友好");
    } else {
      score -= 10;
      caveats.push("不太适合一个人");
    }
  }

  if (chatFriendly === true) {
    if (merchant.environment?.chat_friendly && merchant.environment?.noise_level !== "high") {
      score += 8;
      reasons.push("适合聊天");
    } else {
      caveats.push("聊天环境一般");
    }
  }

  for (const offer of offers) {
    let offerScore = 0;
    const fieldsText = [
      offer.title,
      offer.display_title,
      offer.hook,
      offer.flavor_label,
      ...(offer.cuisine_tags || []),
      ...(offer.decision_tags || []),
      ...(offer.signature_items || []),
      ...(merchant.specialties || []),
      merchant.scene,
      merchant.name,
    ].map(compactText).join(" ");

    for (const tag of [...requestedCuisine, ...requestedFlavor]) {
      if (!tag) continue;
      if (fieldsText.includes(compactText(tag))) offerScore += 14;
    }

    if (food.spice_level || food.spiceLevel) {
      const rule = food.spice_level || food.spiceLevel;
      if (levelMatches(offer.spice_level, rule)) offerScore += 14;
      else offerScore -= 5;
    }

    if (food.oil_level || food.oilLevel) {
      const rule = food.oil_level || food.oilLevel;
      if (levelMatches(offer.oil_level, rule)) offerScore += 12;
      else offerScore -= 6;
    }

    if (food.temperature && offer.temperature === food.temperature) offerScore += 5;
    if (requestedMealStyle.includes(offer.meal_style)) offerScore += 8;
    if (requestedServiceSpeed.includes(offer.service_speed)) offerScore += 8;
    if (maxPrice !== null) offerScore += Number(offer.price_per_person) <= maxPrice ? 10 : -10;
    if (soloFriendly === true) offerScore += offer.solo_friendly ? 6 : -6;
    if (queryText && fieldsText.includes(queryText)) offerScore += 10;

    if (offerScore > bestOfferScore) {
      bestOfferScore = offerScore;
      bestOffer = offer;
    }
  }

  if (bestOffer && bestOfferScore > 0) {
    score += bestOfferScore;
    if (requestedCuisine.length || requestedFlavor.length) reasons.push(`口味/品类命中 ${bestOffer.title}`);
    if (maxPrice !== null && Number(bestOffer.price_per_person) <= maxPrice) reasons.push(`人均约 ${bestOffer.price_per_person}`);
    if (food.spice_level || food.spiceLevel) reasons.push(`辣度 ${bestOffer.spice_level}`);
    if (food.oil_level || food.oilLevel) reasons.push(`油量 ${bestOffer.oil_level}`);
    if (requestedServiceSpeed.includes(bestOffer.service_speed)) reasons.push(`出餐 ${bestOffer.service_speed}`);
  }

  if (!reasons.length && queryText) {
    const merchantText = compactText([
      merchant.name,
      merchant.scene,
      merchant.neighborhood,
      ...(merchant.specialties || []),
    ].join(" "));
    if (merchantText.includes(queryText)) {
      score += 12;
      reasons.push("店名/场景文本命中");
    }
  }

  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 5),
    caveats: [...new Set(caveats)].slice(0, 3),
    bestOffer,
  };
}

export async function searchMerchantCandidates({userId = "demo_weiyingru", query = "", preferences = {}, limit = 4} = {}) {
  const merchants = await readMerchants();
  const offers = await readOffers();
  const offersByMerchant = collectMerchantOffers(offers);
  const scored = [];
  for (const merchant of merchants.values()) {
    const result = scoreCandidate({
      merchant,
      offers: offersByMerchant.get(merchant.merchant_id) || [],
      preferences,
      query,
    });
    if (result.score > 0) {
      scored.push({
        merchant,
        ...result,
      });
    }
  }
  scored.sort((left, right) => right.score - left.score || Number(left.merchant.distance_km || 999) - Number(right.merchant.distance_km || 999));
  const candidates = scored.slice(0, Math.max(1, Number(limit) || 4)).map((item) => ({
    merchant: compactMerchant(item.merchant),
    best_offer: item.bestOffer ? compactOffer(item.bestOffer) : null,
    match_score: item.score,
    match_reasons: item.reasons,
    caveats: item.caveats,
  }));
  return {
    ok: true,
    tool: "merchant_candidate_search",
    user_id: userId,
    query: String(query || ""),
    preferences,
    candidates,
    candidate_count: candidates.length,
    search_contract: {
      natural_language_owner: "openclaw",
      backend_role: "structured_filter_and_evidence_retrieval",
      no_backend_winner: true,
      note: "后端按 OpenClaw 给出的结构化偏好检索候选；最终推荐和解释由 OpenClaw 完成。",
    },
  };
}

export async function buildMerchantIntelContext({userId = "demo_weiyingru", merchantId, sessionId = "", question = ""} = {}) {
  const merchants = await readMerchants();
  const merchant = merchants.get(merchantId);
  if (!merchant) return notFound([merchantId].filter(Boolean));
  const [offers, merchantFeedback, memoryContext, session] = await Promise.all([
    readOffers(),
    readMerchantFeedbackContext({userId}),
    readRecommendationMemoryContext({userId, query: question || merchant.name, includeEvermind: false}),
    sessionId ? getSession(sessionId) : null,
  ]);
  const context = await merchantContext({merchantId, merchant, userId, merchantFeedback, offers});
  return {
    ok: true,
    tool: "merchant_intel_context",
    user_id: userId,
    question,
    evidence_policy: evidencePolicy(),
    current_need: sessionNeed(session),
    user_memory: memoryContext,
    ...context,
  };
}

export async function buildMerchantCompareContext({userId = "demo_weiyingru", merchantIds = [], sessionId = "", question = ""} = {}) {
  const normalizedIds = [...new Set((merchantIds || []).filter(Boolean))].slice(0, 4);
  const merchants = await readMerchants();
  const missing = normalizedIds.filter((merchantId) => !merchants.has(merchantId));
  if (!normalizedIds.length || missing.length) return notFound(missing.length ? missing : normalizedIds);
  const [offers, merchantFeedback, memoryContext, session] = await Promise.all([
    readOffers(),
    readMerchantFeedbackContext({userId}),
    readRecommendationMemoryContext({userId, query: question || normalizedIds.join(" "), includeEvermind: false}),
    sessionId ? getSession(sessionId) : null,
  ]);
  const merchantContexts = await Promise.all(normalizedIds.map((merchantId) => (
    merchantContext({merchantId, merchant: merchants.get(merchantId), userId, merchantFeedback, offers})
  )));
  return {
    ok: true,
    tool: "merchant_compare_context",
    user_id: userId,
    question,
    evidence_policy: evidencePolicy(),
    current_need: sessionNeed(session),
    user_memory: memoryContext,
    merchants: merchantContexts,
    comparison_contract: {
      no_backend_winner: true,
      openclaw_should_compare: ["口味质量", "特色菜命中", "排队/速度", "预算", "用户长期偏好", "当前场景"],
      cite_at_least_one_quantitative_item_per_merchant: true,
    },
  };
}

export async function buildDealSearchContext({
  userId = "demo_weiyingru",
  merchantId = "",
  merchantIds = [],
  merchantNames = [],
  sessionId = "",
  question = "",
  partySize = null,
  budget = null,
  mealTime = "",
  currentMerchantId = "",
} = {}) {
  const resolvedIds = normalizeMerchantIds(merchantIds);
  if (merchantId) resolvedIds.unshift(String(merchantId));
  if (currentMerchantId) resolvedIds.push(String(currentMerchantId));
  const names = normalizeArray(merchantNames);
  if (names.length) {
    const fromNames = await resolveMerchantIdsFromText(names.join(" "), {limit: 4});
    resolvedIds.push(...fromNames);
  }
  if (!resolvedIds.length && question) {
    const fromQuestion = await resolveMerchantIdsFromText(question, {limit: 4});
    resolvedIds.push(...fromQuestion);
  }

  const targetIds = [...new Set(resolvedIds.filter(Boolean))].slice(0, 4);
  if (!targetIds.length) {
    return {
      ok: false,
      error: "merchant_required",
      tool: "deal_search_context",
      question,
      evidence_policy: dealEvidencePolicy(),
      hint: "需要先提供 merchant_id、店名，或在当前商家卡上下文里追问“这家有优惠吗”。",
    };
  }

  const merchants = await readMerchants();
  const missing = targetIds.filter((id) => !merchants.has(id));
  if (missing.length) return notFound(missing);

  const [offers, deals, memoryContext, session] = await Promise.all([
    readOffers(),
    readDeals(),
    readRecommendationMemoryContext({userId, query: question || targetIds.join(" "), includeEvermind: false}),
    sessionId ? getSession(sessionId) : null,
  ]);
  const offerById = new Map(offers.map((offer) => [offer.offer_id, offer]));
  const party = positiveNumberOrNull(partySize);
  const budgetPerPerson = positiveNumberOrNull(budget);
  const merchantContexts = targetIds.map((targetId) => {
    const merchantDeals = deals
      .filter((deal) => deal.merchant_id === targetId)
      .map((deal) => {
        const offer = offerById.get(deal.offer_id);
        const scored = scoreDeal({deal, offer, partySize: party, budget: budgetPerPerson, question});
        return {
          ...compactDeal(deal, {offer, partySize: party}),
          match_score: scored.score,
          match_reasons: scored.reasons,
          caveats: scored.caveats,
        };
      })
      .sort((left, right) => right.match_score - left.match_score || (right.confidence || 0) - (left.confidence || 0));
    const merchantOffers = offers.filter((offer) => offer.merchant_id === targetId).slice(0, 4).map(compactOffer);
    const bestDeal = merchantDeals[0] || null;
    return {
      merchant: compactMerchant(merchants.get(targetId)),
      deals: merchantDeals,
      reference_offers: merchantOffers,
      best_value_hint: bestDeal ? {
        deal_id: bestDeal.deal_id,
        title: bestDeal.title,
        deal_price_per_person: bestDeal.deal_price_per_person,
        estimated_savings_per_person: bestDeal.estimated_savings_per_person,
        confidence: bestDeal.confidence,
        caveats: bestDeal.caveats || [],
      } : null,
      deal_count: merchantDeals.length,
      no_deal_note: merchantDeals.length ? "" : "当前种子证据库里暂无这家店的优惠线索；不能据此判断真实平台没有优惠。",
    };
  });

  return {
    ok: true,
    tool: "deal_search_context",
    user_id: userId,
    question,
    inputs: {
      merchant_ids: targetIds,
      party_size: party,
      budget_per_person: budgetPerPerson,
      meal_time: mealTime || "",
    },
    evidence_policy: dealEvidencePolicy(),
    current_need: sessionNeed(session),
    user_memory: memoryContext,
    merchants: merchantContexts,
    deal_contract: {
      no_realtime_claim: true,
      no_coupon_claiming: true,
      coupon_wallet_is_separate_skill: true,
      openclaw_should_explain: ["券后人均", "适合人数", "限制条件", "来源时间", "置信度"],
    },
  };
}
