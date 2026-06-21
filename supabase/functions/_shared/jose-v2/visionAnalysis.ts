/**
 * visionAnalysis.ts — José v3.1 / Fase 3 (Criativo: análise de visão)
 *
 * Analisa um criativo (imagem) via gateway (capability 'vision', Claude multimodal):
 * objetos, texto na imagem, gancho/CTA, adequação ao nicho, qualidade. Devolve um
 * resumo estruturado e, se houver creative_id, enriquece a tabela creatives
 * (analise_visao, tags, origem, enriquecido_em).
 */

import { callAiGateway } from "./aiGateway.ts";

export interface AnaliseVisao {
  objetos?: string[];
  texto_na_imagem?: string;
  gancho?: string;
  cta?: string;
  adequacao_nicho?: number;   // 0-10
  qualidade?: number;         // 0-10
  nota_geral?: number;        // 0-10
  observacao?: string;
  tags?: string[];
}

async function downloadImageBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { base64: btoa(bin), mime };
  } catch (_e) { return null; }
}

function parseJsonLoose(text: string): any {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (_e) { return null; }
}

// Analisa uma imagem (por URL ou base64). nicho ajusta o critério de adequação.
export async function analyzeCreativeImage(
  admin: any,
  input: { user_id: string; nicho?: string; image_url?: string; image_base64?: string; mime?: string },
): Promise<{ ok: boolean; analise?: AnaliseVisao; error?: string }> {
  let base64 = input.image_base64, mime = input.mime || "image/jpeg";
  if (!base64 && input.image_url) {
    const dl = await downloadImageBase64(input.image_url);
    if (!dl) return { ok: false, error: "download_fail" };
    base64 = dl.base64; mime = dl.mime;
  }
  if (!base64) return { ok: false, error: "sem_imagem" };

  const nicho = input.nicho || "generico";
  const system = [
    "Você é o JOSÉ, diretor de criação de tráfego pago. Analise o CRIATIVO de anúncio na imagem para o nicho",
    `'${nicho}'. Responda APENAS um JSON com as chaves: objetos (array curto), texto_na_imagem (string),`,
    "gancho (string), cta (string), adequacao_nicho (0-10), qualidade (0-10), nota_geral (0-10),",
    "observacao (1-2 frases de melhoria), tags (array de 3-6 palavras). Seja objetivo, em português.",
  ].join(" ");

  try {
    const r = await callAiGateway(admin, {
      user_id: input.user_id, capability: "vision",
      input: {
        system, max_tokens: 700,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Analise este criativo e devolva o JSON pedido." },
            { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
          ],
        }],
      },
      ref_tipo: "creative_vision",
    });
    if (!r.ok || !r.text) return { ok: false, error: r.error || "vision_falhou" };
    const analise = (parseJsonLoose(r.text) || { observacao: r.text }) as AnaliseVisao;
    return { ok: true, analise };
  } catch (e) {
    return { ok: false, error: String((e as any)?.message || e) };
  }
}

// Enriquece a linha de creatives com a análise (se creative_id fornecido).
export async function enrichCreative(admin: any, creativeId: string, analise: AnaliseVisao, origem = "whatsapp") {
  try {
    await admin.from("creatives").update({
      analise_visao: analise,
      tags: Array.isArray(analise.tags) ? analise.tags : undefined,
      origem,
      enriquecido_em: new Date().toISOString(),
    }).eq("id", creativeId);
  } catch (_e) { /* ignore */ }
}

// Texto curto pra mandar de volta no WhatsApp.
export function formatAnaliseWhatsApp(a: AnaliseVisao): string {
  const linhas = [
    "🎨 *Análise do criativo (José)*",
    a.nota_geral != null ? `Nota geral: *${a.nota_geral}/10*` : "",
    a.gancho ? `Gancho: ${a.gancho}` : "",
    a.cta ? `CTA: ${a.cta}` : "",
    a.adequacao_nicho != null ? `Adequação ao nicho: ${a.adequacao_nicho}/10` : "",
    a.qualidade != null ? `Qualidade: ${a.qualidade}/10` : "",
    a.observacao ? `\n${a.observacao}` : "",
  ].filter(Boolean);
  return linhas.join("\n");
}
