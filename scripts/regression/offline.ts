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
import { isGenericFleetQuery } from "../../supabase/functions/_shared/pedro-v2/adContext_20260525.ts";
import { ensureSelfIntroduction, replyHasSelfIntroduction } from "../../supabase/functions/_shared/pedro-v2/preSendVerify.ts";
import {
  buildStockFilters,
  leadMessageAsksBroadStock,
  leadMessageHasExplicitPriceCeiling,
  messageAsksForPhotos,
  detectPhotoTarget,
  queryIsBroadOrGenericVehicle,
  isValidName,
  detectLeadDirectionChange,
  leadAsksForMoreOptions,
  vehicleDedupKey,
  excludeAlreadyPresented,
  pickRoundRobinSeller,
  leadRefinesVehicleNeedsSearch,
  contextVehicleModel,
  replyDeniesAvailability,
  parsePriceCeiling,
  detectLeadRejection,
  updateRejeitados,
  clearRejeitadoOnRequest,
  buildConversationState,
  excludeRejeitados,
  escapeRegExp,
  photoRequestTargetModel,
  leadComplainsPhotoWrongOrMissing,
  messageIsTooVagueToAct,
  leadExpressesVisitOrBuyIntent,
  leadExplicitlyDeclined,
  leadAsksAnyCarInBudget,
  leadProvidingTradeDetails,
  nextFunnelQuestion,
  replyAsksFunnelQuestion,
  replyHasMeaningfulQuestion,
  replyIsGracefulClose,
  leadAsksInfoQuestion,
  leadAffirmsSchedulingQuestion,
  leadAffirmsPresenceToFollowupPing,
  classifyAgentReplyPending,
} from "../../supabase/functions/_shared/pedro-v2/decisionLogic.ts";
import { verifyReplyText, replyMentionsAnyVehicle, detectUngroundedSpecs, neutralizeUngroundedSpecs, replyOffersPhotos, rewriteUnavailablePhotoOffer, detectUngroundedClaims, neutralizeUngroundedClaims, detectAiIdentityLeak, neutralizeAiIdentityLeak, replyDefersSearch, transferMessageIsClear, ensureTransferContactClarity, stripTrailingFillerQuestion } from "../../supabase/functions/_shared/pedro-v2/preSendVerify.ts";
import { buildDeterministicStockReply } from "../../supabase/functions/_shared/pedro-v2/pedroBrainReply_20260525.ts";
import { validateGrounding, extractVehiclePriceClaims } from "../../supabase/functions/_shared/pedro-v2/grounding.ts";
import { uniqueSellersByPhone } from "../../supabase/functions/_shared/transfer/phoneKey.ts";
import {
  pickReferencedVehicle,
  buildVehiclePhotoReply,
  sameVehicleModel,
  leadRequestsAllVehiclePhotos,
  vehicleKey,
} from "../../supabase/functions/_shared/pedro-v2/photoLogic.ts";

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

  // ── CASO #1: LEAD MUDOU DE DIREÇÃO depois do anúncio (backstop + detector) ──
  const planAd = (msg: string, raw: any, adVeh: string) =>
    normalizePlan(raw, FALLBACK, { message: msg, vehicle_resolution: vr() as any, memory: null, recent_history: [], ad_context: { has_ad_context: true, vehicle_query: adVeh } } as any);
  // anúncio = Tracker; lead AMPLIA para "suv" -> NÃO trava no Tracker, busca ampla do tipo.
  const d1 = planAd("procuro um suv 2020 pra frente", { action: "stock_search", intent: "stock_lookup", search_query: "Chevrolet Tracker", search_filters: { modelo_desejado: "Chevrolet Tracker" }, confidence: 0.7 }, "Chevrolet Tracker Premier 1.2 2023");
  check("planner", "anúncio Tracker + 'procuro suv' -> busca TIPO suv (não Tracker)", d1.search_filters?.tipo_veiculo === "suv" && !/tracker/i.test(String(d1.search_query || "")) && Boolean(d1.search_filters?.stock_broad), `q=${d1.search_query} tipo=${d1.search_filters?.tipo_veiculo} broad=${d1.search_filters?.stock_broad}`);
  // CONTRA-PROVA: "esse suv tem teto solar?" é sobre O carro do anúncio -> NÃO amplia (mantém Tracker).
  const d2 = planAd("esse suv tem teto solar?", { action: "stock_search", intent: "stock_lookup", search_query: "Chevrolet Tracker", search_filters: { modelo_desejado: "Chevrolet Tracker" }, confidence: 0.7 }, "Chevrolet Tracker Premier 1.2 2023");
  check("planner", "esse suv tem teto? mantem carro do anuncio", /tracker/i.test(String(d2.search_query || d2.search_filters?.modelo_desejado || "")), `q=${d2.search_query}`);

  const moreSuv = plan("tem mais opcoes?", { action: "reply_only", intent: "unknown", confidence: 0.6 }, { interesse: { tipo_veiculo: "suv", preco_max: 70000 } });
  check("planner", "mais opcoes herda tipo SUV", moreSuv.action === "stock_search" && moreSuv.search_filters?.tipo_veiculo === "suv" && moreSuv.search_filters?.stock_broad === true, JSON.stringify(moreSuv));
  check("planner", "mais opcoes herda preco anterior", Number(moreSuv.search_filters?.preco_max) === 70000, JSON.stringify(moreSuv));

  const sedanPlural = plan("Queria sedans ate 80k", { action: "stock_search", intent: "stock_lookup", search_query: "sedans", search_filters: { modelo_desejado: "sedans", tipo_veiculo: "sedan", preco_max: 80000 }, confidence: 0.9 });
  check("planner", "sedans plural vira tipo, nao modelo", sedanPlural.action === "stock_search" && sedanPlural.search_query === null && sedanPlural.search_filters?.stock_broad === true && sedanPlural.search_filters?.modelo_desejado === null && sedanPlural.search_filters?.tipo_veiculo === "sedan", JSON.stringify(sedanPlural));
  // ── CASO Alê: refina VERSÃO/MOTOR de veículo em contexto -> CHECA estoque (nunca nega de cabeça) ──
  const memCompass = { veiculos_apresentados: [{ marca: "Jeep", modelo: "Compass", versao: "LIMITED 2.0", ano: 2019, preco: 107990 }] };
  const r1 = normalizePlan({ action: "reply_only", intent: "vehicle_reference", confidence: 0.7 }, FALLBACK, { message: "Não amigo. Seria o modelo 270 com nova motorização.", vehicle_resolution: vr() as any, memory: memCompass, recent_history: [] } as any);
  check("planner", "'seria o modelo 270' (Compass em contexto) -> FORÇA busca do Compass", r1.action === "stock_search" && /compass/i.test(String(r1.search_query || r1.search_filters?.modelo_desejado || "")), `action=${r1.action} q=${r1.search_query}`);
  // CONTRA-PROVA: despedida pura NÃO força busca.
  const r2 = normalizePlan({ action: "reply_only", intent: "thanks", confidence: 0.7 }, FALLBACK, { message: "No momento seria só esse mesmo. Mas agradeço.", vehicle_resolution: vr() as any, memory: memCompass, recent_history: [] } as any);
  check("planner", "despedida 'agradeço' NÃO vira busca", r2.action === "reply_only", `action=${r2.action}`);

  // ── CASO Hilux (35-98788375): lead troca de interesse, LLM rotula trade_in errado, agente NEGA ──
  // trade_in só bloqueia busca com sinal REAL de troca; nomear veículo de compra tem que buscar.
  const h1 = normalizePlan({ action: "reply_only", intent: "trade_in", confidence: 0.7 }, FALLBACK, { message: "não\na Hilux cabine simples", vehicle_resolution: vr({ has_current_vehicle_signal: true, query: "Toyota Hilux" }) as any, memory: null, recent_history: [] } as any);
  check("planner", "'a Hilux cabine simples' (LLM rotulou trade_in, SEM sinal real) -> BUSCA", h1.action === "stock_search" && /hilux/i.test(String(h1.search_query || h1.search_filters?.modelo_desejado || "")), `action=${h1.action} q=${h1.search_query}`);
  // CONTRA-PROVA: troca REAL (carro do lead) continua bloqueando a busca desse carro.
  const h2 = normalizePlan({ action: "reply_only", intent: "trade_in", confidence: 0.7 }, FALLBACK, { message: "tenho uma hilux 2015 pra dar na troca", vehicle_resolution: vr({ has_current_vehicle_signal: true, query: "Toyota Hilux" }) as any, memory: null, recent_history: [] } as any);
  check("planner", "troca REAL 'tenho uma hilux pra trocar' -> NÃO busca", h2.action !== "stock_search", `action=${h2.action}`);

  // PROMETE E NÃO CUMPRE (foto): reclamação -> força photo_request (não promete).
  const pc1 = normalizePlan({ action: "reply_only", intent: "vehicle_reference", confidence: 0.7 }, FALLBACK, { message: "Essas fts n são peugeot\nVc n mandou do carro certo", vehicle_resolution: vr() as any, memory: { interesse: { modelo_desejado: "Peugeot 2008 2021" } }, recent_history: [] } as any);
  check("planner", "reclamação de foto errada -> força photo_request (não promete)", pc1.action === "photo_request", `action=${pc1.action}`);

  // ── CAMADA DE VERIFICAÇÃO PRÉ-ENVIO (Chain-of-Verification) ──
  const vTypes = (r: string, ctx?: any) => verifyReplyText(r, ctx).map((v) => v.type);
  check("verificacao", "promessa de foto SEM mídia anexada -> promise_undelivered_media", vTypes("Vou verificar e enviar as fotos corretas pra você!", { mediaCount: 0 }).includes("promise_undelivered_media"));
  check("verificacao", "promessa de foto COM mídia anexada -> OK (está enviando)", vTypes("Vou enviar as fotos do Onix agora!", { mediaCount: 5 }).length === 0);
  check("verificacao", "oferta no presente ('quer ver as fotos?') -> NÃO é promessa", vTypes("Quer ver as fotos dele? Posso te mostrar!", { mediaCount: 0 }).length === 0);
  check("verificacao", "retorno assíncrono ('vou verificar e já te aviso') -> promise_async_followup", vTypes("Vou verificar o consumo e já te aviso, tá?", {}).includes("promise_async_followup"));
  check("verificacao", "transferência ('o consultor vai entrar em contato') -> NÃO viola", vTypes("Perfeito! O consultor vai entrar em contato com você em instantes.", {}).length === 0);
  check("verificacao", "nega disponibilidade sem ter buscado -> denies_without_search", vTypes("Infelizmente não temos o Compass no momento.", { hasVehicleSignal: true, searchedThisTurn: false }).includes("denies_without_search"));
  check("verificacao", "nega MAS buscou neste turno -> NÃO viola (busca rodou)", vTypes("Infelizmente não temos o Compass no momento.", { hasVehicleSignal: true, searchedThisTurn: true }).length === 0);
  check("verificacao", "re-oferece modelo REJEITADO -> offers_rejected", vTypes("Temos um Onix lindo, quer ver?", { rejeitadosModelos: ["Onix"] }).includes("offers_rejected"));

  // Apresentação de CATEGORIA: o reply cita ao menos UM veículo achado? (gap 4.1-mini: às vezes só saúda)
  const _suvs = [{ modelo: "Pajero TR4", marca: "Mitsubishi" }, { modelo: "Tracker", marca: "Chevrolet" }, { modelo: "Renegade", marca: "Jeep" }];
  check("verificacao", "reply lista SUVs -> menciona veículo (não relista)", replyMentionsAnyVehicle("Temos o Pajero TR4 e o Renegade...", _suvs) === true);
  check("verificacao", "reply só saúda/rapport -> NÃO menciona veículo (relista)", replyMentionsAnyVehicle("Boa tarde! Você é de Taubaté mesmo? Já conhece a nossa loja?", _suvs) === false);
  check("verificacao", "reply cita por MARCA -> menciona veículo", replyMentionsAnyVehicle("Temos uma Honda City linda!", [{ modelo: "City", marca: "Honda" }]) === true);

  // ── "QUANDO INCERTO, PERGUNTAR — NÃO CHUTAR" (qualificação de lead vago) ──
  check("qualificacao", "'quero um carro' -> vago (pergunta, não despeja)", messageIsTooVagueToAct("quero um carro") === true);
  check("qualificacao", "'me ajuda a escolher um carro' -> vago", messageIsTooVagueToAct("me ajuda a escolher um carro") === true);
  check("qualificacao", "'qual o melhor de vocês?' -> vago", messageIsTooVagueToAct("qual o melhor de vocês?") === true);
  check("qualificacao", "'não sei qual escolher' -> vago", messageIsTooVagueToAct("não sei qual escolher") === true);
  check("qualificacao", "'quero um suv' -> NÃO vago (tem tipo)", messageIsTooVagueToAct("quero um suv") === false);
  check("qualificacao", "'quero um onix' -> NÃO vago (tem modelo)", messageIsTooVagueToAct("quero um onix") === false);
  check("qualificacao", "'quero um carro até 50 mil' -> NÃO vago (tem preço)", messageIsTooVagueToAct("quero um carro até 50 mil") === false);
  check("qualificacao", "'o que vocês têm?' -> NÃO vago (mostruário, apresenta)", messageIsTooVagueToAct("o que vocês têm?") === false);
  check("qualificacao", "com interesse na memória -> NÃO vago (usa o interesse)", messageIsTooVagueToAct("me ajuda", { interesse: { tipo_veiculo: "suv" } }) === false);

  // ── VISITA/COMPRA -> agendar+coletar antes de transferir (lead 98861-9201) ──
  check("agendamento", "'Irei até a loja' -> intenção de visita", leadExpressesVisitOrBuyIntent("Irei até a loja") === true);
  check("agendamento", "'vou na loja amanhã' -> visita", leadExpressesVisitOrBuyIntent("vou na loja amanhã") === true);
  check("agendamento", "'quero comprar o onix' -> compra", leadExpressesVisitOrBuyIntent("quero comprar o onix") === true);
  check("agendamento", "'quero visitar' -> visita", leadExpressesVisitOrBuyIntent("quero visitar pra ver de perto") === true);
  check("agendamento", "'vou querer' -> compra", leadExpressesVisitOrBuyIntent("acho que vou querer") === true);
  check("agendamento", "'quero um carro da loja' -> NÃO é visita (é busca)", leadExpressesVisitOrBuyIntent("quero um carro da loja de vocês") === false);
  check("agendamento", "'onde fica a loja?' -> NÃO é visita (pergunta)", leadExpressesVisitOrBuyIntent("onde fica a loja?") === false);
  check("agendamento", "'vou pensar' -> NÃO é visita/compra", leadExpressesVisitOrBuyIntent("vou pensar e te falo") === false);

  // ── NÃO ENCERRAR LEAD QUALIFICADO: recusa explícita vs agradecimento (lead 99603-7979 "Grata!") ──
  check("agendamento", "'Grata!' -> NÃO é recusa (lead qualificado vai anunciado)", leadExplicitlyDeclined("Grata!") === false);
  check("agendamento", "'obrigado' -> NÃO é recusa", leadExplicitlyDeclined("obrigado, fico no aguardo") === false);
  check("agendamento", "'não quero mais' -> recusa (preserva silêncio)", leadExplicitlyDeclined("não quero mais, obrigado") === true);
  check("agendamento", "'só estava olhando' -> recusa", leadExplicitlyDeclined("na verdade só estava olhando") === true);
  check("agendamento", "'desisti' -> recusa", leadExplicitlyDeclined("desisti por enquanto") === true);

  // ── TROCA: lead descrevendo o carro -> COLETA (não transferir no meio) — lead 99628-7178 ──
  check("troca", "'17500 km' -> descrevendo a troca", leadProvidingTradeDetails("17500 km") === true);
  check("troca", "'Revisado' -> descrevendo a troca", leadProvidingTradeDetails("Revisado") === true);
  check("troca", "'Embreagem, Correia dentada, freio' -> descrevendo a troca", leadProvidingTradeDetails("Embreagem, Correia dentada, freio") === true);
  check("troca", "'Tudo ok' -> descrevendo a troca", leadProvidingTradeDetails("Tudo ok") === true);
  check("troca", "'Quero o Hilux' -> NÃO é descrição de troca", leadProvidingTradeDetails("Quero o Hilux") === false);
  check("troca", "'quanto fica?' -> NÃO é descrição de troca", leadProvidingTradeDetails("quanto fica?") === false);

  // ── ANÚNCIO de FROTA genérico -> vehicle_query falso é zerado (lead 98109-7851) ──
  check("anuncio", "'veículos revisados e prontos para você' -> genérico", isGenericFleetQuery("veículos revisados e prontos para você") === true);
  check("anuncio", "'diversos modelos disponíveis' -> genérico", isGenericFleetQuery("diversos modelos disponíveis") === true);
  check("anuncio", "'confira nossas ofertas' -> genérico", isGenericFleetQuery("confira nossas ofertas") === true);
  check("anuncio", "'fale com um consultor' -> genérico", isGenericFleetQuery("fale com um de nossos consultores") === true);
  check("anuncio", "'seminovos' -> genérico", isGenericFleetQuery("seminovos com procedência") === true);
  check("anuncio", "'Jeep Renegade 2020' -> veículo REAL (não zera)", isGenericFleetQuery("Jeep Renegade 2020") === false);
  check("anuncio", "'Onix LT' -> veículo REAL (não zera)", isGenericFleetQuery("Chevrolet Onix LT") === false);
  check("anuncio", "'VW Gol' -> veículo REAL (não zera)", isGenericFleetQuery("VW Gol") === false);
  check("anuncio", "'Corolla 2009' -> veículo REAL (não zera)", isGenericFleetQuery("Corolla 2009") === false);

  // ── APRESENTAÇÃO no 1º contato (BLOCO 3, híbrido) — lead 98109-7851 / Creta etc. ──
  {
    const _opts = { agentName: "Carvalho", companyName: "Icom Motors", greeting: "Boa tarde" };
    const _r1 = ensureSelfIntroduction("Temos um Hyundai Creta 2025 disponível!", _opts);
    check("apresentacao", "carro sem saudação -> prepõe saudação + apresentação", _r1.added === true && /Aqui é o Carvalho, consultor da Icom Motors/.test(_r1.text) && /Temos um Hyundai Creta/.test(_r1.text));
    const _r2 = ensureSelfIntroduction("Boa tarde, Sérgio! Temos um Creta.", _opts);
    check("apresentacao", "saudação já existe -> insere apresentação após a saudação", _r2.added === true && /^Boa tarde, Sérgio! Aqui é o Carvalho/.test(_r2.text) && /Temos um Creta\./.test(_r2.text));
    const _r3 = ensureSelfIntroduction("Sou o Carvalho da Icom Motors. Temos um Creta.", _opts);
    check("apresentacao", "já se apresentou -> NÃO duplica", _r3.added === false);
    // ⭐splice (Avant Manu): saudação SEM nome -> NÃO enfia a apresentação no meio ("Temos Aqui é o Manu...")
    const _r4 = ensureSelfIntroduction("Boa tarde! Temos várias opções de SUVs.", _opts);
    check("apresentacao", "saudação sem nome -> apresentação após a saudação (não no meio de 'Temos')", _r4.added === true && /^Boa tarde! Aqui é o Carvalho/.test(_r4.text) && !/Temos Aqui é/.test(_r4.text) && /Temos várias opções de SUVs/.test(_r4.text));
    check("apresentacao", "replyHasSelfIntroduction reconhece 'Aqui é o ...'", replyHasSelfIntroduction("Aqui é o Carvalho, consultor da Icom Motors 😊") === true);
    check("apresentacao", "replyHasSelfIntroduction falso em apresentação de carro", replyHasSelfIntroduction("Temos um Creta 2025 disponível!") === false);
  }

  // ── FUNIL FORÇADO: próxima pergunta obrigatória do funil do cliente (agent_funnel_config.bloco4) ──
  {
    const _b4 = { questions: ["Qual e seu nome?", "Tem algum carro para dar de troca?", "Tem valor para dar de entrada?", "Você sabe onde fica a nossa loja?"] };
    check("funil", "sem nada respondido + sem nome -> pergunta o nome", nextFunnelQuestion(_b4, {}, { hasName: false }) === "Qual e seu nome?");
    check("funil", "nome conhecido (pushName) -> pula p/ troca", nextFunnelQuestion(_b4, {}, { hasName: true }) === "Tem algum carro para dar de troca?");
    check("funil", "nome+troca resp. -> pergunta entrada", nextFunnelQuestion(_b4, { tem_troca: false }, { hasName: true }) === "Tem valor para dar de entrada?");
    check("funil", "lead gostou mas falta troca -> pergunta antes de transferir", nextFunnelQuestion(_b4, { interesse: "SUV ate 80k" }, { hasName: true, hasInterest: true }) === "Tem algum carro para dar de troca?");
    check("funil", "tudo respondido -> null", nextFunnelQuestion(_b4, { nome: "João", tem_troca: true, valor_entrada: "10 mil", sabe_localizacao: true }, { hasName: true }) === null);
    check("funil", "sem bloco4 -> null", nextFunnelQuestion(undefined, {}, { hasName: false }) === null);
    check("funil", "reply 'qual quer ver fotos?' NÃO é pergunta de funil", replyAsksFunnelQuestion("Qual desses você quer ver fotos?") === false);
    check("funil", "reply 'qual seu nome?' É pergunta de funil", replyAsksFunnelQuestion("E qual é o seu nome?") === true);
    check("funil", "reply 'conhece a nossa loja?' É pergunta de funil", replyAsksFunnelQuestion("Você já conhece a nossa loja?") === true);
    check("funil", "reply sem '?' não conta", replyAsksFunnelQuestion("Temos um Onix disponível.") === false);
  }

  // ── SDR PROATIVO: responde + qualifica; isca não conta como pergunta; "o que procura?" mapeada (Avant) ──
  {
    const _avant = { questions: ["Qual é o seu nome?", "O que você está procurando?"] };
    // "O que você está procurando?" agora é MAPEÁVEL (interesse): sem interesse -> é a próxima pergunta
    check("sdr", "Avant: nome conhecido + sem interesse -> 'O que você está procurando?'", nextFunnelQuestion(_avant, {}, { hasName: true }) === "O que você está procurando?");
    check("sdr", "Avant: com interesse -> null (tudo respondido)", nextFunnelQuestion(_avant, { interesse: "onix" }, { hasName: true }) === null);
    check("sdr", "Avant: hasInterest=true -> null", nextFunnelQuestion(_avant, {}, { hasName: true, hasInterest: true }) === null);
    // isca NÃO é pergunta significativa -> SDR-force deve disparar
    check("sdr", "'...Precisa de mais alguma informação?' NÃO é pergunta significativa", replyHasMeaningfulQuestion("Nossa loja fica em Taubaté. Precisa de mais alguma informação?") === false);
    check("sdr", "'Quer ver fotos do Onix?' É significativa", replyHasMeaningfulQuestion("Temos o Onix. Quer ver fotos do Onix?") === true);
    check("sdr", "'O que você está procurando?' É significativa", replyHasMeaningfulQuestion("Beleza! O que você está procurando?") === true);
    check("sdr", "'Tem carro pra troca?' É significativa", replyHasMeaningfulQuestion("Tem algum carro pra dar de troca?") === true);
    check("sdr", "sem '?' não é significativa", replyHasMeaningfulQuestion("Nossa loja fica em Taubaté.") === false);
    // strip da isca
    check("sdr", "strip: tira 'Precisa de mais alguma informação?'", stripTrailingFillerQuestion("Nossa loja fica em Taubaté. Precisa de mais alguma informação?").trim() === "Nossa loja fica em Taubaté.");
    check("sdr", "strip: tira 'Posso ajudar em mais alguma coisa?'", /Posso ajudar/i.test(stripTrailingFillerQuestion("Endereço é Av X, 25. Posso ajudar em mais alguma coisa?")) === false);
    check("sdr", "strip: NÃO tira pergunta de venda ('Quer ver fotos?')", /Quer ver fotos/i.test(stripTrailingFillerQuestion("Temos o Onix. Quer ver fotos?")) === true);
    // não puxa funil em cima de despedida
    check("sdr", "fechamento gracioso -> detectado (não qualificar)", replyIsGracefulClose("Tranquilo, Wander! Não vou tomar seu tempo. Qualquer coisa é só me chamar. 👍") === true);
    check("sdr", "'fico à disposição' -> fechamento", replyIsGracefulClose("Obrigado! Fico à disposição.") === true);
    check("sdr", "resposta normal NÃO é fechamento", replyIsGracefulClose("Nossa loja fica em Taubaté.") === false);
    // ⭐GATILHO: só qualifica quando o LEAD PERGUNTA (não em pedido de foto / resposta curta) — lead 99742-3129
    check("sdr", "'me manda fotos do Ford Ka' NÃO é pergunta (pedido)", leadAsksInfoQuestion("me manda fotos do Ford Ka") === false);
    check("sdr", "'ford ka' NÃO é pergunta (resposta curta)", leadAsksInfoQuestion("ford ka") === false);
    check("sdr", "'sim' NÃO é pergunta", leadAsksInfoQuestion("sim") === false);
    check("sdr", "'tenho um gol pra troca' NÃO é pergunta (afirmação)", leadAsksInfoQuestion("tenho um gol pra troca") === false);
    check("sdr", "'onde fica a loja?' É pergunta", leadAsksInfoQuestion("onde fica a loja?") === true);
    check("sdr", "'vcs tem carro pra negativado' É pergunta (casual sem ?)", leadAsksInfoQuestion("vcs tem carro pra negativado dando entrada") === true);
    check("sdr", "'qual o valor do onix' É pergunta", leadAsksInfoQuestion("qual o valor do onix") === true);
    check("sdr", "'vcs financiam?' É pergunta", leadAsksInfoQuestion("vcs financiam?") === true);
    // ⭐"SIM" a PING DE FOLLOW-UP = presença, NÃO foto (lead 3199-6370: "ainda está por aí?"→"Sim"→5 fotos)
    check("sdr", "'Sim' a 'Ainda está por aí?' = presença (não foto)", leadAffirmsPresenceToFollowupPing("Sim", "Ainda está por aí?") === true);
    check("sdr", "'to aqui' a 'Conseguiu dar uma olhada?' = presença", leadAffirmsPresenceToFollowupPing("to aqui", "Conseguiu dar uma olhada nas opções que mandei?") === true);
    check("sdr", "'Sim, manda as fotos' a ping NÃO é só presença (pediu foto)", leadAffirmsPresenceToFollowupPing("Sim, manda as fotos", "Ainda está por aí?") === false);
    check("sdr", "'Sim' a OFERTA DE FOTO ('quer ver fotos?') NÃO é ping de presença", leadAffirmsPresenceToFollowupPing("Sim", "Quer ver fotos de algum desses?") === false);
  }

  // ── PENDING_QUESTION PERSISTIDO (Codex): classifica o que a RESPOSTA do agente perguntou/ofereceu ──
  {
    const P = classifyAgentReplyPending;
    // SOURCE determinístico (mais forte que o texto):
    check("pending", "source pick_which -> ofereceu_fotos", P("De qual você quer ver?", "vehicle_photos_pick_which") === "ofereceu_fotos");
    check("pending", "source trade_collecting -> perguntou_troca", P("Show, anotei tudo do seu carro!", "trade_collecting") === "perguntou_troca");
    check("pending", "source visit_cpf_qualify -> perguntou_dados", P("Me passa seu CPF?", "visit_cpf_qualify") === "perguntou_dados");
    check("pending", "source ad_generic_abordagem -> perguntou_veiculo", P("Aqui é o Carvalho. O que você procura?", "ad_generic_abordagem") === "perguntou_veiculo");
    check("pending", "source followup_ping_reengage -> ofereceu_opcoes", P("Que bom que está por aí! Quer ver outras opções?", "followup_ping_reengage") === "ofereceu_opcoes");
    // TEXTO (resposta do LLM brain_reply, onde o source não diz):
    check("pending", "texto: oferta de foto -> ofereceu_fotos", P("Quer ver fotos de algum desses?", "brain_stock_reply") === "ofereceu_fotos");
    check("pending", "texto: oferta de opções -> ofereceu_opcoes", P("Posso te mostrar outras opções de hatch?", "brain_reply") === "ofereceu_opcoes");
    check("pending", "texto: pergunta de troca -> perguntou_troca", P("Tem algum carro para dar de troca?", "brain_reply") === "perguntou_troca");
    check("pending", "texto: pergunta de pagamento -> perguntou_pagamento", P("Você pretende pagar à vista ou financiado?", "brain_reply") === "perguntou_pagamento");
    check("pending", "texto: pergunta de nome -> perguntou_dados", P("Qual é o seu nome?", "brain_reply") === "perguntou_dados");
    check("pending", "texto: pergunta de veículo -> perguntou_veiculo", P("Qual carro você está procurando?", "brain_reply") === "perguntou_veiculo");
    check("pending", "texto: pergunta genérica -> fez_pergunta", P("Posso te ajudar com mais alguma coisa?", "brain_reply") === "fez_pergunta");
    check("pending", "texto: afirmação sem pergunta -> afirmacao", P("Perfeito, vou anotar isso.", "brain_reply") === "afirmacao");
    check("pending", "vazio -> nenhum", P("", "brain_reply") === "nenhum");
    // ⭐CRÍTICO: foto + qualificação na MESMA fala NÃO vira ofereceu_fotos (a qualificação vence) — assim o
    // "sim/ok" do lead não é lido como pedido de foto quando o agente perguntou troca/pagamento junto.
    check("pending", "'vou separar as fotos. Tem troca?' -> NÃO é ofereceu_fotos", P("Vou separar as fotos. Tem algum carro pra dar de troca?", "brain_reply") !== "ofereceu_fotos");
  }

  // ── VISITA: lead confirma a pergunta de agendamento -> colher dia/hora (lead 98198-7661) ──
  check("visita", "'Sim' após 'quer agendar visita?' -> é confirmação", leadAffirmsSchedulingQuestion("Sim", "Você tem interesse em agendar uma visita para ver o carro?") === true);
  check("visita", "'Sim' após pergunta de foto -> NÃO é agendamento", leadAffirmsSchedulingQuestion("Sim", "O Tracker está R$ 72.990. Quer ver fotos dele?") === false);
  check("visita", "'não' após 'quer agendar?' -> NÃO confirma", leadAffirmsSchedulingQuestion("não", "Quer agendar uma visita?") === false);
  check("visita", "'agendar visita' sem '?' (aviso) -> NÃO conta", leadAffirmsSchedulingQuestion("Sim", "Se quiser agendar uma visita é só avisar!") === false);

  // ── CLAREZA da transferência (lead 98198-7661) ──
  check("transfer", "'ele vai te chamar' é claro", transferMessageIsClear("Já passei pro consultor, ele vai te chamar!") === true);
  check("transfer", "'ele já vai ter tudo que me contou' NÃO é claro", transferMessageIsClear("Vou chamar nosso consultor agora. Ele já vai ter tudo que você me contou.") === false);
  {
    const _t = ensureTransferContactClarity("Vou chamar nosso consultor agora 👌 Ele já vai ter tudo que você me contou.");
    check("transfer", "msg vaga -> acrescenta 'entrar em contato'", _t.changed === true && /entrar em contato com você/.test(_t.text));
    check("transfer", "msg já clara -> não mexe", ensureTransferContactClarity("Pronto, o consultor vai entrar em contato com você!").changed === false);
  }

  // ── MOTO: aparece SÓ quando o lead quer moto; não vaza em carro/genérico (Avant — decisão do dono) ──
  {
    const moto: any = { markName: "HONDA", modelName: "CB 500", versionName: "", category: "MOTO" };
    const carro: any = { markName: "FIAT", modelName: "ARGO", versionName: "DRIVE", category: "AUTOMOVEL" };
    check("moto", "moto PASSA em busca de moto ('moto')", passesRequestedVehicleType(moto, { query: "moto" }, false) === true);
    check("moto", "moto PASSA em 'quero uma moto'", passesRequestedVehicleType(moto, { query: "quero uma moto" }, false) === true);
    check("moto", "moto NÃO passa em busca de SUV", passesRequestedVehicleType(moto, { query: "suv" }, false) === false);
    check("moto", "moto NÃO passa em browse genérico (vazio, sem modelo)", passesRequestedVehicleType(moto, { query: "" }, false) === false);
    check("moto", "moto PASSA quando NOMEADA (hasModelQuery)", passesRequestedVehicleType(moto, { query: "honda cb 500" }, true) === true);
    check("moto", "carro NÃO passa em busca de moto", passesRequestedVehicleType(carro, { query: "moto" }, false) === false);
  }

  // ── ANTI-ALUCINAÇÃO DE FICHA TÉCNICA (Solução D) ──
  check("ficha", "consumo inventado '13 km/l' (sem nos fatos) -> detecta", detectUngroundedSpecs("Esse Onix faz uns 13 km/l na cidade", "") .length > 0);
  check("ficha", "potência inventada '150cv' -> detecta", detectUngroundedSpecs("Tem 150cv de potência", "").includes("potencia:150"));
  check("ficha", "porta-malas inventado '470 litros' -> detecta", detectUngroundedSpecs("Porta-malas de 470 litros", "").includes("litros:470"));
  check("ficha", "potência ATERRADA na versão (116cv) -> NÃO alucina", detectUngroundedSpecs("Tem 116cv", "Chevrolet Onix 1.0 TURBO 116CV 2022").length === 0);
  check("ficha", "preço/km (R$69.900, 54.000 km) -> NÃO é spec", detectUngroundedSpecs("Custa R$ 69.900 e tem 54.000 km, cor preta", "").length === 0);
  check("ficha", "motor '1.0' / sem unidade de spec -> NÃO detecta", detectUngroundedSpecs("Tem motor 1.0 e é automático", "").length === 0);
  const _neut = neutralizeUngroundedSpecs("Temos o Onix 2020, lindo! Ele faz uns 13 km/l na cidade. Quer ver fotos?", "");
  check("ficha", "neutraliza: tira a frase do km/l", _neut.neutralized === true && !/13\s*km\/l/i.test(_neut.text));
  check("ficha", "neutraliza: mantém oferta + pergunta de foto", /onix/i.test(_neut.text) && /fotos/i.test(_neut.text) && /confirmar/i.test(_neut.text));
  check("ficha", "sem spec -> NÃO mexe na resposta", neutralizeUngroundedSpecs("Temos o Onix 2020 por R$ 65 mil, quer ver?", "").neutralized === false);

  // ── AFIRMAÇÕES NÃO-ATERRADAS NO PROMPT (garantia de fábrica / laudo) — lead 98861-9201 ──
  const _promptIcom = "garantia nos veículos de até 3 meses, não existe garantia superior a isso!";
  check("ficha", "laudo cautelar (não no prompt) -> detecta", detectUngroundedClaims("Sim, temos laudo cautelar disponível para o Polo.", _promptIcom).includes("laudo"));
  check("ficha", "garantia de fábrica (prompt diz 3 meses) -> detecta", detectUngroundedClaims("Sim, o Polo 2025 está na garantia de fábrica.", _promptIcom).includes("garantia_fabrica"));
  check("ficha", "garantia '3 meses' (do prompt) -> NÃO é invenção", detectUngroundedClaims("A garantia é de 3 meses, tá?", _promptIcom).length === 0);
  check("ficha", "loja COM laudo no prompt -> afirmar laudo é OK (não detecta)", detectUngroundedClaims("Sim, temos laudo cautelar.", "oferecemos laudo cautelar em todos os veículos").length === 0);
  const _nc = neutralizeUngroundedClaims("Sim, temos laudo cautelar disponível para o Polo.", _promptIcom);
  check("ficha", "neutraliza laudo inventado -> 'confirmar com a equipe'", _nc.neutralized === true && /confirmar/i.test(_nc.text) && !/temos laudo/i.test(_nc.text));

  // ── ANTI-VAZAMENTO DE IDENTIDADE / QUEBRA DE PERSONA (segurança) ──
  check("identidade", "'sou uma IA' -> detecta vazamento", detectAiIdentityLeak("Na verdade sou uma IA da Icom") === true);
  check("identidade", "'sou um assistente virtual' -> detecta", detectAiIdentityLeak("Sou um assistente virtual treinado pela OpenAI") === true);
  check("identidade", "'modelo de linguagem' -> detecta", detectAiIdentityLeak("Sou um modelo de linguagem, não uma pessoa") === true);
  check("identidade", "'Sou o Carvalho, consultor' -> NÃO vaza (persona OK)", detectAiIdentityLeak("Sou o Carvalho, consultor aqui da Icom Motors 😊") === false);
  check("identidade", "resposta normal de venda -> NÃO falso-positivo", detectAiIdentityLeak("Posso te ajudar com o Onix, quer ver as fotos?") === false);
  const _id = neutralizeAiIdentityLeak("Sou uma IA treinada pela OpenAI, mas posso ajudar!", "Carvalho");
  check("identidade", "neutraliza vazamento -> deflexão de persona (Carvalho)", _id.changed === true && /carvalho/i.test(_id.text) && !/\bia\b|openai/i.test(_id.text));

  // ── "VOU BUSCAR..." E SOME (lead 99747-0573 "Palio") ──
  check("ficha", "deferral 'vou verificar a disponibilidade do X' -> detecta", replyDefersSearch("Vou verificar a disponibilidade do Fiat Palio para você.") === true);
  check("ficha", "deferral 'vou buscar informações sobre o X' -> detecta", replyDefersSearch("Vou buscar informações sobre o Fiat Palio para você!") === true);
  check("ficha", "deferral 'vou buscar opções de veículos na faixa de 34 mil' -> detecta", replyDefersSearch("Vou buscar opções de veículos na faixa de 34 mil para você.") === true);
  check("ficha", "'vou confirmar com a equipe' (dúvida) -> NÃO é deferral de busca", replyDefersSearch("Sobre a garantia, vou confirmar com a nossa equipe de vendas") === false);
  check("ficha", "apresentação com dados (R$) -> NÃO é deferral", replyDefersSearch("Temos o Onix 2020 por R$ 65.990, quer ver?") === false);
  // honestidade do builder determinístico: pediu Palio (não existe) -> NÃO diz "Temos sim", diz "não tenho Palio"
  const _palioStock = { success: true, items: [{ marca: "Fiat", modelo: "Cronos", versao: "Drive 1.0", ano: 2025, preco: 82990 }, { marca: "Fiat", modelo: "Pulse", ano: 2023, preco: 97990 }] };
  const _palioReply = buildDeterministicStockReply({ plan: { action: "stock_search", search_query: "Fiat Palio", search_filters: {} } as any, intent: null as any, stock_result: _palioStock });
  check("ficha", "Palio inexistente -> 'não tenho Palio' (não 'Temos sim')", /nao tenho|não tenho/i.test(_palioReply) && !/temos sim/i.test(_palioReply) && /palio/i.test(_palioReply));
  const _onixReply = buildDeterministicStockReply({ plan: { action: "stock_search", search_query: "Onix", search_filters: {} } as any, intent: null as any, stock_result: { success: true, items: [{ marca: "Chevrolet", modelo: "Onix Sedan", ano: 2025, preco: 97990 }] } });
  check("ficha", "Onix existente -> 'Temos sim'", /temos sim/i.test(_onixReply));
  const _suvReply = buildDeterministicStockReply({ plan: { action: "stock_search", search_query: "suv", search_filters: { stock_broad: true } } as any, intent: null as any, stock_result: { success: true, items: [{ marca: "Chevrolet", modelo: "Tracker", ano: 2023, preco: 111990 }] } });
  check("ficha", "busca AMPLA 'suv' -> 'Temos sim' (não quebra a relista)", /temos sim/i.test(_suvReply));

  // ── R6: PREÇO INVENTADO (caso GRAVE dos prints: Civic 73.990 -> 50.000, S10 91.990 -> 59.000) ──
  const _civic = [{ marca: "Honda", modelo: "Civic", ano: 2014, preco: 73990 }];
  check("preco", "R6: Civic dito por R$ 50.000 (real 73.990) -> viola", validateGrounding("Temos o Honda Civic por R$ 50.000,00", _civic).violations.some((v) => v.rule === "R6"));
  check("preco", "R6: S10 dita por R$ 59.000 (real 91.990) -> viola", validateGrounding("Chevrolet S10 por R$ 59.000,00", [{ marca: "Chevrolet", modelo: "S10", ano: 2014, preco: 91990 }]).violations.some((v) => v.rule === "R6"));
  check("preco", "R6: preço REAL (R$ 73.990) -> NÃO viola", validateGrounding("Temos o Honda Civic por R$ 73.990,00", _civic).ok === true);
  check("preco", "R6: arredondamento 'R$ 74 mil' (real 73.990) -> NÃO viola", validateGrounding("Sai por uns R$ 74 mil", _civic).ok === true);
  check("preco", "R6: teto do lead 'até R$ 50.000' + preço real -> NÃO viola (orçamento ≠ preço)", validateGrounding("Procura até R$ 50.000? Tenho o Civic por R$ 73.990,00", _civic).ok === true);
  check("preco", "extractVehiclePriceClaims: 'até 50 mil' -> [] (orçamento excluído)", extractVehiclePriceClaims("carros automático até 50 mil").length === 0);
  check("preco", "extractVehiclePriceClaims: 'por R$ 73.990,00' -> [73990]", extractVehiclePriceClaims("por R$ 73.990,00").includes(73990));

  // ── OFERTA DE FOTO SEM FOTO (carro "em preparação", images_count=0) ──
  check("fotos", "detecta oferta 'Quer ver fotos dele?'", replyOffersPhotos("Temos o Civic 2014. Quer ver fotos dele?") === true);
  check("fotos", "detecta oferta 'posso te mandar fotos'", replyOffersPhotos("Posso te mandar fotos se quiser") === true);
  check("fotos", "NÃO é oferta: 'recebi suas fotos'", replyOffersPhotos("Recebi suas fotos, obrigado!") === false);
  const _ph = rewriteUnavailablePhotoOffer("Temos o Honda Civic 2014 por R$ 73.990. Quer ver fotos dele?");
  check("fotos", "reescreve: tira a oferta de foto", _ph.changed === true && !/quer ver fotos/i.test(_ph.text));
  check("fotos", "reescreve: mantém o carro + oferece detalhes/visita", /civic/i.test(_ph.text) && /(detalhes|visita)/i.test(_ph.text));
  check("fotos", "sem oferta de foto -> NÃO mexe", rewriteUnavailablePhotoOffer("Temos o Civic 2014 por R$ 73.990.").changed === false);

  // ── "MANDA TODOS" -> envia fotos de TODOS (não re-pergunta "de qual?") — lead 98287-4078 ──
  check("fotos", "detecta 'manda todos'", leadRequestsAllVehiclePhotos("Manda todos\nFotos") === true);
  check("fotos", "detecta 'os dois'", leadRequestsAllVehiclePhotos("quero ver os dois") === true);
  check("fotos", "NÃO é todos: 'quero o branco'", leadRequestsAllVehiclePhotos("quero o branco") === false);
  const _v1 = { marca: "Chevrolet", modelo: "Onix Sedan", versao: "LT 1.0 MEC", ano: 2025, cor: "Branco", preco: 79990, images_count: 3, fotos: ["a1.jpg", "a2.jpg", "a3.jpg"] };
  const _v2 = { marca: "Chevrolet", modelo: "Onix Sedan", versao: "LTZ 1.0 AUT", ano: 2025, cor: "Preto", preco: 97990, images_count: 2, fotos: ["b1.jpg", "b2.jpg"] };
  const _allReply = buildVehiclePhotoReply({ veiculos_apresentados: [_v1, _v2] }, "manda todos");
  check("fotos", "'manda todos' -> envia fotos (não pick_which)", _allReply.source === "vehicle_photos_reply" && (_allReply.media || []).length >= 4);
  check("fotos", "'manda todos' -> reason all_vehicles_requested", _allReply.selected_vehicle_reason === "all_vehicles_requested");
  const _pickReply = buildVehiclePhotoReply({ veiculos_apresentados: [_v1, _v2] }, "foto");
  check("fotos", "pedido vago (não 'todos') com 2 distintos -> ainda pergunta qual", _pickReply.source === "vehicle_photos_pick_which");
  check("fotos", "pick_which oferece a saída 'manda todas' (anti-loop)", /todas/i.test(_pickReply.text || ""));

  // ====== HARNESS DE FLUXO DE FOTO — replay da conversa REAL (lead 98287-4078) ======
  // 2 Onix Sedan, MESMO modelo, unidades diferentes (LT branco MANUAL 79.990 / LTZ preto AUT 97.990),
  // AMBOS com fotos. Comportamento CORRETO esperado em cada turno (sem remendo, sem adivinhar).
  const _onixPool = () => [
    { marca: "Chevrolet", modelo: "Onix Sedan", versao: "PLUS LT 1.0 12V FLEX 4P MEC", ano: 2025, cor: "Branco", preco: 79990, cambio: "Manual", combustivel: "Flex", images_count: 15, fotos: Array.from({ length: 15 }, (_x, i) => `lt-${i}.jpg`) },
    { marca: "Chevrolet", modelo: "Onix Sedan", versao: "PLUS LTZ 1.0 12V TB FLEX AUT", ano: 2025, cor: "Preto", preco: 97990, cambio: "Automático", combustivel: "Flex", images_count: 16, fotos: Array.from({ length: 16 }, (_x, i) => `ltz-${i}.jpg`) },
  ];
  const _phr = (msg: string, extra: any = {}) => buildVehiclePhotoReply({ veiculos_apresentados: _onixPool(), ...extra }, msg);
  // (b) "esse onix automatico" -> manda o LTZ (automatico/preto), NAO o 1o da lista (LT branco)
  const f1 = _phr("quero ver esse onix automatico");
  check("fluxo_foto", "'onix automatico' -> manda o LTZ (aut/preto), não o 1o", f1.source === "vehicle_photos_reply" && /aut/i.test(String(f1.vehicle?.cambio)) && /preto/i.test(String(f1.vehicle?.cor)));
  // cor explicita "o branco" -> LT branco
  const f2 = _phr("quero o branco");
  check("fluxo_foto", "'o branco' -> manda o LT branco", f2.source === "vehicle_photos_reply" && /branco/i.test(String(f2.vehicle?.cor)));
  // cor explicita "o preto" -> LTZ preto
  const f3 = _phr("manda o preto");
  check("fluxo_foto", "'o preto' -> manda o LTZ preto", f3.source === "vehicle_photos_reply" && /preto/i.test(String(f3.vehicle?.cor)));
  // (ambiguidade real) "o onix" SEM discriminador, 2 unidades -> PERGUNTA qual (não chuta o 1o)
  const f4 = _phr("quero ver o onix");
  check("fluxo_foto", "'o onix' (modelo nomeado) -> manda UMA foto (não trava perguntando)", f4.source === "vehicle_photos_reply");
  // (c) CONTINUAÇÃO: já mostrou o LTZ -> "foto do painel" continua no LTZ (não re-pergunta)
  const _ltzKey = f3.selected_vehicle_key;
  const f5 = _phr("foto do painel", { ultima_foto: { veiculo_key: _ltzKey } });
  check("fluxo_foto", "'foto do painel' após mostrar o LTZ -> continua no LTZ (não re-pergunta)", f5.source === "vehicle_photos_reply" && /preto/i.test(String(f5.vehicle?.cor)));
  // (c) MESMO com âncora do pool = LT (1o), a CONTINUAÇÃO (ultima_foto=LTZ) deve vencer — bug real prod.
  const f5b = buildVehiclePhotoReply({ veiculos_apresentados: _onixPool(), ultima_foto: { veiculo_key: _ltzKey } }, "foto do painel", _onixPool()[0]);
  check("fluxo_foto", "'foto do painel' com âncora=LT mas última-foto=LTZ -> continua no LTZ", f5b.source === "vehicle_photos_reply" && /preto/i.test(String(f5b.vehicle?.cor)));
  // ⭐ORDINAL "foto do 3" (lead 3199-6370: pediu o #3=Onix, agente foi confirmar o #1=Ford Focus e não mandou):
  // 3 sedans distintos -> manda o 3o (Onix) por ordinal, com reason 'explicit_ordinal' (o que o guard de
  // mismatch usa pra NÃO bloquear o pick por posição).
  const _sedanPool = [
    { marca: "Ford", modelo: "Focus", ano: 2017, fotos: ["fo-1.jpg", "fo-2.jpg"] },
    { marca: "Ford", modelo: "Ka Sedan", ano: 2019, fotos: ["ka-1.jpg"] },
    { marca: "Chevrolet", modelo: "Onix Sedan", ano: 2025, fotos: ["on-1.jpg", "on-2.jpg"] },
  ];
  const fOrd = buildVehiclePhotoReply({ veiculos_apresentados: _sedanPool }, "Quero foto do 3");
  check("fluxo_foto", "'foto do 3' -> 3o veículo (Onix) por ordinal + reason explicit_ordinal", fOrd.source === "vehicle_photos_reply" && /onix/i.test(String(fOrd.vehicle?.modelo)) && fOrd.selected_vehicle_reason === "explicit_ordinal");
  // ⭐VEÍCULO EM FOCO (cérebro da conversa, lead 3199-6370): lead escolheu o Yaris (ficha), depois "fotos dele"
  // -> manda as do YARIS (não "de qual?" listando outros). E PIVÔ: "fotos do focus" -> manda o Focus.
  const _focoPool = [
    { marca: "Ford", modelo: "Focus", ano: 2017, fotos: ["fo1.jpg", "fo2.jpg"] },
    { marca: "Ford", modelo: "Ka Sedan", ano: 2019, fotos: ["ka1.jpg"] },
    { marca: "Toyota", modelo: "Yaris Sedan", ano: 2025, fotos: ["ya1.jpg", "ya2.jpg"] },
  ];
  const _focoYaris = { key: vehicleKey(_focoPool[2]), modelo: "Yaris Sedan", fotos: _focoPool[2].fotos };
  const fFoco = buildVehiclePhotoReply({ veiculos_apresentados: _focoPool, veiculo_em_foco: _focoYaris }, "quero fotos dele");
  check("fluxo_foto", "'fotos dele' com foco=Yaris -> manda o Yaris (não pergunta de qual)", fFoco.source === "vehicle_photos_reply" && /yaris/i.test(String(fFoco.vehicle?.modelo)));
  const fPivo = buildVehiclePhotoReply({ veiculos_apresentados: _focoPool, veiculo_em_foco: _focoYaris }, "quero fotos do focus");
  check("fluxo_foto", "pivô: 'fotos do focus' com foco=Yaris -> manda o Focus (pivô vence o foco)", fPivo.source === "vehicle_photos_reply" && /focus/i.test(String(fPivo.vehicle?.modelo)));
  // sem foco + part-request + 2 unidades -> ambíguo, pergunta (correto)
  const f6 = _phr("foto do painel");
  check("fluxo_foto", "'foto do painel' SEM foco + 2 unidades -> pergunta qual", f6.source === "vehicle_photos_pick_which");
  // "manda todos" -> envia todos (v163)
  const f7 = _phr("manda todos");
  check("fluxo_foto", "'manda todos' -> envia fotos de todos", f7.source === "vehicle_photos_reply" && (f7.media || []).length >= 4);

  // ── TETO DE PREÇO determinístico (DeepSeek não extraía "até X mil") ──
  check("preco", "parse 'corolla até 50 mil' -> 50000", parsePriceCeiling("corolla até 50 mil") === 50000, String(parsePriceCeiling("corolla até 50 mil")));
  check("preco", "parse 'onix até 30 mil' -> 30000", parsePriceCeiling("onix até 30 mil") === 30000);
  check("preco", "parse 'tenho 100 mil pra gastar' -> 100000", parsePriceCeiling("tenho 100 mil pra gastar") === 100000);
  check("preco", "parse 'até R$ 48.000' -> 48000", parsePriceCeiling("até R$ 48.000") === 48000, String(parsePriceCeiling("até R$ 48.000")));
  check("preco", "parse 'suv 2020 pra frente' -> null (ano, não teto)", parsePriceCeiling("procuro suv 2020 pra frente") === null, String(parsePriceCeiling("procuro suv 2020 pra frente")));
  // "34k" / "de X mil" / "por Xk" SEM "até" (caso real lead 99747-0573 "Tem algum de 34k?")
  check("preco", "parse 'tem algum de 34k?' -> 34000", parsePriceCeiling("tem algum de 34k?") === 34000, String(parsePriceCeiling("tem algum de 34k?")));
  check("preco", "parse 'algum por 50k' -> 50000", parsePriceCeiling("tem algum por 50k") === 50000, String(parsePriceCeiling("tem algum por 50k")));
  check("preco", "parse 'tem de 30 mil?' -> 30000", parsePriceCeiling("tem de 30 mil?") === 30000, String(parsePriceCeiling("tem de 30 mil?")));
  check("preco", "'onix com 80 mil km' -> null (é quilometragem, não preço)", parsePriceCeiling("onix com 80 mil km") === null, String(parsePriceCeiling("onix com 80 mil km")));
  check("preco", "'34k km rodados' -> null (quilometragem)", parsePriceCeiling("carro com 34k km rodados") === null, String(parsePriceCeiling("carro com 34k km rodados")));
  // "tem algum de 34k?" = orçamento (qualquer carro), não modelo específico
  check("preco", "'tem algum de 34k?' -> qualquer-carro-no-orçamento", leadAsksAnyCarInBudget("tem algum de 34k?") === true);
  check("preco", "'tem de 30 mil?' -> qualquer-carro-no-orçamento", leadAsksAnyCarInBudget("tem de 30 mil?") === true);
  check("preco", "'corolla até 50 mil' -> NÃO é qualquer-carro (nomeou modelo)", leadAsksAnyCarInBudget("corolla até 50 mil") === false);
  check("preco", "'tem suv?' -> NÃO (sem preço)", leadAsksAnyCarInBudget("tem suv?") === false);
  // orçamento não atingido: nada ≤34k -> "não tenho até R$ 34.000" + mais em conta primeiro (Sandero antes do Onix)
  const _budStock = { success: true, items: [{ marca: "Chevrolet", modelo: "Onix", ano: 2017, preco: 64990 }, { marca: "Renault", modelo: "Sandero", ano: 2021, preco: 53990 }] };
  const _budReply = buildDeterministicStockReply({ plan: { action: "stock_search", search_query: null, search_filters: { stock_broad: true, preco_max: 34000 } } as any, intent: null as any, stock_result: _budStock });
  check("preco", "orçamento 34k não atingido -> 'não tenho até R$ 34.000'", /nao tenho carro ate r\$ 34/i.test(_budReply));
  check("preco", "orçamento -> mais em conta primeiro (Sandero antes do Onix)", _budReply.indexOf("Sandero") < _budReply.indexOf("Onix"));
  const _orderedReply = buildDeterministicStockReply({ plan: { action: "stock_search", search_query: null, search_filters: { stock_broad: true, preco_max: 80000 } } as any, intent: null as any, stock_result: { success: true, items: [
    { index: 3, marca: "Ford", modelo: "Focus", ano: 2017, preco: 62990 },
    { index: 2, marca: "Ford", modelo: "Ka Sedan", ano: 2019, preco: 63990 },
    { index: 1, marca: "Chevrolet", modelo: "Onix Sedan", ano: 2025, preco: 79990 },
  ] } });
  check("preco", "fallback renumera lista ordenada 1-2-3", /1\. \*Ford Focus[\s\S]*2\. \*Ford Ka Sedan[\s\S]*3\. \*Chevrolet Onix Sedan/.test(_orderedReply), _orderedReply);
  check("preco", "fallback nao usa separador corrompido", !/[?]{2,}/.test(_orderedReply), _orderedReply);
  // normalizePlan aplica o teto mesmo quando o LLM não setou preco_max.
  const pc = normalizePlan({ action: "stock_search", intent: "stock_lookup", search_query: "Corolla", search_filters: { modelo_desejado: "Corolla" }, confidence: 0.7 }, FALLBACK, { message: "corolla até 50 mil", vehicle_resolution: vr() as any, memory: null, recent_history: [] } as any);
  check("preco", "normalizePlan 'corolla até 50 mil' -> preco_max=50000 + hard", Number(pc.search_filters?.preco_max) === 50000 && pc.search_filters?.hard_price_ceiling === true, `preco_max=${pc.search_filters?.preco_max} hard=${pc.search_filters?.hard_price_ceiling}`);

  // TRAVA FINAL: detector de "nega disponibilidade" (orchestrator usa p/ recuperar a busca que faltou).
  check("detectores", "nega: 'Infelizmente não temos a Hilux' -> true", replyDeniesAvailability("Infelizmente, não temos a Hilux cabine simples no momento.") === true);
  check("detectores", "nega: 'no momento não tenho esse modelo' -> true", replyDeniesAvailability("no momento não tenho esse modelo") === true);
  check("detectores", "nega: apresenta carro -> false", replyDeniesAvailability("Temos um Jeep Compass T270 2023 aqui sim! Quer ver fotos?") === false);
  check("detectores", "nega: 'não temos como simular' (financiamento) -> false", replyDeniesAvailability("não temos como simular aqui, vou te passar pro especialista") === false);

  // detector puro: 4 casos.
  const dc = (m: string, prior: string) => detectLeadDirectionChange(m, prior);
  check("detectores", "direção: 'procuro um suv' (ad Tracker) -> mudou p/ suv", dc("procuro um suv 2020 pra frente", "Chevrolet Tracker 2023").changed_direction === true && dc("procuro um suv 2020 pra frente", "Chevrolet Tracker 2023").current_type === "suv");
  check("detectores", "direção: 'esse suv tem teto?' -> NÃO mudou (sobre o carro)", dc("esse suv tem teto solar?", "Chevrolet Tracker 2023").changed_direction === false);
  check("detectores", "direção: 'tem suv tipo o tracker?' -> NÃO mudou (nomeou o anterior)", dc("tem suv tipo o tracker?", "Chevrolet Tracker 2023").changed_direction === false);
  check("detectores", "direção: 'oi tudo bem' -> NÃO mudou (sem tipo)", dc("oi, tudo bem?", "Chevrolet Tracker 2023").changed_direction === false);
}

