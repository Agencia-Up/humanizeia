// ============================================================================
// F2.7.7 â€” Captura segura de slots + objetivos. Testes offline ($0, sem rede).
//   npx tsx tests/run-f2-7-7-slots.ts
//
// Extrator PURO (lead-extraction) + integraÃ§Ã£o no engine (preview -> o modelo jÃ¡ vÃª
// o nome capturado e NÃƒO repergunta no mesmo turno) + multi-modelo no pre-seed.
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, PendingObjective } from "../src/domain/conversation-state.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { deriveModelContext } from "../src/engine/model-context-view.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { DecisionMutation, DecisionStep, QueryResult, ResponseDraft, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T15:00:00.000Z";
const TENANT = "icom"; const AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} â€” ${detail}`); console.log(`  RED ${name}${detail ? ` â€” ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132623, tipo: "hatch" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 80000, tipo: "suv" },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "lead1", now: NOW }),
  ...over,
});
function nameObjective(): PendingObjective {
  return { id: "obj-nome", type: "perguntou_dados", slot: "nome", askedAt: NOW, askedInTurnId: "t0", deliveredByEffectId: "t0:m", deliveryLevel: "delivered", expectedAnswerKinds: ["nome"], status: "pending", attempts: 0 };
}
function withNameObjective(over: Partial<ConversationState> = {}): ConversationState {
  return baseState({ currentObjective: nameObjective(), ...over });
}
const slot = (muts: DecisionMutation[], name: string) => muts.find((m) => m.op === "set_slot" && m.slot === name) as any;
const TI = (over: Partial<TurnInterpretation["extractedEntities"]> = {}, relation: TurnInterpretation["relation"] = "answers_pending"): TurnInterpretation =>
  ({ relation, extractedEntities: over });

class RecordingLlm implements DecisionLlm {
  capturedNomeStatus: string | null = null;
  async proposeNextQueryOrFinal(ctx: TurnContext): Promise<DecisionStep> {
    this.capturedNomeStatus = ctx.state.slots.nome.status;
    return { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "ok" }, reasonCode: "r", reasonSummary: "", confidence: 0.8 } };
  }
  async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "ok" }] }; }
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.7 Slots + objetivos ===\n");

  // 1) "dOUGLAS" com objetivo de nome pendente -> nome = "Douglas" + resolve_objective
  {
    const muts = extractLeadSlots({ leadMessage: "dOUGLAS", state: withNameObjective(), interpretation: TI(), claimExtractor: extractor, turnId: "t1" });
    check("1 'dOUGLAS' + obj nome -> set_slot nome 'Douglas'", slot(muts, "nome")?.value === "Douglas", JSON.stringify(muts));
    check("1 resolve_objective satisfied do objetivo de nome", muts.some((m) => m.op === "resolve_objective" && m.objectiveId === "obj-nome" && m.status === "satisfied"));
  }

  // 1b) caso REAL de prod: "dOUGLAS" SEM objetivo (o LLM nao cria planned), mas o AGENTE acabou de
  //     perguntar o nome (ultima fala dele) -> captura "Douglas". Sem objetivo -> sem resolve.
  {
    const st = baseState({ recentTurns: [
      { role: "lead", text: "Bom dia", at: NOW },
      { role: "agent", text: "Que bom que conhece a loja! Qual Ã© o seu nome, por favor?", at: NOW },
    ] });
    const muts = extractLeadSlots({ leadMessage: "dOUGLAS", state: st, interpretation: TI(), claimExtractor: extractor, turnId: "t1b" });
    check("1b 'dOUGLAS' sem objetivo, agente perguntou nome -> 'Douglas'", slot(muts, "nome")?.value === "Douglas", JSON.stringify(muts));
    check("1b sem objetivo pendente -> nao emite resolve_objective", !muts.some((m) => m.op === "resolve_objective"));
  }

  // 1c) "Douglas" pelado SEM pergunta de nome -> captura OPORTUNÍSTICA (audit Codex smoke real T8: o lead SE APRESENTA
  //     espontaneamente; "Douglas" não é preço/tipo/comando -> é o nome). Guardas: 1-2 tokens, isNameToken, sem outro
  //     answer-kind, e não em pergunta de cidade. Antes o comportamento era "não captura" (invertido pelo requisito novo).
  {
    const st = baseState({ recentTurns: [{ role: "agent", text: "Temos varios SUVs. Qual faixa de preco?", at: NOW }] });
    const muts = extractLeadSlots({ leadMessage: "Douglas", state: st, interpretation: TI(), claimExtractor: extractor, turnId: "t1c" });
    check("1c 'Douglas' pelado sem pergunta de nome -> captura OPORTUNÍSTICA (auto-apresentação)", slot(muts, "nome")?.value === "Douglas", JSON.stringify(muts));
  }
  // 1c-neg) resposta pelada a pergunta de CIDADE NÃO vira nome (a extração de cidade cuida do valor).
  {
    const st = baseState({ recentTurns: [{ role: "agent", text: "De qual cidade você é?", at: NOW }] });
    const muts = extractLeadSlots({ leadMessage: "Taubaté", state: st, interpretation: TI(), claimExtractor: extractor, turnId: "t1cn" });
    check("1c-neg 'Taubaté' em pergunta de cidade -> NÃO captura nome", !slot(muts, "nome"), JSON.stringify(muts));
  }

  // 2) "Meu nome e douglas" (sem objetivo) -> nome "Douglas" (padrao explicito)
  {
    const muts = extractLeadSlots({ leadMessage: "Meu nome e douglas", state: baseState(), interpretation: TI(), claimExtractor: extractor, turnId: "t2" });
    check("2 'Meu nome e douglas' -> set_slot nome 'Douglas'", slot(muts, "nome")?.value === "Douglas", JSON.stringify(muts));
  }

  // 3) "ConheÃ§o sim" NAO vira nome (mesmo com objetivo de nome pendente)
  {
    const muts = extractLeadSlots({ leadMessage: "ConheÃ§o sim", state: withNameObjective(), interpretation: TI(), claimExtractor: extractor, turnId: "t3" });
    check("3 'ConheÃ§o sim' NAO vira nome", !slot(muts, "nome"), JSON.stringify(muts));
  }

  // 4) "Quero um onix" NAO vira nome; vira interesse
  {
    const muts = extractLeadSlots({ leadMessage: "Quero um onix", state: withNameObjective(), interpretation: TI({ model: "onix" }), claimExtractor: extractor, turnId: "t4" });
    check("4 'Quero um onix' NAO vira nome", !slot(muts, "nome"), JSON.stringify(muts));
    check("4 'Quero um onix' -> interesse 'onix'", slot(muts, "interesse")?.value === "onix", JSON.stringify(muts));
  }

  // 5) bloco "dOUGLAS + Quero um onix + ou argo" com objetivo de nome + interpretacao multi-modelo
  {
    const block = "dOUGLAS\nQuero um onix\nou argo";
    const muts = extractLeadSlots({ leadMessage: block, state: withNameObjective(), interpretation: TI({ model: "onix", models: ["onix", "argo"] }), claimExtractor: extractor, turnId: "t5" });
    check("5 bloco -> salva nome 'Douglas'", slot(muts, "nome")?.value === "Douglas", JSON.stringify(muts));
    check("5 bloco -> resolve objetivo de nome", muts.some((m) => m.op === "resolve_objective" && m.status === "satisfied"));
    const interesse = slot(muts, "interesse")?.value ?? "";
    check("5 bloco -> interesse registra Onix E Argo (sem apagar)", /onix/.test(interesse) && /argo/.test(interesse), interesse);
  }

  // 6) objetivo de nome resolvido (coberto em 1/5); aqui: sem objetivo -> nao emite resolve
  {
    const muts = extractLeadSlots({ leadMessage: "Meu nome e Douglas", state: baseState(), interpretation: TI(), claimExtractor: extractor, turnId: "t6" });
    check("6 sem objetivo pendente -> nao emite resolve_objective", !muts.some((m) => m.op === "resolve_objective"));
  }

  // 7) slot ja conhecido -> NAO recaptura + aparece em conversationFacts (compose nao repergunta)
  {
    const known = baseState({ slots: { ...baseState().slots, nome: { status: "known", value: "Douglas", confidence: 0.9, sourceTurnId: "t0", updatedAt: NOW } } });
    const muts = extractLeadSlots({ leadMessage: "Douglas", state: known, interpretation: TI(), claimExtractor: extractor, turnId: "t7" });
    check("7 nome ja conhecido -> nao recaptura", !slot(muts, "nome"));
    const ctx = deriveModelContext(known, TI());
    check("7 nome conhecido aparece em conversationFacts", ctx.conversationFacts.some((f) => f.includes("Douglas")));
  }

  // 8) input ambiguo / sem sinal -> nao salva nome
  {
    const muts = extractLeadSlots({ leadMessage: "talvez depois", state: baseState(), interpretation: TI(), claimExtractor: extractor, turnId: "t8" });
    check("8 input ambiguo sem objetivo/padrao -> nao salva nome", !slot(muts, "nome"), JSON.stringify(muts));
  }

  // â”€â”€ IntegraÃ§Ã£o no engine: bloco real com nome explicito + 2 modelos â”€â”€
  // preview faz o modelo VER o nome (nao repergunta) + pre-seed consulta os modelos do bloco.
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    await p.tryInsert({ eventId: "b1", conversationId: "cB", raw: { __redacted: true, text: "Meu nome e Douglas\nquero onix ou argo" } as any, receivedAt: NOW });
    const queried: string[] = [];
    const runQuery: QueryRunner = async (call) => {
      if (call.tool === "stock_search") {
        if (call.input.modelo) queried.push(normalizeText(call.input.modelo));
        const items = STOCK.filter((v) => !call.input.modelo || normalizeText(v.modelo) === normalizeText(call.input.modelo));
        return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: {} }, source: "fake" };
      }
      return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
    };
    const llm = new RecordingLlm();
    await runConversationTurn({
      persistence: p, clock, llm, runQuery,
      conversationId: "cB", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "tB", leaseTtlMs: 60_000,
      interpretation: TI({ model: "onix", models: ["onix", "argo"] }, "direction_change"),
      tenantCatalog: catalog, claimExtractor: extractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2,
      providerCapability: { send_message: "none" },
    });
    const st = (await p.load("cB"))!.state;
    check("engine: nome salvo no estado ('Douglas')", st.slots.nome.status === "known" && st.slots.nome.value === "Douglas", JSON.stringify(st.slots.nome));
    check("engine: interesse salvo com onix e argo", st.slots.interesse.status === "known" && /onix/.test(st.slots.interesse.value ?? "") && /argo/.test(st.slots.interesse.value ?? ""), JSON.stringify(st.slots.interesse));
    check("engine: caminho deterministico de oferta nao depende do LLM", llm.capturedNomeStatus === null, String(llm.capturedNomeStatus));
    check("engine: pre-seed consultou AMBOS os modelos do bloco (onix+argo)", queried.includes("onix") && queried.includes("argo"), JSON.stringify(queried));
  }

  // Integração no engine: quando o turno segue para o LLM, o preview faz o modelo ver o nome.
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    await p.tryInsert({ eventId: "c1", conversationId: "cC", raw: { __redacted: true, text: "Meu nome e Douglas\nobrigado" } as any, receivedAt: NOW });
    const llm = new RecordingLlm();
    await runConversationTurn({
      persistence: p, clock, llm, runQuery: async (call) => ({ ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult),
      conversationId: "cC", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "tC", leaseTtlMs: 60_000,
      interpretation: TI({}, "answers_pending"), tenantCatalog: catalog, claimExtractor: extractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2,
      providerCapability: { send_message: "none" },
    });
    check("engine: PREVIEW fez o modelo ver o nome (nao reperguntaria)", llm.capturedNomeStatus === "known", String(llm.capturedNomeStatus));
  }
  console.log(`\n=== F2.7.7: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
