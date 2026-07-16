// ============================================================================
// eval/central-real-harness.ts — R13 Inc2/G. Roda o CENTRAL engine com AgentBrain REAL (gpt-4.1-mini) sobre a
// fiação VIVA (prompt/config/estoque reais via buildRealAssembly), efeitos OFF, InMemoryPersistence.
// Simula receipt accepted via commitEffectOutcome REAL + promoção accepted-safe da WM (applyAcceptedPhotoActionOutcome).
// ZERO dispatch externo. Prova: transporte do BRAIN e do COMPOSE contam chamadas 2xx + prompt integral + SHA-256.
//
// Brain (planner) temp 0.2 + compose temp 0.3: o cérebro decide o conteúdo, o compose só REDIGE aterrado — menos
// alucinação -> menos terminal_safe. Cada um com seu transporte contador (prova de prompt integral por papel).
// ============================================================================
import { CountingModelHttpTransport, RetryingModelHttpTransport, sanitize, type RealAssembly } from "./real-harness.ts";
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
import { createHash } from "node:crypto";
import { extractSensitiveSpans, materializeSensitiveTokens } from "../src/domain/sensitive-data.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

export const CENTRAL_LIMITS = { maxSteps: 4, totalTimeoutMs: 200_000, proposeTimeoutMs: 90_000, queryTimeoutMs: 25_000, composeTimeoutMs: 40_000 } as const;
export const CENTRAL_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info", "knowledge_search"] as const;
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
    endpointUrl: assembly.aiProvider.endpointUrl,
    allowedHosts: [...assembly.aiProvider.allowedHosts],
    tokenParameter: assembly.aiProvider.tokenParameter,
    model: assembly.aiProvider.model,
    retryModel: assembly.aiProvider.retryModel,
    temperature: 0.1, maxCompletionTokens: 1200, timeoutMs: 60_000, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
  });
  // COMPOSE temp 0.3 — redige aterrado nos fatos (menos embelezamento -> menos grounding-deny -> menos terminal_safe).
  const composeTransport = new CountingModelHttpTransport(new RetryingModelHttpTransport(new FetchModelHttpTransport()));
  composeTransport.fullPrompt = assembly.runtimeConfig.promptText;
  const composeModel = createOpenAiModelFactory({
    openAiSecret: assembly.openAiSecret, modelTransport: composeTransport,
    modelOptions: {
      endpointUrl: assembly.aiProvider.endpointUrl,
      allowedHosts: [...assembly.aiProvider.allowedHosts],
      tokenParameter: assembly.aiProvider.tokenParameter,
      modelOverride: assembly.aiProvider.model,
      temperatureOverride: 0.3,
      timeoutMs: 30_000,
      maxResponseBytes: 2 * 1024 * 1024,
      maxCompletionTokens: 1_200,
    },
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

export async function runCentralConversation(assembly: RealAssembly, stack: CentralStack, convId: string, steps: readonly (readonly string[])[], opts: {
  readonly maxLlmCalls?: number; readonly singleAuthor?: boolean; readonly llmFirst?: boolean; readonly businessInfo?: TenantBusinessInfoSource;
  // MISSÃO PII: fidelidade de produção no smoke — handoff plannable (fake, NUNCA notifica vendedor real:
  // efeitos seguem OFF/simulados) + vínculo de lead p/ crmWriteEnabled (o handoff exige lead vinculado).
  readonly handoff?: { readonly enabled: boolean; readonly available: boolean; readonly precheck?: import("../src/engine/handoff-precheck.ts").HandoffPrecheckDiag };
  readonly crmLeadId?: string | null;
  // ⭐P0-D (driver ADAPTATIVO/ADVERSARIAL): quando presente, a próxima rajada NÃO vem de `steps` — vem deste driver, que
  // lê `pendingSlot` (o slot que o agente acabou de perguntar via WM.pendingAgentQuestion) e o último capture. Retorna a
  // próxima rajada ou null p/ encerrar. Adaptativo: responde ao slot pedido; Adversarial: ignora/contradiz o slot pendente.
  readonly driver?: (ctx: { readonly turnIndex: number; readonly last: CentralTurnCapture | null; readonly pendingSlot: string | null }) => readonly string[] | null;
  // Eval-only fidelity hooks: production persists these on the inbox record
  // when the Edge bridge receives a Click-to-WhatsApp ad or inbound media.
  readonly firstTurnAdContext?: unknown;
  readonly mediaContextByTurn?: Readonly<Record<number, unknown>>;
} = {}): Promise<CentralTurnCapture[]> {
  const maxLlmCalls = opts.maxLlmCalls ?? Infinity;
  const base = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  // Fidelidade central_active: fonte de negócio do PROMPT (não RuntimeConfig que devolve null); parametrizável.
  const businessInfo = opts.businessInfo ?? new RuntimeConfigBusinessInfoSource(assembly.runtimeConfig);

  const seed = persistence.begin();
  seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: assembly.ref.tenantId, agentId: assembly.ref.agentId, leadId: opts.crmLeadId ?? null, now: clock.now() }));
  const seeded = seed.commit();
  if (!seeded.ok) throw new Error(`central_seed_failed: ${seeded.reason}`);

  const recordingBrain = new RecordingBrain(stack.brain);
  const captures: CentralTurnCapture[] = [];
  let eventSeq = 0, turnSeq = 0;

  let stepIdx = 0;
  while (true) {
    // Próxima rajada: do DRIVER adaptativo/adversarial (lê pendingSlot do último capture) OU da lista fixa `steps`.
    let burst: readonly string[];
    if (opts.driver) {
      const last = captures[captures.length - 1] ?? null;
      const next = opts.driver({ turnIndex: turnSeq, last, pendingSlot: last?.pendingAgentQuestion ?? null });
      if (next == null || next.length === 0) break;
      burst = next;
    } else {
      if (stepIdx >= steps.length) break;
      burst = steps[stepIdx++];
    }
    // Teto de custo (R13-D/6): aborta ANTES de um novo turno quando o total de chamadas LLM (brain+compose) atinge o teto.
    if (stack.brainTransport.count + stack.composeTransport.count >= maxLlmCalls) {
      console.log(`[smoke] teto de chamadas LLM atingido (${stack.brainTransport.count + stack.composeTransport.count} >= ${maxLlmCalls}); abortando antes do turno ${turnSeq + 1}.`);
      break;
    }
    const before = (await persistence.load(convId))?.state;
    const wmBefore = loadPersistedWorkingMemory(before?.workingMemory).memory;
    const possuiTrocaBefore = possuiTrocaStr(before);
    // Fidelidade do ingest de producao: classifica pelo bloco atual + ultima
    // pergunta do agente e materializa refs opacas como se o cofre tivesse
    // confirmado a gravacao. O valor existe somente nesta pilha local do eval.
    const lastAgentText = [...(before?.recentTurns ?? [])].reverse().find((t) => t.role === "agent")?.text ?? "";
    for (const msg of burst) {
      eventSeq += 1;
      const eventId = `${convId}-e${eventSeq}`;
      const sensitive = extractSensitiveSpans(msg, new Date(clock.now()).getUTCFullYear(), {
        expectsCpf: /\bcpf\b/i.test(msg) || /\bcpf\b/i.test(lastAgentText),
        expectsBirthDate: /\b(?:data\s+de\s+nascimento|nascimento)\b/i.test(msg)
          || /\b(?:data\s+de\s+nascimento|nascimento)\b/i.test(lastAgentText),
      });
      const refs = new Map<string, string>();
      sensitive.secrets.forEach((secret, index) => refs.set(secret.placeholder,
        createHash("sha256").update(`${convId}\0${eventId}\0${index}\0${secret.kind}`).digest("hex")));
      // `turnSeq` is zero-based until after this burst is committed. Keep the
      // eval hooks aligned with the one-based turn numbers used by callers and
      // by the production bridge (the ad/media belong to this first inbound
      // message, never the following one).
      const inboundTurnNumber = turnSeq + 1;
      const raw = {
        text: materializeSensitiveTokens(sensitive, refs),
        ...(inboundTurnNumber === 1 && opts.firstTurnAdContext ? { adContext: opts.firstTurnAdContext } : {}),
        ...(opts.mediaContextByTurn?.[inboundTurnNumber] ? { mediaContext: opts.mediaContextByTurn[inboundTurnNumber] } : {}),
      };
      await persistence.tryInsert({
        eventId, conversationId: convId,
        raw: redact(raw) as never,
        receivedAt: clock.now(),
      });
    }
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
        contextPreparer: assembly.contextPreparer, conversationId: convId, tenantId: assembly.ref.tenantId, agentId: assembly.ref.agentId, leadId: opts.crmLeadId ?? null,
        workerId: "central-eval", turnId, leaseTtlMs: 120_000, portalPromptSha256: assembly.promptSha,
        limits: CENTRAL_LIMITS, maxValidationAttempts: 3, brainMaxSteps: 6, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
        providerCapability: { send_message: "none", send_media: "none" },
        singleAuthor: opts.singleAuthor ?? false, llmFirst: opts.llmFirst ?? false,
        // MISSÃO PII: handoff plannable no smoke (fake — efeitos seguem OFF/simulados; NENHUM vendedor real
        // é notificado) + vínculo de lead sintético p/ o gate crmWriteEnabled&&leadId do handoffPlannable.
        crmWriteEnabled: opts.crmLeadId != null,
        handoff: opts.handoff ? {
          enabled: opts.handoff.enabled, available: opts.handoff.available,
          agentName: assembly.runtimeConfig.agentName, leadPhone: "5512988887777",
          nowLocal: new Date(clock.now()).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
          precheck: opts.handoff.precheck,
        } : undefined,
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
    const brainRequestAudits = stack.brainTransport.requestAudits.filter((a) => a.seq > brainBefore && a.seq <= stack.brainTransport.count);
    const allCalls = [...brainCalls, ...composeCalls];

    captures.push({
      turnIndex: turnSeq, turnId,
      leadBlock: sanitize(burst.join(" | ")),
      response: sanitize(r?.status === "committed" ? r.composedText : ""),
      status: r?.status ?? (error ? "error" : "unknown"),
      reasonCode: r?.status === "committed" ? r.decision.reasonCode : (r?.status === "commit_failed" ? `commit_failed:${r.reason.slice(0, 40)}` : undefined),
      responseSource: r?.status === "committed" ? r.responseSource : undefined,
      policyFeedback: r?.status === "committed" ? r.policyFeedback.map((f) => sanitize(f).slice(0, 200)) : undefined,
      primaryIntent: r?.status === "committed" ? r.understanding.primaryIntent : undefined,
      targetResolutionSource: r?.status === "committed" ? r.targetResolutionSource : undefined,
      resolvedVehicleKey: r?.status === "committed" ? r.resolvedVehicleKey : undefined,
      understandingFromBrain: r?.status === "committed" ? r.understandingFromBrain : undefined,
      terminalSafe: r?.status === "committed" ? r.terminalSafe : false,
      brainSteps: r?.status === "committed" ? r.brainSteps : 0,
      llmCallsInTurn: allCalls.length,
      promptExactInTurn: allCalls.length === 0 ? true : allCalls.every((c) => c.promptExact === true),
      toolsRequested: [...recordingBrain.requestedTools],
      observations: r?.status === "committed" ? r.toolObservations.map((o) => ({ tool: o.tool, ok: o.ok, code: o.ok ? undefined : o.error.code })) : [],
      effects: outbox.map((o) => ({ kind: o.kind, vehicleKey: o.payload?.vehicleKey, photoCount: Array.isArray(o.payload?.photoIds) ? o.payload!.photoIds!.length : undefined, status: o.status })),
      // MISSÃO PII: briefing/reason do handoff planejado no turno (relatório integral do smoke).
      handoffBriefing: (outbox.find((o) => o.kind === "handoff") as unknown as { payload?: { briefing?: string } } | undefined)?.payload?.briefing ?? null,
      handoffReason: (outbox.find((o) => o.kind === "handoff") as unknown as { payload?: { reason?: string } } | undefined)?.payload?.reason ?? null,
      slotsDelta: diffSlots(before, after),
      wmBeforeLastPhotoLabel: wmBefore.lastPhotoAction?.label ?? null,
      wmAfterLastPhotoLabel: wmAfter.lastPhotoAction?.label ?? null,
      possuiTrocaBefore, possuiTrocaAfter: possuiTrocaStr(after),
      selectedVehicleKeyAfter: after?.vehicleContext.selected?.key ?? null,
      pendingAgentQuestion: wmAfter.pendingAgentQuestion?.slot ?? null,
      llmRequestAudits: brainRequestAudits,
    });
    base.ms += 30_000;
    if (INTER_TURN_DELAY_MS > 0) await realSleep(INTER_TURN_DELAY_MS);
  }
  return captures;
}
