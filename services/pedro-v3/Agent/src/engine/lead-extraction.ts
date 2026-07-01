// ============================================================================
// lead-extraction.ts - F2.7.7. Camada DETERMINISTICA + SEGURA de captura de slots
// a partir da fala do lead. O LLM NAO emite mutacoes (segue facts:[]); este modulo
// PURO transforma o bloco do lead em DecisionMutation[] VALIDAS, e o engine as injeta
// (mesma fonte unica do append_lead_turn). So emite o que o reducer aceita -> nunca
// derruba o turno.
//
// Captura:
//  - NOME: padrao explicito ("meu nome e X") OU objetivo de nome pendente + token limpo
//    (alfabetico, fora da stoplist, nao-veiculo); normaliza "dOUGLAS" -> "Douglas".
//  - INTERESSE: somente marcas/modelos REAIS do catalogo citados no bloco atual. O slot passa
//    a representar a intencao comercial atual, nao um historico infinito; ordinais/quantidades
//    como "3" nunca entram.
//  - resolve_objective: se o objetivo pendente pede o nome e capturamos, marca satisfied.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, TurnInterpretation } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import { normalizeText, normalizedTermInText } from "./catalog-utils.ts";

const NON_NAME = new Set([
  "sim", "nao", "claro", "certo", "ok", "okay", "isso", "beleza", "blz", "opa", "oi", "ola", "eai", "e", "ou", "eh",
  "quero", "queria", "quis", "tem", "temos", "vi", "gostei", "gosto", "gostaria", "conheco", "conhece", "sei", "acho",
  "vou", "vamos", "posso", "pode", "de", "da", "do", "das", "dos", "um", "uma", "uns", "umas", "talvez", "agora", "aqui",
  "ali", "esse", "essa", "esses", "essas", "ainda", "mas", "porem", "entao", "ver", "vendo", "procuro", "procurando",
  "busco", "buscando", "preciso", "manda", "mandar", "envia", "enviar", "foto", "fotos", "preco", "valor", "quanto",
  "qual", "quais", "bom", "boa", "dia", "tarde", "noite", "obrigado", "obrigada", "valeu", "carro", "carros",
  "modelo", "modelos", "veiculo", "veiculos", "com", "sem", "por", "pra", "para", "que", "comprar", "financiar", "ai",
]);

