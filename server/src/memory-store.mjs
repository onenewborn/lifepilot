import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { evermindConfigStatus, searchEvermindMemories } from "./evermind-memory.mjs";

const SCHEMA_CANDIDATES = "lifepilot.memory_candidates.v1";
const SCHEMA_PREFERENCES = "lifepilot.confirmed_preferences.v1";
const DEFAULT_USER_ID = "demo_weiyingru";
const SENSITIVE_PATTERNS = [
  /\b\d{17}[\dXx]\b/,
  /\b1[3-9]\d{9}\b/,
  /\b\d{16,19}\b/,
];

const FEEDBACK_RULES = [
  {
    id: "oiliness_too_heavy",
    category: "food_oiliness",
    polarity: "negative",
    strength: -0.72,
    confidence: 0.78,
    terms: ["太油", "有点油", "比较油", "偏油", "油腻", "重油", "很油", "油太重"],
    exclude_terms: ["不排斥重油", "并不排斥重油", "不介意重油", "可以接受重油", "能接受重油", "不怕油", "不讨厌油", "不是不喜欢油"],
    statement: "主人不太喜欢明显重油或油腻的餐食。",
    confirmation_text: "以后少推荐明显重油或油腻的餐食。",
  },
  {
    id: "accepts_heavy_oil",
    category: "food_oiliness",
    polarity: "positive",
    strength: 0.46,
    confidence: 0.66,
    terms: ["不排斥重油", "并不排斥重油", "不介意重油", "可以接受重油", "能接受重油", "不怕油", "不讨厌油"],
    statement: "主人并不排斥重油或油香明显的餐食。",
    confirmation_text: "以后不要仅因为重油或油香明显就直接排除候选。",
  },
  {
    id: "queue_too_long",
    category: "queue",
    polarity: "negative",
    strength: -0.68,
    confidence: 0.74,
    terms: ["排队太久", "排队也太久", "排队也久", "等太久", "等也太久", "排很久", "排队久", "等位久", "等位太久"],
    statement: "主人不太能接受饭点排队或等位太久的店。",
    confirmation_text: "以后少推荐饭点排队或等位太久的店。",
  },
  {
    id: "taste_bad",
    category: "taste_quality",
    polarity: "negative",
    strength: -0.64,
    confidence: 0.68,
    terms: ["难吃", "不好吃", "踩雷", "失望", "不好入口"],
    statement: "主人会明确避开体验很差或踩雷感强的餐食。",
    confirmation_text: "以后遇到类似踩雷反馈，要降低这类候选的优先级。",
  },
  {
    id: "too_spicy",
    category: "spice",
    polarity: "negative",
    strength: -0.62,
    confidence: 0.7,
    terms: ["太辣", "辣到受不了", "辣过头", "过辣"],
    statement: "主人不太接受辣度过高的餐食。",
    confirmation_text: "以后少推荐辣度过高的餐食。",
  },
  {
    id: "too_expensive",
    category: "budget",
    polarity: "negative",
    strength: -0.6,
    confidence: 0.68,
    terms: ["太贵", "不值", "性价比低", "价格不值", "贵了"],
    statement: "主人对性价比低或价格明显不值的餐食比较敏感。",
    confirmation_text: "以后少推荐性价比低或价格明显不值的候选。",
  },
  {
    id: "bad_environment",
    category: "ambience",
    polarity: "negative",
    strength: -0.56,
    confidence: 0.64,
    terms: ["太吵", "环境差", "不干净", "脏", "很挤", "座位不舒服", "卫生不好", "环境卫生不好", "不卫生", "卫生一般", "看着不干净"],
    statement: "主人会介意过吵、拥挤或不干净的用餐环境。",
    confirmation_text: "以后少推荐环境过吵、拥挤或不干净的店。",
  },
  {
    id: "not_return_merchant",
    category: "revisit_intent",
    polarity: "negative",
    strength: -0.58,
    confidence: 0.66,
    terms: ["下次可能不来了", "下次不来了", "不会再来", "不想再来", "下次别推", "以后别推"],
    statement: "主人对这次体验有明显不复访倾向。",
    confirmation_text: "以后降低这类体验或该商家的推荐优先级。",
  },
  {
    id: "likes_noodles",
    category: "cuisine",
    polarity: "positive",
    strength: 0.62,
    confidence: 0.68,
    terms: ["喜欢吃面条", "比较喜欢吃面条", "爱吃面条", "喜欢吃面", "多推荐面条", "优先推荐面条"],
    statement: "主人比较喜欢面条类餐食。",
    confirmation_text: "以后可以多推荐面条类餐食。",
  },
];

