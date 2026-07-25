// ============================================================================
// F2.79 — COMBUSTÍVEL como FATO (missão P0, prioridade 2).
//
// INCIDENTE (smoke real Wa, 24/07): "não temos outra SUV diesel mais barata" com a tool
// tendo executado somente {tipo:"suv"}. `fuelName` existia no feed mas MORRIA no adapter,
// e o unico filtro de propulsao era o booleano `hibrido` -> impossivel provar diesel OU
// a ausencia dele. Afirmacao de ausencia sem filtro aplicado.
//
// CONTRATO: (1) combustivel canonico viaja do feed ate VehicleFact; (2) filtro TIPADO e
// GENERICO na stock_search; (3) o resultado declara a PROPRIA capacidade de sustentar uma
// afirmacao de ausencia (absenceAssertable / unverifiableFilters); (4) o classificador
// continua medindo alegacoes não sustentadas para telemetria/eval, mas NUNCA gera hard deny,
// retry ou fallback. A LLM recebe os fatos estruturados e mantém a autoria da resposta.
//   npx tsx tests/run-f2-79-fuel-grounding.ts
// ============================================================================
import { canonicalFuel, FUEL_KINDS, fuelLabel, detectFuelIntent, fuelCoverageSupportsAbsence } from "../src/domain/fuel.ts";
import { normalizeStockSearchInput } from "../src/domain/decision.ts";
import { V2StockSource } from "../src/adapters/read/stock-source.ts";
import type { StockLoader } from "../src/adapters/read/stock-loader.ts";
import type { NormalizedVehicle, StockSearchFilters, StockSearchResult, TenantAgentRef } from "../src/domain/read-ports.ts";
import { constraintsToStockInput, activeConstraintsFromStockInput, detectCommercialConstraints, mergeActiveConstraints } from "../src/engine/commercial-constraints.ts";
import { PolicyEngine, hasDeny, splitSemanticClauses } from "../src/engine/policy-engine.ts";
import { absenceEvidenceAuthorizesClaim, classifyFuelClaims, type FuelClaim } from "../src/engine/fuel-claims.ts";
import type { QueryResult, RenderedResponse, TurnDecision } from "../src/domain/decision.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const REF: TenantAgentRef = { tenantId: "t", agentId: "a" };
function nv(o: Partial<NormalizedVehicle> & { externalVehicleId: string }): NormalizedVehicle {
  return { source: "f", markName: "Jeep", modelName: "Compass", versionName: "Limited", year: 2021, km: 70000, saleValue: 120000,
    color: "Prata", fuelName: null, transmissionName: "Automatico", pictureJs: "[]", category: "suv", bodyType: "suv", ...o };
}
const search = (vs: readonly NormalizedVehicle[], f: StockSearchFilters): Promise<StockSearchResult> =>
  new V2StockSource({ async loadAll(): Promise<NormalizedVehicle[]> { return [...vs]; } } as StockLoader).search(REF, f);

// Estoque com combustivel BEM informado (cobertura alta)
const FEED_OK = [
  nv({ externalVehicleId: "1", fuelName: "Diesel", modelName: "Compass", saleValue: 121400 }),
  nv({ externalVehicleId: "2", fuelName: "Flex", modelName: "Renegade", saleValue: 95000 }),
  nv({ externalVehicleId: "3", fuelName: "Gasolina", modelName: "Tracker", saleValue: 88000 }),
  nv({ externalVehicleId: "4", fuelName: "Híbrido", modelName: "Corolla Cross", saleValue: 150000 }),
  nv({ externalVehicleId: "5", fuelName: "Flex", modelName: "HR-V", saleValue: 83900 }),
];
// Estoque SEM combustivel informado (fonte nao sustenta a dimensao)
const FEED_BLIND = [1, 2, 3, 4, 5].map((i) => nv({ externalVehicleId: String(i), fuelName: null, modelName: `M${i}`, saleValue: 80000 + i }));

