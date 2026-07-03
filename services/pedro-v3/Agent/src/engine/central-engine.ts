// ============================================================================
// central-engine.ts — R13 Inc2/C (+B). O AGENTE CENTRAL governa o turno.
//
// UM único cérebro comercial por turno (Brain/11 §2). Fluxo:
//   inbox consolidado -> prompt do portal -> ConversationState -> WorkingMemory -> transcript -> TurnFrame
//   -> AgentBrainPort loop (query autorizada por chamada; tool devolve FATO tipado; observação volta ao MESMO
//      cérebro) -> UMA decisão final -> compose/render (reusa) -> policies validam -> reducers (estado + WM) ->
//      commit CAS (state + WorkingMemory + decisão + eventos + outbox na MESMA UnitOfWork) -> EffectGate OFF.
//
// Regras de ferro: nenhum handler comercial roda antes do cérebro; regex é só evidência; tool nunca fala com o
// lead; policy valida, não escolhe assunto; no máximo uma decisão comercial; tool só quando falta um fato.
//
// Flag: PEDRO_V3_BRAIN_MODE=central_shadow (default OFF). Sem efeito externo (shadow): o outbox nasce 'pending'
// e NENHUM dispatcher é criado aqui.
// ============================================================================
import type { DecisionLlm } from "../domain/llm.ts";
import type { Clock, Persistence, UnitOfWork, WorkingMemoryOutcomeStore } from "../domain/ports.ts";
import type { TurnContextPreparer, QueryLoopLimits } from "../domain/context.ts";
import type { TurnContext } from "../domain/context.ts";
import { createInitialState } from "../domain/conversation-state.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type {
  DecisionMutation, ProposedDecision, ProposedEffectPlan, QueryCall, QueryResult, TurnAction, TurnDecision, EffectResult,
} from "../domain/decision.ts";
import type {
  AgentBrainPort, AgentBrainDecision, AgentToolObservation, CentralQueryCall, PersistedWorkingMemory,
  PhotoActionDraft, ToolResultMemory, ToolTelemetry, WorkingMemoryV1,
} from "../domain/agent-brain.ts";
import type { TenantAgentRef } from "../domain/read-ports.ts";
import type { InboxRecord, OutboxRecord, ProviderCapability, TurnEventRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, Iso, JsonValue, VehicleFact } from "../domain/types.ts";
import { composeAndVerify, withTimeout } from "./decision-engine.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { PolicyEngine, hasDeny } from "./policy-engine.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { buildContextualSdrReply } from "./continuity-fallback.ts";
import type { RenderedResponse, ResponsePart } from "../domain/decision.ts";
import { finalize } from "./finalizer.ts";
import { applyDecision } from "./state-reducer.ts";
import { materializeEffectPlans } from "./effect-materializer.ts";
import { computeRenderedOfferContext } from "./offer-context.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "./vehicle-focus.ts";
import { extractLeadSlots, resolveSelectedVehicle } from "./lead-extraction.ts";
import { safeCommitSlots } from "./conversation-engine.ts";
import { reconcileObjectiveWithQuestion, type SdrQualificationPolicy } from "./sdr-conductor.ts";
import { buildTurnFrame } from "./turn-frame-builder.ts";
import { normalizeText } from "./catalog-utils.ts";
import {
  loadPersistedWorkingMemory, deriveCanonicalViews, applyDecisionWorkingMemoryMutations,
  applySystemWorkingMemoryMutations, applyEffectOutcomeToWorkingMemory, isValidPhotoActionDraft,
  toAgentObservation, toToolResultMemory, toToolTelemetry,
} from "./working-memory.ts";
import type { TenantBusinessInfoSource } from "./tenant-business-info.ts";
import { resolveTenantBusinessInfo, businessInfoToolResultMemory } from "./tenant-business-info.ts";

// ── Flag de modo ─────────────────────────────────────────────────────────────────────────────────────────────
export type BrainMode = "off" | "central_shadow";
export function readBrainMode(env: Record<string, string | undefined> = process.env): BrainMode {
  return env.PEDRO_V3_BRAIN_MODE === "central_shadow" ? "central_shadow" : "off";
}
export function isCentralShadowMode(env: Record<string, string | undefined> = process.env): boolean {
  return readBrainMode(env) === "central_shadow";
}

export const DEFAULT_ALLOWED_TOOLS = ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info", "crm_read"] as const;

export type CentralTurnArgs = {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly brain: AgentBrainPort;
  readonly llm: DecisionLlm;                 // compose/render (segue o prompt do portal + guidance do cérebro)
  readonly runQuery: QueryRunner;            // os 4 QueryCall do kernel (ref já embutido)
  readonly businessInfo: TenantBusinessInfoSource;
  readonly contextPreparer: TurnContextPreparer;
  readonly conversationId: Id;
  readonly tenantId: Id;
  readonly agentId: Id;
  readonly leadId?: Id | null;
  readonly workerId: string;
  readonly turnId: Id;
  readonly leaseTtlMs: number;
  readonly portalPromptSha256: string;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  readonly sdrPolicy?: SdrQualificationPolicy;
  readonly brainMaxSteps?: number;                       // teto de passos de ferramenta do cérebro (default 4)
  readonly allowedTools?: ReadonlySet<string> | readonly string[];
  readonly providerCapability?: Partial<Record<OutboxRecord["kind"], ProviderCapability>>;
};

