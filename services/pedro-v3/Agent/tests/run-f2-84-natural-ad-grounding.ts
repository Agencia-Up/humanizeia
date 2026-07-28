// ============================================================================
// F2.84 — AUTORIA NATURAL COM GROUNDING E IDENTIDADE DECLARADA PELO ANÚNCIO.
//
// O anúncio pode declarar a identidade que trouxe o lead. Isso autoriza a LLM
// a NOMEÁ-LA naturalmente, mas não prova disponibilidade, chave, preço ou
// atributos. Depois de uma busca, a LLM pode citar naturalmente um único carro
// inequivocamente aterrado, sem ser obrigada a converter toda prosa em parts.
// ============================================================================
import { readFileSync } from "node:fs";
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";
import type { TurnContext } from "../src/domain/context.ts";
import type { QueryResult, RenderedResponse, TurnDecision } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { buildAdDeclaredVehicleIdentity, buildAdIdentityTarget } from "../src/engine/ad-context.ts";
import { draftNaturallyReferencesSingleFreshVehicle } from "../src/engine/draft-grounding.ts";
import { PolicyEngine } from "../src/engine/policy-engine.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); return; }
  fail++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const COMPASS: VehicleFact = {
  vehicleKey: "rm:compass", marca: "Jeep", modelo: "Compass", ano: 2021,
  preco: 121400, km: 74652, cambio: "Automatico", cor: "Prata", tipo: "suv",
};
const COMPASS_2: VehicleFact = { ...COMPASS, vehicleKey: "rm:compass-2", ano: 2022, preco: 132900 };
const KA: VehicleFact = {
  vehicleKey: "rm:ka", marca: "Ford", modelo: "Ka", ano: 2019,
  preco: 63990, km: 119443, cambio: "Automatico", cor: "Prata", tipo: "hatch",
};
const AUDI_A3: VehicleFact = {
  vehicleKey: "rm:audi-a3", marca: "Audi", modelo: "A3", ano: 2020,
  preco: 129900, km: 61000, cambio: "Automatico", cor: "Preto", tipo: "sedan",
};
const MERCEDES_C180: VehicleFact = {
  vehicleKey: "rm:mercedes-c180", marca: "Mercedes-Benz", modelo: "C180", ano: 2019,
  preco: 169900, km: 72000, cambio: "Automatico", cor: "Branco", tipo: "sedan",
};
const SUZUKI_SCROSS: VehicleFact = {
  vehicleKey: "rm:suzuki-scross", marca: "Suzuki", modelo: "S-Cross", ano: 2021,
  preco: 109900, km: 58000, cambio: "Automatico", cor: "Cinza", tipo: "suv",
};
const LAND_ROVER_EVOQUE: VehicleFact = {
  vehicleKey: "rm:evoque", marca: "Land Rover", modelo: "Evoque", ano: 2018,
  preco: 154900, km: 83000, cambio: "Automatico", cor: "Preto", tipo: "suv",
};
const catalog = buildTenantCatalog([
  COMPASS, COMPASS_2, KA, AUDI_A3, MERCEDES_C180, SUZUKI_SCROSS, LAND_ROVER_EVOQUE,
]);
const extractor = new CatalogClaimExtractor(catalog);
const state = createInitialState({ conversationId: "c", tenantId: "t", agentId: "a", leadId: null, now: "2026-07-25T12:00:00.000Z" });
const baseCtx: TurnContext = {
  state, turnId: "turn", leadMessage: "Olá, vim pelo anúncio.", now: "2026-07-25T12:00:00.000Z",
  interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor,
};
const ad = (vehicleQuery: string | null): AdContext => ({
  adId: "ad-1", source: "facebook", sourceUrl: null, title: "Oferta da loja",
  body: "Veiculos revisados e prontos para voce.", greeting: "Ola! Como podemos ajudar?",
  imageUrls: [], vehicleQuery, vehicleType: null, summary: null, confidence: 1,
  semanticSource: "image", capturedAtTurn: 0,
});
const ctxForAd = (vehicleQuery: string): TurnContext => {
  const declared = buildAdDeclaredVehicleIdentity(ad(vehicleQuery));
  if (!declared) throw new Error(`identity not declared: ${vehicleQuery}`);
  return { ...baseCtx, declaredVehicleIdentities: [declared] };
};
const adCtx = ctxForAd("Jeep Compass Limited Diesel 4x4 2021");
const decision = { effectPlan: [], reasonCode: "reply" } as unknown as TurnDecision;
const say = (text: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: text }] }, text });
const policyDenied = (policyId: string, response: RenderedResponse, facts: QueryResult[], ctx: TurnContext): boolean =>
  PolicyEngine.validateResponse(response, facts, decision, ctx, true).some((v) => v.policyId === policyId && v.outcome === "deny");
const stockFact = (items: VehicleFact[]): QueryResult => ({
  ok: true, tool: "stock_search", source: "fake", data: { items, filtersUsed: { modelo: "Compass" } },
} as QueryResult);

