// Valida classifyProviderHttpError contra o formato REAL de erro da OpenAI.
// (1) chave invalida -> chamada real na OpenAI -> 401 body real -> espera 'auth'
// (2) corpos conhecidos de quota/rate -> espera 'quota'/'rate'
// A logica abaixo e COPIA EXATA de aiKeys.ts:classifyProviderHttpError (mantenha em sincronia).

function classifyProviderHttpError(status, bodyText) {
  let code = "";
  try { const j = JSON.parse(bodyText); code = String(j?.error?.code || j?.error?.type || j?.type || ""); } catch (_e) {}
  const c = code.toLowerCase();
  const body = String(bodyText || "").toLowerCase();
  if (status === 401 || status === 403 || c.includes("invalid_api_key") || c.includes("authentication") || body.includes("invalid api key")) {
    return { code: code || `http_${status}`, kind: "auth" };
  }
  if (c.includes("insufficient_quota") || c.includes("billing") || body.includes("insufficient_quota") || body.includes("exceeded your current quota") || body.includes("credit balance is too low")) {
    return { code: code || "insufficient_quota", kind: "quota" };
  }
  if (status === 429) return { code: code || "rate_limit", kind: "rate" };
  return { code: code || `http_${status}`, kind: "other" };
}

const results = [];

// (1) 401 REAL da OpenAI com chave garbage.
try {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer sk-garbage-invalid-key-xxx", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
  });
  const body = await r.text();
  results.push({ case: "openai_invalid_key_LIVE", status: r.status, classified: classifyProviderHttpError(r.status, body), body_excerpt: body.slice(0, 160) });
} catch (e) {
  results.push({ case: "openai_invalid_key_LIVE", error: String(e?.message || e) });
}

// (2) corpos conhecidos (sem rede): quota e rate-limit.
const quotaBody = JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", code: "insufficient_quota" } });
results.push({ case: "openai_insufficient_quota_429", classified: classifyProviderHttpError(429, quotaBody), expect: "quota" });

const rateBody = JSON.stringify({ error: { message: "Rate limit reached for gpt-4o", type: "requests", code: "rate_limit_exceeded" } });
results.push({ case: "openai_rate_limit_429", classified: classifyProviderHttpError(429, rateBody), expect: "rate" });

const anthropicCredit = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });
results.push({ case: "anthropic_low_credit_400", classified: classifyProviderHttpError(400, anthropicCredit), expect: "quota" });

const transient = JSON.stringify({ error: { message: "The server had an error", type: "server_error" } });
results.push({ case: "openai_500_transient", classified: classifyProviderHttpError(500, transient), expect: "other" });

console.log(JSON.stringify(results, null, 2));
