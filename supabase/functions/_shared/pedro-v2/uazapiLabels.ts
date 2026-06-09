// ============================================================================
// uazapiLabels — ETIQUETAS SDR no WhatsApp Business (via UAZAPI).
// ----------------------------------------------------------------------------
// Marca o chat do lead com a categoria SDR (🎯 Qualificado / 🧊 Pouco qualificado /
// 💤 Inativo) NO MOMENTO DA TRANSFERENCIA, pro vendedor abrir o WhatsApp e ver o chat
// ja etiquetado. So as 3 etiquetas SDR — nao mexe em outras (ex.: "Lead").
//
// Endpoints UAZAPI confirmados ao vivo (header token = api_key da instancia):
//   GET  /labels                                   -> lista [{ labelid, name, color, colorHex }]
//   POST /label/edit  { labelid, name, color }     -> cria (labelid novo) ou edita
//   POST /chat/labels { number, add_labelid }      -> aplica etiqueta no chat
//   POST /chat/labels { number, remove_labelid }   -> remove etiqueta do chat
//
// SEGURANCA: NUNCA bloqueia o atendimento — toda falha e logada e ignorada.
// Ligado por env PEDRO_FF_WA_LABELS='on' (default OFF). So funciona em numero Business.
// ============================================================================

import type { SdrCategoryKey } from "../transfer/leadSdrCategory.ts";

interface WaInstanceLite {
  api_url?: string | null;
  api_key_encrypted?: string | null;
  api_key?: string | null;
}

// Nome + cor (indice da paleta do WhatsApp) de cada etiqueta SDR. O nome e a CHAVE de
// busca (resolve por nome em /labels); a cor so vale na CRIACAO.
const SDR_LABELS: Record<SdrCategoryKey, { name: string; color: number }> = {
  qualificado:       { name: "🎯 Qualificado", color: 5 },   // verde-agua #56ccb4
  pouco_qualificado: { name: "🧊 Pouco qualificado", color: 18 }, // azul #9ba6ff
  inativo:           { name: "💤 Inativo", color: 16 },       // ambar #ffae04
};

function normalizeBaseUrl(raw?: string | null): string {
  const s = String(raw || "").trim().replace(/\/+$/, "");
  if (!s) return "";
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
}
function onlyDigits(v?: string | null): string {
  return String(v || "").replace(/\D+/g, "");
}
async function uaFetch(baseUrl: string, token: string, path: string, body?: any) {
  return await fetch(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", token, apikey: token },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Resolve (ou CRIA, se faltar) os labelids das 3 etiquetas SDR nesta instancia.
async function resolveSdrLabelIds(baseUrl: string, token: string): Promise<Record<SdrCategoryKey, string>> {
  const res = await uaFetch(baseUrl, token, "/labels");
  const list = res.ok ? await res.json().catch(() => []) : [];
  const arr = Array.isArray(list) ? list : [];
  const byName = new Map<string, string>(arr.map((l: any) => [String(l?.name || ""), String(l?.labelid ?? "")]));
  let maxId = 0;
  for (const l of arr) { const n = Number(l?.labelid); if (Number.isFinite(n) && n > maxId) maxId = n; }
  const ids = {} as Record<SdrCategoryKey, string>;
  for (const key of Object.keys(SDR_LABELS) as SdrCategoryKey[]) {
    const { name, color } = SDR_LABELS[key];
    let id = byName.get(name);
    if (!id) {
      maxId += 1;
      id = String(maxId);
      await uaFetch(baseUrl, token, "/label/edit", { labelid: id, name, color });
    }
    ids[key] = id;
  }
  return ids;
}

// Aplica a etiqueta SDR da `categoria` no chat e REMOVE as outras 2 (1 etiqueta SDR por chat).
// Nao mexe em etiquetas nao-SDR. Nao bloqueante; gated por PEDRO_FF_WA_LABELS='on'.
export async function setSdrLabelOnChat(
  instance: WaInstanceLite | null | undefined,
  leadNumber: string,
  categoria: SdrCategoryKey,
): Promise<void> {
  try {
    if ((globalThis as any)?.Deno?.env?.get?.("PEDRO_FF_WA_LABELS") !== "on") return;
    const baseUrl = normalizeBaseUrl(instance?.api_url);
    const token = instance?.api_key_encrypted || instance?.api_key || "";
    const number = onlyDigits(leadNumber);
    if (!baseUrl || !token || !number || !SDR_LABELS[categoria]) return;
    const ids = await resolveSdrLabelIds(baseUrl, token);
    const target = ids[categoria];
    if (!target) return;
    await uaFetch(baseUrl, token, "/chat/labels", { number, add_labelid: target });
    for (const key of Object.keys(ids) as SdrCategoryKey[]) {
      if (key !== categoria && ids[key] && ids[key] !== target) {
        await uaFetch(baseUrl, token, "/chat/labels", { number, remove_labelid: ids[key] });
      }
    }
    console.log(`[wa-labels] chat ${number} -> ${SDR_LABELS[categoria].name} (id ${target})`);
  } catch (e: any) {
    console.warn("[wa-labels] falha (nao bloqueante):", e?.message || e);
  }
}
