// ============================================================================
// eval/assertions.ts — motor de ASSERÇÕES DETERMINÍSTICAS (invariantes críticas).
// O eval usa DETECTORES PRÓPRIOS (regex sobre a fala do lead) — independentes do
// engine — para julgar adversarialmente. Cada `critical` reprova a suíte.
//
// Correções da auditoria Codex:
//  - Grounding usa QueryResults DO TURNO ATUAL (+ lista renderizada anterior em foco);
//    NÃO existe mais permissão global acumulada (allReturnedKeys removido).
//  - RC1 answer-binding: objetivo pendente + resposta plausível do lead + a MESMA
//    pergunta de novo = CRÍTICO (mesmo que o slot ainda não esteja known) — via ESTADO.
//  - Outbox exposto (status/receiptLevel) para provar que nada foi despachado.
// ============================================================================
import type { TurnCapture, EvalMode } from "./real-harness.ts";
import { parseOrdinal as parseOrdinalProd } from "../src/engine/ordinal.ts";

export type Severity = "critical" | "warn" | "info";
export type Violation = { readonly code: string; readonly severity: Severity; readonly turnIndex: number; readonly detail: string };
export type AssertionReport = { readonly violations: Violation[]; readonly criticalCount: number; readonly handlerBypassTurns: number[]; readonly outboxAudit: { dispatchedExternally: boolean; deliveredMedia: number; maxReceipt: string } };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const isPhotoNegation = (t: string) => /\bnao\s+quero\s+(mais\s+)?(ver\s+)?fotos?\b|\bsem\s+fotos?\b|\bchega\s+de\s+foto/.test(norm(t));
const isPhotoRequest = (t: string) => !isPhotoNegation(t) && /\bfotos?\b|\bimagens?\b|\bmanda\b.*\bfoto|\bfoto\b/.test(norm(t));
const isMoreOptions = (t: string) => /\bmais\s+op[cç]|\bmais\s+algum|\boutras\s+op|\bmais\s+carr/.test(norm(t));
const isDirectionChange = (t: string) => /\bna\s+verdade\b|\bagora\s+quero\b|\bprefiro\b|\bmelhor\b.*\bquero/.test(norm(t));
const HANDLER_REASONS = /^(explicit_|photo_|popular_|continuity_|vehicle_photos|category_|stock_list|brain_ad|economy|ranking)/;
const AGENT_INTRO = /\bsou o aloan\b|\bconsultor aqui\b|\bconsultor da\b/;
const TECH_MARKER = /desculpe a lentid|terminal-safe|model_decision|model_response|\berro interno\b|timeout|unhandled|exception|stack/i;

// Regex de RE-PERGUNTA por slot (detecta o agente pedindo o MESMO dado de novo).
const REASK_BY_SLOT: Record<string, RegExp> = {
  nome: /\bqual\s+.*\bseu\s+nome\b|\bcomo\s+.*\bse\s+chama\b|\bme\s+diz\s+.*\bnome\b|\bseu\s+nome\s*\?/,
  tipoVeiculo: /\bque\s+tipo\s+de\s+(carro|ve[ií]culo)|\bqual\s+(modelo|tipo)\b.*\b(procur|interess|busca|quer|pens)/,
  interesse: /\bqual\s+(modelo|carro|ve[ií]culo)\b.*\b(procur|interess|busca|quer)|\bo\s+que\s+.*\bprocurando\b/,
  faixaPreco: /\bqual\s+.*\b(faixa|valor|or[cç]amento|investir|gastar)\b/,
  formaPagamento: /\b(à\s+vista|a\s+vista|financ|cons[oó]rcio)\b.*\?|\bcomo\s+.*\bpagar\b|\bforma\s+de\s+pagamento\b/,
  possuiTroca: /\btem\s+(algum\s+)?(carro|ve[ií]culo)\s+.*\btroca\b|\bcarro\s+na\s+troca\b/,
};

