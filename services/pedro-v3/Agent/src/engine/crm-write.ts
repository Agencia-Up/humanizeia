// ============================================================================
// crm-write.ts — FASE 1 do CRM/Handoff (missão 2026-07-09). Módulo PURO.
//
// O ENGINE grava no CRM apenas o que JÁ COLETOU com confiança: os SLOTS do
// ConversationState (fonte = extração determinística + reducer — nunca o
// palpite da LLM). A LLM continua conduzindo a conversa; o CRM write é um
// EFFECT silencioso (não fala com o lead), injetado no chokepoint do turno.
//
// Invariantes (inventário v2 itens #8/#52 + missão):
//  - Só campos COM VALOR entram no plan (nunca null; ausência = omissão).
//  - Idempotência: planId fixo ("crm") -> effectId = turnId:crm (retry do
//    mesmo turno regrava o MESMO effect; o outbox deduplica por effectId).
//  - Delta por turno: só emite plan quando o payload difere do que este
//    estado já produziria antes do turno (evita updates idênticos por turno).
//  - Ordem ALTA (CRM_WRITE_ORDER) e sem dependentes: o reply/media despacham
//    ANTES; falha de CRM NUNCA silencia o lead. (E se o reply falhar, o
//    dispatcher pula o CRM por dependência de ordem — dado fica p/ o próximo turno.)
//  - Troca NUNCA contamina interesse (colunas separadas: vehicle_interest ×
//    trade_in_vehicle) e vice-versa — cada uma nasce do próprio slot.
//  - "Nunca sobrescrever campo humano" / "nunca apagar": a POLÍTICA DE MERGE
//    (fill-only-if-empty) é aplicada no DISPATCHER (crm-write-dispatcher.ts),
//    que lê o lead atual; aqui só nasce o payload com o que o agente coletou.
// ============================================================================
import type { ConversationState, AdContext } from "../domain/conversation-state.ts";
import type { CrmWritePlan } from "../domain/decision.ts";
import type { Id, JsonValue } from "../domain/types.ts";

export const CRM_WRITE_PLAN_ID = "crm";
export const CRM_WRITE_ORDER = 90;   // sempre depois de send_message(0)/send_media(1..)

type Slots = ConversationState["slots"];
type SlotRecord = Record<string, { status?: string; value?: unknown } | undefined>;

