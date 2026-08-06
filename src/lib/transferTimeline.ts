export type TransferAttemptStatus = 'pending' | 'confirmed' | 'expired' | 'closed';

export interface TransferTimelineAttempt {
  id: string;
  status: TransferAttemptStatus;
  createdAt: string;
  confirmationTimeoutAt: string | null;
  confirmedAt: string | null;
  toMemberId: string | null;
  sellerName: string | null;
  transferReason: string | null;
  serverNow: string | null;
  clockOffsetMs: number;
}

export interface TransferTimelineRow {
  transfer_id?: string | null;
  transfer_status?: string | null;
  is_confirmed?: boolean | null;
  transfer_created_at?: string | null;
  confirmation_timeout_at?: string | null;
  confirmed_at?: string | null;
  to_member_id?: string | null;
  seller_name?: string | null;
  transfer_reason?: string | null;
  server_now?: string | null;
}

export function normalizeTransferStatus(
  status: string | null | undefined,
  isConfirmed: boolean | null | undefined,
): TransferAttemptStatus {
  if (isConfirmed === true || status === 'confirmed') return 'confirmed';
  if (status === 'pending') return 'pending';
  if (status === 'expired') return 'expired';
  return 'closed';
}

export function toTransferTimelineAttempt(row: TransferTimelineRow, clientNowMs = Date.now()): TransferTimelineAttempt | null {
  if (!row.transfer_id || !row.transfer_created_at) return null;
  return {
    id: row.transfer_id,
    status: normalizeTransferStatus(row.transfer_status, row.is_confirmed),
    createdAt: row.transfer_created_at,
    confirmationTimeoutAt: row.confirmation_timeout_at || null,
    confirmedAt: row.confirmed_at || null,
    toMemberId: row.to_member_id || null,
    sellerName: row.seller_name || null,
    transferReason: row.transfer_reason || null,
    serverNow: row.server_now || null,
    clockOffsetMs: serverClockOffsetMs(row.server_now, clientNowMs),
  };
}

export function serverClockOffsetMs(serverNow: string | null | undefined, clientNowMs: number): number {
  if (!serverNow) return 0;
  const serverMs = Date.parse(serverNow);
  return Number.isFinite(serverMs) ? serverMs - clientNowMs : 0;
}

export function transferCountdown(
  deadline: string | null | undefined,
  clientNowMs: number,
  clockOffsetMs = 0,
): { label: string; remainingMs: number; expired: boolean } | null {
  if (!deadline) return null;
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return null;

  const remainingMs = Math.max(0, deadlineMs - (clientNowMs + clockOffsetMs));
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const label = hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;

  return { label, remainingMs, expired: remainingMs <= 0 };
}

/**
 * Places each transfer immediately before the first message at/after it.
 * The last bucket is rendered after every message.
 */
export function bucketTransferAttempts(
  attempts: TransferTimelineAttempt[],
  messageTimes: string[],
): TransferTimelineAttempt[][] {
  const buckets = Array.from({ length: messageTimes.length + 1 }, () => [] as TransferTimelineAttempt[]);
  const parsedMessages = messageTimes.map((value) => Date.parse(value));
  const ordered = [...attempts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  for (const attempt of ordered) {
    const attemptMs = Date.parse(attempt.createdAt);
    let index = parsedMessages.findIndex((messageMs) => Number.isFinite(messageMs) && messageMs >= attemptMs);
    if (index < 0) index = messageTimes.length;
    buckets[index].push(attempt);
  }

  return buckets;
}
