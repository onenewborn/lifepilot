import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { createDayId, getDayContext } from "./session-store.mjs";
import { createMemoryCandidatesFromOpenClaw, listConfirmedPreferences, listMemoryCandidates } from "./memory-store.mjs";
import { requestOpenClawAgent } from "./openclaw-gateway-client.mjs";

const DEFAULT_USER_ID = "demo_weiyingru";
const CHAT_SCHEMA = "lifepilot.xiaowang_chat.v1";
const SKILL_REGISTRY = [
  {
    skill: "meal_swipe",
    title: "饭点滑卡",
    description: "先滑方向卡，再筛具体商家，最后收束到一家。",
    trigger_examples: ["今天吃什么", "帮我选饭", "不知道吃啥"],
    action: "start_meal",
    cta: "开始滑卡",
    runtime: "local",
    status: "available",
  },
  {
    skill: "memory_capture",
    title: "记住偏好",
    description: "把明确表达的饮食偏好生成待确认记忆。",
    trigger_examples: ["以后少推荐排队久的", "记住我喜欢热汤面"],
    action: "review_memory",
    cta: "查看待确认",
    runtime: "local",
    status: "available",
  },
  {
    skill: "diary_review",
    title: "小汪日记本",
    description: "查看今天吃饭记录、待确认记忆和已确认偏好。",
    trigger_examples: ["你记得我什么", "看看汪记本", "今天小汪记了什么"],
    action: "open_diary",
    cta: "打开汪记本",
    runtime: "local",
    status: "available",
  },
  {
    skill: "openclaw_dreaming",
    title: "后台复盘",
    description: "让小汪在后台整理 day context，生成候选记忆和下一次互动建议。",
    trigger_examples: ["复盘今天", "整理今天的吃饭记录"],
    action: "run_dreaming",
    cta: "开始复盘",
    runtime: "openclaw_gateway_client",
    status: "planned",
  },
];

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
  return /(记住|以后|下次|多推荐|少推荐|别推|不要推)/.test(text);
}

function wantsDiarySkill(text) {
  return /(汪记本|日记|记得我|记住了什么|你了解我|我的偏好|待确认|画像|今天.*记录|今天.*记了什么)/.test(text);
}

function skillByName(name) {
  return SKILL_REGISTRY.find((item) => item.skill === name);
}

function skillCard(name) {
  const skill = skillByName(name);
  if (!skill) return null;
  return {
    skill: skill.skill,
    action: skill.action,
    title: skill.title,
    description: skill.description,
    cta: skill.cta,
  };
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
  if (skillCards.some((item) => item.skill === "meal_swipe")) {
    return "可以，主人。小汪可以直接带你走饭点滑卡路线：先看方向，再筛具体店，最后收束到一家。";
  }
  if (skillCards.some((item) => item.skill === "diary_review")) {
    return `我可以打开汪记本给主人看。现在有 ${preferenceCount} 条已确认偏好、${pendingCount} 条待确认记忆。`;
  }
  if (createdCount) {
    return "我听到了，这像是一个可以帮助推荐的偏好。我先放进待确认记忆，主人确认后小汪再正式记住。";
  }
  if (/今天|刚刚|这顿|吃完|反馈/.test(message)) {
    return "收到，主人。今天这顿我会先作为当下记录理解；如果里面有稳定偏好，小汪会提醒你要不要沉淀成长期记忆。";
  }
  if (preferenceCount || pendingCount) {
    return `我在看你的记忆本：已经确认 ${preferenceCount} 条，待确认 ${pendingCount} 条。你可以继续告诉我今天想怎么吃，或者让我帮你走滑卡。`;
  }
  return "我在，主人。你可以直接问我今天怎么吃，也可以告诉我以后想多推荐或少推荐什么。";
}

export function listXiaowangSkills() {
  return {
    ok: true,
    skills: SKILL_REGISTRY,
  };
}

function recentChatContext(messages = []) {
  return messages
    .slice(-8)
    .map((item) => `${item.role === "user" ? "用户" : "小汪"}：${String(item.content || "").trim()}`)
    .filter((line) => line.trim())
    .join("\n");
}

