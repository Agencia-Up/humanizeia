/**
 * aiGateway.ts — José v3.1 / Fase 0
 *
 * PONTO ÚNICO por onde TODA chamada de IA do José passa. Recebe (capability, input),
 * lê jose_providers_config (modelo/provider trocável SEM deploy), resolve a chave via
 * BYOK (resolveAiKey), chama o provider certo, faz FALLBACK em falha, mede consumo e
 * grava no jose_usage_ledger. Nenhuma edge function do José chama OpenAI/Anthropic direto.
 *
 * USO (in-process, dentro de uma edge function com SERVICE ROLE):
 *   import { callAiGateway } from "../_shared/jose-v2/aiGateway.ts";
 *   const r = await callAiGateway(admin, {
 *     user_id, ad_account_id, capability: 'llm',
 *     input: { system, messages, max_tokens: 2000 },
 *     ref_tipo: 'reasoning', ref_id: verdictId,
 *   });
 *   if (r.ok) use r.text;
 *
 * Requer client supabase com SERVICE ROLE (lê config + grava ledger + RPC do Vault).
 */

import {
  resolveAiKey,
  classifyProviderHttpError,
  type AiProvider,
} from "../aiKeys.ts";

export type JoseCapability = "llm" | "vision" | "stt" | "tts";

export interface GatewayInput {
  // llm / vision
  system?: string;
  messages?: any[];          // formato Anthropic (role/content). Vision = content com blocos image.
  max_tokens?: number;
  temperature?: number;
  // stt
  audio?: { base64?: string; mime?: string; filename?: string };
  language?: string;
  // tts
  text?: string;
  voice?: string;
  // function-calling (llm) — só Anthropic suporta hoje; o fallback OpenAI degrada p/ texto.
  tools?: any[];
  tool_choice?: any;
  // genérico
  params?: Record<string, any>;
}

export interface GatewayCallOpts {
  user_id: string | null;
  ad_account_id?: string | null;
  capability: JoseCapability;
  input: GatewayInput;
  ref_tipo?: string;
  ref_id?: string | null;
}

export interface GatewayResult {
  ok: boolean;
  capability: JoseCapability;
  provider: string;
  model: string;
  used_fallback: boolean;
  text?: string;        // llm / vision
  tool_use?: any[];     // blocos tool_use (function-calling Anthropic)
  content?: any[];      // content cru do assistant (replay no loop de ferramentas)
  stop_reason?: string;
  transcript?: string;  // stt
  audio_base64?: string;// tts
  usage: { tokens_in?: number; tokens_out?: number; minutes?: number; images?: number };
  cost_usd: number;
  source?: "client" | "platform" | "none";
  error?: string;
}

interface ProviderChoice {
  provider: string;
  model: string;
  params: Record<string, any>;
  fallback_provider?: string | null;
  fallback_model?: string | null;
}

// Defaults de código (quando jose_providers_config ainda não tem linha). O dono troca pelo painel.
// Mantém o modelo que o José já usa hoje (claude-3-5-sonnet) p/ não mudar custo silenciosamente.
const DEFAULTS: Record<JoseCapability, ProviderChoice> = {
  llm:    { provider: "anthropic", model: "claude-3-5-sonnet-20241022", params: {}, fallback_provider: "openai", fallback_model: "gpt-4o" },
  vision: { provider: "anthropic", model: "claude-3-5-sonnet-20241022", params: {}, fallback_provider: "openai", fallback_model: "gpt-4o" },
  stt:    { provider: "openai", model: "gpt-4o-transcribe", params: {}, fallback_provider: "openai", fallback_model: "whisper-1" },
  tts:    { provider: "openai", model: "gpt-4o-mini-tts", params: { voice: "alloy" }, fallback_provider: null, fallback_model: null },
};

