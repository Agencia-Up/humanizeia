// ============================================================================
// ConversationEngine - F2.1. Orquestra UM turno end-to-end em memoria:
// inbox -> claim -> state -> DecisionEngine -> reducer -> outbox -> commit CAS.
// SEM dispatcher, SEM provider, SEM banco real, SEM rede.
// ============================================================================
import type { DecisionLlm } from "../domain/llm.ts";
import type { Clock, Persistence } from "../domain/ports.ts";
import type { TurnContext, QueryLoopLimits, TurnContextPreparer } from "../domain/context.ts";
import { createInitialState } from "../domain/conversation-state.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { ClaimExtractor, DecisionMutation, QueryResult, TenantCatalog, TurnDecision, TurnInterpretation } from "../domain/decision.ts";
import type { InboxRecord, OutboxRecord, ProviderCapability, TurnEventRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, Iso, JsonValue } from "../domain/types.ts";
import { runTurn } from "./decision-engine.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { applyDecision } from "./state-reducer.ts";
import { materializeEffectPlans } from "./effect-materializer.ts";
import { extractLeadSlots } from "./lead-extraction.ts";
import { resolvePhotoIntent, buildPhotoTurnOutput, resolvePhotoPromiseRepair, shouldRepairPhotoPromise } from "./photo-intent.ts";
import { detectPopularEconomyIntent, resolvePopularEconomyOffer, buildPopularEconomyTurnOutput, resolvePopularityRankingIntent, buildPopularityRankingTurnOutput } from "./popularity-intent.ts";

export type ConversationEngineArgs = {
  persistence: Persistence;
  clock: Clock;
  llm: DecisionLlm;
  runQuery: QueryRunner;
  conversationId: Id;
  tenantId: Id;
  agentId: Id;
  leadId?: Id | null;
  workerId: string;
  turnId: Id;
  leaseTtlMs: number;
  interpretation?: TurnInterpretation;
  tenantCatalog?: TenantCatalog;
  claimExtractor?: ClaimExtractor;
  contextPreparer?: TurnContextPreparer;
  limits: QueryLoopLimits;
  maxValidationAttempts: number;
  providerCapability?: Partial<Record<OutboxRecord["kind"], ProviderCapability>>;
  afterCutoff?: (cutoff: Iso) => void | Promise<void>;
  beforeCommit?: (ctx: BeforeCommitContext) => void | Promise<void>;
};

export type BeforeCommitContext = {
  claimedEventIds: Id[];
  expectedVersion: number;
  nextState: ConversationState;
  turnOutput: TurnOutput;
  outbox: OutboxRecord[];
};

export type ConversationEngineResult =
  | { status: "no_op"; turnId: Id; claimedEventIds: Id[] }
  | {
      status: "committed";
      turnId: Id;
      claimedEventIds: Id[];
      decision: TurnDecision;
      composedText: string;
      facts: QueryResult[];
      outbox: OutboxRecord[];
      stateVersion: number;
    }
  | { status: "commit_failed"; turnId: Id; claimedEventIds: Id[]; reason: string };

function payloadJson(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(payloadJson);
  if (typeof value === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = payloadJson(v);
    return out;
  }
  return String(value);
}

function textFromInbox(rec: InboxRecord): string {
  const raw = rec.raw as Record<string, unknown>;
  const text = raw.text ?? raw.message ?? raw.body ?? raw.transcription ?? "";
  return typeof text === "string" ? text.trim() : "";
}

// F2.7.8 hardening (Codex): so commita os slots extraidos se o PREVIEW do reducer passar. Se falhar
// (mutacao invalida), DESCARTA (committed=[]) — senao o reducer rejeitaria o lote inteiro e derrubaria o
// turno (terminal-safe). Devolve tambem o contextState (slots aplicados, sem bump de version/turno) p/ o
// modelo ja ver o que foi capturado. PURO + testavel.
export function safeCommitSlots(
  state: ConversationState,
  slots: DecisionMutation[],
  turnId: Id,
  now: Iso,
): { contextState: ConversationState; committed: DecisionMutation[] } {
  if (slots.length === 0) return { contextState: state, committed: [] };
  const preview = applyDecision(state, slots, turnId, now);
  if (!preview.ok) return { contextState: state, committed: [] };
  return {
    contextState: { ...preview.next, version: state.version, turnNumber: state.turnNumber, updatedAt: state.updatedAt },
    committed: slots,
  };
}