// ── CASO #2 + MUDANÇAS DE DECISÃO DO LEAD — simula a jornada (lead muda de ideia) ─────────────
{
  // detecção de "mais opções" (vs mudança de tipo, vs pedido de foto).
  check("decisao", "'M mostra mais opções' -> mais opções", leadAsksForMoreOptions("M mostra mais opções") === true);
  check("decisao", "'tem mais?' -> mais opções", leadAsksForMoreOptions("tem mais?") === true);
  check("decisao", "'quero um suv' -> NÃO é mais opções", leadAsksForMoreOptions("quero um suv") === false);
  check("decisao", "'manda foto do onix' -> NÃO é mais opções", leadAsksForMoreOptions("manda foto do onix") === false);

  // chave estável: mesma unidade = mesma key; ano diferente = key diferente.
  const a = { marca: "Renault", modelo: "Sandero", versao: "ZEN FLEX 1.0", ano: 2021, preco: 53990 };
  const b = { marca: "Renault", modelo: "Sandero", versao: "ZEN FLEX 1.6", ano: 2020, preco: 56990 };
  check("decisao", "dedupKey: Sandero 2021 != Sandero 2020", vehicleDedupKey(a) !== vehicleDedupKey(b) && vehicleDedupKey(a) === vehicleDedupKey({ ...a }));

  // SCENÁRIO DO PRINT (lead 99647-8589): 5 carros JÁ vistos + pool com eles + 3 NOVOS ->
  // "mostra mais opções" deve EXCLUIR os 5 e trazer só os 3 novos (não repetir).
  const vistos = [
    { marca: "Peugeot", modelo: "207 Hatch", versao: "XR 1.4", ano: 2011, preco: 22990 },
    { marca: "Renault", modelo: "Sandero", versao: "ZEN FLEX 1.0", ano: 2021, preco: 53990 },
    { marca: "Renault", modelo: "Kwid", versao: "Zen 1.0", ano: 2024, preco: 55990 },
    { marca: "Renault", modelo: "Sandero", versao: "ZEN FLEX 1.6", ano: 2020, preco: 56990 },
    { marca: "Mitsubishi", modelo: "Pajero", versao: "TR 4 2.0", ano: 2013, preco: 60990 },
  ];
  const novos = [
    { marca: "Chevrolet", modelo: "Onix", versao: "LT 1.0", ano: 2022, preco: 66990 },
    { marca: "Hyundai", modelo: "HB20", versao: "Comfort", ano: 2023, preco: 72990 },
    { marca: "Fiat", modelo: "Argo", versao: "Drive 1.0", ano: 2022, preco: 69990 },
  ];
  const poolBuscaNova = [...vistos, ...novos]; // a busca devolve os mesmos + novos
  const seenKeys = vistos.map(vehicleDedupKey);
  const fresh = excludeAlreadyPresented(poolBuscaNova, seenKeys);
  const freshKeys = new Set(fresh.map(vehicleDedupKey));
  const semRepeticao = vistos.every((v) => !freshKeys.has(vehicleDedupKey(v)));
  check("decisao", "'mais opções' exclui os 5 já vistos (não repete)", fresh.length === 3 && semRepeticao, `fresh=${fresh.length}`);

  // ESGOTOU: o lead já viu TODOS -> exclusão zera (o orchestrator então oferece variar critério).
  const tudoVisto = excludeAlreadyPresented(vistos, vistos.map(vehicleDedupKey));
  check("decisao", "'mais opções' com tudo já visto -> 0 (sinaliza esgotamento)", tudoVisto.length === 0);

  // MUDA DE IDEIA no meio (sem anúncio): tinha interesse Onix, agora pede picape -> mudança de direção.
  const piv = detectLeadDirectionChange("na verdade quero uma picape", "Chevrolet Onix");
  check("decisao", "muda de ideia: interesse Onix -> 'quero uma picape' = mudou p/ pickup", piv.changed_direction === true && piv.current_type === "pickup");

  // ── PLANO A: rejeição (o que o lead recusou) ──
  check("decisao", "rejeição: 'não quero o compass' -> rejeita", detectLeadRejection("não quero o compass").has_rejection === true);
  check("decisao", "rejeição: 'esse não, quero outro' -> rejeita o foco", (() => { const r = detectLeadRejection("esse não, quero outro"); return r.has_rejection === true && r.rejects_focus === true; })());
  check("decisao", "rejeição: 'não quero sedan' -> tipo sedan", (() => { const r = detectLeadRejection("não quero sedan"); return r.has_rejection === true && r.rejected_type === "sedan"; })());
  check("decisao", "rejeição: 'sedan não' -> tipo sedan", (() => { const r = detectLeadRejection("sedan não"); return r.has_rejection === true && r.rejected_type === "sedan"; })());
  check("decisao", "rejeição: 'amanhã não posso' -> NÃO é rejeição de carro", detectLeadRejection("amanhã não posso ir aí").has_rejection === false);
  check("decisao", "rejeição: 'não, pode mandar' -> NÃO é rejeição", detectLeadRejection("não, pode mandar as fotos").has_rejection === false);

  // acumular/resolver rejeição: nome citado -> esse modelo; "esse não" -> último apresentado (foco).
  const apres2 = [{ modelo: "Compass" }, { modelo: "Onix" }];
  check("decisao", "updateRejeitados: 'não quero o compass' -> modelos[compass]", updateRejeitados("não quero o compass", apres2, null).modelos.includes("compass"));
  check("decisao", "updateRejeitados: 'esse não' -> último apresentado (onix)", updateRejeitados("esse não, quero outro", apres2, { modelos: [], tipos: [] }).modelos.includes("onix"));
  check("decisao", "updateRejeitados: 'não quero sedan' -> tipos[sedan]", updateRejeitados("não quero sedan", [], null).tipos.includes("sedan"));
  check("decisao", "updateRejeitados: sem recusa preserva o anterior", updateRejeitados("oi tudo bem", apres2, { modelos: ["compass"], tipos: [] }).modelos.includes("compass"));
  // mudou de ideia: pediu o que rejeitou -> sai da lista (não fica blacklist eterno).
  const cleared = clearRejeitadoOnRequest({ modelos: ["compass", "onix"], tipos: ["sedan"] }, "na verdade quero ver o compass");
  check("decisao", "clearRejeitadoOnRequest: pediu o compass -> tira compass, mantém onix", !cleared.modelos.includes("compass") && cleared.modelos.includes("onix"));

  // ── PLANO B: estado da conversa (etapa) + exclusão determinística de rejeitados ──
  check("decisao", "estado: interesse sem apresentados -> etapa 'buscando'", buildConversationState({ interesse: { tipo_veiculo: "suv", preco_max: 80000 }, lead_name: "Ana" }).etapa === "buscando");
  check("decisao", "estado: com apresentados -> etapa 'comparando'", buildConversationState({ interesse: { modelo_desejado: "Onix" }, veiculos_apresentados: [{}, {}, {}] }).etapa === "comparando");
  check("decisao", "estado: nome+interesse+agendamento -> etapa 'agendando'", buildConversationState({ lead_name: "Ana", interesse: { modelo_desejado: "Onix", dia_agendamento: "sexta" } }).etapa === "agendando");
  check("decisao", "estado: lê rejeitados", buildConversationState({ rejeitados: { modelos: ["onix"], tipos: [] } }).rejeitou.modelos.includes("onix"));
  // ⭐SHAPE REAL salvo pelo agente (Codex): o filme TEM que ler lead.nome / negociacao.* / atendimento.* —
  // antes lia interesse.*/lead_name (vazios) e a qualificação saía TODA nula -> cérebro RE-perguntava tudo.
  const _estReal = buildConversationState({
    lead: { nome: "João" },
    interesse: { modelo_desejado: "Onix" },
    negociacao: { carro_troca: "Gol 2015", forma_pagamento: "financiamento", valor_entrada: "10 mil", tem_troca: true },
    atendimento: { dia_agendamento: "sábado 10h" },
  });
  check("decisao", "estado REAL: lê lead.nome (não some)", _estReal.qualificacao.nome === "João");
  check("decisao", "estado REAL: lê negociacao.carro_troca", _estReal.qualificacao.troca === "Gol 2015");
  check("decisao", "estado REAL: lê negociacao.forma_pagamento", _estReal.qualificacao.pagamento === "financiamento");
  check("decisao", "estado REAL: lê atendimento.dia_agendamento", _estReal.qualificacao.agendamento === "sábado 10h");
  check("decisao", "estado REAL: qualificado -> etapa 'agendando'", _estReal.etapa === "agendando");
  // exclusão determinística por modelo rejeitado.
  const poolRej = [{ modelo: "Onix" }, { modelo: "Compass" }, { modelo: "Tracker" }];
  const semOnix = excludeRejeitados(poolRej, { modelos: ["onix"] });
  check("decisao", "excludeRejeitados: tira Onix, mantém Compass/Tracker", semOnix.length === 2 && !semOnix.some((v) => /onix/i.test(v.modelo)));
  check("decisao", "excludeRejeitados: sem rejeitados -> mantém tudo", excludeRejeitados(poolRej, { modelos: [] }).length === 3);

  // ── FOTO DO CARRO CERTO (caso Bárbara): mensagem referencia o interesse -> alvo = interesse ──
  const memBarbara = { interesse: { modelo_desejado: "Peugeot 2008 2021" } };
  check("foto", "alvo: 'fts do 2008 2021' (interesse Peugeot 2008) -> Peugeot 2008", photoRequestTargetModel("quero ver as fts do 2008 2021", memBarbara, null) === "Peugeot 2008 2021");
  check("foto", "alvo: 'fotos desse' (sem referência) -> fallback (âncora)", photoRequestTargetModel("manda fotos desse", { interesse: { modelo_desejado: "Onix" } }, null) === null);
  check("foto", "alvo: 'foto do compass' (interesse Onix) -> usa o nomeado (fallback search_query)", photoRequestTargetModel("manda foto do compass", { interesse: { modelo_desejado: "Onix" } }, "Compass") === "Compass");
  // ⭐CRASH (lead 99755-8112): interesse com parênteses "(cab. simples)" -> token "(cab." derrubava o turno
  // (new RegExp inválida). Agora escapa: NÃO lança + casa o modelo normalmente.
  {
    const memHilux = { interesse: { modelo_desejado: "Toyota Hilux Cabine Simples Hilux STD 4 x 4 2.5 (cab. simples)" } };
    let threw = false, res: any = null;
    try { res = photoRequestTargetModel("quero ver fotos da hilux", memHilux, null); } catch { threw = true; }
    check("regex-escape", "photoRequestTargetModel NÃO lança com '(cab. simples)' no interesse", threw === false);
    check("regex-escape", "casa 'hilux' -> retorna o interesse (modelo do Hilux)", res === "Toyota Hilux Cabine Simples Hilux STD 4 x 4 2.5 (cab. simples)");
    check("regex-escape", "escapeRegExp escapa parênteses e ponto", escapeRegExp("(cab. simples)") === "\\(cab\\. simples\\)");
  }

  // "promete e não cumpre": reclamação de foto errada/faltando -> deve re-disparar (não prometer).
  check("foto", "reclama: 'essas fts n são peugeot' -> reclamação", leadComplainsPhotoWrongOrMissing("Essas fts n são peugeot\nSão de uma Tracker") === true);
  check("foto", "reclama: 'vc n mandou nenhuma do carro certo' -> reclamação", leadComplainsPhotoWrongOrMissing("Vc n mandou nenhuma\nDo carro certo") === true);
  check("foto", "reclama: 'manda as fotos' -> NÃO é reclamação (é pedido)", leadComplainsPhotoWrongOrMissing("manda as fotos do onix") === false);
  check("foto", "reclama: 'essas fotos ficaram lindas' -> NÃO é reclamação", leadComplainsPhotoWrongOrMissing("essas fotos ficaram lindas") === false);

  // REFINA VERSÃO/MOTOR (caso Alê): detector + contextVehicleModel.
  const memC = { veiculos_apresentados: [{ marca: "Jeep", modelo: "Compass", ano: 2019 }] };
  check("decisao", "contextVehicleModel: lê o modelo apresentado (Compass)", contextVehicleModel(memC) === "Compass");
  check("decisao", "refina '270 nova motorização' c/ Compass em contexto -> checa", leadRefinesVehicleNeedsSearch("Não amigo. Seria o modelo 270 com nova motorização.", memC) === true);
  check("decisao", "refina 'premier' c/ contexto -> checa", leadRefinesVehicleNeedsSearch("seria a premier mesmo", memC) === true);
  check("decisao", "'270' SEM contexto -> NÃO checa (não identifica nada)", leadRefinesVehicleNeedsSearch("modelo 270", {}) === false);
  check("decisao", "'obrigado, era só isso' c/ contexto -> NÃO checa (despedida)", leadRefinesVehicleNeedsSearch("obrigado, era só isso", memC) === false);
}

