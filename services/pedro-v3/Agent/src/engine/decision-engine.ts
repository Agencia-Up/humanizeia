// ============================================================================
// DecisionEngine — PURO (sem I/O). Brain/02 §3.
//  - bounded read-only query loop com autorização POR CHAMADA (Codex r3 #6);
//  - pós-query -> Finalizer (única decisão);
//  - compose -> validate com LIMITE de tentativas -> terminal SAFE_RESPONSE que
//    CANCELA efeitos comerciais (Codex r3.5 #1/#7). Nunca loop infinito nem silêncio.
// O despacho de efeitos e o EffectOutcomeCommit ficam FORA do engine (outbox).
// ============================================================================
import type { TurnContext, QueryLoopLimits } from "../domain/context.ts";
import type { DecisionLlm } from "../domain/llm.ts";
import type {
  QueryCall, QueryResult, ProposedDecision, TurnDecision, RenderedResponse, EffectPlan, SendMessagePlan, ProposedEffectPlan,
} from "../domain/decision.ts";
import { PolicyEngine, hasDeny } from "./policy-engine.ts";
import { finalize, emitTerminalSafe, emitErrorTerminalSafe } from "./finalizer.ts";
import { ResponseRenderer } from "./response-renderer.ts";

export type QueryRunner = (call: QueryCall) => Promise<QueryResult>;

export type TurnOutput = {
  decision: TurnDecision;
  composed: RenderedResponse;
  facts: QueryResult[];
  loopExhausted: boolean;
  terminalSafe: boolean; // validação esgotou -> SAFE_RESPONSE + alerta/dead-letter
  steps: number;
};

const SAFE_CLARIFY = (): ProposedDecision => ({
  proposedAction: "clarify",
  facts: [],
  proposedEffects: [{ kind: "send_message", planId: "safe-clarify", order: 1, onSuccess: [] } as ProposedEffectPlan],
  responsePlan: { guidance: "Não consegui concluir com segurança — peço um esclarecimento." },
  reasonCode: "query_loop_exhausted", reasonSummary: "limite do loop atingido", confidence: 0.5,
});

// D (F2.7.4): modelos que o lead nomeou NESTE turno (interpretacao + claims do catalogo na fala do lead).
// Base para consultar o estoque ANTES de propor — "tools/query antes de responder", sem if por frase.
function detectRequestedModels(ctx: TurnContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (m: string | null | undefined): void => {
    const norm = (m ?? "").trim();
    const key = norm.toLowerCase();
    if (!norm || seen.has(key)) return;
    seen.add(key);
    out.push(norm);
  };
  push(ctx.interpretation.extractedEntities?.model);
  for (const claim of ctx.claimExtractor.extractClaims(ctx.leadMessage)) {
    if (claim.kind === "model" || claim.kind === "brand_model") push(claim.text);
  }
  return out.slice(0, 2); // bound: no maximo 2 modelos seedados por turno
}

