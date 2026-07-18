// ============================================================================
// central-shadow-runner.ts — R13-D/2. SHADOW VERDADEIRO do agente central.
//
// Roda `runCentralConversationTurn` num store TOTALMENTE ISOLADO (InMemoryPersistence próprio), semeado com uma
// CÓPIA read-only do estado canônico + o bloco do lead. Garantias:
//   - NÃO claima nem conclui o inbox CANÔNICO (o shadow tem seu próprio inbox isolado);
//   - NÃO altera o ConversationState CANÔNICO (só `persistence.load` — leitura);
//   - NÃO cria outbox acionável no canônico (o outbox nasce no store isolado, e nada é despachado);
//   - devolve uma COMPARAÇÃO SANITIZADA (sem PII/segredo) para observabilidade lado-a-lado.
// Zero dispatch: nenhum EffectDispatcher é criado aqui. (A prova com OutboxDispatcher real + gate shadow está no
// teste run-central-shadow-isolation.ts: records viram 'skipped', 0 despachados.)
// ============================================================================
import type { Clock, Persistence } from "../domain/ports.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { DecisionLlm } from "../domain/llm.ts";
import type { QueryLoopLimits, TurnContextPreparer } from "../domain/context.ts";
import type { AgentBrainPort } from "../domain/agent-brain.ts";
import type { QueryRunner } from "./decision-engine.ts";
import type { TenantBusinessInfoSource } from "./tenant-business-info.ts";
import { createInitialState } from "../domain/conversation-state.ts";
import { redact } from "../domain/effect-intent.ts";
import { InMemoryPersistence, FakeIdGen } from "../adapters/persistence/in-memory-store.ts";
import { runCentralConversationTurn, DEFAULT_ALLOWED_TOOLS } from "./central-engine.ts";
import { loadPersistedWorkingMemory } from "./working-memory.ts";
import { sanitizeTurnError } from "../runtime/sanitize-error.ts";

export type CentralShadowDeps = {
  readonly brain: AgentBrainPort;
  readonly llm: DecisionLlm;
  readonly runQuery: QueryRunner;
  readonly businessInfo: TenantBusinessInfoSource;
  readonly contextPreparer: TurnContextPreparer;
  readonly clock: Clock;
  readonly portalPromptSha256: string;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  readonly brainMaxSteps?: number;
  readonly allowedTools?: readonly string[];
};

// Comparação SANITIZADA (nunca PII/segredo/URL). agentText é redigido (sanitizeTurnError cobre sk-/JWT/Bearer;
// o texto do agente é curto e sem PII do lead por contrato do compose, mas passamos por um trim defensivo).
export type CentralShadowComparison = {
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: string;
  readonly reasonCode?: string;
  readonly terminalSafe: boolean;
  readonly brainSteps: number;
  readonly toolsRequested: readonly string[];
  readonly effectKinds: readonly string[];
  readonly wmLastPhotoLabel: string | null;
  readonly canonicalUntouched: boolean;   // versão canônica não mudou (nenhuma escrita no canônico)
  readonly responsePreview: string;        // primeiros 160 chars, sanitizado
};

// Brain que registra as tools pedidas (para a comparação), delegando ao real.
class RecordingShadowBrain implements AgentBrainPort {
  readonly requestedTools: string[] = [];
  constructor(private readonly inner: AgentBrainPort) {}
  async proposeNextStep(frame: Parameters<AgentBrainPort["proposeNextStep"]>[0], obs: Parameters<AgentBrainPort["proposeNextStep"]>[1]) {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") this.requestedTools.push(step.call.tool);
    return step;
  }
}

