// ============================================================================
// F2.16 — Perguntas INSTITUCIONAIS (audit): resolução TERMINAL por tópico, sem loop, sem repetir chamada.
// Engine central REAL (runCentralConversationTurn, singleAuthor) + AgentBrain SCRIPTADO + FakeBusinessInfo config.
// Prova: address+hours presentes (2 obs+ambos); address ok/hours NOT_CONFIGURED (sem repetir, responde+ausência);
// ambos NOT_CONFIGURED (honesto, sem loop, sem technical_fallback); READ_SOURCE_FAILURE (degraded permitido/observável);
// nenhuma chamada idêntica repetida.  npx tsx tests/run-f2-16-institutional.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, CentralQueryCall, BusinessInfoTopic } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import type { TenantBusinessInfoSource, TenantBusinessInfo } from "../src/engine/tenant-business-info.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", CONV = "conv-inst", NOW = "2026-07-04T10:00:00.000Z", SHA = "sha-inst";
const catalog = buildTenantCatalog([] as VehicleFact[]);
const extractor = new CatalogClaimExtractor(catalog);
class FixedPreparer implements TurnContextPreparer {
  constructor(private readonly relation: TurnRelation = "ambiguous") {}
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
const runQuery = async (_c: QueryCall): Promise<QueryResult> => ({ ok: false, tool: "stock_search", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult);
class ComposeSpyLlm implements DecisionLlm {
  composeCalls = 0;
  async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author não deve chamar propose"); }
  async compose(): Promise<ResponseDraft> { this.composeCalls++; return { parts: [{ type: "text", content: "[SPY]" }] }; }
}
// FakeBusinessInfo configurável + CONTADOR de execuções (prova de "não repete a mesma chamada").
class FakeBI implements TenantBusinessInfoSource {
  calls = 0;
  constructor(private readonly info: TenantBusinessInfo | "throw") {}
  async getBusinessInfo(): Promise<TenantBusinessInfo> { this.calls++; if (this.info === "throw") throw new Error("read source down"); return this.info; }
}

const txt = (content: string): ResponsePart => ({ type: "text", content });
function finalT(content: string): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: "reply", reasonSummary: "resposta institucional", confidence: 0.9,
    responsePlan: { guidance: "responder institucional", draft: { parts: [txt(content)] } },
    proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan], memoryMutations: [], stateMutations: [],
  };
  return { kind: "final", decision };
}
const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
const srcOf = (r: CentralTurnResult): string => (r.status === "committed" ? r.responseSource : r.status);
const degradedOf = (r: CentralTurnResult): boolean => r.status === "committed" && r.degraded;
const instOf = (r: CentralTurnResult): { topic: string; status: string }[] => (r.status === "committed" ? [...r.institutionalResolved] : []);
const statusOf = (r: CentralTurnResult, topic: string): string | undefined => instOf(r).find((x) => x.topic === topic)?.status;

