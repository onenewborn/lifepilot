import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const HOST = "127.0.0.1";
const PORT = Number(process.env.LIFEPILOT_TEST_PORT || await findFreePort());
const BASE = `http://${HOST}:${PORT}`;
const RUNTIME_ROOT = await mkdtemp(path.join(tmpdir(), "lifepilot-memory-api-runtime-"));
const MEMORY_ROOT = await mkdtemp(path.join(tmpdir(), "lifepilot-memory-api-memory-"));

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

async function request(pathname, {method = "GET", body} = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? {"content-type": "application/json"} : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return {status: response.status, payload};
}

async function requestOk(pathname, options = {}) {
  const result = await request(pathname, options);
  assert.equal(result.status, 200, `${pathname} should return 200`);
  assert.equal(result.payload.ok, true, `${pathname} should be ok`);
  return result.payload;
}

async function waitForHealth() {
  for (let index = 0; index < 50; index += 1) {
    try {
      const payload = await requestOk("/api/health");
      if (payload.marker === "lifepilot-next-p1") return payload;
    } catch {
      // The local server may still be starting.
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
    LIFEPILOT_MEMORY_ROOT: MEMORY_ROOT,
    LIFEPILOT_AI_PROVIDER: "local",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  await waitForHealth();

  const userId = "smoke_memory_api";
  const dayId = "day_20260605_smoke_memory_api";
  const started = await requestOk("/api/session/start", {
    method: "POST",
    body: {
      user_id: userId,
      day_id: dayId,
      entry_form: {
        goal: "今天想吃川菜，但不要太油，最好少排队",
        location: {label: "福田区 · 景田地铁站附近"},
      },
    },
  });
  const sessionId = started.session.session_id;

  const observation = await requestOk("/api/memory/observations", {
    method: "POST",
    body: {
      user_id: userId,
      day_id: dayId,
      source: "smoke_memory_api",
      type: "chat_observation",
      text: "用户说想吃川菜，但不要太油，最好少排队",
      summary: "川菜需求中强调少油和少排队",
      confidence: 0.81,
      source_event: {source: "smoke_memory_api", session_id: sessionId, day_id: dayId},
    },
  });
  assert.ok(observation.observation.observation_id);

  const candidate = await requestOk("/api/memory/candidates", {
    method: "POST",
    body: {
      user_id: userId,
      day_id: dayId,
      source: "smoke_memory_api",
      statement: "主人偏好川菜时也希望少油、少排队。",
      confirmation_text: "想吃川菜时优先推荐少油、少排队的店",
      category: "cuisine_context",
      polarity: "positive",
      confidence: 0.86,
      evidence: ["用户说：今天想吃川菜，但不要太油，最好少排队"],
      source_event: {source: "smoke_memory_api", session_id: sessionId, day_id: dayId},
    },
  });
  assert.equal(candidate.candidate.status, "pending");

  const search = await requestOk(`/api/memory/search?user_id=${encodeURIComponent(userId)}&query=${encodeURIComponent("川菜 少排队")}&limit=10`);
  assert.ok(search.results.some((item) => item.type === "memory_candidate" && item.id === candidate.candidate.candidate_id));
  assert.ok(search.results.some((item) => item.type === "memory_observation" && item.id === observation.observation.observation_id));

  const sessionMemory = await requestOk(`/api/session/memory?user_id=${encodeURIComponent(userId)}&day_id=${encodeURIComponent(dayId)}&query=${encodeURIComponent("川菜")}`);
  assert.ok(sessionMemory.sessions.some((item) => item.session_id === sessionId));

  const confirmed = await requestOk("/api/memory/manage", {
    method: "POST",
    body: {
      user_id: userId,
      operation: "confirm_pending",
      target: {candidate_id: candidate.candidate.candidate_id},
      actor: "smoke_memory_api",
    },
  });
  const preferenceId = confirmed.preference.preference_id;

  const preferenceSearch = await requestOk(`/api/memory/search?user_id=${encodeURIComponent(userId)}&type=preference&query=${encodeURIComponent("少油")}`);
  assert.ok(preferenceSearch.results.some((item) => item.id === preferenceId));

  const updated = await requestOk(`/api/memory/preferences/${encodeURIComponent(preferenceId)}`, {
    method: "PATCH",
    body: {
      user_id: userId,
      statement: "想吃川菜时优先推荐少油、少排队、距离近的店",
      actor: "smoke_memory_api",
    },
  });
  assert.equal(updated.preference.statement, "想吃川菜时优先推荐少油、少排队、距离近的店");

  const paused = await requestOk(`/api/memory/preferences/${encodeURIComponent(preferenceId)}/pause`, {
    method: "POST",
    body: {user_id: userId, reason: "smoke pause", actor: "smoke_memory_api"},
  });
  assert.equal(paused.preference.status, "paused");

  const deleted = await requestOk(`/api/memory/preferences/${encodeURIComponent(preferenceId)}`, {
    method: "DELETE",
    body: {user_id: userId, reason: "smoke cleanup", actor: "smoke_memory_api"},
  });
  assert.equal(deleted.preference.status, "forgotten");
} catch (error) {
  console.error(stdout);
  console.error(stderr);
  throw error;
} finally {
  child.kill("SIGTERM");
  await rm(RUNTIME_ROOT, {recursive: true, force: true});
  await rm(MEMORY_ROOT, {recursive: true, force: true});
}