const NAME_TOKEN = /^\p{L}[\p{L}'’-]{1,}$/u;

function titleCase(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean)
    .map((w) => w[0].toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR"))
    .join(" ");
}

function isVehicleTerm(token: string, claimExtractor: ClaimExtractor): boolean {
  return claimExtractor.extractClaims(token).some((c) => c.kind === "model" || c.kind === "brand_model" || c.kind === "brand");
}

function isNameToken(token: string, claimExtractor: ClaimExtractor): boolean {
  if (!NAME_TOKEN.test(token)) return false;
  const norm = normalizeText(token);
  if (!norm || norm.length < 2 || NON_NAME.has(norm)) return false;
  if (isVehicleTerm(token, claimExtractor)) return false;
  return true;
}

const NAME_PATTERN = /(?:meu nome (?:é|e|eh)|me chamo|pode me chamar de|sou o|sou a|aqui (?:é|e|eh) o|quem fala (?:é|e|eh))\s+(\p{L}[\p{L}'’ -]{1,40})/iu;
const AGENT_ASKED_NAME = /seu nome|qual.{0,15}nome|como.{0,20}cham/iu;

function lastAgentText(state: ConversationState): string {
  const turns = state.recentTurns ?? [];
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === "agent") return turns[i].text;
  return "";
}

function extractName(
  leadMessage: string,
  state: ConversationState,
  claimExtractor: ClaimExtractor,
): { value: string; confidence: number } | null {
  if (state.slots.nome.status === "known") return null;

  const m = NAME_PATTERN.exec(leadMessage);
  if (m) {
    const valid = m[1].trim().split(/\s+/).slice(0, 3).filter((w) => isNameToken(w, claimExtractor));
    if (valid.length > 0) return { value: titleCase(valid.join(" ")), confidence: 0.95 };
  }

  const objAskingName = state.currentObjective?.slot === "nome" && state.currentObjective.status === "pending";
  const agentAskedName = AGENT_ASKED_NAME.test(lastAgentText(state));
  if (objAskingName || agentAskedName) {
    for (const line of leadMessage.split(/\n+/)) {
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || tokens.length > 3) continue;
      if (tokens.every((t) => isNameToken(t, claimExtractor))) {
        return { value: titleCase(tokens.join(" ")), confidence: 0.85 };
      }
    }
  }
  return null;
}

// Marcas/modelos citados no bloco atual, exclusivamente via catalogo vivo.
export function detectInterestModels(
  leadMessage: string,
  _interpretation: TurnInterpretation | null | undefined,
  claimExtractor: ClaimExtractor,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined): void => {
    const n = normalizeText(raw ?? "");
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  };
  for (const c of claimExtractor.extractClaims(leadMessage)) {
    if (c.kind === "model" || c.kind === "brand_model" || c.kind === "brand") add(c.text);
  }

  // A LLM pode identificar um modelo que nao esta no catalogo/estoque atual (ex.: "argo" quando
  // nao ha Argo no estoque). Aceitamos isso SOMENTE se o termo aparece literalmente na fala do lead
  // e contem letras. Assim nao volta o bug "jeep -> argo" nem "foto do 3 -> C3".
  const entities = _interpretation?.extractedEntities;
  const candidates = [entities?.model, ...(entities?.models ?? [])];
  for (const candidate of candidates) {
    const n = normalizeText(candidate ?? "");
    if (!/[a-z]/.test(n)) continue;
    if (!normalizedTermInText(leadMessage, n)) continue;
    add(n);
  }
  return out;
}

const NAME_CONFIDENCE_MIN = 0.7;

function inferredQuestionSlot(state: ConversationState): keyof ConversationState["slots"] | null {
  if (state.currentObjective?.status === "pending" && state.currentObjective.slot) return state.currentObjective.slot;
  const text = normalizeText(lastAgentText(state));
  if (/\bnome\b|\bcomo.*cham/.test(text)) return "nome";
  if (/\bcidade\b|\bde onde/.test(text)) return "cidade";
  if (/\bconhece.*loja\b/.test(text)) return "conheceLoja";
  if (/\bparcela\b|\bmensal/.test(text)) return "parcelaDesejada";
  if (/\bentrada\b/.test(text)) return "entrada";
  if (/\bmodelo.*ano\b|\bano.*quilometr|\bdados.*veiculo.*troca/.test(text)) return "veiculoTroca";
  if (/\btroca\b/.test(text)) return "possuiTroca";
  if (/\bdia\b|\bhorario\b/.test(text)) return "diaHorario";
  if (/\bvisita\b|\bagendar\b/.test(text)) return "interesseVisita";
  if (/\bpagamento\b|\ba vista\b|\bfinanc|\bconsorcio\b/.test(text)) return "formaPagamento";
  if (/\bfaixa.*valor\b|\bquanto.*invest/.test(text)) return "faixaPreco";
  if (/\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b/.test(text)) return "tipoVeiculo";
  if (/\bmodelo\b|\bcarro.*procura\b/.test(text)) return "interesse";
  return null;
}

