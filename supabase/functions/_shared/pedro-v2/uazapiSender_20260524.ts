import { digitsOnly } from "./phone.ts";

import { splitMessageForHumanizationLLM } from "../humanization/llmMessageSplit.ts";
import { sendTypingPresence } from "../humanization/typingSimulator.ts";

type PedroWaInstance = {
  id?: string;
  instance_name?: string | null;
  api_url?: string | null;
  api_key?: string | null;
  api_key_encrypted?: string | null;
};

function normalizeBaseUrl(url?: string | null) {
  return String(url || "").replace(/\/+$/, "");
}

function getInstanceToken(instance: PedroWaInstance) {
  return instance.api_key_encrypted || instance.api_key || "";
}

export function normalizeDestination(value: string) {
  const digits = digitsOnly(value);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculatePedroV2DelayMs(text: string) {
  const len = String(text || "").length;
  // Delay proporcional ao tamanho: partes curtas (rajada conversacional)
  // saem rapido e naturais; textos longos (lista de estoque) levam um pouco
  // mais, mas com teto menor que antes pra nao parecer travado.
  const bySize = Math.min(5000, len * 30);
  const jitter = Math.floor(Math.random() * 1800);
  return Math.max(2500, Math.min(9000, 2000 + bySize + jitter));
}

export async function resolvePedroInstance(supabase: any, input: {
  user_id: string;
  agent_id?: string | null;
  instance_id?: string | null;
}) {
  if (input.instance_id) {
    const { data } = await supabase
      .from("wa_instances")
      .select("*")
      .eq("id", input.instance_id)
      .maybeSingle();
    if (data) return data;
  }

  if (input.agent_id) {
    const { data: agent } = await supabase
      .from("wa_ai_agents")
      .select("instance_id, instance_ids")
      .eq("id", input.agent_id)
      .maybeSingle();

    const instanceIds = [
      agent?.instance_id,
      ...(Array.isArray(agent?.instance_ids) ? agent.instance_ids : []),
    ].filter(Boolean);

    if (instanceIds.length > 0) {
      const { data } = await supabase
        .from("wa_instances")
        .select("*")
        .in("id", instanceIds)
        .eq("user_id", input.user_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data;
    }
  }

  const { data } = await supabase
    .from("wa_instances")
    .select("*")
    .eq("user_id", input.user_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function sendPedroTextOnce(instance: PedroWaInstance, input: { to: string; text: string }) {
  const baseUrl = normalizeBaseUrl(instance.api_url);
  const token = getInstanceToken(instance);
  const destination = normalizeDestination(input.to);
  if (!baseUrl) throw new Error("Instancia WhatsApp sem URL configurada");
  if (!token) throw new Error("Instancia WhatsApp sem token configurado");
  if (!destination) throw new Error("Destino WhatsApp invalido");

  const remoteJid = `${destination}@s.whatsapp.net`;
  const attempts = [
    { label: "send-text-number", url: `${baseUrl}/send/text`, body: { number: destination, text: input.text } },
    { label: "send-text-remotejid", url: `${baseUrl}/send/text`, body: { remoteJid, text: input.text } },
    { label: "message-sendText", url: `${baseUrl}/message/sendText/${instance.instance_name || ""}`, body: { number: destination, text: input.text } },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    const res = await fetch(attempt.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", token, apikey: token },
      body: JSON.stringify(attempt.body),
    });
    if (res.ok) return { ok: true, provider: "uazapi", attempt: attempt.label, status: res.status };
    lastError = `${attempt.label}: HTTP ${res.status} ${await res.text().catch(() => "")}`;
  }
  return { ok: false, provider: "uazapi", error: lastError || "Falha ao enviar texto" };
}

export async function sendPedroText(
  instance: PedroWaInstance,
  input: { to: string; text: string },
  options?: { humanize?: boolean; typingOnly?: boolean },
) {
  const baseUrl = normalizeBaseUrl(instance.api_url);
  const token = getInstanceToken(instance);
  const destination = normalizeDestination(input.to);
  if (!baseUrl) throw new Error("Instancia WhatsApp sem URL configurada");
  if (!token) throw new Error("Instancia WhatsApp sem token configurado");
  if (!destination) throw new Error("Destino WhatsApp invalido");

  if (!options?.humanize) {
    if (options?.typingOnly) {
      await sendTypingPresence(baseUrl, token, destination, "composing").catch(() => false);
      await sleep(calculatePedroV2DelayMs(input.text));
      const result = await sendPedroTextOnce(instance, input);
      await sendTypingPresence(baseUrl, token, destination, "paused").catch(() => false);
      return { ...result, attempt: result.ok ? "typing-preserved-text" : result.attempt };
    }
    return sendPedroTextOnce(instance, input);
  }

  // Conversa: LLM barata (gpt-4o-mini) escolhe cortes naturais ate 3 mensagens
  // (>=130 chars), evitando separar modelo/ano. Cai no splitter heuristico em
  // qualquer falha. NAO afeta a lista de estoque (vem por outro caminho, typingOnly).
  const parts = await splitMessageForHumanizationLLM(input.text, { maxParts: 3, minLength: 130 });
  const attempts: any[] = [];

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    await sendTypingPresence(baseUrl, token, destination, "composing").catch(() => false);
    await sleep(calculatePedroV2DelayMs(part));
    const result = await sendPedroTextOnce(instance, { to: destination, text: part });
    attempts.push(result);
    await sendTypingPresence(baseUrl, token, destination, "paused").catch(() => false);
    if (!result.ok) return { ...result, parts_sent: index, attempts };
    if (index < parts.length - 1) await sleep(900);
  }

  return {
    ok: true,
    provider: "uazapi",
    attempt: "humanized-text",
    parts_sent: parts.length,
    attempts,
  };
}

export async function sendPedroMedia(instance: PedroWaInstance, input: {
  to: string;
  file: string;
  type?: "image" | "audio" | "video" | "document";
  caption?: string;
}) {
  const baseUrl = normalizeBaseUrl(instance.api_url);
  const token = getInstanceToken(instance);
  const destination = normalizeDestination(input.to);
  if (!baseUrl) throw new Error("Instancia WhatsApp sem URL configurada");
  if (!token) throw new Error("Instancia WhatsApp sem token configurado");
  if (!destination) throw new Error("Destino WhatsApp invalido");

  const res = await fetch(`${baseUrl}/send/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token, apikey: token },
    body: JSON.stringify({
      number: destination,
      file: input.file,
      type: input.type || "image",
      caption: input.caption || "",
    }),
  });
  if (res.ok) return { ok: true, provider: "uazapi", attempt: "send-media", status: res.status };
  return {
    ok: false,
    provider: "uazapi",
    error: `send-media: HTTP ${res.status} ${await res.text().catch(() => "")}`,
  };
}
