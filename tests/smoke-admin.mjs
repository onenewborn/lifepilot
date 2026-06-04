import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createApp } from "../server/src/app.mjs";

const dataFiles = [
  "data/synthetic_food_futian/food_directions.json",
  "data/synthetic_food_futian/merchants.json",
  "data/synthetic_food_futian/offers.json",
  "data/synthetic_food_futian/deals.json",
  "data/merchant_reputation/seed.json",
];
const originals = new Map(await Promise.all(dataFiles.map(async (file) => [file, await readFile(file)])));
const server = createApp();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const {port} = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const merchantId = `m_admin_${suffix}`;
const directionId = `dir_admin_${suffix}`;
const offerId = `off_admin_${suffix}`;
const dealId = `deal_admin_${suffix}`;
let uploadedLocalPath = "";

async function request(path, {method = "GET", body} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {"content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return {response, payload};
}

async function expectOk(path, options) {
  const result = await request(path, options);
  assert.equal(result.response.ok, true, JSON.stringify(result.payload));
  assert.notEqual(result.payload.ok, false, JSON.stringify(result.payload));
  return result.payload;
}

async function cleanup() {
  for (const [type, id] of [
    ["deals", dealId],
    ["reputations", merchantId],
    ["offers", offerId],
    ["directions", directionId],
    ["merchants", merchantId],
  ]) {
    await request(`/api/admin/${type}/${encodeURIComponent(id)}`, {method: "DELETE"}).catch(() => {});
  }
  if (uploadedLocalPath) await unlink(uploadedLocalPath).catch(() => {});
}

try {
  await cleanup();
  const initial = await expectOk("/api/admin/catalog");
  assert.ok(Array.isArray(initial.directions));
  assert.ok(Array.isArray(initial.merchants));
  assert.ok(Array.isArray(initial.offers));
  assert.ok(Array.isArray(initial.deals));
  assert.ok(Array.isArray(initial.reputations));
  assert.ok(initial.options.queue_risk.some((item) => item.label === "中" && item.value === "medium"));
  assert.ok(initial.options.video_source_type.some((item) => item.label === "官方视频" && item.value === "official"));
  const adminHtml = await readFile("server/public/admin/merchant-admin.html", "utf8");
  assert.match(adminHtml, /data-upload-repeat/);
  assert.match(adminHtml, /data-upload-append/);
  assert.match(adminHtml, /商家视频列表/);
  assert.match(adminHtml, /商家\/菜品多图/);
  const memoryDebugHtml = await readFile("server/public/admin/memory-debug.html", "utf8");
  assert.match(memoryDebugHtml, /Memory Pipeline 调试面板/);
  assert.match(memoryDebugHtml, /只读调试页/);
  assert.match(memoryDebugHtml, /pipeline_events/);
  assert.doesNotMatch(memoryDebugHtml, /method\s*:\s*["']POST/);
  const memoryDebugResponse = await fetch(`${baseUrl}/admin/memory-debug.html`);
  assert.equal(memoryDebugResponse.ok, true);
  assert.match(await memoryDebugResponse.text(), /Memory Pipeline 调试面板/);
  const memoryPipeline = await expectOk("/api/admin/memory-pipeline?user_id=demo_weiyingru");
  assert.ok(Array.isArray(memoryPipeline.observations));
  assert.ok(Array.isArray(memoryPipeline.memory_intelligence_jobs));
  assert.ok(Array.isArray(memoryPipeline.memory_candidates));
  assert.ok(Array.isArray(memoryPipeline.confirmed_preferences));
  assert.ok(memoryPipeline.food_insight_profile);
  assert.ok(memoryPipeline.provider_status?.local?.configured);
  assert.ok(Array.isArray(memoryPipeline.pipeline_events));
  assert.ok(Array.isArray(memoryPipeline.pipeline_edges));

  await expectOk("/api/admin/merchants", {
    method: "POST",
    body: {
      merchant_id: merchantId,
      name: "后台烟测商家",
      neighborhood: "岗厦北",
      queue_risk: "medium",
      distance_km: 0.8,
      environment: {solo_friendly: "true", chat_friendly: "false", noise_level: "low"},
      specialties: ["烟测菜"],
      media: {
        poster_url: "/assets/offer-media/admin-smoke/poster.jpg",
        video_sources: [
          {key: "official", type: "official", label: "官方视频", url: "/assets/offer-media/admin-smoke/official.mp4", poster_url: "/assets/offer-media/admin-smoke/poster.jpg", has_sound: "true"},
          {key: "user_upload_1", type: "user_upload", label: "用户探店", url: "/assets/offer-media/admin-smoke/user.mp4", poster_url: "/assets/offer-media/admin-smoke/poster.jpg", has_sound: "true"},
        ],
        image_urls: ["/assets/offer-media/admin-smoke/image-1.jpg", "/assets/offer-media/admin-smoke/image-2.jpg"],
        danmaku: ["后台弹幕一", "后台弹幕二"],
      },
    },
  });
  await expectOk("/api/admin/directions", {
    method: "POST",
    body: {
      direction_id: directionId,
      title: "后台烟测方向",
      hook: "用于验证后台 CRUD。",
      tags: ["后台", "烟测"],
      media: {url: "/assets/food-directions/admin-smoke.jpg"},
    },
  });
  await expectOk("/api/admin/offers", {
    method: "POST",
    body: {
      offer_id: offerId,
      merchant_id: merchantId,
      direction_ids: [directionId],
      title: "后台烟测吃法",
      display_title: "后台烟测商家 · 后台烟测吃法",
      price_per_person: 66,
      oil_level: "low",
      spice_level: "none",
      signature_items: ["烟测菜"],
      media: {image_url: "/assets/offer-media/admin-smoke/cover.jpg"},
    },
  });
  await expectOk("/api/admin/deals", {
    method: "POST",
    body: {
      deal_id: dealId,
      merchant_id: merchantId,
      offer_id: offerId,
      platform: "demo_group_buy",
      deal_type: "set_meal",
      title: "后台烟测优惠",
      deal_price: 88,
      original_price: 128,
      party_size_min: 2,
      party_size_max: 2,
      confidence: 0.72,
    },
  });
  await expectOk("/api/admin/reputations", {
    method: "POST",
    body: {
      merchant_id: merchantId,
      merchant_name: "后台烟测商家",
      evidence_confidence: "medium",
      rating: {value: 4.6, scale: 5, source: "admin_smoke"},
      review_stats: {review_count: 100, positive_count: 80, positive_ratio: 0.8, neutral_count: 15, neutral_ratio: 0.15, negative_count: 5, negative_ratio: 0.05},
      reputation_tags: [{tag: "稳定", sentiment: "positive", mention_count: 80, mention_ratio: 0.8}],
    },
  });

  const linkedDelete = await request(`/api/admin/merchants/${encodeURIComponent(merchantId)}`, {method: "DELETE"});
  assert.equal(linkedDelete.response.status, 409);

  const updated = await expectOk(`/api/admin/offers/${encodeURIComponent(offerId)}`, {
    method: "PUT",
    body: {oil_level: "medium", price_per_person: 68},
  });
  assert.equal(updated.offer.oil_level, "medium");
  assert.equal(updated.offer.price_per_person, 68);

  const upload = await expectOk("/api/admin/assets/upload", {
    method: "POST",
    body: {
      filename: "admin-smoke.png",
      data_url: `data:image/png;base64,${Buffer.from("admin smoke").toString("base64")}`,
      asset_kind: "offer_cover",
      slug: merchantId,
    },
  });
  assert.match(upload.asset.path, /^\/assets\/offer-media\//);
  uploadedLocalPath = upload.asset.local_path;
  const assetResponse = await fetch(`${baseUrl}${upload.asset.path}`);
  assert.equal(assetResponse.ok, true);

  const catalog = await expectOk("/api/admin/catalog");
  assert.ok(catalog.deals.some((item) => item.deal_id === dealId && item.merchant_name === "后台烟测商家"));
  assert.ok(catalog.reputations.some((item) => item.merchant_id === merchantId));
  const merchantMedia = catalog.merchants.find((item) => item.merchant_id === merchantId)?.media;
  assert.equal(merchantMedia.video_sources.length, 2);
  assert.equal(merchantMedia.video_sources[0].type, "official");
  assert.equal(merchantMedia.video_sources[1].type, "user_upload");
  assert.deepEqual(merchantMedia.image_urls, ["/assets/offer-media/admin-smoke/image-1.jpg", "/assets/offer-media/admin-smoke/image-2.jpg"]);
  assert.deepEqual(merchantMedia.danmaku, ["后台弹幕一", "后台弹幕二"]);

  await cleanup();
  const finalCatalog = await expectOk("/api/admin/catalog");
  assert.equal(finalCatalog.merchants.some((item) => item.merchant_id === merchantId), false);
  assert.equal(finalCatalog.directions.some((item) => item.direction_id === directionId), false);
  assert.equal(finalCatalog.offers.some((item) => item.offer_id === offerId), false);
  assert.equal(finalCatalog.deals.some((item) => item.deal_id === dealId), false);
  assert.equal(finalCatalog.reputations.some((item) => item.merchant_id === merchantId), false);
  console.log(JSON.stringify({ok: true, suite: "admin_smoke"}));
} finally {
  await cleanup();
  for (const [file, content] of originals) await writeFile(file, content);
  await new Promise((resolve) => server.close(resolve));
}
