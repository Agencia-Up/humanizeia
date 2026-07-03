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
  QueryCall, QueryResult, ProposedDecision, TurnDecision, RenderedResponse, ResponseDraft, EffectPlan, SendMessagePlan, ProposedEffectPlan,
} from "../domain/decision.ts";
import { normalizeStockSearchInput } from "../domain/decision.ts";
import { PolicyEngine, hasDeny } from "./policy-engine.ts";
import { finalize, emitTerminalSafe, emitErrorTerminalSafe } from "./finalizer.ts";
import { ResponseRenderer } from "./response-renderer.ts";
import { normalizeText } from "./catalog-utils.ts";
import { buildContextualSdrReply } from "./continuity-fallback.ts";
import type { RenderedOfferItem } from "../domain/conversation-state.ts";

export type QueryRunner = (call: QueryCall) => Promise<QueryResult>;

export type TurnOutput = {
  decision: TurnDecision;
  composed: RenderedResponse;
  facts: QueryResult[];
  loopExhausted: boolean;
  terminalSafe: boolean; // validação esgotou -> SAFE_RESPONSE + alerta/dead-letter
  steps: number;
  renderedOfferContext?: readonly RenderedOfferItem[] | null; // F2.7.12: handler determinístico já forneceu os itens (ordem)
  // 1B.7: quando true, o handler produziu FATOS+decisão+guidance (não texto final) e o ENGINE deve rodar
  // conductDecision + composeAndVerify (o LLM redige seguindo o prompt do portal). `composed` é só placeholder
  // e `fallbackText` é o texto determinístico usado SOMENTE em falha técnica/schema/policy repetida.
  needsCompose?: boolean;
  fallbackText?: string;
  // 1B.7: o runTurn (LLM puro) já aplicou a condução por GUIDANCE (conductDecision) antes de compor — o engine
  // NÃO deve reconduzir via applySdrConduction (só garante a apresentação). Handlers legados não setam.
  conducted?: boolean;
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
  // F2.7.7: TODOS os modelos do bloco (ex.: "onix ou argo") -> consulta cada um (responder o bloco inteiro).
  for (const m of ctx.interpretation.extractedEntities?.models ?? []) push(m);
  for (const claim of ctx.claimExtractor.extractClaims(ctx.leadMessage)) {
    if (claim.kind === "model" || claim.kind === "brand_model") push(claim.text);
  }
  return out.slice(0, 3); // bound: no maximo 3 modelos seedados por turno
}

// F2.7.9: pedido AMPLO de estoque por PRECO BAIXO (barato/economico/em conta/acessivel...) SEM modelo
// nomeado. Raiz do terminal-safe em "Quais modelos baratos voce tem?": sem seed, o vehicle_offer_list do
// LLM citava veiculo FORA dos fatos -> POL-GROUND-PRICE deny -> terminal-safe. Deteccao geral (sem if por frase).
const BROAD_PRICE_QUERY = /\bbarat|\beconomic|\bem conta\b|\bacessiv|\bpreco baixo\b|\bmais barat/;
export function detectBroadStockQuery(ctx: Pick<TurnContext, "leadMessage">): boolean {
  return BROAD_PRICE_QUERY.test(normalizeText(ctx.leadMessage));
}

// Ordena por preco crescente (preco > 0) e limita — a oferta ampla mostra so as opcoes mais em conta.
export function limitCheapest(res: QueryResult, n: number): QueryResult {
  if (!res.ok || res.tool !== "stock_search") return res;
  const priced = res.data.items.filter((v) => typeof v.preco === "number" && v.preco > 0).slice().sort((a, b) => a.preco - b.preco);
  const items = (priced.length > 0 ? priced : res.data.items).slice(0, n);
  return { ...res, data: { ...res.data, items } };
}

