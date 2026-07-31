export type ConversationMessageSource = string | null | undefined;

export type ConversationMessageLike = {
  readonly id: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly content: string | null;
  readonly message_type: string;
  readonly remote_message_id?: string | null;
  readonly created_at: string;
  readonly source?: ConversationMessageSource;
};

type MergeConversationMessagesOptions<T extends ConversationMessageLike> = {
  readonly hasRenderableMedia?: (message: T) => boolean;
  readonly mirrorWindowMs?: number;
};

function normalizedContent(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizedMediaKind(value: string): string | null {
  const kind = value.trim().toLowerCase();
  if (!kind || kind === 'text') return null;
  if (kind === 'ptt' || kind === 'voice') return 'audio';
  return kind;
}

function validTimestamp(value: string): number | null {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasSameRemoteMessageId<T extends ConversationMessageLike>(left: T, right: T): boolean {
  const leftRemoteId = left.remote_message_id?.trim();
  const rightRemoteId = right.remote_message_id?.trim();
  return Boolean(leftRemoteId && rightRemoteId && leftRemoteId === rightRemoteId);
}

function isHeuristicMirror<T extends ConversationMessageLike>(
  left: T,
  right: T,
  mirrorWindowMs: number,
): boolean {
  if (left.direction !== right.direction) return false;

  // Sem identificador estavel, so unimos espelhos vindos de fontes diferentes.
  // Duas mensagens iguais gravadas pela MESMA fonte continuam sendo duas falas
  // legitimas do cliente e nunca sao apagadas por heuristica temporal/textual.
  const leftSource = left.source?.trim();
  const rightSource = right.source?.trim();
  if (!leftSource || !rightSource || leftSource === rightSource) return false;

  const leftAt = validTimestamp(left.created_at);
  const rightAt = validTimestamp(right.created_at);
  if (leftAt == null || rightAt == null || Math.abs(leftAt - rightAt) > mirrorWindowMs) return false;

  const leftMedia = normalizedMediaKind(left.message_type);
  const rightMedia = normalizedMediaKind(right.message_type);
  if (leftMedia || rightMedia) {
    // Espelhos de midia podem carregar URLs distintas (.enc no webhook e URL
    // duravel no historico). Uma janela curta evita colapsar uma sequencia real
    // de duas fotos/ audios enviados pelo cliente.
    return leftMedia != null
      && leftMedia === rightMedia
      && Math.abs(leftAt - rightAt) <= Math.min(mirrorWindowMs, 15_000);
  }

  const leftText = normalizedContent(left.content);
  return leftText.length > 0 && leftText === normalizedContent(right.content);
}

/**
 * Consolida a mesma mensagem fisica replicada por pipelines distintos
 * (wa_inbox, v3_inbox, historico sincronizado) sem apagar repeticoes reais do
 * cliente. A identidade remota vence; a heuristica texto+tempo so opera entre
 * fontes diferentes.
 */
export function mergeConversationMessages<T extends ConversationMessageLike>(
  messages: readonly T[],
  options: MergeConversationMessagesOptions<T> = {},
): T[] {
  const mirrorWindowMs = options.mirrorWindowMs ?? 120_000;
  const merged: Array<{ message: T; sources: Set<string> }> = [];

  for (const message of messages) {
    const source = message.source?.trim() || null;
    let duplicateIndex = merged.findIndex((entry) => hasSameRemoteMessageId(entry.message, message));

    if (duplicateIndex === -1 && source) {
      // Um espelho de cada fonte pode participar de cada mensagem fisica. Isso
      // impede que duas falas legitimas e identicas do cliente sejam colapsadas
      // quando ambas aparecem nos mesmos dois pipelines. Entre os candidatos,
      // pareia com o timestamp mais proximo, nunca com o primeiro da janela.
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < merged.length; index += 1) {
        const entry = merged[index];
        if (entry.sources.has(source) || !isHeuristicMirror(entry.message, message, mirrorWindowMs)) continue;
        const leftAt = validTimestamp(entry.message.created_at);
        const rightAt = validTimestamp(message.created_at);
        const distance = leftAt == null || rightAt == null ? Number.POSITIVE_INFINITY : Math.abs(leftAt - rightAt);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          duplicateIndex = index;
        }
      }
    }

    if (duplicateIndex === -1) {
      merged.push({ message, sources: new Set(source ? [source] : []) });
      continue;
    }

    const entry = merged[duplicateIndex];
    if (source) entry.sources.add(source);
    if (options.hasRenderableMedia?.(message) && !options.hasRenderableMedia(entry.message)) {
      entry.message = { ...message, id: entry.message.id };
    }
  }

  return merged.map((entry) => entry.message).sort((left, right) => {
    const leftAt = validTimestamp(left.created_at) ?? 0;
    const rightAt = validTimestamp(right.created_at) ?? 0;
    return leftAt - rightAt;
  });
}
