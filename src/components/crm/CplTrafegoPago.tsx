// ============================================================================
// CplTrafegoPago — Custo por Lead do Tráfego Pago + Real vs. Não Real
// ----------------------------------------------------------------------------
// Renderizado no painel ao vivo (CrmAoVivo), só para o MASTER.
//
// O QUE MOSTRA:
//  1. Custo por Lead do TRÁFEGO PAGO (Hoje e Últimos 7 dias)
//     = gasto nas campanhas ÷ leads que chegaram pelo WhatsApp
//       (fora os manuais: porta, marketplace, indicação, OLX, site...).
//     NÃO mistura com lead de porta/marketplace — só tráfego.
//
//  2. Real vs. o que o Meta mostra (Hoje e 7 dias):
//     - REAL    = leads que realmente chegaram e o Pedro atendeu.
//     - NÃO REAL = o que o Meta reporta (conversas iniciadas / leads do anúncio)
//                  e que NÃO bateu com o que chegou no Pedro (o "fantasma").
//     - CPL real     = gasto ÷ leads reais (o custo de verdade).
//     - CPL não real = gasto ÷ número do Meta (o custo "oficial" que o Meta mostra).
//
// FONTES: campaign_costs (spend + leads_meta + conversations_started) e os leads
// já carregados do painel (origem + datas). Tudo client-side, escopado no master.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, CheckCircle2, AlertTriangle } from 'lucide-react';

interface LiveLead {
  origem?: string | null;
  arrived_at?: string | null;
  created_at?: string | null;
  last_interaction_at?: string | null;
}

// Origens MANUAIS/OFFLINE — não contam como tráfego pago (não chegaram por anúncio).
const MANUAL_ORIGINS = new Set([
  'porta', 'marketplace', 'indicacao', 'indicação', 'olx', 'site',
  'importacao', 'importação', 'loja', 'presencial', 'feirao', 'feirão',
]);
function isPaidTraffic(origem?: string | null): boolean {
  const o = (origem || '').trim().toLowerCase();
  return !MANUAL_ORIGINS.has(o); // tudo que não é manual/offline = chegou pelo WhatsApp/anúncio
}
function effTime(l: LiveLead): number {
  // arrived_at = data real de chegada (lead manual); cai no created_at quando vazio.
  return new Date(l.arrived_at || l.created_at || l.last_interaction_at || 0).getTime();
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function brl(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface Win { spend: number; meta: number; }
const ZERO: Win = { spend: 0, meta: 0 };

interface Computed {
  spend: number;
  real: number;        // leads que chegaram no Pedro (tráfego pago)
  metaTotal: number;   // número que o Meta reporta
  naoReal: number;     // meta - real (o fantasma)
  cplReal: number;     // gasto / real
  cplNaoReal: number;  // gasto / meta
}

export function CplTrafegoPago({ userId, leads }: { userId?: string | null; leads: LiveLead[] }) {
  const [cost, setCost] = useState<{ today: Win; week: Win }>({ today: ZERO, week: ZERO });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const todayStr = ymd(now);
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6);
        const { data } = await (supabase as any)
          .from('campaign_costs')
          .select('entity_level, spend, leads_meta, conversations_started, date')
          .eq('user_id', userId)
          .gte('date', ymd(weekStart));
        const rows: any[] = Array.isArray(data) ? data : [];
        // Escolhe UM nível pra não duplicar o gasto (campanha > conjunto > anúncio).
        const level = rows.some(r => r.entity_level === 'campaign') ? 'campaign'
          : rows.some(r => r.entity_level === 'adset') ? 'adset' : 'ad';
        const lvl = rows.filter(r => r.entity_level === level);
        // "Número do Meta": usa leads_meta (campanha de formulário) ou, se zerado,
        // conversations_started (campanha de mensagem/WhatsApp).
        const metaOf = (r: any) => {
          const lm = Number(r.leads_meta) || 0;
          return lm > 0 ? lm : (Number(r.conversations_started) || 0);
        };
        const sum = (rs: any[]): Win => rs.reduce((a, r) => ({
          spend: a.spend + (Number(r.spend) || 0),
          meta: a.meta + metaOf(r),
        }), { spend: 0, meta: 0 });
        if (!cancelled) {
          setCost({
            week: sum(lvl),
            today: sum(lvl.filter(r => String(r.date) === todayStr)),
          });
        }
      } catch {
        if (!cancelled) setCost({ today: ZERO, week: ZERO });
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const counts = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    let today = 0, week = 0;
    for (const l of leads) {
      if (!isPaidTraffic(l.origem)) continue;
      const t = effTime(l);
      if (t >= weekStart.getTime()) week++;
      if (t >= todayStart.getTime()) today++;
    }
    return { today, week };
  }, [leads]);

  const data = useMemo(() => {
    const mk = (win: Win, real: number): Computed => ({
      spend: win.spend,
      real,
      metaTotal: win.meta,
      naoReal: Math.max(0, win.meta - real),
      cplReal: real > 0 ? win.spend / real : 0,
      cplNaoReal: win.meta > 0 ? win.spend / win.meta : 0,
    });
    return { today: mk(cost.today, counts.today), week: mk(cost.week, counts.week) };
  }, [cost, counts]);

  return (
    <section style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#101827', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <DollarSign style={{ width: 16, height: 16, color: '#FBBF24' }} />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: '#F8FAFC' }}>Custo por Lead — Tráfego Pago</h3>
        <span style={{ fontSize: 10, color: '#64748B' }}>leads que chegaram pelo WhatsApp (fora porta / marketplace / indicação)</span>
      </div>

      {/* CPL Hoje + 7 dias */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <CplCard title="Hoje" cpl={data.today.cplReal} leads={counts.today} spend={data.today.spend} />
        <CplCard title="Últimos 7 dias" cpl={data.week.cplReal} leads={counts.week} spend={data.week.spend} />
      </div>

      {/* Real vs. Não Real */}
      <div style={{ marginTop: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.22)', padding: 12 }}>
        <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 850, color: '#E2E8F0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Leads gerais — Real vs. o que o Meta mostra
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <RealVsMeta title="Hoje" c={data.today} />
          <RealVsMeta title="Últimos 7 dias" c={data.week} />
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 10, color: '#64748B', lineHeight: 1.5 }}>
          <strong style={{ color: '#94A3B8' }}>Real</strong> = leads que chegaram e o Pedro atendeu (CPL real = gasto ÷ leads reais).{' '}
          <strong style={{ color: '#94A3B8' }}>Não real</strong> = o que o Meta reporta (conversas/leads do anúncio) e não bateu com o que chegou
          (CPL não real = gasto ÷ número do Meta).
        </p>
      </div>
    </section>
  );
}

