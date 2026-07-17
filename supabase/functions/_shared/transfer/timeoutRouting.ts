// Pure timeout-routing helpers. They resolve only the next recipient; they do
// not inspect or decide anything about the lead's commercial conversation.
import { sellerPhoneKey, uniqueSellersByPhone, type SellerLike } from "./phoneKey.ts";

export type TimeoutSeller = SellerLike & { id?: string; is_active?: boolean };
export type RecentTransfer = { to_member_id?: string | null; created_at?: string | null };

export function pickNextTimeoutSeller(
  sellers: readonly TimeoutSeller[],
  recentTransfers: readonly RecentTransfer[],
  excludeId?: string | null,
  excludePhoneKey?: string | null,
): TimeoutSeller | null {
  const active = uniqueSellersByPhone(sellers.filter((seller) => {
    const phoneKey = sellerPhoneKey(seller);
    return seller.is_active === true && Boolean(phoneKey)
      && seller.id !== excludeId
      && (!excludePhoneKey || phoneKey !== excludePhoneKey);
  }));
  if (active.length === 0) return null;

  const lastReceived = new Map<string, number>();
  for (const transfer of recentTransfers) {
    if (!transfer.to_member_id || lastReceived.has(transfer.to_member_id)) continue;
    const timestamp = Date.parse(String(transfer.created_at || ""));
    lastReceived.set(transfer.to_member_id, Number.isFinite(timestamp) ? timestamp : 0);
  }
  const neverReceived = active.filter((seller) => !lastReceived.has(String(seller.id || "")));
  if (neverReceived.length > 0) return neverReceived[0];
  return [...active].sort((a, b) =>
    (lastReceived.get(String(a.id || "")) || 0) - (lastReceived.get(String(b.id || "")) || 0)
  )[0] || null;
}