// ── RODÍZIO DE VENDEDOR (pickRoundRobinSeller) — vendedor novo (null) entra na fila ───────────
{
  // CENÁRIO REAL (Icom Motors): 3 antigos com last_lead recente + 4 novos (null) -> ESCOLHE um novo.
  const antigos = [
    { name: "Joao Santos", total_leads_received: 0, last_lead_received_at: "2026-06-19T13:19:15.801Z" },
    { name: "Luiz Paulo", total_leads_received: 0, last_lead_received_at: "2026-06-19T12:30:04.833Z" },
    { name: "Matheus", total_leads_received: 0, last_lead_received_at: "2026-06-19T11:50:04.316Z" },
  ];
  const novos = [
    { name: "Bruno Henrique", total_leads_received: 0, last_lead_received_at: null },
    { name: "Flaviane Gomes", total_leads_received: 0, last_lead_received_at: null },
  ];
  const escolhido = pickRoundRobinSeller([...antigos, ...novos]);
  check("transfer", "rodízio: novo (null) é escolhido antes dos antigos com data", escolhido && escolhido.last_lead_received_at === null, `escolhido=${escolhido?.name}`);

  // todos com data -> escolhe quem recebeu HÁ MAIS TEMPO (Matheus, o mais antigo).
  const soAntigos = pickRoundRobinSeller(antigos);
  check("transfer", "rodízio: todos com data -> o mais antigo (Matheus)", soAntigos?.name === "Matheus", `escolhido=${soAntigos?.name}`);

  // empate no last_lead -> menor total_leads_received vence.
  const porCarga = pickRoundRobinSeller([
    { name: "A", total_leads_received: 5, last_lead_received_at: null },
    { name: "B", total_leads_received: 2, last_lead_received_at: null },
  ]);
  check("transfer", "rodízio: empate em data -> menor carga (B)", porCarga?.name === "B", `escolhido=${porCarga?.name}`);

  // lista vazia -> null (cai em no_active_seller no router).
  check("transfer", "rodízio: sem vendedor ativo -> null", pickRoundRobinSeller([]) === null);

  // COMPOSIÇÃO (dedup do sócio + rodízio): vendedor duplicado por telefone (com/sem 55) é ignorado;
  // entre o restante, o novo (null) é escolhido. Reproduz o cenário real (duplicados + vendedor novo).
  const comDuplicado = [
    { id: "old", whatsapp_number: "5512992338876", total_leads_received: 0, last_lead_received_at: "2026-06-19T13:00:00Z" },
    { id: "olddup", whatsapp_number: "12992338876", total_leads_received: 0, last_lead_received_at: "2026-05-01T00:00:00Z" },
    { id: "novo", whatsapp_number: "5512000000000", total_leads_received: 0, last_lead_received_at: null },
  ];
  const pickComposto = pickRoundRobinSeller(uniqueSellersByPhone(comDuplicado));
  check("transfer", "dedup+rodízio: ignora duplicado e escolhe o novo (null)", pickComposto?.id === "novo", `escolhido=${pickComposto?.id}`);
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
  // isValidName (usado pelo follow-up): nome-lixo -> false (não vira "Bom dia $!").
  check("nome", "isValidName('$') -> false", isValidName("$") === false);
  check("nome", "isValidName('Jô') -> true", isValidName("Jô") === true);
  check("nome", "isValidName('Douglas') -> true", isValidName("Douglas") === true);
  check("nome", "isValidName('123') -> false", isValidName("123") === false);
  check("nome", "isValidName('lead') -> false", isValidName("lead") === false);
}

