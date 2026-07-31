export interface SellerMemberGroup {
  memberIds: string[];
}

export type SellerContactMetricState =
  | 'contacted'
  | 'awaiting_contact'
  | 'seller_disconnected'
  | 'checking';

export interface SellerContactMetricInput {
  confirmedAt: string;
  firstContactAt: string | null;
  sellerConnected: boolean | null;
}

export interface SellerContactMetric {
  state: SellerContactMetricState;
  delayMs: number;
}

/**
 * Um vendedor pode ter uma linha em ai_team_members por agente. Para qualquer
 * operacao vinculada ao WhatsApp dele, todos esses ids representam a mesma
 * pessoa e devem ser consultados juntos.
 */
export function sellerMemberScope(
  groups: SellerMemberGroup[],
  memberId: string,
): string[] {
  const group = groups.find(candidate => candidate.memberIds.includes(memberId));
  return group ? [...new Set(group.memberIds)] : [memberId];
}

/**
 * Transforma o fato calculado no banco em estado de apresentacao. A funcao nao
 * tenta inferir autoria pela timeline renderizada: firstContactAt ja precisa ser
 * uma mensagem do vendedor comprovada pela RPC.
 */
export function deriveSellerContactMetric(
  input: SellerContactMetricInput,
  nowMs = Date.now(),
): SellerContactMetric {
  const confirmedMs = new Date(input.confirmedAt).getTime();
  const firstContactMs = input.firstContactAt
    ? new Date(input.firstContactAt).getTime()
    : Number.NaN;

  if (Number.isFinite(firstContactMs) && firstContactMs >= confirmedMs) {
    return { state: 'contacted', delayMs: firstContactMs - confirmedMs };
  }

  const delayMs = Math.max(0, nowMs - confirmedMs);
  if (input.sellerConnected === true) return { state: 'awaiting_contact', delayMs };
  if (input.sellerConnected === false) return { state: 'seller_disconnected', delayMs };
  return { state: 'checking', delayMs };
}
