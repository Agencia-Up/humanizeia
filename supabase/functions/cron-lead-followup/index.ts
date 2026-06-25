import { logTransferFailure } from '../_shared/pedro-v2/logTransferFailure.ts';
import { resolveAutomationRules, isWithinConfiguredWindow } from "../_shared/automation/rules.ts";
import { managerPhones } from "../_shared/transfer/managers.ts";
import { resolveLeadInterestVehicle } from "../_shared/transfer/interestVehicle.ts";
import { leadTransferStatusLine, leadTransferStatusText } from "../_shared/transfer/leadStatus.ts";
import { classifyLeadSdrCategory, sdrCategoryLine, sdrCategoryText, classifyLeadSdr } from "../_shared/transfer/leadSdrCategory.ts";
import { composeSellerMsg, composeGerenteMsg, buildEtiquetas, maybeStripEmojis } from "../_shared/transfer/messageTemplates.ts";
import { setSdrLabelOnChat } from "../_shared/pedro-v2/uazapiLabels.ts";
import { logAiCall } from "../_shared/observability/aiCallLog.ts";

// ─── Inline PostgREST client (no external imports) ──────────────────────────
function createSupabaseClient(url: string, key: string) {
  const restBase = `${url}/rest/v1`;
  const baseHeaders: Record<string, string> = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  type FilterEntry = { col: string; op: string; val: string };
  type OrderEntry = { column: string; ascending: boolean; nullsFirst: boolean };

  function buildQuery(table: string) {
    let _select: string | null = null;
    let _filters: FilterEntry[] = [];
    let _orders: OrderEntry[] = [];
    let _limit: number | null = null;
    let _maybeSingle = false;
    let _body: any = null;
    let _method: 'GET' | 'POST' | 'PATCH' = 'GET';
    let _returnSelect: string | null = null; // for update().select()

    const builder = {
      select(cols?: string) {
        if (_method === 'PATCH') {
          // .update(data).select('id') → return representation with select
          _returnSelect = cols || '*';
          return builder;
        }
        _select = cols || '*';
        return builder;
      },
      eq(col: string, val: any) {
        _filters.push({ col, op: 'eq', val: String(val) });
        return builder;
      },
      lte(col: string, val: any) {
        _filters.push({ col, op: 'lte', val: String(val) });
        return builder;
      },
      gt(col: string, val: any) {
        _filters.push({ col, op: 'gt', val: String(val) });
        return builder;
      },
      is(col: string, val: any) {
        _filters.push({ col, op: 'is', val: String(val) });
        return builder;
      },
      not(col: string, op: string, val: any) {
        _filters.push({ col, op: `not.${op}`, val: String(val) });
        return builder;
      },
      in(col: string, vals: any[]) {
        const list = vals.map((v: any) => `"${v}"`).join(',');
        _filters.push({ col, op: 'in', val: `(${list})` });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        _orders.push({
          column,
          ascending: opts?.ascending ?? true,
          nullsFirst: opts?.nullsFirst ?? false,
        });
        return builder;
      },
      limit(n: number) {
        _limit = n;
        return builder;
      },
      maybeSingle() {
        _maybeSingle = true;
        return builder._execute();
      },
      update(data: any) {
        _method = 'PATCH';
        _body = data;
        return builder;
      },
      insert(data: any) {
        _method = 'POST';
        _body = data;
        return builder._execute();
      },
      then(resolve: (v: any) => void, reject?: (e: any) => void) {
        return builder._execute().then(resolve, reject);
      },
      async _execute(): Promise<{ data: any; error: any }> {
        const params = new URLSearchParams();

        // select param
        const selectVal = _method === 'PATCH' ? (_returnSelect || undefined) : (_select || '*');
        if (selectVal) params.set('select', selectVal);

        // filters
        for (const f of _filters) {
          params.append(f.col, `${f.op}.${f.val}`);
        }

        // order
        for (const o of _orders) {
          let orderStr = o.column;
          if (!o.ascending) orderStr += '.desc';
          else orderStr += '.asc';
          if (o.nullsFirst) orderStr += '.nullsfirst';
          else orderStr += '.nullslast';
          params.append('order', orderStr);
        }

        // limit
        if (_limit !== null) {
          params.set('limit', String(_limit));
        }

        const queryStr = params.toString();
        const urlStr = `${restBase}/${table}${queryStr ? '?' + queryStr : ''}`;

        const headers: Record<string, string> = { ...baseHeaders };

        if (_method === 'PATCH' && _returnSelect) {
          headers['Prefer'] = 'return=representation';
        }
        if (_method === 'POST') {
          headers['Prefer'] = 'return=minimal';
        }
        if (_maybeSingle) {
          headers['Accept'] = 'application/vnd.pgrst.object+json';
        }

        try {
          const res = await fetch(urlStr, {
            method: _method,
            headers,
            body: _body ? JSON.stringify(_body) : undefined,
          });

          if (_maybeSingle && res.status === 406) {
            return { data: null, error: null };
          }

          if (!res.ok) {
            const errBody = await res.text();
            return { data: null, error: { message: errBody, status: res.status } };
          }

          if (_method === 'POST' && !_returnSelect) {
            return { data: null, error: null };
          }

          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('json')) {
            return { data: null, error: null };
          }

          const data = await res.json();
          return { data, error: null };
        } catch (err: any) {
          return { data: null, error: { message: err.message } };
        }
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      return buildQuery(table);
    },
  };
}

// ─── CORS headers ───────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIVE_MIN_MESSAGES = [
  "Oie, voce ainda esta por ai? Posso te ajudar com mais alguma duvida?",
  "Tudo certo por ai? Se precisar de mais alguma informacao, e so me falar!",
  "Ainda tem interesse? Estou aqui se precisar de ajuda com os detalhes!"
];

async function sendUazapiTextMessage(baseUrl: string, instKey: string, instanceName: string, phoneNumber: string, remoteJid: string, text: string) {
  const attempts = [
    { label: 'send-text-number', url: `${baseUrl}/send/text`, body: { number: phoneNumber, text } },
    { label: 'send-text-remotejid', url: `${baseUrl}/send/text`, body: { remoteJid, text } },
    { label: 'message-sendText', url: `${baseUrl}/message/sendText/${instanceName}`, body: { number: phoneNumber, text } }
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': instKey, 'apikey': instKey },
        body: JSON.stringify(attempt.body),
      });
      if (res.ok) return true;
    } catch (err) {
      // continua tentando
    }
  }
  return false;
}

function sellerPhoneKey(seller: any): string {
  const digits = String(seller?.whatsapp_number || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === '9') return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}

function uniqueSellersByPhone(sellers: any[] = [], excludeId?: string, excludePhoneKey?: string): any[] {
  const seenPhones = new Set<string>();
  return sellers.filter((seller) => {
    const phoneKey = sellerPhoneKey(seller);
    if (!seller.is_active || seller.id === excludeId || (excludePhoneKey && phoneKey === excludePhoneKey)) return false;
    if (phoneKey && seenPhones.has(phoneKey)) return false;
    if (phoneKey) seenPhones.add(phoneKey);
    return true;
  });
}

// ── Horario operacional de repasse (Brasilia) ────────────────────────────────
// Seg-Sab: 10:11 - 19:29 | Dom/Feriado: 11:11 - 17:29
// Leads criados fora da janela NAO entram no rodizio de repasse.
// Ao entrar no horario, leads da noite NAO sao repassados retroativamente.

function brasiliaMinOfDay(dt: Date): number {
  const nowBrasilia = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  return nowBrasilia.getUTCHours() * 60 + nowBrasilia.getUTCMinutes();
}

function toBrasilia(dt: Date): Date {
  return new Date(dt.getTime() - 3 * 60 * 60 * 1000);
}

