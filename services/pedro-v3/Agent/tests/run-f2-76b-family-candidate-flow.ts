// ============================================================================
// F2.76b — FLUXO INTEGRADO do candidato de família (engine central REAL, singleAuthor+llmFirst).
//
// Prova ponta a ponta (ordem Codex #4) o que os testes unitários NÃO cobrem:
//   TURNO 1: lead pede "HB20 Confort Plus 2017"; a stock_search volta matchKind=family_candidate (items:[],
//     familyCandidates:[HB20 2017]). A 1ª resposta é DELIBERADAMENTE negada (vaza a vehicleKey crua no texto ->
//     guarda de chave interna). No RETRY o cérebro apresenta o candidato de forma TRANSPARENTE (nomeia HB20 2017
//     aterrado + pede pra confirmar a versão). ASSERTS: (a) o feedback do retry NÃO contém "vazia" (def#2: um turno
//     family_candidate nunca é "busca vazia"); a única negação foi a de chave interna. (b) a resposta nomeia o carro
//     sem vazar a chave. (c) commit por brain_retry, sem fallback/degradação.
//   TURNO 2: lead pede "as fotos do HB20 2017"; o candidato apresentado no turno 1 ficou aterrado em
//     lastRenderedOfferContext (fix offer-context) -> resolve fotos e envia send_media na vehicleKey REAL (Codex #6).
//     ASSERTS: (d) send_media na key real; (e) resolveu fotos da key real; (f) sem fallback.
//   npx tsx tests/run-f2-76b-family-candidate-flow.ts
// ============================================================================
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation, EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (s: string, n: string): boolean => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());

const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-24T09:00:00.000Z", SHA = "sha-76b";
const CAND_KEY = "Hyundai|HB20|2017";
const CAND: VehicleFact = { vehicleKey: CAND_KEY, marca: "Hyundai", modelo: "HB20", ano: 2017, preco: 52100, km: 60000, cambio: "Manual", cor: "Prata", tipo: "hatch" };
const catalog = buildTenantCatalog([CAND]);
const extractor = new CatalogClaimExtractor(catalog);

const executed: QueryCall[] = [];
// runQuery: consulta de VERSÃO ("HB20 Confort Plus") -> family_candidate; modelo-base "HB20" -> exato; fotos -> ids.
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  executed.push(call);
  if (call.tool === "stock_search") {
    const modelo = String((call.input as { modelo?: string }).modelo ?? "");
    if (/confort/i.test(modelo)) {
      return { ok: true, tool: "stock_search", source: "fake", data: { items: [], filtersUsed: call.input as Record<string, never>, familyCandidates: [CAND], matchKind: "family_candidate" } } as QueryResult;
    }
    return { ok: true, tool: "stock_search", source: "fake", data: { items: [CAND], filtersUsed: call.input as Record<string, never>, matchKind: "exact" } } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") { const key = (call.input as { vehicleRef?: { key?: string } }).vehicleRef?.key ?? ""; return { ok: true, tool: "vehicle_photos_resolve", source: "fake", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1", "p2"] } } as QueryResult; }
  if (call.tool === "vehicle_details") { return { ok: true, tool: "vehicle_details", source: "fake", data: { vehicle: CAND } } as QueryResult; }
  throw new Error("runQuery tool não suportada: " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("single-author não chama propose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "[SPY]" }] }; } }
class RelPreparer implements TurnContextPreparer { relation: TurnRelation = "ambiguous"; async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: this.relation }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent, o: Partial<TurnUnderstanding> = {}): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [], ...o });
const searchU: TurnUnderstanding = U("search_stock", { requestedCapabilities: ["stock_search"], subject: "explicit_model", subjectValue: "HB20 Confort Plus", evidence: [{ capability: "stock_search", quote: "HB20 Confort Plus" }] });
const photoU: TurnUnderstanding = U("request_photos", { requestedCapabilities: ["send_photos"], subject: "explicit_model", subjectValue: "HB20", evidence: [{ capability: "send_photos", quote: "fotos" }] });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const vref = (field: "marca" | "modelo" | "ano"): ResponsePart => ({ type: "vehicle_ref", vehicleKey: CAND_KEY, field });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const media: ProposedEffectPlan = { kind: "send_media", planId: "m", order: 1, vehicleKey: CAND_KEY, photoIds: ["p1", "p2"], onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], u: TurnUnderstanding, reasonCode = "reply", effects: ProposedEffectPlan[] = [reply]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode, reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const qU = (input: Record<string, unknown>, tool: QueryCall["tool"], u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call: { tool, input } as never, understanding: u } as AgentBrainStep);

type Cap = { outbox: string; committed: boolean; src: string | null; reasonCode: string | null; degraded: boolean; hasMedia: boolean; mediaKey: string | null; brainFeedback: string[]; exec: QueryCall[] };

