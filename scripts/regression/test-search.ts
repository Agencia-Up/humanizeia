// Harness de teste LOCAL da busca do Pedro v2 (Pilar B). Roda OFFLINE (sem deploy, sem rede):
//   npx tsx scripts/regression/test-search.ts
// Estoque FAKE representativo do Carvalho (BNDV). Testa rankVehicles direto -> itera o fix
// de slots/marca/tipo/multi-modelo SEM whack-a-mole em producao.
import {
  rankVehicles,
  getVehicleSubcategory,
  passesRequestedVehicleType,
  scoreVehicle,
} from "../../supabase/functions/_shared/pedro-v2/stockSearch_20260525_photo_flow.ts";
import { normalizePlan } from "../../supabase/functions/_shared/pedro-v2/pedroBrainPlanner_20260525.ts";

type V = Record<string, any>;
// Estoque fake: marca/modelo/versao/ano/preco como o BNDV devolve (markName/modelName/versionName).
const STOCK: V[] = [
  { markName: "HONDA", modelName: "CITY", versionName: "EX 1.5 FLEX AUT", year: 2019, km: 70000, saleValue: 85000, color: "PRATA", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "CHEVROLET", modelName: "ONIX SEDAN PLUS", versionName: "LTZ 1.0 TB AUT", year: 2025, km: 55000, saleValue: 97990, color: "PRETO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "CHEVROLET", modelName: "ONIX SEDAN PLUS", versionName: "LT 1.0 MEC", year: 2025, km: 46300, saleValue: 79990, color: "BRANCO", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "CHEVROLET", modelName: "ONIX HATCH", versionName: "ACTIV 1.4", year: 2017, km: 111354, saleValue: 64990, color: "LARANJA", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "FIAT", modelName: "CRONOS", versionName: "DRIVE 1.0 6V FLEX", year: 2025, km: 21400, saleValue: 82990, color: "PRETO", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "VOLKSWAGEN", modelName: "VIRTUS", versionName: "COMFORT 200 TSI 1.0", year: 2021, km: 92375, saleValue: 82990, color: "BRANCO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "HYUNDAI", modelName: "HB20", versionName: "VISION 1.0", year: 2020, km: 60000, saleValue: 62990, color: "PRATA", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "HYUNDAI", modelName: "HB20", versionName: "COMFORT 1.0", year: 2022, km: 40000, saleValue: 72990, color: "CINZA", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "HYUNDAI", modelName: "CRETA", versionName: "ATTITUDE 1.6 AUT", year: 2019, km: 80000, saleValue: 86990, color: "PRETO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "FIAT", modelName: "TORO", versionName: "FREEDOM 1.8 AT", year: 2024, km: 15000, saleValue: 149990, color: "VERMELHO", fuelName: "FLEX", transmissionName: "Automatico" },
];

const fmt = (ranked: any[]) =>
  ranked.length ? ranked.map((r) => `${r.vehicle.markName} ${r.vehicle.modelName}(${r.score})`).join("  |  ") : "∅ VAZIO";

function show(label: string, filters: V) {
  console.log(`\n▶ ${label}`);
  console.log("   filtros:", JSON.stringify(filters));
  console.log("   →", fmt(rankVehicles(STOCK, filters)));
}

console.log("=== DEBUG getVehicleSubcategory ===");
for (const v of STOCK) console.log(`   ${v.markName} ${v.modelName} -> ${getVehicleSubcategory(v as any)}`);

console.log("\n=== CENÁRIOS DE BUSCA (rankVehicles direto, offline) ===");
// ALVO REAL: "Sedan. So se for Honda" -> deve voltar SÓ a Honda City.
show("marca Honda + tipo sedan (marca_required)", { marca: "honda", marca_required: true, tipo_veiculo: "sedan", query: "honda" });
// REPRODUZ O PROD: body_type=sedan da +40 aos sedans de qualquer marca -> enterra a Honda City.
show("marca Honda + body_type sedan (REPRO PROD)", { marca: "honda", marca_required: true, tipo_veiculo: "sedan", body_type: "sedan", query: "honda" });
show("marca Honda pura (marca_required)", { marca: "honda", marca_required: true, query: "honda" });
show("marca Fiat pura (marca_required)", { marca: "fiat", marca_required: true, query: "fiat" });
// Sanidade / não-regressão:
show("modelo Onix (sem marca_required)", { modelo_desejado: "onix", query: "onix" });
show("modelo Creta", { modelo_desejado: "creta", query: "creta" });
show("tipo sedan (sem marca)", { tipo_veiculo: "sedan", query: "sedan" });

// ── PLANNER → BUSCA (ponta a ponta, offline): simula a saída do LLM e roda o normalizePlan ──
const FALLBACK: any = { action: "reply_only", intent: "unknown", confidence: 0.4, search_query: null, search_filters: {}, photo_target: null, use_memory_vehicle: false, response_guidance: "", reason: "", source: "fallback" };
const vr = (o: any = {}) => ({ query: null, has_current_vehicle_signal: false, vehicle_type: null, used_memory: false, possible_new_topic: false, ...o });

function planner(label: string, message: string, raw: any) {
  const plan = normalizePlan(raw, FALLBACK, { message, vehicle_resolution: vr() as any, memory: null, recent_history: [] });
  const f = plan.search_filters || {};
  console.log(`\n▶ PLANNER "${message}"  [${label}]`);
  console.log(`   plan: action=${plan.action} marca=${(f as any).marca || "-"} modelo=${(f as any).modelo_desejado || "-"} tipo=${(f as any).tipo_veiculo || "-"} query=${plan.search_query || "-"} reason=${String(plan.reason || "").slice(0, 40)}`);
  const ranked = rankVehicles(STOCK, { ...f, query: plan.search_query || (f as any).query });
  console.log(`   busca → ${fmt(ranked)}`);
}

console.log("\n=== PLANNER → BUSCA (simula LLM, offline) ===");
// pior caso: LLM DROPA a marca e poe modelo="sedan"
planner("LLM dropou marca", "Sedan. Só se for Honda", { action: "stock_search", intent: "vehicle_reference", search_query: "sedan", search_filters: { modelo_desejado: "sedan", tipo_veiculo: "sedan" }, confidence: 0.7 });
// LLM poe a marca como se fosse modelo
planner("LLM marca-como-modelo", "tem honda?", { action: "stock_search", intent: "vehicle_reference", search_query: "Honda", search_filters: { modelo_desejado: "Honda" }, confidence: 0.8 });
// modelo real + marca (nao pode limpar o modelo)
planner("modelo real Civic", "quero um honda civic", { action: "stock_search", intent: "vehicle_reference", search_query: "Honda Civic", search_filters: { modelo_desejado: "Honda Civic", tipo_veiculo: "sedan" }, confidence: 0.8 });
