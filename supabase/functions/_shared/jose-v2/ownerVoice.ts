/**
 * ownerVoice.ts — José v3.1 / Fase 2 (voz, simplificada)
 *
 * O DONO manda ÁUDIO pro José (pergunta ou resposta do gate). José TRANSCREVE
 * (STT via gateway) e responde por TEXTO — sem voz de volta. Áudio de LEAD não
 * passa por aqui (continua no fluxo do Pedro). Só roda quando a mensagem é áudio.
 */

import { resolvePedroInstance, sendPedroText } from "../pedro-v2/uazapiSender.ts";
import { phonesMatch, remoteJidToPhone } from "../pedro-v2/phone.ts";
import { callAiGateway } from "./aiGateway.ts";
import { resolveApprovalNumbers, applyApprovalDecision, parseSimNao } from "./approvalGate.ts";
import { isFeatureEnabled } from "./flags.ts";
import { analyzeCreativeImage, formatAnaliseWhatsApp } from "./visionAnalysis.ts";

// Extrai a URL do áudio do payload (mesma lógica do pedro-webhook-v2). null = não é áudio.
export function extractAudioUrl(payload: any): { url: string; mime?: string } | null {
  const inMsg = (Array.isArray(payload?.messages) && payload.messages[0]) ||
    (Array.isArray(payload?.data) && payload.data[0]) || payload?.message || payload?.data || payload;
  const mt = String(inMsg?.messageType || "").toLowerCase();
  const isAudio = mt.includes("audio") || mt.includes("ptt") || !!inMsg?.message?.audioMessage;
  if (!isAudio) return null;
  const url = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.audioMessage?.url || null;
  if (!url) return null;
  const mime = inMsg?.mimetype || inMsg?.mime || inMsg?.message?.audioMessage?.mimetype || "audio/ogg";
  return { url: String(url), mime: String(mime) };
}

async function downloadBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "audio/ogg";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { base64: btoa(bin), mime };
  } catch (_e) { return null; }
}

// Pergunta aberta do dono -> José responde por texto, com um contexto enxuto da conta.
async function askJose(admin: any, userId: string, question: string): Promise<string> {
  // contexto barato: último veredito + vendas recentes.
  let contexto = "";
  try {
    const { data: vd } = await admin.from("jose_campaign_verdict")
      .select("veredito, justificativa, nivel3, created_at").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (vd) contexto += `Último veredito: ${vd.veredito}. ${vd.justificativa || ""} `;
  } catch (_e) { /* ignore */ }
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const { count } = await admin.from("comercial_vendas").select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("data_venda", since);
    contexto += `Vendas nos últimos 7 dias: ${count || 0}.`;
  } catch (_e) { /* ignore */ }

  const system = [
    "Você é o JOSÉ, gestor de tráfego pago da concessionária, falando com o DONO no WhatsApp.",
    "Responda em português, CURTO e direto (no máximo 4-5 frases), como um gestor experiente.",
    "Baseie-se no contexto fornecido; NÃO invente números. Se não tiver o dado, diga que precisa de uma análise no painel.",
  ].join(" ");
  try {
    const r = await callAiGateway(admin, {
      user_id: userId, capability: "llm",
      input: { system, messages: [{ role: "user", content: `Contexto: ${contexto}\n\nPergunta do dono: ${question}` }], max_tokens: 350 },
      ref_tipo: "owner_voice",
    });
    return (r.ok && r.text) ? r.text.trim() : "Recebi sua mensagem, mas não consegui processar agora. Dá uma olhada no painel do José.";
  } catch (_e) {
    return "Recebi sua mensagem, mas não consegui processar agora. Dá uma olhada no painel do José.";
  }
}