function requiredToolBeforeFinal(frame: ReturnType<typeof buildTurnFrame>, observations: readonly AgentToolObservation[]): string | null {
  const wasObserved = (tool: string) => observations.some((observation) =>
    observation.tool === tool && (observation.ok || observation.error.code !== "REQUIRED_TOOL_MISSING"));
  if (frame.signals.mentionsMoreOptions && !wasObserved("stock_search")) {
    return "O lead pediu mais opções. Execute stock_search com os filtros atuais e excludeKeys da última oferta antes da resposta final.";
  }
  if (frame.signals.mentionsStore && !wasObserved("tenant_business_info")) {
    return "O lead pediu informação da loja. Execute tenant_business_info antes da resposta final.";
  }
  return null;
}

export type CentralTurnResult =
  | { status: "no_op"; turnId: Id; claimedEventIds: Id[] }
  | {
      status: "committed";
      turnId: Id;
      claimedEventIds: Id[];
      decision: TurnDecision;
      composedText: string;
      terminalSafe: boolean;
      facts: QueryResult[];
      outbox: OutboxRecord[];
      stateVersion: number;
      workingMemory: PersistedWorkingMemory;
      toolObservations: AgentToolObservation[];
      toolTelemetry: ToolTelemetry[];
      brainSteps: number;
    }
  | { status: "commit_failed"; turnId: Id; claimedEventIds: Id[]; reason: string };

