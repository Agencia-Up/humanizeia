// =============================================================================
// BASE DE CONHECIMENTO (RAG) do Pedro v2 — OPCIONAL, enriquece o agente com a
// informação da LOJA que o cliente cadastrar (garantia, financiamento, documentação,
// regras de troca, diferenciais, FAQ) — exatamente a info que hoje o agente não sabe
// e às vezes inventa.
// -----------------------------------------------------------------------------
// CONDICIONAL: só embeda/busca quando o agente TEM base ligada (agent_knowledge_bases).
// Agente SEM base -> retorna "" após 1 query barata, custo de IA ZERO. Replica o padrão
// do uazapi-webhook (RPC `search_knowledge`, threshold 0.60, top 5). NUNCA derruba o
// turno: todo o corpo em try/catch; em qualquer falha segue SEM contexto.
// =============================================================================
import { logAiCall } from "../observability/aiCallLog.ts";

export async function fetchPedroKnowledgeContext(
  supabase: any,
  opts: {
    agentId: string;
    userId: string;
    agentName?: string | null;
    queryText: string;
    openaiKey?: string | null;
    auditable?: boolean; // false em dry-run -> não polui ai_call_log
  },
): Promise<string> {
  try {
    const q = String(opts?.queryText || "").trim();
    if (!q || !opts?.agentId || !opts?.openaiKey) return "";

    // 1) O agente tem base ligada? (query barata; se não tem, para aqui — custo de IA ZERO)
    const { data: agentKbs } = await supabase
      .from("agent_knowledge_bases").select("kb_id").eq("agent_id", opts.agentId);
    const kbIds = (agentKbs || []).map((k: any) => k?.kb_id).filter(Boolean);
    if (kbIds.length === 0) return "";

    // 2) Embedding da pergunta do lead (text-embedding-3-small).
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q.slice(0, 8000) }),
    });
    if (!embedRes.ok) return "";
    const embedData = await embedRes.json();
    if (opts.auditable !== false) {
      await logAiCall(supabase, {
        userId: opts.userId,
        disparoTipo: "embedding",
        provedor: "openai",
        modelo: "text-embedding-3-small",
        inputTokens: Number(embedData?.usage?.prompt_tokens) || 0,
        outputTokens: 0,
        nSubcalls: 1,
        agentId: opts.agentId ?? null,
        agentName: opts.agentName ?? null,
      });
    }
    const emb = embedData?.data?.[0]?.embedding;
    if (!Array.isArray(emb)) return "";

    // 3) Busca semântica nos chunks da(s) base(s) do agente.
    const { data: chunks } = await supabase.rpc("search_knowledge", {
      query_embedding: emb, kb_ids: kbIds, match_threshold: 0.60, match_count: 5,
    });
    if (Array.isArray(chunks) && chunks.length > 0) {
      return chunks.map((c: any) => c?.content).filter(Boolean).join("\n\n---\n\n");
    }
    return "";
  } catch (_e) {
    return ""; // RAG é opcional: nunca derruba o turno
  }
}
