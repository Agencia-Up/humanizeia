// ============================================================================
// transfer-templates.ts — HF-2 (missão 2026-07-11). Módulo PURO de composição
// das notificações de transferência (vendedor/gerente) COMPATÍVEL com o portal:
//
//  - renderTemplate: MESMA semântica do v2 (_shared/transfer/messageTemplates.ts):
//    {etiqueta} vira o dado real; linha cujas etiquetas ficaram TODAS vazias
//    SOME inteira (nunca "Cidade:" pendurado).
//  - composeSellerMessage/composeManagerMessage: template do portal quando
//    existe (briefing_template_vendedor/gerente); senão o fallback inline
//    (mesmo formato do v2, com "Responda Ok" na pendente e variante de
//    re-aviso SEM Ok no retorno).
//  - stripEmojis/maybeStripEmojis: porta do v2 — só remove pictogramas e linhas
//    decorativas; acentos NUNCA são tocados (prova em teste com "ç/ã/é").
//  - buildTransferEtiquetas: mapa de etiquetas alimentado SÓ por fatos do
//    ConversationState v3 (slot known) — interesse de COMPRA e veículo de
//    TROCA jamais se contaminam; ausente = "" (a linha some na renderização).
//  - Rodízio puro: sellerPhoneKey/uniqueSellersByPhone/pickFairRoundRobin —
//    mesma regra do v2 pós-fix Icom (nunca-recebeu PRIMEIRO, depois o mais
//    antigo last_lead_received_at; dedup por telefone).
//
// Nada aqui fala com banco/rede e nada aqui escreve resposta AO LEAD — são
// notificações operacionais ao VENDEDOR/GERENTE (execução, não conversa).
// ============================================================================
import type { ConversationState, FunnelSlots } from "../domain/conversation-state.ts";

// ── Reason kinds do contrato de handoff (HF-1). `returning_lead_renotify` é
//    resolvido pela SAGA (lead já tem dono ativo); os demais nascem na decisão. ──
export const HANDOFF_REASON_KINDS = [
  "explicit_human_request",
  "qualified_handoff",
  "followup_timeout_handoff",
  "returning_lead_renotify",
] as const;
export type HandoffReasonKind = (typeof HANDOFF_REASON_KINDS)[number];

export function isHandoffReasonKind(value: unknown): value is HandoffReasonKind {
  return typeof value === "string" && (HANDOFF_REASON_KINDS as readonly string[]).includes(value);
}

// Rótulo humano do motivo (vai no briefing e no transfer_reason do banco com o
// prefixo "v3:" — o notify_seller deriva a variante da mensagem disso).
export const HANDOFF_REASON_LABEL: Record<HandoffReasonKind, string> = {
  explicit_human_request: "Lead pediu atendimento humano",
  qualified_handoff: "Lead qualificado — próximo passo é o vendedor",
  followup_timeout_handoff: "Inatividade do lead (follow-up T3)",
  returning_lead_renotify: "Lead retornou e voltou a demonstrar interesse",
};

export function transferReasonTag(kind: HandoffReasonKind): string {
  return `v3:${kind}`;
}
export function parseTransferReasonTag(reason: string | null | undefined): HandoffReasonKind | null {
  const m = /^v3:([a-z_]+)/.exec(String(reason ?? "").trim());
  return m && isHandoffReasonKind(m[1]) ? m[1] : null;
}

