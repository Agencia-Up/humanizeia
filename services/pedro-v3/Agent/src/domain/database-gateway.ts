import type { JsonValue } from "./types.ts";

export type DatabaseRow = { [key: string]: JsonValue };
export type DatabaseFilters = { [column: string]: JsonValue };
export type DatabaseOrder = { column: string; ascending?: boolean };

export interface V3DatabaseGateway {
  rpc<T extends JsonValue>(name: string, args: DatabaseRow): Promise<T>;
  selectOne(table: string, filters: DatabaseFilters, columns?: string): Promise<DatabaseRow | null>;
  selectMany(
    table: string,
    filters: DatabaseFilters,
    options?: { columns?: string; order?: DatabaseOrder[]; limit?: number },
  ): Promise<DatabaseRow[]>;
  count(table: string, filters: DatabaseFilters): Promise<number>;
}