function parseType(t: string): string | null {
  const n = norm(t);
  if (/\bsuvs?\b/.test(n)) return "suv";
  if (/\bpicapes?\b|\bpickups?\b/.test(n)) return "pickup";
  if (/\bsedans?\b/.test(n)) return "sedan";
  if (/\bhatch/.test(n)) return "hatch";
  return null;
}
function parseBudget(t: string): number | null {
  const n = norm(t);
  const mil = /\b(\d{1,3})\s*mil\b/.exec(n);
  if (mil) return Number(mil[1]) * 1000;
  const k = /\b(\d{1,3})\s*k\b/.exec(n);
  if (k) return Number(k[1]) * 1000;
  return null;
}
// P1-4 (Codex): o avaliador NÃO tem parser paralelo — delega ao parseOrdinal de PRODUÇÃO (src/engine/ordinal.ts).
function parseOrdinal(t: string): number | null {
  return parseOrdinalProd(t)?.value ?? null;
}

const MODEL_WORDS = /\b(onix|hb20|renegade|argo|kwid|mobi|creta|hrv|hr-v|corolla|civic|gol|polo|t-cross|tcross|nivus|compass|tracker|kicks|duster|toro|hilux|s10|ranger|strada|saveiro|montana|pulse|fastback)\b/;
const mentionsModel = (t: string) => MODEL_WORDS.test(norm(t));

// isNameAnswer: parece um NOME próprio (frase de apresentação, ou 1-3 tokens só-letras sem termo de
// carro/comando/negação). "Douglas" ✓ · "Na verdade prefiro hatch" ✗ · "Manda de novo" ✗ · "Bonito ele" ✗.
function isNameAnswer(lead: string): boolean {
  const n = norm(lead);
  if (/\b(meu nome (e|é)|me chamo|pode me chamar|sou o|sou a)\b/.test(n)) return true;
  const tokens = lead.trim().split(/\s+/);
  if (tokens.length < 1 || tokens.length > 3) return false;
  if (parseType(lead) != null || parseBudget(lead) != null || mentionsModel(lead)) return false;
  if (/\b(quero|manda|foto|financi|troca|sim|nao|opcao|opcoes|vista|mais|gostei|bonito|automatico|de novo|visitar|entrada|cpf|valor|barato)\b/.test(n)) return false;
  return /^[a-z\s]+$/.test(n);
}

// leadAnswersObjective: a fala do lead é COMPATÍVEL com o objetivo pendente ESPECÍFICO (expectedAnswerKind
// do slot)? Evita falso-positivo de RC1 quando o lead respondeu OUTRA coisa (mudou de assunto).
function leadAnswersObjective(lead: string, slot: string): boolean {
  const n = norm(lead);
  switch (slot) {
    case "nome": return isNameAnswer(lead);
    case "possuiTroca": return /\btroca\b|\bnao tenho\b|\btenho (um|outro)\b/.test(n);
    case "interesse":
    case "tipoVeiculo": return parseType(lead) != null || mentionsModel(lead);
    case "faixaPreco": return parseBudget(lead) != null;
    case "formaPagamento": return /\bfinanci|a vista|à vista|consorcio|consórcio\b/.test(n);
    default: return false; // sem sinal claro de compatibilidade -> não afirmamos que respondeu
  }
}

// agentAsksSlot: o agente PERGUNTA (forma interrogativa) o dado do slot? Testa só sentenças que contêm
// "?" -> não casa acknowledgment ("você não tem carro para troca." é afirmação, não pergunta).
function agentAsksSlot(agentText: string, slot: string): boolean {
  const rx = REASK_BY_SLOT[slot];
  if (!rx) return false;
  return agentText.split(/(?<=[?!.])\s+|\n+/).some((s) => s.includes("?") && rx.test(norm(s)));
}