// ── renderTemplate: porta EXATA do v2 (linha só de etiquetas vazias some). ──
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const out: string[] = [];
  for (const rawLine of String(tpl).split("\n")) {
    const placeholders = rawLine.match(/\{[a-zA-Z_]+\}/g) ?? [];
    if (placeholders.length === 0) { out.push(rawLine); continue; }
    let anyFilled = false;
    let line = rawLine;
    for (const ph of placeholders) {
      const key = ph.slice(1, -1).toLowerCase();
      const val = (vars[key] ?? "").toString().trim();
      if (val) anyFilled = true;
      line = line.split(ph).join(val);
    }
    if (!anyFilled) continue;
    out.push(line);
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── stripEmojis: porta do v2 — pictogramas/linhas decorativas fora, ACENTOS intactos. ──
export function stripEmojis(text: string): string {
  let t = String(text ?? "");
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}\u{1F1E6}-\u{1F1FF}]/gu, "");
  t = t.replace(/[─-╿]+/g, "");   // box-drawing (━ ─ │) — range EXPLÍCITO, nunca pega letras acentuadas
  t = t.split("\n").map((l) => l.replace(/\s{2,}/g, " ").replace(/^\s+/, "").replace(/\s+$/, "")).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export function maybeStripEmojis(mensagensSemEmoji: boolean, text: string): string {
  if (mensagensSemEmoji !== true) return text;
  try { return stripEmojis(text); } catch { return text; }
}

// ── Fatos do estado v3 -> etiquetas ─────────────────────────────────────────
type ValueSlotName = Exclude<keyof FunnelSlots, "cpf">;   // cpf é SensitiveSlot (ref, nunca valor) — fora das etiquetas por construção
function known<K extends ValueSlotName>(slots: FunnelSlots, key: K): FunnelSlots[K]["value"] | undefined {
  const slot = slots[key];
  return slot && slot.status === "known" && slot.value != null ? slot.value : undefined;
}
function moneyBr(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
}

// Interesse de COMPRA (selecionado > slot interesse > tipo/faixa) — NUNCA lê a troca.
export function interestEtiquetaText(state: ConversationState, adVehicleLabel: string | null): string {
  const sel = state.vehicleContext?.selected?.label ?? null;
  if (typeof sel === "string" && sel.trim()) return sel.trim();
  const interesse = known(state.slots, "interesse");
  if (typeof interesse === "string" && interesse.trim()) return interesse.trim();
  if (adVehicleLabel && adVehicleLabel.trim()) return adVehicleLabel.trim();
  const tipo = known(state.slots, "tipoVeiculo");
  const faixa = known(state.slots, "faixaPreco");
  const bits: string[] = [];
  if (typeof tipo === "string" && tipo.trim()) bits.push(tipo.trim());
  if (faixa && typeof faixa === "object") {
    const max = moneyBr((faixa as { max?: number }).max);
    if (max) bits.push(`até ${max}`);
  }
  return bits.join(" ");
}

// Veículo de TROCA (carro DO LEAD) — NUNCA alimenta o interesse.
export function tradeEtiquetaText(slots: FunnelSlots): string {
  const possui = known(slots, "possuiTroca");
  const carro = known(slots, "veiculoTroca");
  if (carro && typeof carro === "object") {
    const c = carro as { marca?: string; modelo?: string; ano?: number; km?: number };
    const parts = [c.marca, c.modelo, c.ano ? String(c.ano) : null,
      typeof c.km === "number" && c.km > 0 ? `${Math.round(c.km).toLocaleString("pt-BR")} km` : null,
    ].filter((p): p is string => typeof p === "string" && p.trim() !== "");
    if (parts.length > 0) return parts.join(" ");
  }
  if (possui === true) return "sim (dados a coletar)";
  if (possui === false) return "não possui";
  return "";   // unknown = etiqueta vazia (linha some) — NUNCA vira "não possui"
}

export type TransferEtiquetasArgs = {
  readonly state: ConversationState;
  readonly agentName: string;
  readonly leadDisplayName: string | null;   // lead_name canônico do CRM (já sanitizado) ou nome do slot
  readonly leadPhone: string | null;         // dígitos (ex.: 5512988887777)
  readonly sellerName: string | null;
  readonly sellerPhone: string | null;
  readonly adVehicleLabel: string | null;
  readonly classificacao: string;            // texto da categoria SDR (briefing-builder)
  readonly horario: string;                  // horário local já formatado (injeção do clock — puro)
  readonly resumo: string;                   // briefing/summary (cap 300 na etiqueta, como no v2)
};

