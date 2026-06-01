import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { createDayId, getDayContext } from "./session-store.mjs";
import { createMemoryCandidatesFromOpenClaw, listConfirmedPreferences, listMemoryCandidates } from "./memory-store.mjs";
import { requestOpenClawAgent, resetOpenClawGatewayClient } from "./openclaw-gateway-client.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";
import { getLatestOpenClawJobForDay } from "./openclaw-store.mjs";
import { buildMerchantCompareContext, buildMerchantIntelContext, resolveMerchantIdsFromText } from "./merchant-tools.mjs";

const DEFAULT_USER_ID = "demo_weiyingru";
const CHAT_SCHEMA = "lifepilot.xiaowang_chat.v1";
const DIARY_TIME_ZONE = "Asia/Shanghai";
const chatJobs = new Map();
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
    status: "available",
  },
  {
    skill: "merchant_intel",
    title: "商家理解",
    description: "解释这家店的特色菜、口味、排队风险和适合几个人吃。",
    trigger_examples: ["这家有什么特色菜", "这家适合一个人吗", "这家口味怎么样"],
    action: "show_merchant_intel",
    cta: "看商家证据",
    runtime: "openclaw_gateway_client",
    status: "available",
  },
  {
    skill: "merchant_compare",
    title: "商家对比",
    description: "基于评分、评论分布、口碑标签和用户记忆比较两到四家店。",
    trigger_examples: ["这两家怎么选", "哪家更好吃", "汪记豆花和川香楼比一下"],
    action: "show_merchant_compare",
    cta: "看对比证据",
    runtime: "openclaw_gateway_client",
    status: "available",
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

function wantsMerchantIntelSkill(text) {
  return /(这家|这店|商家|店).*?(特色|招牌|口味|好吃|适合|排队|环境|怎么点|几个人|一个人|两个人|三个人)|特色菜|招牌菜/.test(text);
}

function wantsMerchantCompareSkill(text) {
  return /(对比|比较|哪家|哪个更|谁更|怎么选|二选一|两家|三家|排名|榜)/.test(text);
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
    skill_result_cards: Array.isArray(parsed.skill_result_cards || parsed.skillResultCards)
      ? (parsed.skill_result_cards || parsed.skillResultCards)
      : [],
    memory_prompts: Array.isArray(parsed.memory_prompts || parsed.memoryPrompts)
      ? (parsed.memory_prompts || parsed.memoryPrompts).map((item) => ({
        text: String(item?.text || "").trim(),
        confirmation_text: String(item?.confirmation_text || item?.confirmationText || "").trim(),
      })).filter((item) => item.text || item.confirmation_text)
      : [],
    parse_mode: "json",
  };
}

function compactCurrentContext(context = {}) {
  if (!context || typeof context !== "object") return null;
  const card = context.current_card || context.currentCard || context.current_merchant || context.currentMerchant || {};
  if (!card || typeof card !== "object") return null;
  const merchantId = card.merchant_id || card.merchantId || "";
  const merchantName = card.merchant_name || card.merchantName || card.title || "";
  if (!merchantId && !merchantName) return null;
  return {
    active_tab: context.active_tab || context.activeTab || "",
    meal_stage: context.meal_stage || context.mealStage || "",
    meal_session_id: context.meal_session_id || context.mealSessionId || "",
    current_merchant: {
      merchant_id: merchantId,
      merchant_name: merchantName,
      title: card.title || "",
      tags: card.tags || [],
      facts: card.facts || {},
    },
  };
}

