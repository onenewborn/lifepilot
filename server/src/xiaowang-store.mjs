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
const DIARY_TIME_ZONE = "Asia/Shanghai";
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

function formatDiaryDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return {
      display_date: "",
      display_time: "",
      display_datetime: "",
    };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: DIARY_TIME_ZONE,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  const displayDate = `${parts.month}月${parts.day}日`;
  const displayTime = `${parts.hour}:${parts.minute}`;
  return {
    display_date: displayDate,
    display_time: displayTime,
    display_datetime: `${displayDate} ${displayTime}`,
  };
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

function candidateFromChat({message, userId, sessionId, confirmationText}) {
  const confirmation = String(confirmationText || message).trim();
  return {
    type: "food_preference",
    category: "xiaowang_chat",
    polarity: /(不喜欢|讨厌|少推荐|别推|不要推)/.test(confirmation) ? "negative" : "positive",
    statement: `主人在问小汪时提到：${confirmation}`,
    confirmation_text: confirmation.replace(/^记住[：:，,\s]*/, "") || confirmation,
    confidence: 0.78,
    evidence: [{
      source: "xiaowang_chat",
      session_id: sessionId,
      reason: message || confirmation,
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

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeSkillCalls(calls = []) {
  if (!Array.isArray(calls)) return [];
  const seen = new Set();
  return calls
    .map((call) => {
      const skill = skillByName(call?.skill);
      if (!skill) return null;
      if (seen.has(skill.skill)) return null;
      seen.add(skill.skill);
      return {
        skill: skill.skill,
        action: skill.action,
        reason: String(call.reason || "").trim(),
        args: call.args && typeof call.args === "object" ? call.args : {},
      };
    })
    .filter(Boolean);
}

function parseOpenClawChatResponse(text) {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    return {
      message: String(text || "").trim(),
      skill_calls: [],
      memory_prompts: [],
      parse_mode: "text_fallback",
    };
  }
  return {
    message: String(parsed.message || "").trim(),
    skill_calls: normalizeSkillCalls(parsed.skill_calls || parsed.skillCalls || []),
    memory_prompts: Array.isArray(parsed.memory_prompts || parsed.memoryPrompts)
      ? (parsed.memory_prompts || parsed.memoryPrompts).map((item) => ({
        text: String(item?.text || "").trim(),
        confirmation_text: String(item?.confirmation_text || item?.confirmationText || "").trim(),
      })).filter((item) => item.text || item.confirmation_text)
      : [],
    parse_mode: "json",
  };
}

function buildOpenClawChatMessage({message, session, pendingCount, preferenceCount}) {
  const context = recentChatContext(session.messages || []);
  const skills = SKILL_REGISTRY.map((skill) => (
    `- ${skill.skill}: ${skill.description} action=${skill.action} cta=${skill.cta} status=${skill.status}`
  )).join("\n");
  return [
    "请使用 lifepilot-xiaowang skill，按 OpenClaw workspace 的 SOUL.md 和 AGENTS.md 处理用户消息。",
    "",
    "用户正在和小汪聊天。你需要自己判断是否调用 LifePilot 产品 skill。",
    "请只输出 JSON，不要加 Markdown，不要解释 JSON。",
    "",
    "JSON schema:",
    "{\"message\":\"小汪要发给用户的一段自然回复，最多 3 句。\",\"skill_calls\":[{\"skill\":\"meal_swipe\",\"action\":\"start_meal\",\"reason\":\"\",\"args\":{}}],\"memory_prompts\":[]}",
    "",
    "可用 skills:",
    skills,
    "",
    "不要暴露 gateway、runner、transport、schema、OpenClaw 等内部实现。",
    "如果用户表达长期偏好或要求记住，使用 memory_capture，并在 memory_prompts 中给出待确认文本。",
    "如果不需要 skill，skill_calls 返回空数组。",
    "",
    `当前已确认偏好数量：${preferenceCount}`,
    `待确认记忆数量：${pendingCount}`,
    context ? `最近对话：\n${context}` : "最近对话：暂无",
    "",
    `用户最新消息：${message}`,
    "",
    "再次强调：只输出 JSON，message 最多 3 句。",
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
  const response = parseOpenClawChatResponse(text);
  if (!response.message) {
    throw new Error("openclaw_missing_message");
  }
  return {
    content: response.message,
    skillCalls: response.skill_calls,
    memoryPrompts: response.memory_prompts,
    parseMode: response.parse_mode,
    raw: result,
  };
}

function fallbackSkillCards(message) {
  return [
    wantsMealSkill(message) ? skillCard("meal_swipe") : null,
    wantsDiarySkill(message) ? skillCard("diary_review") : null,
  ].filter(Boolean);
}

function skillCardsFromCalls(skillCalls = []) {
  return normalizeSkillCalls(skillCalls)
    .map((call) => skillCard(call.skill))
    .filter(Boolean);
}

function mealSlotLabel(slot) {
  return {
    breakfast: "早餐",
    lunch: "午餐",
    afternoon: "下午这顿",
    dinner: "晚餐",
    late_night: "夜宵",
  }[slot] || "这顿饭";
}

function statusLabel(session) {
  if (session.finalized_at || session.status === "finalized") return "已选定";
  if (session.offer_event_count) return "看店中";
  if (session.direction_event_count) return "挑方向中";
  return "刚开始";
}

function compactGoal(text) {
  const value = String(text || "")
    .trim()
    .replace(/^用户(想|需要|希望|正在找|在找)/, "")
    .replace(/^一个/, "想要一个")
    .replace(/^找一家/, "想找一家");
  if (!value) return "";
  return value.length > 54 ? `${value.slice(0, 54)}...` : value;
}

function xiaowangMealDiaryItem(session = {}) {
  const timeSource = session.finalized_at || session.updated_at || session.created_at;
  const time = formatDiaryDateTime(timeSource);
  const slot = mealSlotLabel(session.meal_slot);
  const status = statusLabel(session);
  const merchantName = session.final_merchant_name || "";
  const goal = compactGoal(session.goal);
  const seenCount = Number(session.offer_event_count || session.direction_event_count || 0);

  let diaryTitle = merchantName ? `${slot}选了 ${merchantName}` : `${slot}的小汪记录`;
  let diaryText = goal
    ? `主人这次想要：${goal}`
    : "主人开了一轮饭点滑卡，小汪先记在这里。";
  if (merchantName) {
    diaryText = goal
      ? `小汪记下啦：主人最后选了 ${merchantName}。一开始想要的是「${goal}」。`
      : `小汪记下啦：主人最后选了 ${merchantName}。`;
  } else if (seenCount > 0) {
    diaryText = goal
      ? `这轮还没最后拍板，但小汪已经陪主人看了 ${seenCount} 张卡。主人当时想要「${goal}」。`
      : `这轮还没最后拍板，小汪已经陪主人看了 ${seenCount} 张卡。`;
  }

  return {
    ...session,
    ...time,
    diary_title: diaryTitle,
    diary_text: diaryText,
    diary_status: status,
  };
}

function xiaowangMemoryCandidateItem(candidate = {}) {
  const time = formatDiaryDateTime(candidate.created_at || candidate.updated_at);
  const text = candidate.confirmation_text || candidate.statement || "";
  return {
    ...candidate,
    ...time,
    diary_text: `主人，这条要不要让小汪长期记住：${text}`,
  };
}

function xiaowangPreferenceItem(preference = {}) {
  const time = formatDiaryDateTime(preference.updated_at || preference.created_at);
  return {
    ...preference,
    ...time,
    diary_text: preference.statement || preference.confirmation_text || "",
  };
}

function memoryPromptsFromCalls({skillCalls = [], memoryPrompts = [], message}) {
  const prompts = Array.isArray(memoryPrompts) ? [...memoryPrompts] : [];
  const hasMemorySkill = skillCalls.some((call) => call.skill === "memory_capture");
  if (!hasMemorySkill) return prompts;

  const call = skillCalls.find((item) => item.skill === "memory_capture") || {};
  const args = call.args || {};
  const confirmationText = String(
    args.confirmation_text
      || args.confirmationText
      || args.text
      || args.preference
      || ""
  ).trim();
  if (confirmationText && !prompts.some((item) => item.confirmation_text === confirmationText)) {
    prompts.push({
      text: `要不要让小汪记住：${confirmationText}`,
      confirmation_text: confirmationText,
    });
  }
  if (!prompts.length) {
    prompts.push({
      text: `要不要让小汪记住：${message}`,
      confirmation_text: message,
    });
  }
  return prompts;
}

async function createMemoryCandidatesFromPrompts({userId, sessionId, dayId, message, skillCalls = [], memoryPrompts = []}) {
  const prompts = memoryPromptsFromCalls({skillCalls, memoryPrompts, message})
    .map((item) => ({
      text: String(item?.text || "").trim(),
      confirmation_text: String(item?.confirmation_text || item?.confirmationText || item?.text || "").trim(),
    }))
    .filter((item) => item.confirmation_text);

  if (!prompts.length) {
    return {created_count: 0, candidates: []};
  }

  return createMemoryCandidatesFromOpenClaw({
    userId,
    dreamId: "",
    dayId,
    candidates: prompts.slice(0, 3).map((prompt) => candidateFromChat({
      message,
      userId,
      sessionId,
      confirmationText: prompt.confirmation_text,
    })),
  });
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
  const dayId = body.day_id || body.dayId || "";
  let skillCards = [];
  let skillCalls = [];
  let memoryPrompts = [];
  let memoryResult = {created_count: 0, candidates: []};
  let content = "";
  let mode = "openclaw_gateway_client";
  let openclawMeta = null;
  if (message) {
    try {
      const openclawReply = await getOpenClawChatReply({
        message,
        session,
        pendingCount: pending.count || 0,
        preferenceCount: preferences.count || 0,
      });
      content = openclawReply.content;
      skillCalls = openclawReply.skillCalls || [];
      skillCards = skillCardsFromCalls(skillCalls);
      memoryPrompts = memoryPromptsFromCalls({
        skillCalls,
        memoryPrompts: openclawReply.memoryPrompts || [],
        message,
      });
      if (skillCalls.some((item) => item.skill === "memory_capture")) {
        memoryResult = await createMemoryCandidatesFromPrompts({
          userId,
          sessionId: session.session_id,
          dayId,
          message,
          skillCalls,
          memoryPrompts,
        });
      }
      mode = "openclaw_gateway_client";
      openclawMeta = {
        status: openclawReply.raw?.status || "",
        run_id: openclawReply.raw?.runId || "",
        parse_mode: openclawReply.parseMode || "",
      };
    } catch (error) {
      skillCards = fallbackSkillCards(message);
      if (wantsMemoryCandidate(message)) {
        memoryResult = await createMemoryCandidatesFromOpenClaw({
          userId,
          dreamId: "",
          dayId,
          candidates: [candidateFromChat({message, userId, sessionId: session.session_id})],
        });
      }
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
    mode = "local_empty_message";
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
    agent_skill_calls: skillCalls,
    memory_prompts: memoryPrompts,
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
  const mealSessions = (dayContext?.meal_sessions || [])
    .map(xiaowangMealDiaryItem)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
  const memoryCandidates = (pending.candidates || []).map(xiaowangMemoryCandidateItem);
  const confirmedPreferences = (preferences.preferences || []).map(xiaowangPreferenceItem);
  return {
    ok: true,
    user_id: userId,
    day_id: dayId,
    day_context: dayContext || null,
    diary_date: dayContext?.date || dayId.match(/^day_(\d{8})_/)?.[1] || "",
    meal_sessions: mealSessions,
    memory_candidates: memoryCandidates,
    confirmed_preferences: confirmedPreferences,
    prompts: memoryCandidates.slice(0, 3).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      text: `要不要让小汪记住：${candidate.confirmation_text || candidate.statement}`,
    })),
  };
}
