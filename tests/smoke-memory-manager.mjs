import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "lifepilot-memory-manager-"));
process.env.LIFEPILOT_MEMORY_ROOT = memoryRoot;

const { createMemoryCandidatesFromOpenClaw, listConfirmedPreferences, listMemoryCandidates } = await import("../server/src/memory-store.mjs");
const { executeMemoryManageOperation, executeMemoryManageOperations } = await import("../server/src/memory-manager.mjs");

const userId = "smoke_memory_manager";

try {
  const candidateResult = await createMemoryCandidatesFromOpenClaw({
    userId,
    dayId: "day_smoke_memory_manager",
    candidates: [{
      statement: "主人不想工作日中午排队太久。",
      confirmation_text: "工作日中午少推荐排队久的店",
      category: "queue",
      polarity: "negative",
      confidence: 0.9,
      evidence: ["用户明确说这条可以确认下来"],
    }],
  });
  assert.equal(candidateResult.ok, true);
  assert.equal(candidateResult.created_count, 1);

  const confirmResult = await executeMemoryManageOperations({
    userId,
    operations: [{
      skill: "memory_manage",
      args: {
        operation: "confirm_latest_pending",
      },
    }],
  });
  assert.equal(confirmResult.ok, true);
  assert.equal(confirmResult.success_count, 1);
  assert.equal(confirmResult.results[0].operation, "confirm_latest_pending");
  assert.equal(confirmResult.results[0].candidate.status, "confirmed");
  assert.equal(confirmResult.results[0].preference.status, "active");

  const directCreate = await executeMemoryManageOperation({
    body: {
      user_id: userId,
      operation: "create_confirmed_preference",
      confirmation_text: "下雨天可以多推荐热汤面",
      category: "cuisine",
      polarity: "positive",
    },
  });
  assert.equal(directCreate.ok, true);
  assert.equal(directCreate.preference.status, "active");

  const updated = await executeMemoryManageOperation({
    body: {
      user_id: userId,
      operation: "update_preference",
      target: {match_text: "热汤面"},
      confirmation_text: "下雨天可以多推荐清淡热汤面",
    },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.preference.statement, "下雨天可以多推荐清淡热汤面");

  const deleted = await executeMemoryManageOperation({
    body: {
      user_id: userId,
      operation: "delete_preference",
      target: {match_text: "排队久"},
    },
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.preference.status, "forgotten");

  const pending = await listMemoryCandidates({userId});
  const preferences = await listConfirmedPreferences({userId});
  assert.deepEqual(pending.candidates.map((item) => item.status), ["confirmed"]);
  assert.equal(preferences.preferences.filter((item) => item.status === "active").length, 1);
  assert.equal(preferences.preferences.filter((item) => item.status === "forgotten").length, 1);
} finally {
  await rm(memoryRoot, {recursive: true, force: true});
}
