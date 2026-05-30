import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const HOST = "127.0.0.1";
const PORT = Number(process.env.LIFEPILOT_TEST_PORT || 4331);
const BASE = `http://${HOST}:${PORT}`;

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
      // Server may still be starting.
    }
    await wait(100);
  }
  throw new Error("server did not become healthy");
}

const child = spawn("node", ["server/src/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {...process.env, HOST, PORT: String(PORT)},
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

  const started = await request("/api/session/start", {
    method: "POST",
    body: {
      session_id: "smoke_p1_session",
      user_id: "smoke_user",
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
  assert.ok(started.payload.session.current_cards.length > 0);

  const swipeCard = started.payload.session.current_cards[0];
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

  const viewed = await request("/api/session/smoke_p1_session");
  assert.equal(viewed.status, 200);
  assert.equal(viewed.payload.ok, true);
  assert.equal(viewed.payload.session.direction_events.length, 1);

  const missing = await request("/api/session/missing_session");
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.ok, false);
  assert.equal(missing.payload.error.code, "session_not_found");

  console.log(JSON.stringify({
    ok: true,
    assertions: 18,
    cards: directions.payload.cards.length,
    marker: health.marker,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("close", resolve));
  if (process.env.DEBUG_SMOKE_OUTPUT === "1") {
    console.error(stdout);
    console.error(stderr);
  }
}
