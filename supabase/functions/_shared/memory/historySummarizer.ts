// =============================================================================
// HISTORY SUMMARIZER — IT-3.2 (memória do Pedro SDR)
// =============================================================================
//
// Resolve "Pedro esquece em conversas longas" do DIAGNOSTICO. Hoje o webhook
// trunca historico em 10 mensagens (linha 2208) — quando passa disso, perde
// contexto crítico do inicio.
//
// SOLUÇÃO HIERÁRQUICA:
//   - Buscar histórico expandido (N mensagens, ex: 30)
//   - Se total > KEEP_RAW (ex: 10): separar em [oldMessages, recentMessages]
//   - Sumarizar `oldMessages` via Claude Haiku (rápido + barato)
//   - Histórico final = [systemMsgComSumario, ...recentMessages]
//
// MODELO ESCOLHIDO: Claude Haiku é ideal (subsegundo, ~$0.0001/sumarização).
// Reusa o mesmo cascade `CLAUDE_HAIKU_MODEL_CANDIDATES` do extractEntities.
//
// USO (fonte canônica testável):
//   ```ts
//   import { splitForSummarization, summarizeOldMessages,
//            formatSummaryAsSystemMessage } from './historySummarizer';
//
//   const { oldMessages, recentMessages } = splitForSummarization(history, 10);
//   if (oldMessages.length > 0) {
//     const summary = await summarizeOldMessages(oldMessages, ANTHROPIC_KEY);
//     return [formatSummaryAsSystemMessage(summary, oldMessages.length), ...recentMessages];
//   }
//   return recentMessages;
//   ```
//
// IMPORTANTE: fonte canônica + testes vitest. O webhook
// `uazapi-webhook/index.ts` tem cópia INLINE — qualquer mudança aqui
// precisa ser refletida lá.
// =============================================================================

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: any;
};

/**
 * Separa o histórico em [antigas, recentes]. Mantém últimas `keepRecent`
 * cruas; o restante vai pra sumarização. NÃO sumariza por si — só separa.
 */
export function splitForSummarization(
  history: ChatMessage[],
  keepRecent = 10
): { oldMessages: ChatMessage[]; recentMessages: ChatMessage[] } {
  if (!Array.isArray(history) || history.length === 0) {
    return { oldMessages: [], recentMessages: [] };
  }
  if (history.length <= keepRecent) {
    return { oldMessages: [], recentMessages: [...history] };
  }
  const splitAt = history.length - keepRecent;
  return {
    oldMessages: history.slice(0, splitAt),
    recentMessages: history.slice(splitAt),
  };
}

/**
 * Constrói prompt pra sumarização. Retorna { systemPrompt, userMessage }.
 */
export function buildSummarizationPrompt(messages: ChatMessage[]): {
  systemPrompt: string;
  userMessage: string;
} {
  const transcript = messages
    .map((m) => {
      const role = m.role === "user" ? "Cliente" : "Pedro";
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${role}: ${content}`;
    })
    .join("\n");

  return {
    systemPrompt: `Você é um sumarizador de conversas de SDR de concessionária automotiva no WhatsApp. Resuma a conversa abaixo em até 8 bullets CURTOS, em português, preservando APENAS:
- Modelo de interesse mencionado (com configuração se houver)
- Forma de pagamento discutida (à vista / financiado / troca)
- Dados pessoais coletados (nome, telefone, cidade, acompanhante)
- Veículos apresentados pelo Pedro (modelo + ano + preço)
- Objeções declaradas pelo cliente
- Pedidos pendentes (cliente esperando foto, preço, etc.)
- Status final da conversa (transferido, fora do horário, esperando follow-up)

NÃO incluir: saudações, agradecimentos, frases de transição, opiniões. Só fatos úteis pro próximo turno.`,
    userMessage: `TRANSCRIÇÃO PARCIAL (${messages.length} mensagens mais antigas da conversa):\n\n${transcript}\n\nResuma em até 8 bullets, em português.`,
  };
}

/**
 * Formata o resumo como ChatMessage `system` pra inserir no array do LLM.
 */
export function formatSummaryAsSystemMessage(
  summary: string,
  oldCount: number
): ChatMessage {
  return {
    role: "system",
    content: `## RESUMO DAS ${oldCount} MENSAGENS ANTERIORES (turnos mais antigos da conversa)\n\n${summary}\n\n⚠️ Use este resumo como contexto. As mensagens mais recentes vêm logo a seguir cruas.`,
  };
}

/**
 * Chama Claude Haiku pra sumarizar `oldMessages`. Retorna string do resumo
 * ou string vazia em caso de falha (caller decide fallback).
 *
 * `fetchFn` injetável pra testes (default global fetch).
 */
export async function summarizeOldMessages(
  oldMessages: ChatMessage[],
  apiKey: string,
  modelCandidates: string[] = [
    "claude-haiku-4-5-20251001",
    "claude-haiku-4-5-20260101",
    "claude-3-5-haiku-20241022",
  ],
  fetchFn: typeof fetch = fetch
): Promise<string> {
  if (!Array.isArray(oldMessages) || oldMessages.length === 0) return "";
  if (!apiKey) return "";

  const { systemPrompt, userMessage } = buildSummarizationPrompt(oldMessages);

  for (const model of modelCandidates) {
    try {
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        if (res.status === 404 || err.includes("model")) continue;
        return "";
      }

      const data = await res.json();
      const text = data?.content?.[0]?.text || "";
      return text.trim();
    } catch {
      continue;
    }
  }
  return "";
}
