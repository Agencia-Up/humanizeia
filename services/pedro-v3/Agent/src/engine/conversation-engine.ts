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
import { runTurn, composeAndVerify } from "./decision-engine.ts";
import type { QueryRunner, TurnOutput } from "./decision-engine.ts";
import { applyDecision } from "./state-reducer.ts";
import { materializeEffectPlans } from "./effect-materializer.ts";
import { extractLeadSlots } from "./lead-extraction.ts";
import { resolvePhotoIntent, buildPhotoTurnOutput, resolvePhotoPromiseRepair, shouldRepairPhotoPromise } from "./photo-intent.ts";
import { detectPopularEconomyIntent, resolvePopularEconomyOffer, buildPopularEconomyTurnOutput, resolvePopularityRankingIntent, buildPopularityRankingTurnOutput } from "./popularity-intent.ts";
import { detectContinuityIntent, buildContinuityTurnOutput, resolveContinuityFacts } from "./continuity-fallback.ts";
import { computeRenderedOfferContext } from "./offer-context.ts";
import { resolveExplicitSearchIntent, buildExplicitSearchTurnOutput, resolveMoreOptionsIntent, buildMoreOptionsTurnOutput } from "./explicit-search.ts";
import { focusInvalidationMutations, isNewSearchTurn } from "./vehicle-focus.ts";
import { detectInvalidOrdinalChoice, buildInvalidOrdinalChoiceTurnOutput } from "./ordinal-choice.ts";
import { applySdrConduction, conductDecision, adjustDraftSafeguards, reconcileObjectiveWithQuestion, type SdrQualificationPolicy } from "./sdr-conductor.ts";

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
  sdrPolicy?: SdrQualificationPolicy;
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
      terminalSafe: boolean; // fallback determinÃ­stico foi usado neste turno (compose/policy falhou) â€” observabilidade
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
// (mutacao invalida), DESCARTA (committed=[]) â€” senao o reducer rejeitaria o lote inteiro e derrubaria o
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

// 1B.7 / P1 (Codex): as travas determinÃ­sticas (apresentaÃ§Ã£o no 1Âº contato + anti-SLOT_FIXATION) NÃƒO sÃ£o mais
// aplicadas ao texto pÃ³s-policy. Agora entram como `adjustDraft` (adjustDraftSafeguards) DENTRO do compose:
// ajustam as PARTS antes de renderizar+validar, preservando as parts estruturadas e revalidando integralmente.