// ── helpers puros ──────────────────────────────────────────────────────────────────────────────────────────
function payloadJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(payloadJson);
  if (typeof value === "object") { const out: { [k: string]: JsonValue } = {}; for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = payloadJson(v); return out; }
  return String(value);
}
function textFromInbox(rec: InboxRecord): string {
  const raw = rec.raw as Record<string, unknown>;
  const text = raw.text ?? raw.message ?? raw.body ?? raw.transcription ?? "";
  return typeof text === "string" ? text.trim() : "";
}
function aggregateLeadMessage(records: InboxRecord[]): string {
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt), tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  return ordered.map(textFromInbox).filter(Boolean).join("\n");
}
function makeEvent(args: { conversationId: Id; turnId: Id; type: string; suffix: string; payload: { [k: string]: JsonValue }; at: Iso }): TurnEventRecord {
  return { eventId: `${args.turnId}:${args.suffix}`, conversationId: args.conversationId, turnId: args.turnId, type: args.type, payloadSchemaVersion: 1, payload: redact(args.payload), at: args.at };
}
function deriveProposedAction(effects: readonly ProposedEffectPlan[]): TurnAction {
  if (effects.some((e) => e.kind === "send_media")) return "send_photos";
  if (effects.some((e) => e.kind === "handoff")) return "handoff";
  if (effects.some((e) => e.kind === "schedule_visit")) return "schedule_visit";
  return "reply";
}
// Toda resposta precisa de UM send_message (o texto renderizado vai nele). Se o cérebro não propôs, injeta.
function ensureSendMessage(effects: readonly ProposedEffectPlan[]): ProposedEffectPlan[] {
  const list = [...effects];
  if (!list.some((e) => e.kind === "send_message")) {
    list.unshift({ kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan);
  }
  return list;
}
// tool `crm_read` só passa com leadId; tenant_business_info não é QueryCall (tratada à parte). Aqui autorizamos
// só a superfície do kernel (POL-STATE-011) — a policy VALIDA, não escolhe assunto.
function isKernelQueryCall(call: CentralQueryCall): call is QueryCall {
  return call.tool === "stock_search" || call.tool === "vehicle_details" || call.tool === "vehicle_photos_resolve" || call.tool === "crm_read";
}

// ── Enforcement determinístico de invariantes (Brain/11 §5: validador/executor; NÃO conduz o assunto) ──────────
// PEDIDO de foto AGORA (imperativo) — distinto de PERGUNTA de memória ("qual carro pedi fotos?").
const PHOTO_MEMORY_Q_RX = /\b(qual|que|quais)\b[^?]*\b(foto|carro|ve[ií]culo|modelo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi)\b/;
const PHOTO_REQUEST_RX = /\b(manda|mandar|envia|enviar|mostra|mostrar|me\s+ve|quero\s+ver|posso\s+ver|ver\s+as?)\b[^?]*\bfotos?\b|\bfotos?\s+d(o|a|e|esse|essa|ele|ela|aquele)\b|\bfoto\s+d(a|o)\s+(primeir|segund|terceir|quart)/;
function isPhotoRequestBlock(text: string): boolean {
  const n = normalizeText(text);
  if (PHOTO_MEMORY_Q_RX.test(n)) return false;   // pergunta de memória NUNCA é pedido de envio
  return PHOTO_REQUEST_RX.test(n);
}
function isPhotoMemoryQuestionBlock(text: string): boolean { return PHOTO_MEMORY_Q_RX.test(normalizeText(text)); }
// A resposta cita o veículo lembrado? (token de marca/modelo do label, ignorando o ano).
function mentionsLabel(text: string, label: string): boolean {
  const t = normalizeText(text);
  return normalizeText(label).split(/\s+/).filter((w) => w.length >= 3 && !/^(19|20)\d{2}$/.test(w)).some((tok) => t.includes(tok));
}
// Invariante "no máximo UMA pergunta": mantém todas as sentenças NÃO-interrogativas + a PRIMEIRA interrogativa,
// descarta as demais interrogativas. Remover texto é grounding-safe (nunca cria alegação). PURO.
export function trimToOneQuestion(text: string): string {
  if ((text.match(/\?/g) ?? []).length <= 1) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  let sawQuestion = false;
  const kept: string[] = [];
  for (const s of sentences) {
    if (s.includes("?")) { if (sawQuestion) continue; sawQuestion = true; }
    kept.push(s);
  }
  return kept.join(" ").trim();
}

// Reconciliação dos invariantes 8+10 (Brain/11): um veículo LEMBRADO (oferta anterior, seleção, última ação de
// foto) É um FATO TIPADO — logo pode ser NOMEADO na resposta de MEMÓRIA sem re-consultar tool. Estes "fatos de
// grounding de memória" derivam SÓ de dados que o próprio sistema já estabeleceu (marca/modelo/ano estruturados);
// preço = -1 (sentinela: NUNCA aterra menção de preço; grounding de marca/modelo só usa marca/modelo). Entram só
// no compose/validate — NÃO no postQuery (não autorizam nova oferta) e NÃO no offer-context (não é busca nova).
function labelToFact(key: string, label: string | null | undefined): VehicleFact | null {
  if (!key || !label) return null;
  const tokens = label.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const yearTok = tokens[tokens.length - 1];
  const hasYear = /^(19|20)\d{2}$/.test(yearTok);
  const marca = tokens[0];
  const modelo = (hasYear ? tokens.slice(1, -1) : tokens.slice(1)).join(" ");
  if (!marca || !modelo) return null;
  return { vehicleKey: key, marca, modelo, ano: hasYear ? Number(yearTok) : 0, preco: -1, tipo: "unknown", km: 0, cambio: "", cor: "" } as VehicleFact;
}
function buildMemoryGroundingFacts(state: ConversationState): QueryResult[] {
  const items: VehicleFact[] = [];
  const seen = new Set<string>();
  const push = (v: VehicleFact | null): void => { if (v && v.marca && v.modelo && !seen.has(v.vehicleKey)) { seen.add(v.vehicleKey); items.push(v); } };
  for (const it of state.lastRenderedOfferContext?.items ?? []) {
    // preço REAL da oferta anterior (aterra menção de preço lembrada); ausente -> -1 (sentinela).
    if (it.marca && it.modelo) push({ vehicleKey: it.vehicleKey, marca: it.marca, modelo: it.modelo, ano: it.ano ?? 0, preco: typeof it.preco === "number" && it.preco > 0 ? it.preco : -1, tipo: "unknown", km: 0, cambio: "", cor: "" } as VehicleFact);
  }
  const sel = state.vehicleContext?.selected;
  if (sel?.key) push(labelToFact(sel.key, sel.label));
  const persistedWm = state.workingMemory;
  const lastPhoto = persistedWm && typeof persistedWm === "object" ? (persistedWm as { lastPhotoAction?: { vehicleKey?: string; label?: string } }).lastPhotoAction : null;
  if (lastPhoto?.vehicleKey) push(labelToFact(lastPhoto.vehicleKey, lastPhoto.label));
  if (items.length === 0) return [];
  return [{ ok: true, tool: "stock_search", source: "memory-grounding", data: { items, filtersUsed: {} } }];
}

// Auto-grounding (executor determinístico): veículos que a RESPOSTA pode nomear — alvo de foto (send_media) e o
// selecionado — precisam estar nos FATOS p/ o compose citar nome/atributo aterrado. vehicle_photos_resolve NÃO
// devolve marca/modelo; então buscamos vehicle_details (dados REAIS: preço/câmbio/cor) desses veículos. Bounded (3),
// best-effort (falha não derruba o turno). Não conduz o assunto — só garante grounding do que já foi decidido.
async function groundNamedVehicles(args: {
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly state: ConversationState;
  readonly facts: readonly QueryResult[];
  readonly memoryFacts: readonly QueryResult[];
  readonly runQuery: QueryRunner;
  readonly timeoutMs: number;
}): Promise<QueryResult[]> {
  const keys = new Set<string>();
  for (const e of args.proposedEffects) if (e.kind === "send_media" && typeof e.vehicleKey === "string" && e.vehicleKey) keys.add(e.vehicleKey);
  if (args.state.vehicleContext.selected?.key) keys.add(args.state.vehicleContext.selected.key);
  if (keys.size === 0) return [];
  const known = new Set<string>();
  for (const f of [...args.facts, ...args.memoryFacts]) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") for (const v of f.data.items) known.add(v.vehicleKey);
    if (f.tool === "vehicle_details") known.add(f.data.vehicle.vehicleKey);
  }
  const toFetch = [...keys].filter((k) => !known.has(k)).slice(0, 3);
  const out: QueryResult[] = [];
  for (const vehicleKey of toFetch) {
    try {
      const res = await withTimeout(args.runQuery({ tool: "vehicle_details", input: { vehicleKey } }), args.timeoutMs, "query: ground vehicle_details");
      if (res.ok) out.push(res);
    } catch { /* best-effort: grounding ausente só significa que o compose não poderá nomear o veículo */ }
  }
  return out;
}

