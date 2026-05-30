import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { requestOpenClawAgent } from "./openclaw-gateway-client.mjs";

function safeArg(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function defaultApiBase() {
  return process.env.LIFEPILOT_PUBLIC_API_BASE || `http://${config.host}:${config.port}`;
}

function boolFromEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function defaultOpenClawLocal() {
  return boolFromEnv(process.env.LIFEPILOT_OPENCLAW_LOCAL);
}

function defaultOpenClawApiBase(localMode) {
  if (process.env.LIFEPILOT_OPENCLAW_API_BASE) return process.env.LIFEPILOT_OPENCLAW_API_BASE.replace(/\/$/, "");
  if (localMode) return defaultApiBase();
  if (["127.0.0.1", "localhost", "0.0.0.0"].includes(config.host)) {
    return `http://host.docker.internal:${config.port}`;
  }
  return defaultApiBase();
}

function defaultOpenClawTransport() {
  return process.env.LIFEPILOT_OPENCLAW_TRANSPORT || "cli";
}

function buildDreamCommand({userId, dayId, apiBase}) {
  return [`python3 skills/lifepilot-dreaming/scripts/run_dream.py --user-id ${userId} --day-id ${dayId} --api-base ${apiBase} --submit`];
}

function buildDreamMessage({userId, dayId, apiBase}) {
  return [
    "请使用 lifepilot-dreaming skill 完成一次 LifePilot 后台 dreaming 闭环。",
    "",
    "要求：",
    "1. 只通过 LifePilot 后端 API 读取产品上下文，不要直接读取或修改产品 runtime 文件。",
    "2. 使用 skills/lifepilot-dreaming/scripts/run_dream.py。",
    "3. 必须提交 dream result 到 LifePilot 后端。",
    "4. 完成后用简短中文回复，包含 dream_id、candidate_count、job_id。",
    "5. 如果 API 连接失败，直接报告失败；不要启动 mock server，不要伪造后端结果。",
    "6. 不要先请求 /api/health。当前后端没有 health 路由，直接运行下面的 python 命令。",
    "7. 不要使用 export；后端地址已经写在 --api-base 参数里。",
    "",
    "运行命令：",
    "```bash",
    ...buildDreamCommand({userId, dayId, apiBase}),
    "```",
  ].join("\n");
}

function parseJsonMaybe(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseAgentFinalText(result) {
  return result?.result?.payloads?.map((payload) => payload.text).filter(Boolean).join("\n\n") || "";
}

export async function runOpenClawDreamAgent({userId, dayId, apiBase, timeoutSeconds, sessionId, local, transport} = {}) {
  const safeUserId = safeArg(userId || "demo_weiyingru");
  const safeDayId = safeArg(dayId);
  if (!safeDayId) {
    return {ok: false, error: "missing_day_id"};
  }
  const localMode = local === undefined ? defaultOpenClawLocal() : Boolean(local);
  const resolvedApiBase = String(apiBase || defaultOpenClawApiBase(localMode)).replace(/\/$/, "");
  const resolvedSessionId = sessionId || `lifepilot-dream-${safeUserId}-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const timeout = Math.max(30, Math.min(Number(timeoutSeconds || 240), 900));
  const resolvedTransport = String(transport || defaultOpenClawTransport()).replace(/-/g, "_");
  const message = buildDreamMessage({userId: safeUserId, dayId: safeDayId, apiBase: resolvedApiBase});
  if (resolvedTransport === "gateway_client") {
    const startedAt = Date.now();
    try {
      const result = await requestOpenClawAgent({
        message,
        sessionId: resolvedSessionId,
        timeoutSeconds: timeout,
        idempotencyKey: `lifepilot-dream-${safeDayId}-${Date.now()}-${randomUUID().slice(0, 6)}`,
      });
      return {
        ok: result?.status === "ok",
        error: result?.status === "ok" ? null : "openclaw_gateway_agent_failed",
        transport: resolvedTransport,
        session_id: resolvedSessionId,
        timing: {total_ms: Date.now() - startedAt},
        parsed_stdout: result,
        final_text: parseAgentFinalText(result),
      };
    } catch (error) {
      return {
        ok: false,
        error: "openclaw_gateway_agent_failed",
        error_message: error instanceof Error ? error.message : String(error),
        transport: resolvedTransport,
        session_id: resolvedSessionId,
        timing: {total_ms: Date.now() - startedAt},
      };
    }
  }
  const args = [
    "agent",
    "--agent",
    "main",
    "--session-id",
    resolvedSessionId,
    "--timeout",
    String(timeout),
    "--json",
    "--message",
    message,
  ];
  if (localMode) args.splice(1, 0, "--local");
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn("openclaw", args, {
      cwd: process.env.OPENCLAW_WORKSPACE || "/Users/mona/.openclaw/workspace",
      env: {
        ...process.env,
        LIFEPILOT_API_BASE: resolvedApiBase,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        error: "openclaw_agent_timeout",
        session_id: resolvedSessionId,
        timing: {total_ms: Date.now() - startedAt},
        stdout,
        stderr,
      });
    }, (timeout + 10) * 1000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        error: code === 0 ? null : "openclaw_agent_failed",
        transport: resolvedTransport,
        exit_code: code,
        session_id: resolvedSessionId,
        timing: {total_ms: Date.now() - startedAt},
        raw_stdout: stdout,
        raw_stderr: stderr,
        parsed_stdout: parseJsonMaybe(stdout),
      });
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        error: "openclaw_agent_spawn_failed",
        error_message: error instanceof Error ? error.message : String(error),
        transport: resolvedTransport,
        session_id: resolvedSessionId,
        timing: {total_ms: Date.now() - startedAt},
        stdout,
        stderr,
      });
    });
  });
}
