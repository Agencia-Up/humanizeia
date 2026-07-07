// ── SELEÇÃO/CURADORIA DE FOTOS (missão: até 5 fotos iniciais com diversidade, sem repetir lote) ──────────────────────
// Módulo PURO. Recebe os photoIds disponíveis de UM veículo (já resolvidos por vehicle_photos_resolve, ordenados
// principal-primeiro) + os que JÁ foram enviados, e devolve até `max` selecionados priorizando DIVERSIDADE visual.
//
// O pipeline de fotos do v3 só expõe IDs OPACOS (sem ângulo/categoria; a única pista de ordem é "principal-primeiro",
// aplicada no adapter). Sem metadado por-foto não dá para garantir "1 frente / 1 traseira / 2 interior / 1 painel"
// deterministicamente — então a heurística é CONSERVADORA: mantém a principal (índice 0) e ESPAÇA os índices restantes
// ao longo do array, evitando enviar 5 fotos quase idênticas em sequência. Se um dia o adapter passar a expor
// ângulo/categoria por foto, este módulo é o ponto ÚNICO para trocar a heurística por classificação real.

export const MAX_INITIAL_PHOTOS = 5;

export type PhotoSelectionReason =
  | "all_available"      // <= max fotos novas: envia todas
  | "capped_diverse"     // > max fotos novas (1º lote): recorta a 5 espaçadas
  | "next_batch"         // "manda mais": restante <= max, envia o restante
  | "next_batch_capped"  // "manda mais": restante > max, recorta a 5 espaçadas
  | "exhausted";         // nada novo a enviar (tudo já foi enviado)

export type PhotoSelection = {
  readonly selectedPhotoIds: string[];
  readonly reason: PhotoSelectionReason;
};

// Escolhe `count` índices distribuídos uniformemente em [0, n-1], SEMPRE incluindo 0 (a foto principal) e n-1 (última),
// para maximizar a variedade visual. Determinístico. Dedup defensivo do arredondamento (pode devolver < count se dois
// índices colidirem — preferimos menos fotos distintas a fotos repetidas).
export function spaceIndices(n: number, count: number): number[] {
  if (n <= 0 || count <= 0) return [];
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  if (count === 1) return [0];
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    out.push(Math.round((k * (n - 1)) / (count - 1)));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function selectPhotos(args: {
  readonly availablePhotoIds: readonly string[];
  readonly alreadySentPhotoIds?: readonly string[];
  readonly max?: number;
}): PhotoSelection {
  const max = args.max ?? MAX_INITIAL_PHOTOS;
  const sent = new Set(args.alreadySentPhotoIds ?? []);
  // Preserva a ORDEM original (principal-primeiro) e remove os já enviados (não repete lote).
  const pool = args.availablePhotoIds.filter((id) => typeof id === "string" && id.length > 0 && !sent.has(id));
  const isNextBatch = sent.size > 0;
  if (pool.length === 0) return { selectedPhotoIds: [], reason: "exhausted" };
  if (max <= 0) return { selectedPhotoIds: [], reason: "exhausted" };
  if (pool.length <= max) {
    return { selectedPhotoIds: [...pool], reason: isNextBatch ? "next_batch" : "all_available" };
  }
  const picked = spaceIndices(pool.length, max).map((i) => pool[i]);
  return { selectedPhotoIds: picked, reason: isNextBatch ? "next_batch_capped" : "capped_diverse" };
}
