// ============================================================================
// F2.74 — G1: policyDecision fantasma não derruba o turno (incidente Icom "obrigada" 2026-07-24).
//
// Uma policyDecision cuja REFERÊNCIA é inválida (política não configurada/desativada/shape inválido) é metadado que a
// LLM alucinou. Antes, virava issue HARD -> understanding untrusted -> "obrigada" caía em 5 retries -> technical_fallback
// ("Tive uma instabilidade..."). Agora é DESCARTADA (advisory): o turno segue pela evidência/intenção; a decisão vira
// null (não autoriza efeito/mutação/handoff). RIGOR: política REAL habilitada usada errado (ação/evidência) segue HARD.
//
// G2 (histórico, já corrigido em 93b9aa74): despedida NÃO exige qualified_handoff. Regressão de engine prova que um
// encerramento simples ("de nada") é aceito com handoff disponível — sem require-side, sem fallback.
//   npx tsx tests/run-f2-74-policy-decision-drop.ts
// ============================================================================
import { validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";
import type { TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { TenantFunnelPolicy } from "../src/domain/tenant-policy-contract.ts";
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const POLICY: TenantFunnelPolicy = {
  id: "entrada_financiada", enabled: true, name: "Entrada informada", domain: "financial",
  when: "quando o lead informa um valor de entrada", action: "inform",
  responseGuidance: "acolha o valor e prossiga", evidenceRequirement: "trecho com o valor", priority: 20,
};
const CTX = { tenantPolicies: [POLICY] };

function U(over: Partial<TurnUnderstanding>): TurnUnderstanding {
  return { primaryIntent: "other", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn",
    evidence: [], isTopicChange: false, answeredLeadQuestions: [], policyDecision: null, ...over } as TurnUnderstanding;
}

async function main(): Promise<void> {
  console.log("== F2.74: G1 policy fantasma descartada (não derruba o turno) ==");

  // ── PARTE A — G1 UNIT (validateTurnUnderstanding) ─────────────────────────────────────────────
  // [G1-1] "Obrigada" + policy NÃO configurada (a LLM alucinou o id) -> descarta -> turno CONFIÁVEL, zero issue.
  const v1 = validateTurnUnderstanding(
    U({ primaryIntent: "disengagement", evidence: [{ capability: "stock_search", quote: "Obrigada" }],
        policyDecision: { policyId: "disengagement_policy", action: "inform", evidence: "Obrigada" } as never }),
    "Obrigada.", true, CTX);
  check("[G1-1] policy fantasma NÃO torna o turno untrusted (obrigada segue natural)", v1.trusted === true, JSON.stringify(v1.semanticIssues));
  check("[G1-1b] policy fantasma é DESCARTADA (policyDecision -> null; não autoriza nada — Codex #3)", v1.understanding.policyDecision === null, JSON.stringify(v1.understanding.policyDecision));

  // [G1-2] policy REAL configurada, mas evidência NÃO aparece no bloco -> continua BLOQUEADA (rigor Codex #4).
  const v2 = validateTurnUnderstanding(
    U({ evidence: [{ capability: "stock_search", quote: "Obrigada" }],
        policyDecision: { policyId: "entrada_financiada", action: "inform", evidence: "tenho 15 mil" } as never }),
    "Obrigada.", true, CTX);
  check("[G1-2] policy REAL com evidência FORA do bloco -> untrusted (rigor mantido)", v2.trusted === false && v2.understanding.policyDecision != null, JSON.stringify(v2));

  // [G1-4] policy REAL configurada, mas AÇÃO incompatível com a config -> continua BLOQUEADA (rigor).
  const v4 = validateTurnUnderstanding(
    U({ evidence: [{ capability: "stock_search", quote: "Obrigada" }],
        policyDecision: { policyId: "entrada_financiada", action: "deny", evidence: "Obrigada" } as never }),
    "Obrigada.", true, CTX);
  check("[G1-4] policy REAL com AÇÃO incompatível -> untrusted (rigor)", v4.trusted === false, JSON.stringify(v4.semanticIssues));

  // [G1-5] CONTROLE: policy REAL + ação certa + evidência no bloco -> confiável e PRESERVADA (não descarta o que é válido).
  const v5 = validateTurnUnderstanding(
    U({ evidence: [{ capability: "stock_search", quote: "posso dar 15 mil de entrada" }],
        policyDecision: { policyId: "entrada_financiada", action: "inform", evidence: "posso dar 15 mil de entrada" } as never }),
    "posso dar 15 mil de entrada", true, CTX);
  check("[G1-5] policy REAL correta -> confiável e preservada", v5.trusted === true && v5.understanding.policyDecision != null, JSON.stringify(v5.semanticIssues));

  // [G1-6] policy fantasma com intenção/evidência boas NÃO deve deixar NENHUM issue de política nos semanticIssues.
  check("[G1-6] policy fantasma não injeta issue de política", !(v1.semanticIssues ?? []).some((i) => /pol[íi]tica/i.test(i)), JSON.stringify(v1.semanticIssues));

  // ── PARTE B — G2 REGRESSÃO DE ENGINE (despedida NÃO exige handoff; já corrigido em 93b9aa74) ──
  const catalog = buildTenantCatalog([]);
  const extractor = new CatalogClaimExtractor(catalog);
  const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aline", companyName: "Mônaco", promptText: "Você é a Aline." } as never);
  const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Mônaco", source: "t" }; } });
  class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
  class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor; catalogDegraded: boolean }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor, catalogDegraded: false }; } }
  const txt = (c: string): ResponsePart => ({ type: "text", content: c });
  const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
  const disU = U({ primaryIntent: "disengagement" as PrimaryIntent, evidence: [{ capability: "stock_search", quote: "Obrigada" }] });
  const closingBrain: BrainResponder = () => ({ kind: "final", understanding: disU,
    decision: { reasonCode: "reply", reasonSummary: "encerramento cordial", confidence: 0.9,
      responsePlan: { guidance: "g", draft: { parts: [txt("De nada! Estou à disposição, qualquer coisa é só chamar. 😊")] } },
      proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision } as AgentBrainStep);
  const runQuery = async (c: QueryCall): Promise<QueryResult> => { throw new Error("no tool " + c.tool); };
  const clock = new FakeClock("2026-07-24T12:00:00.000Z"); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const brain = new ScriptedAgentBrain(); brain.setResponder(closingBrain);
  const convId = "wa:f274-g2"; const turnId = `${convId}-t1`;
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: "Obrigada" }), receivedAt: clock.now() });
  clock.advance(1000);
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: new RelPreparer(),
    conversationId: convId, tenantId: "cf55ad47", agentId: "61054aad", leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: "sha-74",
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 6, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    handoff: { enabled: true, available: true, agentName: "Aline", leadPhone: "5512999999999", nowLocal: "2026-07-24 09:00", precheck: { available: true, reason: "available" } as never },
  } as never) as CentralTurnResult;
  const committed = r.status === "committed";
  const src = committed ? r.responseSource : null;
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  const outText = outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "";
  check("[G2-1] despedida simples é ACEITA com handoff disponível (brain_final, não technical_fallback)", committed && (src === "brain_final" || src === "brain_retry"), `status=${r.status} src=${src}`);
  check("[G2-2] engine NÃO força handoff numa despedida (sem require-side)", !outbox.some((o) => o.kind === "handoff"), JSON.stringify(outbox.map((o) => o.kind)));
  check("[G2-3] resposta natural de encerramento, sem 'instabilidade'", has(outText, "disposi") && !has(outText, "instabilidade"), `outbox="${outText}"`);

  // ── PARTE C — REPRO EXATO DA PRODUÇÃO (Icom "obrigada" 15:18): cérebro declara policy FANTASMA num turno de
  //    despedida. ANTES do fix: understanding untrusted -> understanding_required 5x -> technical_fallback. AGORA: descarta
  //    a policy e COMPÕE a resposta natural. ──
  const phantomBrain: BrainResponder = () => ({ kind: "final",
    understanding: U({ primaryIntent: "disengagement" as PrimaryIntent, evidence: [{ capability: "stock_search", quote: "Obrigada" }],
      policyDecision: { policyId: "disengagement_policy", action: "inform", evidence: "Obrigada" } as never }),
    decision: { reasonCode: "reply", reasonSummary: "encerramento", confidence: 0.9,
      responsePlan: { guidance: "g", draft: { parts: [txt("Imagina! Fico à disposição, qualquer coisa é só me chamar. 😊")] } },
      proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision } as AgentBrainStep);
  const clock2 = new FakeClock("2026-07-24T12:00:00.000Z"); const persistence2 = new InMemoryPersistence(clock2, new FakeIdGen());
  const brain2 = new ScriptedAgentBrain(); brain2.setResponder(phantomBrain);
  const convId2 = "wa:f274-c"; const turnId2 = `${convId2}-t1`;
  await persistence2.tryInsert({ eventId: `${convId2}-e1`, conversationId: convId2, raw: redact({ text: "Obrigada" }), receivedAt: clock2.now() });
  clock2.advance(1000);
  const r2: CentralTurnResult = await runCentralConversationTurn({
    persistence: persistence2, clock: clock2, brain: brain2, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: new RelPreparer(),
    conversationId: convId2, tenantId: "f49fd48a", agentId: "aee7e916", leadId: null, workerId: "w", turnId: turnId2, leaseTtlMs: 60_000, portalPromptSha256: "sha-74c",
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 6, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    handoff: { enabled: true, available: true, agentName: "Carvalho", leadPhone: "5512999999999", nowLocal: "2026-07-24 09:00", precheck: { available: true, reason: "available" } as never },
  } as never) as CentralTurnResult;
  const src2 = r2.status === "committed" ? r2.responseSource : null;
  const out2 = (await persistence2.listOutbox(convId2)).filter((o) => o.turnId === turnId2) as unknown as { kind: string; payload?: { text?: string } }[];
  const txt2 = out2.find((o) => o.kind === "send_message")?.payload?.text ?? "";
  check("[G1-E2E] policy fantasma na despedida -> COMPÕE (brain_final), NÃO technical_fallback", r2.status === "committed" && (src2 === "brain_final" || src2 === "brain_retry"), `status=${r2.status} src=${src2}`);
  check("[G1-E2E-b] lead recebe encerramento natural, NÃO 'instabilidade'", has(txt2, "disposi") && !has(txt2, "instabilidade"), `outbox="${txt2}"`);

  console.log(`\n== F2.74: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