async function main(): Promise<void> {
  console.log("== F2.79: combustivel como FATO ==");

  // ── 1) DOMINIO: canonicalizacao por tabela ordenada ───────────────────────────────────────────
  check("[D1] Diesel/DIESEL/a diesel -> diesel", ["Diesel", "DIESEL", "a diesel"].every((s) => canonicalFuel(s) === "diesel"));
  check("[D2] 'Flex'/'Alcool e Gasolina'/'Bicombustivel' -> flex", ["Flex", "Álcool e Gasolina", "Bicombustível"].every((s) => canonicalFuel(s) === "flex"));
  check("[D3] ORDEM: 'Híbrido Flex' -> hibrido (nao flex)", canonicalFuel("Híbrido Flex") === "hibrido");
  check("[D3] ORDEM: 'Elétrico' -> eletrico; 'Etanol' -> etanol", canonicalFuel("Elétrico") === "eletrico" && canonicalFuel("Etanol") === "etanol");
  check("[D4] desconhecido/vazio -> null (NUNCA default)", canonicalFuel("GNV") === null && canonicalFuel("") === null && canonicalFuel(null) === null);
  check("[D5] intencao do lead usa a MESMA tabela", detectFuelIntent("queria um diesel") === "diesel" && detectFuelIntent("tem híbrido?") === "hibrido");
  check("[D6] combustível recusado não vira filtro positivo", detectFuelIntent("não quero diesel") === null);
  check("[D7] contraste preserva somente a preferência positiva", detectFuelIntent("não quero diesel, quero flex") === "flex");
  check("[D8] alternativas ambíguas ficam para a decisão tipada da LLM", detectFuelIntent("pode ser diesel ou flex") === null);
  check("[D6] ⭐cobertura INTEGRAL: 5/5 sustenta; 4/5 NAO (o desconhecido pode ser o diesel)",
    fuelCoverageSupportsAbsence(5, 5) && !fuelCoverageSupportsAbsence(4, 5) && !fuelCoverageSupportsAbsence(0, 0));

  // ── 2) FATO: o combustivel chega ao VehicleFact ───────────────────────────────────────────────
  const all = await search(FEED_OK, {});
  const compass = all.items.find((v) => v.modelo === "Compass");
  check("[F1] VehicleFact carrega combustivel canonico do feed", compass?.combustivel === "diesel", JSON.stringify(compass?.combustivel));
  const blind = await search(FEED_BLIND, {});
  check("[F2] fonte sem combustivel -> campo AUSENTE (nunca 'nao e diesel')", blind.items.every((v) => v.combustivel === undefined));

  // ── 3) FILTRO GENERICO (nao um if para diesel) ────────────────────────────────────────────────
  const dsl = await search(FEED_OK, { combustivel: "diesel" });
  check("[T1] SUV diesel existente -> retorna SO diesel", dsl.items.length === 1 && dsl.items[0].combustivel === "diesel", JSON.stringify(dsl.items.map((v) => v.combustivel)));
  const eletrico = await search(FEED_OK, { combustivel: "eletrico" });
  check("[T2] combustivel inexistente -> vazio FACTUAL", eletrico.items.length === 0);
  check("[T2] ⭐(caso 5) busca GLOBAL, vazia, cobertura 100% -> AUTORIZA ausencia",
    eletrico.absenceAssertable === true && eletrico.absenceScope === "global", `${eletrico.absenceAssertable}/${eletrico.absenceScope}`);
  for (const kind of FUEL_KINDS) {
    const r = await search(FEED_OK, { combustivel: kind });
    if (r.items.some((v) => v.combustivel !== kind)) { check(`[T3] filtro generico coerente p/ ${kind}`, false); break; }
  }
  check("[T3] filtro coerente para TODOS os FUEL_KINDS (regra generica)", true);
  const combinado = await search(FEED_OK, { combustivel: "flex", precoMax: 90000, tipo: "suv", cambio: "automatic" });
  check("[T4] combustivel + preco + tipo + cambio juntos", combinado.items.length === 1 && combinado.items[0].modelo === "HR-V", JSON.stringify(combinado.items.map((v) => v.modelo)));
  const excl = await search(FEED_OK, { combustivel: "flex", excludeKeys: combinado.items.map((v) => v.vehicleKey) });
  check("[T4] combustivel + excludeKeys", excl.items.every((v) => v.combustivel === "flex") && excl.items.length === 1);

  // ── 4) QUANDO A AUSENCIA **NAO** PODE SER AFIRMADA (os 4 casos do Codex) ──────────────────────
  const soTipo = await search(FEED_OK, { tipo: "suv" });
  check("[A0] busca so por tipo (sem filtro de combustivel) -> FALSE", soTipo.absenceAssertable === false, String(soTipo.absenceAssertable));

  // (caso 1) 4/5 conhecidos -> o desconhecido pode ser exatamente o diesel procurado
  const QUASE = [
    nv({ externalVehicleId: "1", fuelName: "Flex", saleValue: 90000 }),
    nv({ externalVehicleId: "2", fuelName: "Flex", saleValue: 91000 }),
    nv({ externalVehicleId: "3", fuelName: "Gasolina", saleValue: 92000 }),
    nv({ externalVehicleId: "4", fuelName: "Gasolina", saleValue: 93000 }),
    nv({ externalVehicleId: "5", fuelName: null, saleValue: 94000 }),   // desconhecido
  ];
  const quase = await search(QUASE, { combustivel: "diesel" });
  check("[A1] ⭐(caso 1) 4/5 conhecidos -> absenceAssertable FALSE", quase.absenceAssertable === false, JSON.stringify(quase.attributeCoverage));
  check("[A1] e a dimensao vira 'nao verificavel'", (quase.unverifiableFilters ?? []).includes("combustivel"));

  // (caso 2) catalogo GERAL completo, mas o SUBCONJUNTO consultado tem desconhecido -> FALSE.
  // Prova que a cobertura e medida DEPOIS de marca/modelo/ano/preco/tipo/cambio.
  const MISTO = [
    nv({ externalVehicleId: "1", markName: "Jeep", modelName: "Compass", fuelName: "Flex", saleValue: 120000 }),
    nv({ externalVehicleId: "2", markName: "Jeep", modelName: "Compass", fuelName: null, saleValue: 125000 }),   // desconhecido NO subconjunto
    nv({ externalVehicleId: "3", markName: "Fiat", modelName: "Argo", fuelName: "Flex", saleValue: 70000 }),
    nv({ externalVehicleId: "4", markName: "Fiat", modelName: "Mobi", fuelName: "Flex", saleValue: 60000 }),
    nv({ externalVehicleId: "5", markName: "Ford", modelName: "Ka", fuelName: "Gasolina", saleValue: 55000 }),
  ];
  const subconjunto = await search(MISTO, { modelo: "Compass", combustivel: "diesel" });
  check("[A2] ⭐(caso 2) catalogo geral OK mas SUBCONJUNTO com desconhecido -> FALSE",
    subconjunto.absenceAssertable === false, JSON.stringify(subconjunto.attributeCoverage));
  check("[A2] a cobertura reflete o UNIVERSO CONSULTADO (1/2), nao o catalogo (4/5)",
    subconjunto.attributeCoverage?.combustivel.total === 2 && subconjunto.attributeCoverage?.combustivel.known === 1,
    JSON.stringify(subconjunto.attributeCoverage));

  // (caso 3) existe um diesel encontrado -> jamais autoriza negar
  const COM_DIESEL = [nv({ externalVehicleId: "1", fuelName: "Diesel", saleValue: 120000 }), nv({ externalVehicleId: "2", fuelName: "Flex", saleValue: 90000 })];
  const achou = await search(COM_DIESEL, { combustivel: "diesel" });
  check("[A3] ⭐(caso 3) achou diesel -> absenceAssertable FALSE (resultado nao vazio)",
    achou.items.length === 1 && achou.absenceAssertable === false, `${achou.items.length}/${achou.absenceAssertable}`);

  // (caso 4) busca RESTRITA vazia nao autoriza afirmacao GLOBAL
  const restrita = await search(FEED_OK, { tipo: "suv", combustivel: "eletrico" });
  check("[A4] ⭐(caso 4) busca restrita vazia -> escopo 'restricted'",
    restrita.items.length === 0 && restrita.absenceScope === "restricted", `${restrita.items.length}/${restrita.absenceScope}`);

  // fonte cega: nenhum combustivel informado
  const cego = await search(FEED_BLIND, { combustivel: "diesel" });
  check("[A5] fonte sem combustivel -> unverifiableFilters=['combustivel'] e ausencia NAO afirmavel",
    (cego.unverifiableFilters ?? []).includes("combustivel") && cego.absenceAssertable === false, JSON.stringify(cego.unverifiableFilters));
  check("[A5] cobertura observavel (0/5)", cego.attributeCoverage?.combustivel.known === 0 && cego.attributeCoverage?.combustivel.total === 5, JSON.stringify(cego.attributeCoverage));

  // family_candidate nao autoriza ausencia absoluta (existe algo relacionado no estoque)
  const FAMILIA = [nv({ externalVehicleId: "1", markName: "Hyundai", modelName: "HB20", versionName: "Comfort", fuelName: "Flex", saleValue: 52000 })];
  const fam = await search(FAMILIA, { modelo: "HB20 Confort Plus", combustivel: "flex" });
  check("[A6] ⭐family_candidate presente -> ausencia NAO afirmavel",
    (fam.familyCandidates ?? []).length > 0 && fam.absenceAssertable === false, `${(fam.familyCandidates ?? []).length}/${fam.absenceAssertable}`);

  // ── 5) INTERPRETACAO TIPADA DA AFIRMACAO (rodada 3 do Codex) ─────────────────────────────────
  // A negacao escopa a DIREITA e liga no predicado mais proximo: EXISTENCIAL = fala do estoque;
  // EPISTEMICO = fala da propria capacidade de verificar. Nada de lista de frases.
  const catalogI = buildTenantCatalog([]);
  const extractorI = new CatalogClaimExtractor(catalogI);
  const claimsOf = (t: string): FuelClaim[] => classifyFuelClaims(t, extractorI, splitSemanticClauses);

  const i1 = claimsOf("Não temos diesel.");
  check("[I1] 'Não temos diesel' -> inventory_absence GLOBAL", i1.length === 1 && i1[0].kind === "inventory_absence" && i1[0].scope === "global", JSON.stringify(i1));
  const i2 = claimsOf("Não encontrei SUV diesel nessa faixa.");
  check("[I2] ⭐'Não encontrei SUV diesel nessa faixa' -> inventory_absence RESTRITO + anafora",
    i2.length === 1 && i2[0].kind === "inventory_absence" && i2[0].scope === "restricted" && i2[0].anaphoric === true && i2[0].restrictors.tipo === "suv", JSON.stringify(i2));
  const i3 = claimsOf("Não consegui confirmar se esses carros são diesel.");
  check("[I3] ⭐'Não consegui confirmar se é diesel' -> attribute_unverified (NAO fala de estoque)",
    i3.length === 1 && i3[0].kind === "attribute_unverified", JSON.stringify(i3));
  const i4 = claimsOf("Não tenho certeza se esse é diesel.");
  check("[I4] ⭐complemento EPISTEMICO vence o verbo existencial ('não tenho certeza')",
    i4.length === 1 && i4[0].kind === "attribute_unverified", JSON.stringify(i4));
  const i5 = claimsOf("Esse diesel não tem teto solar.");
  check("[I5] ⭐combustivel FORA do escopo da negacao -> NENHUMA afirmacao sobre combustivel", i5.length === 0, JSON.stringify(i5));
  const i6 = claimsOf("Diesel esgotado no momento.");
  check("[I6] predicado auto-negativo ('esgotado') -> inventory_absence sem negador", i6.length === 1 && i6[0].kind === "inventory_absence", JSON.stringify(i6));
  // ⭐(rodada 4 do Codex) o predicado auto-negativo predica sobre o SUJEITO. Combustivel dentro de ADJUNTO
  // ("nesse diesel", "nos carros diesel") NAO e afirmacao de estoque de diesel.
  const i6a = claimsOf("O teto solar está indisponível nesse diesel.");
  check("[I6a] ⭐'teto solar indisponível NESSE diesel' -> NAO e ausencia de diesel", i6a.length === 0, JSON.stringify(i6a));
  const i6b = claimsOf("A cor branca está indisponível nos carros diesel.");
  check("[I6b] ⭐'cor branca indisponível NOS CARROS diesel' -> NAO e ausencia de diesel", i6b.length === 0, JSON.stringify(i6b));
  const i6c = claimsOf("Esse diesel está indisponível.");
  check("[I6c] ⭐'ESSE DIESEL está indisponível' CONTINUA sendo ausencia (o combustivel e o sujeito)",
    i6c.length === 1 && i6c[0].kind === "inventory_absence", JSON.stringify(i6c));
  const i6d = claimsOf("O estoque de diesel está esgotado.");
  check("[I6d] nucleo de ESTOQUE mantem a ligacao ('estoque DE diesel esgotado')",
    i6d.length === 1 && i6d[0].kind === "inventory_absence", JSON.stringify(i6d));
  const i6e = claimsOf("A garantia dos carros diesel está indisponível.");
  check("[I6e] adjunto sem nucleo de estoque ('garantia DOS carros diesel') -> nenhuma afirmacao", i6e.length === 0, JSON.stringify(i6e));
  const i6f = claimsOf("Não temos teto solar nesse diesel.");
  check("[I6f] mesma ligacao vale com negador proprio ('não temos teto solar NESSE diesel')", i6f.length === 0, JSON.stringify(i6f));
  const i7 = claimsOf("Não temos diesel, mas posso confirmar com a equipe.");
  check("[I7] ⭐epistemico em OUTRA clausula nao rebaixa a afirmacao de ausencia",
    i7.some((c) => c.kind === "inventory_absence"), JSON.stringify(i7));
  const i8 = claimsOf("Não trabalhamos com elétrico.");
  check("[I8] outro predicado existencial do lexico ('trabalhamos com')", i8.length === 1 && i8[0].fuel === "eletrico" && i8[0].kind === "inventory_absence", JSON.stringify(i8));

  // ── 6) TELEMETRIA DE AUSENCIA: classifica risco sem negar a resposta da LLM ───────────────────
  const catalog = buildTenantCatalog([]);
  const ctx = { state: createInitialState({ conversationId: "c", tenantId: "t", agentId: "a", leadId: null, now: "2026-07-24T12:00:00.000Z" }),
    leadMessage: "tem outra SUV diesel mais barata?", interpretation: { relation: "ambiguous" as const },
    claimExtractor: new CatalogClaimExtractor(catalog), tenantCatalog: catalog, now: "2026-07-24T12:00:00.000Z" } as never;
  const decision = { effectPlan: [], reasonCode: "reply" } as unknown as TurnDecision;
  const say = (t: string): RenderedResponse => ({ draft: { parts: [{ type: "text", content: t }] }, text: t });
  const factWith = (filtersUsed: Record<string, unknown>, absenceAssertable: boolean, absenceScope: "global" | "restricted" = "global"): QueryResult =>
    ({ ok: true, tool: "stock_search", source: "f", data: { items: [] as VehicleFact[], filtersUsed, absenceAssertable, absenceScope } } as QueryResult);

  const unsupported = (text: string, fact: QueryResult): boolean => {
    const claim = claimsOf(text).find((c) => c.kind === "inventory_absence");
    if (!claim || !fact.ok || fact.tool !== "stock_search") return false;
    return fact.data.absenceAssertable !== true
      || fact.data.filtersUsed?.combustivel !== claim.fuel
      || absenceEvidenceAuthorizesClaim(claim, {
        filtersUsed: fact.data.filtersUsed as Record<string, unknown>,
        absenceScope: fact.data.absenceScope ?? "restricted",
      }) != null;
  };

  const semProvaFact = factWith({ tipo: "suv" }, false, "restricted");
  const semProva = PolicyEngine.validateResponse(say("No momento não temos outra SUV diesel mais barata."), [semProvaFact], decision, ctx, true);
  check("[P1] ⭐classificador detecta ausencia sem prova, mas a engine NAO nega",
    unsupported("No momento não temos outra SUV diesel mais barata.", semProvaFact) && !hasDeny(semProva), JSON.stringify(semProva).slice(0, 160));
  const comProva = PolicyEngine.validateResponse(say("No momento não temos nenhum diesel disponível."), [factWith({ combustivel: "diesel" }, true, "global")], decision, ctx, true);
  check("[P2] ⭐frase GLOBAL com busca GLOBAL de diesel, vazia e 100% coberta -> PASSA", !hasDeny(comProva), JSON.stringify(comProva).slice(0, 160));
  const restritaFact = factWith({ tipo: "suv", combustivel: "diesel" }, true, "restricted");
  const restritaProva = PolicyEngine.validateResponse(say("Não temos nenhum diesel."), [restritaFact], decision, ctx, true);
  check("[P3] ⭐prova restrita não sustenta frase global; telemetria detecta sem hard deny",
    unsupported("Não temos nenhum diesel.", restritaFact) && !hasDeny(restritaProva), JSON.stringify(restritaProva).slice(0, 140));
  const fracaFact = factWith({ combustivel: "diesel" }, false, "global");
  const provaFraca = PolicyEngine.validateResponse(say("Não temos diesel."), [fracaFact], decision, ctx, true);
  check("[P4] cobertura incompleta continua observável, sem bloquear a autoria",
    unsupported("Não temos diesel.", fracaFact) && !hasDeny(provaFraca), JSON.stringify(provaFraca).slice(0, 120));
  const honesto = PolicyEngine.validateResponse(say("Não consegui confirmar o combustível desses carros agora; quer que eu verifique com um consultor?"), [factWith({ tipo: "suv" }, false, "restricted")], decision, ctx, true);
  check("[P5] ⭐(caso 6) resposta HONESTA (nao confirmou) passa sem prova", !hasDeny(honesto), JSON.stringify(honesto).slice(0, 160));
  const dieselFact = factWith({ combustivel: "diesel" }, true, "global");
  const outroCombustivel = PolicyEngine.validateResponse(say("Não temos nenhum elétrico no momento."), [dieselFact], decision, ctx, true);
  check("[P6] prova de DIESEL não sustenta negar ELÉTRICO; detector mede e engine não nega",
    unsupported("Não temos nenhum elétrico no momento.", dieselFact) && !hasDeny(outroCombustivel), JSON.stringify(outroCombustivel).slice(0, 120));

  // ⭐OS DOIS FALSOS BLOQUEIOS DA RODADA 2 (reproduzidos pelo Codex no codigo real)
  const provaRecorte = [factWith({ tipo: "suv", precoMax: 90000, combustivel: "diesel" }, true, "restricted")];
  const ausenciaNoRecorte = PolicyEngine.validateResponse(say("Não encontrei SUV diesel nessa faixa."), provaRecorte, decision, ctx, true);
  check("[P7] ⭐ausencia VERDADEIRA no recorte pesquisado -> PASSA (era falso bloqueio)", !hasDeny(ausenciaNoRecorte), JSON.stringify(ausenciaNoRecorte).slice(0, 200));
  const naoConfirmou = PolicyEngine.validateResponse(say("Não consegui confirmar se esses carros são diesel."), [], decision, ctx, true);
  check("[P8] ⭐declaracao honesta de NAO-VERIFICACAO passa SEM prova nenhuma (era falso bloqueio)", !hasDeny(naoConfirmou), JSON.stringify(naoConfirmou).slice(0, 200));

  // Contencao de conjuntos: prova GLOBAL cobre qualquer recorte; prova RESTRITA nao cobre outro recorte.
  const globalCobreRecorte = PolicyEngine.validateResponse(say("Não encontrei SUV diesel nessa faixa."), [factWith({ combustivel: "diesel" }, true, "global")], decision, ctx, true);
  check("[P9] prova GLOBAL autoriza a afirmacao RESTRITA (ausencia total implica ausencia no recorte)", !hasDeny(globalCobreRecorte), JSON.stringify(globalCobreRecorte).slice(0, 160));
  const suvDieselFact = factWith({ tipo: "suv", combustivel: "diesel" }, true, "restricted");
  const outroRecorte = PolicyEngine.validateResponse(say("Não temos nenhuma Toyota diesel."), [suvDieselFact], decision, ctx, true);
  check("[P10] ⭐marca fora do recorte continua classificada, sem deny/retry da engine",
    unsupported("Não temos nenhuma Toyota diesel.", suvDieselFact) && !hasDeny(outroRecorte), JSON.stringify(outroRecorte).slice(0, 200));
  const semRetomarFaixa = PolicyEngine.validateResponse(say("Não encontrei SUV diesel."), provaRecorte, decision, ctx, true);
  check("[P11] ⭐afirmação que abandona teto segue observável, mas não é hard deny",
    unsupported("Não encontrei SUV diesel.", provaRecorte[0]) && !hasDeny(semRetomarFaixa), JSON.stringify(semRetomarFaixa).slice(0, 200));
  // A retomada EXPLICITA do teto e testada na CONTENCAO (no texto renderizado, dinheiro solto ja e barrado por
  // POL-GROUND-PRICE — a LLM usa money_ref; a regra de combustivel nao pode depender disso).
  const provaSuv90k = { filtersUsed: { tipo: "suv", precoMax: 90000, combustivel: "diesel" }, absenceScope: "restricted" as const };
  const claimAte90 = claimsOf("Não encontrei SUV diesel até 90 mil.")[0];
  check("[P12] recorte retomado EXPLICITAMENTE (tipo + teto) -> autoriza",
    claimAte90 != null && claimAte90.restrictors.precoMax === 90000 && absenceEvidenceAuthorizesClaim(claimAte90, provaSuv90k) === null,
    JSON.stringify(claimAte90?.restrictors));
  const claimAte120 = claimsOf("Não encontrei SUV diesel até 120 mil.")[0];
  check("[P13] ⭐teto MAIOR que o pesquisado nao e contido pela prova -> recusa",
    claimAte120 != null && absenceEvidenceAuthorizesClaim(claimAte120, provaSuv90k) !== null,
    String(claimAte120 && absenceEvidenceAuthorizesClaim(claimAte120, provaSuv90k)));
  const claimAte70 = claimsOf("Não encontrei SUV diesel até 70 mil.")[0];
  check("[P14] teto MENOR (afirmacao mais estreita) continua contido -> autoriza",
    claimAte70 != null && absenceEvidenceAuthorizesClaim(claimAte70, provaSuv90k) === null,
    String(claimAte70 && absenceEvidenceAuthorizesClaim(claimAte70, provaSuv90k)));

  // ⭐(rodada 4 do Codex) A ANAFORA SO HERDA O QUE FOI OMITIDO. Ela nunca apaga nem alarga o que a frase DECLAROU.
  const provaSuv2020 = { filtersUsed: { tipo: "suv", anos: [2020], precoMax: 90000, combustivel: "diesel" }, absenceScope: "restricted" as const };
  const anafora120 = claimsOf("Não encontrei SUV diesel até 120 mil nessa faixa.")[0];
  check("[P15] ⭐'até 120 mil NESSA FAIXA' com prova de 90 mil -> RECUSA (anafora nao apaga o preco declarado)",
    anafora120 != null && anafora120.anaphoric === true && anafora120.restrictors.precoMax === 120000
      && absenceEvidenceAuthorizesClaim(anafora120, provaSuv2020) !== null,
    `${anafora120?.restrictors.precoMax} -> ${anafora120 && absenceEvidenceAuthorizesClaim(anafora120, provaSuv2020)}`);
  const anafora2021 = claimsOf("Não encontrei SUV diesel do ano 2021 nessa faixa.")[0];
  check("[P16] ⭐'do ano 2021 NESSA FAIXA' com prova de 2020 -> RECUSA (anafora nao apaga o ano declarado)",
    anafora2021 != null && anafora2021.anaphoric === true && (anafora2021.restrictors.anos ?? []).includes(2021)
      && absenceEvidenceAuthorizesClaim(anafora2021, provaSuv2020) !== null,
    `${JSON.stringify(anafora2021?.restrictors.anos)} -> ${anafora2021 && absenceEvidenceAuthorizesClaim(anafora2021, provaSuv2020)}`);
  const anaforaOmite = claimsOf("Não encontrei SUV diesel nessa faixa.")[0];
  check("[P17] a anafora CONTINUA herdando o que a frase OMITIU (ano e teto nao mencionados) -> autoriza",
    anaforaOmite != null && absenceEvidenceAuthorizesClaim(anaforaOmite, provaSuv2020) === null,
    String(anaforaOmite && absenceEvidenceAuthorizesClaim(anaforaOmite, provaSuv2020)));
  const anafora2020 = claimsOf("Não encontrei SUV diesel 2020 nessa faixa.")[0];
  check("[P18] valor DECLARADO igual ao pesquisado (2020) -> autoriza",
    anafora2020 != null && absenceEvidenceAuthorizesClaim(anafora2020, provaSuv2020) === null,
    String(anafora2020 && absenceEvidenceAuthorizesClaim(anafora2020, provaSuv2020)));
  const anaforaSedan = claimsOf("Não encontrei outro sedan diesel.")[0];
  check("[P19] marca/tipo DECLARADO divergente nao e salvo pela anafora ('outro sedan' vs busca de SUV)",
    anaforaSedan != null && absenceEvidenceAuthorizesClaim(anaforaSedan, provaSuv2020) !== null,
    String(anaforaSedan && absenceEvidenceAuthorizesClaim(anaforaSedan, provaSuv2020)));

  // ── 6) CONSTRAINTS: intencao -> filtro -> escopo persistido -> proximo turno ──────────────────
  const extractor = new CatalogClaimExtractor(catalog);
  const c = detectCommercialConstraints({ block: "queria uma SUV diesel até 90 mil", signals: {} as never, claimExtractor: extractor });
  check("[C1] intencao do lead vira constraint tipado", c.combustivel === "diesel", JSON.stringify(c.combustivel));
  const inp = constraintsToStockInput(c);
  check("[C2] constraint -> input da tool", inp.combustivel === "diesel", JSON.stringify(inp));
  const active = activeConstraintsFromStockInput({ tipo: "suv", combustivel: "diesel" });
  check("[C3] escopo executado persiste o combustivel", active.combustivel === "diesel");
  const legado = activeConstraintsFromStockInput({ tipo: "suv", hibrido: true });
  check("[C4] estado LEGADO (hibrido:true) migra na leitura -> combustivel='hibrido'", legado.combustivel === "hibrido", JSON.stringify(legado));
  const merged = mergeActiveConstraints(active, { combustivel: "flex" });
  check("[C5] o bloco ATUAL substitui a propulsao antiga", merged.combustivel === "flex");
  check("[C6] rotulo humano p/ recuperacao honesta", fuelLabel("hibrido") === "híbrido" && fuelLabel("diesel") === "diesel");
  const rejectedFuel = detectCommercialConstraints({ block: "quero uma SUV, mas não quero diesel", signals: {} as never, claimExtractor: extractor });
  check("[C7] engine não injeta no stock_search o combustível recusado", rejectedFuel.tipo === "suv" && rejectedFuel.combustivel === undefined, JSON.stringify(rejectedFuel));

  // ── 7) ALIAS LEGADO dobrado em ponto unico, com fail-closed ───────────────────────────────────
  const dobrado = normalizeStockSearchInput({ hibrido: true });
  check("[L1] hibrido:true -> combustivel:'hibrido' (alias dobrado)", dobrado.ok === true && dobrado.input.combustivel === "hibrido" && dobrado.input.hibrido === undefined, JSON.stringify(dobrado));
  const conflito = normalizeStockSearchInput({ hibrido: true, combustivel: "diesel" });
  check("[L2] ⭐hibrido:true + combustivel:'diesel' -> FALHA FECHADA (nao elege sozinho)", conflito.ok === false, JSON.stringify(conflito));

  console.log(`\n== F2.79: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
