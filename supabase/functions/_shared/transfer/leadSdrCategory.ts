// ============================================================================
// leadSdrCategory — FONTE UNICA das 3 categorias de lead do SDR (Pedro v2).
// ----------------------------------------------------------------------------
// Decisao do dono (04/06/2026): o briefing de transferencia (vendedor + gerente)
// passa a usar SOMENTE 3 categorias, e elas sao GRAVADAS em ai_crm_leads.status_crm
// pra alimentar o dashboard de feedback (a ser criado depois).
//
//   1. INATIVO ('inativo') — lead que chega de anuncio, o agente responde mas ele
//      NAO fala mais nada -> e transferido por inatividade. Nenhum dado coletado.
//
//   2. POUCO QUALIFICADO ('pouco_qualificado') — o agente coletou ALGUMA info
//      (CPF, carro de troca, financiamento, entrada, cidade, agendamento...) mas o
//      lead nao quis seguir OU parou de responder -> vai pro vendedor por ausencia.
//
//   3. QUALIFICADO ('qualificado') — lead pronto pra comprar: nome + interesse +
//      dados suficientes e intencao de compra OU de agendar visita.
//
// ESTE modulo e a UNICA fonte da regra. Usado em 3 lugares pra nunca divergir:
//   - orquestrador (handoff ao vivo): define o status do briefing + grava status_crm.
//   - cron-lead-followup (12min de inatividade): idem.
//   - auto-classify-leads (reclassificacao horaria): idem, lendo as colunas do lead.
//
// NAO mexe nas COLUNAS do board do CRM (Interessado / Medio Qualif. continuam) — a
// simplificacao pra 3 categorias e SO do briefing/status_crm. E NUNCA sobrescreve um
// estado que o VENDEDOR moveu manualmente (PROTECTED_STATUSES) — "o vendedor e quem move".
// ============================================================================

export type SdrCategoryKey = "inativo" | "pouco_qualificado" | "qualificado";

const SDR_CATEGORY_MAP: Record<SdrCategoryKey, { emoji: string; label: string }> = {
  inativo:           { emoji: "💤", label: "LEAD INATIVO" },
  pouco_qualificado: { emoji: "🧊", label: "LEAD POUCO QUALIFICADO" },
  qualificado:       { emoji: "🎯", label: "LEAD QUALIFICADO" },
};

// Estados que o VENDEDOR/gerente moveu manualmente — a classificacao automatica NUNCA
// sobrescreve (espelha o auto-classify-leads original). "O vendedor e quem move."
const PROTECTED_STATUSES = new Set([
  "fechado", "em_atendimento", "negociacao", "agendamento", "perdido", "transferido",
]);

// Campos de COMPLETUDE (mesma base do auto-classify-leads — preserva o comportamento
// historico do 'qualificado').
const COMPLETION_FIELDS = [
  "client_name", "vehicle_interest", "payment_method",
  "budget", "client_city", "visit_scheduled",
] as const;

// Campos de ENGAJAMENTO = completude + dados "profundos" que o lead so da quando
// realmente conversa (troca / entrada / CPF).
const ENGAGE_FIELDS = [
  ...COMPLETION_FIELDS, "trade_in_vehicle", "down_payment", "cpf",
] as const;

// Campos "PROFUNDOS" = info que o lead SO da se engajou de verdade. NAO inclui
// client_name nem vehicle_interest: lead de anuncio ja chega com o nome do WhatsApp e
// o carro do anuncio preenchidos SEM nunca ter respondido. Por isso a distincao
// INATIVO (nao engajou) x POUCO QUALIFICADO (deu CPF/troca/financiamento) olha SO estes.
const DEEP_FIELDS = [
  "payment_method", "budget", "client_city", "visit_scheduled",
  "trade_in_vehicle", "down_payment", "cpf",
] as const;

const COMPLETION_THRESHOLD = 0.6; // % de campos de completude p/ 'qualificado'

export interface LeadFieldsForClassification {
  client_name?: string | null;
  vehicle_interest?: string | null;
  payment_method?: string | null;
  budget?: string | null;
  client_city?: string | null;
  visit_scheduled?: string | null;
  trade_in_vehicle?: string | null;
  down_payment?: string | null;
  cpf?: string | null;
  status_crm?: string | null;
}

export interface ClassifyOpts {
  by_inactivity?: boolean;      // transferido pela cron (lead parou de responder)
  ready_to_transfer?: boolean;  // o cerebro marcou 'pronto_para_transferir' (qualificado)
  for_briefing?: boolean;       // se true, lead SEM nada vira 'inativo' (nunca 'novo')
}

const hasValue = (v: any): boolean =>
  v !== null && v !== undefined &&
  String(v).trim() !== "" &&
  String(v).trim().toLowerCase() !== "false" &&
  String(v).trim().toLowerCase() !== "null";

