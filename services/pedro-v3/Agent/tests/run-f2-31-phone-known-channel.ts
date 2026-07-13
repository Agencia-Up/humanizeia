// ============================================================================
// F2.31 — P0 (INC2): no WhatsApp o telefone JÁ é conhecido pelo canal -> o agente NÃO pode pedir telefone do lead.
//   Incidente real (tenant ecb26258): após o nome, o agente perguntou "Douglas, qual é o seu telefone para contato?".
//   Origem = 100% o LLM (não há slot/pergunta hardcoded de telefone). Fix por invariante: signals.contactPhoneKnown
//   (canal "wa:") + guard POL-PHONE-KNOWN em validateResponse (deny+retry) + nota no protocolo do cérebro.
//   npx tsx tests/run-f2-31-phone-known-channel.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { asksLeadContactPhone, contactPhoneKnownFromChannel } from "../src/engine/turn-domain.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { buildSdrQualificationPolicy } from "../src/engine/sdr-conductor.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-06T12:00:00.000Z", SHA = "sha-31";
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));

const ONIX: VehicleFact = { vehicleKey: "rm:onix", marca: "Chevrolet", modelo: "Onix", ano: 2018, preco: 59990, km: 60000, cambio: "Manual", cor: "Preto", tipo: "hatch" };
const STOCK = [ONIX];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const sdrPolicy = buildSdrQualificationPolicy({ qualificationQuestions: [], agentName: "Aloan", companyName: "Avant", promptText: "Você é o Aloan da Avant." } as never);
const makeBI = (): TenantBusinessInfoSource => ({ async getBusinessInfo() { return { address: null, hours: null, unit: "Avant", source: "test" }; } });

const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") return { ok: true, tool: "stock_search", data: { items: STOCK.slice(), filtersUsed: (call.input as Record<string, never>) }, source: "fake" } as QueryResult;
  if (call.tool === "vehicle_details") { const v = STOCK[0]; return { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult; }
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], reasonCode: string, u: TurnUnderstanding): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
// cérebro que SEMPRE pede o telefone do lead (o bug).
const asksPhone: BrainResponder = () => finU([txt("Douglas, qual é o seu telefone para contato?")], "coleta_contato", U("other"));

