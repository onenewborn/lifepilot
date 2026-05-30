import { config } from "../config.mjs";

export async function callArkChat({messages, maxTokens, temperature, timeoutMs} = {}) {
  const startedAt = Date.now();
  if (!config.ai.arkApiKey) {
    return {
      ok: false,
      provider: "ark_doubao",
      model: config.ai.arkModel,
      error_code: "provider_not_configured",
      timing: {total_ms: Date.now() - startedAt},
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs || config.ai.timeoutMs));
  try {
    const response = await fetch(`${config.ai.arkBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.ai.arkApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ai.arkModel,
        messages: messages || [],
        temperature: Number(temperature ?? config.ai.temperature),
        max_tokens: Number(maxTokens ?? config.ai.maxTokens),
        thinking: {type: "disabled"},
      }),
    });
    const rawText = await response.text();
    let raw = null;
    try {
      raw = rawText ? JSON.parse(rawText) : null;
    } catch {
      raw = {raw_text: rawText};
    }
    if (!response.ok) {
      return {
        ok: false,
        provider: "ark_doubao",
        model: config.ai.arkModel,
        error_code: "provider_error",
        status: response.status,
        raw,
        timing: {total_ms: Date.now() - startedAt},
      };
    }
    return {
      ok: true,
      provider: "ark_doubao",
      model: raw?.model || config.ai.arkModel,
      text: raw?.choices?.[0]?.message?.content || "",
      raw,
      usage: raw?.usage || null,
      timing: {total_ms: Date.now() - startedAt},
    };
  } catch (error) {
    return {
      ok: false,
      provider: "ark_doubao",
      model: config.ai.arkModel,
      error_code: error?.name === "AbortError" ? "provider_timeout" : "provider_error",
      error_message: error instanceof Error ? error.message : String(error),
      timing: {total_ms: Date.now() - startedAt},
    };
  } finally {
    clearTimeout(timer);
  }
}