// D3 (F2.7.4): recompoe com FEEDBACK do deny anterior em vez de repetir cega (que so reproduz o erro
// -> terminal-safe). Anexa a correcao ao guidance (o compose ja recebe decision.responsePlan.guidance).
// NAO muta a decisao original (usada no caminho terminal-safe).
function withRetryGuidance(decision: TurnDecision, denyDetail: string): TurnDecision {
  const note = ` [CORRECAO OBRIGATORIA: sua tentativa anterior foi REJEITADA pela validacao (${denyDetail}). Nunca escreva marca/modelo/preco em texto livre — use partes vehicle_ref/money_ref ancoradas nos fatos; NAO cite veiculo ausente dos fatos.]`;
  return { ...decision, responsePlan: { guidance: (decision.responsePlan.guidance + note).slice(0, 1400) } };
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const step = errorMsg.split(":")[0];
      const err = new Error(errorMsg);
      (err as any).step = step;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

export async function runTurn(args: {
  ctx: TurnContext;
  llm: DecisionLlm;
  runQuery: QueryRunner;
  limits: QueryLoopLimits;
  maxValidationAttempts: number;
}): Promise<TurnOutput> {
  const { ctx, llm, runQuery, limits, maxValidationAttempts } = args;

  const fullCtx: TurnContext = ctx;

  const execute = async (): Promise<TurnOutput> => {
    const facts: QueryResult[] = [];
    // D (F2.7.4): se o lead nomeou um veiculo, consulta o estoque ANTES de propor (deterministico).
    // Raiz do terminal-safe "TextPart contem 'ONIX'": o modelo respondia sobre o veiculo SEM fatos.
    // Com os fatos ja presentes, a proposta/compose se ancora (vehicle_ref) ou diz "nao encontrei" + similares.
    for (const modelo of detectRequestedModels(fullCtx)) {
      const seedCall: QueryCall = { tool: "stock_search", input: { modelo } };
      if (PolicyEngine.authorizeQuery(seedCall, fullCtx, facts).outcome !== "allow") continue;
      let seedRes: QueryResult;
      try {
        seedRes = await withTimeout(
          runQuery(seedCall),
          limits.queryTimeoutMs ?? 4000,
          "query: stock_search (seed) exceeded timeout",
        );
      } catch (err: any) {
        err.step = err.step ?? "query";
        throw err;
      }
      facts.push(seedRes);
    }
    let proposal: ProposedDecision | null = null;
    let steps = 0;
    let loopExhausted = false;

    for (; steps < limits.maxSteps; steps++) {
      let step;
      try {
        step = await withTimeout(
          llm.proposeNextQueryOrFinal(fullCtx, facts),
          limits.proposeTimeoutMs ?? 5000,
          "propose: LLM proposal exceeded timeout"
        );
      } catch (err: any) {
        err.step = err.step ?? "propose";
        throw err;
      }
      if (step.kind === "final") { proposal = step.proposal; break; }

      // kind === "query": AUTORIZA antes de executar (POL-STATE-011).
      const verdict = PolicyEngine.authorizeQuery(step.call, fullCtx, facts);
      if (verdict.outcome === "allow") {
        let queryRes;
        try {
          queryRes = await withTimeout(
            runQuery(step.call),
            limits.queryTimeoutMs ?? 4000,
            `query: Query tool ${step.call.tool} exceeded timeout`
          );
        } catch (err: any) {
          err.step = err.step ?? "query";
          throw err;
        }
        facts.push(queryRes);
      } else {
        facts.push({ ok: false, tool: step.call.tool, error: { code: "FORBIDDEN", message: verdict.violations?.join(";") ?? "query negada", retryable: false } } as QueryResult);
      }
    }
    if (!proposal) { proposal = SAFE_CLARIFY(); loopExhausted = true; }

    // ── PÓS-QUERY -> Finalizer (única decisão) ──
    const post = PolicyEngine.postQuery(proposal, facts, fullCtx);
    let decision = finalize(fullCtx.turnId, proposal, post, facts);

    // ── COMPOSE -> VALIDATE com LIMITE (Codex r3 #7) ──
    let composed: RenderedResponse = {
      draft: { parts: [] },
      text: ""
    };
    let terminalSafe = false;
    let ok = false;
    let lastDenyDetail = ""; // F2.7.3: motivo do deny de grounding (observabilidade no terminal-safe)
    for (let attempt = 1; attempt <= maxValidationAttempts; attempt++) {
      // D3: a partir da 2a tentativa, recompoe COM o motivo do deny anterior (feedback), nao cega.
      const composeDecision = attempt > 1 && lastDenyDetail ? withRetryGuidance(decision, lastDenyDetail) : decision;
      try {
        const draft = await withTimeout(
          llm.compose(composeDecision, facts, fullCtx),
          limits.composeTimeoutMs ?? 5000,
          "compose: LLM compose exceeded timeout"
        );
        composed = { draft, text: "" };
      } catch (err: any) {
        err.step = err.step ?? "compose";
        throw err;
      }

      let gv;
      try {
        composed.text = ResponseRenderer.render(composed.draft, facts, fullCtx.state);
        gv = PolicyEngine.validateResponse(composed, facts, decision, fullCtx);
      } catch (renderErr: any) {
        // Referência inválida falha fechada -> gv vira deny imediato
        gv = [{
          policyId: "POL-GROUND-PRICE",
          outcome: "deny" as const,
          violations: [`Erro de renderização: ${renderErr.message ?? renderErr}`]
        }];
      }

      if (!hasDeny(gv)) { ok = true; break; }
      lastDenyDetail = JSON.stringify(gv.filter((v) => v.outcome === "deny")).slice(0, 220);
    }
    if (!ok) {
      // TERMINAL: cancela efeitos comerciais + resposta segura + dead-letter/alerta. Sem loop/silêncio.
      decision = emitTerminalSafe(fullCtx.turnId, decision, `Validação de resposta falhou repetidamente: ${lastDenyDetail || "motivo nao capturado"}`.slice(0, 260));
      composed = {
        draft: { parts: [{ type: "text", content: "Desculpe a lentidão temporária. Como posso te ajudar a escolher seu veículo hoje?" }] },
        text: "Desculpe a lentidão temporária. Como posso te ajudar a escolher seu veículo hoje?"
      };
      terminalSafe = true;
    }

    return { decision, composed, facts, loopExhausted, terminalSafe, steps };
  };

  try {
    return await withTimeout(
      execute(),
      limits.totalTimeoutMs,
      "global: Turn execution exceeded global timeout"
    );
  } catch (err: any) {
    const step = err.step ?? (err.message?.startsWith("global:") ? "global" : "unknown");
    const reason = err.message ?? String(err);

    // Todo TurnDecision, inclusive erro global/timeout, sai do Finalizer
    const decision = emitErrorTerminalSafe(ctx.turnId, step, reason);
    const composed = {
      draft: { parts: [{ type: "text" as const, content: "Desculpe a lentidão temporária. Como posso te ajudar a escolher seu veículo hoje?" }] },
      text: "Desculpe a lentidão temporária. Como posso te ajudar a escolher seu veículo hoje?"
    };

    return {
      decision,
      composed,
      facts: [],
      loopExhausted: step === "global",
      terminalSafe: true,
      steps: 0
    };
  }
}
