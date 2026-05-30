import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";

const DIRECTIONS_PATH = path.join(REPO_ROOT, "data/synthetic_food_futian/food_directions.json");
const DEFAULT_IMAGE = "/assets/food-directions/hot_soup_noodles.jpg";
const DEFAULT_DIRECTION_LIMIT = 10;

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
  const dimensionText = Object.values(parsed.dimensions || {})
    .filter(Boolean)
    .map((item) => [item.intent, ...(item.evidence || [])].join(" "))
    .join(" ");
  const constraintText = (parsed.hard_constraints || [])
    .map((item) => [item.facet, item.operator, item.value, ...(item.evidence || [])].join(" "))
    .join(" ");
  const preferenceText = (parsed.soft_preferences || [])
    .map((item) => [item.facet, item.value, ...(item.evidence || [])].join(" "))
    .join(" ");
  const goal = parsed.parse_mode === "ark"
    ? [dimensionText, constraintText, preferenceText].filter(Boolean).join(" ")
    : [parsed.normalized_goal, parsed.raw_entry_text, dimensionText, constraintText, preferenceText].filter(Boolean).join(" ");
  const budgetMatch = goal.match(/(?:人均|预算|不超过|以内|以下)?\s*(\d{2,4})/);
  return {
    budgetMax: Number(constraints.budget_per_person_max || budgetMatch?.[1] || 0),
    partySize: Number(constraints.party_size || 0),
    wantsLowOil: hasAny(goal, ["不想太油", "不要太油", "少油", "清淡", "清爽", "低负担", "轻一点", "吃得有点重", "吃太重"]),
    wantsSpicy: hasAny(goal, ["想吃辣", "能吃辣", "重口味", "重口", "麻辣", "香辣", "川菜", "湘菜"]),
    avoidsSpicy: hasAny(goal, ["不吃辣", "不能吃辣", "不要辣", "完全不辣", "别太辣"]),
    wantsChat: hasAny(goal, ["聊天", "慢慢聊", "坐下来", "朋友", "见面", "聚"]),
    wantsEasy: hasAny(goal, ["不想折腾", "省心", "简单", "附近", "近一点", "下班", "累"]),
    wantsSatisfying: hasAny(goal, ["下饭", "满足", "犒劳", "顶饱", "吃饱"]),
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
    if (min && min > rules.budgetMax) conflicts.push("budget");
  }
  if (rules.partySize === 1) {
    const minParty = Number(matchRules.party_size_min || 0);
    if (minParty > 1 || hasAny(avoidText, ["一个人随便吃"])) conflicts.push("party_size");
  }
  if (rules.avoidsSpicy && isSpicyDirection(card)) conflicts.push("spicy");
  return conflicts;
}

function scoreCard(card, rules) {
  const text = directionText(card, false);
  let score = 0;
  if (rules.budgetMax) {
    const max = Number((card.match_rules || {}).budget_max || budgetMaxFromBand(card.budget_band));
    const min = Number((card.match_rules || {}).budget_min || 0);
    if (max && max <= rules.budgetMax) score += 5;
    else if (min && min <= rules.budgetMax) score += 2;
    else if (max) score -= 3;
  }
  if (rules.partySize === 1 && hasAny(text, ["独食", "一个人", "快", "工作餐"])) score += 6;
  if (rules.partySize > 1 && hasAny(text, ["朋友", "聚餐", "聊天", "正餐", "久坐", "环境好"])) score += 5;
  if (rules.wantsLowOil && hasAny(text, ["清爽", "不太油", "不油", "轻", "粉", "粿条", "番茄", "日式"])) score += 10;
  if (rules.wantsLowOil && hasAny(text, ["偏油", "重油", "牛油", "猪脚", "烧腊", "炸", "重口"])) score -= 10;
  if (rules.wantsSpicy && hasAny(text, ["辣", "重口", "川菜", "湘菜", "麻辣", "牛油"])) score += 8;
  if (rules.wantsSpicy && !isSpicyDirection(card)) score -= 3;
  if (rules.wantsChat && hasAny(text, ["聊天", "环境好", "坐", "久坐", "仪式感", "商场", "正餐"])) score += 7;
  if (rules.wantsChat && hasAny(text, ["快餐", "工作餐", "一个人", "独食", "快"])) score -= 4;
  if (rules.wantsEasy && hasAny(text, ["快", "独食", "一个人", "热汤", "简餐"])) score += 5;
  if (rules.wantsSatisfying) {
    const satisfyingWords = rules.wantsLowOil
      ? ["热乎", "热汤", "正餐", "定食", "番茄", "小锅"]
      : ["下饭", "顶饱", "米饭", "正餐", "重口", "麻辣", "热乎"];
    if (hasAny(text, satisfyingWords)) score += 6;
  }
  return score;
}

export function filterFoodDirectionCards(cards, parsed, {limit = DEFAULT_DIRECTION_LIMIT} = {}) {
  const rules = rulesFromParsed(parsed);
  return cards
    .filter((card) => !hardConflicts(card, rules).length)
    .map((card) => ({...card, match_score: scoreCard(card, rules)}))
    .sort((left, right) => {
      if (right.match_score !== left.match_score) return right.match_score - left.match_score;
      return Number(left.rank || 0) - Number(right.rank || 0);
    })
    .slice(0, limit);
}
