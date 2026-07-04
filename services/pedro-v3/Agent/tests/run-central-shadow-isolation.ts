// ============================================================================
// R13-D/2 — Shadow VERDADEIRO: o cérebro central roda ISOLADO, sem tocar o canônico e sem despachar.
// Prova: (a) versão/inbox canônicos INTOCADOS após o shadow; (b) zero dispatch com OutboxDispatcher REAL + gate shadow.
//   npx tsx tests/run-central-shadow-isolation.ts
// ============================================================================
import { runCentralShadowTurn } from "../src/engine/central-shadow-runner.ts";
import { OutboxDispatcher, type EffectDispatcher } from "../src/engine/outbox-dispatcher.ts";
import { InMemoryEffectGate } from "../src/engine/effect-gate.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { FakeLlm, type ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { ResponseDraft } from "../src/domain/decision.ts";
import type { AgentBrainStep } from "../src/domain/agent-brain.ts";
import type { EffectResult, ProposedEffectPlan, QueryCall, QueryResult, TurnRelation } from "../src/domain/decision.ts";
import type { OutboxRecord } from "../src/domain/effect-intent.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";
import { extractTenantBusinessFacts } from "../src/engine/tenant-business-info.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { redact } from "../src/domain/effect-intent.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-03T12:00:00.000Z";
const STOCK: VehicleFact[] = [{ vehicleKey: "rm:1", marca: "Nissan", modelo: "Kicks", ano: 2018, preco: 74990, tipo: "suv", km: 60000, cambio: "Automatico", cor: "Prata" } as VehicleFact];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
class FixedPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare() { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; }
}
class FakeBusinessInfo implements TenantBusinessInfoSource {
  async getBusinessInfo(): Promise<TenantBusinessInfo> { return { address: null, hours: null, unit: null, source: "x" }; }
}
const runQuery = async (_c: QueryCall): Promise<QueryResult> => ({ ok: false, tool: "stock_search", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult);
const plainText: ComposeOverride = (d) => ({ parts: [{ type: "text", content: d.responsePlan.guidance }] });
function llmWith(o: ComposeOverride): FakeLlm { const l = new FakeLlm(); l.setTurnScript([], o); return l; }
function finalGreeting(): AgentBrainStep {
  // autoria única: o cérebro autora um DRAFT estruturado (o shadow renderiza aterrado, sem 2º compose).
  return { kind: "final", decision: { reasonCode: "greeting", reasonSummary: "oi", confidence: 0.9, responsePlan: { guidance: "saudar", draft: { parts: [{ type: "text", content: "Oi! Como posso ajudar?" }] } }, proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan], memoryMutations: [], stateMutations: [] } };
}
// Spy do 2º autor: em single-author NUNCA deve ser chamado (prova B6 no shadow).
class ShadowComposeSpy implements DecisionLlm {
  composeCalls = 0;
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("shadow single-author não deve chamar proposeNextQueryOrFinal"); }
  async compose(): Promise<ResponseDraft> { this.composeCalls++; return { parts: [{ type: "text", content: "[SPY_COMPOSE_PROIBIDO]" }] }; }
}

