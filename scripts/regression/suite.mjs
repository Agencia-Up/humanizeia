// ============================================================================
// SUÍTE DE REGRESSÃO do Pedro v2 (Pilar D — blindagem).
// Roda TODOS os casos reais que já corrigimos contra o dry-run do agente (comportamento
// real, NÃO envia nada). Cobre as CLASSES de erro, não instâncias. Objetivo: um conserto
// novo só passa se NÃO quebrar nenhum caso antigo. Rode DEPOIS de cada deploy:
//   node scripts/regression/suite.mjs            (tudo)
//   node scripts/regression/suite.mjs alucinacao (só um grupo)
// Sai com código !=0 se algo falhar (pra travar no fluxo de deploy).
// ============================================================================
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']\s*$/g, "").trim();
}
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const URL = "https://seyljsqmhlopkcauhlor.supabase.co";
const INSTANCE = "whatsapp-carvalho-4yae";
const USER = "f49fd48a-4386-4009-95f3-26a5100b84f7";
const AGENT = "aee7e916-31b1-431c-ba6f-f38178fd4899";
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const onlyGroup = (process.argv[2] || "").toLowerCase();

let _seq = 0;
const freshChat = () => `5599${(Date.now() % 1e7).toString().padStart(7, "0")}${_seq++}@s.whatsapp.net`;

// Override opt-in de provedor (mitigação/teste multi-LLM). Ex.: FORCE_PROVIDER=deepseek node suite.mjs
const FORCE_PROVIDER = (process.env.FORCE_PROVIDER || "").trim().toLowerCase();
function applyProviderOverride(body) {
  if (FORCE_PROVIDER) { body.planner_provider = FORCE_PROVIDER; body.reply_provider = FORCE_PROVIDER; }
  return body;
}

