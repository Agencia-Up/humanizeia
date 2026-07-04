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
import type { EntityReference, Id } from "../domain/types.ts";
import { normalizeText, normalizedTermInText } from "./catalog-utils.ts";
import { parseOrdinal } from "./ordinal.ts";

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

// COMPATIBILIDADE (item 4, Codex): classificador de KIND por EXTRATORES TIPADOS (não só stoplist). Diz
// quais answer-kinds a fala satisfaz; a binder compara com `currentObjective.expectedAnswerKinds` — uma
// resposta INCOMPATÍVEL não preenche o slot. "command" = pedido comercial/ordinal/comparativo/atributo.
// Ex.: "automático", "mais barato", "outras possibilidades", "sábado de manhã", "não tenho troca" -> não são nome.
function classifyAnswerKinds(message: string, claimExtractor: ClaimExtractor): Set<string> {
  const n = normalizeText(message);
  const kinds = new Set<string>();
  if (moneySpans(message).length > 0) kinds.add("valor");
  if (parseVehicleType(message) || claimExtractor.extractClaims(message).some((c) => c.kind === "model" || c.kind === "brand_model" || c.kind === "brand")) kinds.add("modelo");
  const bool = parseBooleanAnswer(message);
  if (bool === false) kinds.add("negacao");
  if (bool === true) kinds.add("afirmacao");
  if (visitScheduleAnswer(message)) kinds.add("data");
  if (/\b(mostra|mostrar|manda|mandar|envia|enviar|ver|fotos?|imagens?)\b/.test(n)) kinds.add("command");            // comando imperativo/foto
  if (/\bmais\s+\w|\boutr[ao]s?\b|\bbarat|\bcar[oa]\b|\beconomic|\bautomatic|\bmanual\b|\bflex\b|\bcompleto\b|\bpossibilidade/.test(n)) kinds.add("command"); // comparativo/atributo
  if (/\b(primeir|segund|terceir|quart|quint)o?\b|\b(?:do|no|opcao|numero|item)\s*\d\b/.test(n)) kinds.add("command"); // ordinal
  return kinds;
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
      const trimmed = line.trim();
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || tokens.length > 3) continue;
      // Fail-closed POR LINHA (item 4): se a linha classifica como QUALQUER outro answer-kind (valor/modelo/
      // negacao/afirmacao/data/command), NÃO é um nome — evita nome="Automático"/"Mais Barato"/"Mostra...".
      // Preserva a linha-nome numa rajada mista ("Douglas\nquero onix").
      if (classifyAnswerKinds(trimmed, claimExtractor).size > 0) continue;
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

