// fake-credential-provider.ts — F2.5.2A / A.1
//
// Spy + fake FAIL-CLOSED do CredentialProvider. Conta chamadas a `resolve` para
// PROVAR que carregar a configuração (TenantConfigSource.load) NUNCA acessa o
// segredo (R1-6/R1-7) — na F2.5.2A `resolveCount` permanece 0.
//
// A.1: ausência/divergência de segredo FALHA FECHADO (nunca devolve material
// "default"): SECRET_NOT_FOUND / SECRET_OWNERSHIP_MISMATCH / SECRET_PROVIDER_MISMATCH.

import type {
  CredentialProvider,
  ResolveSecretResult,
  SecretRef,
} from "../../../domain/credential-provider.ts";
import type { SecretProvider } from "../../../domain/credential-provider.ts";

export type FakeSecretEntry = {
  readonly tenantId: string;
  readonly provider: SecretProvider;
  readonly material: string;
};

export class FakeCredentialProvider implements CredentialProvider {
  resolveCount = 0;
  readonly seenRefs: SecretRef[] = [];

  constructor(private readonly secrets: Readonly<Record<string, FakeSecretEntry>> = {}) {}

  async resolve(ref: SecretRef): Promise<ResolveSecretResult> {
    this.resolveCount += 1;
    this.seenRefs.push(ref);
    const entry = this.secrets[ref.integrationId];
    if (!entry) return { ok: false, error: "SECRET_NOT_FOUND" };
    if (entry.tenantId !== ref.tenantId) return { ok: false, error: "SECRET_OWNERSHIP_MISMATCH" };
    if (entry.provider !== ref.provider) return { ok: false, error: "SECRET_PROVIDER_MISMATCH" };
    return { ok: true, secret: { purpose: ref.purpose, material: entry.material } };
  }
}
