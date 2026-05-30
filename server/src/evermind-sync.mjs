import {
  addEvermindMemory,
  deleteEvermindMemory,
  evermindConfigStatus,
  extractEvermindMemoryId,
  replaceEvermindMemory,
  searchEvermindMemories,
} from "./evermind-memory.mjs";
import { setConfirmedPreferenceSync } from "./memory-store.mjs";

function nowIso() {
  return new Date().toISOString();
}

export function evermindSyncAllowed(body = {}) {
  return body.sync_evermind !== false && body.syncEvermind !== false;
}

function evermindSessionForPreference(preference = {}) {
  return preference.source_event?.session_id || `lifepilot_memory_${preference.user_id || "demo_weiyingru"}`;
}

function preferenceEvermindContent(preference = {}) {
  const evidence = Array.isArray(preference.evidence) ? preference.evidence : [];
  return [
    `LifePilot confirmed preference: ${preference.statement || ""}`,
    `Category: ${preference.category || "general"}`,
    `Polarity: ${preference.polarity || "neutral"}`,
    `Scope: ${preference.scope || "food"}`,
    `Confidence: ${preference.confidence ?? ""}`,
    evidence.length ? `Evidence: ${evidence.join("；")}` : "",
    "This is a user-confirmed LifePilot preference. LifePilot backend remains the source of truth.",
  ].filter(Boolean).join("\n");
}

function evermindSyncMeta(preference = {}, operation = "add") {
  return {
    lifepilot_preference_id: preference.preference_id,
    lifepilot_user_id: preference.user_id,
    lifepilot_category: preference.category,
    lifepilot_operation: operation,
    source_candidate_id: preference.source_candidate_id || "",
    confirmed_preference: true,
  };
}

function evermindMemoryIdFromResult(result) {
  return extractEvermindMemoryId(result?.payload) ||
    extractEvermindMemoryId(result?.add?.payload) ||
    extractEvermindMemoryId(result?.added?.payload) ||
    null;
}

async function resolveEvermindMemoryId(preference) {
  const result = await searchEvermindMemories({
    userId: preference.user_id,
    sessionId: evermindSessionForPreference(preference),
    query: preference.statement || preferenceEvermindContent(preference),
    method: "hybrid",
    topK: 5,
  });
  if (!result.ok) return {ok: false, memory_id: null, error: result.error};
  const memoryId = extractEvermindMemoryId(result.memories) || extractEvermindMemoryId(result.payload);
  return {
    ok: true,
    memory_id: memoryId,
    count: result.memories?.length || 0,
  };
}

async function waitForEvermindMemoryId(preference, {attempts = 3, intervalMs = 1000} = {}) {
  let lastResult = null;
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastResult = await resolveEvermindMemoryId(preference);
    if (lastResult.memory_id) {
      return {
        ...lastResult,
        attempts: index + 1,
      };
    }
  }
  return {
    ...(lastResult || {ok: false, memory_id: null}),
    attempts,
  };
}

async function recordPreferenceSync({preference, sync, operation}) {
  return setConfirmedPreferenceSync({
    userId: preference.user_id,
    preferenceId: preference.preference_id,
    sync,
    audit: {operation},
  });
}

export async function syncPreferenceAddToEvermind(preference, {operation = "add"} = {}) {
  const status = evermindConfigStatus();
  if (!status.configured) {
    return recordPreferenceSync({
      preference,
      operation,
      sync: {
        sync_status: "not_configured",
        evermind_memory_id: preference.sync?.evermind_memory_id || null,
        last_synced_at: null,
        last_sync_error: "EVEROS_API_KEY or EVERMIND_API_KEY is not configured",
      },
    });
  }

  const result = await addEvermindMemory({
    userId: preference.user_id,
    sessionId: evermindSessionForPreference(preference),
    content: preferenceEvermindContent(preference),
    metadata: evermindSyncMeta(preference, operation),
    asyncMode: false,
    flush: true,
  });
  let memoryId = evermindMemoryIdFromResult(result);
  let resolveResult = null;
  if (result.ok && !memoryId) {
    resolveResult = await waitForEvermindMemoryId(preference);
    memoryId = resolveResult.memory_id || null;
  }

  return recordPreferenceSync({
    preference,
    operation,
    sync: {
      evermind_memory_id: memoryId || preference.sync?.evermind_memory_id || null,
      sync_status: result.ok ? "synced" : "failed",
      last_synced_at: result.ok ? nowIso() : null,
      last_sync_error: result.ok ? (resolveResult?.error || "") : result.error,
      last_sync_result: {
        operation,
        ok: result.ok,
        status: result.status,
        memory_id_available: Boolean(memoryId),
        memory_id_resolve_count: resolveResult?.count ?? null,
        memory_id_resolve_attempts: resolveResult?.attempts ?? null,
      },
    },
  });
}