// Item 3 (Codex): extração monetária por SPANS + CUES independentes (order-independent). Cada papel
// (parcela/entrada/orçamento) pega o valor MAIS PRÓXIMO do seu cue e o CONSOME, então outro papel não o
// reusa. Anos (1900-2100 sem R$/mil) e km nunca viram dinheiro. Índices preservados (toLowerCase, sem NFD).
type MoneySpan = { value: number; start: number; end: number };
function moneySpans(message: string): MoneySpan[] {
  const lower = message.toLowerCase();
  const out: MoneySpan[] = [];
  const re = /(?:r\$\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d+(?:,\d{1,2})?)\s*(mil|k)?\b/gi;
  for (let m = re.exec(lower); m; m = re.exec(lower)) {
    const hasCurrency = /r\$/.test(m[0]);
    let v = Number(m[1].replace(/[.\s]/g, "").replace(",", "."));
    if (!Number.isFinite(v)) continue;
    const mult = m[2];
    if (mult) v *= 1000;
    const after = lower.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/\bkm\b|quilometr|rodad/.test(after)) continue;                 // km/rodagem não é dinheiro
    if (!mult && !hasCurrency && v >= 1900 && v <= 2100) continue;      // ano não é dinheiro
    const hasSep = /[.\s,]/.test(m[1]);
    if (v < 1000 && !hasSep && !mult && !hasCurrency) continue;         // número pequeno puro não é dinheiro
    out.push({ value: Math.round(v), start: m.index, end: m.index + m[0].length });
  }
  return out;
}
// Papel por CLÁUSULA (robusto a ambas as ordens): divide a fala em cláusulas (vírgula/;/./"e"/"com"/"mas")
// e classifica cada uma pelo cue presente NELA. O valor da cláusula é o 1º span monetário dela. Assim
// "picape até 100 mil, parcela até 1.800" separa as cláusulas e não confunde os valores (não depende de
// distância nem de apagar texto). "unknown" = valor sem cue (resposta pura a uma pergunta pendente).
type MoneyRoleTag = "parcela" | "entrada" | "budget" | "unknown";
function moneyByClause(message: string): Array<{ role: MoneyRoleTag; value: number }> {
  const clauses = message.split(/(?!\d)[,;.](?!\d)|\s+\b(?:e|com|mas|mais)\b\s+/i);
  const out: Array<{ role: MoneyRoleTag; value: number }> = [];
  for (const clause of clauses) {
    const spans = moneySpans(clause);
    if (spans.length === 0) continue;
    const n = clause.toLowerCase();
    const role: MoneyRoleTag =
      /parcela|mensal|mensais|por m[eê]s|prestac/.test(n) ? "parcela"
      : /entrada|sinal/.test(n) ? "entrada"
      : /at[eé]|no m[aá]ximo|or[çc]amento|faixa|investir|gastar/.test(n) ? "budget"
      : "unknown";
    out.push({ role, value: spans[0].value });
  }
  return out;
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

// P0-5 + Hardening 2 (audit): VISITA em TRÊS estados — recusa (false), intenção (true), adiamento/incerteza (não grava).
// Stem "visit" cobre visita/visitar/visitando; agendar; conhecer o carro/loja/de perto presencialmente; ir na loja.
const VISIT_INTENT_RX = /\bvisit|\bagend|\bconhecer\s+(?:o\s+carro|a\s+loja|de\s+perto|pessoal?mente|voces?)|\bir\s+(?:a[ií]|na\s+loja|ate\s+a\s+loja|conhecer)|\bpassar\s+(?:a[ií]|na\s+loja|la)|\bpresencial/;
// (1) RECUSA explícita: negação LIGADA ao ato de visitar ("não quero visitar", "não vou passar na loja",
//     "não pretendo ir aí", "não quero presencial"). Só recusa quando o alvo é a visita — "não quero ir longe" NÃO conta.
const VISIT_REFUSAL_RX = /\bnao\s+(?:quero|posso|vou|pretendo|preciso|gostaria|tenho\s+interesse)\b[^.?!]{0,30}\b(?:visit|agend|conhecer|presencial|na\s+loja|(?:ir|passar)\s+(?:a[ií]|na\s+loja|ate\s+a\s+loja|l[aá]))/;
// (2) ADIAMENTO/INCERTEZA (sem o ato de visitar): "talvez", "agora não", "mais tarde", "depois", "outro dia",
//     "qualquer dia", "não sei", "quem sabe". NÃO é recusa NEM intenção -> não grava interesseVisita (nem false nem true).
const VISIT_POSTPONE_RX = /\btalvez\b|\bagora\s+nao\b|\bmais\s+(?:tarde|pra\s+frente|adiante)\b|\bdepois\s+(?:eu|vejo|a\s+gente|vemos|marco)\b|\boutro\s+dia\b|\bqualquer\s+dia\b|\bnao\s+sei\b|\bquem\s+sabe\b/;
// dia/período (acento preservado do texto original) + hora. Guarda: "mais tarde"/"mais cedo" é período VAGO (adiamento),
// não um horário concreto — não deve virar diaHorario="tarde".
function extractDayPeriod(text: string): string | null {
  const cleaned = text.replace(/\bmais\s+(?:tarde|cedo)\b/gi, " ");
  const day = /\b(hoje|amanh[ãa]|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|domingo|manh[ãa]|tarde|noite|fim de semana|final de semana)\b/i.exec(cleaned)?.[1];
  const time = /\b(\d{1,2}(?::\d{2}|h(?:\d{2})?))\b/i.exec(cleaned)?.[1];
  const parts = [day, time].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(" ") : null;
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

// item 1 (Codex): ESCOLHA de veículo do lead a partir da última lista renderizada — ordinal OU modelo ÚNICO.
// Ambíguo (2 Onix pelo modelo) -> NÃO seleciona (o ordinal desambigua); modelo fora da lista -> não muda o foco.
// item 2: usa o parseOrdinal ÚNICO/endurecido (quantidade não é ordinal: "quero 3 fotos" não seleciona).
export function resolveSelectedVehicle(leadMessage: string, state: ConversationState, claimExtractor: ClaimExtractor): EntityReference | null {
  const items = state.lastRenderedOfferContext?.items ?? [];
  if (items.length === 0) return null;
  const labelOf = (it: (typeof items)[number]): string => [it.marca, it.modelo, it.ano].filter(Boolean).join(" ").trim();
  const ord = parseOrdinal(leadMessage);
  if (ord && ord.value >= 1 && ord.value <= items.length) {
    const it = items[ord.value - 1];
    return { kind: "vehicle", key: it.vehicleKey, label: labelOf(it) };
  }
  const claims = claimExtractor.extractClaims(leadMessage).filter((c) => c.kind === "model" || c.kind === "brand_model").map((c) => normalizeText(c.text));
  if (claims.length > 0) {
    const matches = items.filter((it) => { const mm = normalizeText(it.modelo ?? ""); return !!mm && claims.some((cl) => mm.includes(cl) || cl.includes(mm)); });
    const uniqueKeys = [...new Set(matches.map((m) => m.vehicleKey))];
    if (uniqueKeys.length === 1) return { kind: "vehicle", key: matches[0].vehicleKey, label: labelOf(matches[0]) };
  }
  return null;
}

// item F-6 (Codex): kind de resposta representado por cada slot — p/ a interseção answerKinds no resolve.
function slotAnswerKind(slot: keyof ConversationState["slots"]): string {
  if (slot === "nome") return "nome";
  if (slot === "possuiTroca" || slot === "conheceLoja" || slot === "interesseVisita") return "boolean";
  if (slot === "interesse" || slot === "tipoVeiculo" || slot === "veiculoTroca") return "modelo";
  if (slot === "faixaPreco" || slot === "entrada" || slot === "parcelaDesejada") return "valor";
  if (slot === "diaHorario") return "data";
  return "afirmacao";
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

  // ── Papéis monetários (item 3): por CLÁUSULA, order-independent (ver moneyByClause). Cada papel pega o
  //    valor da SUA cláusula; "unknown" (valor sem cue) só alimenta o slot monetário PENDENTE (resposta pura).
  const money = moneyByClause(leadMessage);
  const unknownMoney = money.find((r) => r.role === "unknown")?.value;
  const roleVal = (role: MoneyRoleTag, slotForExpected: keyof ConversationState["slots"]): number | undefined =>
    money.find((r) => r.role === role)?.value ?? (expected === slotForExpected ? unknownMoney : undefined);

  const parcelaVal = roleVal("parcela", "parcelaDesejada");
  if (parcelaVal != null) add({ op: "set_slot", slot: "parcelaDesejada", value: parcelaVal, confidence: 0.9, sourceTurnId: turnId }, "parcelaDesejada");

  // LLM-first (missão SDR): NEGAÇÃO a uma pergunta de ENTRADA = entrada zero (MEMÓRIA, p/ o cérebro não repergunta e
  // seguir no financiamento). "não"/"tenho não"/"não tenho"/"não tenho dinheiro pra entrada"/"não dá"/"não consigo" -> 0.
  // Bare "não"/"tenho não" só quando entrada foi PERGUNTADA (expected); "... entrada" explícito vale mesmo espontâneo.
  const entradaNegada =
    (expected === "entrada" && (/\btenho\s+nao\b|\bnao\s+tenho\b|\bnao\s+da\b|\bnao\s+consigo\b|\bnao\s+posso\b|\bsem\s+(?:dinheiro|grana|condic)/.test(norm) || /^(?:nao|nem)\b/.test(norm)))
    || /\bnao\s+(?:tenho|vou|posso|consigo|pretendo)\b[^.?!]{0,25}\bentrada\b|\bsem\s+condic[^.?!]{0,20}\bentrada\b/.test(norm);
  if (/\b(?:sem|nao tenho|zero de)\s+entrada\b|\bentrada\s+zero\b/.test(norm) || entradaNegada) {
    add({ op: "set_slot", slot: "entrada", value: 0, confidence: entradaNegada ? 0.9 : 0.98, sourceTurnId: turnId }, "entrada");
  } else {
    const entradaVal = roleVal("entrada", "entrada");
    if (entradaVal != null) add({ op: "set_slot", slot: "entrada", value: entradaVal, confidence: 0.9, sourceTurnId: turnId }, "entrada");
  }

  const budgetVal = roleVal("budget", "faixaPreco");
  if (budgetVal != null) add({ op: "set_slot", slot: "faixaPreco", value: { max: budgetVal }, confidence: 0.92, sourceTurnId: turnId }, "faixaPreco");

  const payment = parsePayment(leadMessage);
  if (payment && (expected === "formaPagamento" || /\ba vista\b|\bfinanc|\bparcel|\bconsorcio\b|\bpagamento\b/.test(norm))) {
    add({ op: "set_slot", slot: "formaPagamento", value: payment, confidence: 0.95, sourceTurnId: turnId }, "formaPagamento");
  }

  const explicitNoTrade = /\b(?:nao tenho|sem).{0,40}\b(?:carro|veiculo|troca)\b|\bnao.{0,60}\btroca\b/.test(norm);
  const explicitTrade = !explicitNoTrade && /\b(?:tenho|possuo).{0,25}\b(?:carro|veiculo).{0,20}\btroca\b|\b(?:carro|veiculo)\s+(?:para|pra)\s+troca\b/.test(norm);
  // R11-A1 (Codex): um PEDIDO de compra ("Quero SUV até 70 mil", "quero um Gol") NÃO é resposta booleana de troca.
  // Sem isto, com objetivo 'possuiTroca' pendente, parseBooleanAnswer("quero...") virava possuiTroca=true ESPÚRIO
  // (memória corrompida -> objetivo trocava sem base). "tenho um Gol" (verbo de POSSE) continua sendo troca=sim.
  const buyVerb = /\b(quero|procuro|busco|prefiro|mostra|me ve|gostaria de ver|estou procurando|to procurando)\b/.test(norm);
  const mentionsVehicle = parseVehicleType(leadMessage) != null || /\b(carro|veiculo|modelo)\b/.test(norm) || /\b\d{1,3}\s*mil\b/.test(norm)
    || claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model");
  const looksLikeBuyRequest = buyVerb && mentionsVehicle;
  // LLM-first (missão): "tenho não"/"não tenho"/"não possuo" respondendo à pergunta de TROCA = NÃO (possuiTroca=false).
  // parseBooleanAnswer("tenho não") casaria "tenho"->true (ERRADO); por isso a negação explícita vem ANTES. Mata a
  // repetição vista no eval real (agente repetia "tem carro pra troca?" porque não entendeu "tenho não").
  const trocaNeg = /\btenho\s+nao\b|\bnao\s+tenho\b|\bnao\s+possuo\b|\bpossuo\s+nao\b/.test(norm);
  const trocaPos = !trocaNeg && /\btenho\s+sim\b|\bpossuo\s+sim\b/.test(norm);
  let deniedTradeVehicle = false;
  if (explicitTrade || explicitNoTrade || expected === "possuiTroca") {
    const value = (explicitNoTrade || trocaNeg) ? false : (explicitTrade || trocaPos) ? true : (looksLikeBuyRequest ? null : parseBooleanAnswer(leadMessage));
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

  // P0-5 + H2 (audit): visita = FATO explícito do lead em TRÊS estados. "quero o terceiro"/"quero fotos" =
  // seleção/mídia, NÃO visita (refersVehicleOrMedia).
  const refersVehicleOrMedia = /\b(?:primeir|segund|terceir|quart|quint|ultim)[oa]\b|\bo\s+\d+\b|\bop[cç][aã]o\b|\bfotos?\b|\bimagens?\b|\bv[ií]deos?\b/.test(norm);
  const visitIntentPresent = VISIT_INTENT_RX.test(norm);
  const visitRefusal = VISIT_REFUSAL_RX.test(norm);
  // Intenção POSITIVA: cita o ato de visitar E não é recusa E não é seleção/mídia. "quero visitar mais tarde" -> true
  // ("mais tarde" é período vago, não recusa; só não vira diaHorario concreto — ver extractDayPeriod).
  const positiveVisit = visitIntentPresent && !visitRefusal && !refersVehicleOrMedia;
  // ADIAMENTO só conta quando NÃO há intenção positiva nem recusa (senão "quero visitar mais tarde" cairia aqui).
  const postpone = !positiveVisit && !visitRefusal && VISIT_POSTPONE_RX.test(norm);
  if (visitRefusal || positiveVisit || expected === "interesseVisita" || visitIntentPresent) {
    // recusa -> false; intenção -> true; adiamento -> NÃO grava (null); senão booleana pura só se o slot foi perguntado.
    const value = visitRefusal ? false
      : positiveVisit ? true
      : postpone ? null
      : refersVehicleOrMedia ? null
      : expected === "interesseVisita" ? parseBooleanAnswer(leadMessage)
      : null;
    if (value != null) add({ op: "set_slot", slot: "interesseVisita", value, confidence: 0.9, sourceTurnId: turnId }, "interesseVisita");
  }
  // diaHorario: captura o dia/período quando HÁ intenção POSITIVA de visita OU o agente perguntou o dia (mesmo turno).
  // extractDayPeriod ignora "mais tarde"/"mais cedo" (período vago), então "quero visitar mais tarde" não grava horário.
  if (expected === "diaHorario" || positiveVisit) {
    const answer = extractDayPeriod(leadMessage) ?? (expected === "diaHorario" ? visitScheduleAnswer(leadMessage) : null);
    if (answer) add({ op: "set_slot", slot: "diaHorario", value: answer, confidence: 0.82, sourceTurnId: turnId }, "diaHorario");
  }

  const selectedVehicle = resolveSelectedVehicle(leadMessage, state, claimExtractor);
  if (selectedVehicle) muts.push({ op: "select_vehicle_focus", vehicle: selectedVehicle, sourceTurnId: turnId });

  // item F-6: só resolve o currentObjective quando o slot foi CAPTURADO **E** o answerKind é compatível com
  // expectedAnswerKinds (interseção real). Resposta incompatível não resolve nem altera o objetivo.
  const current = state.currentObjective;
  const capturedKinds = new Set<string>();
  for (const s of captured) { const k = slotAnswerKind(s); capturedKinds.add(k); if (k === "boolean") { capturedKinds.add("afirmacao"); capturedKinds.add("negacao"); } }
  const kindsCompatible = (current?.expectedAnswerKinds ?? []).some((k) => capturedKinds.has(k));
  if (current?.status === "pending" && current.slot && captured.has(current.slot) && kindsCompatible) {
    muts.push({ op: "resolve_objective", objectiveId: current.id, status: "satisfied" });
  } else if (current?.status === "pending" && current.slot === "veiculoTroca" && deniedTradeVehicle) {
    muts.push({ op: "supersede_objective", objectiveId: current.id });
  }

  return muts;
}
