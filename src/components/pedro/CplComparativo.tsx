// ============================================================================
// CplComparativo — Custo por Lead do Tráfego Pago: REAL vs. FALSO (Meta)
// ----------------------------------------------------------------------------
// Card compacto no Painel ao Vivo (DashboardTV), só master. Compara, pra HOJE
// e ÚLTIMOS 7 DIAS:
//   REAL  = gasto ÷ leads de tráfego pago que CHEGARAM no Pedro (custo de verdade).
//           Tráfego pago = leads do Pedro (ai_crm_leads) atribuídos a vendedor —
//           alimentado pelo SDR + transferências manuais + leads adicionados no Pedro.
//   FALSO = gasto ÷ resultado que o Facebook/Meta MOSTRA (conversas/leads do anúncio).
//           É o custo "de vitrine" do Meta; quase sempre menor que o real.
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

interface Win { spend: number; meta: number; }
const ZERO: Win = { spend: 0, meta: 0 };

export function CplComparativo({ userId }: { userId?: string | null }) {
  const [cost, setCost] = useState<{ today: Win; week: Win }>({ today: ZERO, week: ZERO });
  const [leads, setLeads] = useState<{ today: number; week: number }>({ today: 0, week: 0 });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
        const todayYMD = ymd(now);
        const weekISO = weekStart.toISOString();

        const [costRes, leadsRes] = await Promise.all([
          (supabase as any)
            .from('campaign_costs')
            .select('entity_level, spend, leads_meta, conversations_started, date')
            .eq('user_id', userId)
            .gte('date', ymd(weekStart)),
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, arrived_at, created_at, assigned_to_id')
            .eq('user_id', userId)
            .not('assigned_to_id', 'is', null)
            .or(`arrived_at.gte.${weekISO},and(arrived_at.is.null,created_at.gte.${weekISO})`),
        ]);

        const rows: any[] = Array.isArray(costRes?.data) ? costRes.data : [];
        const level = rows.some(r => r.entity_level === 'campaign') ? 'campaign'
          : rows.some(r => r.entity_level === 'adset') ? 'adset' : 'ad';
        const lvl = rows.filter(r => r.entity_level === level);
        const metaOf = (r: any) => {
          const lm = Number(r.leads_meta) || 0;
          return lm > 0 ? lm : (Number(r.conversations_started) || 0);
        };
        const sum = (rs: any[]): Win => rs.reduce((a, r) => ({
          spend: a.spend + (Number(r.spend) || 0),
          meta: a.meta + metaOf(r),
        }), { spend: 0, meta: 0 });

        const ls: any[] = Array.isArray(leadsRes?.data) ? leadsRes.data : [];
        let lToday = 0, lWeek = 0;
        for (const l of ls) {
          const t = new Date(l.arrived_at || l.created_at || 0).getTime();
          if (t >= weekStart.getTime()) lWeek++;
          if (t >= todayStart.getTime()) lToday++;
        }

        if (!cancelled) {
          setCost({ week: sum(lvl), today: sum(lvl.filter(r => String(r.date) === todayYMD)) });
          setLeads({ today: lToday, week: lWeek });
        }
      } catch {
        if (!cancelled) { setCost({ today: ZERO, week: ZERO }); setLeads({ today: 0, week: 0 }); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const v = useMemo(() => {
    const cplReal = (w: Win, n: number) => (n > 0 ? w.spend / n : 0);
    const cplFalso = (w: Win) => (w.meta > 0 ? w.spend / w.meta : 0);
    return {
      realToday: cplReal(cost.today, leads.today),
      real7d: cplReal(cost.week, leads.week),
      falsoToday: cplFalso(cost.today),
      falso7d: cplFalso(cost.week),
    };
  }, [cost, leads]);

  return (
    <section className="shrink-0 px-8 pb-4">
      <div className="bg-slate-900/60 rounded-2xl border border-blue-900/40 p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h3 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">
            Custo por Lead · Tráfego Pago — Real vs. Meta
          </h3>
          <span className="text-[9px] text-slate-500">Real = chegou no Pedro · Meta = o que o Facebook mostra</span>
        </div>
        <div className="grid grid-cols-2 portrait:grid-cols-1 gap-3">
          {/* REAL */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">Real (chegou no Pedro)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[clamp(1.2rem,3vmin,1.9rem)] font-black tabular-nums leading-none text-emerald-300">{leads.today > 0 ? brl(v.realToday) : '—'}</p>
                <p className="text-[10px] text-slate-400 mt-1">Hoje · {leads.today} leads</p>
              </div>
              <div>
                <p className="text-[clamp(1.2rem,3vmin,1.9rem)] font-black tabular-nums leading-none text-emerald-300">{leads.week > 0 ? brl(v.real7d) : '—'}</p>
                <p className="text-[10px] text-slate-400 mt-1">7 dias · {leads.week} leads</p>
              </div>
            </div>
          </div>
          {/* FALSO / META */}
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-orange-400">Falso (o que o Meta mostra)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[clamp(1.2rem,3vmin,1.9rem)] font-black tabular-nums leading-none text-orange-300">{cost.today.meta > 0 ? brl(v.falsoToday) : '—'}</p>
                <p className="text-[10px] text-slate-400 mt-1">Hoje · {cost.today.meta} no Meta</p>
              </div>
              <div>
                <p className="text-[clamp(1.2rem,3vmin,1.9rem)] font-black tabular-nums leading-none text-orange-300">{cost.week.meta > 0 ? brl(v.falso7d) : '—'}</p>
                <p className="text-[10px] text-slate-400 mt-1">7 dias · {cost.week.meta} no Meta</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
