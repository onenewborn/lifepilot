import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { createDayId, getDayContext } from "./session-store.mjs";
import { createMemoryCandidatesFromOpenClaw, listConfirmedPreferences, listMemoryCandidates } from "./memory-store.mjs";

const DEFAULT_USER_ID = "demo_weiyingru";
const CHAT_SCHEMA = "lifepilot.xiaowang_chat.v1";

function nowIso() {
  return new Date().toISOString();
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_") || DEFAULT_USER_ID;
}

function chatRoot() {
  return path.join(config.storage.runtimeRoot, "xiaowang_chats");
}

function chatPath(sessionId) {
  return path.join(chatRoot(), `${safeId(sessionId)}.json`);
}

function createChatSessionId() {
  return `xw_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

async function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), {recursive: true});
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, filePath);
  return payload;
}

function titleFromMessage(message) {
  const text = String(message || "").trim();
  return text ? text.slice(0, 18) : "和小汪聊聊";
}

async function readChatSession(sessionId) {
  if (!sessionId) return null;
  try {
    return JSON.parse(await readFile(chatPath(sessionId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function wantsMealSkill(text) {
  return /(滑卡|选饭|吃什么|推荐|帮我选|饭点|挑饭|不知道吃啥|不知道吃什么)/.test(text);
}

function wantsMemoryCandidate(text) {
  return /(记住|以后|下次|多推荐|少推荐|别推|不要推|喜欢|不喜欢|讨厌|偏好)/.test(text);
}

function candidateFromChat({message, userId, sessionId}) {
  return {
    type: "food_preference",
    category: "xiaowang_chat",
    polarity: /(不喜欢|讨厌|少推荐|别推|不要推)/.test(message) ? "negative" : "positive",
    statement: `主人在问小汪时提到：${message}`,
    confirmation_text: message.replace(/^记住[：:，,\s]*/, "") || message,
    confidence: 0.78,
    evidence: [{
      source: "xiaowang_chat",
      session_id: sessionId,
      reason: message,
    }],
    needs_confirmation: true,
  };
}

function buildAssistantReply({message, pendingCount, preferenceCount, skillCards, createdCount}) {
  if (skillCards.length) {
    return "可以，主人。小汪可以直接带你走饭点滑卡路线：先看方向，再筛具体店，最后收束到一家。";
  }
  if (createdCount) {
    return "我听到了，这像是一个可以长期帮助推荐的偏好。我先放进待确认记忆，主人确认后小汪再正式记住。";
  }
  if (/今天|刚刚|这顿|吃完|反馈/.test(message)) {
    return "收到，主人。今天这顿我会先作为当下记录理解；如果里面有稳定偏好，小汪会提醒你要不要沉淀成长期记忆。";
  }
  if (preferenceCount || pendingCount) {
    return `我在看你的记忆本：已经确认 ${preferenceCount} 条，待确认 ${pendingCount} 条。你可以继续告诉我今天想怎么吃，或者让我帮你走滑卡。`;
  }
  return "我在，主人。你可以直接问我今天怎么吃，也可以告诉我以后想多推荐或少推荐什么。";
}

export async function handleXiaowangChat({body = {}} = {}) {
  const userId = body.user_id || body.userId || DEFAULT_USER_ID;
  const message = String(body.message || "").trim();
  const createdAt = nowIso();
  const existing = await readChatSession(body.session_id || body.sessionId);
  const session = existing || {
    schema_version: CHAT_SCHEMA,
    session_id: createChatSessionId(),
    user_id: userId,
    title: titleFromMessage(message),
    summary: "",
    messages: [],
    created_at: createdAt,
    updated_at: createdAt,
  };

  const pending = await listMemoryCandidates({userId, status: "pending"});
  const preferences = await listConfirmedPreferences({userId, status: "active"});
  const skillCards = wantsMealSkill(message) ? [{
    skill: "meal_swipe",
    action: "start_meal",
    title: "走饭点滑卡",
    description: "先滑方向卡，再筛具体商家。",
    cta: "开始滑卡",
  }] : [];

  let memoryResult = {created_count: 0, candidates: []};
  if (message && wantsMemoryCandidate(message)) {
    memoryResult = await createMemoryCandidatesFromOpenClaw({
      userId,
      dreamId: "",
      dayId: body.day_id || body.dayId || "",
      candidates: [candidateFromChat({message, userId, sessionId: session.session_id})],
    });
  }

  const assistant = {
    id: `msg_${Date.now()}_${randomUUID().slice(0, 6)}`,
    role: "assistant",
    content: buildAssistantReply({
      message,
      pendingCount: pending.count || 0,
      preferenceCount: preferences.count || 0,
      skillCards,
      createdCount: memoryResult.created_count || 0,
    }),
    mode: "local_skill_router",
    skill_cards: skillCards,
    memory_candidate_created_count: memoryResult.created_count || 0,
    memory_candidates: memoryResult.candidates || [],
    created_at: createdAt,
  };

  const userMessage = {
    id: `msg_${Date.now()}_${randomUUID().slice(0, 6)}`,
    role: "user",
    content: message,
    created_at: createdAt,
  };
  session.messages = [...(session.messages || []), userMessage, assistant];
  session.summary = assistant.content;
  session.updated_at = nowIso();
  await writeJson(chatPath(session.session_id), session);

  return {
    ok: true,
    session: {
      session_id: session.session_id,
      title: session.title,
      summary: session.summary,
      updated_at: session.updated_at,
    },
    assistant,
    messages: session.messages,
  };
}

export async function readXiaowangDiary({userId = DEFAULT_USER_ID, date} = {}) {
  const dayId = createDayId(userId, date ? new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00+08:00`) : new Date());
  const dayContext = await getDayContext(dayId);
  const pending = await listMemoryCandidates({userId, status: "pending"});
  const preferences = await listConfirmedPreferences({userId});
  return {
    ok: true,
    user_id: userId,
    day_id: dayId,
    day_context: dayContext || null,
    meal_sessions: dayContext?.meal_sessions || [],
    memory_candidates: pending.candidates || [],
    confirmed_preferences: preferences.preferences || [],
    prompts: (pending.candidates || []).slice(0, 3).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      text: `要不要让小汪记住：${candidate.confirmation_text || candidate.statement}`,
    })),
  };
}
