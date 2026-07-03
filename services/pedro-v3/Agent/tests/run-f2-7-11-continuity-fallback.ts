// ============================================================================
// F2.7.11 (P0) — fallback SDR contextual (nunca "Desculpe a lentidao") + guard de
// continuidade (saudacao/ack nao reinicia nem cai em terminal-safe). Offline ($0).
//   npx tsx tests/run-f2-7-11-continuity-fallback.ts
// ============================================================================
import { detectContinuityIntent, buildContinuityTurnOutput, buildContextualSdrReply } from "../src/engine/continuity-fallback.ts";
import { runTurn } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { runConversationTurn } from "../src/engine/conversation-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import type { DecisionStep, QueryResult, TenantCatalog } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T21:00:00.000Z";
const TENANT = "icom", AGENT = "aloan";
const FALLBACK = /desculpe a lentid/i;
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const STOCK: VehicleFact[] = [
  { vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, tipo: "hatch" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, tipo: "suv" },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

const base = (): ConversationState => createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "l1", now: NOW });
const withState = (over: Partial<ConversationState>): ConversationState => ({ ...base(), ...over });
const introduced = withState({ recentTurns: [{ role: "agent", text: "Olá! Sou o Aloan. Você já conhece a loja?", at: NOW }], turnNumber: 2 });
const afterOffer = withState({ recentTurns: [{ role: "agent", text: "Separei algumas: 1. Fiat Uno 2014 — R$ 29.990\n2. VW Gol 2015 — R$ 38.990", at: NOW }], turnNumber: 3 });
const withInteresse = withState({ recentTurns: [{ role: "agent", text: "Beleza!", at: NOW }], turnNumber: 4, slots: { ...base().slots, interesse: { value: "onix, renegade", status: "known", confidence: 0.9, updatedAt: NOW } } as any });

const cont = (leadMessage: string, state: ConversationState) => detectContinuityIntent({ leadMessage, state, claimExtractor: extractor });
const ctx = (leadMessage: string, state: ConversationState = base()): TurnContext =>
  ({ state, turnId: "t1", leadMessage, now: NOW, interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor });
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };
const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    return { ok: true as const, tool: "stock_search" as const, data: { items: STOCK.filter((v) => !modelo || normalizeText(v.modelo).includes(modelo)), filtersUsed: call.input as any }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const script = (): DecisionStep[] => [{ kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "reply", order: 0, onSuccess: [] }], responsePlan: { guidance: "ofertar" }, reasonCode: "x", reasonSummary: "x", confidence: 1 } }];
const fakeCompose: ComposeOverride = () => ({ parts: [{ type: "text", content: "Veja:" }, { type: "vehicle_offer_list", vehicleKeys: ["fake|key|9999"] }] });

// Roda um turno REAL pelo conversation-engine com estado SEMEADO (historico/oferta) -> prova o roteamento.
async function e2eRun(convId: string, seeded: ConversationState, leadText: string, llm: FakeLlm = new FakeLlm()) {
  const clock = new FakeClock(NOW);
  const p = new InMemoryPersistence(clock, new FakeIdGen());
  (p as any).states.set(convId, { state: seeded, version: 1 }); // seed do StateStore in-memory
  await p.tryInsert({ eventId: convId + "-e1", conversationId: convId, raw: { __redacted: true, text: leadText } as any, receivedAt: NOW });
  return runConversationTurn({
    persistence: p, clock, llm, runQuery,
    conversationId: convId, tenantId: TENANT, agentId: AGENT, leadId: null,
    workerId: "w", turnId: convId + "-t", leaseTtlMs: 60_000,
    interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor,
    limits, maxValidationAttempts: 2, providerCapability: { send_message: "none" } as any,
  });
}

