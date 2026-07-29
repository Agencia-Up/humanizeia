// ============================================================================
// F2.88 — três P0 encontrados em conversas reais (2026-07-27)
//
//  A) ano de veículo nunca vira teto de preço por causa de uma palavra de
//     orçamento em outra cláusula;
//  B) uma classificação semântica genérica de encerramento não transfere o
//     lead por conta própria — transferência é ato explícito da LLM, salvo o
//     opt-out operacional inequívoco já existente;
//  C) fatos específicos da empresa só podem vir das fontes factuais do turno.
//     Ausência de informação nunca é prova de uma negativa.
//
// Nenhum aceite depende de marca, modelo, vaga ou frase comercial específica.
// ============================================================================
import { readFileSync } from "node:fs";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { computeTurnFrame } from "../src/engine/explicit-search.ts";
import { detectCommercialConstraints } from "../src/engine/commercial-constraints.ts";
import { buildFrameSignals } from "../src/engine/turn-frame-builder.ts";
import { extractAdVehicleConstraints } from "../src/engine/ad-context.ts";
import { COMPACT_OPERATIONAL_PROMPT } from "../src/adapters/llm/openai-agent-brain.ts";
import type { AdContext } from "../src/domain/conversation-state.ts";
import type { TurnInterpretation } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0;
let fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); return; }
  fail += 1;
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const VEHICLES: VehicleFact[] = [
  { vehicleKey: "test:ranger", marca: "Ford", modelo: "Ranger", ano: 2025, preco: 249_900, km: 2_000, cambio: "Automatico", cor: "Preto", tipo: "pickup" },
  { vehicleKey: "test:equinox", marca: "Chevrolet", modelo: "Equinox", ano: 2023, preco: 169_900, km: 30_000, cambio: "Automatico", cor: "Branco", tipo: "suv" },
  { vehicleKey: "test:discovery", marca: "Land Rover", modelo: "Discovery Sport", ano: 2020, preco: 159_900, km: 65_000, cambio: "Automatico", cor: "Cinza", tipo: "suv" },
];
const extractor = new CatalogClaimExtractor(buildTenantCatalog(VEHICLES));
const interpretation = { relation: "ambiguous" } as TurnInterpretation;
const constraints = (block: string) => detectCommercialConstraints({
  block,
  signals: buildFrameSignals(block, interpretation),
  claimExtractor: extractor,
  interpretation,
});

function ad(overrides: Partial<AdContext>): AdContext {
  return {
    adId: "ad-p0",
    source: "facebook",
    sourceUrl: null,
    title: null,
    body: null,
    greeting: null,
    imageUrls: [],
    capturedAtTurn: 1,
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log("== F2.88: contratos gerais dos três P0 reais ==");

  console.log("\n[A] Ano e dinheiro preservam papéis distintos");
  const a1Text = "Procuro uma Ranger 2025. Consigo ir até amanhã?";
  const a1 = constraints(a1Text);
  check("[A1] ano do veículo é preservado como ano", a1.anos?.includes(2025) === true, JSON.stringify(a1));
  check("[A2] palavra 'até' em outra cláusula não transforma ano em preço", a1.precoMax == null, JSON.stringify(a1));

  const a2 = constraints("Quero uma Equinox 2023, com opções até 120 mil.");
  check("[A3] ano e orçamento explícito podem coexistir", a2.anos?.includes(2023) === true && a2.precoMax === 120_000, JSON.stringify(a2));

  const a3 = constraints("Discovery Sport 2020; até quando a loja atende hoje?");
  check("[A4] pergunta temporal não cria orçamento", a3.anos?.includes(2020) === true && a3.precoMax == null, JSON.stringify(a3));

  const a4 = constraints("Quero um SUV até 90 mil.");
  check("[A5] orçamento monetário explícito continua funcionando", a4.precoMax === 90_000, JSON.stringify(a4));

  const a5 = constraints("Quero veículos até 2025.");
  check("[A6] teto de ano plausível não vira teto monetário", a5.anos?.includes(2025) === true && a5.precoMax == null, JSON.stringify(a5));

  const a6 = constraints("Quero opções até 2000 reais.");
  check("[A6a] moeda explícita vence a ambiguidade numérica de ano", a6.precoMax === 2_000, JSON.stringify(a6));

  const a7 = constraints("Tenho R$ 10 mil em materiais e quero conhecer os carros.");
  check("[A6b] trecho de palavra não fabrica marcador de orçamento", a7.precoMax == null, JSON.stringify(a7));

  const frame = computeTurnFrame({ leadMessage: a1Text, claimExtractor: extractor, interpretation });
  check("[A7] frame atual também não carrega preço fantasma", frame.budgetMax == null, JSON.stringify(frame));

  const adConstraints = extractAdVehicleConstraints(ad({
    vehicleQuery: "Ford Ranger 2025",
    greeting: "Quero informações da Ford Ranger 2025",
    body: "Atendimento de segunda até sábado.",
  }), extractor, interpretation);
  check("[A8] texto longo do anúncio não converte ano em preço", adConstraints.modelos?.some((model) => /ranger/i.test(model)) === true && adConstraints.precoMax == null, JSON.stringify(adConstraints));

  console.log("\n[B] Engine não inventa transferência");
  const centralSource = readFileSync(new URL("../src/engine/central-engine.ts", import.meta.url), "utf8");
  check("[B1] fluxo ativo não calcula motivo forçado de handoff", !/const forcedHandoffReason/.test(centralSource));
  check("[B2] buildHandoffChain recebe somente a decisão da LLM", !/forcedReason:\s*/.test(centralSource));
  check("[B3] opt-out continua separado da autoria de transferência",
    /detectExplicitOptOut\(leadMessage\)/.test(centralSource)
      && /A engine nunca origina uma transferência no fluxo ativo/.test(centralSource));

  console.log("\n[C] Fatos da empresa permanecem sob autoridade de fontes reais");
  const prompt = COMPACT_OPERATIONAL_PROMPT.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  check("[C1] contrato nomeia fontes factuais da empresa", prompt.includes("fatos especificos da empresa") && prompt.includes("prompt do portal") && prompt.includes("knowledge_search"));
  check("[C2] silêncio ou ausência de fonte não vira negativa", prompt.includes("ausencia de informacao") && prompt.includes("nao e prova de inexistencia"));
  check("[C3] busca de conhecimento vazia continua sendo desconhecido", prompt.includes("knowledge_search vazia") && prompt.includes("nao confirmado"));
  check("[C4] contrato é geral, sem remendo lexical do incidente", !/\bvagas?\b|\bcontratando\b|\bcurriculo\b/.test(prompt));

  console.log(`\nF2.88: ${ok} OK / ${fail} FALHA`);
  if (fail > 0) process.exitCode = 1;
}

void main();
