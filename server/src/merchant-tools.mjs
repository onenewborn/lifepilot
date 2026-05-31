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

let cachedMerchants = null;
let cachedOffers = null;

async function readMerchants() {
  if (!cachedMerchants) {
    const rows = JSON.parse(await readFile(MERCHANTS_PATH, "utf8")).merchants || [];
    cachedMerchants = new Map(rows.map((merchant) => [merchant.merchant_id, merchant]));
  }
  return cachedMerchants;
}

async function readOffers() {
  if (!cachedOffers) {
    cachedOffers = JSON.parse(await readFile(OFFERS_PATH, "utf8")).offers || [];
  }
  return cachedOffers;
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