export function runAssertions(turns: readonly TurnCapture[], mode: EvalMode = "pilot-realistic"): AssertionReport {
  const V: Violation[] = [];
  const add = (severity: Severity, code: string, turnIndex: number, detail: string) => V.push({ code, severity, turnIndex, detail });

  const knownSlots = new Set<string>();
  const declinedSlots = new Set<string>();
  let priorRenderedKeys = new Set<string>();          // lista renderizada do turno ANTERIOR (foco/oferta válida)
  let lastRendered: { ordinal: number; vehicleKey: string }[] = [];
  let lastType: string | null = null;
  let lastBudget: number | null = null;
  let funnelReady = false;
  let prevObjectiveSlot: string | null = null;        // objetivo pendente ao ENTRAR neste turno
  let prevSelectedFocusKey: string | null = null;     // selectedVehicleFocus do turno anterior (F-7)
  let lastAskedSlot: string | null = null;            // slot perguntado no turno anterior (fixação)
  let askStreak = 0;
  let everOffered = false;                             // alguma oferta aterrada já ocorreu no fluxo?
  const handlerBypassTurns: number[] = [];
  let dispatchedExternally = false, deliveredMedia = 0;
  const receiptRank: Record<string, number> = { "": 0, accepted: 1, delivered: 2 };
  let maxReceipt = "";

  for (const t of turns) {
    const lead = t.leadText;
    const reqType = parseType(lead);
    const reqBudget = parseBudget(lead);
    const ord = parseOrdinal(lead);
    const commercial = !!reqType || !!reqBudget || isMoreOptions(lead) || isPhotoRequest(lead) || ord != null || /\bonix|hb20|renegade|carro|veiculo|opcoes/.test(norm(lead));

    // Chaves aterradas ESTE turno: tools do turno + lista renderizada anterior (ainda em foco).
    const currentTurnKeys = new Set<string>();
    for (const tool of t.tools) for (const k of tool.keys ?? []) currentTurnKeys.add(k);
    const groundedKeys = new Set<string>([...currentTurnKeys, ...priorRenderedKeys]);
    if (t.renderedOffer.length > 0 || t.tools.some((x) => x.tool === "stock_search" && (x.itemCount ?? 0) > 0)) everOffered = true;

    // [14] Prompt do portal presente (integralmente) em toda chamada LLM do turno.
    if (!t.promptExactInTurn) add("critical", "PROMPT_MISSING_IN_LLM_CALL", t.turnIndex, "alguma chamada LLM do turno nao continha o prompt do portal na integra");

    // [11] Nenhum texto tecnico/terminal-safe ao lead.
    if (t.terminalSafe === true) add("critical", "TERMINAL_SAFE_TO_LEAD", t.turnIndex, `terminalSafe=true reason=${t.reasonCode}`);
    if (TECH_MARKER.test(t.agentText)) add("critical", "TECH_TEXT_TO_LEAD", t.turnIndex, `texto tecnico vazou: ${t.agentText.slice(0, 60)}`);

    // [9] Nao reapresentar o agente apos o 1o turno.
    if (t.turnIndex > 1 && AGENT_INTRO.test(norm(t.agentText))) add("critical", "RE_INTRODUCED_AGENT", t.turnIndex, "reapresentou o agente apos o turno 1");

    // [13] Exposição do outbox: provar que NADA foi despachado externamente.
    for (const o of t.outbox) {
      if (o.status === "processing") { dispatchedExternally = true; add("critical", "OUTBOX_PROCESSING_LEAK", t.turnIndex, `outbox ${o.kind} ficou em 'processing' (claim sem commit)`); }
      if ((o.receiptLevel ?? "") && receiptRank[o.receiptLevel ?? ""] > receiptRank[maxReceipt]) maxReceipt = o.receiptLevel!;
      if (o.kind === "send_media" && o.receiptLevel === "delivered") {
        deliveredMedia += 1;
        if (mode === "pilot-realistic") add("warn", "MEDIA_DELIVERED_IN_BASELINE", t.turnIndex, "send_media com receiptLevel=delivered no baseline pilot-realistic (deveria ficar em accepted)");
      }
    }

    // [1] Grounding POR TURNO: veiculo apresentado deve estar nos QueryResults deste turno OU na
    //     lista renderizada anterior (foco). Sem permissão global acumulada.
    for (const it of t.renderedOffer) {
      if (!groundedKeys.has(it.vehicleKey)) add("critical", "VEHICLE_OUTSIDE_QUERYRESULTS", t.turnIndex, `veiculo ${it.vehicleKey} apresentado sem QueryResult no turno nem foco valido`);
    }

    // [2] Nenhum veiculo fora do teto solicitado (best-effort via tools desta rodada de busca).
    if (reqBudget != null) {
      for (const tool of t.tools) if (tool.tool === "stock_search" && typeof (tool.input as Record<string, unknown>).precoMax !== "number") {
        add("warn", "SEARCH_WITHOUT_CEILING", t.turnIndex, `lead pediu teto ${reqBudget} mas stock_search sem precoMax: ${JSON.stringify(tool.input)}`);
      }
    }

    // [3] Preferencia atual vence memoria antiga (mudanca de direcao).
    if (isDirectionChange(lead) && reqType) {
      const searchedNew = t.tools.some((x) => x.tool === "stock_search" && JSON.stringify(x.input).toLowerCase().includes(reqType));
      if (t.tools.some((x) => x.tool === "stock_search") && !searchedNew) {
        add("critical", "OLD_MEMORY_BEAT_CURRENT", t.turnIndex, `mudou p/ ${reqType} mas a busca nao refletiu: ${JSON.stringify(t.tools.map((x) => x.input))}`);
      }
    }

    // [4] "Mais opcoes" preserva filtros + exclui ja mostrados.
    if (isMoreOptions(lead)) {
      const search = t.tools.find((x) => x.tool === "stock_search");
      if (search) {
        const inp = search.input as Record<string, unknown>;
        if (lastType && inp.tipo !== lastType && !(inp.modelo && String(inp.modelo).toLowerCase().includes(lastType))) {
          add("critical", "MORE_OPTIONS_LOST_CATEGORY", t.turnIndex, `'mais opcoes' perdeu a categoria ${lastType}: ${JSON.stringify(inp)}`);
        }
        if (lastBudget != null && inp.precoMax !== lastBudget) add("warn", "MORE_OPTIONS_LOST_BUDGET", t.turnIndex, `'mais opcoes' perdeu o teto ${lastBudget}: ${JSON.stringify(inp)}`);
        if (!Array.isArray(inp.excludeKeys) || inp.excludeKeys.length === 0) add("warn", "MORE_OPTIONS_NO_EXCLUDE", t.turnIndex, `'mais opcoes' nao excluiu itens ja mostrados: ${JSON.stringify(inp)}`);
      }
    }

    // [5] Ordinal -> mesmo vehicleKey da lista renderizada anterior.
    if (ord != null && lastRendered.length > 0) {
      const target = lastRendered.find((r) => r.ordinal === ord)?.vehicleKey;
      const resolved = t.tools.find((x) => x.tool === "vehicle_photos_resolve" || x.tool === "vehicle_details")?.keys?.[0]
        ?? t.outbox.find((o) => o.vehicleKey)?.vehicleKey;
      if (target && resolved && target !== resolved) add("critical", "ORDINAL_WRONG_VEHICLE", t.turnIndex, `ordinal ${ord} deveria ser ${target} mas resolveu ${resolved}`);
    }

    // [6] Pedido de foto -> send_media do veiculo correto. [7] Negacao -> sem midia.
    if (isPhotoRequest(lead) && !t.outbox.some((o) => o.kind === "send_media")) add("warn", "PHOTO_REQUEST_NO_MEDIA", t.turnIndex, `pediu foto mas nao houve send_media (reason=${t.reasonCode})`);
    if (isPhotoNegation(lead) && t.outbox.some((o) => o.kind === "send_media")) add("critical", "PHOTO_NEGATION_SENT_MEDIA", t.turnIndex, "negou foto mas gerou send_media");

    // [8] Nao reperguntar slot ja known/declined (interrogativo real, nao acknowledgment).
    const q = norm(t.agentText);
    if ((knownSlots.has("nome") || declinedSlots.has("nome")) && agentAsksSlot(t.agentText, "nome")) add("critical", "REASK_KNOWN_SLOT", t.turnIndex, "reperguntou o nome (ja known/declined)");
    if ((knownSlots.has("tipoVeiculo") || knownSlots.has("interesse")) && /\bqual\s+modelo\s+ou\s+tipo\b/.test(q)) add("critical", "REASK_KNOWN_SLOT", t.turnIndex, "reperguntou modelo/tipo (ja known)");
    if (knownSlots.has("possuiTroca") && agentAsksSlot(t.agentText, "possuiTroca")) add("warn", "REASK_KNOWN_SLOT", t.turnIndex, "reperguntou troca (ja known)");

    // [RC1] Answer-binding: objetivo pendente + resposta COMPATÍVEL com ELE + o agente PERGUNTA (interrogativo)
    //       o mesmo dado de novo -> CRÍTICO (mesmo sem o slot known). Compatibilidade + interrogativo evitam o
    //       falso-positivo de acknowledgment / mudança de assunto.
    if (prevObjectiveSlot && leadAnswersObjective(lead, prevObjectiveSlot) && agentAsksSlot(t.agentText, prevObjectiveSlot)) {
      add("critical", "REASK_AFTER_ANSWER", t.turnIndex, `objetivo '${prevObjectiveSlot}' pendente, lead respondeu compatível ("${lead.slice(0, 24)}") e o agente repergunta o mesmo dado`);
    }

    // [RC4/condução] Fixação: o agente PERGUNTA o MESMO slot em >=3 turnos consecutivos (condutor travado,
    //       ignora a fala do lead) -> CRÍTICO. É o bug real de repetição (ex.: 'possuiTroca' 6x em s1).
    let askedThisTurn: string | null = null;
    for (const slot of Object.keys(REASK_BY_SLOT)) { if (agentAsksSlot(t.agentText, slot)) { askedThisTurn = slot; break; } }
    if (askedThisTurn && askedThisTurn === lastAskedSlot) askStreak += 1; else askStreak = askedThisTurn ? 1 : 0;
    lastAskedSlot = askedThisTurn;
    if (askStreak >= 3) add("critical", "SLOT_FIXATION", t.turnIndex, `agente pergunta '${askedThisTurn}' pela ${askStreak}a vez consecutiva (condutor travado, ignora a fala do lead)`);

    // [RC8] Alucinação: afirma atributo de um veículo "que você gostou/viu" sem NENHUMA oferta aterrada no fluxo.
    if (!everOffered && /\b(e|esta)\s+(automatico|manual|flex|completo|novo|seminovo|zero|top)\b/.test(q) && /\b(gostou|viu|escolheu|curtiu|que voce)\b/.test(q)) {
      add("critical", "HALLUCINATED_VEHICLE", t.turnIndex, `afirma detalhe de veículo sem oferta aterrada: "${t.agentText.slice(0, 50)}"`);
    }

    // [12] Handoff antes do funil minimo.
    const didHandoff = t.action === "handoff" || t.outbox.some((o) => o.kind === "handoff" || o.kind === "notify_seller");
    if (didHandoff && !funnelReady) add("critical", "EARLY_HANDOFF", t.turnIndex, `handoff antes do funil minimo (nome/contato/interesse); slots=${[...knownSlots].join(",")}`);

    // [15] Registrar turnos comerciais que ainda desviam do LLM por handler (compose bypass).
    if (commercial && t.reasonCode && HANDLER_REASONS.test(t.reasonCode)) handlerBypassTurns.push(t.turnIndex);

    // ── Invariantes de ESTADO/REFERÊNCIA (1A.5) ──
    // TYPE_SENT_AS_MODEL: nenhum stock_search do turno pode ter TIPO em `modelo` (deve ir a zero pós-1A.4).
    for (const tool of t.tools) {
      if (tool.tool !== "stock_search") continue;
      const modelo = String((tool.input as Record<string, unknown>).modelo ?? "").trim();
      if (modelo && /^(suvs?|sedans?|hatch(?:back)?s?|picapes?|pickups?)$/i.test(modelo)) {
        add("critical", "TYPE_SENT_AS_MODEL", t.turnIndex, `stock_search com tipo em modelo: ${JSON.stringify(tool.input)}`);
      }
    }
    // MONEY_ROLE_CORRUPTION: faixaPreco.max minúsculo (< 10k) = parcela/entrada vazou p/ o orçamento.
    for (const d of t.slotsDelta) {
      if (d.slot !== "faixaPreco") continue;
      const mx = /"max":\s*(\d+)/.exec(d.to);
      if (mx && Number(mx[1]) > 0 && Number(mx[1]) < 10000) {
        add("critical", "MONEY_ROLE_CORRUPTION", t.turnIndex, `faixaPreco.max=${mx[1]} implausível (parcela/entrada vazou): "${lead.slice(0, 30)}"`);
      }
    }
    // INCOMPATIBLE_OBJECTIVE_BINDING: nome (ou slot) setado com valor claramente de comando/comercial.
    for (const d of t.slotsDelta) {
      if (d.slot === "nome" && /known/.test(d.to) && /(opco|opca|mais|mostra|manda|envia|foto|financ|troca|parcel|suv|sedan|hatch|picape)/i.test(d.to)) {
        add("critical", "INCOMPATIBLE_OBJECTIVE_BINDING", t.turnIndex, `nome setado com valor incompatível: ${d.to.slice(0, 40)}`);
      }
    }
    // PRONOUN_RESOLVED_WRONG_VEHICLE / FOCUS_VEHICLE_CHANGED: pronome (ele/dele/desse) que re-busca por texto
    // ou resolve p/ veículo fora da última lista renderizada (deveria usar o foco/vehicleKey exato).
    if (/\b(ele|dele|nele|desse|deste|nesse|neste|esse)\b/.test(norm(lead)) && !parseType(lead) && parseOrdinal(lead) == null) {
      if (t.tools.some((x) => x.tool === "stock_search")) {
        add("warn", "PRONOUN_RESOLVED_WRONG_VEHICLE", t.turnIndex, `pronome resolvido via re-busca textual: ${JSON.stringify(t.tools.filter((x) => x.tool === "stock_search").map((x) => x.input))}`);
      }
      const resolved = t.tools.find((x) => x.tool === "vehicle_details" || x.tool === "vehicle_photos_resolve")?.keys?.[0];
      if (resolved && lastRendered.length > 0 && !lastRendered.some((r) => r.vehicleKey === resolved)) {
        add("warn", "FOCUS_VEHICLE_CHANGED", t.turnIndex, `pronome resolveu p/ ${resolved} fora da última lista renderizada`);
      }
    }
    // DETAIL_FROM_WRONG_VEHICLE (item 7): turno resolve detalhe/foto de um vehicleKey != selectedVehicleFocus.
    if (t.selectedFocusKey) {
      const resolvedDetail = t.tools.find((x) => x.tool === "vehicle_details" || x.tool === "vehicle_photos_resolve")?.keys?.[0]
        ?? t.outbox.find((o) => o.vehicleKey)?.vehicleKey;
      if (resolvedDetail && resolvedDetail !== t.selectedFocusKey) {
        add("critical", "DETAIL_FROM_WRONG_VEHICLE", t.turnIndex, `detalhe/foto resolveu ${resolvedDetail} != veículo selecionado ${t.selectedFocusKey}`);
      }
    }
    // OBJECTIVE_STARVED (item 7): objetivo deferido até/além do limite sem ser respondido (funil faminto).
    if ((t.objectiveDeferrals ?? 0) >= 2) {
      add("warn", "OBJECTIVE_STARVED", t.turnIndex, `objetivo '${t.activeObjective?.slot}' deferido ${t.objectiveDeferrals}x (starvation) — condutor deve avançar p/ outro slot`);
    }

    // ── Invariantes F-7 (foco/ordinal/atributo/objetivo) ──
    // SELECTED_FOCUS_BYPASSED_BY_INTERPRETATION: pronome ("dele/desse") resolveu != selectedVehicleFocus.
    if (t.selectedFocusKey && /\b(dele|desse|deste|nele|nesse|neste)\b/.test(norm(lead))) {
      const resolvedRef = t.tools.find((x) => x.tool === "vehicle_details" || x.tool === "vehicle_photos_resolve")?.keys?.[0] ?? t.outbox.find((o) => o.vehicleKey)?.vehicleKey;
      if (resolvedRef && resolvedRef !== t.selectedFocusKey) add("critical", "SELECTED_FOCUS_BYPASSED_BY_INTERPRETATION", t.turnIndex, `pronome resolveu ${resolvedRef} != selecionado ${t.selectedFocusKey}`);
    }
    // QUANTITY_BECAME_ORDINAL: "N fotos/imagens" (quantidade) virou seleção da posição N.
    const qty = /\b([2-9])\s+(fotos?|imagens?)/.exec(norm(lead));
    if (qty && t.selectedFocusKey && t.selectedFocusKey !== prevSelectedFocusKey && lastRendered[Number(qty[1]) - 1]?.vehicleKey === t.selectedFocusKey) {
      add("critical", "QUANTITY_BECAME_ORDINAL", t.turnIndex, `"${qty[0]}" (quantidade) virou seleção da posição ${qty[1]}`);
    }
    // STALE_SELECTED_FOCUS: nova direção/modelo explícito mas o foco NÃO foi limpo/atualizado (segue o antigo).
    if ((isDirectionChange(lead) && reqType) && t.selectedFocusKey && t.selectedFocusKey === prevSelectedFocusKey) {
      add("warn", "STALE_SELECTED_FOCUS", t.turnIndex, `nova intenção explícita mas selectedFocus obsoleto ${t.selectedFocusKey}`);
    }
    // VEHICLE_ATTRIBUTE_VALUE_MISMATCH: turno de detalhe afirma atributo e cai em terminal_safe (policy negou o valor).
    if (t.terminalSafe && /\b(dele|desse|nele)\b/.test(norm(lead)) && /\b(automatic|manual|flex|cambio|cor|km)\b/.test(norm(lead))) {
      add("warn", "VEHICLE_ATTRIBUTE_VALUE_MISMATCH", t.turnIndex, `pergunta de atributo caiu em terminal_safe (possível mismatch de valor negado pela policy)`);
    }
    // OBJECTIVE_REPLACED_WITHOUT_SUPERSEDE: o slot do objetivo mudou com o antigo ainda missing (sem supersede).
    if (prevObjectiveSlot && t.activeObjective?.slot && t.activeObjective.slot !== prevObjectiveSlot && !knownSlots.has(prevObjectiveSlot) && !declinedSlots.has(prevObjectiveSlot)) {
      add("warn", "OBJECTIVE_REPLACED_WITHOUT_SUPERSEDE", t.turnIndex, `objetivo mudou de '${prevObjectiveSlot}' p/ '${t.activeObjective.slot}' com o antigo ainda missing`);
    }

    // ── Atualiza estado do avaliador ──
    for (const d of t.slotsDelta) {
      if (/known/.test(d.to)) knownSlots.add(d.slot);
      if (/declined/.test(d.to)) declinedSlots.add(d.slot);
    }
    if (knownSlots.has("nome") && (knownSlots.has("interesse") || knownSlots.has("tipoVeiculo"))) funnelReady = true;
    if (t.renderedOffer.length > 0) { lastRendered = t.renderedOffer.slice(); priorRenderedKeys = new Set(t.renderedOffer.map((r) => r.vehicleKey)); }
    if (reqType) lastType = reqType;
    if (reqBudget != null) lastBudget = reqBudget;
    prevObjectiveSlot = t.activeObjective?.slot ?? null; // pendente para o PRÓXIMO turno
    prevSelectedFocusKey = t.selectedFocusKey ?? null;
  }

  return {
    violations: V,
    criticalCount: V.filter((v) => v.severity === "critical").length,
    handlerBypassTurns,
    outboxAudit: { dispatchedExternally, deliveredMedia, maxReceipt: maxReceipt || "none" },
  };
}
