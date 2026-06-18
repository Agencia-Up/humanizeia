/**
 * pedro-auto-followup  —  MOTOR DE REATIVACAO AUTOMATICA (Follow-up IA)
 * ---------------------------------------------------------------------------
 * Regras confirmadas pelo master (Wander, 01/06/2026):
 *  1. Dispara SO na coluna "Lead Inativo" (status_crm='inativo'), automatico.
 *  2. Pelo NUMERO DA IA do master (instancia do agente do lead).
 *  3. Mensagem GERADA pela IA OpenAI (mesmo provider do agente Pedro, gpt-4o-mini),
 *     personalizada por lead — ou template base literal quando
 *     gerar_variacoes_ia=false.
 *  4. Quantidade/dia = max_disparos_dia (config do painel).
 *  5. FILA em rodizio (RPC get_next_reactivation_lead): so repete num lead
 *     depois que todos da fila receberam a 1a msg.
 *  6. Intervalo min/max configuravel + PISO HARD de 3 min (ninguem reduz).
 *  7. So dentro do horario/dias configurados (fuso Brasilia, UTC-3).
 *  8. Pausa global: is_active=false -> nao dispara nada.
 *  9. Filtro por data: periodo_dias (NULL=todos).
 *  10. Quando o lead RESPONDE: tratado no webhook (fase C) — aqui so o disparo.
 *
 * SEGURANCA / TESTE:
 *  - body.dry_run=true   -> faz tudo MENOS enviar/gravar. Retorna o que FARIA
 *                           (inclusive a mensagem gerada pela IA OpenAI). Ignora
 *                           horario/dias/intervalo/cap pra permitir preview.
 *  - body.only_user_id   -> restringe a 1 master (teste).
 *  - body.only_lead_id   -> dispara num lead especifico (teste real controlado),
 *                           pulando a fila. Ainda respeita is_active.
 *  - body.max_per_master -> nº de envios por master por execucao (default 1).
 *
 * Sem config (followup_ia_config) ou is_active=false => nao faz nada.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HARD_MIN_GAP_MINUTES = 3; // PISO ABSOLUTO — ninguem reduz isso.

// Modelo OpenAI — MESMO provider do agente Pedro (gpt-4o-mini por padrao).
// Pode ser sobrescrito pela secret OPENAI_MODEL, se o master quiser.
const OPENAI_MODEL_DEFAULT = "gpt-4o-mini";

// ── Helpers de fuso (Brasilia = UTC-3) ──────────────────────────────────────
function toBrasilia(d: Date): Date {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000);
}
function brasiliaMinOfDay(d: Date): number {
  const b = toBrasilia(d);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}
function brasiliaWeekday(d: Date): number {
  return toBrasilia(d).getUTCDay(); // 0=dom ... 6=sab
}
// Inicio do dia (00:00 Brasilia) expresso em UTC — pra contar "disparos hoje".
function startOfBrasiliaDayUtc(now: Date): Date {
  const b = toBrasilia(now);
  const y = b.getUTCFullYear(), m = b.getUTCMonth(), day = b.getUTCDate();
  // 00:00 Brasilia == 03:00 UTC do mesmo dia.
  return new Date(Date.UTC(y, m, day, 3, 0, 0));
}
function parseHHMMtoMin(t: string | null | undefined): number {
  if (!t) return 0;
  const [hh, mm] = String(t).split(":");
  return (Number(hh) || 0) * 60 + (Number(mm) || 0);
}
// Jitter ESTAVEL entre ticks: deriva do timestamp do ultimo envio (seed), pra
// nao "sortear" um intervalo novo a cada tick do cron (senao fura o ritmo).
function stableGapMinutes(lastSentMs: number, minM: number, maxM: number, jitter: boolean): number {
  const floorMin = Math.max(HARD_MIN_GAP_MINUTES, minM);
  const floorMax = Math.max(floorMin, maxM);
  if (!jitter || floorMax <= floorMin) return floorMin;
  const seed = Math.abs(Math.floor(lastSentMs)) % 1000;
  const frac = seed / 1000; // 0..0.999
  return floorMin + (floorMax - floorMin) * frac;
}

// ── Envio via UazAPI (mesmo padrao do pedro-trigger-followup) ───────────────
async function sendUazapiTextMessage(
  baseUrl: string, instKey: string, instanceName: string,
  phoneNumber: string, remoteJid: string, text: string,
): Promise<boolean> {
  const attempts = [
    { url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } },
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": instKey, "apikey": instKey },
        body: JSON.stringify(a.body),
      });
      if (res.ok) return true;
      const e = await res.text().catch(() => "");
      console.error(`[auto-followup] UazAPI send error (${a.url}): ${res.status} - ${e}`);
    } catch (err) {
      console.error(`[auto-followup] UazAPI send exception (${a.url}):`, err);
    }
  }
  return false;
}

// ── Higienização de Nome e Saudação Inteligente (Checklist 4 e 5) ───────────────
function isValidName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  const invalidNames = ["lead", "desconhecido", "cliente", "contato", "sem nome", "user", "desconhecida", "—", "unknown"];
  if (n === "" || invalidNames.includes(n)) return false;
  // Se contiver caracteres de telefone ou for número puro
  if (/^\+?\d+$/.test(n.replace(/[\s\-\(\)]/g, ""))) return false;
  // Nome-LIXO do WhatsApp (pushName pode ser "$", ".", "🙂", so simbolos/emoji ou 1 letra): NAO e
  // nome. Sem isso, o follow-up virava "Bom dia $!" (lead 99716-4335, pushName="$"). Exige >=2 LETRAS
  // reais (com acento). Mesma robustez do leadFirstName do reply principal.
  if ((name.match(/\p{L}/gu) || []).length < 2) return false;
  return true;
}

function getBrasiliaGreeting(d: Date): string {
  // Ajusta fuso de Brasília (UTC-3)
  const b = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const hour = b.getUTCHours();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function applyTemplateVars(tpl: string, leadName: string | null | undefined, greeting: string, carro: string): string {
  const hasName = isValidName(leadName);
  let resolvedTpl = tpl || "";
  
  // Substitui a saudação
  resolvedTpl = resolvedTpl.replace(/\{saudacao\}/gi, greeting);
  
  if (hasName) {
    resolvedTpl = resolvedTpl.replace(/\{nome\}/gi, leadName!.trim());
  } else {
    // Remove o placeholder {nome} e ajusta pontuações e espaçamentos órfãos
    resolvedTpl = resolvedTpl
      .replace(/,\s*\{nome\}/gi, "")
      .replace(/\{nome\}\s*,/gi, "")
      .replace(/\{nome\}/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,\.!;\?])/g, "$1")
      .replace(/^(Oi|Olá|Bom dia|Boa tarde|Boa noite)\s*,\s*/i, "$1, ");
  }
  
  return resolvedTpl
    .replace(/\{carro\}/gi, carro || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function generateReactivationMessage(opts: {
  apiKey: string;
  leadName: string;
  mensagemBase: string;
  transcript: string;
  agentName: string;
  greeting: string;
}): Promise<string | null> {
  const { apiKey, leadName, mensagemBase, transcript, agentName, greeting } = opts;
  if (!apiKey) return null;

  const hasName = isValidName(leadName);
  const systemPrompt =
`Voce e ${agentName || "o assistente de vendas"} de uma concessionaria de carros, falando por WhatsApp.
Sua tarefa: escrever UMA mensagem curta e natural pra REATIVAR um lead que ficou parado (esfriou).
Regras da mensagem:
- Portugues do Brasil, tom humano, simpatico e direto (WhatsApp, nao e e-mail).
- 1 a 2 frases. Curta. Sem enrolacao, sem markdown, sem emojis em excesso (no maximo 1).
- ${hasName ? `Comece a mensagem saudando o cliente pelo nome próprio (${leadName}). Ex: "${greeting} ${leadName}!" ou similar.` : `O cliente NÃO tem um nome próprio válido cadastrado. NÃO use nenhuma saudação personalizada nem tente inventar nomes. Comece com uma saudação geral do horário: "${greeting}!" ou similar.`}
- Se o veículo de interesse aparecer no historico de mensagens, personalize citando o carro de interesse. Caso contrário, fale de forma genérica sobre o interesse em um carro.
- NAO invente informacoes que nao estao no historico.
- Termine com uma pergunta leve que convide a responder.
- Use a "mensagem de referencia" do master so como GUIA de intencao/tom, nao copie literal.`;

  const userMsg =
`Nome do lead: ${hasName ? leadName : "(desconhecido)"}
Saudacao recomendada por horario: "${greeting}"
Mensagem de referencia do master (guia de tom/intencao): "${mensagemBase || "Oi, tudo bem? Ainda tem interesse?"}"

Historico recente da conversa (mais antigo no topo):
${transcript || "(sem historico registrado)"}

Escreva agora SOMENTE a mensagem de reativacao (sem aspas, sem prefixo).`;

  // Mesma API do agente Pedro: OpenAI chat/completions.
  const model = Deno.env.get("OPENAI_MODEL") || OPENAI_MODEL_DEFAULT;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[auto-followup] OpenAI erro ${res.status}: ${err}`);
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return String(text).trim() || null;
  } catch (err) {
    console.error("[auto-followup] OpenAI excecao:", err);
    return null;
  }
}

// ── Resolve a instancia da IA do master (a partir do agente do lead) ─────────
async function resolveAgentInstance(supabase: any, agentId: string | null, cache: Record<string, any>) {
  if (!agentId) return null;
  const { data: agent } = await supabase
    .from("wa_ai_agents")
    .select("instance_id, instance_ids")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return null;
  const instId = agent.instance_id
    || (Array.isArray(agent.instance_ids) && agent.instance_ids.length > 0 ? agent.instance_ids[0] : null);
  if (!instId) return null;
  if (cache[instId]) return cache[instId];
  const { data: inst } = await supabase
    .from("wa_instances")
    .select("id, api_url, api_key_encrypted, instance_name, status")
    .eq("id", instId)
    .maybeSingle();
  if (inst) cache[instId] = inst;
  return inst;
}

// TRAVA DE 24h (regra do dono): so reativa lead SEM atendimento da IA ha MAIS de 24h —
// nao enche o saco de quem acabou de falar com o agente (caso real: lead falou 11:04,
// recusou, e recebeu reativacao 11:07). Como a RPC retorna a fila em rodizio (ordenada por
// last_sent_at), pegamos um LOTE de candidatos e devolvemos o 1o que esta quieto ha >24h —
// preservando a ordem do rodizio. (A mesma trava esta na migration da RPC, pra quando as
// migrations forem aplicadas; aqui e a rede que ja vale em producao.)
const REACT_MIN_QUIET_HOURS = 24;
// CADENCIA (decisao do dono): no MAXIMO 3 follow-ups por lead, com >=24h entre eles, depois PARA.
// Aplicado na RPC get_next_reactivation_lead (teto + intervalo) e ao marcar 'skipped' no teto.
const REACT_MAX_ATTEMPTS = 3;
const REACT_MIN_RESEND_HOURS = 24;
async function pickEligibleByRecency(supabase: any, rows: any[]): Promise<any> {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ids = rows.map((r: any) => r.lead_id).filter(Boolean);
  if (ids.length === 0) return null;
  const { data: leads } = await supabase
    .from("ai_crm_leads")
    .select("id, last_interaction_at, last_user_reply_at, last_agent_reply_at, created_at")
    .in("id", ids);
  const byId = new Map((leads || []).map((l: any) => [l.id, l]));
  const cutoff = Date.now() - REACT_MIN_QUIET_HOURS * 60 * 60 * 1000;
  const ms = (v: any) => (v ? Date.parse(v) || 0 : 0);
  for (const r of rows) { // rows ja vem na ordem do rodizio
    const l = byId.get(r.lead_id);
    if (!l) continue;
    const lastTouch = Math.max(
      ms(l.last_interaction_at), ms(l.last_user_reply_at),
      ms(l.last_agent_reply_at), ms(l.created_at),
    );
    if (lastTouch > 0 && lastTouch < cutoff) return r; // atendido ha >24h -> elegivel
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

  // ── Parse opcoes (todas opcionais) ────────────────────────────────────────
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const dryRun: boolean = body?.dry_run === true;
  const onlyUserId: string | null = body?.only_user_id || null;
  const onlyLeadId: string | null = body?.only_lead_id || null;
  const maxPerMaster: number = Math.max(1, Number(body?.max_per_master) || 1);

  // ── KILL-SWITCH GLOBAL ────────────────────────────────────────────────────
  // O caminho AUTOMATICO (cron, body vazio) SO dispara quando
  // PEDRO_FF_AUTO_REACTIVATION = 'on'. Enquanto a flag estiver desligada, o
  // deploy em producao NAO muda nada: o cron chama, isto aqui responde
  // "disabled" e nao envia/grava nada. Testes manuais controlados continuam
  // liberados (dry_run = preview sem enviar; only_lead_id = envio unico de
  // validacao), pra dar pro master testar sem ligar o motor pra todo mundo.
  const reactEnabled = (Deno.env.get("PEDRO_FF_AUTO_REACTIVATION") ?? "").toLowerCase() === "on";
  if (!reactEnabled && !dryRun && !onlyLeadId) {
    return new Response(
      JSON.stringify({ ok: true, disabled: true, reason: "PEDRO_FF_AUTO_REACTIVATION off", total_sent: 0 }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const now = new Date();
  const startOfDay = startOfBrasiliaDayUtc(now);
  const instanceCache: Record<string, any> = {};
  const report: any[] = [];
  let totalSent = 0;

  try {
    // 1. Masters com follow-up IA ATIVO (is_active=true). Sem config => nada.
    let q = supabase
      .from("followup_ia_config")
      .select("user_id, is_active, max_disparos_dia, intervalo_min_minutes, intervalo_max_minutes, periodo_dias, horario_inicio, horario_fim, dias_semana, mensagem_base, gerar_variacoes_ia, simular_humano, reactivation_cycle_at")
      .eq("is_active", true);
    if (onlyUserId) q = q.eq("user_id", onlyUserId);
    const { data: configs, error: cfgErr } = await q;
    if (cfgErr) throw cfgErr;

    for (const cfg of configs || []) {
      const r: any = { user_id: cfg.user_id, gates: {}, actions: [] };

      // 2. Horario/dias (fuso Brasilia). Em dry_run, so reporta (nao bloqueia).
      const weekday = brasiliaWeekday(now);
      const minOfDay = brasiliaMinOfDay(now);
      const startMin = parseHHMMtoMin(cfg.horario_inicio);
      const endMin = parseHHMMtoMin(cfg.horario_fim);
      const dias: number[] = Array.isArray(cfg.dias_semana) ? cfg.dias_semana : [1, 2, 3, 4, 5];
      const withinDay = dias.includes(weekday);
      const withinHour = minOfDay >= startMin && minOfDay <= endMin;
      r.gates.within_schedule = withinDay && withinHour;
      if (!dryRun && !(withinDay && withinHour)) {
        r.skipped = "fora_do_horario";
        report.push(r);
        continue;
      }

      // 3. Teto diario (max_disparos_dia). Conta envios de HOJE (Brasilia).
      const { count: sentToday } = await supabase
        .from("pedro_followup_reactivation")
        .select("id", { count: "exact", head: true })
        .eq("user_id", cfg.user_id)
        .gte("last_sent_at", startOfDay.toISOString());
      const cap = Math.max(1, Number(cfg.max_disparos_dia) || 10);
      r.gates.sent_today = sentToday ?? 0;
      r.gates.cap = cap;
      if (!dryRun && (sentToday ?? 0) >= cap) {
        r.skipped = "teto_diario_atingido";
        report.push(r);
        continue;
      }

      // 4. Intervalo desde o ultimo envio (com piso 3min + jitter estavel).
      const { data: lastRow } = await supabase
        .from("pedro_followup_reactivation")
        .select("last_sent_at")
        .eq("user_id", cfg.user_id)
        .not("last_sent_at", "is", null)
        .order("last_sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const minM = Math.max(HARD_MIN_GAP_MINUTES, Number(cfg.intervalo_min_minutes) || HARD_MIN_GAP_MINUTES);
      const maxM = Math.max(minM, Number(cfg.intervalo_max_minutes) || minM);
      let intervalOk = true;
      if (lastRow?.last_sent_at) {
        const lastMs = new Date(lastRow.last_sent_at).getTime();
        const gapMin = stableGapMinutes(lastMs, minM, maxM, cfg.simular_humano !== false);
        const elapsedMin = (now.getTime() - lastMs) / 60000;
        intervalOk = elapsedMin >= gapMin;
        r.gates.interval_needed_min = Math.round(gapMin * 10) / 10;
        r.gates.interval_elapsed_min = Math.round(elapsedMin * 10) / 10;
      }
      r.gates.interval_ok = intervalOk;
      if (!dryRun && !intervalOk) {
        r.skipped = "aguardando_intervalo";
        report.push(r);
        continue;
      }

      // 5. Quantos enviar nesta execucao (respeita cap restante).
      const remaining = dryRun ? maxPerMaster : Math.min(maxPerMaster, cap - (sentToday ?? 0));

      // CICLO DE FILA: o lead so volta a receber follow-up depois que TODA a fila
      // passou. cycleAt = inicio do ciclo atual; quem foi cutucado neste ciclo
      // (last_sent_at >= cycleAt) fica de fora ate a fila zerar e abrir ciclo novo.
      let cycleAt: string | null = cfg.reactivation_cycle_at || null;
      let cycleReset = false;

      for (let i = 0; i < remaining; i++) {
        // 5a. Proximo lead: fila em rodizio (RPC) OU lead especifico (teste).
        let lead: any = null;
        if (onlyLeadId) {
          const { data: l } = await supabase
            .from("ai_crm_leads")
            .select("id, remote_jid, lead_name, agent_id, assigned_to_id, status_crm, user_id")
            .eq("id", onlyLeadId)
            .eq("user_id", cfg.user_id)
            .maybeSingle();
          if (l && l.status_crm === "inativo") {
            const { data: rr } = await supabase
              .from("pedro_followup_reactivation")
              .select("id, status, send_count")
              .eq("lead_id", l.id)
              .maybeSingle();
            lead = {
              lead_id: l.id, remote_jid: l.remote_jid, lead_name: l.lead_name,
              agent_id: l.agent_id, assigned_to_id: l.assigned_to_id,
              react_id: rr?.id || null, send_count: rr?.send_count || 0,
            };
          }
        } else {
          // Busca um LOTE da fila do CICLO atual (rodizio) e pega o 1o quieto >24h.
          const fetchBatch = async (cyc: string | null) => {
            const { data: rows } = await supabase.rpc("get_next_reactivation_lead", {
              p_user_id: cfg.user_id,
              p_periodo_dias: cfg.periodo_dias ?? null,
              p_limit: 25,
              p_cycle_at: cyc,
              p_max_attempts: REACT_MAX_ATTEMPTS,   // teto de 3 follow-ups por lead
              p_min_resend_hours: REACT_MIN_RESEND_HOURS, // >=24h entre follow-ups do mesmo lead
            });
            return await pickEligibleByRecency(supabase, rows);
          };
          lead = await fetchBatch(cycleAt);
          // CICLO: se a fila do ciclo atual zerou mas AINDA ha leads inativos
          // (todos ja cutucados neste ciclo), abre ciclo novo e recomeca o rodizio.
          // So assim um lead volta a receber follow-up — depois da fila inteira.
          if (!lead && !cycleReset) {
            cycleReset = true;
            const newCycle = now.toISOString();
            const restarted = await fetchBatch(newCycle);
            if (restarted) {
              if (!dryRun) {
                await supabase.from("followup_ia_config")
                  .update({ reactivation_cycle_at: newCycle })
                  .eq("user_id", cfg.user_id);
              }
              cycleAt = newCycle;
              lead = restarted;
              r.actions.push({ note: "ciclo_reiniciado_fila_completa" });
            }
          }
        }

        if (!lead) { r.actions.push({ note: "fila_vazia" }); break; }

        // 5b. Resolve a instancia da IA do master (numero de atendimento).
        const inst = await resolveAgentInstance(supabase, lead.agent_id, instanceCache);
        if (!inst?.api_url) {
          r.actions.push({ lead_id: lead.lead_id, error: "sem_instancia" });
          // Em modo real, evita travar a fila no mesmo lead: marca um toque
          // pra mandar pro fim da fila (last_sent_at) sem enviar.
          if (!dryRun) {
            await supabase.from("pedro_followup_reactivation")
              .upsert({
                user_id: cfg.user_id, lead_id: lead.lead_id,
                status: "pending", last_sent_at: now.toISOString(),
                last_message: "[sem instancia — adiado]",
              }, { onConflict: "lead_id" });
          }
          continue;
        }

        // 5c. Monta contexto e gera a mensagem.
        let transcript = "";
        let carro = "";
        try {
          const { data: hist } = await supabase
            .from("wa_chat_history")
            .select("role, content, created_at")
            .eq("agent_id", lead.agent_id)
            .eq("remote_jid", lead.remote_jid)
            .order("created_at", { ascending: false })
            .limit(16);
          if (Array.isArray(hist) && hist.length > 0) {
            transcript = hist.reverse().map((m: any) =>
              `${m.role === "user" ? "Cliente" : "IA"}: ${String(m.content || "").substring(0, 300)}`
            ).join("\n");
          }
        } catch { /* segue sem historico */ }

        let message: string | null = null;
        const wantsIA = cfg.gerar_variacoes_ia !== false;
        const greeting = getBrasiliaGreeting(now);

        if (wantsIA) {
          message = await generateReactivationMessage({
            apiKey: openaiKey,
            leadName: lead.lead_name || "",
            mensagemBase: cfg.mensagem_base || "",
            transcript,
            agentName: "o assistente",
            greeting,
          });
        }
        // Fallback (IA off ou falhou): template base com variaveis.
        if (!message) {
          message = applyTemplateVars(cfg.mensagem_base || "Oi {nome}, tudo bem? Ainda tem interesse?", lead.lead_name, greeting, carro);
        }

        // 5d. DRY-RUN: nao envia, nao grava. So mostra o que faria.
        if (dryRun) {
          r.actions.push({
            lead_id: lead.lead_id,
            lead_name: lead.lead_name,
            instance: inst.instance_name,
            instance_status: inst.status,
            generated_message: message,
            would_send: r.gates.within_schedule && (r.gates.interval_ok !== false),
          });
          continue;
        }

        // 5e. ENVIO REAL.
        const baseUrl = String(inst.api_url).replace(/\/+$/, "");
        const instKey = inst.api_key_encrypted || "";
        const instName = inst.instance_name || "";
        const remoteJid = lead.remote_jid;
        const phoneNumber = String(remoteJid).split("@")[0];

        const sent = await sendUazapiTextMessage(baseUrl, instKey, instName, phoneNumber, remoteJid, message);

        if (!sent) {
          r.actions.push({ lead_id: lead.lead_id, error: "envio_falhou" });
          
          // Grava log histórico de falha (defensivo)
          try {
            await supabase.from("pedro_followup_logs").insert({
              user_id: cfg.user_id,
              lead_id: lead.lead_id,
              remote_jid: remoteJid,
              message: message,
              status: "failed",
              error_message: "UazAPI: envio falhou",
              type: "ia"
            });
          } catch (logErr) {
            console.warn("[auto-followup] Erro ao gravar log de falha em pedro_followup_logs (migration pendente):", logErr);
          }

          // Marca toque pra rodar a fila (nao trava no mesmo lead).
          await supabase.from("pedro_followup_reactivation")
            .upsert({
              user_id: cfg.user_id, lead_id: lead.lead_id,
              status: "pending", last_sent_at: now.toISOString(),
              last_message: "[envio falhou]",
            }, { onConflict: "lead_id" });
          continue;
        }

        // 5f. Sucesso: grava estado (status='sent' => aguardando resposta),
        //     incrementa contagem, persiste no historico de chat e grava no log histórico.
        const _newCount = (Number(lead.send_count) || 0) + 1;
        await supabase.from("pedro_followup_reactivation")
          .upsert({
            user_id: cfg.user_id,
            lead_id: lead.lead_id,
            // TETO: ao bater REACT_MAX_ATTEMPTS, marca 'skipped' (terminal) -> sai da fila pra
            // sempre (a RPC ja exclui send_count>=teto; isto deixa explicito no dado/relatorio).
            status: _newCount >= REACT_MAX_ATTEMPTS ? "skipped" : "sent",
            send_count: _newCount,
            last_sent_at: now.toISOString(),
            last_message: message,
          }, { onConflict: "lead_id" });

        await supabase.from("wa_chat_history").insert({
          user_id: cfg.user_id,
          agent_id: lead.agent_id,
          instance_id: instName,
          remote_jid: remoteJid,
          role: "assistant",
          content: `[Follow-up IA] ${message}`,
        });

        // Grava log histórico de sucesso (defensivo)
        try {
          await supabase.from("pedro_followup_logs").insert({
            user_id: cfg.user_id,
            lead_id: lead.lead_id,
            remote_jid: remoteJid,
            message: message,
            status: "sent",
            type: "ia"
          });
        } catch (logErr) {
          console.warn("[auto-followup] Erro ao gravar log de sucesso em pedro_followup_logs (migration pendente):", logErr);
        }

        totalSent++;
        r.actions.push({ lead_id: lead.lead_id, lead_name: lead.lead_name, sent: true, instance: instName });
      }

      report.push(r);
    }

    return new Response(
      JSON.stringify({ ok: true, dry_run: dryRun, total_sent: totalSent, masters: report }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[pedro-auto-followup] Erro geral:", err);
    return new Response(
      JSON.stringify({ error: err?.message ?? "Erro interno" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