export async function runCentralShadowTurn(args: {
  readonly canonicalPersistence: Persistence;
  readonly conversationId: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly leadId?: string | null;
  readonly messageBlock: string;
  readonly turnId: string;
  readonly deps: CentralShadowDeps;
  // Snapshot PRÉ-turno (opcional): quando o shadow roda ao lado do canônico, use o estado ANTES do turno canônico
  // (senão o shadow veria a resposta do canônico já em recentTurns). Sem override: lê o estado canônico atual.
  readonly seedStateOverride?: ConversationState;
}): Promise<{ ok: true; comparison: CentralShadowComparison } | { ok: false; reason: string }> {
  const { canonicalPersistence, conversationId, tenantId, agentId, leadId, messageBlock, turnId, deps } = args;

  // 1) LÊ (read-only) a VERSÃO canônica atual, p/ depois provar que nada mudou no canônico.
  let before;
  try {
    before = await canonicalPersistence.load(conversationId);
  } catch (error) {
    return { ok: false, reason: `shadow_load_failed:${sanitizeTurnError(error instanceof Error ? error.message : String(error))}` };
  }
  const beforeVersion = before?.version ?? -1;

  // 2) Store ISOLADO (nada aqui toca o canônico). Semeia com o snapshot pré-turno (override) OU o estado canônico.
  const iso = new InMemoryPersistence(deps.clock, new FakeIdGen());
  const source = args.seedStateOverride ?? before?.state ?? null;
  const seedState = source
    ? { ...structuredClone(source), version: 0 }
    : createInitialState({ conversationId, tenantId, agentId, leadId, now: deps.clock.now() });
  const seedUow = iso.begin();
  seedUow.casState(conversationId, 0, seedState);
  const seeded = seedUow.commit();
  if (!seeded.ok) return { ok: false, reason: `shadow_seed_failed:${seeded.reason}` };
  await iso.tryInsert({ eventId: `${turnId}-shadow`, conversationId, raw: redact({ text: messageBlock }) as never, receivedAt: deps.clock.now() });

  // 3) Roda o turno central no ISOLADO (EffectGate OFF por construção — nenhum dispatcher; capability none).
  const recordingBrain = new RecordingShadowBrain(deps.brain);
  const r = await runCentralConversationTurn({
    persistence: iso, clock: deps.clock, brain: recordingBrain, llm: deps.llm, runQuery: deps.runQuery,
    businessInfo: deps.businessInfo, contextPreparer: deps.contextPreparer,
    conversationId, tenantId, agentId, leadId: leadId ?? null,
    workerId: "central-shadow", turnId, leaseTtlMs: 60_000, portalPromptSha256: deps.portalPromptSha256,
    limits: deps.limits, maxValidationAttempts: deps.maxValidationAttempts, brainMaxSteps: deps.brainMaxSteps,
    allowedTools: deps.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
    providerCapability: { send_message: "none", send_media: "none" },
    // B6 (audit): shadow espelha EXATAMENTE o caminho ativo (autoria única, sem 2º compose).
    singleAuthor: true,
    // F7-5 (decisão do dono, Opção a): o shadow observa o MESMO agente que vai para produção — llmFirst=true, igual
    // ao central_active (pilot-active-root #processCentralActive). Efeitos externos seguem OFF (store isolado, zero
    // dispatch, providerCapability none), então o shadow NUNCA envia; apenas espelha a autoria/condução da LLM.
    llmFirst: true,
  });

  // 4) PROVA de não-interferência: o estado CANÔNICO não mudou de versão (nenhuma escrita no canônico).
  let after;
  try { after = await canonicalPersistence.load(conversationId); } catch { after = before; }
  const canonicalUntouched = (after?.version ?? -1) === beforeVersion;

  const wmLabel = r.status === "committed" ? (loadPersistedWorkingMemory(r.workingMemory).memory.lastPhotoAction?.label ?? null) : null;
  const comparison: CentralShadowComparison = {
    conversationId, turnId,
    status: r.status,
    reasonCode: r.status === "committed" ? r.decision.reasonCode : (r.status === "commit_failed" ? "commit_failed" : undefined),
    terminalSafe: r.status === "committed" ? r.terminalSafe : false,
    brainSteps: r.status === "committed" ? r.brainSteps : 0,
    toolsRequested: [...recordingBrain.requestedTools],
    effectKinds: r.status === "committed" ? r.outbox.map((o) => o.kind) : [],
    wmLastPhotoLabel: wmLabel,
    canonicalUntouched,
    responsePreview: r.status === "committed" ? sanitizeTurnError(r.composedText).slice(0, 160) : "",
  };
  return { ok: true, comparison };
}