export function memoryRoot(workspaceRoot = config.storage.runtimeRoot) {
  if (process.env.LIFEPILOT_MEMORY_ROOT) {
    return process.env.LIFEPILOT_MEMORY_ROOT;
  }
  if (existsSync("/memory/users")) {
    return "/memory/users";
  }
  return path.join(workspaceRoot || config.storage.runtimeRoot, "memory", "users");
}

function normalizeUserId(userId) {
  return String(userId || DEFAULT_USER_ID).replace(/[^a-zA-Z0-9_-]/g, "_") || DEFAULT_USER_ID;
}

function nowIso() {
  return new Date().toISOString();
}

function candidateId() {
  return `cand_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function preferenceId() {
  return `pref_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

async function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function ensureMemoryUser({workspaceRoot = config.storage.runtimeRoot, userId} = {}) {
  const safeUserId = normalizeUserId(userId);
  const root = memoryRoot(workspaceRoot);
  const directory = path.join(root, safeUserId);
  await mkdir(directory, {recursive: true});
  const candidatesPath = path.join(directory, "memory_candidates.json");
  const preferencesPath = path.join(directory, "preferences.json");
  if (!existsSync(candidatesPath)) {
    await writeJson(candidatesPath, {
      schema_version: SCHEMA_CANDIDATES,
      user_id: safeUserId,
      candidates: [],
    });
  }
  if (!existsSync(preferencesPath)) {
    await writeJson(preferencesPath, {
      schema_version: SCHEMA_PREFERENCES,
      user_id: safeUserId,
      preferences: [],
    });
  }
  return {userId: safeUserId, root, directory, candidatesPath, preferencesPath};
}

function hasSensitiveText(text) {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function matchedRules(text) {
  return FEEDBACK_RULES.filter((rule) => {
    if ((rule.exclude_terms || []).some((term) => text.includes(term))) return false;
    return rule.terms.some((term) => text.includes(term));
  });
}

function sourceEventFromBody(body, feedbackText) {
  return {
    type: "post_meal_feedback",
    text: feedbackText,
    source: body.source || "miniapp",
    session_id: body.session_id || body.sessionId || "",
    offer_id: body.offer_id || body.offerId || "",
    merchant_id: body.merchant_id || body.merchantId || "",
    merchant_name: body.merchant_name || body.merchantName || "",
    title: body.title || body.offer_title || body.offerTitle || "",
    rating: body.rating ?? null,
    occurred_at: body.occurred_at || body.occurredAt || nowIso(),
  };
}

function candidateFromRule({rule, body, userId, feedbackText}) {
  const createdAt = nowIso();
  return {
    candidate_id: candidateId(),
    schema_version: "lifepilot.memory_candidate.v1",
    user_id: userId,
    status: "pending",
    kind: "post_meal_feedback",
    created_at: createdAt,
    updated_at: createdAt,
    category: rule.category,
    polarity: rule.polarity,
    strength: rule.strength,
    confidence: rule.confidence,
    statement: rule.statement,
    confirmation_text: rule.confirmation_text,
    evidence: [feedbackText],
    extraction: {
      method: "deterministic_rules",
      rule_id: rule.id,
      ai_used: false,
    },
    source_event: sourceEventFromBody(body, feedbackText),
    safety: {
      writes_confirmed_preference: false,
      requires_user_confirmation: true,
      sensitive_text_rejected: false,
    },
  };
}

function defaultPreferenceStore(userId) {
  return {
    schema_version: SCHEMA_PREFERENCES,
    user_id: userId,
    preferences: [],
  };
}

function normalizePreferencePatch(input = {}) {
  const patch = {};
  if (input.category !== undefined) patch.category = String(input.category || "").trim();
  if (input.polarity !== undefined) patch.polarity = String(input.polarity || "").trim();
  if (input.scope !== undefined) patch.scope = String(input.scope || "").trim();
  if (input.statement !== undefined) patch.statement = String(input.statement || "").trim();
  if (input.confirmation_text !== undefined || input.confirmationText !== undefined) {
    patch.confirmation_text = String(input.confirmation_text || input.confirmationText || "").trim();
  }
  if (input.strength !== undefined) patch.strength = Number(input.strength);
  if (input.confidence !== undefined) patch.confidence = Number(input.confidence);
  if (Array.isArray(input.evidence)) patch.evidence = input.evidence.map((item) => String(item || "").trim()).filter(Boolean);
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== "" && !(typeof value === "number" && Number.isNaN(value)))
  );
}

