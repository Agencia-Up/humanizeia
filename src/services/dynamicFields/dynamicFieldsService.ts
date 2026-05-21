// =============================================================================
// dynamicFieldsService — operações comuns pra cities e lead_sources.
// =============================================================================
// Cada função aceita `entity` ('city' | 'lead_source') e roteia pra tabela certa.
// Reusa Supabase client existente. Trata tabelas não-tipadas com `as any`.

import { supabase } from "@/integrations/supabase/client";
import { normalizeForDedup, toDisplayName, validateNameInput } from "./normalize";

export type DynamicEntity = "city" | "lead_source";
export type DynamicStatus = "active" | "pending_review" | "archived" | "rejected";

export interface DynamicRow {
  id: string;
  user_id: string;
  name: string;
  normalized_name: string;
  state_uf?: string | null; // só cities
  category?: string | null; // só lead_sources
  icon?: string | null;
  status: DynamicStatus;
  is_system_default: boolean;
  created_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface SimilarSuggestion {
  id: string;
  name: string;
  similarity: number; // 0..1
}

export interface ValidateResult {
  ok: boolean;
  display: string;
  normalized: string;
  errors: string[];
  similar: SimilarSuggestion[];
  existing: { id: string; name: string } | null;
}

export interface CreateResult {
  row: DynamicRow;
  wasCreated: boolean;
  forcedWithSimilar: boolean;
  requiresApproval: boolean;
}

const TABLE_BY_ENTITY: Record<DynamicEntity, string> = {
  city: "cities",
  lead_source: "lead_sources",
};

// ───────────────────────────────────────────────────────────────────────────
// listActive — todos os registros 'active' do user_id (com herança de master)
// ───────────────────────────────────────────────────────────────────────────
export async function listActive(
  entity: DynamicEntity,
  userId: string
): Promise<DynamicRow[]> {
  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("is_system_default", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []) as DynamicRow[];
}

// ───────────────────────────────────────────────────────────────────────────
// listPending — pra tela de revisão (master)
// ───────────────────────────────────────────────────────────────────────────
export async function listPending(
  entity: DynamicEntity,
  userId: string
): Promise<DynamicRow[]> {
  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending_review")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as DynamicRow[];
}

// ───────────────────────────────────────────────────────────────────────────
// validateInput — verifica duplicidade exata + sugere similares (pg_trgm)
// ───────────────────────────────────────────────────────────────────────────
export async function validateInput(
  entity: DynamicEntity,
  input: string,
  userId: string
): Promise<ValidateResult> {
  const display = toDisplayName(input);
  const normalized = normalizeForDedup(input);
  const errors = validateNameInput(input, {
    allowNumbers: entity === "lead_source",
  });

  if (errors.length > 0 || !normalized) {
    return { ok: false, display, normalized, errors, similar: [], existing: null };
  }

  // 1) Duplicado exato
  const { data: exact, error: exactErr } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .select("id, name")
    .eq("user_id", userId)
    .eq("normalized_name", normalized)
    .maybeSingle();
  if (exactErr) throw exactErr;
  if (exact) {
    return {
      ok: true,
      display,
      normalized,
      errors: [],
      similar: [],
      existing: { id: (exact as any).id, name: (exact as any).name },
    };
  }

  // 2) Similares via pg_trgm — query manual com similarity()
  // Usa LIKE como fallback se RPC não estiver disponível
  const similar = await fetchSimilar(entity, normalized, userId);

  return {
    ok: true,
    display,
    normalized,
    errors: [],
    similar,
    existing: null,
  };
}

async function fetchSimilar(
  entity: DynamicEntity,
  normalized: string,
  userId: string
): Promise<SimilarSuggestion[]> {
  // Estratégia: traz top 5 já existentes do mesmo user_id (status=active) cujos
  // 3 primeiros chars batem (índice trgm trabalha bem aqui), depois calcula
  // similaridade client-side.
  const prefix = normalized.slice(0, 3);
  if (!prefix) return [];

  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .select("id, name, normalized_name")
    .eq("user_id", userId)
    .eq("status", "active")
    .ilike("normalized_name", `${prefix}%`)
    .limit(20);
  if (error) return []; // não bloqueia
  if (!data || data.length === 0) {
    // sem prefix match — tenta sufixo
    const tail = normalized.slice(-3);
    const { data: data2 } = await supabase
      .from(TABLE_BY_ENTITY[entity] as any)
      .select("id, name, normalized_name")
      .eq("user_id", userId)
      .eq("status", "active")
      .ilike("normalized_name", `%${tail}`)
      .limit(20);
    return scoreAndSort(normalized, data2 || []);
  }
  return scoreAndSort(normalized, data);
}

function scoreAndSort(needle: string, rows: any[]): SimilarSuggestion[] {
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      similarity: bigramSimilarity(needle, r.normalized_name),
    }))
    .filter((s) => s.similarity >= 0.55) // threshold conservador
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);
}

