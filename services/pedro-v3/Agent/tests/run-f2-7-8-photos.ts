// ============================================================================
// F2.7.8 — Fluxo real de fotos (send_media) + hardening F2.7.7. Offline ($0).
//   npx tsx tests/run-f2-7-8-photos.ts
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { resolvePhotoIntent, buildPhotoTurnOutput, resolvePhotoPromiseRepair, shouldRepairPhotoPromise } from "../src/engine/photo-intent.ts";
import { safeCommitSlots, runConversationTurn } from "../src/engine/conversation-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { DecisionMutation, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T16:00:00.000Z";
const TENANT = "icom"; const AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ONIX = "chevrolet|onix|2014", RENEGADE = "jeep|renegade|2018", HB20 = "hyundai|hb20|2022";
const STOCK: VehicleFact[] = [
  { vehicleKey: ONIX, marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 54990, km: 132623, tipo: "hatch" },
  { vehicleKey: RENEGADE, marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 80000, tipo: "suv" },
  { vehicleKey: HB20, marca: "Hyundai", modelo: "HB20", ano: 2022, preco: 79990, km: 40000, tipo: "hatch" },
];
const PHOTOS: Record<string, string[]> = { [ONIX]: ["p1", "p2"], [RENEGADE]: ["p3"], [HB20]: [] };
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = STOCK.filter((v) => !modelo || normalizeText(v.modelo) === modelo || normalizeText(v.modelo).includes(modelo));
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: {} }, source: "fake" };
  }
  if (call.tool === "vehicle_photos_resolve") {
    const key = call.input.vehicleRef.key;
    return { ok: true as const, tool: "vehicle_photos_resolve" as const, data: { vehicleKey: key, ambiguous: false, photoIds: PHOTOS[key] ?? [] }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "lead1", now: NOW }),
  ...over,
});
const agentOffered = (text: string): ConversationState => baseState({ recentTurns: [{ role: "agent", text, at: NOW }] });
const TI = (models?: string[]): TurnInterpretation => ({ relation: "asks_vehicle_detail", ...(models ? { extractedEntities: { models } } : {}) });
const intent = (leadMessage: string, state: ConversationState, interpretation: TurnInterpretation = TI()) =>
  resolvePhotoIntent({ leadMessage, state, claimExtractor: extractor, runQuery, interpretation });
const repair = (composedText: string, leadMessage: string, state: ConversationState) =>
  resolvePhotoPromiseRepair({ composedText, leadMessage, state, claimExtractor: extractor, runQuery, interpretation: TI() });
const mkSendMessage = () => ({ kind: "send_message" as const, planId: "reply", effectId: "t:reply", order: 0, onSuccess: [] });
const mkDecision = (action: string, effectPlan: unknown[]): any =>
  ({ turnId: "t", action, target: null, reasonCode: "x", reasonSummary: "x", confidence: 1, decisionMutations: [], effectPlan, responsePlan: { guidance: "" }, policyChecks: [] });
// leadMessage default = pedido positivo de foto (so a negacao do lead deve travar o reparo)
const shouldRepair = (decision: unknown, composedText: string, leadMessage = "quero fotos do onix"): boolean =>
  shouldRepairPhotoPromise({ decision: decision as any, composedText, leadMessage });