async function runTurn(opts: { bi: FakeBI; leadText: string; script: AgentBrainStep[]; state?: ConversationState }): Promise<{ result: CentralTurnResult; outboxText: string }> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const state = opts.state ?? createInitialState({ conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  { const uow = persistence.begin(); uow.casState(CONV, 0, state); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${CONV}-e1`, conversationId: CONV, raw: redact({ text: opts.leadText }), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain(); brain.setTurnScript(opts.script);
  const result = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: opts.bi,
    contextPreparer: new FixedPreparer(), conversationId: CONV, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: `${CONV}-t1`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 4, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true,
  });
  const outbox = await persistence.listOutbox(CONV);
  const sendMsg = outbox.find((o) => o.kind === "send_message");
  const outboxText = typeof (sendMsg?.payload as any)?.text === "string" ? (sendMsg!.payload as any).text : "";
  return { result, outboxText };
}

async function main(): Promise<void> {
  console.log("== F2.16 Perguntas institucionais (offline) ==");
  const LEAD = "Onde fica a loja e qual o horário?";

  // [1] endereço + horário PRESENTES -> duas observações terminais (ok) + resposta com AMBOS + nenhuma repetição.
  {
    const bi = new FakeBI({ address: "Avenida Charles Schnneider, Taubaté", hours: "Seg a Sáb das 9h às 19h", unit: "Icom Motors", source: "cfg" });
    const r = await runTurn({ bi, leadText: LEAD, script: [finalT("."), finalT("Ficamos na Avenida Charles Schnneider, Taubaté e atendemos Seg a Sáb das 9h às 19h.")] });
    check("[1] address+hours: 2 observações terminais ok + resposta com AMBOS", r.result.status === "committed" && statusOf(r.result, "address") === "ok" && statusOf(r.result, "hours") === "ok" && /charles schnneider/i.test(r.outboxText) && /9h/i.test(r.outboxText) && bi.calls === 2 && !degradedOf(r.result), `inst=${JSON.stringify(instOf(r.result))} calls=${bi.calls} text="${r.outboxText}"`);
  }
  // [2] endereço OK, horário NOT_CONFIGURED -> não repete tool; responde endereço + ausência HONESTA do horário; sem degraded.
  {
    const bi = new FakeBI({ address: "Avenida Charles Schnneider, Taubaté", hours: null, unit: "Icom Motors", source: "cfg" });
    const r = await runTurn({ bi, leadText: LEAD, script: [finalT("."), finalT("Ficamos na Avenida Charles Schnneider, Taubaté. Sobre o horário, não tenho essa informação configurada aqui, mas confirmo com a equipe.")] });
    check("[2] address ok + hours NOT_CONFIGURED: responde endereço + ausência honesta, sem repetir, sem degraded", r.result.status === "committed" && statusOf(r.result, "address") === "ok" && statusOf(r.result, "hours") === "not_configured" && /charles schnneider/i.test(r.outboxText) && /hor[áa]rio/i.test(r.outboxText) && bi.calls === 2 && !degradedOf(r.result) && srcOf(r.result) !== "technical_fallback", `inst=${JSON.stringify(instOf(r.result))} calls=${bi.calls} degraded=${degradedOf(r.result)} text="${r.outboxText}"`);
  }
  // [3] AMBOS NOT_CONFIGURED -> resposta honesta, SEM loop e SEM technical_fallback.
  {
    const bi = new FakeBI({ address: null, hours: null, unit: "Icom Motors", source: "cfg" });
    const r = await runTurn({ bi, leadText: LEAD, script: [finalT("."), finalT("No momento não tenho o endereço nem o horário configurados aqui, mas posso confirmar com a equipe pra você.")] });
    check("[3] ambos NOT_CONFIGURED: honesto, sem loop (2 chamadas), sem technical_fallback", r.result.status === "committed" && statusOf(r.result, "address") === "not_configured" && statusOf(r.result, "hours") === "not_configured" && bi.calls === 2 && srcOf(r.result) !== "technical_fallback" && !degradedOf(r.result), `inst=${JSON.stringify(instOf(r.result))} calls=${bi.calls} src=${srcOf(r.result)} degraded=${degradedOf(r.result)}`);
  }
  // [4] READ_SOURCE_FAILURE (fonte cai) -> falha TÉCNICA observável; degraded PERMITIDO; sem loop (cada tópico 1x).
  {
    const bi = new FakeBI("throw");
    const r = await runTurn({ bi, leadText: LEAD, script: [finalT("."), finalT("Deixa eu confirmar o endereço e o horário com a equipe e já te falo.")] });
    check("[4] READ_SOURCE_FAILURE: falha técnica OBSERVÁVEL (institutionalResolved=failure), sem loop; degraded permitido", r.result.status === "committed" && statusOf(r.result, "address") === "failure" && statusOf(r.result, "hours") === "failure" && bi.calls === 2, `inst=${JSON.stringify(instOf(r.result))} calls=${bi.calls} degraded=${degradedOf(r.result)}`);
  }
  // [5] nenhuma chamada IDÊNTICA repetida: mesmo com o cérebro RE-consultando address, a fonte roda 1x por tópico.
  {
    const bi = new FakeBI({ address: "Avenida Charles Schnneider, Taubaté", hours: "Seg a Sáb das 9h às 19h", unit: "Icom", source: "cfg" });
    const r = await runTurn({ bi, leadText: LEAD, script: [
      q({ tool: "tenant_business_info", input: { topic: "address" as BusinessInfoTopic } }),
      q({ tool: "tenant_business_info", input: { topic: "address" as BusinessInfoTopic } }), // repetição idêntica
      finalT("Ficamos na Avenida Charles Schnneider, Taubaté e atendemos Seg a Sáb das 9h às 19h."),
    ] });
    check("[5] tópico resolvido no MÁXIMO 1x (repetição idêntica não reexecuta a fonte)", r.result.status === "committed" && bi.calls === 2 && statusOf(r.result, "address") === "ok" && statusOf(r.result, "hours") === "ok", `calls=${bi.calls} inst=${JSON.stringify(instOf(r.result))}`);
  }

  console.log(`\n== F2.16 INSTITUCIONAL: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
