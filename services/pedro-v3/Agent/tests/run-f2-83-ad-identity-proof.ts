// F2.83 — anúncio: existência referenciável e prova exata de identidade são eixos independentes.
import {
  adFingerprintOf, buildGroundedFleet, carryForwardProof, evaluateAdIdentityProof,
  resolveAdConfirmation, stockSearchProofFingerprint, type AdIdentityProof, type AdIdentityTarget,
} from "../src/domain/operational-context.ts";
import { buildAdIdentityTarget } from "../src/engine/ad-context.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";
import type { QueryResult } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";
import { createReadQueryRunner } from "../src/engine/read-query-runner.ts";

let ok = 0, fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const vehicle = (key: string, modelo: string, ano: number, versao?: string): VehicleFact => ({
  vehicleKey: key, marca: modelo === "Grand Siena" ? "Fiat" : "Hyundai", modelo, versao,
  ano, preco: 55_000, km: 60_000, cambio: "Manual", cor: "Branco", tipo: "hatch",
});
const HB20_EXACT = vehicle("hb20-exact", "HB20", 2017, "Confort Plus 1.0 Flex");
const HB20_BASE = vehicle("hb20-base", "HB20", 2017);
const HB20_WRONG = vehicle("hb20-wrong", "HB20", 2017, "Comfort Style");
const RANGER_PROVIDER_FORMAT: VehicleFact = {
  vehicleKey: "bndv:ranger-limited-plus",
  marca: "Ford",
  modelo: "Ranger",
  versao: "LIMITED+ 3.0 V 6 4 X 4 CD TB DIE AUT",
  ano: 2025,
  preco: 299_900,
  km: 42_597,
  cambio: "Automatico",
  combustivel: "diesel",
  combustivelLabel: "Diesel",
  cor: "Cinza",
  tipo: "pickup",
};

const search = (items: VehicleFact[], filtersUsed: Record<string, unknown>, family: VehicleFact[] = []): QueryResult => ({
  ok: true, tool: "stock_search", source: "fixture",
  data: {
    items, filtersUsed,
    matchKind: items.length ? "exact" : family.length ? "family_candidate" : "none",
    ...(family.length ? { familyCandidates: family } : {}),
  },
} as QueryResult);
const details = (v: VehicleFact): QueryResult => ({ ok: true, tool: "vehicle_details", source: "fixture", data: { vehicle: v } } as QueryResult);
const photos = (key: string): QueryResult => ({ ok: true, tool: "vehicle_photos_resolve", source: "fixture", data: { vehicleKey: key, ambiguous: false, photoIds: ["p1"] } } as QueryResult);

const TARGET: AdIdentityTarget = {
  identity: "Hyundai HB20 Confort Plus 2017", marca: "Hyundai", modelo: "HB20", ano: 2017,
  variantTokens: ["confort", "plus"],
};
const FP = adFingerprintOf({ adId: "ad-1", identity: TARGET.identity });
const evaluate = (facts: QueryResult[], target: AdIdentityTarget | null = TARGET) =>
  evaluateAdIdentityProof({ adFingerprint: target ? FP : "", target, facts });
const confirm = (proof: AdIdentityProof | null, facts: QueryResult[] = [], previous: Array<{ vehicleKey: string; marca?: string; modelo?: string; ano?: number }> = []) =>
  resolveAdConfirmation({ proof, groundedKeys: buildGroundedFleet({ previousOfferItems: previous, facts }).map((v) => v.vehicleKey) });

function ad(vehicleQuery: string): AdContext {
  return { adId: "ad-1", source: "facebook", sourceUrl: null, title: null, body: null, greeting: null,
    imageUrls: [], vehicleQuery, confidence: 1, semanticSource: "image", capturedAtTurn: 1 };
}