// Preços aproximados (USD). LLM = por 1M tokens (in/out). Voz = por minuto.
const PRICE_LLM: Record<string, { in: number; out: number }> = {
  "claude-3-5-sonnet-20241022": { in: 3, out: 15 },
  "claude-3-5-haiku-20241022":  { in: 0.8, out: 4 },
  "gpt-4o":      { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};
const PRICE_VOICE_PER_MIN: Record<string, number> = {
  "gpt-4o-transcribe": 0.006,
  "whisper-1":         0.006,
  "gpt-4o-mini-tts":   0.015,
};
const DEFAULT_LLM_PRICE = { in: 3, out: 15 };

async function loadProviderChoice(
  admin: any,
  userId: string | null,
  capability: JoseCapability,
): Promise<ProviderChoice> {
  try {
    // tenant-específico vence o global; ativo apenas.
    const { data } = await admin
      .from("jose_providers_config")
      .select("user_id, provider, model, params, fallback_provider, fallback_model, ativo")
      .eq("capability", capability)
      .eq("ativo", true)
      .or(`user_id.is.null${userId ? `,user_id.eq.${userId}` : ""}`);
    const rows = (data || []) as any[];
    const chosen = rows.sort((a, b) => Number(Boolean(b.user_id)) - Number(Boolean(a.user_id)))[0];
    if (chosen) {
      return {
        provider: chosen.provider,
        model: chosen.model,
        params: chosen.params || {},
        fallback_provider: chosen.fallback_provider,
        fallback_model: chosen.fallback_model,
      };
    }
  } catch (_e) { /* cai pro default */ }
  return DEFAULTS[capability];
}

function asAiProvider(p: string): AiProvider {
  return (p === "openai" || p === "anthropic" || p === "deepseek") ? p : "openai";
}

// ── Chamadas por provider ──────────────────────────────────────────────────

async function callAnthropicLLM(key: string, model: string, input: GatewayInput) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: input.max_tokens ?? 2000,
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      ...(input.system ? { system: input.system } : {}),
      ...(Array.isArray(input.tools) && input.tools.length ? { tools: input.tools } : {}),
      ...(input.tool_choice ? { tool_choice: input.tool_choice } : {}),
      messages: input.messages ?? [],
    }),
  });
  if (!res.ok) return { ok: false as const, res };
  const j = await res.json();
  const content = Array.isArray(j?.content) ? j.content : [];
  const text = content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
  const tool_use = content.filter((b: any) => b?.type === "tool_use");
  return {
    ok: true as const,
    text,
    tool_use,
    content,
    stop_reason: j?.stop_reason,
    tokens_in: j?.usage?.input_tokens ?? 0,
    tokens_out: j?.usage?.output_tokens ?? 0,
  };
}

async function callOpenAILLM(key: string, model: string, input: GatewayInput) {
  // Converte mensagens estilo Anthropic -> OpenAI (texto simples; visão simplificada).
  const messages: any[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  for (const m of input.messages ?? []) {
    const content = typeof m.content === "string"
      ? m.content
      : (Array.isArray(m.content) ? m.content.map((c: any) => c?.text || "").join("\n") : "");
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: input.max_tokens ?? 2000, messages }),
  });
  if (!res.ok) return { ok: false as const, res };
  const j = await res.json();
  return {
    ok: true as const,
    text: j?.choices?.[0]?.message?.content ?? "",
    tokens_in: j?.usage?.prompt_tokens ?? 0,
    tokens_out: j?.usage?.completion_tokens ?? 0,
  };
}

async function callOpenAISTT(key: string, model: string, input: GatewayInput) {
  if (!input.audio?.base64) return { ok: false as const, res: new Response("no audio", { status: 400 }) };
  const bin = Uint8Array.from(atob(input.audio.base64), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append("file", new Blob([bin], { type: input.audio.mime || "audio/ogg" }), input.audio.filename || "audio.ogg");
  fd.append("model", model);
  if (input.language) fd.append("language", input.language);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!res.ok) return { ok: false as const, res };
  const j = await res.json();
  // duração estimada: ~ bytes/ (16kbps ogg) — aproximação p/ ledger; refinar na Fase 2.
  const minutes = Math.max(0.05, bin.length / (16000 / 8) / 60);
  return { ok: true as const, transcript: j?.text ?? "", minutes };
}

async function callOpenAITTS(key: string, model: string, input: GatewayInput) {
  const voice = input.voice || input.params?.voice || "alloy";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, voice, input: input.text || "" }),
  });
  if (!res.ok) return { ok: false as const, res };
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const audio_base64 = btoa(bin);
  // estimativa de minutos pela contagem de caracteres (~ 14 chars/seg de fala).
  const minutes = Math.max(0.05, (input.text || "").length / 14 / 60);
  return { ok: true as const, audio_base64, minutes };
}

function costLLM(model: string, tin: number, tout: number): number {
  const p = PRICE_LLM[model] || DEFAULT_LLM_PRICE;
  return (tin / 1_000_000) * p.in + (tout / 1_000_000) * p.out;
}
function costVoice(model: string, minutes: number): number {
  return minutes * (PRICE_VOICE_PER_MIN[model] ?? 0.01);
}

