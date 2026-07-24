// ============================================================================
// F2.76 — BUSCA EXATA PRIMEIRO, CANDIDATOS DE FAMÍLIA DEPOIS (contrato do Codex).
//
// INCIDENTE (Wa, 2026-07-24): o lead perguntou por "HB20 Confort Plus 2017". A
// stock_search casava por TODOS os tokens (broad=false), voltava VAZIA (o feed
// tinha "HB20 Comfort", nao "Confort Plus") e o agente dizia "nao temos esse
// HB20" — mesmo com o MODELO-BASE (HB20) no estoque.
//
// CONTRATO (exato -> familia): executar a busca EXATA; se vier vazia MAS o modelo
// canonico existir, devolver CANDIDATOS DE FAMILIA SEPARADOS (matchKind=
// "family_candidate"), NUNCA como match exato. Preserva filtros objetivos
// (marca/ano/cambio/preco/tipo); relaxa SO a versao, pela taxonomia (HB20).
// A LLM decide apresentar e SEMPRE confirma a versao (prompt). Fotos/detalhes
// usam a vehicleKey REAL do candidato (grounding).
//
// Os 6 aceites do Codex:
//   1. Versao exata encontrada -> somente exato.
//   2. Versao ausente, base existe -> candidato SEPARADO e transparente.
//   3. Base ausente -> vazio genuino.
//   4. "HB20 Confort Plus 2017" nao retorna outro ano/modelo/marca.
//   5. broad nao escolhe arbitrariamente por "Confort"/"Plus" (familia = canonico).
//   6. LLM nunca afirma que candidato E "Confort Plus" sem esse fato (dado canonico).
//
//   npx tsx tests/run-f2-76-family-candidate-stock.ts
// ============================================================================
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import type { StockLoader } from "../src/adapters/read/stock-loader.ts";
import type { NormalizedVehicle, StockSearchFilters, StockSearchResult, TenantAgentRef } from "../src/domain/read-ports.ts";
import { stockSearchGroundableVehicles, normalizeStockSearchInput } from "../src/domain/decision.ts";
import { activeConstraintsFromStockInput, constraintsToStockInput } from "../src/engine/commercial-constraints.ts";
import type { QueryResult } from "../src/domain/decision.ts";
import { knownVehicleKeysForTest } from "../src/engine/central-engine.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = "2026-07-24T12:00:00.000Z";
const REF: TenantAgentRef = { tenantId: "t", agentId: "a" };

function nv(over: Partial<NormalizedVehicle> & { externalVehicleId: string }): NormalizedVehicle {
  return { source: "bndv", markName: null, modelName: null, versionName: null, year: null, km: null, saleValue: null,
    color: "Prata", fuelName: "Flex", transmissionName: "Manual", pictureJs: "[]", category: "hatch", bodyType: "hatch", ...over };
}
function fakeSource(vehicles: readonly NormalizedVehicle[]): V2StockSource {
  const loader: StockLoader = { async loadAll(_ref: TenantAgentRef): Promise<NormalizedVehicle[]> { return [...vehicles]; } };
  return new V2StockSource(loader);
}
const search = (vehicles: readonly NormalizedVehicle[], filters: StockSearchFilters): Promise<StockSearchResult> => fakeSource(vehicles).search(REF, filters);
const fam = (r: StockSearchResult): readonly VehicleFact[] => r.familyCandidates ?? [];

// Estoque: DOIS HB20 (base existe) + 3 iscas para os aceites 4/5 (marca/ano/"Confort"/"Plus" de OUTROS modelos).
const HB20_2017 = nv({ externalVehicleId: "1", markName: "Hyundai", modelName: "HB20", versionName: "Comfort 1.0 Flex", year: 2017, km: 60000, saleValue: 52100 });
const HB20_2025 = nv({ externalVehicleId: "2", markName: "Hyundai", modelName: "HB20", versionName: "Platinum Plus 1.0 TGDI", year: 2025, km: 0, saleValue: 75900, transmissionName: "Automatico" });
const ONIX_PLUS = nv({ externalVehicleId: "3", markName: "Chevrolet", modelName: "Onix Plus", versionName: "LT 1.0", year: 2021, km: 30000, saleValue: 68000, category: "sedan", bodyType: "sedan" });
const ARGO_CFP  = nv({ externalVehicleId: "4", markName: "Fiat", modelName: "Argo", versionName: "Confort Plus 1.3", year: 2019, km: 40000, saleValue: 60000 }); // versao LITERALMENTE "Confort Plus", modelo != HB20
const COROLLA   = nv({ externalVehicleId: "5", markName: "Toyota", modelName: "Corolla", versionName: "XEI 2.0", year: 2018, km: 50000, saleValue: 95000, category: "sedan", bodyType: "sedan" });