// D3 (F2.7.4): recompoe com FEEDBACK do deny anterior em vez de repetir cega (que so reproduz o erro
// -> terminal-safe). Anexa a correcao ao guidance (o compose ja recebe decision.responsePlan.guidance).
// NAO muta a decisao original (usada no caminho terminal-safe).
// Guidance de retry ESPECÍFICO por motivo do deny (R10): instrução genérica não fazia o LLM corrigir -> terminal-safe.
// Cada regra da policy tem uma correção acionável; assim a 2ª tentativa conserta em vez de repetir o erro.
function withRetryGuidance(decision: TurnDecision, denyDetail: string): TurnDecision {
  const d = denyDetail.toLowerCase();
  const tips: string[] = [];
  if (d.includes("mais de uma pergunta")) tips.push("Você fez MAIS DE UMA pergunta (oferecer visita/fotos TAMBÉM conta como pergunta). Faça SÓ UMA pergunta — escolha a mais importante agora e REMOVA as outras.");
  if (d.includes("conhecido")) tips.push("Você perguntou/reofereceu algo que o lead JÁ informou. NÃO repita nada já conhecido (inclusive visita/horário já aceitos) — use o dado e avance para o PRÓXIMO passo do funil.");
  if (d.includes("cpf")) tips.push("NÃO peça CPF neste momento — não é parte da qualificação inicial.");
  if (d.includes("nao-aterrado") || d.includes("não-aterrado")) tips.push("Você citou um MODELO que não está na oferta deste turno (ou abreviou o nome). Cite os veículos SÓ pela vehicle_offer_list com o nome EXATO dos fatos; NÃO escreva nomes de modelo em texto livre nem abrevie.");
  if (d.includes("monetario") || d.includes("monetário") || d.includes("preco") || d.includes("preço")) tips.push("NÃO escreva preço/valor de veículo em texto — use money_ref ou a vehicle_offer_list.");
  const specific = tips.length > 0 ? " " + tips.join(" ") : " Nunca escreva marca/modelo/preco em texto livre — use partes vehicle_ref/money_ref ancoradas nos fatos; NAO cite veiculo ausente dos fatos.";
  const note = ` [CORRECAO OBRIGATORIA: sua tentativa anterior foi REJEITADA pela validacao (${denyDetail}).${specific}]`;
  return { ...decision, responsePlan: { guidance: (decision.responsePlan.guidance + note).slice(0, 1600) } };
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
  // 1B.7: condução por GUIDANCE injetada pelo engine (conductDecision fechado sobre state/policy/turnId).
  // Evita dependência circular decision-engine <-> sdr-conductor. Aplicada após finalize, ANTES do compose.
  conduct?: (decision: TurnDecision) => TurnDecision;
  // P1 (Codex): ajuste determinístico do draft (apresentação/anti-fixação) antes de renderizar+validar.
  adjustDraft?: (draft: ResponseDraft) => ResponseDraft;
}): Promise<TurnOutput> {
  const { ctx, llm, runQuery, limits, maxValidationAttempts } = args;

  const fullCtx: TurnContext = ctx;

  const execute = async (): Promise<TurnOutput> => {
    const facts: QueryResult[] = [];
    // D (F2.7.4): se o lead nomeou um veiculo, consulta o estoque ANTES de propor (deterministico).
    // Raiz do terminal-safe "TextPart contem 'ONIX'": o modelo respondia sobre o veiculo SEM fatos.
    // Com os fatos ja presentes, a proposta/compose se ancora (vehicle_ref) ou diz "nao encontrei" + similares.
    const seededModels = detectRequestedModels(fullCtx);
    for (const modelo of seededModels) {
      // 1A.4: a seed também normaliza — termo de TIPO ("suv") citado como modelo pela interpretação vira `tipo`
      // (nunca stock_search({modelo:"suv"}); bypassa o decodeStep por ser query do ENGINE, não do LLM).
      const seedNorm = normalizeStockSearchInput({ modelo });
      if (!seedNorm.ok) continue;
      const seedCall: QueryCall = { tool: "stock_search", input: seedNorm.input };
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
    // F2.7.9: busca AMPLA por preco baixo (sem modelo nomeado) -> seed do estoque (a fonte ja ordena por
    // preco asc) limitado as 5 mais em conta -> o vehicle_offer_list ancora nos fatos (nada de terminal-safe).
    if (seededModels.length === 0 && detectBroadStockQuery(fullCtx)) {
      const broadCall: QueryCall = { tool: "stock_search", input: { broad: true } };
      if (PolicyEngine.authorizeQuery(broadCall, fullCtx, facts).outcome === "allow") {
        let broadRes: QueryResult;
        try {
          broadRes = await withTimeout(
            runQuery(broadCall),
            limits.queryTimeoutMs ?? 4000,
            "query: stock_search (broad seed) exceeded timeout",
          );
        } catch (err: any) {
          err.step = err.step ?? "query";
          throw err;
        }
        facts.push(limitCheapest(broadRes, 5));
      }
    }
    // item 2: pergunta de DETALHE sobre o veículo SELECIONADO (pronome "ele/dele", sem modelo novo) -> consulta
    // vehicle_details do vehicleKey EXATO, aterrando a resposta de atributo (câmbio/cor/…) no fato do veículo certo.
    const selectedKey = fullCtx.state.vehicleContext.selected?.key;
    if (seededModels.length === 0 && selectedKey && fullCtx.interpretation.relation === "asks_vehicle_detail") {
      const detailCall: QueryCall = { tool: "vehicle_details", input: { vehicleKey: selectedKey } };
      if (PolicyEngine.authorizeQuery(detailCall, fullCtx, facts).outcome === "allow") {
        try {
          facts.push(await withTimeout(runQuery(detailCall), limits.queryTimeoutMs ?? 4000, "query: vehicle_details (selected) exceeded timeout"));
        } catch (err: any) { err.step = err.step ?? "query"; throw err; }
      }
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
    // 1B.7: condução por GUIDANCE (o conductor injeta slots conhecidos/próximo/deferimento) ANTES do compose —
    // o LLM redige seguindo o prompt do portal + esse guidance, em vez do conductor reescrever a pergunta.
    if (args.conduct) decision = args.conduct(decision);

    // ── COMPOSE -> VALIDATE com LIMITE (Codex r3 #7) — extraído p/ composeAndVerify (reusado pelo 1B.7). ──
    const cv = await composeAndVerify({ decision, facts, ctx: fullCtx, llm, limits, maxValidationAttempts, adjustDraft: args.adjustDraft });
    return { decision: cv.decision, composed: cv.composed, facts, loopExhausted, terminalSafe: cv.terminalSafe, steps, conducted: !!args.conduct };
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

    // Todo TurnDecision, inclusive erro global/timeout, sai do Finalizer. P0 (F2.7.11): texto ao lead =
    // fallback de SDR contextual (NUNCA "Desculpe a lentidao..."); o reason_code error/timeout fica nos logs.
    const decision = emitErrorTerminalSafe(ctx.turnId, step, reason);
    const fallbackText = buildContextualSdrReply(ctx.state, { leadMessage: ctx.leadMessage });
    const composed = {
      draft: { parts: [{ type: "text" as const, content: fallbackText }] },
      text: fallbackText
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

// 1B.7 (Codex): loop de COMPOSE -> VALIDATE reutilizável. O LLM real compõe a fala (seguindo o prompt do
// portal + responsePlan.guidance) sobre os FATOS já decididos pelo handler/engine; a policy é a autoridade
// final; fallback determinístico SOMENTE em falha técnica/schema (validação repetida) -> terminal-safe.
export async function composeAndVerify(args: {
  readonly decision: TurnDecision;
  readonly facts: QueryResult[];
  readonly ctx: TurnContext;
  readonly llm: DecisionLlm;
  readonly limits: QueryLoopLimits;
  readonly maxValidationAttempts: number;
  // 1B.7: fallback determinístico do HANDLER (ex.: a lista da oferta já renderizada). Usado SOMENTE em falha
  // técnica/schema/policy repetida. Sem ele, cai no fallback SDR contextual genérico.
  readonly fallbackText?: string;
  // P1 (Codex): ajuste determinístico do DRAFT (apresentação/anti-fixação) aplicado ANTES de renderizar+validar
  // — nada é reescrito DEPOIS da policy; o texto validado já é o final.
  readonly adjustDraft?: (draft: ResponseDraft) => ResponseDraft;
}): Promise<{ decision: TurnDecision; composed: RenderedResponse; terminalSafe: boolean }> {
  const { facts, ctx, llm, limits, maxValidationAttempts } = args;
  let decision = args.decision;
  let composed: RenderedResponse = { draft: { parts: [] }, text: "" };
  let ok = false, lastDenyDetail = "";
  for (let attempt = 1; attempt <= maxValidationAttempts; attempt++) {
    const composeDecision = attempt > 1 && lastDenyDetail ? withRetryGuidance(decision, lastDenyDetail) : decision;
    let gv;
    try {
      const rawDraft = await withTimeout(llm.compose(composeDecision, facts, ctx), limits.composeTimeoutMs ?? 5000, "compose: LLM compose exceeded timeout");
      // P1 (Codex): as travas determinísticas ajustam o DRAFT (parts) ANTES de renderizar+validar. Assim o
      // texto validado JÁ É o final (nada é substituído depois da policy) e as parts estruturadas são preservadas.
      const draft = args.adjustDraft ? args.adjustDraft(rawDraft) : rawDraft;
      composed = { draft, text: ResponseRenderer.render(draft, facts, ctx.state) };
      gv = PolicyEngine.validateResponse(composed, facts, decision, ctx);
    } catch (err: any) {
      // P0-1 (Codex): QUALQUER falha técnica do compose (throw/timeout/schema inválido/erro de render) — DEPOIS
      // dos fatos já obtidos — NÃO pode propagar (viraria commit_failed). Trata como deny -> re-tenta; se
      // esgotar, cai no fallback determinístico (terminal-safe + fallbackText do handler). Nunca há silêncio.
      gv = [{ policyId: "POL-COMPOSE-FAIL", outcome: "deny" as const, violations: [`compose falhou: ${String(err?.message ?? err).slice(0, 160)}`] }];
    }
    if (!hasDeny(gv)) { ok = true; break; }
    lastDenyDetail = JSON.stringify(gv.filter((v) => v.outcome === "deny")).slice(0, 220);
  }
  if (!ok) {
    decision = emitTerminalSafe(ctx.turnId, decision, `Validação de resposta falhou repetidamente: ${lastDenyDetail || "motivo nao capturado"}`.slice(0, 260));
    const fallbackText = (args.fallbackText && args.fallbackText.trim().length > 0)
      ? args.fallbackText
      : buildContextualSdrReply(ctx.state, { leadMessage: ctx.leadMessage });
    composed = { draft: { parts: [{ type: "text", content: fallbackText }] }, text: fallbackText };
    return { decision, composed, terminalSafe: true };
  }
  return { decision, composed, terminalSafe: false };
}
