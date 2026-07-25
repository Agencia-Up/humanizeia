// ============================================================================
// F2.81 — DUP_TOOL: REUSO ESTRITO do resultado já executado (missão P0, prioridade 4).
//
// INCIDENTE (Mônaco / AD-2, 18/07): a LLM chamou vehicle_details com uma chave FABRICADA -> NOT_FOUND. Ela repetiu
// a MESMA chamada e recebeu `DUP_TOOL: "use o fato que a ferramenta retornou"` — mas NÃO HAVIA fato. Mensagem
// inacionável: repetiu 3x, colecionou denies, queimou os passos e o lead recebeu uma deflexão
// ("Vou confirmar os detalhes desse veículo com o consultor").
//
// CONTRATO: repetir a MESMA chamada é idempotente. O engine devolve o RESULTADO já obtido — sucesso OU erro —
// sem reexecutar o adapter e sem deny. Erro real (NOT_FOUND) é acionável; deny genérico não é. Teto anti-loop
// preservado: o resultado é reentregue uma vez por tool; na insistência o loop sai para a autoria.
//   npx tsx tests/run-f2-81-dup-tool-reuse.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain, type BrainResponder } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnUnderstanding, PrimaryIntent, AgentToolObservation } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const has = (s: string, n: string): boolean => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());

const TENANT = "9420eb5d", AGENT = "5deb3b9a", NOW = "2026-07-25T12:00:00.000Z", SHA = "sha-81";
const KEY = "revendamais:8251676";
const CAR: VehicleFact = { vehicleKey: KEY, marca: "Jeep", modelo: "Compass", ano: 2021, preco: 121400, km: 74652, cambio: "Automatico", cor: "Prata", tipo: "suv" };
const catalog = buildTenantCatalog([CAR]);
const extractor = new CatalogClaimExtractor(catalog);

let detailExecutions = 0, stockExecutions = 0, detailFails = false;
const runQuery = async (call: QueryCall): Promise<QueryResult> => {
  if (call.tool === "stock_search") { stockExecutions++; return { ok: true, tool: "stock_search", source: "f", data: { items: [CAR], filtersUsed: {}, matchKind: "exact" } } as QueryResult; }
  if (call.tool === "vehicle_details") {
    detailExecutions++;
    // Veículo que SUMIU do feed entre a oferta e o detalhe: a chave é aterrada (veio de tool), mas o detalhe falha.
    if (detailFails || call.input.vehicleKey !== KEY) return { ok: false, tool: "vehicle_details", error: { code: "NOT_FOUND", message: "veiculo nao encontrado", retryable: false } } as QueryResult;
    return { ok: true, tool: "vehicle_details", source: "f", data: { vehicle: CAR } } as QueryResult;
  }
  if (call.tool === "vehicle_photos_resolve") return { ok: true, tool: "vehicle_photos_resolve", source: "f", data: { vehicleKey: KEY, ambiguous: false, photoIds: ["p1"], media: [{ id: "p1", url: "https://x/p1.jpg" }] } } as QueryResult;
  throw new Error("tool " + call.tool);
};
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "x" }] }; } }
class RelPreparer implements TurnContextPreparer { async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> { return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor }; } }

const U = (primaryIntent: PrimaryIntent, o: Partial<TurnUnderstanding> = {}): TurnUnderstanding => ({ primaryIntent, requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [], ...o });
const txt = (content: string): ResponsePart => ({ type: "text", content });
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
function finU(parts: ResponsePart[], u: TurnUnderstanding, effects: ProposedEffectPlan[] = [reply]): AgentBrainStep {
  return { kind: "final", understanding: u, decision: { reasonCode: "reply", reasonSummary: "r", confidence: 0.9, responsePlan: { guidance: "g", draft: { parts } }, proposedEffects: effects, memoryMutations: [], stateMutations: [] } as AgentBrainDecision };
}
const qU = (input: Record<string, unknown>, tool: QueryCall["tool"], u: TurnUnderstanding): AgentBrainStep => ({ kind: "query", call: { tool, input } as never, understanding: u } as AgentBrainStep);