function preferenceFromCandidate({candidate, userId, actor = "user", method = "candidate_confirm"}) {
  const createdAt = nowIso();
  return {
    preference_id: preferenceId(),
    schema_version: "lifepilot.confirmed_preference.v1",
    user_id: userId,
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
    category: candidate.category || "general",
    polarity: candidate.polarity || "neutral",
    scope: candidate.scope || "food",
    strength: Number(candidate.strength ?? 0),
    confidence: Number(candidate.confidence ?? 0.6),
    statement: candidate.confirmation_text || candidate.statement || "",
    original_statement: candidate.statement || "",
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence : [],
    source_candidate_id: candidate.candidate_id,
    source_event: candidate.source_event || {},
    confirmation: {
      confirmed_at: createdAt,
      actor,
      method,
    },
    sync: {
      provider: "local",
      evermind_memory_id: null,
      sync_status: "not_synced",
      last_synced_at: null,
      replacement: null,
    },
    safety: {
      user_confirmed: true,
      sensitive_text_rejected: false,
    },
  };
}

function preferenceFromBody({body, userId}) {
  const createdAt = nowIso();
  const evidence = Array.isArray(body.evidence)
    ? body.evidence.map((item) => String(item || "").trim()).filter(Boolean)
    : [body.evidence || body.text || body.statement].map((item) => String(item || "").trim()).filter(Boolean);
  const statement = String(body.statement || body.confirmation_text || body.confirmationText || "").trim();
  return {
    preference_id: preferenceId(),
    schema_version: "lifepilot.confirmed_preference.v1",
    user_id: userId,
    status: "active",
    created_at: createdAt,
    updated_at: createdAt,
    category: String(body.category || "general").trim(),
    polarity: String(body.polarity || "neutral").trim(),
    scope: String(body.scope || "food").trim(),
    strength: Number(body.strength ?? 0),
    confidence: Number(body.confidence ?? 0.7),
    statement,
    original_statement: statement,
    evidence,
    source_candidate_id: body.source_candidate_id || body.sourceCandidateId || "",
    source_event: body.source_event || body.sourceEvent || {},
    confirmation: {
      confirmed_at: createdAt,
      actor: body.actor || "user",
      method: body.method || "manual_create",
    },
    sync: {
      provider: "local",
      evermind_memory_id: body.evermind_memory_id || body.evermindMemoryId || null,
      sync_status: body.sync_status || body.syncStatus || "not_synced",
      last_synced_at: body.last_synced_at || body.lastSyncedAt || null,
      replacement: null,
    },
    safety: {
      user_confirmed: true,
      sensitive_text_rejected: false,
    },
  };
}

