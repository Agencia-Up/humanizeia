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

export function extractLeadSlots(args: {
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly interpretation: TurnInterpretation | null | undefined;
  readonly claimExtractor: ClaimExtractor;
  readonly turnId: Id;
}): DecisionMutation[] {
  const { leadMessage, state, interpretation, claimExtractor, turnId } = args;
  const muts: DecisionMutation[] = [];

  const name = extractName(leadMessage, state, claimExtractor);
  if (name && name.confidence >= NAME_CONFIDENCE_MIN) {
    muts.push({ op: "set_slot", slot: "nome", value: name.value, confidence: name.confidence, sourceTurnId: turnId });
    if (state.currentObjective?.slot === "nome" && state.currentObjective.status === "pending") {
      muts.push({ op: "resolve_objective", objectiveId: state.currentObjective.id, status: "satisfied" });
    }
  }

  const models = detectInterestModels(leadMessage, interpretation, claimExtractor);
  if (models.length > 0) {
    // Interesse e a intencao comercial ATUAL, nao historico acumulativo. Isso evita memoria poluida
    // como "onix, renegade, argo, hb 20, 3, jeep" vencer o turno atual.
    const value = models.join(", ");
    const before = state.slots.interesse.status === "known" ? normalizeText(state.slots.interesse.value ?? "") : "";
    if (value && normalizeText(value) !== before) {
      muts.push({ op: "set_slot", slot: "interesse", value, confidence: 0.9, sourceTurnId: turnId });
    }
  }

  return muts;
}
