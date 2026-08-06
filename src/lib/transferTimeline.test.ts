import { describe, expect, it } from 'vitest';

import {
  bucketTransferAttempts,
  normalizeTransferStatus,
  serverClockOffsetMs,
  toTransferTimelineAttempt,
  transferCountdown,
  type TransferTimelineAttempt,
} from './transferTimeline';

describe('transfer timeline', () => {
  it('treats is_confirmed as authoritative even with a stale textual status', () => {
    expect(normalizeTransferStatus('pending', true)).toBe('confirmed');
  });

  it('preserves pending, expired and closed states', () => {
    expect(normalizeTransferStatus('pending', false)).toBe('pending');
    expect(normalizeTransferStatus('expired', false)).toBe('expired');
    expect(normalizeTransferStatus('cancelled', false)).toBe('closed');
  });

  it('normalizes the RPC row without inventing a deadline', () => {
    expect(toTransferTimelineAttempt({
      transfer_id: 't1',
      transfer_status: 'pending',
      is_confirmed: false,
      transfer_created_at: '2026-08-05T20:00:00.000Z',
      confirmation_timeout_at: null,
      seller_name: 'Luiz Otavio',
    })).toMatchObject({
      id: 't1',
      status: 'pending',
      confirmationTimeoutAt: null,
      sellerName: 'Luiz Otavio',
    });
  });

  it('formats the live countdown as requested', () => {
    expect(transferCountdown('2026-08-05T20:09:59.000Z', Date.parse('2026-08-05T20:00:00.000Z'))).toEqual({
      label: '9:59',
      remainingMs: 599_000,
      expired: false,
    });
  });

  it('supports deadlines longer than one hour and clamps elapsed deadlines', () => {
    expect(transferCountdown('2026-08-05T21:02:03.000Z', Date.parse('2026-08-05T20:00:00.000Z'))?.label).toBe('1:02:03');
    expect(transferCountdown('2026-08-05T19:59:00.000Z', Date.parse('2026-08-05T20:00:00.000Z'))).toEqual({
      label: '0:00',
      remainingMs: 0,
      expired: true,
    });
  });

  it('uses the server clock as authority instead of trusting client skew', () => {
    const clientNow = Date.parse('2026-08-05T19:55:00.000Z');
    const offset = serverClockOffsetMs('2026-08-05T20:00:00.000Z', clientNow);
    expect(transferCountdown('2026-08-05T20:10:00.000Z', clientNow, offset)?.label).toBe('10:00');
  });

  it('places retries chronologically between the surrounding messages', () => {
    const attempt = (id: string, createdAt: string): TransferTimelineAttempt => ({
      id,
      status: 'pending',
      createdAt,
      confirmationTimeoutAt: null,
      confirmedAt: null,
      toMemberId: null,
      sellerName: null,
      transferReason: null,
      serverNow: null,
      clockOffsetMs: 0,
    });
    const buckets = bucketTransferAttempts([
      attempt('second', '2026-08-05T20:20:00.000Z'),
      attempt('first', '2026-08-05T20:05:00.000Z'),
    ], [
      '2026-08-05T20:00:00.000Z',
      '2026-08-05T20:10:00.000Z',
    ]);

    expect(buckets[1].map((item) => item.id)).toEqual(['first']);
    expect(buckets[2].map((item) => item.id)).toEqual(['second']);
  });
});