// Nome HUMANO do veículo (marca modelo ano) a partir dos fatos do turno + oferta anterior + seleção; nunca a chave crua.
function resolveVehicleLabel(vehicleKey: string, facts: readonly QueryResult[], state: ConversationState): string {
  for (const f of facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") { const v = f.data.items.find((x) => x.vehicleKey === vehicleKey); if (v) { const l = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim(); if (l) return l; } }
    if (f.tool === "vehicle_details" && f.data.vehicle.vehicleKey === vehicleKey) { const v = f.data.vehicle; const l = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim(); if (l) return l; }
  }
  const it = state.lastRenderedOfferContext?.items.find((i) => i.vehicleKey === vehicleKey);
  if (it) { const l = [it.marca, it.modelo, it.ano].filter(Boolean).join(" ").trim(); if (l) return l; }
  if (state.vehicleContext.selected?.key === vehicleKey && state.vehicleContext.selected.label) return state.vehicleContext.selected.label;
  return vehicleKey;
}

// Executor DETERMINÍSTICO de uma decisão JÁ tomada (Brain/11 §5), usado SÓ quando o compose do LLM falha o
// grounding. Renderiza aterrado por construção: foto -> texto sem atributos; oferta -> lista numerada dos fatos do
// turno; senão -> resposta SDR contextual (sem citar veículo). Nunca inventa; substitui o terminal_safe genérico.
function renderDeterministicResponse(decision: TurnDecision, toolFacts: readonly QueryResult[], composeFacts: readonly QueryResult[], state: ConversationState, leadMessage: string): RenderedResponse {
  if (decision.effectPlan.some((p) => p.kind === "send_media")) {
    const parts: ResponsePart[] = [{ type: "text", content: "Aqui estão as fotos que você pediu! 😊 Quer que eu te passe mais detalhes desse carro?" }];
    return { draft: { parts }, text: ResponseRenderer.render({ parts }, [...composeFacts], state) };
  }
  const items = toolFacts.flatMap((f) => (f.ok && f.tool === "stock_search") ? f.data.items : []).filter((v) => typeof v.preco === "number" && v.preco > 0);
  if (items.length > 0) {
    const keys = [...new Set(items.map((v) => v.vehicleKey))].slice(0, 5);
    const parts: ResponsePart[] = [{ type: "text", content: "Tenho estas opções pra você:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver as fotos de alguma?" }];
    return { draft: { parts }, text: ResponseRenderer.render({ parts }, [...composeFacts], state) };
  }
  const text = buildContextualSdrReply(state, { leadMessage });
  return { draft: { parts: [{ type: "text", content: text }] }, text };
}

