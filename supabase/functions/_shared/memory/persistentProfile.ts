// =============================================================================
// PERSISTENT PROFILE — IT-3.1 (memória do Pedro SDR)
// =============================================================================
//
// Agrega dados de TODAS as conversas anteriores que o mesmo cliente teve
// (cross-conversa) num "perfil persistente". Cliente que volta depois de
// dias/semanas não começa do zero: agente enxerga cidade, modelos
// anteriores, acompanhante de decisão, preferências, etc.
//
// FONTE DE DADOS:
//   - leadRecords: rows de `ai_crm_leads` com mesmo `remote_jid` (ou phone
//     normalizado), do mesmo `user_id`. Idealmente excluindo o lead atual
//     (pra não duplicar contexto).
//   - stateRecords: rows de `pedro_conversation_state.state` desses leads.
//
// AGREGAÇÃO:
//   - Pega o valor mais recente não-vazio de cada campo (ordena por
//     `last_interaction_at` desc no caller — função aqui assume ordem).
//   - Para arrays/sets (modelos perguntados, objeções), faz UNION com dedupe.
//
// USO (fonte canônica testável):
//   ```ts
//   import { derivePersistentProfile, formatPersistentProfileBlock } from './persistentProfile';
//
//   // Caller faz queries e ordena
//   const profile = derivePersistentProfile(leadRecords, stateRecords);
//   if (profile) systemPrompt += '\n\n' + formatPersistentProfileBlock(profile);
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type PersistentProfile = {
  /** Quantas conversas anteriores foram agregadas. */
  total_previous_conversations: number;
  /** Última interação (ISO) — mais recente de TODAS. */
  last_seen_at: string | null;
  /** Dias desde a última interação (calculado pelo caller). */
  days_since_last_seen: number | null;
  /** Nome consolidado. */
  known_name: string | null;
  /** Cidade consolidada. */
  known_city: string | null;
  /** Modelos perguntados em conversas anteriores (deduplicado). */
  previously_asked_models: string[];
  /** Veículos que foram apresentados antes. */
  previously_shown_vehicles: Array<{
    modelo: string;
    ano?: number | string;
    preco?: string;
  }>;
  /** Forma de pagamento mencionada antes. */
  known_payment_method: string | null;
  /** Acompanhante de decisão. */
  known_decision_maker: string | null;
  /** Objeções históricas (deduplicado). */
  known_objections: string[];
  /** Já foi transferido pra vendedor antes? */
  has_been_transferred_before: boolean;
};

const isNonEmpty = (v: any): boolean =>
  v !== null && v !== undefined && (typeof v !== "string" || v.trim().length > 0);

/**
 * Deriva perfil persistente de N leads + N states. Pure function.
 * Aceita arrays vazios. Retorna null se nada útil foi encontrado.
 *
 * Importante: o caller DEVE ordenar `leadRecords` por `last_interaction_at`
 * desc antes de chamar, pra "valor mais recente" funcionar corretamente.
 */
