import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { buildFoodOffers, resetFoodOfferCache } from "../server/src/offer-cards.mjs";

const files = {
  directions: "data/synthetic_food_futian/food_directions.json",
  merchants: "data/synthetic_food_futian/merchants.json",
  offers: "data/synthetic_food_futian/offers.json",
};
const originals = new Map(await Promise.all(Object.values(files).map(async (file) => [file, await readFile(file, "utf8")])));
const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const directionId = `dir_media_${suffix}`;
const merchantVideoId = `m_media_video_${suffix}`;
const merchantImageId = `m_media_image_${suffix}`;
const merchantLegacyId = `m_media_legacy_${suffix}`;

async function writeJson(file, payload) {
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function baseMerchant(id, name) {
  return {
    merchant_id: id,
    name,
    area: "深圳福田",
    neighborhood: "烟测商圈",
    scene: "商家媒体烟测。",
    environment: {space_type: "普通堂食店", noise_level: "low", solo_friendly: true, chat_friendly: false, comfort_level: "standard"},
    queue_risk: "low",
    subway_walk_min: 3,
    opening_hours: {weekday: ["10:00", "22:00"], weekend: ["10:00", "22:00"]},
    synthetic: true,
    meal_service_type: "quick_meal",
    reservation_mode: "none",
    address: "深圳市福田区烟测路 1 号",
    distance_km: 0.3,
    specialties: ["烟测菜"],
  };
}

function baseOffer(id, merchantId, title) {
  return {
    offer_id: id,
    merchant_id: merchantId,
    direction_ids: [directionId],
    title,
    display_title: `${title} · 商家媒体烟测`,
    hook: "用于验证商家卡媒体字段。",
    price_per_person: 30,
    oil_level: "low",
    spice_level: "none",
    solo_friendly: true,
    signature_items: ["烟测菜"],
    environment_note: "烟测。",
    avoid_for: [],
    media: {type: "image", image_url: "/assets/offer-media/media-smoke/offer-cover.jpg", poster_url: "", video_url: "", video_sources: []},
    synthetic: true,
    cuisine_tags: ["media_smoke"],
    meal_style: "quick_meal",
    service_speed: "fast",
    portion_size: "normal",
    temperature: "hot",
    satisfaction_level: "steady",
    decision_tags: ["媒体烟测"],
    danmaku: [],
  };
}

try {
  const directions = await readJson(files.directions);
  const merchants = await readJson(files.merchants);
  const offers = await readJson(files.offers);

  directions.directions.push({
    direction_id: directionId,
    title: "商家媒体烟测方向",
    hook: "用于验证商家媒体合并。",
    budget_band: "30-50",
    tags: ["烟测"],
    fit: ["媒体测试"],
    avoid_for: [],
    match_rules: {cuisine_tags: ["media_smoke"]},
    media: {type: "image", url: "/assets/food-directions/media-smoke.png"},
    synthetic: true,
  });

  merchants.merchants.push({
    ...baseMerchant(merchantVideoId, "商家视频烟测"),
    media: {
      poster_url: "/assets/offer-media/media-smoke/merchant-poster.jpg",
      video_sources: [
        {key: "official", type: "official", label: "官方视频", url: "/assets/offer-media/media-smoke/official.mp4", poster_url: "/assets/offer-media/media-smoke/official-poster.jpg", has_sound: true},
        {key: "user_upload_1", type: "user_upload", label: "用户探店", url: "/assets/offer-media/media-smoke/user.mp4", poster_url: "/assets/offer-media/media-smoke/user-poster.jpg", has_sound: true},
      ],
      image_urls: ["/assets/offer-media/media-smoke/merchant-cover.jpg"],
      danmaku: ["官方视频优先", "用户探店也在"],
    },
  });
  merchants.merchants.push({
    ...baseMerchant(merchantImageId, "商家多图烟测"),
    media: {
      poster_url: "",
      video_sources: [],
      image_urls: ["/assets/offer-media/media-smoke/image-1.jpg", "/assets/offer-media/media-smoke/image-2.jpg"],
      danmaku: [],
    },
  });
  merchants.merchants.push(baseMerchant(merchantLegacyId, "旧视频烟测"));

  offers.offers.push(baseOffer(`off_media_video_${suffix}`, merchantVideoId, "商家视频吃法"));
  offers.offers.push(baseOffer(`off_media_image_${suffix}`, merchantImageId, "商家多图吃法"));
  offers.offers.push({
    ...baseOffer(`off_media_legacy_${suffix}`, merchantLegacyId, "旧视频吃法"),
    media: {type: "video", image_url: "/assets/offer-media/media-smoke/legacy-cover.jpg", poster_url: "/assets/offer-media/media-smoke/legacy-poster.jpg", video_url: "/assets/offer-media/media-smoke/legacy.mp4", video_sources: []},
  });

  await writeJson(files.directions, directions);
  await writeJson(files.merchants, merchants);
  await writeJson(files.offers, offers);
  resetFoodOfferCache();

  const payload = await buildFoodOffers({body: {kept_direction_ids: [directionId], ai_explanations: false}, limit: 999});
  const byMerchant = new Map(payload.cards.map((card) => [card.merchant_id, card]));
  const videoCard = byMerchant.get(merchantVideoId);
  const imageCard = byMerchant.get(merchantImageId);
  const legacyCard = byMerchant.get(merchantLegacyId);

  assert.ok(videoCard);
  assert.equal(videoCard.video_sources.length, 2);
  assert.equal(videoCard.video_sources[0].type, "official");
  assert.equal(videoCard.video_sources[1].type, "user_upload");
  assert.equal(videoCard.video_url, "/assets/offer-media/media-smoke/official.mp4");
  assert.deepEqual(videoCard.danmaku.slice(0, 2), ["官方视频优先", "用户探店也在"]);

  assert.ok(imageCard);
  assert.equal(imageCard.video_sources.length, 0);
  assert.equal(imageCard.video_url, "");
  assert.deepEqual(imageCard.image_urls.slice(0, 2), ["/assets/offer-media/media-smoke/image-1.jpg", "/assets/offer-media/media-smoke/image-2.jpg"]);

  assert.ok(legacyCard);
  assert.equal(legacyCard.video_sources.length, 1);
  assert.equal(legacyCard.video_url, "/assets/offer-media/media-smoke/legacy.mp4");

  console.log(JSON.stringify({ok: true, suite: "merchant_media_smoke"}));
} finally {
  for (const [file, content] of originals) await writeFile(file, content, "utf8");
  resetFoodOfferCache();
}