function aggregateLeadMessage(records: InboxRecord[]): string {
  // F2.7.6: o bloco da rajada preserva a ORDEM de chegada (received_at), com eventId
  // como desempate deterministico â€” independente da ordem em que o claim devolveu.
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
    limits, maxValidationAttempts, providerCapability, sdrPolicy, afterCutoff, beforeCommit,
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
      // do objetivo de nome â€” FONTE UNICA (o LLM segue facts:[]). So emite mutacoes VALIDAS (o reducer
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
      // F2.7.13 (P0): PRIORIDADE DO TURNO ATUAL. Se o lead pediu AGORA marca/modelo/tipo/faixa, roda
      // stock_search do que ele pediu e oferta (ancorado) OU responde honesto â€” VENCE memoria antiga
      // (slots.interesse/lastCommercialInterest/lista antiga). Era a raiz do "jeep -> Argo".
      const explicitSearch = (photoIntent || rankingIntent || economyIntent)
        ? null
        : await resolveExplicitSearchIntent({ leadMessage, state: contextState, claimExtractor: prepared.claimExtractor, interpretation: prepared.interpretation, runQuery });
      // SeÃ§Ã£o 4: "mais opÃ§Ãµes" DETERMINÃSTICO â€” herda tipo/teto dos slots + exclui os jÃ¡ mostrados (nunca deixa
      // o LLM inventar veÃ­culo). SÃ³ quando NÃƒO Ã© busca nova (senÃ£o Ã© explicit-search) e hÃ¡ contexto anterior.
      const moreOptions = (photoIntent || rankingIntent || economyIntent || explicitSearch)
        ? null
        : await resolveMoreOptionsIntent({ leadMessage, state: contextState, runQuery, claimExtractor: prepared.claimExtractor });
      // F2.7.11 (P0): saudacao/ack/comentario curto SEM intencao comercial nova -> conduz pelo contexto.
      const invalidOrdinalChoice = (photoIntent || rankingIntent || economyIntent || explicitSearch || moreOptions)
        ? null
        : detectInvalidOrdinalChoice({ leadMessage, state: contextState });
      const continuityIntent = (photoIntent || rankingIntent || economyIntent || explicitSearch || moreOptions || invalidOrdinalChoice)
        ? false
        : detectContinuityIntent({ leadMessage, state: contextState, claimExtractor: prepared.claimExtractor });
      let turnOutput: TurnOutput;
      if (photoIntent) {
        turnOutput = buildPhotoTurnOutput(photoIntent, turnId, cutoff);
      } else if (rankingIntent) {
        turnOutput = buildPopularityRankingTurnOutput(turnId);
      } else if (economyIntent) {
        // "populares" -> 5 mais em conta do estoque + nota do criterio (ancorado nos fatos, nunca terminal-safe).
        turnOutput = buildPopularEconomyTurnOutput(await resolvePopularEconomyOffer({ runQuery }), turnId);
      } else if (explicitSearch) {
        turnOutput = buildExplicitSearchTurnOutput(explicitSearch, turnId);
      } else if (moreOptions) {
        turnOutput = buildMoreOptionsTurnOutput(moreOptions, turnId, contextState.moreOptionsExhausted ?? 0);
      } else if (invalidOrdinalChoice) {
        turnOutput = buildInvalidOrdinalChoiceTurnOutput(invalidOrdinalChoice, turnId);
      } else if (continuityIntent) {
        // R12-A (Codex): a continuidade PASSA PELO COMPOSE (frame governa), não mais pelo menu robótico legado.
        // Busca os fatos do veículo SELECIONADO (se houver) p/ o compose citá-lo aterrado; senão conduz o funil.
        const continuityFacts = await resolveContinuityFacts({ state: contextState, runQuery });
        turnOutput = buildContinuityTurnOutput(contextState, turnId, { facts: continuityFacts, leadMessage });
      } else {
        // 1B.7: o LLM puro tambÃ©m Ã© conduzido por GUIDANCE (conductDecision) antes de compor â€” o conductor
        // informa slots/prÃ³ximo/deferimento e o LLM redige seguindo o prompt, em vez de reescrever a pergunta.
        turnOutput = await runTurn({
          ctx, llm, runQuery, limits, maxValidationAttempts,
          conduct: sdrPolicy ? (d) => conductDecision({ decision: d, state: ctx.state, policy: sdrPolicy, turnId, leadMessage, interpretation: prepared.interpretation }) : undefined,
          adjustDraft: sdrPolicy ? (draft) => adjustDraftSafeguards(draft, ctx.state, sdrPolicy) : undefined,
        });
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
      // Preserva a oferta estruturada antes da conduÃ§Ã£o.
      const renderedOfferContext = computeRenderedOfferContext(turnOutput, turnId, cutoff);
      // FINDING 2 (auditoria P1, 2026-07-01): a conduÃ§Ã£o precisa ver os slots que ESTE turno acabou de gravar.
      // `contextState` ja tem os slots do lead-extraction (safeCommitSlots), mas NAO os do HANDLER (ex.: Fix C
      // do explicit-search grava tipoVeiculo/interesse em decisionMutations, so aplicados no commit adiante).
      // Sem projetar, a conduÃ§Ã£o acha o slot "unknown" e REPERGUNTA. safeCommitSlots PRESERVA version/turnNumber.
      const handlerSlotMutations = turnOutput.decision.decisionMutations.filter((m) => m.op === "set_slot" || m.op === "set_slot_ref");
      const conductorState = handlerSlotMutations.length > 0
        ? safeCommitSlots(contextState, handlerSlotMutations, turnId, cutoff).contextState
        : contextState;
      if (turnOutput.needsCompose) {
        // 1B.7 (coraÃ§Ã£o): o handler produziu FATOS + guidance (nÃ£o texto). A conduÃ§Ã£o injeta a qualificaÃ§Ã£o
        // como GUIDANCE (sem reescrever texto); o LLM real COMPÃ•E seguindo o prompt do portal; a policy valida;
        // fallback determinÃ­stico do handler SÃ“ em falha tÃ©cnica/schema/policy repetida.
        const conducted = sdrPolicy
          ? conductDecision({ decision: turnOutput.decision, state: conductorState, policy: sdrPolicy, turnId, leadMessage, interpretation: prepared.interpretation })
          : turnOutput.decision;
        // P1 (Codex): as travas (apresentaÃ§Ã£o/anti-fixaÃ§Ã£o) entram como `adjustDraft` DENTRO do compose â€” ajustam
        // as PARTS antes de renderizar+validar. Nada Ã© reescrito depois da policy; o texto validado jÃ¡ Ã© o final.
        const cv = await composeAndVerify({
          decision: conducted, facts: turnOutput.facts, ctx, llm, limits, maxValidationAttempts,
          fallbackText: turnOutput.fallbackText,
          adjustDraft: sdrPolicy ? (draft) => adjustDraftSafeguards(draft, conductorState, sdrPolicy) : undefined,
        });
        turnOutput = { ...turnOutput, decision: cv.decision, composed: cv.composed, terminalSafe: cv.terminalSafe };
      } else if (turnOutput.conducted) {
        // 1B.7: o runTurn jÃ¡ conduziu por guidance e compÃ´s COM as travas de draft aplicadas DENTRO do compose
        // (adjustDraft). Nada a reescrever aqui â€” o texto validado jÃ¡ Ã© o final.
      } else if (sdrPolicy) {
        // Caminho legado (handlers ainda nÃ£o migrados p/ compose): conduÃ§Ã£o reescreve o CTA como hoje.
        turnOutput = applySdrConduction({ output: turnOutput, state: conductorState, policy: sdrPolicy, turnId });
      }

      // R10-1 (Codex): RECONCILIAÃ‡ÃƒO objetivoâ†”pergunta â€” o objetivo PERSISTIDO passa a ser exatamente o slot da
      // pergunta EFETIVAMENTE renderizada (0 perguntas -> sem objetivo; supersede o anterior diferente). ImpossÃ­vel
      // gravar objetivo != pergunta enviada. NÃ£o roda em terminal-safe (fallback nÃ£o tem pergunta estruturada).
      if (sdrPolicy && !turnOutput.terminalSafe) {
        turnOutput = { ...turnOutput, decision: reconcileObjectiveWithQuestion({ decision: turnOutput.decision, composedText: turnOutput.composed.text, state: conductorState, turnId, policy: sdrPolicy }) };
      }

      // F2.7.4: a fala do lead entra na memoria (recentTurns) deterministicamente (burst agregado num turno).
      const leadTurnMutations: DecisionMutation[] = leadMessage.trim().length > 0
        ? [{ op: "append_lead_turn", turn: { role: "lead", text: leadMessage, at: cutoff } }]
        : [];
      // O engine e a UNICA fonte do append_lead_turn â€” remove qualquer um emitido pelo modelo (sem duplicar).
      const modelMutations = turnOutput.decision.decisionMutations.filter((m) => m.op !== "append_lead_turn");
      // P0-2 + P0 (Codex): invalidaÃ§Ã£o CENTRAL do foco baseada na AÃ‡ÃƒO do turno (nÃ£o em palavras do lead). SÃ³ uma
      // BUSCA/direÃ§Ã£o comercial REALMENTE NOVA limpa o selectedVehicleFocus â€” sinal = uma NOVA lista de oferta foi
      // renderizada (explicit-search/baratos/broad/LLM) OU uma busca explÃ­cita nova nÃ£o encontrou nada. Pedido de
      // FOTO/DETALHE (preÃ§o/cÃ¢mbio/cor/ano/km) e referÃªncia ao veÃ­culo ATUAL NÃƒO limpam. 1 renderizado -> select;
      // vÃ¡rios/nenhum -> null. Ordinal/seleÃ§Ã£o de item Ã© tratado pelo select_vehicle_focus do lead-extraction.
      const renderedItems = renderedOfferContext?.items ?? [];
      const newSearchExecuted = isNewSearchTurn({
        isPhotoIntent: photoIntent != null,
        relation: prepared.interpretation.relation,
        renderedItemCount: renderedItems.length,
        explicitSearchKind: explicitSearch?.kind ?? null,
      });
      const focusInvalidation = focusInvalidationMutations(newSearchExecuted, renderedItems, turnId);
      // R10-4: qualquer oferta NOVA com veÃ­culos renderizados RESETA a progressÃ£o de "mais opÃ§Ãµes esgotadas"
      // (o lead voltou a ver opÃ§Ãµes). Idempotente com o reset do prÃ³prio handler de mais-opÃ§Ãµes.
      const moreOptionsReset: DecisionMutation[] = (renderedItems.length > 0 && (contextState.moreOptionsExhausted ?? 0) > 0)
        ? [{ op: "set_more_options_exhausted", value: 0 }] : [];
      const committedMutations = [...leadTurnMutations, ...safeExtractedSlots, ...modelMutations, ...focusInvalidation, ...moreOptionsReset];
      const reduced = applyDecision(state, committedMutations, turnId, cutoff);
      if (!reduced.ok) {
        throw new Error(`decision mutations rejected: ${reduced.rejected.map((r) => r.reason).join("; ")}`);
      }
      // F2.7.12 (P0): se este turno renderizou uma lista (vehicle_offer_list), grava a memÃ³ria OPERACIONAL
      // estruturada (ordinal -> vehicleKey) p/ resolver "foto do N" depois â€” deterministico, sem parse de
      // texto, sem depender do delivered. Sem nova oferta -> preserva a anterior (reduced.next ja a clonou).
      if (renderedOfferContext) reduced.next.lastRenderedOfferContext = renderedOfferContext;

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
        terminalSafe: turnOutput.terminalSafe ?? false,
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