type Cap = { outbox: string; committed: boolean; src: string | null; degraded: boolean; obs: AgentToolObservation[][] };
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function runTurn(lead: string, responder: BrainResponder, tag: string): Promise<Cap> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const brain = new ScriptedAgentBrain(); brain.setResponder(responder);
  const convId = `wa:f281:${Math.abs(hash(lead + tag))}`;
  const seed = persistence.begin();
  const { createInitialState } = await import("../src/domain/conversation-state.ts");
  const base = createInitialState({ conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  seed.casState(convId, 0, { ...base, vehicleContext: { focus: null, selected: { kind: "vehicle", key: KEY, label: "Jeep Compass 2021" } },
    lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: [{ ordinal: 1, vehicleKey: KEY, marca: "Jeep", modelo: "Compass", ano: 2021, preco: 121400, cor: "Prata", cambio: "Automatico", tipo: "suv" }] } } as never);
  seed.commit();
  await persistence.tryInsert({ eventId: `${convId}-e1`, conversationId: convId, raw: redact({ text: lead }), receivedAt: clock.now() });
  clock.advance(1000);
  const turnId = `${convId}-t1`;
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery,
    businessInfo: { async get() { return { ok: false as const, error: { code: "NOT_CONFIGURED" as const, message: "n/a" } }; } } as never,
    contextPreparer: new RelPreparer(), conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: "lead-1",
    workerId: "w", turnId, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 8, totalTimeoutMs: 9000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 3, brainMaxSteps: 8, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true, crmWriteEnabled: true,
  } as never);
  const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string } }[];
  return {
    outbox: outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "",
    committed: r.status === "committed", src: r.status === "committed" ? r.responseSource : r.status,
    degraded: r.status === "committed" ? r.degraded : false,
    obs: brain.seenObservations.map((o) => [...o]),
  };
}
// Observações que o cérebro VIU no último passo (o loop acumula: basta olhar o maior array).
const lastObs = (c: Cap): AgentToolObservation[] => c.obs[c.obs.length - 1] ?? [];
const dupDenies = (c: Cap): string[] => lastObs(c).filter((o) => !o.ok && o.tool === "response").map((o) => (o.ok === false ? `${o.error.code}:${o.error.message}` : "")).filter((m) => has(m, "DUP"));

