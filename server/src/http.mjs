import { randomUUID } from "node:crypto";

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

export function ok(res, payload = {}, status = 200) {
  sendJson(res, status, {ok: true, ...payload});
}

export function fail(res, status, code, message, details = {}) {
  sendJson(res, status, {
    ok: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      request_id: `req_${randomUUID().slice(0, 12)}`,
      fallback_used: false,
    },
  });
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error("Invalid JSON body.");
    wrapped.code = "invalid_json";
    wrapped.cause = error;
    throw wrapped;
  }
}
