const DEFAULT_BASE_URL = "https://api.evermind.ai";
const DEFAULT_TIMEOUT_MS = 20_000;

function envApiKey() {
  return process.env.EVEROS_API_KEY || process.env.EVERMIND_API_KEY || "";
}

function envBaseUrl() {
  return (process.env.EVEROS_API_BASE_URL || process.env.EVERMIND_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function normalizeUserId(userId) {
  return String(userId || "demo_weiyingru").replace(/[^a-zA-Z0-9_-]/g, "_") || "demo_weiyingru";
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

async function parseResponseBody(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return {raw_text: text};
  }
}

async function evermindRequest(pathname, {method = "POST", body, timeoutMs = DEFAULT_TIMEOUT_MS} = {}) {
  const apiKey = envApiKey();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      provider: "evermind",
      error: "EVEROS_API_KEY or EVERMIND_API_KEY is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${envBaseUrl()}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      return {
        ok: false,
        configured: true,
        provider: "evermind",
        status: response.status,
        error: payload?.message || payload?.error || payload?.raw_text || `Evermind API error ${response.status}`,
        payload,
      };
    }
    return {
      ok: true,
      configured: true,
      provider: "evermind",
      status: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      provider: "evermind",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function flattenMemoryPayload(payload) {
  const data = payload?.data || payload || {};
  const agentMemory = data.agent_memory || {};
  return [
    ...(data.episodes || []).map((item) => ({...item, memory_type: "episodic_memory"})),
    ...(data.profiles || []).map((item) => ({...item, memory_type: "profile"})),
    ...((agentMemory.cases || data.agent_cases || [])).map((item) => ({...item, memory_type: "agent_case"})),
    ...((agentMemory.skills || data.agent_skills || [])).map((item) => ({...item, memory_type: "agent_skill"})),
  ];
}

export function extractEvermindMemoryId(payload) {
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    for (const key of ["memory_id", "memoryId", "id"]) {
      if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
    }
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) {
        for (const entry of item) {
          const found = visit(entry);
          if (found) return found;
        }
      } else {
        const found = visit(item);
        if (found) return found;
      }
    }
    return null;
  }
  return visit(payload);
}

export function evermindConfigStatus() {
  return {
    provider: "evermind",
    configured: Boolean(envApiKey()),
    base_url: envBaseUrl(),
  };
}

export async function addEvermindMemory({
  userId,
  sessionId,
  content,
  role = "user",
  timestamp = Date.now(),
  asyncMode = false,
  flush = false,
  metadata,
  timeoutMs,
} = {}) {
  const text = String(content || "").trim();
  if (!text) {
    return {
      ok: false,
      configured: Boolean(envApiKey()),
      provider: "evermind",
      error: "content is required",
    };
  }
  const safeUserId = normalizeUserId(userId);
  const result = await evermindRequest("/api/v1/memories", {
    timeoutMs,
    body: compactObject({
      user_id: safeUserId,
      session_id: sessionId,
      async_mode: asyncMode,
      metadata,
      messages: [
        {
          role,
          timestamp,
          content: text,
        },
      ],
    }),
  });
  if (!result.ok || !flush) return result;
  const flushResult = await flushEvermindMemory({userId: safeUserId, sessionId, timeoutMs});
  return {
    ...result,
    flush: flushResult,
  };
}

export async function flushEvermindMemory({userId, sessionId, timeoutMs} = {}) {
  return evermindRequest("/api/v1/memories/flush", {
    timeoutMs,
    body: compactObject({
      user_id: normalizeUserId(userId),
      session_id: sessionId,
    }),
  });
}

export async function searchEvermindMemories({
  userId,
  sessionId,
  query = "用户已确认偏好和最近饭点上下文",
  method = "hybrid",
  memoryTypes = ["episodic_memory", "profile"],
  topK = 8,
  includeOriginalData = false,
  timeoutMs,
} = {}) {
  const result = await evermindRequest("/api/v1/memories/search", {
    timeoutMs,
    body: {
      query: String(query || "").trim() || "用户已确认偏好和最近饭点上下文",
      filters: compactObject({
        user_id: normalizeUserId(userId),
        session_id: sessionId,
      }),
      method,
      memory_types: memoryTypes,
      top_k: topK,
      include_original_data: includeOriginalData,
    },
  });
  if (!result.ok) return result;
  return {
    ...result,
    memories: flattenMemoryPayload(result.payload),
  };
}

export async function deleteEvermindMemory({memoryId, userId, sessionId, timeoutMs} = {}) {
  const body = memoryId
    ? {memory_id: memoryId}
    : compactObject({
      user_id: normalizeUserId(userId),
      session_id: sessionId,
    });
  if (!body.memory_id && !body.user_id) {
    return {
      ok: false,
      configured: Boolean(envApiKey()),
      provider: "evermind",
      error: "memoryId or userId is required",
    };
  }
  return evermindRequest("/api/v1/memories/delete", {body, timeoutMs});
}

export async function replaceEvermindMemory({
  memoryId,
  userId,
  sessionId,
  content,
  role = "user",
  metadata,
  timeoutMs,
} = {}) {
  if (!memoryId) {
    return {
      ok: false,
      configured: Boolean(envApiKey()),
      provider: "evermind",
      error: "memoryId is required for replacement",
    };
  }
  const added = await addEvermindMemory({
    userId,
    sessionId,
    content,
    role,
    metadata: {
      ...(metadata || {}),
      replaces_evermind_memory_id: memoryId,
    },
    timeoutMs,
  });
  if (!added.ok) {
    return {
      ...added,
      operation: "replace",
      added,
      deleted: null,
      replacement_completed: false,
      cleanup_required: false,
    };
  }
  const deleted = await deleteEvermindMemory({memoryId, timeoutMs});
  return {
    ok: Boolean(added.ok && deleted.ok),
    configured: added.configured,
    provider: "evermind",
    operation: "replace",
    added,
    deleted,
    replacement_completed: Boolean(added.ok && deleted.ok),
    cleanup_required: Boolean(added.ok && !deleted.ok),
    old_evermind_memory_id: memoryId,
    new_evermind_memory_id: extractEvermindMemoryId(added.payload),
  };
}
