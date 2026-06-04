import assert from "node:assert/strict";

const args = new Map(process.argv.slice(2).map((item) => {
  const [key, ...rest] = item.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));

const API_BASE = (args.get("api-base") || process.env.LIFEPILOT_EVAL_API_BASE || process.env.LIFEPILOT_PUBLIC_API_BASE || "http://127.0.0.1:4331").replace(/\/$/, "");
const MODE_ARG = args.get("mode") || "both";
const MODES = MODE_ARG === "both" ? ["full", "workspace_minimal"] : [MODE_ARG];
const TIMEOUT_MS = Number(args.get("timeout-ms") || 180000);
const USER_ID = args.get("user-id") || "demo_weiyingru";
const SCENARIO_FILTER = args.get("scenario") || "";

const currentMerchant = {
  active_tab: "meal",
  meal_stage: "offer",
  current_card: {
    merchant_id: "m_futian_025",
    merchant_name: "汪记豆花川菜馆",
    title: "汪记豆花川菜馆",
    facts: {
      price_per_person: 68,
      queue_risk: "medium",
    },
  },
};

const scenarios = [
  {
    id: "generic_meal_entry",
    message: "今天中午不知道吃什么",
    validate(assistant) {
      const actions = actionsOf(assistant);
      assert.ok(actions.includes("open_meal_entry"), "expected open_meal_entry skill card");
      assert.ok(!actions.includes("start_meal"), "must not emit legacy start_meal");
    },
  },
  {
    id: "explicit_sichuan_offer_session",
    message: "我想吃川菜，有什么推荐吗",
    validate(assistant) {
      assert.ok(actionsOf(assistant).includes("open_meal_session"), "expected open_meal_session skill card");
      assert.ok(skillCards(assistant).some((card) => card.payload?.session_id || card.payload?.sessionId), "open_meal_session needs session_id");
    },
  },
  {
    id: "named_compare_with_swipe",
    message: "川香楼和汪记豆花怎么选",
    validate(assistant) {
      assert.ok(resultCards(assistant).length > 0, "expected merchant compare result card");
      assert.ok(actionsOf(assistant).includes("open_meal_session"), "expected compare flow to include swipe entry");
    },
  },
  {
    id: "current_merchant_intel",
    message: "这家有什么特色菜，适合一个人吗",
    current_context: currentMerchant,
    validate(assistant) {
      assert.ok(resultCards(assistant).length > 0, "expected merchant intel result card");
      assert.match(JSON.stringify(assistant), /汪记|豆花|腰花|特色|一个人|适合/);
    },
  },
  {
    id: "current_merchant_deal",
    message: "这家有团购吗，两个人怎么吃划算",
    current_context: currentMerchant,
    validate(assistant) {
      assert.ok(resultCards(assistant).length > 0, "expected deal result card");
      assert.match(JSON.stringify(assistant), /优惠|团购|券后|划算|人均|套餐/);
    },
  },
  {
    id: "memory_capture",
    message: "以后少推荐排队久的店",
    validate(assistant) {
      const prompts = Array.isArray(assistant.memory_prompts) ? assistant.memory_prompts : [];
      assert.ok(prompts.length || Number(assistant.memory_candidate_created_count || 0) > 0, "expected pending memory prompt or candidate");
    },
  },
];

function skillCards(assistant = {}) {
  return Array.isArray(assistant.skill_cards) ? assistant.skill_cards : [];
}

function resultCards(assistant = {}) {
  return Array.isArray(assistant.skill_result_cards) ? assistant.skill_result_cards : [];
}

function actionsOf(assistant = {}) {
  return skillCards(assistant).map((card) => card.action).filter(Boolean);
}

async function postJson(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json();
    return {status: response.status, payload};
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
const failures = [];

const selectedScenarios = SCENARIO_FILTER
  ? scenarios.filter((scenario) => scenario.id === SCENARIO_FILTER)
  : scenarios;
assert.ok(selectedScenarios.length, `No scenarios matched ${SCENARIO_FILTER}`);

for (const mode of MODES) {
  for (const scenario of selectedScenarios) {
    const sessionId = `eval_${mode}_${scenario.id}_${Date.now()}`;
    const {status, payload} = await postJson("/api/xiaowang/chat", {
      user_id: USER_ID,
      session_id: sessionId,
      message: scenario.message,
      current_context: scenario.current_context || {},
      openclaw_prompt_mode: mode,
    });
    const assistant = payload.assistant || {};
    const result = {
      mode,
      scenario: scenario.id,
      status,
      assistant_mode: assistant.mode,
      prompt_mode: assistant.openclaw?.prompt_mode || assistant.ai?.prompt_mode || "",
      openclaw_error: assistant.openclaw?.error || "",
      ai_error: assistant.ai?.error || "",
      actions: actionsOf(assistant),
      result_card_count: resultCards(assistant).length,
      memory_prompt_count: Array.isArray(assistant.memory_prompts) ? assistant.memory_prompts.length : 0,
      memory_candidate_created_count: assistant.memory_candidate_created_count || 0,
      content: assistant.content || "",
    };
    try {
      assert.equal(status, 200);
      assert.equal(payload.ok, true);
      assert.equal(result.prompt_mode, mode);
      scenario.validate(assistant, payload);
      result.ok = true;
    } catch (error) {
      result.ok = false;
      result.error = error instanceof Error ? error.message : String(error);
      failures.push(result);
    }
    results.push(result);
    console.log(JSON.stringify(result));
  }
}

console.log(JSON.stringify({ok: failures.length === 0, api_base: API_BASE, modes: MODES, results, failures}, null, 2));
if (failures.length) process.exit(1);
