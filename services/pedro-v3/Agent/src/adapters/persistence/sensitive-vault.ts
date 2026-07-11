import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SensitiveSecretCandidate } from "../../domain/sensitive-data.ts";

export type SensitiveVaultRef = { readonly ref: string; readonly kind: "cpf" | "birth_date"; readonly last4: string | null };

export interface SensitiveVaultPort {
  store(input: {
    tenantId: string; conversationId: string; eventId: string;
    candidate: SensitiveSecretCandidate; index: number;
  }): Promise<SensitiveVaultRef>;
  resolve(input: { tenantId: string; conversationId: string; ref: string; kind: "cpf" | "birth_date" }): Promise<string | null>;
}

export type SupabaseSensitiveVaultOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly allowedHosts: readonly string[];
  readonly encryptionKey: Uint8Array;
  readonly keyVersion: string;
  readonly timeoutMs?: number;
};

const REF_RX = /^[a-f0-9]{64}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pgBytea(value: Uint8Array): string { return `\\x${Buffer.from(value).toString("hex")}`; }
function fromPgBytea(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("\\x") && /^[0-9a-f]+$/i.test(value.slice(2))) return Buffer.from(value.slice(2), "hex");
  try { return Buffer.from(value, "base64"); } catch { return null; }
}

export function decodeSensitiveVaultKey(value: string): Uint8Array {
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.byteLength !== 32) throw new Error("SENSITIVE_VAULT_KEY_INVALID");
  return key;
}

export class SupabaseSensitiveVault implements SensitiveVaultPort {
  readonly #base: string;
  readonly #key: Buffer;
  constructor(private readonly opts: SupabaseSensitiveVaultOptions) {
    const parsed = new URL(opts.url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("SENSITIVE_VAULT_URL_INVALID");
    if (!opts.allowedHosts.some((h) => h.toLowerCase() === parsed.hostname.toLowerCase())) throw new Error("SENSITIVE_VAULT_HOST_NOT_ALLOWED");
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(opts.keyVersion)) throw new Error("SENSITIVE_VAULT_KEY_VERSION_INVALID");
    if (opts.encryptionKey.byteLength !== 32) throw new Error("SENSITIVE_VAULT_KEY_INVALID");
    this.#base = `${parsed.origin}/rest/v1/v3_sensitive_vault`;
    this.#key = Buffer.from(opts.encryptionKey);
  }
  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.opts.serviceRoleKey, authorization: `Bearer ${this.opts.serviceRoleKey}`, "content-type": "application/json", ...extra };
  }
  #ref(tenantId: string, conversationId: string, eventId: string, index: number, kind: string): string {
    return createHash("sha256").update(`${tenantId}\0${conversationId}\0${eventId}\0${index}\0${kind}`, "utf8").digest("hex");
  }
  async store(input: { tenantId: string; conversationId: string; eventId: string; candidate: SensitiveSecretCandidate; index: number }): Promise<SensitiveVaultRef> {
    if (!UUID_RX.test(input.tenantId) || !input.conversationId || !input.eventId) throw new Error("SENSITIVE_VAULT_ID_INVALID");
    const ref = this.#ref(input.tenantId, input.conversationId, input.eventId, input.index, input.candidate.kind);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(`${input.tenantId}\0${input.conversationId}\0${ref}\0${input.candidate.kind}`, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(input.candidate.value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const body = {
      ref, tenant_id: input.tenantId, conversation_id: input.conversationId,
      kind: input.candidate.kind === "cpf" ? "cpf" : "secret",
      ciphertext: pgBytea(ciphertext), nonce: pgBytea(nonce), auth_tag: pgBytea(authTag),
      enc_alg: "AES-256-GCM", key_version: this.opts.keyVersion,
      last4: input.candidate.kind === "cpf" ? input.candidate.last4 : null,
    };
    const res = await fetch(`${this.#base}?on_conflict=ref`, {
      method: "POST", headers: this.#headers({ prefer: "resolution=ignore-duplicates,return=minimal" }),
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    if (!res.ok && res.status !== 409) throw new Error(`SENSITIVE_VAULT_STORE_HTTP_${res.status}`);
    return { ref, kind: input.candidate.kind, last4: input.candidate.last4 };
  }
  async resolve(input: { tenantId: string; conversationId: string; ref: string; kind: "cpf" | "birth_date" }): Promise<string | null> {
    if (!UUID_RX.test(input.tenantId) || !REF_RX.test(input.ref) || !input.conversationId) return null;
    const params = new URLSearchParams({
      tenant_id: `eq.${input.tenantId}`, conversation_id: `eq.${input.conversationId}`, ref: `eq.${input.ref}`,
      select: "ref,kind,ciphertext,nonce,auth_tag,enc_alg,key_version", limit: "1",
    });
    const res = await fetch(`${this.#base}?${params}`, { headers: this.#headers(), signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000) });
    if (!res.ok) throw new Error(`SENSITIVE_VAULT_FETCH_HTTP_${res.status}`);
    const rows = await res.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row || row.enc_alg !== "AES-256-GCM" || row.key_version !== this.opts.keyVersion) return null;
    const ciphertext = fromPgBytea(row.ciphertext), nonce = fromPgBytea(row.nonce), tag = fromPgBytea(row.auth_tag);
    if (!ciphertext || !nonce || !tag) return null;
    const decipher = createDecipheriv("aes-256-gcm", this.#key, nonce);
    decipher.setAAD(Buffer.from(`${input.tenantId}\0${input.conversationId}\0${input.ref}\0${input.kind}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
