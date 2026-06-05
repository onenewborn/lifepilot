import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const memoryRoot = await mkdtemp(path.join(tmpdir(), "lifepilot-memory-intelligence-"));
process.env.LIFEPILOT_MEMORY_ROOT = memoryRoot;
process.env.LIFEPILOT_RUNTIME_ROOT = memoryRoot;

const {
  buildMemoryIntelligenceInput,
  createMemoryObservation,
  listMemoryIntelligenceJobs,
  listMemoryObservations,
  readFoodInsightProfile,
  runMemoryIntelligence,
} = await import("../server/src/memory-intelligence-store.mjs");
const { listMemoryCandidates } = await import("../server/src/memory-store.mjs");

const userId = "smoke_memory_intelligence";
const dayId = "day_20260604_smoke_memory_intelligence";

try {
  const observationResult = await createMemoryObservation({
    userId,
    body: {
      day_id: dayId,
      source: "xiaowang_chat",
      type: "explicit_memory_prompt",
      text: "以后少推荐排队久的店",
      summary: "主人在问小汪时提到：以后少推荐排队久的店",
      confidence: 0.8,
      source_event: {
        source: "xiaowang_chat",
        session_id: "xw_smoke",
        day_id: dayId,
      },
    },
  });
  assert.equal(observationResult.ok, true);

  const inputResult = await buildMemoryIntelligenceInput({
    mode: "instant_review",
    userId,
    dayId,
    observationId: observationResult.observation.observation_id,
  });
  assert.equal(inputResult.ok, true);
  assert.equal(inputResult.input.mode, "instant_review");
  assert.equal(inputResult.input.observation.observation_id, observationResult.observation.observation_id);
  assert.ok(inputResult.input_metrics.char_count > 0);
  assert.ok(inputResult.input_metrics.estimated_tokens > 0);
  assert.ok(inputResult.input_metrics.section_counts.observations > 0);

  const instant = await runMemoryIntelligence({
    mode: "instant_review",
    userId,
    dayId,
    observationId: observationResult.observation.observation_id,
  });
  assert.equal(instant.ok, true);
  assert.equal(instant.job.mode, "instant_review");
  assert.equal(instant.job.accepted_memory_candidates.length, 1);
  assert.ok(instant.job.input_metrics.char_count > 0);
  assert.equal(instant.job.input_metrics.over_threshold, false);
  assert.ok(instant.job.timing.total_ms >= instant.job.timing.input_build_ms);

  const pending = await listMemoryCandidates({userId, status: "pending"});
  assert.equal(pending.candidates.length, 1);
  assert.equal(pending.candidates[0].category, "queue");

  const tempObservation = await createMemoryObservation({
    userId,
    body: {
      day_id: dayId,
      source: "xiaowang_chat",
      type: "chat_observation",
      text: "今天不想吃轻食",
      confidence: 0.55,
    },
  });
  assert.equal(tempObservation.ok, true);
  const tempReview = await runMemoryIntelligence({
    mode: "instant_review",
    userId,
    dayId,
    observationId: tempObservation.observation.observation_id,
  });
  assert.equal(tempReview.ok, true);
  assert.equal(tempReview.job.accepted_memory_candidates.length, 0);

  const profile = await runMemoryIntelligence({
    mode: "profile_update",
    userId,
    dayId,
  });
  assert.equal(profile.ok, true);
  assert.equal(profile.job.food_insight_profile_updated, true);
  assert.ok(profile.job.input_metrics.char_count > 0);
  assert.ok(profile.job.timing.total_ms >= 0);
  const storedProfile = await readFoodInsightProfile({userId});
  assert.ok(storedProfile.food_choice_motives.convenience.score > 0);
  assert.ok(Array.isArray(storedProfile.top_motives));

  const observations = await listMemoryObservations({userId, dayId});
  assert.ok(observations.count >= 2);

  const jobs = await listMemoryIntelligenceJobs({userId, dayId});
  assert.ok(jobs.count >= 3);
} finally {
  await rm(memoryRoot, {recursive: true, force: true});
}