async function main(): Promise<void> {
  console.log("== F2.84: autoria natural com grounding ==");

  check("[A1] modelo sem fonte nem fato continua bloqueado",
    policyDenied("POL-GROUND-STOCK", say("O Jeep Compass é o veículo do anúncio."), [], baseCtx));
  check("[A2] identidade estruturada do anúncio pode ser nomeada naturalmente",
    !policyDenied("POL-GROUND-STOCK", say("O Jeep Compass é o veículo do anúncio."), [], adCtx));
  check("[A3] anúncio do Compass não autoriza nomear outro carro",
    policyDenied("POL-GROUND-STOCK", say("O Ford Ka é o veículo do anúncio."), [], adCtx));
  check("[A4] identidade declarada não aterra preço",
    policyDenied("POL-GROUND-PRICE", say("O Jeep Compass está por R$ 121.400."), [], adCtx));
  const inventedRef: RenderedResponse = {
    draft: { parts: [{ type: "vehicle_ref", vehicleKey: "invented:key", field: "modelo" }] },
    text: "Jeep Compass",
  };
  check("[A5] identidade declarada não aterra vehicleKey inventada",
    policyDenied("POL-GROUND-STOCK", inventedRef, [], adCtx));

  const identitiesOutsideFiniteTaxonomy = [
    { label: "Audi A3 2020", response: "O Audi A3 2020 foi o carro que voce viu no anuncio." },
    { label: "Mercedes-Benz C180 2019", response: "A Mercedes-Benz C180 2019 foi o carro do anuncio." },
    { label: "Suzuki S-Cross 2021", response: "O Suzuki S-Cross 2021 foi o carro anunciado." },
    { label: "Land Rover Evoque 2018", response: "O Land Rover Evoque 2018 foi o carro do anuncio." },
  ];
  for (const [index, example] of identitiesOutsideFiniteTaxonomy.entries()) {
    const declared = buildAdDeclaredVehicleIdentity(ad(example.label));
    check(`[A${6 + index * 3}] identidade declarada independe da taxonomia: ${example.label}`,
      declared?.label === example.label && declared.source === "paid_ad");
    check(`[A${7 + index * 3}] prova exata nao e fabricada para taxonomia desconhecida: ${example.label}`,
      buildAdIdentityTarget(ad(example.label)) == null);
    check(`[A${8 + index * 3}] policy aceita a identidade estruturada: ${example.label}`,
      !policyDenied("POL-GROUND-STOCK", say(example.response), [], ctxForAd(example.label)));
  }
  check("[A18] identidade desconhecida nao autoriza outra marca/modelo",
    policyDenied("POL-GROUND-STOCK", say("O Ford Ka foi o carro do anuncio."), [], ctxForAd("Audi A3 2020")));
  check("[A19] identidade desconhecida nao autoriza preco sem fato",
    policyDenied("POL-GROUND-PRICE", say("O Audi A3 esta por R$ 129.900."), [], ctxForAd("Audi A3 2020")));
  check("[A20] anuncio institucional sem veiculo nao cria identidade",
    buildAdDeclaredVehicleIdentity(ad(null)) == null);
  const centralSource = readFileSync(new URL("../src/engine/central-engine.ts", import.meta.url), "utf8");
  check("[A21] engine entrega a declaracao real ao policy context",
    /declaredVehicleIdentities:\s*adDeclaredIdentity\s*\?\s*\[adDeclaredIdentity\]/.test(centralSource));
  check("[A22] engine entrega a declaracao real ao contexto operacional da LLM",
    /identity:\s*adDeclaredIdentity\?\.label\s*\?\?/.test(centralSource));

  check("[B1] um único veículo fresco pode ser citado em linguagem natural",
    draftNaturallyReferencesSingleFreshVehicle({ draft: say("Encontrei o Jeep Compass 2021.").draft, freshVehicles: [COMPASS], claimExtractor: extractor }));
  check("[B2] citar só a marca não escolhe um veículo",
    !draftNaturallyReferencesSingleFreshVehicle({ draft: say("Temos Jeep no estoque.").draft, freshVehicles: [COMPASS], claimExtractor: extractor }));
  check("[B3] modelo diferente não usa o fato fresco",
    !draftNaturallyReferencesSingleFreshVehicle({ draft: say("Encontrei um Ford Ka.").draft, freshVehicles: [COMPASS], claimExtractor: extractor }));
  check("[B4] dois resultados do mesmo modelo permanecem ambíguos",
    !draftNaturallyReferencesSingleFreshVehicle({ draft: say("Encontrei o Jeep Compass.").draft, freshVehicles: [COMPASS, COMPASS_2], claimExtractor: extractor }));
  check("[B5] entre modelos distintos, nome inequívoco escolhe somente o citado",
    draftNaturallyReferencesSingleFreshVehicle({ draft: say("Encontrei o Jeep Compass.").draft, freshVehicles: [COMPASS, KA], claimExtractor: extractor }));
  check("[B6] o fato fresco sustenta a identidade, mas o preço continua validado separadamente",
    !policyDenied("POL-GROUND-STOCK", say("Encontrei o Jeep Compass 2021."), [stockFact([COMPASS])], baseCtx)
      && policyDenied("POL-GROUND-PRICE", say("Encontrei o Jeep Compass por R$ 999.999."), [stockFact([COMPASS])], baseCtx));

  console.log(`\nF2.84: ${ok} OK / ${fail} FALHA`);
  if (fail) { console.error(failures.join("\n")); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
