// ============================================================================
// CplTrafegoPainel — Custo por Lead do Tráfego Pago + Real vs. Não Real
// ----------------------------------------------------------------------------
// Renderizado no "Painel ao Vivo" do Pedro (DashboardTV), só para o MASTER.
//
// "TRÁFEGO PAGO" aqui = leads do Pedro (ai_crm_leads) atribuídos a um vendedor —
// exatamente o que o card "Tráfego Pago" do painel já conta. Não mistura com
// porta / marketplace / consignado / indicação (esses são leads do Marcos).
//
// MOSTRA (Hoje e Últimos 7 dias, sempre fixos, independente do filtro):
//  - CPL do tráfego pago = gasto nas campanhas ÷ leads de tráfego que chegaram.
//  - Real vs. o que o Meta mostra:
//      Real    = leads que chegaram e o Pedro atendeu.
//      Não real = o que o Meta reporta (conversas iniciadas / leads do anúncio)
//                 e que NÃO bateu com o que chegou. CPL não real = gasto ÷ Meta.
//
// FONTES: campaign_costs (spend + leads_meta + conversations_started) e
// ai_crm_leads (leads do Pedro atribuídos). Tudo client-side, escopado no master.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, CheckCircle2, AlertTriangle } from 'lucide-react';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface Win { spend: number; meta: number; }
const ZERO: Win = { spend: 0, meta: 0 };

interface Computed {
  spend: number; real: number; metaTotal: number; naoReal: number;
  cplReal: number; cplNaoReal: number;
}

export function CplTrafegoPainel({ userId }: { userId?: string | null }) {
  const [cost, setCost] = useState<{ today: Win; week: Win }>({ today: ZERO, week: ZERO });
  const [leadCount, setLeadCount] = useState<{ today: number; week: number }>({ today: 0, week: 0 });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
        const todayYMD = ymd(now);
        const weekYMD = ymd(weekStart);
        const weekISO = weekStart.toISOString();

        const [costRes, leadsRes] = await Promise.all([
          (supabase as any)
            .from('campaign_costs')
            .select('entity_level, spend, leads_meta, conversations_started, date')
            .eq('user_id', userId)
            .gte('date', weekYMD),
          // Leads do Pedro ATRIBUÍDOS (= "Tráfego Pago"), pela data real de chegada
          // (arrived_at quando informada, senão created_at). Janela de 7 dias.
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, arrived_at, created_at, assigned_to_id')
            .eq('user_id', userId)
            .not('assigned_to_id', 'is', null)
            .or(`arrived_at.gte.${weekISO},and(arrived_at.is.null,created_at.gte.${weekISO})`),
        ]);

        // ── Custo (escolhe 1 nível pra não duplicar o gasto) ──────────────────
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

        // ── Leads do Pedro (hoje / 7 dias) ────────────────────────────────────
        const leads: any[] = Array.isArray(leadsRes?.data) ? leadsRes.data : [];
        let lToday = 0, lWeek = 0;
        for (const l of leads) {
          const t = new Date(l.arrived_at || l.created_at || 0).getTime();
          if (t >= weekStart.getTime()) lWeek++;
          if (t >= todayStart.getTime()) lToday++;
        }

        if (!cancelled) {
          setCost({ week: sum(lvl), today: sum(lvl.filter(r => String(r.date) === todayYMD)) });
          setLeadCount({ today: lToday, week: lWeek });
        }
      } catch {
        if (!cancelled) { setCost({ today: ZERO, week: ZERO }); setLeadCount({ today: 0, week: 0 }); }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const data = useMemo(() => {
    const mk = (win: Win, real: number): Computed => ({
      spend: win.spend,
      real,
      metaTotal: win.meta,
      naoReal: Math.max(0, win.meta - real),
      cplReal: real > 0 ? win.spend / real : 0,
      cplNaoReal: win.meta > 0 ? win.spend / win.meta : 0,
    });
    return { today: mk(cost.today, leadCount.today), week: mk(cost.week, leadCount.week) };
  }, [cost, leadCount]);

  return (
    <section className="shrink-0 px-8 pb-6">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <DollarSign className="h-3.5 w-3.5 text-amber-400" />
        <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">Custo por Lead — Tráfego Pago</h2>
        <span className="text-[10px] text-slate-500 normal-case tracking-normal">leads do Pedro atribuídos (não inclui porta / marketplace / consignado)</span>
      </div>
      <div className="grid grid-cols-2 portrait:grid-cols-1 gap-3">
        <PeriodCard title="Hoje" leads={leadCount.today} c={data.today} />
        <PeriodCard title="Últimos 7 dias" leads={leadCount.week} c={data.week} />
      </div>
      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
        <strong className="text-slate-400">CPL real</strong> = gasto ÷ leads que chegaram no Pedro.{' '}
        <strong className="text-slate-400">Não real</strong> = o que o Meta mostra (conversas/leads do anúncio) e não bateu com o que chegou ·{' '}
        <strong className="text-slate-400">CPL não real</strong> = gasto ÷ número do Meta.
      </p>
    </section>
  );
}

// ─── Card de um período (Hoje / 7 dias): CPL + Real vs Não Real ──────────────
function PeriodCard({ title, leads, c }: { title: string; leads: number; c: Computed }) {
  return (
    <div className="bg-slate-900/60 rounded-2xl p-4 border border-amber-900/40">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className="text-[10px] uppercase tracking-widest text-amber-300/80 font-bold">CPL Tráfego Pago · {title}</p>
        <p className="text-[10px] text-slate-500">gasto {brl(c.spend)}</p>
      </div>
      <p className="text-[clamp(1.6rem,4vmin,2.4rem)] font-black tabular-nums leading-none text-amber-300">
        {leads > 0 ? brl(c.cplReal) : '—'}
      </p>
      <p className="text-[11px] text-slate-400 mt-1.5"><strong className="text-slate-200">{leads}</strong> leads de tráfego pago</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        {/* REAL */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-400">Real</span>
          </div>
          <p className="text-xl font-black tabular-nums leading-none text-emerald-300">{c.real}</p>
          <p className="text-[9px] text-slate-400 mt-1">chegaram no Pedro</p>
          <p className="text-[11px] font-bold text-slate-200 mt-1">{c.real > 0 ? `${brl(c.cplReal)}/lead` : '—'}</p>
        </div>
        {/* NÃO REAL */}
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3 w-3 text-orange-400" />
            <span className="text-[9px] font-bold uppercase tracking-wide text-orange-400">Não real</span>
          </div>
          <p className="text-xl font-black tabular-nums leading-none text-orange-300">{c.naoReal}</p>
          <p className="text-[9px] text-slate-400 mt-1">Meta mostra {c.metaTotal}, não chegou</p>
          <p className="text-[11px] font-bold text-slate-200 mt-1">{c.metaTotal > 0 ? `${brl(c.cplNaoReal)}/lead` : '—'}</p>
        </div>
      </div>
    </div>
  );
}
