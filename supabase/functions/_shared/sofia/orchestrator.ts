// ============================================================================
// SOFIA — cérebro do agente SDR "Geral" (agent_type='sdr_geral').
// ----------------------------------------------------------------------------
// Vende a PRÓPRIA Logos IA: qualifica o lead (dono/decisor) e AGENDA uma demo.
// NÃO fecha venda, NÃO usa BNDV. Memória boa (não repete pergunta, lembra ao
// voltar). Funil em 4 fases: Conexão → Descoberta/Dor → Valor/Curiosidade → CTA.
//
// Mesmo contrato do Pedro: processSofiaTurn(supabase, { payload, agent,
// wa_instance, dry_run }) -> { ok, ... }. Roteado no pedro-webhook-v2 por
// agent_type==='sdr_geral'. Módulo ISOLADO: não importa nada do fluxo de carro.
//
// Reaproveita do _shared/pedro-v2: sendPedroText (envio), ensurePedroV2Lead +
// loadPedroMemory (CRM/memória). Calendário via _shared/google-calendar.ts.
// ============================================================================

import { sendPedroText } from "../pedro-v2/uazapiSender.ts";
import { ensurePedroV2Lead, loadPedroMemory } from "../pedro-v2/leadMemory.ts";
import { managerPhones } from "../transfer/managers.ts";
import {
  isCalendarConfigured,
  getBusyBlocks,
  createMeeting,
} from "../google-calendar.ts";

// --------------------------------- tipos -----------------------------------
export interface SofiaState {
  perfil?: { nome?: string | null; empresa?: string | null; cargo?: string | null; segmento?: string | null; site?: string | null };
  champ?: {
    dor_principal?: string | null;
    fluxo_atual?: string | null;
    leads_por_dia?: number | null;
    investe_trafego?: boolean | null;
    cpl_atual?: string | null;
    urgencia?: string | null;
    decisor?: boolean | null;
  };
  interesse?: { diferencial_que_engajou?: string | null; objecoes?: string[] };
  agendamento?: { status?: string; data_hora?: string | null; meet_link?: string | null; event_id?: string | null };
  proximo_passo?: string | null;
}

type SofiaIntent = "saudacao" | "qualificando" | "objecao" | "agendar" | "despedida" | "off_topic";

interface SofiaPlan {
  intent: SofiaIntent;
  fase: "conexao" | "descoberta" | "valor" | "cta" | "encerramento";
  extracted: SofiaState;
  wants_scheduling: boolean;
  resumo_curto: string;
}

// ------------------------------ parse inbound -------------------------------
function collectMessages(payload: any): any[] {
  if (Array.isArray(payload?.messages)) return payload.messages;
  if (payload?.message) return [payload.message?.key ? payload.message : { message: payload.message }];
  if (payload?.data?.messages && Array.isArray(payload.data.messages)) return payload.data.messages;
  if (payload?.data) return [payload.data];
  return [];
}

function extractText(m: any): string {
  const t =
    m?.message?.conversation ||
    m?.message?.extendedTextMessage?.text ||
    m?.message?.imageMessage?.caption ||
    m?.text ||
    m?.body ||
    m?.content ||
    "";
  return typeof t === "string" ? t.trim() : "";
}

function resolveJid(raw: string, m: any): string {
  let jid = String(raw || "");
  if (jid.endsWith("@lid")) {
    const alt = String(m?.key?.remoteJidAlt || m?.remoteJidAlt || m?.key?.senderPn || m?.senderPn || "");
    if (alt.endsWith("@s.whatsapp.net")) jid = alt;
    else {
      const d = alt.replace(/\D/g, "");
      if (d.length >= 10) jid = `${d}@s.whatsapp.net`;
    }
  }
  return jid;
}

