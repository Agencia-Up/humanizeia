/**
 * joseBrain.ts — José Cabine de Comando / Bloco B (chat)
 *
 * O CÉREBRO conversável do José: loop de tool-use da Anthropic via o aiGateway
 * (mantém ledger/BYOK/fallback). É o MESMO cérebro nos dois transportes (painel e,
 * depois, WhatsApp). Busca dados REAIS pelas ferramentas (joseTools) antes de
 * responder -> nunca inventa número, e bate com os cards (anti-divergência).
 */

import { callAiGateway } from "./aiGateway.ts";
import { JOSE_TOOLS, executeJoseTool } from "./joseTools.ts";

const SYSTEM = `Você é o José, gestor de tráfego de IA de uma concessionária/revenda de veículos.

Como você pensa (hierarquia de VERDADE, nunca só a vitrine):
- Venda fechada > lead BOM (qualificado pelo Pedro no atendimento) > vitrine (CPM/CTR/CPL).
- "Custo por lead BOM" vale mais que "custo por lead" da Meta. Decida pela verdade.

Regras:
- SEMPRE use as ferramentas pra buscar o dado REAL antes de afirmar qualquer número. Nunca invente.
- Responda em português claro e direto, sem jargão. Valores em reais (R$).
- Seja CONCISO — o gestor lê no celular. Vá ao ponto, no máximo uns 4-6 períodos.
- Quando faltar dado (ex.: leads ainda sem classificação), diga isso com honestidade.
- A atribuição por anúncio pode vir "por título" (aproximada) quando a conta usa o WhatsApp
  não-oficial; deixe claro quando for o caso, sem fingir precisão que não tem.`;

export interface ChatTurnResult {
  ok: boolean;
  text: string;
  tool_calls: string[];
  cost_usd: number;
  session_id: string;
  error?: string;
}

export async function joseChatTurn(admin: any, opts: {
  user_id: string;
  ad_account_id?: string | null;
  session_id: string;
  canal: "painel" | "whatsapp";
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<ChatTurnResult> {
  const messages: any[] = [
    ...(opts.history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.userMessage },
  ];
  const toolCalls: string[] = [];
  let totalCost = 0;
  let finalText = "";

  await persist(admin, opts, "user", opts.userMessage, null);

  // Até 6 round-trips de ferramenta por turno (trava de segurança contra loop).
  for (let i = 0; i < 6; i++) {
    const r = await callAiGateway(admin, {
      user_id: opts.user_id,
      ad_account_id: opts.ad_account_id ?? null,
      capability: "llm",
      input: { system: SYSTEM, messages, max_tokens: 1500, tools: JOSE_TOOLS },
      ref_tipo: "chat",
      ref_id: opts.session_id,
    });
    totalCost += r.cost_usd || 0;

    if (!r.ok) {
      finalText = "Tive um problema pra pensar agora. Tenta de novo em instantes?";
      await persist(admin, opts, "assistant", finalText, toolCalls);
      return { ok: false, text: finalText, tool_calls: toolCalls, cost_usd: totalCost, session_id: opts.session_id, error: r.error };
    }

    const content = (r.content && r.content.length) ? r.content : (r.text ? [{ type: "text", text: r.text }] : []);
    messages.push({ role: "assistant", content });

    const toolUse = (r.tool_use || []).filter((b: any) => b?.type === "tool_use");
    if (toolUse.length === 0 || r.stop_reason !== "tool_use") {
      finalText = r.text || "";
      break;
    }

    const results: any[] = [];
    for (const tu of toolUse) {
      toolCalls.push(tu.name);
      let out: any;
      try { out = await executeJoseTool(admin, opts.user_id, tu.name, tu.input || {}); }
      catch (e) { out = { erro: String((e as any)?.message || e) }; }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Não consegui montar a resposta. Pode reformular a pergunta?";
  await persist(admin, opts, "assistant", finalText, toolCalls);
  return { ok: true, text: finalText, tool_calls: toolCalls, cost_usd: totalCost, session_id: opts.session_id };
}

async function persist(
  admin: any,
  opts: { user_id: string; session_id: string; canal: string },
  role: string,
  content: string,
  toolCalls: string[] | null,
) {
  try {
    await admin.from("jose_chat_messages").insert({
      user_id: opts.user_id,
      session_id: opts.session_id,
      canal: opts.canal,
      role,
      content,
      tool_calls: toolCalls && toolCalls.length ? toolCalls : null,
    });
  } catch (_e) { /* histórico best-effort, nunca quebra a resposta */ }
}
