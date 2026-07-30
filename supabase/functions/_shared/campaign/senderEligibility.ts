// ============================================================================
// ETAPA 1 — Quem pode EXECUTAR um disparo automatico (campanha / massa).
//
// PRINCIPIO: a campanha continua PERTENCENDO a quem a criou (inclusive vendedor,
// para atribuicao e relatorio), mas a EXECUCAO automatica sai sempre por uma
// linha oficial da conta. Dono != remetente.
//
// REGRA DURA (independe de classificacao e de qualquer flag):
//   instancia com seller_member_id preenchido NUNCA executa disparo automatico.
// O numero pessoal do vendedor continua: sincronizando entrada/saida, recebendo
// briefing e transferencia, confirmando "Ok", aparecendo no inbox e sendo usado
// manualmente por ele no WhatsApp. Nada disso passa por este caminho.
//
// purpose='agent' (linha da IA) tambem nunca executa disparo em massa.
//
// VALORES DE purpose ACEITOS PELO BANCO (CHECK em wa_instances, conferido em
// producao 30/07/2026): NULL | 'agent' | 'bulk_sender' | 'manual' | 'test'.
// 'sync_only' NAO existe no CHECK — nao e usado aqui. Se um dia for preciso,
// entra por migration aditiva ANTES de aparecer nesta regra.
//
// MODO DE COMPATIBILIDADE (transitorio): com REQUIRE_EXPLICIT_BULK_SENDER=false,
// master com purpose NULL segue elegivel, porque hoje 0 de 25 instancias estao
// classificadas. purpose=NULL e ESTADO TEMPORARIO, nao finalidade declarada.
// Depois da classificacao humana, ligar a flag => so 'bulk_sender' executa.
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
  | "bulk_sender_required";

export type SenderOpts = { requireExplicitBulkSender?: boolean; now?: Date };

/** Motivo pelo qual NAO pode executar disparo; null = pode. Fail-closed. */
export function campaignSenderIneligibility(
  inst: CampaignSenderCandidate | null | undefined,
  opts: SenderOpts = {},
): IneligibleReason | null {
  if (!inst) return "seller_instance"; // sem candidato = nao envia

  if (inst.seller_member_id) return "seller_instance";        // barreira absoluta

  const purpose = inst.purpose ?? null;
  if (purpose === "agent") return "ai_agent_line";
  if (purpose === "manual" || purpose === "test") return "purpose_not_allowed";

  if (inst.is_active === false) return "not_active";
  if (String(inst.status ?? "").toLowerCase() !== "connected") return "not_connected";
  if (inst.shadow_ban_suspect === true) return "shadow_ban_suspect";
  if (inst.quarantine_until) {
    const until = new Date(inst.quarantine_until).getTime();
    if (Number.isFinite(until) && until > (opts.now ?? new Date()).getTime()) return "quarantined";
  }
  if (typeof inst.health_score === "number" && inst.health_score < 20) return "unhealthy";

  if (opts.requireExplicitBulkSender) {
    return purpose === "bulk_sender" ? null : "bulk_sender_required";
  }
  return purpose === null || purpose === undefined || purpose === "bulk_sender"
    ? null
    : "purpose_not_allowed";
}

export function isEligibleCampaignSender(
  inst: CampaignSenderCandidate | null | undefined,
  opts: SenderOpts = {},
): boolean {
  return campaignSenderIneligibility(inst, opts) === null;
}

export function selectCampaignSenderPool<T extends CampaignSenderCandidate>(
  all: T[] | null | undefined,
  opts: SenderOpts = {},
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
  const pool = selectCampaignSenderPool(tenantInstances, opts);
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
