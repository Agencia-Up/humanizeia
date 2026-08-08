// ============================================================================
// HOTFIX P0 — autorizacao de `pedro-auto-followup`.
//
// A funcao implantada (v78) esta com `verify_jwt=false`, nao le o `Authorization`
// e cria o cliente com service_role. O kill-switch era
// `if (!reactEnabled && !dryRun && !onlyLeadId)`, entao um corpo
// `{"only_lead_id":"<uuid>"}` — que e ENVIO REAL — atravessava a flag desligada.
// Somado ao `verify_jwt=false`, qualquer chamada anonima podia disparar WhatsApp
// pela instancia de um cliente.
//
// Este modulo concentra a decisao. E PURO no nucleo e recebe as dependencias de
// I/O injetadas, para o gate rodar offline, sem rede e sem Supabase.
//
// Sem imports de proposito: o mesmo arquivo e carregado pelo Deno (edge) e pelo
// tsx (teste em Node).
// ============================================================================

export type ReactivationCallerKind = "service_role" | "user";

export type ReactivationAuthDenial = {
  readonly ok: false;
  readonly status: 400 | 401 | 403;
  /** Corpo ja sanitizado: nunca carrega token, telefone, prompt, stack ou erro do banco. */
  readonly body: { readonly ok: false; readonly error: "unauthorized" | "forbidden" | "invalid_payload" };
  /** Motivo interno para log/teste. Nao vai para a resposta HTTP. */
  readonly reason: string;
};

export type ReactivationScope = {
  readonly ok: true;
  readonly caller: ReactivationCallerKind;
  /**
   * Tenant unico autorizado, ou null = varrer todos os tenants ativos.
   * `null` SO e alcancavel por service_role sem `only_user_id` e sem `only_lead_id`
   * (o caminho do cron). Usuario autenticado NUNCA chega a null.
   */
  readonly tenantScope: string | null;
  readonly onlyLeadId: string | null;
  readonly dryRun: boolean;
  readonly maxPerMaster: number;
};

export type ReactivationAuthResult = ReactivationScope | ReactivationAuthDenial;

