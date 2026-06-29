import type { DecisionLlm } from "../domain/llm.ts";
import type { Clock, InboxInsert, Persistence } from "../domain/ports.ts";
import type { ClaimExtractor, QueryName, QueryResult, TenantCatalog, TurnAction, TurnInterpretation } from "../domain/decision.ts";
import type { OutboxRecord } from "../domain/effect-intent.ts";
import { redact } from "../domain/effect-intent.ts";
import type { Id, JsonValue } from "../domain/types.ts";
import type { QueryLoopLimits, TurnContextPreparer } from "../domain/context.ts";
import type { QueryRunner } from "./decision-engine.ts";
import { runConversationTurn, type ConversationEngineResult } from "./conversation-engine.ts";
import { InMemoryEffectGate } from "./effect-gate.ts";
import { OutboxDispatcher, type EffectDispatcher } from "./outbox-dispatcher.ts";

export type ShadowExpected = {
  readonly action?: TurnAction;
  readonly reasonCode?: string;
  readonly requiredTools?: readonly QueryName[];
  readonly forbiddenTools?: readonly QueryName[];
};

export type ShadowComparison = {
  readonly passed: boolean;
  readonly mismatches: readonly string[];
};

export type ShadowHarnessResult = {
  readonly inserted: boolean;
  readonly engine: ConversationEngineResult;
  readonly outboxBeforeDispatch: readonly OutboxRecord[];
  readonly outboxAfterDispatch: readonly OutboxRecord[];
  readonly facts: readonly QueryResult[];
  readonly dispatchAttempts: number;
  readonly comparison: ShadowComparison;
};

export type ShadowHarnessArgs = {
  readonly persistence: Persistence;
  readonly clock: Clock;
  readonly llm: DecisionLlm;
  readonly runQuery: QueryRunner;
  readonly conversationId: Id;
  readonly tenantId: Id;
  readonly agentId: Id;
  readonly leadId?: Id | null;
  readonly workerId: string;
  readonly turnId: Id;
  readonly eventId: Id;
  readonly messageText: string;
  readonly receivedAt?: string;
  readonly interpretation?: TurnInterpretation;
  readonly tenantCatalog?: TenantCatalog;
  readonly claimExtractor?: ClaimExtractor;
  readonly contextPreparer?: TurnContextPreparer;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  readonly expected?: ShadowExpected;
};

function compareShadow(args: {
  engine: ConversationEngineResult;
  facts: readonly QueryResult[];
  outboxAfterDispatch: readonly OutboxRecord[];
  dispatchAttempts: number;
  expected?: ShadowExpected;
}): ShadowComparison {
  const mismatches: string[] = [];

  if (args.dispatchAttempts !== 0) {
    mismatches.push(`shadow tentou dispatch real ${args.dispatchAttempts} vez(es)`);
  }

  for (const record of args.outboxAfterDispatch) {
    if (record.status !== "skipped") {
      mismatches.push(`efeito ${record.effectId} ficou ${record.status}, esperado skipped em shadow`);
    }
    if (record.outcomeAppliedAt !== null) {
      mismatches.push(`efeito ${record.effectId} aplicou outcome em shadow`);
    }
  }

  if (args.engine.status === "committed") {
    if (args.expected?.action && args.engine.decision.action !== args.expected.action) {
      mismatches.push(`action=${args.engine.decision.action}, esperado ${args.expected.action}`);
    }
    if (args.expected?.reasonCode && args.engine.decision.reasonCode !== args.expected.reasonCode) {
      mismatches.push(`reasonCode=${args.engine.decision.reasonCode}, esperado ${args.expected.reasonCode}`);
    }
  } else if (args.expected?.action || args.expected?.reasonCode) {
    mismatches.push(`turno nao commitou: ${args.engine.status}`);
  }

  const usedTools = new Set(args.facts.map((fact) => fact.tool));
  for (const tool of args.expected?.requiredTools ?? []) {
    if (!usedTools.has(tool)) mismatches.push(`tool obrigatoria nao usada: ${tool}`);
  }
  for (const tool of args.expected?.forbiddenTools ?? []) {
    if (usedTools.has(tool)) mismatches.push(`tool proibida usada: ${tool}`);
  }

  return { passed: mismatches.length === 0, mismatches };
}

export async function runShadowHarnessTurn(args: ShadowHarnessArgs): Promise<ShadowHarnessResult> {
  const raw: InboxInsert["raw"] = redact({ text: args.messageText });
  const inserted = await args.persistence.tryInsert({
    eventId: args.eventId,
    conversationId: args.conversationId,
    raw,
    receivedAt: args.receivedAt ?? args.clock.now(),
  });

  const engine = await runConversationTurn({
    persistence: args.persistence,
    clock: args.clock,
    llm: args.llm,
    runQuery: args.runQuery,
    conversationId: args.conversationId,
    tenantId: args.tenantId,
    agentId: args.agentId,
    leadId: args.leadId,
    workerId: args.workerId,
    turnId: args.turnId,
    leaseTtlMs: 60_000,
    interpretation: args.interpretation,
    tenantCatalog: args.tenantCatalog,
    claimExtractor: args.claimExtractor,
    contextPreparer: args.contextPreparer,
    limits: args.limits,
    maxValidationAttempts: args.maxValidationAttempts,
  });

  const outboxBeforeDispatch = await args.persistence.listOutbox(args.conversationId);

  let dispatchAttempts = 0;
  const dispatchRecorder: EffectDispatcher = {
    async dispatch(record) {
      dispatchAttempts += 1;
      return {
        status: "outcome_uncertain",
        effectId: record.effectId,
        metadata: redact({ reason: "shadow_dispatch_should_never_run" as JsonValue }),
      };
    },
  };

  const shadowGate = new InMemoryEffectGate();
  shadowGate.setActiveMode(args.conversationId, false);
  const dispatcher = new OutboxDispatcher(
    args.persistence,
    args.clock,
    dispatchRecorder,
    shadowGate,
    `${args.workerId}:shadow-dispatcher`,
  );
  await dispatcher.dispatchConversation(args.conversationId);

  const outboxAfterDispatch = await args.persistence.listOutbox(args.conversationId);
  const facts = engine.status === "committed" ? engine.facts : [];
  const comparison = compareShadow({
    engine,
    facts,
    outboxAfterDispatch,
    dispatchAttempts,
    expected: args.expected,
  });

  return {
    inserted,
    engine,
    outboxBeforeDispatch,
    outboxAfterDispatch,
    facts,
    dispatchAttempts,
    comparison,
  };
}
