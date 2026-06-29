import type {
  DatabaseFilters,
  DatabaseOrder,
  DatabaseRow,
  V3DatabaseGateway,
} from "../../domain/database-gateway.ts";
import type { JsonValue } from "../../domain/types.ts";

type SupabaseError = { message: string; code?: string; details?: string; hint?: string };
type SupabaseResult<T> = { data: T | null; error: SupabaseError | null; count?: number | null };

interface SupabaseFilterBuilder extends PromiseLike<SupabaseResult<DatabaseRow[]>> {
  eq(column: string, value: JsonValue): SupabaseFilterBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseFilterBuilder;
  limit(count: number): SupabaseFilterBuilder;
  maybeSingle(): PromiseLike<SupabaseResult<DatabaseRow>>;
}

interface SupabaseTableBuilder {
  select(
    columns?: string,
    options?: { count?: "exact"; head?: boolean },
  ): SupabaseFilterBuilder;
}

export interface SupabaseClientLike {
  rpc<T>(name: string, args: DatabaseRow): PromiseLike<SupabaseResult<T>>;
  from(table: string): SupabaseTableBuilder;
}

export class SupabaseGatewayError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string | null,
    message: string,
  ) {
    super(`${operation}: ${message}`);
    this.name = "SupabaseGatewayError";
  }
}

function fail(operation: string, error: SupabaseError): never {
  throw new SupabaseGatewayError(operation, error.code ?? null, error.message);
}

function applyFilters(builder: SupabaseFilterBuilder, filters: DatabaseFilters): SupabaseFilterBuilder {
  let next = builder;
  for (const [column, value] of Object.entries(filters)) next = next.eq(column, value);
  return next;
}

function applyOrder(builder: SupabaseFilterBuilder, order: DatabaseOrder[] | undefined): SupabaseFilterBuilder {
  let next = builder;
  for (const item of order ?? []) next = next.order(item.column, { ascending: item.ascending ?? true });
  return next;
}

export class SupabaseV3Gateway implements V3DatabaseGateway {
  constructor(private readonly client: SupabaseClientLike) {}

  async rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T> {
    const result = await this.client.rpc<T>(name, args);
    if (result.error) fail(`rpc:${name}`, result.error);
    if (result.data === null) throw new SupabaseGatewayError(`rpc:${name}`, null, "resposta nula");
    return result.data;
  }

  async selectOne(table: string, filters: DatabaseFilters, columns = "*"): Promise<DatabaseRow | null> {
    const query = applyFilters(this.client.from(table).select(columns), filters).limit(1);
    const result = await query.maybeSingle();
    if (result.error) fail(`selectOne:${table}`, result.error);
    return result.data;
  }

  async selectMany(
    table: string,
    filters: DatabaseFilters,
    options: { columns?: string; order?: DatabaseOrder[]; limit?: number } = {},
  ): Promise<DatabaseRow[]> {
    let query = applyFilters(this.client.from(table).select(options.columns ?? "*"), filters);
    query = applyOrder(query, options.order);
    if (options.limit != null) query = query.limit(options.limit);
    const result = await query;
    if (result.error) fail(`selectMany:${table}`, result.error);
    return result.data ?? [];
  }

  async count(table: string, filters: DatabaseFilters): Promise<number> {
    const query = applyFilters(
      this.client.from(table).select("*", { count: "exact", head: true }),
      filters,
    );
    const result = await query;
    if (result.error) fail(`count:${table}`, result.error);
    return result.count ?? 0;
  }
}