async function main(): Promise<void> {
  console.log("== F2.81: DUP_TOOL reusa o resultado ja executado ==");

  // ── 1) O INCIDENTE MÔNACO: a 1ª chamada FALHA e a LLM repete a MESMA chamada ──────────────────
  // A chave usada aqui é ATERRADA de propósito: a invariante AD-2 já impede uma chave FABRICADA de chegar ao
  // adapter. O que este caso cobre é o que acontece DEPOIS de uma execução que falhou de verdade (veículo que
  // sumiu do feed entre a oferta e o detalhe) — a repetição não pode virar um DUP_TOOL inacionável.
  detailExecutions = 0; detailFails = true;
  // A evidência é sempre um trecho LITERAL do bloco atual (proveniência temporal) — por isso varia por cenário.
  const det = (quote: string): TurnUnderstanding => U("vehicle_detail", { requestedCapabilities: ["vehicle_details"], subject: "selected_vehicle", subjectValue: "Compass", subjectSource: "memory", evidence: [{ capability: "vehicle_details", quote }] });
  const detU = det("desse carro");
  const repeteChaveErrada: BrainResponder = (_f, _o, step) => step < 2
    ? qU({ vehicleKey: KEY }, "vehicle_details", detU)
    : finU([txt("Não consegui puxar a ficha completa dele aqui agora. Prefere que eu te mostre as fotos dele?")], detU);
  const m = await runTurn("Me fala mais desse carro", repeteChaveErrada, "mon");
  detailFails = false;
  check("[R1] ⭐chamada REPETIDA nao reexecuta o adapter (1 execucao para 2 propostas)", detailExecutions === 1, `execucoes=${detailExecutions}`);
  check("[R2] ⭐o cerebro segue com o RESULTADO real (NOT_FOUND) em maos, e ele aparece UMA vez so",
    lastObs(m).filter((o) => o.tool === "vehicle_details" && !o.ok && (o.ok === false ? has(o.error.code, "NOT_FOUND") : false)).length === 1,
    JSON.stringify(lastObs(m).map((o) => `${o.tool}:${o.ok ? "ok" : (o.ok === false ? o.error.code : "")}`)));
  // ⭐O CERNE DO INCIDENTE: a mensagem da repetição NÃO pode afirmar um fato que não existe. Ela é derivada do
  // resultado REAL — aqui, o NOT_FOUND — e diz o que fazer. Nunca "use o fato que a ferramenta retornou".
  check("[R3] ⭐a mensagem da repeticao NOMEIA a falha real e nao inventa fato",
    dupDenies(m).length === 1 && has(dupDenies(m)[0], "NOT_FOUND") && !has(dupDenies(m)[0], "use o fato que a ferramenta retornou"),
    JSON.stringify(dupDenies(m)));
  check("[R3a] e orienta a MUDAR o alvo (repetir igual nao muda nada)", has(dupDenies(m)[0] ?? "", "Repetir igual nao muda nada".replace("nao", "não")) || has(dupDenies(m)[0] ?? "", "alvo/filtro DIFERENTE"), JSON.stringify(dupDenies(m)));
  check("[R4] o turno CONCLUI pela LLM (nao morre em deflexao/fallback)", m.committed && !m.degraded, `src=${m.src} deg=${m.degraded}`);

  // ── 2) REPETICAO DE CHAMADA BEM-SUCEDIDA: devolve o mesmo fato, sem reexecutar, sem deny ──────
  detailExecutions = 0;
  const cambioU = det("câmbio");
  const repeteChaveCerta: BrainResponder = (_f, _o, step) => step < 2
    ? qU({ vehicleKey: KEY }, "vehicle_details", cambioU)
    : finU([txt("É o Compass 2021, automático, 74.652 km. Quer ver as fotos?")], cambioU);
  const s = await runTurn("E o câmbio dele?", repeteChaveCerta, "sucesso");
  check("[R5] chamada identica bem-sucedida executa UMA vez", detailExecutions === 1, `execucoes=${detailExecutions}`);
  // ⭐A repetição NÃO reempurra o fato: ele já está na lista acumulada do turno. Reempurrar não informaria nada e
  // inflaria a contagem de tools (sinal de retry-storm). O contrato é: o fato continua disponível, UMA vez, sem deny.
  check("[R6] ⭐o FATO continua disponivel ao cerebro e aparece UMA vez so (repeticao nao infla a contagem)",
    lastObs(s).filter((o) => o.tool === "vehicle_details" && o.ok).length === 1, JSON.stringify(lastObs(s).map((o) => `${o.tool}:${o.ok}`)));
  check("[R7] a mensagem da repeticao aponta o resultado que EXISTE (e nao um erro inventado)",
    dupDenies(s).length === 1 && has(dupDenies(s)[0], "resultado esta nas suas observacoes".replace("esta", "está").replace("observacoes", "observações")),
    JSON.stringify(dupDenies(s)));
  check("[R8] turno conclui pela LLM", s.committed && !s.degraded, `src=${s.src}`);

  // ── 3) BUSCA REPETIDA: nao reexecuta e a exigencia de busca do turno segue satisfeita ─────────
  stockExecutions = 0;
  const buscaU = U("search_stock", { requestedCapabilities: ["stock_search"], subject: "vehicle_type", subjectValue: "suv", subjectSource: "current_turn", evidence: [{ capability: "stock_search", quote: "SUV" }] });
  const repeteBusca: BrainResponder = (_f, _o, step) => step < 2
    ? qU({ tipo: "suv" }, "stock_search", buscaU)
    : finU([txt("Achei essa opção pra você:"), { type: "vehicle_offer_list", vehicleKeys: [KEY] } as ResponsePart], buscaU);
  const b = await runTurn("Tem SUV?", repeteBusca, "busca");
  check("[R9] ⭐stock_search identico executa UMA vez", stockExecutions === 1, `execucoes=${stockExecutions}`);
  check("[R9a] ⭐e a busca aparece UMA vez nas observacoes (nao infla o sinal de retry-storm)",
    lastObs(b).filter((o) => o.tool === "stock_search").length === 1, JSON.stringify(lastObs(b).map((o) => `${o.tool}:${o.ok}`)));
  check("[R10] a lista sai para o lead (a exigencia de busca NAO ficou pendente)", b.committed && has(b.outbox, "Compass"), `${b.src} | ${b.outbox.slice(0, 80)}`);

  // ── 4) TETO ANTI-LOOP: cerebro que so repete nao queima o turno ──────────────────────────────
  detailExecutions = 0;
  const soRepete: BrainResponder = () => qU({ vehicleKey: KEY }, "vehicle_details", det("Detalhes"));
  const loop = await runTurn("Detalhes desse carro?", soRepete, "loop");
  check("[R11] ⭐cerebro que SO repete: adapter chamado 1x e turno termina (nao entra em livelock)", detailExecutions === 1, `execucoes=${detailExecutions}`);
  check("[R12] saida observavel (degradada), nunca silencio", loop.outbox.length > 0, loop.outbox.slice(0, 80));

  console.log(`\n== F2.81: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
