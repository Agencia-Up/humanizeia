// ============================================================================
// F2.7.16 - HONESTIDADE do explicit-search (Fix A) + PERSISTIR intencao nos slots (Fix C).
// Diagnostico 2026-07-01 (Brain/2026-07-01-claude-diagnostico-suv-memoria-conducao.md):
//   O agente listou SUVs e logo depois disse "nao tenho SUV" (mentira confiante), e reperguntou
//   "qual modelo/tipo?" apos ofertar (nao persistia a intencao nos slots).
// INVARIANTE Fix A: uma busca por TIPO nunca vira "nao tenho {tipo}" havendo estoque -> oferta
//   candidatos (grounded=false) em vez de negar. Marca/modelo mantem ausencia honesta (verificavel).
// INVARIANTE Fix C: o handler que age sobre a intencao explicita grava tipoVeiculo/interesse/faixaPreco.
//
// DESACOPLADO da taxonomia real: a fonte fake classifica pelo campo `tipo` do proprio veiculo, com a
// MESMA regra do stock-source.ts ("unknown" nunca atende um filtro de tipo). A correcao da CLASSIFICACAO
// em si (taxonomia) e coberta por run-f2-7-15-vehicle-taxonomy.ts. Aqui testamos so a HONESTIDADE do handler.
//   npx tsx tests/run-f2-7-16-explicit-honesty.ts
// ============================================================================
import { resolveExplicitSearchIntent, buildExplicitSearchTurnOutput } from "../src/engine/explicit-search.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import type { QueryCall, QueryResult, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact, VehicleType } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} - ${detail}`); console.log(`  RED ${name}${detail ? ` - ${detail}` : ""}`); }
}

const V = (vehicleKey: string, marca: string, modelo: string, ano: number, preco: number, km: number, tipo: VehicleType): VehicleFact =>
  ({ vehicleKey, marca, modelo, ano, preco, km, tipo });

// SUVs cujo tipo o feed CONSEGUE classificar (suv) + SUVs REAIS que o feed NAO classifica (unknown)
// + hatches. Espelha o print real: CRV/Tiggo 2 chegam sem carroceria -> unknown.
const RENEGADE = V("revendamais:1", "Jeep", "Renegade", 2018, 72990, 80000, "suv");
const P2008    = V("revendamais:2", "Peugeot", "2008", 2021, 66990, 40000, "suv");
const CRV      = V("revendamais:3", "Honda", "CRV", 2010, 62990, 158000, "unknown");
const TIGGO2   = V("revendamais:4", "CAOA Chery", "Tiggo 2", 2020, 71990, 78000, "unknown");
const C3       = V("revendamais:5", "Citroen", "C3", 2015, 47990, 116000, "hatch");
const GOL      = V("revendamais:6", "Volkswagen", "Gol", 2015, 38990, 95000, "hatch");
// SUVs FICTICIOS que NENHUMA taxonomia conhece (marca/modelo inventados) -> classificacao sempre unknown,
// mesmo apos o Fix B (taxonomia). Servem p/ exercitar a REDE DE SEGURANCA do Fix A de forma robusta.
const MISTERIOA = V("revendamais:91", "Nimbus", "Vega", 2021, 55000, 30000, "unknown");
const MISTERIOB = V("revendamais:92", "Zenith", "Lyra", 2019, 49000, 60000, "unknown");

// Fonte fake FIEL ao stock-source.ts: "unknown" nunca atende um filtro de tipo (a raiz da mentira).
const sourceFor = (stock: VehicleFact[]): QueryRunner => async (call: QueryCall) => {
  if (call.tool !== "stock_search") return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
  let pool = stock.filter((v) => typeof v.preco === "number" && v.preco > 0);
  if (call.input.tipo) pool = pool.filter((v) => v.tipo !== "unknown" && v.tipo === call.input.tipo); // stock-source.ts:53
  if (typeof call.input.precoMax === "number") pool = pool.filter((v) => v.preco <= call.input.precoMax!);
  if (call.input.modelo) { const m = normalizeText(call.input.modelo); pool = pool.filter((v) => normalizeText(`${v.marca} ${v.modelo}`).includes(m)); }
  pool = pool.slice().sort((a, b) => a.preco - b.preco);
  return { ok: true as const, tool: "stock_search" as const, data: { items: pool, filtersUsed: call.input as any }, source: "fake" };
};

const catalog: TenantCatalog = buildTenantCatalog([RENEGADE, P2008, CRV, TIGGO2, C3, GOL]);
const extractor = new CatalogClaimExtractor(catalog);
const resolve = (m: string, stock: VehicleFact[], interp: TurnInterpretation = { relation: "asks_vehicle_detail" }) =>
  resolveExplicitSearchIntent({ leadMessage: m, claimExtractor: extractor, interpretation: interp, runQuery: sourceFor(stock) });

