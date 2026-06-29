// Sanitiza um erro de turno do v3 p/ gravar em v3_inbox.last_error (observabilidade F2.6L):
// nome + codigo + mensagem truncados, REDIGINDO segredos (chaves sk-, JWT eyJ, Bearer). Puro -> testavel.
export function sanitizeTurnError(error: unknown): string {
  const name = error instanceof Error && error.name ? error.name : "Error";
  const codeRaw = (error as { code?: unknown } | null | undefined)?.code;
  const code = typeof codeRaw === "string" && codeRaw.length > 0 ? `:${codeRaw}` : "";
  const rawMsg = error instanceof Error ? error.message : String(error ?? "");
  const redacted = String(rawMsg)
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/eyJ[A-Za-z0-9._-]{8,}/g, "jwt-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***");
  return `${name}${code}: ${redacted}`.slice(0, 300);
}
