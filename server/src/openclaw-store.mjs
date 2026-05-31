import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";
import { getDayContext, getSession, createDayId } from "./session-store.mjs";
import { readUserMemoryContext, createMemoryCandidatesFromOpenClaw } from "./memory-store.mjs";
import { readMerchantFeedbackContext } from "./merchant-feedback-store.mjs";

const DREAM_INPUT_SCHEMA = "lifepilot.openclaw_dream_input.v1";
const DREAM_JOB_SCHEMA = "lifepilot.openclaw_dream_job.v1";

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function jobsRoot() {
  return path.join(config.storage.runtimeRoot, "openclaw_jobs");
}

function jobPath(jobId) {
  return path.join(jobsRoot(), `${safeId(jobId)}.json`);
}

function dreamIndexPath(dreamId) {
  return path.join(jobsRoot(), "dream_index", `${safeId(dreamId)}.json`);
}

function createDreamId(dayId) {
  return `dream_${safeId(dayId || "day")}_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function createJobId() {
  return `dreamjob_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
  return payload;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function compactEvent(event = {}) {
  return {
    event_id: event.event_id || "",
    round: event.round || "",
    action: event.action || "",
    card_id: event.card_id || "",
    direction_id: event.direction_id || "",
    offer_id: event.offer_id || "",
    merchant_id: event.merchant_id || "",
    title: event.title || "",
    created_at: event.created_at || "",
  };
}

function compactSession(session = {}) {
  return {
    session_id: session.session_id,
    user_id: session.user_id,
    day_id: session.day_id,
    meal_slot: session.meal_slot,
    status: session.status,
    stage: session.stage,
    goal: session.goal,
    location: session.location || null,
    entry_form: session.entry_form || {},
    understanding: {
      normalized_goal: session.understanding?.normalized_goal || "",
      raw_entry_text: session.understanding?.raw_entry_text || "",
      dimensions: session.understanding?.dimensions || {},
      hard_constraints: session.understanding?.hard_constraints || [],
      soft_preferences: session.understanding?.soft_preferences || [],
      parse_mode: session.understanding?.parse_mode || "",
    },
    direction_events: (session.direction_events || []).map(compactEvent),
    offer_events: (session.offer_events || []).map(compactEvent),
    direction_summary: session.direction_summary || null,
    final_decision: session.result || null,
    offer_payload_meta: session.offer_payload_meta || null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    finalized_at: session.finalized_at || null,
  };
}

function compactMerchantFeedback(context = {}) {
  const merchantEntries = Object.entries(context.merchant_summaries || {})
    .sort((left, right) => Math.abs(Number(right[1]?.score || 0)) - Math.abs(Number(left[1]?.score || 0)))
    .slice(0, 20)
    .map(([merchantId, summary]) => ({
      merchant_id: merchantId,
      score: summary.score || 0,
      feedback_count: summary.feedback_count || 0,
      positive_tags: summary.positive_tags || [],
      negative_tags: summary.negative_tags || [],
      last_feedback_text: summary.last_feedback_text || "",
      last_session_id: summary.last_session_id || "",
      updated_at: summary.updated_at || "",
    }));
  return {
    user_id: context.user_id || "",
    merchants: merchantEntries,
  };
}

function normalizeDreamResult(body = {}) {
  const memoryCandidates = Array.isArray(body.memory_candidates || body.memoryCandidates)
    ? (body.memory_candidates || body.memoryCandidates)
    : [];
  const ideas = Array.isArray(body.xiaowang_next_interaction_ideas || body.xiaowangNextInteractionIdeas)
    ? (body.xiaowang_next_interaction_ideas || body.xiaowangNextInteractionIdeas)
    : [];
  return {
    dream_id: String(body.dream_id || body.dreamId || "").trim(),
    user_id: String(body.user_id || body.userId || "demo_weiyingru").trim(),
    day_id: String(body.day_id || body.dayId || "").trim(),
    status: String(body.status || "completed").trim(),
    summary: String(body.summary || "").trim(),
    memory_candidates: memoryCandidates.slice(0, 12),
    preference_update_suggestions: Array.isArray(body.preference_update_suggestions || body.preferenceUpdateSuggestions)
      ? (body.preference_update_suggestions || body.preferenceUpdateSuggestions).slice(0, 12)
      : [],
    merchant_feedback_insights: Array.isArray(body.merchant_feedback_insights || body.merchantFeedbackInsights)
      ? (body.merchant_feedback_insights || body.merchantFeedbackInsights).slice(0, 12)
      : [],
    xiaowang_next_interaction_ideas: ideas.slice(0, 12),
    raw_result: body,
  };
}

export async function buildOpenClawDreamInput({userId = "demo_weiyingru", dayId, date} = {}) {
  const resolvedDayId = dayId || createDayId(userId, date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00.000Z` : new Date());
  const [dayContext, memoryContext, merchantFeedback] = await Promise.all([
    getDayContext(resolvedDayId),
    readUserMemoryContext({userId}),
    readMerchantFeedbackContext({userId}),
  ]);
  if (!dayContext) {
    return {ok: false, error: "day_context_not_found", day_id: resolvedDayId};
  }
  const sessions = [];
  for (const item of dayContext.meal_sessions || []) {
    const session = await getSession(item.session_id);
    if (session) sessions.push(compactSession(session));
  }
  return {
    ok: true,
    dream_input: {
      schema_version: DREAM_INPUT_SCHEMA,
      dream_id: createDreamId(resolvedDayId),
      user_id: userId,
      day_id: resolvedDayId,
      window: {
        type: "day",
        date: dayContext.date,
        timezone: dayContext.timezone || "Asia/Shanghai",
      },
      policy: {
        openclaw_role: "semantic_reviewer",
        memory_authority: "lifepilot_backend",
        may_create_confirmed_preferences: false,
        may_modify_meal_session: false,
        may_read_runtime_files: false,
      },
      confirmed_preferences: (memoryContext.preferences || []).filter((item) => item.status === "active"),
      pending_memory_candidates: memoryContext.pending_candidates || [],
      day_context: dayContext,
      meal_sessions: sessions,
      merchant_feedback_summary: compactMerchantFeedback(merchantFeedback),
      xiaowang_interactions: dayContext.xiaowang_chat_sessions || [],
      allowed_outputs: [
        "summary",
        "memory_candidates",
        "preference_update_suggestions",
        "merchant_feedback_insights",
        "xiaowang_next_interaction_ideas",
      ],
      generated_at: nowIso(),
    },
  };
}

export async function storeOpenClawDreamResult({body = {}} = {}) {
  const normalized = normalizeDreamResult(body);
  if (!normalized.dream_id) {
    return {ok: false, error: "missing_dream_id"};
  }
  if (!normalized.day_id) {
    return {ok: false, error: "missing_day_id"};
  }
  const candidateResult = await createMemoryCandidatesFromOpenClaw({
    userId: normalized.user_id,
    dreamId: normalized.dream_id,
    dayId: normalized.day_id,
    candidates: normalized.memory_candidates,
  });
  const job = {
    schema_version: DREAM_JOB_SCHEMA,
    job_id: createJobId(),
    dream_id: normalized.dream_id,
    user_id: normalized.user_id,
    day_id: normalized.day_id,
    status: normalized.status || "completed",
    summary: normalized.summary,
    accepted_memory_candidates: candidateResult.candidates || [],
    rejected_memory_candidates: candidateResult.rejected || [],
    preference_update_suggestions: normalized.preference_update_suggestions,
    merchant_feedback_insights: normalized.merchant_feedback_insights,
    xiaowang_next_interaction_ideas: normalized.xiaowang_next_interaction_ideas,
    raw_result: normalized.raw_result,
    stored_at: nowIso(),
  };
  await writeJsonAtomic(jobPath(job.job_id), job);
  await writeJsonAtomic(dreamIndexPath(job.dream_id), {
    dream_id: job.dream_id,
    job_id: job.job_id,
    user_id: job.user_id,
    day_id: job.day_id,
    stored_at: job.stored_at,
  });
  return {
    ok: true,
    job,
  };
}

export async function getOpenClawJob(jobId) {
  if (!jobId) return null;
  return readJson(jobPath(jobId));
}

export async function getOpenClawJobByDreamId(dreamId) {
  if (!dreamId) return null;
  const index = await readJson(dreamIndexPath(dreamId));
  if (!index?.job_id) return null;
  return getOpenClawJob(index.job_id);
}

export async function getLatestOpenClawJobForDay({userId, dayId} = {}) {
  try {
    const entries = await readdir(jobsRoot());
    const jobs = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const job = await readJson(path.join(jobsRoot(), entry));
      if (!job || job.schema_version !== DREAM_JOB_SCHEMA) continue;
      if (dayId && job.day_id !== dayId) continue;
      if (userId && job.user_id !== userId) continue;
      jobs.push(job);
    }
    return jobs.sort((left, right) => String(right.stored_at || "").localeCompare(String(left.stored_at || "")))[0] || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
