// ============================================================================
// turn-advisories.ts — RODADA 1 (2026-07-13, autoria-LLM exclusiva). Módulo PURO
// que produz as ORIENTAÇÕES de condução do turno, injetadas no prompt ANTES da
// 1ª geração. Substituem os antigos denies de QUALIDADE do authorFromBrainDraft.
//
// CONTRATO (arquitetura RD1 + auditoria Codex):
//  - Advisory ORIENTA, nunca decide. NÃO muda intent, tool, slot, veículo, texto
//    ou effect; e NÃO pode negar depois uma resposta factual válida.
//  - PRECEDÊNCIA DO BLOCO ATUAL: pedido explícito atual > orientação do funil >
//    memória anterior. Quando o bloco atual tem um ATO EXPLÍCITO prioritário
//    (humano, visita, institucional, foto, detalhe, seleção, financiamento/troca,
//    sensível, despedida, ou alvo comercial já dito), a orientação de
//    descoberta/apresentação/nome é SUPRIMIDA (`suppressDiscovery`).
//  - O PORTAL é a AUTORIDADE do funil: a próxima pergunta de qualificação vem
//    pronta do tenant (`portalNextQuestion`, derivada de qualificationQuestions/
//    SdrQualificationPolicy). Este módulo NUNCA impõe uma ordem comercial
//    universal hardcoded. Sem próxima pergunta configurada, orienta apenas
//    "continue a qualificação conforme o prompt do portal".
// ============================================================================

import { isInstitutionalTurn } from "./turn-domain.ts";
import { leadRequestsPhoto } from "./turn-understanding.ts";