export function derivePersistentProfile(
  leadRecords: any[],
  stateRecords: any[]
): PersistentProfile | null {
  if ((leadRecords?.length ?? 0) === 0 && (stateRecords?.length ?? 0) === 0) {
    return null;
  }

  const leads = leadRecords || [];
  const states = stateRecords || [];

  // Helper: percorre records em ordem e devolve o primeiro valor non-empty
  const pickRecent = <T>(records: any[], path: (r: any) => T): T | null => {
    for (const r of records) {
      const v = path(r);
      if (isNonEmpty(v)) return v;
    }
    return null;
  };

  // last_seen_at: max de `last_interaction_at` em leads
  let lastSeenAt: string | null = null;
  for (const l of leads) {
    if (l?.last_interaction_at && (!lastSeenAt || l.last_interaction_at > lastSeenAt)) {
      lastSeenAt = l.last_interaction_at;
    }
  }
  let daysSinceLastSeen: number | null = null;
  if (lastSeenAt) {
    const diffMs = Date.now() - new Date(lastSeenAt).getTime();
    daysSinceLastSeen = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Nome: prefere state.lead.nome_completo, depois lead_name do CRM
  const knownName =
    pickRecent<string>(states, (r) => r?.state?.lead?.nome_completo) ||
    pickRecent<string>(states, (r) => r?.state?.lead?.nome) ||
    pickRecent<string>(leads, (l) => l?.lead_name) ||
    pickRecent<string>(leads, (l) => l?.client_name) ||
    null;

  // Cidade
  const knownCity =
    pickRecent<string>(states, (r) => r?.state?.lead?.cidade) ||
    pickRecent<string>(leads, (l) => l?.client_city) ||
    null;

  // Modelos perguntados (union de todos os states + ai_crm_leads.vehicle_interest)
  const modelSet = new Set<string>();
  for (const s of states) {
    const m = s?.state?.interesse?.modelo_desejado;
    if (isNonEmpty(m)) modelSet.add(m.trim());
  }
  for (const l of leads) {
    if (isNonEmpty(l?.vehicle_interest)) modelSet.add(l.vehicle_interest.trim());
  }
  const previouslyAskedModels = Array.from(modelSet);

  // Veículos apresentados antes (com ano + preço se disponível)
  const shownMap = new Map<string, { modelo: string; ano?: any; preco?: string }>();
  for (const s of states) {
    const vp = s?.state?.veiculo_apresentado;
    if (vp?.ja_apresentado && vp?.modelo) {
      const key = `${vp.modelo}|${vp.ano || ""}`;
      if (!shownMap.has(key)) {
        shownMap.set(key, { modelo: vp.modelo, ano: vp.ano, preco: vp.preco });
      }
    }
  }
  const previouslyShownVehicles = Array.from(shownMap.values());

  // Forma de pagamento
  const knownPaymentMethod =
    pickRecent<string>(states, (r) => r?.state?.negociacao?.forma_pagamento) ||
    pickRecent<string>(leads, (l) => l?.payment_method) ||
    null;

  // Acompanhante de decisão
  const knownDecisionMaker = pickRecent<string>(
    states,
    (r) => r?.state?.lead?.acompanhante_decisao
  );

  // Objeções (union deduplicado)
  const objSet = new Set<string>();
  for (const s of states) {
    const objs = s?.state?.atendimento?.objecoes;
    if (Array.isArray(objs)) objs.forEach((o: string) => isNonEmpty(o) && objSet.add(o));
  }
  const knownObjections = Array.from(objSet);

  // Foi transferido antes?
  const hasBeenTransferredBefore = leads.some(
    (l) => l?.status === "transferido" || l?.status_crm === "qualificado"
  );

  return {
    total_previous_conversations: leads.length,
    last_seen_at: lastSeenAt,
    days_since_last_seen: daysSinceLastSeen,
    known_name: knownName,
    known_city: knownCity,
    previously_asked_models: previouslyAskedModels,
    previously_shown_vehicles: previouslyShownVehicles,
    known_payment_method: knownPaymentMethod,
    known_decision_maker: knownDecisionMaker,
    known_objections: knownObjections,
    has_been_transferred_before: hasBeenTransferredBefore,
  };
}

/**
 * Formata perfil como bloco markdown pro system prompt. Retorna string
 * vazia se nenhum campo útil — não polui o prompt.
 */
export function formatPersistentProfileBlock(profile: PersistentProfile): string {
  // Filtra: só apenda se há algo realmente útil (não só 1 conversa vazia)
  const hasUsefulData =
    !!profile.known_name ||
    !!profile.known_city ||
    profile.previously_asked_models.length > 0 ||
    profile.previously_shown_vehicles.length > 0 ||
    !!profile.known_payment_method ||
    !!profile.known_decision_maker ||
    profile.known_objections.length > 0;
  if (!hasUsefulData) return "";

  const lines: string[] = [];
  lines.push("## PERFIL CONHECIDO (conversas anteriores)");
  if (profile.days_since_last_seen !== null) {
    if (profile.days_since_last_seen === 0) {
      lines.push(`- Última interação: hoje`);
    } else if (profile.days_since_last_seen === 1) {
      lines.push(`- Última interação: ontem`);
    } else {
      lines.push(`- Última interação: ${profile.days_since_last_seen} dias atrás`);
    }
  }
  lines.push(`- Conversas anteriores: ${profile.total_previous_conversations}`);
  if (profile.known_name) lines.push(`- Nome: ${profile.known_name}`);
  if (profile.known_city) lines.push(`- Cidade: ${profile.known_city}`);
  if (profile.known_payment_method)
    lines.push(`- Pagamento mencionado antes: ${profile.known_payment_method}`);
  if (profile.known_decision_maker)
    lines.push(`- Decisão envolve: ${profile.known_decision_maker}`);
  if (profile.previously_asked_models.length > 0) {
    lines.push(
      `- Modelos já perguntados: ${profile.previously_asked_models.join(", ")}`
    );
  }
  if (profile.previously_shown_vehicles.length > 0) {
    const shownStr = profile.previously_shown_vehicles
      .map(
        (v) =>
          `${v.modelo}${v.ano ? ` ${v.ano}` : ""}${v.preco ? ` (R$ ${v.preco})` : ""}`
      )
      .join("; ");
    lines.push(`- Veículos apresentados antes: ${shownStr}`);
  }
  if (profile.known_objections.length > 0) {
    lines.push(`- Objeções históricas: ${profile.known_objections.join(", ")}`);
  }
  if (profile.has_been_transferred_before) {
    lines.push(`- ⚠️ Já foi transferido pra vendedor anteriormente`);
  }
  lines.push("");
  lines.push(
    "⚠️ Use esses dados como CONTEXTO — não pergunte de novo o que já sabemos. Se cliente disser algo conflitante, prefira a info NOVA (pessoa pode ter mudado)."
  );
  return lines.join("\n");
}
