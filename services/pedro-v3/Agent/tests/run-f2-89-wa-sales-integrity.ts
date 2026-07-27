// ============================================================================
// F2.89 — regressões dos incidentes reais da WA (2026-07-27)
//
// 1) Categoria automotiva nunca vira modelo literal na busca.
// 2) O decoder REAL do cérebro aplica o mesmo contrato do domínio.
// 3) O frame semântico preserva categoria e não fabrica modelo.
//
// Tudo offline: transporte de IA fake, sem rede e sem consumo.
// ============================================================================
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import type {
  ModelHttpRequest,
  ModelHttpResponse,
  ModelHttpTransport,
} from "../src/adapters/llm/structured-json-model.ts";
import { normalizeStockSearchInput } from "../src/domain/decision.ts";
import type { TurnInterpretation } from "../src/domain/decision.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";
import { OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { computeTurnFrame } from "../src/engine/explicit-search.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  OK  ${name}`);
    return;
  }
  failed += 1;
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

class CannedTransport implements ModelHttpTransport {
  constructor(private readonly content: string) {}

  async postJson(_url: string, _request: ModelHttpRequest): Promise<ModelHttpResponse> {
    return {
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({ choices: [{ message: { content: this.content } }] }),
    };
  }
}

const SECRET = OpenAiRuntimeSecret.fromString("sk-test-wa-sales-integrity");

function frame(block: string): TurnFrame {
  return {
    turnId: "f2-89-turn",
    now: "2026-07-27T15:00:00.000Z",
    block,
    portalPromptSha256: "test",
    workingMemory: {
      ...createInitialPersistedWorkingMemory(),
      funnel: { known: [], declined: [], deferred: [], suggestedObjective: null },
      selectedVehicle: null,
      lastOffer: null,
    },
    recentTranscript: [],
    conversationContext: {
      lastAgentMessage: null,
      pendingAgentQuestion: null,
      selectedVehicle: null,
      lastVisibleOffer: null,
      lastResolvedSlotAnswer: null,
      conversationSummary: null,
    },
    currentTurnFacts: {
      expectedAnswer: { slot: null, lastAgentQuestion: null },
      extracted: [],
      offerReference: null,
    },
    signals: {
      mentionsPhoto: false,
      mentionsStore: false,
      mentionsMoreOptions: false,
      mentionsVehicleType: "pickup",
      isMemoryQuestion: false,
      relation: "direction_change",
    },
  };
}

async function main(): Promise<void> {
  console.log("== F2.89: integridade comercial WA ==");

  const normalized = normalizeStockSearchInput({ modelo: "utilitário", precoMax: 50_000 });
  check("[A1] domínio converte utilitário em tipo pickup", normalized.ok && normalized.input.tipo === "pickup", JSON.stringify(normalized));
  check("[A2] domínio remove o falso modelo literal", normalized.ok && normalized.input.modelo == null, JSON.stringify(normalized));
  check("[A3] domínio preserva o teto de preço", normalized.ok && normalized.input.precoMax === 50_000, JSON.stringify(normalized));

  const vehicles: VehicleFact[] = [
    { vehicleKey: "wa:1", marca: "Fiat", modelo: "Strada", ano: 2022, preco: 49_900, km: 80_000, cambio: "Manual", cor: "Branca", tipo: "pickup" },
  ];
  const claimExtractor = new CatalogClaimExtractor(buildTenantCatalog(vehicles));
  const interpretation = {
    relation: "direction_change",
    extractedEntities: { model: "utilitário" },
  } as TurnInterpretation;
  const semanticFrame = computeTurnFrame({
    leadMessage: "Tem que ser utilitário até 50 mil",
    claimExtractor,
    interpretation,
  });
  check("[B1] frame reconhece categoria pickup", semanticFrame.explicitTypes.includes("pickup"), JSON.stringify(semanticFrame));
  check("[B2] frame não transforma categoria em modelo", semanticFrame.explicitModels.length === 0, JSON.stringify(semanticFrame));

  const modelOutput = JSON.stringify({
    kind: "query",
    understanding: {
      primaryIntent: "search_stock",
      requestedCapabilities: ["stock_search"],
      subject: "vehicle_type",
      subjectValue: "utilitário",
      subjectSource: "current_turn",
      evidence: [{ capability: "stock_search", quote: "utilitário" }],
      monetaryMentions: [{ value: 50_000, role: "search_budget", quote: "50 mil" }],
      isTopicChange: true,
      answeredLeadQuestions: [],
      policyDecision: null,
    },
    call: {
      tool: "stock_search",
      input: { modelo: "utilitário", precoMax: 50_000 },
    },
  });
  const brain = new OpenAiAgentBrain(
    SECRET,
    new CannedTransport(modelOutput),
    "Você é uma SDR de veículos e segue o pedido atual do lead.",
    { model: "gpt-4.1-mini", allowedTools: ["stock_search"] },
  );
  const step = await brain.proposeNextStep(frame("Tem que ser utilitário até 50 mil"), []);
  const input = step.kind === "query" && step.call.tool === "stock_search" ? step.call.input : null;
  check("[C1] decoder real aceita a query", input != null, JSON.stringify(step));
  check("[C2] decoder real converte modelo utilitário em pickup", input?.tipo === "pickup", JSON.stringify(input));
  check("[C3] decoder real não deixa modelo utilitário escapar", input?.modelo == null, JSON.stringify(input));
  check("[C4] decoder real preserva preço", input?.precoMax === 50_000, JSON.stringify(input));

  console.log(`\nF2.89: ${passed} OK / ${failed} FALHA`);
  if (failed > 0) process.exitCode = 1;
}

void main();
