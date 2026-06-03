const { assetUrl } = require("../config/assets");
const { videoByDirectionId } = require("../data/video-manifest");
const { compactText, joinTags, moneyText } = require("./format");

const directionVideos = videoByDirectionId();

function versionedAssetUrl(path, version) {
  const url = assetUrl(path);
  if (!url || !version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function uniqueAssetUrls(values = []) {
  const seen = {};
  return values
    .map((value) => assetUrl(value || ""))
    .filter((url) => {
      if (!url || seen[url]) return false;
      seen[url] = true;
      return true;
    });
}

function normalizeVideoSources(card = {}) {
  const rawSources = Array.isArray(card.video_sources)
    ? card.video_sources
    : (Array.isArray(card.videoSources) ? card.videoSources : []);
  const normalized = rawSources.map((source, index) => {
    const url = assetUrl(source.url || source.video_url || source.videoUrl || "");
    if (!url) return null;
    const type = source.type || (source.key === "official" ? "official" : "other");
    return {
      key: source.key || `video_${index + 1}`,
      type,
      label: source.label || (type === "official" ? "官方" : (type === "user_upload" ? "探店" : `视频 ${index + 1}`)),
      url,
      posterUrl: assetUrl(source.poster_url || source.posterUrl || card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
      hasSound: Boolean(source.has_sound || source.hasSound)
    };
  }).filter(Boolean);
  if (normalized.length) {
    return normalized.sort((left, right) => {
      if (left.type === "official" && right.type !== "official") return -1;
      if (right.type === "official" && left.type !== "official") return 1;
      return 0;
    });
  }
  const legacyVideoUrl = assetUrl(card.video_url || card.videoUrl || "");
  if (!legacyVideoUrl) return [];
  return [{
    key: "legacy_video",
    type: "other",
    label: "视频",
    url: legacyVideoUrl,
    posterUrl: assetUrl(card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
    hasSound: Boolean(card.has_sound || card.hasSound)
  }];
}

function normalizeGalleryImages(card = {}, fallbackImageUrl = "") {
  return uniqueAssetUrls([
    ...(Array.isArray(card.image_urls) ? card.image_urls : []),
    ...(Array.isArray(card.imageUrls) ? card.imageUrls : []),
    card.image_url,
    card.imageUrl,
    fallbackImageUrl
  ]);
}

function normalizeDanmaku(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => compactText(line, ""))
    .filter(Boolean)
    .slice(0, 5)
    .map((text, index) => ({
      text: text.length > 18 ? `${text.slice(0, 18)}...` : text,
      row: index % 3,
      duration: 10 + (index % 3) * 2,
      delay: index * 1.4
    }));
}

function plainMoneyText(value) {
  const number = Number(value || 0);
  return number > 0 ? `${number}` : "";
}

function dealPartyText(deal = {}) {
  const min = deal.party_size_min;
  const max = deal.party_size_max;
  if (min && max && min !== max) return `${min}-${max} 人`;
  if (min) return `${min} 人起`;
  if (max) return `${max} 人内`;
  return "";
}

function normalizeDealSummary(deal = null, context = {}) {
  if (!deal) {
    return {
      hasDeal: false,
      title: "",
      priceText: "",
      partyText: "",
      restrictionsText: "",
      sourceText: "",
      confidenceText: "",
      summaryText: context.no_deal_note || "当前种子库暂无优惠线索，不能据此判断真实平台没有优惠。"
    };
  }
  const price = plainMoneyText(deal.deal_price_per_person || deal.deal_price);
  const restrictions = Array.isArray(deal.restrictions) ? deal.restrictions.filter(Boolean).slice(0, 2) : [];
  const source = [deal.source_label || deal.source_type, deal.data_checked_at].filter(Boolean).join(" · ");
  return {
    hasDeal: true,
    title: compactText(deal.title, "团购优惠线索"),
    priceText: price ? `券后约 ${price} / 人` : "",
    partyText: dealPartyText(deal),
    restrictionsText: restrictions.join("；"),
    sourceText: source,
    confidenceText: deal.confidence ? `${Math.round(Number(deal.confidence) * 100)}%` : "",
    summaryText: [
      price ? `券后约 ${price} / 人` : "",
      dealPartyText(deal),
      restrictions[0] || ""
    ].filter(Boolean).join(" · ")
  };
}

function normalizeFinalContext(context = null) {
  if (!context) return null;
  const route = context.route || {};
  const routeRecommended = route.recommended || {};
  const weather = context.weather || {};
  const queue = context.queue || {};
  const deal = normalizeDealSummary(context.best_deal, context);
  return {
    merchantId: context.merchant_id || context.merchantId || "",
    weatherText: compactText(weather.text, "天气以实时信息为准"),
    weatherAffects: Boolean(weather.affects_recommendation),
    weatherFallback: Boolean(weather.fallback_used),
    queueText: compactText(queue.average_queue_wait, "排队需要到店前确认"),
    queueRisk: compactText(queue.queue_risk, ""),
    routeText: compactText([
      routeRecommended.distance_text,
      routeRecommended.eta
    ].filter(Boolean).join(" · "), "路线以真实地图为准"),
    routeFallback: Boolean(route.fallback_used),
    deal,
    dealCount: Number(context.deal_count || 0),
    noDealNote: context.no_deal_note || deal.summaryText || "",
    sourceNotice: "天气、路线、排队和团购均为出发前辅助线索，真实营业与平台信息仍需确认。"
  };
}

function normalizeDirectionCard(card = {}, order = 0) {
  const directionId = card.direction_id || card.directionId || card.card_id || `direction_${order}`;
  const manifestVideo = directionVideos[directionId] || {};
  const imageUrl = assetUrl(card.image_url || card.imageUrl || manifestVideo.posterUrl || card.poster_url || card.posterUrl || "");
  const videoUrl = versionedAssetUrl(manifestVideo.url || card.video_url || card.videoUrl || "", manifestVideo.version);
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
    posterUrl: assetUrl(manifestVideo.posterUrl || card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
    videoUrl,
    hasSound: Boolean(manifestVideo.hasSound || card.has_sound || card.hasSound),
    tags: joinTags([...(card.tags || []), card.budget_band || card.budgetBand], 5),
    fit: joinTags(card.fit || [], 4),
    avoidFor: joinTags(card.avoid_for || card.avoidFor || [], 3)
  };
}

function normalizeOfferCard(card = {}, order = 0) {
  const facts = card.facts || {};
  const explanation = card.explanation || {};
  const imageUrl = assetUrl(card.image_url || card.imageUrl || facts.cover_url || facts.coverUrl || "");
  const videoSources = normalizeVideoSources({
    ...card,
    video_url: card.video_url || card.videoUrl || facts.video_url || facts.videoUrl,
    poster_url: card.poster_url || card.posterUrl || card.image_url || card.imageUrl || facts.cover_url || facts.coverUrl
  });
  const firstVideo = videoSources[0] || null;
  const galleryImages = normalizeGalleryImages(card, imageUrl);
  const danmaku = normalizeDanmaku(card.danmaku || []);
  const matched = explanation.matched || card.matched || [];
  const watchouts = explanation.watchouts || card.watchouts || [];
  const conflicts = explanation.conflicts || card.conflicts || [];
  const tags = joinTags([
    moneyText(facts.price_per_person),
    facts.distance_text,
    facts.queue_risk ? `排队 ${facts.queue_risk}` : "",
    ...(card.tags || [])
  ], 6);
  const storeFacts = [
    facts.address,
    facts.distance_text,
    moneyText(facts.price_per_person),
    facts.queue_risk ? `排队风险 ${facts.queue_risk}` : "",
    facts.service_speed ? `速度 ${facts.service_speed}` : ""
  ].filter(Boolean);
  const issueLines = joinTags(watchouts.length ? watchouts : conflicts, 3);
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
    merchantCoverUrl: assetUrl(card.cover_thumb_url || card.coverThumbUrl || facts.cover_thumb_url || facts.coverThumbUrl || card.image_url || card.imageUrl || ""),
    coverThumbUrl: assetUrl(card.cover_thumb_url || card.coverThumbUrl || facts.cover_thumb_url || facts.coverThumbUrl || card.image_url || card.imageUrl || ""),
    posterUrl: (firstVideo && firstVideo.posterUrl) || assetUrl(card.poster_url || card.posterUrl || card.image_url || card.imageUrl || ""),
    videoUrl: (firstVideo && firstVideo.url) || "",
    videoSources,
    activeVideoIndex: 0,
    currentVideoLabel: (firstVideo && firstVideo.label) || "",
    galleryImages,
    danmaku,
    hasVideoSources: videoSources.length > 0,
    hasGalleryImages: galleryImages.length > 0,
    hasSound: Boolean((firstVideo && firstVideo.hasSound) || card.has_sound || card.hasSound),
    tags,
    displayTags: tags,
    facts: storeFacts,
    storeFacts,
    recommendedItems: joinTags(facts.recommended_items || [], 4),
    matched: joinTags(matched, 3),
    watchouts: joinTags(watchouts, 2),
    conflicts: joinTags(conflicts, 2),
    issueTitle: watchouts.length ? "需要留意" : "可能不合适",
    issueLines,
    hasConflict: Boolean(conflicts.length),
    aiExplanationMode: card.ai_explanation_mode || card.aiExplanationMode || "",
    finalContext: normalizeFinalContext(card.final_context || card.finalContext || null)
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
    selectedMerchants: (result.selected_merchants || result.selectedMerchants || [primary, ...(result.alternatives || [])]).map(normalizeOfferCard),
    rankingBasis: result.ranking_basis || result.rankingBasis || "",
    contextCards: result.context_cards || result.contextCards || [],
    summaryText: result.summary_text || result.summaryText || `小汪建议先去 ${normalizedPrimary.title}。`
  };
}

module.exports = {
  normalizeDirectionCard,
  normalizeOfferCard,
  normalizeResult
};