function aggregateLeadMessage(records: InboxRecord[]): string {
  // F2.7.6: o bloco da rajada preserva a ORDEM de chegada (received_at), com eventId
  // como desempate deterministico — independente da ordem em que o claim devolveu.
  const ordered = [...records].sort((a, b) => {
    const ta = Date.parse(a.receivedAt);
    const tb = Date.parse(b.receivedAt);
    if (ta !== tb) return ta - tb;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
  return ordered.map(textFromInbox).filter(Boolean).join("\n");
}

function makeEvent(args: {
  conversationId: Id;
  turnId: Id;
  type: string;
  suffix: string;
  payload: { [k: string]: JsonValue };
  at: Iso;
}): TurnEventRecord {
  return {
    eventId: `${args.turnId}:${args.suffix}`,
    conversationId: args.conversationId,
    turnId: args.turnId,
    type: args.type,
    payloadSchemaVersion: 1,
    payload: redact(args.payload),
    at: args.at,
  };
}

export async function runConversationTurn(args: ConversationEngineArgs): Promise<ConversationEngineResult> {
  const {
    persistence, clock, llm, runQuery, conversationId, tenantId, agentId, leadId,
    workerId, turnId, leaseTtlMs, interpretation, tenantCatalog, claimExtractor, contextPreparer,
    limits, maxValidationAttempts, providerCapability, afterCutoff, beforeCommit,
  } = args;

  let claimedEventIds: Id[] = [];

  return persistence.withLease(conversationId, workerId, leaseTtlMs, async (lease) => {
    const cutoff = clock.now();
    if (afterCutoff) await afterCutoff(cutoff);

    claimedEventIds = await persistence.claimBurst(conversationId, cutoff, workerId, turnId, lease);
    if (claimedEventIds.length === 0) return { status: "no_op", turnId, claimedEventIds };

    try {
      const loadedInbox = await Promise.all(
        claimedEventIds.map((eventId) => persistence.get(eventId)),
      );
      const inboxRecords = loadedInbox.filter((rec): rec is InboxRecord => rec != null);

      if (inboxRecords.length !== claimedEventIds.length) {
        throw new Error("claimed inbox record missing");
      }

      const snapshot = await persistence.load(conversationId);
      const expectedVersion = snapshot?.version ?? 0;
      const state = snapshot?.state ?? createInitialState({ conversationId, tenantId, agentId, leadId, now: cutoff });
      const leadMessage = aggregateLeadMessage(inboxRecords);
      const prepared = contextPreparer
        ? await contextPreparer.prepare({ state, turnId, leadMessage, now: cutoff })
        : interpretation && tenantCatalog && claimExtractor
          ? { interpretation, tenantCatalog, claimExtractor }
          : null;
      if (!prepared) throw new Error("turn context preparation missing");

      // F2.7.7: captura DETERMINISTICA de slots (nome normalizado + interesse multi-modelo) + resolucao
      // do objetivo de nome — FONTE UNICA (o LLM segue facts:[]). So emite mutacoes VALIDAS (o reducer
      // rejeita o lote inteiro se algo invalido), entao o extrator e conservador e nunca derruba o turno.
      // Calculado ANTES de decidir + aplicado num ESTADO-PREVIA (sem bump de version/turnNumber) p/ o
      // modelo JA ver o nome/interesse capturados -> reconhece e NAO repergunta o nome no MESMO turno.
      const extractedSlots = extractLeadSlots({
        leadMessage,
        state,
        interpretation: prepared.interpretation,
        claimExtractor: prepared.claimExtractor,
        turnId,
      });
      // F2.7.8 hardening (Codex): so commita os slots se o PREVIEW do reducer passar (senao descarta,
      // nao derruba o turno). contextState = slots aplicados (sem bump) p/ o modelo nao reperguntar.
      const { contextState, committed: safeExtractedSlots } = safeCommitSlots(state, extractedSlots, turnId, cutoff);

      const ctx: TurnContext = {
        state: contextState,
        turnId,
        leadMessage,
        now: cutoff,
        interpretation: prepared.interpretation,
        tenantCatalog: prepared.tenantCatalog,
        claimExtractor: prepared.claimExtractor,
      };

      // F2.7.8: pedido de FOTO e tratado DETERMINISTICAMENTE (resolve veiculo + fotos -> EffectPlan
      // send_media real), nunca fingido por texto. Se nao for pedido de foto, segue o fluxo normal do LLM.
      const photoIntent = await resolvePhotoIntent({
        leadMessage,
        state: contextState,
        claimExtractor: prepared.claimExtractor,
        runQuery,
        interpretation: prepared.interpretation,
      });
      // F2.7.10 (dominio BR): "carro popular" = ENTRADA/economico -> oferta REAL do estoque. "mais vendidos/
      // procurados/o que mais sai/best sellers" = ranking sem fonte -> honesto. P1 do Codex: em frase HIBRIDA
      // ("populares mais vendidos") o RANKING explicito VENCE -> calcula ranking PRIMEIRO; economy so se NAO houver.
      const rankingIntent = photoIntent ? null : resolvePopularityRankingIntent({ leadMessage });
      const economyIntent = (photoIntent || rankingIntent) ? false : detectPopularEconomyIntent(leadMessage);
      let turnOutput: TurnOutput;
      if (photoIntent) {
        turnOutput = buildPhotoTurnOutput(photoIntent, turnId, cutoff);
      } else if (rankingIntent) {
        turnOutput = buildPopularityRankingTurnOutput(turnId);
      } else if (economyIntent) {
        // "populares" -> 5 mais em conta do estoque + nota do criterio (ancorado nos fatos, nunca terminal-safe).
        turnOutput = buildPopularEconomyTurnOutput(await resolvePopularEconomyOffer({ runQuery }), turnId);
      } else {
        turnOutput = await runTurn({ ctx, llm, runQuery, limits, maxValidationAttempts });
        // F2.7.8 LAYER 2: NENHUMA promessa de foto sem send_media real. Se o LLM decidiu enviar foto sem
        // send_media, ROTEIA pelo resolvedor deterministico -> envia de verdade OU responde honesto.
        if (shouldRepairPhotoPromise({ decision: turnOutput.decision, composedText: turnOutput.composed.text, leadMessage })) {
          const repair = await resolvePhotoPromiseRepair({
            composedText: turnOutput.composed.text,
            leadMessage,
            state: contextState,
            claimExtractor: prepared.claimExtractor,
            runQuery,
            interpretation: prepared.interpretation,
          });
          turnOutput = buildPhotoTurnOutput(repair, turnId, cutoff);
        }
      }
      // F2.7.4: a fala do lead entra na memoria (recentTurns) deterministicamente (burst agregado num turno).
      const leadTurnMutations: DecisionMutation[] = leadMessage.trim().length > 0
        ? [{ op: "append_lead_turn", turn: { role: "lead", text: leadMessage, at: cutoff } }]
        : [];
      // O engine e a UNICA fonte do append_lead_turn — remove qualquer um emitido pelo modelo (sem duplicar).
      const modelMutations = turnOutput.decision.decisionMutations.filter((m) => m.op !== "append_lead_turn");
      const committedMutations = [...leadTurnMutations, ...safeExtractedSlots, ...modelMutations];
      const reduced = applyDecision(state, committedMutations, turnId, cutoff);
      if (!reduced.ok) {
        throw new Error(`decision mutations rejected: ${reduced.rejected.map((r) => r.reason).join("; ")}`);
      }

      const outbox = materializeEffectPlans(turnOutput.decision, turnOutput.composed, {
        conversationId,
        createdAt: cutoff,
        providerCapability,
      });

      if (beforeCommit) await beforeCommit({ claimedEventIds, expectedVersion, nextState: reduced.next, turnOutput, outbox });

      const events = [
        makeEvent({ conversationId, turnId, type: "turn_claimed", suffix: "claimed", payload: { eventIds: claimedEventIds }, at: cutoff }),
        makeEvent({
          conversationId,
          turnId,
          type: "decision_final",
          suffix: "decision",
          payload: {
            action: turnOutput.decision.action,
            reasonCode: turnOutput.decision.reasonCode,
            effectIds: outbox.map((r) => r.effectId),
          },
          at: cutoff,
        }),
        makeEvent({
          conversationId,
          turnId,
          type: "response_composed",
          suffix: "response",
          payload: { text: turnOutput.composed.text, terminalSafe: turnOutput.terminalSafe },
          at: cutoff,
        }),
      ];

      const uow = persistence.begin({ lease });
      uow.casState(conversationId, expectedVersion, reduced.next);
      uow.appendEvents(events);
      uow.appendDecision(conversationId, { ...turnOutput.decision, decisionMutations: committedMutations });
      uow.appendOutbox(outbox);
      uow.markInboxDone(claimedEventIds, workerId, turnId);
      const commit = await uow.commit();

      if (!commit.ok) {
        await persistence.releaseClaim(claimedEventIds, workerId, turnId);
        return { status: "commit_failed", turnId, claimedEventIds, reason: commit.reason };
      }

      return {
        status: "committed",
        turnId,
        claimedEventIds,
        decision: turnOutput.decision,
        composedText: turnOutput.composed.text,
        facts: turnOutput.facts,
        outbox,
        stateVersion: reduced.next.version,
      };
    } catch (err) {
      await persistence.releaseClaim(claimedEventIds, workerId, turnId);
      return {
        status: "commit_failed",
        turnId,
        claimedEventIds,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
