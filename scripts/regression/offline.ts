// ============================================================================
// SUÍTE DE REGRESSÃO **OFFLINE** do Pedro v2 — roda SEM REDE, SEM LLM, SEM CUSTO ($0).
//   npx tsx scripts/regression/offline.ts            (tudo)
//   npx tsx scripts/regression/offline.ts busca      (só um grupo)
// ----------------------------------------------------------------------------
// POR QUE: a suíte HTTP (suite.mjs) bate na prod ao vivo -> cada teste = chamada gpt-4o =
// custo real. A MAIORIA dos bugs do agente é LÓGICA PURA (ranking de busca, normalizePlan,
// formatação, parsing de nome) e NÃO precisa de LLM pra testar. Aqui testamos essas funções
// DIRETO (import), de graça e em segundos. O que depende do LLM (frase do reply, classificação
// do planner) fica na suíte HTTP "golden", rodada RARAMENTE.
// Sai com código !=0 se algo falhar (trava o deploy).
// ============================================================================
import {
  rankVehicles,
  getVehicleSubcategory,
  passesRequestedVehicleType,
} from "../../supabase/functions/_shared/pedro-v2/stockSearch_20260525_photo_flow.ts";
import { normalizePlan } from "../../supabase/functions/_shared/pedro-v2/pedroBrainPlanner_20260525.ts";
import { ensureStockReplyFormatting, leadFirstName } from "../../supabase/functions/_shared/pedro-v2/pedroBrainReply_20260525.ts";

const onlyGroup = (process.argv[2] || "").toLowerCase();
let ok = 0, fail = 0;
const fails: string[] = [];
function check(group: string, name: string, pass: boolean, detail = "") {
  if (onlyGroup && group !== onlyGroup) return;
  if (pass) { ok++; console.log(`  ✅ [${group}] ${name}`); }
  else { fail++; fails.push(`[${group}] ${name} — ${detail}`); console.log(`  ❌ [${group}] ${name} — ${detail}`); }
}