const FEED_A = [HB20_2017, HB20_2025, ONIX_PLUS, ARGO_CFP, COROLLA]; // base HB20 PRESENTE
const FEED_B = [ONIX_PLUS, ARGO_CFP, COROLLA];                       // base HB20 AUSENTE

async function main(): Promise<void> {
  console.log("== F2.76: busca exata -> candidatos de familia ==");

  // ── ACEITE 1: versao EXATA encontrada -> somente exato (sem familia) ────────────────────────────
  const a1 = await search(FEED_A, { modelo: "HB20 Platinum Plus" });
  check("[A1] versao exata existe -> matchKind=exact", a1.matchKind === "exact", String(a1.matchKind));
  check("[A1] exato traz SO o HB20 2025 (a versao pedida)", a1.items.length === 1 && a1.items[0].ano === 2025, `n=${a1.items.length}`);
  check("[A1] com match exato, familyCandidates vazio", fam(a1).length === 0, `fc=${fam(a1).length}`);

  // Modelo-base cru (sem versao) que EXISTE -> exato com os dois HB20, sem familia (nao ha versao a relaxar).
  const a1b = await search(FEED_A, { modelo: "HB20" });
  check("[A1b] modelo-base cru existente -> exact com os 2 HB20", a1b.matchKind === "exact" && a1b.items.length === 2 && fam(a1b).length === 0, `n=${a1b.items.length}/${fam(a1b).length}`);

  // ── ACEITE 2: versao AUSENTE, base EXISTE -> candidato de familia SEPARADO ───────────────────────
  const a2 = await search(FEED_A, { modelo: "HB20 Confort Plus" });
  check("[A2] versao ausente + base existe -> matchKind=family_candidate", a2.matchKind === "family_candidate", String(a2.matchKind));
  check("[A2] items (match exato) VAZIO — nunca vira exato", a2.items.length === 0, `items=${a2.items.length}`);
  check("[A2] familyCandidates traz os 2 HB20 da familia", fam(a2).length === 2, `fc=${fam(a2).length}`);
  check("[A2] todo candidato e Hyundai HB20 (modelo canonico)", fam(a2).every((v) => v.marca === "Hyundai" && v.modelo === "HB20"), JSON.stringify(fam(a2).map((v) => `${v.marca}/${v.modelo}`)));

  // ── ACEITE 6: o DADO do candidato e o modelo CANONICO "HB20", nunca "HB20 Confort Plus" ──────────
  check("[A6] candidato NAO carrega a versao pedida no dado (modelo=HB20, nao 'Confort Plus')",
    fam(a2).every((v) => v.modelo === "HB20" && !/confort|plus/i.test(v.modelo)), JSON.stringify(fam(a2).map((v) => v.modelo)));

  // ── ACEITE 5: familia = CANONICO. Um Fiat Argo "Confort Plus" e um Onix "Plus" NUNCA entram ──────
  check("[A5] Argo 'Confort Plus' (outro modelo) NAO vira candidato de HB20", fam(a2).every((v) => v.marca !== "Fiat"), "Argo vazou");
  check("[A5] Onix 'Plus' (outro modelo) NAO vira candidato de HB20", fam(a2).every((v) => v.marca !== "Chevrolet"), "Onix vazou");
  check("[A5] nenhum candidato veio por token 'Confort'/'Plus' de outro modelo (precos 60k/68k ausentes)",
    fam(a2).every((v) => v.preco !== 60000 && v.preco !== 68000), JSON.stringify(fam(a2).map((v) => v.preco)));

  // ── ACEITE 5 REFORÇADO (ordem Codex #5): broad:true NÃO pode contaminar o EXATO. "HB20 Confort Plus" + broad:true
  //    continua all-tokens (broad inerte no modelo) -> NÃO casa "Fiat Argo Confort Plus" nem entra como exact. ──
  const a5b = await search(FEED_A, { modelo: "HB20 Confort Plus", broad: true });
  check("[A5b] broad:true NÃO vira OR-de-token: Argo 'Confort Plus' NUNCA entra no exato", a5b.items.every((v) => v.marca !== "Fiat"), JSON.stringify(a5b.items.map((v) => v.marca)));
  check("[A5b] broad:true resultado OR não recebe matchKind=exact (exato vazio -> family_candidate)", a5b.matchKind === "family_candidate" && a5b.items.length === 0, `${a5b.matchKind}/${a5b.items.length}`);
  check("[A5b] broad:true família segue canônica (só HB20, nunca Argo/Onix)", fam(a5b).length === 2 && fam(a5b).every((v) => v.marca === "Hyundai" && v.modelo === "HB20"), JSON.stringify(fam(a5b).map((v) => v.marca)));

  // ── MULTI-MODELO (modelos[], uso interno do engine, ex.: "palio gol"): OR entre ALTERNATIVAS, cada uma all-tokens.
  //    Nunca faz OR-de-token entre modelos distintos (o "Plus" do Argo não satisfaz a alternativa "Onix Plus"). ──
  const mm = await search(FEED_A, { modelos: ["HB20", "Onix Plus"] });
  check("[MM] modelos[] casa HB20 OU Onix Plus (matchKind=exact, 3 itens)", mm.matchKind === "exact" && mm.items.length === 3, `${mm.matchKind}/${mm.items.length}`);
  check("[MM] modelos[] só Hyundai/Chevrolet (Argo 'Plus' e Corolla FORA — sem OR-de-token entre modelos)", mm.items.every((v) => v.marca === "Hyundai" || v.marca === "Chevrolet"), JSON.stringify(mm.items.map((v) => v.marca)));
  const mmNone = await search(FEED_B, { modelos: ["HB20", "Kwid"] });
  check("[MM] modelos[] sem nenhuma alternativa no estoque -> none", mmNone.matchKind === "none" && mmNone.items.length === 0, `${mmNone.matchKind}/${mmNone.items.length}`);

  // ── ACEITE 3: base AUSENTE -> vazio GENUINO (nem exato, nem familia) ─────────────────────────────
  const a3 = await search(FEED_B, { modelo: "HB20 Confort Plus" });
  check("[A3] base ausente -> matchKind=none", a3.matchKind === "none", String(a3.matchKind));
  check("[A3] sem itens e sem candidatos (vazio genuino)", a3.items.length === 0 && fam(a3).length === 0, `items=${a3.items.length} fc=${fam(a3).length}`);
  // regressao: modelo-base cru inexistente tambem e none (nao inventa familia de si mesmo).
  const a3b = await search(FEED_B, { modelo: "HB20" });
  check("[A3b] modelo-base cru inexistente -> none (nao vira auto-candidato)", a3b.matchKind === "none" && fam(a3b).length === 0, `${a3b.matchKind}/${fam(a3b).length}`);

  // ── ACEITE 4: filtros objetivos PRESERVADOS — nao retorna outro ano/marca ────────────────────────
  const a4 = await search(FEED_A, { modelo: "HB20 Confort Plus", anos: [2017] });
  check("[A4] ano preservado -> candidato SO de 2017 (nunca o HB20 2025)", a4.matchKind === "family_candidate" && fam(a4).length === 1 && fam(a4)[0].ano === 2017,
    `${a4.matchKind} fc=${JSON.stringify(fam(a4).map((v) => v.ano))}`);
  const a4b = await search(FEED_A, { modelo: "HB20 Confort Plus", marca: "Fiat" });
  check("[A4b] marca preservada -> HB20 nao vaza sob marca=Fiat (none)", a4b.matchKind === "none" && fam(a4b).length === 0, `${a4b.matchKind}/${fam(a4b).length}`);

  // ══ ROUNDTRIP DO CICLO COMPLETO (bloqueador Codex rodada 3) ══════════════════════════════════════════════════
  // input da tool -> activeSearchConstraints (persistido) -> constraintsToStockInput no TURNO SEGUINTE -> matching.
  // O bug: `modelo` unico multi-palavra era QUEBRADO em palavras (["HB20","Confort","Plus"]) e voltava como OR de 3
  // alternativas -> "Fiat Argo Confort Plus" reentrava pelo token "Confort" COMO EXATO no turno seguinte.
  const execInput = { modelo: "HB20 Confort Plus" };
  const active1 = activeConstraintsFromStockInput(execInput);
  check("[RT1] modelo unico multi-palavra = UMA alternativa inteira (nunca quebrado em palavras)",
    (active1.modelos ?? []).length === 1 && (active1.modelos ?? [])[0] === "HB20 Confort Plus", JSON.stringify(active1.modelos));
  const next1 = constraintsToStockInput(active1);
  check("[RT2] o turno seguinte busca `modelo` unico (sem OR de modelos[], sem broad)",
    next1.modelo === "HB20 Confort Plus" && next1.modelos === undefined && next1.broad === undefined, JSON.stringify(next1));
  const rt1 = await search(FEED_A, next1 as StockSearchFilters);
  check("[RT3] ⭐roundtrip NAO reaceita 'Fiat Argo Confort Plus' na busca exata (a contaminacao NAO volta)",
    rt1.items.every((v) => v.marca !== "Fiat"), JSON.stringify(rt1.items.map((v) => `${v.marca} ${v.modelo}`)));
  check("[RT4] roundtrip preserva o contrato: exato vazio -> family_candidate so da familia HB20",
    rt1.matchKind === "family_candidate" && rt1.items.length === 0 && fam(rt1).every((v) => v.marca === "Hyundai" && v.modelo === "HB20"),
    `${rt1.matchKind} fc=${JSON.stringify(fam(rt1).map((v) => v.marca))}`);

  // Multi-modelo sobrevive ao mesmo ciclo (nao vira frase juntada nem perde alternativas).
  const active2 = activeConstraintsFromStockInput({ modelos: ["Palio", "Gol"] });
  check("[RT5] multi-modelo roundtrip preserva as 2 alternativas", (active2.modelos ?? []).length === 2, JSON.stringify(active2.modelos));
  const next2 = constraintsToStockInput(active2);
  check("[RT6] multi-modelo volta como modelos[] (OR de alternativas), sem broad",
    Array.isArray(next2.modelos) && next2.modelos.length === 2 && next2.modelo === undefined && next2.broad === undefined, JSON.stringify(next2));

  // OR de alternativas MULTI-PALAVRA: cada alternativa exige TODOS os seus tokens; nada casa por token solto.
  const next3 = constraintsToStockInput(activeConstraintsFromStockInput({ modelos: ["HB20 Confort Plus", "Onix Plus"] }));
  const rt3 = await search(FEED_A, next3 as StockSearchFilters);
  check("[RT7] OR de alternativas multi-palavra: so o Onix Plus casa; Argo 'Confort Plus' NUNCA entra",
    rt3.items.length === 1 && rt3.items[0].marca === "Chevrolet", JSON.stringify(rt3.items.map((v) => `${v.marca} ${v.modelo}`)));

  // [RT8] MODELO REAL COM PALAVRA DE TIPO NO NOME ("Focus Sedan", "Ka Sedan", "Etios Sedan", "City Hatchback" — todos na
  // vehicle-taxonomy). Com o split antigo o elemento "Sedan" era promovido a `tipo` pela guarda de normalizeStockSearchInput:
  // o modelo degradava p/ "Focus" (busca o carro ERRADO) e, se o escopo já tivesse `tipo` divergente, a busca INTEIRA era
  // rejeitada fail-closed ({ok:false, conflict}). Com a frase inteira nada é promovido.
  const rt8Next = constraintsToStockInput(activeConstraintsFromStockInput({ modelo: "Focus Sedan" }));
  check("[RT8] modelo com palavra de tipo no nome sobrevive ao roundtrip (não vira tipo nem degrada)",
    rt8Next.modelo === "Focus Sedan" && rt8Next.tipo === undefined && rt8Next.modelos === undefined, JSON.stringify(rt8Next));
  const rt8Norm = normalizeStockSearchInput(rt8Next);
  check("[RT8] normalizeStockSearchInput NÃO promove 'Sedan' a tipo nem rejeita a busca",
    rt8Norm.ok === true && rt8Norm.input.modelo === "Focus Sedan" && rt8Norm.input.tipo === undefined, JSON.stringify(rt8Norm));

  // ── GROUNDING: candidato de familia e veiculo REAL e REFERENCIAVEL (Codex #6: fotos/detalhes usam a key real) ──
  const fA: VehicleFact = { vehicleKey: "Hyundai|HB20|2017", marca: "Hyundai", modelo: "HB20", ano: 2017, preco: 52100, tipo: "hatch" };
  const fB: VehicleFact = { vehicleKey: "Hyundai|HB20|2025", marca: "Hyundai", modelo: "HB20", ano: 2025, preco: 75900, tipo: "hatch" };
  check("[G1] stockSearchGroundableVehicles = items (sem familia)", stockSearchGroundableVehicles({ items: [fA], filtersUsed: {} }).length === 1);
  check("[G1] stockSearchGroundableVehicles = items ∪ familyCandidates", stockSearchGroundableVehicles({ items: [], filtersUsed: {}, familyCandidates: [fB], matchKind: "family_candidate" }).map((v) => v.vehicleKey).join() === "Hyundai|HB20|2025");
  const famFact: QueryResult = { ok: true, tool: "stock_search", source: "x", data: { items: [], filtersUsed: {}, familyCandidates: [fB], matchKind: "family_candidate" } };
  const state = createInitialState({ conversationId: "c", tenantId: "t", agentId: "a", leadId: null, now: NOW });
  const keys = knownVehicleKeysForTest([famFact], [], state);
  check("[G2] a key REAL do candidato de familia esta aterrada (referenciavel p/ foto/detalhe)", keys.has("Hyundai|HB20|2025"), [...keys].join());
  check("[G2] um match EXATO segue aterrado normalmente", knownVehicleKeysForTest([{ ok: true, tool: "stock_search", source: "x", data: { items: [fA], filtersUsed: {} } }], [], state).has("Hyundai|HB20|2017"));

  console.log(`\n== F2.76: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
