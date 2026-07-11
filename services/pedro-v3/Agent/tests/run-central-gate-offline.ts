// ============================================================================
// R13-D/5 (audit Codex) — GATE conversacional OFFLINE (sem OpenAI). Roda o ENGINE central REAL com AgentBrain
// SCRIPTADO (as decisões que um bom cérebro tomaria) + FakeLlm (compose) e exige, DETERMINISTICAMENTE:
//   (a) "SUV até 90 mil" respondido com OFERTA antes de qualquer pergunta de funil;
//   (b) "o primeiro" resolve o PRIMEIRO item da última oferta (resolução determinística do engine);
//   (c) "gostei" não gera "você gostou?";
//   (d) nome CONHECIDO não é reperguntado (POL-QUESTION-OBJECTIVE bloqueia, mesmo se o cérebro tentar);
//   (e) pedido de visita + "sábado de manhã" avança o agendamento (diaHorario/interesseVisita known);
//   (f) nenhuma fixação: nenhum slot perguntado em 3 turnos consecutivos.
// O smoke pago NÃO é o gate; ESTE é. A qualidade das decisões do cérebro REAL é validada pelo dono no WhatsApp.
//   npx tsx tests/run-central-gate-offline.ts
// ============================================================================
import { runCentralConversationTurn } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { FakeLlm, type ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { slotQuestions } from "../src/engine/question-classify.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { AgentBrainDecision, AgentBrainStep, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { DecisionMutation, ProposedEffectPlan, QueryCall, QueryResult, TurnRelation } from "../src/domain/decision.ts";
import type { EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { Persistence } from "../src/domain/ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { redact } from "../src/domain/effect-intent.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-03T12:00:00.000Z";
const STOCK: VehicleFact[] = [
  { vehicleKey: "rm:1", marca: "Nissan", modelo: "Kicks", ano: 2018, preco: 74990, tipo: "suv", km: 60000, cambio: "Automatico", cor: "Prata" } as VehicleFact,
  { vehicleKey: "rm:2", marca: "Honda", modelo: "CRV", ano: 2010, preco: 62990, tipo: "suv", km: 158000, cambio: "Automatico", cor: "Preto" } as VehicleFact,
  { vehicleKey: "rm:3", marca: "Jeep", modelo: "Renegade", ano: 2019, preco: 89990, tipo: "suv", km: 70000, cambio: "Automatico", cor: "Branco" } as VehicleFact,
  { vehicleKey: "rm:4", marca: "Volkswagen", modelo: "Gol", ano: 2016, preco: 44990, tipo: "hatch", km: 90000, cambio: "Manual", cor: "Prata" } as VehicleFact,
];
const catalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
class FixedPreparer implements TurnContextPreparer {
  relation: TurnRelation = "ambiguous";
  async prepare() { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; }
}
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") {
    const inp = call.input as { tipo?: string; precoMax?: number };
    let items = STOCK.slice();
    if (inp.tipo) items = items.filter((v) => (v as VehicleFact & { tipo?: string }).tipo === inp.tipo);
    if (inp.precoMax != null) items = items.filter((v) => v.preco <= inp.precoMax!);
    return { ok: true, tool: "stock_search", data: { items, filtersUsed: inp as Record<string, never> }, source: "fake" } as QueryResult;
  }
  if (call.tool === "vehicle_details") { const v = STOCK.find((x) => x.vehicleKey === (call.input as { vehicleKey?: string }).vehicleKey); return v ? { ok: true, tool: "vehicle_details", data: { vehicle: v }, source: "fake" } as QueryResult : { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult; }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const businessInfo = { async getBusinessInfo() { return { address: null, hours: null, unit: null, source: "x" }; } };

const q = (call: CentralQueryCall): AgentBrainStep => ({ kind: "query", call });
function finalStep(over: { guidance: string; effects?: ProposedEffectPlan[]; stateMutations?: DecisionMutation[]; reasonCode?: string }): AgentBrainStep {
  const decision: AgentBrainDecision = {
    reasonCode: over.reasonCode ?? "reply", reasonSummary: "x", confidence: 0.9, responsePlan: { guidance: over.guidance },
    proposedEffects: over.effects ?? [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan],
    memoryMutations: [], stateMutations: over.stateMutations ?? [],
  };
  return { kind: "final", decision };
}
const plainText: ComposeOverride = (d) => ({ parts: [{ type: "text", content: d.responsePlan.guidance }] });
const offerList: ComposeOverride = (_d, facts) => {
  const s = facts.find((f) => f.ok && f.tool === "stock_search");
  const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
  return { parts: [{ type: "text", content: "Tenho estas opções de SUV pra você:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver as fotos de alguma?" }] };
};
// override que DESOBEDECE e tenta reperguntar o nome (testa o backstop POL-QUESTION-OBJECTIVE):
const askNameBad: ComposeOverride = () => ({ parts: [{ type: "text", content: "Sim, financiamos! Antes, qual é o seu nome?" }] });
function llmWith(o: ComposeOverride): FakeLlm { const l = new FakeLlm(); l.setTurnScript([], o); return l; }

const CENTRAL_LIMITS = { maxSteps: 4, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 };
const slot = (s: ConversationState | null, name: string) => (s?.slots as Record<string, { status?: string; value?: unknown }>)?.[name];

async function main(): Promise<void> {
  console.log("== R13-D/5 Gate conversacional OFFLINE (a-f) ==");
  const clock = new FakeClock(NOW);
  const p: Persistence = new InMemoryPersistence(clock, new FakeIdGen());
  // nome CONHECIDO desde o início (o lead se apresentou antes) -> testa (d).
  const seed = createInitialState({ conversationId: "g1", tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  seed.slots.nome = { status: "known", value: "Douglas", confidence: 1, updatedAt: NOW };
  const s0 = p.begin(); s0.casState("g1", 0, seed); s0.commit();

  const brain = new ScriptedAgentBrain();
  const prep = new FixedPreparer();
  const askedPerTurn: string[][] = [];
  let eventSeq = 0, turnSeq = 0;

  async function turn(leadText: string, script: AgentBrainStep[], compose: ComposeOverride, relation: TurnRelation): Promise<string> {
    prep.relation = relation;
    brain.setTurnScript(script);
    eventSeq++; await p.tryInsert({ eventId: `g1-e${eventSeq}`, conversationId: "g1", raw: redact({ text: leadText }) as never, receivedAt: clock.now() });
    clock.advance(1000);
    turnSeq++;
    const r = await runCentralConversationTurn({
      persistence: p, clock, brain, llm: llmWith(compose), runQuery, businessInfo, contextPreparer: prep,
      conversationId: "g1", tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: `g1-t${turnSeq}`,
      leaseTtlMs: 60_000, portalPromptSha256: "sha", limits: CENTRAL_LIMITS, maxValidationAttempts: 2, brainMaxSteps: 4,
      allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" },
    });
    const text = r.status === "committed" ? r.composedText : "";
    askedPerTurn.push(slotQuestions(text));
    // settle accepted (append da fala do agente em recentTurns -> lastAgentText p/ o próximo turno)
    while (true) {
      const claimed = await p.claimOutbox("g1", "w", 60_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `pm-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence: p, clock, conversationId: "g1", effectId: rec.effectId, result });
      }
    }
    clock.advance(30_000);
    return text;
  }

  // ── (a) "SUV até 90 mil" respondido com OFERTA antes de qualquer pergunta de funil ──
  const t1 = await turn("quero uma suv até 90 mil",
    [q({ tool: "stock_search", input: { tipo: "suv", precoMax: 90000 } }), finalStep({ guidance: "Tenho estas opções de SUV pra você:", stateMutations: [{ op: "set_slot", slot: "tipoVeiculo", value: "suv", confidence: 0.95, sourceTurnId: "g1-t1" }, { op: "set_slot", slot: "faixaPreco", value: { max: 90000 }, confidence: 0.9, sourceTurnId: "g1-t1" }] })],
    offerList, "direction_change");
  const nt1 = normalizeText(t1);
  check("(a) responde com OFERTA de SUV (aterrada) ao pedido comercial", /kicks|crv|renegade/.test(nt1));
  check("(a) NÃO faz pergunta de funil (nome) antes de ofertar", !/seu nome|qual.*nome|como.*chama/.test(nt1));

  // ── (b) "o primeiro" resolve o PRIMEIRO item da última oferta (determinístico do engine) ──
  await turn("o primeiro", [finalStep({ guidance: "Ótima escolha! Quer ver as fotos ou saber mais detalhes?" })], plainText, "continues_offer");
  const afterB = (await p.load("g1"))?.state ?? null;
  const firstOffered = afterB?.lastRenderedOfferContext?.items?.[0]?.vehicleKey;
  check("(b) 'o primeiro' -> selectedVehicleFocus = 1º item da última oferta", afterB?.vehicleContext.selected?.key === firstOffered && firstOffered === "rm:1", `${afterB?.vehicleContext.selected?.key} vs ${firstOffered}`);

  // ── (c) "gostei" não gera "você gostou?" ──
  const t3 = await turn("gostei", [finalStep({ guidance: "Que bom que gostou! Posso te passar mais detalhes desse carro?" })], plainText, "continues_offer");
  check("(c) 'gostei' não devolve 'você gostou?'", !/voce gostou|você gostou/i.test(t3), t3.slice(0, 60));

  // ── (d) nome CONHECIDO não é reperguntado (mesmo o cérebro tentando) ──
  const t4 = await turn("e vocês financiam?", [finalStep({ guidance: "Sim, financiamos! Antes, qual é o seu nome?" })], askNameBad, "answers_pending");
  check("(d) nome já conhecido NÃO é reperguntado (POL-QUESTION-OBJECTIVE)", !/seu nome|qual.*nome|como.*chama/.test(normalizeText(t4)), t4.slice(0, 60));

  // ── (e) visita + "sábado de manhã" avança o agendamento ──
  await turn("quero agendar uma visita", [finalStep({ guidance: "Perfeito! Que dia e horário fica melhor pra você?", stateMutations: [{ op: "set_slot", slot: "interesseVisita", value: true, confidence: 0.95, sourceTurnId: "g1-t5" }] })], plainText, "answers_pending");
  await turn("sábado de manhã", [finalStep({ guidance: "Combinado, te espero sábado de manhã!", stateMutations: [{ op: "set_slot", slot: "diaHorario", value: "sábado de manhã", confidence: 0.9, sourceTurnId: "g1-t6" }] })], plainText, "answers_pending");
  const afterE = (await p.load("g1"))?.state ?? null;
  // ⭐SEM (F2.48): a EXTRAÇÃO determinística é a autoridade do slot quando cobre o bloco — a mutação da LLM
  // ("sábado de manhã") é descartada em favor do valor extraído ("sábado"). O invariante do caso é o AVANÇO
  // do agendamento (ambos known), não o texto exato do dia.
  check("(e) agendamento avança: interesseVisita + diaHorario known", slot(afterE, "interesseVisita")?.status === "known" && slot(afterE, "interesseVisita")?.value === true && slot(afterE, "diaHorario")?.status === "known" && String(slot(afterE, "diaHorario")?.value ?? "").toLowerCase().includes("sábado"), JSON.stringify({ v: slot(afterE, "interesseVisita")?.value, d: slot(afterE, "diaHorario")?.value }));

  // ── (f) nenhuma fixação: nenhum slot perguntado em 3 turnos consecutivos ──
  let maxStreak = 0;
  const slotSet = new Set(askedPerTurn.flat());
  for (const s of slotSet) {
    let streak = 0;
    for (const asked of askedPerTurn) { streak = asked.includes(s) ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  }
  check("(f) nenhuma fixação de slot (< 3 turnos consecutivos no mesmo slot)", maxStreak < 3, `maxStreak=${maxStreak} asked=${JSON.stringify(askedPerTurn)}`);

  console.log(`\n== R13-D/5 GATE OFFLINE: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
