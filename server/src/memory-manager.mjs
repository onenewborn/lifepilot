import {
  confirmMemoryCandidate,
  createConfirmedPreference,
  listConfirmedPreferences,
  listMemoryCandidates,
  rejectMemoryCandidate,
  setConfirmedPreferenceStatus,
  updateConfirmedPreference,
} from "./memory-store.mjs";
import {
  evermindSyncAllowed,
  syncPreferenceAddToEvermind,
  syncPreferenceDeleteFromEvermind,
  syncPreferenceReplaceToEvermind,
} from "./evermind-sync.mjs";

const DEFAULT_USER_ID = "demo_weiyingru";

function text(value) {
  return String(value || "").trim();
}

function latestByCreatedAt(items = []) {
  return [...items].sort((left, right) => (
    new Date(right.created_at || right.updated_at || 0).getTime() -
    new Date(left.created_at || left.updated_at || 0).getTime()
  ))[0] || null;
}

function includesMatch(item = {}, matchText = "") {
  const needle = text(matchText);
  if (!needle) return false;
  return [
    item.preference_id,
    item.candidate_id,
    item.statement,
    item.confirmation_text,
    item.original_statement,
    item.category,
    item.scope,
  ].some((value) => text(value).includes(needle));
}

async function resolvePendingCandidate({userId, target = {}}) {
  const candidateId = text(target.candidate_id || target.candidateId);
  const matchText = text(target.match_text || target.matchText || target.text);
  const pending = await listMemoryCandidates({userId, status: "pending"});
  const candidates = pending.candidates || [];
  const candidate = candidateId
    ? candidates.find((item) => item.candidate_id === candidateId)
    : matchText
      ? candidates.find((item) => includesMatch(item, matchText))
      : latestByCreatedAt(candidates);
  return {pending, candidate};
}

async function resolvePreference({userId, target = {}, status = ""}) {
  const preferenceId = text(target.preference_id || target.preferenceId);
  const matchText = text(target.match_text || target.matchText || target.text);
  const listed = await listConfirmedPreferences({userId, status});
  const preferences = listed.preferences || [];
  const preference = preferenceId
    ? preferences.find((item) => item.preference_id === preferenceId)
    : matchText
      ? preferences.find((item) => includesMatch(item, matchText))
      : latestByCreatedAt(preferences);
  return {listed, preference};
}

function patchFromArgs(args = {}) {
  const patch = args.patch && typeof args.patch === "object" ? {...args.patch} : {};
  const confirmationText = text(
    args.confirmation_text ||
    args.confirmationText ||
    args.text ||
    args.statement ||
    patch.confirmation_text ||
    patch.confirmationText ||
    patch.statement
  );
  if (confirmationText) {
    patch.confirmation_text = confirmationText;
    patch.statement = patch.statement || confirmationText;
  }
  if (args.category !== undefined) patch.category = args.category;
  if (args.polarity !== undefined) patch.polarity = args.polarity;
  if (args.scope !== undefined) patch.scope = args.scope;
  if (args.strength !== undefined) patch.strength = args.strength;
  if (args.confidence !== undefined) patch.confidence = args.confidence;
  if (Array.isArray(args.evidence)) patch.evidence = args.evidence;
  return patch;
}

function operationLabel(operation) {
  return {
    list_memory: "读取",
    create_confirmed_preference: "新增",
    confirm_pending: "确认",
    confirm_latest_pending: "确认",
    reject_pending: "拒绝",
    update_preference: "更新",
    delete_preference: "删除",
    pause_preference: "暂停",
  }[operation] || operation;
}

function summarizeResult({operation, result = {}, preference = null, candidate = null}) {
  if (operation === "list_memory") {
    return `已读取 ${result.confirmed_preferences?.length || 0} 条已确认、${result.pending_candidates?.length || 0} 条待确认记忆`;
  }
  const item = preference || result.preference || candidate || result.candidate || {};
  const statement = text(item.confirmation_text || item.statement);
  return `${operationLabel(operation)}成功${statement ? `：${statement}` : ""}`;
}

