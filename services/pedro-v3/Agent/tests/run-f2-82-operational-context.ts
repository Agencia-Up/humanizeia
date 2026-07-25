// ============================================================================
// F2.82 — CONTEXTO OPERACIONAL VERIFICADO.
//
// O contexto entrega fatos tipados à LLM antes de cada passo. Ele não contém
// instruções comerciais e não decide como responder. Esta suíte separa:
//   1. existência/referenciabilidade de um veículo;
//   2. prova de que ele é exatamente o veículo anunciado.
// ============================================================================
import {
  adFingerprintOf,
  buildGroundedFleet,
  buildOperationalContext,
  carryForwardProof,
  compactGroundedFleet,
  deriveSendMediaAvailability,
  evaluateAdIdentityProof,
  resolveAdConfirmation,
  type AdIdentityProof,
  type AdIdentityTarget,
} from "../src/domain/operational-context.ts";
import type { QueryResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    ok++;
    console.log(`  OK  ${name}`);
    return;
  }
  fail++;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const AD_KEY = "revendamais:8251676";
const OTHER_KEY = "revendamais:9999999";
const AD_IDENTITY = "Jeep Compass Limited Diesel 4x4 2021";
const AD_TARGET: AdIdentityTarget = {
  identity: AD_IDENTITY,
  marca: "Jeep",
  modelo: "Compass",
  ano: 2021,
  variantTokens: ["limited", "diesel", "4x4"],
};
const AD_FP = adFingerprintOf({ adId: "ad-compass", identity: AD_IDENTITY });

function vehicle(
  vehicleKey: string,
  marca: string,
  modelo: string,
  ano: number,
  versao: string | null = null,
): VehicleFact {
  return {
    vehicleKey,
    marca,
    modelo,
    versao,
    ano,
    preco: 100_000,
    km: 50_000,
    cambio: "Automatico",
    cor: "Prata",
    tipo: "suv",
    combustivel: versao?.toLowerCase().includes("diesel") ? "diesel" : undefined,
  };
}

const COMPASS = vehicle(AD_KEY, "Jeep", "Compass", 2021, "Limited Diesel 4x4");
const RENEGADE = vehicle(OTHER_KEY, "Jeep", "Renegade", 2020, "Longitude Flex");

function search(
  items: VehicleFact[],
  filtersUsed: Record<string, unknown> = {},
  familyCandidates: VehicleFact[] = [],
): QueryResult {
  return {
    ok: true,
    tool: "stock_search",
    source: "fixture",
    data: {
      items,
      filtersUsed,
      matchKind: items.length > 0 ? "exact" : familyCandidates.length > 0 ? "family_candidate" : "none",
      familyCandidates,
      absenceScope: Object.keys(filtersUsed).length > 0 ? "restricted" : "global",
    },
  } as QueryResult;
}

function failedSearch(): QueryResult {
  return {
    ok: false,
    tool: "stock_search",
    error: { code: "UPSTREAM", message: "fonte indisponível", retryable: true },
  } as QueryResult;
}

function details(v: VehicleFact): QueryResult {
  return { ok: true, tool: "vehicle_details", source: "fixture", data: { vehicle: v } } as QueryResult;
}

function photos(vehicleKey: string): QueryResult {
  return {
    ok: true,
    tool: "vehicle_photos_resolve",
    source: "fixture",
    data: { vehicleKey, ambiguous: false, photoIds: ["p1"] },
  } as QueryResult;
}

const CAPS = {
  sendMessage: true,
  sendMedia: true as boolean | null,
  handoff: false,
  automatedLeadFollowupEnabled: null,
};

function operational(input: {
  facts: QueryResult[];
  proof?: AdIdentityProof | null;
  previous?: { vehicleKey: string; marca?: string | null; modelo?: string | null; ano?: number | null }[];
  previousGrounded?: { vehicleKey: string; marca?: string | null; modelo?: string | null; versao?: string | null; ano?: number | null; referenceable: true }[];
  executionFailures?: string[];
}) {
  const fleet = buildGroundedFleet({
    previousGroundedVehicles: input.previousGrounded ?? [],
    previousOfferItems: input.previous ?? [],
    facts: input.facts,
  });
  const confirmation = resolveAdConfirmation({
    proof: input.proof ?? null,
    groundedKeys: fleet.map((v) => v.vehicleKey),
  });
  return {
    fleet,
    context: buildOperationalContext({
      facts: input.facts,
      executionFailures: input.executionFailures ?? [],
      groundedVehicleKeys: fleet.map((v) => v.vehicleKey),
      capabilities: CAPS,
      ad: {
        identity: AD_IDENTITY,
        confidence: 0.9,
        referenceKey: confirmation.vehicleKey,
      },
    }),
  };
}