async function writeLedger(
  admin: any,
  base: { user_id: string | null; ad_account_id?: string | null; capability: JoseCapability; ref_tipo?: string; ref_id?: string | null },
  rows: Array<{ unidade: string; quantidade: number; custo_usd: number }>,
) {
  if (!base.user_id) return; // ledger é por tenant
  try {
    await admin.from("jose_usage_ledger").insert(
      rows.map((r) => ({
        user_id: base.user_id,
        ad_account_id: base.ad_account_id ?? null,
        capability: base.capability,
        unidade: r.unidade,
        quantidade: r.quantidade,
        custo_usd: r.custo_usd,
        ref_tipo: base.ref_tipo ?? null,
        ref_id: base.ref_id ?? null,
      })),
    );
  } catch (_e) { /* observabilidade nunca quebra a chamada */ }
}

// ── Executa uma capability com um provider/model específico ─────────────────
async function runOne(
  admin: any,
  opts: GatewayCallOpts,
  provider: string,
  model: string,
): Promise<{ result?: Partial<GatewayResult>; errRes?: Response; source: GatewayResult["source"] }> {
  const aiProv = asAiProvider(provider);
  const { key, source } = await resolveAiKey(admin, opts.user_id, aiProv);
  if (!key) return { errRes: new Response(JSON.stringify({ error: "no_api_key", source }), { status: 402 }), source };

  const cap = opts.capability;
  if (cap === "llm" || cap === "vision") {
    const out = provider === "anthropic"
      ? await callAnthropicLLM(key, model, opts.input)
      : await callOpenAILLM(key, model, opts.input);
    if (!out.ok) return { errRes: out.res, source };
    const cost = costLLM(model, out.tokens_in, out.tokens_out);
    await writeLedger(admin, { ...opts, capability: cap }, [
      { unidade: "tokens_in", quantidade: out.tokens_in, custo_usd: (out.tokens_in / 1_000_000) * (PRICE_LLM[model]?.in ?? DEFAULT_LLM_PRICE.in) },
      { unidade: "tokens_out", quantidade: out.tokens_out, custo_usd: (out.tokens_out / 1_000_000) * (PRICE_LLM[model]?.out ?? DEFAULT_LLM_PRICE.out) },
    ]);
    return { result: { text: out.text, tool_use: (out as any).tool_use, content: (out as any).content, stop_reason: (out as any).stop_reason, usage: { tokens_in: out.tokens_in, tokens_out: out.tokens_out }, cost_usd: cost }, source };
  }
  if (cap === "stt") {
    const out = await callOpenAISTT(key, model, opts.input);
    if (!out.ok) return { errRes: out.res, source };
    const cost = costVoice(model, out.minutes);
    await writeLedger(admin, { ...opts, capability: cap }, [{ unidade: "min", quantidade: out.minutes, custo_usd: cost }]);
    return { result: { transcript: out.transcript, usage: { minutes: out.minutes }, cost_usd: cost }, source };
  }
  // tts
  const out = await callOpenAITTS(key, model, opts.input);
  if (!out.ok) return { errRes: out.res, source };
  const cost = costVoice(model, out.minutes);
  await writeLedger(admin, { ...opts, capability: cap }, [{ unidade: "min", quantidade: out.minutes, custo_usd: cost }]);
  return { result: { audio_base64: out.audio_base64, usage: { minutes: out.minutes }, cost_usd: cost }, source };
}

// ── API pública ─────────────────────────────────────────────────────────────
export async function callAiGateway(admin: any, opts: GatewayCallOpts): Promise<GatewayResult> {
  const choice = await loadProviderChoice(admin, opts.user_id, opts.capability);
  const base: GatewayResult = {
    ok: false, capability: opts.capability, provider: choice.provider, model: choice.model,
    used_fallback: false, usage: {}, cost_usd: 0,
  };

  // 1ª tentativa: provider/model primário.
  const primary = await runOne(admin, opts, choice.provider, choice.model);
  if (primary.result) {
    return { ...base, ok: true, ...primary.result, source: primary.source };
  }

  // Fallback (se configurado). Classifica o erro p/ contexto.
  let errText = "";
  try { errText = primary.errRes ? await primary.errRes.clone().text() : ""; } catch (_e) { /* */ }
  const cls = primary.errRes ? classifyProviderHttpError(primary.errRes.status, errText) : { code: "unknown", kind: "other" as const };

  if (choice.fallback_provider && choice.fallback_model) {
    const fb = await runOne(admin, opts, choice.fallback_provider, choice.fallback_model);
    if (fb.result) {
      return {
        ...base, ok: true, used_fallback: true,
        provider: choice.fallback_provider, model: choice.fallback_model,
        ...fb.result, source: fb.source,
      };
    }
  }

  return { ...base, ok: false, error: `provider_failed:${cls.kind}:${cls.code}`, source: primary.source };
}
