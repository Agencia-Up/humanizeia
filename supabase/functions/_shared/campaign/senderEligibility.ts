// ============================================================================
// REMETENTE DE CAMPANHA / DISPARO EM MASSA — modelo do dono (confirmado 30/07).
//
// COMO O PRODUTO FUNCIONA:
//   * campanha de VENDEDOR sai do NUMERO DELE. E assim que deve ser: o cliente
//     fala com o vendedor. A protecao contra banimento vem do LIMITE (intervalo
//     entre envios, limite diario, aquecimento de numero novo, rodizio), nao de
//     trocar o remetente.
//   * campanha do MASTER sai de uma linha da conta (nunca do numero pessoal de
//     um vendedor: o cliente do master receberia mensagem do celular de alguem
//     que nao tem relacao com aquele disparo).
//   * a LINHA DA IA (purpose='agent') nunca faz disparo em massa. Ela existe para
//     o atendimento e o follow-up dos leads inativos do CRM do Pedro. Se levar
//     ban por disparo, o atendimento inteiro da conta para.
//
// FAIL-CLOSED: na duvida sobre quem e o remetente correto, nao envia.
// ============================================================================

export type CampaignSenderCandidate = {
  id?: string;
  seller_member_id?: string | null;
  purpose?: string | null;
  is_active?: boolean | null;
  status?: string | null;
  health_score?: number | null;
  shadow_ban_suspect?: boolean | null;
  quarantine_until?: string | null;
  user_id?: string | null;
};

export type IneligibleReason =
  | "seller_instance"
  | "ai_agent_line"
  | "purpose_not_allowed"
  | "not_active"
  | "not_connected"
  | "shadow_ban_suspect"
  | "quarantined"
  | "unhealthy"
  | "bulk_sender_required"
  | "wrong_owner";

export type SenderOpts = { requireExplicitBulkSender?: boolean; now?: Date };

/** Estado operacional: vale para QUALQUER remetente (vendedor ou master). */
export function senderOperationalIssue(
  inst: CampaignSenderCandidate | null | undefined,
  opts: SenderOpts = {},
): IneligibleReason | null {
  if (!inst) return "not_connected";
  if (inst.is_active === false) return "not_active";
  if (String(inst.status ?? "").toLowerCase() !== "connected") return "not_connected";
  if (inst.shadow_ban_suspect === true) return "shadow_ban_suspect";
  if (inst.quarantine_until) {
    const until = new Date(inst.quarantine_until).getTime();
    if (Number.isFinite(until) && until > (opts.now ?? new Date()).getTime()) return "quarantined";
  }
  if (typeof inst.health_score === "number" && inst.health_score < 20) return "unhealthy";
  return null;
}

/**
 * Pode esta instancia executar a campanha de `ownerSellerMemberId`?
 * null = pode. Fail-closed.
 *
 *  - campanha de VENDEDOR  => somente o numero DAQUELE vendedor;
 *  - campanha do MASTER    => somente linha da conta (seller_member_id IS NULL);
 *  - linha da IA (agent)   => NUNCA, em nenhum dos dois casos.
 */
export function campaignSenderIneligibility(
  inst: CampaignSenderCandidate | null | undefined,
  opts: SenderOpts & { ownerSellerMemberId?: string | null } = {},
): IneligibleReason | null {
  if (!inst) return "not_connected";

  const purpose = inst.purpose ?? null;
  if (purpose === "agent") return "ai_agent_line";   // atendimento nunca dispara em massa
  if (purpose === "manual" || purpose === "test") return "purpose_not_allowed";

  const dono = opts.ownerSellerMemberId ?? null;
  if (dono) {
    // Campanha do vendedor: o remetente e o numero DELE. Nunca de outro vendedor.
    if (inst.seller_member_id !== dono) return "wrong_owner";
  } else {
    // Campanha do master: nunca sai do numero pessoal de um vendedor.
    if (inst.seller_member_id) return "seller_instance";
    if (opts.requireExplicitBulkSender && purpose !== "bulk_sender") return "bulk_sender_required";
  }

  return senderOperationalIssue(inst, opts);
}

export function isEligibleCampaignSender(
  inst: CampaignSenderCandidate | null | undefined,
  opts: SenderOpts & { ownerSellerMemberId?: string | null } = {},
): boolean {
  return campaignSenderIneligibility(inst, opts) === null;
}

/** Pool valido para a campanha. Nunca mistura vendedores, nunca usa a linha da IA. */
export function selectCampaignSenderPool<T extends CampaignSenderCandidate>(
  all: T[] | null | undefined,
  opts: SenderOpts & { ownerSellerMemberId?: string | null } = {},
): T[] {
  return (all ?? []).filter((i) => isEligibleCampaignSender(i, opts));
}