function main(): void {
  console.log("== F2.82: contexto operacional verificado ==");

  const before = operational({ facts: [] });
  check("[1] anúncio declarado não equivale a disponibilidade confirmada",
    before.context.ad.identity === AD_IDENTITY
    && before.context.ad.inventoryConfirmed === false
    && before.context.ad.vehicleKey === null,
    JSON.stringify(before.context.ad));
  check("[1a] ausência de consulta é not_queried, nunca estoque vazio",
    before.context.stock.status === "not_queried" && before.context.stock.resultCount === 0);

  const exactFact = search([COMPASS], { marca: "Jeep", modelo: "Compass", anos: [2021] });
  const exactEvaluation = evaluateAdIdentityProof({ adFingerprint: AD_FP, target: AD_TARGET, facts: [exactFact] });
  const exact = operational({ facts: [exactFact], proof: exactEvaluation.proof });
  check("[2] busca direcionada + versão factual produz prova exata",
    exactEvaluation.status === "exact" && exactEvaluation.proof?.vehicleKey === AD_KEY,
    JSON.stringify(exactEvaluation));
  check("[2a] prova exata + chave aterrada confirma inventário",
    exact.context.ad.inventoryConfirmed === true && exact.context.ad.vehicleKey === AD_KEY,
    JSON.stringify(exact.context.ad));
  check("[2b] stock descreve a consulta executada, não a intenção",
    exact.context.stock.status === "queried"
    && exact.context.stock.scope === "restricted"
    && exact.context.stock.filtersApplied.modelo === "Compass"
    && exact.context.stock.resultCount === 1,
    JSON.stringify(exact.context.stock));

  const wrongFact = search([RENEGADE], { tipo: "suv" });
  const wrongEvaluation = evaluateAdIdentityProof({ adFingerprint: AD_FP, target: AD_TARGET, facts: [wrongFact] });
  const wrong = operational({ facts: [wrongFact], proof: wrongEvaluation.proof });
  check("[3] único resultado errado não confirma o anúncio por contagem",
    wrongEvaluation.status === "not_observed"
    && wrong.context.ad.inventoryConfirmed === false
    && wrong.context.ad.vehicleKey === null);

  const exactPlusAlternative = search([COMPASS, RENEGADE], { marca: "Jeep", modelo: "Compass", anos: [2021] });
  const mixedEvaluation = evaluateAdIdentityProof({ adFingerprint: AD_FP, target: AD_TARGET, facts: [exactPlusAlternative] });
  const mixed = operational({ facts: [exactPlusAlternative], proof: mixedEvaluation.proof });
  check("[4] veículo exato continua confirmável quando a tool também retorna alternativa",
    mixedEvaluation.status === "exact"
    && mixed.context.ad.inventoryConfirmed === true
    && mixed.context.ad.vehicleKey === AD_KEY,
    JSON.stringify(mixedEvaluation));

  const carried = carryForwardProof(exactEvaluation.proof, AD_FP);
  const secondSearch = search([RENEGADE], { tipo: "suv", precoMax: 90_000 });
  const secondEvaluation = evaluateAdIdentityProof({ adFingerprint: AD_FP, target: AD_TARGET, facts: [secondSearch] });
  const afterSecond = operational({
    facts: [secondSearch],
    proof: secondEvaluation.status === "not_observed" ? carried : secondEvaluation.proof,
    previous: [{ vehicleKey: AD_KEY, marca: "Jeep", modelo: "Compass", ano: 2021 }],
  });
  check("[5] busca não relacionada não apaga prova anterior do mesmo anúncio",
    secondEvaluation.status === "not_observed"
    && afterSecond.context.ad.inventoryConfirmed === true
    && afterSecond.context.ad.vehicleKey === AD_KEY);
  check("[5a] stock ainda descreve somente a última busca",
    afterSecond.context.stock.vehicleKeys.length === 1
    && afterSecond.context.stock.vehicleKeys[0] === OTHER_KEY
    && afterSecond.context.stock.filtersApplied.precoMax === 90_000);

  const previousOnly = operational({
    facts: [],
    previous: [{ vehicleKey: AD_KEY, marca: "Jeep", modelo: "Compass", ano: 2021 }],
  });
  check("[6] oferta anterior sozinha prova existência, não versão anunciada",
    previousOnly.fleet.some((v) => v.vehicleKey === AD_KEY)
    && previousOnly.context.ad.inventoryConfirmed === false);
  const previousWithProof = operational({
    facts: [],
    proof: carried,
    previous: [{ vehicleKey: AD_KEY, marca: "Jeep", modelo: "Compass", ano: 2021 }],
  });
  check("[6a] oferta anterior + prova exata persistida confirma sem nova consulta",
    previousWithProof.context.ad.inventoryConfirmed === true
    && previousWithProof.context.stock.status === "not_queried");

  const persistedExistenceWithProof = operational({
    facts: [],
    proof: carried,
    previousGrounded: [{
      vehicleKey: AD_KEY,
      marca: "Jeep",
      modelo: "Compass",
      versao: "Limited Diesel 4x4",
      ano: 2021,
      referenceable: true,
    }],
  });
  check("[6b] veiculo aterrado no turno anterior + prova exata confirma sem nova busca nem lista",
    persistedExistenceWithProof.context.ad.inventoryConfirmed === true
    && persistedExistenceWithProof.context.ad.vehicleKey === AD_KEY
    && persistedExistenceWithProof.context.stock.status === "not_queried");

  const persistedExistenceWithoutProof = operational({
    facts: [],
    previousGrounded: [{
      vehicleKey: AD_KEY,
      marca: "Jeep",
      modelo: "Compass",
      versao: "Limited Diesel 4x4",
      ano: 2021,
      referenceable: true,
    }],
  });
  check("[6c] persistir existencia nunca promove sozinho a identidade do anuncio",
    persistedExistenceWithoutProof.fleet.some((v) => v.vehicleKey === AD_KEY)
    && persistedExistenceWithoutProof.context.ad.inventoryConfirmed === false
    && persistedExistenceWithoutProof.context.ad.vehicleKey === null);

  const familyFact = search([], { modelo: "Compass", anos: [2021] }, [vehicle("rm:family", "Jeep", "Compass", 2021, "Sport Flex")]);
  const familyEvaluation = evaluateAdIdentityProof({ adFingerprint: AD_FP, target: AD_TARGET, facts: [familyFact] });
  const family = operational({ facts: [familyFact], proof: familyEvaluation.proof });
  check("[7] candidato de família é referenciável, mas não confirma a versão",
    family.fleet.length === 1
    && familyEvaluation.status === "family_only"
    && family.context.ad.inventoryConfirmed === false,
    JSON.stringify(familyEvaluation));

  const photoOnly = operational({ facts: [photos(AD_KEY)] });
  check("[8] foto aterra a chave, mas não promove identidade do anúncio",
    photoOnly.fleet.some((v) => v.vehicleKey === AD_KEY)
    && photoOnly.context.ad.inventoryConfirmed === false);
  const detailsOnly = operational({ facts: [details(COMPASS)] });
  check("[8a] detalhe aterra o veículo, mas sem prova de busca não confirma o anúncio",
    detailsOnly.fleet.some((v) => v.vehicleKey === AD_KEY)
    && detailsOnly.context.ad.inventoryConfirmed === false);

  const compacted = compactGroundedFleet([
    { vehicleKey: "old:1", referenceable: true },
    { vehicleKey: AD_KEY, marca: "Jeep", modelo: "Compass", ano: 2021, referenceable: true },
    { vehicleKey: "new:1", referenceable: true },
  ], [AD_KEY], 2);
  check("[8b] compactacao limitada preserva a chave preferida sem alterar sua semantica",
    compacted.length === 2
    && compacted[0]?.vehicleKey === AD_KEY
    && compacted.every((v) => v.referenceable === true),
    JSON.stringify(compacted));

  const failed = operational({ facts: [failedSearch()], executionFailures: ["stock_search"] });
  check("[9] falha real de execução vira stock.failed", failed.context.stock.status === "failed");
  const blocked = operational({ facts: [], executionFailures: [] });
  check("[9a] tool bloqueada antes do adapter não finge falha da fonte", blocked.context.stock.status === "not_queried");

  check("[10] automotivo com rota e tool de fotos recebe sendMedia=true",
    deriveSendMediaAvailability({ mediaDeliveryAvailable: true, photosToolAllowed: true }) === true);
  check("[10a] SDR geral sem tool de fotos recebe sendMedia=false",
    deriveSendMediaAvailability({ mediaDeliveryAvailable: true, photosToolAllowed: false }) === false);
  check("[10b] disponibilidade não informada permanece desconhecida",
    deriveSendMediaAvailability({ mediaDeliveryAvailable: null, photosToolAllowed: true }) === null);

  check("[11] capacidades distinguem tarefa individual de follow-up comercial",
    before.context.capabilities.appointmentBooking === false
    && before.context.capabilities.deferredFactCheckTask === false
    && before.context.capabilities.individualDeferredCallbackTask === false
    && before.context.capabilities.automatedLeadFollowupEnabled === null
    && !("agentAsyncReturn" in (before.context.capabilities as Record<string, unknown>)));

  const serialized = JSON.stringify(before.context);
  check("[12] contexto é dado neutro, sem instrução de condução",
    !/pergunte|ofereça|ofereca|conduza|diga |responda |transfira/i.test(serialized), serialized);

  console.log(`\n== F2.82: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) {
    console.error("FALHAS:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main();
