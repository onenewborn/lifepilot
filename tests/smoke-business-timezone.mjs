import assert from "node:assert/strict";

const { createDayId, createSessionId } = await import("../server/src/session-store.mjs");

const earlyBeijingMorning = new Date("2026-06-04T16:01:00.000Z");

assert.equal(
  createDayId("timezone_smoke", earlyBeijingMorning),
  "day_20260605_timezone_smoke"
);
assert.match(
  createSessionId(earlyBeijingMorning),
  /^meal_20260605_\d+_[a-f0-9]{8}$/
);
