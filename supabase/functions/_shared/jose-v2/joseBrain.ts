/**
 * joseBrain.ts — José Cabine de Comando / Bloco B (chat)
 *
 * O CÉREBRO conversável do José: loop de tool-use da Anthropic via o aiGateway
 * (mantém ledger/BYOK/fallback). É o MESMO cérebro nos dois transportes (painel e,
 * depois, WhatsApp). Busca dados REAIS pelas ferramentas (joseTools) antes de
 * responder -> nunca inventa número, e bate com os cards (anti-divergência).
 */

import { callAiGateway } from "./aiGateway.ts";
import { getJoseTools, executeJoseTool } from "./joseTools.ts";
import { isFeatureEnabled } from "./flags.ts";
import { JOSE_EXPERTISE } from "./joseExpertise.ts";

const SYSTEM = `Você é o José, gestor de tráfego de IA de uma concessionária/revenda de veículos. Você é um GESTOR DE VERDADE: analisa, cruza os dados e recomenda — não é um chatbot que só bate papo.

Como você pensa (hierarquia de VERDADE, nunca só a vitrine):
- Venda fechada > lead BOM (qualificado pelo Pedro no atendimento) > vitrine (CPM/CTR/CPL).
- "Custo por lead BOM" vale mais que "custo por lead" da Meta. Decida pela verdade.

Os DADOS REAIS da conta JÁ vêm prontos no bloco "DADOS REAIS DA CONTA" no FIM destas instruções — campanhas (gasto/verba/status), qualidade do lead por anúncio (Pedro), e a visão geral. Eles são a sua fonte; não precisa "buscar" nada.

REGRA DE OURO — RESPONDA DIRETO com os dados:
- Os números JÁ estão no bloco DADOS REAIS abaixo. É PROIBIDO dizer "vou verificar", "vou listar", "um momento" — está tudo aí, responda NA HORA com os números.
- Pra decidir o que pausar/escalar, CRUZE: campanha (gasto/verba) + qualidade do lead por anúncio (Pedro) + visão geral. Gasto alto e poucos leads BONS = candidato a pausar; custo por lead bom baixo = candidato a escalar.

Como responder:
- Português claro e direto, sem jargão. Valores em reais (R$). CONCISO — o gestor lê no celular.
- Termine SEMPRE com uma RECOMENDAÇÃO concreta + os números que a sustentam.
- Quando faltar dado (leads sem classificação), diga com honestidade. A atribuição por anúncio pode ser "por título" (aproximada) quando a conta usa o WhatsApp não-oficial — deixe claro, sem fingir precisão.`;

// Anexado ao system só quando a flag jose_acao está ligada (conta pode AGIR).
const ACTION_GUIDE = `

Você PODE propor ações (pausar/reativar campanha, subir/baixar a verba) — com disciplina:
- NUNCA proponha sem antes olhar os números: use listar_campanhas (pega o campaign_id e o gasto) e consultar_qualidade_por_anuncio (pra saber o que traz lead bom).
- Proponha só com um motivo claro e defensável. No campo 'motivo', explique em UMA frase com número (ex.: "gastou R$420 em 7 dias e só trouxe leads ruins").
- Você NÃO executa nada: o propor_acao cria uma PROPOSTA que o DONO autoriza (SIM/NÃO). Deixe isso explícito ("criei a proposta, é só você autorizar").
- Uma proposta por vez. Se o pedido for vago ("resolve aí"), pergunte qual campanha antes de propor.`;

export interface ChatTurnResult {
  ok: boolean;
  text: string;
  tool_calls: string[];
  cost_usd: number;
  session_id: string;
  error?: string;
  // Proposta de ação pendente (quando o José chamou propor_acao) — a UI mostra
  // os botões Autorizar/Cancelar pra fechar o gate via jose-approval-handler.
  proposal?: { approval_id: string; resumo: string; risco: string; action_type: string } | null;
}

