// ============================================================================
// media-effect-grounding.ts
//
// Fronteira factual do efeito send_media. A LLM decide SE quer enviar mídia;
// este módulo valida apenas se a tool realmente resolveu fotos para a mesma
// vehicleKey e substitui argumentos opacos propostos pelo resultado factual.
// Não classifica intenção, não lê a mensagem do lead e não conduz conversa.
// ============================================================================
import type { ProposedEffectPlan, QueryResult, ResolvedPhoto } from "../domain/decision.ts";

export type MediaEffectGroundingResult =
  | { readonly ok: true; readonly effects: ProposedEffectPlan[] }
  | { readonly ok: false; readonly feedback: string };

type SuccessfulPhotoResult = Extract<QueryResult, { ok: true; tool: "vehicle_photos_resolve" }>;

function normalizedPhotoIds(value: readonly string[]): string[] {
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))];
}

function resolvedSnapshot(
  result: SuccessfulPhotoResult,
  photoIds: readonly string[],
): ResolvedPhoto[] | null | undefined {
  if (result.data.media == null) return undefined;
  const byId = new Map<string, ResolvedPhoto>();
  for (const item of result.data.media) {
    const id = item.id.trim();
    const url = item.url.trim();
    if (!id || !url || byId.has(id)) continue;
    byId.set(id, { id, url });
  }
  if (photoIds.some((id) => !byId.has(id))) return null;
  return photoIds.map((id) => byId.get(id)!);
}

export function groundProposedMediaEffects(
  effects: readonly ProposedEffectPlan[],
  facts: readonly QueryResult[],
): MediaEffectGroundingResult {
  const photoResults = facts.filter(
    (fact): fact is SuccessfulPhotoResult => fact.ok && fact.tool === "vehicle_photos_resolve",
  );

  const grounded: ProposedEffectPlan[] = [];
  for (const effect of effects) {
    if (effect.kind !== "send_media") {
      grounded.push(effect);
      continue;
    }

    const vehicleKey = effect.vehicleKey.trim();
    if (!vehicleKey) {
      return { ok: false, feedback: "O efeito send_media não possui uma vehicleKey válida." };
    }
    const result = [...photoResults].reverse().find(
      (candidate) => !candidate.data.ambiguous && candidate.data.vehicleKey === vehicleKey,
    );
    if (!result) {
      return {
        ok: false,
        feedback: `O efeito send_media para '${vehicleKey}' não possui um resultado bem-sucedido e inequívoco de vehicle_photos_resolve para a mesma chave neste turno.`,
      };
    }

    const photoIds = normalizedPhotoIds(result.data.photoIds);
    if (photoIds.length === 0) {
      return {
        ok: false,
        feedback: `vehicle_photos_resolve não retornou fotos para '${vehicleKey}', portanto send_media não é executável.`,
      };
    }
    const media = resolvedSnapshot(result, photoIds);
    if (media === null) {
      return {
        ok: false,
        feedback: `O snapshot de mídia resolvido para '${vehicleKey}' está incompleto e não corresponde aos photoIds retornados pela tool.`,
      };
    }

    const onSuccess = effect.onSuccess.map((mutation) => mutation.op === "mark_photos_sent"
      ? { ...mutation, vehicleKey, photoIds: [...photoIds] }
      : mutation);
    // Nunca preserve URLs propostas pela LLM. O snapshot, quando existe, deve
    // vir exclusivamente do resultado factual de vehicle_photos_resolve.
    const effectWithoutProposedMedia: typeof effect = { ...effect };
    delete effectWithoutProposedMedia.media;
    grounded.push({
      ...effectWithoutProposedMedia,
      vehicleKey,
      photoIds,
      ...(media ? { media } : {}),
      onSuccess,
    });
  }

  return { ok: true, effects: grounded };
}