async function main(): Promise<void> {
  console.log("\n=== F2.7.16 Honestidade do explicit-search + slots ===\n");

  // 1) SUV com SUVs classificaveis: oferta so com SUVs (nao vaza o hatch C3/Gol -> bug do turno 2).
  {
    const r = await resolve("voces tem suv?", [RENEGADE, P2008, CRV, TIGGO2, C3, GOL]);
    const keys = r?.kind === "offer" ? r.vehicles.map((v) => v.vehicleKey) : [];
    check("SUV: oferta (nao mentira)", r?.kind === "offer", JSON.stringify(r?.kind));
    check("SUV: NAO vaza hatch C3/Gol", !keys.includes(C3.vehicleKey) && !keys.includes(GOL.vehicleKey), JSON.stringify(keys));
    check("SUV: contem Renegade+2008", keys.includes(RENEGADE.vehicleKey) && keys.includes(P2008.vehicleKey));
  }

  // 2) FINDING 1 (auditoria P1): so ha SUVs que o feed NAO classifica (ficticios) + hatches. NAO pode listar
  //    C3/Gol (tipo ERRADO) como "opcao" NEM mentir "nao tenho SUV" -> `none` + pergunta condutiva, SEM carro.
  {
    const r = await resolve("voces tem suv?", [MISTERIOA, MISTERIOB, C3, GOL]);
    check("Finding 1: kind none (nao oferta tipo errado)", r?.kind === "none", JSON.stringify(r?.kind));
    const out = r ? buildExplicitSearchTurnOutput(r, "t2") : null;
    const txt = out?.composed.text ?? "";
    check("Finding 1: NAO lista carro do tipo errado", !/c3|gol|nimbus|zenith|vega|lyra/i.test(txt), txt.slice(0, 90));
    check("Finding 1: pergunta condutiva (ampliar/outro tipo)", /amplie|outro tipo|sedan|hatch/i.test(txt), txt.slice(0, 100));
    check("Finding 1: nao e terminal-safe", !!out && out.terminalSafe === false);
  }

  // 3) FIX C: persiste tipoVeiculo + interesse nos slots (condutor nao repergunta "qual modelo/tipo?").
  {
    const r = await resolve("voces tem suv?", [RENEGADE, P2008, C3, GOL]);
    const out = r ? buildExplicitSearchTurnOutput(r, "t3") : null;
    const muts = out?.decision.decisionMutations ?? [];
    const tipo = muts.find((m: any) => m.op === "set_slot" && m.slot === "tipoVeiculo") as any;
    const inter = muts.find((m: any) => m.op === "set_slot" && m.slot === "interesse") as any;
    check("FIX C: set_slot tipoVeiculo=suv", tipo?.value === "suv", JSON.stringify(tipo));
    check("FIX C: set_slot interesse presente", !!inter && typeof inter.value === "string");
  }

  // 4) FIX C com faixa: "suv ate 60 mil" grava tambem faixaPreco.
  {
    const r = await resolve("quero um suv ate 60 mil", [RENEGADE, P2008, C3, GOL]);
    const out = r ? buildExplicitSearchTurnOutput(r, "t4") : null;
    const muts = out?.decision.decisionMutations ?? [];
    const faixa = muts.find((m: any) => m.op === "set_slot" && m.slot === "faixaPreco") as any;
    check("FIX C: set_slot faixaPreco.max=60000", faixa?.value?.max === 60000, JSON.stringify(faixa));
  }

  // 5) MODELO ausente: honestidade "nao tenho X" PRESERVADA (ausencia verificavel; sem rede de seguranca).
  {
    const r = await resolve("tem corolla?", [RENEGADE, P2008, C3, GOL], { relation: "asks_vehicle_detail", extractedEntities: { model: "corolla" } });
    check("Modelo ausente: kind none", r?.kind === "none", JSON.stringify(r?.kind));
    const out = r ? buildExplicitSearchTurnOutput(r, "t5") : null;
    check("Modelo ausente: explicit_not_found", out?.decision.reasonCode === "explicit_not_found");
    check("Modelo ausente: diz 'nao tenho'", !!out && /nao tenho/i.test(out.composed.text), out?.composed.text?.slice(0, 60));
  }

  // 6) FAIXA sem SUV na faixa: `none` condutivo, sem listar carro, sem "nao tenho SUV" flat.
  {
    const r = await resolve("quero suv ate 30 mil", [RENEGADE, P2008, CRV, TIGGO2]); // todos > 30k
    check("Faixa vazia: kind none", r?.kind === "none", JSON.stringify(r?.kind));
    const out = r ? buildExplicitSearchTurnOutput(r, "t6") : null;
    const txt = out?.composed.text ?? "";
    check("Faixa vazia: nao lista carro", !/renegade|2008|crv|tiggo/i.test(txt), txt.slice(0, 100));
    check("Faixa vazia: condutiva (ampliar/outro tipo)", /amplie|outro tipo|sedan|hatch/i.test(txt));
  }

  // 7) FINDING 1: havendo hatch barato na faixa, NAO empurrar hatch p/ quem pediu SUV -> `none`, SEM listar C3/Gol.
  {
    const r = await resolve("quero suv ate 50 mil", [CRV, TIGGO2, C3, GOL]); // C3/Gol sao HATCH, <= 50k
    check("Finding 1 faixa: kind none (nao empurra hatch)", r?.kind === "none", JSON.stringify(r?.kind));
    const out = r ? buildExplicitSearchTurnOutput(r, "t7") : null;
    const txt = out?.composed.text ?? "";
    check("Finding 1 faixa: NAO lista C3/Gol", !/\bc3\b|\bgol\b/i.test(txt), txt.slice(0, 80));
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} - ${ok} ok, ${fail} red`);
  if (fails.length) { for (const f of fails) console.log("  - " + f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
