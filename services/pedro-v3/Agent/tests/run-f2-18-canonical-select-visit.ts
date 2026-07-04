// ============================================================================
// F2.18 — Hardenings da auditoria Codex (offline, $0, sem rede):
//   npx tsx tests/run-f2-18-canonical-select-visit.ts
//
// H1 — SELEÇÃO ESTRITAMENTE CANÔNICA:
//   canonicalizeSelectMutations NÃO aceita o label proposto pela LLM como fallback. O label vem só de fonte
//   canônica (VehicleFact / RememberedVehicleIdentity / lastRenderedOfferContext). Sem label canônico a seleção é
//   DESCARTADA (key vai para droppedKeys), nunca persiste vazio/da LLM. O StateReducer rejeita label vazio ou ==key.
//
// H2 — VISITA EM TRÊS ESTADOS (extractLeadSlots):
//   recusa "não quero visitar" -> interesseVisita=false; intenção "quero visitar sábado" -> true (+dia);
//   adiamento/incerteza "talvez depois"/"agora não"/"mais tarde" -> NÃO grava (nem false nem true);
//   "quero visitar mais tarde" -> true, sem diaHorario (período vago); não quebra "quero fotos"/"quero o terceiro".
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState, RenderedOfferItem } from "../src/domain/conversation-state.ts";
import { extractLeadSlots } from "../src/engine/lead-extraction.ts";
import { canonicalizeSelectMutations } from "../src/engine/central-engine.ts";
import { applyDecision } from "../src/engine/state-reducer.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { DecisionMutation, QueryResult, TenantCatalog } from "../src/domain/decision.ts";
import type { RememberedVehicleIdentity, VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-07-04T15:00:00.000Z";
const TENANT = "icom"; const AGENT = "aloan";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const CRV_KEY = "honda|crv|2010";
const STOCK: VehicleFact[] = [
  { vehicleKey: "toyota|corolla|2019", marca: "Toyota", modelo: "Corolla", ano: 2019, preco: 89990, km: 60000, tipo: "sedan" },
  { vehicleKey: CRV_KEY, marca: "Honda", modelo: "CRV", ano: 2010, preco: 45990, km: 132623, tipo: "suv" },
  { vehicleKey: "fiat|argo|2021", marca: "Fiat", modelo: "Argo", ano: 2021, preco: 69990, km: 30000, tipo: "hatch" },
];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

const OFFER_ITEMS: RenderedOfferItem[] = [
  { ordinal: 1, vehicleKey: "toyota|corolla|2019", marca: "Toyota", modelo: "Corolla", ano: 2019 },
  { ordinal: 2, vehicleKey: CRV_KEY, marca: "Honda", modelo: "CRV", ano: 2010 },
  { ordinal: 3, vehicleKey: "fiat|argo|2021", marca: "Fiat", modelo: "Argo", ano: 2021 },
];

const base = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: TENANT, agentId: AGENT, leadId: "lead1", now: NOW }),
  ...over,
});
const withOffer = (over: Partial<ConversationState> = {}): ConversationState =>
  base({ lastRenderedOfferContext: { sourceTurnId: "t0", createdAt: NOW, items: OFFER_ITEMS }, ...over });
const visitAsked = (): ConversationState =>
  base({ recentTurns: [{ role: "agent", text: "Quer agendar uma visita para conhecer de perto?", at: NOW }] });

const selMut = (key: string, label: string): DecisionMutation =>
  ({ op: "select_vehicle_focus", vehicle: { kind: "vehicle", key, label }, sourceTurnId: "t1" });
const slot = (muts: DecisionMutation[], name: string) => muts.find((m) => m.op === "set_slot" && m.slot === name) as any;
const hasSlot = (muts: DecisionMutation[], name: string) => muts.some((m) => m.op === "set_slot" && m.slot === name);
const stockFacts = (): QueryResult[] => [{ ok: true, tool: "stock_search", data: { items: STOCK, filtersUsed: {} }, source: "test" }];