export async function executeMemoryManageOperation({body = {}} = {}) {
  const operation = text(body.operation || body.op);
  const userId = body.user_id || body.userId || DEFAULT_USER_ID;
  const target = body.target && typeof body.target === "object" ? body.target : body;
  const actor = text(body.actor) || "openclaw";
  const syncBody = {
    sync_evermind: body.sync_evermind,
    syncEvermind: body.syncEvermind,
  };

  if (!operation) {
    return {ok: false, user_id: userId, error: "operation_required"};
  }

  if (operation === "list_memory") {
    const [pending, preferences] = await Promise.all([
      listMemoryCandidates({userId, status: "pending"}),
      listConfirmedPreferences({userId, status: "active"}),
    ]);
    const result = {
      pending_candidates: pending.candidates || [],
      confirmed_preferences: preferences.preferences || [],
    };
    return {
      ok: true,
      user_id: userId,
      operation,
      ...result,
      result_summary: summarizeResult({operation, result}),
    };
  }

  if (operation === "confirm_pending" || operation === "confirm_latest_pending") {
    const {candidate} = await resolvePendingCandidate({userId, target});
    if (!candidate) {
      return {ok: false, user_id: userId, operation, error: "pending_candidate_not_found"};
    }
    const payload = await confirmMemoryCandidate({
      userId,
      candidateId: candidate.candidate_id,
      actor,
      patch: patchFromArgs(body),
    });
    if (!payload.ok) return {...payload, operation};
    let preference = payload.preference;
    if (evermindSyncAllowed(syncBody)) {
      const synced = await syncPreferenceAddToEvermind(preference, {operation: "memory_manage_confirm"});
      preference = synced.preference || preference;
    }
    return {
      ...payload,
      operation,
      preference,
      evermind_sync: preference.sync,
      result_summary: summarizeResult({operation, preference, candidate: payload.candidate}),
    };
  }

  if (operation === "reject_pending") {
    const {candidate} = await resolvePendingCandidate({userId, target});
    if (!candidate) {
      return {ok: false, user_id: userId, operation, error: "pending_candidate_not_found"};
    }
    const payload = await rejectMemoryCandidate({
      userId,
      candidateId: candidate.candidate_id,
      actor,
      reason: text(body.reason) || "memory_manage_reject",
    });
    return {
      ...payload,
      operation,
      result_summary: payload.ok ? summarizeResult({operation, candidate: payload.candidate}) : "",
    };
  }

  if (operation === "create_confirmed_preference") {
    const patch = patchFromArgs(body);
    const payload = await createConfirmedPreference({
      userId,
      body: {
        ...patch,
        actor,
        method: "memory_manage_direct_create",
        evidence: Array.isArray(patch.evidence) && patch.evidence.length
          ? patch.evidence
          : [text(body.reason) || "user_explicit_memory_manage"],
      },
    });
    if (!payload.ok) return {...payload, operation};
    let preference = payload.preference;
    if (evermindSyncAllowed(syncBody)) {
      const synced = await syncPreferenceAddToEvermind(preference, {operation: "memory_manage_create"});
      preference = synced.preference || preference;
    }
    return {
      ...payload,
      operation,
      preference,
      evermind_sync: preference.sync,
      result_summary: summarizeResult({operation, preference}),
    };
  }

  if (operation === "update_preference") {
    const {preference: previous} = await resolvePreference({userId, target, status: "active"});
    if (!previous) {
      return {ok: false, user_id: userId, operation, error: "preference_not_found"};
    }
    const payload = await updateConfirmedPreference({
      userId,
      preferenceId: previous.preference_id,
      patch: {
        ...patchFromArgs(body),
        actor,
      },
    });
    if (!payload.ok) return {...payload, operation};
    let preference = payload.preference;
    if (evermindSyncAllowed(syncBody)) {
      const synced = await syncPreferenceReplaceToEvermind(previous, preference);
      preference = synced.preference || preference;
    }
    return {
      ...payload,
      operation,
      preference,
      evermind_sync: preference.sync,
      result_summary: summarizeResult({operation, preference}),
    };
  }

  if (operation === "delete_preference" || operation === "pause_preference") {
    const {preference: previous} = await resolvePreference({userId, target, status: "active"});
    if (!previous) {
      return {ok: false, user_id: userId, operation, error: "preference_not_found"};
    }
    const status = operation === "delete_preference" ? "forgotten" : "paused";
    const payload = await setConfirmedPreferenceStatus({
      userId,
      preferenceId: previous.preference_id,
      status,
      reason: text(body.reason) || `memory_manage_${operation}`,
      actor,
    });
    if (!payload.ok) return {...payload, operation};
    let preference = payload.preference;
    if (operation === "delete_preference" && evermindSyncAllowed(syncBody)) {
      const synced = await syncPreferenceDeleteFromEvermind(preference);
      preference = synced.preference || preference;
    }
    return {
      ...payload,
      operation,
      preference,
      evermind_sync: preference.sync,
      result_summary: summarizeResult({operation, preference}),
    };
  }

  return {
    ok: false,
    user_id: userId,
    operation,
    error: "unsupported_memory_operation",
  };
}

export async function executeMemoryManageOperations({userId, operations = []} = {}) {
  const results = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    const args = operation.args && typeof operation.args === "object" ? operation.args : {};
    results.push(await executeMemoryManageOperation({
      body: {
        ...args,
        operation: args.operation || operation.operation,
        user_id: args.user_id || args.userId || userId || DEFAULT_USER_ID,
        actor: args.actor || "openclaw",
      },
    }));
  }
  return {
    ok: results.every((item) => item.ok),
    results,
    count: results.length,
    success_count: results.filter((item) => item.ok).length,
  };
}
