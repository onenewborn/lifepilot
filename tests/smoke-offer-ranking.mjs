import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const RUNTIME_ROOT = await mkdtemp(path.join(tmpdir(), "lifepilot-offer-ranking-"));
process.env.LIFEPILOT_RUNTIME_ROOT = RUNTIME_ROOT;
process.env.LIFEPILOT_AI_PROVIDER = "local";

const { buildFoodOffers } = await import("../server/src/offer-cards.mjs");
const { writeRecommendationSignals } = await import("../server/src/recommendation-signals.mjs");

function baseSession(patch = {}) {
  return {
    user_id: patch.user_id || "offer_ranking_smoke",
    goal: patch.goal || "今天想吃点合适的",
    understanding: {
      parse_mode: "smoke",
      normalized_goal: patch.normalized_goal || patch.goal || "",
      raw_entry_text: patch.raw_entry_text || patch.goal || "",
      constraints: patch.constraints || {},
      food_preferences: patch.food_preferences || {},
      soft_preferences: patch.soft_preferences || [],
    },
    direction_events: patch.direction_events || [],
    ...patch.session,
  };
}

async function offersFor(session, body = {}) {
  const payload = await buildFoodOffers({
    session,
    body: {
      ai_explanations: false,
      ...body,
    },
    limit: body.limit || 50,
  });
  assert.equal(Array.isArray(payload.cards), true);
  return payload;
}

try {
  const cuisinePayload = await offersFor(baseSession({
    goal: "我想吃川菜",
    normalized_goal: "我想吃川菜",
    raw_entry_text: "我想吃川菜",
    food_preferences: {cuisine_tags: ["川菜"]},
  }), {limit: 20});
  assert.ok(cuisinePayload.cards.length > 0, "川菜硬过滤后仍应有候选");
  for (const card of cuisinePayload.cards) {
    const haystack = [
      ...(card.facts?.cuisine_tags || []),
      ...(card.facts?.decision_tags || []),
      card.title,
      card.display_title,
      card.hook,
    ].join(" ").toLowerCase();
    assert.match(haystack, /sichuan|川菜|四川|chengdu|zigong|yanbang|chongqing/, `${card.merchant_name} 不应混入非川菜候选`);
    assert.ok(card.scoring_features.some((item) => item.key === "cuisine.match"));
  }
  assert.ok(cuisinePayload.offer_payload_meta.filtered_offer_count > 0);

  const budgetPayload = await offersFor(baseSession({
    goal: "人均 50 以内",
    constraints: {budget_per_person_max: 50},
  }));
  assert.ok(budgetPayload.cards.length > 0, "预算过滤后仍应有候选");
  for (const card of budgetPayload.cards) {
    assert.ok(Number(card.facts.price_per_person) <= 50, `${card.merchant_name} 超过预算`);
  }

  const soloPayload = await offersFor(baseSession({
    goal: "今晚一个人吃",
    constraints: {party_size: 1},
  }));
  assert.ok(soloPayload.cards.length > 0, "solo 过滤后仍应有候选");
  for (const card of soloPayload.cards) {
    assert.equal(card.facts.solo_friendly, true, `${card.merchant_name} 不应出现在一个人吃的硬过滤结果中`);
  }

  const noSpicyPayload = await offersFor(baseSession({
    goal: "今天不要辣",
    soft_preferences: [
      {facet: "spice", value: "不要辣", evidence: ["不要辣"]},
    ],
  }));
  assert.ok(noSpicyPayload.cards.length > 0, "不要辣过滤后仍应有候选");
  for (const card of noSpicyPayload.cards) {
    assert.notEqual(card.facts.spice_level, "medium", `${card.merchant_name} 不应出现中辣候选`);
    assert.notEqual(card.facts.spice_level, "high", `${card.merchant_name} 不应出现高辣候选`);
  }

  const dislikedPayload = await offersFor(baseSession({
    goal: "换个方向看看",
  }), {disliked_direction_ids: ["dir_hunan_stir_fry"], limit: 50});
  for (const card of dislikedPayload.cards) {
    assert.equal(card.direction_ids.includes("dir_hunan_stir_fry"), false, `${card.merchant_name} 属于已放弃方向`);
  }

  const signalWrite = await writeRecommendationSignals({
    userId: "offer_ranking_memory_smoke",
    signals: [
      {
        signal_id: "sig_pref_smoke_avoid_high_oil",
        preference_id: "pref_smoke_avoid_high_oil",
        status: "active",
        category: "food_oiliness",
        polarity: "negative",
        confidence: 0.78,
        strength: -0.72,
        target: {
          entity: "offer",
          field: "offer.oil_level",
          operator: "in",
          values: ["high"],
        },
        score_delta: -8,
        reason: "长期记忆：主人不太喜欢明显重油或油腻的餐食。",
      },
    ],
  });
  assert.equal(signalWrite.ok, true);
  const memoryPayload = await offersFor(baseSession({
    user_id: "offer_ranking_memory_smoke",
    goal: "看看这家",
  }), {
    candidate_merchant_ids: ["m_futian_016"],
    limit: 5,
  });
  assert.ok(memoryPayload.cards.length > 0);
  const highOilCard = memoryPayload.cards.find((card) => card.facts.oil_level === "high");
  assert.ok(highOilCard, "测试数据应包含高油候选");
  assert.ok(highOilCard.scoring_features.some((item) => item.source === "memory" && item.score < 0));
  assert.equal(memoryPayload.offer_payload_meta.recommendation_signals.active_count, 1);

  const invalidWrite = await writeRecommendationSignals({
    userId: "offer_ranking_invalid_signal_smoke",
    signals: [
      {
        target: {field: "offer.secret_field", operator: "equals", values: ["x"]},
        score_delta: -5,
      },
    ],
  });
  assert.equal(invalidWrite.ok, false);
  assert.equal(invalidWrite.rejected_count, 1);
} finally {
  await rm(RUNTIME_ROOT, {recursive: true, force: true});
}