async function dryRun({ text, externalAdReply, chatid } = {}) {
  const body = { instanceName: INSTANCE, chatid: chatid || freshChat(), senderName: "RegTest", text: text ?? "", dry_run: true };
  if (externalAdReply) body.externalAdReply = externalAdReply;
  applyProviderOverride(body);
  const r = await fetch(`${URL}/functions/v1/pedro-webhook-v2`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  const reply = typeof j.reply === "string" ? j.reply : (j.reply && j.reply.text) || "";
  return {
    raw: j,
    build: j.build,
    action: j.brain_plan?.action,
    planner_source: j.brain_plan?.source || null,
    planner_provider: j.brain_plan?._planner_meta?.provider || null,
    reply_provider: j.reply?._reply_provider || null,
    filters: j.brain_plan?.search_filters || {},
    items: (j.stock_result?.items || []),
    fotos: Array.isArray(j.reply?.media) ? j.reply.media.length : 0,
    pronto: j.reply?.pronto_para_transferir === true,
    temperatura: j.reply?.temperatura || null,
    next_action: j.next_action,
    reply,
    replyN: reply.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
  };
}

// ── asserções (retornam {pass,label}) ──────────────────────────────────────
const A = {
  replyHas: (r, words) => ({ pass: words.some(w => r.replyN.includes(w.toLowerCase())), label: `reply contém algum de [${words}]` }),
  replyHasNot: (r, words) => { const hit = words.find(w => r.replyN.includes(w.toLowerCase())); return { pass: !hit, label: `reply NÃO contém [${words}]${hit ? ` (achou "${hit}")` : ""}` }; },
  fotos: (r, n) => ({ pass: r.fotos === n, label: `fotos == ${n} (got ${r.fotos})` }),
  fotosGt: (r, n) => ({ pass: r.fotos > n, label: `fotos > ${n} (got ${r.fotos})` }),
  action: (r, a) => ({ pass: r.action === a, label: `action == ${a} (got ${r.action})` }),
  pronto: (r, v) => ({ pass: r.pronto === v, label: `pronto_para_transferir == ${v} (got ${r.pronto})` }),
  temperatura: (r, t) => ({ pass: r.temperatura === t, label: `temperatura == ${t} (got ${r.temperatura})` }),
  nextActionNot: (r, na) => ({ pass: r.next_action !== na, label: `next_action != ${na} (got ${r.next_action})` }),
  hasItems: (r) => ({ pass: r.items.length > 0, label: `busca retornou itens (got ${r.items.length})` }),
  noInlineList: (r) => { const bad = String(r.reply || "").split(/\n/).some(line => ((line.match(/\d{1,2}\.\s+[A-Za-zÀ-ÿ]/g) || []).length >= 2)); return { pass: !bad, label: `sem 2+ veículos numerados na mesma linha` }; },
  itemsPriceMax: (r, max) => { const bad = r.items.filter(v => Number(v.preco) > 0 && Number(v.preco) > max); return { pass: bad.length === 0, label: `nenhum item > R$${max} (viol: ${bad.map(v => v.preco)})` }; },
  itemsYearIn: (r, [lo, hi]) => { const bad = r.items.filter(v => Number(v.ano) && (Number(v.ano) < lo || Number(v.ano) > hi)); return { pass: bad.length === 0, label: `anos em [${lo},${hi}] (viol: ${bad.map(v => v.ano)})` }; },
};
const NAO_TEMOS = ["nao temos", "não temos", "nao tem ", "nao possuimos", "indisponivel"];
const ISCA = ["posso ajudar com mais alguma", "gostaria de saber mais", "alguma duvida", "estou a disposicao", "fico a disposicao", "qualquer duvida"];

// ── CASOS SEM ESTADO (turno único) ──────────────────────────────────────────
const stateless = [
  // — Anti-alucinação / falso "não temos" (a dor central) —
  { g: "alucinacao", n: "tem onix -> apresenta, não nega", text: "tem onix?", e: r => [A.replyHas(r, ["onix"]), A.replyHasNot(r, NAO_TEMOS)] },
  { g: "alucinacao", n: "tem fiat toro -> não nega", text: "tem fiat toro?", e: r => [A.replyHas(r, ["toro"]), A.replyHasNot(r, NAO_TEMOS)] },
  { g: "alucinacao", n: "picape cabine dupla -> apresenta", text: "tem picape cabine dupla?", e: r => [A.replyHasNot(r, NAO_TEMOS)] },
  { g: "alucinacao", n: "tem suv -> apresenta", text: "tem suv?", e: r => [A.replyHasNot(r, NAO_TEMOS)] },
  { g: "alucinacao", n: "tem hatch -> apresenta", text: "tem hatch?", e: r => [A.replyHasNot(r, NAO_TEMOS)] },
  // Busca AMPLA não pode ZERAR por causa da frase do lead que sobra em ad_context (lead 99716-4335:
  // "procuro suv ... pra frente" zerava 27 SUVs porque "procuro/pra/frente" viravam filtro DURO de match).
  { g: "alucinacao", n: "procuro suv pra frente -> apresenta (busca ampla não zera por ad_context)", text: "procuro suv pra frente", e: r => [A.hasItems(r), A.replyHasNot(r, NAO_TEMOS)] },
  { g: "alucinacao", n: "procuro suv 2020 pra frente -> apresenta (com ano)", text: "procuro suv 2020 pra frente", e: r => [A.hasItems(r), A.replyHasNot(r, NAO_TEMOS)] },
  // ANÚNCIO de modelo específico + lead AMPLIA p/ tipo genérico (lead 99716-4335): o reply NÃO pode
  // fixar/confirmar fotos do modelo do anúncio (Tracker) — deve APRESENTAR a categoria (vários SUVs).
  { g: "alucinacao", n: "anúncio Tracker + 'procuro suv 2020 pra frente' -> apresenta SUVs (não fixa no Tracker)",
    text: "Bom dia\nProcuro um suv 2020 pra frente",
    ad: { title: "Fale com um consultor", body: "Veículos revisados", greetingMessageBody: "Olá! Quer saber mais sobre o Tracker Premier 1.2 2023?", sourceUrl: "https://fb.me/x" },
    e: r => {
      const models = ["renegade", "creta", "compass", "kicks", "pulse", "2008", "tracker", "asx", "pajero", "captur", "duster", "tcross", "t-cross", "nivus", "corolla cross", "hr-v", "hrv"];
      const hits = models.filter(m => r.replyN.includes(m)).length;
      return [A.fotos(r, 0), A.replyHasNot(r, ["confirmar as fotos do", "vou confirmar as fotos"]), { pass: hits >= 2, label: `apresenta >=2 SUVs distintos (got ${hits})` }];
    } },

  // — Preço / faixa —
  { g: "preco", n: "corolla até 50 mil: nada acima do teto", text: "tem corolla ate 50 mil?", e: r => [A.itemsPriceMax(r, 50000)] },
  { g: "preco", n: "onix até 30 mil: sem item acima/sem-preço furando", text: "tem onix ate 30 mil?", e: r => [A.itemsPriceMax(r, 30000)] },
  { g: "preco", n: "hatch 2013 a 2018: anos na faixa", text: "tem hatch de 2013 a 2018?", e: r => [A.itemsYearIn(r, [2013, 2018])] },
  { g: "preco", n: "suv até 80 mil: nada acima", text: "tem suv ate 80 mil?", e: r => [A.itemsPriceMax(r, 80000)] },

  // — Fotos / mídia —
  { g: "fotos", n: "[imagem recebida]+orçamento -> 0 fotos (placeholder)", text: "[imagem recebida]\nAcima de 1.0 ate 50000", e: r => [A.fotos(r, 0)] },
  { g: "fotos", n: "[imagem recebida] só -> 0 fotos", text: "[imagem recebida]", e: r => [A.fotos(r, 0)] },
  { g: "fotos", n: "manda foto do onix -> envia fotos", text: "manda foto do onix", e: r => [A.fotosGt(r, 0)] },
  { g: "fotos", n: "tem video do onix -> 0 fotos, honesto", text: "tem video do onix?", e: r => [A.fotos(r, 0)] },
  { g: "fotos", n: "me manda fotos (sem modelo) -> 0 fotos, pergunta qual", text: "me manda umas fotos", e: r => [A.fotos(r, 0)] },

  // — Atendimento —
  { g: "atendimento", n: "spec question: sem pergunta-isca proibida", text: "quantos lugares tem o onix?", e: r => [A.replyHasNot(r, ISCA)] },
  { g: "atendimento", n: "golpe/hostil -> temperatura desqualificado", text: "isso e golpe, vey kkk", e: r => [A.temperatura(r, "desqualificado")] },

  // — Financiamento / transferência —
  { g: "transfer", n: "quero financiar + nome -> transfere", text: "quero financiar o onix, meu nome e joao", e: r => [A.pronto(r, true), A.replyHas(r, ["especialista", "consultor", "financiamento"])] },
  { g: "transfer", n: "vocês financiam? (info) -> NÃO transfere", text: "voces financiam?", e: r => [A.pronto(r, false)] },

  // — Tipo de veículo —
  { g: "tipo", n: "tem moto -> recusa (só carros)", text: "tem moto?", e: r => [A.replyHas(r, ["nao temos moto", "apenas com carros", "so com carros", "trabalhamos com carros", "so carros", "nao trabalhamos com moto", "nao temos motos"])] },

  // — Pilar B: SLOTS (marca explícita) — ALVO REAL lead 99627-7728: "Sedan. Só se for Honda" —
  // O agente mostrava Chevrolet/Fiat e ignorava a Honda City que EXISTE. Deve liderar com a Honda.
  { g: "slots", n: "marca explícita Honda -> apresenta Honda (não só outras marcas)", text: "quero um sedan, so se for honda",
    e: r => [{ pass: (r.items || []).length > 0 && r.items.some(v => /honda/i.test(String(v.marca))), label: `items inclui Honda (got: ${(r.items || []).slice(0, 4).map(v => v.marca).join("|") || "vazio"})` }, A.replyHas(r, ["honda"])] },
  // TROCA: "eu tenho um cruze 2016" = carro do lead (não interesse) -> NÃO busca Cruze nem nega.
  { g: "slots", n: "troca: 'eu tenho um cruze 2016' NÃO vira busca de Cruze", text: "Nossa muito rodando. Eu tenho um cruze 2016 com 64 mil de km",
    e: r => [{ pass: r.action !== "stock_search" || !/cruze/i.test(String(r.filters?.modelo_desejado || r.filters?.modelo || "")), label: `não buscou Cruze (action=${r.action}, modelo=${r.filters?.modelo_desejado || "-"})` }, A.replyHasNot(r, NAO_TEMOS)] },
];

// ── SAÚDE DO CÉREBRO: o planner/reply DEVE usar LLM, nunca a heurística burra (incidente 18/06:
// OpenAI caiu -> tudo na heurística -> agente "burro" em silêncio; a suíte NÃO pegava). Com o
// failover (Pilar E), só cai na heurística se TODOS os provedores falharem. ──────────────────
const health = [
  { g: "saude", n: "planner usa LLM (não a heurística burra)", text: "tem corolla?", e: r => [
    { pass: r.planner_source === "llm", label: `planner.source==llm (got ${r.planner_source}, prov=${r.planner_provider || "NONE"})` },
  ] },
  { g: "saude", n: "reply usa LLM (não fallback determinístico) numa busca", text: "tem onix?", e: r => [
    { pass: !!r.reply_provider, label: `reply via LLM (prov=${r.reply_provider || "NONE"})` },
  ] },
];

// ── CASOS COM ESTADO (setup no banco -> dry-run -> cleanup) ──────────────────
async function withLead(seed, fn) {
  const CHAT = freshChat();
  const cleanup = [];
  let leadId = null;
  try {
    const { data: lead } = await sb.from("ai_crm_leads").insert({ user_id: USER, agent_id: AGENT, remote_jid: CHAT, lead_name: "RegTest", ...(seed.lead || {}) }).select("id").maybeSingle();
    leadId = lead?.id || null;
    if (seed.state && leadId) await sb.from("pedro_conversation_state").upsert({ lead_id: leadId, agent_id: AGENT, user_id: USER, state: seed.state }, { onConflict: "lead_id,agent_id" });
    for (const h of (seed.history || [])) await sb.from("wa_chat_history").insert({ user_id: USER, agent_id: AGENT, instance_id: INSTANCE, remote_jid: CHAT, role: h.role, content: h.content, ...(h.metadata ? { metadata: h.metadata } : {}) });
    return await fn(CHAT, leadId);
  } finally {
    try { if (leadId) await sb.from("pedro_followup_reactivation").delete().eq("lead_id", leadId); } catch (_e) {}
    try { await sb.from("pedro_conversation_state").delete().eq("lead_id", leadId); } catch (_e) {}
    try { await sb.from("wa_chat_history").delete().eq("remote_jid", CHAT); } catch (_e) {}
    try { if (leadId) await sb.from("ai_crm_leads").delete().eq("id", leadId); } catch (_e) {}
  }
}

const stateful = [
  { g: "oferta", n: "'Ok' após oferta de opções -> apresenta (não despede)", run: () => withLead(
    { history: [{ role: "assistant", content: "Posso te mostrar outras opções de hatch que temos?" }] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "Ok" }); return { r, checks: [A.action(r, "stock_search"), A.replyHasNot(r, ["nao vou tomar seu tempo", "se mudar de ideia"])] }; }) },
  { g: "oferta", n: "'Ok obrigado, tchau' após oferta -> despede (não força)", run: () => withLead(
    { history: [{ role: "assistant", content: "Posso te mostrar outras opções de hatch que temos?" }] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "Ok obrigado, tchau" }); return { r, checks: [{ pass: r.action !== "stock_search", label: `action != stock_search (got ${r.action})` }] }; }) },
  { g: "memoria", n: "pergunta de preço genérica usa interesse (picape), não 'carro'", run: () => withLead(
    { state: { interesse: { tipo_veiculo: "pickup", modelo_desejado: "pickup", stock_broad: true }, atendimento: { etapa: "apresentando_opcoes" } } },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "Esse preço que vocês anunciaram é real?" }); return { r, checks: [{ pass: (r.filters.tipo_veiculo === "pickup") || r.items.some(v => /pickup|picape|toro|strada|frontier|ranger|hilux/i.test(`${v.modelo} ${v.marca}`)), label: `buscou picape (tipo=${r.filters.tipo_veiculo})` }, A.replyHasNot(r, NAO_TEMOS)] }; }) },
  { g: "reativacao", n: "lead reativado + pausado -> NÃO fica mudo", run: () => withLead(
    { lead: { ai_paused: true }, state: { interesse: { tipo_veiculo: "suv", modelo_desejado: "creta" } } },
    async (chat, leadId) => {
      try { await sb.from("pedro_followup_reactivation").insert({ lead_id: leadId, user_id: USER, status: "responded", send_count: 1 }); } catch (_e) {}
      const r = await dryRun({ chatid: chat, text: "ainda tem?" });
      return { r, checks: [A.nextActionNot(r, "ai_paused")] };
    }) },
  { g: "anuncio", n: "anúncio em RAJADA (metadata) -> recupera veículo", run: () => withLead(
    { history: [{ role: "user", content: "Olá! Tenho interesse e queria mais informações, por favor.", metadata: { ctwa_ad: { greetingMessageBody: "Oi! Como podemos ajudar?", body: "🚗 PULSE AUDACE T200\nAno: 2024/2025\nMotor: 1.0 Turbo\nCâmbio: Automático", title: "Por: R$ 108.990,00", sourceApp: "instagram" } } }] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "Quantos kms" }); return { r, checks: [A.replyHas(r, ["pulse"])] }; }) },

  // PILAR C — TROCA qualificada -> ANUNCIA o consultor (não "à disposição" / não silêncio). Caso real
  // lead 99710-1211 "Marcos": colheu Onix+CRLV+valor, interesse Strada, e fechou com "estou à disposição".
  { g: "transfer", n: "troca qualificada (interesse+veículo de troca+nome) -> anuncia consultor, não dispensa", run: () => withLead(
    { lead: { lead_name: "Marcos", trade_in_vehicle: "Onix", vehicle_interest: "Fiat Strada" }, state: { interesse: { modelo_desejado: "Fiat Strada", trade_in_vehicle: "Onix" } } },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "tenho um onix 2016 na troca, 75 mil km" }); return { r, checks: [A.pronto(r, true), A.replyHas(r, ["consultor", "especialista", "avaliar", "avalia", "passar"]), A.replyHasNot(r, ["a disposicao", "estou a disposicao", "fico a disposicao"])] }; }) },

  // PILAR C — INTELIGÊNCIA do cérebro (decision_context, sem if por caso): NÃO repetir a lista já
  // mostrada + RECONHECER o sentimento. Caso real lead 99627-7728 ("ficaram orrivel" -> repetiu lista).
  { g: "memoria", n: "reclamou dos carros já mostrados -> NÃO repete a mesma lista, reconhece e avança", run: () => withLead(
    { lead: { lead_name: "Joao" }, state: { interesse: { tipo_veiculo: "sedan" }, veiculos_apresentados: [{ label: "Chevrolet Onix Sedan Plus 2025", marca: "Chevrolet", modelo: "Onix Sedan", ano: 2025, preco: 97990 }, { label: "Fiat Cronos 2025", marca: "Fiat", modelo: "Cronos", ano: 2025, preco: 82990 }] },
      history: [{ role: "assistant", content: "Temos alguns sedans: 1. Chevrolet Onix Sedan Plus 2025 - R$ 97.990. 2. Fiat Cronos 2025 - R$ 82.990. Quer ver fotos de algum?" }] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "esses ficaram horriveis" }); return { r, checks: [{ pass: !(r.replyN.includes("onix") && r.replyN.includes("cronos")), label: `não repetiu a lista (reply: "${r.reply.slice(0, 60)}")` }] }; }) },

  // GROUNDING no CONJUNTO APRESENTADO (lead 99214-4889): apresentou 3 Onix (todos com fotos), lead
  // pediu "E os outros" e o agente MENTIU ("só tenho as fotos do Activ 2017"). O reply deve oferecer
  // os OUTROS (eles existem + têm fotos), nunca negar. Geral p/ qualquer lista de qualquer modelo.
  { g: "fotos", n: "'E os outros' após apresentar 3 Onix -> oferece os outros, não mente que só tem 1", run: () => withLead(
    { state: { interesse: { modelo_desejado: "Onix", tipo_veiculo: "hatch" }, veiculos_apresentados: [
        { label: "Chevrolet Onix HATCH ACTIV 1.4 2017", marca: "Chevrolet", modelo: "Onix", versao: "ACTIV 1.4", ano: 2017, cor: "Laranja", preco: 64990, km: 111354, fotos: ["a.jpg", "b.jpg"], images_count: 16 },
        { label: "Chevrolet Onix HATCH LT 1.0 2022", marca: "Chevrolet", modelo: "Onix", versao: "LT 1.0", ano: 2022, cor: "Azul", preco: 66990, km: 111000, fotos: ["c.jpg"], images_count: 10 },
        { label: "Chevrolet Onix HATCH LT 2025", marca: "Chevrolet", modelo: "Onix", versao: "LT", ano: 2025, cor: "Branco", preco: 76990, km: 43900, fotos: ["d.jpg"], images_count: 10 },
      ], ultima_foto: { veiculo_key: "chevrolet-onix-activ-2017", veiculo_index: 0, target: "overview", fotos_enviadas: [0, 3, 6] } },
      history: [
        { role: "assistant", content: "Temos algumas opções de Onix:\n1. Chevrolet Onix HATCH ACTIV 2017, laranja, R$ 64.990.\n2. Chevrolet Onix HATCH LT 2022, azul, R$ 66.990.\n3. Chevrolet Onix 2025, branco, R$ 76.990.\nQuer ver fotos de algum deles?" },
        { role: "user", content: "Sim" },
        { role: "assistant", content: "Vou te enviar as fotos do Chevrolet Onix HATCH ACTIV 2017. 😊" },
      ] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "E os outros" });
      return { r, checks: [
        A.replyHasNot(r, ["so tenho", "nao tenho mais", "nao tenho outras", "apenas as fotos do", "somente as fotos", "nao temos mais"]),
        A.replyHas(r, ["2022", "2025", "azul", "branco", "lt"]),
      ] }; }) },

  // FORMATAÇÃO de lista (lead 99214-4889): "1. ... 2. ... 3. ..." tudo na MESMA linha = ilegível.
  { g: "fotos", n: "lista de Onix -> cada veículo em sua própria linha", run: () => withLead(
    { state: { interesse: { modelo_desejado: "Onix" } } },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "tem onix?" }); return { r, checks: [A.noInlineList(r)] }; }) },

  // DISAMBIGUAÇÃO (lead 99214-4889 #2): "Sim" a "fotos de algum deles?" com 3 Onix -> PERGUNTA qual
  // (extrai o que o lead quer), não despeja o álbum do primeiro.
  { g: "fotos", n: "'Sim' a oferta de fotos com 3 Onix -> pergunta qual, não despeja o 1º", run: () => withLead(
    { state: { interesse: { modelo_desejado: "Onix", tipo_veiculo: "hatch" }, veiculos_apresentados: [
        { label: "Chevrolet Onix HATCH ACTIV 1.4 2017", marca: "Chevrolet", modelo: "Onix", ano: 2017, cor: "Laranja", preco: 64990, km: 111354, fotos: ["a.jpg", "b.jpg"], images_count: 16 },
        { label: "Chevrolet Onix HATCH LT 1.0 2022", marca: "Chevrolet", modelo: "Onix", ano: 2022, cor: "Azul", preco: 66990, km: 111000, fotos: ["c.jpg"], images_count: 10 },
        { label: "Chevrolet Onix HATCH LT 2025", marca: "Chevrolet", modelo: "Onix", ano: 2025, cor: "Branco", preco: 76990, km: 43900, fotos: ["d.jpg"], images_count: 10 },
      ] },
      history: [{ role: "assistant", content: "Temos algumas opções de Onix:\n1. Chevrolet Onix HATCH ACTIV 2017, laranja, R$ 64.990.\n2. Chevrolet Onix HATCH LT 2022, azul, R$ 66.990.\n3. Chevrolet Onix 2025, branco, R$ 76.990.\nQuer ver fotos de algum deles?" }] },
    async (chat) => { const r = await dryRun({ chatid: chat, text: "Sim" }); return { r, checks: [A.fotos(r, 0), A.replyHas(r, ["qual"])] }; }) },
];