async function main(): Promise<void> {
  console.log("\n=== F2.7.8 Fotos ===\n");

  // 1) "tem foto?" apos oferta de 1 veiculo -> send_media
  {
    const r = await intent("tem foto?", agentOffered("Temos sim: 1. Chevrolet Onix 2014 — R$ 54.990. Qual seu nome?"));
    check("1 'tem foto?' apos 1 veiculo -> send (onix, fotos)", r?.kind === "send" && r.vehicleKey === ONIX && r.photoIds.length === 2, JSON.stringify(r));
  }
  // 2) "manda foto do onix" -> resolve + send_media
  {
    const r = await intent("manda foto do onix", baseState());
    check("2 'manda foto do onix' -> send (onix)", r?.kind === "send" && r.vehicleKey === ONIX, JSON.stringify(r));
  }
  // 3) "foto do segundo" apos lista -> item 2 (Renegade)
  {
    const r = await intent("foto do segundo", agentOffered("1. Chevrolet Onix 2014 — R$ 54.990\n2. Jeep Renegade 2018 — R$ 72.990"));
    check("3 'foto do segundo' -> send do 2o listado (renegade)", r?.kind === "send" && r.vehicleKey === RENEGADE, JSON.stringify(r));
  }
  // 4) pedido ambiguo apos lista com varios -> pergunta qual
  {
    const r = await intent("tem foto?", agentOffered("1. Chevrolet Onix 2014\n2. Jeep Renegade 2018"));
    check("4 'tem foto?' apos lista multipla -> ask_which", r?.kind === "ask_which", JSON.stringify(r));
  }
  // 5) fotos inexistentes -> honesto, sem send
  {
    const r = await intent("quero fotos do hb20", baseState());
    check("5 modelo sem fotos -> not_found (honesto)", r?.kind === "not_found", JSON.stringify(r));
  }
  // 6) ja enviada -> nao reenvia; "mais fotos" reenvia
  {
    const sent = baseState({ photoLedger: { sentByVehicle: { [ONIX]: ["p1", "p2"] } } });
    const r1 = await intent("tem foto do onix?", sent);
    check("6 fotos ja enviadas -> already_sent (nao reenvia)", r1?.kind === "already_sent", JSON.stringify(r1));
    const r2 = await intent("manda mais fotos do onix", sent);
    check("6 'mais fotos' -> send (reenvio sob pedido claro)", r2?.kind === "send", JSON.stringify(r2));
  }
  // 7) fail-closed: modelo fora do estoque -> not_found; grounding: send sempre usa vehicleKey do estoque
  {
    const r = await intent("foto do ferrari", baseState(), TI(["ferrari"])); // interpret traz o modelo fora do catalogo
    check("7 modelo fora do estoque -> not_found (fail-closed)", r?.kind === "not_found", JSON.stringify(r));
    const send = await intent("foto do onix", baseState());
    check("7 grounding: vehicleKey do send vem do estoque", send?.kind === "send" && STOCK.some((v) => v.vehicleKey === send.vehicleKey));
  }
  // nao-pedido-de-foto -> null (deixa o LLM)
  {
    const r = await intent("quero um onix", baseState());
    check("nao-pedido-de-foto -> null (fluxo LLM normal)", r === null);
  }

  // ── fix 1 (Codex): NEGACAO de foto -> null, NUNCA midia ──
  {
    const list = agentOffered("Temos sim: 1. Chevrolet Onix 2014 — R$ 54.990");
    for (const neg of ["não quero foto", "não precisa mandar foto", "sem foto", "agora não, foto depois", "não manda imagem"]) {
      const r = await intent(neg, list);
      check(`neg: "${neg}" -> null (sem midia)`, r === null, JSON.stringify(r));
    }
    // negacao DEPOIS da palavra de foto ("tem foto ou nao?") ainda e pedido valido
    const ok = await intent("tem foto ou não?", list);
    check("neg: 'tem foto ou não?' (negacao depois) -> ainda resolve (send)", ok?.kind === "send", JSON.stringify(ok));
  }

  // ── fix 2 (Codex): anti-reenvio ACCEPTED-SAFE via recentTurns (sem depender do delivered/ledger) ──
  {
    const afterSend = agentOffered("Aqui estão as fotos do Chevrolet Onix 2014! 📸"); // fala do agente no accepted
    const r1 = await intent("tem foto?", afterSend);
    check("fix2: pedido repetido simples apos envio -> already_sent (sem midia)", r1?.kind === "already_sent", JSON.stringify(r1));
    const r2 = await intent("manda foto do onix", afterSend);
    check("fix2: pedido repetido explicito mesmo veiculo -> already_sent", r2?.kind === "already_sent", JSON.stringify(r2));
    const r3 = await intent("manda mais fotos", afterSend);
    check("fix2: 'mais fotos' apos envio -> send (reenvio sob pedido claro)", r3?.kind === "send", JSON.stringify(r3));
    const r4 = await intent("manda foto do renegade", afterSend);
    check("fix2: OUTRO veiculo apos envio -> send", r4?.kind === "send" && r4.vehicleKey === RENEGADE, JSON.stringify(r4));
  }

  // ── Fix A (Codex r3): negacao ESCOPADA POR CLAUSULA — o caso REAL que falhou em prod ──
  {
    // rajada unida por \n: resposta de troca ("nao tenho") + pedido de foto -> NAO pode bloquear
    const r1 = await intent("Também não tenho carro pra troca\nquero fotos do onix", baseState());
    check("A: rajada 'nao tenho troca \\n quero fotos do onix' -> send (negacao de OUTRA clausula nao bloqueia)", r1?.kind === "send" && r1.vehicleKey === ONIX, JSON.stringify(r1));
    // negacao na MESMA clausula ainda bloqueia
    const r2 = await intent("nao quero foto agora", baseState());
    check("A: 'nao quero foto' (mesma clausula) -> null", r2 === null, JSON.stringify(r2));
    // negacao depois de virgula, em clausula separada, NAO bloqueia o pedido
    const r3 = await intent("nao curti o preco, mas manda foto do onix", baseState());
    check("A: 'nao curti o preco, mas manda foto do onix' -> send", r3?.kind === "send", JSON.stringify(r3));
  }

  // ── Fix B (Codex r3): trava pos-LLM — promessa de foto SEM send_media e reparada, mas RESPEITA a negacao do lead ──
  {
    const sendDec = buildPhotoTurnOutput({ kind: "send", vehicleKey: ONIX, vehicleLabel: "Chevrolet Onix 2014", photoIds: ["p1"] }, "t", NOW).decision;
    check("B: decisao COM send_media -> nao precisa reparo", shouldRepair(sendDec, "Aqui estão as fotos!") === false);
    check("B: lead pediu foto + send_photos sem midia -> repara", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "ok", "quero fotos do onix") === true);
    check("B: lead neutro + texto composto promete foto -> repara", shouldRepair(mkDecision("reply", [mkSendMessage()]), "Douglas, vou te enviar as fotos do modelo ONIX 2014", "Boa tarde") === true);
    check("B: texto NEGADO ('nao vou mandar fotos') + lead neutro -> NAO repara", shouldRepair(mkDecision("reply", [mkSendMessage()]), "entendi, nao vou te mandar fotos entao", "ok") === false);
    check("B: texto normal sem foto + lead neutro -> NAO repara", shouldRepair(mkDecision("reply", [mkSendMessage()]), "Qual seu nome para eu te ajudar?", "ok") === false);

    // ⭐ Codex r3.2 (OVER-TRIGGER): action send_photos SOZINHO (sem foto no lead nem promessa no texto) NAO repara
    check("B-over: lead 'Bonito ele' + send_photos + texto sem promessa -> NAO repara", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "Que bom que gostou! Quer agendar uma visita?", "Bonito ele") === false);
    check("B-over: lead 'Gostei' + send_photos -> NAO repara", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "Que otimo! Posso te ajudar com mais detalhes?", "Gostei") === false);
    check("B-over: lead 'quanto fica?' + send_photos + texto sem promessa -> NAO repara", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "O valor e R$ 54.990.", "quanto fica?") === false);

    // ⭐ P1 do Codex: a NEGACAO DO LEAD trava o reparo MESMO com action send_photos (LLM veio errado)
    check("B-P1: lead 'não quero foto' + send_photos sem midia -> NAO repara (nunca midia contra a vontade)", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "vou enviar as fotos", "não quero foto") === false);
    check("B-P1: lead 'não precisa mandar foto do onix' + send_photos -> NAO repara", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "vou enviar as fotos do onix", "não precisa mandar foto do onix") === false);
    check("B-P1: lead rajada 'troca\\nquero fotos do onix' + send_photos -> REPARA (negacao de outra clausula)", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "vou enviar as fotos do onix", "Também não tenho carro pra troca\nquero fotos do onix") === true);
    check("B-P1: lead 'tem foto ou não?' + send_photos -> pode reparar (negacao depois)", shouldRepair(mkDecision("send_photos", [mkSendMessage()]), "vou enviar as fotos", "tem foto ou não?") === true);

    // repair pega o veiculo do TEXTO do agente (caso real "Boa tarde -> estou enviando as fotos... ONIX 2014")
    const rep1 = await repair("Douglas, estou enviando as fotos do modelo ONIX 2014", "Boa tarde", baseState());
    check("B: repair pega o veiculo do texto do agente -> send (onix)", rep1.kind === "send" && rep1.vehicleKey === ONIX, JSON.stringify(rep1));
    // repair sem modelo no texto/lead -> cai na ultima oferta do agente
    const rep2 = await repair("vou te enviar as fotos agora", "manda ai", agentOffered("Temos o Chevrolet Onix 2014 disponível"));
    check("B: repair sem modelo no texto -> usa ultima oferta (onix)", rep2.kind === "send" && rep2.vehicleKey === ONIX, JSON.stringify(rep2));
  }

  // ── buildPhotoTurnOutput: send -> efeito send_media; not_found -> so texto, SEM send_media ──
  {
    const out = buildPhotoTurnOutput({ kind: "send", vehicleKey: ONIX, vehicleLabel: "Chevrolet Onix 2014", photoIds: ["p1", "p2"] }, "t-send", NOW);
    const media = out.decision.effectPlan.find((p) => p.kind === "send_media") as any;
    check("decision send: tem EffectPlan send_media com vehicleKey+photoIds", !!media && media.vehicleKey === ONIX && media.photoIds.length === 2, JSON.stringify(out.decision.effectPlan.map((p) => p.kind)));
    check("decision send: send_media tem mark_photos_sent no onSuccess", !!media && media.onSuccess.some((o: any) => o.op === "mark_photos_sent" && o.vehicleKey === ONIX), JSON.stringify(media?.onSuccess));
    check("decision send: tambem manda um texto (send_message)", out.decision.effectPlan.some((p) => p.kind === "send_message") && !out.terminalSafe);

    const nf = buildPhotoTurnOutput({ kind: "not_found", vehicleLabel: "Fiat Argo" }, "t-nf", NOW);
    check("decision not_found: SEM send_media", !nf.decision.effectPlan.some((p) => p.kind === "send_media"));
    check("decision not_found: texto honesto", /nao encontrei|não encontrei/i.test(nf.composed.text), nf.composed.text);
  }

  // ── Engine e2e: "manda foto do onix" -> outbox tem send_media real ──
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    await p.tryInsert({ eventId: "e1", conversationId: "cP", raw: { __redacted: true, text: "manda foto do onix" } as any, receivedAt: NOW });
    await runConversationTurn({
      persistence: p, clock, llm: new FakeLlm(), runQuery,
      conversationId: "cP", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "tP", leaseTtlMs: 60_000,
      interpretation: TI(["onix"]), tenantCatalog: catalog, claimExtractor: extractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2,
      providerCapability: { send_message: "none", send_media: "none" },
    });
    const outbox = await p.listOutbox("cP");
    const media = outbox.find((r) => r.kind === "send_media");
    check("e2e: outbox tem send_media (nao fingiu por texto)", !!media, JSON.stringify(outbox.map((r) => r.kind)));
    check("e2e: send_media com vehicleKey do onix", !!media && (media.payload as any).vehicleKey === ONIX, JSON.stringify(media?.payload));
  }

  // ── Engine e2e REGRESSAO (o print real 13:33): rajada "Também não...\nquero fotos do onix" -> send_media ──
  {
    const clock = new FakeClock(NOW);
    const p = new InMemoryPersistence(clock, new FakeIdGen());
    await p.tryInsert({ eventId: "r1", conversationId: "cR", raw: { __redacted: true, text: "Também não tenho carro pra troca" } as any, receivedAt: "2026-06-30T15:59:58.000Z" });
    await p.tryInsert({ eventId: "r2", conversationId: "cR", raw: { __redacted: true, text: "quero fotos do onix" } as any, receivedAt: NOW });
    await runConversationTurn({
      persistence: p, clock, llm: new FakeLlm(), runQuery,
      conversationId: "cR", tenantId: TENANT, agentId: AGENT, leadId: null,
      workerId: "w", turnId: "tR", leaseTtlMs: 60_000,
      interpretation: TI(["onix"]), tenantCatalog: catalog, claimExtractor: extractor,
      limits: { maxSteps: 4, totalTimeoutMs: 5000 }, maxValidationAttempts: 2,
      providerCapability: { send_message: "none", send_media: "none" },
    });
    const outbox = await p.listOutbox("cR");
    const media = outbox.find((r) => r.kind === "send_media");
    check("e2e REGRESSAO: rajada troca+'quero fotos do onix' -> outbox tem send_media", !!media && (media.payload as any).vehicleKey === ONIX, JSON.stringify(outbox.map((r) => r.kind)));
  }

  // ── F2.7.7 hardening: safeCommitSlots commita o valido e DESCARTA o invalido (preview falha) ──
  {
    const st = baseState();
    const valid: DecisionMutation[] = [{ op: "set_slot", slot: "nome", value: "Douglas", confidence: 0.9, sourceTurnId: "t" }];
    const okRes = safeCommitSlots(st, valid, "t", NOW);
    check("hardening: slots validos -> committed + contextState aplicado", okRes.committed.length === 1 && okRes.contextState.slots.nome.value === "Douglas");
    const invalid: DecisionMutation[] = [{ op: "set_slot", slot: "nome", value: "x", confidence: 5, sourceTurnId: "t" } as any]; // confidence>1 -> reducer rejeita
    const badRes = safeCommitSlots(st, invalid, "t", NOW);
    check("hardening: preview falha -> NAO commita (committed=[]), nao derruba o turno", badRes.committed.length === 0 && badRes.contextState === st);
  }

  console.log(`\n=== F2.7.8: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