// Classifica o lead numa das 3 categorias do SDR. Retorna tambem o estado protegido
// (movido pelo vendedor) ou 'novo' quando NAO e pra briefing — para o auto-classify
// horario preservar exatamente o comportamento antigo nesses casos.
export function classifyLeadSdr(
  lead: LeadFieldsForClassification,
  opts: ClassifyOpts = {},
): SdrCategoryKey | "novo" | string {
  // 1) Estado movido manualmente pelo vendedor -> preserva (nunca "puxa de volta").
  if (lead.status_crm && PROTECTED_STATUSES.has(lead.status_crm)) {
    return lead.status_crm;
  }

  const filledEngage = ENGAGE_FIELDS.filter((f) => hasValue((lead as any)[f])).length;
  const filledCompletion = COMPLETION_FIELDS.filter((f) => hasValue((lead as any)[f])).length;
  const filledDeep = DEEP_FIELDS.filter((f) => hasValue((lead as any)[f])).length;
  const hasRequired = hasValue(lead.client_name) && hasValue(lead.vehicle_interest);
  const completion = filledCompletion / COMPLETION_FIELDS.length;

  // 2) QUALIFICADO: o cerebro disse que esta pronto, OU nome+interesse + >=60% dos campos.
  if (opts.ready_to_transfer) return "qualificado";

  // 3) Transferido por INATIVIDADE: se o lead deu algum dado PROFUNDO (CPF/troca/
  //    financiamento/entrada/cidade/agendamento) = pouco qualificado (definicao do dono);
  //    se so tem nome do WhatsApp + carro do anuncio = inativo (nao engajou de verdade).
  if (opts.by_inactivity) {
    return filledDeep > 0 ? "pouco_qualificado" : "inativo";
  }

  // Mantem a regra historica (>=60% dos 6 campos de completude) E aceita um caminho mais
  // largo: nome + interesse + 2 dados quaisquer de engajamento. Sem isso, o agente marca
  // 'qualificado' na transferencia mas o classificador horario rebaixaria (o cerebro captura
  // troca/entrada/CPF, que nao estavam nos 6 campos antigos) — assim os dois concordam.
  if (hasRequired && (completion >= COMPLETION_THRESHOLD || filledEngage >= 4)) return "qualificado";

  // 4) POUCO QUALIFICADO: deu alguma info PROFUNDA (CPF/troca/financiamento/entrada/
  //    cidade/agendamento) mas nao fechou; ou ja estava nessa faixa no board.
  if (filledDeep > 0 ||
      ["pouco_qualificado", "medio_qualificado", "interessado"].includes(lead.status_crm || "")) {
    return "pouco_qualificado";
  }

  // 5) Sem dado nenhum: no briefing vira 'inativo'; fora dele preserva 'novo'.
  return opts.for_briefing ? "inativo" : (lead.status_crm || "novo");
}

// Garante uma das 3 categorias (para o briefing). Qualquer estado protegido/'novo'
// inesperado cai em 'inativo' (lead que vai pro vendedor sem nada coletado).
export function classifyLeadSdrCategory(
  lead: LeadFieldsForClassification,
  opts: ClassifyOpts = {},
): SdrCategoryKey {
  const r = classifyLeadSdr(lead, { ...opts, for_briefing: true });
  return (r === "inativo" || r === "pouco_qualificado" || r === "qualificado") ? r : "inativo";
}

// Linha pronta pro WhatsApp do VENDEDOR. Ex.: "🏷️ *Status:* 🎯 LEAD QUALIFICADO"
export function sdrCategoryLine(key: SdrCategoryKey): string {
  const c = SDR_CATEGORY_MAP[key] || SDR_CATEGORY_MAP.inativo;
  return `🏷️ *Status:* ${c.emoji} ${c.label}`;
}

// Versao curta (emoji + label) pro relatorio do GERENTE.
export function sdrCategoryText(key: SdrCategoryKey): string {
  const c = SDR_CATEGORY_MAP[key] || SDR_CATEGORY_MAP.inativo;
  return `${c.emoji} ${c.label}`;
}

// De-para da qualificacao que o cerebro coletou (qualificacao_coletada) -> colunas
// de ai_crm_leads, pra alimentar o dashboard. Retorna SO os campos com valor (nunca
// apaga dado que o vendedor ja preencheu). Separa em:
//   - safe: colunas confirmadas como TEXTO (gravacao segura).
//   - extra: colunas de tipo incerto (entrada/agendamento) — o caller grava em
//            bloco best-effort proprio, pra um erro de tipo nunca derrubar o resto.
export function mapQualificacaoToLeadColumns(
  qc: any,
  temperatura?: string | null,
): { safe: Record<string, any>; extra: Record<string, any> } {
  const safe: Record<string, any> = {};
  const extra: Record<string, any> = {};
  const put = (obj: Record<string, any>, key: string, v: any) => {
    if (v !== null && v !== undefined && String(v).trim() !== "") obj[key] = String(v).trim();
  };
  put(safe, "client_name", qc?.nome);
  put(safe, "vehicle_interest", qc?.interesse);
  put(safe, "payment_method", qc?.forma_pagamento);
  put(safe, "trade_in_vehicle", qc?.carro_troca);
  put(safe, "client_city", qc?.cidade);
  put(safe, "cpf", qc?.cpf);
  if (temperatura) put(safe, "temperature", temperatura);
  // tipo de coluna incerto -> best-effort isolado
  put(extra, "down_payment", qc?.valor_entrada);
  put(extra, "visit_scheduled", qc?.dia_agendamento);
  return { safe, extra };
}