// ── REPLAY de anúncios REAIS (ctwa_diag_capture) ────────────────────────────
function deepFind(o, k, d = 0) { if (!o || typeof o !== "object" || d > 14) return null; for (const [kk, v] of Object.entries(o)) { if (kk === k && v) return v; if (v && typeof v === "object") { const r = deepFind(v, k, d + 1); if (r) return r; } } return null; }
async function replayCtwa(limit = 12) {
  const rows = (await sb.from("ctwa_diag_capture").select("payload").order("created_at", { ascending: false }).limit(limit)).data || [];
  const out = [];
  for (const row of rows) {
    const greeting = deepFind(row.payload, "greetingMessageBody") || "";
    const m = String(greeting).match(/sobre\s+(?:o|a|os|as)?\s*(.+?)\s*(?:dispon[ií]ve|por\s+r\$|\?)/i);
    const model = m ? m[1].split(/\s+/).filter(w => !/^(19|20)\d{2}$/.test(w)).slice(0, 3).join(" ") : "";
    if (!model) continue;
    const FRESH = "55" + Math.floor(Math.random() * 1e9);
    let s = JSON.stringify(row.payload);
    for (const id of [deepFind(row.payload, "sender_pn"), deepFind(row.payload, "sender")]) { if (id) { const dig = String(id).replace(/\D/g, ""); if (dig) s = s.split(dig).join(FRESH); } }
    const p = JSON.parse(s); p.dry_run = true; p.chatid = FRESH + "@s.whatsapp.net"; p.instanceName = p.instanceName || INSTANCE;
    applyProviderOverride(p);
    const r = await fetch(`${URL}/functions/v1/pedro-webhook-v2`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, apikey: KEY }, body: JSON.stringify(p) });
    const j = await r.json().catch(() => ({}));
    if (j.next_action && /transfer|silence|hold|paused/.test(j.next_action)) continue;
    const reply = (typeof j.reply === "string" ? j.reply : j.reply?.text || "").toLowerCase();
    const tok = model.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    // OK = não negou E (citou o modelo do anúncio OU apresentou estoque REAL). A 2ª via cobre o lead
    // que AMPLIOU pro tipo genérico (ex.: clicou no Tracker mas disse "procuro um suv"): apresentar a
    // CATEGORIA com preços reais é o comportamento CORRETO (v134), não precisa liderar com o modelo.
    const presentsRealStock = /r\$\s?\d/.test(reply) || /\b(op[cç][aã]o|op[cç][oõ]es|temos\s+(alguns|algumas|v[aá]rios|v[aá]rias)|a partir de)\b/.test(reply);
    const ok = Boolean(reply) && !/n[aã]o temos/i.test(reply) && (tok.some(w => reply.includes(w)) || presentsRealStock);
    out.push({ pass: ok, label: `anúncio "${model}" identificado | reply: ${reply.slice(0, 70)}` });
  }
  return out;
}

