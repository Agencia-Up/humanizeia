// ============================================================================
// lead-extraction.ts — F2.7.7. Camada DETERMINISTICA + SEGURA de captura de slots
// a partir da fala do lead. O LLM NAO emite mutacoes (segue facts:[]); este modulo
// PURO transforma o bloco do lead em DecisionMutation[] VALIDAS, e o engine as injeta
// (mesma fonte unica do append_lead_turn). So emite o que o reducer aceita -> nunca
// derruba o turno. Sem if por frase: invariantes (padrao de nome, stoplist, objetivo).
//
// Captura:
//  - NOME: padrao explicito ("meu nome e X") OU objetivo de nome pendente + token limpo
//    (alfabetico, fora da stoplist, nao-veiculo); normaliza "dOUGLAS" -> "Douglas".
//  - INTERESSE: modelos citados no bloco -> slots.interesse (formato documentado: lista
//    normalizada unida por ", "; NUNCA apaga um modelo pelo outro). Sem novo contrato de estado.
//  - resolve_objective: se o objetivo pendente pede o nome e capturamos, marca satisfied.
// ============================================================================
import type { ConversationState, PendingObjective } from "../domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, TurnInterpretation } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import { normalizeText } from "./catalog-utils.ts";

// Palavras comuns que NAO sao nome (normalizadas, sem acento). Invariante geral.
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
  if (isVehicleTerm(token, claimExtractor)) return false; // nao confundir modelo com nome
  return true;
}

const NAME_PATTERN = /(?:meu nome (?:é|e|eh)|me chamo|pode me chamar de|sou o|sou a|aqui (?:é|e|eh) o|quem fala (?:é|e|eh))\s+(\p{L}[\p{L}'’ -]{1,40})/iu;

function extractName(
  leadMessage: string,
  currentObjective: PendingObjective | null | undefined,
  slots: ConversationState["slots"],
  claimExtractor: ClaimExtractor,
): { value: string; confidence: number } | null {
  if (slots.nome.status === "known") return null; // ja conhecido -> nao recaptura

  // 1) Padrao explicito de apresentacao (vale mesmo sem objetivo).
  const m = NAME_PATTERN.exec(leadMessage);
  if (m) {
    const valid = m[1].trim().split(/\s+/).slice(0, 3).filter((w) => isNameToken(w, claimExtractor));
    if (valid.length > 0) return { value: titleCase(valid.join(" ")), confidence: 0.95 };
  }

  // 2) Objetivo pedindo o nome + linha com nome "pelado" (1-3 tokens, todos limpos).
  const objAskingName = currentObjective?.slot === "nome" && currentObjective.status === "pending";
  if (objAskingName) {
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

// Modelos citados no bloco (catalogo via claimExtractor + interpretacao single/multi). Normalizados.
export function detectInterestModels(
  leadMessage: string,
  interpretation: TurnInterpretation | null | undefined,
  claimExtractor: ClaimExtractor,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null | undefined): void => {
    const n = normalizeText(raw ?? "");
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  };
  for (const c of claimExtractor.extractClaims(leadMessage)) {
    if (c.kind === "model" || c.kind === "brand_model") add(c.normalized);
  }
  add(interpretation?.extractedEntities?.model);
  for (const m of interpretation?.extractedEntities?.models ?? []) add(m);
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

  // ── NOME (+ resolve do objetivo) ──
  const name = extractName(leadMessage, state.currentObjective, state.slots, claimExtractor);
  if (name && name.confidence >= NAME_CONFIDENCE_MIN) {
    muts.push({ op: "set_slot", slot: "nome", value: name.value, confidence: name.confidence, sourceTurnId: turnId });
    if (state.currentObjective?.slot === "nome" && state.currentObjective.status === "pending") {
      muts.push({ op: "resolve_objective", objectiveId: state.currentObjective.id, status: "satisfied" });
    }
  }

  // ── INTERESSE (multi-modelo, formato documentado, sem apagar) ──
  const models = detectInterestModels(leadMessage, interpretation, claimExtractor);
  if (models.length > 0) {
    const existing = state.slots.interesse.status === "known" && state.slots.interesse.value
      ? state.slots.interesse.value.split(",").map((s) => normalizeText(s)).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existing, ...models]));
    const value = merged.join(", ");
    const before = state.slots.interesse.status === "known" ? normalizeText(state.slots.interesse.value ?? "") : "";
    if (value && normalizeText(value) !== before) {
      muts.push({ op: "set_slot", slot: "interesse", value, confidence: 0.9, sourceTurnId: turnId });
    }
  }

  return muts;
}