async function main(): Promise<void> {
  console.log("== F2.83: ad identity proof ==");

  const parsed = buildAdIdentityTarget(ad("Hyundai HB20 Confort Plus 2017"));
  check("[T1] extração separa modelo-base de versão", parsed?.modelo === "HB20" && parsed.variantTokens.join("|") === "confort|plus", JSON.stringify(parsed));
  const compound = buildAdIdentityTarget(ad("Fiat Grand Siena 2020"));
  check("[T2] modelo composto não é inventado como versão", compound?.modelo === "Grand Siena" && compound.variantTokens.length === 0, JSON.stringify(compound));
  const rangerTarget = buildAdIdentityTarget(ad("FORD RANGER LIMITED+ 3.0 V6 4x4 CD TB DIESEL AUT. 2025"));
  const rangerEval = evaluateAdIdentityProof({
    adFingerprint: adFingerprintOf({ adId: "ad-ranger", identity: rangerTarget?.identity ?? null }),
    target: rangerTarget,
    facts: [search([RANGER_PROVIDER_FORMAT], { marca: "Ford", modelo: "Ranger", anos: [2025] })],
  });
  check(
    "[T3] formatos equivalentes do provedor preservam a identidade exata do anúncio",
    rangerEval.status === "exact" && rangerEval.proof?.vehicleKey === RANGER_PROVIDER_FORMAT.vehicleKey,
    JSON.stringify({ rangerTarget, rangerEval }),
  );
  const rangerWithoutPlus = evaluateAdIdentityProof({
    adFingerprint: adFingerprintOf({ adId: "ad-ranger", identity: rangerTarget?.identity ?? null }),
    target: rangerTarget,
    facts: [search([
      { ...RANGER_PROVIDER_FORMAT, vehicleKey: "bndv:ranger-limited", versao: "LIMITED 3.0 V6 4x4 CD TB DIE AUT" },
    ], { marca: "Ford", modelo: "Ranger", anos: [2025] })],
  });
  check(
    "[T4] normalizacao visual nao promove uma versao realmente diferente",
    rangerWithoutPlus.status === "none",
    JSON.stringify({ rangerTarget, rangerWithoutPlus }),
  );

  const exactEval = evaluate([search([HB20_EXACT], { modelo: "HB20", anos: [2017] })]);
  check("[A1] modelo-base + fato real da versão prova anúncio", exactEval.status === "exact" && exactEval.proof?.vehicleKey === "hb20-exact", JSON.stringify(exactEval));
  check("[A2] prova exata + chave aterrada confirma inventário", confirm(exactEval.proof, [search([HB20_EXACT], { modelo: "HB20", anos: [2017] })]).inventoryConfirmed === true);
  check("[A3] fingerprint é canônico", stockSearchProofFingerprint({ anos: [2017], modelo: "HB20" }) === stockSearchProofFingerprint({ modelo: "HB20", anos: [2017] }));

  check("[B1] fato sem versão não prova Confort Plus", evaluate([search([HB20_BASE], { modelo: "HB20", anos: [2017] })]).status === "none");
  check("[B2] versão diferente não prova", evaluate([search([HB20_WRONG], { modelo: "HB20", anos: [2017] })]).status === "none");
  // Regressao da fronteira real do runner: `anos` e um array numerico.
  // O adapter aplicava o filtro corretamente, mas o serializer o descartava do
  // QueryResult. Sem essa proveniencia, a prova exata do anuncio nao sobrevivia
  // ao commit e o turno seguinte barrava `fotos dele` como chave nao aterrada.
  const runner = createReadQueryRunner(
    { tenantId: "tenant", agentId: "agent" },
    {
      stock: {
        search: async (_ref, filters) => ({
          items: [HB20_EXACT],
          filtersUsed: filters,
          matchKind: "exact" as const,
        }),
      },
      vehicleDetails: { getDetails: async () => null },
      vehiclePhotos: {
        resolvePhotos: async (_ref, vehicleKey) => ({ vehicleKey, ambiguous: false, photoIds: [] }),
        resolveUrls: async () => [],
      },
      crm: { readLead: async () => null },
      allowedTools: ["stock_search"],
    },
  );
  const runnerResult = await runner({ tool: "stock_search", input: { modelo: "HB20", anos: [2017] } });
  const runnerFilters = runnerResult.ok && runnerResult.tool === "stock_search"
    ? runnerResult.data.filtersUsed
    : {};
  check("[A4] runner preserva array numerico de anos", Array.isArray(runnerFilters.anos) && runnerFilters.anos[0] === 2017, JSON.stringify(runnerFilters));
  const runnerEval = evaluate([runnerResult]);
  check("[A5] prova exata nasce do resultado serializado real", runnerEval.status === "exact" && runnerEval.proof?.vehicleKey === "hb20-exact", JSON.stringify(runnerEval));

  const familyEval = evaluate([search([], { modelo: "HB20", anos: [2017] }, [HB20_BASE])]);
  check("[B3] candidato de família é referenciável, nunca exato", familyEval.status === "family_only" && familyEval.proof?.level === "family_only");
  check("[B4] candidato de família não confirma inventário anunciado", confirm(familyEval.proof, [search([], { modelo: "HB20", anos: [2017] }, [HB20_BASE])]).inventoryConfirmed === false);
  check("[B5] foto não promove família", evaluate([search([], { modelo: "HB20", anos: [2017] }, [HB20_BASE]), photos("hb20-base")]).status === "family_only");
  check("[B6] detalhes não promovem família", evaluate([search([], { modelo: "HB20", anos: [2017] }, [HB20_BASE]), details(HB20_BASE)]).status === "family_only");
  check("[B7] oferta anterior só prova existência", confirm(null, [], [{ vehicleKey: "hb20-base", marca: "Hyundai", modelo: "HB20", ano: 2017 }]).inventoryConfirmed === false);

  const ambiguous = evaluate([
    search([HB20_EXACT], { modelo: "HB20", anos: [2017] }),
    search([{ ...HB20_EXACT, vehicleKey: "hb20-exact-2" }], { anos: [2017], modelo: "HB20" }),
  ]);
  check("[C1] duas chaves em buscas separadas permanecem ambíguas", ambiguous.status === "ambiguous" && ambiguous.proof === null, JSON.stringify(ambiguous));
  check("[C2] busca não relacionada não apaga prova", evaluate([search([vehicle("siena", "Grand Siena", 2020)], { modelo: "Grand Siena", anos: [2020] })]).status === "not_observed");
  check("[C3] busca direcionada vazia invalida prova antiga", evaluate([search([], { modelo: "HB20", anos: [2017] })]).status === "none");

  const proof = exactEval.proof;
  check("[D1] prova atravessa turno do mesmo anúncio", carryForwardProof(proof, FP)?.vehicleKey === "hb20-exact");
  check("[D2] anúncio novo invalida prova", carryForwardProof(proof, adFingerprintOf({ adId: "ad-2", identity: TARGET.identity })) === null);
  check("[D3] prova não inventa estoque se a chave sumiu", confirm(proof).inventoryConfirmed === false);
  check("[D4] prova persistida + oferta aterrada confirma", confirm(proof, [], [{ vehicleKey: "hb20-exact", marca: "Hyundai", modelo: "HB20", ano: 2017 }]).inventoryConfirmed === true);
  check("[D5] estado antigo sem prova fica desconhecido", confirm(null, [], [{ vehicleKey: "hb20-exact", modelo: "HB20", ano: 2017 }]).inventoryConfirmed === false);

  console.log(`\n== F2.83: ${ok} OK | ${fail} FALHA ==`);
  if (fail) process.exit(1);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