// ── normalização local (minúsculas + sem acento) para os regexes deste módulo. PURA. ──
const normAdv = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ── Detectores LEXICAIS de SUPRESSÃO (Codex ajuste #2, RD1-2). SÓ calculam CONTEXTO/SUPRESSÃO — NUNCA autorizam
//    intent/tool/effect/slot. São a base de `deriveTurnAdvisoryContext`, testável com MENSAGENS REAIS. ──
const HUMAN_RX = /\b(atendente|vendedor|humano|consultor|falar com algu|me transfere|me transfira|quero falar com|chama? algu[eé]m)\b/;
const VISIT_RX = /\b(agendar|agendamento|marcar|visita|visitar|test ?drive|passar a[il]|ir a[il]|conhecer a loja)\b/;
const SELECTION_RX = /\bgostei\b|\bquero (esse|este|aquele)\b|\bfico com\b|\bpode ser (esse|este|o )\b|\besse (a[ií]|mesmo)\b|\bo (primeiro|segundo|terceiro|quarto|quinto|numero|n[uú]mero)\b/;
// cópia estável do PAYMENT_TURN_RX do central-engine (pagamento/financiamento/parcela/entrada/à vista/consórcio/simulação).
const PAYMENT_ADV_RX = /\bcondic[oõ]?es?\b|\bpagament|\bfinanci|\bparcel|\bentrada\b|\ba\s+vista\b|\bconsorci|\bsimul(?:ar|acao|e)\b/;
// alvo comercial dito lexicalmente (tipo de carro OU marca comum) — reforça o sinal de currentConstraints.
const COMMERCIAL_TYPE_RX = /\b(suv|sedan|hatch|hatchback|picape|caminhonete|pickup|utilit[aá]rio|minivan|cup[eê]|conversivel)\b/;
// posse de veículo (base de troca): "tenho uma Hilux", "tenho meu Onix". Suprime discovery (o turno tem alvo/troca).
const POSSESSION_RX = /\btenho\s+(?:um|uma|o|a|meu|minha)\s+\w+/;

// Entrada de `deriveTurnAdvisoryContext`: o BLOCO do lead + os sinais SEMÂNTICOS do turno já computados pelo engine
// (que dependem de estado/pergunta pendente e não são puramente lexicais). Overrides opcionais deixam o engine usar
// seus detectores CANÔNICOS (isServiceOrInstitutionalQuestion / isPaymentTurn / leadRequestsPhoto) sem divergência,
// enquanto os TESTES deixam a função derivar tudo do texto real (isInstitutionalTurn / leadRequestsPhoto / regex locais).
export type TurnAdvisoryContextInput = {
  readonly leadBlock: string;
  readonly commercialTargetStated: boolean;            // currentConstraints tem tipo/modelos/marca/precoMax (autoridade)
  readonly financialAnswerTurn: boolean;               // respondeu entrada/parcela/forma (pergunta pendente)
  readonly tradeInAnswerTurn: boolean;                 // ofereceu/respondeu troca (pergunta pendente)
  readonly sensitiveAnswerTurn: boolean;               // respondeu CPF/data (dado sensível)
  readonly disengagement: boolean;                     // agradeceu/encerrou sem novo pedido
  readonly explicitBuyIntent: boolean;                 // "quero comprar/fechar" explícito
  readonly institutionalTurnOverride?: boolean;        // engine passa seu detector canônico; teste omite (deriva do texto)
  readonly paymentTurnOverride?: boolean;
  readonly photoTurnOverride?: boolean;
};

// Contexto de SUPRESSÃO derivado (Codex ajuste #2). NUNCA autoriza nada — só orienta o que NÃO empurrar.
export type TurnAdvisoryContext = {
  readonly suppressDiscovery: boolean;
  readonly suppressFunnelQuestion: boolean;
  // sinais expostos p/ observabilidade e testes (nunca viram autorização).
  readonly leadRequestsHuman: boolean;
  readonly leadWantsVisit: boolean;
  readonly institutionalTurn: boolean;
  readonly paymentTurn: boolean;
  readonly photoTurn: boolean;
  readonly selectionTurn: boolean;
};

// Deriva a PRECEDÊNCIA DO BLOCO ATUAL (Codex #1) a partir de sinais reais. PURA e determinística. Um ato explícito
// prioritário no bloco atual (humano/visita/institucional/foto/seleção/pagamento/troca/sensível/despedida/compra/alvo
// comercial/posse) SUPRIME apresentação/descoberta. Atos FORA do funil (institucional/humano/visita/despedida/foto)
// também suprimem a próxima pergunta do funil (não empurrar pergunta não relacionada). NUNCA autoriza intent/tool/effect.
export function deriveTurnAdvisoryContext(i: TurnAdvisoryContextInput): TurnAdvisoryContext {
  const n = normAdv(i.leadBlock);
  const leadRequestsHuman = HUMAN_RX.test(n);
  const leadWantsVisit = VISIT_RX.test(n);
  const selectionTurn = SELECTION_RX.test(n);
  const possession = POSSESSION_RX.test(n);
  const institutionalTurn = i.institutionalTurnOverride ?? isInstitutionalTurn(i.leadBlock);
  const paymentTurn = i.paymentTurnOverride ?? PAYMENT_ADV_RX.test(n);
  const photoTurn = i.photoTurnOverride ?? leadRequestsPhoto(i.leadBlock);
  const commercialTarget = i.commercialTargetStated || COMMERCIAL_TYPE_RX.test(n);
  const suppressDiscovery = institutionalTurn || i.financialAnswerTurn || i.tradeInAnswerTurn || paymentTurn
    || i.sensitiveAnswerTurn || photoTurn || selectionTurn || i.disengagement || i.explicitBuyIntent
    || commercialTarget || leadRequestsHuman || leadWantsVisit || possession;
  const suppressFunnelQuestion = institutionalTurn || leadRequestsHuman || leadWantsVisit || i.disengagement || photoTurn;
  return { suppressDiscovery, suppressFunnelQuestion, leadRequestsHuman, leadWantsVisit, institutionalTurn, paymentTurn, photoTurn, selectionTurn };
}

export type TurnAdvisoryInput = {
  // Primeiro contato sem anúncio e sem alvo comercial ("Boa tarde" cru).
  readonly isFirstContact: boolean;
  // Entrada por anúncio de veículo ESPECÍFICO (label aterrado) — conduzir sobre ele na abertura.
  readonly adVehicleLabel: string | null;
  // Ainda sem intenção comercial (abertura sem alvo OU sem interesse/tipo/faixa) — descobrir antes de pedir nome.
  readonly needsDiscovery: boolean;
  // ⭐PRECEDÊNCIA: o bloco atual carrega um ato explícito prioritário -> suprime apresentação/anúncio/descoberta.
  readonly suppressDiscovery: boolean;
  // ⭐PRECEDÊNCIA: ato fora do funil (institucional/humano/visita/despedida) -> não empurrar a próxima pergunta do funil.
  readonly suppressFunnelQuestion: boolean;
  // Próxima pergunta de qualificação DERIVADA DO PORTAL (config do tenant). null = sem próxima pergunta configurada.
  readonly portalNextQuestion: string | null;
  // Nome já conhecido (não repergunte).
  readonly knownName: string | null;
  // Telefone de contato já conhecido pelo canal (WhatsApp) — não peça telefone.
  readonly contactPhoneKnown: boolean;
  // Turno de PAGAMENTO com carro JÁ escolhido — conduzir financiamento, não voltar à descoberta.
  readonly paymentTurnWithChosenCar: boolean;
  // O cliente acabou de informar entrada/parcela — acolher explicitamente antes de avançar.
  readonly justAnsweredFinancialSlot: "entrada" | "parcelaDesejada" | null;
  // Agradecimento/despedida sem pedido novo — fechar curto, sem pergunta, sem reabrir funil.
  readonly disengagementOnly: boolean;
  // Pergunta de serviço/institucional em contexto comercial — depois de responder, conduzir com UMA pergunta.
  readonly institutionalHookNeeded: boolean;
  // Slots do funil já CONHECIDOS (não os repergunte).
  readonly knownFunnelSlots: readonly string[];
  // ⭐P1 (continuação de agendamento): componentes já conhecidos/informados da VISITA, para a LLM acolher o que o cliente
  // deu e perguntar SÓ a dimensão faltante — NUNCA reperguntar o dia/horário já respondido. Ausente = não é turno de agenda.
  readonly scheduling?: {
    readonly active: boolean;          // visita/agendamento em andamento
    readonly dayJustGiven: boolean;    // o BLOCO ATUAL trouxe o dia
    readonly timeJustGiven: boolean;   // o BLOCO ATUAL trouxe o horário
    readonly dayKnown: boolean;        // dia já definido (memória + bloco atual)
    readonly timeKnown: boolean;       // horário já definido (memória + bloco atual)
  };
};

const SLOT_PT: Record<string, string> = {
  nome: "nome", interesse: "modelo de interesse", tipoVeiculo: "tipo de carro", faixaPreco: "faixa de preço",
  formaPagamento: "forma de pagamento", entrada: "valor de entrada", possuiTroca: "se tem carro para troca",
  parcelaDesejada: "parcela desejada", veiculoTroca: "dados do carro de troca", cidade: "cidade",
  conheceLoja: "se conhece a loja", diaHorario: "dia/horário", interesseVisita: "interesse em visitar",
};

// Constrói as orientações do turno. Ordem estável. Cada item é uma frase curta de condução (advisory).
export function buildTurnAdvisories(input: TurnAdvisoryInput): string[] {
  const out: string[] = [];
  let discoveryEmitted = false;

  // ── Abertura / descoberta — SÓ quando o bloco atual NÃO tem ato explícito prioritário. ──
  if (!input.suppressDiscovery) {
    if (input.adVehicleLabel) {
      out.push(`O cliente chegou por um anúncio do ${input.adVehicleLabel}: reconheça esse veículo e conduza sobre ele (fotos, detalhes, condições ou disponibilidade). Não abra com saudação genérica pedindo nome, telefone, cidade ou loja.`);
      discoveryEmitted = true;
    } else if (input.isFirstContact) {
      out.push("Primeiro contato: cumprimente e APRESENTE-SE conforme a identidade e a personalidade do prompt do portal (diga quem você é e de qual loja fala). Depois, faça a primeira pergunta de qualificação do portal para descobrir o que o cliente procura. Não peça nome nem telefone agora.");
      discoveryEmitted = true;
    }
    if (input.needsDiscovery && !input.adVehicleLabel) {
      out.push("O cliente ainda não disse o que procura: entenda primeiro a intenção comercial conforme o prompt do portal. O nome vem depois, com naturalidade. Não peça sobrenome nem nome completo nesta fase.");
      discoveryEmitted = true;
    }
  }

  // ── Não repergunte o que já é conhecido. ──
  if (input.knownName) {
    out.push(`Você já sabe o nome do cliente (${input.knownName}): use-o e siga a conversa; não pergunte o nome de novo.`);
  }
  if (input.contactPhoneKnown) {
    out.push("O telefone de contato já é conhecido pelo canal do WhatsApp: use-o como contato e NÃO peça o telefone.");
  }
  const otherKnown = input.knownFunnelSlots.filter((s) => s !== "nome").map((s) => SLOT_PT[s] ?? s);
  if (otherKnown.length > 0) {
    out.push(`Dados que você já sabe (não os pergunte de novo): ${otherKnown.join(", ")}.`);
  }

  // ── Conduzir financiamento do carro escolhido (sem voltar à descoberta). A ORDEM vem do portal (abaixo). ──
  if (input.paymentTurnWithChosenCar) {
    out.push("O cliente pediu as condições de pagamento de um carro que ele JÁ escolheu: conduza o financiamento — não volte para a descoberta ('o que você procura'/'que tipo'). Não afirme valores; pergunte-os.");
  }
  if (input.justAnsweredFinancialSlot === "entrada") {
    out.push("O cliente acabou de responder sobre a ENTRADA: acolha esse dado explicitamente antes de avançar.");
  } else if (input.justAnsweredFinancialSlot === "parcelaDesejada") {
    out.push("O cliente acabou de informar a PARCELA mensal desejada: acolha essa parcela explicitamente antes de avançar.");
  }

  // ── ⭐P1 CONTINUAÇÃO DE AGENDAMENTO: acolha o dia/horário informado e pergunte SÓ a dimensão faltante; NUNCA repergunte a
  //    já respondida. Se dia e horário estão definidos, confirme e avance conforme o prompt do portal. (Orienta, não escreve.) ──
  const sched = input.scheduling;
  if (sched?.active) {
    const given = [sched.dayJustGiven ? "o DIA" : null, sched.timeJustGiven ? "o HORÁRIO" : null].filter((x): x is string => x != null).join(" e ");
    if (given) out.push(`O cliente ACABOU de informar ${given} da visita neste bloco: reconheça/acolha explicitamente esse dado. NUNCA pergunte de novo uma dimensão (dia ou horário) que ele já respondeu.`);
    if (sched.dayKnown && sched.timeKnown) {
      out.push("O agendamento JÁ TEM o dia E o horário: confirme a visita citando o dia e o horário e avance conforme o prompt do portal (ex.: próximo passo/dado que o portal pede). NÃO pergunte o dia nem o horário novamente.");
    } else if (!sched.dayKnown) {
      out.push("Falta o DIA da visita: acolha o que veio e pergunte SOMENTE o dia. Não pergunte o horário ainda.");
    } else if (!sched.timeKnown) {
      out.push("Falta o HORÁRIO da visita: o dia JÁ está definido — NÃO o repergunte; acolha e pergunte SOMENTE o horário.");
    }
  }

  // ── Próxima pergunta de qualificação — AUTORIDADE DO PORTAL (nunca ordem hardcoded). Suprimida no agendamento ativo
  //    (a próxima pergunta é o dia/horário faltante, orientado acima). ──
  if (!input.suppressFunnelQuestion && !discoveryEmitted && !sched?.active) {
    if (input.portalNextQuestion && input.portalNextQuestion.trim()) {
      out.push(`Próximo passo da qualificação, conforme o prompt do portal: "${input.portalNextQuestion.trim()}". Faça UMA pergunta por vez e não repita dados que você já sabe.`);
    } else {
      out.push("Continue a qualificação conforme o prompt do portal, com UMA pergunta por vez e sem repetir dados que você já sabe.");
    }
  }

  // ── Gancho institucional / despedida. ──
  if (input.institutionalHookNeeded) {
    out.push("Depois de responder a informação da loja, conduza como SDR com UMA pergunta curta ligada ao carro em conversa (fotos, detalhes, condições, visita ou próximo passo). Não pare seco depois de responder.");
  }
  if (input.disengagementOnly) {
    out.push("O cliente apenas agradeceu ou encerrou e NÃO fez um pedido novo: responda uma despedida curta e cordial, deixando a loja à disposição — sem pergunta e sem reabrir a qualificação.");
  }

  // ── Estilo geral: UMA pergunta acionável; não empilhar perguntas INDEPENDENTES. Alternativas curtas e
  //    relacionadas ao MESMO veículo ("fotos ou condições dele?") são naturais e permitidas (auditoria Codex #2).
  //    Suprimido na despedida (que já orienta "sem pergunta") -> caso E fica só a orientação de encerramento. ──
  if (!input.disengagementOnly) {
    out.push("Faça no máximo UMA pergunta acionável por resposta e prefira um próximo passo claro. Não empilhe duas perguntas INDEPENDENTES no mesmo texto; alternativas curtas e relacionadas ao mesmo veículo (ex.: 'quer as fotos ou prefere ver as condições dele?') são naturais. Se o cliente já respondeu algo, reconheça e siga — não repita a mesma pergunta.");
  }

  return out;
}
