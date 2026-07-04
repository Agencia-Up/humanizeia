// ============================================================================
// eval/central-real-harness.ts — R13 Inc2/G. Roda o CENTRAL engine com AgentBrain REAL (gpt-4.1-mini) sobre a
// fiação VIVA (prompt/config/estoque reais via buildRealAssembly), efeitos OFF, InMemoryPersistence.
// Simula receipt accepted via commitEffectOutcome REAL + promoção accepted-safe da WM (applyAcceptedPhotoActionOutcome).
// ZERO dispatch externo. Prova: transporte do BRAIN e do COMPOSE contam chamadas 2xx + prompt integral + SHA-256.
//
// Brain (planner) temp 0.2 + compose temp 0.3: o cérebro decide o conteúdo, o compose só REDIGE aterrado — menos
// alucinação -> menos terminal_safe. Cada um com seu transporte contador (prova de prompt integral por papel).
// ============================================================================
import { buildRealAssembly, CountingModelHttpTransport, RetryingModelHttpTransport, sanitize, PILOT_MODEL, PILOT_TENANT, PILOT_AGENT, type RealAssembly } from "./real-harness.ts";
import { FetchModelHttpTransport } from "../src/runtime/fetch-transports.ts";
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { PromptBoundConversationAdapter } from "../src/adapters/llm/prompt-bound-conversation.ts";
import { createOpenAiModelFactory } from "../src/engine/openai-canary-root.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { RuntimeConfigBusinessInfoSource, type TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame } from "../src/domain/agent-brain.ts";
import type { EffectReceipt, EffectResult } from "../src/domain/decision.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

export const CENTRAL_LIMITS = { maxSteps: 4, totalTimeoutMs: 200_000, proposeTimeoutMs: 90_000, queryTimeoutMs: 25_000, composeTimeoutMs: 40_000 } as const;
export const CENTRAL_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"] as const;
// Pacing entre turnos (spread do burst) p/ não estourar o rate-limit de TPM da OpenAI numa corrida de 100+ turnos —
// assim o LLM REAL dirige a maioria dos turnos (okCount alto), em vez de cair no fallback determinístico por 429.
const INTER_TURN_DELAY_MS = Number(process.env.CENTRAL_EVAL_TURN_DELAY_MS ?? "2500");
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

export type CentralStack = {
  readonly brain: OpenAiAgentBrain;
  readonly brainTransport: CountingModelHttpTransport;
  readonly composeLlm: PromptBoundConversationAdapter;
  readonly composeTransport: CountingModelHttpTransport;
};

export function buildCentralStack(assembly: RealAssembly): CentralStack {
  // BRAIN (planner) temp 0.2 — decisões consistentes (buscar-antes-de-listar, resolver-antes-de-enviar-foto).
  const brainTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new FetchModelHttpTransport()));
  brainTransport.fullPrompt = assembly.runtimeConfig.promptText;
  const brain = new OpenAiAgentBrain(assembly.openAiSecret, brainTransport, assembly.runtimeConfig.promptText, {
    model: PILOT_MODEL, temperature: 0.1, maxCompletionTokens: 1200, timeoutMs: 60_000, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
  });
  // COMPOSE temp 0.3 — redige aterrado nos fatos (menos embelezamento -> menos grounding-deny -> menos terminal_safe).
  const composeTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new FetchModelHttpTransport()));
  composeTransport.fullPrompt = assembly.runtimeConfig.promptText;
  const composeModel = createOpenAiModelFactory({
    openAiSecret: assembly.openAiSecret, modelTransport: composeTransport,
    modelOptions: { modelOverride: PILOT_MODEL, temperatureOverride: 0.3, timeoutMs: 30_000, maxResponseBytes: 2 * 1024 * 1024, maxCompletionTokens: 1_200 },
  })(assembly.runtimeConfig);
  const composeLlm = new PromptBoundConversationAdapter(assembly.runtimeConfig, composeModel);
  return { brain, brainTransport, composeLlm, composeTransport };
}

class RecordingBrain implements AgentBrainPort {
  requestedTools: string[] = [];
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void { this.requestedTools = []; }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") this.requestedTools.push(step.call.tool);
    return step;
  }
}

