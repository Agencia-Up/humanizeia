import { describe, expect, it } from 'vitest';
import { deriveSellerContactMetric, sellerMemberScope } from './sellerContactMetric';

describe('sellerMemberScope', () => {
  it('resolve todas as linhas irmas do mesmo vendedor', () => {
    expect(sellerMemberScope([
      { memberIds: ['member-agent-a', 'member-agent-b'] },
      { memberIds: ['other'] },
    ], 'member-agent-b')).toEqual(['member-agent-a', 'member-agent-b']);
  });

  it('preserva o id quando o agrupamento ainda nao carregou', () => {
    expect(sellerMemberScope([], 'member-agent-a')).toEqual(['member-agent-a']);
  });
});

describe('deriveSellerContactMetric', () => {
  const confirmedAt = '2026-07-31T11:38:32.000Z';

  it('mede o primeiro contato factual depois do OK', () => {
    expect(deriveSellerContactMetric({
      confirmedAt,
      firstContactAt: '2026-07-31T11:38:45.000Z',
      sellerConnected: true,
    })).toEqual({ state: 'contacted', delayMs: 13_000 });
  });

  it('nao aceita mensagem anterior ao OK como contato desta transferencia', () => {
    expect(deriveSellerContactMetric({
      confirmedAt,
      firstContactAt: '2026-07-31T11:38:20.000Z',
      sellerConnected: true,
    }, Date.parse('2026-07-31T11:40:32.000Z'))).toEqual({
      state: 'awaiting_contact',
      delayMs: 120_000,
    });
  });

  it('distingue espera rastreavel de vendedor desconectado', () => {
    const nowMs = Date.parse('2026-07-31T11:40:32.000Z');
    expect(deriveSellerContactMetric({ confirmedAt, firstContactAt: null, sellerConnected: true }, nowMs).state)
      .toBe('awaiting_contact');
    expect(deriveSellerContactMetric({ confirmedAt, firstContactAt: null, sellerConnected: false }, nowMs).state)
      .toBe('seller_disconnected');
  });

  it('nao transforma dado ainda nao carregado em ausencia de contato', () => {
    expect(deriveSellerContactMetric({
      confirmedAt,
      firstContactAt: null,
      sellerConnected: null,
    }).state).toBe('checking');
  });
});
