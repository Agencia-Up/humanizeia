// ============================================================================
// F2.7.4 Fase 1 (D + E) — testes adversariais offline ($0, sem rede).
//   npx tsx tests/run-f2-7-4-grounding-context.ts
//
// E (contexto explicito + anti-reapresentacao deterministica): deriveModelContext.
// D (grounding/estoque): stock_search ANTES de compor quando o lead nomeia veiculo;
//    compose so cita veiculo dos QueryResults; nao-encontrado != terminal-safe;
//    re-tentativa COM feedback do deny (D3) recupera em vez de cair em terminal-safe.
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { deriveModelContext } from "../src/engine/model-context-view.ts";
import { runTurn } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import type {
  StructuredConversationModel, InterpretModelRequest, ProposeModelRequest, ComposeModelRequest,
} from "../src/domain/conversation-model.ts";
import type { TenantRuntimeConfig } from "../src/domain/read-ports.ts";
import type { DecisionStep, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T12:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: "icom", agentId: "aloan", leadId: "lead1", now: NOW }),
  ...over,
});

const STOCK: VehicleFact[] = [
  { vehicleKey: "chevrolet|onix|2021", marca: "Chevrolet", modelo: "Onix", ano: 2021, preco: 72990, tipo: "hatch", photoIds: ["p1"] },
  { vehicleKey: "hyundai|hb20|2022", marca: "Hyundai", modelo: "HB20", ano: 2022, preco: 79990, tipo: "hatch", photoIds: ["p2"] },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

// runQuery com filtro real por modelo (para provar "encontrado" vs "nao encontrado").
const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = STOCK.filter((v) =>
      (!call.input.tipo || v.tipo === call.input.tipo) &&
      (call.input.precoMax == null || v.preco <= call.input.precoMax) &&
      (!modelo || normalizeText(v.modelo).includes(modelo) || modelo.includes(normalizeText(v.modelo))));
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

function ctx(over: Partial<TurnContext> & { leadMessage: string; turnId: string; interpretation: TurnInterpretation }): TurnContext {
  return {
    state: over.state ?? baseState(),
    turnId: over.turnId,
    leadMessage: over.leadMessage,
    now: NOW,
    interpretation: over.interpretation,
    tenantCatalog: catalog,
    claimExtractor: extractor,
  };
}

const onixKeyFrom = (facts: QueryResult[]): string | null => {
  for (const f of facts) if (f.ok && f.tool === "stock_search") for (const v of f.data.items) if (normalizeText(v.modelo) === "onix") return v.vehicleKey;
  return null;
};

const runtimeConfig: TenantRuntimeConfig = Object.freeze({
  tenantId: "icom", agentId: "aloan", agentName: "Aloan", companyName: "Icom Motors", instanceId: null,
  promptText: "Prompt vivo.", promptSource: "raw_system_prompt", versionStamp: "v1", model: "gpt-test", temperature: 0.2,
  sdrGoal: "agendar", qualificationQuestions: ["nome"], sellsMotorcycles: false, blockedCategories: [],
  ragRestricted: false, stockProvider: "none", stockSecretRef: null, stockIntegrations: [],
});

async function main(): Promise<void> {
  console.log("\n=== F2.7.4 Fase 1 (D grounding + E contexto) ===\n");

  // ── E: deriveModelContext (contexto explicito + anti-reapresentacao) ──
  {
    const fresh = deriveModelContext(baseState(), { relation: "unrelated" });
    check("E1 1o turno: alreadyIntroduced=false (sem historico)", fresh.alreadyIntroduced === false, JSON.stringify(fresh.alreadyIntroduced));
    check("E1 1o turno: recentTranscript vazio", fresh.recentTranscript.length === 0);
    check("E1 1o turno: lastAgentMessage null", fresh.lastAgentMessage === null);
  }
  {
    const withHist = baseState({
      recentTurns: [
        { role: "lead", text: "Bom dia", at: NOW },
        { role: "agent", text: "Bom dia! Sou o Aloan, consultor da Icom Motors. Em que posso ajudar?", at: NOW },
        { role: "lead", text: "quero um onix", at: NOW },
      ],
      turnNumber: 2,
    });
    const c = deriveModelContext(withHist, { relation: "direction_change", extractedEntities: { model: "onix" } });
    check("E2 2o turno: alreadyIntroduced=true (agente ja falou)", c.alreadyIntroduced === true);
    check("E2 lastAgentMessage = ultima fala do agente", (c.lastAgentMessage ?? "").includes("Aloan"));
    check("E2 recentTranscript preserva lead+agente", c.recentTranscript.length === 3 && c.recentTranscript.some((t) => t.role === "agent") && c.recentTranscript.some((t) => t.role === "lead"));
    check("E2 lastCommercialInterest = onix (interpretacao)", c.lastCommercialInterest?.model === "onix");
  }
  {
    // turnNumber>1 sozinho ja marca alreadyIntroduced (robustez), mesmo sem recentTurns.
    const c = deriveModelContext(baseState({ turnNumber: 3 }), { relation: "unrelated" });
    check("E2 alreadyIntroduced=true por turnNumber>1", c.alreadyIntroduced === true);
  }
  {
    // Test 4 (lista ampla): nome depois do interesse comercial NAO apaga o interesse.
    const s = baseState({
      slots: { ...baseState().slots, interesse: { status: "known", value: "onix", confidence: 0.9, updatedAt: NOW } },
    });
    // turno do nome: interpretacao SEM modelo (lead so disse "Douglas")
    const c = deriveModelContext(s, { relation: "answers_pending" });
    check("E interesse comercial persiste no turno do nome", c.lastCommercialInterest?.model === "onix", JSON.stringify(c.lastCommercialInterest));
  }
  {
    const s = baseState({ slots: { ...baseState().slots, nome: { status: "known", value: "Douglas", confidence: 1, updatedAt: NOW } } });
    const c = deriveModelContext(s, { relation: "unrelated" });
    check("E conversationFacts inclui o nome conhecido", c.conversationFacts.some((f) => f.includes("Douglas")));
  }

  // ── D: pre-seed stock_search quando o lead nomeia veiculo ──
  {
    const llm = new FakeLlm();
    llm.setTurnScript([
      { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "Temos esse modelo disponivel, quer agendar uma visita?" }, reasonCode: "reply", reasonSummary: "", confidence: 0.8 } },
    ] as DecisionStep[]);
    const out = await runTurn({ ctx: ctx({ turnId: "t1", leadMessage: "quero um onix", interpretation: { relation: "direction_change", extractedEntities: { model: "onix" } } }), llm, runQuery, limits, maxValidationAttempts: 2 });
    const seeded = out.facts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.some((i) => normalizeText(i.modelo) === "onix"));
    check("D1 'quero um onix' forca stock_search ANTES do reply", seeded, JSON.stringify(out.facts.map((f) => f.tool)));
    check("D1 com fato valido NAO cai em terminal-safe", out.terminalSafe === false, out.composed.text);
    check("D1 resposta ancora o Onix (texto renderizado cita o modelo)", normalizeText(out.composed.text).includes("onix"), out.composed.text);
  }

  // ── D: modelo pedido que NAO existe no estoque -> nao alucina, nao terminal-safe ──
  {
    const llm = new FakeLlm();
    llm.setTurnScript([
      { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "Nao encontrei esse modelo agora, mas posso te mostrar opcoes parecidas." }, reasonCode: "reply", reasonSummary: "", confidence: 0.7 } },
    ] as DecisionStep[]);
    const out = await runTurn({ ctx: ctx({ turnId: "t2", leadMessage: "tem civic?", interpretation: { relation: "asks_vehicle_detail", extractedEntities: { model: "civic" } } }), llm, runQuery, limits, maxValidationAttempts: 2 });
    const seededEmpty = out.facts.some((f) => f.ok && f.tool === "stock_search" && f.data.items.length === 0);
    check("D2 modelo inexistente: stock_search roda e volta vazio", seededEmpty, JSON.stringify(out.facts));
    check("D2 nao-encontrado NAO vira terminal-safe", out.terminalSafe === false, out.composed.text);
  }

  // ── D: citar veiculo do catalogo em texto livre SEM QueryResult -> negado (terminal-safe) ──
  {
    const llm = new FakeLlm();
    llm.setTurnScript([
      { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "x" }, reasonCode: "reply", reasonSummary: "", confidence: 0.8 } },
    ] as DecisionStep[], () => ({ parts: [{ type: "text", content: "Claro, temos o Onix por um otimo preco!" }] }));
    // leadMessage sem modelo -> sem pre-seed -> sem fatos -> citar Onix em texto livre e alucinacao.
    const out = await runTurn({ ctx: ctx({ turnId: "t3", leadMessage: "boa tarde", interpretation: { relation: "unrelated" } }), llm, runQuery, limits, maxValidationAttempts: 2 });
    check("D3a veiculo em texto livre sem QueryResult -> terminal-safe", out.terminalSafe === true);
    check("D3a terminal-safe registra a violation (POL-GROUND-STOCK)", out.decision.reasonSummary.includes("POL-GROUND-STOCK"), out.decision.reasonSummary);
  }

  // ── D3: re-tentativa de compose COM feedback do deny recupera (nao cega -> nao terminal-safe) ──
  {
    let attempts = 0;
    const override: ComposeOverride = (decision, facts) => {
      attempts += 1;
      const corrected = decision.responsePlan.guidance.includes("CORRECAO");
      // 1a: PRECO livre no texto (erro) -> deny. (Rodada 9: o modelo Onix, por estar aterrado nos fatos, pode ser
      // citado em texto; o PRECO livre nao. Assim o teste do LOOP de retry continua valido: deny -> recupera.)
      if (!corrected) return { parts: [{ type: "text", content: "Temos o Onix por R$ 50.000, otima escolha!" }] };
      const key = onixKeyFrom(facts);
      return { parts: [{ type: "text", content: "Temos esse modelo, quer agendar?" }, { type: "vehicle_ref", vehicleKey: key ?? "x", field: "modelo" }] };
    };
    const llm = new FakeLlm();
    llm.setTurnScript([
      { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "responder sobre o onix" }, reasonCode: "reply", reasonSummary: "", confidence: 0.8 } },
    ] as DecisionStep[], override);
    const out = await runTurn({ ctx: ctx({ turnId: "t4", leadMessage: "quero um onix", interpretation: { relation: "direction_change", extractedEntities: { model: "onix" } } }), llm, runQuery, limits, maxValidationAttempts: 2 });
    check("D3 re-tentativa usou feedback (2 tentativas de compose)", attempts === 2, `attempts=${attempts}`);
    check("D3 feedback recupera o grounding -> NAO terminal-safe", out.terminalSafe === false, out.composed.text);
  }

  // ── E (payload): recentTranscript/alreadyIntroduced/lastAgentMessage chegam ao modelo ──
  {
    class RecordingBackend implements StructuredConversationModel {
      lastPropose: ProposeModelRequest | null = null;
      async interpret(_r: InterpretModelRequest): Promise<unknown> { return { relation: "ambiguous" }; }
      async propose(r: ProposeModelRequest): Promise<unknown> {
        this.lastPropose = r;
        return { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m", order: 0, onSuccess: [] }], responsePlan: { guidance: "ok" }, reasonCode: "r", reasonSummary: "ok", confidence: 0.8 } };
      }
      async compose(_r: ComposeModelRequest): Promise<unknown> { return { parts: [{ type: "text", content: "ok" }] }; }
    }
    const backend = new RecordingBackend();
    const adapter = new PromptBoundConversationAdapter(runtimeConfig, backend);
    const stateWithHistory = baseState({
      recentTurns: [
        { role: "lead", text: "Bom dia", at: NOW },
        { role: "agent", text: "Bom dia! Sou o Aloan da Icom Motors.", at: NOW },
      ],
      turnNumber: 2,
    });
    await adapter.proposeNextQueryOrFinal(ctx({ state: stateWithHistory, turnId: "t5", leadMessage: "quero ver", interpretation: { relation: "answers_pending" } }), []);
    const c = backend.lastPropose?.turn.context;
    check("E payload: turn.context existe no request ao modelo", !!c);
    check("E payload: recentTranscript chega ao modelo", (c?.recentTranscript.length ?? 0) === 2);
    check("E payload: alreadyIntroduced=true chega ao modelo", c?.alreadyIntroduced === true);
    check("E payload: lastAgentMessage chega ao modelo", (c?.lastAgentMessage ?? "").includes("Aloan"));
  }

  console.log(`\n=== F2.7.4 Fase 1: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
