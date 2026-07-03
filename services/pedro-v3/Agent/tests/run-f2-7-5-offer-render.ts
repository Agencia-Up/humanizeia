// ============================================================================
// F2.7.5 — Renderizacao WhatsApp de ofertas (deterministica). $0, sem rede.
//   npx tsx tests/run-f2-7-5-offer-render.ts
//
// Prova: lista numerada, BRL, km BR, campos ausentes sem buraco, grounding (falha
// fechada em chave inexistente), e que refs NUNCA mais grudam ("ONIX2014Ele").
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ConversationState } from "../src/domain/conversation-state.ts";
import { renderVehicleOfferList, formatBRL, formatKm } from "../src/engine/vehicle-offer-render.ts";
import { ResponseRenderer } from "../src/engine/response-renderer.ts";
import { runTurn } from "../src/engine/decision-engine.ts";
import type { QueryRunner } from "../src/engine/decision-engine.ts";
import { FakeLlm } from "../src/adapters/llm/fake-llm.ts";
import type { ComposeOverride } from "../src/adapters/llm/fake-llm.ts";
import { buildTenantCatalog, normalizeText } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { DecisionStep, QueryResult, ResponseDraft, TenantCatalog, TurnInterpretation } from "../src/domain/decision.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const NOW = "2026-06-30T13:00:00.000Z";
let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name} — ${detail}`); console.log(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const baseState = (over: Partial<ConversationState> = {}): ConversationState => ({
  ...createInitialState({ conversationId: "c1", tenantId: "icom", agentId: "aloan", leadId: "lead1", now: NOW }),
  ...over,
});

const ONIX: VehicleFact = { vehicleKey: "chevrolet|onix|2014", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 71990, km: 132623, tipo: "hatch", photoIds: ["p1"] };
const RENEGADES: VehicleFact[] = [
  { vehicleKey: "jeep|renegade|2016", marca: "Jeep", modelo: "Renegade", ano: 2016, preco: 71990, km: 98000, tipo: "suv" },
  { vehicleKey: "jeep|renegade|2018", marca: "Jeep", modelo: "Renegade", ano: 2018, preco: 72990, km: 80000, tipo: "suv" },
  { vehicleKey: "jeep|renegade|2021", marca: "Jeep", modelo: "Renegade", ano: 2021, preco: 82990, km: 45000, tipo: "suv" },
  { vehicleKey: "jeep|renegade|2023", marca: "Jeep", modelo: "Renegade", ano: 2023, preco: 106990, km: 12000, tipo: "suv" },
];
const STOCK: VehicleFact[] = [ONIX, ...RENEGADES];
const catalog: TenantCatalog = buildTenantCatalog(STOCK);
const extractor = new CatalogClaimExtractor(catalog);

const runQuery: QueryRunner = async (call) => {
  if (call.tool === "stock_search") {
    const modelo = call.input.modelo ? normalizeText(call.input.modelo) : null;
    const items = STOCK.filter((v) => (!modelo || normalizeText(v.modelo).includes(modelo) || modelo.includes(normalizeText(v.modelo))));
    return { ok: true as const, tool: "stock_search" as const, data: { items, filtersUsed: call.input as any }, source: "fake" };
  }
  return { ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult;
};
const limits = { maxSteps: 4, totalTimeoutMs: 5000 };
function ctx(leadMessage: string, turnId: string, interpretation: TurnInterpretation): TurnContext {
  return { state: baseState(), turnId, leadMessage, now: NOW, interpretation, tenantCatalog: catalog, claimExtractor: extractor };
}
const stockFacts = (items: VehicleFact[]): QueryResult[] => [{ ok: true, tool: "stock_search", data: { items, filtersUsed: {} }, source: "fake" }];
const GLUE = /[A-Za-z]\d{4}[A-Za-z]|\d{3}R\$|R\$\s?[\d.]+[A-Za-z]|[\u00C3\u00C2\uFFFD]/u; // "ONIX2014Ele", "990R$", "R$ 71.990RENEGADE", mojibake
const offerListOverride: ComposeOverride = (_d, facts) => {
  const keys: string[] = [];
  for (const f of facts) if (f.ok && f.tool === "stock_search") for (const v of f.data.items) keys.push(v.vehicleKey);
  return { parts: [{ type: "text", content: "Temos sim! Encontrei estas opcoes no estoque:" }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer ver fotos de algum deles ou prefere filtrar por ano/faixa de preco?" }] };
};

async function main(): Promise<void> {
  console.log("\n=== F2.7.5 Renderizacao de ofertas WhatsApp ===\n");

  // 1) 1 veiculo nao gruda modelo/ano/texto
  {
    const out = renderVehicleOfferList([ONIX]);
    check("1 veiculo: nome com espacos (nao 'Onix2014')", out.includes("Chevrolet Onix 2014") && !GLUE.test(out), out);
    check("1 veiculo: numerado '1.'", out.startsWith("1. "));
    check("1 veiculo: detalhe km em linha propria indentada", out.includes("\n   132.623 km"), out);
  }

  // 2) multiplos -> lista numerada
  {
    const out = renderVehicleOfferList(RENEGADES);
    check("multiplos: 1./2./3./4. numerados", ["1. ", "2. ", "3. ", "4. "].every((n) => out.includes(n)));
    check("multiplos: cada item 'Jeep Renegade ANO'", (out.match(/Jeep Renegade 20\d\d/g) ?? []).length === 4, out);
    check("multiplos: itens separados por linha em branco", out.includes("\n\n"));
    check("multiplos: nada grudado", !GLUE.test(out), out);
  }

  // 3) preco BRL correto
  {
    check("BRL 71990 -> 'R$ 71.990'", formatBRL(71990) === "R$ 71.990", formatBRL(71990));
    check("BRL 106990 -> 'R$ 106.990'", formatBRL(106990) === "R$ 106.990", formatBRL(106990));
    check("offer cita preco BRL", renderVehicleOfferList([ONIX]).includes("R$ 71.990"));
  }

  // 4) km BR correto
  {
    check("km 132623 -> '132.623'", formatKm(132623) === "132.623", formatKm(132623));
  }

  // 4b) detalhes comerciais: cambio e cor entram na linha de detalhes
  {
    const detailed: VehicleFact = { ...ONIX, cambio: "Automatico", cor: "Prata" };
    const out = renderVehicleOfferList([detailed]);
    check("detalhes incluem km, cambio e cor", out.includes("132.623 km") && out.includes("Automatico") && out.includes("Prata"), out);
  }
  // 5) campos ausentes nao quebram layout
  {
    const semKm: VehicleFact = { vehicleKey: "x|y|2020", marca: "Marca", modelo: "Modelo", ano: 2020, preco: 50000, tipo: "sedan" };
    const out1 = renderVehicleOfferList([semKm]);
    check("sem km: sem undefined e sem separador solto", !out1.includes("undefined") && !out1.includes(" | ") && !/\n {3}$/.test(out1), out1);
    check("sem km: so o titulo (uma linha)", out1 === "1. Marca Modelo 2020 - R$ 50.000", JSON.stringify(out1));
    const kmZero: VehicleFact = { vehicleKey: "x|km0|2020", marca: "Marca", modelo: "Zero", ano: 2020, preco: 50000, km: 0, tipo: "sedan" };
    const outKm0 = renderVehicleOfferList([kmZero]);
    check("km 0: omite quilometragem em vez de mostrar 0 km", !outKm0.includes("0 km") && outKm0 === "1. Marca Zero 2020 - R$ 50.000", JSON.stringify(outKm0));
    const semPreco: VehicleFact = { vehicleKey: "x|z|2019", marca: "Marca", modelo: "Zeta", ano: 2019, preco: 0, tipo: "sedan" };
    check("preco 0 -> preco a confirmar (nunca R$ 0)", renderVehicleOfferList([semPreco]).includes("preco a confirmar") && !renderVehicleOfferList([semPreco]).includes("R$ 0"), renderVehicleOfferList([semPreco]));
    const semAno: VehicleFact = { vehicleKey: "x|w|0", marca: "Marca", modelo: "Wagon", ano: 0, preco: 60000, tipo: "sedan" };
    check("ano ausente: nao inventa ano", renderVehicleOfferList([semAno]) === "1. Marca Wagon - R$ 60.000", JSON.stringify(renderVehicleOfferList([semAno])));
  }

  // 5b) maxItems limita a lista
  {
    const many = [...RENEGADES, ...RENEGADES]; // 8
    check("limite default 5 itens", (renderVehicleOfferList(many).match(/^\d+\. /gm) ?? []).length === 5);
    check("opcao maxItems=3", (renderVehicleOfferList(many, { maxItems: 3 }).match(/^\d+\. /gm) ?? []).length === 3);
  }

  // 6) vehicleKey inexistente -> render falha fechado
  {
    const draft: ResponseDraft = { parts: [{ type: "text", content: "ok" }, { type: "vehicle_offer_list", vehicleKeys: ["marca|inventada|2099"] }] };
    let threw = false;
    try { ResponseRenderer.render(draft, stockFacts([ONIX]), baseState()); } catch { threw = true; }
    check("6 chave fora dos fatos -> render falha fechado", threw);
  }

  // 6b) anti-glue do renderer geral (vehicle_ref adjacentes + texto)
  {
    const draft: ResponseDraft = { parts: [
      { type: "text", content: "Temos disponivel este modelo aqui para voce:" },
      { type: "vehicle_ref", vehicleKey: ONIX.vehicleKey, field: "modelo" },
      { type: "vehicle_ref", vehicleKey: ONIX.vehicleKey, field: "ano" },
      { type: "text", content: "Ele esta otimo." },
    ] };
    const text = ResponseRenderer.render(draft, stockFacts([ONIX]), baseState());
    check("6b refs adjacentes NAO grudam ('voce: Onix 2014 Ele')", !GLUE.test(text) && text.includes("voce: Onix") && text.includes("2014 Ele"), text);
  }

  // 7) "so tem um?" usa os resultados (offer_list) e nao inventa
  {
    const draft: ResponseDraft = { parts: [{ type: "text", content: "Alem desse, tenho estas opcoes:" }, { type: "vehicle_offer_list", vehicleKeys: STOCK.map((v) => v.vehicleKey) }] };
    const text = ResponseRenderer.render(draft, stockFacts(STOCK), baseState());
    check("7 lista renderiza so veiculos dos fatos", text.includes("Chevrolet Onix 2014") && (text.match(/Jeep Renegade/g) ?? []).length === 4 && !GLUE.test(text), text);
  }

  // 8) "tem renegade?" -> pre-seed + offer_list -> lista real, sem grude, sem terminal-safe (fluxo completo)
  {
    const llm = new FakeLlm();
    llm.setTurnScript([
      { kind: "final", proposal: { proposedAction: "reply", facts: [], proposedEffects: [{ kind: "send_message", planId: "m1", order: 0, onSuccess: [] } as any], responsePlan: { guidance: "apresentar renegades" }, reasonCode: "reply", reasonSummary: "", confidence: 0.8 } },
    ] as DecisionStep[], offerListOverride);
    const out = await runTurn({ ctx: ctx("tem renegade?", "t8", { relation: "asks_vehicle_detail", extractedEntities: { model: "renegade" } }), llm, runQuery, limits, maxValidationAttempts: 2 });
    check("8 'tem renegade?' NAO cai em terminal-safe", out.terminalSafe === false, out.composed.text);
    check("8 resposta e lista numerada real (>=4 renegades, sem grude)", (out.composed.text.match(/Jeep Renegade 20\d\d/g) ?? []).length >= 4 && !GLUE.test(out.composed.text), out.composed.text);
    check("8 intro + lista + pergunta de conducao", out.composed.text.includes("Encontrei estas opcoes") && /Quer ver fotos|filtrar/.test(out.composed.text), out.composed.text);
  }

  console.log(`\n=== F2.7.5: ${ok} OK | ${fail} FALHA ===`);
  if (fail > 0) { for (const f of fails) console.error("  - " + f); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
