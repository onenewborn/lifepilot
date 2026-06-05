import { randomUUID } from "node:crypto";
import { requestOpenClawAgent } from "./openclaw-gateway-client.mjs";

const OUTPUT_SCHEMA = {
  mode: "manual_daily_review",
  summary: "",
  observations: [],
  weak_hypotheses: [],
  memory_candidates: [],
  preference_update_suggestions: [],
  food_insight_profile: null,
  xiaowang_next_interaction_ideas: [],
};

function boolFromEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function compactJson(value, max = 26000) {
  const text = JSON.stringify(value || {}, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...<truncated>` : text;
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const first = withoutFence.indexOf("{");
    const last = withoutFence.lastIndexOf("}");
    if (first < 0 || last <= first) return null;
    try {
      return JSON.parse(withoutFence.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

function parseAgentFinalText(result) {
  if (Array.isArray(result?.result?.payloads)) {
    return result.result.payloads.map((payload) => payload.text).filter(Boolean).join("\n\n");
  }
  if (typeof result?.result?.text === "string") return result.result.text;
  if (typeof result?.text === "string") return result.text;
  return "";
}

export function buildMemoryIntelligenceAgentPrompt(input = {}) {
  return [
    "请按 lifepilot-memory-intelligence 的规则完成一次 LifePilot 记忆智能复盘。",
    "",
    "你不是在聊天回复用户，而是在为 LifePilot 后端生成结构化 JSON。",
    "不要调用工具，不要读取文件，不要访问 API；本 prompt 已包含完整输入和输出规则。",
    "",
    "必须遵守：",
    "1. 只根据下面的 memory_intelligence_input 分析，不直接读写产品 runtime 文件。",
    "2. 不要创建 confirmed preference；只输出 pending memory_candidates 或建议。",
    "3. 不要修改 meal session、商户数据或用户账本。",
    "4. 只能输出一个 JSON 对象，不要 Markdown，不要解释。",
    "5. 输出字段必须兼容下面 schema；没有内容就用空数组或 null。",
    "",
    "输出 JSON schema 示例：",
    JSON.stringify(OUTPUT_SCHEMA, null, 2),
    "",
    "memory_intelligence_input:",
    compactJson(input),
  ].join("\n");
}

export async function runOpenClawMemoryIntelligenceEngine({
  input,
  userId,
  dayId,
  timeoutSeconds = 180,
  sessionId = "",
} = {}) {
  if (boolFromEnv(process.env.LIFEPILOT_MEMORY_INTELLIGENCE_DISABLE_OPENCLAW)) {
    return {ok: false, error: "openclaw_agent_engine_disabled"};
  }
  const startedAt = Date.now();
  const resolvedSessionId = sessionId || `lifepilot-memory-intelligence-${userId || "user"}-${Date.now()}-${randomUUID().slice(0, 6)}`;
  try {
    const response = await requestOpenClawAgent({
      message: buildMemoryIntelligenceAgentPrompt(input),
      sessionId: resolvedSessionId,
      timeoutSeconds,
      idempotencyKey: `lifepilot-memory-intelligence-${dayId || "day"}-${Date.now()}-${randomUUID().slice(0, 6)}`,
    });
    const finalText = parseAgentFinalText(response);
    const parsed = parseJsonFromText(finalText);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        error: "openclaw_memory_result_parse_failed",
        engine: "openclaw_agent",
        session_id: resolvedSessionId,
        timing: {agent_ms: Date.now() - startedAt},
        final_text: finalText,
      };
    }
    return {
      ok: true,
      engine: "openclaw_agent",
      session_id: resolvedSessionId,
      timing: {agent_ms: Date.now() - startedAt},
      result: parsed,
      raw_response: response,
      final_text: finalText,
    };
  } catch (error) {
    return {
      ok: false,
      error: "openclaw_memory_agent_failed",
      error_message: error instanceof Error ? error.message : String(error),
      engine: "openclaw_agent",
      session_id: resolvedSessionId,
      timing: {agent_ms: Date.now() - startedAt},
    };
  }
}

export async function runMemoryIntelligenceExternalEngine({
  engine,
  input,
  userId,
  dayId,
  timeoutSeconds,
  sessionId,
} = {}) {
  if (engine === "openclaw_agent") {
    return runOpenClawMemoryIntelligenceEngine({input, userId, dayId, timeoutSeconds, sessionId});
  }
  return {ok: false, error: `${engine || "unknown"}_engine_not_connected_yet`};
}