function known(slots: Slots, key: string): unknown {
  const s = (slots as SlotRecord)[key];
  return s?.status === "known" ? s.value : undefined;
}
function textOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function moneyBr(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

// Nome REAL de pessoa (mesma semântica do ensurePedroV2Lead/isRealLeadName do v2):
// >=2 letras e não-placeholder. Vale p/ lead_name (exibição no CRM/inbox/briefing —
// campo CANÔNICO de nome, auditado 2026-07-10) e client_name (nome da qualificação).
// Lixo/emoji/placeholder NUNCA entra em nenhum dos dois.
// ⭐Codex P1: NORMALIZA o hint do WhatsApp (pushName) — remove emoji/símbolos (mantém letras, espaços, ' - .),
// colapsa espaços ("Douglas 🚗" -> "Douglas"). Nome COMERCIAL ("Icom Motors") não é nome de pessoa: rejeitado
// (vira placeholder promovível). Exportado p/ o teste bridge→ingest→CRM.
const BUSINESS_NAME_RX = /\b(?:motors?|motos?|veiculos?|automoveis|autos?|cars?|multimarcas|garage|garagem|loja|oficina|ltda|comercio|store|shop|oficial|vendas)\b/i;
export function sanitizeLeadNameHint(raw: unknown): string | null {
  const text = String(raw ?? "").normalize("NFC").replace(/[^\p{L}\p{M}\s'.-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (text.length < 2) return null;
  const noAccents = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (BUSINESS_NAME_RX.test(noAccents)) return null;   // nome de empresa/loja nunca vira lead_name
  return text;
}
export function isRealLeadName(value: unknown): boolean {
  const text = String(value ?? "").trim();
  if (text.length === 0 || !/\p{L}{2,}/u.test(text)) return false;
  if (/^(lead|cliente|client|customer|contato|usuario|user)$/i.test(text)) return false;
  // ⭐SEM inv.7: o placeholder de criação ("Contato WhatsApp • final 1234") também é promovível — nunca é nome real.
  if (/^contato\b/i.test(text)) return false;
  return true;
}

// Veículo de TROCA (carro DO LEAD) -> texto de briefing/CRM. NUNCA alimenta vehicle_interest.
export function tradeVehicleText(slots: Slots): string | null {
  const possui = known(slots, "possuiTroca");
  const tv = known(slots, "veiculoTroca");
  if (tv && typeof tv === "object") {
    const o = tv as { marca?: string; modelo?: string; ano?: number; km?: number; estado?: string };
    const parts = [o.marca, o.modelo, o.ano != null ? String(o.ano) : null].filter(Boolean).join(" ").trim();
    const km = typeof o.km === "number" && o.km > 0 ? `${o.km.toLocaleString("pt-BR")} km` : null;
    const desc = [parts || null, km, o.estado ?? null].filter(Boolean).join(", ");
    if (desc) return desc;
  }
  if (possui === true) return "sim (dados pendentes)";
  if (possui === false) return "não possui";
  return null;
}

// Veículo de INTERESSE (compra): selecionado CANÔNICO > slot interesse > veículo do anúncio.
// O anúncio entra como fallback (inventário: lead de anúncio quase nunca digita o modelo).
export function interestVehicleText(state: ConversationState, adVehicleLabel: string | null): string | null {
  const sel = state.vehicleContext.selected;
  if (sel?.label && sel.label !== sel.key) return sel.label;
  const interesse = textOf(known(state.slots, "interesse"));
  if (interesse) return interesse;
  return adVehicleLabel;
}

function visitText(slots: Slots): string | null {
  const dia = textOf(known(slots, "diaHorario"));
  const quer = known(slots, "interesseVisita");
  if (dia) return dia;
  if (quer === true) return "quer visitar (dia/horário a combinar)";
  return null;
}

// Resumo curto DETERMINÍSTICO (fatos do estado; sem LLM na Fase 1 — a LLM só
// poderia RESUMIR fatos fornecidos, nunca criar; hook fica para fase futura).
export function buildCrmSummary(state: ConversationState, adVehicleLabel: string | null): string | null {
  const parts: string[] = [];
  const interesse = interestVehicleText(state, adVehicleLabel);
  if (interesse) parts.push(`Interesse: ${interesse}`);
  const troca = tradeVehicleText(state.slots);
  if (troca) parts.push(`Troca: ${troca}`);
  const entrada = moneyBr(known(state.slots, "entrada"));
  if (entrada) parts.push(`Entrada: ${entrada}`);
  const parcela = moneyBr(known(state.slots, "parcelaDesejada"));
  if (parcela) parts.push(`Parcela desejada: ${parcela}/mês`);
  const forma = textOf(known(state.slots, "formaPagamento"));
  if (forma) parts.push(`Pagamento: ${forma}`);
  const visita = visitText(state.slots);
  if (visita) parts.push(`Visita: ${visita}`);
  if (parts.length === 0) return null;
  return `[Pedro v3] ${parts.join(" · ")}`.slice(0, 800);
}

// Campos de ai_crm_leads que a Fase 1 pode escrever (colunas REAIS; mapeamento
// espelha mapQualificacaoToLeadColumns do v2 + desired_installment/budget/origem).
export function buildCrmFields(state: ConversationState, ad: AdContext | null, adVehicleLabel: string | null, leadNameHint: string | null = null): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  const put = (col: string, v: string | null) => { if (v != null && v.trim() !== "") out[col] = v.trim().slice(0, 400); };
  // Nome: só NOME REAL entra (nunca lixo/placeholder). client_name = nome da qualificação;
  // lead_name = nome de EXIBIÇÃO canônico do CRM (o dispatcher promove placeholder->real e
  // NUNCA regride um lead_name humano real — contrato do audit 2026-07-10).
  const nome = textOf(known(state.slots, "nome"));
  if (nome && isRealLeadName(nome)) {
    put("client_name", nome);
    put("lead_name", nome);
  } else if (sanitizeLeadNameHint(leadNameHint) && isRealLeadName(sanitizeLeadNameHint(leadNameHint))) {
    // ⭐SEM inv.7: sem nome DECLARADO, o pushName REAL do WhatsApp inicializa o lead_name de exibição
    // (só exibição — client_name é exclusivo do nome declarado na conversa). O merge do dispatcher
    // continua mandando: promove placeholder e NUNCA regride um lead_name humano real.
    put("lead_name", sanitizeLeadNameHint(leadNameHint));
  }
  put("vehicle_interest", interestVehicleText(state, adVehicleLabel));
  put("payment_method", textOf(known(state.slots, "formaPagamento")));
  put("down_payment", moneyBr(known(state.slots, "entrada")));
  put("desired_installment", moneyBr(known(state.slots, "parcelaDesejada")));
  put("trade_in_vehicle", tradeVehicleText(state.slots));
  put("client_city", textOf(known(state.slots, "cidade")));
  put("visit_scheduled", visitText(state.slots));
  const faixa = known(state.slots, "faixaPreco");
  if (faixa && typeof faixa === "object") {
    const max = moneyBr((faixa as { max?: number }).max);
    if (max) put("budget", `até ${max}`);
  }
  // Origem: lead entrou por anúncio CTWA -> mesma semântica do v2 ("trafico_pago").
  if (ad) put("origem", "trafico_pago");
  put("summary", buildCrmSummary(state, adVehicleLabel));
  return out;
}

export type CrmWritePlanArgs = {
  readonly stateAfter: ConversationState;          // estado PÓS-turno (inclui os slots extraídos NESTE turno)
  readonly stateBefore: ConversationState | null;  // estado PRÉ-turno (p/ delta: só emite quando algo mudou)
  readonly adContext: AdContext | null;
  readonly adVehicleLabel: string | null;          // veículo do anúncio JÁ ATERRADO no catálogo (nunca texto cru)
  readonly leadId: string | null;
  readonly turnId: Id;
  readonly leadNameHint?: string | null;   // ⭐SEM inv.7: pushName sanitizado (hint de lead_name; validado por isRealLeadName)
};

// Constrói o CrmWritePlan do turno (ou null quando não há o que gravar).
// null quando: sem leadId (fail-closed), sem nenhum campo, ou payload idêntico
// ao que o estado PRÉ-turno já produzia (nada novo coletado neste turno).
export function buildCrmWritePlan(args: CrmWritePlanArgs): CrmWritePlan | null {
  if (!args.leadId || args.leadId.trim() === "") return null;
  const hint = args.leadNameHint ?? null;
  const fields = buildCrmFields(args.stateAfter, args.adContext, args.adVehicleLabel, hint);
  if (Object.keys(fields).length === 0) return null;
  if (args.stateBefore) {
    const before = buildCrmFields(args.stateBefore, args.adContext, args.adVehicleLabel, hint);
    if (JSON.stringify(before) === JSON.stringify(fields)) return null;   // nada novo neste turno
  }
  return {
    kind: "crm_write",
    planId: CRM_WRITE_PLAN_ID,
    effectId: `${args.turnId}:${CRM_WRITE_PLAN_ID}`,
    order: CRM_WRITE_ORDER,
    onSuccess: [],
    leadId: args.leadId,
    fields,
  };
}
