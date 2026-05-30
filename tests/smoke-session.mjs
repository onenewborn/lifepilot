import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const HOST = "127.0.0.1";
const PORT = Number(process.env.LIFEPILOT_TEST_PORT || await findFreePort());
const BASE = `http://${HOST}:${PORT}`;
const RUNTIME_ROOT = await mkdtemp(path.join(tmpdir(), "lifepilot-runtime-"));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, {method = "GET", body} = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? {"content-type": "application/json"} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return {status: response.status, payload};
}

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const {status, payload} = await request("/api/health");
      if (status === 200 && payload.ok && payload.marker === "lifepilot-next-p1") return payload;
    } catch {
      // 服务可能还在启动中。
    }
    await wait(100);
  }
  throw new Error("server did not become healthy");
}

const child = spawn("node", ["server/src/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    HOST,
    PORT: String(PORT),
    LIFEPILOT_RUNTIME_ROOT: RUNTIME_ROOT,
    LIFEPILOT_AI_PROVIDER: "local",
    EVERMIND_API_KEY: "",
    EVEROS_API_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  const health = await waitForHealth();
  assert.equal(health.ok, true);
  assert.equal(health.runtime, "lifepilot-next");

  const directions = await request("/api/food-directions");
  assert.equal(directions.status, 200);
  assert.equal(directions.payload.ok, true);
  assert.ok(directions.payload.cards.length > 0);
  const firstCard = directions.payload.cards[0];
  assert.ok(firstCard.direction_id);
  assert.ok(firstCard.image_url);
  assert.equal(firstCard.service_id, firstCard.direction_id);
  assert.equal(firstCard.card_id, firstCard.direction_id);

  const parsedEntry = await request("/api/agent/parse-entry", {
    method: "POST",
    body: {
      local_only: true,
      entry_form: {
        raw_query: "今天下班有点累，想吃点下饭的。",
        party_size: 1,
        budget_per_person_max: 90,
      },
    },
  });
  assert.equal(parsedEntry.status, 200);
  assert.equal(parsedEntry.payload.ok, true);
  assert.equal(parsedEntry.payload.understanding.parse_mode, "local_fallback");
  assert.equal(parsedEntry.payload.meta.fallback_used, true);
  assert.equal(parsedEntry.payload.understanding.raw_entry_text, "今天下班有点累，想吃点下饭的。");
  assert.ok(parsedEntry.payload.understanding.dimensions);

  const started = await request("/api/session/start", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      user_id: "smoke_user",
      location: {
        label: "烟测当前位置",
        latitude: 22.52291,
        longitude: 114.05454,
        coordinate_type: "gcj02",
        source: "smoke",
      },
      entry_form: {
        raw_query: "今晚一个人吃，预算 50 内，不想太油。",
        party_size: 1,
        budget_per_person_max: 50,
      },
    },
  });
  assert.equal(started.status, 200);
  assert.equal(started.payload.ok, true);
  assert.equal(started.payload.session.session_id, "smoke_p1_session");
  assert.equal(started.payload.session.stage, "direction");
  assert.equal(started.payload.session.schema_version, "lifepilot.meal_session.v1");
  assert.equal(started.payload.session.status, "active");
  assert.ok(started.payload.session.day_id.startsWith("day_"));
  assert.ok(started.payload.session.meal_slot);
  assert.ok(started.payload.session.current_cards.length > 0);
  assert.ok(started.payload.session.current_cards.length <= 10);
  assert.equal(started.payload.session.understanding.parse_mode, "local_fallback");
  assert.ok(started.payload.session.understanding.raw_entry_text);
  assert.equal(started.payload.session.location.source, "smoke");
  const dayId = started.payload.session.day_id;
  const sessionFile = path.join(RUNTIME_ROOT, "meal_sessions", "smoke_p1_session.json");
  const persistedAfterStart = JSON.parse(await readFile(sessionFile, "utf8"));
  assert.equal(persistedAfterStart.session_id, "smoke_p1_session");
  assert.equal(persistedAfterStart.status, "active");
  const dayContextFile = path.join(RUNTIME_ROOT, "day_contexts", `${dayId}.json`);
  const persistedDayAfterStart = JSON.parse(await readFile(dayContextFile, "utf8"));
  assert.equal(persistedDayAfterStart.schema_version, "lifepilot.day_context.v1");
  assert.equal(persistedDayAfterStart.day_id, dayId);
  assert.equal(persistedDayAfterStart.meal_sessions.length, 1);
  assert.equal(persistedDayAfterStart.meal_sessions[0].session_id, "smoke_p1_session");
  assert.equal(persistedDayAfterStart.meal_sessions[0].status, "active");

  const dayViewAfterStart = await request(`/api/day-context/${encodeURIComponent(dayId)}`);
  assert.equal(dayViewAfterStart.status, 200);
  assert.equal(dayViewAfterStart.payload.ok, true);
  assert.equal(dayViewAfterStart.payload.day_context.meal_sessions[0].session_id, "smoke_p1_session");

  const swipeCard = started.payload.session.current_cards[0];
  const dislikeCard = started.payload.session.current_cards[1];
  const swiped = await request("/api/session/swipe", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      action: "keep",
      card_id: swipeCard.card_id,
      dwell_ms: 1234,
    },
  });
  assert.equal(swiped.status, 200);
  assert.equal(swiped.payload.ok, true);
  assert.equal(swiped.payload.event.action, "keep");
  assert.equal(swiped.payload.event.direction_id, swipeCard.direction_id);
  assert.equal(swiped.payload.session.direction_events.length, 1);

  const disliked = await request("/api/session/swipe", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      action: "dislike",
      card_id: dislikeCard.card_id,
      dwell_ms: 820,
    },
  });
  assert.equal(disliked.status, 200);
  assert.equal(disliked.payload.event.action, "dislike");
  assert.equal(disliked.payload.session.direction_events.length, 2);

  const viewed = await request("/api/session/smoke_p1_session");
  assert.equal(viewed.status, 200);
  assert.equal(viewed.payload.ok, true);
  assert.equal(viewed.payload.session.direction_events.length, 2);

  const invalidAction = await request("/api/session/swipe", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      action: "skip",
      card_id: swipeCard.card_id,
    },
  });
  assert.equal(invalidAction.status, 422);
  assert.equal(invalidAction.payload.ok, false);
  assert.equal(invalidAction.payload.error.code, "invalid_payload");
  assert.equal(viewed.payload.session.direction_events.length, 2);

  const missingCard = await request("/api/session/swipe", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      action: "keep",
      card_id: "dir_missing_card",
    },
  });
  assert.equal(missingCard.status, 404);
  assert.equal(missingCard.payload.ok, false);
  assert.equal(missingCard.payload.error.code, "card_not_found");

  const afterMissingCard = await request("/api/session/smoke_p1_session");
  assert.equal(afterMissingCard.status, 200);
  assert.equal(afterMissingCard.payload.session.direction_events.length, 2);

  const advanced = await request("/api/session/advance", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      local_only: true,
    },
  });
  assert.equal(advanced.status, 200);
  assert.equal(advanced.payload.ok, true);
  assert.equal(advanced.payload.session.stage, "direction_summary");
  assert.equal(advanced.payload.session.next_step, "confirm_direction_summary");
  assert.equal(advanced.payload.session.current_cards.length, 0);
  assert.ok(advanced.payload.session.direction_summary.summary_text);
  assert.equal(advanced.payload.session.direction_summary.mode, "local_fallback");
  assert.equal(advanced.payload.meta.fallback_used, true);
  assert.equal(advanced.payload.meta.memory_context.evermind_memories, 0);

  const offerAdvance = await request("/api/session/advance", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      limit: 10,
    },
  });
  assert.equal(offerAdvance.status, 200);
  assert.equal(offerAdvance.payload.ok, true);
  assert.equal(offerAdvance.payload.session.stage, "offer");
  assert.equal(offerAdvance.payload.session.next_step, "swipe_food_offers");
  assert.ok(offerAdvance.payload.session.current_cards.length > 0);
  assert.ok(offerAdvance.payload.session.current_cards.length <= 10);
  const offerCard = offerAdvance.payload.session.current_cards[0];
  assert.ok(offerCard.offer_id);
  assert.ok(offerCard.merchant_id);
  assert.ok(offerCard.facts.distance_text.endsWith("km"));
  assert.equal(Object.hasOwn(offerCard.facts, "subway_walk_min"), false);
  assert.ok(offerCard.facts.address);
  assert.ok(offerCard.facts.location);
  assert.equal(offerCard.facts.location.coordinate_type, "gcj02");

  const offerSwipe = await request("/api/session/swipe", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      action: "keep",
      card_id: offerCard.card_id,
      dwell_ms: 1111,
    },
  });
  assert.equal(offerSwipe.status, 200);
  assert.equal(offerSwipe.payload.event.action, "keep");
  assert.equal(offerSwipe.payload.event.offer_id, offerCard.offer_id);
  assert.equal(offerSwipe.payload.session.offer_events.length, 1);

  const finalized = await request("/api/session/finalize", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
    },
  });
  assert.equal(finalized.status, 200);
  assert.equal(finalized.payload.ok, true);
  assert.equal(finalized.payload.session.stage, "final");
  assert.equal(finalized.payload.session.status, "finalized");
  assert.ok(finalized.payload.session.finalized_at);
  assert.equal(finalized.payload.result.hasSelection, true);
  assert.equal(finalized.payload.result.primary.offer_id, offerCard.offer_id);
  assert.equal(finalized.payload.evermind_session_summary.skipped, "not_configured");
  const persistedAfterFinalize = JSON.parse(await readFile(sessionFile, "utf8"));
  assert.equal(persistedAfterFinalize.stage, "final");
  assert.equal(persistedAfterFinalize.status, "finalized");
  assert.equal(persistedAfterFinalize.result.primary.offer_id, offerCard.offer_id);
  const dayViewAfterFinalize = await request(`/api/day-context/${encodeURIComponent(dayId)}`);
  assert.equal(dayViewAfterFinalize.status, 200);
  const mealSummary = dayViewAfterFinalize.payload.day_context.meal_sessions[0];
  assert.equal(mealSummary.status, "finalized");
  assert.equal(mealSummary.stage, "final");
  assert.equal(mealSummary.final_offer_id, offerCard.offer_id);
  assert.equal(mealSummary.final_merchant_id, offerCard.merchant_id);

  const feedback = await request("/api/memory/post-meal-feedback", {
    method: "POST",
    body: {
      user_id: "smoke_user",
      session_id: "smoke_p1_session",
      offer_id: offerCard.offer_id,
      merchant_id: offerCard.merchant_id,
      merchant_name: offerCard.merchant_name,
      feedback_text: "这家太油了，下次别给我推这种。",
      rating: 2,
    },
  });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.payload.ok, true);
  assert.ok(feedback.payload.created_count >= 1);
  assert.ok(feedback.payload.candidates[0].candidate_id);
  assert.equal(feedback.payload.candidates[0].status, "pending");
  assert.equal(feedback.payload.merchant_feedback.created, true);
  assert.ok(feedback.payload.merchant_feedback.merchant_summary.score < 0);
  assert.ok(feedback.payload.merchant_feedback.merchant_summary.negative_tags.includes("偏油"));

  const dayViewAfterMemory = await request(`/api/day-context/${encodeURIComponent(dayId)}`);
  assert.equal(dayViewAfterMemory.status, 200);
  assert.ok(dayViewAfterMemory.payload.day_context.memory_candidate_ids.includes(feedback.payload.candidates[0].candidate_id));

  const candidates = await request("/api/memory/candidates?user_id=smoke_user&status=pending");
  assert.equal(candidates.status, 200);
  assert.equal(candidates.payload.ok, true);
  assert.ok(candidates.payload.count >= 1);

  const offersBeforeConfirm = await request("/api/food-offers", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      limit: 10,
      ai_explanations: false,
    },
  });
  assert.equal(offersBeforeConfirm.status, 200);
  assert.equal(offersBeforeConfirm.payload.ok, true);
  assert.equal(offersBeforeConfirm.payload.ai_explanations.memory_context.confirmed_preferences, 0);
  const feedbackCard = offersBeforeConfirm.payload.cards.find((card) => card.merchant_id === offerCard.merchant_id);
  if (feedbackCard) {
    assert.ok(feedbackCard.facts.user_feedback);
    assert.ok(feedbackCard.facts.user_feedback.score < 0);
    assert.ok(feedbackCard.facts.user_feedback.negative_tags.includes("偏油"));
  } else {
    assert.equal(offersBeforeConfirm.payload.cards.some((card) => card.merchant_id === offerCard.merchant_id), false);
  }

  const candidateId = feedback.payload.candidates[0].candidate_id;
  const confirmed = await request(`/api/memory/candidates/${encodeURIComponent(candidateId)}/confirm`, {
    method: "POST",
    body: {
      user_id: "smoke_user",
      actor: "smoke",
    },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.payload.ok, true);
  assert.equal(confirmed.payload.candidate.status, "confirmed");
  assert.equal(confirmed.payload.preference.status, "active");
  assert.equal(confirmed.payload.preference.source_candidate_id, candidateId);
  assert.equal(confirmed.payload.preference.sync.provider, "evermind");
  assert.equal(confirmed.payload.preference.sync.sync_status, "not_configured");
  assert.equal(confirmed.payload.evermind_sync.sync_status, "not_configured");

  const preferences = await request("/api/memory/preferences?user_id=smoke_user&status=active");
  assert.equal(preferences.status, 200);
  assert.equal(preferences.payload.ok, true);
  assert.equal(preferences.payload.count, 1);

  const offersAfterConfirm = await request("/api/food-offers", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      limit: 2,
      ai_explanations: false,
    },
  });
  assert.equal(offersAfterConfirm.status, 200);
  assert.equal(offersAfterConfirm.payload.ok, true);
  assert.equal(offersAfterConfirm.payload.ai_explanations.memory_context.confirmed_preferences, 0);
  assert.equal(offersAfterConfirm.payload.ai_explanations.memory_context.policy, "local_active_confirmed_preferences_are_strong; evermind_memories_are_weak_context");
  assert.equal(offersAfterConfirm.payload.ai_explanations.memory_context.evermind_memories, 0);

  const ledger = await request("/api/memory/ledger?user_id=smoke_user");
  assert.equal(ledger.status, 200);
  assert.equal(ledger.payload.ok, true);
  assert.equal(ledger.payload.provider_status.local.configured, true);
  assert.equal(ledger.payload.provider_status.evermind.configured, false);
  assert.equal(ledger.payload.preferences.length, 1);
  assert.equal(ledger.payload.pending_candidates.length, feedback.payload.created_count - 1);

  const dreamInput = await request(`/api/openclaw/dream-input?user_id=smoke_user&day_id=${encodeURIComponent(dayId)}`);
  assert.equal(dreamInput.status, 200);
  assert.equal(dreamInput.payload.ok, true);
  assert.equal(dreamInput.payload.dream_input.schema_version, "lifepilot.openclaw_dream_input.v1");
  assert.equal(dreamInput.payload.dream_input.user_id, "smoke_user");
  assert.equal(dreamInput.payload.dream_input.day_id, dayId);
  assert.equal(dreamInput.payload.dream_input.policy.memory_authority, "lifepilot_backend");
  assert.equal(dreamInput.payload.dream_input.policy.may_create_confirmed_preferences, false);
  assert.equal(dreamInput.payload.dream_input.policy.may_modify_meal_session, false);
  assert.ok(dreamInput.payload.dream_input.allowed_outputs.includes("memory_candidates"));
  assert.equal(dreamInput.payload.dream_input.meal_sessions.length, 1);
  assert.equal(dreamInput.payload.dream_input.meal_sessions[0].session_id, "smoke_p1_session");
  assert.equal(dreamInput.payload.dream_input.meal_sessions[0].status, "finalized");
  assert.equal(dreamInput.payload.dream_input.meal_sessions[0].direction_events.length, 2);
  assert.equal(dreamInput.payload.dream_input.confirmed_preferences.length, 1);
  assert.ok(Array.isArray(dreamInput.payload.dream_input.pending_memory_candidates));
  assert.ok(dreamInput.payload.dream_input.merchant_feedback_summary.merchants.length >= 1);

  const dreamId = dreamInput.payload.dream_input.dream_id;
  const dreamResult = await request("/api/openclaw/dream-result", {
    method: "POST",
    body: {
      dream_id: dreamId,
      user_id: "smoke_user",
      day_id: dayId,
      status: "completed",
      summary: "今天主人对重油反馈明确，后续可以更小心油腻负担。",
      memory_candidates: [
        {
          type: "food_preference",
          category: "meal_context",
          polarity: "negative",
          scope: "food",
          statement: "主人对明显油腻的晚饭体验比较敏感。",
          confidence: 0.82,
          evidence: [
            {
              source: "meal_session",
              session_id: "smoke_p1_session",
              reason: "饭后反馈说这家太油了，下次别推这种。",
            },
          ],
          needs_confirmation: true,
        },
        {
          type: "food_preference",
          category: "weak_signal",
          polarity: "positive",
          statement: "低置信度候选不应该保存。",
          confidence: 0.5,
          evidence: [{source: "meal_session", session_id: "smoke_p1_session"}],
        },
      ],
      xiaowang_next_interaction_ideas: [
        {
          type: "proactive_message",
          timing_hint: "next_dinner",
          draft: "主人下次下班累的时候，小汪会避开太油的选择。",
        },
      ],
    },
  });
  assert.equal(dreamResult.status, 200);
  assert.equal(dreamResult.payload.ok, true);
  assert.ok(dreamResult.payload.job.job_id.startsWith("dreamjob_"));
  assert.equal(dreamResult.payload.job.dream_id, dreamId);
  assert.equal(dreamResult.payload.job.accepted_memory_candidates.length, 1);
  assert.equal(dreamResult.payload.job.accepted_memory_candidates[0].source, "openclaw_dream");
  assert.equal(dreamResult.payload.job.accepted_memory_candidates[0].status, "pending");
  assert.equal(dreamResult.payload.job.rejected_memory_candidates.length, 1);
  assert.equal(dreamResult.payload.job.xiaowang_next_interaction_ideas.length, 1);

  const dreamJob = await request(`/api/openclaw/jobs/${encodeURIComponent(dreamResult.payload.job.job_id)}`);
  assert.equal(dreamJob.status, 200);
  assert.equal(dreamJob.payload.ok, true);
  assert.equal(dreamJob.payload.job.dream_id, dreamId);

  const dreamJobByDream = await request(`/api/openclaw/jobs/by-dream/${encodeURIComponent(dreamId)}`);
  assert.equal(dreamJobByDream.status, 200);
  assert.equal(dreamJobByDream.payload.ok, true);
  assert.equal(dreamJobByDream.payload.job.job_id, dreamResult.payload.job.job_id);

  const candidatesAfterDream = await request("/api/memory/candidates?user_id=smoke_user&status=pending");
  assert.equal(candidatesAfterDream.status, 200);
  assert.equal(candidatesAfterDream.payload.ok, true);
  assert.ok(candidatesAfterDream.payload.candidates.some((candidate) => (
    candidate.source === "openclaw_dream"
    && candidate.source_event.dream_id === dreamId
    && candidate.statement === "主人对明显油腻的晚饭体验比较敏感。"
  )));

  const route = await request("/api/map/route", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      merchant_id: offerCard.merchant_id,
      distance_km: offerCard.facts.distance_km,
    },
  });
  assert.equal(route.status, 200);
  assert.equal(route.payload.ok, true);
  assert.ok(route.payload.recommended.distance_text.endsWith("km"));
  assert.ok(route.payload.origin);

  const weather = await request("/api/weather/forecast", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
    },
  });
  assert.equal(weather.status, 200);
  assert.equal(weather.payload.ok, true);
  assert.equal(weather.payload.provider, "mock");
  assert.equal(weather.payload.location.source, "smoke");

  const queue = await request("/api/queue/status", {
    method: "POST",
    body: {
      merchant_id: offerCard.merchant_id,
      queue_risk: offerCard.facts.queue_risk,
    },
  });
  assert.equal(queue.status, 200);
  assert.equal(queue.payload.ok, true);
  assert.equal(queue.payload.provider, "mock");

  const invalidAdvance = await request("/api/session/advance", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
    },
  });
  assert.equal(invalidAdvance.status, 409);
  assert.equal(invalidAdvance.payload.ok, false);
  assert.equal(invalidAdvance.payload.error.code, "invalid_session_transition");

  const missing = await request("/api/session/missing_session");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.ok, false);
  assert.equal(missing.payload.error.code, "session_not_found");

  console.log(JSON.stringify({
    ok: true,
    assertions: 172,
    cards: directions.payload.cards.length,
    marker: health.marker,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
  await rm(RUNTIME_ROOT, {recursive: true, force: true});
  if (process.env.DEBUG_SMOKE_OUTPUT === "1") {
    console.error(stdout);
    console.error(stderr);
  }
}
