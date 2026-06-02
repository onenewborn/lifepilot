import assert from "node:assert/strict";

const { buildDealSearchContext } = await import("../server/src/merchant-tools.mjs");

const byName = await buildDealSearchContext({
  userId: "smoke_deal_search",
  merchantNames: ["椒香巷川味小馆"],
  question: "这家一个人有没有优惠，怎么吃更划算",
  partySize: 1,
  budget: 35,
});
assert.equal(byName.ok, true);
assert.equal(byName.tool, "deal_search_context");
assert.equal(byName.merchants.length, 1);
assert.equal(byName.merchants[0].merchant.merchant_id, "m_futian_014");
assert.ok(byName.merchants[0].deals.length >= 1);
assert.equal(byName.deal_contract.no_realtime_claim, true);
assert.equal(byName.deal_contract.no_coupon_claiming, true);
assert.ok(byName.merchants[0].deals[0].deal_price_per_person <= 35);

const byId = await buildDealSearchContext({
  userId: "smoke_deal_search",
  merchantId: "m_futian_007",
  question: "三个人想吃热汤鱼，团购划算吗",
  partySize: 3,
});
assert.equal(byId.ok, true);
assert.equal(byId.merchants[0].merchant.name, "鲜潭蒸汽石锅鱼");
assert.ok(byId.merchants[0].deals[0].match_reasons.some((item) => /适合/.test(item)));
assert.equal(byId.merchants[0].deals[0].party_size_min, 3);

const missingMerchant = await buildDealSearchContext({
  userId: "smoke_deal_search",
  question: "附近哪家更便宜一点",
});
assert.equal(missingMerchant.ok, false);
assert.equal(missingMerchant.error, "merchant_required");
assert.equal(missingMerchant.evidence_policy.backend_must_not_claim_realtime_platform_access, true);
