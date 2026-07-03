// ============================================================================
// continuity-fallback.ts — F2.7.11 (P0). Duas garantias:
//
//  (Task 2) `buildContextualSdrReply(state)`: o texto que vai pro LEAD num fallback (terminal-safe
//    de validacao/grounding/erro) NUNCA pode ser a frase tecnica "Desculpe a lentidao...". E um
//    fallback de SDR conduzido pelo ESTADO (oferta recente / interesse conhecido / descoberta).
//    O `reason_code` interno do decision pode seguir terminal_safe (logs), mas o texto e comercial.
//
//  (Task 3) Guard de CONTINUIDADE: saudacao/ack/comentario curto SEM nova intencao comercial, em
//    conversa JA iniciada -> resposta deterministica que CONDUZ a partir do contexto, sem reiniciar,
//    sem reapresentar, sem ofertar ungrounded (que virava terminal-safe). Por CLASSE de termo, nao
//    por frase especifica.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, ProposedDecision, QueryResult } from "../domain/decision.ts";
import type { Id } from "../domain/types.ts";
import type { TurnOutput, QueryRunner } from "./decision-engine.ts";
import { finalize } from "./finalizer.ts";
import { normalizeText } from "./catalog-utils.ts";
import { turnHasNewCommercialIntent } from "./explicit-search.ts";

const FALLBACK_MARKER = /desculpe a lentid/i; // fallback tecnico antigo: NUNCA reusar como "oferta"

// Houve oferta/lista REAL recente do agente? (R$ / item numerado / "separei…/disponivel"), ignorando o
// proprio fallback antigo. recentTurns e accepted-safe (populado mesmo com delivered bloqueado — issue C).
function recentAgentOffered(state: ConversationState): boolean {
  for (const turn of (state.recentTurns ?? []).slice(-8)) {
    if (turn.role !== "agent") continue;
    const t = turn.text ?? "";
    if (FALLBACK_MARKER.test(t)) continue;
    if (/R\$\s?\d/.test(t) || /(^|\n)\s*\d\.\s/.test(t) || /separei|dispon[ií]ve/i.test(t)) return true;
  }
  return false;
}

function alreadyIntroduced(state: ConversationState): boolean {
  return (state.recentTurns ?? []).some((t) => t.role === "agent") || (state.turnNumber ?? 1) > 1;
}

function knownInteresse(state: ConversationState): string | null {
  const s = (state.slots as any)?.interesse;
  return s && s.status === "known" && typeof s.value === "string" && s.value.trim() !== "" ? s.value : null;
}

// Textos RECENTES do AGENTE (normalizados) para anti-repetição do fallback. Olha as últimas K falas do
// agente, não só a imediatamente anterior: no piloto "fotos/filtre" repetia em T6 e T8 (T7 era uma foto no
// meio), escapando de uma checagem de 1 turno só. recentTurns é accepted-safe.
function recentAgentTextsNorm(state: ConversationState, k = 4): Set<string> {
  const out = new Set<string>();
  const turns = state.recentTurns ?? [];
  for (let i = turns.length - 1; i >= 0 && out.size < k; i--) {
    if (turns[i]?.role === "agent") out.add(normalizeText(turns[i]?.text ?? ""));
  }
  return out;
}

// Escolhe a 1a variante que NÃO repete (normalizado) NENHUMA das falas recentes do agente. Se todas
// repetirem (improvável), cai na 1a. A variação é intencional: o juiz penaliza repetição e "não variou".
function pickVaried(candidates: readonly string[], recentNorm: Set<string>): string {
  for (const c of candidates) {
    if (!recentNorm.has(normalizeText(c))) return c;
  }
  return candidates[0] ?? "";
}

// Sinal FORTE de avanço do lead (comprar/fechar/visitar) — o fallback NÃO pode reabrir descoberta genérica
// (bug r3: lead "Quero comprar agora" recebia "Me conta o que você procura"). Conduz para o próximo passo.
const FORWARD_SIGNAL = /\b(quero comprar|comprar agora|fechar( negocio)?|vou levar|quero (levar|esse|essa|ele|ela)|pode ser (esse|essa|esse mesmo)|bora|agendar|visitar|marcar( a)? visita)\b/;

// Fallback SDR conduzido pelo estado (Task 2). NUNCA mensagem de sistema. Agora ANTI-REPETIÇÃO (varia a
// formulação vs. a última fala do agente) e ciente do SINAL do lead (avanço de compra não vira descoberta).
export function buildContextualSdrReply(state: ConversationState, opts: { readonly leadMessage?: string } = {}): string {
  const recentNorm = recentAgentTextsNorm(state);
  const lead = normalizeText(opts.leadMessage ?? "");
  if (lead && FORWARD_SIGNAL.test(lead)) {
    return pickVaried([
      "Show, vamos avançar! Pra eu já verificar a disponibilidade, me confirma: qual carro (ou tipo) você quer?",
      "Perfeito! Me diz qual modelo ou tipo você tem em mente que eu já deixo tudo encaminhado pra gente seguir.",
    ], recentNorm);
  }
  if (recentAgentOffered(state)) {
    return pickVaried([
      "Quer ver as fotos de algum desses, ou prefere que eu filtre por valor, câmbio ou ano?",
      "Algum desses te chamou a atenção? Posso mandar as fotos ou refinar por preço, câmbio ou ano.",
      "Quer que eu detalhe algum desses pra você, ou busco outras opções?",
    ], recentNorm);
  }
  const interesse = knownInteresse(state);
  if (interesse) {
    return pickVaried([
      `Sobre o que você comentou (${interesse}) — quer que eu te mostre as opções no estoque, veja as fotos, ou prefere já agendar uma visita?`,
      `Posso te mostrar agora o que temos de ${interesse}. Prefere ver as opções ou já agendar uma visita?`,
    ], recentNorm);
  }
  return pickVaried([
    "Me conta o que você procura — um modelo específico, uma faixa de preço ou um tipo (SUV, hatch, sedan)? Aí já busco no nosso estoque.",
    "Pra eu buscar certinho: você tem um modelo em mente, um tipo (SUV, hatch, sedan) ou uma faixa de preço?",
  ], recentNorm);
}

