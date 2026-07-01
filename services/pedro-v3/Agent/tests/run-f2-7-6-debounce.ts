// ============================================================================
// F2.7.6 â€” Debounce/burst do lead. Testes offline ($0, sem rede, FakeClock).
//   npx tsx tests/run-f2-7-6-debounce.ts
//
// Prova: rajada vira UM turno; ordem preservada; mensagem depois da janela = novo
// turno; max-wait processa mesmo com mensagens continuas; duplicado de webhook nao
// gera 2o turno; nao reprocessa evento done; poller orquestra find+process.
// ============================================================================
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ingestPilotMessage } from "../src/engine/pilot-ingest.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { isConversationSettled, resolveDebounceConfig } from "../src/engine/debounce-policy.ts";
import { DebouncePoller } from "../src/runtime/debounce-poller.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { DecisionStep, QueryResult, ResponseDraft, TenantCatalog } from "../src/domain/decision.ts";
import type { Clock, SettledConversation } from "../src/domain/ports.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const TENANT = "tenant-deb";
const AGENT = "aloan";
const TO = "5511999990000";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} â€” ${detail}`); console.log(`  RED ${name}${detail ? ` â€” ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [{ vehicleKey: "chevrolet|onix|2021", marca: "Chevrolet", modelo: "Onix", ano: 2021, preco: 72990, km: 30000, tipo: "hatch" }];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);
const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") return { ok: true as const, tool: "stock_search" as const, data: { items: STOCK, filtersUsed: {} }, source: "fake" };
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };

// LLM que GRAVA o leadMessage que o engine montou (p/ provar agregacao + ordem).
class RecordingLlm implements DecisionLlm {
  readonly captured: string[] = [];
  async proposeNextQueryOrFinal(ctx: TurnContext, _facts: QueryResult[]): Promise<DecisionStep> {
    this.captured.push(ctx.leadMessage);
    return { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "ok" }, reasonCode: "r", reasonSummary: "", confidence: 0.8 } };
  }
  async compose(_d: unknown, _f: QueryResult[], _c: TurnContext): Promise<ResponseDraft> { return { parts: [{ type: "text", content: "ok" }] }; }
}

async function ingestNow(p: InMemoryPersistence, clock: FakeClock, eventId: string, conversationId: string, text: string) {
  return ingestPilotMessage(p, clock, { eventId, conversationId, agentId: AGENT, leadId: null, toAddr: TO, messageText: text, receivedAt: clock.now() });
}
async function processBlock(p: InMemoryPersistence, clock: FakeClock, conversationId: string, turnId: string) {
  const llm = new RecordingLlm();
  const result = await runConversationTurn({
    persistence: p, clock, llm, runQuery,
    conversationId, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "poll-worker", turnId, leaseTtlMs: 60_000,
    interpretation: { relation: "answers_pending" }, tenantCatalog: catalog, claimExtractor: extractor,
    limits, maxValidationAttempts: 2, providerCapability: { send_message: "none" },
  });
  return { leadMessage: llm.captured[0] ?? "", result };
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.6 Debounce/burst ===\n");

  // â”€â”€ Politica pura â”€â”€
  {
    check("policy: quieto >= debounce -> settled", isConversationSettled({ nowMs: 10_000, oldestPendingMs: 0, newestPendingMs: 4_000, debounceMs: 6000, maxWaitMs: 12000 }) === true);
    check("policy: barulhento < debounce -> nao settled", isConversationSettled({ nowMs: 10_000, oldestPendingMs: 6_000, newestPendingMs: 6_000, debounceMs: 6000, maxWaitMs: 12000 }) === false);
    check("policy: starvation (oldest >= max) -> settled mesmo barulhento", isConversationSettled({ nowMs: 13_000, oldestPendingMs: 1_000, newestPendingMs: 12_500, debounceMs: 6000, maxWaitMs: 12000 }) === true);
    const cfg = resolveDebounceConfig({});
    check("config defaults 6000/12000/2000", cfg.debounceMs === 6000 && cfg.maxWaitMs === 12000 && cfg.pollIntervalMs === 2000);
    const cfg2 = resolveDebounceConfig({ PEDRO_V3_DEBOUNCE_MS: "8000", PEDRO_V3_DEBOUNCE_MAX_MS: "3000" });
    check("config maxWait nunca menor que debounce", cfg2.debounceMs === 8000 && cfg2.maxWaitMs === 8000);
  }

  // â”€â”€ 2 mensagens com intervalo < debounce viram UM turno; ordem preservada â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T00:00:00.000Z");
    await ingestNow(p, clock, "e1", "cA", "ConheÃ§o sim");
    clock.advance(1000);
    await ingestNow(p, clock, "e2", "cA", "quero ver opcoes");
    // ainda dentro da janela -> nao assentou
    clock.advance(1000); // now = T+2s
    check("rajada < debounce: NAO assenta ainda", p.findSettledConversations(clock.now(), 6000, 12000, 20).length === 0);
    // passa a janela
    clock.advance(6000); // now = T+8s, newest = T+1s -> 7s >= 6s
    const settled = p.findSettledConversations(clock.now(), 6000, 12000, 20);
    check("rajada quieta >= debounce: assenta com pendingCount=2", settled.length === 1 && settled[0].pendingCount === 2 && settled[0].toAddr === TO && settled[0].agentId === AGENT, JSON.stringify(settled));
    const { leadMessage, result } = await processBlock(p, clock, "cA", "t-cA");
    check("rajada vira UM turno (committed)", result.status === "committed", result.status);
    check("bloco preserva ordem e conteudo das 2 mensagens", leadMessage === "ConheÃ§o sim\nquero ver opcoes", JSON.stringify(leadMessage));
    check("apos processar, nada pendente (nao reprocessa)", p.findSettledConversations(clock.now(), 6000, 12000, 20).length === 0);
  }

  // â”€â”€ 3 mensagens rapidas preservam ordem â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T01:00:00.000Z");
    await ingestNow(p, clock, "f1", "cB", "Bom dia"); clock.advance(500);
    await ingestNow(p, clock, "f2", "cB", "ConheÃ§o sim"); clock.advance(500);
    await ingestNow(p, clock, "f3", "cB", "quero ver opcoes");
    clock.advance(6000);
    const { leadMessage } = await processBlock(p, clock, "cB", "t-cB");
    check("3 mensagens: ordem preservada no bloco", leadMessage === "Bom dia\nConheÃ§o sim\nquero ver opcoes", JSON.stringify(leadMessage));
  }

  // â”€â”€ 'ConheÃ§o sim' + 'quero ver opcoes' (sem modelo -> caminho LLM) geram UMA decisao que ve ambos â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T02:00:00.000Z");
    await ingestNow(p, clock, "g1", "cC", "ConheÃ§o sim"); clock.advance(2000);
    await ingestNow(p, clock, "g2", "cC", "quero ver opcoes");
    clock.advance(6000);
    const llm = new RecordingLlm();
    const result = await runConversationTurn({
      persistence: p, clock, llm, runQuery, conversationId: "cC", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "t-cC", leaseTtlMs: 60_000, interpretation: { relation: "answers_pending" },
      tenantCatalog: catalog, claimExtractor: extractor, limits, maxValidationAttempts: 2, providerCapability: { send_message: "none" },
    });
    check("UMA unica decisao para a rajada", llm.captured.length === 1 && result.status === "committed");
    check("a decisao considerou AMBOS (2a msg presente no bloco)", llm.captured[0].toLowerCase().includes("conhe") && llm.captured[0].toLowerCase().includes("opcoes"), llm.captured[0]);
  }


  // -- Caso real: "Conheco sim" + "quero um onix" tambem precisa ser UM turno.
  // O explicit-search pode bypassar o LLM, entao a prova aqui e no estado/decisao, nao no RecordingLlm.
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T02:30:00.000Z");
    await ingestNow(p, clock, "gr1", "cREAL", "Conheco sim"); clock.advance(2000);
    await ingestNow(p, clock, "gr2", "cREAL", "quero um onix");
    clock.advance(6000);
    const llm = new RecordingLlm();
    const result = await runConversationTurn({
      persistence: p, clock, llm, runQuery, conversationId: "cREAL", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "t-cREAL", leaseTtlMs: 60_000, interpretation: { relation: "answers_pending" },
      tenantCatalog: catalog, claimExtractor: extractor, limits, maxValidationAttempts: 2, providerCapability: { send_message: "none" },
    });
    const snap = p.load("cREAL");
    const lastLead = snap?.state.recentTurns.filter((t) => t.role === "lead").at(-1)?.text ?? "";
    check("rajada real Onix: UMA decisao committed", result.status === "committed" && result.decision.reasonCode === "explicit_offer", result.status === "committed" ? result.decision.reasonCode : result.status);
    check("rajada real Onix: bloco preservado no estado", lastLead === "Conheco sim\nquero um onix", JSON.stringify(lastLead));
    check("rajada real Onix: pedido atual venceu sem depender do LLM", llm.captured.length === 0);
  }
  // â”€â”€ Mensagem DEPOIS da janela vira novo turno â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T03:00:00.000Z");
    await ingestNow(p, clock, "h1", "cD", "primeira");
    clock.advance(8000);
    const r1 = await processBlock(p, clock, "cD", "t-cD-1");
    await ingestNow(p, clock, "h2", "cD", "segunda"); // depois da janela
    clock.advance(8000);
    const r2 = await processBlock(p, clock, "cD", "t-cD-2");
    check("mensagem depois da janela = 2o turno separado", r1.leadMessage === "primeira" && r2.leadMessage === "segunda", JSON.stringify([r1.leadMessage, r2.leadMessage]));
  }

  // â”€â”€ Max-wait: processa mesmo com o lead mandando mensagem continuamente â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T04:00:00.000Z");
    await ingestNow(p, clock, "i1", "cE", "m1");        // T+0
    clock.advance(5000); await ingestNow(p, clock, "i2", "cE", "m2"); // T+5
    clock.advance(5000); await ingestNow(p, clock, "i3", "cE", "m3"); // T+10
    check("max-wait: ainda nao assentou em T+10 (quieto 0, oldest 10s)", p.findSettledConversations(clock.now(), 6000, 12000, 20).length === 0);
    clock.advance(2000); await ingestNow(p, clock, "i4", "cE", "m4"); // T+12 (lead continua digitando)
    const settled = p.findSettledConversations(clock.now(), 6000, 12000, 20);
    check("max-wait: assenta em T+12 por starvation (mesmo barulhento)", settled.length === 1 && settled[0].pendingCount === 4, JSON.stringify(settled));
  }

  // â”€â”€ Duplicado de webhook NAO gera 2o turno; e nao reprocessa done â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T05:00:00.000Z");
    const r1 = await ingestNow(p, clock, "j1", "cF", "oi");
    const r2 = await ingestNow(p, clock, "j1", "cF", "oi"); // retry do webhook, mesmo eventId, ainda pending
    check("duplicado pending: idempotente (proceed, sem 2o insert)", r1.decision === "proceed" && r2.decision === "proceed" && p.findSettledConversations(clock.now(), 0, 0, 20)[0]?.pendingCount === 1, JSON.stringify(r2));
    clock.advance(8000);
    const proc = await processBlock(p, clock, "cF", "t-cF");
    check("processou o turno (1 mensagem)", proc.result.status === "committed" && proc.leadMessage === "oi");
    const r3 = await ingestNow(p, clock, "j1", "cF", "oi"); // retry APOS done
    check("duplicado apos done: 'duplicate' (nao reprocessa)", r3.decision === "duplicate");
    check("nada pendente apos done", p.findSettledConversations(clock.now(), 0, 0, 20).length === 0);
  }

  // â”€â”€ Roteamento exigido: sem upsert, findSettled ignora a conversa â”€â”€
  {
    const p = new InMemoryPersistence(new FakeClock(), new FakeIdGen());
    const clock = new FakeClock("2026-06-30T06:00:00.000Z");
    // tryInsert direto (sem ingest/roteamento)
    p.tryInsert({ eventId: "k1", conversationId: "cG", raw: { __redacted: true } as any, receivedAt: clock.now() });
    clock.advance(8000);
    check("sem roteamento: findSettled NAO retorna (nao da p/ despachar)", p.findSettledConversations(clock.now(), 6000, 12000, 20).length === 0);
  }

  // â”€â”€ Poller: orquestra find + process, isola falhas â”€â”€
  {
    const fakeClock: Clock = { now: () => "2026-06-30T07:00:00.000Z" };
    const s = (id: string): SettledConversation => ({ conversationId: id, agentId: AGENT, leadId: null, toAddr: TO, pendingCount: 1 });
    const processed: string[] = [];
    const poller = new DebouncePoller(async () => [s("a"), s("b")], async (c) => { processed.push(c.conversationId); }, fakeClock);
    const r = await poller.runOnce();
    check("poller: processa todas as assentadas", r.found === 2 && r.processed === 2 && processed.join(",") === "a,b", JSON.stringify(r));

    const processed2: string[] = [];
    const poller2 = new DebouncePoller(async () => [s("a"), s("b")], async (c) => { if (c.conversationId === "a") throw new Error("boom"); processed2.push(c.conversationId); }, fakeClock);
    const r2 = await poller2.runOnce();
    check("poller: falha de uma conversa nao derruba as outras", r2.found === 2 && r2.processed === 1 && r2.failed === 1 && processed2.join(",") === "b", JSON.stringify(r2));

    const poller3 = new DebouncePoller(async () => { throw new Error("db down"); }, async () => { /* */ }, fakeClock);
    const r3 = await poller3.runOnce();
    check("poller: finder que lanÃ§a nao crasha o tick", r3.found === 0 && r3.processed === 0, JSON.stringify(r3));
  }

  console.log(`\n=== F2.7.6: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