// ── Turno central ────────────────────────────────────────────────────────────────────────────────────────────
export async function runCentralConversationTurn(args: CentralTurnArgs): Promise<CentralTurnResult> {
  const {
    persistence, clock, brain, llm, runQuery, businessInfo, contextPreparer,
    conversationId, tenantId, agentId, leadId, workerId, turnId, leaseTtlMs, portalPromptSha256,
    limits, maxValidationAttempts, providerCapability, sdrPolicy,
  } = args;
  const ref: TenantAgentRef = { tenantId, agentId };
  const allowed = new Set(args.allowedTools ?? DEFAULT_ALLOWED_TOOLS);
  const brainMaxSteps = args.brainMaxSteps ?? 4;
  let claimedEventIds: Id[] = [];

  return persistence.withLease(conversationId, workerId, leaseTtlMs, async (lease): Promise<CentralTurnResult> => {
    const cutoff = clock.now();
    claimedEventIds = await persistence.claimBurst(conversationId, cutoff, workerId, turnId, lease);
    if (claimedEventIds.length === 0) return { status: "no_op", turnId, claimedEventIds };

    try {
      const loadedInbox = await Promise.all(claimedEventIds.map((eventId) => persistence.get(eventId)));
      const inboxRecords = loadedInbox.filter((rec): rec is InboxRecord => rec != null);
      if (inboxRecords.length !== claimedEventIds.length) throw new Error("claimed inbox record missing");

      const snapshot = await persistence.load(conversationId);
      const expectedVersion = snapshot?.version ?? 0;
      const state = snapshot?.state ?? createInitialState({ conversationId, tenantId, agentId, leadId, now: cutoff });
      // Isolamento (B item 3): estado carregado precisa pertencer a ESTA conta/agente/conversa. Falha fechado.
      if (state.tenantId !== tenantId || state.agentId !== agentId || state.conversationId !== conversationId) {
        throw new Error(`central: state ownership mismatch (loaded ${state.tenantId}/${state.agentId}/${state.conversationId} != ${tenantId}/${agentId}/${conversationId})`);
      }
      const leadMessage = aggregateLeadMessage(inboxRecords);
      const prepared = await contextPreparer.prepare({ state, turnId, leadMessage, now: cutoff });

      // Bind factual answers before the brain runs. This does not choose the reply; it only projects
      // conservative slot facts (for example, a bare name when the previous accepted question asked for it).
      const extractedSlots = extractLeadSlots({
        leadMessage,
        state,
        interpretation: prepared.interpretation,
        claimExtractor: prepared.claimExtractor,
        turnId,
      });
      const { contextState, committed: safeExtractedSlots } = safeCommitSlots(state, extractedSlots, turnId, cutoff);

      const ctx: TurnContext = {
        state: contextState, turnId, leadMessage, now: cutoff,
        interpretation: prepared.interpretation, tenantCatalog: prepared.tenantCatalog, claimExtractor: prepared.claimExtractor,
      };

      // ── WorkingMemory: parte persistida (WM-owned) + view canônica derivada do estado. ──
      const persisted0: PersistedWorkingMemory = loadPersistedWorkingMemory(contextState.workingMemory).memory;
      const wmV1: WorkingMemoryV1 = { ...persisted0, ...deriveCanonicalViews(contextState) };
      const frame = buildTurnFrame({ turnId, now: cutoff, block: leadMessage, portalPromptSha256, workingMemory: wmV1, interpretation: prepared.interpretation, state: contextState });

      // ── LOOP do cérebro: query (autorizada por chamada) | final. Observações FACTUAIS voltam ao MESMO cérebro. ──
      const observations: AgentToolObservation[] = [];
      const facts: QueryResult[] = [];                 // só os 4 QueryCall (grounding comercial)
      const toolResultMems: ToolResultMemory[] = [];   // memória sanitizada das tools executadas
      const toolTelemetry: ToolTelemetry[] = [];
      let finalDecision: AgentBrainDecision | null = null;
      let brainSteps = 0;

      for (; brainSteps < brainMaxSteps; brainSteps++) {
        let step;
        try {
          step = await withTimeout(brain.proposeNextStep(frame, observations), limits.proposeTimeoutMs ?? 30_000, "propose: agent brain step exceeded timeout");
        } catch { break; } // falha técnica do cérebro -> sai do loop -> fallback seguro (nunca silêncio)
        if (step.kind === "final") {
          const missingTool = requiredToolBeforeFinal(frame, observations);
          if (missingTool && brainSteps + 1 < brainMaxSteps) {
            observations.push({ tool: frame.signals.mentionsStore ? "tenant_business_info" : "stock_search", ok: false, error: { code: "REQUIRED_TOOL_MISSING", message: missingTool } });
            continue;
          }
          if (missingTool) break;
          finalDecision = step.decision;
          break;
        }

        const call = step.call;
        // Allowlist: tool proibida NÃO executa (observação de erro; o cérebro segue com o que tem).
        if (!allowed.has(call.tool)) {
          observations.push({ tool: call.tool, ok: false, error: { code: "FORBIDDEN", message: `tool '${call.tool}' fora do allowlist` } });
          continue;
        }
        if (call.tool === "tenant_business_info") {
          const started = Date.parse(clock.now());
          const obs = await resolveTenantBusinessInfo(businessInfo, ref, call.input.topic);
          observations.push(obs);
          toolResultMems.push(businessInfoToolResultMemory(call.input.topic, obs.ok, turnId));
          toolTelemetry.push({ tool: "tenant_business_info", ok: obs.ok, ms: Math.max(0, Date.parse(clock.now()) - started) });
          continue;
        }
        if (!isKernelQueryCall(call)) { observations.push({ tool: (call as { tool: string }).tool, ok: false, error: { code: "VALIDATION", message: "tool desconhecida" } }); continue; }
        // AUTORIZAÇÃO POR CHAMADA (POL-STATE-011): a policy VALIDA (allow/deny), nunca escolhe o assunto.
        const verdict = PolicyEngine.authorizeQuery(call, ctx, facts);
        if (verdict.outcome !== "allow") {
          observations.push({ tool: call.tool, ok: false, error: { code: "FORBIDDEN", message: verdict.violations?.join(";") ?? "query negada" } });
          continue;
        }
        const started = Date.parse(clock.now());
        let res: QueryResult;
        try {
          res = await withTimeout(runQuery(call), limits.queryTimeoutMs ?? 20_000, `query: ${call.tool} exceeded timeout`);
        } catch {
          observations.push({ tool: call.tool, ok: false, error: { code: "UPSTREAM", message: "tool indisponivel" } });
          continue;
        }
        facts.push(res);
        observations.push(toAgentObservation(res));
        toolResultMems.push(toToolResultMemory(res, turnId));
        toolTelemetry.push(toToolTelemetry(res, Math.max(0, Date.parse(clock.now()) - started)));
      }

      if (!finalDecision) {
        finalDecision = {
          reasonCode: "brain_loop_exhausted", reasonSummary: "cérebro não concluiu no limite de passos", confidence: 0.4,
          responsePlan: { guidance: "Peça um esclarecimento gentil ao lead, sem inventar veículo, preço ou informação." },
          proposedEffects: [], memoryMutations: [], stateMutations: [],
        };
      }

      // ── UMA decisão comercial: AgentBrainDecision -> ProposedDecision -> Finalizer -> compose/render/validate. ──
      // Invariante 8 (enforcement): send_media SÓ quando o bloco ATUAL pede foto. Pergunta de memória/comentário
      // NUNCA reenvia mídia — o engine remove o send_media espúrio proposto pelo cérebro (o texto/send_message fica).
      const brainEffects = isPhotoRequestBlock(leadMessage) ? finalDecision.proposedEffects : finalDecision.proposedEffects.filter((e) => e.kind !== "send_media");
      const proposedEffects = ensureSendMessage(brainEffects);
      const stateMutations: DecisionMutation[] = [...(finalDecision.stateMutations ?? [])];
      const proposal: ProposedDecision = {
        proposedAction: deriveProposedAction(proposedEffects),
        facts: stateMutations,
        proposedEffects,
        responsePlan: { guidance: finalDecision.responsePlan.guidance },
        reasonCode: finalDecision.reasonCode, reasonSummary: finalDecision.reasonSummary, confidence: finalDecision.confidence,
      };
      const post = PolicyEngine.postQuery(proposal, facts, ctx);           // postQuery só com fatos de TOOL (não autoriza oferta por memória)
      const decision0 = finalize(turnId, proposal, post, facts);
      // Grounding do compose = fatos de tool + fatos de MEMÓRIA (veículos já estabelecidos) + auto-grounding dos
      // veículos que a resposta pode nomear (foto/seleção), buscando vehicle_details real.
      const memoryFacts = buildMemoryGroundingFacts(contextState);
      const groundFacts = await groundNamedVehicles({ proposedEffects, state: contextState, facts, memoryFacts, runQuery, timeoutMs: limits.queryTimeoutMs ?? 20_000 });
      const composeFacts = [...facts, ...memoryFacts, ...groundFacts];
      const cv = await composeAndVerify({ decision: decision0, facts: composeFacts, ctx, llm, limits, maxValidationAttempts });
      // Se o LLM falhou o grounding (terminal_safe), EXECUTA a decisão JÁ tomada deterministicamente (grounded por
      // construção, mantendo os efeitos decididos — ex.: send_media). Só cai no terminal_safe genérico se ATÉ o
      // render determinístico for negado pela policy (raríssimo). Isso elimina o terminal_safe sem afrouxar grounding.
      let effectiveDecision = cv.decision;
      let composedRaw = cv.composed;
      let terminalSafe = cv.terminalSafe;
      if (cv.terminalSafe) {
        const det = renderDeterministicResponse(decision0, facts, composeFacts, ctx.state, leadMessage);
        const gv = PolicyEngine.validateResponse(det, composeFacts, decision0, ctx);
        if (!hasDeny(gv)) { effectiveDecision = decision0; composedRaw = det; terminalSafe = false; }
      }
      // Enforcement do invariante "≤1 pergunta": trima o TEXTO final (draft/parts intactos p/ o offer-context).
      const trimmedText = trimToOneQuestion(composedRaw.text);
      let composed = trimmedText === composedRaw.text ? composedRaw : { ...composedRaw, text: trimmedText };
      // Invariante 8 (enforcement): pergunta de MEMÓRIA de foto SEMPRE nomeia o veículo lembrado. Se a resposta não
      // citou o label da última ação de foto (e não é envio novo de mídia), substitui por um recall determinístico
      // (o label é um fato de memória estabelecido pelo próprio sistema — grounded por construção).
      const recalledLabel = persisted0.lastPhotoAction?.label ?? null;
      if (recalledLabel && isPhotoMemoryQuestionBlock(leadMessage) && !effectiveDecision.effectPlan.some((p) => p.kind === "send_media") && !mentionsLabel(composed.text, recalledLabel)) {
        const recall = `Você pediu as fotos do ${recalledLabel}. Quer que eu te passe mais detalhes dele?`;
        composed = { draft: { parts: [{ type: "text", content: recall }] }, text: recall };
      }
      // The question actually sent is the source of truth for the next turn. Persist its objective on
      // send_message accepted so a short answer such as "Douglas" is bound to `nome` deterministically.
      if (sdrPolicy && !terminalSafe) {
        effectiveDecision = reconcileObjectiveWithQuestion({
          decision: effectiveDecision,
          composedText: composed.text,
          state: contextState,
          turnId,
          policy: sdrPolicy,
        });
      }
      const turnOutput: TurnOutput = { decision: effectiveDecision, composed, facts, loopExhausted: false, terminalSafe, steps: brainSteps };
      const decision = turnOutput.decision;

      // ── WorkingMemory reducers: decisão (cérebro propõe) + sistema (tools executadas, autoridade do engine). ──
      let persistedWM = persisted0;
      if (finalDecision.memoryMutations.length > 0) {
        const r = applyDecisionWorkingMemoryMutations(persisted0, finalDecision.memoryMutations, { authorizedTurnId: turnId });
        if (r.ok) persistedWM = r.next; // rejeição NÃO corrompe: mantém a base (fail-closed por lote)
      }
      if (toolResultMems.length > 0) {
        const sys = applySystemWorkingMemoryMutations(persistedWM, toolResultMems.map((result) => ({ op: "record_tool_result" as const, result })), { authorizedTurnId: turnId });
        if (sys.ok) persistedWM = sys.next;
      }
      const nextWM = persistedWM;

      // ── Estado: o ENGINE é a única fonte do append_lead_turn; foco invalidado pela AÇÃO do turno. ──
      const renderedOfferContext = computeRenderedOfferContext(turnOutput, turnId, cutoff);
      const renderedItems = renderedOfferContext?.items ?? [];
      const leadTurnMutations: DecisionMutation[] = leadMessage.trim().length > 0 ? [{ op: "append_lead_turn", turn: { role: "lead", text: leadMessage, at: cutoff } }] : [];
      const brainStateMutations = decision.decisionMutations.filter((m) => m.op !== "append_lead_turn");
      const newSearchExecuted = isNewSearchTurn({
        isPhotoIntent: proposedEffects.some((e) => e.kind === "send_media"),
        relation: prepared.interpretation.relation, renderedItemCount: renderedItems.length, explicitSearchKind: null,
      });
      const focusInvalidation = focusInvalidationMutations(newSearchExecuted, renderedItems, turnId);
      const moreOptionsReset: DecisionMutation[] = (renderedItems.length > 0 && (contextState.moreOptionsExhausted ?? 0) > 0) ? [{ op: "set_more_options_exhausted", value: 0 }] : [];
      // Resolução DETERMINÍSTICA de referência ordinal/modelo à ÚLTIMA oferta ("o primeiro", "gostei do segundo") ->
      // selectedVehicleFocus. Grounded (só seleciona item da última lista renderizada); SEM inferência booleana (não
      // reintroduz o bug de possuiTroca). Aplicada por último -> vence a seleção do cérebro em caso de divergência.
      const ordinalRef = resolveSelectedVehicle(leadMessage, contextState, prepared.claimExtractor);
      const ordinalSelect: DecisionMutation[] = ordinalRef ? [{ op: "select_vehicle_focus", vehicle: ordinalRef, sourceTurnId: turnId }] : [];

      const committedMutations = [...leadTurnMutations, ...safeExtractedSlots, ...brainStateMutations, ...focusInvalidation, ...moreOptionsReset, ...ordinalSelect];
      let reduced = applyDecision(state, committedMutations, turnId, cutoff);
      if (!reduced.ok) {
        // Fato de estado proposto pelo cérebro inválido -> o reducer (autoridade) rejeita SÓ o do cérebro; a
        // fala e a memória do turno continuam (nunca derruba o turno por causa de uma mutação do cérebro).
        reduced = applyDecision(state, [...leadTurnMutations, ...safeExtractedSlots, ...focusInvalidation, ...moreOptionsReset], turnId, cutoff);
        if (!reduced.ok) throw new Error(`central: decision mutations rejected: ${reduced.rejected.map((r) => r.reason).join("; ")}`);
      }
      reduced.next.workingMemory = nextWM;
      if (renderedOfferContext) reduced.next.lastRenderedOfferContext = renderedOfferContext;

      // ── B item 2: draft accepted-safe de foto por effectId (promovido à WM só no receipt accepted). ──
      const pending: Record<string, PhotoActionDraft> = { ...(reduced.next.pendingPhotoActions ?? {}) };
      for (const plan of decision.effectPlan) {
        if (plan.kind !== "send_media" || !plan.photoIds || plan.photoIds.length === 0) continue;
        const label = resolveVehicleLabel(plan.vehicleKey, composeFacts, contextState); // nome HUMANO (marca modelo ano), nunca a chave crua
        const draft: PhotoActionDraft = { vehicleKey: plan.vehicleKey, label, photoIds: [...plan.photoIds], effectId: plan.effectId, sourceTurnId: turnId, sourceTurnNumber: reduced.next.turnNumber };
        if (isValidPhotoActionDraft(draft)) pending[plan.effectId] = draft;
      }
      reduced.next.pendingPhotoActions = pending;

      // Isolamento defensivo no commit.
      if (reduced.next.tenantId !== tenantId || reduced.next.agentId !== agentId || reduced.next.conversationId !== conversationId) {
        throw new Error("central: next state ownership mismatch at commit");
      }

      const outbox = materializeEffectPlans(decision, composed, { conversationId, createdAt: cutoff, providerCapability });

      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        makeEvent({ conversationId, turnId, type: "decision_final", suffix: "decision", payload: { action: decision.action, reasonCode: decision.reasonCode, effectIds: outbox.map((r) => r.effectId), brainMode: "central_active", brainSteps }, at: cutoff }),
        makeEvent({ conversationId, turnId, type: "response_composed", suffix: "response", payload: { text: composed.text, terminalSafe }, at: cutoff }),
      ];

      // ── COMMIT ATÔMICO: state (com WorkingMemory embutida) + decisão + eventos + outbox na MESMA UnitOfWork CAS. ──
      const uow: UnitOfWork = persistence.begin({ lease });
      uow.casState(conversationId, expectedVersion, reduced.next);
      uow.appendEvents(events);
      uow.appendDecision(conversationId, { ...decision, decisionMutations: committedMutations });
      uow.appendOutbox(outbox);
      uow.markInboxDone(claimedEventIds, workerId, turnId);
      const commit = await uow.commit();
      if (!commit.ok) {
        await persistence.releaseClaim(claimedEventIds, workerId, turnId);
        return { status: "commit_failed", turnId, claimedEventIds, reason: commit.reason };
      }

      return {
        status: "committed", turnId, claimedEventIds, decision, composedText: composed.text, terminalSafe,
        facts, outbox, stateVersion: reduced.next.version, workingMemory: nextWM, toolObservations: observations, toolTelemetry, brainSteps,
      };
    } catch (err) {
      await persistence.releaseClaim(claimedEventIds, workerId, turnId);
      return { status: "commit_failed", turnId, claimedEventIds, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}

// ============================================================================
// B item 2 — Outcome ACCEPTED da ação de foto: promove pendingPhotoActions[effectId] -> WorkingMemory.lastPhotoAction.
//   accepted (ou delivered) -> atualiza lastPhotoAction (accepted-safe); NÃO toca photoLedger (isso é do
//   commitEffectOutcome no nível delivered). Idempotência INDEPENDENTE via appliedAcceptedEffectIds (NÃO usa o
//   outcomeAppliedAt do outbox, que governa a fase delivered — um marcador não pode impedir o outro). newer-wins
//   pelo sourceTurnNumber (applyEffectOutcomeToWorkingMemory). failed/outcome_uncertain NÃO consomem idempotência.
// ============================================================================
export async function applyAcceptedPhotoActionOutcome(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
  readonly effectId: string;
  readonly result: EffectResult;
  readonly maxCasRetries?: number;
}): Promise<{ ok: true; applied: boolean } | { ok: false; reason: string }> {
  const { persistence, conversationId, effectId, result } = args;
  if (result.effectId !== effectId) return { ok: false, reason: `effectId mismatch (${result.effectId} != ${effectId})` };
  if (result.status !== "succeeded") return { ok: true, applied: false };                    // failed/uncertain: não consome
  if (result.receipt.level !== "accepted" && result.receipt.level !== "delivered") return { ok: true, applied: false };
  const retries = args.maxCasRetries ?? 3;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const snapshot = await persistence.load(conversationId);
    if (!snapshot) return { ok: false, reason: "state_not_found" };
    const state = snapshot.state;
    const alreadyApplied = state.appliedAcceptedEffectIds ?? [];
    if (alreadyApplied.includes(effectId)) return { ok: true, applied: false };              // idempotente (accepted OU delivered posterior)
    const draft = state.pendingPhotoActions?.[effectId];
    if (!draft) return { ok: true, applied: false };                                          // não é ação de foto rastreada
    const persisted: PersistedWorkingMemory = loadPersistedWorkingMemory(state.workingMemory).memory;
    const red = applyEffectOutcomeToWorkingMemory(persisted, { op: "mark_photo_action_accepted", action: draft }, result);
    if (!red.ok) return { ok: false, reason: red.rejected.map((r) => r.reason).join("; ") };
    // Audit Codex: envia SOMENTE a WorkingMemory (nunca o ConversationState completo). O adapter/RPC carrega o estado
    // ATUAL e atualiza só workingMemory/appliedAcceptedEffectIds/version/updatedAt (preserva o resto). Fail-closed
    // se o adapter não expõe a capability (nunca cai num casState de estado completo — o UnitOfWork é só de turno).
    const wmStore = persistence as Partial<WorkingMemoryOutcomeStore>;
    if (typeof wmStore.commitWorkingMemoryOutcome !== "function") return { ok: false, reason: "persistence_missing_working_memory_outcome" };
    const c = await wmStore.commitWorkingMemoryOutcome(conversationId, effectId, snapshot.version, red.next, result.receipt.at);
    if (!c.ok) return { ok: false, reason: c.reason };
    if (c.applied) return { ok: true, applied: true };
    // applied=false -> duplicado (o loop recarrega e vê alreadyApplied -> no-op) OU conflito de versão -> reprocessa.
  }
  return { ok: false, reason: "cas_retries_exhausted" };
}

// ============================================================================
// R13-D/4 (audit Codex): RECONCILIAÇÃO DURÁVEL da promoção accepted-safe. Rastro durável = um send_media 'succeeded'
// (accepted|delivered) cujo effectId NÃO está em appliedAcceptedEffectIds e TEM um pendingPhotoAction. Isso acontece
// se a promoção falhou (CAS/transiente) DEPOIS do dispatch. Reprocessa via applyAcceptedPhotoActionOutcome (idempotente,
// SEM redispatch — a mídia já foi enviada; isto é só escrita de WorkingMemory). Um scheduler/poller pode chamar isto
// periodicamente; sobrevive a restart (o rastro está no estado persistido).
// ============================================================================
export async function reconcileAcceptedPhotoOutcomes(args: {
  readonly persistence: Persistence;
  readonly conversationId: string;
}): Promise<{ reconciled: number; failed: number; pending: number }> {
  const { persistence, conversationId } = args;
  const snapshot = await persistence.load(conversationId);
  if (!snapshot) return { reconciled: 0, failed: 0, pending: 0 };
  const applied = new Set(snapshot.state.appliedAcceptedEffectIds ?? []);
  const drafts = snapshot.state.pendingPhotoActions ?? {};
  const outbox = await persistence.listOutbox(conversationId);
  let reconciled = 0, failed = 0, pending = 0;
  for (const rec of outbox) {
    if (rec.kind !== "send_media" || rec.status !== "succeeded") continue;
    if (rec.receiptLevel !== "accepted" && rec.receiptLevel !== "delivered") continue;
    if (applied.has(rec.effectId)) continue;   // já promovido
    if (!drafts[rec.effectId]) continue;        // sem draft rastreado (não é ação de foto do central)
    pending += 1;
    const pr = rec.providerReceipt;
    const receiptAt = (pr && typeof pr === "object" && !Array.isArray(pr) && typeof (pr as { at?: unknown }).at === "string")
      ? (pr as { at: string }).at : (rec.terminalAt ?? rec.createdAt);
    const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt: { effectId: rec.effectId, level: rec.receiptLevel, at: receiptAt } };
    const r = await applyAcceptedPhotoActionOutcome({ persistence, conversationId, effectId: rec.effectId, result });
    if (r.ok && r.applied) reconciled += 1; else if (!r.ok) failed += 1;
  }
  return { reconciled, failed, pending };
}