/** Tetos de lote. O chamador humano e conservador; o cron ainda assim e limitado. */
export const MAX_PER_MASTER_LIMIT: Readonly<Record<ReactivationCallerKind, number>> = {
  user: 5,
  service_role: 50,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Aceita exatamente `Bearer <token>`; devolve null para ausente/vazio/malformado. */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer[ \t]+(.+)$/.exec(header.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  return token === "" ? null : token;
}

/**
 * `max_per_master` do corpo. Rejeita o que nao for inteiro positivo; acima do teto
 * do papel, limita (nao rejeita) — um numero alto e pedido legitimo mal calibrado,
 * nao payload invalido.
 */
export function normalizeMaxPerMaster(
  raw: unknown,
  caller: ReactivationCallerKind,
): { readonly ok: true; readonly value: number } | { readonly ok: false } {
  const limit = MAX_PER_MASTER_LIMIT[caller];
  if (raw === undefined || raw === null) return { ok: true, value: 1 };
  if (typeof raw !== "number" && typeof raw !== "string") return { ok: false };
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return { ok: false };
  return { ok: true, value: Math.min(parsed, limit) };
}

/**
 * O kill-switch depois do hotfix: TODO envio real depende da flag.
 * `dry_run` continua liberado com a flag desligada — ele nao envia nem grava —
 * mas ainda exige autenticacao e escopo de tenant (resolvidos antes daqui).
 */
export function reactivationSendsBlocked(input: {
  readonly flagEnabled: boolean;
  readonly dryRun: boolean;
}): boolean {
  return !input.flagEnabled && !input.dryRun;
}

/** Semantica vigente da secret preservada de proposito: liga so com "on". */
export function reactivationFlagEnabled(rawEnv: string | null | undefined): boolean {
  return String(rawEnv ?? "").trim().toLowerCase() === "on";
}

export type ReactivationAuthDeps = {
  /** Valida o JWT e devolve o id do usuario REAL. `null` para anon/invalido/expirado. */
  readonly verifyUserToken: (token: string) => Promise<string | null>;
  /** Tenant (billing owner) do usuario. `null` quando o usuario nao tem tenant. */
  readonly resolveTenantForUser: (userId: string) => Promise<string | null>;
  /** Dono do lead. `null` se nao existe. Usado para ancorar o escopo. */
  readonly resolveLeadOwner: (leadId: string) => Promise<string | null>;
};

export type ReactivationAuthInput = {
  readonly authorizationHeader: string | null | undefined;
  readonly body: Record<string, unknown> | null | undefined;
  readonly serviceRoleKey: string;
  /** Chave anonima do projeto: e publica (vai no frontend) e NUNCA autentica alguem. */
  readonly anonKey?: string | null;
};

const deny = (
  status: ReactivationAuthDenial["status"],
  error: ReactivationAuthDenial["body"]["error"],
  reason: string,
): ReactivationAuthDenial => ({ ok: false, status, body: { ok: false, error }, reason });

/**
 * Autentica e resolve o escopo ANTES de qualquer consulta operacional.
 *
 * Regras:
 *  - sem Bearer / token vazio / JWT invalido -> 401;
 *  - anon key -> 401 (e publica; nao identifica ninguem);
 *  - usuario sem tenant -> 403;
 *  - `only_user_id` de terceiro -> 403;
 *  - `only_lead_id` de outro tenant -> 403; lead inexistente -> 403 (fail-closed);
 *  - `only_lead_id` SEMPRE ancora o escopo num unico tenant, inclusive para o
 *    service_role — assim ele nunca alarga a varredura para todos os tenants.
 */
export async function authorizeReactivationRequest(
  deps: ReactivationAuthDeps,
  input: ReactivationAuthInput,
): Promise<ReactivationAuthResult> {
  const token = parseBearerToken(input.authorizationHeader);
  if (!token) return deny(401, "unauthorized", "missing_bearer");

  const body = (input.body && typeof input.body === "object") ? input.body : {};
  const dryRun = body.dry_run === true;
  const rawOnlyUser = body.only_user_id;
  const rawOnlyLead = body.only_lead_id;

  const serviceRoleKey = String(input.serviceRoleKey ?? "");
  const isServiceRole = serviceRoleKey !== "" && token === serviceRoleKey;

  let caller: ReactivationCallerKind;
  let callerTenant: string | null = null;

  if (isServiceRole) {
    caller = "service_role";
  } else {
    // A anon key e um JWT valido de papel `anon`. Ela e publica: rejeitada antes
    // de qualquer verificacao, para nao depender do provider devolver erro.
    if (input.anonKey && token === String(input.anonKey)) return deny(401, "unauthorized", "anon_key_is_not_a_user");
    let userId: string | null = null;
    try {
      userId = await deps.verifyUserToken(token);
    } catch {
      return deny(401, "unauthorized", "token_verification_failed");
    }
    if (!userId) return deny(401, "unauthorized", "invalid_token");
    caller = "user";
    let tenant: string | null = null;
    try {
      tenant = await deps.resolveTenantForUser(userId);
    } catch {
      return deny(403, "forbidden", "tenant_resolution_failed");
    }
    if (!tenant) return deny(403, "forbidden", "user_without_tenant");
    callerTenant = tenant;
  }

  // ── only_user_id ────────────────────────────────────────────────────────────
  let tenantScope: string | null = callerTenant; // usuario ja nasce preso ao proprio tenant
  if (rawOnlyUser !== undefined && rawOnlyUser !== null && rawOnlyUser !== "") {
    if (!isUuid(rawOnlyUser)) return deny(400, "invalid_payload", "only_user_id_not_uuid");
    const requested = String(rawOnlyUser).trim();
    if (caller === "user" && requested !== callerTenant) return deny(403, "forbidden", "cross_tenant_only_user_id");
    tenantScope = requested;
  }

  // ── only_lead_id ────────────────────────────────────────────────────────────
  let onlyLeadId: string | null = null;
  if (rawOnlyLead !== undefined && rawOnlyLead !== null && rawOnlyLead !== "") {
    if (!isUuid(rawOnlyLead)) return deny(400, "invalid_payload", "only_lead_id_not_uuid");
    onlyLeadId = String(rawOnlyLead).trim();
    let owner: string | null = null;
    try {
      owner = await deps.resolveLeadOwner(onlyLeadId);
    } catch {
      return deny(403, "forbidden", "lead_owner_resolution_failed");
    }
    // Fail-closed: sem dono inequivoco, nega. Nunca "tenta em todos os tenants".
    if (!owner) return deny(403, "forbidden", "lead_owner_unresolved");
    if (tenantScope !== null && owner !== tenantScope) return deny(403, "forbidden", "cross_tenant_only_lead_id");
    tenantScope = owner;
  }

  const max = normalizeMaxPerMaster(body.max_per_master, caller);
  if (!max.ok) return deny(400, "invalid_payload", "max_per_master_invalid");

  return { ok: true, caller, tenantScope, onlyLeadId, dryRun, maxPerMaster: max.value };
}
