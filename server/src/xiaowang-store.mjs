import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.mjs";
import { appendXiaowangChatToDayContext, createDayId, getDayContext } from "./session-store.mjs";
import { listConfirmedPreferences, listMemoryCandidates } from "./memory-store.mjs";
import {
  createMemoryObservation,
  listMemoryIntelligenceJobs,
  listMemoryObservations,
  readFoodInsightProfile,
  runMemoryIntelligence,
} from "./memory-intelligence-store.mjs";
import { executeMemoryManageOperations } from "./memory-manager.mjs";
import { requestOpenClawAgent, resetOpenClawGatewayClient } from "./openclaw-gateway-client.mjs";
import { callArkChat } from "./ai/ark-provider.mjs";
import { getLatestOpenClawJobForDay } from "./openclaw-store.mjs";
import { buildDealSearchContext, buildMerchantCompareContext, buildMerchantIntelContext, resolveMerchantIdsFromText } from "./merchant-tools.mjs";

const DEFAULT_USER_ID = "demo_weiyingru";
const CHAT_SCHEMA = "lifepilot.xiaowang_chat.v1";
const DIARY_TIME_ZONE = "Asia/Shanghai";
const chatJobs = new Map();
const SKILL_REGISTRY = [
  {
    skill: "meal_swipe",
    title: "饭点滑卡",
    description: "打开饭点滑卡产品流程。",
    trigger_examples: ["今天吃什么", "帮我选饭", "不知道吃啥", "我想吃川菜"],
    action: "open_meal_entry",
    cta: "去确认需求",
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
    skill: "memory_manage",
    title: "管理记忆",
    description: "把用户在聊天里明确表达的记忆确认、新增、修改、删除、暂停或查询意图转成结构化 memory ledger 操作。",
    trigger_examples: ["可以确认下来", "刚刚那条别记了", "把排队久那条改一下"],
    action: "memory_manage",
    cta: "已处理",
    runtime: "openclaw_gateway_client",
    status: "available",
  },
  {
    skill: "diary_review",
    title: "小汪日记本",
    description: "查看今日小结、本周小结、食物选择画像和待确认偏好。",
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
  {
    skill: "deal_search",
    title: "优惠和团购",
    description: "查询 LifePilot 可控优惠证据，估算券后人均、适合人数、省多少钱和限制条件。",
    trigger_examples: ["这家有团购吗", "两个人怎么吃更划算", "有没有优惠券"],
    action: "show_deals",
    cta: "看优惠证据",
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

function publicChatMessage(message = {}) {
  return {
    id: message.id || "",
    role: message.role || "",
    content: message.content || "",
    mode: message.mode || "",
    skill_cards: Array.isArray(message.skill_cards) ? message.skill_cards : [],
    skill_result_cards: Array.isArray(message.skill_result_cards) ? message.skill_result_cards : [],
    agent_skill_calls: Array.isArray(message.agent_skill_calls) ? message.agent_skill_calls : [],
    memory_candidate_created_count: Number(message.memory_candidate_created_count || 0),
    memory_operation_result: message.memory_operation_result || null,
    openclaw: message.openclaw || null,
    ai: message.ai || null,
    created_at: message.created_at || "",
  };
}

function publicChatSession(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const latestUser = [...messages].reverse().find((message) => message?.role === "user");
  return {
    session_id: session.session_id || "",
    user_id: session.user_id || DEFAULT_USER_ID,
    title: session.title || titleFromMessage(latestUser?.content || ""),
    summary: session.summary || "",
    latest_user_message: latestUser?.content || "",
    message_count: messages.length,
    created_at: session.created_at || "",
    updated_at: session.updated_at || session.created_at || "",
  };
}

export async function listXiaowangChatSessions({userId = DEFAULT_USER_ID, limit = 24} = {}) {
  if (!existsSync(chatRoot())) {
    return {ok: true, user_id: userId, sessions: []};
  }
  const files = await readdir(chatRoot());
  const sessions = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const session = JSON.parse(await readFile(path.join(chatRoot(), file), "utf8"));
      if (userId && session.user_id && session.user_id !== userId) continue;
      sessions.push(publicChatSession(session));
    } catch {
      // Ignore incomplete runtime files; history is a convenience view.
    }
  }
  sessions.sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  return {
    ok: true,
    user_id: userId,
    sessions: sessions.slice(0, Number(limit || 24)),
  };
}

export async function getXiaowangChatSession({sessionId, userId = DEFAULT_USER_ID} = {}) {
  const session = await readChatSession(sessionId);
  if (!session || (userId && session.user_id && session.user_id !== userId)) {
    return {ok: false, error: "chat_session_not_found"};
  }
  return {
    ok: true,
    session: publicChatSession(session),
    messages: (session.messages || []).map(publicChatMessage),
  };
}

function wantsMealSkill(text) {
  return /(滑卡|选饭|吃什么|推荐|帮我选|饭点|挑饭|不知道吃啥|不知道吃什么)/.test(text);
}

function wantsGenericMealEntrySkill(text) {
  return /(不知道吃啥|不知道吃什么|吃什么|吃啥|帮我选饭|帮我选|没想法|没主意|随便吃点|挑饭)/.test(text);
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

function wantsDealSearchSkill(text) {
  return /(团购|优惠|优惠券|券后|套餐|省钱|划算|便宜|怎么吃更值|怎么吃更省|怎么买更划算|领券)/.test(text);
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
    skill_cards: Array.isArray(parsed.skill_cards || parsed.skillCards)
      ? (parsed.skill_cards || parsed.skillCards)
      : [],
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

function normalizeOpenClawPromptMode(value = "") {
  const mode = String(value || "").trim();
  return mode === "full" ? "full" : "workspace_minimal";
}

function frontendSkillCardContract() {
  return [
    "前端可渲染的 skill_cards action 契约：",
    "- 饭点泛需求：{skill:\"meal_swipe\", action:\"open_meal_entry\", cta:\"去确认需求\", payload:{prefill_text:\"用户原话\"}}",
    "- 饭点商户卡：{skill:\"meal_swipe\", action:\"open_meal_session\", cta:\"开始滑卡\", payload:{session_id:\"meal_...\", entry_mode:\"offer_only|merchant_compare\"}}",
    "- 汪记本：{skill:\"diary_review\", action:\"open_diary\", cta:\"打开汪记本\", payload:{}}",
    "- 复盘：{skill:\"openclaw_dreaming\", action:\"run_dreaming\", cta:\"开始复盘\", payload:{day_id:\"day_...\"}}",
    "- 其他证据卡优先放 skill_result_cards；只有需要打开产品页面时才放 skill_cards。",
  ].join("\n");
}

function buildOpenClawChatMessage({message, session, userId = DEFAULT_USER_ID, dayId = "", pendingCount, preferenceCount, diarySummary = null, preferences = [], pending = [], currentContext = null, promptMode = "workspace_minimal", target = "openclaw"} = {}) {
  const context = recentChatContext(session.messages || []);
  const openClawApiBase = (process.env.LIFEPILOT_OPENCLAW_API_BASE || process.env.LIFEPILOT_PUBLIC_API_BASE || `http://${config.host}:${config.port}`).replace(/\/$/, "");
  const mode = normalizeOpenClawPromptMode(promptMode);
  const includeRoutingDetails = target === "ark_fallback" || mode === "full";
  const fullSkills = SKILL_REGISTRY.map((skill) => (
    `- ${skill.skill}: ${skill.description} action=${skill.action} cta=${skill.cta} status=${skill.status}`
  )).join("\n");
  const preferenceText = preferences.slice(0, 6)
    .map((item) => `- ${item.confirmation_text || item.statement}`)
    .join("\n") || "暂无";
  const pendingText = pending.slice(0, 4)
    .map((item) => `- ${item.confirmation_text || item.statement}`)
    .join("\n") || "暂无";
  const baseLines = [
    "你是 LifePilot 小汪。",
    "",
    includeRoutingDetails
      ? "用户正在和小汪聊天。你需要判断是否调用 LifePilot 产品 skill。"
      : "请按 OpenClaw workspace 的 SOUL.md、AGENTS.md、TOOLS.md 和 skills/*/SKILL.md 判断业务动作；本消息只提供动态上下文和前端输出契约。",
    "请只输出 JSON，不要加 Markdown，不要解释 JSON。",
    "",
    "JSON schema:",
    "{\"message\":\"小汪要发给用户的一段自然回复，最多 3 句。\",\"skill_calls\":[],\"skill_cards\":[],\"skill_result_cards\":[],\"memory_prompts\":[]}",
    "",
    "不要暴露 gateway、runner、transport、schema、OpenClaw 等内部实现。",
    `OpenClaw 工具调用 LifePilot API 时必须使用这个 api base：${openClawApiBase}`,
    `当前 user_id：${userId}`,
    `调用任何 LifePilot Python skill 脚本时，必须显式传入 --user-id ${userId}；不要使用 demo_weiyingru、示例占位符或空 user_id。`,
    `当前 day_id：${dayId || "暂无"}`,
    "",
    frontendSkillCardContract(),
  ];
  const fullRoutingLines = [
    "可用 LifePilot tool ids（当前 JSON 兼容层仍使用 snake_case；OpenClaw skill 目录使用 hyphen 命名）:",
    fullSkills,
    "",
    "不要再通过二级 router skill 处理。",
    "记忆规则：自然语言理解和目标选择由你完成；LifePilot 后端只执行结构化 memory_manage，不会帮你用规则猜用户意思。",
    "如果用户只是表达可能的长期偏好、但没有明确要求确认/写入，用 memory_capture 生成待确认候选，并在 memory_prompts 中给出待确认文本。",
    "如果用户明确说可以确认、记住、改一下、删掉、暂停、先不记、或查询记忆，使用 memory_manage。不要让用户再去汪记本点确认。",
    "memory_manage args.operation 支持 list_memory、create_confirmed_preference、confirm_pending、confirm_latest_pending、reject_pending、update_preference、delete_preference、pause_preference。",
    "memory_manage args.target 可带 candidate_id/preference_id/match_text；如果用户说“刚刚那条/可以确认下来”，优先用 confirm_latest_pending。",
    "无待确认候选且用户明确要求记住某个偏好时，用 create_confirmed_preference，并给出 confirmation_text 或 statement。",
    "饭点滑卡入口由 OpenClaw 判断，不由 LifePilot 后端按固定话术路由。",
    "泛需求（如不知道吃什么、帮我选饭、没想法）不要直接创建 session；返回 skill_cards: [{skill:\"meal_swipe\", action:\"open_meal_entry\", cta:\"去确认需求\", payload:{prefill_text:\"用户原话\"}}]。",
    "明确需求（如想吃川菜、找环境好/少排队/附近/适合聊天的店）应调用 meal-swipe skill 脚本创建 offer-stage session，再返回脚本输出的 open_meal_session skill card。",
    "点名两家或多家商户对比时，先调用 merchant-compare 证据工具；若用户适合继续滑卡比较，再调用 meal-swipe start-offer-flow 并传 candidate_merchant_ids，只比较这些商户。",
    "如果用户问某家店的特色菜、口味、排队、适合几个人吃，优先调用 merchant-intel skill 的脚本：python3 skills/merchant-intel/scripts/merchant_intel_tool.py --api-base 上面的_api_base ...，读取工具结果后再生成 message。",
    "如果用户问两家或多家店怎么选、哪家更好吃、类似店对比，优先调用 merchant-compare skill 的脚本：python3 skills/merchant-compare/scripts/merchant_compare_tool.py --api-base 上面的_api_base ...，读取工具结果后再生成 message。",
    "如果用户问团购、优惠、券后、人均、省钱、怎么吃更划算，优先调用 deal-search skill 的脚本：python3 skills/deal-search/scripts/deal_search_tool.py --api-base 上面的_api_base ...，读取工具结果后再生成 message。",
    "deal_search 只查询 LifePilot 可控优惠证据，不代表真实平台实时库存、可领取或可核销；如果用户说“帮我领券”，说明当前只能查看优惠线索，领券是后续独立 coupon-wallet 能力。",
    "merchant_intel / merchant_compare / deal_search 的最终解释应由 OpenClaw 基于工具证据生成，不要让 LifePilot 后端替你下结论；使用脚本拿到证据后，最终 JSON 里 skill_calls 应尽量返回空数组，skill_result_cards 放脚本返回的证据卡。",
    "商户评分、评论数和口碑分布必须来自 LifePilot 工具证据；只有当工具调用不可用时，才用 skill_calls 作为临时兼容层。",
    "如果当前上下文里有 current_merchant，用户说“这家/这店”时优先使用它的 merchant_id。",
    "如果不需要 skill，skill_calls 返回空数组。",
  ];
  return [
    ...baseLines,
    "",
    ...(includeRoutingDetails ? fullRoutingLines : [
      "如果不需要 skill，skill_calls、skill_cards、skill_result_cards 和 memory_prompts 返回空数组。",
      "业务路由、脚本调用和产品边界以 OpenClaw workspace 文件为准，不在本消息重复。",
    ]),
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

async function getOpenClawChatReply({message, session, userId, dayId, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext, promptMode}) {
  const result = await requestOpenClawAgent({
    sessionId: `lifepilot-chat-${session.session_id}`,
    timeoutSeconds: process.env.LIFEPILOT_XIAOWANG_OPENCLAW_TIMEOUT_SECONDS || 90,
    idempotencyKey: `lifepilot-chat-${session.session_id}-${Date.now()}-${randomUUID().slice(0, 6)}`,
    message: buildOpenClawChatMessage({message, session, userId, dayId, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext, promptMode, target: "openclaw"}),
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
    skillCards: response.skill_cards || [],
    skillResultCards: response.skill_result_cards || [],
    memoryPrompts: response.memory_prompts,
    parseMode: response.parse_mode,
    promptMode: normalizeOpenClawPromptMode(promptMode),
    raw: result,
  };
}

function isOpenClawTimeout(error) {
  return /timeout/i.test(error instanceof Error ? error.message : String(error));
}

async function getArkChatReply({message, session, userId, dayId, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext, promptMode}) {
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
        content: buildOpenClawChatMessage({message, session, userId, dayId, pendingCount, preferenceCount, diarySummary, preferences, pending, currentContext, promptMode, target: "ark_fallback"}),
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
    skillCards: response.skill_cards || [],
    skillResultCards: response.skill_result_cards || [],
    memoryPrompts: response.memory_prompts,
    parseMode: response.parse_mode,
    promptMode: normalizeOpenClawPromptMode(promptMode),
    raw: ai,
  };
}

function fallbackSkillCards(message) {
  return [
    wantsDealSearchSkill(message) ? skillCard("deal_search") : null,
    wantsMerchantCompareSkill(message) ? skillCard("merchant_compare") : null,
    wantsMerchantIntelSkill(message) ? skillCard("merchant_intel") : null,
    wantsGenericMealEntrySkill(message) ? skillCard("meal_swipe") : null,
    wantsDiarySkill(message) ? skillCard("diary_review") : null,
  ].filter(Boolean);
}

function skillCardsFromCalls(skillCalls = []) {
  return normalizeSkillCalls(skillCalls)
    .filter((call) => !["merchant_intel", "merchant_compare", "deal_search", "memory_manage"].includes(call.skill))
    .map((call) => {
      const card = skillCard(call.skill);
      if (!card) return null;
      const args = call.args || {};
      return {
        ...card,
        action: args.action || card.action,
        payload: args.payload || args,
      };
    })
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

function xiaowangObservationItem(observation = {}) {
  const time = formatDiaryDateTime(observation.updated_at || observation.created_at);
  return {
    ...observation,
    ...time,
    diary_title: observation.type === "weak_hypothesis" ? "小汪的弱假设" : "小汪观察",
    diary_text: observation.summary || observation.text || "",
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

function buildWeeklySummary({latestWeekJob = null} = {}) {
  if (latestWeekJob?.summary) {
    return {
      source: "memory_intelligence_week_dreaming",
      text: latestWeekJob.summary,
      job_id: latestWeekJob.job_id || "",
      updated_at: latestWeekJob.stored_at || "",
    };
  }
  return {
    source: "empty",
    text: "本周小结还没生成。等小汪多复盘几次，会把这一周的吃饭模式整理在这里。",
    job_id: "",
    updated_at: "",
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

function moneyText(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `¥${Math.round(number * 10) / 10}` : "";
}

function dealPartyText(deal = {}) {
  const min = deal.party_size_min;
  const max = deal.party_size_max;
  if (min && max && min === max) return `${min} 人`;
  if (min && max) return `${min}-${max} 人`;
  if (min) return `${min} 人起`;
  if (max) return `最多 ${max} 人`;
  return "";
}

function discountText(deal = {}) {
  const title = String(deal.title || "");
  const matched = title.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/);
  if (matched) return `满 ${matched[1]} 减 ${matched[2]}`;
  const original = Number(deal.original_price);
  const price = Number(deal.deal_price);
  if (Number.isFinite(original) && Number.isFinite(price) && original > price) {
    return `省 ${moneyText(original - price)}`;
  }
  return deal.deal_type === "set_meal" ? "套餐优惠" : "优惠线索";
}

function dealRecommendation(deal = {}) {
  const bestFor = (deal.best_for || []).find(Boolean);
  const perPerson = moneyText(deal.deal_price_per_person) || moneyText(deal.deal_price);
  if (bestFor && perPerson) return `${bestFor}，券后约 ${perPerson} / 人，去之前再确认可用状态。`;
  if (bestFor) return `${bestFor}，去之前再确认可用状态。`;
  return "适合想先把预算压住的一顿，去之前再确认可用状态。";
}

function dealSearchCard(context = {}) {
  const merchants = context.merchants || [];
  const allDeals = merchants.flatMap((item) => (item.deals || []).map((deal) => ({
    ...deal,
    merchant_name: item.merchant?.name || "",
  }))).slice(0, 5);
  const topDeal = allDeals[0] || null;
  const noDealNotes = merchants.map((item) => item.no_deal_note).filter(Boolean);
  return {
    type: "deal_card",
    skill: "deal_search",
    title: topDeal ? (topDeal.merchant_name || "优惠线索") : "暂无可用优惠",
    merchant_name: topDeal?.merchant_name || merchants.map((item) => item.merchant?.name).filter(Boolean).join("、") || "需要先选定商家",
    poster_url: topDeal?.poster_url || topDeal?.image_url || "",
    image_url: topDeal?.image_url || topDeal?.poster_url || "",
    discount_text: topDeal ? discountText(topDeal) : "",
    deal_price_text: topDeal ? (moneyText(topDeal.deal_price_per_person) || moneyText(topDeal.deal_price)) : "",
    menu_text: topDeal ? (topDeal.included_items || []).slice(0, 4).join("、") : "",
    recommendation: topDeal ? dealRecommendation(topDeal) : (noDealNotes[0] || "当前没有查到可展示的优惠线索。"),
    subtitle: "",
    summary: topDeal
      ? `${discountText(topDeal)} · 券后约 ${moneyText(topDeal.deal_price_per_person) || moneyText(topDeal.deal_price)} / 人`
      : (noDealNotes[0] || "当前种子证据库里没有查到匹配优惠。"),
    primary_points: [],
    evidence_chips: [],
    deals: allDeals.map((deal) => ({
      deal_id: deal.deal_id,
      merchant_id: deal.merchant_id,
      merchant_name: deal.merchant_name,
      title: deal.title,
      deal_type: deal.deal_type,
      poster_url: deal.poster_url || deal.image_url || "",
      image_url: deal.image_url || deal.poster_url || "",
      discount_text: discountText(deal),
      menu_text: (deal.included_items || []).slice(0, 4).join("、"),
      recommendation: dealRecommendation(deal),
      deal_price: moneyText(deal.deal_price),
      original_price: moneyText(deal.original_price),
      deal_price_per_person: moneyText(deal.deal_price_per_person),
      estimated_savings_per_person: moneyText(deal.estimated_savings_per_person),
      party_text: dealPartyText(deal),
      included_items: (deal.included_items || []).slice(0, 4),
      best_for: (deal.best_for || []).slice(0, 3),
      restrictions: (deal.restrictions || []).slice(0, 3),
      source_label: deal.source_label || deal.source_type || "",
      data_checked_at: deal.data_checked_at || "",
      confidence_text: deal.confidence ? `${Math.round(deal.confidence * 100)}%` : "",
      caveats: (deal.caveats || []).slice(0, 2),
    })),
    no_deal_notes: noDealNotes,
    source_type: topDeal?.source_type || "",
    note: "这是 LifePilot 可控优惠线索，不代表真实平台实时库存、可领取或可核销；下单前仍需二次确认。",
  };
}

function currentMerchantIdFromContext(context = {}) {
  const current = compactCurrentContext(context);
  return current?.current_merchant?.merchant_id || "";
}

async function merchantIdsFromSkillCall({call, message, currentContext}) {
  const args = call.args || {};
  const merchantNameList = Array.isArray(args.merchant_names || args.merchantNames)
    ? (args.merchant_names || args.merchantNames)
    : [];
  const rawMerchantRefs = [
    ...(Array.isArray(args.merchant_ids || args.merchantIds) ? (args.merchant_ids || args.merchantIds) : []),
    ...merchantNameList,
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
    if (call.skill === "deal_search") {
      const args = call.args || {};
      const merchantIds = (await merchantIdsFromSkillCall({call, message, currentContext})).slice(0, 4);
      const contextMerchantId = currentMerchantIdFromContext(currentContext);
      if (!merchantIds.length && !contextMerchantId) {
        resultCards.push({
          type: "deal_card",
          skill: "deal_search",
          title: "小汪还不知道要查哪家店",
          subtitle: "可以点开商家卡后问“这家有优惠吗”，或者直接说店名。",
          primary_points: ["如果你问的是“附近哪家更划算”，小汪需要先有候选商家列表。"],
          deals: [],
          note: "当前不做真实平台实时搜索，也不会编造团购。",
        });
        traces.push({skill: call.skill, ok: false, error: "missing_merchant_id"});
        continue;
      }
      const context = await buildDealSearchContext({
        userId,
        merchantIds,
        merchantNames: args.merchant_names || args.merchantNames || args.merchant_name || args.merchantName || [],
        sessionId: currentContext?.meal_session_id || currentContext?.mealSessionId || "",
        question: message,
        partySize: args.party_size || args.partySize,
        budget: args.budget || args.budget_per_person || args.budgetPerPerson || args.max_price_per_person || args.maxPricePerPerson,
        mealTime: args.meal_time || args.mealTime || "",
        currentMerchantId: contextMerchantId,
      });
      if (context.ok) resultCards.push(dealSearchCard(context));
      traces.push({skill: call.skill, ok: Boolean(context.ok), merchant_ids: merchantIds.length ? merchantIds : [contextMerchantId].filter(Boolean), tool: context.tool || "", error: context.error || ""});
    }
  }
  return {resultCards, traces};
}

async function reviewMemoryPromptsAsObservations({userId, sessionId, dayId, message, skillCalls = [], memoryPrompts = []}) {
  const prompts = memoryPromptsFromCalls({skillCalls, memoryPrompts, message})
    .map((item) => ({
      text: String(item?.text || "").trim(),
      confirmation_text: String(item?.confirmation_text || item?.confirmationText || item?.text || "").trim(),
    }))
    .filter((item) => item.confirmation_text);

  if (!prompts.length) {
    return {
      created_count: 0,
      candidates: [],
      observations: [],
      intelligence_jobs: [],
    };
  }

  const observations = [];
  const jobs = [];
  const candidates = [];
  for (const prompt of prompts.slice(0, 3)) {
    const observationResult = await createMemoryObservation({
      userId,
      body: {
        day_id: dayId,
        source: "xiaowang_chat",
        type: "explicit_memory_prompt",
        text: prompt.confirmation_text,
        summary: `主人在问小汪时提到：${prompt.confirmation_text}`,
        confidence: 0.78,
        tags: ["待确认偏好", "小汪聊天"],
        source_event: {
          source: "xiaowang_chat",
          session_id: sessionId,
          day_id: dayId,
          reason: message || prompt.confirmation_text,
        },
      },
    });
    if (!observationResult.ok) continue;
    observations.push(observationResult.observation);
    const intelligence = await runMemoryIntelligence({
      mode: "instant_review",
      userId,
      dayId,
      observationId: observationResult.observation.observation_id,
      source: "xiaowang_memory_capture",
    });
    if (intelligence?.job) {
      jobs.push(intelligence.job);
      candidates.push(...(intelligence.job.accepted_memory_candidates || []));
    }
  }
  return {
    created_count: candidates.length,
    candidates,
    observations,
    intelligence_jobs: jobs,
  };
}

async function executeMemoryManageSkillCalls({skillCalls = [], userId}) {
  const memoryCalls = skillCalls.filter((item) => item.skill === "memory_manage");
  if (!memoryCalls.length) {
    return {ok: true, count: 0, success_count: 0, results: []};
  }
  return executeMemoryManageOperations({userId, operations: memoryCalls});
}

function memoryManageTrace(memoryOperation = {}) {
  return (memoryOperation.results || []).map((result) => ({
    skill: "memory_manage",
    ok: Boolean(result.ok),
    operation: result.operation || "",
    result_summary: result.result_summary || "",
    error: result.error || "",
    preference_id: result.preference?.preference_id || "",
    candidate_id: result.candidate?.candidate_id || "",
  }));
}

function contentAfterMemoryOperation(content, memoryOperation = {}) {
  const results = memoryOperation.results || [];
  if (!results.length) return content;
  const failed = results.find((item) => !item.ok);
  if (failed) {
    return `这次记忆操作没成功：${failed.error || "后端没有写入成功"}。你可以换个说法，或者去汪记本里手动处理。`;
  }
  const latest = results[results.length - 1];
  if (latest?.operation === "list_memory") {
    return content;
  }
  if (latest?.result_summary) {
    return `好，${String(latest.result_summary).replace(/[。！？.!?]+$/u, "")}。`;
  }
  return content;
}

export async function handleXiaowangChat({body = {}, onProgress = null} = {}) {
  const reportProgress = typeof onProgress === "function" ? onProgress : () => {};
  const userId = body.user_id || body.userId || DEFAULT_USER_ID;
  const message = String(body.message || "").trim();
  const createdAt = nowIso();
  reportProgress({step: "context", label: "正在读取今天的日记、待确认记忆和已确认偏好"});
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
  const promptMode = normalizeOpenClawPromptMode(body.openclaw_prompt_mode || body.openclawPromptMode || process.env.LIFEPILOT_XIAOWANG_OPENCLAW_PROMPT_MODE);
  const mealSessionsForSummary = (dayContext?.meal_sessions || []).map(xiaowangMealDiaryItem);
  const latestDreamJob = await getLatestOpenClawJobForDay({userId, dayId});
  reportProgress({step: "context_ready", label: "已整理今日上下文，准备交给 OpenClaw 判断"});
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
  let memoryOperation = {ok: true, count: 0, success_count: 0, results: []};
  let content = "";
  let mode = "openclaw_gateway_client";
  let openclawMeta = null;
  let aiMeta = null;
  if (message) {
    try {
      reportProgress({step: "openclaw", label: "正在调用 OpenClaw 判断是否需要产品 skill"});
      const openclawReply = await getOpenClawChatReply({
        message,
        session,
        userId,
        dayId,
        pendingCount: pending.count || 0,
        preferenceCount: preferences.count || 0,
        diarySummary,
        preferences: preferences.preferences || [],
        pending: pending.candidates || [],
        currentContext,
        promptMode,
      });
      content = openclawReply.content;
      skillCalls = openclawReply.skillCalls || [];
      reportProgress({
        step: "openclaw_done",
        label: skillCalls.length
          ? `OpenClaw 选择调用 ${skillCalls.map((item) => item.skill).filter(Boolean).join("、")}`
          : "OpenClaw 已完成判断，本轮不需要额外工具",
        skillCalls,
        runId: openclawReply.raw?.runId || "",
        parseMode: openclawReply.parseMode || "",
      });
      skillCards = (openclawReply.skillCards && openclawReply.skillCards.length) ? openclawReply.skillCards : skillCardsFromCalls(skillCalls);
      skillResultCards = openclawReply.skillResultCards || [];
      if (skillCalls.length) {
        reportProgress({step: "skill_running", label: "正在调用 LifePilot 工具读取商户、优惠或记忆证据", skillCalls});
      }
      const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
      skillResultCards = [...skillResultCards, ...executed.resultCards];
      skillTrace = executed.traces;
      if (executed.traces.length) {
        reportProgress({step: "skill_done", label: "工具证据已返回，正在整理给主人的回复", skillTrace});
      }
      if (skillCalls.some((item) => item.skill === "memory_manage")) {
        reportProgress({step: "memory_manage", label: "正在执行记忆确认、修改或删除操作", skillCalls});
      }
      memoryOperation = await executeMemoryManageSkillCalls({skillCalls, userId});
      skillTrace = [...skillTrace, ...memoryManageTrace(memoryOperation)];
      memoryPrompts = memoryPromptsFromCalls({
        skillCalls,
        memoryPrompts: openclawReply.memoryPrompts || [],
        message,
      });
      if (skillCalls.some((item) => item.skill === "memory_capture")) {
        reportProgress({step: "memory_capture", label: "正在把可记住的偏好整理成待确认记忆", skillCalls});
        memoryResult = await reviewMemoryPromptsAsObservations({
          userId,
          sessionId: session.session_id,
          dayId,
          message,
          skillCalls,
          memoryPrompts,
        });
      }
      content = contentAfterMemoryOperation(content, memoryOperation);
      reportProgress({step: "finalizing", label: "正在整理最终回复和可点击卡片", skillCalls, skillTrace});
      mode = "openclaw_gateway_client";
      openclawMeta = {
        status: openclawReply.raw?.status || "",
        run_id: openclawReply.raw?.runId || "",
        parse_mode: openclawReply.parseMode || "",
        prompt_mode: openclawReply.promptMode || promptMode,
        skill_trace: skillTrace,
      };
    } catch (error) {
      if (isOpenClawTimeout(error)) resetOpenClawGatewayClient();
      reportProgress({
        step: "openclaw_error",
        label: "OpenClaw 暂时不可用，正在切到 Ark 兜底",
        error: error instanceof Error ? error.message : String(error),
      });
      openclawMeta = {
        error: error instanceof Error ? error.message : String(error),
        prompt_mode: promptMode,
      };
      try {
        reportProgress({step: "ark_fallback", label: "正在用 Ark 兜底理解问题和判断 skill"});
        const arkReply = await getArkChatReply({
          message,
          session,
          userId,
          dayId,
          pendingCount: pending.count || 0,
          preferenceCount: preferences.count || 0,
          diarySummary,
          preferences: preferences.preferences || [],
          pending: pending.candidates || [],
          currentContext,
          promptMode,
        });
        content = arkReply.content;
        skillCalls = (arkReply.skillCalls || []).filter((item) => item.skill !== "memory_manage");
        reportProgress({
          step: "ark_done",
          label: skillCalls.length
            ? `Ark 兜底选择调用 ${skillCalls.map((item) => item.skill).filter(Boolean).join("、")}`
            : "Ark 兜底已完成判断，本轮不需要额外工具",
          skillCalls,
        });
        skillCards = (arkReply.skillCards && arkReply.skillCards.length) ? arkReply.skillCards : skillCardsFromCalls(skillCalls);
        skillResultCards = arkReply.skillResultCards || [];
        if (skillCalls.length) {
          reportProgress({step: "skill_running", label: "正在调用 LifePilot 工具读取证据", skillCalls});
        }
        const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
        skillResultCards = [...skillResultCards, ...executed.resultCards];
        skillTrace = executed.traces;
        if (executed.traces.length) {
          reportProgress({step: "skill_done", label: "工具证据已返回，正在整理兜底回复", skillTrace});
        }
        memoryPrompts = memoryPromptsFromCalls({
          skillCalls,
          memoryPrompts: arkReply.memoryPrompts || [],
          message,
        });
        if (skillCalls.some((item) => item.skill === "memory_capture")) {
          reportProgress({step: "memory_capture", label: "正在把可记住的偏好整理成待确认记忆", skillCalls});
          memoryResult = await reviewMemoryPromptsAsObservations({
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
          prompt_mode: arkReply.promptMode || promptMode,
          timing: arkReply.raw?.timing || null,
          skill_trace: skillTrace,
        };
      } catch (arkError) {
        reportProgress({step: "local_fallback", label: "AI 兜底也失败了，正在用本地规则生成可用回复"});
        skillCards = fallbackSkillCards(message);
        skillCalls = normalizeSkillCalls(skillCards.map((card) => ({skill: card.skill, args: {}})));
        if (skillCalls.length) {
          reportProgress({step: "skill_running", label: "正在用本地规则调用可用工具", skillCalls});
        }
        const executed = await executeMerchantSkillCalls({skillCalls, message, userId, dayId, currentContext});
        skillResultCards = executed.resultCards;
        skillTrace = executed.traces;
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
          prompt_mode: promptMode,
          raw: arkError?.ai || null,
        };
      }
    }
  } else {
    mode = "local_empty_message";
    reportProgress({step: "empty_message", label: "没有收到有效文本，正在返回本地提示"});
    content = buildAssistantReply({
      message,
      pendingCount: pending.count || 0,
      preferenceCount: preferences.count || 0,
      skillCards,
      createdCount: memoryResult.created_count || 0,
    });
  }

  reportProgress({step: "saving", label: "正在保存这次聊天记录和日记索引"});
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
    memory_operation_result: memoryOperation,
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
  await appendXiaowangChatToDayContext({
    dayId,
    userId,
    chat: {
      session_id: session.session_id,
      user_id: userId,
      title: session.title,
      summary: session.summary,
      latest_user_message: message,
      message_count: session.messages.length,
      memory_candidate_created_count: memoryResult.created_count || 0,
      skill_calls: skillCalls.map((item) => item.skill).filter(Boolean),
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
  });
  reportProgress({step: "done", label: "回复已准备好"});

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
        "小汪正在理解这句话",
        "小汪正在判断要不要调用产品 skill",
      ],
    },
    created_at: nowIso(),
  };
}

function normalizeProgressSkillCalls(skillCalls = []) {
  return normalizeSkillCalls(skillCalls).map((item) => ({
    skill: item.skill,
    action: skillByName(item.skill)?.action || "",
  }));
}

function normalizeProgressSkillTrace(skillTrace = []) {
  return (Array.isArray(skillTrace) ? skillTrace : []).map((trace) => ({
    skill: trace.skill || "",
    ok: Boolean(trace.ok),
    error: trace.error || "",
    merchant_ids: Array.isArray(trace.merchant_ids) ? trace.merchant_ids : [],
    tool: trace.tool || "",
  })).filter((trace) => trace.skill || trace.tool || trace.error);
}

function appendUniqueProgress(lines = [], nextLine = "") {
  const line = String(nextLine || "").trim();
  if (!line) return lines;
  const result = [...(Array.isArray(lines) ? lines : [])];
  if (!result.includes(line)) result.push(line);
  return result.slice(-8);
}

function skillDisplayName(skill = "") {
  return ({
    meal_swipe: "饭点滑卡",
    memory_capture: "记忆候选",
    memory_manage: "记忆管理",
    diary_review: "汪记本",
    openclaw_dreaming: "复盘",
    merchant_intel: "商家理解",
    merchant_compare: "商家对比",
    deal_search: "优惠查询",
  })[skill] || skill || "工具";
}

function skillListLabel(skillCalls = []) {
  const names = normalizeProgressSkillCalls(skillCalls)
    .map((item) => skillDisplayName(item.skill))
    .filter(Boolean);
  return [...new Set(names)].join("、");
}

function agentFacingProgressLabel(patch = {}) {
  const skillNames = skillListLabel(patch.skillCalls || []);
  const traceNames = normalizeProgressSkillTrace(patch.skillTrace || [])
    .map((item) => skillDisplayName(item.skill || item.tool))
    .filter(Boolean);
  const traceLabel = [...new Set(traceNames)].join("、");
  switch (patch.step) {
    case "context":
      return "小汪正在翻看今天的记忆线索";
    case "context_ready":
      return "小汪拿到了今日记忆和最近对话";
    case "openclaw":
      return "小汪正在理解问题并选择下一步";
    case "openclaw_done":
      return skillNames ? `小汪决定使用 ${skillNames}` : "小汪决定直接回答";
    case "skill_running":
      return skillNames ? `小汪正在使用 ${skillNames}` : "小汪正在使用工具查证据";
    case "skill_done":
      return traceLabel ? `小汪拿到了 ${traceLabel} 的结果` : "小汪拿到了工具结果";
    case "memory_manage":
      return "小汪正在处理记忆确认或修改";
    case "memory_capture":
      return "小汪正在整理可确认的记忆";
    case "openclaw_error":
      return "小汪这次调用不顺，正在切换兜底理解";
    case "ark_fallback":
      return "小汪正在用 Ark 兜底理解";
    case "ark_done":
      return skillNames ? `小汪兜底决定使用 ${skillNames}` : "小汪兜底后决定直接回答";
    case "local_fallback":
      return "小汪正在用本地兜底生成可用回复";
    case "empty_message":
      return "小汪没有收到有效文字，正在准备提示";
    case "saving":
      return "小汪正在保存这次对话";
    case "finalizing":
      return "小汪正在整理回复和可点击卡片";
    case "done":
      return "小汪回复完成";
    default:
      return patch.label || "";
  }
}

function updateChatJobProgress(jobId, patch = {}) {
  const job = chatJobs.get(jobId);
  if (!job || job.status !== "running") return;
  const pendingAssistant = job.pending_assistant || createPendingAssistant({jobId, message: ""});
  const currentOpenClaw = pendingAssistant.openclaw || {};
  const displayLabel = agentFacingProgressLabel(patch);
  const progress = appendUniqueProgress(currentOpenClaw.progress || [], displayLabel);
  const skillCalls = patch.skillCalls ? normalizeProgressSkillCalls(patch.skillCalls) : (pendingAssistant.agent_skill_calls || []);
  const skillTrace = patch.skillTrace ? normalizeProgressSkillTrace(patch.skillTrace) : (currentOpenClaw.skill_trace || []);
  const nextAssistant = {
    ...pendingAssistant,
    content: displayLabel || pendingAssistant.content,
    agent_skill_calls: skillCalls,
    openclaw: {
      ...currentOpenClaw,
      status: "running",
      parse_mode: patch.parseMode || currentOpenClaw.parse_mode || "pending",
      run_id: patch.runId || currentOpenClaw.run_id || "",
      current_step: patch.step || currentOpenClaw.current_step || "",
      progress,
      skill_trace: skillTrace,
      error: patch.error || currentOpenClaw.error || "",
    },
  };
  chatJobs.set(jobId, {
    ...job,
    updated_at: nowIso(),
    current_step: patch.step || job.current_step || "",
    progress,
    tool_trace: skillTrace,
    pending_assistant: nextAssistant,
  });
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
    current_step: "queued",
    progress: pendingAssistant.openclaw.progress || [],
    tool_trace: [],
    result: null,
    error: null,
  };
  chatJobs.set(jobId, job);
  handleXiaowangChat({
    body,
    onProgress: (patch) => updateChatJobProgress(jobId, patch),
  })
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

export async function readXiaowangDiary({userId = DEFAULT_USER_ID, date, includeDayContext = false} = {}) {
  const dayId = createDayId(userId, date ? new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00+08:00`) : new Date());
  const dayContext = await getDayContext(dayId);
  const pending = await listMemoryCandidates({userId, status: "pending"});
  const preferences = await listConfirmedPreferences({userId});
  const observations = await listMemoryObservations({userId, dayId, limit: 12});
  const intelligenceJobs = await listMemoryIntelligenceJobs({userId, dayId, limit: 6});
  const weekJobs = await listMemoryIntelligenceJobs({userId, mode: "week_dreaming", limit: 1});
  let foodInsightProfile = await readFoodInsightProfile({userId});
  const mealSessions = (dayContext?.meal_sessions || [])
    .map(xiaowangMealDiaryItem)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
  const memoryCandidates = (pending.candidates || []).map(xiaowangMemoryCandidateItem);
  const confirmedPreferences = (preferences.preferences || []).map(xiaowangPreferenceItem);
  const observationItems = (observations.observations || []).map(xiaowangObservationItem);
  if ((observationItems.length || confirmedPreferences.length) && Number(foodInsightProfile.confidence || 0) < 0.3) {
    const profileJob = await runMemoryIntelligence({
      mode: "profile_update",
      userId,
      dayId,
      source: "diary_profile_refresh",
    });
    if (profileJob?.profile) foodInsightProfile = profileJob.profile;
  }
  const latestDreamJob = await getLatestOpenClawJobForDay({userId, dayId});
  const dailySummary = buildDiarySummary({
    mealSessions,
    memoryCandidates,
    confirmedPreferences,
    latestDreamJob,
  });
  const weeklySummary = buildWeeklySummary({latestWeekJob: (weekJobs.jobs || [])[0] || null});
  return {
    ok: true,
    user_id: userId,
    day_id: dayId,
    day_context: includeDayContext ? dayContext || null : undefined,
    diary_date: dayContext?.date || dayId.match(/^day_(\d{8})_/)?.[1] || "",
    daily_summary: dailySummary,
    weekly_summary: weeklySummary,
    meal_sessions: mealSessions,
    observations: observationItems,
    memory_intelligence_jobs: intelligenceJobs.jobs || [],
    food_insight_profile: foodInsightProfile,
    memory_candidates: memoryCandidates,
    confirmed_preferences: confirmedPreferences,
    prompts: memoryCandidates.slice(0, 3).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      text: `要不要让小汪记住：${candidate.confirmation_text || candidate.statement}`,
    })),
  };
}