// ── FILTROS (buildStockFilters) — construção dos filtros de busca (extraído do orchestrator) ──
{
  // broad (lead pediu TIPO) limpa ad_context (raiz v131: frase do lead em ad_context zerava a busca ampla).
  const f1 = buildStockFilters(
    { extracted: { referencia: { texto_referencia: "procuro um suv 2020 pra frente" } } },
    {}, "procuro um suv 2020 pra frente",
    { search_filters: { tipo_veiculo: "suv", stock_broad: true } }, {},
    { lead_message: "procuro um suv 2020 pra frente" },
  );
  check("filtros", "broad limpa ad_context (v131)", f1.ad_context === "" && f1.query === "" && f1.stock_broad === true, `ad_context=${JSON.stringify(f1.ad_context)} query=${JSON.stringify(f1.query)}`);

  // marca_required NÃO é broad -> preserva a marca (não vira sedan genérico).
  const f2 = buildStockFilters(
    {}, {}, "sedan so se for honda",
    { search_query: "honda", search_filters: { marca: "honda", marca_required: true, tipo_veiculo: "sedan" } }, {},
    { lead_message: "sedan so se for honda" },
  );
  check("filtros", "marca_required preserva a marca", /honda/i.test(String(f2.marca || "")), `marca=${f2.marca}`);

  // teto EXPLÍCITO ("ate 30 mil") -> hard_price_ceiling (não relaxa).
  const f3 = buildStockFilters(
    {}, {}, "tem onix ate 30 mil?",
    { search_query: "onix", search_filters: { modelo_desejado: "onix", preco_max: 30000 } }, {},
    { lead_message: "tem onix ate 30 mil?" },
  );
  check("filtros", "teto explícito -> hard_price_ceiling", f3.hard_price_ceiling === true && Number(f3.preco_max) === 30000, `ceiling=${f3.hard_price_ceiling} max=${f3.preco_max}`);

  // MEM-1: modelo NOVO sem preço dito -> NÃO herda preço velho do interesse (não filtra/zera errado).
  const f4 = buildStockFilters(
    {}, { interesse: { preco_max: 80000, tipo_veiculo: "suv" } }, "tem hilux?",
    { search_query: "hilux", search_filters: { modelo_desejado: "hilux" } }, {},
    { lead_message: "tem hilux?" },
  );
  check("filtros", "MEM-1: não herda preço velho em modelo novo", !(Number(f4.preco_max) > 0), `preco_max=${f4.preco_max}`);

  // ⭐MODELO NOMEADO + palavra de tipo ("Onix plus sedan", lead 99758-5303): leadMessageAsksBroadStock vê
  // "sedan" e marcaria broad, MAS há modelo -> NÃO apaga o Onix (era: "Temos sim!" + Focus/Ka/Cronos errados).
  const f5 = buildStockFilters(
    { extracted: { interesse: { modelo_desejado: "Chevrolet Onix" } } }, {}, "gostaria de um onix plus sedan",
    { search_query: "Chevrolet Onix", search_filters: { modelo_desejado: "Chevrolet Onix", tipo_veiculo: "sedan" } }, {},
    { lead_message: "gostaria de um onix plus sedan" },
  );
  check("filtros", "modelo nomeado + 'sedan' NÃO vira busca ampla (mantém Onix)", f5.stock_broad !== true && /onix/i.test(String(f5.query || "")), `broad=${f5.stock_broad} query=${JSON.stringify(f5.query)}`);

  const f6 = buildStockFilters(
    { extracted: { interesse: {} } },
    { interesse: { tipo_veiculo: "suv", preco_max: 70000 } },
    "tem mais opcoes?",
    { action: "stock_search", search_query: null, search_filters: {}, use_memory_vehicle: false },
    {},
    { lead_message: "tem mais opcoes?", ad_context: { has_ad_context: true, vehicle_query: "Chevrolet Tracker" } },
  );
  check("filtros", "mais opcoes mantem SUV do perfil anterior", f6.stock_broad === true && f6.tipo_veiculo === "suv" && f6.body_type === "suv", JSON.stringify(f6));
  check("filtros", "mais opcoes mantem teto anterior mesmo com anuncio", Number(f6.preco_max) === 70000 && !f6.ad_price, JSON.stringify(f6));

  const f7 = buildStockFilters(
    { extracted: { interesse: {} } },
    {},
    "Queria sedans ate 80k",
    { action: "stock_search", search_query: "sedans", search_filters: { modelo_desejado: "sedans", tipo_veiculo: "sedan", preco_max: 80000 }, use_memory_vehicle: false },
    {},
    { lead_message: "Queria sedans ate 80k" },
  );
  check("filtros", "sedans plural nao fica como modelo/query", f7.stock_broad === true && f7.tipo_veiculo === "sedan" && f7.query === "" && !f7.modelo_desejado && Number(f7.preco_max) === 80000, JSON.stringify(f7));
}

