import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";

const SEED_PATH = path.join(REPO_ROOT, "data/merchant_reputation/seed.json");

let cachedSeed = null;

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function ratingLevel(value) {
  const rating = numberOrNull(value);
  if (rating === null) return "unknown";
  if (rating >= 4.6) return "excellent";
  if (rating >= 4.3) return "strong";
  if (rating >= 4.0) return "steady";
  return "risky";
}

function reviewVolumeLevel(value) {
  const count = numberOrNull(value) || 0;
  if (count >= 2000) return "very_high";
  if (count >= 800) return "high";
  if (count >= 300) return "medium";
  if (count > 0) return "low";
  return "unknown";
}

function negativeRiskLevel(value) {
  const ratio = numberOrNull(value);
  if (ratio === null) return "unknown";
  if (ratio >= 0.12) return "high";
  if (ratio >= 0.08) return "medium";
  return "low";
}

function normalizeTag(tag = {}) {
  const mentionCount = Number(tag.mention_count || tag.mentionCount || 0);
  const mentionRatio = Number(tag.mention_ratio || tag.mentionRatio || 0);
  return {
    tag: String(tag.tag || "").trim(),
    sentiment: tag.sentiment || "neutral",
    mention_count: Number.isFinite(mentionCount) ? mentionCount : 0,
    mention_ratio: Number.isFinite(mentionRatio) ? mentionRatio : 0,
    evidence_text: tag.evidence_text || tag.evidenceText || "",
    source: tag.source || "",
  };
}

export function normalizeMerchantReputation(input = {}) {
  const ratingValue = numberOrNull(input.rating?.value ?? input.rating);
  const reviewStats = input.review_stats || input.reviewStats || {};
  const reviewCount = Number(reviewStats.review_count || reviewStats.reviewCount || 0);
  const negativeRatio = numberOrNull(reviewStats.negative_ratio || reviewStats.negativeRatio);
  return {
    merchant_id: input.merchant_id || input.merchantId || "",
    merchant_name: input.merchant_name || input.merchantName || "",
    source_type: input.source_type || input.sourceType || "unknown",
    evidence_confidence: input.evidence_confidence || input.evidenceConfidence || "unknown",
    rating: {
      value: ratingValue,
      scale: Number(input.rating?.scale || 5),
      source: input.rating?.source || "",
      level: ratingLevel(ratingValue),
    },
    review_stats: {
      review_count: Number.isFinite(reviewCount) ? reviewCount : 0,
      positive_count: Number(reviewStats.positive_count || reviewStats.positiveCount || 0),
      positive_ratio: numberOrNull(reviewStats.positive_ratio || reviewStats.positiveRatio),
      neutral_count: Number(reviewStats.neutral_count || reviewStats.neutralCount || 0),
      neutral_ratio: numberOrNull(reviewStats.neutral_ratio || reviewStats.neutralRatio),
      negative_count: Number(reviewStats.negative_count || reviewStats.negativeCount || 0),
      negative_ratio: negativeRatio,
      source: reviewStats.source || "",
      volume_level: reviewVolumeLevel(reviewCount),
      negative_risk_level: negativeRiskLevel(negativeRatio),
    },
    reputation_tags: Array.isArray(input.reputation_tags || input.reputationTags)
      ? (input.reputation_tags || input.reputationTags).map(normalizeTag).filter((item) => item.tag)
      : [],
    signature_dishes: Array.isArray(input.signature_dishes || input.signatureDishes)
      ? (input.signature_dishes || input.signatureDishes).map((dish) => ({
        name: dish.name || "",
        confidence: numberOrNull(dish.confidence),
        source: dish.source || "",
      })).filter((dish) => dish.name)
      : [],
    scenario_fit: input.scenario_fit || input.scenarioFit || {},
    negative_signals: Array.isArray(input.negative_signals || input.negativeSignals)
      ? (input.negative_signals || input.negativeSignals)
      : [],
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    updated_at: input.updated_at || input.updatedAt || "",
  };
}

async function readSeed() {
  if (cachedSeed) return cachedSeed;
  if (!existsSync(SEED_PATH)) {
    cachedSeed = {schema_version: "lifepilot.merchant_reputation_seed.v1", reputations: []};
    return cachedSeed;
  }
  cachedSeed = JSON.parse(await readFile(SEED_PATH, "utf8"));
  return cachedSeed;
}

export async function listMerchantReputations({merchantIds = []} = {}) {
  const wanted = new Set((merchantIds || []).filter(Boolean));
  const seed = await readSeed();
  return (seed.reputations || [])
    .filter((item) => !wanted.size || wanted.has(item.merchant_id))
    .map(normalizeMerchantReputation);
}

export async function getMerchantReputation({merchantId} = {}) {
  if (!merchantId) return null;
  const [item] = await listMerchantReputations({merchantIds: [merchantId]});
  return item || null;
}

export function merchantReputationEvidenceSummary(reputation = {}) {
  const rating = reputation.rating?.value ? `${reputation.rating.value}/${reputation.rating.scale || 5}` : "暂无评分";
  const reviewCount = reputation.review_stats?.review_count || 0;
  const topTags = (reputation.reputation_tags || [])
    .slice(0, 4)
    .map((tag) => `${tag.tag}(${Math.round((tag.mention_ratio || 0) * 100)}%)`);
  return {
    text: `${rating}，${reviewCount} 条评价量级；高频标签：${topTags.join("、") || "暂无"}`,
    rating_level: reputation.rating?.level || "unknown",
    review_volume_level: reputation.review_stats?.volume_level || "unknown",
    negative_risk_level: reputation.review_stats?.negative_risk_level || "unknown",
  };
}
