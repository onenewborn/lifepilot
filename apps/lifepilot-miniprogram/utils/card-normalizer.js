const { assetUrl } = require("../config/assets");
const { compactText, joinTags, moneyText } = require("./format");

function normalizeDirectionCard(card = {}, order = 0) {
  const directionId = card.direction_id || card.directionId || card.card_id || `direction_${order}`;
  const imageUrl = assetUrl(card.image_url || card.imageUrl || card.poster_url || card.posterUrl || "");
  const videoUrl = assetUrl(card.video_url || card.videoUrl || "");
  return {
    raw: card,
    order,
    cardType: "direction",
    cardId: card.card_id || card.cardId || directionId,
    directionId,
    title: compactText(card.title, "饭点方向"),
    subtitle: compactText(card.hook || card.description, "小汪会继续帮主人筛具体商家"),
    badge: compactText(card.badge, "深圳福田 · 方向卡"),
    imageUrl,
    posterUrl: assetUrl(card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
    videoUrl,
    hasSound: Boolean(card.has_sound || card.hasSound),
    tags: joinTags([...(card.tags || []), card.budget_band || card.budgetBand], 5),
    fit: joinTags(card.fit || [], 4),
    avoidFor: joinTags(card.avoid_for || card.avoidFor || [], 3)
  };
}

function normalizeOfferCard(card = {}, order = 0) {
  const facts = card.facts || {};
  const explanation = card.explanation || {};
  const imageUrl = assetUrl(card.image_url || card.imageUrl || facts.cover_url || facts.coverUrl || "");
  const videoUrl = assetUrl(card.video_url || card.videoUrl || facts.video_url || facts.videoUrl || "");
  const matched = explanation.matched || card.matched || [];
  const watchouts = explanation.watchouts || card.watchouts || [];
  const conflicts = explanation.conflicts || card.conflicts || [];
  return {
    raw: card,
    order,
    cardType: "offer",
    cardId: card.card_id || card.cardId || card.offer_id || `offer_${order}`,
    offerId: card.offer_id || card.offerId || "",
    merchantId: card.merchant_id || card.merchantId || "",
    title: compactText(card.merchant_name || card.merchantName, "候选商家"),
    dishTitle: compactText(card.title, "小汪推荐吃法"),
    subtitle: compactText(card.hook || card.description || facts.address, "小汪会按刚刚的选择继续收束到这家店"),
    badge: compactText(card.badge, "深圳福田 · 商家卡"),
    imageUrl,
    posterUrl: assetUrl(card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
    videoUrl,
    hasSound: Boolean(card.has_sound || card.hasSound),
    tags: joinTags([
      moneyText(facts.price_per_person),
      facts.distance_text,
      facts.queue_risk ? `排队 ${facts.queue_risk}` : "",
      ...(card.tags || [])
    ], 6),
    facts: [
      facts.address,
      facts.distance_text,
      moneyText(facts.price_per_person),
      facts.queue_risk ? `排队风险 ${facts.queue_risk}` : "",
      facts.service_speed ? `速度 ${facts.service_speed}` : ""
    ].filter(Boolean),
    recommendedItems: joinTags(facts.recommended_items || [], 4),
    matched: joinTags(matched, 3),
    watchouts: joinTags(watchouts, 2),
    conflicts: joinTags(conflicts, 2),
    aiExplanationMode: card.ai_explanation_mode || card.aiExplanationMode || ""
  };
}

function normalizeResult(result = {}) {
  const primary = result.primary || null;
  if (!primary) return { hasSelection: false, primary: null, alternatives: [], summaryText: "这轮还没有明确选择。" };
  const normalizedPrimary = normalizeOfferCard(primary, 0);
  return {
    hasSelection: true,
    primary: normalizedPrimary,
    alternatives: (result.alternatives || []).map(normalizeOfferCard),
    summaryText: result.summary_text || result.summaryText || `小汪建议先去 ${normalizedPrimary.title}。`
  };
}

module.exports = {
  normalizeDirectionCard,
  normalizeOfferCard,
  normalizeResult
};