/** Similaridade simples baseada em bigramas (proxy do pg_trgm). 0..1 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const bigrams = (s: string): Set<string> => {
    const out = new Set<string>();
    const padded = `  ${s}  `;
    for (let i = 0; i < padded.length - 1; i++) {
      out.add(padded.slice(i, i + 2));
    }
    return out;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  return (2 * inter) / (A.size + B.size);
}

// ───────────────────────────────────────────────────────────────────────────
// create — insert idempotente
// ───────────────────────────────────────────────────────────────────────────
export interface CreateOpts {
  entity: DynamicEntity;
  input: string;
  userId: string;
  createdBy?: string;
  stateUf?: string; // só cities
  category?: string; // só lead_sources
  icon?: string;
  forceIfSimilar?: boolean;
  requireApproval?: boolean; // default false (auto-approve)
}

export async function create(opts: CreateOpts): Promise<CreateResult> {
  const validation = await validateInput(opts.entity, opts.input, opts.userId);
  if (!validation.ok) {
    throw new Error(`Validação falhou: ${validation.errors.join(", ")}`);
  }
  if (validation.existing) {
    // Já existe — retorna o registro existente como "wasCreated=false"
    const { data: row } = await supabase
      .from(TABLE_BY_ENTITY[opts.entity] as any)
      .select("*")
      .eq("id", validation.existing.id)
      .single();
    return {
      row: row as DynamicRow,
      wasCreated: false,
      forcedWithSimilar: false,
      requiresApproval: false,
    };
  }
  if (validation.similar.length > 0 && !opts.forceIfSimilar) {
    throw new Error(
      `Encontrados similares: ${validation.similar.map((s) => s.name).join(", ")}. ` +
        `Passe forceIfSimilar=true para criar mesmo assim.`
    );
  }

  const requiresApproval = !!opts.requireApproval;
  const insertRow: any = {
    user_id: opts.userId,
    name: validation.display,
    normalized_name: validation.normalized,
    status: requiresApproval ? "pending_review" : "active",
    is_system_default: false,
    created_by: opts.createdBy || opts.userId,
  };
  if (!requiresApproval) {
    insertRow.approved_by = opts.createdBy || opts.userId;
    insertRow.approved_at = new Date().toISOString();
  }
  if (opts.entity === "city" && opts.stateUf) insertRow.state_uf = opts.stateUf;
  if (opts.entity === "lead_source") {
    insertRow.category = opts.category || "manual";
    if (opts.icon) insertRow.icon = opts.icon;
  }

  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[opts.entity] as any)
    .insert(insertRow)
    .select()
    .single();
  if (error) {
    // race condition: ON CONFLICT pode disparar 23505
    if ((error as any).code === "23505") {
      // Re-busca e retorna o existente
      const { data: existing } = await supabase
        .from(TABLE_BY_ENTITY[opts.entity] as any)
        .select("*")
        .eq("user_id", opts.userId)
        .eq("normalized_name", validation.normalized)
        .single();
      return {
        row: existing as DynamicRow,
        wasCreated: false,
        forcedWithSimilar: !!opts.forceIfSimilar,
        requiresApproval: false,
      };
    }
    throw error;
  }

  return {
    row: data as DynamicRow,
    wasCreated: true,
    forcedWithSimilar: validation.similar.length > 0 && !!opts.forceIfSimilar,
    requiresApproval,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// approve, reject, archive, merge — operações do gerente
// ───────────────────────────────────────────────────────────────────────────
export async function approve(
  entity: DynamicEntity,
  id: string,
  approvedBy: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .update({
      status: "active",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function reject(
  entity: DynamicEntity,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .update({
      status: "rejected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function archive(
  entity: DynamicEntity,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .update({
      status: "archived",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Edita o nome e marca como aprovado em uma só ação.
 * Recalcula normalized_name. Se já existir outro registro com mesmo
 * normalized_name no mesmo user, joga erro (caller pode oferecer "merge").
 */