function buildOpenClawChatMessage({message, session, pendingCount, preferenceCount, diarySummary = null, preferences = [], pending = [], currentContext = null}) {
  const context = recentChatContext(session.messages || []);
  const skills = SKILL_REGISTRY.map((skill) => (
    `- ${skill.skill}: ${skill.description} action=${skill.action} cta=${skill.cta} status=${skill.status}`
  )).join("\n");
  const preferenceText = preferences.slice(0, 6)
    .map((item) => `- ${item.confirmation_text || item.statement}`)
    .join("\n") || "暂无";
  const pendingText = pending.slice(0, 4)
    .map((item) => `- ${item.confirmation_text || item.statement}`)
    .join("\n") || "暂无";
  return [
    "请使用 lifepilot-xiaowang skill，按 OpenClaw workspace 的 SOUL.md 和 AGENTS.md 处理用户消息。",
    "",
    "用户正在和小汪聊天。你需要自己判断是否调用 LifePilot 产品 skill。",
    "请只输出 JSON，不要加 Markdown，不要解释 JSON。",
    "",
    "JSON schema:",
    "{\"message\":\"小汪要发给用户的一段自然回复，最多 3 句。\",\"skill_calls\":[{\"skill\":\"merchant_intel\",\"action\":\"show_merchant_intel\",\"reason\":\"\",\"args\":{\"merchant_id\":\"m_futian_006\"}}],\"memory_prompts\":[]}",
    "",
    "可用 skills:",
    skills,
    "",
    "不要暴露 gateway、runner、transport、schema、OpenClaw 等内部实现。",
    "如果用户表达长期偏好或要求记住，使用 memory_capture，并在 memory_prompts 中给出待确认文本。",
    "如果用户问某家店的特色菜、口味、排队、适合几个人吃，使用 merchant_intel。",
    "如果用户问两家或多家店怎么选、哪家更好吃、类似店对比，使用 merchant_compare。",
    "merchant_intel / merchant_compare 只负责发起 skill_call；最终证据由 LifePilot 后端工具补齐。你不要自己编评分和评论数。",
    "如果当前上下文里有 current_merchant，用户说“这家/这店”时优先使用它的 merchant_id。",
    "如果不需要 skill，skill_calls 返回空数组。",
    "",
    `当前已确认偏好数量：${preferenceCount}`,
    `待确认记忆数量：${pendingCount}`,
    `今日汪记本总结：${diarySummary?.text || "暂无"}`,
    `已确认偏好：\n${preferenceText}`,
    `待确认记忆：\n${pendingText}`,
    currentContext ? `当前产品上下文：\n${JSON.stringify(currentContext)}` : "当前产品上下文：暂无",
    context ? `最近对话：\n${context}` : "最近对话：暂无",
    "",
    `用户最新消息：${message}`,
    "",
    "再次强调：只输出 JSON，message 最多 3 句。",
  ].join("\n");
}