// Continuidade (Task 3): saudacao/ack/reacao curta. Por CLASSE (sem if por frase).
const CONTINUITY = /\b(bom dia|boa tarde|boa noite|ola|oi|opa|eai|e ai|ok|okay|certo|entendi|entendido|beleza|blz|show|massa|tranquil\w*|perfeito|isso|uhum|aham|valeu|obrigad\w*|fechou|combinado|bonit\w*|lind\w*|gostei|legal|interessante|bacana|maneiro|top|otim\w*|que bom|nossa|adorei|amei|curti|de boa)\b/;
// Sinais de NOVA intencao comercial -> NAO e continuidade (deixa handlers/LLM): foto, preco/estoque, agenda, tipo.
const COMMERCIAL_SIGNAL = /\bfotos?\b|\bimagens?\b|\bbarat|\bpopular|\bvendid|\bprocurad|\bpreco|\bvalor|\bquanto|\bparcel|\bfinanc|\btroca|\bfaixa|\bsuv\b|\bhatch\b|\bsedan\b|\bagendar|\bvisita|\bdetalhe/;

export function detectContinuityIntent(args: { readonly leadMessage: string; readonly state: ConversationState; readonly claimExtractor: ClaimExtractor }): boolean {
  const { leadMessage, state, claimExtractor } = args;
  if (!alreadyIntroduced(state)) return false; // 1o contato -> LLM faz a saudacao inicial (nao curto-circuita)
  if (turnHasNewCommercialIntent(leadMessage, claimExtractor)) return false; // F2.7.13: marca/modelo/tipo/faixa NAO e continuidade
  const norm = normalizeText(leadMessage);
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false; // continuidade = mensagem CURTA
  if (!CONTINUITY.test(norm)) return false;
  if (COMMERCIAL_SIGNAL.test(norm)) return false; // tem intencao comercial nova
  if (claimExtractor.extractClaims(leadMessage).some((c) => c.kind === "model" || c.kind === "brand_model")) return false; // nomeou veiculo
  return true;
}

// R12-A (Codex): a continuidade/reação do lead PASSA PELO COMPOSE (o frame do conductor governa a condução),
// em vez do menu robótico legado (applySdrConduction). Para o compose citar o veículo em jogo SEM violar o
// grounding, buscamos os FATOS do veículo SELECIONADO (vehicle_details) — nome/preço/atributos aterrados.
// Sem seleção, facts=[] e o frame conduz o funil sem citar veículo específico. PURO exceto a query (runQuery).
export async function resolveContinuityFacts(args: {
  readonly state: ConversationState;
  readonly runQuery: QueryRunner;
}): Promise<QueryResult[]> {
  const selectedKey = args.state.vehicleContext.selected?.key;
  if (!selectedKey) return [];
  try {
    const res = await args.runQuery({ tool: "vehicle_details", input: { vehicleKey: selectedKey } });
    return res.ok ? [res] : [];
  } catch {
    return [];
  }
}

// R12-A: guidance BASE curta — o frame (conductDecision) injeta a condução REAL (funil/buy-signal/uma-pergunta).
// O texto FINAL é composto pelo LLM seguindo o prompt do portal; `fallbackText` (SDR contextual) SÓ entra em
// falha de compose/policy. Antes este handler cuspia `buildContextualSdrReply` direto (menu robótico) e caía no
// applySdrConduction; agora é `needsCompose=true` e nunca reconduz duas vezes.
const CONTINUITY_GUIDANCE =
  "O lead mandou uma mensagem curta de reacao/continuidade (nao e busca nova). NAO reinicie a conversa nem " +
  "reapresente. Reconheca o que ele disse e CONDUZA a partir do contexto (proximo passo do funil ou do veiculo " +
  "em foco), de forma natural, com no maximo UMA pergunta.";

export function buildContinuityTurnOutput(
  state: ConversationState,
  turnId: Id,
  opts: { readonly facts?: QueryResult[]; readonly leadMessage?: string } = {},
): TurnOutput {
  const facts = opts.facts ?? [];
  const fallbackText = buildContextualSdrReply(state, { leadMessage: opts.leadMessage });
  const proposal: ProposedDecision = {
    proposedAction: "reply",
    facts: [],
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }],
    responsePlan: { guidance: CONTINUITY_GUIDANCE },
    reasonCode: "continuity_conduct",
    reasonSummary: "Continuidade/reacao do lead — conduz pelo frame (compose), sem menu robotico.",
    confidence: 1,
  };
  const decision = finalize(turnId, proposal, [{ policyId: "POL-CONTINUITY", outcome: "allow" }], facts);
  return {
    decision,
    composed: { draft: { parts: [{ type: "text", content: fallbackText }] }, text: fallbackText },
    facts,
    loopExhausted: false,
    terminalSafe: false,
    steps: 0,
    needsCompose: true,
    fallbackText,
  };
}
