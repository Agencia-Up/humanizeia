import { createInitialState } from "../src/domain/conversation-state.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { deriveFallbackUnderstanding, resolveTurnTarget, validateTurnUnderstanding } from "../src/engine/turn-understanding.ts";
import { resolveSelectedVehicle } from "../src/engine/lead-extraction.ts";
import { constraintsToStockInput, detectCommercialConstraints } from "../src/engine/commercial-constraints.ts";
import type { TurnUnderstanding } from "../src/domain/agent-brain.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0;
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { fail += 1; console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`); }
}

const NOW = "2026-07-13T00:00:00.000Z";
const ECO: VehicleFact = {
  vehicleKey: "bndv:eco-2020", marca: "Ford", modelo: "EcoSport", ano: 2020,
  preco: 71990, km: 108600, cambio: "Automatico", cor: "Cinza", tipo: "suv",
};
const catalog = buildTenantCatalog([ECO]);
const extractor = new CatalogClaimExtractor(catalog);

console.log("== F2.54: contratos achados no audit real DeepSeek ==");

{
  const block = "[CPF_VALIDO_REF_abc_FINAL_7735]\n[DATA_NASCIMENTO_VALIDA_REF_def]";
  const fallback = deriveFallbackUnderstanding(block, {
    mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false,
    mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous",
  }, extractor);
  check("[S-1] token sensivel possui ato proprio", fallback.primaryIntent === "sensitive_data", fallback.primaryIntent);
  const staleVisit: TurnUnderstanding = {
    primaryIntent: "visit", requestedCapabilities: [], subject: "none", subjectValue: null,
    subjectSource: "memory", isTopicChange: false, answeredLeadQuestions: [], evidence: [{ quote: block }],
  };
  const staleValidation = validateTurnUnderstanding(staleVisit, block, true);
  check("[S-2] memoria de visita nao vence CPF/data atuais", !staleValidation.trusted && (staleValidation.semanticIssues ?? []).some((x) => x.includes("sensitive_data")), JSON.stringify(staleValidation.semanticIssues));
  const current: TurnUnderstanding = { ...staleVisit, primaryIntent: "sensitive_data", subjectSource: "current_turn" };
  check("[S-3] understanding sensitive_data atual e confiavel", validateTurnUnderstanding(current, block, true).trusted);
}

{
  const block = "Na verdade quero um sedan hibrido ate 120 mil";
  const c = detectCommercialConstraints({
    block,
    signals: {
      mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false,
      mentionsPopular: false, mentionsVehicleType: "sedan", isMemoryQuestion: false, relation: "ambiguous",
    },
    claimExtractor: extractor,
  });
  const input = constraintsToStockInput(c);
  check("[H-1] hibrido e requisito comercial explicito", c.hibrido === true && c.tipo === "sedan" && c.precoMax === 120000, JSON.stringify(c));
  check("[H-2] busca preserva hibrido no contrato da tool", input.hibrido === true, JSON.stringify(input));
}

{
  const block = "Ta com quantos km? tem fotos?";
  const mixed: TurnUnderstanding = {
    primaryIntent: "vehicle_detail", requestedCapabilities: ["vehicle_details", "send_photos"],
    subject: "selected_vehicle", subjectValue: null, subjectSource: "memory", isTopicChange: false,
    answeredLeadQuestions: [], evidence: [
      { capability: "vehicle_details", quote: "quantos km" },
      { capability: "send_photos", quote: "tem fotos" },
    ],
  };
  check("[M-1] turno misto km+foto aceita vehicle_detail como ato primario", validateTurnUnderstanding(mixed, block, true).trusted);
  const fallback = deriveFallbackUnderstanding(block, {
    mentionsPhoto: true, mentionsStore: false, mentionsMoreOptions: false,
    mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous",
  }, extractor);
  check("[M-2] fallback conserva as duas capabilities", fallback.requestedCapabilities.includes("vehicle_details") && fallback.requestedCapabilities.includes("send_photos"), JSON.stringify(fallback));
  const searchBlock = "Quero um SUV automatico ate 90 mil";
  const search: TurnUnderstanding = {
    primaryIntent: "search_stock", requestedCapabilities: ["stock_search"], subject: "vehicle_type",
    subjectValue: "suv", subjectSource: "current_turn", isTopicChange: true, answeredLeadQuestions: [],
    evidence: [{ capability: "stock_search", quote: searchBlock }],
  };
  check("[M-3] automatico em filtro de busca nao vira vehicle_detail", validateTurnUnderstanding(search, searchBlock, true).trusted);
  const adDetailSearch: TurnUnderstanding = {
    ...search, subject: "explicit_model", subjectValue: "HB20X",
    evidence: [{ capability: "stock_search", quote: "Quantos km" }],
  };
  check("[M-4] anuncio+atributo pode buscar o veiculo antes do detalhe", validateTurnUnderstanding(adDetailSearch, "Quantos km", true).trusted);
  const selectionAndFinance: TurnUnderstanding = {
    primaryIntent: "financing", requestedCapabilities: [], subject: "selected_vehicle", subjectValue: null,
    subjectSource: "memory", isTopicChange: false, answeredLeadQuestions: [],
    evidence: [{ quote: "Gostei dele. Tenho 15 mil de entrada e quero financiar o restante" }],
  };
  check("[M-5] selecao+financiamento aceita financiamento como ato principal", validateTurnUnderstanding(selectionAndFinance, "Gostei dele. Tenho 15 mil de entrada e quero financiar o restante", true).trusted);
}

{
  const state = createInitialState({ conversationId: "conv-f254", tenantId: "tenant", agentId: "agent", now: NOW });
  state.lastRenderedOfferContext = {
    sourceTurnId: "t-offer", createdAt: NOW,
    items: [{ ordinal: 1, vehicleKey: ECO.vehicleKey, marca: ECO.marca, modelo: ECO.modelo, ano: ECO.ano, preco: ECO.preco, cor: ECO.cor, tipo: ECO.tipo }],
  };
  const misleadingMemorySubject: TurnUnderstanding = {
    primaryIntent: "request_photos", requestedCapabilities: ["send_photos"], subject: "selected_vehicle",
    subjectValue: "Renegade", subjectSource: "memory", isTopicChange: false, answeredLeadQuestions: [],
    evidence: [{ capability: "send_photos", quote: "tem fotos?" }],
  };
  const target = resolveTurnTarget({
    understanding: misleadingMemorySubject, leadMessage: "Ta com quantos km? tem fotos?", state,
    claimExtractor: extractor, knownModels: new Map([[ECO.vehicleKey, { marca: ECO.marca, modelo: ECO.modelo }]]),
  });
  check("[P-1] oferta unica atual vence subjectValue herdado", target.kind === "resolved" && target.vehicleKey === ECO.vehicleKey, JSON.stringify(target));
  check("[P-2] fonte observavel e single_offer", target.kind === "resolved" && target.source === "single_offer", JSON.stringify(target));
}

{
  const state = createInitialState({ conversationId: "conv-color", tenantId: "tenant", agentId: "agent", now: NOW });
  state.lastRenderedOfferContext = {
    sourceTurnId: "t-colors", createdAt: NOW,
    items: [
      { ordinal: 1, vehicleKey: "v-black", marca: "Fiat", modelo: "Fastback", ano: 2025, cor: "Preto" },
      { ordinal: 2, vehicleKey: "v-silver", marca: "Fiat", modelo: "Fastback", ano: 2025, cor: "Prata" },
    ],
  };
  const selected = resolveSelectedVehicle("Gostaria de ver esse prata e os opcionais", state, extractor);
  check("[C-1] atributo unico da oferta resolve o item prata", selected?.key === "v-silver", JSON.stringify(selected));
  state.lastRenderedOfferContext.items.push({ ordinal: 3, vehicleKey: "v-silver-2", marca: "Fiat", modelo: "Cronos", ano: 2024, cor: "Prata" });
  check("[C-2] cor ambigua nao escolhe arbitrariamente", resolveSelectedVehicle("quero esse prata", state, extractor) == null);
}

console.log(`\n== F2.54: ${ok} OK | ${fail} FALHA ==`);
if (fail > 0) process.exit(1);