export async function createPostMealMemoryCandidates({workspaceRoot = config.storage.runtimeRoot, body}) {
  const feedbackText = String(body.feedback_text || body.feedbackText || body.text || "").trim();
  const {userId, candidatesPath, root} = await ensureMemoryUser({
    workspaceRoot,
    userId: body.user_id || body.userId,
  });
  if (!feedbackText) {
    return {
      ok: true,
      user_id: userId,
      memory_root: root,
      created_count: 0,
      candidates: [],
      skipped: {reason: "empty_feedback"},
    };
  }
  if (hasSensitiveText(feedbackText)) {
    return {
      ok: true,
      user_id: userId,
      memory_root: root,
      created_count: 0,
      candidates: [],
      skipped: {reason: "sensitive_text"},
    };
  }
  const rules = matchedRules(feedbackText);
  if (!rules.length) {
    return {
      ok: true,
      user_id: userId,
      memory_root: root,
      created_count: 0,
      candidates: [],
      skipped: {reason: "no_memory_candidate_rule_matched"},
    };
  }
  const store = await readJsonIfExists(candidatesPath, {
    schema_version: SCHEMA_CANDIDATES,
    user_id: userId,
    candidates: [],
  });
  const candidates = rules.map((rule) => candidateFromRule({rule, body, userId, feedbackText}));
  store.candidates = [...(store.candidates || []), ...candidates];
  await writeJson(candidatesPath, store);
  return {
    ok: true,
    user_id: userId,
    memory_root: root,
    created_count: candidates.length,
    candidates,
  };
}

export async function createMemoryCandidatesFromOpenClaw({workspaceRoot = config.storage.runtimeRoot, userId, dreamId, dayId, candidates = []} = {}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const cleanCandidates = Array.isArray(candidates) ? candidates : [];
  if (!cleanCandidates.length) {
    return {
      ok: true,
      user_id: user.userId,
      memory_root: user.root,
      created_count: 0,
      candidates: [],
    };
  }

  const accepted = [];
  const rejected = [];
  for (const item of cleanCandidates.slice(0, 12)) {
    const statement = String(item?.statement || item?.confirmation_text || item?.confirmationText || "").trim();
    const evidence = Array.isArray(item?.evidence) ? item.evidence : [];
    const confidence = Number(item?.confidence ?? 0);
    if (!statement) {
      rejected.push({reason: "missing_statement", candidate: item});
      continue;
    }
    if (!evidence.length) {
      rejected.push({reason: "missing_evidence", statement});
      continue;
    }
    if (!Number.isFinite(confidence) || confidence < 0.75) {
      rejected.push({reason: "low_confidence", statement, confidence});
      continue;
    }
    if (hasSensitiveText(`${statement} ${JSON.stringify(evidence)}`)) {
      rejected.push({reason: "sensitive_text_rejected", statement});
      continue;
    }
    accepted.push({
      candidate_id: candidateId(),
      schema_version: "lifepilot.memory_candidate.v1",
      user_id: user.userId,
      source: "openclaw_dream",
      source_event: {
        type: "openclaw_dream",
        dream_id: dreamId || "",
        day_id: dayId || "",
      },
      type: item.type || "food_preference",
      category: String(item.category || "general").trim() || "general",
      polarity: String(item.polarity || "neutral").trim() || "neutral",
      scope: String(item.scope || "food").trim() || "food",
      strength: Number(item.strength ?? 0),
      confidence,
      statement,
      confirmation_text: String(item.confirmation_text || item.confirmationText || statement).trim(),
      evidence,
      status: "pending",
      needs_confirmation: item.needs_confirmation !== false,
      created_at: nowIso(),
      updated_at: nowIso(),
      safety: {
        sensitive_text_rejected: false,
        writes_confirmed_preference: false,
        requires_user_confirmation: true,
      },
    });
  }

  if (accepted.length) {
    const store = await readJsonIfExists(user.candidatesPath, {
      schema_version: SCHEMA_CANDIDATES,
      user_id: user.userId,
      candidates: [],
    });
    store.candidates = [...(store.candidates || []), ...accepted];
    await writeJson(user.candidatesPath, store);
  }

  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    created_count: accepted.length,
    candidates: accepted,
    rejected,
  };
}