export async function joseChatTurn(admin: any, opts: {
  user_id: string;
  ad_account_id?: string | null;
  session_id: string;
  canal: "painel" | "whatsapp";
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachmentBlocks?: any[]; // blocos multimodais (image/document) p/ o turno do usuário
}): Promise<ChatTurnResult> {
  const userContent = (opts.attachmentBlocks && opts.attachmentBlocks.length)
    ? [{ type: "text", text: opts.userMessage }, ...opts.attachmentBlocks]
    : opts.userMessage;
  const messages: any[] = [
    ...(opts.history || []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];
  const toolCalls: string[] = [];
  let totalCost = 0;
  let finalText = "";
  let proposal: ChatTurnResult["proposal"] = null;

  // Conta pode AGIR? (flag jose_acao). Só o propor_acao fica como FERRAMENTA — os dados
  // de LEITURA são injetados direto no prompt (abaixo), pra não depender de tool-calling
  // (o modelo estava narrando "vou listar" sem chamar nada de verdade).
  const canAct = await isFeatureEnabled(admin, opts.user_id, "jose_acao");
  const tools = getJoseTools(canAct).filter((t: any) => t.name === "propor_acao");

  // Pré-carrega os dados REAIS e injeta no system (best-effort; em paralelo). Assim o
  // José SEMPRE tem os números na frente e responde direto.
  let dados = "";
  try {
    const ctx = { ad_account_id: opts.ad_account_id ?? null };
    const [cabine, campanhas, qualidade] = await Promise.all([
      executeJoseTool(admin, opts.user_id, "consultar_cabine", { periodo: "last_7d" }, ctx).catch(() => null),
      executeJoseTool(admin, opts.user_id, "listar_campanhas", {}, ctx).catch(() => null),
      executeJoseTool(admin, opts.user_id, "consultar_qualidade_por_anuncio", {}, ctx).catch(() => null),
    ]);
    dados = `\n\n====== DADOS REAIS DA CONTA (últimos 7 dias) — use ESTES números, NUNCA diga "vou verificar/listar" ======\n`
      + `VISÃO GERAL DA CONTA: ${JSON.stringify(cabine)}\n`
      + `CAMPANHAS (gasto/verba/status): ${JSON.stringify(campanhas)}\n`
      + `QUALIDADE DO LEAD POR ANÚNCIO (classificado pelo Pedro): ${JSON.stringify(qualidade)}\n`
      + `====== FIM DOS DADOS ======`;
  } catch (_e) { /* sem dados: responde com o que tem */ }

  // Persona + (ação) + CÉREBRO DE DOMÍNIO (como um gestor de tráfego pensa) + dados reais.
  const system = (canAct ? SYSTEM + ACTION_GUIDE : SYSTEM) + "\n\n" + JOSE_EXPERTISE + dados;

  await persist(admin, opts, "user", opts.userMessage, null);

  // Loop curto: a leitura já está no prompt; só pode haver round-trip de propor_acao.
  for (let i = 0; i < 4; i++) {
    const r = await callAiGateway(admin, {
      user_id: opts.user_id,
      ad_account_id: opts.ad_account_id ?? null,
      capability: "llm",
      input: { system, messages, max_tokens: 1500, ...(tools.length ? { tools, tool_choice: { type: "auto" } } : {}) },
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
      try { out = await executeJoseTool(admin, opts.user_id, tu.name, tu.input || {}, { ad_account_id: opts.ad_account_id ?? null }); }
      catch (e) { out = { erro: String((e as any)?.message || e) }; }
      // Capturou uma proposta de ação? Guarda pra UI mostrar os botões (último vence).
      if (tu.name === "propor_acao" && out?.approval_id) {
        proposal = { approval_id: out.approval_id, resumo: out.resumo, risco: out.risco, action_type: out.action_type };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Não consegui montar a resposta. Pode reformular a pergunta?";
  await persist(admin, opts, "assistant", finalText, toolCalls);
  return { ok: true, text: finalText, tool_calls: toolCalls, cost_usd: totalCost, session_id: opts.session_id, proposal };
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