function parseInbound(payload: any): { remote_jid: string; lead_phone: string; push_name: string; user_text: string } {
  const msgs = collectMessages(payload);
  let remoteJidRaw = "";
  let pushName = "";
  const texts: string[] = [];
  for (const m of msgs) {
    const jid = m?.key?.remoteJid || m?.chatid || m?.sender || m?.from || "";
    if (jid && !remoteJidRaw) remoteJidRaw = resolveJid(jid, m);
    if (!pushName && (m?.pushName || m?.senderName || m?.notifyName)) pushName = m.pushName || m.senderName || m.notifyName;
    const t = extractText(m);
    if (t) texts.push(t);
  }
  // Fallback p/ payload "achatado" (dry-run / simplificado): {chatid|remoteJid, text|body, senderName}
  if (!remoteJidRaw) remoteJidRaw = resolveJid(String(payload?.chatid || payload?.remoteJid || payload?.sender || payload?.from || ""), payload);
  if (!pushName) pushName = String(payload?.senderName || payload?.pushName || payload?.notifyName || "");
  if (!texts.length) {
    const flat = extractText(payload);
    if (flat) texts.push(flat);
  }
  const phone = remoteJidRaw.replace(/@.*$/, "").replace(/\D/g, "");
  return {
    remote_jid: phone ? `${phone}@s.whatsapp.net` : remoteJidRaw,
    lead_phone: phone,
    push_name: pushName,
    user_text: texts.join("\n").trim(),
  };
}

// -------------------------------- memória -----------------------------------
function sofiaScore(s: SofiaState): number {
  let score = 0;
  if (s.perfil?.nome) score += 8;
  if (s.perfil?.empresa) score += 10;
  if (s.perfil?.cargo) score += 12;
  if (s.perfil?.segmento) score += 10;
  if (s.champ?.dor_principal) score += 20;
  if (s.champ?.fluxo_atual) score += 8;
  if (s.champ?.leads_por_dia != null) score += 8;
  if (s.champ?.investe_trafego != null) score += 8;
  if (s.champ?.urgencia) score += 8;
  if (s.champ?.decisor === true) score += 8;
  return Math.min(100, score);
}

function mergeState(base: SofiaState, patch: SofiaState): SofiaState {
  const out: any = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) out[k] = v;
    else if (typeof v === "object") out[k] = mergeState(out[k] || {}, v as any);
    else out[k] = v;
  }
  return out as SofiaState;
}

// ------------------------------ LLM (OpenAI) --------------------------------
async function callOpenAI(model: string, system: string, user: string, jsonMode: boolean): Promise<string> {
  const key = (globalThis as any)?.Deno?.env?.get?.("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY ausente");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: jsonMode ? 0.1 : 0.7,
      max_tokens: jsonMode ? 700 : 500,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  return data?.choices?.[0]?.message?.content || "";
}

const PLANNER_MODEL = () => (globalThis as any)?.Deno?.env?.get?.("SOFIA_PLANNER_MODEL") || "gpt-4o-mini";
const REPLY_MODEL = () => (globalThis as any)?.Deno?.env?.get?.("SOFIA_REPLY_MODEL") || "gpt-4o";

function historyToText(history: Array<{ role: string; content: string }>): string {
  return history.map((h) => `${h.role === "assistant" ? "Sofia" : "Lead"}: ${h.content}`).join("\n");
}

// -------------------------------- planner -----------------------------------
async function planTurn(state: SofiaState, history: Array<{ role: string; content: string }>, userText: string): Promise<SofiaPlan> {
  const system = `Você é o PLANNER da Sofia, SDR da Logos IA (vende uma plataforma de IA para vendas a donos de negócio, foco em concessionárias). Sua tarefa NÃO é responder ao lead — é classificar o turno e extrair dados. Responda APENAS em JSON.

Intenções possíveis (campo "intent"):
- "saudacao": primeiro contato / cumprimento.
- "qualificando": o lead está respondendo perguntas / falando da empresa/dor.
- "objecao": dúvida, resistência, "tá caro", "não tenho tempo", "como funciona".
- "agendar": o lead aceitou conversar/ver demo, deu disponibilidade, ou pediu pra marcar.
- "despedida": encerrou educadamente / "depois falo" / "obrigado, por enquanto é só".
- "off_topic": assunto sem relação com a Logos.

Fases (campo "fase"): "conexao" (descobrir cargo/segmento), "descoberta" (dor/fluxo/volume), "valor" (já tem dor, falta gerar curiosidade), "cta" (qualificado, propor reunião), "encerramento".

Extraia para "extracted" SÓ o que o lead disse explicitamente (não invente; use null se não souber):
{ "perfil": {"nome","empresa","cargo","segmento","site"},
  "champ": {"dor_principal","fluxo_atual","leads_por_dia"(número),"investe_trafego"(bool),"cpl_atual","urgencia","decisor"(bool)},
  "interesse": {"objecoes":[...]} }

"wants_scheduling": true só se o lead claramente quer marcar/aceitou a reunião ou deu horário.
"resumo_curto": 1 frase do estado da conversa.

JSON: { "intent","fase","extracted","wants_scheduling"(bool),"resumo_curto" }`;

  const user = `MEMÓRIA ATUAL (já sabido, NÃO pergunte de novo):
${JSON.stringify(state || {}, null, 0)}

HISTÓRICO RECENTE:
${historyToText(history) || "(sem histórico)"}

NOVA MENSAGEM DO LEAD:
${userText}`;

  try {
    const raw = await callOpenAI(PLANNER_MODEL(), system, user, true);
    const parsed = JSON.parse(raw);
    return {
      intent: (parsed?.intent || "qualificando") as SofiaIntent,
      fase: (parsed?.fase || "conexao"),
      extracted: (parsed?.extracted || {}) as SofiaState,
      wants_scheduling: parsed?.wants_scheduling === true,
      resumo_curto: String(parsed?.resumo_curto || ""),
    };
  } catch (_e) {
    // Fallback seguro: trata como qualificação, sem extração.
    return { intent: "qualificando", fase: "conexao", extracted: {}, wants_scheduling: false, resumo_curto: "" };
  }
}