function parseAmount(raw: string): number | null {
  const normalized = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const matches = [...normalized.matchAll(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(mil|k)?\b/g)];
  const values = matches.map((match) => {
    let amount = Number(match[1].replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    if (match[2]) amount *= 1000;
    if (!match[2] && amount >= 1900 && amount <= 2100) return null;
    return { amount: Math.round(amount), multiplied: !!match[2] };
  }).filter((item): item is { amount: number; multiplied: boolean } => item != null && item.amount >= 0);
  return values[0]?.amount ?? null;
}

function amountAfterCue(raw: string, cue: RegExp): number | null {
  const match = cue.exec(raw);
  if (!match) return null;
  return parseAmount(raw.slice(match.index, match.index + 80));
}

function parseBooleanAnswer(text: string): boolean | null {
  const norm = normalizeText(text).trim();
  if (/^(nao|nem|nunca)\b|\bsem\b/.test(norm)) return false;
  if (/^(sim|tenho|conheco|quero|gostaria|pode|vamos|claro|com certeza)\b/.test(norm)) return true;
  return null;
}

function parsePayment(text: string): "a_vista" | "financiamento" | "consorcio" | "troca" | null {
  const norm = normalizeText(text);
  if (/\ba vista\b|\bdinheiro\b|\bpix\b/.test(norm)) return "a_vista";
  if (/\bfinanc|\bparcel/.test(norm)) return "financiamento";
  if (/\bconsorcio\b/.test(norm)) return "consorcio";
  if (/\btroca\b/.test(norm)) return "troca";
  return null;
}

function parseVehicleType(text: string): "suv" | "sedan" | "hatch" | "pickup" | null {
  const norm = normalizeText(text);
  if (/\bsuvs?\b/.test(norm)) return "suv";
  if (/\bsedans?\b/.test(norm)) return "sedan";
  if (/\bhatch(?:back)?s?\b/.test(norm)) return "hatch";
  if (/\bpicapes?\b|\bpickups?\b/.test(norm)) return "pickup";
  return null;
}

function explicitCity(text: string): string | null {
  const match = /(?:moro em|sou de|falo de|estou em|cidade (?:e|é))\s+([\p{L}][\p{L}' -]{1,40}?)(?=\s+(?:e|mas|quero|procuro)\b|[,.!?\n]|$)/iu.exec(text);
  if (!match) return null;
  return titleCase(match[1].trim().split(/\s+/).slice(0, 4).join(" "));
}

function bareTextAnswer(text: string): string | null {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1 || lines[0].length > 60 || /[?]/.test(lines[0])) return null;
  return lines[0];
}

function isUncertainAnswer(text: string): boolean {
  const norm = normalizeText(text).trim();
  return /^(nao sei|ainda nao sei|talvez|qualquer|depois|vou ver|nao decidi|nao tenho certeza)\b/.test(norm);
}

function bareCityAnswer(text: string, claimExtractor: ClaimExtractor): string | null {
  const answer = bareTextAnswer(text);
  if (!answer || isUncertainAnswer(answer) || parseBooleanAnswer(answer) != null || /\d/.test(answer)) return null;
  if (claimExtractor.extractClaims(answer).length > 0) return null;
  const words = answer.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5 || !words.every((word) => /^[\p{L}'’-]+$/u.test(word))) return null;
  return answer;
}

function visitScheduleAnswer(text: string): string | null {
  const answer = bareTextAnswer(text);
  if (!answer || isUncertainAnswer(answer)) return null;
  const norm = normalizeText(answer);
  const hasDateOrPeriod = /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|manha|tarde|noite)\b|\bdia\s+\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}\b/.test(norm);
  const hasTime = /\b\d{1,2}(?::\d{2}|h(?:\d{2})?)\b/.test(norm);
  return hasDateOrPeriod || hasTime ? answer : null;
}

function tradeVehicle(text: string, claimExtractor: ClaimExtractor): { marca?: string; modelo?: string; ano?: number; km?: number; estado?: string } | null {
  const norm = normalizeText(text);
  const claims = claimExtractor.extractClaims(text);
  const model = claims.find((c) => c.kind === "model" || c.kind === "brand_model");
  const brand = claims.find((c) => c.kind === "brand" || c.kind === "brand_model");
  const yearMatch = /\b(?:ano\s*)?((?:19|20)\d{2})\b/.exec(norm);
  const kmMatch = /\b(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(mil|k)?\s*km\b/.exec(norm);
  const result: { marca?: string; modelo?: string; ano?: number; km?: number; estado?: string } = {};
  if (brand) result.marca = brand.text;
  if (model) result.modelo = model.text;
  if (yearMatch) result.ano = Number(yearMatch[1]);
  if (kmMatch) {
    let km = Number(kmMatch[1].replace(/[.,]/g, ""));
    if (kmMatch[2] && km < 1000) km *= 1000;
    result.km = km;
  }
  if (/\bbom estado\b|\bbem conservad/.test(norm)) result.estado = "bom estado";
  return Object.keys(result).length > 0 ? result : null;
}

export function extractLeadSlots(args: {
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly interpretation: TurnInterpretation | null | undefined;
  readonly claimExtractor: ClaimExtractor;
  readonly turnId: Id;
}): DecisionMutation[] {
  const { leadMessage, state, interpretation, claimExtractor, turnId } = args;
  const muts: DecisionMutation[] = [];
  const captured = new Set<keyof ConversationState["slots"]>();
  const expected = inferredQuestionSlot(state);
  const norm = normalizeText(leadMessage);

  const add = (mutation: DecisionMutation, slot?: keyof ConversationState["slots"]): void => {
    muts.push(mutation);
    if (slot) captured.add(slot);
  };

  const name = extractName(leadMessage, state, claimExtractor);
  if (name && name.confidence >= NAME_CONFIDENCE_MIN) {
    add({ op: "set_slot", slot: "nome", value: name.value, confidence: name.confidence, sourceTurnId: turnId }, "nome");
  }

  const models = detectInterestModels(leadMessage, interpretation, claimExtractor);
  if (models.length > 0) {
    const value = models.join(", ");
    const before = state.slots.interesse.status === "known" ? normalizeText(state.slots.interesse.value ?? "") : "";
    if (value && normalizeText(value) !== before) {
      add({ op: "set_slot", slot: "interesse", value, confidence: 0.9, sourceTurnId: turnId }, "interesse");
    }
  }

  const type = parseVehicleType(leadMessage);
  if (type) add({ op: "set_slot", slot: "tipoVeiculo", value: type, confidence: 0.95, sourceTurnId: turnId }, "tipoVeiculo");

  const budgetCue = /\bate\b|\bno maximo\b|\borcamento\b|\bfaixa.*valor\b|\bpretendo.*invest/.test(norm);
  if (expected === "faixaPreco" || budgetCue) {
    const amount = amountAfterCue(leadMessage, /até|ate|no máximo|no maximo|orçamento|orcamento|faixa|invest/iu) ?? parseAmount(leadMessage);
    if (amount != null) add({ op: "set_slot", slot: "faixaPreco", value: { max: amount }, confidence: budgetCue ? 0.95 : 0.82, sourceTurnId: turnId }, "faixaPreco");
  }

  const payment = parsePayment(leadMessage);
  if (payment && (expected === "formaPagamento" || /\ba vista\b|\bfinanc|\bparcel|\bconsorcio\b|\bpagamento\b/.test(norm))) {
    add({ op: "set_slot", slot: "formaPagamento", value: payment, confidence: 0.95, sourceTurnId: turnId }, "formaPagamento");
  }

  if (/\b(?:sem|nao tenho)\s+entrada\b/.test(norm)) {
    add({ op: "set_slot", slot: "entrada", value: 0, confidence: 0.98, sourceTurnId: turnId }, "entrada");
  } else if (expected === "entrada" || /\bentrada\b/.test(norm)) {
    const amount = amountAfterCue(leadMessage, /entrada/iu) ?? parseAmount(leadMessage);
    if (amount != null) add({ op: "set_slot", slot: "entrada", value: amount, confidence: 0.9, sourceTurnId: turnId }, "entrada");
  }

  if (expected === "parcelaDesejada" || /\bparcela\b|\bpor mes\b|\bmensal\b/.test(norm)) {
    const amount = amountAfterCue(leadMessage, /parcela|mensal/iu) ?? parseAmount(leadMessage);
    if (amount != null) add({ op: "set_slot", slot: "parcelaDesejada", value: amount, confidence: 0.9, sourceTurnId: turnId }, "parcelaDesejada");
  }

  const explicitNoTrade = /\b(?:nao tenho|sem).{0,40}\b(?:carro|veiculo|troca)\b|\bnao.{0,60}\btroca\b/.test(norm);
  const explicitTrade = !explicitNoTrade && /\b(?:tenho|possuo).{0,25}\b(?:carro|veiculo).{0,20}\btroca\b|\b(?:carro|veiculo)\s+(?:para|pra)\s+troca\b/.test(norm);
  let deniedTradeVehicle = false;
  if (explicitTrade || explicitNoTrade || expected === "possuiTroca") {
    const value = explicitNoTrade ? false : explicitTrade ? true : parseBooleanAnswer(leadMessage);
    if (value != null) {
      if (value === false) deniedTradeVehicle = true;
      add({ op: "set_slot", slot: "possuiTroca", value, confidence: expected === "possuiTroca" ? 0.9 : 0.96, sourceTurnId: turnId }, "possuiTroca");
    }
  }

  if (expected === "veiculoTroca" || (state.slots.possuiTroca.value === true && /\b(?:ano|km|quilometr|troca)\b/.test(norm))) {
    const vehicle = tradeVehicle(leadMessage, claimExtractor);
    if (vehicle) add({ op: "set_slot", slot: "veiculoTroca", value: vehicle, confidence: 0.86, sourceTurnId: turnId }, "veiculoTroca");
  }

  const city = explicitCity(leadMessage) ?? (expected === "cidade" ? bareCityAnswer(leadMessage, claimExtractor) : null);
  if (city) add({ op: "set_slot", slot: "cidade", value: titleCase(city), confidence: expected === "cidade" ? 0.86 : 0.95, sourceTurnId: turnId }, "cidade");

  if (expected === "conheceLoja" || /\b(?:conheco|ja fui|nunca fui).{0,20}\bloja\b/.test(norm)) {
    const value = /\bnunca fui\b|\bnao conheco\b/.test(norm) ? false : /\bconheco\b|\bja fui\b/.test(norm) ? true : parseBooleanAnswer(leadMessage);
    if (value != null) add({ op: "set_slot", slot: "conheceLoja", value, confidence: 0.9, sourceTurnId: turnId }, "conheceLoja");
  }

  if (expected === "interesseVisita" || /\b(?:quero|gostaria|posso).{0,20}\b(?:visita|agendar|ir na loja)\b|\bnao quero.{0,20}\bvisita\b/.test(norm)) {
    const value = /\bnao quero\b|\bagora nao\b/.test(norm) ? false : /\bvisita\b|\bagendar\b|\bir na loja\b/.test(norm) ? true : parseBooleanAnswer(leadMessage);
    if (value != null) add({ op: "set_slot", slot: "interesseVisita", value, confidence: 0.9, sourceTurnId: turnId }, "interesseVisita");
  }

  if (expected === "diaHorario") {
    const answer = visitScheduleAnswer(leadMessage);
    if (answer) add({ op: "set_slot", slot: "diaHorario", value: answer, confidence: 0.82, sourceTurnId: turnId }, "diaHorario");
  }

  const current = state.currentObjective;
  if (current?.status === "pending" && current.slot && captured.has(current.slot)) {
    muts.push({ op: "resolve_objective", objectiveId: current.id, status: "satisfied" });
  } else if (current?.status === "pending" && current.slot === "veiculoTroca" && deniedTradeVehicle) {
    muts.push({ op: "supersede_objective", objectiveId: current.id });
  }

  return muts;
}