type Cap = { outbox: string; committed: boolean; contactPhoneKnownSeen: boolean };
async function runOne(convId: string, lead: string, responder: BrainResponder): Promise<Cap> {
  const brain = new ScriptedAgentBrain(); const preparer = new RelPreparer(); const clock = new FakeClock(NOW); const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  preparer.relation = "ambiguous"; brain.setResponder(responder);
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t1`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: makeBI(), contextPreparer: preparer,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 8, sdrPolicy, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "", committed: r.status === "committed",
    contactPhoneKnownSeen: brain.seenFrames.some((f) => f.signals.contactPhoneKnown === true),
  };
}

async function main(): Promise<void> {
  console.log("== F2.31: não pedir telefone quando o WhatsApp já é o telefone (INC2) ==");

  // ── PARTE 1 — PURO ──
  check("[P-1] asksLeadContactPhone 'qual é o seu telefone para contato?' -> true", asksLeadContactPhone("Douglas, qual é o seu telefone para contato?") === true);
  check("[P-2] asksLeadContactPhone 'me passa seu número' -> true", asksLeadContactPhone("Me passa seu número pra eu te avisar quando surgir algo") === true);
  check("[P-3] asksLeadContactPhone 'qual seu telefone?' -> true", asksLeadContactPhone("Qual seu telefone?") === true);
  check("[P-4] asksLeadContactPhone NÃO dispara em dar o telefone da LOJA", asksLeadContactPhone("Nosso telefone é (11) 99999-9999, pode ligar") === false);
  check("[P-5] asksLeadContactPhone NÃO dispara em número ALTERNATIVO (exceção)", asksLeadContactPhone("Você tem um telefone alternativo pra contato?") === false);
  check("[P-6] asksLeadContactPhone NÃO dispara em pergunta normal", asksLeadContactPhone("Qual modelo você procura?") === false);
  check("[P-7] contactPhoneKnownFromChannel 'wa:...' -> true", contactPhoneKnownFromChannel("wa:8ed13714abc") === true);
  check("[P-8] contactPhoneKnownFromChannel não-wa -> false", contactPhoneKnownFromChannel("conv-1") === false && contactPhoneKnownFromChannel(null) === false);

  // ── PARTE 2 — INTEGRAÇÃO ──
  {
    // ⭐RD1-2: POL-PHONE-KNOWN virou ADVISORY no central_active — o sinal contactPhoneKnown CHEGA ao cérebro (I-1), que é
    // orientado a não pedir telefone. A LLM advertida usa o número do canal e não pede telefone; o engine ENTREGA (brain_final).
    const goodNoPhone: BrainResponder = () => finU([txt("Perfeito, Douglas! Você procura um modelo específico ou um tipo de carro?")], "reply", U("other"));
    const r = await runOne("wa:8ed13714deadbeef", "douglas", goodNoPhone);
    check("[I-1] canal wa: -> signals.contactPhoneKnown=true no frame do cérebro (advisory)", r.contactPhoneKnownSeen === true);
    check("[I-2] com phone-known como advisory, a resposta boa é ENTREGUE sem pedir telefone", r.committed && !has(r.outbox, "seu telefone") && !has(r.outbox, "seu numero") && !has(r.outbox, "seu número"), `outbox="${r.outbox}"`);
    // ⭐RD1-2 (contrato explícito): se a LLM IGNORA o advisory e pede o telefone, o engine NÃO bloqueia mais (entrega) —
    // o adversarial de estilo (LLM real seguindo o advisory) é coberto pelos smokes; aqui provamos "zero deny de estilo".
    const r2 = await runOne("wa:8ed13714deadbee2", "douglas", asksPhone);
    check("[I-2b] desvio de estilo (pede telefone) é ENTREGUE (committed), sem deny de estilo", r2.committed === true, `outbox="${r2.outbox}"`);
  }
  {
    // Controle: canal NÃO-wa (o guard é gated por canal) -> a pergunta passa (não é o cenário do bug).
    const r = await runOne("conv-legacy-1", "douglas", asksPhone);
    check("[I-3] canal não-wa: guard inerte (contactPhoneKnown=false), pergunta de telefone passa", r.contactPhoneKnownSeen === false && has(r.outbox, "telefone"), `outbox="${r.outbox}"`);
  }
  {
    // WhatsApp + resposta normal (sem pedir telefone) -> commit normal, sem falso-positivo.
    // ⭐AUTORIDADE: sem força heurística a AUTORIA é despachada — o responder simula a LLM real: classifica busca, CHAMA
    // stock_search e apresenta o resultado aterrado. O alvo do caso segue sendo o guard de telefone (não dispara).
    const searchU: TurnUnderstanding = { ...U("search_stock"), requestedCapabilities: ["stock_search"], evidence: [{ capability: "stock_search", quote: "Onix" }] };
    const r = await runOne("wa:8ed13714cafe", "quero um Onix", (_f, obs) => {
      const s = obs.find((o) => o.tool === "stock_search" && o.ok);
      if (!s) return { kind: "query", call: { tool: "stock_search", input: { modelo: "Onix" } }, understanding: searchU } as AgentBrainStep;
      return finU([txt("Ótimo! Encontrei este pra você:"), { type: "vehicle_offer_list", vehicleKeys: [ONIX.vehicleKey] } as ResponsePart, txt("Quer ver as condições?")], "reply", searchU);
    });
    check("[I-4] wa: + resposta sem pedir telefone -> commit normal (sem falso-positivo)", r.committed && has(r.outbox, "Onix"), `outbox="${r.outbox}"`);
  }

  console.log(`\n== F2.31: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
