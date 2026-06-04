import assert from "node:assert/strict";
import { buildOfferExplanationPrompt } from "../server/src/ai/prompts.mjs";

const cards = [
  {
    offer_id: "offer_top",
    merchant_id: "merchant_top",
    merchant_name: "第一名川菜小馆",
    title: "麻婆豆腐饭",
    score: 31,
    scoring_features: [
      {source: "current_need", key: "cuisine.match", score: 18, reason: "命中想吃的菜系"},
      {source: "current_need", key: "budget.within_max", score: 6, reason: "人均 22，符合预算"},
      {source: "default_tiebreaker", key: "service.fast_baseline", score: 1, reason: "出餐速度快"},
    ],
    facts: {price_per_person: 22, distance_text: "0.7km", cuisine_tags: ["sichuan"]},
  },
  {
    offer_id: "offer_strong",
    merchant_id: "merchant_strong",
    merchant_name: "第二名冒菜",
    title: "一人冒菜碗",
    score: 25,
    scoring_features: [
      {source: "current_need", key: "cuisine.match", score: 18, reason: "命中想吃的菜系"},
      {source: "current_need", key: "health.high_oil", score: -6, reason: "这份会偏油"},
    ],
    facts: {price_per_person: 25, distance_text: "0.9km", cuisine_tags: ["sichuan"], oil_level: "high"},
  },
  {
    offer_id: "offer_viable",
    merchant_id: "merchant_viable",
    merchant_name: "后排备选豆花",
    title: "豆花饭",
    score: 12,
    scoring_features: [
      {source: "current_need", key: "budget.within_max", score: 6, reason: "人均 58，符合预算"},
      {source: "merchant_feedback", key: "feedback.negative", score: -4, reason: "主人之前对这家有过负反馈"},
    ],
    facts: {price_per_person: 58, distance_text: "0.4km", cuisine_tags: ["sichuan"]},
  },
];

const prompt = buildOfferExplanationPrompt({
  goal: "我想吃川菜",
  understanding: {
    constraints: {budget_per_person_max: 80},
    food_preferences: {cuisine_tags: ["川菜"]},
  },
  cards,
});

assert.match(prompt, /rank_position/);
assert.match(prompt, /rank_tier/);
assert.match(prompt, /score_gap_from_top/);
assert.match(prompt, /top_positive_features/);
assert.match(prompt, /top_negative_features/);
assert.match(prompt, /matched\[0\]/);
assert.match(prompt, /top_pick/);
assert.match(prompt, /strong_pick/);
assert.match(prompt, /viable_pick/);

const factsJson = prompt.match(/商家卡事实：([\s\S]+)$/)?.[1];
assert.ok(factsJson, "prompt should include card facts JSON");
const rankedCards = JSON.parse(factsJson);
assert.equal(rankedCards.length, 3);
assert.equal(rankedCards[0].rank_position, 1);
assert.equal(rankedCards[0].rank_tier, "top_pick");
assert.equal(rankedCards[0].score, 31);
assert.equal(rankedCards[0].score_gap_from_top, 0);
assert.equal(rankedCards[1].rank_position, 2);
assert.equal(rankedCards[1].rank_tier, "strong_pick");
assert.equal(rankedCards[1].score_gap_from_top, 6);
assert.equal(rankedCards[2].rank_position, 3);
assert.equal(rankedCards[2].rank_tier, "strong_pick");
assert.equal(rankedCards[2].score_gap_from_top, 19);
assert.deepEqual(rankedCards[0].top_positive_features.map((item) => item.key), [
  "cuisine.match",
  "budget.within_max",
  "service.fast_baseline",
]);
assert.deepEqual(rankedCards[1].top_negative_features.map((item) => item.key), ["health.high_oil"]);
