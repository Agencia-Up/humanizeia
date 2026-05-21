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
