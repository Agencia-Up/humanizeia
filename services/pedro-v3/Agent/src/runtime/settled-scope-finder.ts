import type { PedroV3ActiveScope } from "../domain/pilot-scope.ts";
import type { SettledConversation } from "../domain/ports.ts";

export type SettledScopeFailure = {
  readonly scope: PedroV3ActiveScope;
  readonly error: unknown;
};

export type SettledScopeResult = {
  readonly settled: readonly SettledConversation[];
  readonly succeededScopes: number;
  readonly failures: readonly SettledScopeFailure[];
};

// Tenant isolation also applies to availability: one broken integration must
// never prevent another tenant's settled conversations from being processed.
export async function findSettledAcrossScopes(
  scopes: readonly PedroV3ActiveScope[],
  load: (scope: PedroV3ActiveScope) => Promise<readonly SettledConversation[]>,
): Promise<SettledScopeResult> {
  const outcomes = await Promise.allSettled(scopes.map((scope) => load(scope)));
  const settled: SettledConversation[] = [];
  const failures: SettledScopeFailure[] = [];
  let succeededScopes = 0;

  outcomes.forEach((outcome, index) => {
    const scope = scopes[index];
    if (!scope) return;
    if (outcome.status === "fulfilled") {
      succeededScopes += 1;
      settled.push(...outcome.value);
      return;
    }
    failures.push({ scope, error: outcome.reason });
  });

  return { settled, succeededScopes, failures };
}