// ── DETECTORES (extraídos) — regex de decisão que dispararam bugs ───────────────────────────
{
  check("detectores", "broad: 'procuro um suv' -> true", leadMessageAsksBroadStock("procuro um suv 2020 pra frente") === true);
  check("detectores", "broad: 'oi tudo bem' -> false", leadMessageAsksBroadStock("oi tudo bem") === false);
  check("detectores", "teto: 'ate 30 mil' -> true", leadMessageHasExplicitPriceCeiling("tem onix ate 30 mil") === true);
  check("detectores", "teto: 'tem onix' -> false", leadMessageHasExplicitPriceCeiling("tem onix") === false);
  // foto: pedido explícito.
  check("detectores", "foto: 'manda foto do onix' -> true", messageAsksForPhotos("manda foto do onix") === true);
  // foto: placeholder de sistema NÃO é pedido (raiz v117: "[imagem recebida]" disparava álbum).
  check("detectores", "foto: '[imagem recebida]' -> false (placeholder)", messageAsksForPhotos("[imagem recebida]") === false);
  // foto: "pra frente" (ano em diante) NÃO é pedido de foto da "frente" (falso-positivo que disparou foto no v134).
  check("detectores", "foto: 'procuro suv 2020 pra frente' -> false", messageAsksForPhotos("procuro um suv 2020 pra frente") === false);
  // alvo da foto.
  check("detectores", "alvo: 'foto da roda' -> wheel", detectPhotoTarget("foto da roda") === "wheel");
  check("detectores", "alvo: 'manda a frente' -> front", detectPhotoTarget("manda a frente do carro") === "front");
  // query genérica.
  check("detectores", "genérico: 'suv' -> true", queryIsBroadOrGenericVehicle("suv") === true);
  check("detectores", "genérico: 'onix' -> false", queryIsBroadOrGenericVehicle("onix") === false);
}