async function main(): Promise<void> {
  console.log("\n=== F2.7.11 Fallback SDR contextual + continuidade ===\n");

  // 1) detectContinuityIntent: saudacao/ack/comentario curto em conversa JA iniciada -> true
  for (const m of ["Boa tarde", "ok", "certo", "entendi", "Bonito ele", "legal", "show", "perfeito"]) {
    check(`cont: "${m}" (introduzido) -> true`, cont(m, introduced) === true);
  }
  // intencao comercial / veiculo / pergunta -> NAO continuidade
  for (const m of ["tem onix?", "quanto custa?", "manda foto do onix", "quero os mais baratos", "me mostra um suv"]) {
    check(`cont: "${m}" -> false (intencao comercial)`, cont(m, introduced) === false);
  }
  // 1o contato (sem agente no historico) -> NAO continuidade (LLM faz saudacao inicial)
  check("cont: 'Boa tarde' no 1o contato -> false", cont("Boa tarde", base()) === false);
  // mensagem longa -> NAO continuidade
  check("cont: saudacao longa (>6 palavras) -> false", cont("boa tarde tudo bem com voce hoje meu amigo", introduced) === false);

  // 2) buildContextualSdrReply: NUNCA "Desculpe a lentidao"; conduz pelo estado
  {
    const off = buildContextualSdrReply(afterOffer);
    check("reply apos oferta: conduz p/ fotos/filtro, sem 'Desculpe'", /fotos|filtre/i.test(off) && !FALLBACK.test(off), off);
    const intr = buildContextualSdrReply(withInteresse);
    check("reply com interesse: referencia 'onix, renegade', sem 'Desculpe'", /onix, renegade/i.test(intr) && !FALLBACK.test(intr), intr);
    const disc = buildContextualSdrReply(base());
    check("reply sem contexto: descoberta, sem 'Desculpe'", /procura/i.test(disc) && !FALLBACK.test(disc), disc);
  }

  // 2b) 1B.7 — ANTI-REPETIÇÃO + SINAL DE AVANÇO (bugs r3/s3/r1: fallback repetia verbatim e ignorava o lead).
  {
    // Descoberta: última fala do agente == candidato[0] -> escolhe OUTRA formulação (não repete).
    const discLine = "Me conta o que você procura — um modelo específico, uma faixa de preço ou um tipo (SUV, hatch, sedan)? Aí já busco no nosso estoque.";
    const repeated = withState({ turnNumber: 3, recentTurns: [{ role: "agent", text: discLine, at: NOW }] });
    const varied = buildContextualSdrReply(repeated);
    check("fallback NÃO repete a última fala do agente (varia a formulação)", normalizeText(varied) !== normalizeText(discLine), varied);
    check("fallback variado ainda conduz descoberta (modelo/tipo/faixa)", /modelo|tipo|faixa/i.test(varied), varied);
    // Sinal de compra: 'Quero comprar agora' -> conduz p/ avanço, NÃO reabre descoberta genérica (bug r3 T3).
    const buy = buildContextualSdrReply(base(), { leadMessage: "Quero comprar agora" });
    check("sinal 'Quero comprar agora' -> fallback avança (não 'Me conta o que você procura')", /avan[çc]|disponibilidade|encaminh|seguir/i.test(buy) && !/me conta o que voce procura/i.test(normalizeText(buy)), buy);
    // Após já ter perguntado 'fotos/filtre', repetir a MESMA frase é proibido -> varia.
    const photoLine = "Quer ver as fotos de algum desses, ou prefere que eu filtre por valor, câmbio ou ano?";
    const offeredThenPhotos = withState({ turnNumber: 5, recentTurns: [{ role: "agent", text: "Separei: 1. Onix — R$ 51.990", at: NOW }, { role: "agent", text: photoLine, at: NOW }] });
    const afterPhotos = buildContextualSdrReply(offeredThenPhotos);
    check("após 'fotos/filtre', fallback NÃO repete a mesma frase (varia)", normalizeText(afterPhotos) !== normalizeText(photoLine), afterPhotos);
    // NÃO-adjacente (caso real s1 T6/T8): 'fotos/filtre' foi dita 2 turnos atrás, com uma FOTO no meio -> ainda varia.
    const photosBetween = withState({ turnNumber: 7, recentTurns: [{ role: "agent", text: "Separei: 1. Onix — R$ 51.990", at: NOW }, { role: "agent", text: photoLine, at: NOW }, { role: "agent", text: "Aqui estão as fotos do Onix! 📸", at: NOW }] });
    const afterNonAdjacent = buildContextualSdrReply(photosBetween);
    check("anti-repetição olha N turnos: 'fotos/filtre' 2 turnos atrás (foto no meio) -> varia mesmo assim", normalizeText(afterNonAdjacent) !== normalizeText(photoLine), afterNonAdjacent);
  }

  // 3) buildContinuityTurnOutput: nao terminal-safe, so send_message, reasonCode, sem 'Desculpe'
  {
    const out = buildContinuityTurnOutput(withInteresse, "t-cont");
    check("continuity build: NAO terminal-safe", out.terminalSafe === false);
    check("continuity build: reasonCode continuity_conduct", out.decision.reasonCode === "continuity_conduct");
    check("continuity build: so send_message (sem oferta/midia)", out.decision.effectPlan.every((p) => p.kind === "send_message"));
    check("continuity build: texto sem 'Desculpe a lentidao'", !FALLBACK.test(out.composed.text));
  }

  // 4) Task 2 — falha de GROUNDING em msg normal: terminal_safe interno, MAS texto = fallback SDR contextual
  {
    const llm = new FakeLlm(); llm.setTurnScript(script(), fakeCompose);
    const out = await runTurn({ ctx: ctx("me ve umas opcoes ai", withInteresse), llm, runQuery, limits, maxValidationAttempts: 2 });
    check("T2 grounding: terminal-safe interno (reason_code)", out.terminalSafe === true && out.decision.reasonCode === "terminal_safe");
    check("T2 grounding: texto ao lead NAO e 'Desculpe a lentidao'", !FALLBACK.test(out.composed.text), out.composed.text);
    check("T2 grounding: texto e contextual (referencia interesse)", /onix, renegade|opções|opcoes|fotos/i.test(out.composed.text), out.composed.text);
  }

  // 5) Task 2 — ERRO de infra (runQuery throw no pre-seed): error interno, texto = fallback SDR (sem 'Desculpe')
  {
    const throwQuery: QueryRunner = async () => { throw new Error("infra down"); };
    const llm = new FakeLlm(); llm.setTurnScript(script(), fakeCompose);
    const out = await runTurn({ ctx: ctx("quero um onix", withInteresse), llm, runQuery: throwQuery, limits, maxValidationAttempts: 2 });
    check("T2 erro: terminal-safe interno (error/timeout)", out.terminalSafe === true && out.decision.reasonCode !== "terminal_safe");
    check("T2 erro: texto ao lead NAO e 'Desculpe a lentidao'", !FALLBACK.test(out.composed.text), out.composed.text);
  }

  // 6) Task 4 — oferta GROUNDED valida nao vira terminal-safe (uma decisao/turno)
  {
    const offerCompose: ComposeOverride = (_d, facts) => {
      const s = facts.find((f) => f.ok && f.tool === "stock_search");
      const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
      return { parts: [{ type: "text", content: "Opções:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] };
    };
    const llm = new FakeLlm(); llm.setTurnScript(script(), offerCompose);
    const out = await runTurn({ ctx: ctx("tem onix?", base()), llm, runQuery, limits, maxValidationAttempts: 2 });
    check("T4: oferta grounded -> NAO terminal-safe (sem dupla resposta)", out.terminalSafe === false && out.decision.reasonCode !== "terminal_safe", out.decision.reasonCode);
  }

  // 7) e2e — msg normal que falha grounding -> outbox manda fallback SDR, NUNCA 'Desculpe a lentidao'
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    await p.tryInsert({ eventId: "e1", conversationId: "cE", raw: { __redacted: true, text: "me ve umas opcoes ai" } as any, receivedAt: NOW });
    const llm = new FakeLlm(); llm.setTurnScript(script(), fakeCompose);
    await runConversationTurn({
      persistence: p, clock, llm, runQuery,
      conversationId: "cE", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "tE", leaseTtlMs: 60_000,
      interpretation: { relation: "asks_vehicle_detail" }, tenantCatalog: catalog, claimExtractor: extractor,
      limits, maxValidationAttempts: 2, providerCapability: { send_message: "none" } as any,
    });
    const outbox = await p.listOutbox("cE");
    const msg = outbox.find((r) => r.kind === "send_message");
    check("e2e: outbox tem send_message", !!msg);
    check("e2e: texto despachado NAO e 'Desculpe a lentidao'", !!msg && !FALLBACK.test((msg.payload as any).text ?? ""), JSON.stringify((msg?.payload as any)?.text));
  }

  // ── ⭐ Codex: e2e via runConversationTurn provando o ROTEAMENTO p/ continuity_conduct (estado semeado) ──
  // 8) "Boa tarde" em conversa COM historico/oferta -> continuity_conduct (conduz pelo contexto)
  {
    const res = await e2eRun("cBoa", afterOffer, "Boa tarde");
    check("e2e1 'Boa tarde': status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("e2e1: reasonCode continuity_conduct (NAO terminal_safe)", res.decision.reasonCode === "continuity_conduct", res.decision.reasonCode);
      const msgs = res.outbox.filter((r) => r.kind === "send_message");
      check("e2e1: exatamente 1 send_message, 0 send_media", msgs.length === 1 && !res.outbox.some((r) => r.kind === "send_media"), JSON.stringify(res.outbox.map((r) => r.kind)));
      check("e2e1: payload.text NAO 'Desculpe a lentidao'", !FALLBACK.test((msgs[0]?.payload as any)?.text ?? res.composedText), res.composedText);
      // R12-A: a continuidade agora PASSA PELO COMPOSE (needsCompose=true), não mais pelo menu robótico legado
      // (applySdrConduction). Prova do roteamento: NÃO caiu em terminal-safe (o compose rodou e validou).
      check("e2e1: passou pelo COMPOSE do frame (nao caiu no fallback legado)", res.terminalSafe === false, `terminalSafe=${res.terminalSafe}`);
    }
  }
  // 9) "Bonito ele" apos oferta/lista -> continuity_conduct, sem foto, sem reiniciar apresentacao
  {
    const res = await e2eRun("cBon", afterOffer, "Bonito ele");
    check("e2e2 'Bonito ele': status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("e2e2: reasonCode continuity_conduct", res.decision.reasonCode === "continuity_conduct", res.decision.reasonCode);
      check("e2e2: 1 send_message, 0 send_media (nao mandou foto)", res.outbox.filter((r) => r.kind === "send_message").length === 1 && !res.outbox.some((r) => r.kind === "send_media"));
      check("e2e2: texto nao tecnico e NAO reapresenta", !FALLBACK.test(res.composedText) && !/(sou o |me chamo|meu nome|bem-?vindo|prazer em)/i.test(res.composedText), res.composedText);
    }
  }
  // 10) NEGATIVO: "tem onix?" em conversa com historico -> NAO continuity_conduct (segue comercial)
  {
    const llm = new FakeLlm();
    const offerCompose: ComposeOverride = (_d, facts) => {
      const s = facts.find((f) => f.ok && f.tool === "stock_search");
      const keys = s && s.ok && s.tool === "stock_search" ? s.data.items.map((v) => v.vehicleKey) : [];
      return { parts: [{ type: "text", content: "Temos sim:" }, { type: "vehicle_offer_list", vehicleKeys: keys }] };
    };
    llm.setTurnScript(script(), offerCompose);
    const res = await e2eRun("cOnix", afterOffer, "tem onix?", llm);
    check("e2e3 'tem onix?': status committed", res.status === "committed", res.status);
    if (res.status === "committed") {
      check("e2e3: NAO continuity_conduct (segue caminho comercial)", res.decision.reasonCode !== "continuity_conduct", res.decision.reasonCode);
    }
  }

  console.log(`\n=== F2.7.11: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