// Trata o áudio do DONO. Retorna { handled }. Áudio de lead -> handled:false (Pedro segue).
export async function handleOwnerVoice(
  supabase: any,
  input: { user_id: string; agent_id?: string | null; payload: any; remote_jid: string; instance?: any },
): Promise<{ handled: boolean; action?: string }> {
  try {
    const audio = extractAudioUrl(input.payload);
    if (!audio) return { handled: false }; // não é áudio
    // nada liga sem flag: voz só funciona se o dono ligou o recurso "voz".
    if (!(await isFeatureEnabled(supabase, input.user_id, "voz"))) return { handled: false };

    const fromPhone = remoteJidToPhone(input.remote_jid);
    if (!fromPhone) return { handled: false };
    const owners = await resolveApprovalNumbers(supabase, input.user_id);
    if (!owners.some((n) => phonesMatch(n, fromPhone))) return { handled: false }; // áudio de lead -> Pedro

    const reply = async (text: string) => {
      try {
        const instance = input.instance || await resolvePedroInstance(supabase, { user_id: input.user_id, agent_id: input.agent_id || null });
        if (instance) await sendPedroText(instance, { to: fromPhone, text });
      } catch (_e) { /* ignore */ }
    };

    // transcreve (STT via gateway)
    const dl = await downloadBase64(audio.url);
    if (!dl) { await reply("Não consegui baixar seu áudio. Me manda por texto?"); return { handled: true, action: "download_fail" }; }
    const stt = await callAiGateway(supabase, {
      user_id: input.user_id, capability: "stt",
      input: { audio: { base64: dl.base64, mime: dl.mime, filename: "audio.ogg" }, language: "pt" },
      ref_tipo: "owner_voice_stt",
    });
    const transcript = (stt.ok && stt.transcript) ? stt.transcript.trim() : "";
    if (!transcript) { await reply("Não entendi o áudio. Pode mandar por texto?"); return { handled: true, action: "stt_empty" }; }

    // 1) é resposta do gate? (SIM/NÃO falado)
    const decision = parseSimNao(transcript);
    if (decision) {
      const { data: pendentes } = await supabase.from("jose_action_approvals")
        .select("*").eq("user_id", input.user_id).eq("status", "pendente")
        .order("created_at", { ascending: false }).limit(1);
      const pending = (pendentes || [])[0] || null;
      if (pending) {
        await supabase.from("jose_action_approvals").update({ resposta_raw: `[áudio] ${transcript}`.slice(0, 200) }).eq("id", pending.id);
        const res = await applyApprovalDecision(supabase, pending, decision, "whatsapp");
        await reply(decision === "aprovado"
          ? (res.ok ? "✅ Entendi: autorizado. José executou." : "✅ Autorizado, mas não consegui executar agora.")
          : "❌ Entendi: cancelado.");
        return { handled: true, action: "gate_" + decision };
      }
    }

    // 2) pergunta aberta -> José responde por texto
    const resposta = await askJose(supabase, input.user_id, transcript);
    await reply(resposta);
    return { handled: true, action: "answered" };
  } catch (_e) {
    return { handled: false }; // fail-safe: não bloqueia o Pedro
  }
}

// ── Fase 3: imagem (criativo) do DONO -> José analisa por visão e responde ─────
export function extractImageUrl(payload: any): { url: string; mime?: string } | null {
  const inMsg = (Array.isArray(payload?.messages) && payload.messages[0]) ||
    (Array.isArray(payload?.data) && payload.data[0]) || payload?.message || payload?.data || payload;
  const mt = String(inMsg?.messageType || "").toLowerCase();
  const isImage = mt.includes("image") || !!inMsg?.message?.imageMessage;
  if (!isImage) return null;
  const url = inMsg?.mediaUrl || inMsg?.directUrl || inMsg?.media_url || inMsg?.url || inMsg?.message?.imageMessage?.url || null;
  if (!url) return null;
  const mime = inMsg?.mimetype || inMsg?.mime || inMsg?.message?.imageMessage?.mimetype || "image/jpeg";
  return { url: String(url), mime: String(mime) };
}

export async function handleOwnerImage(
  supabase: any,
  input: { user_id: string; agent_id?: string | null; payload: any; remote_jid: string; instance?: any },
): Promise<{ handled: boolean; action?: string }> {
  try {
    const img = extractImageUrl(input.payload);
    if (!img) return { handled: false };
    if (!(await isFeatureEnabled(supabase, input.user_id, "criativo_whatsapp"))) return { handled: false };

    const fromPhone = remoteJidToPhone(input.remote_jid);
    if (!fromPhone) return { handled: false };
    const owners = await resolveApprovalNumbers(supabase, input.user_id);
    if (!owners.some((n) => phonesMatch(n, fromPhone))) return { handled: false }; // imagem de lead -> Pedro

    const reply = async (text: string) => {
      try {
        const instance = input.instance || await resolvePedroInstance(supabase, { user_id: input.user_id, agent_id: input.agent_id || null });
        if (instance) await sendPedroText(instance, { to: fromPhone, text });
      } catch (_e) { /* ignore */ }
    };

    // nicho da 1ª conta do dono (best-effort)
    let nicho = "generico";
    try {
      const { data: acc } = await supabase.from("ad_accounts").select("nicho").eq("user_id", input.user_id).eq("is_active", true).limit(1).maybeSingle();
      if (acc?.nicho) nicho = acc.nicho;
    } catch (_e) { /* ignore */ }

    const res = await analyzeCreativeImage(supabase, { user_id: input.user_id, nicho, image_url: img.url, mime: img.mime });
    if (!res.ok || !res.analise) { await reply("Não consegui analisar a imagem agora. Tenta de novo?"); return { handled: true, action: "vision_fail" }; }

    // guarda o criativo do WhatsApp como metadado (best-effort; não quebra se constraint).
    try {
      await supabase.from("creatives").insert({
        user_id: input.user_id, name: `WhatsApp ${new Date().toISOString().slice(0, 10)}`,
        type: "image", file_url: img.url, origem: "whatsapp",
        analise_visao: res.analise, tags: res.analise.tags || [], enriquecido_em: new Date().toISOString(),
      });
    } catch (_e) { /* ignore */ }

    await reply(formatAnaliseWhatsApp(res.analise));
    return { handled: true, action: "analyzed" };
  } catch (_e) {
    return { handled: false };
  }
}