// ── Pascoa (algoritmo Computus) e feriados nacionais ─────────────────────────
function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function getBrazilianHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  holidays.add(`${year}-01-01`); // Confraternizacao Universal
  holidays.add(`${year}-04-21`); // Tiradentes
  holidays.add(`${year}-05-01`); // Dia do Trabalho
  holidays.add(`${year}-09-07`); // Independencia
  holidays.add(`${year}-10-12`); // Nossa Sra. Aparecida
  holidays.add(`${year}-11-02`); // Finados
  holidays.add(`${year}-11-15`); // Proclamacao da Republica
  holidays.add(`${year}-12-25`); // Natal

  const easter = getEasterDate(year);
  holidays.add(fmt(addDays(easter, -48))); // Segunda de Carnaval
  holidays.add(fmt(addDays(easter, -47))); // Terca de Carnaval
  holidays.add(fmt(addDays(easter, -2)));  // Sexta-feira Santa
  holidays.add(fmt(addDays(easter, 60)));  // Corpus Christi

  return holidays;
}

function isDomingoOuFeriado(dt: Date): boolean {
  const brasilia = toBrasilia(dt);
  if (brasilia.getUTCDay() === 0) return true;
  const year = brasilia.getUTCFullYear();
  const dateStr = `${year}-${String(brasilia.getUTCMonth() + 1).padStart(2, '0')}-${String(brasilia.getUTCDate()).padStart(2, '0')}`;
  return getBrazilianHolidays(year).has(dateStr);
}

// Seg-Sex: 10:11-19:29 | Sab: 10:11-18:29 | Dom/Feriado: 11:11-17:29
function getRepassWindow(dt: Date): { start: number; end: number; label: string } {
  const brasilia = toBrasilia(dt);
  const dow = brasilia.getUTCDay(); // 0=dom, 6=sab

  if (dow === 0 || isDomingoOuFeriado(dt)) {
    return { start: 11 * 60 + 11, end: 17 * 60 + 29, label: '11:11-17:29 (dom/feriado)' };
  }
  if (dow === 6) {
    return { start: 10 * 60 + 11, end: 18 * 60 + 29, label: '10:11-18:29 (sabado)' };
  }
  return { start: 10 * 60 + 11, end: 19 * 60 + 29, label: '10:11-19:29 (seg-sex)' };
}

/**
 * Verifica se o horario atual esta dentro da janela de rodizio vendedor -> vendedor.
 * Seg-Sab: 10:11-19:29 | Dom/Feriado: 11:11-17:29
 * A transferencia inicial do lead para o primeiro vendedor segue ativa 24h.
 */
function isDentroDoHorarioOperacional(now: Date): boolean {
  const minutosDoDia = brasiliaMinOfDay(now);
  const hora = Math.floor(minutosDoDia / 60);
  const minuto = minutosDoDia % 60;
  const { start, end, label } = getRepassWindow(now);
  const ativo = minutosDoDia >= start && minutosDoDia <= end;
  console.log(`[Cron] Hora Brasilia: ${hora}:${String(minuto).padStart(2, '0')} | Horario operacional: ${ativo ? 'SIM' : 'NAO'} (${label})`);
  return ativo;
}

/** Verifica se um transfer foi CRIADO dentro da janela de repasse do dia em questao */
function transferCriadoNoHorario(createdAt: string): boolean {
  const dt = new Date(createdAt);
  const min = brasiliaMinOfDay(dt);
  const { start, end } = getRepassWindow(dt);
  return min >= start && min <= end;
}

// ════════════════════════════════════════════════════════════════════════════
// ETAPA B (2026-05-29): follow-up contextual 5/8/12 do Pedro v2.
// GATED pela mesma allowlist do webhook (PEDRO_V2_ENABLED / _ALLOWED_USER_IDS /
// _ALLOWED_USER_EMAILS). Leads NAO-v2 (v1/Marcos/outras contas) seguem no fluxo
// classico 5/10 mais abaixo, INTOCADO. Controle de etapa em
// pedro_conversation_state.state.followup (sem migration).
// ════════════════════════════════════════════════════════════════════════════
function parseCsvEnv(name: string): string[] {
  return String(Deno.env.get(name) || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const _v2UserCache = new Map<string, boolean>();
async function isPedroV2User(supabaseUrl: string, serviceKey: string, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  if (_v2UserCache.has(userId)) return _v2UserCache.get(userId)!;
  let enabled = false;
  const globalFlag = String(Deno.env.get("PEDRO_V2_ENABLED") || "").toLowerCase();
  if (globalFlag === "true" || globalFlag === "1") {
    enabled = true;
  } else if (parseCsvEnv("PEDRO_V2_ALLOWED_USER_IDS").includes(userId.toLowerCase())) {
    enabled = true;
  } else {
    const allowedEmails = parseCsvEnv("PEDRO_V2_ALLOWED_USER_EMAILS");
    if (allowedEmails.length > 0) {
      try {
        const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (res.ok) {
          const u = await res.json();
          const email = String(u?.email || "").toLowerCase();
          if (email && allowedEmails.includes(email)) enabled = true;
        }
      } catch (_e) { /* fail-closed: nao habilita se o lookup falhar */ }
    }
  }
  _v2UserCache.set(userId, enabled);
  return enabled;
}

// Gera a mensagem de follow-up de forma contextual (gpt-4o-mini). Fallback fixo
// se nao houver chave/erro — nunca deixa de mandar algo natural.
async function generateFollowupText(opts: {
  kind: "reengage" | "check_help" | "farewell";
  agentName: string; companyName: string; persona: string;
  leadName?: string | null; recentTurns: any[];
}): Promise<{ text: string; usage: { input: number; output: number; total: number } }> {
  const noUsage = { input: 0, output: 0, total: 0 };
  const fallbacks: Record<string, string> = {
    reengage: "E ai, conseguiu dar uma olhada? Posso te ajudar com mais alguma coisa? 😊",
    check_help: "Ainda esta por ai? Posso te ajudar com mais alguma coisa? 😊",
    farewell: "Vou pedir para um dos nossos consultores de vendas dar continuidade no seu atendimento, ta? Ele ja vai entrar em contato com voce. Obrigado pelo papo! 😊",
  };
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return { text: fallbacks[opts.kind], usage: noUsage };
  const history = (opts.recentTurns || []).slice(-8)
    .map((t: any) => `${t.role === "agent" ? opts.agentName : (opts.leadName || "Cliente")}: ${String(t.text || "").slice(0, 300)}`)
    .join("\n");
  const goal: Record<string, string> = {
    reengage: "O cliente parou de responder ha ~5 min. Escreva UMA mensagem curta e natural so retomando o INTERESSE dele de forma leve (ex.: 'e ai, o que achou?' / 'conseguiu dar uma olhada?'), convidando a continuar. Sem pressionar. NAO prometa enviar nem REENVIAR nada e NAO re-cite/re-anuncie fotos que ja foram mandadas.",
    check_help: "SEGUNDA tentativa (~8 min sem resposta). A 1a mensagem JA retomou o veiculo/assunto — NAO repita isso. Aqui escreva algo bem CURTO so checando presenca, no estilo 'Ainda esta por ai?' ou 'Ainda posso te ajudar?'. NAO mencione veiculo, fotos, valores nem 'outras opcoes'. Apenas 1 frase curta.",
    farewell: "O cliente nao respondeu (~12 min). Escreva UMA mensagem curta e amigavel avisando que um consultor de vendas vai ENTRAR EM CONTATO com ele em breve e agradecendo o contato. IMPORTANTE: NAO diga que o atendimento continua 'por aqui'/'neste numero'/'aqui mesmo' — o vendedor fala de OUTRO numero. Use 'vai entrar em contato', nunca prometa que ele responde por este WhatsApp.",
  };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [
          { role: "system", content: [
            `Voce e ${opts.agentName}, consultor de vendas da ${opts.companyName || "loja"} no WhatsApp.`,
            opts.persona ? `Personalidade/estilo (siga o tom):\n${opts.persona.slice(0, 1200)}` : "",
            "Escreva SOMENTE a mensagem para o cliente (sem aspas, sem rotulos). Curta (1-2 frases), humana, em PT-BR.",
            "PROIBIDO prometer ou anunciar QUALQUER envio agora: NUNCA diga 'vou enviar', 'vou mandar', 'aqui estao as fotos', 'confira a seguir', 'segue as imagens', nem prometa fotos/imagens/videos/detalhes. Voce NAO esta enviando nada neste momento — e so um toque curto ou uma despedida. Se ja mandou fotos antes, NAO reenvie nem re-anuncie.",
            opts.leadName ? `Nome do cliente (apenas para contexto): ${opts.leadName}. NAO comece a mensagem com o nome e NAO repita o nome — soa robotico. Prefira nao usar o nome.` : "",
            goal[opts.kind],
          ].filter(Boolean).join("\n") },
          { role: "user", content: `Conversa recente:\n${history || "(sem historico)"}\n\nEscreva a mensagem.` },
        ],
      }),
    });
    if (!res.ok) return { text: fallbacks[opts.kind], usage: noUsage };
    const data = await res.json();
    const u = data?.usage || {};
    const uin = Math.max(0, Math.round(Number(u.prompt_tokens) || 0));
    const uout = Math.max(0, Math.round(Number(u.completion_tokens) || 0));
    let utot = typeof u.total_tokens === "number" ? Math.round(u.total_tokens) : uin + uout;
    if (!(utot > 0)) utot = uin + uout;
    const usage = { input: uin, output: uout, total: utot };
    const text = String(data?.choices?.[0]?.message?.content || "").trim().replace(/^["']+|["']+$/g, "").trim();
    return { text: text || fallbacks[opts.kind], usage };
  } catch (_e) {
    return { text: fallbacks[opts.kind], usage: noUsage };
  }
}