function makeConv(convId: string): { turn: (lead: string, responder: BrainResponder) => Promise<Cap> } {
  const brain = new ScriptedAgentBrain();
  const preparer = new RelPreparer();
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const businessInfo = { async get() { return { ok: false as const, error: { code: "NOT_CONFIGURED" as const, message: "n/a" } }; } } as never;
  let seq = 0;
  const turn = async (lead: string, responder: BrainResponder): Promise<Cap> => {
    seq += 1; executed.length = 0; brain.setResponder(responder);
    const framesBefore = brain.seenObservations.length;
    await persistence.tryInsert({ eventId: `${convId}-e${seq}`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
    clock.advance(1000);
    const turnId = `${convId}-t${seq}`;
    const r: CentralTurnResult = await runCentralConversationTurn({
      persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo, contextPreparer: preparer,
      conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
      limits: { maxSteps: 8, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
      maxValidationAttempts: 3, brainMaxSteps: 8, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    } as never);
    const execSnapshot = [...executed];
    // Materializa e confirma efeitos (para o send_media virar OutboxRecord com receipt, como no fluxo real).
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "w", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
    clock.advance(30000);
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
    const brainFeedback = brain.seenObservations.slice(framesBefore).flat().filter((o) => o.tool === "response" && !o.ok).map((o) => (o.ok === false ? o.error.message : ""));
    const mediaRec = outbox.find((o) => o.kind === "send_media");
    return {
      outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
      committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : r.status,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : null, degraded: r.status === "committed" ? r.degraded : false,
      hasMedia: !!mediaRec, mediaKey: mediaRec?.payload?.vehicleKey ?? null, brainFeedback, exec: execSnapshot,
    };
  };
  return { turn };
}

async function main(): Promise<void> {
  console.log("== F2.76b: fluxo integrado do candidato de família ==");
  const { turn } = makeConv("wa:f276b:hb20");

  // ── TURNO 1: "tem HB20 Confort Plus 2017?" -> busca; 1º draft vaza a chave (deny); retry apresenta transparente. ──
  const t1Responder: BrainResponder = (_frame, observations) => {
    const ranSearch = observations.some((o) => o.tool === "stock_search");
    const priorDenies = observations.filter((o) => o.tool === "response" && !o.ok).length;
    if (!ranSearch) return qU({ modelo: "HB20 Confort Plus", anos: [2017] }, "stock_search", searchU);
    if (priorDenies === 0) return finU([txt(`Encontrei este: ${CAND_KEY}. Deixa eu confirmar a versao.`)], searchU, "family_candidate_present"); // vaza a chave -> deny
    return finU([txt("No estoque eu tenho um "), vref("modelo"), txt(" "), vref("ano"), txt(", mas preciso confirmar se a versao exata e a Confort Plus. Quer que eu confirme os detalhes dele?")], searchU, "family_candidate_present");
  };
  const t1 = await turn("tem HB20 Confort Plus 2017?", t1Responder);
  check("[T1-a] o retry NUNCA recebeu 'vazia' (family_candidate não é busca vazia)", t1.brainFeedback.length >= 1 && t1.brainFeedback.every((f) => !/vazi/i.test(f)), JSON.stringify(t1.brainFeedback));
  check("[T1-a2] a ÚNICA negação foi a de chave interna (não a de estoque vazio)", t1.brainFeedback.length === 1 && has(t1.brainFeedback[0], "chave interna"), JSON.stringify(t1.brainFeedback));
  check("[T1-b] a resposta NOMEIA o HB20 2017 e pede pra confirmar a versão", has(t1.outbox, "hb20") && has(t1.outbox, "2017") && (has(t1.outbox, "confirm") || has(t1.outbox, "versao")), `outbox="${t1.outbox}"`);
  check("[T1-b2] a resposta NÃO vaza a vehicleKey crua", !t1.outbox.includes(CAND_KEY), `outbox="${t1.outbox}"`);
  check("[T1-c] commit por brain_retry, sem fallback nem degradação", t1.committed && t1.src === "brain_retry" && t1.reasonCode !== "technical_fallback" && t1.reasonCode !== "contextual_recovery" && !t1.degraded, `src=${t1.src} rc=${t1.reasonCode} deg=${t1.degraded}`);

  // ── TURNO 2: "me manda as fotos do HB20 2017" -> resolve o candidato aterrado no turno 1 e envia na key REAL. ──
  const t2Responder: BrainResponder = (_frame, observations) => {
    const resolved = observations.some((o) => o.tool === "vehicle_photos_resolve" && o.ok);
    if (!resolved) return qU({ vehicleRef: { kind: "vehicle", key: CAND_KEY } }, "vehicle_photos_resolve", photoU);
    return finU([txt("Aqui estao as fotos que voce pediu!")], photoU, "send_vehicle_photos", [reply, media]);
  };
  const t2 = await turn("me manda as fotos do HB20 2017", t2Responder);
  check("[T2-d] send_media enviado na vehicleKey REAL do candidato", t2.hasMedia && t2.mediaKey === CAND_KEY, `hasMedia=${t2.hasMedia} key=${t2.mediaKey}`);
  check("[T2-e] resolveu fotos da key REAL (candidato do turno 1 aterrado via offer-context)", t2.exec.some((c) => c.tool === "vehicle_photos_resolve" && (c.input as { vehicleRef?: { key?: string } }).vehicleRef?.key === CAND_KEY), JSON.stringify(t2.exec.map((c) => c.tool)));
  check("[T2-f] turno de foto commitado sem fallback/degradação", t2.committed && t2.reasonCode !== "technical_fallback" && !t2.degraded, `src=${t2.src} rc=${t2.reasonCode} deg=${t2.degraded}`);

  console.log(`\n== F2.76b: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
