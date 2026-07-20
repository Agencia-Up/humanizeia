// Pure timeout-routing helpers. They resolve only the next recipient; they do
// not inspect or decide anything about the lead's commercial conversation.
import { sellerPhoneKey, uniqueSellersByPhone, type SellerLike } from "./phoneKey.ts";

export type TimeoutSeller = SellerLike & {
  id?: string;
  name?: string | null;
  is_active?: boolean;
  last_lead_received_at?: string | null;
};
export type RecentTransfer = { to_member_id?: string | null; created_at?: string | null };

// Escolhe o proximo vendedor pela MESMA fila do Painel ao Vivo e das demais
// rotas de transferencia (uazapi-webhook, manual-transfer): quem NUNCA recebeu
// (last_lead_received_at null) vai PRIMEIRO; senao, quem recebeu ha MAIS tempo.
//
// Antes esta funcao ordenava pelo historico de ai_lead_transfers, um sinal
// DIFERENTE do que o painel usa e que ja tinha divergido em producao (5 de 6
// vendedores da Icom fora de sincronia; o painel apontava um vendedor e o
// timeout escalava para outro). Pior: a reordenacao manual da fila que o gestor
// faz no painel grava SO o last_lead_received_at, entao era ignorada aqui.
// Agora os dois caminhos leem o mesmo campo. `recentTransfers` foi mantido na
// assinatura por compatibilidade, mas NAO decide mais a ordem.
export function pickNextTimeoutSeller(
  sellers: readonly TimeoutSeller[],
  _recentTransfers: readonly RecentTransfer[],
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

  const never = active.filter((seller) => !seller.last_lead_received_at);
  if (never.length > 0) return never[0];
  return [...active].sort((a, b) =>
    Date.parse(String(a.last_lead_received_at || "")) - Date.parse(String(b.last_lead_received_at || ""))
  )[0] || null;
}