type SlotShape = { status?: string; value?: unknown; ref?: unknown };
function slotSummary(state: ConversationState | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const slots = (state?.slots ?? {}) as Record<string, SlotShape>;
  for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? s.ref ?? null)}`; }
  return out;
}
function diffSlots(before: ConversationState | undefined, after: ConversationState | undefined): { slot: string; from: string; to: string }[] {
  const b = slotSummary(before), a = slotSummary(after);
  const d: { slot: string; from: string; to: string }[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) d.push({ slot: k, from: b[k] ?? "-", to: a[k] ?? "-" });
  return d;
}
function possuiTrocaStr(state: ConversationState | undefined): string {
  const s = (state?.slots as Record<string, SlotShape> | undefined)?.possuiTroca;
  return s?.status && s.status !== "unknown" ? `${s.status}:${JSON.stringify(s.value)}` : "unknown";
}

export async function runCentralConversation(assembly: RealAssembly, stack: CentralStack, convId: string, steps: readonly (readonly string[])[], opts: { readonly maxLlmCalls?: number; readonly singleAuthor?: boolean; readonly llmFirst?: boolean; readonly businessInfo?: TenantBusinessInfoSource } = {}): Promise<CentralTurnCapture[]> {
  const maxLlmCalls = opts.maxLlmCalls ?? Infinity;
  const base = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  // Fidelidade central_active: fonte de negócio do PROMPT (não RuntimeConfig que devolve null); parametrizável.
  const businessInfo = opts.businessInfo ?? new RuntimeConfigBusinessInfoSource(assembly.runtimeConfig);

  const seed = persistence.begin();
  seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null, now: clock.now() }));
  const seeded = seed.commit();
  if (!seeded.ok) throw new Error(`central_seed_failed: ${seeded.reason}`);

  const recordingBrain = new RecordingBrain(stack.brain);
  const captures: CentralTurnCapture[] = [];
  let eventSeq = 0, turnSeq = 0;

  for (const burst of steps) {
    // Teto de custo (R13-D/6): aborta ANTES de um novo turno quando o total de chamadas LLM (brain+compose) atinge o teto.
    if (stack.brainTransport.count + stack.composeTransport.count >= maxLlmCalls) {
      console.log(`[smoke] teto de chamadas LLM atingido (${stack.brainTransport.count + stack.composeTransport.count} >= ${maxLlmCalls}); abortando antes do turno ${turnSeq + 1}.`);
      break;
    }
    const before = (await persistence.load(convId))?.state;
    const wmBefore = loadPersistedWorkingMemory(before?.workingMemory).memory;
    const possuiTrocaBefore = possuiTrocaStr(before);
    for (const msg of burst) { eventSeq += 1; await persistence.tryInsert({ eventId: `${convId}-e${eventSeq}`, conversationId: convId, raw: redact({ text: msg }) as never, receivedAt: clock.now() }); }
    base.ms += 1_000;
    turnSeq += 1;
    const turnId = `central-${convId}-t${turnSeq}`;
    recordingBrain.reset();
    const brainBefore = stack.brainTransport.count;
    const composeBefore = stack.composeTransport.count;
    let r: Awaited<ReturnType<typeof runCentralConversationTurn>> | null = null;
    let error: string | undefined;
    try {
      r = await runCentralConversationTurn({
        persistence, clock: clock as never, brain: recordingBrain, llm: stack.composeLlm, runQuery: assembly.runQuery, businessInfo,
        contextPreparer: assembly.contextPreparer, conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null,
        workerId: "central-eval", turnId, leaseTtlMs: 120_000, portalPromptSha256: assembly.promptSha,
        limits: CENTRAL_LIMITS, maxValidationAttempts: 3, brainMaxSteps: 4, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
        providerCapability: { send_message: "none", send_media: "none" },
        singleAuthor: opts.singleAuthor ?? false, llmFirst: opts.llmFirst ?? false,
      });
    } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 160); }

    // ── SIMULA RECEIPT accepted (commitEffectOutcome REAL + promoção accepted-safe da WM). Sem dispatch. ──
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "central-eval", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }

    const after = (await persistence.load(convId))?.state;
    const wmAfter = loadPersistedWorkingMemory(after?.workingMemory).memory;
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; status: string; payload?: { vehicleKey?: string; photoIds?: string[] } }[];
    const brainCalls = stack.brainTransport.calls.slice(brainBefore);
    const composeCalls = stack.composeTransport.calls.slice(composeBefore);
    const allCalls = [...brainCalls, ...composeCalls];

    captures.push({
      turnIndex: turnSeq, turnId,
      leadBlock: sanitize(burst.join(" | ")),
      response: sanitize(r?.status === "committed" ? r.composedText : ""),
      status: r?.status ?? (error ? "error" : "unknown"),
      reasonCode: r?.status === "committed" ? r.decision.reasonCode : (r?.status === "commit_failed" ? `commit_failed:${r.reason.slice(0, 40)}` : undefined),
      responseSource: r?.status === "committed" ? r.responseSource : undefined,
      policyFeedback: r?.status === "committed" ? r.policyFeedback.map((f) => sanitize(f).slice(0, 200)) : undefined,
      terminalSafe: r?.status === "committed" ? r.terminalSafe : false,
      brainSteps: r?.status === "committed" ? r.brainSteps : 0,
      llmCallsInTurn: allCalls.length,
      promptExactInTurn: allCalls.length === 0 ? true : allCalls.every((c) => c.promptExact === true),
      toolsRequested: [...recordingBrain.requestedTools],
      observations: r?.status === "committed" ? r.toolObservations.map((o) => ({ tool: o.tool, ok: o.ok })) : [],
      effects: outbox.map((o) => ({ kind: o.kind, vehicleKey: o.payload?.vehicleKey, photoCount: Array.isArray(o.payload?.photoIds) ? o.payload!.photoIds!.length : undefined, status: o.status })),
      slotsDelta: diffSlots(before, after),
      wmBeforeLastPhotoLabel: wmBefore.lastPhotoAction?.label ?? null,
      wmAfterLastPhotoLabel: wmAfter.lastPhotoAction?.label ?? null,
      possuiTrocaBefore, possuiTrocaAfter: possuiTrocaStr(after),
    });
    base.ms += 30_000;
    if (INTER_TURN_DELAY_MS > 0) await realSleep(INTER_TURN_DELAY_MS);
  }
  return captures;
}