export async function listMemoryCandidates({workspaceRoot = config.storage.runtimeRoot, userId, status}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.candidatesPath, {
    schema_version: SCHEMA_CANDIDATES,
    user_id: user.userId,
    candidates: [],
  });
  const candidates = (store.candidates || []).filter((candidate) => (
    status ? candidate.status === status : true
  ));
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    candidates,
    count: candidates.length,
  };
}

export async function createConfirmedPreference({workspaceRoot = config.storage.runtimeRoot, userId, body = {}}) {
  const user = await ensureMemoryUser({workspaceRoot, userId: userId || body.user_id || body.userId});
  const statement = String(body.statement || body.confirmation_text || body.confirmationText || "").trim();
  const evidenceText = Array.isArray(body.evidence) ? body.evidence.join(" ") : String(body.evidence || body.text || "");
  if (!statement) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "statement is required"};
  }
  if (hasSensitiveText(`${statement} ${evidenceText}`)) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "sensitive_text_rejected"};
  }
  const store = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preference = preferenceFromBody({body, userId: user.userId});
  store.preferences = [...(store.preferences || []), preference];
  await writeJson(user.preferencesPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    preference,
  };
}

export async function listConfirmedPreferences({workspaceRoot = config.storage.runtimeRoot, userId, status}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preferences = (store.preferences || []).filter((preference) => (
    status ? preference.status === status : true
  ));
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    preferences,
    count: preferences.length,
  };
}

export async function updateConfirmedPreference({workspaceRoot = config.storage.runtimeRoot, userId, preferenceId: targetPreferenceId, patch = {}}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preferences = store.preferences || [];
  const index = preferences.findIndex((preference) => preference.preference_id === targetPreferenceId);
  if (index === -1) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "preference_not_found"};
  }
  if (preferences[index].status === "forgotten") {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "preference_forgotten"};
  }
  const normalizedPatch = normalizePreferencePatch(patch);
  const statementForSafety = normalizedPatch.statement || preferences[index].statement || "";
  const evidenceForSafety = Array.isArray(normalizedPatch.evidence) ? normalizedPatch.evidence.join(" ") : "";
  if (hasSensitiveText(`${statementForSafety} ${evidenceForSafety}`)) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "sensitive_text_rejected"};
  }
  const updatedAt = nowIso();
  const previous = preferences[index];
  const next = {
    ...previous,
    ...normalizedPatch,
    updated_at: updatedAt,
    revision: Number(previous.revision || 0) + 1,
    audit: [
      ...(previous.audit || []),
      {
        type: "update",
        actor: patch.actor || "user",
        occurred_at: updatedAt,
        changed_fields: Object.keys(normalizedPatch),
      },
    ],
  };
  preferences[index] = next;
  store.preferences = preferences;
  await writeJson(user.preferencesPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    preference: next,
  };
}

export async function setConfirmedPreferenceStatus({workspaceRoot = config.storage.runtimeRoot, userId, preferenceId: targetPreferenceId, status, reason = "", actor = "user"}) {
  const allowed = new Set(["active", "paused", "forgotten"]);
  if (!allowed.has(status)) {
    return {ok: false, user_id: normalizeUserId(userId), error: "invalid_preference_status"};
  }
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preferences = store.preferences || [];
  const index = preferences.findIndex((preference) => preference.preference_id === targetPreferenceId);
  if (index === -1) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "preference_not_found"};
  }
  const updatedAt = nowIso();
  const previous = preferences[index];
  if (previous.status === "forgotten" && status !== "forgotten") {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "preference_forgotten"};
  }
  const next = {
    ...previous,
    status,
    updated_at: updatedAt,
    status_reason: reason,
    audit: [
      ...(previous.audit || []),
      {
        type: status === "forgotten" ? "delete" : "status_change",
        actor,
        status,
        reason,
        occurred_at: updatedAt,
      },
    ],
  };
  preferences[index] = next;
  store.preferences = preferences;
  await writeJson(user.preferencesPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    preference: next,
  };
}