export async function editAndApprove(
  entity: DynamicEntity,
  id: string,
  newName: string,
  approvedBy: string
): Promise<DynamicRow> {
  const display = (await import("./normalize")).toDisplayName(newName);
  const normalized = (await import("./normalize")).normalizeForDedup(newName);
  if (!normalized || normalized.length < 2) {
    throw new Error("Nome inválido");
  }
  const { data, error } = await supabase
    .from(TABLE_BY_ENTITY[entity] as any)
    .update({
      name: display,
      normalized_name: normalized,
      status: "active",
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if ((error as any).code === "23505") {
      throw new Error("Já existe outra entrada com esse nome. Use 'Mesclar' em vez disso.");
    }
    throw error;
  }
  return data as DynamicRow;
}

/**
 * Mescla: move todos os leads que apontam pro `fromId` pra `intoId` e
 * arquiva o `fromId`. Aplicável a city_id e source_id em ai_crm_leads/crm_leads.
 */
export async function merge(
  entity: DynamicEntity,
  fromId: string,
  intoId: string
): Promise<void> {
  const fkCol = entity === "city" ? "city_id" : "source_id";
  // Atualiza ai_crm_leads
  await supabase
    .from("ai_crm_leads" as any)
    .update({ [fkCol]: intoId })
    .eq(fkCol, fromId);
  // Atualiza crm_leads (só source_id)
  if (entity === "lead_source") {
    await supabase
      .from("crm_leads" as any)
      .update({ source_id: intoId })
      .eq("source_id", fromId);
  }
  // Arquiva o fromId
  await archive(entity, fromId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.5b — Settings (toggle auto_approve por user)
// ─────────────────────────────────────────────────────────────────────────────

export interface DynamicFieldSettings {
  user_id: string;
  cities_auto_approve: boolean;
  lead_sources_auto_approve: boolean;
  notify_on_pending: boolean;
}

export async function getSettings(userId: string): Promise<DynamicFieldSettings> {
  // RPC garante row default se não existir
  const { data, error } = await supabase.rpc("ensure_dynamic_field_settings", {
    p_user_id: userId,
  } as any);
  if (error) throw error;
  return data as DynamicFieldSettings;
}

export async function updateSettings(
  userId: string,
  patch: Partial<Omit<DynamicFieldSettings, "user_id">>
): Promise<void> {
  const { error } = await supabase
    .from("dynamic_field_settings" as any)
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.5c — Histórico (últimos 50 itens decididos)
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string;
  user_id: string;
  entity_type: "city" | "lead_source";
  entity_id: string;
  action: string;
  performed_by: string | null;
  payload: any;
  created_at: string;
}

export async function listAuditHistory(
  userId: string,
  entity?: DynamicEntity,
  limit = 50
): Promise<AuditLogRow[]> {
  let q = supabase
    .from("dynamic_fields_audit_log" as any)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (entity) q = q.eq("entity_type", entity);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as AuditLogRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.6 — Analytics
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalyticsTopCreator {
  performed_by: string;
  performed_by_name: string;
  count: number;
}

export interface AnalyticsResult {
  total_active: number;
  total_pending: number;
  total_archived: number;
  total_rejected: number;
  created_last_30d: number;
  approval_auto_rate: number; // 0..1
  rejection_rate: number; // 0..1
  top_used: Array<{ id: string; name: string; usage_count: number }>;
  top_creators: AnalyticsTopCreator[];
}

export async function fetchAnalytics(
  entity: DynamicEntity,
  userId: string
): Promise<AnalyticsResult> {
  const table = TABLE_BY_ENTITY[entity];

  // 1) Counts por status
  const { data: rows, error: rowsErr } = await supabase
    .from(table as any)
    .select("id, name, status, usage_count, created_at, created_by, is_system_default")
    .eq("user_id", userId);
  if (rowsErr) throw rowsErr;
  const all = (rows || []) as any[];

  const totalActive = all.filter((r) => r.status === "active").length;
  const totalPending = all.filter((r) => r.status === "pending_review").length;
  const totalArchived = all.filter((r) => r.status === "archived").length;
  const totalRejected = all.filter((r) => r.status === "rejected").length;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const createdLast30d = all.filter(
    (r) => !r.is_system_default && new Date(r.created_at).getTime() >= cutoff
  ).length;

  const topUsed = [...all]
    .sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
    .slice(0, 5)
    .map((r) => ({ id: r.id, name: r.name, usage_count: r.usage_count || 0 }));

  // 2) Audit log pra calcular taxa de aprovação automática vs manual
  const { data: audits } = await supabase
    .from("dynamic_fields_audit_log" as any)
    .select("action, performed_by, payload")
    .eq("user_id", userId)
    .eq("entity_type", entity)
    .gte("created_at", new Date(cutoff).toISOString());
  const auditArr = (audits || []) as any[];

  const created = auditArr.filter((a) => a.action === "created").length;
  const approvedFromPending = auditArr.filter(
    (a) => a.action === "approved" && a.payload?.old_status === "pending_review"
  ).length;
  const rejected = auditArr.filter((a) => a.action === "rejected").length;

  // Aprovação automática: criadas com status=active (não passaram por pending)
  // Aproximação: assume que (created total - approvedFromPending) foram autos
  const autoApproved = Math.max(0, created - approvedFromPending - rejected);
  const totalDecisions = autoApproved + approvedFromPending + rejected;
  const approvalAutoRate = totalDecisions > 0 ? autoApproved / totalDecisions : 0;
  const rejectionRate = totalDecisions > 0 ? rejected / totalDecisions : 0;

  // 3) Top creators (vendedores que mais sugerem)
  const counts = new Map<string, number>();
  auditArr
    .filter((a) => a.action === "created" && a.performed_by)
    .forEach((a) => {
      counts.set(a.performed_by, (counts.get(a.performed_by) || 0) + 1);
    });
  const creatorIds = Array.from(counts.keys());
  let nameById = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles" as any)
      .select("id, full_name")
      .in("id", creatorIds);
    (profs || []).forEach((p: any) => nameById.set(p.id, p.full_name || "Usuário"));
  }
  const topCreators: AnalyticsTopCreator[] = Array.from(counts.entries())
    .map(([id, n]) => ({
      performed_by: id,
      performed_by_name: nameById.get(id) || "Usuário",
      count: n,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    total_active: totalActive,
    total_pending: totalPending,
    total_archived: totalArchived,
    total_rejected: totalRejected,
    created_last_30d: createdLast30d,
    approval_auto_rate: approvalAutoRate,
    rejection_rate: rejectionRate,
    top_used: topUsed,
    top_creators: topCreators,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.5f — Badge: contagem de pendentes (cidades + origens combinadas)
// ─────────────────────────────────────────────────────────────────────────────

export async function countPending(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("count_pending_dynamic_fields", {
    p_user_id: userId,
  } as any);
  if (error) return 0;
  return (data as number) || 0;
}
