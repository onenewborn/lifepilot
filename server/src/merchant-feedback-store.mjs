import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";

const SCHEMA_VERSION = "lifepilot.merchant_feedback.v1";
const DEFAULT_USER_ID = "demo_weiyingru";

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || DEFAULT_USER_ID).replace(/[^a-zA-Z0-9_-]/g, "_") || DEFAULT_USER_ID;
}

function rootDir() {
  return path.join(config.storage.runtimeRoot, "merchant_feedback", "users");
}

function feedbackPath(userId) {
  return path.join(rootDir(), safeId(userId), "merchant_feedback.json");
}

async function readStore(userId) {
  const filePath = feedbackPath(userId);
  if (!existsSync(filePath)) {
    return {
      schema_version: SCHEMA_VERSION,
      user_id: safeId(userId),
      feedback_events: [],
      merchant_summaries: {},
      offer_summaries: {},
    };
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeStore(userId, store) {
  const filePath = feedbackPath(userId);
  await mkdir(path.dirname(filePath), {recursive: true});
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
  return store;
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function extractTags(text) {
  const positive = [];
  const negative = [];
  if (includesAny(text, ["好吃", "不错", "满意", "香", "下饭", "喜欢", "还会来", "下次还来"])) positive.push("好吃");
  if (includesAny(text, ["难吃", "不好吃", "踩雷", "失望", "不想再来"])) negative.push("不好吃");
  if (includesAny(text, ["环境好", "舒服", "安静", "适合聊天"])) positive.push("环境舒服");
  if (includesAny(text, ["环境差", "太吵", "很挤", "不干净", "卫生不好", "座位不舒服"])) negative.push("环境一般");
  if (includesAny(text, ["太油", "油腻", "重油", "很油"])) negative.push("偏油");
  if (includesAny(text, ["太辣", "辣过头", "辣到受不了"])) negative.push("偏辣");
  if (includesAny(text, ["排队太久", "等太久", "等位久"])) negative.push("排队久");
  if (includesAny(text, ["便宜", "划算", "性价比高", "值"])) positive.push("性价比不错");
  if (includesAny(text, ["太贵", "不值", "性价比低"])) negative.push("性价比一般");
  return {
    positive_tags: [...new Set(positive)],
    negative_tags: [...new Set(negative)],
  };
}

function scoreFromFeedback({text, rating}) {
  let score = 0;
  const numericRating = Number(rating);
  if (Number.isFinite(numericRating)) {
    if (numericRating >= 4) score += 4;
    if (numericRating <= 2) score -= 5;
  }
  if (includesAny(text, ["好吃", "不错", "满意", "喜欢", "还会来", "下次还来"])) score += 4;
  if (includesAny(text, ["难吃", "不好吃", "踩雷", "失望", "不想再来", "下次别推", "以后别推"])) score -= 6;
  if (includesAny(text, ["环境差", "太吵", "很挤", "不干净", "卫生不好"])) score -= 2;
  if (includesAny(text, ["排队太久", "等太久", "太贵", "不值"])) score -= 2;
  return Math.max(-10, Math.min(10, score));
}

function mergeSummary(previous = {}, event) {
  const score = Number(previous.score || 0) + event.score_delta;
  return {
    score: Math.max(-20, Math.min(20, score)),
    feedback_count: Number(previous.feedback_count || 0) + 1,
    positive_tags: [...new Set([...(previous.positive_tags || []), ...event.positive_tags])].slice(0, 8),
    negative_tags: [...new Set([...(previous.negative_tags || []), ...event.negative_tags])].slice(0, 8),
    last_feedback_text: event.feedback_text,
    last_rating: event.rating,
    last_session_id: event.session_id,
    last_offer_id: event.offer_id,
    updated_at: event.created_at,
  };
}

export async function recordMerchantFeedback({body = {}} = {}) {
  const userId = safeId(body.user_id || body.userId);
  const feedbackText = String(body.feedback_text || body.feedbackText || body.text || "").trim();
  const merchantId = String(body.merchant_id || body.merchantId || "").trim();
  const offerId = String(body.offer_id || body.offerId || "").trim();
  if (!feedbackText || !merchantId) {
    return {
      ok: true,
      created: false,
      skipped: {reason: !feedbackText ? "empty_feedback" : "missing_merchant_id"},
    };
  }
  const tags = extractTags(feedbackText);
  const event = {
    feedback_event_id: `mfb_${Date.now()}_${randomUUID().slice(0, 8)}`,
    user_id: userId,
    session_id: body.session_id || body.sessionId || "",
    merchant_id: merchantId,
    offer_id: offerId,
    merchant_name: body.merchant_name || body.merchantName || "",
    offer_title: body.title || body.offer_title || body.offerTitle || "",
    feedback_text: feedbackText,
    rating: body.rating ?? null,
    score_delta: scoreFromFeedback({text: feedbackText, rating: body.rating}),
    ...tags,
    created_at: nowIso(),
  };
  const store = await readStore(userId);
  store.feedback_events = [...(store.feedback_events || []), event];
  store.merchant_summaries = {
    ...(store.merchant_summaries || {}),
    [merchantId]: mergeSummary(store.merchant_summaries?.[merchantId], event),
  };
  if (offerId) {
    store.offer_summaries = {
      ...(store.offer_summaries || {}),
      [offerId]: mergeSummary(store.offer_summaries?.[offerId], event),
    };
  }
  await writeStore(userId, store);
  return {
    ok: true,
    created: true,
    event,
    merchant_summary: store.merchant_summaries[merchantId],
    offer_summary: offerId ? store.offer_summaries[offerId] : null,
  };
}

export async function readMerchantFeedbackContext({userId} = {}) {
  const store = await readStore(userId || DEFAULT_USER_ID);
  return {
    user_id: safeId(userId),
    merchant_summaries: store.merchant_summaries || {},
    offer_summaries: store.offer_summaries || {},
  };
}
