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
import { VEHICLE_TAXONOMY } from "../adapters/read/vehicle-taxonomy.ts";
import { BIRTH_DATE_VALID_TOKEN_RX, CPF_VALID_TOKEN_RX, reserveSensitiveNumericSpans } from "../domain/sensitive-data.ts";

const NON_NAME = new Set([
  "sim", "nao", "claro", "certo", "ok", "okay", "isso", "beleza", "blz", "opa", "oi", "ola", "eai", "e", "ou", "eh",
  "quero", "queria", "quis", "tem", "temos", "vi", "gostei", "gosto", "gostaria", "conheco", "conhece", "sei", "acho",
  "vou", "vamos", "posso", "pode", "de", "da", "do", "das", "dos", "um", "uma", "uns", "umas", "talvez", "agora", "aqui",
  "ali", "esse", "essa", "esses", "essas", "ainda", "mas", "porem", "entao", "ver", "vendo", "procuro", "procurando",
  "busco", "buscando", "preciso", "manda", "mandar", "envia", "enviar", "foto", "fotos", "preco", "valor", "quanto",
  "qual", "quais", "bom", "boa", "dia", "tarde", "noite", "obrigado", "obrigada", "valeu", "carro", "carros",
  "modelo", "modelos", "veiculo", "veiculos", "com", "sem", "por", "pra", "para", "que", "comprar", "financiar", "financia", "financiamento", "voces", "voce", "ai",
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
  if (parsePayment(message) != null || /\bfinanci|\bparcel|\bpagament|\bconsorci/.test(n)) kinds.add("command");
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
  // Missão P0 (audit Codex smoke real T8): captura OPORTUNÍSTICA de nome — o lead se APRESENTA espontaneamente ("Douglas",
  // "Douglas Aloan") mesmo SEM termos perguntado. Só quando o bloco INTEIRO é um nome PELADO (1-2 tokens que passam
  // isNameToken; nenhum outro answer-kind: valor/modelo/negação/afirmação/data/comando) — evita capturar "SUV"/"Sim"/
  // "automático"/"mostra" como nome. Confidence menor (não foi resposta a uma pergunta de nome). >=NAME_CONFIDENCE_MIN.
  // Guard: se o agente perguntou a CIDADE, um token pelado ("Taubaté") é a cidade, NÃO o nome — a extração de cidade cuida.
  const bareTokens = leadMessage.trim().split(/\s+/).filter(Boolean);
  if (inferredQuestionSlot(state) !== "cidade"
    && bareTokens.length >= 1 && bareTokens.length <= 2
    && classifyAnswerKinds(leadMessage.trim(), claimExtractor).size === 0
    && bareTokens.every((t) => isNameToken(t, claimExtractor))) {
    return { value: titleCase(bareTokens.join(" ")), confidence: 0.8 };
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

export function leadAsksQuestion(text: string): boolean {
  const norm = normalizeText(text).trim();
  if (/[?？]\s*$/.test(text.trim())) return true;
  if (/^(?:tem|da|dá)\s+(?:sim|nao)\b/.test(norm)) return false;
  return /^(?:qual|quais|quanto|quantos|onde|como|quando|tem|existe|possui|aceita|faz|da|dá|precisa|tenho que|tem que)\b/.test(norm);
}

function negatesOwnCity(text: string): boolean {
  const norm = normalizeText(text);
  return /\bnao\s+(?:sou|moro|estou|fico)\s+de\b|\bnao\s+falo\s+de\b/.test(norm);
}

// A ÚLTIMA cláusula INTERROGATIVA da fala do agente (o que ele de fato PERGUNTOU). Assim um acolhimento em statement
// ("Entendi que você não tem entrada. ...") NÃO domina a inferência do slot — só o que termina em "?". PURO.
// ⭐SEM: exportada — o feedback de proveniência do understanding cita a última pergunta p/ orientar o cérebro.
export function lastAgentQuestionText(state: ConversationState): string {
  const full = lastAgentText(state);
  const questions = full.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.endsWith("?"));
  return questions.length > 0 ? questions[questions.length - 1] : full;
}
// ⭐SEM (invariante 3): classificação de PERGUNTA DE SLOT a partir de um texto do AGENTE — fonte única usada
// tanto na inferência da pergunta pendente (recentTurns) quanto no registro na WorkingMemory (texto AUTORADO
// do turno que está sendo enviado). Taxonomia de slot, não handler.
export function questionSlotFromAgentText(agentText: string, opts: { readonly legacyFallback?: boolean } = {}): keyof ConversationState["slots"] | null {
  const questions = agentText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.endsWith("?"));
  // Default ESTRITO (WM.pendingAgentQuestion): sem "?" não há pergunta — um statement ("Anotado, parcela de
  // R$ 1.200.") NUNCA registra pergunta pendente. legacyFallback=true preserva o comportamento histórico do
  // inferredQuestionSlot (usa o texto inteiro quando não há interrogativa).
  if (questions.length === 0 && !agentText.trim().endsWith("?") && opts.legacyFallback !== true) return null;
  const text = normalizeText(questions.length > 0 ? questions[questions.length - 1] : agentText);
  // MISSÃO PII (causa-raiz do pendente STALE): pergunta de CPF/data de nascimento mapeia para o slot
  // SENSÍVEL `cpf` — ANTES de "parcela" (a frase "…parcela até 1200. Preciso do seu CPF…" caía no
  // fallback legado como parcelaDesejada e a resposta curta seguinte era ligada à pergunta ERRADA).
  if (/\bcpf\b/.test(text)) return "cpf";
  if (/\bdata de nascimento\b|\bnascimento\b/.test(text)) return "birthDate";
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
export function inferredQuestionSlot(state: ConversationState): keyof ConversationState["slots"] | null {
  if (state.currentObjective?.status === "pending" && state.currentObjective.slot) return state.currentObjective.slot;
  return questionSlotFromAgentText(lastAgentText(state), { legacyFallback: true });
}

// ── MISSÃO P0 (Financial Question Context): a RESPOSTA a uma pergunta financeira do agente (parcela/entrada/
//    pagamento/troca) NUNCA é uma nova busca de estoque. Estes três helpers PUROS formam o contrato do "contexto
//    esperado": (1) qual pergunta o agente acabou de fazer + de que TIPO; (2) a fala do lead traz intenção de COMPRA
//    NOVA (vence o contexto); (3) a fala do lead RESPONDE à pergunta financeira (valor/negação/pagamento). ──────────
export type ExpectedAnswerKind = "financial" | "trade" | "discovery" | "other";
export interface ExpectedAnswerContext {
  readonly slot: keyof ConversationState["slots"] | null;
  readonly kind: ExpectedAnswerKind | null;
}
export function inferExpectedAnswerContext(state: ConversationState): ExpectedAnswerContext {
  const slot = inferredQuestionSlot(state);
  if (slot == null) return { slot: null, kind: null };
  if (slot === "parcelaDesejada" || slot === "entrada" || slot === "formaPagamento") return { slot, kind: "financial" };
  if (slot === "possuiTroca" || slot === "veiculoTroca") return { slot, kind: "trade" };
  if (slot === "interesse" || slot === "tipoVeiculo" || slot === "faixaPreco") return { slot, kind: "discovery" };
  return { slot, kind: "other" };
}

// Intenção EXPLÍCITA de COMPRA/BUSCA NOVA (vence o contexto financeiro anterior): verbo de compra/mostrar + referência a
// veículo (modelo/tipo/"carro"), OU "tem <veículo>?", OU "outro carro/modelo/mais opções". NÃO casa valor solto ("até
// 1200"), negação ("tenho não"), afirmação curta ("sim"/"pode ser") nem forma de pagamento ("financiar"). PURO.
const NEW_SEARCH_VERB_RX = /\b(quero|procuro|busco|prefiro|mostra|me\s+(?:mostra|ve|mostr\w*)|ver|gostaria\s+de\s+(?:ver|comprar)|gostei|curti|me\s+interess(?:ou|ei)|tenho\s+interesse)\b/;
const ANOTHER_CAR_RX = /\boutr[oa]s?\s+(?:carro|modelo|veiculo|op[cç])|\bmais\s+op[cç]|\bmais\s+um\s+(?:carro|modelo)\b/;
export function hasExplicitNewCommercialSearchIntent(
  leadMessage: string,
  interpretation: TurnInterpretation | null | undefined,
  claimExtractor: ClaimExtractor,
): boolean {
  const norm = normalizeText(leadMessage);
  const availability = /\btem\s+\w/.test(norm);            // "tem SUV?", "tem Onix?" = disponibilidade (compra)
  const anotherCar = ANOTHER_CAR_RX.test(norm);
  const hasType = parseVehicleType(leadMessage) != null;
  const hasModel = detectInterestModels(leadMessage, interpretation, claimExtractor).length > 0;
  const vehicleRef = hasType || hasModel || /\b(carro|veiculo|modelo)\b/.test(norm);
  const buyVerb = NEW_SEARCH_VERB_RX.test(norm);
  return anotherCar || ((buyVerb || availability) && vehicleRef);
}

// A fala do lead RESPONDE à pergunta financeira pendente (parcela/entrada/pagamento)? = valor monetário, negação de
// entrada, forma de pagamento, ou afirmação curta — e NÃO é uma pergunta nova. Não decide a resposta; só classifica a
// intenção da fala p/ o engine bloquear tool comercial errada. PURO.
export function isAnswerToFinancialQuestion(
  leadMessage: string,
  expected: (keyof ConversationState["slots"]) | null,
  interpretation?: TurnInterpretation | null,
  claimExtractor?: ClaimExtractor,
): boolean {
  if (expected !== "parcelaDesejada" && expected !== "entrada" && expected !== "formaPagamento") return false;
  if (/\?\s*$/.test(leadMessage.trim())) return false;    // termina em "?" = pergunta nova, não resposta
  const norm = normalizeText(leadMessage).trim();
  // Referência a veículo (tipo/modelo) => NÃO é resposta financeira pura — evita "Compass 2019" respondendo parcela virar
  // valor 2019. Sem isso, a pergunta pendente financeira é CONTEXTO financeiro: "2100" (range de ano) vira valor de parcela.
  const hasVehicleRef = parseVehicleType(leadMessage) != null
    || (claimExtractor != null && detectInterestModels(leadMessage, interpretation, claimExtractor).length > 0);
  const hasMoney = moneyByClause(leadMessage, !hasVehicleRef).length > 0;
  const negation = /^(?:nao|nem)\b|\btenho\s+nao\b|\bnao\s+tenho\b|\bsem\s+(?:entrada|dinheiro|grana|condic)/.test(norm);
  const affirm = /^(?:sim|isso|ok|beleza|claro|pode\s+ser|com\s+certeza|isso\s+mesmo)\b/.test(norm);
  const paymentMethod = parsePayment(leadMessage) != null; // "financiar", "à vista", "consórcio"
  return hasMoney || negation || affirm || paymentMethod;
}

// Valor financeiro em andamento mesmo quando o objetivo/pergunta pendente não sobreviveu no estado.
// Ex.: carro selecionado + entrada/financiamento já em andamento + "Até 2100 tá bom" = parcela mensal,
// não teto de busca de estoque. Continua cedendo para intenção comercial nova explícita ("quero Onix até 80 mil").
export function isFinancialValueDuringSelectedFinancing(
  leadMessage: string,
  state: ConversationState,
  interpretation: TurnInterpretation | null | undefined,
  claimExtractor: ClaimExtractor,
): boolean {
  if (/\?\s*$/.test(leadMessage.trim())) return false;
  const paymentInProgress = state.vehicleContext.selected != null
    && (state.slots.entrada.status !== "unknown" || state.slots.formaPagamento.status !== "unknown" || state.slots.parcelaDesejada.status !== "unknown");
  if (!paymentInProgress) return false;
  if (statesTradeVehiclePossession(leadMessage, claimExtractor)) return false;
  if (hasExplicitNewCommercialSearchIntent(leadMessage, interpretation, claimExtractor)) return false;
  // Referência a veículo (tipo/modelo) => é ano/carro, não valor financeiro ("Compass 2019" durante o financiamento).
  if (parseVehicleType(leadMessage) != null || detectInterestModels(leadMessage, interpretation, claimExtractor).length > 0) return false;
  // Financiamento em andamento = CONTEXTO financeiro: um número no range de ano ("2100") é VALOR (parcela). financialContext=true.
  return moneyByClause(leadMessage, true).length > 0;
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
// financialContext=true: o CONTEXTO da conversa é financeiro (respondendo parcela/entrada, financiamento em andamento),
// então um número no range de ANO (1900-2100) é VALOR, não ano. Sem isso (default), só um cue financeiro COLADO no texto
// (até/parcela/entrada/por mês/R$) libera o range de ano — "Compass 2019" continua sendo ano.
function moneySpans(message: string, financialContext = false): MoneySpan[] {
  // ── MISSÃO PII (precedência lexical, causa-raiz "01/10/1997 -> parcela=1997"): spans SENSÍVEIS/DATA são
  //    RESERVADOS e nunca chegam ao parser de dinheiro — datas completas (DD/MM/AAAA e variantes) e runs de
  //    11 dígitos são removidos ANTES da varredura, mesmo em financialContext (que libera range de ano).
  //    Ordem: sensível/data > km/ano > dinheiro. Defesa em profundidade (o ingest já sanitiza). ──────────────
  const lower = reserveSensitiveNumericSpans(message).toLowerCase();
  const out: MoneySpan[] = [];
  const re = /(?:r\$\s*)?(\d{1,3}(?:[.,\s]\d{3})+|\d+(?:,\d{1,2})?)\s*(mil|k)?\b/gi;
  for (let m = re.exec(lower); m; m = re.exec(lower)) {
    const hasCurrency = /r\$/.test(m[0]);
    const rawNumber = m[1];
    const groupedThousands = /^\d{1,3}(?:[.,\s]\d{3})+$/.test(rawNumber);
    // No português informal, "2,000 mil" e "2.500 mil" usam o separador
    // como decimal antes do multiplicador (2 x mil / 2,5 x mil). Sem o
    // multiplicador, o mesmo formato representa agrupamento de milhares.
    const normalizedNumber = groupedThousands && !m[2]
      ? rawNumber.replace(/[.,\s]/g, "")
      : rawNumber.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, ".").replace(",", ".");
    let v = Number(normalizedNumber);
    if (!Number.isFinite(v)) continue;
    const mult = m[2];
    if (mult) v *= 1000;
    const before = lower.slice(Math.max(0, m.index - 28), m.index);
    const after = lower.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/\bkm\b|quilometr|rodad/.test(after)) continue;                 // km/rodagem NUNCA é dinheiro (vence tudo)
    const hasSep = /[.\s,]/.test(m[1]);
    // Cue financeiro COLADO ao número (antes: "até/parcela/entrada/R$/por mês ..."; depois: "... de parcela/mês").
    const financialCue =
      /(?:r\$|at[eé]|parcela|mensal|mensais|por m[eê]s|prestac|entrada|sinal)\s*(?:de\s*)?$/.test(before)
      || /^\s*(?:de\s*)?(?:parcela|mensal|mensais|por m[eê]s|prestac|entrada|sinal)\b/.test(after);
    // Ano (1900-2100 SEM separador/multiplicador/R$) NÃO é dinheiro — EXCETO com cue financeiro no texto OU quando o
    // contexto da conversa é financeiro. "Compass 2019" fica ano; "até 2100"/"parcela 2100"/2100-respondendo-parcela viram valor.
    if (!mult && !hasCurrency && !hasSep && v >= 1900 && v <= 2100 && !financialCue && !financialContext) continue;
    if (v < 1000 && !hasSep && !mult && !hasCurrency) continue;         // número pequeno puro não é dinheiro
    out.push({ value: Math.round(v), start: m.index, end: m.index + m[0].length });
  }
  return out;
}
// ⭐Missão P0 (validationState, audit Codex F2.43): os VALORES MONETÁRIOS que o LEAD ESCREVEU no bloco ATUAL —
// allowlist de PROVENIÊNCIA para a validação da resposta: ecoar um valor que o cliente acabou de dizer ("Tenho 8k
// de entrada" -> "R$ 8.000 anotado!") NUNCA é invenção, independente do timing do commit dos slots. Valor que a LLM
// inventa (não está no bloco nem nos slots conhecidos) continua sem aterro -> deny. PURO (mesmo parser da extração;
// financialContext=true para "até 2100" contar como valor, como no slot).
export function leadStatedMoneyValues(message: string): number[] {
  const seen = new Set<number>();
  for (const s of moneySpans(message, true)) seen.add(s.value);
  return [...seen];
}
// Papel por CLÁUSULA (robusto a ambas as ordens): divide a fala em cláusulas (vírgula/;/./"e"/"com"/"mas")
// e classifica cada uma pelo cue presente NELA. O valor da cláusula é o 1º span monetário dela. Assim
// "picape até 100 mil, parcela até 1.800" separa as cláusulas e não confunde os valores (não depende de
// distância nem de apagar texto). "unknown" = valor sem cue (resposta pura a uma pergunta pendente).
export type MoneyRoleTag = "parcela" | "entrada" | "budget" | "unknown";
export function moneyByClause(message: string, financialContext = false): Array<{ role: MoneyRoleTag; value: number }> {
  const clauses = message.split(/(?!\d)[,;.](?!\d)|\s+\b(?:e|com|mas|mais)\b\s+/i);
  const out: Array<{ role: MoneyRoleTag; value: number }> = [];
  for (const clause of clauses) {
    const spans = moneySpans(clause, financialContext);
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

export function parseBooleanAnswer(text: string): boolean | null {
  const norm = normalizeText(text).trim();
  // Resposta booleana e um ATO curto, nao qualquer frase que comece com
  // "quero". Sem este limite, "quero agendar visita" respondendo a uma
  // pergunta anterior de troca virava possuiTroca=true e corrompia o funil.
  if (/^(?:nao|nem|nunca|nao tenho|tenho nao|nao possuo|possuo nao|sem)[.!\s]*$/.test(norm)) return false;
  if (/^(?:sim|tenho|conheco|quero|gostaria|pode|vamos|claro|com certeza)(?:\s+(?:sim|tambem|por favor))?[.!\s]*$/.test(norm)) return true;
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
function containsVisitRefusal(text: string): boolean {
  // A negação precisa pertencer à mesma cláusula do ato de visita.
  // "precisa não, vou aí visitar" contém uma recusa de fotos seguida de
  // uma intenção positiva de visita; normalizar o bloco inteiro apagava a
  // vírgula e ligava o "não" ao verbo "visitar" da cláusula seguinte.
  return text
    .split(/[,;.!?\n]+/)
    .map((clause) => normalizeText(clause))
    .some((clause) => VISIT_REFUSAL_RX.test(clause));
}
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

// ⭐P0-A (COMPOSIÇÃO de agendamento): mescla o diaHorario JÁ conhecido com o novo valor SEM apagar a outra dimensão.
//    "segunda" (existente) + "15h" (novo) -> "segunda 15h"; o horário não apaga o dia; o dia não apaga o horário; corrigir
//    uma dimensão mantém a outra. PURO/testável. Dia = dia-da-semana/relativo; horário = relógio/meio-dia/período (manhã/tarde/noite).
const SCHED_DAY_PART_RX = /\b(hoje|amanh[ãa]|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado|domingo|fim de semana|final de semana)\b/i;
const SCHED_TIME_PART_RX = /\b(\d{1,2}(?::\d{2}|h(?:\d{2})?)|meio-?dia|meia-?noite|manh[ãa]|tarde|noite)\b/i;
function scheduleDayToken(s: string): string | null { return SCHED_DAY_PART_RX.exec(s)?.[1] ?? null; }
function scheduleTimeToken(s: string): string | null { return SCHED_TIME_PART_RX.exec(s)?.[1] ?? null; }
export function composeSchedule(existing: string | null, incoming: string): string {
  if (!existing || !existing.trim()) return incoming.trim();
  const day = scheduleDayToken(incoming) ?? scheduleDayToken(existing);
  const time = scheduleTimeToken(incoming) ?? scheduleTimeToken(existing);
  if (day && time) return `${day} ${time}`;
  return incoming.trim() || existing.trim();
}

// ── Missão P0 (TROCA em bloco quebrado): o carro de TROCA é DO LEAD — não precisa existir na taxonomia nem no
//    catálogo do tenant. Tolerância GENÉRICA (não if-por-frase): (a) typo de letra dobrada resolve pela taxonomia de
//    mercado COLAPSADA ("hillux"->Hilux/Toyota); (b) senão, o DESCRITOR LIVRE adjacente à posse/ano vira o modelo
//    (palavra do lead, para o briefing do vendedor). Dígitos nunca colapsam (ano/km intactos). ─────────────────────
const collapseLetters = (s: string): string => s.replace(/(\p{L})\1+/gu, "$1");
const MARKET_COLLAPSED: ReadonlyMap<string, { marca: string; modelo: string }> = (() => {
  const m = new Map<string, { marca: string; modelo: string }>();
  for (const e of VEHICLE_TAXONOMY) {
    const key = collapseLetters(normalizeText(e.model));
    if (key && !m.has(key)) m.set(key, { marca: e.brand, modelo: e.model });
  }
  return m;
})();
// Palavras que descrevem o veículo genericamente (nunca são um modelo): não viram descritor.
const TRADE_DESC_STOP = new Set([
  "carro", "carros", "veiculo", "veiculos", "automovel", "moto", "modelo", "marca", "ano", "km", "mil", "troca",
  "meu", "minha", "outro", "outra", "novo", "nova", "usado", "usada", "seminovo", "seminova", "bom", "boa", "sim",
  "sedan", "suv", "hatch", "picape", "pickup", "caminhonete", "diesel", "flex", "automatico", "manual", "completo", "completa",
]);
function freeTradeDescriptor(norm: string): string | null {
  const cands: string[] = [];
  // O carro de troca frequentemente tem nome composto ("C4 Lounge", "Range
  // Rover", "C3 Aircross"). Guardar apenas a primeira ou a última palavra
  // empobrece o briefing. Recortamos a expressão de posse até o primeiro dado
  // objetivo (ano/km/troca) e a tratamos como uma identidade declarada pelo lead.
  const afterPossession = /\b(?:tenho|possuo)\s+(?:um|uma)\s+(.{2,56}?)(?=\s+(?:(?:19|20)\d{2}|\d{1,3}(?:[.,]\d{3})*\s*(?:mil|k)?\s*km|(?:para|pra|na)\s+troca)\b|$)/u.exec(norm);
  if (afterPossession) {
    const phrase = afterPossession[1].replace(/\s+/g, " ").trim();
    if (phrase) cands.push(phrase);
  }
  for (const m of norm.matchAll(/\b([\p{L}][\p{L}\d-]{2,})\s+(?:19|20)\d{2}\b/gu)) cands.push(m[1]);
  for (const c of cands) if (!TRADE_DESC_STOP.has(c) && !/^\d+$/.test(c)) return c;
  return null;
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
  const desc = freeTradeDescriptor(norm);
  if (model) {
    // Um claim de catálogo parcial ("Lounge") não deve vencer a identidade
    // composta declarada pelo cliente ("C4 Lounge"). Quando o descritor é
    // mais específico, a taxonomia o canoniza; se for veículo fora do catálogo,
    // ele segue como texto do lead para o briefing.
    if (desc && collapseLetters(desc).length > collapseLetters(model.text).length) {
      const canon = MARKET_COLLAPSED.get(collapseLetters(desc));
      if (canon) { result.modelo = canon.modelo; if (!result.marca) result.marca = canon.marca; }
      else result.modelo = desc;
    } else result.modelo = model.text;
  } else {
    if (desc) {
      const canon = MARKET_COLLAPSED.get(collapseLetters(desc));
      if (canon) { result.modelo = canon.modelo; if (!result.marca) result.marca = canon.marca; }
      else result.modelo = desc;
    }
  }
  if (yearMatch) result.ano = Number(yearMatch[1]);
  if (kmMatch) {
    let km = Number(kmMatch[1].replace(/[.,]/g, ""));
    // Normalização BR (missão P0 D): no veículo de TROCA (usado), um km BAIXO é abreviação de milhares — "86km"/"86 km"/
    // "86 mil km" = 86.000. Um usado com <1000 km real é implausível. "86.000 km"/"86000 km" já vêm em milhares (>=1000).
    if (km < 1000) km *= 1000;
    result.km = km;
  }
  if (/\bbom estado\b|\bbem conservad/.test(norm)) result.estado = "bom estado";
  if (!result.modelo && result.marca && (result.ano != null || result.km != null)) result.modelo = result.marca;
  return Object.keys(result).length > 0 ? result : null;
}

// Missão P0 (audit Codex smoke real): o lead OFERECE um veículo de TROCA mesmo SEM termos perguntado sobre troca — no smoke,
// "Tenho um Renegade 2019 86km" foi dito enquanto o agente perguntava sobre ENTRADA/financiamento. Sinal ROBUSTO de posse =
// verbo de posse (tenho/possuo, exceto "tenho interesse" = compra) + veículo (modelo) + QUILOMETRAGEM (km). O km é o
// discriminador forte: você só cita o km de um carro que É SEU, nunca de um que quer comprar. Assim "tem Renegade?" /
// "quero um Renegade" (compra, sem posse+km) NÃO viram troca. Usado no engine (tradeInAnswerTurn) e na captura de
// veiculoTroca — para o ENTENDIMENTO REFLETIR a conversa, não só quando nós perguntamos.
export function statesTradeVehiclePossession(text: string, claimExtractor: ClaimExtractor): boolean {
  const norm = normalizeText(text);
  const hasPossession = /\b(?:tenho|possuo)\b/.test(norm) && !/\btenho\s+interesse\b/.test(norm);
  if (!hasPossession) return false;
  const tv = tradeVehicle(text, claimExtractor);
  return tv != null && tv.modelo != null && tv.km != null;
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
  // Referencia por atributo visivel da lista ("esse prata"): resolve somente
  // quando a cor foi aterrada na oferta renderizada e identifica UM item.
  // Nao consulta catalogo inteiro e nao escolhe em caso ambiguo.
  const normLead = normalizeText(leadMessage);
  if (/\b(?:esse|essa|este|esta|ver|gostei|quero|prefiro)\b/.test(normLead)) {
    const colorMatches = items.filter((it) => {
      const color = normalizeText(it.cor ?? "");
      return color.length >= 3 && new RegExp(`\\b${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normLead);
    });
    const uniqueColorKeys = [...new Set(colorMatches.map((m) => m.vehicleKey))];
    if (uniqueColorKeys.length === 1) return { kind: "vehicle", key: colorMatches[0].vehicleKey, label: labelOf(colorMatches[0]) };
  }
  // ⭐SEM (incidente real: "Gostei do Aircross" não selecionou o "C3 Aircross" da lista — o claim do catálogo não
  // reconhece o SUBMODELO solto de um modelo composto). Fallback GROUNDED NA LISTA RENDERIZADA: uma palavra do bloco
  // (>=4 chars) idêntica a um token do modelo de UM ÚNICO item seleciona aquele item. Ambíguo (2 Renegade) -> não
  // seleciona (o ordinal desambigua); nada fora da lista pode casar (zero risco de catálogo inteiro).
  if (claims.length === 0) {
    const words = new Set(normalizeText(leadMessage).split(/\s+/).filter((w) => w.length >= 4));
    if (words.size > 0) {
      const tokenMatches = items.filter((it) => normalizeText(it.modelo ?? "").split(/\s+/).some((tk) => tk.length >= 4 && words.has(tk)));
      const uniq = [...new Set(tokenMatches.map((m) => m.vehicleKey))];
      if (uniq.length === 1) return { kind: "vehicle", key: tokenMatches[0].vehicleKey, label: labelOf(tokenMatches[0]) };
    }
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
  readonly allowVehicleSelection?: boolean;
}): DecisionMutation[] {
  const { leadMessage, state, interpretation, claimExtractor, turnId } = args;
  const muts: DecisionMutation[] = [];
  const captured = new Set<keyof ConversationState["slots"]>();
  const expected = inferredQuestionSlot(state);
  const norm = normalizeText(leadMessage);
  const questionLike = leadAsksQuestion(leadMessage);
  // ── Missão P0 (audit Codex): separa o ALVO DE COMPRA do veículo de TROCA no MESMO bloco. O verbo de compra marca o INÍCIO
  //    do alvo de compra; o trecho ANTES é a parte de TROCA. Em contexto de troca, interesse/tipoVeiculo (COMPRA) vêm SÓ do
  //    alvo de compra (NUNCA do carro de troca -> mata a contaminação "interesse=Renegade"); veiculoTroca vem da parte de troca. ──
  const buyVerbMatch = /\b(quero|procuro|busco|prefiro|gostaria\s+de|estou\s+procurando|to\s+procurando|gostei|curti|me\s+interess(?:ou|ei)|tenho\s+interesse)\b/i.exec(leadMessage);
  const buyClauseText = buyVerbMatch ? leadMessage.slice(buyVerbMatch.index) : "";           // "quero SUV / quero algo até 70 mil"
  const preBuyText = buyVerbMatch ? leadMessage.slice(0, buyVerbMatch.index) : leadMessage;   // "tenho um Onix para troca,"
  const availabilityQ = /\btem\s+\w/.test(norm);   // "tem Renegade?" = DISPONIBILIDADE (compra), não troca
  const asksVehicleAvailability = questionLike && availabilityQ;
  const tradePhrase = /\b(?:para|pra|de|na)\s+troca\b|\bdar\s+(?:de\s+|na\s+)?troca\b|\bdou\s+(?:de\s+|na\s+)?troca\b/.test(norm);
  // Missão P0 (audit Codex smoke real): posse de veículo COM km = oferta de TROCA mesmo sem termos perguntado troca. Entra no
  // inTradeContext p/ que interesse/tipoVeiculo (COMPRA) venham SÓ do alvo de compra (buyClause) — NUNCA do carro de troca
  // (senão "Tenho um Renegade 2019 86km" respondendo sobre entrada gravaria interesse=renegade).
  const offersTradeByPossession = statesTradeVehiclePossession(preBuyText || leadMessage, claimExtractor);
  const inTradeContext = !asksVehicleAvailability && (expected === "possuiTroca" || expected === "veiculoTroca" || tradePhrase || offersTradeByPossession);
  // interesse/tipoVeiculo de COMPRA: em contexto de troca, só do ALVO DE COMPRA (buy clause); fora dele, o bloco todo.
  const interestText = inTradeContext ? buyClauseText : leadMessage;

  const add = (mutation: DecisionMutation, slot?: keyof ConversationState["slots"]): void => {
    muts.push(mutation);
    if (slot) captured.add(slot);
  };

  const name = extractName(leadMessage, state, claimExtractor);
  const nameOnlyTurn = name != null && normalizeText(leadMessage).trim() === normalizeText(name.value).trim();
  if (name && name.confidence >= NAME_CONFIDENCE_MIN) {
    add({ op: "set_slot", slot: "nome", value: name.value, confidence: name.confidence, sourceTurnId: turnId }, "nome");
  }

  // CPF chega sanitizado do ingest como token tipado com referencia opaca; o valor nunca entra no estado.
  //    entra no estado. Token VÁLIDO -> slot sensível `cpf` recebe SÓ a referência opaca (kind+final). Token
  //    INVÁLIDO -> NENHUM slot (o cérebro vê o token no bloco e pede correção curta). Formato, não frase. ──────
  const cpfToken = CPF_VALID_TOKEN_RX.exec(leadMessage);
  if (cpfToken && state.slots.cpf.status !== "known") {
    add({ op: "set_slot_ref", slot: "cpf", ref: { ref: cpfToken[1], kind: "cpf", last4: cpfToken[2] }, sourceTurnId: turnId }, "cpf");
  }
  const birthToken = BIRTH_DATE_VALID_TOKEN_RX.exec(leadMessage);
  if (birthToken && state.slots.birthDate?.status !== "known") {
    add({ op: "set_slot_ref", slot: "birthDate", ref: { ref: birthToken[1], kind: "birth_date", last4: null }, sourceTurnId: turnId }, "birthDate");
  }

  // interesse/tipoVeiculo (COMPRA) vêm de interestText — em contexto de troca é o ALVO DE COMPRA (nunca o carro de troca).
  // Uma apresentacao curta e um fato de identidade, nunca um modelo de compra.
  // Isso tambem limita uma entidade automotiva alucinada pela interpretacao LLM.
  const models = interestText && !nameOnlyTurn ? detectInterestModels(interestText, interpretation, claimExtractor) : [];
  if (models.length > 0) {
    const value = models.join(", ");
    const before = state.slots.interesse.status === "known" ? normalizeText(state.slots.interesse.value ?? "") : "";
    if (value && normalizeText(value) !== before) {
      add({ op: "set_slot", slot: "interesse", value, confidence: 0.9, sourceTurnId: turnId }, "interesse");
    }
  }

  const type = interestText ? parseVehicleType(interestText) : null;
  if (type) add({ op: "set_slot", slot: "tipoVeiculo", value: type, confidence: 0.95, sourceTurnId: turnId }, "tipoVeiculo");

  // ── MISSÃO P0 (Financial Question Context): CONTEXTO financeiro do turno. Pergunta pendente financeira (parcela/
  //    entrada/pagamento) OU financiamento em andamento (carro selecionado + entrada/pagamento/parcela conhecidos), SEM
  //    intenção de compra nova e SEM referência a veículo (tipo/modelo). Nesse contexto um número no range de ANO (2100)
  //    é VALOR (parcela), não ano — libera o parser monetário (financialContext). "Compass 2019" (tem veículo) fica ano.
  const newBuyIntent = hasExplicitNewCommercialSearchIntent(leadMessage, interpretation, claimExtractor);
  const paymentInProgress = state.vehicleContext.selected != null
    && (state.slots.entrada.status !== "unknown" || state.slots.formaPagamento.status !== "unknown" || state.slots.parcelaDesejada.status !== "unknown");
  const expectedIsFinancial = expected === "parcelaDesejada" || expected === "entrada" || expected === "formaPagamento";
  const msgHasVehicleRef = parseVehicleType(leadMessage) != null || detectInterestModels(leadMessage, interpretation, claimExtractor).length > 0;
  const financialContext = !newBuyIntent && !msgHasVehicleRef && (expectedIsFinancial || paymentInProgress);
  // Papéis monetários (item 3): por CLÁUSULA, order-independent. "unknown" (valor sem cue) só alimenta o slot monetário
  // PENDENTE. financialContext libera um número no range de ano como VALOR (ver moneySpans).
  const money = moneyByClause(leadMessage, financialContext);
  const unknownMoney = money.find((r) => r.role === "unknown")?.value;
  const roleVal = (role: MoneyRoleTag, slotForExpected: keyof ConversationState["slots"]): number | undefined =>
    money.find((r) => r.role === role)?.value ?? (expected === slotForExpected ? unknownMoney : undefined);
  // Respondendo parcela/entrada pendente (ou financiamento em andamento) SEM compra nova: o valor é a PARCELA/ENTRADA —
  // mesmo com cue "budget" ("até 1200") ou no range de ano ("até 2100") — NUNCA orçamento de compra (faixaPreco). Trade
  // real ("tenho um Renegade...") excluído. "quero Onix até 80 mil" (compra nova) VENCE e volta a alimentar faixaPreco.
  // Renda/salário descreve capacidade financeira, mas não responde qual é a
  // entrada nem qual parcela o cliente aceita. O valor continua disponível
  // para a LLM no bloco atual, porém não contamina slots com outro significado.
  const statesIncome = /\b(?:minha\s+)?renda\b|\bsal[aá]rio\b|\b(?:eu\s+)?(?:ganho|recebo)\b|\brendimento\b/.test(norm)
    && !/\bentrada\b|\bparcela\b|\bpresta[cç][aã]o\b/.test(norm);
  const financingValue = !statesIncome && paymentInProgress && expected !== "entrada" && expected !== "faixaPreco"
    && money.length > 0 && !statesTradeVehiclePossession(leadMessage, claimExtractor) && !newBuyIntent && !msgHasVehicleRef;
  const answeringParcela = !statesIncome && !newBuyIntent && (expected === "parcelaDesejada" || financingValue);
  const answeringEntrada = !statesIncome && !newBuyIntent && expected === "entrada";
  const explicitParcelaValue = money.find((item) => item.role === "parcela")?.value;
  const explicitEntradaValue = money.find((item) => item.role === "entrada")?.value;
  const contextualMoneyValue = money.find((item) => item.role === "unknown" || item.role === "budget")?.value;

  // Um papel explícito no bloco atual vence a pergunta pendente. Somente um
  // valor sem papel ("2 mil", "até 2 mil") herda o slot esperado.
  const parcelaVal = statesIncome ? undefined
    : explicitParcelaValue ?? (answeringParcela ? contextualMoneyValue : undefined);
  if (parcelaVal != null) add({ op: "set_slot", slot: "parcelaDesejada", value: parcelaVal, confidence: 0.9, sourceTurnId: turnId }, "parcelaDesejada");

  // LLM-first (missão SDR): NEGAÇÃO a uma pergunta de ENTRADA = entrada zero (MEMÓRIA, p/ o cérebro não repergunta e
  // seguir no financiamento). "não"/"tenho não"/"não tenho"/"não tenho dinheiro pra entrada"/"não dá"/"não consigo" -> 0.
  // Bare "não"/"tenho não" só quando entrada foi PERGUNTADA (expected); "... entrada" explícito vale mesmo espontâneo.
  const negationNamesTradeObject = /\b(?:carro|veiculo|troca)\b/.test(norm);
  const entradaNegada = !questionLike && (
    (expected === "entrada" && !negationNamesTradeObject && (/\btenho\s+nao\b|\bnao\s+tenho\b|\bnao\s+da\b|\bnao\s+consigo\b|\bnao\s+posso\b|\bsem\s+(?:dinheiro|grana|condic)/.test(norm) || /^(?:nao|nem)\b/.test(norm)))
    || /\bnao\s+(?:tenho|vou|posso|consigo|pretendo)\b[^.?!]{0,25}\bentrada\b|\bsem\s+condic[^.?!]{0,20}\bentrada\b/.test(norm)
  );
  if (!questionLike && (/\b(?:sem|nao tenho|zero de)\s+entrada\b|\bentrada\s+zero\b/.test(norm) || entradaNegada)) {
    add({ op: "set_slot", slot: "entrada", value: 0, confidence: entradaNegada ? 0.9 : 0.98, sourceTurnId: turnId }, "entrada");
  } else {
    const entradaVal = statesIncome ? undefined
      : explicitEntradaValue ?? (answeringEntrada ? contextualMoneyValue : undefined);
    if (entradaVal != null) add({ op: "set_slot", slot: "entrada", value: entradaVal, confidence: 0.9, sourceTurnId: turnId }, "entrada");
  }

  // faixaPreco (orçamento de COMPRA) NUNCA recebe o valor quando o lead está respondendo parcela/entrada (ver acima):
  // "até 1200" é a parcela/entrada, não um teto de preço de veículo. Só compra/busca/orçamento explícito alimenta faixaPreco.
  const budgetVal = (answeringParcela || answeringEntrada) ? undefined : roleVal("budget", "faixaPreco");
  if (budgetVal != null) add({ op: "set_slot", slot: "faixaPreco", value: { max: budgetVal }, confidence: 0.92, sourceTurnId: turnId }, "faixaPreco");

  const payment = parsePayment(leadMessage);
  if (payment && (expected === "formaPagamento" || /\ba vista\b|\bfinanc|\bparcel|\bconsorcio\b|\bpagamento\b/.test(norm))) {
    add({ op: "set_slot", slot: "formaPagamento", value: payment, confidence: 0.95, sourceTurnId: turnId }, "formaPagamento");
  }

  const explicitNoTrade = /\b(?:nao tenho|sem).{0,40}\b(?:carro|veiculo|troca)\b|\bnao.{0,60}\btroca\b/.test(norm);
  // Missão P0: "X para/de/na troca", "dar/dou de/na troca" também é TROCA (test 10: "tenho um Onix para troca, mas quero SUV").
  const explicitTrade = !explicitNoTrade && (/\b(?:tenho|possuo).{0,25}\b(?:carro|veiculo).{0,20}\btroca\b|\b(?:carro|veiculo)\s+(?:para|pra)\s+troca\b/.test(norm)
    || /\b(?:para|pra|de|na)\s+troca\b|\bdar\s+(?:de\s+|na\s+)?troca\b|\bdou\s+(?:de\s+|na\s+)?troca\b/.test(norm));
  // R11-A1 (Codex): um PEDIDO de compra ("Quero SUV até 70 mil", "quero um Gol") NÃO é resposta booleana de troca.
  // Sem isto, com objetivo 'possuiTroca' pendente, parseBooleanAnswer("quero...") virava possuiTroca=true ESPÚRIO
  // (memória corrompida -> objetivo trocava sem base). "tenho um Gol" (verbo de POSSE) continua sendo troca=sim.
  const buyVerb = /\b(quero|procuro|busco|prefiro|mostra|me ve|gostaria de ver|estou procurando|to procurando|gostei|curti|me interess(?:ou|ei)|tenho interesse)\b/.test(norm);
  const mentionsVehicle = parseVehicleType(leadMessage) != null || /\b(carro|veiculo|modelo)\b/.test(norm) || /\b\d{1,3}\s*mil\b/.test(norm)
    || claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model");
  const looksLikeBuyRequest = (buyVerb || availabilityQ) && mentionsVehicle;   // "tem Renegade?" também é compra, não troca
  // LLM-first (missão): "tenho não"/"não tenho"/"não possuo" respondendo à pergunta de TROCA = NÃO (possuiTroca=false).
  // parseBooleanAnswer("tenho não") casaria "tenho"->true (ERRADO); por isso a negação explícita vem ANTES. Mata a
  // repetição vista no eval real (agente repetia "tem carro pra troca?" porque não entendeu "tenho não").
  // ⭐SEM (incidente real 2026-07-10: "Mas não tenho entrada" -> possuiTroca=false FANTASMA, que depois BLOQUEOU a
  // pergunta legítima de troca e derrubou o turno em fallback): negação de posse NUA só responde TROCA com VÍNCULO —
  // pergunta pendente de troca OU o bloco fala de troca/carro/veículo. Negação com OUTRO objeto explícito (entrada/
  // parcela/valor/condições) pertence àquele contexto e NUNCA vira troca (invariante 3: uma negação nunca responde
  // outro slot sem vínculo com a última pergunta aceita).
  const trocaNegRaw = /\btenho\s+nao\b|\bnao\s+tenho\b|\bnao\s+possuo\b|\bpossuo\s+nao\b/.test(norm);
  const negationTargetsOtherObject = /\bnao\s+(?:tenho|possuo)\s+(?:entrada|parcela|valor|dinheiro|grana|condicao|condicoes)\b/.test(norm);
  const tradeNegContext = expected === "possuiTroca" || expected === "veiculoTroca" || /\btroca\b|\bcarro\b|\bveiculo\b/.test(norm);
  const trocaNeg = trocaNegRaw && !negationTargetsOtherObject && tradeNegContext;
  const trocaPos = !trocaNeg && /\btenho\s+sim\b|\bpossuo\s+sim\b/.test(norm);
  // ⭐F2.43 (audit Codex): resposta FINANCEIRA ("Tenho 8k de entrada", "tenho 5 mil") à pergunta de TROCA não é
  // booleano de troca — o "tenho" é do DINHEIRO. Com valor monetário no bloco e SEM menção a carro/troca/modelo,
  // NÃO infere posse (paralelo do R11-A1 p/ compra); o valor vai aos slots financeiros e a troca segue sem resposta.
  const mentionsVehicleWord = parseVehicleType(leadMessage) != null || /\b(carro|veiculo|modelo|troca)\b/.test(norm)
    || claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model");
  const looksLikeMoneyAnswer = leadStatedMoneyValues(leadMessage).length > 0 && !mentionsVehicleWord;
  let deniedTradeVehicle = false;
  const tradeCandidate = tradeVehicle(preBuyText || leadMessage, claimExtractor);
  const tradeVehicleDescribed = tradeCandidate != null && tradeCandidate.modelo != null && (tradeCandidate.ano != null || tradeCandidate.km != null);
  // ⭐SEM: PERGUNTA do lead ("vocês não aceitam troca?") nunca é RESPOSTA de troca — mas o guard vale POR CLÁUSULA:
  // num bloco misto ("Não tenho carro pra troca / tem SUV até 100k?") a negação está em statement e SEGUE válida
  // (caso P0-1f da F2.44); só anula quando a PRÓPRIA cláusula da negação é interrogativa.
  const tradeNegRx = /\b(?:nao tenho|sem)\b.{0,40}\b(?:carro|veiculo|troca)\b|\bnao\b.{0,60}\btroca\b|\btenho\s+nao\b|\bnao\s+tenho\b|\bnao\s+possuo\b|\bpossuo\s+nao\b/;
  const tradeNegClauseIsQuestion = leadMessage.split(/(?<=[.!?\n])/).some((clause) => {
    if (!tradeNegRx.test(normalizeText(clause))) return false;
    return clause.trim().endsWith("?") || leadAsksQuestion(clause);
  });
  const noTradeAnswer = !tradeNegClauseIsQuestion && (explicitNoTrade || trocaNeg);
  // Pergunta pendente de troca NÃO transforma qualquer frase afirmativa em "possui troca". A resposta booleana nua só
  // vale quando o bloco não está explicitamente respondendo outro objeto do funil (entrada/parcela/financiamento) nem
  // iniciando uma compra. Isto mata: pergunta de troca -> "quero financiar ele, mas não tenho entrada" -> troca=true.
  const pendingTradeBooleanAnswer = expected === "possuiTroca" && !questionLike
    && !negationTargetsOtherObject && !looksLikeMoneyAnswer && !looksLikeBuyRequest
    && parseBooleanAnswer(leadMessage) != null;
  // Um veiculo concreto declarado como posse em resposta ao contexto de troca
  // confirma a posse por si so. O modelo capturado e a evidência estrutural;
  // exigir ainda um "sim" deixava veiculoTroca preenchido com possuiTroca
  // desconhecido. Perguntas de disponibilidade e clausulas de compra continuam
  // excluidas pelo contexto e por looksLikeBuyRequest.
  const ownedTradeVehicleAnswer = !questionLike && !looksLikeBuyRequest
    && (expected === "possuiTroca" || expected === "veiculoTroca")
    && tradeCandidate?.modelo != null
    && /\b(?:tenho|possuo|meu|minha)\b/.test(normalizeText(preBuyText || leadMessage));
  const positiveTradeAnswer = !questionLike && (explicitTrade || offersTradeByPossession || tradeVehicleDescribed || ownedTradeVehicleAnswer || pendingTradeBooleanAnswer);
  if (noTradeAnswer || positiveTradeAnswer) {
    const value = (explicitNoTrade || trocaNeg) ? false
      : (explicitTrade || trocaPos || offersTradeByPossession || ownedTradeVehicleAnswer || (expected === "possuiTroca" && tradeVehicleDescribed)) ? true
      : ((looksLikeBuyRequest || looksLikeMoneyAnswer || negationTargetsOtherObject) ? null : parseBooleanAnswer(leadMessage));
    if (value != null) {
      if (value === false) deniedTradeVehicle = true;
      add({ op: "set_slot", slot: "possuiTroca", value, confidence: expected === "possuiTroca" ? 0.9 : 0.96, sourceTurnId: turnId }, "possuiTroca");
    }
  }

  // Missão P0 INC3/C: captura o VEÍCULO de troca no MESMO turno em que o lead confirma a troca e já dá o carro ("Tenho / um
  // Renegade / 2019 / 86km" respondendo "tem carro pra troca?"). Antes o gate lia possuiTroca PRÉ-turno e perdia o veículo.
  // Contexto de troca ATIVO = pergunta pendente de troca (possuiTroca/veiculoTroca) OU já confirmou OU frase explícita de
  // troca no bloco. NÃO captura quando negou a troca ("não tenho"). O tradeVehicle já retorna null sem dados de veículo.
  // Missão P0 (audit Codex): só captura o veículo de troca quando há sinal REAL de POSSE/troca no trecho de troca
  // (tenho/possuo/"para troca") OU o agente pediu explicitamente os DADOS do carro de troca (expected=veiculoTroca).
  // Extrai do preBuyText (parte de troca) — nunca do alvo de compra. "tem Renegade?"/"quero um Renegade" (COMPRA) NÃO viram troca.
  const tradeContextActive = !asksVehicleAvailability && (expected === "veiculoTroca" || expected === "possuiTroca" || state.slots.possuiTroca.value === true || explicitTrade || offersTradeByPossession || tradeVehicleDescribed);
  const possessionSignal = /\b(tenho|possuo|meu|minha)\b/.test(normalizeText(preBuyText)) || tradePhrase || (expected === "possuiTroca" && tradeVehicleDescribed);
  const captureTrade = !deniedTradeVehicle && (expected === "veiculoTroca" || (tradeContextActive && possessionSignal));
  if (captureTrade) {
    const vehicle = tradeCandidate ?? tradeVehicle(preBuyText || leadMessage, claimExtractor);
    if (vehicle) add({ op: "set_slot", slot: "veiculoTroca", value: vehicle, confidence: 0.86, sourceTurnId: turnId }, "veiculoTroca");
  }

  // Uma negacao de origem ("nao sou de Guaratingueta") nao pode cair no
  // fallback de cidade nua apenas porque a pergunta anterior era sobre cidade.
  // A semantica negativa vence ambas as formas de extracao.
  const cityNegated = negatesOwnCity(leadMessage);
  const city = (!questionLike && !cityNegated ? explicitCity(leadMessage) : null)
    ?? (expected === "cidade" && !questionLike && !cityNegated ? bareCityAnswer(leadMessage, claimExtractor) : null);
  if (city) add({ op: "set_slot", slot: "cidade", value: titleCase(city), confidence: expected === "cidade" ? 0.86 : 0.95, sourceTurnId: turnId }, "cidade");

  if (expected === "conheceLoja" || /\b(?:conheco|ja fui|nunca fui).{0,20}\bloja\b/.test(norm)) {
    // ⭐SEM (incidente real: "tem SUV?" respondendo a saudação com "já conhece a loja?" virou conheceLoja=true):
    // frase EXPLÍCITA ("conheço"/"já fui"/"nunca fui") vale sempre; resposta booleana NUA só quando o bloco NÃO é
    // uma pergunta nova do lead (pergunta não responde slot pendente — invariante 3).
    const explicit = /\bnunca fui\b|\bnao conheco\b/.test(norm) ? false : /\bconheco\b|\bja fui\b/.test(norm) ? true : null;
    const value = explicit ?? (questionLike ? null : parseBooleanAnswer(leadMessage));
    if (value != null) add({ op: "set_slot", slot: "conheceLoja", value, confidence: 0.9, sourceTurnId: turnId }, "conheceLoja");
  }

  // P0-5 + H2 (audit): visita = FATO explícito do lead em TRÊS estados. "quero o terceiro"/"quero fotos" =
  // seleção/mídia, NÃO visita (refersVehicleOrMedia).
  const refersVehicleOrMedia = /\b(?:primeir|segund|terceir|quart|quint|ultim)[oa]\b|\bo\s+\d+\b|\bop[cç][aã]o\b|\bfotos?\b|\bimagens?\b|\bv[ií]deos?\b/.test(norm);
  const visitIntentPresent = VISIT_INTENT_RX.test(norm);
  const visitRefusal = containsVisitRefusal(leadMessage);
  // A weekday can share spelling with a feminine ordinal ("segunda"). It is
  // only a vehicle reference when the hardened ordinal parser accepts it.
  const vehicleOrMediaConflict = refersVehicleOrMedia
    && !(visitIntentPresent && parseOrdinal(leadMessage) == null);
  // Intenção POSITIVA: cita o ato de visitar E não é recusa E não é seleção/mídia. "quero visitar mais tarde" -> true
  // ("mais tarde" é período vago, não recusa; só não vira diaHorario concreto — ver extractDayPeriod).
  const positiveVisit = visitIntentPresent && !visitRefusal && !vehicleOrMediaConflict;
  // ADIAMENTO só conta quando NÃO há intenção positiva nem recusa (senão "quero visitar mais tarde" cairia aqui).
  const postpone = !positiveVisit && !visitRefusal && VISIT_POSTPONE_RX.test(norm);
  if (visitRefusal || positiveVisit || expected === "interesseVisita" || visitIntentPresent) {
    // recusa -> false; intenção -> true; adiamento -> NÃO grava (null); senão booleana pura só se o slot foi perguntado.
    const value = visitRefusal ? false
      : positiveVisit ? true
      : postpone ? null
      : vehicleOrMediaConflict ? null
      : expected === "interesseVisita" ? parseBooleanAnswer(leadMessage)
      : null;
    if (value != null) add({ op: "set_slot", slot: "interesseVisita", value, confidence: 0.9, sourceTurnId: turnId }, "interesseVisita");
  }
  // diaHorario: captura o dia/período quando HÁ intenção POSITIVA de visita OU o agente perguntou o dia (mesmo turno).
  // extractDayPeriod ignora "mais tarde"/"mais cedo" (período vago), então "quero visitar mais tarde" não grava horário.
  // ⭐P0-A: VISITA em andamento (interesseVisita=true) — um valor temporal ("às 15h") registra/compõe o diaHorario MESMO
  // que o agente tenha perguntado outro slot (ex.: o nome). Robustez da composição: o horário não se perde por causa da
  // pergunta pendente. extractDayPeriod/visitScheduleAnswer só casam dia/horário, então respostas financeiras não vazam.
  const visitInProgress = state.slots.interesseVisita.status === "known" && state.slots.interesseVisita.value === true;
  if (expected === "diaHorario" || positiveVisit || visitInProgress) {
    const answer = extractDayPeriod(leadMessage) ?? ((expected === "diaHorario" || visitInProgress) ? visitScheduleAnswer(leadMessage) : null);
    if (answer) {
      // ⭐P0-A: compõe com o diaHorario já conhecido (dia + horário em turnos separados) sem apagar a outra dimensão.
      const existing = state.slots.diaHorario.status === "known" && typeof state.slots.diaHorario.value === "string" ? state.slots.diaHorario.value : null;
      add({ op: "set_slot", slot: "diaHorario", value: composeSchedule(existing, answer), confidence: 0.82, sourceTurnId: turnId }, "diaHorario");
    }
  }

  if (args.allowVehicleSelection !== false) {
    const selectedVehicle = resolveSelectedVehicle(leadMessage, state, claimExtractor);
    if (selectedVehicle) muts.push({ op: "select_vehicle_focus", vehicle: selectedVehicle, sourceTurnId: turnId });
  }

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
