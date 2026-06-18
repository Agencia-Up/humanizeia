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
    const ok = tok.some(w => reply.includes(w)) && reply && !/n[aã]o temos/i.test(reply);
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
  for (const c of stateless) {
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