export async function setConfirmedPreferenceSync({workspaceRoot = config.storage.runtimeRoot, userId, preferenceId: targetPreferenceId, sync = {}, audit = {}}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preferences = store.preferences || [];
  const index = preferences.findIndex((preference) => preference.preference_id === targetPreferenceId);
  if (index === -1) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "preference_not_found"};
  }
  const updatedAt = nowIso();
  const previous = preferences[index];
  const next = {
    ...previous,
    updated_at: updatedAt,
    sync: {
      ...(previous.sync || {}),
      provider: "evermind",
      ...sync,
    },
    audit: [
      ...(previous.audit || []),
      {
        type: "sync",
        actor: audit.actor || "system",
        provider: "evermind",
        operation: audit.operation || sync.operation || "sync",
        occurred_at: updatedAt,
        ok: Boolean(sync.sync_status === "synced" || sync.sync_status === "cleanup_required"),
      },
    ],
  };
  preferences[index] = next;
  store.preferences = preferences;
  await writeJson(user.preferencesPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    preference: next,
  };
}

export async function confirmMemoryCandidate({workspaceRoot = config.storage.runtimeRoot, userId, candidateId: targetCandidateId, actor = "user", patch = {}}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const candidatesStore = await readJsonIfExists(user.candidatesPath, {
    schema_version: SCHEMA_CANDIDATES,
    user_id: user.userId,
    candidates: [],
  });
  const candidates = candidatesStore.candidates || [];
  const candidateIndex = candidates.findIndex((candidate) => candidate.candidate_id === targetCandidateId);
  if (candidateIndex === -1) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "candidate_not_found"};
  }
  const candidate = candidates[candidateIndex];
  if (candidate.status !== "pending") {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "candidate_not_pending", candidate};
  }
  const normalizedPatch = normalizePreferencePatch(patch);
  const confirmationText = normalizedPatch.confirmation_text || normalizedPatch.statement || "";
  const patchedCandidate = confirmationText ? {
    ...candidate,
    ...normalizedPatch,
    statement: normalizedPatch.statement || `主人确认想让小汪记住：${confirmationText}`,
    confirmation_text: confirmationText,
    evidence: normalizedPatch.evidence || candidate.evidence,
    edit: {
      actor,
      edited_at: nowIso(),
      original_confirmation_text: candidate.confirmation_text || candidate.statement || "",
    },
  } : candidate;
  if (hasSensitiveText(`${patchedCandidate.statement || ""} ${patchedCandidate.confirmation_text || ""}`)) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "sensitive_text_rejected"};
  }
  const preferencesStore = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const preference = preferenceFromCandidate({candidate: patchedCandidate, userId: user.userId, actor});
  const updatedAt = nowIso();
  candidates[candidateIndex] = {
    ...patchedCandidate,
    status: "confirmed",
    updated_at: updatedAt,
    confirmed_at: updatedAt,
    confirmed_preference_id: preference.preference_id,
    safety: {
      ...(candidate.safety || {}),
      writes_confirmed_preference: true,
      user_confirmed: true,
    },
  };
  candidatesStore.candidates = candidates;
  preferencesStore.preferences = [...(preferencesStore.preferences || []), preference];
  await writeJson(user.candidatesPath, candidatesStore);
  await writeJson(user.preferencesPath, preferencesStore);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    candidate: candidates[candidateIndex],
    preference,
  };
}