// ── Decisao de roteamento (pura, testavel) ──────────────────────────────────

export type CampaignForRouting = {
  id?: string | null;
  seller_member_id?: string | null;
  instance_id?: string | null;
};

export type RoutingDecision<T> =
  | { action: "send"; pool: T[]; pinIgnored: boolean; ownedBySeller: boolean }
  | { action: "park"; reason: "no_eligible_campaign_sender"; ownedBySeller: boolean };

/**
 * Decide POR ONDE o disparo sai. Nunca devolve instancia de vendedor.
 *
 * - Campanha de vendedor NAO e bloqueada: ela continua do vendedor (atribuicao),
 *   mas a execucao usa a linha oficial da conta.
 * - `campaign.instance_id` apontando para instancia INELEGIVEL (ex.: numero de
 *   vendedor, herdado de antes desta politica) NAO trava a fila: o pin e
 *   ignorado (sinalizado em `pinIgnored`) e o pool oficial e usado.
 * - Sem linha oficial => "park": o item NAO e consumido, NAO vira failed, NAO
 *   penaliza o vendedor. Fica recuperavel para quando houver remetente.
 */
export function decideCampaignSender<T extends CampaignSenderCandidate>(
  campaign: CampaignForRouting | null | undefined,
  tenantInstances: T[] | null | undefined,
  opts: SenderOpts = {},
): RoutingDecision<T> {
  const ownedBySeller = !!campaign?.seller_member_id;
  // Campanha de vendedor => pool = numero DELE. Campanha do master => linhas da conta.
  const pool = selectCampaignSenderPool(tenantInstances, {
    ...opts, ownerSellerMemberId: campaign?.seller_member_id ?? null,
  });
  if (pool.length === 0) {
    return { action: "park", reason: "no_eligible_campaign_sender", ownedBySeller };
  }
  const pinnedId = campaign?.instance_id ?? null;
  if (pinnedId) {
    const pinned = pool.filter((i) => i.id === pinnedId);
    if (pinned.length > 0) return { action: "send", pool: pinned, pinIgnored: false, ownedBySeller };
    return { action: "send", pool, pinIgnored: true, ownedBySeller };
  }
  return { action: "send", pool, pinIgnored: false, ownedBySeller };
}

// ── Plano de despacho de UM item da fila (puro, testavel) ───────────────────

export type QueueItemForRouting = {
  id?: string | null;
  campaign_id?: string | null;
  instance_id?: string | null;
};

export type DispatchPlan<T> =
  /** Item SEM campanha (ex.: continuidade do handle-instance-ban). A politica de
   *  campanha NAO se aplica: preserva a regra antiga e o instance_id do proprio item. */
  | { kind: "no_campaign"; pool: T[]; pinnedInstanceId: string | null }
  /** Campanha sem remetente oficial: estaciona. Nao consome tentativa, nao falha. */
  | { kind: "park"; reason: "no_eligible_campaign_sender"; ownedBySeller: boolean }
  /** Campanha com remetente oficial. `effectiveInstanceId` e o pin JA VALIDADO:
   *  null quando o pin original era inelegivel (nao pode chegar ao seletor). */
  | { kind: "send"; pool: T[]; effectiveInstanceId: string | null; pinIgnored: boolean; ownedBySeller: boolean };

export function planQueueItemDispatch<T extends CampaignSenderCandidate>(
  item: QueueItemForRouting,
  campaign: CampaignForRouting | null | undefined,
  tenantInstances: T[] | null | undefined,
  opts: SenderOpts = {},
): DispatchPlan<T> {
  const all = tenantInstances ?? [];

  // 1) Sem campanha => fora da politica de campanha (fluxo de continuidade).
  if (!item?.campaign_id || !campaign) {
    return { kind: "no_campaign", pool: all, pinnedInstanceId: item?.instance_id ?? null };
  }

  // 2) Campanha: pool oficial (nunca vendedor, nunca agent). Lista vazia e lista
  //    sem elegivel caem no MESMO caminho: estaciona.
  const d = decideCampaignSender(campaign, all, opts);
  if (d.action === "park") {
    return { kind: "park", reason: d.reason, ownedBySeller: d.ownedBySeller };
  }
  return {
    kind: "send",
    pool: d.pool,
    // pin inelegivel NUNCA e repassado adiante — vira null.
    effectiveInstanceId: d.pinIgnored ? null : (campaign.instance_id ?? null),
    pinIgnored: d.pinIgnored,
    ownedBySeller: d.ownedBySeller,
  };
}
