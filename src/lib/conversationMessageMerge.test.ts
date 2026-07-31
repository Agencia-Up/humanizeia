import { describe, expect, it } from 'vitest';
import { mergeConversationMessages, type ConversationMessageLike } from './conversationMessageMerge';

type Message = ConversationMessageLike & { readonly media_url?: string | null };

const at = (seconds: number) => `2026-07-31T18:49:${String(seconds).padStart(2, '0')}.000Z`;
const message = (overrides: Partial<Message> & Pick<Message, 'id'>): Message => ({
  id: overrides.id,
  direction: 'incoming',
  content: 'Qual a quilometragem?',
  message_type: 'text',
  remote_message_id: null,
  created_at: at(38),
  source: 'v3',
  media_url: null,
  ...overrides,
});

describe('mergeConversationMessages', () => {
  it('une o mesmo texto espelhado por wa_inbox e v3_inbox', () => {
    const rows = mergeConversationMessages([
      message({ id: 'v3', source: 'v3', created_at: at(38) }),
      message({ id: 'wa', source: 'inbox', created_at: at(40) }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['v3']);
  });

  it('preserva duas falas iguais gravadas pela mesma fonte', () => {
    const rows = mergeConversationMessages([
      message({ id: 'one', source: 'inbox', created_at: at(38) }),
      message({ id: 'two', source: 'inbox', created_at: at(40) }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('preserva duas falas identicas reais mesmo quando ambas foram espelhadas', () => {
    const rows = mergeConversationMessages([
      message({ id: 'v3-one', source: 'v3', created_at: at(10) }),
      message({ id: 'inbox-one', source: 'inbox', created_at: at(12) }),
      message({ id: 'v3-two', source: 'v3', created_at: at(30) }),
      message({ id: 'inbox-two', source: 'inbox', created_at: at(32) }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['v3-one', 'v3-two']);
  });

  it('deduplica por remote_message_id mesmo dentro da mesma fonte', () => {
    const rows = mergeConversationMessages([
      message({ id: 'one', source: 'inbox', remote_message_id: 'wamid.1' }),
      message({ id: 'two', source: 'inbox', remote_message_id: 'wamid.1', created_at: at(40) }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('mantem a copia de midia renderizavel', () => {
    const rows = mergeConversationMessages([
      message({ id: 'enc', source: 'inbox', message_type: 'ptt', content: '', media_url: null }),
      message({ id: 'audio', source: 'chat', message_type: 'audio', content: '', media_url: 'https://storage/audio.ogg', created_at: at(40) }),
    ], { hasRenderableMedia: (row) => Boolean(row.media_url) });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('enc');
    expect(rows[0]?.media_url).toBe('https://storage/audio.ogg');
  });

  it('nao une direcoes diferentes nem eventos fora da janela', () => {
    const rows = mergeConversationMessages([
      message({ id: 'incoming' }),
      message({ id: 'outgoing', source: 'inbox', direction: 'outgoing', created_at: at(40) }),
      message({ id: 'late', source: 'inbox', created_at: '2026-07-31T18:52:00.000Z' }),
    ]);
    expect(rows).toHaveLength(3);
  });
});