async function getOpenClawChatReply({message, session, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext}) {
  const result = await requestOpenClawAgent({
    sessionId: `lifepilot-xiaowang-${session.session_id}`,
    timeoutSeconds: process.env.LIFEPILOT_XIAOWANG_OPENCLAW_TIMEOUT_SECONDS || 90,
    idempotencyKey: `lifepilot-xiaowang-${session.session_id}-${Date.now()}-${randomUUID().slice(0, 6)}`,
    message: buildOpenClawChatMessage({message, session, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext}),
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
    skillResultCards: response.skill_result_cards || [],
    memoryPrompts: response.memory_prompts,
    parseMode: response.parse_mode,
    raw: result,
  };
}

function isOpenClawTimeout(error) {
  return /timeout/i.test(error instanceof Error ? error.message : String(error));
}

async function getArkChatReply({message, session, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext}) {
  const ai = await callArkChat({
    timeoutMs: Number(process.env.LIFEPILOT_XIAOWANG_ARK_TIMEOUT_MS || 12000),
    maxTokens: 700,
    temperature: 0.35,
    responseFormat: {type: "json_object"},
    messages: [
      {
        role: "system",
        content: "你是 LifePilot 微信小程序里的小汪。你要用简短、亲切、像 IM 对话的中文回复，并判断是否调用产品 skill。只输出 JSON。",
      },
      {
        role: "user",
        content: buildOpenClawChatMessage({message, session, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext}),
      },
    ],
  });
  if (!ai.ok || !ai.text) {
    const error = new Error(ai.error_code || "ark_empty_reply");
    error.ai = ai;
    throw error;
  }
  const response = parseOpenClawChatResponse(ai.text);
  if (!response.message) {
    const error = new Error("ark_missing_message");
    error.ai = ai;
    throw error;
  }
  return {
    content: response.message,
    skillCalls: response.skill_calls,
    skillResultCards: response.skill_result_cards || [],
    memoryPrompts: response.memory_prompts,
    parseMode: response.parse_mode,
    raw: ai,
  };
}

function fallbackSkillCards(message) {
  return [
    wantsMerchantCompareSkill(message) ? skillCard("merchant_compare") : null,
    wantsMerchantIntelSkill(message) ? skillCard("merchant_intel") : null,
    wantsMealSkill(message) ? skillCard("meal_swipe") : null,
    wantsDiarySkill(message) ? skillCard("diary_review") : null,
  ].filter(Boolean);
}

function skillCardsFromCalls(skillCalls = []) {
  return normalizeSkillCalls(skillCalls)
    .filter((call) => !["merchant_intel", "merchant_compare"].includes(call.skill))
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

function keywordsFromText(text) {
  const value = String(text || "");
  return [
    /热乎|热汤|暖/.test(value) ? "热乎" : "",
    /省心|低决策|不折腾|方便/.test(value) ? "省心" : "",
    /近|附近|公里|少走/.test(value) ? "近一点" : "",
    /排队|等待|等位/.test(value) ? "少排队" : "",
    /下饭|米饭|满足/.test(value) ? "下饭" : "",
    /清爽|低油|轻/.test(value) ? "清爽点" : "",
  ].filter(Boolean);
}

function uniqueItems(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function buildDiarySummary({mealSessions = [], memoryCandidates = [], confirmedPreferences = [], latestDreamJob = null} = {}) {
  if (latestDreamJob?.summary) {
    return {
      source: "openclaw_dreaming",
      text: `小汪复盘过啦：${latestDreamJob.summary}`,
      next_prompt: (latestDreamJob.xiaowang_next_interaction_ideas || [])[0]?.text || "要不要让小汪根据今天的记录，继续帮主人挑一轮？",
      dream_job_id: latestDreamJob.job_id,
    };
  }
  const finalizedCount = mealSessions.filter((item) => item.finalized_at || item.status === "finalized").length;
  const activeCount = mealSessions.filter((item) => !(item.finalized_at || item.status === "finalized")).length;
  const keywords = uniqueItems(mealSessions.flatMap((item) => keywordsFromText(item.goal || item.diary_text || ""))).slice(0, 4);
  const preferenceHint = confirmedPreferences.length
    ? `小汪还记着 ${confirmedPreferences.length} 条长期偏好。`
    : "长期偏好还不多，小汪会继续观察。";
  const pendingHint = memoryCandidates.length
    ? `还有 ${memoryCandidates.length} 条想请主人确认。`
    : "今天暂时没有新的待确认记忆。";
  let text = "今天小汪还没攒到吃饭记录。主人开一轮滑卡以后，我会在这里整理。";
  if (mealSessions.length) {
    const keywordText = keywords.length ? `主要在找${keywords.join("、")}的饭` : "有几轮吃饭选择";
    const activeText = activeCount ? `，还有 ${activeCount} 轮没最后拍板，小汪先记着` : "";
    text = `今天主人${keywordText}，已经选定 ${finalizedCount} 轮${activeText}。${pendingHint}`;
  }
  return {
    source: "rule",
    text: `${text}${mealSessions.length ? ` ${preferenceHint}` : ""}`,
    next_prompt: memoryCandidates.length
      ? "主人，要不要先确认一条小汪觉得有用的偏好？"
      : "主人如果现在要吃饭，小汪可以结合今天的记录帮你继续挑。",
    dream_job_id: "",
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

function ratingText(reputation = {}) {
  const rating = reputation.rating?.value;
  const count = reputation.review_stats?.review_count || 0;
  if (!rating) return "暂无评分证据";
  return `${rating}/${reputation.rating?.scale || 5} · ${count} 条评价量级`;
}

function topEvidenceTags(reputation = {}, limit = 3) {
  return (reputation.reputation_tags || [])
    .slice(0, limit)
    .map((tag) => ({
      label: tag.tag,
      value: `${Math.round((tag.mention_ratio || 0) * 100)}%`,
      text: tag.evidence_text || `${tag.mention_count || 0} 条提到 ${tag.tag}`,
      sentiment: tag.sentiment,
    }));
}

function merchantIntelCard(context = {}) {
  const reputation = context.merchant_reputation || {};
  const dishes = (context.merchant?.specialties || context.merchant_reputation?.signature_dishes?.map((item) => item.name) || []).slice(0, 5);
  const risks = (context.merchant_reputation?.negative_signals || []).slice(0, 3).map((item) => item.signal);
  return {
    type: "merchant_intel_card",
    skill: "merchant_intel",
    title: context.merchant?.name || "商家理解",
    subtitle: ratingText(reputation),
    summary: context.reputation_summary?.text || "",
    primary_points: [
      dishes.length ? `特色菜：${dishes.join("、")}` : "",
      context.merchant?.scene ? `适合场景：${context.merchant.scene}` : "",
      risks.length ? `需要留意：${risks.join("、")}` : "",
    ].filter(Boolean),
    evidence_chips: topEvidenceTags(reputation),
    source_type: reputation.source_type || "",
    note: "评分和评论分布若标记为 demo_constructed，仅用于产品原型和 OpenClaw skill 评测。",
  };
}

function merchantCompareCard(context = {}) {
  const merchants = context.merchants || [];
  return {
    type: "merchant_compare_card",
    skill: "merchant_compare",
    title: "商家对比证据",
    subtitle: merchants.map((item) => item.merchant?.name).filter(Boolean).join(" vs "),
    merchants: merchants.map((item) => ({
      merchant_id: item.merchant?.merchant_id,
      name: item.merchant?.name,
      rating: ratingText(item.merchant_reputation || {}),
      scene: item.merchant?.scene || "",
      tags: topEvidenceTags(item.merchant_reputation || {}, 2),
      specialties: (item.merchant?.specialties || []).slice(0, 4),
      risks: (item.merchant_reputation?.negative_signals || []).slice(0, 2).map((signal) => signal.signal),
    })),
    note: "后端没有选择 winner；小汪会基于这些证据和你的偏好说明取舍。",
  };
}

function currentMerchantIdFromContext(context = {}) {
  const current = compactCurrentContext(context);
  return current?.current_merchant?.merchant_id || "";
}

async function merchantIdsFromSkillCall({call, message, currentContext}) {
  const args = call.args || {};
  const rawMerchantRefs = [
    ...(Array.isArray(args.merchant_ids || args.merchantIds) ? (args.merchant_ids || args.merchantIds) : []),
    args.merchant_id || args.merchantId,
    args.merchant_name || args.merchantName || "",
    args.left_merchant_name || args.leftMerchantName || "",
    args.right_merchant_name || args.rightMerchantName || "",
  ].filter(Boolean);
  const ids = [
    ...rawMerchantRefs.filter((item) => /^m_futian_\d{3}$/.test(String(item))),
    currentMerchantIdFromContext(currentContext),
    ...(await resolveMerchantIdsFromText([
      message,
      ...rawMerchantRefs,
    ].filter(Boolean).join(" "))),
  ].filter(Boolean);
  return [...new Set(ids)];
}

async function executeMerchantSkillCalls({skillCalls = [], message, userId, dayId, currentContext}) {
  const resultCards = [];
  const traces = [];
  for (const call of skillCalls) {
    if (call.skill === "merchant_intel") {
      const [merchantId] = await merchantIdsFromSkillCall({call, message, currentContext});
      if (!merchantId) {
        resultCards.push({
          type: "merchant_intel_card",
          skill: "merchant_intel",
          title: "小汪还不知道是哪家店",
          subtitle: "可以点开商家卡后再问“这家有什么特色菜”。",
          primary_points: ["也可以直接说店名，比如“川香楼有什么特色菜？”"],
          evidence_chips: [],
        });
        traces.push({skill: call.skill, ok: false, error: "missing_merchant_id"});
        continue;
      }
      const context = await buildMerchantIntelContext({
        userId,
        merchantId,
        sessionId: currentContext?.meal_session_id || currentContext?.mealSessionId || "",
        question: message,
      });
      if (context.ok) resultCards.push(merchantIntelCard(context));
      traces.push({skill: call.skill, ok: Boolean(context.ok), merchant_ids: [merchantId], tool: context.tool || "", error: context.error || ""});
    }
    if (call.skill === "merchant_compare") {
      const merchantIds = (await merchantIdsFromSkillCall({call, message, currentContext})).slice(0, 4);
      if (merchantIds.length < 2) {
        resultCards.push({
          type: "merchant_compare_card",
          skill: "merchant_compare",
          title: "小汪需要至少两家店才能比较",
          subtitle: "你可以说“汪记豆花和川香楼怎么选”。",
          merchants: [],
        });
        traces.push({skill: call.skill, ok: false, error: "need_two_merchants"});
        continue;
      }
      const context = await buildMerchantCompareContext({
        userId,
        merchantIds,
        sessionId: currentContext?.meal_session_id || currentContext?.mealSessionId || "",
        question: message,
      });
      if (context.ok) resultCards.push(merchantCompareCard(context));
      traces.push({skill: call.skill, ok: Boolean(context.ok), merchant_ids: merchantIds, tool: context.tool || "", error: context.error || ""});
    }
  }
  return {resultCards, traces};
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
  const dayId = body.day_id || body.dayId || createDayId(userId, new Date());
  const dayContext = await getDayContext(dayId);
  const currentContext = compactCurrentContext(body.current_context || body.currentContext || {});
  const mealSessionsForSummary = (dayContext?.meal_sessions || []).map(xiaowangMealDiaryItem);
  const latestDreamJob = await getLatestOpenClawJobForDay({userId, dayId});
  const diarySummary = buildDiarySummary({
    mealSessions: mealSessionsForSummary,
    memoryCandidates: pending.candidates || [],
    confirmedPreferences: preferences.preferences || [],
    latestDreamJob,
  });
  let skillCards = [];
  let skillCalls = [];
  let memoryPrompts = [];
  let skillResultCards = [];
  let skillTrace = [];
  let memoryResult = {created_count: 0, candidates: []};
  let content = "";
  let mode = "openclaw_gateway_client";
  let openclawMeta = null;
  let aiMeta = null;
  if (message) {
    try {
      const openclawReply = await getOpenClawChatReply({
        message,
        session,
        pendingCount: pending.count || 0,
        preferenceCount: preferences.count || 0,
        diarySummary,
        preferences: preferences.preferences || [],
        pending: pending.candidates || [],
        currentContext,
      });
      content = openclawReply.content;
      skillCalls = openclawReply.skillCalls || [];
      skillCards = skillCardsFromCalls(skillCalls);
      skillResultCards = openclawReply.skillResultCards || [];
      const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
      skillResultCards = [...skillResultCards, ...executed.resultCards];
      skillTrace = executed.traces;
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
        skill_trace: skillTrace,
      };
    } catch (error) {
      if (isOpenClawTimeout(error)) resetOpenClawGatewayClient();
      openclawMeta = {
        error: error instanceof Error ? error.message : String(error),
      };
      try {
        const arkReply = await getArkChatReply({
          message,
          session,
          pendingCount: pending.count || 0,
          preferenceCount: preferences.count || 0,
          diarySummary,
          preferences: preferences.preferences || [],
          pending: pending.candidates || [],
          currentContext,
        });
        content = arkReply.content;
        skillCalls = arkReply.skillCalls || [];
        skillCards = skillCardsFromCalls(skillCalls);
        skillResultCards = arkReply.skillResultCards || [];
        const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
        skillResultCards = [...skillResultCards, ...executed.resultCards];
        skillTrace = executed.traces;
        memoryPrompts = memoryPromptsFromCalls({
          skillCalls,
          memoryPrompts: arkReply.memoryPrompts || [],
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
        mode = "ark_fallback_after_openclaw_error";
        aiMeta = {
          provider: arkReply.raw?.provider || "ark_doubao",
          model: arkReply.raw?.model || "",
          parse_mode: arkReply.parseMode || "",
          timing: arkReply.raw?.timing || null,
          skill_trace: skillTrace,
        };
      } catch (arkError) {
        skillCards = fallbackSkillCards(message);
        skillCalls = normalizeSkillCalls(skillCards.map((card) => ({skill: card.skill, args: {}})));
        const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
        skillResultCards = executed.resultCards;
        skillTrace = executed.traces;
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
        aiMeta = {
          provider: "ark_doubao",
          error: arkError instanceof Error ? arkError.message : String(arkError),
          raw: arkError?.ai || null,
        };
      }
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
    skill_result_cards: skillResultCards,
    agent_skill_calls: skillCalls,
    memory_prompts: memoryPrompts,
    memory_candidate_created_count: memoryResult.created_count || 0,
    memory_candidates: memoryResult.candidates || [],
    openclaw: openclawMeta,
    ai: aiMeta,
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

function createPendingAssistant({jobId, message}) {
  return {
    id: `pending_${jobId}`,
    role: "assistant",
    content: wantsMerchantCompareSkill(message)
      ? "小汪开始对比商家证据了：先识别店名，再调口碑工具。"
      : wantsMerchantIntelSkill(message)
        ? "小汪开始看这家店的特色和口碑证据了。"
        : "小汪开始思考了：先理解你的问题，再判断要不要调用工具。",
    mode: "openclaw_pending",
    skill_cards: [],
    skill_result_cards: [],
    agent_skill_calls: [],
    openclaw: {
      status: "running",
      parse_mode: "pending",
      progress: [
        "收到消息",
        "准备调用 OpenClaw Gateway client",
        "等待 OpenClaw 判断是否需要 skill",
      ],
    },
    created_at: nowIso(),
  };
}

export function startXiaowangChatJob({body = {}} = {}) {
  const jobId = `xwj_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const createdAt = nowIso();
  const pendingAssistant = createPendingAssistant({jobId, message: body.message || ""});
  const job = {
    ok: true,
    job_id: jobId,
    status: "running",
    created_at: createdAt,
    updated_at: createdAt,
    pending_assistant: pendingAssistant,
    result: null,
    error: null,
  };
  chatJobs.set(jobId, job);
  handleXiaowangChat({body})
    .then((result) => {
      chatJobs.set(jobId, {
        ...job,
        status: "completed",
        updated_at: nowIso(),
        result,
      });
    })
    .catch((error) => {
      chatJobs.set(jobId, {
        ...job,
        status: "failed",
        updated_at: nowIso(),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return {
    ok: true,
    job_id: jobId,
    status: "running",
    pending_assistant: pendingAssistant,
  };
}

export function getXiaowangChatJob(jobId) {
  const job = chatJobs.get(jobId);
  if (!job) {
    return {ok: false, error: "chat_job_not_found"};
  }
  return job;
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
  const latestDreamJob = await getLatestOpenClawJobForDay({userId, dayId});
  const dailySummary = buildDiarySummary({
    mealSessions,
    memoryCandidates,
    confirmedPreferences,
    latestDreamJob,
  });
  return {
    ok: true,
    user_id: userId,
    day_id: dayId,
    day_context: dayContext || null,
    diary_date: dayContext?.date || dayId.match(/^day_(\d{8})_/)?.[1] || "",
    daily_summary: dailySummary,
    meal_sessions: mealSessions,
    memory_candidates: memoryCandidates,
    confirmed_preferences: confirmedPreferences,
    prompts: memoryCandidates.slice(0, 3).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      text: `要不要让小汪记住：${candidate.confirmation_text || candidate.statement}`,
    })),
  };
}