// --------------------------------- reply ------------------------------------
const SOFIA_PERSONA_FALLBACK = `Você é a Sofia, SDR da Logos IA Brasil — especialista em IA e automação para vendas no WhatsApp.
Seu objetivo NÃO é vender, é QUALIFICAR e AGENDAR uma demonstração com um especialista.
Tom: humana, consultiva, empática. Mensagens CURTAS, UMA pergunta por vez. Use o nome do lead.
NUNCA repita uma pergunta já respondida (confira a memória). Gere CURIOSIDADE — não entregue tudo.
A Logos é um ecossistema de IA (tráfego + atendimento SDR + CRM) que mostra o Custo por Lead AO VIVO dentro do atendimento; na demo o especialista mostra isso na prática.`;

async function generateReply(
  agentPrompt: string | null,
  state: SofiaState,
  history: Array<{ role: string; content: string }>,
  userText: string,
  plan: SofiaPlan,
  schedulingNote: string,
): Promise<string> {
  const persona = (agentPrompt && agentPrompt.trim().length > 30) ? agentPrompt : SOFIA_PERSONA_FALLBACK;
  const system = `${persona}

REGRAS DE SAÍDA:
- Responda como a Sofia, em português, no WhatsApp. Curto (1-3 linhas). UMA pergunta por vez.
- Fase atual do funil: ${plan.fase}. Intenção do lead: ${plan.intent}.
- Não repita perguntas cuja resposta já está na memória.
- Se for "valor", conecte a dor do lead ao diferencial e desperte curiosidade pra demo.
- Se for "cta"/agendar, conduza para marcar a reunião.${schedulingNote ? "\n- " + schedulingNote : ""}
- Se "despedida", encerre com gentileza, sem insistir.
- Responda SOMENTE com o texto da mensagem (sem aspas, sem rótulos).`;

  const user = `MEMÓRIA (o que já sabemos do lead):
${JSON.stringify(state || {}, null, 0)}

HISTÓRICO RECENTE:
${historyToText(history) || "(sem histórico)"}

MENSAGEM DO LEAD AGORA:
${userText}`;

  const text = await callOpenAI(REPLY_MODEL(), system, user, false);
  return String(text || "").trim();
}

// ------------------------------ agendamento ---------------------------------
function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