function parseOpenClawText(result) {
  return result?.result?.payloads?.map((payload) => payload.text).filter(Boolean).join("\n").trim() || "";
}

function buildOpenClawChatMessage({message, session, pendingCount, preferenceCount}) {
  const context = recentChatContext(session.messages || []);
  return [
    "你是 LifePilot 微信小程序里的小汪。请按 OpenClaw workspace 的 SOUL.md 和 AGENTS.md 回复。",
    "",
    "用户正在和小汪聊天。请用自然、简短、具体的中文回复，像 IM 对话，不要写报告。",
    "不要暴露 gateway、runner、transport、schema、OpenClaw 等内部实现。",
    "如果用户想吃饭、选饭或不知道吃什么，可以提到你能调起饭点滑卡，但不要伪造已经调起；后端会用 skill card 处理。",
    "如果用户表达长期偏好或要求记住，提醒需要主人确认后小汪才会正式记住。",
    "",
    `当前已确认偏好数量：${preferenceCount}`,
    `待确认记忆数量：${pendingCount}`,
    context ? `最近对话：\n${context}` : "最近对话：暂无",
    "",
    `用户最新消息：${message}`,
    "",
    "请只输出小汪要发给用户的一段话，最多 3 句。",
  ].join("\n");
}

async function getOpenClawChatReply({message, session, pendingCount, preferenceCount}) {
  const result = await requestOpenClawAgent({
    sessionId: `lifepilot-xiaowang-${session.session_id}`,
    timeoutSeconds: 60,
    idempotencyKey: `lifepilot-xiaowang-${session.session_id}-${Date.now()}-${randomUUID().slice(0, 6)}`,
    message: buildOpenClawChatMessage({message, session, pendingCount, preferenceCount}),
  });
  const text = parseOpenClawText(result);
  if (result?.status !== "ok" || !text) {
    throw new Error("openclaw_empty_reply");
  }
  return {
    content: text,
    raw: result,
  };
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
  const skillCards = [
    wantsMealSkill(message) ? skillCard("meal_swipe") : null,
    wantsDiarySkill(message) ? skillCard("diary_review") : null,
  ].filter(Boolean);

  let memoryResult = {created_count: 0, candidates: []};
  if (message && wantsMemoryCandidate(message)) {
    memoryResult = await createMemoryCandidatesFromOpenClaw({
      userId,
      dreamId: "",
      dayId: body.day_id || body.dayId || "",
      candidates: [candidateFromChat({message, userId, sessionId: session.session_id})],
    });
  }

  let content = "";
  let mode = "local_skill_router";
  let openclawMeta = null;
  if (!skillCards.length && !memoryResult.created_count && message) {
    try {
      const openclawReply = await getOpenClawChatReply({
        message,
        session,
        pendingCount: pending.count || 0,
        preferenceCount: preferences.count || 0,
      });
      content = openclawReply.content;
      mode = "openclaw_gateway_client";
      openclawMeta = {
        status: openclawReply.raw?.status || "",
        run_id: openclawReply.raw?.runId || "",
      };
    } catch (error) {
      content = buildAssistantReply({
        message,
        pendingCount: pending.count || 0,
        preferenceCount: preferences.count || 0,
        skillCards,
        createdCount: memoryResult.created_count || 0,
      });
      mode = "local_fallback_after_openclaw_error";
      openclawMeta = {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  } else {
    content = buildAssistantReply({
      message,
      pendingCount: pending.count || 0,
      preferenceCount: preferences.count || 0,
      skillCards,
      createdCount: memoryResult.created_count || 0,
    });
  }

  const assistant = {
    id: `msg_${Date.now()}_${randomUUID().slice(0, 6)}`,
    role: "assistant",
    content,
    mode,
    skill_cards: skillCards,
    memory_candidate_created_count: memoryResult.created_count || 0,
    memory_candidates: memoryResult.candidates || [],
    openclaw: openclawMeta,
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