// Mapa de etiquetas do PORTAL (mesmas chaves do v2). Ausente = "" (linha some).
export function buildTransferEtiquetas(args: TransferEtiquetasArgs): Record<string, string> {
  const s = args.state.slots;
  const digits = String(args.leadPhone ?? "").replace(/\D/g, "");
  const nomeSlot = known(s, "nome");
  const nome = (typeof nomeSlot === "string" && nomeSlot.trim())
    ? nomeSlot.trim()
    : (args.leadDisplayName?.trim() || (digits ? `Lead (final ${digits.slice(-4)})` : "Lead"));
  const forma = known(s, "formaPagamento");
  return {
    agente: args.agentName || "Agente",
    nome,
    telefone: digits,
    link: digits ? `https://wa.me/${digits}` : "",
    cidade: (typeof known(s, "cidade") === "string" ? String(known(s, "cidade")) : "").trim(),
    temperatura: "",
    interesse: interestEtiquetaText(args.state, args.adVehicleLabel),
    veiculo: args.state.vehicleContext?.focus?.label?.trim() ?? "",
    pagamento: typeof forma === "string" ? forma : "",
    entrada: moneyBr(known(s, "entrada")),
    troca: tradeEtiquetaText(s),
    objecoes: "",
    decisao: "",
    resumo: args.resumo ? String(args.resumo).substring(0, 300) : "",
    vendedor: args.sellerName?.trim() ?? "",
    telefone_vendedor: args.sellerPhone?.trim() ?? "",
    classificacao: args.classificacao?.trim() ?? "",
    horario: args.horario?.trim() ?? "",
    motivo: "",
    urgencia: "",
    score: "",
  };
}

// ── Composição vendedor/gerente (template do portal OU fallback v2-compatível) ──
export type SellerMessageArgs = {
  readonly template: string | null;              // briefing_template_vendedor (null/vazio = fallback)
  readonly mensagensSemEmoji: boolean;
  readonly etiquetas: Record<string, string>;
  readonly reason: HandoffReasonKind;
  readonly leadDisplayName: string | null;
  readonly leadPhone: string | null;             // dígitos
  readonly agentName: string;
  readonly briefing: string;                     // briefing factual integral (buildSellerBriefing)
  readonly classificacaoLine: string;            // linha de status SDR (ex.: "🏷️ *Status:* 🎯 LEAD QUALIFICADO")
};

export function composeSellerMessage(args: SellerMessageArgs): string {
  const tpl = String(args.template ?? "").trim();
  if (tpl) return maybeStripEmojis(args.mensagensSemEmoji, renderTemplate(tpl, args.etiquetas));
  const digits = String(args.leadPhone ?? "").replace(/\D/g, "");
  const isRenotify = args.reason === "returning_lead_renotify";
  const header = isRenotify
    ? `*LEAD RETORNOU (Pedro v3)*\nUm cliente que já era seu voltou a conversar. Retome o atendimento.`
    : `*NOVO LEAD PARA ATENDIMENTO (Pedro v3)*`;
  const footer = isRenotify
    ? (digits ? `*Atender:* https://wa.me/${digits}` : "")
    : `${digits ? `*Atender agora:* https://wa.me/${digits}\n\n` : ""}*Responda "Ok" para assumir este atendimento!*`;
  const lines = [
    header,
    "",
    `*Cliente:* ${args.leadDisplayName?.trim() || "Desconhecido"}`,
    args.classificacaoLine,
    digits ? `*Contato:* +${digits}` : "",
    `*Agente IA:* ${args.agentName || "Agente"}`,
    `*Motivo:* ${HANDOFF_REASON_LABEL[args.reason]}`,
    "",
    "--------------------",
    args.briefing,
    "--------------------",
    "",
    footer,
  ].filter((l) => l !== "");
  return maybeStripEmojis(args.mensagensSemEmoji, lines.join("\n"));
}

export type ManagerMessageArgs = {
  readonly template: string | null;              // briefing_template_gerente
  readonly mensagensSemEmoji: boolean;
  readonly gerenteFeedbackCompleto: boolean;     // completo = MESMA msg do vendedor + linha do vendedor
  readonly etiquetas: Record<string, string>;
  readonly sellerMessage: string;                // a mensagem final que FOI composta ao vendedor
  readonly sellerName: string | null;
  readonly sellerPhone: string | null;           // dígitos
  readonly agentName: string;
  readonly leadDisplayName: string | null;
  readonly leadPhone: string | null;
  readonly classificacaoText: string;            // texto curto da categoria (sem markup)
  readonly horario: string;
};

