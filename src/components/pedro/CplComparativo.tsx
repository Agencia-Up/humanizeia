// ============================================================================
// CplComparativo — Custo por Lead do Tráfego Pago: REAL vs. META (Painel do Meta)
// ----------------------------------------------------------------------------
// Card compacto no Painel ao Vivo (DashboardTV), só master. SEGUE o filtro de
// período do painel (Hoje / Ontem / 7 dias / 30 dias / Personalizado):
//   REAL  = gasto ÷ leads de tráfego pago que CHEGARAM no Pedro no período.
//           "Chegou no Pedro" = TODOS os leads do Pedro (ai_crm_leads) no período
//           — é a MESMA conta do CRM Avançado (o agente de IA atendeu todos eles).
//           Usa o mesmo filtro de data do painel (arrived_at, senão created_at).
//   META  = gasto ÷ resultado que o Facebook/Meta MOSTRA (conversas/leads do anúncio).
//           Custo "de vitrine" do Meta; quase sempre menor que o real.
//
// Fonte: campaign_costs (spend + leads_meta + conversations_started) + ai_crm_leads.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function CplComparativo({
  userId,
  reloadKey,
  periodStart,
  periodEnd,
  periodLabel,
}: {
  userId?: string | null;
  reloadKey?: number;
  /** Início do período selecionado (ISO) — mesmo range do painel. */
  periodStart: string;
  /** Fim do período selecionado (ISO). */
  periodEnd: string;
  /** Rótulo do período (ex.: "Hoje", "Últimos 7 dias"). */
  periodLabel: string;
}) {
  const [spend, setSpend] = useState(0);
  const [meta, setMeta] = useState(0);
  const [leads, setLeads] = useState(0);

  useEffect(() => {
    if (!userId || !periodStart || !periodEnd) return;
    let cancelled = false;
    (async () => {
      try {
        const startKey = ymd(new Date(periodStart));
        const endKey = ymd(new Date(periodEnd));

        const [costRes, leadsRes] = await Promise.all([
          (supabase as any)
            .from('campaign_costs')
            .select('entity_level, spend, leads_meta, conversations_started, date')
            .eq('user_id', userId)
            .gte('date', startKey)
            .lte('date', endKey),
          // "Real" = TODOS os leads do Pedro (ai_crm_leads) no período: atendidos
          // pela IA, adicionados manual OU transferidos. MESMA conta do CRM Avançado
          // (sem filtrar assigned_to_id). Mesmo filtro de data do painel: arrived_at
          // quando informado, senão created_at.
          (supabase as any)
            .from('ai_crm_leads')
            .select('id')
            .eq('user_id', userId)
            .or(`and(arrived_at.gte.${periodStart},arrived_at.lte.${periodEnd}),and(arrived_at.is.null,created_at.gte.${periodStart},created_at.lte.${periodEnd})`),
        ]);

        const rows: any[] = Array.isArray(costRes?.data) ? costRes.data : [];
        // Escolhe o nível mais agregado disponível pra não somar duplicado.
        const level = rows.some(r => r.entity_level === 'campaign') ? 'campaign'
          : rows.some(r => r.entity_level === 'adset') ? 'adset' : 'ad';
        const lvl = rows.filter(r => r.entity_level === level);
        const metaOf = (r: any) => {
          // META = CONVERSAS iniciadas (o que o usuário escolheu = clique). Prefere
          // conversations_started; só cai pro leads_meta se NÃO houver conversa.
          const conv = Number(r.conversations_started) || 0;
          return conv > 0 ? conv : (Number(r.leads_meta) || 0);
        };
        const totalSpend = lvl.reduce((a, r) => a + (Number(r.spend) || 0), 0);
        const totalMeta = lvl.reduce((a, r) => a + metaOf(r), 0);

        const ls: any[] = Array.isArray(leadsRes?.data) ? leadsRes.data : [];

        if (!cancelled) {
          setSpend(totalSpend);
          setMeta(totalMeta);
          setLeads(ls.length);
        }
      } catch {
        if (!cancelled) { setSpend(0); setMeta(0); setLeads(0); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId, reloadKey, periodStart, periodEnd]);

  const v = useMemo(() => ({
    real: leads > 0 ? spend / leads : 0,
    metaCpl: meta > 0 ? spend / meta : 0,
  }), [spend, meta, leads]);

  return (
    <section className="shrink-0 px-8 pb-4">
      <div className="bg-slate-900/60 rounded-2xl border border-blue-900/40 p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">
            Custo por Lead · Tráfego Pago — Real vs. Meta
          </h3>
          <span className="text-[9px] text-slate-500">
            {periodLabel} · Real = chegou no Pedro (CRM Avançado) · Meta = o que o Facebook mostra
          </span>
        </div>
        <div className="grid grid-cols-2 portrait:grid-cols-1 gap-3">
          {/* REAL */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">Real (chegou no Pedro)</span>
            </div>
            <p className="text-[clamp(1.4rem,3.4vmin,2.2rem)] font-black tabular-nums leading-none text-emerald-300">{leads > 0 ? brl(v.real) : '—'}</p>
            <p className="text-[10px] text-slate-400 mt-1.5">{periodLabel} · {leads} leads</p>
          </div>
          {/* META / PAINEL DO META ADS */}
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-orange-400">Painel do Meta Ads</span>
            </div>
            <p className="text-[clamp(1.4rem,3.4vmin,2.2rem)] font-black tabular-nums leading-none text-orange-300">{meta > 0 ? brl(v.metaCpl) : '—'}</p>
            <p className="text-[10px] text-slate-400 mt-1.5">{periodLabel} · {meta} no Meta</p>
          </div>
        </div>
      </div>
    </section>
  );
}