export async function rejectMemoryCandidate({workspaceRoot = config.storage.runtimeRoot, userId, candidateId: targetCandidateId, reason = "", actor = "user"}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const store = await readJsonIfExists(user.candidatesPath, {
    schema_version: SCHEMA_CANDIDATES,
    user_id: user.userId,
    candidates: [],
  });
  const candidates = store.candidates || [];
  const index = candidates.findIndex((candidate) => candidate.candidate_id === targetCandidateId);
  if (index === -1) {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "candidate_not_found"};
  }
  const candidate = candidates[index];
  if (candidate.status !== "pending") {
    return {ok: false, user_id: user.userId, memory_root: user.root, error: "candidate_not_pending", candidate};
  }
  const updatedAt = nowIso();
  candidates[index] = {
    ...candidate,
    status: "rejected",
    updated_at: updatedAt,
    rejected_at: updatedAt,
    rejection: {
      actor,
      reason,
    },
    safety: {
      ...(candidate.safety || {}),
      writes_confirmed_preference: false,
      user_confirmed: false,
    },
  };
  store.candidates = candidates;
  await writeJson(user.candidatesPath, store);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    candidate: candidates[index],
  };
}

export async function readUserMemoryContext({workspaceRoot = config.storage.runtimeRoot, userId}) {
  const user = await ensureMemoryUser({workspaceRoot, userId});
  const profilePath = path.join(user.directory, "profile.md");
  const preferencesStore = await readJsonIfExists(user.preferencesPath, defaultPreferenceStore(user.userId));
  const candidatesStore = await readJsonIfExists(user.candidatesPath, {
    schema_version: SCHEMA_CANDIDATES,
    user_id: user.userId,
    candidates: [],
  });
  const profileText = existsSync(profilePath)
    ? await readFile(profilePath, "utf8")
    : "";
  const preferences = (preferencesStore.preferences || [])
    .filter((item) => item && item.status !== "forgotten" && item.status !== "paused")
    .slice(0, 20);
  const pendingCandidates = (candidatesStore.candidates || [])
    .filter((item) => item && item.status === "pending")
    .slice(-12);
  return {
    ok: true,
    user_id: user.userId,
    memory_root: user.root,
    profile_text: profileText.slice(0, 2200),
    preferences,
    pending_candidates: pendingCandidates,
  };
}

function compactEvermindMemory(item = {}) {
  return {
    memory_type: item.memory_type || item.type || "",
    summary: String(item.summary || item.content || item.text || item.memory || "").slice(0, 260),
    score: item.score ?? item.rank_score ?? null,
    source: "evermind",
  };
}

export async function readRecommendationMemoryContext({workspaceRoot = config.storage.runtimeRoot, userId, query = "", includeEvermind = true} = {}) {
  const context = await readUserMemoryContext({workspaceRoot, userId});
  const confirmedPreferences = (context.preferences || [])
    .filter((item) => item.status === "active")
    .slice(0, 12)
    .map((item) => ({
      preference_id: item.preference_id,
      category: item.category,
      scope: item.scope,
      polarity: item.polarity,
      strength: item.strength,
      confidence: item.confidence,
      statement: item.statement,
      explanation_hint: item.statement,
    }));
  let evermindResult = {ok: false, error: "disabled", memories: []};
  if (includeEvermind && evermindConfigStatus().configured) {
    evermindResult = await searchEvermindMemories({
      userId: context.user_id,
      query: query || "饭点推荐 用户偏好 最近用餐上下文",
      method: "hybrid",
      topK: 8,
      memoryTypes: ["episodic_memory", "profile"],
    });
  }
  const evermindMemories = evermindResult.ok
    ? (evermindResult.memories || []).map(compactEvermindMemory).filter((item) => item.summary).slice(0, 8)
    : [];
  return {
    user_id: context.user_id,
    policy: "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context",
    confirmed_preferences: confirmedPreferences,
    preference_count: confirmedPreferences.length,
    evermind_weak_memories: evermindMemories,
    evermind_memory_count: evermindMemories.length,
    evermind_warning: evermindResult.ok ? "" : (evermindResult.error || ""),
  };
}
