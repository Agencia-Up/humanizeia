// =============================================================================
// MESSAGE SPLIT — IT-1.1 (humanização do Pedro SDR)
// =============================================================================
//
// Divide uma resposta longa do agente em até N mensagens curtas, pra parecer
// natural quando entregue via WhatsApp (humano escreve em rajadas, não em
// blocos de 5 linhas).
//
// HEURÍSTICAS:
//   - Texto curto (<= MIN_LENGTH) ou com 1 frase só → não divide.
//   - Quebra em pontuação forte SEGUIDA DE ESPAÇO ou em \n+
//     (evita quebrar "R$ 12.500,00" ou "site.com.br").
//   - Distribui as frases em até `maxParts` grupos, tentando balancear
//     pelo número de caracteres.
//   - Garante: cada parte tem pelo menos 1 frase completa não-vazia.
//   - Preserva pontuação ao final de cada parte.
//
// USO (fonte canônica pra testes vitest):
//   ```ts
//   import { splitMessageForHumanization } from './messageSplit';
//   const parts = splitMessageForHumanization(text, { maxParts: 3 });
//   ```
//
// IMPORTANTE: este arquivo é a FONTE CANÔNICA. O webhook
// `uazapi-webhook/index.ts` tem uma cópia INLINE da função
// `splitMessageForHumanization` na seção "Humanization helpers". Qualquer
// mudança aqui DEVE ser refletida lá manualmente (Supabase Edge Functions
// não importam cross-function).
// =============================================================================

export type SplitOptions = {
  /** Máximo de partes. Default 3. */
  maxParts?: number;
  /** Tamanho mínimo (chars) pra considerar splitting. Default 200. */
  minLength?: number;
};

const DEFAULT_OPTIONS: Required<SplitOptions> = {
  maxParts: 3,
  minLength: 200,
};

/**
 * Divide um texto em até N partes naturais. Sempre retorna >= 1 parte.
 * Se o texto for curto ou indivisível, retorna `[text]` sem mexer.
 */
export function splitMessageForHumanization(
  text: string,
  opts?: SplitOptions
): string[] {
  const { maxParts, minLength } = { ...DEFAULT_OPTIONS, ...opts };

  const trimmed = (text ?? "").trim();
  if (!trimmed) return [""];
  if (trimmed.length <= minLength) return [trimmed];

  // Tokeniza em frases preservando pontuação ao final.
  // Usa lookbehind: split em (pontuação forte + espaço) ou (newline+).
  // Pontuação dentro de "12.500,00" não bate porque exige espaço depois.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length <= 1) return [trimmed];

  // Distribui sentences em até maxParts grupos, balanceando por chars.
  const targetParts = Math.min(maxParts, sentences.length);
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
  const targetCharsPerPart = totalChars / targetParts;

  const parts: string[] = [];
  let currentBuf: string[] = [];
  let currentLen = 0;
  let partsFilled = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const remaining = sentences.length - i;
    const slotsLeft = targetParts - partsFilled;

    currentBuf.push(sentence);
    currentLen += sentence.length + 1; // +1 pra espaço

    const isLastSentence = i === sentences.length - 1;
    const isLastPart = partsFilled === targetParts - 1;
    const reachedTarget = currentLen >= targetCharsPerPart * 0.7;
    const mustFlushToReserveSlot = remaining <= slotsLeft - 1;

    if (
      isLastSentence ||
      (!isLastPart && (reachedTarget || mustFlushToReserveSlot))
    ) {
      parts.push(currentBuf.join(" ").trim());
      currentBuf = [];
      currentLen = 0;
      partsFilled++;
    }
  }

  // Sanity: se algo deu errado e produziu parte vazia, descarta
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  return cleaned.length > 0 ? cleaned : [trimmed];
}