async function main(): Promise<void> {
  console.log("\n=== F2.18 Seleção canônica (H1) + Visita 3 estados (H2) ===\n");

  // ── H1: canonicalizeSelectMutations ────────────────────────────────────────────────────────────────────
  // 1) ADVERSARIAL: label "Ferrari Roma" da LLM, mas o key existe na oferta -> canonicaliza p/ "Honda CRV 2010".
  {
    const r = canonicalizeSelectMutations([selMut(CRV_KEY, "Ferrari Roma")], [], [], withOffer());
    const m = r.mutations.find((x) => x.op === "select_vehicle_focus") as any;
    check("H1.1 label 'Ferrari Roma' NÃO persiste; vira 'Honda CRV 2010'", m?.vehicle?.label === "Honda CRV 2010" && r.droppedKeys.length === 0, JSON.stringify(r));
  }
  // 2) ADVERSARIAL: key inexistente em qualquer fonte canônica + label da LLM -> DESCARTA (nada persiste).
  {
    const r = canonicalizeSelectMutations([selMut("ferrari|roma|2021", "Ferrari Roma")], [], [], withOffer());
    const hasSelect = r.mutations.some((x) => x.op === "select_vehicle_focus");
    check("H1.2 key sem fonte canônica -> descartado (droppedKeys), NÃO persiste label da LLM", !hasSelect && r.droppedKeys.includes("ferrari|roma|2021"), JSON.stringify(r));
  }
  // 3) key canônico via FATO real (não oferta) mas a LLM mandou o key cru como label -> canonicaliza pelo fato.
  {
    const r = canonicalizeSelectMutations([selMut(CRV_KEY, CRV_KEY)], stockFacts(), [], base());
    const m = r.mutations.find((x) => x.op === "select_vehicle_focus") as any;
    check("H1.3 label == key -> canonicaliza pelo VehicleFact 'Honda CRV 2010'", m?.vehicle?.label === "Honda CRV 2010" && r.droppedKeys.length === 0, JSON.stringify(r));
  }
  // 4) key canônico via RememberedVehicleIdentity (memória) -> nomeia mesmo sem fato/oferta no turno.
  {
    const id: RememberedVehicleIdentity = { vehicleKey: CRV_KEY, marca: "Honda", modelo: "CRV", ano: 2010 };
    const r = canonicalizeSelectMutations([selMut(CRV_KEY, "qualquer")], [], [id], base());
    const m = r.mutations.find((x) => x.op === "select_vehicle_focus") as any;
    check("H1.4 label canônico da identidade lembrada 'Honda CRV 2010'", m?.vehicle?.label === "Honda CRV 2010", JSON.stringify(r));
  }
  // 5) NORMAL: seleção do 2º da lista ("o segundo") -> extractLeadSlots já produz label canônico; canonicalize mantém
  //    "Honda CRV 2010" e o reducer aceita (state.selected.label = "Honda CRV 2010").
  {
    const muts = extractLeadSlots({ leadMessage: "quero o segundo", state: withOffer(), interpretation: null, claimExtractor: extractor, turnId: "t1" });
    const r = canonicalizeSelectMutations(muts, [], [], withOffer());
    const m = r.mutations.find((x) => x.op === "select_vehicle_focus") as any;
    check("H1.5a seleção normal do 2º -> label canônico 'Honda CRV 2010'", m?.vehicle?.key === CRV_KEY && m?.vehicle?.label === "Honda CRV 2010", JSON.stringify(m));
    const red = applyDecision(withOffer(), r.mutations, "t1", NOW);
    check("H1.5b reducer ACEITA e grava selected 'Honda CRV 2010'", red.ok === true && (red as any).next.vehicleContext.selected?.label === "Honda CRV 2010", JSON.stringify(red.ok ? (red as any).next.vehicleContext.selected : (red as any).rejected));
  }

  // ── H1 (defesa 2ª): StateReducer rejeita label vazio ou == key ───────────────────────────────────────────
  {
    const red = applyDecision(base(), [selMut(CRV_KEY, "")], "t1", NOW);
    check("H1.6 reducer REJEITA select com label vazio", red.ok === false, JSON.stringify(red));
  }
  {
    const red = applyDecision(base(), [selMut(CRV_KEY, CRV_KEY)], "t1", NOW);
    check("H1.7 reducer REJEITA select com label == key", red.ok === false, JSON.stringify(red));
  }
  {
    const red = applyDecision(base(), [selMut(CRV_KEY, "Honda CRV 2010")], "t1", NOW);
    check("H1.8 reducer ACEITA select com label canônico != key", red.ok === true && (red as any).next.vehicleContext.selected?.label === "Honda CRV 2010", JSON.stringify(red));
  }

  // ── H2: visita em três estados ───────────────────────────────────────────────────────────────────────────
  const visit = (leadMessage: string, state: ConversationState) =>
    extractLeadSlots({ leadMessage, state, interpretation: null, claimExtractor: extractor, turnId: "t1" });

  // 9) RECUSA -> interesseVisita = false
  {
    const muts = visit("não quero visitar", visitAsked());
    check("H2.1 'não quero visitar' -> interesseVisita=false", slot(muts, "interesseVisita")?.value === false, JSON.stringify(muts));
  }
  // 10) INTENÇÃO + dia -> true + diaHorario "sábado"
  {
    const muts = visit("quero visitar sábado", base());
    const iv = slot(muts, "interesseVisita"); const dh = slot(muts, "diaHorario");
    check("H2.2 'quero visitar sábado' -> interesseVisita=true", iv?.value === true, JSON.stringify(muts));
    check("H2.2 '... sábado' -> diaHorario com sábado", typeof dh?.value === "string" && /s[áa]bado/i.test(dh.value), JSON.stringify(dh));
  }
  // 11) ADIAMENTO -> NÃO grava interesseVisita (nem false nem true), mesmo com a visita perguntada
  {
    for (const [msg, tag] of [["talvez depois", "talvez depois"], ["agora não", "agora não"], ["mais tarde", "mais tarde"]] as const) {
      const muts = visit(msg, visitAsked());
      check(`H2.3 '${tag}' (adiamento) -> NÃO grava interesseVisita`, !hasSlot(muts, "interesseVisita"), JSON.stringify(muts));
    }
  }
  // 12) "quero visitar mais tarde" -> interesseVisita=true, SEM diaHorario ("mais tarde" é período vago)
  {
    const muts = visit("quero visitar mais tarde", base());
    check("H2.4a 'quero visitar mais tarde' -> interesseVisita=true", slot(muts, "interesseVisita")?.value === true, JSON.stringify(muts));
    check("H2.4b 'quero visitar mais tarde' -> SEM diaHorario", !hasSlot(muts, "diaHorario"), JSON.stringify(muts));
  }
  // 13) NÃO QUEBRAR mídia/seleção: "quero fotos" -> sem interesseVisita
  {
    const muts = visit("quero fotos", base());
    check("H2.5 'quero fotos' -> NÃO grava interesseVisita", !hasSlot(muts, "interesseVisita"), JSON.stringify(muts));
  }
  // 14) NÃO QUEBRAR seleção ordinal: "quero o terceiro" -> select do 3º, sem interesseVisita
  {
    const muts = visit("quero o terceiro", withOffer());
    const sel = muts.find((m) => m.op === "select_vehicle_focus") as any;
    check("H2.6a 'quero o terceiro' -> seleciona o 3º (Fiat Argo 2021)", sel?.vehicle?.key === "fiat|argo|2021", JSON.stringify(sel));
    check("H2.6b 'quero o terceiro' -> NÃO grava interesseVisita", !hasSlot(muts, "interesseVisita"), JSON.stringify(muts));
  }

  console.log(`\n=== F2.18: ${ok} OK / ${fail} RED ===`);
  if (fail > 0) { for (const f of fails) console.log("  FALHOU:", f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