// ── RUNNER ──────────────────────────────────────────────────────────────────
(async () => {
  let pass = 0, fail = 0; const fails = [];
  const report = (g, n, checks) => {
    const bad = checks.filter(c => !c.pass);
    if (bad.length === 0) { pass++; console.log(`  ✅ [${g}] ${n}`); }
    else { fail++; fails.push(`[${g}] ${n}`); console.log(`  ❌ [${g}] ${n}`); for (const b of bad) console.log(`       - ${b.label}`); }
  };
  let build = null;
  console.log("\n=== SUÍTE DE REGRESSÃO Pedro v2 ===\n");

  // stateless
  for (const c of [...health, ...stateless]) {
    if (onlyGroup && c.g !== onlyGroup) continue;
    try { const r = await dryRun({ text: c.text, externalAdReply: c.ad }); build = build || r.build; report(c.g, c.n, c.e(r)); }
    catch (e) { fail++; fails.push(`[${c.g}] ${c.n}`); console.log(`  ❌ [${c.g}] ${c.n} ERRO: ${e?.message || e}`); }
  }
  // stateful
  for (const c of stateful) {
    if (onlyGroup && c.g !== onlyGroup) continue;
    try { const { r, checks } = await c.run(); build = build || r?.build; report(c.g, c.n, checks); }
    catch (e) { fail++; fails.push(`[${c.g}] ${c.n}`); console.log(`  ❌ [${c.g}] ${c.n} ERRO: ${e?.message || e}`); }
  }
  // replay ctwa
  if (!onlyGroup || onlyGroup === "ctwa") {
    try { const rs = await replayCtwa(12); for (const x of rs) report("ctwa", x.label.split("|")[0].trim(), [x]); }
    catch (e) { console.log(`  ⚠️ ctwa replay erro: ${e?.message || e}`); }
  }

  console.log(`\n=== build: ${build} | ${pass} OK | ${fail} FALHARAM ===`);
  if (fail) { console.log("FALHAS:\n  " + fails.join("\n  ")); process.exit(1); }
  process.exit(0);
})();
