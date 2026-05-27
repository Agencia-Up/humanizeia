// ============================================================================
// usePendingTransfers
// ----------------------------------------------------------------------------
// BUG-NOVO-04 da auditoria 27/05/2026.
//
// Após o fix do BUG-13 Opção A, manual-transfer NÃO seta assigned_to_id no
// lead até o vendedor confirmar com "Ok" via WhatsApp. Isso significa que
// existe uma janela (até 15min) onde:
//   - ai_crm_leads.assigned_to_id = null (banco)
//   - ai_lead_transfers tem row com is_confirmed=false (pending)
//
// Sem este hook, a UI mostraria o lead como "Sem vendedor" mesmo após o
// master clicar Transferir — confuso. Este hook carrega os transfers
// pending recentes e expõe um Map { lead_id → { to_member_id, member_name } }
// pra cada tela renderizar badge amarela "Aguardando confirmação (Vendedor X)".
//
// Usado por: PedroSDR.tsx (CRM Avançado), CrmAoVivo.tsx (TV), WhatsAppInbox.tsx
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PendingTransfer {
  transfer_id: string;
  lead_id: string;
  to_member_id: string;
  member_name: string;
  created_at: string;
  confirmation_timeout_at: string | null;
}

/**
 * Carrega transferências pendentes (is_confirmed=false, transfer_status='pending')
 * pros lead_ids passados. Re-executa quando lista de leads muda.
 *
 * Retorna Map de lead_id → último PendingTransfer (caso haja múltiplos no mesmo
 * lead — improvável, mas mantém o mais recente).
 */
export function usePendingTransfers(leadIds: string[] | undefined | null) {
  const [pendingMap, setPendingMap] = useState<Map<string, PendingTransfer>>(new Map());

  // Stable key pra deps do useEffect (evita refetch se ordem mudou mas IDs iguais)
  const idsKey = (leadIds || []).slice().sort().join(',');

  useEffect(() => {
    if (!leadIds || leadIds.length === 0) {
      setPendingMap(new Map());
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // 1. Buscar transfers pending — JOIN com ai_team_members pra ter member_name
        const { data, error } = await (supabase as any)
          .from('ai_lead_transfers')
          .select('id, lead_id, to_member_id, created_at, confirmation_timeout_at, member:ai_team_members!ai_lead_transfers_to_member_id_fkey(id, name)')
          .in('lead_id', leadIds)
          .eq('is_confirmed', false)
          .eq('transfer_status', 'pending')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[usePendingTransfers] erro:', error);
          return;
        }
        if (cancelled) return;

        // 2. Manter apenas o transfer mais recente por lead_id
        const map = new Map<string, PendingTransfer>();
        for (const row of (data || []) as any[]) {
          if (map.has(row.lead_id)) continue; // já tem mais recente (ORDER DESC)
          map.set(row.lead_id, {
            transfer_id: row.id,
            lead_id: row.lead_id,
            to_member_id: row.to_member_id,
            member_name: row.member?.name || 'Vendedor',
            created_at: row.created_at,
            confirmation_timeout_at: row.confirmation_timeout_at,
          });
        }
        setPendingMap(map);
      } catch (err) {
        console.warn('[usePendingTransfers] exception:', err);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return pendingMap;
}

/**
 * Helper: formata "há N min" pra mostrar no tooltip da badge
 */
export function formatPendingAge(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'agora';
  if (mins === 1) return 'há 1 minuto';
  if (mins < 60) return `há ${mins} minutos`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'há 1 hora';
  return `há ${hours} horas`;
}