// Gera 2 sugestões de horário (dias úteis, 10h e 15h) a partir de amanhã,
// pulando blocos ocupados. Sem dependência de libs de data.
function buildSlotSuggestions(busy: Array<{ start: string; end: string }>): Array<{ startISO: string; endISO: string; label: string }> {
  const out: Array<{ startISO: string; endISO: string; label: string }> = [];
  const tzOffset = "-03:00";
  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const base = new Date();
  for (let addDay = 1; addDay <= 7 && out.length < 2; addDay++) {
    const d = new Date(base.getTime() + addDay * 24 * 60 * 60 * 1000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // pula fim de semana
    for (const hour of [10, 15]) {
      if (out.length >= 2) break;
      const y = d.getUTCFullYear();
      const mo = pad(d.getUTCMonth() + 1);
      const da = pad(d.getUTCDate());
      const startISO = `${y}-${mo}-${da}T${pad(hour)}:00:00${tzOffset}`;
      const endISO = `${y}-${mo}-${da}T${pad(hour + 1)}:00:00${tzOffset}`;
      const overlaps = busy.some((b) => new Date(b.start) < new Date(endISO) && new Date(b.end) > new Date(startISO));
      if (overlaps) continue;
      out.push({ startISO, endISO, label: `${dias[dow]} (${da}/${mo}) às ${hour}h` });
    }
  }
  return out;
}

// --------------------------------- main -------------------------------------
export async function processSofiaTurn(
  supabase: any,
  input: { payload: any; agent: any; wa_instance: any; dry_run?: boolean },
): Promise<any> {
  const dryRun = input.dry_run === true;
  const agent = input.agent || {};
  const waInstance = input.wa_instance || {};
  const userId = waInstance.user_id || agent.user_id;
  const agentId = agent.id;

  const parsed = parseInbound(input.payload);
  if (!parsed.user_text) {
    return { ok: true, agent: "sofia", ignored: "empty_message" };
  }

  // ── memória ──────────────────────────────────────────────────────────────
  let leadId: string | null = null;
  let currentState: SofiaState = {};
  let history: Array<{ role: string; content: string }> = [];

  if (!dryRun && userId && agentId) {
    try {
      const lead = await ensurePedroV2Lead(supabase, {
        user_id: userId,
        agent_id: agentId,
        instance_id: waInstance.id || null,
        remote_jid: parsed.remote_jid,
        lead_name: parsed.push_name || null,
      });
      leadId = lead?.id || null;
    } catch (e: any) {
      console.warn("[sofia] ensureLead falhou:", e?.message || e);
    }
  }

  if (leadId) {
    currentState = (await loadPedroMemory(supabase, { lead_id: leadId, agent_id: agentId })) as SofiaState;
  }

  if (userId && agentId) {
    const { data: hist } = await supabase
      .from("wa_chat_history")
      .select("role, content, created_at")
      .eq("agent_id", agentId)
      .eq("remote_jid", parsed.remote_jid)
      .order("created_at", { ascending: false })
      .limit(12);
    history = (Array.isArray(hist) ? hist : []).reverse().map((h: any) => ({ role: h.role, content: h.content }));
  }

  // ── planner ──────────────────────────────────────────────────────────────
  const plan = await planTurn(currentState, history, parsed.user_text);
  const nextState = mergeState(currentState, plan.extracted || {});
  if (parsed.push_name && !nextState.perfil?.nome) {
    nextState.perfil = { ...(nextState.perfil || {}), nome: parsed.push_name };
  }
  const score = sofiaScore(nextState);

  // ── agendamento (Fase 2 — só age se a integração estiver configurada) ──────
  const calendarConfigured = isCalendarConfigured();
  let scheduling: any = { attempted: false, configured: calendarConfigured };
  let schedulingNote = "";
  let slots: Array<{ startISO: string; endISO: string; label: string }> = [];

  const calendarId = await getCalendarId(supabase, userId);
  const meetingLink = await getMeetingLink(supabase, userId);
  const qualifiedEnough = score >= 50 || nextState.champ?.dor_principal;

  if (plan.wants_scheduling && calendarConfigured && calendarId) {
    try {
      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const busy = await getBusyBlocks(calendarId, now.toISOString(), horizon.toISOString());
      slots = buildSlotSuggestions(busy);
      scheduling.attempted = true;
      scheduling.slots = slots.map((s) => s.label);
      schedulingNote = slots.length
        ? `Ofereça estes 2 horários (não invente outros): ${slots.map((s) => s.label).join(" ou ")}. Peça pro lead escolher um.`
        : "Não há horários livres nos próximos dias úteis; peça uma preferência ao lead.";
    } catch (e: any) {
      console.warn("[sofia] freeBusy falhou:", e?.message || e);
    }
  } else if (plan.wants_scheduling && qualifiedEnough && !calendarConfigured) {
    // Integração ainda não ligada: a Sofia ainda conduz a marcação, mas sem
    // consultar a agenda real (a confirmação fica para quando o calendário
    // estiver configurado).
    schedulingNote = "Conduza para agendar: pergunte 2 opções de dia/horário que funcionam pro lead.";
  }

  // ── reply ──────────────────────────────────────────────────────────────────
  let replyText = "";
  try {
    replyText = await generateReply(agent.system_prompt || null, nextState, history, parsed.user_text, plan, schedulingNote);
  } catch (e: any) {
    console.error("[sofia] reply falhou:", e?.message || e);
    replyText = "Perfeito! Me conta rapidinho: qual é o seu cargo e o segmento da sua empresa? 😊";
  }

  // ── persistência + envio (apenas fora do dry-run) ──────────────────────────
  if (!dryRun) {
    if (leadId) {
      try {
        await supabase.from("pedro_conversation_state").upsert(
          {
            lead_id: leadId,
            agent_id: agentId,
            user_id: userId,
            state: nextState,
            qualificacao_score: score,
            last_extracted_at: new Date().toISOString(),
          },
          { onConflict: "lead_id,agent_id" },
        );
      } catch (e: any) {
        console.warn("[sofia] save state falhou:", e?.message || e);
      }
    }

    try {
      await supabase.from("wa_chat_history").insert([
        { user_id: userId, agent_id: agentId, instance_id: String(waInstance.id || ""), remote_jid: parsed.remote_jid, role: "user", content: parsed.user_text },
        { user_id: userId, agent_id: agentId, instance_id: String(waInstance.id || ""), remote_jid: parsed.remote_jid, role: "assistant", content: replyText },
      ]);
    } catch (e: any) {
      console.warn("[sofia] save history falhou:", e?.message || e);
    }

    if (replyText) {
      try {
        await sendPedroText(waInstance, { to: parsed.lead_phone, text: replyText }, { humanize: true });
      } catch (e: any) {
        console.error("[sofia] envio falhou:", e?.message || e);
      }
    }

    // Notifica o anfitrião (Wander) quando uma reunião é de fato marcada.
    if (nextState.agendamento?.status === "agendado") {
      const gerentes = managerPhones(agent);
      const dossie = buildDossie(nextState, parsed.lead_phone, meetingLink);
      for (const gp of gerentes) {
        try { await sendPedroText(waInstance, { to: gp, text: dossie }); } catch (_e) { /* não bloqueante */ }
      }
    }
  }

  return {
    ok: true,
    agent: "sofia",
    dry_run: dryRun,
    brain_plan: { intent: plan.intent, fase: plan.fase, wants_scheduling: plan.wants_scheduling, resumo: plan.resumo_curto },
    memory_state: nextState,
    qualificacao_score: score,
    scheduling,
    reply: { text: replyText },
    next_action: plan.intent === "despedida" ? "encerrar" : (plan.wants_scheduling ? "agendar" : "qualificar"),
  };
}

// ----------------------------- helpers de config ----------------------------
async function getIntegrationCreds(supabase: any, userId: string | null): Promise<Record<string, string> | null> {
  if (!userId) return null;
  try {
    const { data } = await supabase
      .from("platform_integrations")
      .select("api_key_encrypted, is_active")
      .eq("user_id", userId)
      .eq("platform", "google_calendar")
      .eq("is_active", true)
      .maybeSingle();
    if (!data?.api_key_encrypted) return null;
    return JSON.parse(data.api_key_encrypted);
  } catch {
    return null;
  }
}

async function getCalendarId(supabase: any, userId: string | null): Promise<string | null> {
  const creds = await getIntegrationCreds(supabase, userId);
  return creds?.calendar_id?.trim() || null;
}
async function getMeetingLink(supabase: any, userId: string | null): Promise<string | null> {
  const creds = await getIntegrationCreds(supabase, userId);
  return creds?.meeting_link?.trim() || null;
}

function buildDossie(state: SofiaState, leadPhone: string, meetingLink: string | null): string {
  const p = state.perfil || {};
  const c = state.champ || {};
  const a = state.agendamento || {};
  return [
    "📅 *Nova reunião agendada — Logos IA*",
    `Lead: ${p.nome || "(sem nome)"} · ${leadPhone}`,
    p.empresa ? `Empresa: ${p.empresa}` : null,
    p.cargo ? `Cargo: ${p.cargo}` : null,
    p.segmento ? `Segmento: ${p.segmento}` : null,
    c.dor_principal ? `Dor: ${c.dor_principal}` : null,
    c.cpl_atual ? `CPL hoje: ${c.cpl_atual}` : null,
    a.data_hora ? `🗓️ ${a.data_hora}` : null,
    meetingLink ? `🔗 ${meetingLink}` : (a.meet_link ? `🔗 ${a.meet_link}` : null),
  ].filter(Boolean).join("\n");
}

// Exporta utilidades para teste/uso futuro do fluxo de criação de evento.
export { buildSlotSuggestions, createMeeting };