async function main(): Promise<void> {
  console.log("== R13-D/2 Shadow verdadeiro (isolamento + zero dispatch) ==");

  // [1] Shadow NÃO toca o canônico: versão + inbox pendente permanecem; o shadow commita no store isolado.
  {
    const clock = new FakeClock(NOW);
    const canonical = new InMemoryPersistence(clock, new FakeIdGen());
    const seed = canonical.begin(); seed.casState("c1", 0, createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW })); seed.commit();
    // 1 mensagem pendente no inbox CANÔNICO (não deve ser claimada pelo shadow).
    await canonical.tryInsert({ eventId: "c1-e1", conversationId: "c1", raw: redact({ text: "oi" }) as never, receivedAt: NOW });
    const beforeVersion = (await canonical.load("c1"))?.version ?? -1;
    const beforePending = await canonical.pendingCount("c1");

    const brain = new ScriptedAgentBrain(); brain.setTurnScript([finalGreeting()]);
    const r = await runCentralShadowTurn({
      canonicalPersistence: canonical, conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: null,
      messageBlock: "oi", turnId: "c1-shadow",
      deps: { brain, llm: llmWith(plainText), runQuery, businessInfo: new FakeBusinessInfo(), contextPreparer: new FixedPreparer(), clock, portalPromptSha256: "sha", limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 }, maxValidationAttempts: 2 },
    });
    const afterVersion = (await canonical.load("c1"))?.version ?? -1;
    const afterPending = await canonical.pendingCount("c1");
    check("[1] shadow commitou no store ISOLADO", r.ok === true && r.comparison.status === "committed", r.ok ? r.comparison.status : "not-ok");
    check("[1] canônico INTOCADO: versão inalterada", beforeVersion === afterVersion && r.ok === true && r.comparison.canonicalUntouched === true, `${beforeVersion}->${afterVersion}`);
    check("[1] canônico INTOCADO: inbox segue pendente (não claimado)", beforePending === 1 && afterPending === 1, `${beforePending}->${afterPending}`);
    check("[1] comparação sanitizada devolvida (preview + tools)", r.ok === true && typeof r.comparison.responsePreview === "string" && Array.isArray(r.comparison.toolsRequested));
  }

  // [2] Zero dispatch com OutboxDispatcher REAL + gate SHADOW (inativo): records viram 'skipped', dispatch() NUNCA chamado.
  {
    const clock = new FakeClock(NOW);
    const iso = new InMemoryPersistence(clock, new FakeIdGen());
    const seed = iso.begin();
    seed.casState("c2", 0, createInitialState({ conversationId: "c2", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW }));
    const rec: OutboxRecord = { effectId: "t:reply", idempotencyKey: "t:reply", conversationId: "c2", turnId: "t", planId: "reply", kind: "send_message", payload: redact({ text: "oi" }), onSuccess: [], order: 0, dependsOn: [], status: "pending", providerCapability: "none", receiptLevel: null, attempts: 0, nextRetryAt: null, providerReceipt: null, outcomeAppliedAt: null, terminalAt: null, lastError: null, createdAt: NOW, dispatchedAt: null, processingBy: null, processingToken: null, processingExpiresAt: null };
    seed.appendOutbox([rec]);
    // appendOutbox exige inbox done? Não — o commit valida idempotency + cas. Sem inboxDone/decision é aceito no InMemory.
    seed.commit();
    let dispatchCalled = 0;
    const dispatcher: EffectDispatcher = { async dispatch(): Promise<EffectResult> { dispatchCalled++; return { status: "succeeded", effectId: "t:reply", receipt: { effectId: "t:reply", level: "accepted", at: NOW } }; } };
    const shadowGate = new InMemoryEffectGate(); // NUNCA setActiveMode -> isActiveMode=false p/ toda conversa
    const outboxDispatcher = new OutboxDispatcher(iso, clock, dispatcher, shadowGate, "shadow-dispatcher");
    const dispatched = await outboxDispatcher.dispatchConversation("c2");
    const records = await iso.listOutbox("c2");
    check("[2] OutboxDispatcher REAL: 0 despachados em shadow (gate inativo)", dispatched === 0 && dispatchCalled === 0, `dispatched=${dispatched} called=${dispatchCalled}`);
    check("[2] record consumido pelo gate shadow (skipped)", records[0]?.status === "skipped" && records[0]?.lastError === "shadow_mode_gate_active", records[0]?.status);
  }

  // [3] TenantBusinessFacts (R13-D/3): extração ROTULADA (provenance=portal_prompt) + NUNCA inventa campo ausente.
  {
    const facts = extractTenantBusinessFacts({ companyName: "Icom Motors", promptText: "Você é o Aloan, consultor.\nEndereço: Avenida Charles Schnneider, Jardim das Bandeiras, Taubaté SP\nHorário de atendimento: das 9h às 19h de segunda a sábado.\nSeja cordial." });
    check("[3] extrai endereço rotulado (provenance=portal_prompt)", facts.address.value?.includes("Charles Schnneider") === true && facts.address.provenance === "portal_prompt", JSON.stringify(facts.address));
    check("[3] extrai horário rotulado (provenance=portal_prompt)", facts.hours.value?.includes("9h") === true && facts.hours.provenance === "portal_prompt", JSON.stringify(facts.hours));
    check("[3] company/unit vêm do config", facts.company.value === "Icom Motors" && facts.company.provenance === "config" && facts.unit.value === "Icom Motors");
    const none = extractTenantBusinessFacts({ companyName: "", promptText: "Você é um vendedor simpático. Ajude o cliente a escolher um carro." });
    check("[3] sem rótulo -> null (NUNCA inventa)", none.address.value === null && none.address.provenance === "absent" && none.hours.value === null && none.company.value === null);
  }

  // [4] B6 (audit): shadow roda AUTORIA ÚNICA (singleAuthor) — renderiza o DRAFT do cérebro e NUNCA chama compose.
  {
    const clock = new FakeClock(NOW);
    const canonical = new InMemoryPersistence(clock, new FakeIdGen());
    const seed = canonical.begin(); seed.casState("c4", 0, createInitialState({ conversationId: "c4", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW })); seed.commit();
    const brain = new ScriptedAgentBrain();
    brain.setTurnScript([{ kind: "final", decision: { reasonCode: "reply", reasonSummary: "oi", confidence: 0.9, responsePlan: { guidance: "saudar", draft: { parts: [{ type: "text", content: "Bom dia! Sou o Aloan, como posso ajudar?" }] } }, proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan], memoryMutations: [], stateMutations: [] } }]);
    const spy = new ShadowComposeSpy();
    const r = await runCentralShadowTurn({
      canonicalPersistence: canonical, conversationId: "c4", tenantId: TENANT, agentId: AGENT, leadId: null, messageBlock: "oi", turnId: "c4-shadow",
      deps: { brain, llm: spy, runQuery, businessInfo: new FakeBusinessInfo(), contextPreparer: new FixedPreparer(), clock, portalPromptSha256: "sha", limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 }, maxValidationAttempts: 2 },
    });
    check("[4] shadow single-author: renderiza o DRAFT do cérebro, ZERO compose", r.ok === true && r.comparison.status === "committed" && r.comparison.responsePreview.includes("Bom dia! Sou o Aloan") && spy.composeCalls === 0, r.ok ? `preview="${r.comparison.responsePreview}" compose=${spy.composeCalls}` : "not-ok");
  }

  console.log(`\n== R13-D/2 SHADOW: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