// ─── Card de CPL (Hoje / 7 dias) ─────────────────────────────────────────────
function CplCard({ title, cpl, leads, spend }: { title: string; cpl: number; leads: number; spend: number }) {
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(251,191,36,0.30)', background: 'rgba(251,191,36,0.07)', padding: 14 }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#A8761B' }}>
        CPL Tráfego Pago · {title}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 30, fontWeight: 950, color: '#FCD34D', lineHeight: 1 }}>
        {leads > 0 ? brl(cpl) : '—'}
      </p>
      <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 11, color: '#94A3B8' }}>
        <span><strong style={{ color: '#E2E8F0' }}>{leads}</strong> leads de tráfego</span>
        <span>gasto <strong style={{ color: '#E2E8F0' }}>{brl(spend)}</strong></span>
      </div>
    </div>
  );
}

// ─── Bloco Real vs. Não Real (por período) ───────────────────────────────────
function RealVsMeta({ title, c }: { title: string; c: Computed }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: 12 }}>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, color: '#CBD5E1' }}>{title}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* REAL */}
        <div style={{ borderRadius: 8, border: '1px solid rgba(52,211,153,0.30)', background: 'rgba(52,211,153,0.08)', padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <CheckCircle2 style={{ width: 13, height: 13, color: '#34D399' }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#34D399', textTransform: 'uppercase' }}>Real</span>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 950, color: '#6EE7B7', lineHeight: 1 }}>{c.real}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#94A3B8' }}>chegaram no Pedro</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 800, color: '#E2E8F0' }}>
            {c.real > 0 ? `${brl(c.cplReal)}/lead` : '—'}
          </p>
        </div>
        {/* NÃO REAL */}
        <div style={{ borderRadius: 8, border: '1px solid rgba(251,146,60,0.30)', background: 'rgba(251,146,60,0.08)', padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <AlertTriangle style={{ width: 13, height: 13, color: '#FB923C' }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#FB923C', textTransform: 'uppercase' }}>Não real</span>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 950, color: '#FDBA74', lineHeight: 1 }}>{c.naoReal}</p>
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#94A3B8' }}>Meta mostra {c.metaTotal}, não chegou</p>
          <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 800, color: '#E2E8F0' }}>
            {c.metaTotal > 0 ? `${brl(c.cplNaoReal)}/lead` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}
