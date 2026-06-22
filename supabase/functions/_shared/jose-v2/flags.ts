/**
 * flags.ts — José v3.1 / Fase 0
 *
 * Checa jose_feature_flags antes de QUALQUER capability. Linha do tenant vence a
 * global; sem linha = DESLIGADO (nada liga sem flag). rollout_pct faz canário
 * determinístico por user_id (o mesmo usuário cai sempre do mesmo lado).
 *
 * USO: if (!(await isFeatureEnabled(admin, userId, 'voz'))) return;
 */

export type JoseFeature =
  | "voz" | "criativo_whatsapp" | "criacao_campanha"
  | "google_ads" | "otimizacao_proativa" | "reasoning_core"
  | "handoff_qualidade" | "cabine_cards" | "jose_chat" | "jose_acao";

// hash determinístico (FNV-1a) -> 0..99. Mesmo user/feature => mesmo bucket.
function bucketOf(userId: string, feature: string): number {
  let h = 0x811c9dc5;
  const s = `${userId}:${feature}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export async function isFeatureEnabled(
  admin: any,
  userId: string | null | undefined,
  feature: JoseFeature,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from("jose_feature_flags")
      .select("user_id, habilitado, rollout_pct")
      .eq("feature", feature)
      .or(`user_id.is.null${userId ? `,user_id.eq.${userId}` : ""}`);
    const rows = (data || []) as any[];
    // tenant vence global
    const row = rows.sort((a, b) => Number(Boolean(b.user_id)) - Number(Boolean(a.user_id)))[0];
    if (!row || !row.habilitado) return false;
    const pct = Number.isFinite(row.rollout_pct) ? row.rollout_pct : 100;
    if (pct >= 100) return true;
    if (pct <= 0) return false;
    if (!userId) return true; // sem user p/ canário: respeita só o habilitado
    return bucketOf(userId, feature) < pct;
  } catch (_e) {
    return false; // em erro, NÃO liga (fail-safe)
  }
}