// ── FOTO (pickReferencedVehicle + buildVehiclePhotoReply) — extraído p/ photoLogic.ts ──────────
{
  // pool de 3 unidades DISTINTAS (mesmo modelo Onix) com fotos.
  const onix3 = [
    { marca: "Chevrolet", modelo: "Onix", versao: "ACTIV 1.4", ano: 2017, cor: "Laranja", preco: 64990, km: 111354, fotos: ["a1.jpg", "a2.jpg"], principal_image: "a1.jpg" },
    { marca: "Chevrolet", modelo: "Onix", versao: "LT 1.0", ano: 2022, cor: "Azul", preco: 66990, km: 111000, fotos: ["b1.jpg"], principal_image: "b1.jpg" },
    { marca: "Chevrolet", modelo: "Onix", versao: "LT", ano: 2025, cor: "Branco", preco: 76990, km: 43900, fotos: ["c1.jpg"], principal_image: "c1.jpg" },
  ];
  const mix = [
    { marca: "Chevrolet", modelo: "Tracker", versao: "PREMIER 1.2", ano: 2023, cor: "Cinza", preco: 111990, fotos: ["t1.jpg", "t2.jpg"], principal_image: "t1.jpg" },
    { marca: "Jeep", modelo: "Renegade", versao: "LONGITUDE", ano: 2021, cor: "Preto", preco: 85990, fotos: ["r1.jpg"], principal_image: "r1.jpg" },
  ];

  // pickReferencedVehicle: ordinal explícito.
  check("foto", "pick: 'o segundo' -> index 1 explícito", (() => { const r = pickReferencedVehicle("quero o segundo", {}, onix3); return r.index === 1 && r.explicit === true; })());
  // pickReferencedVehicle: nome do modelo.
  check("foto", "pick: 'foto do renegade' -> Renegade (model_name)", (() => { const r = pickReferencedVehicle("manda foto do renegade", {}, mix); return r.reason === "model_name_match" && mix[r.index].modelo === "Renegade"; })());
  // pickReferencedVehicle: sem sinal -> default (não-explícito).
  check("foto", "pick: 'sim' -> default não-explícito", (() => { const r = pickReferencedVehicle("sim", {}, onix3); return r.reason === "default_first_vehicle" && r.explicit === false; })());

  // buildVehiclePhotoReply: AMBIGUIDADE (3 distintos, "Sim" sem dizer qual) -> pergunta qual, 0 fotos.
  const amb = buildVehiclePhotoReply({ veiculos_apresentados: onix3 }, "Sim");
  check("foto", "'Sim' com 3 Onix -> pergunta qual (0 fotos)", amb.source === "vehicle_photos_pick_which" && (amb.media?.length || 0) === 0, `src=${amb.source}`);
  // buildVehiclePhotoReply: modelo NOMEADO -> manda as fotos desse carro.
  const named = buildVehiclePhotoReply({ veiculos_apresentados: mix }, "manda foto do tracker");
  check("foto", "'foto do tracker' -> envia fotos do Tracker", named.source === "vehicle_photos_reply" && (named.media?.length || 0) > 0 && /tracker/i.test(String((named as any).selected_vehicle_label || "")), `src=${named.source} label=${(named as any).selected_vehicle_label}`);
  // buildVehiclePhotoReply: pool vazio -> pede referência (não inventa).
  const empty = buildVehiclePhotoReply({ veiculos_apresentados: [] }, "manda as fotos");
  check("foto", "pool vazio -> pede referência", empty.source === "vehicle_photos_need_reference" && (empty.media?.length || 0) === 0);
  // sameVehicleModel: Onix vs Onix (mesmo), Tracker vs Renegade (diferente).
  check("foto", "sameVehicleModel: Onix==Onix", sameVehicleModel(onix3[0], onix3[1]) === true);
  check("foto", "sameVehicleModel: Tracker!=Renegade", sameVehicleModel(mix[0], mix[1]) === false);
}

console.log(`\n=== OFFLINE: ${ok} OK | ${fail} FALHA ===`);
if (fail) { console.log("\nFALHAS:\n" + fails.map((f) => "  " + f).join("\n")); process.exit(1); }
