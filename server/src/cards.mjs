import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";

const DIRECTIONS_PATH = path.join(REPO_ROOT, "data/synthetic_food_futian/food_directions.json");
const DEFAULT_IMAGE = "/assets/food-directions/hot_soup_noodles.jpg";

let cachedDirections = null;

async function readDirectionsPayload() {
  if (!cachedDirections) {
    cachedDirections = JSON.parse(await readFile(DIRECTIONS_PATH, "utf8"));
  }
  return cachedDirections;
}

function normalizeDirection(direction, index) {
  const media = direction.media || {};
  const directionId = direction.direction_id;
  return {
    card_id: directionId,
    direction_id: directionId,
    service_id: directionId,
    title: direction.title || "",
    subtitle: direction.subtitle || "",
    hook: direction.hook || "",
    budget_band: direction.budget_band || "",
    tags: direction.tags || [],
    fit: direction.fit || [],
    avoid_for: direction.avoid_for || [],
    match_rules: direction.match_rules || {},
    image_url: media.url || DEFAULT_IMAGE,
    video_url: media.video_url || "",
    poster_url: media.poster_url || media.url || DEFAULT_IMAGE,
    video_version: media.video_version || "",
    has_sound: Boolean(media.has_sound),
    media_type: media.video_url ? "video" : (media.type || "image"),
    score: Number(direction.score || 0),
    synthetic: true,
    synthetic_only: true,
    rank: index + 1,
  };
}

export async function buildFoodDirectionCards() {
  const payload = await readDirectionsPayload();
  return (payload.directions || []).map(normalizeDirection);
}

function hasAny(text, keywords) {
  return keywords.some((keyword) => String(text || "").includes(keyword));
}

function budgetMaxFromBand(budgetBand) {
  const numbers = String(budgetBand || "").match(/\d+/g);
  if (!numbers?.length) return 0;
  return Math.max(...numbers.map((value) => Number(value)));
}

function directionText(card, includeAvoid = true) {
  return [
    card.title,
    card.hook,
    card.budget_band,
    ...(card.tags || []),
    ...(card.fit || []),
    ...(includeAvoid ? card.avoid_for || [] : []),
  ].join(" ");
}

export function localParseEntry(entryForm = {}) {
  const rawText = [
    entryForm.raw_query,
    entryForm.rawQuery,
    entryForm.free_text,
    entryForm.freeText,
    entryForm.text,
    entryForm.goal,
  ].filter(Boolean).join(" ");
  const budget = Number(entryForm.budget_per_person_max || entryForm.budget || 0);
  return {
    constraints: {
      area: entryForm.area || "深圳福田",
      meal_time: entryForm.meal_time || entryForm.mealTime || "dinner",
      party_size: Number(entryForm.party_size || entryForm.partySize || 1),
      budget_per_person_max: Number.isFinite(budget) && budget > 0 ? budget : null,
    },
    requirements: rawText ? [{facet: "free_text", text: rawText}] : [],
    normalized_goal: rawText || "今天想在深圳福田找一顿合适的饭。",
    assistant_text: "我先按这些条件给主人筛一轮方向卡。",
    missing_info: [],
    confidence: rawText ? 0.72 : 0.5,
  };
}

function rulesFromParsed(parsed = {}) {
  const constraints = parsed.constraints || {};
  const goal = String(parsed.normalized_goal || "");
  const budgetMatch = goal.match(/(?:人均|预算|不超过|以内|以下)?\s*(\d{2,4})/);
  return {
    budgetMax: Number(constraints.budget_per_person_max || budgetMatch?.[1] || 0),
    partySize: Number(constraints.party_size || 0),
    wantsLowOil: hasAny(goal, ["不想太油", "不要太油", "少油", "清淡", "清爽", "低负担"]),
    wantsSpicy: hasAny(goal, ["想吃辣", "能吃辣", "重口味", "重口", "麻辣", "香辣", "川菜", "湘菜"]),
    avoidsSpicy: hasAny(goal, ["不吃辣", "不能吃辣", "不要辣", "完全不辣", "别太辣"]),
  };
}

function isSpicyDirection(card) {
  const text = directionText(card, false);
  if (hasAny(text, ["清爽锅", "清汤", "番茄", "椰子鸡", "潮汕牛肉"])) return false;
  return hasAny(text, ["麻辣", "香辣", "辣", "川菜", "湘菜", "重口", "牛油", "冒菜", "下饭"]);
}

function hardConflicts(card, rules) {
  const matchRules = card.match_rules || {};
  const positiveText = directionText(card, false);
  const avoidText = (card.avoid_for || []).join(" ");
  const conflicts = [];
  if (rules.budgetMax) {
    const max = Number(matchRules.budget_max || budgetMaxFromBand(card.budget_band));
    const min = Number(matchRules.budget_min || 0);
    if ((max && max > rules.budgetMax) || (min && min > rules.budgetMax)) conflicts.push("budget");
  }
  if (rules.partySize === 1) {
    const minParty = Number(matchRules.party_size_min || 0);
    if (minParty > 1 || hasAny(avoidText, ["一个人随便吃"])) conflicts.push("party_size");
  }
  if (rules.wantsLowOil && hasAny(positiveText, ["偏油", "重油", "牛油", "猪脚", "烧腊", "炸"])) conflicts.push("oil");
  if (rules.avoidsSpicy && isSpicyDirection(card)) conflicts.push("spicy");
  if (rules.wantsSpicy && !isSpicyDirection(card)) conflicts.push("not_spicy_enough");
  return conflicts;
}

function scoreCard(card, rules) {
  const text = directionText(card, false);
  let score = 0;
  if (rules.budgetMax) {
    const max = Number((card.match_rules || {}).budget_max || budgetMaxFromBand(card.budget_band));
    if (max && max <= rules.budgetMax) score += 5;
  }
  if (rules.partySize === 1 && hasAny(text, ["独食", "一个人", "快", "工作餐"])) score += 6;
  if (rules.wantsLowOil && hasAny(text, ["清爽", "不太油", "不油", "轻", "粉", "粿条"])) score += 8;
  if (rules.wantsSpicy && hasAny(text, ["辣", "重口", "川菜", "湘菜", "麻辣", "牛油"])) score += 8;
  return score;
}

export function filterFoodDirectionCards(cards, parsed) {
  const rules = rulesFromParsed(parsed);
  return cards
    .filter((card) => !hardConflicts(card, rules).length)
    .map((card) => ({...card, match_score: scoreCard(card, rules)}))
    .sort((left, right) => {
      if (right.match_score !== left.match_score) return right.match_score - left.match_score;
      return Number(left.rank || 0) - Number(right.rank || 0);
    });
}
