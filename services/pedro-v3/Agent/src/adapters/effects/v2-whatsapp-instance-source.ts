import type { ResolveSecretResult, SecretRef } from "../../domain/credential-provider.ts";
import type { TenantAgentRef } from "../../domain/read-ports.ts";
import { assertTenantAgentRef } from "../read/v2-read-gateway.ts";
import type { SecretDecryptor, V2ReadDatabase, V2ColumnName } from "../read/supabase-v2-read-adapter.ts";
import type { WhatsAppInstanceConfig, WhatsAppInstanceSource } from "./pilot-whatsapp-runtime.ts";

const INSTANCE_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "instance_name",
  "api_url",
  "provider",
] satisfies readonly V2ColumnName[]);

// wa_instances tem `api_key_encrypted` mas NAO tem coluna `api_key` (F2.6Q): selecionar `api_key`
// gerava `select=...,api_key` -> PostgREST 400 (coluna inexistente) -> o gateway de leitura lancava ->
// `sender_text_exception` no dispatch (nunca rodou contra PostgREST real; o fake de teste nao valida
// existencia de coluna). O token mora em `api_key_encrypted` (cru ou JSON), extraido pelo decryptor.
const INSTANCE_SECRET_COLUMNS = Object.freeze([
  "id",
  "user_id",
  "provider",
  "api_key_encrypted",
] satisfies readonly V2ColumnName[]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeProvider(value: unknown): "uazapi" | "unsupported" {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "" || raw === "uazapi") return "uazapi";
  return "unsupported";
}

function tokenRefFor(ref: TenantAgentRef, instanceId: string): SecretRef {
  return Object.freeze({
    tenantId: ref.tenantId,
    integrationId: instanceId,
    provider: "uazapi",
    purpose: "whatsapp_instance",
  });
}

export class V2WhatsAppInstanceSource implements WhatsAppInstanceSource {
  constructor(private readonly db: V2ReadDatabase) {}

  async loadOwnedInstance(ref: TenantAgentRef, instanceId: string): Promise<WhatsAppInstanceConfig | null> {
    assertTenantAgentRef(ref);
    if (typeof instanceId !== "string" || instanceId.trim() === "") return null;
    const row = await this.db.selectOne("wa_instances", INSTANCE_COLUMNS, {
      id: instanceId,
      user_id: ref.tenantId,
    });
    if (!row) return null;

    const id = asString(row.id);
    const tenantId = asString(row.user_id);
    const apiUrl = asString(row.api_url);
    if (id !== instanceId || tenantId !== ref.tenantId || !apiUrl) return null;

    const provider = normalizeProvider(row.provider);
    if (provider !== "uazapi") {
      return {
        tenantId,
        instanceId: id,
        provider: "unsupported",
        apiUrl,
        instanceName: asString(row.instance_name),
        tokenRef: tokenRefFor(ref, id),
      };
    }

    return {
      tenantId,
      instanceId: id,
      provider: "uazapi",
      apiUrl,
      instanceName: asString(row.instance_name),
      tokenRef: tokenRefFor(ref, id),
    };
  }
}

export class V2WhatsAppInstanceCredentialProvider {
  constructor(
    private readonly db: V2ReadDatabase,
    private readonly decryptor: SecretDecryptor,
  ) {}

  async resolve(ref: SecretRef): Promise<ResolveSecretResult> {
    if (ref.provider !== "uazapi" || ref.purpose !== "whatsapp_instance") {
      return { ok: false, error: "SECRET_PROVIDER_MISMATCH" };
    }
    const row = await this.db.selectOne("wa_instances", INSTANCE_SECRET_COLUMNS, {
      id: ref.integrationId,
      user_id: ref.tenantId,
    });
    if (!row) return { ok: false, error: "SECRET_NOT_FOUND" };

    const tenantId = asString(row.user_id);
    if (tenantId !== ref.tenantId) return { ok: false, error: "SECRET_OWNERSHIP_MISMATCH" };

    const provider = normalizeProvider(row.provider);
    if (provider !== "uazapi") return { ok: false, error: "SECRET_PROVIDER_MISMATCH" };

    const encrypted = asString(row.api_key_encrypted) ?? asString(row.api_key);
    if (!encrypted) return { ok: false, error: "SECRET_NOT_FOUND" };

    const material = await this.decryptor.decryptApiKey(encrypted, {
      tenantId: ref.tenantId,
      integrationId: ref.integrationId,
      provider: "uazapi",
    });
    if (!material) return { ok: false, error: "SECRET_NOT_FOUND" };
    return { ok: true, secret: { purpose: "whatsapp_instance", material } };
  }
}