export async function syncPreferenceReplaceToEvermind(previousPreference, nextPreference) {
  const oldMemoryId = previousPreference?.sync?.evermind_memory_id || nextPreference?.sync?.evermind_memory_id || null;
  const status = evermindConfigStatus();
  if (!status.configured) {
    return recordPreferenceSync({
      preference: nextPreference,
      operation: "replace",
      sync: {
        sync_status: "not_configured",
        evermind_memory_id: oldMemoryId,
        last_sync_error: "EVEROS_API_KEY or EVERMIND_API_KEY is not configured",
      },
    });
  }
  if (!oldMemoryId) {
    return syncPreferenceAddToEvermind(nextPreference, {operation: "update_add_without_old_id"});
  }

  const result = await replaceEvermindMemory({
    memoryId: oldMemoryId,
    userId: nextPreference.user_id,
    sessionId: evermindSessionForPreference(nextPreference),
    content: preferenceEvermindContent(nextPreference),
    metadata: evermindSyncMeta(nextPreference, "replace"),
  });
  const newMemoryId = result.new_evermind_memory_id || evermindMemoryIdFromResult(result) || null;
  return recordPreferenceSync({
    preference: nextPreference,
    operation: "replace",
    sync: {
      evermind_memory_id: newMemoryId || oldMemoryId,
      sync_status: result.replacement_completed ? "synced" : (result.cleanup_required ? "cleanup_required" : "failed"),
      last_synced_at: result.ok || result.cleanup_required ? nowIso() : null,
      last_sync_error: result.ok ? "" : (result.deleted?.error || result.added?.error || result.error || ""),
      replacement: {
        old_evermind_memory_id: oldMemoryId,
        new_evermind_memory_id: newMemoryId,
        replacement_status: result.replacement_completed ? "completed" : (result.cleanup_required ? "old_memory_cleanup_required" : "failed"),
      },
      last_sync_result: {
        operation: "replace",
        ok: result.ok,
        cleanup_required: result.cleanup_required,
      },
    },
  });
}

export async function syncPreferenceDeleteFromEvermind(preference) {
  const memoryId = preference?.sync?.evermind_memory_id;
  if (!memoryId) {
    return recordPreferenceSync({
      preference,
      operation: "delete",
      sync: {
        sync_status: "local_only_deleted",
        last_sync_error: "",
      },
    });
  }
  const result = await deleteEvermindMemory({memoryId});
  return recordPreferenceSync({
    preference,
    operation: "delete",
    sync: {
      sync_status: result.ok ? "deleted" : "delete_failed",
      last_synced_at: result.ok ? nowIso() : null,
      last_sync_error: result.ok ? "" : result.error,
      last_sync_result: {
        operation: "delete",
        ok: result.ok,
        status: result.status,
      },
    },
  });
}

function cardTitleForEvent(event = {}) {
  return event.card?.title || event.card?.merchant_name || event.card_title || event.title || event.card_id || event.offer_id || "";
}

function summarizeEvents(events = [], action) {
  return events
    .filter((event) => event.action === action)
    .map(cardTitleForEvent)
    .filter(Boolean)
    .slice(0, 8);
}

function buildMealSessionMemorySummary(session = {}) {
  const keptDirections = summarizeEvents(session.direction_events || [], "keep");
  const dislikedDirections = summarizeEvents(session.direction_events || [], "dislike");
  const keptOffers = summarizeEvents(session.offer_events || [], "keep");
  const dislikedOffers = summarizeEvents(session.offer_events || [], "dislike");
  const primary = session.result?.primary || {};
  const alternatives = session.result?.alternatives || [];
  return [
    "LifePilot meal session memory.",
    `Session: ${session.session_id || ""}`,
    `User goal: ${session.goal || ""}`,
    `Parsed constraints: ${JSON.stringify(session.understanding?.constraints || {})}`,
    keptDirections.length ? `Kept food directions this round: ${keptDirections.join("、")}` : "",
    dislikedDirections.length ? `Disliked food directions this round: ${dislikedDirections.join("、")}` : "",
    keptOffers.length ? `Kept merchant offers this round: ${keptOffers.join("、")}` : "",
    dislikedOffers.length ? `Disliked merchant offers this round: ${dislikedOffers.join("、")}` : "",
    session.direction_summary?.summary_text ? `Direction summary: ${session.direction_summary.summary_text}` : "",
    primary.merchant_name ? `Final primary recommendation: ${primary.merchant_name} · ${primary.title || ""}` : "",
    alternatives.length ? `Alternatives: ${alternatives.map((item) => `${item.merchant_name || ""} ${item.title || ""}`.trim()).filter(Boolean).join("、")}` : "",
    "This is session/episodic context only. It is not a confirmed long-term preference unless the user explicitly confirms it.",
  ].filter(Boolean).join("\n");
}

export async function writeMealSessionSummaryToEvermind(session = {}) {
  if (!evermindConfigStatus().configured) {
    return {ok: false, skipped: "not_configured"};
  }
  return addEvermindMemory({
    userId: session.user_id,
    sessionId: session.session_id,
    role: "assistant",
    content: buildMealSessionMemorySummary(session),
    asyncMode: false,
    flush: true,
    metadata: {
      source: "miniapp_meal_session_summary",
      lifepilot_session_id: session.session_id,
      lifepilot_day_id: session.day_id,
      confirmed_preference: false,
    },
  });
}
