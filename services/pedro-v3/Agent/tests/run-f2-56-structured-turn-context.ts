// ============================================================================
// F2.56 - Contexto estruturado do turno atual: memoria ajuda a LLM a entender
// referencias da lista e respostas curtas; nunca escolhe busca ou resposta.
// ============================================================================
import { createInitialPersistedWorkingMemory, type TurnUnderstanding } from "../src/domain/agent-brain.ts";
import { createInitialState, type ConversationState } from "../src/domain/conversation-state.ts";
import type { ClaimExtractor } from "../src/domain/decision.ts";
import { buildConversationContext } from "../src/engine/conversation-context.ts";
import { buildTurnFrame } from "../src/engine/turn-frame-builder.ts";
import { authorizesPhotoByResolvedTarget, resolveTurnTarget } from "../src/engine/turn-understanding.ts";
import { buildWorkingMemory } from "../src/engine/working-memory.ts";

let ok = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok += 1;
    console.log(`  OK  ${name}`);
    return;
  }
  failed += 1;
  failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`);
}

const NOW = "2026-07-15T12:00:00.000Z";
const noClaims: ClaimExtractor = { extractClaims: () => [] };
const knownModels = new Map<string, { marca: string; modelo: string }>();

function stateWithOffer(items: ConversationState["lastRenderedOfferContext"] extends infer _ ? NonNullable<ConversationState["lastRenderedOfferContext"]>["items"] : never): ConversationState {
  const state = createInitialState({ conversationId: "wa:test", tenantId: "tenant", agentId: "agent", now: NOW });
  return {
    ...state,
    recentTurns: [
      { role: "agent", text: "Qual carro da lista voce quer ver as fotos?", at: NOW },
    ],
    lastRenderedOfferContext: { sourceTurnId: "offer-turn", createdAt: NOW, items },
  };
}

function understanding(subjectValue: string): TurnUnderstanding {
  return {
    primaryIntent: "request_photos",
    requestedCapabilities: ["send_photos"],
    subject: "offer_reference",
    subjectValue,
    subjectSource: "memory",
    evidence: [{ capability: "send_photos", quote: subjectValue }],
    isTopicChange: false,
    answeredLeadQuestions: [],
  };
}

function main(): void {
  console.log("== F2.56 Contexto estruturado do turno ==");

  const state = stateWithOffer([
    { ordinal: 1, vehicleKey: "rm:corolla-2015", marca: "Toyota", modelo: "Corolla", ano: 2015, cor: "Preto", preco: 87990, cambio: "Automatico", tipo: "sedan" },
    { ordinal: 2, vehicleKey: "rm:corolla-2016", marca: "Toyota", modelo: "Corolla", ano: 2016, cor: "Azul", preco: 89990, cambio: "Automatico", tipo: "sedan" },
    { ordinal: 3, vehicleKey: "rm:cruze-2020", marca: "Chevrolet", modelo: "Cruze", ano: 2020, cor: "Prata", preco: 96990, cambio: "Automatico", tipo: "sedan" },
  ]);
  const persisted = {
    ...createInitialPersistedWorkingMemory(),
    pendingAgentQuestion: { slot: "possuiTroca", sinceTurnId: "turn-trade" },
    lastResolvedSlotAnswer: { slot: "nome", turnId: "turn-name" },
    conversationSummary: "Lead viu sedans e pediu fotos de um item da lista.",
  };
  const memory = buildWorkingMemory(state, persisted).memory;
  const context = buildConversationContext({ state, workingMemory: memory });

  check("[A] preserva pergunta pendente, ultima fala e resumo", context.pendingAgentQuestion?.slot === "possuiTroca"
    && context.lastAgentMessage === "Qual carro da lista voce quer ver as fotos?"
    && context.conversationSummary?.includes("sedans") === true);
  check("[B] ultima lista leva atributos aterrados", context.lastVisibleOffer?.items.length === 3
    && context.lastVisibleOffer.items[1]?.modelo === "Corolla"
    && context.lastVisibleOffer.items[1]?.ano === 2016
    && context.lastVisibleOffer.items[1]?.cor === "Azul");

  const frame = buildTurnFrame({
    turnId: "turn-current",
    now: NOW,
    block: "Me mostra o azul",
    portalPromptSha256: "sha",
    workingMemory: memory,
    interpretation: { relation: "ambiguous" },
    state,
  });
  check("[C] TurnFrame entrega o mesmo contexto estruturado ao cerebro", frame.conversationContext.lastVisibleOffer?.items[1]?.vehicleKey === "rm:corolla-2016"
    && frame.conversationContext.pendingAgentQuestion?.slot === "possuiTroca");

  const blue = resolveTurnTarget({ understanding: understanding("azul"), leadMessage: "Me mostra o azul", state, claimExtractor: noClaims, knownModels });
  check("[D] referencia unica por cor resolve o item visivel sem nova busca", blue.kind === "resolved"
    && blue.vehicleKey === "rm:corolla-2016"
    && blue.source === "turn_offer_reference", JSON.stringify(blue));
  check("[D2] resposta a pergunta de foto aceita a referencia estruturada", authorizesPhotoByResolvedTarget(blue, "Me mostra o azul", state));

  const year = resolveTurnTarget({ understanding: understanding("Corolla 2016"), leadMessage: "Me manda fotos do Corolla 2016", state, claimExtractor: noClaims, knownModels });
  check("[E] modelo e ano citados juntos restringem ao item exato", year.kind === "resolved"
    && year.vehicleKey === "rm:corolla-2016", JSON.stringify(year));

  const ambiguousState = stateWithOffer([
    { ordinal: 1, vehicleKey: "rm:onix-blue-1", marca: "Chevrolet", modelo: "Onix", ano: 2024, cor: "Azul", preco: 71990 },
    { ordinal: 2, vehicleKey: "rm:onix-blue-2", marca: "Chevrolet", modelo: "Onix", ano: 2025, cor: "Azul", preco: 76990 },
  ]);
  const ambiguous = resolveTurnTarget({ understanding: understanding("azul"), leadMessage: "Mostra o azul", state: ambiguousState, claimExtractor: noClaims, knownModels });
  check("[F] referencia ainda ambigua nao escolhe carro arbitrario", ambiguous.kind === "ambiguous"
    && ambiguous.candidateVehicleKeys.length === 2, JSON.stringify(ambiguous));

  if (failed > 0) {
    console.error(`\nF2.56: ${ok} OK | ${failed} FALHA\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`\nF2.56: ${ok} OK | 0 FALHA`);
}

main();
