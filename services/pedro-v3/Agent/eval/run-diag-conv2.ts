// ============================================================================
// eval/run-diag-conv2.ts — DIAGNÓSTICO (observabilidade PURA, NÃO corrige código) da conversa 2 LLM-first.
// Objetivo: capturar a causa EXATA do technical_fallback/degraded em T4 "gostei do segundo" e T10 "não quero foto agora".
// Envolve o brain p/ capturar CADA draft bruto + proposedEffects por tentativa; correlaciona com o policyFeedback do
// engine (por tentativa). Roda SÓ a conversa 2. Efeitos OFF. gpt-4.1-mini real. Teto de custo. Probe de quota.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run diag:conv2
// ============================================================================
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL, PILOT_TENANT, PILOT_AGENT } from "./real-harness.ts";
import { buildCentralStack, CENTRAL_LIMITS, CENTRAL_ALLOWED_TOOLS } from "./central-real-harness.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome, deriveCurrentTurnIntent } from "../src/engine/central-engine.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { PromptTenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame } from "../src/domain/agent-brain.ts";
import type { EffectReceipt, EffectResult, QueryCall, QueryResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const CONV2 = ["Bom dia", "Douglas", "vocês tem SUV?", "gostei do segundo", "manda foto dele",
  "qual carro eu pedi foto?", "onde fica a loja?", "tem Onix?", "queria um popular até 50k", "não quero foto agora"];
const MAX_LLM_CALLS = 50;

type FinalAttempt = { draft: string; effects: string; reasonCode: string };
class DiagBrain implements AgentBrainPort {
  finals: FinalAttempt[] = [];
  tools: string[] = [];
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void { this.finals = []; this.tools = []; }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") this.tools.push((step.call as { tool: string }).tool + ":" + sanitize(JSON.stringify((step.call as { input?: unknown }).input ?? {})).slice(0, 60));
    else this.finals.push({
      draft: sanitize(JSON.stringify(step.decision.responsePlan.draft)).slice(0, 500),
      effects: sanitize(JSON.stringify(step.decision.proposedEffects)).slice(0, 260),
      reasonCode: sanitize(step.decision.reasonCode),
    });
    return step;
  }
}
const selOf = (state: unknown): string => {
  const s = (state as { vehicleContext?: { selected?: { key?: string; label?: string } } } | undefined)?.vehicleContext?.selected;
  return s?.key ? `${s.label ?? "?"} (${s.key})` : "—";
};

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== DIAG conv2 (só a conversa 2, singleAuthor+llmFirst, efeitos OFF, teto=${MAX_LLM_CALLS}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  const businessInfo = new PromptTenantBusinessInfoSource(assembly.runtimeConfig);

  // claimExtractor p/ recomputar currentTurnIntent (sem LLM): 1 stock_search amplo -> catálogo.
  let extractor: CatalogClaimExtractor | null = null;
  try {
    const stock = await assembly.runQuery({ tool: "stock_search", input: {} } as QueryCall) as QueryResult;
    if (stock.ok && stock.tool === "stock_search") extractor = new CatalogClaimExtractor(buildTenantCatalog(stock.data.items as unknown as VehicleFact[]));
  } catch { /* sem catálogo -> currentTurnIntent fica "?" */ }
  const intentOf = (msg: string): string => extractor ? deriveCurrentTurnIntent(msg, buildFrameSignals(msg, { relation: "ambiguous" }), extractor) : "?";

  // Probe de quota.
  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* final seguro; a prova é o 2xx */ }
  if (stack.brainTransport.okCount === 0) { console.error(`\nBLOQUEIO EXTERNO: sem quota/chave OpenAI (2xx=0). NÃO executando.`); process.exit(3); }
  console.log(`probe OK: brain 2xx (${stack.brainTransport.okCount}/${stack.brainTransport.count}).`);

  const base = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  const convId = "diag-conv2";
  { const seed = persistence.begin(); seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null, now: clock.now() })); if (!(await seed.commit()).ok) throw new Error("seed_failed"); }
  const diagBrain = new DiagBrain(stack.brain);

  type Turn = { i: number; lead: string; intent: string; selBefore: string; selAfter: string; finals: FinalAttempt[]; tools: string[]; policyFeedback: string[]; responseSource: string; terminalSafe: boolean; reasonCode: string; brainSteps: number; text: string; status: string };
  const turns: Turn[] = [];

  for (let i = 0; i < CONV2.length; i++) {
    if (stack.brainTransport.count + stack.composeTransport.count >= MAX_LLM_CALLS) { console.log(`[diag] teto atingido antes do turno ${i + 1}.`); break; }
    const lead = CONV2[i];
    const before = (await persistence.load(convId))?.state;
    await persistence.tryInsert({ eventId: `${convId}-e${i + 1}`, conversationId: convId, raw: redact({ text: lead }) as never, receivedAt: clock.now() });
    base.ms += 1_000;
    const turnId = `${convId}-t${i + 1}`;
    diagBrain.reset();
    const r = await runCentralConversationTurn({
      persistence, clock: clock as never, brain: diagBrain, llm: stack.composeLlm, runQuery: assembly.runQuery, businessInfo,
      contextPreparer: assembly.contextPreparer, conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null,
      workerId: "diag", turnId, leaseTtlMs: 120_000, portalPromptSha256: assembly.promptSha,
      limits: CENTRAL_LIMITS, maxValidationAttempts: 3, brainMaxSteps: 4, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
    });
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "diag", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
    const after = (await persistence.load(convId))?.state;
    turns.push({
      i: i + 1, lead, intent: intentOf(lead), selBefore: selOf(before), selAfter: selOf(after),
      finals: [...diagBrain.finals], tools: [...diagBrain.tools],
      policyFeedback: r.status === "committed" ? r.policyFeedback.map((f) => sanitize(f)) : [],
      responseSource: r.status === "committed" ? r.responseSource : r.status,
      terminalSafe: r.status === "committed" ? r.terminalSafe : false,
      reasonCode: r.status === "committed" ? sanitize(r.decision.reasonCode) : r.status,
      brainSteps: r.status === "committed" ? r.brainSteps : 0,
      text: sanitize(r.status === "committed" ? r.composedText : ""), status: r.status,
    });
    base.ms += 30_000;
    await new Promise((res) => setTimeout(res, 1200));
  }

  // ── RESUMO ─────────────────────────────────────────────────────────────────
  console.log(`\n== RESUMO POR TURNO ==`);
  for (const t of turns) console.log(`T${t.i} [${t.lead}] intent=${t.intent} | src=${t.responseSource} TS=${t.terminalSafe} steps=${t.brainSteps} | finals=${t.finals.length} feedbacks=${t.policyFeedback.length} tools=[${t.tools.join(" ")}] sel:${t.selBefore}→${t.selAfter}`);

  // ── DETALHE dos turnos DEGRADADOS (terminal_safe/technical_fallback) ─────────
  const degraded = turns.filter((t) => t.terminalSafe || t.responseSource === "technical_fallback");
  console.log(`\n== DETALHE DOS TURNOS DEGRADADOS (${degraded.length}) ==`);
  for (const t of degraded) {
    console.log(`\n────────── T${t.i} ──────────`);
    console.log(`1. leadMessage: "${t.lead}"`);
    console.log(`2. currentTurnIntent: ${t.intent}`);
    console.log(`3. selectedVehicle: antes=${t.selBefore} | depois=${t.selAfter}`);
    console.log(`6. tools chamadas: ${t.tools.length ? t.tools.join(" | ") : "(nenhuma)"}`);
    console.log(`4+5+7+8. tentativas de FINAL (draft bruto + effects + o feedback que a negou):`);
    t.finals.forEach((f, k) => {
      console.log(`   tentativa ${k + 1}: reasonCode=${f.reasonCode}`);
      console.log(`     draft:   ${f.draft}`);
      console.log(`     effects: ${f.effects}`);
      const fb = t.policyFeedback[k];
      console.log(`     ↳ policyFeedback/deny: ${fb ? fb : "(sem feedback — pré-empção por required-tool/B2/institucional, ou aceito)"}`);
    });
    console.log(`9. texto final enviado: "${t.text}"`);
    console.log(`10. por que esgotou: brainSteps=${t.brainSteps}/brainMaxSteps=4; finais rejeitados=${t.policyFeedback.length}; responseSource=${t.responseSource}. ${t.finals.length > t.policyFeedback.length ? "(algumas propostas foram pré-emptadas por required-tool/B2 antes do validate)" : "(todas as propostas de final foram negadas pelo validate -> fallback técnico)"}`);
  }

  const totalCalls = stack.brainTransport.count + stack.composeTransport.count;
  console.log(`\n== TOTAIS ==`);
  console.log(`OpenAI: ${totalCalls} chamadas (BRAIN ${stack.brainTransport.count} 2xx=${stack.brainTransport.okCount} · COMPOSE ${stack.composeTransport.count}) · turnos=${turns.length}/10`);
  console.log(`custo≈US$${((stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0) * 0.4 + stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0) * 1.6) / 1e6).toFixed(4)} · DIAGNÓSTICO (nenhum código corrigido)`);
  process.exit(0);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