// Fluxo de follow-up do Pedro v2: 5min -> 8min -> 12min(transfere). Etapa em
// pedro_conversation_state.state.followup, com reset quando o lead volta a falar
// (anchor = last_agent_reply_at da rodada).
async function handleV2Followup(supabase: any, ctx: {
  lead: any; agentData: any; baseUrl: string; instKey: string; instanceName: string;
  remoteJid: string; phoneNumber: string; agentId: string; now: Date;
}) {
  const { lead, agentData, baseUrl, instKey, instanceName, remoteJid, phoneNumber, agentId, now } = ctx;
  const elapsedMin = (now.getTime() - new Date(lead.last_agent_reply_at).getTime()) / 60000;

  // Regras configuraveis por agente (NULL = legado 5/8/12, transfere, 10min, janela fixa).
  const { data: agentRulesRow } = await supabase
    .from("wa_ai_agents").select("automation_rules, gerente_phone, gerente_phone_2, gerente_feedback_completo, mensagens_sem_emoji, briefing_template_vendedor, briefing_template_gerente").eq("id", agentId).maybeSingle();
  const rules = resolveAutomationRules(agentRulesRow?.automation_rules);
  if (!rules.followup.enabled) return;              // gerente desligou o follow-up
  if (elapsedMin < rules.followup.t1_min) return;   // ainda nao chegou no 1o tempo

  const { data: stateRow } = await supabase
    .from("pedro_conversation_state").select("state")
    .eq("lead_id", lead.id).eq("agent_id", agentId).maybeSingle();
  const state = (stateRow?.state && typeof stateRow.state === "object") ? stateRow.state : {};
  if (state.conversa_encerrada) {
    console.log(`[CronFollowup] Conversa encerrada para o lead ${lead.id}. Ignorando follow-up.`);
    return;
  }
  const fu = (state.followup && typeof state.followup === "object") ? state.followup : {};
  const sameCycle = fu.anchor === lead.last_agent_reply_at;
  const stage = sameCycle ? Number(fu.stage || 0) : 0;
  const recentTurns = Array.isArray(state.recent_turns) ? state.recent_turns : [];

  const agentName = String(agentData?.name || "Consultor");
  const companyName = String(agentData?.company_name || "");
  const persona = String(agentData?.system_prompt || "");
  const leadName = lead.lead_name || (state.lead && state.lead.nome) || null;

  // AUDITORIA (so-registro): registra o follow-up automatico em ai_call_log.
  // logAiCall nunca lanca; nao bloqueia o envio.
  const logFollowupAi = async (usage: { input: number; output: number; total: number }) => {
    await logAiCall(supabase, {
      userId: lead.user_id,
      disparoTipo: "followup_auto",
      modelo: "gpt-4o-mini",
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.total,
      nSubcalls: usage.total > 0 ? 1 : 0,
      agentId,
      agentName,
      eventoOrigem: String(lead.id),
      status: usage.total > 0 ? "ok" : "fallback",
    });
  };

  const saveStage = async (newStage: number) => {
    const newState = { ...state, followup: { stage: newStage, anchor: lead.last_agent_reply_at, at: now.toISOString() } };
    if (stateRow) {
      await supabase.from("pedro_conversation_state").update({ state: newState })
        .eq("lead_id", lead.id).eq("agent_id", agentId);
    } else {
      await supabase.from("pedro_conversation_state").insert({
        lead_id: lead.id, agent_id: agentId, user_id: lead.user_id, state: newState,
      });
    }
  };
  const logChat = async (text: string) => {
    await supabase.from("wa_chat_history").insert({
      user_id: lead.user_id, agent_id: agentId, instance_id: instanceName,
      remote_jid: remoteJid, role: "assistant", content: text,
    });
  };

  // ─── T3 (default 12min): despedida amigavel + transferencia (se configurado) ───
  // So transfere se o gerente deixou o 3o follow-up transferir (t3_transfers) E a
  // transferencia estiver ativa. Senao: manda SO a despedida e para (lead fica
  // sem vendedor). `stage < 3` evita reenviar a despedida a cada ciclo do cron.
  if (elapsedMin >= rules.followup.t3_min && stage < 3) {
    // ── GATE DE CONECTIVIDADE (fix transferencia-fantasma) ───────────────────────
    // Manda a despedida ao LEAD PRIMEIRO e so prossegue se ela foi ENTREGUE. Se o envio
    // falhar (WhatsApp da loja offline / "session not reconnectable"), ADIA tudo: nao
    // transfere no CRM, nao grava historico, nao avanca o stage -> a proxima rodada tenta
    // de novo quando reconectar. Antes: T3 transferia o lead + gravava a despedida MESMO
    // com o envio falhando (enquanto T1/T2 validavam o envio e ficavam presos no stage 0),
    // entao o catch-up pulava direto pra ca e movia o lead no CRM sem ninguem ser avisado.
    const { text: bye, usage: byeUsage } = await generateFollowupText({ kind: "farewell", agentName, companyName, persona, leadName, recentTurns });
    await logFollowupAi(byeUsage);
    if (!(await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, bye))) {
      console.warn(`[CronFollowup] T3 lead ${lead.id}: despedida NAO enviada (WhatsApp provavelmente offline). Adiando transferencia — CRM/historico intocados.`);
      return;
    }
    await logChat(bye);

    const doTransfer = rules.followup.t3_transfers && rules.transfer.enabled;
    if (doTransfer) {
    const { data: updatedRows } = await supabase.from("ai_crm_leads")
      .update({ status: "transferido", assigned_to_id: null, followup_5min_sent: true, last_interaction_at: now.toISOString() })
      .in("status", ["novo", "interessado"]).eq("id", lead.id).select("id");
    if (!updatedRows || updatedRows.length === 0) return; // outro runner ja tratou

    let { data: teamMembers } = await supabase.from("ai_team_members").select("*")
      .eq("user_id", lead.user_id).eq("is_active", true).eq("agent_id", agentId)
      .order("last_lead_received_at", { ascending: true, nullsFirst: true }).limit(50);
    if (!teamMembers || teamMembers.length === 0) {
      const { data: fb } = await supabase.from("ai_team_members").select("*")
        .eq("user_id", lead.user_id).eq("is_active", true)
        .order("last_lead_received_at", { ascending: true, nullsFirst: true }).limit(50);
      teamMembers = fb;
    }
    const availableSellers = uniqueSellersByPhone(teamMembers || []);
    if (availableSellers.length > 0) {
      let seller = availableSellers[0];
      const { data: prev } = await supabase.from("ai_crm_leads").select("assigned_to_id")
        .eq("user_id", lead.user_id).eq("remote_jid", lead.remote_jid)
        .not("assigned_to_id", "is", null)
        .order("last_interaction_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const prevSeller = availableSellers.find((m: any) => m.id === prev?.assigned_to_id);
      if (prevSeller) seller = prevSeller;

      // Veiculo de interesse do lead (do anuncio/memoria do Pedro v2). Sem isso, o
      // briefing por IA so via o transcript e saia "VEICULO DE INTERESSE: Nao
      // especificado" para lead de anuncio (que so manda "tenho interesse").
      const veiculoInteresse = await resolveLeadInterestVehicle(supabase, lead.id, agentId);
      let summary = lead.summary || (veiculoInteresse
        ? `Veiculo de interesse: ${veiculoInteresse}. O cliente demonstrou interesse e parou de responder durante a conversa.`
        : "O cliente demonstrou interesse e parou de responder durante a conversa.");
      try {
        const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
        const { data: fullChat } = await supabase.from("wa_chat_history")
          .select("role, content, created_at").eq("agent_id", agentId).eq("remote_jid", remoteJid)
          .order("created_at", { ascending: false }).limit(20);
        if (openaiApiKey && fullChat && fullChat.length > 0) {
          const transcript = fullChat.reverse().map((m: any) =>
            `${m.role === "user" ? `Cliente (${leadName || "Desconhecido"})` : "Agente IA"}: ${String(m.content || "").substring(0, 400)}`).join("\n");
          const sres = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
            body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.3, messages: [
              { role: "system", content: `Voce e um analista de vendas especialista em mercado automotivo. Gere um briefing objetivo para o vendedor humano que vai assumir o atendimento. O cliente parou de responder.\n\nSecoes obrigatorias:\n*VEICULO DE INTERESSE:*\n*ORIGEM DO LEAD:*\n*PERFIL DO CLIENTE:*\n*DICA PARA RETOMADA:*\n\nSeja direto. Nao invente informacoes. Se o "Veiculo de interesse conhecido" for informado abaixo, use-o EXATAMENTE na secao VEICULO DE INTERESSE (e o carro do anuncio/conversa).` },
              { role: "user", content: `Conversa:\n${transcript}\n\nVeiculo de interesse conhecido: ${veiculoInteresse || "nao informado"}\n\nGere o briefing.` },
            ] }),
          });
          if (sres.ok) { const sd = await sres.json(); const gt = sd.choices?.[0]?.message?.content; if (gt) summary = gt; }
        }
      } catch (_e) { /* silencioso */ }

      await supabase.from("ai_crm_leads").update({ summary }).eq("id", lead.id);
      await supabase.from("ai_lead_transfers").insert({
        user_id: lead.user_id, lead_id: lead.id, to_member_id: seller.id,
        transfer_reason: `Inatividade do cliente (${rules.followup.t3_min} minutos)`, notes: summary,
        transfer_status: "pending", is_confirmed: false,
        confirmation_timeout_at: new Date(now.getTime() + rules.transfer.seller_response_min * 60000).toISOString(),
      });
      await supabase.from("ai_team_members").update({ last_lead_received_at: now.toISOString() }).eq("id", seller.id);
      // CATEGORIA DO LEAD (3 categorias do SDR) — transferencia por INATIVIDADE. Busca os
      // dados coletados na tabela pra separar INATIVO (lead de anuncio que nao engajou) de
      // POUCO QUALIFICADO (deu CPF/troca/financiamento e sumiu). Persiste status_crm pro
      // dashboard, sem sobrescrever movimento do vendedor. Best-effort: nunca derruba a transferencia.
      let _sdrCat: "inativo" | "pouco_qualificado" | "qualificado" = "inativo";
      let _leadCols: any = null;
      try {
        const { data: _lf } = await supabase.from("ai_crm_leads")
          .select("client_name, vehicle_interest, payment_method, budget, client_city, visit_scheduled, trade_in_vehicle, down_payment, cpf, status_crm")
          .eq("id", lead.id).maybeSingle();
        _leadCols = _lf;
        const _fields = { ...(_lf || {}), vehicle_interest: (_lf?.vehicle_interest || veiculoInteresse || null) };
        _sdrCat = classifyLeadSdrCategory(_fields, { by_inactivity: true });
        const _persist = classifyLeadSdr(_fields, { by_inactivity: true });
        if (["inativo", "pouco_qualificado", "qualificado"].includes(_persist as string)) {
          await supabase.from("ai_crm_leads").update({ status_crm: _persist }).eq("id", lead.id);
        }
      } catch (_e) { /* classificacao/persistencia best-effort */ }

      // Etiquetas pros templates personalizados (vendedor/gerente). Se o agente NAO tem
      // template/flag, composeX/maybeStripEmojis caem no comportamento de SEMPRE -> quem
      // nao mexeu NAO muda nada (aditivo + gated, mesma regra do orchestrator).
      const _hora = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const _tradeIn = _leadCols?.trade_in_vehicle || null;
      const _msgVars = buildEtiquetas({
        lead: { cidade: _leadCols?.client_city, telefone: phoneNumber },
        interesse: { modelo_desejado: veiculoInteresse },
        negociacao: { forma_pagamento: _leadCols?.payment_method, valor_entrada: _leadCols?.down_payment,
          tem_troca: !!_tradeIn, carro_troca: _tradeIn ? { modelo: _tradeIn } : null },
      }, {
        agentName, leadName, leadPhone: phoneNumber,
        sellerName: seller.name, sellerPhone: seller.whatsapp_number,
        interesse: veiculoInteresse, classificacao: sdrCategoryText(_sdrCat),
        horario: _hora, resumo: summary,
      });

      if (seller.whatsapp_number) {
        const cleanSellerNum = String(seller.whatsapp_number).replace(/\D/g, "");
        const _notifInline = `*NOVO LEAD PARA ATENDIMENTO (Sem resposta ${rules.followup.t3_min}min)*\n\n*Cliente:* ${leadName || "Desconhecido"}\n${sdrCategoryLine(_sdrCat)}\n*Contato:* +${phoneNumber}${veiculoInteresse ? `\n🚗 *Veículo:* ${veiculoInteresse}` : ""}\n*Agente IA:* ${agentName}\n\n--------------------\n*ANALISE DO LEAD PELA IA:*\n${summary}\n\n--------------------\n\n*Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!*`;
        const notif = maybeStripEmojis(agentRulesRow, composeSellerMsg(agentRulesRow, _msgVars, _notifInline));
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notif);
      }
      // Relatorio automatico ao(s) gerente(s) — ate 2.
      const _gerentes = managerPhones(agentRulesRow);
      if (_gerentes.length > 0) {
        const _mgrNum = String(seller.whatsapp_number || "").replace(/\D/g, "");
        const _mgrInline = `📊 *RELATÓRIO DE LEAD — ${agentName}*\n\n🕐 *Horário:* ${_hora}\n\n👤 *Lead:* ${leadName || "Desconhecido"}\n📱 *Telefone:* +${phoneNumber}\n🏷️ *Status:* ${sdrCategoryText(_sdrCat)}${veiculoInteresse ? `\n🚗 *Veículo de interesse:* ${veiculoInteresse}` : ""}\n📊 *Motivo:* inatividade (${rules.followup.t3_min}min)\n\n━━━━━━━━━━━━━━━━━━━━\n\n🎯 *Enviado para:* ${seller.name}\n📲 *WhatsApp vendedor:* ${seller.whatsapp_number || ""}\n\n━━━━━━━━━━━━━━━━━━━━\n_Gerado automaticamente pelo Pedro SDR_`;
        const _mgrCompleto = `📊 *RELATÓRIO COMPLETO — ${agentName}*\n\n🧑‍💼 *Vendedor atribuído:* ${seller.name}${_mgrNum ? ` — wa.me/${_mgrNum}` : ""}\n🕐 ${_hora}\n\n━━━━━━━━━━━━━━━━━━━━\n*Cliente:* ${leadName || "Desconhecido"}\n${sdrCategoryLine(_sdrCat)}\n*Contato:* +${phoneNumber}${veiculoInteresse ? `\n🚗 *Veículo:* ${veiculoInteresse}` : ""}\n📊 *Motivo:* inatividade (${rules.followup.t3_min}min)\n\n*ANALISE DO LEAD PELA IA:*\n${summary}\n━━━━━━━━━━━━━━━━━━━━\n_Relatório completo (mesmo briefing do vendedor) — Pedro SDR_`;
        const _mgrBase = (agentRulesRow?.gerente_feedback_completo === true)
          ? _mgrCompleto
          : composeGerenteMsg(agentRulesRow, _msgVars, _mgrInline);
        const _mgrMsg = maybeStripEmojis(agentRulesRow, _mgrBase);
        for (const gp of _gerentes) {
          try { await sendUazapiTextMessage(baseUrl, instKey, instanceName, gp, `${gp}@s.whatsapp.net`, _mgrMsg); } catch (_e) { /* nao bloqueante */ }
        }
      }
      // ETIQUETA SDR no WhatsApp Business: aplica a categoria do lead no chat NA TRANSFERENCIA
      // por inatividade. A cron v2 NAO fazia isso -> a etiqueta nunca mudava nos contatos (so o
      // brain-transfer do orquestrador etiquetava, mas a MAIORIA dos leads sai por inatividade aqui).
      try { await setSdrLabelOnChat({ api_url: baseUrl, api_key_encrypted: instKey }, phoneNumber, _sdrCat); } catch (_e) { /* nao bloqueante */ }
    }
    } // fim do if (doTransfer)
    await saveStage(3);
    return;
  }

  // ─── T2 (default 8min): segunda mensagem contextual ───
  if (elapsedMin >= rules.followup.t2_min && stage < 2) {
    const { text: txt, usage: txtUsage } = await generateFollowupText({ kind: "check_help", agentName, companyName, persona, leadName, recentTurns });
    await logFollowupAi(txtUsage);
    if (await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, txt)) {
      await logChat(txt); await saveStage(2);
    }
    return;
  }

  // ─── T1 (default 5min): primeira mensagem contextual ───
  if (elapsedMin >= rules.followup.t1_min && stage < 1) {
    const { text: txt, usage: txtUsage } = await generateFollowupText({ kind: "reengage", agentName, companyName, persona, leadName, recentTurns });
    await logFollowupAi(txtUsage);
    if (await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, txt)) {
      await logChat(txt); await saveStage(1);
      await supabase.from("ai_crm_leads").update({ followup_5min_sent: true }).eq("id", lead.id);
    }
    return;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createSupabaseClient(supabaseUrl, supabaseKey)

    const now = new Date();
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();
    const oneMinAgo = new Date(now.getTime() - 60000).toISOString();

    console.log(`[Cron] Iniciando varredura. Agora: ${now.toISOString()} | 5m ago: ${fiveMinsAgo} | 10m ago: ${tenMinsAgo}`);

    const operacional = isDentroDoHorarioOperacional(now);

    // ════════════════════════════════════════════════════════════════
    // SECAO 1: ROTATIVIDADE DE VENDEDORES (transferencia pendente > 10 min)
    // REGRA: O vendedor tem 10 minutos para responder "Ok" a partir do momento
    //        em que RECEBEU a notificacao (ai_lead_transfers.created_at).
    //        Usa ai_lead_transfers como fonte de verdade, NAO last_interaction_at.
    //        So executa dentro do horario operacional (10:10 - 21:30 Brasilia).
    // ════════════════════════════════════════════════════════════════
    if (operacional) {
      // Buscar transferencias pendentes onde o vendedor NAO confirmou em 10 minutos
      const { data: pendingTransfers } = await supabase
        .from('ai_lead_transfers')
        .select('*, lead:ai_crm_leads(*, wa_ai_agents!ai_crm_leads_agent_id_fkey(id, name, instance_id, instance_ids, automation_rules))')
        .eq('is_confirmed', false)
        .eq('transfer_status', 'pending')
        .lte('created_at', oneMinAgo); // candidatos (>=1min); o tempo real por agente e checado no loop (seller_response_min)

      if (pendingTransfers && pendingTransfers.length > 0) {
        console.log(`[Cron] Encontradas ${pendingTransfers.length} transferencias pendentes ha mais de 10 min.`);
        const { data: allInstances } = await supabase.from('wa_instances').select('*');

        for (const transfer of pendingTransfers) {
          const lead = transfer.lead;
          if (!lead) {
            console.warn(`[Cron] Transferencia ${transfer.id} sem lead associado. Pulando.`);
            continue;
          }

          // ── Regras configuraveis por agente (NULL = legado: 10min, janela fixa) ──
          const aRules = resolveAutomationRules(lead?.wa_ai_agents?.automation_rules);
          // Transferencia desligada pelo gerente -> sem escalacao automatica
          // (o lead fica com o vendedor atual; o "Ok" dele ainda confirma).
          if (!aRules.transfer.enabled) continue;
          // Tempo de resposta do vendedor (por agente). Ainda nao deu o tempo -> espera.
          const elapsedMinT = (now.getTime() - new Date(transfer.created_at).getTime()) / 60000;
          if (elapsedMinT < aRules.transfer.seller_response_min) continue;
          // ── Janela de repasse ──
          // Configurada (por agente): so repassa se AGORA estiver dentro dela
          // (narrowa dentro do horario operacional global ja checado acima).
          // Sem config: regra legada — lead CRIADO fora da janela fica com o vendedor.
          if (aRules.transfer.window) {
            // (a) nao repassa ENQUANTO agora estiver fora da janela.
            if (isWithinConfiguredWindow(aRules.transfer.window, now) === false) continue;
            // (b) lead CRIADO fora da janela (ex.: madrugada) fica com o vendedor —
            //     NAO repassa retroativamente quando o expediente volta de manha.
            //     Espelha a regra legada do branch abaixo. Sem isto, o lead da noite
            //     era repassado as 10h e o "Ok" do vendedor caia em "ja repassado".
            if (isWithinConfiguredWindow(aRules.transfer.window, new Date(transfer.created_at)) === false) {
              console.log(`[Cron] Transfer ${transfer.id} criado fora da janela configurada (${transfer.created_at}). Auto-confirmando - lead fica com o vendedor.`);
              await supabase.from('ai_lead_transfers')
                .update({ transfer_status: 'confirmed', is_confirmed: true })
                .eq('id', transfer.id);
              continue;
            }
          } else if (!transferCriadoNoHorario(transfer.created_at)) {
            console.log(`[Cron] Transfer ${transfer.id} criado fora do horario de repasse (${transfer.created_at}). Auto-confirmando - lead fica com vendedor atual.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'confirmed', is_confirmed: true })
              .eq('id', transfer.id);
            continue;
          }

          // Verificar se o lead ainda esta 'qualificado' (vendedor pode ter confirmado manualmente)
          const { data: freshLead } = await supabase
            .from('ai_crm_leads')
            .select('id, status, assigned_to_id')
            .eq('id', lead.id)
            .maybeSingle();

          // ── DEFESA EM PROFUNDIDADE 1: pula se status já mudou ──
          if (!freshLead || (freshLead.status !== 'qualificado' && freshLead.status !== 'transferido')) {
            console.log(`[Cron] Lead ${lead.id} nao esta mais qualificado/transferido (status: ${freshLead?.status}). Marcando transferencia como expirada e pulando.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('id', transfer.id);
            continue;
          }

          // ── DEFESA EM PROFUNDIDADE 2: se status='em_atendimento' OU já tem transfer mais novo CONFIRMADO ─
          // Cobre o caso "vendedor confirmou mas webhook falhou em algum step":
          // se existe um transfer pra esse lead criado DEPOIS de transfer.created_at com is_confirmed=true,
          // significa que houve confirmação posterior e este transfer já é stale.
          const { data: newerConfirmed } = await supabase
            .from('ai_lead_transfers')
            .select('id, to_member_id, created_at, is_confirmed, transfer_status')
            .eq('lead_id', lead.id)
            .gt('created_at', transfer.created_at)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (newerConfirmed && (newerConfirmed.is_confirmed || newerConfirmed.transfer_status === 'confirmed')) {
            console.log(`[Cron] Lead ${lead.id} tem transfer mais novo confirmado (${newerConfirmed.id} → ${newerConfirmed.to_member_id}). Pulando este transfer e marcando como expirado.`);
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'expired' })
              .eq('id', transfer.id);
            continue;
          }

          // ── DEFESA EM PROFUNDIDADE 3: se vendedor atual já recebeu OUTRO lead depois de transfer.created_at ─
          // Sinal de atividade — vendedor está ativo no sistema, não está "inativo".
          if (transfer.to_member_id) {
            const { data: currentSeller } = await supabase
              .from('ai_team_members')
              .select('last_lead_received_at, name')
              .eq('id', transfer.to_member_id)
              .maybeSingle();
            if (currentSeller?.last_lead_received_at && new Date(currentSeller.last_lead_received_at) > new Date(transfer.created_at)) {
              console.log(`[Cron] Vendedor ${currentSeller.name} já recebeu lead mais novo (${currentSeller.last_lead_received_at}) — está ativo, não repassar. Marcando transfer como confirmed.`);
              await supabase.from('ai_lead_transfers')
                .update({ transfer_status: 'confirmed', is_confirmed: true, confirmed_at: now.toISOString() })
                .eq('id', transfer.id);
              continue;
            }
          }

          const agentId = lead.agent_id;
          const currentSellerId = transfer.to_member_id;

          // Marcar a transferencia atual como expirada ATOMICAMENTE antes de repassar
          const { data: expireResult } = await supabase
            .from('ai_lead_transfers')
            .update({ transfer_status: 'expired' })
            .eq('id', transfer.id)
            .eq('transfer_status', 'pending') // SO expira se ainda for pending
            .select('id');

          if (!expireResult || expireResult.length === 0) {
            console.log(`[Cron] Transferencia ${transfer.id} ja foi processada por outro worker. Pulando.`);
            continue;
          }

          // Buscar TODOS os vendedores (inclusive o atual, para poder notifica-lo)
          let { data: teamMembers } = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', lead.user_id)
            .eq('is_active', true)
            .eq('agent_id', agentId)
            .order('last_lead_received_at', { ascending: true, nullsFirst: true })
            .limit(50);

          if (!teamMembers || teamMembers.length === 0) {
            const { data: fallbackTeamMembers } = await supabase
              .from('ai_team_members')
              .select('*')
              .eq('user_id', lead.user_id)
              .eq('is_active', true)
              .order('last_lead_received_at', { ascending: true, nullsFirst: true })
              .limit(50);
            teamMembers = fallbackTeamMembers;
          }

          // ── Notifica o vendedor que PERDEU o lead ──────────────────────
          const expiredSeller = (teamMembers || []).find((m: any) => m.id === currentSellerId);
          if (expiredSeller?.whatsapp_number) {
            const agentData = lead.wa_ai_agents;
            let targetInstanceId = agentData?.instance_id;
            if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
            const expiredInstance = allInstances?.find((i: any) => i.id === targetInstanceId);

            if (expiredInstance) {
              const expBaseUrl = expiredInstance.api_url?.replace(/\/$/, '');
              const expInstKey = expiredInstance.api_key_encrypted || expiredInstance.api_key;
              let expSellerNum = expiredSeller.whatsapp_number.replace(/\D/g, '');
              if (expSellerNum.length === 10 || expSellerNum.length === 11) expSellerNum = `55${expSellerNum}`;

              const missedMsg = `*LEAD REPASSADO*\n\nO lead *${lead.lead_name || 'Desconhecido'}* nao teve sua confirmacao dentro de 10 minutos e foi passado para o proximo da fila.\n\n*Por favor, NAO entre em contato com este cliente.*`;

              await sendUazapiTextMessage(expBaseUrl, expInstKey, expiredInstance.instance_name, expSellerNum, `${expSellerNum}@s.whatsapp.net`, missedMsg);
              console.log(`[Cron] Aviso enviado para ${expiredSeller.name} (perdeu o lead por inatividade).`);
            }
          }

          const availableSellers = uniqueSellersByPhone(
            teamMembers || [],
            currentSellerId,
            sellerPhoneKey({ whatsapp_number: expiredSeller?.whatsapp_number })
          );

          if (availableSellers.length === 0) {
            console.log(`[Cron] Nenhum outro vendedor disponivel para o agente ${agentId}. Lead ${lead.id} permanece com vendedor atual.`);
            // Diagnostico: rodizio sem outro vendedor para assumir.
            await logTransferFailure({
              user_id: lead.user_id,
              reason_code: 'sem_vendedor_disponivel',
              mode: 'pedro',
              lead_id: lead.id,
              agent_id: agentId,
              member_id: currentSellerId,
              lead_name: lead.lead_name,
              remote_jid: lead.remote_jid,
              attempted_transfer: true,
              source: 'cron-lead-followup',
              reason_detail: 'Transferencia expirou (vendedor nao respondeu em 10min) e nao ha outro vendedor ativo para o rodizio.',
            });
            // Repassar de volta para o mesmo (sem outros disponiveis)
            await supabase.from('ai_lead_transfers')
              .update({ transfer_status: 'pending' })
              .eq('id', transfer.id);
            continue;
          }

          const nextSeller = availableSellers[0];
          console.log(`[Cron] Repassando lead ${lead.id} de ${expiredSeller?.name || currentSellerId} para ${nextSeller.name} (nao respondeu em 10min).`);

          // ── NOTIFICA O PROXIMO VENDEDOR PRIMEIRO (gate anti-repasse-fantasma, #2) ──────
          // So reatribui o lead no CRM se conseguir AVISAR o proximo vendedor. Se o envio
          // falhar (instancia da loja offline), NAO reatribui: devolve a transferencia atual
          // pra pending e tenta de novo na proxima rodada. Antes: reatribuia no CRM e a
          // notificacao (sem validacao) se perdia -> o proximo vendedor nunca sabia do lead.
          const agentData = lead.wa_ai_agents;
          let targetInstanceId = agentData?.instance_id;
          if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];
          const instance = allInstances?.find((i: any) => i.id === targetInstanceId);

          let nextNotified = false;
          const nextHasNumber = Boolean(instance && nextSeller.whatsapp_number);
          if (nextHasNumber) {
            const baseUrl = instance.api_url?.replace(/\/$/, '');
            const instKey = instance.api_key_encrypted || instance.api_key;
            const cleanSellerNum = nextSeller.whatsapp_number.replace(/\D/g, '');
            const phoneNumber = lead.remote_jid.split('@')[0];

            // Gerar resumo para o proximo vendedor
            const veiculoInteresseRep = await resolveLeadInterestVehicle(supabase, lead.id, agentId);
            let aiGeneratedSummary = lead.summary || (veiculoInteresseRep
              ? `Veiculo de interesse: ${veiculoInteresseRep}. Lead qualificado aguardando atendimento.`
              : 'Lead qualificado aguardando atendimento.');
            try {
              const { data: fullChat } = await supabase
                .from('wa_chat_history')
                .select('role, content, created_at')
                .eq('agent_id', agentId)
                .eq('remote_jid', lead.remote_jid)
                .order('created_at', { ascending: false })
                .limit(20);

              const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
              if (openaiApiKey && fullChat && fullChat.length > 0) {
                const chatTranscript = fullChat.reverse().map((m: any) =>
                  `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
                ).join('\n');

                const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                  body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0.3,
                    messages: [
                      { role: 'system', content: `Gere um briefing curto e objetivo para um vendedor de carros que esta recebendo um lead repassado. Inclua: veiculo de interesse, perfil do cliente e dica de abordagem. Maximo 5 linhas. Se o "Veiculo de interesse conhecido" for informado, use-o como veiculo de interesse.` },
                      { role: 'user', content: `Conversa:\n${chatTranscript}\n\nVeiculo de interesse conhecido: ${veiculoInteresseRep || 'nao informado'}\n\nGere o briefing.` }
                    ]
                  })
                });
                if (summaryRes.ok) {
                  const sd = await summaryRes.json();
                  const gt = sd.choices?.[0]?.message?.content;
                  if (gt) aiGeneratedSummary = gt;
                }
              }
            } catch (e) { /* silencioso */ }

            const notificationMsg = `*LEAD REPASSADO (Vendedor anterior nao respondeu em 10min)*\n\n*Nome:* ${lead.lead_name || 'Desconhecido'}\n${leadTransferStatusLine("repassado")}\n*Numero:* +${phoneNumber}${veiculoInteresseRep ? `\n🚗 *Veículo:* ${veiculoInteresseRep}` : ""}\n*Agente IA:* ${agentData?.name || 'Assistente'}\n\n--------------------\n*ANALISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n--------------------\n\n*Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!*`;

            nextNotified = await sendUazapiTextMessage(baseUrl, instKey, instance.instance_name, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
            if (nextNotified) console.log(`[Cron] Notificacao enviada para ${nextSeller.name}.`);
          }

          // Instancia offline (tinha numero mas o envio falhou) -> NAO reatribui. Devolve a
          // transferencia atual pra pending (retry na proxima rodada) e loga a falha. Sem
          // numero = problema de config (nao e desconexao) -> segue o fluxo pra nao travar.
          if (nextHasNumber && !nextNotified) {
            console.warn(`[Cron] Lead ${lead.id}: falha ao notificar ${nextSeller.name} (WhatsApp da loja offline?). Revertendo expire pra pending — reatribuicao adiada.`);
            await supabase.from('ai_lead_transfers').update({ transfer_status: 'pending' }).eq('id', transfer.id);
            await logTransferFailure({
              user_id: lead.user_id, reason_code: 'notificacao_falhou', mode: 'pedro',
              lead_id: lead.id, agent_id: agentId, member_id: nextSeller.id,
              lead_name: lead.lead_name, remote_jid: lead.remote_jid, attempted_transfer: true,
              source: 'cron-lead-followup',
              reason_detail: 'Rodizio: envio da notificacao ao proximo vendedor falhou (instancia provavelmente offline). Reatribuicao adiada.',
            });
            continue;
          }

          // Notificado (ou sem numero) -> COMMIT a reatribuicao no CRM:
          // Atualizar lead com novo vendedor
          await supabase.from('ai_crm_leads').update({
            assigned_to_id: null,
            status: 'transferido',
          }).eq('id', lead.id).in('status', ['qualificado', 'transferido']);

          // Atualizar timestamp do novo vendedor
          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', nextSeller.id);

          // Criar nova transferencia para o proximo vendedor
          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            from_member_id: currentSellerId,
            to_member_id: nextSeller.id,
            transfer_reason: 'Rodizio por Inatividade do Vendedor (10min)',
            notes: `Repassado de ${currentSellerId} para ${nextSeller.name} por falta de resposta em 10 minutos`,
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });
        }
      } else {
        console.log('[Cron] Nenhuma transferencia pendente com timeout.');
      }
    } else {
      console.log('[Cron] Fora do horario operacional. Secao 1 (rodizio) ignorada.');
    }

    // ════════════════════════════════════════════════════════════════
    // SECAO 2: FOLLOW-UP + TRANSFERENCIA POR INATIVIDADE DO CLIENTE
    // 5 min -> ping de follow-up (funciona 24h)
    // 10 min -> transferencia para vendedor (so dentro do horario operacional)
    // ════════════════════════════════════════════════════════════════
    const { data: leads, error } = await supabase
      .from('ai_crm_leads')
      .select('*, wa_ai_agents!ai_crm_leads_agent_id_fkey(id, name, company_name, system_prompt, instance_id, instance_ids)')
      .in('status', ['novo', 'interessado'])
      .is('assigned_to_id', null)
      .not('last_agent_reply_at', 'is', null)
      .not('last_user_reply_at', 'is', null)
      .lte('last_agent_reply_at', fiveMinsAgo);

    if (error) throw error;
    if (!leads || leads.length === 0) {
      console.log('[Cron] Nenhum lead inativo encontrado.');
      return new Response(JSON.stringify({ message: "Nenhum lead inativo." }), { headers: corsHeaders, status: 200 });
    }

    console.log(`[Cron] Encontrados ${leads.length} leads inativos. Processando...`);
    const { data: instances } = await supabase.from('wa_instances').select('*');

    let processed5Min = 0;
    let processed10Min = 0;

    for (const lead of leads) {
      // Ignorar se o usuario falou depois do agente
      if (new Date(lead.last_user_reply_at) >= new Date(lead.last_agent_reply_at)) continue;

      const agentData = lead.wa_ai_agents;
      let targetInstanceId = agentData?.instance_id;
      if (!targetInstanceId && agentData?.instance_ids?.length > 0) targetInstanceId = agentData.instance_ids[0];

      const instance = instances?.find((i: any) => i.id === targetInstanceId);
      if (!instance) continue;

      const baseUrl = instance.api_url?.replace(/\/$/, '');
      const instKey = instance.api_key_encrypted || instance.api_key;
      const instanceName = instance.instance_name;
      const remoteJid = lead.remote_jid;
      const phoneNumber = remoteJid.split('@')[0];
      const agentId = lead.agent_id;

      // ETAPA B: leads do Pedro v2 (allowlist) usam o follow-up contextual 5/8/12.
      // Os demais (v1/Marcos/outras contas) seguem no fluxo classico 5/10 abaixo, intocado.
      if (await isPedroV2User(supabaseUrl, supabaseKey, lead.user_id)) {
        try {
          await handleV2Followup(supabase, { lead, agentData, baseUrl, instKey, instanceName, remoteJid, phoneNumber, agentId, now });
        } catch (e) {
          console.error(`[Cron][v2] Falha no follow-up v2 do lead ${phoneNumber}:`, e);
        }
        continue;
      }

      const is10MinPassed = new Date(lead.last_agent_reply_at) <= new Date(tenMinsAgo);

      if (is10MinPassed) {
        // --- REGRA DE 10 MINUTOS: TRANSFERENCIA PARA VENDEDOR (Funciona 24/7) ---
        // Sempre envia o lead inicial para o funil do vendedor, independente do horario.
        const { data: updatedRows, error: updateError } = await supabase
          .from('ai_crm_leads')
          .update({
            status: 'transferido',
            last_interaction_at: now.toISOString()
          })
          .in('status', ['novo', 'interessado'])
          .eq('id', lead.id)
          .select('id');

        if (updateError || !updatedRows || updatedRows.length === 0) {
          console.log(`[Cron] Lead ${phoneNumber} ja foi processado. Pulando.`);
          continue;
        }

        console.log(`[Cron] Lead ${phoneNumber} inativo ha 10 min. Transferindo sem mover status_crm. Buscando vendedor...`);

        let { data: teamMembers } = await supabase
          .from('ai_team_members')
          .select('*')
          .eq('user_id', lead.user_id)
          .eq('is_active', true)
          .eq('agent_id', agentId)
          .order('last_lead_received_at', { ascending: true, nullsFirst: true })
          .limit(50);

        if (!teamMembers || teamMembers.length === 0) {
          const { data: fallbackTeamMembers } = await supabase
            .from('ai_team_members')
            .select('*')
            .eq('user_id', lead.user_id)
            .eq('is_active', true)
            .order('last_lead_received_at', { ascending: true, nullsFirst: true })
            .limit(50);
          teamMembers = fallbackTeamMembers;
        }

        let selectedSellerId = null;
        let sellerName = 'Especialista';
        const availableSellers = uniqueSellersByPhone(teamMembers || []);

        if (availableSellers.length > 0) {
          let seller = availableSellers[0];
          const { data: previousLeadSeller } = await supabase
            .from('ai_crm_leads')
            .select('assigned_to_id')
            .eq('user_id', lead.user_id)
            .eq('remote_jid', lead.remote_jid)
            .not('assigned_to_id', 'is', null)
            .order('last_interaction_at', { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          const previousSeller = availableSellers.find((member: any) => member.id === previousLeadSeller?.assigned_to_id);
          if (previousSeller) {
            seller = previousSeller;
            console.log(`[Cron] Lead recorrente ${phoneNumber}. Mantendo vendedor anterior: ${seller.name}`);
          }
          selectedSellerId = seller.id;
          sellerName = seller.name;

          // ─── GERA O BRIEFING RICO DA IA ANTES DE QUALQUER COISA ─────────
          // (antes ficava DEPOIS do insert, então o CRM nunca recebia o
          // texto rico — só o "via cron" curto. Agora geramos primeiro
          // e gravamos no notes E no summary.)
          const { data: fullChat } = await supabase
            .from('wa_chat_history')
            .select('role, content, created_at')
            .eq('agent_id', agentId)
            .eq('remote_jid', remoteJid)
            .order('created_at', { ascending: false })
            .limit(20);

          const veiculoInteresseSec = await resolveLeadInterestVehicle(supabase, lead.id, agentId);
          let aiGeneratedSummary = lead.summary || (veiculoInteresseSec
            ? `Veiculo de interesse: ${veiculoInteresseSec}. O cliente demonstrou interesse e parou de responder durante a conversa.`
            : 'O cliente demonstrou interesse e parou de responder durante a conversa.');
          try {
            const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
            if (openaiApiKey && fullChat && fullChat.length > 0) {
              const chatTranscript = fullChat.reverse().map((m: any) =>
                `${m.role === 'user' ? `Cliente (${lead.lead_name || 'Desconhecido'})` : 'Agente IA'}: ${String(m.content || '').substring(0, 400)}`
              ).join('\n');

              const summaryRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  temperature: 0.3,
                  messages: [
                    { role: 'system', content: `Voce e um analista de vendas especialista em mercado automotivo. Gere um briefing objetivo para o vendedor humano que vai assumir o atendimento. O cliente parou de responder.\n\nSecoes obrigatorias:\n*VEICULO DE INTERESSE:*\n*ORIGEM DO LEAD:*\n*PERFIL DO CLIENTE:*\n*DICA PARA RETOMADA:*\n\nSeja direto. Nao invente informacoes. Se o "Veiculo de interesse conhecido" for informado abaixo, use-o EXATAMENTE na secao VEICULO DE INTERESSE.` },
                    { role: 'user', content: `Conversa:\n${chatTranscript}\n\nVeiculo de interesse conhecido: ${veiculoInteresseSec || 'nao informado'}\n\nGere o briefing.` }
                  ]
                })
              });
              if (summaryRes.ok) {
                const sd = await summaryRes.json();
                const gt = sd.choices?.[0]?.message?.content;
                if (gt) aiGeneratedSummary = gt;
              }
            }
          } catch (e) { /* silencioso */ }

          await supabase.from('ai_crm_leads').update({
            status: 'transferido',
            assigned_to_id: null,
            followup_5min_sent: true,
            last_interaction_at: now.toISOString(),
            summary: aiGeneratedSummary, // ← grava o resumo rico no lead
          }).eq('id', lead.id);

          await supabase.from('ai_lead_transfers').insert({
            user_id: lead.user_id,
            lead_id: lead.id,
            to_member_id: seller.id,
            transfer_reason: 'Inatividade do cliente (10 minutos)',
            notes: aiGeneratedSummary, // ← grava o resumo rico na transferência
            transfer_status: 'pending',
            is_confirmed: false,
            confirmation_timeout_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          });

          await supabase.from('ai_team_members').update({
            last_lead_received_at: now.toISOString(),
          }).eq('id', seller.id);

          if (seller.whatsapp_number) {
            const cleanSellerNum = seller.whatsapp_number.replace(/\D/g, '');

            const notificationMsg = `*NOVO LEAD PARA ATENDIMENTO (Sem resposta 10min)*\n\n*Cliente:* ${lead.lead_name || 'Desconhecido'}\n${leadTransferStatusLine("sem_resposta")}\n*Contato:* +${phoneNumber}${veiculoInteresseSec ? `\n🚗 *Veículo:* ${veiculoInteresseSec}` : ""}\n*Agente IA:* ${agentData?.name || 'Agente'}\n\n--------------------\n*ANALISE DO LEAD PELA IA:*\n${aiGeneratedSummary}\n\n--------------------\n\n*Atender agora:* https://wa.me/${phoneNumber}\n\n*Responda "Ok" para assumir este atendimento!*`;

            await sendUazapiTextMessage(baseUrl, instKey, instanceName, cleanSellerNum, `${cleanSellerNum}@s.whatsapp.net`, notificationMsg);
          }
        } else {
          // Diagnostico: lead ficou inativo (10min) e pronto para repasse, mas
          // NAO havia nenhum vendedor ativo. Status virou 'transferido' sem dono.
          await logTransferFailure({
            user_id: lead.user_id,
            reason_code: 'sem_vendedor_disponivel',
            mode: 'pedro',
            lead_id: lead.id,
            agent_id: agentId,
            lead_name: lead.lead_name,
            remote_jid: lead.remote_jid,
            lead_status: 'transferido',
            attempted_transfer: true,
            source: 'cron-lead-followup',
            reason_detail: 'Lead inativo (10min) pronto para repasse, mas nenhum vendedor ativo disponivel na fila.',
          });
        }
        // Mensagem de despedida para o cliente
        const byeMsg = "Estarei te transferindo para um dos nossos especialistas em vendas!";
        await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, byeMsg);
        processed10Min++;

      } else if (!lead.followup_5min_sent) {
        // --- REGRA DE 5 MINUTOS (FOLLOW-UP) — Funciona 24h ---
        console.log(`[Cron] Lead ${phoneNumber} inativo ha 5 min. Enviando ping...`);
        const randomMsg = FIVE_MIN_MESSAGES[Math.floor(Math.random() * FIVE_MIN_MESSAGES.length)];

        const sent = await sendUazapiTextMessage(baseUrl, instKey, instanceName, phoneNumber, remoteJid, randomMsg);

        if (sent) {
          await supabase.from('ai_crm_leads').update({
            followup_5min_sent: true
          }).eq('id', lead.id);

          await supabase.from('wa_chat_history').insert({
            user_id: lead.user_id, agent_id: agentId, instance_id: instanceName,
            remote_jid: remoteJid, role: 'assistant', content: randomMsg
          });

          processed5Min++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      build: 'etapa-b-followup-5-8-12-v1',
      horario_operacional: operacional,
      processed_5_min: processed5Min,
      processed_10_min: processed10Min
    }), { headers: corsHeaders, status: 200 })

  } catch (err: any) {
    console.error("[Cron] Falha:", err);
    return new Response(JSON.stringify({ error: err.message }), { headers: corsHeaders, status: 500 })
  }
})