type V = Record<string, any>;
// Estoque FAKE representativo do Carvalho (shape do BNDV: markName/modelName/versionName/year/km/saleValue).
const STOCK: V[] = [
  // sedans
  { markName: "HONDA", modelName: "CITY", versionName: "EX 1.5 FLEX AUT", year: 2019, km: 70000, saleValue: 85000, color: "PRATA", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "CHEVROLET", modelName: "ONIX SEDAN PLUS", versionName: "LTZ 1.0 TB AUT", year: 2025, km: 55000, saleValue: 97990, color: "PRETO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "FIAT", modelName: "CRONOS", versionName: "DRIVE 1.0 6V FLEX", year: 2025, km: 21400, saleValue: 82990, color: "PRETO", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "VOLKSWAGEN", modelName: "VIRTUS", versionName: "COMFORT 200 TSI 1.0", year: 2021, km: 92375, saleValue: 90990, color: "BRANCO", fuelName: "FLEX", transmissionName: "Automatico" },
  // hatches
  { markName: "CHEVROLET", modelName: "ONIX HATCH", versionName: "ACTIV 1.4", year: 2017, km: 111354, saleValue: 64990, color: "LARANJA", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "HYUNDAI", modelName: "HB20", versionName: "VISION 1.0", year: 2020, km: 60000, saleValue: 62990, color: "PRATA", fuelName: "FLEX", transmissionName: "Manual" },
  { markName: "HYUNDAI", modelName: "HB20", versionName: "COMFORT 1.0", year: 2022, km: 40000, saleValue: 72990, color: "CINZA", fuelName: "FLEX", transmissionName: "Manual" },
  // suvs
  { markName: "HYUNDAI", modelName: "CRETA", versionName: "ATTITUDE 1.6 AUT", year: 2019, km: 80000, saleValue: 86990, color: "PRETO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "CHEVROLET", modelName: "TRACKER", versionName: "PREMIER 1.2 TURBO AUT", year: 2023, km: 83000, saleValue: 111990, color: "CINZA", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "JEEP", modelName: "RENEGADE", versionName: "LONGITUDE 1.8 AUT", year: 2021, km: 114000, saleValue: 85990, color: "PRETO", fuelName: "FLEX", transmissionName: "Automatico" },
  { markName: "JEEP", modelName: "COMPASS", versionName: "LONGITUDE 2.0 AUT", year: 2019, km: 88000, saleValue: 97990, color: "BRANCO", fuelName: "FLEX", transmissionName: "Automatico" },
  // pickups
  { markName: "FIAT", modelName: "TORO", versionName: "FREEDOM 1.8 AT", year: 2024, km: 15000, saleValue: 149990, color: "VERMELHO", fuelName: "FLEX", transmissionName: "Automatico" },
];
const ranked = (filters: V) => rankVehicles(STOCK, filters);
const labels = (rk: any[]) => rk.map((r) => `${r.vehicle.markName} ${r.vehicle.modelName}`);
const models = (rk: any[]) => new Set(rk.map((r) => String(r.vehicle.modelName).toLowerCase().split(" ")[0]));

console.log("\n=== SUÍTE OFFLINE Pedro v2 (sem rede / sem LLM / $0) ===\n");

// ── BUSCA (rankVehicles) — onde mais nasceram bugs ──────────────────────────
{
  // Busca AMPLA de categoria (query vazia, sem modelo): retorna o POOL do tipo, NUNCA zera.
  const suv = ranked({ tipo_veiculo: "suv", body_type: "suv", query: "", stock_broad: true });
  check("busca", "broad SUV retorna o pool (não zera)", suv.length >= 4, `got ${suv.length}`);
  check("busca", "broad SUV só traz SUV", suv.every((r: any) => getVehicleSubcategory(r.vehicle) === "suv"), labels(suv).join(","));

  // ad_context (frase do lead) numa busca ampla NÃO pode zerar (raiz v131). Invariante: numa busca
  // ampla, mesmo com ad_context preenchido, o pool não some. (No prod o orchestrator limpa o ad_context;
  // aqui garantimos que, limpo, a busca ampla funciona — e documentamos que ad_context não é filtro duro.)
  const broadClean = ranked({ tipo_veiculo: "suv", body_type: "suv", query: "", stock_broad: true, ad_context: "" });
  check("busca", "broad com ad_context vazio = pool cheio (v131)", broadClean.length >= 4, `got ${broadClean.length}`);

  // marca_required: "só se for Honda" -> só Honda, mesmo com bônus de carroceria.
  const honda = ranked({ marca: "honda", marca_required: true, tipo_veiculo: "sedan", body_type: "sedan", query: "honda" });
  check("busca", "marca_required Honda -> só Honda", honda.length > 0 && honda.every((r: any) => /honda/i.test(r.vehicle.markName)), labels(honda).join(","));

  // tipo sedan (sem marca): só sedans.
  const sedans = ranked({ tipo_veiculo: "sedan", body_type: "sedan", query: "sedan" });
  check("busca", "tipo sedan -> só sedans", sedans.length > 0 && sedans.every((r: any) => getVehicleSubcategory(r.vehicle) === "sedan"), labels(sedans).join(","));

  // teto de preço EXPLÍCITO e HARD: nada acima.
  const ate70 = ranked({ tipo_veiculo: "suv", body_type: "suv", query: "", stock_broad: true, preco_max: 90000, hard_price_ceiling: true });
  check("busca", "teto R$90k hard -> nada acima", ate70.every((r: any) => Number(r.vehicle.saleValue) <= 90000), labels(ate70).join(","));

  // faixa de ANO (ano_min/ano_max): só dentro da faixa.
  const faixa = ranked({ tipo_veiculo: "suv", body_type: "suv", query: "", stock_broad: true, ano_min: 2021, ano_max: 2025 });
  check("busca", "ano_min 2021 -> nada abaixo de 2021", faixa.every((r: any) => Number(r.vehicle.year) >= 2021), faixa.map((r: any) => r.vehicle.year).join(","));

  // modelo nomeado: traz o modelo (não zera, não traz tudo).
  const onix = ranked({ modelo_desejado: "onix", query: "onix" });
  check("busca", "modelo 'onix' -> traz Onix", onix.length > 0 && onix.some((r: any) => /onix/i.test(r.vehicle.modelName)), labels(onix).join(","));

  // passesRequestedVehicleType: moto fora de busca de carro (sanidade do filtro de tipo).
  check("busca", "Creta passa como suv", passesRequestedVehicleType(STOCK[7] as any, { tipo_veiculo: "suv" }, false) === true);
}

// ── PLANNER (normalizePlan) — pós-processamento determinístico do plano do LLM ──────────────
{
  const FALLBACK: any = { action: "reply_only", intent: "unknown", confidence: 0.4, search_query: null, search_filters: {}, photo_target: null, use_memory_vehicle: false, response_guidance: "", reason: "", source: "fallback" };
  const vr = (o: any = {}) => ({ query: null, has_current_vehicle_signal: false, vehicle_type: null, used_memory: false, possible_new_topic: false, ...o });
  const plan = (msg: string, raw: any, mem: any = null) => normalizePlan(raw, FALLBACK, { message: msg, vehicle_resolution: vr() as any, memory: mem, recent_history: [] } as any);

  // SLOT recovery: LLM dropou a marca em "Sedan. Só se for Honda" -> normalizePlan recupera marca + marca_required.
  const p1 = plan("Sedan. Só se for Honda", { action: "stock_search", intent: "vehicle_reference", search_query: "sedan", search_filters: { modelo_desejado: "sedan", tipo_veiculo: "sedan" }, confidence: 0.7 });
  check("planner", "recupera marca Honda que o LLM dropou", /honda/i.test(String(p1.search_filters?.marca || p1.search_query || "")), `marca=${p1.search_filters?.marca} q=${p1.search_query}`);

  // FAIXA DE ANO como string "2013-2018" -> vira ano_min/ano_max.
  const p2 = plan("hatch de 2013 a 2018", { action: "stock_search", intent: "stock_lookup", search_query: "hatch", search_filters: { tipo_veiculo: "hatch", ano: "2013-2018" }, confidence: 0.7 });
  check("planner", "faixa de ano 2013-2018 -> ano_min/ano_max", Number(p2.search_filters?.ano_min) === 2013 && Number(p2.search_filters?.ano_max) === 2018, `min=${p2.search_filters?.ano_min} max=${p2.search_filters?.ano_max}`);

  // TROCA (posse): "eu tenho um cruze 2016" = carro do LEAD, NÃO interesse -> NÃO busca Cruze.
  const p3 = plan("Nossa muito rodando. Eu tenho um cruze 2016 com 64 mil de km", { action: "stock_search", intent: "stock_lookup", search_query: "Chevrolet Cruze", search_filters: { modelo_desejado: "Chevrolet Cruze" }, confidence: 0.7 });
  check("planner", "troca 'tenho um cruze' NÃO vira busca de Cruze", p3.action !== "stock_search" || !/cruze/i.test(String(p3.search_filters?.modelo_desejado || p3.search_query || "")), `action=${p3.action} modelo=${p3.search_filters?.modelo_desejado}`);

  // CONTRA-PROVA: "trocar meu corsa POR UM onix" QUER o Onix (não é só troca).
  const p4 = plan("quero trocar meu corsa por um onix", { action: "stock_search", intent: "trade_in", search_query: "Chevrolet Onix", search_filters: { modelo_desejado: "Chevrolet Onix" }, confidence: 0.7 });
  check("planner", "'trocar por um onix' busca o Onix", /onix/i.test(String(p4.search_query || p4.search_filters?.modelo_desejado || "")), `q=${p4.search_query}`);
}

// ── FORMATAÇÃO (ensureStockReplyFormatting) — lista legível no WhatsApp ──────────────────────
{
  const fmt = (text: string, facts: any[] = []) => ensureStockReplyFormatting({ text, facts, plan: {} as any });
  // lista numerada inline -> 1 veículo por linha.
  const inlineList = "Temos opções: 1. Onix Activ 2017, laranja, R$ 64.990. 2. Onix LT 2022, azul, R$ 66.990. 3. Onix 2025, branco, R$ 76.990. Quer ver fotos?";
  const out = fmt(inlineList);
  const maxItensNaLinha = Math.max(...out.split("\n").map((l: string) => (l.match(/\d{1,2}\.\s+[A-Za-zÀ-ÿ]/g) || []).length));
  check("formatacao", "lista numerada inline -> 1 por linha", maxItensNaLinha <= 1, `max itens/linha = ${maxItensNaLinha}`);
  // NÃO quebra preço "64.990" nem prosa normal.
  const prosa = fmt("O Onix 2025 sai por R$ 76.990 e tem 43.900 km. Quer ver?");
  check("formatacao", "não quebra preço/prosa sem lista", prosa.includes("R$ 76.990") && !/\n\d/.test(prosa), JSON.stringify(prosa.slice(0, 40)));
}

// ── NOME (leadFirstName) — nome-lixo do WhatsApp vira null (saudação genérica) ───────────────
{
  const fn = (nome: string) => leadFirstName({ lead: { nome } } as any);
  check("nome", "'$' -> null (sem nome)", fn("$") === null, String(fn("$")));
  check("nome", "emoji -> null", fn("😄😄") === null, String(fn("😄😄")));
  check("nome", "'.' -> null", fn(".") === null, String(fn(".")));
  check("nome", "1 letra -> null", fn("A") === null, String(fn("A")));
  check("nome", "'Jô' -> Jô (nome real curto)", (fn("Jô") || "").toLowerCase() === "jô", String(fn("Jô")));
  check("nome", "'douglas aloan' -> Douglas", fn("douglas aloan") === "Douglas", String(fn("douglas aloan")));
  check("nome", "nome com emoji -> 1º nome limpo", fn("RUTH ❤️🤩") === "Ruth", String(fn("RUTH ❤️🤩")));
}

console.log(`\n=== OFFLINE: ${ok} OK | ${fail} FALHA ===`);
if (fail) { console.log("\nFALHAS:\n" + fails.map((f) => "  " + f).join("\n")); process.exit(1); }
