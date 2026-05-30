import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";
import { buildOfferExplanationPrompt } from "./ai/prompts.mjs";
import { parseJsonObjectFromText } from "./json-utils.mjs";
import { readRecommendationMemoryContext } from "./memory-store.mjs";
import { readMerchantFeedbackContext } from "./merchant-feedback-store.mjs";

const DATA_ROOT = path.join(REPO_ROOT, "data/synthetic_food_futian");
const DIRECTIONS_PATH = path.join(DATA_ROOT, "food_directions.json");
const OFFERS_PATH = path.join(DATA_ROOT, "offers.json");
const MERCHANTS_PATH = path.join(DATA_ROOT, "merchants.json");
const DEFAULT_OFFER_LIMIT = 10;

let cachedDirections = null;
let cachedOffers = null;
let cachedMerchants = null;

const OIL_RANK = {low: 0, medium: 1, high: 2};
const SPICE_RANK = {none: 0, low: 1, medium: 2, high: 3};
const QUEUE_LABELS = {low: "排队风险低", medium: "饭点可能有一点排队", high: "饭点排队风险高"};

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

function mediaForOffer(offer = {}) {
  const media = offer.media || {};
  const fallbackDirection = media.inherit_from_direction || offer.direction_ids?.[0] || "dir_hot_soup_noodles";
  const fallbackImage = `/assets/food-directions/${fallbackDirection.replace(/^dir_/, "")}.png`;
  return {
    image_url: media.image_url || media.poster_url || fallbackImage,
    video_url: media.video_url || "",
    poster_url: media.poster_url || media.image_url || fallbackImage,
    media_type: media.video_url ? "video" : (media.type || "image"),
    video_sources: media.video_sources || [],
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

function hardConflicts(offer, merchant, context) {
  const reasons = [];
  const constraints = context.understanding?.constraints || {};
  const budgetMax = Number(constraints.budget_per_person_max || 0);
  if (budgetMax && Number(offer.price_per_person) > budgetMax) reasons.push(`人均 ${offer.price_per_person} 超过预算 ${budgetMax}`);
  if (Number(constraints.party_size || 0) === 1 && offer.solo_friendly === false) reasons.push("不适合一个人吃");
  if (hasPreference(context.understanding, "", ["不吃辣", "不能吃辣", "不要辣"]) && SPICE_RANK[offer.spice_level] >= SPICE_RANK.medium) {
    reasons.push("辣度和不吃辣冲突");
  }
  if (context.dislikedDirections.size && offer.direction_ids?.some((id) => context.dislikedDirections.has(id)) && !offer.direction_ids?.some((id) => context.keptDirections.has(id))) {
    reasons.push("属于刚刚放弃的方向");
  }
  return reasons;
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
  let score = 0;
  const matched = [];
  const watchouts = [];
  const conflicts = hardConflicts(offer, merchant, context);
  const understanding = context.understanding || {};
  const distanceKm = distanceKmFromMerchant(merchant);
  const userFeedback = userFeedbackForOffer(offer, merchant, context);

  if (offer.direction_ids?.some((id) => context.keptDirections.has(id))) {
    score += 12;
    matched.push("命中主人刚刚保留的方向");
  }
  if (!context.keptDirections.size) score += 2;

  const budgetMax = Number(understanding.constraints?.budget_per_person_max || 0);
  if (budgetMax) {
    if (Number(offer.price_per_person) <= budgetMax) {
      score += 6;
      matched.push(`人均 ${offer.price_per_person}，符合预算`);
    } else {
      score -= 8;
    }
  }

  if (Number(understanding.constraints?.party_size || 0) === 1 && offer.solo_friendly) {
    score += 5;
    matched.push("适合一个人吃");
  }
  if (Number(understanding.constraints?.party_size || 0) >= 2 && merchant.environment?.chat_friendly) {
    score += 5;
    matched.push("适合两个人坐下来聊");
  }

  if (hasPreference(understanding, "flavor.satisfaction", ["下饭", "满足"])) {
    if (["large", "generous"].includes(offer.portion_size) || ["high", "steady"].includes(offer.satisfaction_level)) {
      score += 5;
      matched.push("更有满足感");
    }
  }
  if (hasPreference(understanding, "health_load", ["清爽", "低负担"])) {
    if (offer.oil_level === "low") {
      score += 6;
      matched.push("油负担低一些");
    } else if (offer.oil_level === "high") {
      score -= 6;
      watchouts.push("这份会偏油");
    }
  }
  if (hasPreference(understanding, "temperature", ["热乎"])) {
    if (offer.temperature === "hot") {
      score += 4;
      matched.push("是热乎的一顿");
    }
  }
  if (hasPreference(understanding, "queue", ["少排队"])) {
    if (merchant.queue_risk === "low") {
      score += 4;
      matched.push("排队风险低");
    } else {
      score -= merchant.queue_risk === "high" ? 5 : 2;
      watchouts.push(QUEUE_LABELS[merchant.queue_risk] || "排队情况需确认");
    }
  }
  if (hasPreference(understanding, "distance", ["附近", "少走路"]) && Number.isFinite(distanceKm)) {
    if (distanceKm <= 0.8) {
      score += 5;
      matched.push(`距离约 ${distanceText(distanceKm)}，很省脚程`);
    } else if (distanceKm <= 1.5) {
      score += 3;
      matched.push(`距离约 ${distanceText(distanceKm)}`);
    } else {
      score -= 2;
      watchouts.push(`距离约 ${distanceText(distanceKm)}，不算最近`);
    }
  }
  if (hasPreference(understanding, "social_friction", ["身上味道", "狼狈", "尴尬"])) {
    if (offer.spice_level === "none" && offer.oil_level !== "high" && merchant.environment?.comfort_level !== "basic") {
      score += 5;
      matched.push("吃相和气味压力小一些");
    } else {
      watchouts.push("可能不够适合低尴尬场景");
    }
  }
  if (hasPreference(understanding, "environment", ["聊天", "舒服", "安静"])) {
    if (merchant.environment?.chat_friendly || merchant.environment?.noise_level === "low") {
      score += 5;
      matched.push("环境更适合坐下来聊");
    } else {
      watchouts.push("环境可能更适合快吃");
    }
  }

  if (conflicts.length) score -= conflicts.length * 8;
  if (merchant.queue_risk === "low") score += 1;
  if (offer.service_speed === "fast") score += 1;
  if (userFeedback.score) {
    score += userFeedback.score;
    if (userFeedback.score > 0) matched.push("主人上次反馈不错");
    if (userFeedback.score < 0) watchouts.push("主人之前对这家有过负反馈");
  }
  if (!matched.length) matched.push(offer.hook || "有基础匹配点");

  return {
    score,
    explanation: {
      matched: [...new Set(matched)].slice(0, 4),
      watchouts: [...new Set(watchouts)].slice(0, 3),
      conflicts: [...new Set(conflicts)].slice(0, 3),
      unknown: ["真实营业状态和价格需要出发前确认"],
    },
  };
}

function normalizeOfferCard(offer, merchant, score, explanation, context = {}) {
  const media = mediaForOffer(offer);
  const distanceKm = distanceKmFromMerchant(merchant);
  const userFeedback = userFeedbackForOffer(offer, merchant, context);
  return {
    card_id: offer.offer_id,
    offer_id: offer.offer_id,
    merchant_id: offer.merchant_id,
    merchant_name: cleanMerchantName(merchant.name),
    direction_ids: offer.direction_ids || [],
    title: offer.title,
    display_title: offer.display_title,
    hook: offer.hook,
    tags: offer.decision_tags || [],
    score,
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
    explanation,
    synthetic_only: true,
  };
}

export async function buildFoodOffers({session = {}, body = {}, limit = DEFAULT_OFFER_LIMIT} = {}) {
  const [offers, merchants, directions] = await Promise.all([readOffers(), readMerchants(), readDirections()]);
  const userId = session.user_id || body.user_id || body.userId || "demo_weiyingru";
  const context = {
    understanding: session.understanding || body.understanding || {},
    keptDirections: keptDirectionIds(session, body),
    dislikedDirections: dislikedDirectionIds(session, body),
    merchantFeedback: await readMerchantFeedbackContext({userId}),
  };
  const directionContext = {
    kept: [...context.keptDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
    disliked: [...context.dislikedDirections].map((id) => compactDirection(directions.get(id) || {direction_id: id})),
  };
  const cards = [];
  for (const offer of offers) {
    const merchant = merchants.get(offer.merchant_id);
    if (!merchant) continue;
    const {score, explanation} = scoreOffer(offer, merchant, context);
    const card = normalizeOfferCard(offer, merchant, score, explanation, context);
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
  let topCards = cards.slice(0, Number(limit || DEFAULT_OFFER_LIMIT));
  const aiExplanations = await maybeApplyAiExplanations(topCards, session, body, directionContext);
  topCards = aiExplanations.cards;
  return {
    cards: topCards,
    candidate_count: cards.length,
    ai_explanations: aiExplanations.meta,
    offer_payload_meta: {
      card_grain: "offer",
      limit: Number(limit || DEFAULT_OFFER_LIMIT),
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

async function requestAiExplanationBatch(cards, session, body, directionContext, memoryContext) {
  const ai = await callArkChat({
    timeoutMs: body.offer_ai_timeout_ms || body.offerAiTimeoutMs || 8000,
    maxTokens: Math.max(500, Math.min(1200, 240 + cards.length * 140)),
    responseFormat: {type: "json_object"},
    messages: [
      {role: "system", content: "你是饭点定了小程序里的小汪，只输出符合要求的 JSON。"},
      {role: "user", content: buildOfferExplanationPrompt({
        goal: session.goal || body.goal || "",
        directionSummary: session.direction_summary || body.direction_summary || {},
        understanding: session.understanding || body.understanding || {},
        directionContext,
        memoryContext,
        cards,
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
  if (!explanations.size) {
    return {
      ok: false,
      reason: "invalid_ai_json",
      status: null,
      raw: null,
      usage: ai.usage || null,
      explanations,
    };
  }
  return {
    ok: explanations.size >= cards.length,
    reason: explanations.size >= cards.length ? null : "partial_ai_json",
    status: null,
    raw: null,
    usage: ai.usage || null,
    explanations,
    explained_count: explanations.size,
  };
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
  const explanations = await explainCardsWithSplitFallback(cards, session, body, directionContext, memoryContext, splitMeta);
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

export function selectFinalDecision(session = {}) {
  const kept = (session.offer_events || []).filter((event) => event.action === "keep").map((event) => event.offer_id).filter(Boolean);
  const disliked = new Set((session.offer_events || []).filter((event) => event.action === "dislike").map((event) => event.offer_id).filter(Boolean));
  const cards = (session.current_cards || []).filter((card) => !disliked.has(card.offer_id));
  const primary = cards.find((card) => kept.includes(card.offer_id)) || cards[0] || null;
  const alternatives = cards.filter((card) => primary && card.offer_id !== primary.offer_id).slice(0, 2);
  if (!primary) return {hasSelection: false, primary: null, alternatives: []};
  return {
    hasSelection: true,
    primary,
    alternatives,
    summary_text: `小汪会推荐 ${primary.merchant_name} · ${primary.title}，因为它和刚刚保留的方向更贴近，${primary.facts.distance_text}，人均约 ${primary.facts.price_per_person}。真实营业、价格和排队仍建议出发前再确认。`,
  };
}
