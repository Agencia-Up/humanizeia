// ============================================================================
// F2.64 — FASE 1 (diagnóstico observável): a CAUSA de uma degradação é registrada no resultado do turno, sanitizada,
// diferenciando falha REAL de provedor (HTTP/timeout/JSON) de resposta rejeitada por política. Engine central REAL
// (runCentralConversationTurn, singleAuthor + llmFirst) + AgentBrain SCRIPTADO.
//   npx tsx tests/run-f2-64-degradation-diagnostic.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-17T12:00:00.000Z", SHA = "sha-64";
const ADDR = "Avenida Charles Schnneider, 1700, Taubaté SP";
const catalog = buildTenantCatalog([]);
const extractor = new CatalogClaimExtractor(catalog);
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const txt = (content: string): ResponsePart => ({ type: "text", content });

class RelPreparer implements TurnContextPreparer {
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [txt("x")] }; } }
const runQuery = async (call: QueryCall): Promise<QueryResult> => ({ ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult);
const makeBI = (address: string | null): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address, hours: null, unit: "Icom", source: "test" }; } });

// Simula a #safeFinal do adapter: provedor caiu (HTTP/JSON) -> final marcado reasonCode="brain_fallback", SEM draft.
const providerFail = (reason: string): AgentBrainStep => ({ kind: "final", decision: {
  reasonCode: "brain_fallback", reasonSummary: reason, confidence: 0.3,
  responsePlan: { guidance: "Peça um esclarecimento gentil, sem inventar." },
  proposedEffects: [reply], memoryMutations: [], stateMutations: [],
} as AgentBrainDecision });
// Cérebro respondeu (envelope VÁLIDO com understanding) mas com draft VAZIO -> rejeitado pela autoria/completude.
// NÃO é falha de provedor -> deve classificar como response_rejected, providerFallbackReason=null.
const emptyDraftWithUnderstanding = (lead: string): AgentBrainStep => ({ kind: "final", decision: {
  reasonCode: "reply", reasonSummary: "r", confidence: 0.9,
  responsePlan: { guidance: "g", draft: { parts: [] } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [],
} as AgentBrainDecision, understanding: deriveFallbackUnderstanding(lead, buildFrameSignals(lead, { relation: "ambiguous" }), extractor) });
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });

type Cap = { committed: boolean; src: string; degraded: boolean; kind: string; providerReason: string | null; outbox: string };
let convSeq = 0;
async function runTurn(lead: string, bi: TenantBusinessInfoSource, responder: (obs: readonly AgentToolObservation[]) => AgentBrainStep): Promise<Cap> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const conv = `conv-${convSeq++}`;
  const state = createInitialState({ conversationId: conv, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  { const uow = persistence.begin(); uow.casState(conv, 0, state); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${conv}-e1`, conversationId: conv, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain();
  // Responder observation-aware: pode rodar a tool primeiro e SÓ DEPOIS falhar (falha PARCIAL de provedor).
  // Anexa understanding derivado do bloco a qualquer passo que não seja falha de provedor (o #safeFinal real NÃO
  // carrega understanding — mantemos isso p/ realismo; a query/o final normal precisam do envelope p/ agir).
  brain.setResponder((frame, obs) => {
    const step = responder(obs);
    if (step.understanding || (step.kind === "final" && step.decision.reasonCode === "brain_fallback")) return step;
    return { ...step, understanding: deriveFallbackUnderstanding(frame.block, frame.signals, extractor) };
  });
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: bi, contextPreparer: new RelPreparer(),
    conversationId: conv, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: `${conv}-t1`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 6, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = (await persistence.listOutbox(conv)).find((o) => o.kind === "send_message");
  return {
    committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : r.status,
    degraded: r.status === "committed" && r.degraded, kind: r.status === "committed" ? r.degradationKind : "?",
    providerReason: r.status === "committed" ? r.providerFallbackReason : null,
    outbox: (outbox?.payload as { text?: string } | undefined)?.text ?? "",
  };
}

async function main(): Promise<void> {
  console.log("== F2.64 Diagnóstico de degradação (FASE 1) ==");

  // A) Provedor caiu num turno COMERCIAL -> technical_fallback + degradationKind=provider_transport + motivo sanitizado.
  {
    const cap = await runTurn("quero um SUV automático", makeBI(ADDR), () => providerFail("brain HTTP 429"));
    check("[A] comercial + provedor caído -> technical_fallback", cap.committed && cap.src === "technical_fallback" && cap.degraded, `src=${cap.src}`);
    check("[A] degradationKind = provider_transport (não 'response_rejected')", cap.kind === "provider_transport", `kind=${cap.kind}`);
    check("[A] providerFallbackReason sanitizado presente", cap.providerReason === "brain HTTP 429", `reason=${cap.providerReason}`);
  }
  // B) Item 7: JSON malformado (provedor RESPONDEU) NÃO é provider_transport — é protocol_adherence (o modelo não conformou
  //    o contrato). Itens 2/3/4: institucional sem autoria da LLM -> technical_fallback (a engine NÃO escreve endereço).
  {
    const cap = await runTurn("onde fica a loja?", makeBI(null), () => providerFail("brain JSON inválido"));
    check("[B] institucional + JSON malformado sem autoria -> technical_fallback (engine não escreve endereço)", cap.committed && cap.src === "technical_fallback", `src=${cap.src}`);
    check("[B] Item 7: JSON malformado = protocol_adherence (NÃO provider_transport)", cap.kind === "protocol_adherence", `kind=${cap.kind}`);
  }
  // B2) Item 7: HTTP 400 (request rejeitada pelo contrato) = protocol_adherence; HTTP 503/timeout = provider_transport real.
  {
    const c400 = await runTurn("quero um carro", makeBI(ADDR), () => providerFail("brain HTTP 400: unsupported content"));
    check("[B2] HTTP 400 = protocol_adherence (contrato rejeitado, não transporte)", c400.kind === "protocol_adherence", `kind=${c400.kind}`);
    const c503 = await runTurn("quero um carro", makeBI(ADDR), () => providerFail("brain HTTP 503: upstream"));
    check("[B2] HTTP 503 = provider_transport (transporte real caído)", c503.kind === "provider_transport", `kind=${c503.kind}`);
  }
  // B3) Item 7: modelo emitiu tool fora do allowlist / query inválida (2xx) = tool_disallowed (falha semântica, não transporte).
  {
    const cap = await runTurn("quero um carro", makeBI(ADDR), () => providerFail("query inválida ou tool fora do allowlist"));
    check("[B3] tool fora do allowlist = tool_disallowed (falha semântica do modelo)", cap.kind === "tool_disallowed", `kind=${cap.kind}`);
  }
  // C) Cérebro respondeu (envelope VÁLIDO com understanding) mas com draft vazio -> rejeitado pela autoria -> technical_fallback
  //    + degradationKind=response_rejected + providerFallbackReason=null (não foi o provedor).
  {
    const cap = await runTurn("quero um carro bom", makeBI(ADDR), () => emptyDraftWithUnderstanding("quero um carro bom"));
    check("[C] draft vazio (sem falha de provedor) -> technical_fallback", cap.committed && cap.src === "technical_fallback" && cap.degraded, `src=${cap.src}`);
    // O provedor respondeu -> a causa NÃO pode ser provider_transport; é uma REJEIÇÃO da autoria (response_rejected/grounding).
    check("[C] degradationKind é rejeição da autoria, não falha de provedor", cap.kind !== "provider_transport" && cap.kind !== "none", `kind=${cap.kind}`);
    check("[C] providerFallbackReason = null (o provedor respondeu)", cap.providerReason === null, `reason=${cap.providerReason}`);
  }
  // D) Falha PARCIAL: o cérebro roda tenant_business_info e SÓ DEPOIS o provedor cai na autoria. Itens 2/3/4: a engine NÃO
  //    redige o endereço (isso é da LLM) -> technical_fallback; mas o diagnóstico (FASE 1) preserva a causa-raiz provider_transport.
  {
    const cap = await runTurn("qual o endereço de vocês?", makeBI(ADDR), (obs) =>
      obs.some((o) => o.tool === "tenant_business_info") ? providerFail("brain HTTP 503") : q({ tool: "tenant_business_info", input: { topic: "address" } }));
    check("[D] falha parcial na autoria -> technical_fallback (engine não escreve o endereço)", cap.committed && cap.src === "technical_fallback", `src=${cap.src} text="${cap.outbox}"`);
    check("[D] causa-raiz provider_transport preservada no diagnóstico", cap.kind === "provider_transport", `kind=${cap.kind}`);
  }

  console.log(`\n== F2.64: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
