// =============================================================================
// TEMPORÁRIO — DIAGNÓSTICO FASE 0 (atribuição CTWA / Click-to-WhatsApp).
//
// OBJETIVO: capturar, num payload REAL de lead vindo de anúncio, o caminho/nome
// EXATO dos campos de referral (ad_source_id, ctwa_clid, etc.) que o uazapi
// entrega. Hoje o parser (adContext_20260525.ts) "adivinha" ~10 caminhos e
// DESCARTA os IDs de máquina — precisamos confirmar a verdade antes da Fase 1.
//
// COMO FUNCIONA: imprime no console (prefixo [CTWA-DIAG]) o payload PODADO
// (strings longas truncadas, blobs binários/thumbnails omitidos) SOMENTE quando
// há marcador de anúncio/CTWA. Não toca em NENHUMA lógica do Pedro. Não lança.
//
// REMOVER após confirmar os campos (apagar este arquivo + a chamada no index.ts).
// =============================================================================

// Chaves cujo valor é blob binário/base64 grande — omitidas pra não estourar o log.
const OMIT_KEYS = new Set([
  "jpegThumbnail", "thumbnail", "thumbnailDirectPath", "jpegThumbnailBase64",
  "mediaKey", "fileSha256", "fileEncSha256", "fileEncSha256B64", "directPath",
  "streamingSidecar", "waveform", "buffer", "base64", "body64", "fileLength",
]);

// Marcadores específicos de anúncio/CTWA. NÃO incluímos sourceId/sourceUrl soltos
// (aparecem em preview de link comum) — só os que indicam clique em anúncio.
const AD_MARKER_KEYS = [
  "externalAdReply", "ctwaPayload", "ctwaClid", "conversionData",
  "entryPointConversionSource", "convertedFrom",
];

function truncate(value: string, max = 220): string {
  return value.length > max ? `${value.slice(0, max)}…(+${value.length - max} chars)` : value;
}

// Poda o payload preservando a ESTRUTURA de chaves (o que precisamos pra achar o
// referral), truncando strings e colapsando buffers numéricos/base64 gigantes.
function prune(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 14) return "…(depth-limit)";
  if (typeof value === "string") {
    if (value.length > 400 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return `[blob ~${value.length} chars]`;
    return truncate(value);
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > 40 && value.every((v) => typeof v === "number")) return `[${value.length} bytes]`;
    return value.slice(0, 25).map((v) => prune(v, depth + 1, seen));
  }
  const rec = value as Record<string, unknown>;
  if (seen.has(rec)) return "…(circular)";
  seen.add(rec);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = OMIT_KEYS.has(k) ? "[omitido]" : prune(v, depth + 1, seen);
  }
  return out;
}

function deepHasKey(value: unknown, keys: string[], depth = 0, seen = new WeakSet<object>()): boolean {
  if (!value || depth > 14) return false;
  if (Array.isArray(value)) return value.some((v) => deepHasKey(v, keys, depth + 1, seen));
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (seen.has(rec)) return false;
    seen.add(rec);
    for (const k of keys) if (k in rec && (rec as Record<string, unknown>)[k] != null) return true;
    return Object.values(rec).some((v) => deepHasKey(v, keys, depth + 1, seen));
  }
  return false;
}

/** Loga o payload podado SOMENTE se houver marcador de anúncio/CTWA. Nunca lança. */
export function logCtwaDiag(payload: unknown): void {
  try {
    if (!deepHasKey(payload, AD_MARKER_KEYS)) return;
    console.log("[CTWA-DIAG] " + JSON.stringify({
      at: new Date().toISOString(),
      markers: AD_MARKER_KEYS.filter((k) => deepHasKey(payload, [k])),
      payload: prune(payload),
    }));
  } catch (_e) {
    // diagnóstico NUNCA pode quebrar o webhook
  }
}