export function composeManagerMessage(args: ManagerMessageArgs): string {
  const sellerDigits = String(args.sellerPhone ?? "").replace(/\D/g, "");
  if (args.gerenteFeedbackCompleto === true) {
    const linhaVendedor = `🧑‍💼 *Vendedor atribuído:* ${args.sellerName?.trim() || "Vendedor"}${sellerDigits ? ` — wa.me/${sellerDigits}` : ""}`;
    return maybeStripEmojis(args.mensagensSemEmoji, `${linhaVendedor}\n\n${args.sellerMessage}`);
  }
  const tpl = String(args.template ?? "").trim();
  if (tpl) return maybeStripEmojis(args.mensagensSemEmoji, renderTemplate(tpl, args.etiquetas));
  const digits = String(args.leadPhone ?? "").replace(/\D/g, "");
  const fallback = [
    `📊 *RELATÓRIO DE LEAD — ${args.agentName || "Agente"}*`,
    "",
    `🕐 *Horário:* ${args.horario}`,
    "",
    `👤 *Lead:* ${args.leadDisplayName?.trim() || "Desconhecido"}`,
    digits ? `📱 *Telefone:* +${digits}` : "",
    args.classificacaoText ? `🏷️ *Status:* ${args.classificacaoText}` : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    `🎯 *Enviado para:* ${args.sellerName?.trim() || "Vendedor"}`,
    sellerDigits ? `📲 *WhatsApp vendedor:* ${sellerDigits}` : "",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "_Gerado automaticamente pelo Pedro v3_",
  ].filter((l) => l !== "");
  return maybeStripEmojis(args.mensagensSemEmoji, fallback.join("\n"));
}

// ── Rodízio puro (mesma regra do v2 pós-fix Icom) ───────────────────────────
export type SellerCandidate = {
  readonly id: string;
  readonly name: string | null;
  readonly whatsappNumber: string | null;
  readonly isActive: boolean;
  readonly agentId: string | null;
  readonly lastLeadReceivedAt: string | null;
  readonly totalLeadsReceived: number;
};

// Chave local do telefone (10 dígitos): remove 55 e o 9º dígito de celular — o
// MESMO colapso do v2 (sellerPhoneKey), p/ dedup de vendedor duplicado.
export function sellerPhoneKey(whatsappNumber: string | null | undefined): string {
  const digits = String(whatsappNumber ?? "").replace(/\D/g, "");
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11 && local[2] === "9") return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}

export function uniqueSellersByPhone(
  sellers: readonly SellerCandidate[],
  exclude?: { readonly id?: string | null; readonly phoneKey?: string | null },
): SellerCandidate[] {
  const seen = new Set<string>();
  return sellers.filter((seller) => {
    const key = sellerPhoneKey(seller.whatsappNumber);
    if (!seller.isActive) return false;
    if (exclude?.id && seller.id === exclude.id) return false;
    if (exclude?.phoneKey && key === exclude.phoneKey) return false;
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

// Rodízio JUSTO: quem NUNCA recebeu vai primeiro; depois o mais antigo
// last_lead_received_at. Empate resolvido por id (determinístico p/ teste).
export function pickFairRoundRobin(sellers: readonly SellerCandidate[]): SellerCandidate | null {
  if (sellers.length === 0) return null;
  const sorted = [...sellers].sort((a, b) => {
    const aNever = a.lastLeadReceivedAt == null ? 0 : 1;
    const bNever = b.lastLeadReceivedAt == null ? 0 : 1;
    if (aNever !== bNever) return aNever - bNever;
    const aAt = a.lastLeadReceivedAt ? Date.parse(a.lastLeadReceivedAt) : 0;
    const bAt = b.lastLeadReceivedAt ? Date.parse(b.lastLeadReceivedAt) : 0;
    if (aAt !== bAt) return aAt - bAt;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}
