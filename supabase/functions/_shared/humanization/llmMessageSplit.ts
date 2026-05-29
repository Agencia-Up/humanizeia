// =============================================================================
// LLM MESSAGE SPLIT — quebra "inteligente" de mensagens conversacionais
// =============================================================================
//
// Usa um modelo barato (gpt-4o-mini) APENAS para decidir ONDE cortar uma
// mensagem conversacional em pedacos naturais de WhatsApp, evitando cortes
// feios (ex: separar "Onix Hatch 1.4 ... MEC." de "2017").
//
// SEGURANCA (nunca quebra o agente):
//   - Mensagens curtas / indivisiveis: nem chama a LLM (usa heuristica e sai).
//   - Sem OPENAI_API_KEY, erro de rede, JSON invalido, partes demais, ou
//     QUALQUER alteracao de conteudo -> cai no splitter heuristico atual.
//   - Validacao anti-alteracao: o conteudo (sem espacos) dos pedacos tem que
//     ser IDENTICO ao original. A LLM so escolhe cortes; nunca reescreve.
//
// NAO afeta a lista de estoque: ela vai por outro caminho (typingOnly) e nunca
// passa por aqui.
// =============================================================================

import {
  splitMessageForHumanization,
  type SplitOptions,
} from "./messageSplit.ts";

/** Remove espacos e normaliza caixa pra comparar conteudo (ignora so o corte). */
function contentFingerprint(value: string): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

/**
 * Igual a splitMessageForHumanization, mas pede pra uma LLM barata escolher os
 * cortes naturais. Sempre cai no heuristico em qualquer duvida/falha.
 * Assincrona.
 */
export async function splitMessageForHumanizationLLM(
  text: string,
  opts?: SplitOptions,
): Promise<string[]> {
  const trimmed = (text ?? "").trim();
  const maxParts = opts?.maxParts ?? 3;

  // Heuristico primeiro: serve de baseline e de fallback.
  const heuristic = splitMessageForHumanization(trimmed, opts);

  // Curto/indivisivel -> nem gasta chamada de LLM.
  if (heuristic.length <= 1) return heuristic;

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return heuristic;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "Voce divide UMA mensagem de WhatsApp de um vendedor de carros em pedacos curtos e naturais, como um humano digitando em rajada.",
              "Responda SOMENTE com JSON no formato: { \"parts\": [\"...\", \"...\"] }.",
              `REGRAS RIGIDAS:`,
              `- No maximo ${maxParts} pedacos. Se nao for natural dividir, devolva 1 pedaco so.`,
              "- NUNCA altere, corrija, traduza, resuma ou acrescente QUALQUER palavra, emoji, numero ou pontuacao. Use EXATAMENTE o texto original; voce so escolhe onde cortar.",
              "- A juncao dos pedacos deve reproduzir o texto original (mesmas palavras, mesma ordem).",
              "- NUNCA separe o nome/versao de um veiculo do seu ano ou preco (ex.: 'Onix Hatch Activ 1.4 8V FLEX 5P MEC. 2017' fica TUDO junto).",
              "- NUNCA corte no meio de um numero, valor (R$), ano, quilometragem ou link/URL.",
              "- Prefira cortar entre frases ou perguntas completas.",
            ].join("\n"),
          },
          { role: "user", content: trimmed },
        ],
      }),
    });

    if (!res.ok) return heuristic;
    const data = await res.json();
    const content = String(data?.choices?.[0]?.message?.content || "{}");
    const parsed = JSON.parse(content);

    const parts = Array.isArray(parsed?.parts)
      ? parsed.parts.map((p: any) => String(p ?? "").trim()).filter((p: string) => p.length > 0)
      : [];

    // Guardas: tem que ter pedacos, respeitar o teto e NAO ter mudado o conteudo.
    if (parts.length === 0) return heuristic;
    if (parts.length > maxParts) return heuristic;
    if (contentFingerprint(parts.join(" ")) !== contentFingerprint(trimmed)) return heuristic;

    return parts;
  } catch (_error) {
    return heuristic;
  }
}
