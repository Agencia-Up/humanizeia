import { useEffect, useState, useMemo } from 'react';
import { useFluxCRM } from '@/hooks/useFluxCRM';
import { Trophy, Zap, Star, TrendingUp } from 'lucide-react';

/* ── helpers ──────────────────────────────────────────── */

function useClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return t;
}

function fmt(v: number) {
  if (v >= 1000000) return `R$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return `R$${v.toFixed(0)}`;
}

const SELLER_COLORS = [
  { bg: 'from-violet-500 to-purple-600', glow: 'shadow-violet-500/50', ring: 'ring-violet-400' },
  { bg: 'from-cyan-500 to-blue-600',     glow: 'shadow-cyan-500/50',   ring: 'ring-cyan-400' },
  { bg: 'from-rose-500 to-pink-600',     glow: 'shadow-rose-500/50',   ring: 'ring-rose-400' },
  { bg: 'from-amber-500 to-orange-600',  glow: 'shadow-amber-500/50',  ring: 'ring-amber-400' },
  { bg: 'from-emerald-500 to-teal-600',  glow: 'shadow-emerald-500/50',ring: 'ring-emerald-400' },
  { bg: 'from-fuchsia-500 to-pink-600',  glow: 'shadow-fuchsia-500/50',ring: 'ring-fuchsia-400' },
];

/* ── component ────────────────────────────────────────── */

export default function CRMAoVivo() {
  const { stages, leads, loading } = useFluxCRM();
  const now = useClock();
  const [tick, setTick] = useState(false);

  useEffect(() => {
    const i = setInterval(() => { setTick(p => !p); }, 1000);
    return () => clearInterval(i);
  }, []);

  /* unique ordered stages */
  const uniqueStages = useMemo(() => {
    const seen = new Set<string>();
    return stages.filter(s => { const k = s.name.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.position - b.position);
  }, [stages]);

  /* metrics */
  const metrics = useMemo(() => {
    const total = leads.length;
    const totalValue = leads.reduce((s, l) => s + (l.value || 0), 0);
    const won = leads.filter(l => l.won_at).length;
    const convRate = total > 0 ? Math.round((won / total) * 100) : 0;
    return { total, totalValue, won, convRate };
  }, [leads]);

  /* sellers ranking */
  const sellers = useMemo(() => {
    const map = new Map<string, { leads: number; value: number; won: number }>();
    leads.forEach(l => {
      const v = (l.custom_fields?.vendedor as string)?.trim();
      if (!v) return;
      const cur = map.get(v) || { leads: 0, value: 0, won: 0 };
      cur.leads++;
      cur.value += l.value || 0;
      if (l.won_at) cur.won++;
      map.set(v, cur);
    });
    return [...map.entries()]
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.won - a.won || b.value - a.value);
  }, [leads]);

  /* recent leads */
  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5),
    [leads]
  );

  const getStageName = (id: string | null) => uniqueStages.find(s => s.id === id)?.name ?? '—';
  const getStageColor = (id: string | null) => uniqueStages.find(s => s.id === id)?.color ?? '#ffffff';

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  if (loading) return (
    <div className="h-screen w-screen bg-[#050508] flex items-center justify-center">
      <p className="text-white text-3xl font-bold animate-pulse">Carregando...</p>
    </div>
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#050508] text-white select-none"
      style={{ fontFamily: "'Inter', sans-serif", backgroundImage: 'radial-gradient(ellipse at 20% 20%, #1a0533 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #001a3a 0%, transparent 60%)' }}>

      {/* ── HEADER ─────────────────────────────────────── */}
      <header className="flex-none px-6 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-lg font-black shadow-lg shadow-violet-500/40">L</div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-[0.2em]">LogosIA</p>
            <p className="text-lg font-black bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent leading-tight">CRM AO VIVO</p>
          </div>
        </div>

        {/* clock */}
        <div className="text-center">
          <p className="text-3xl font-mono font-black tabular-nums tracking-tight text-white">{timeStr}</p>
          <p className="text-[10px] text-white/30 capitalize">{dateStr}</p>
        </div>

        {/* live dot */}
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full bg-red-500 shadow-md shadow-red-500/70 ${tick ? 'opacity-100' : 'opacity-30'} transition-opacity duration-300`} />
          <span className="text-xs font-bold text-red-400 tracking-widest">AO VIVO</span>
        </div>
      </header>

      {/* ── MÉTRICAS ───────────────────────────────────── */}
      <section className="flex-none px-4 pb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'LEADS', value: metrics.total, gradient: 'from-violet-600 to-purple-700', glow: 'shadow-violet-500/40', icon: <Zap className="h-4 w-4" /> },
          { label: 'PIPELINE', value: fmt(metrics.totalValue), gradient: 'from-cyan-600 to-blue-700', glow: 'shadow-cyan-500/40', icon: <TrendingUp className="h-4 w-4" /> },
          { label: 'FECHADOS', value: metrics.won, gradient: 'from-emerald-500 to-teal-700', glow: 'shadow-emerald-500/40', icon: <Trophy className="h-4 w-4" /> },
          { label: 'CONVERSÃO', value: `${metrics.convRate}%`, gradient: 'from-amber-500 to-orange-600', glow: 'shadow-amber-500/40', icon: <Star className="h-4 w-4" /> },
        ].map(m => (
          <div key={m.label} className={`rounded-2xl bg-gradient-to-br ${m.gradient} p-[1px] shadow-lg ${m.glow}`}>
            <div className="rounded-2xl bg-[#0d0d18] h-full px-3 py-3">
              <div className="flex items-center gap-1.5 text-white/60 text-[9px] font-bold uppercase tracking-widest mb-1">{m.icon}{m.label}</div>
              <p className="text-3xl font-black tabular-nums leading-none">{m.value}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── VENDEDORES ─────────────────────────────────── */}
      <section className="flex-none px-4 pb-3">
        <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
          <Trophy className="h-3 w-3 text-amber-400" /> Ranking de Vendedores
        </p>
        {sellers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-white/30 text-xs">
            Nenhum vendedor vinculado — adicione o campo "Vendedor" nos leads
          </div>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(sellers.length, 4)}, 1fr)` }}>
            {sellers.slice(0, 4).map((s, i) => {
              const c = SELLER_COLORS[i % SELLER_COLORS.length];
              const isFirst = i === 0;
              return (
                <div key={s.name} className={`relative rounded-2xl bg-gradient-to-br ${c.bg} p-[1.5px] shadow-xl ${c.glow} ${isFirst ? 'shadow-lg' : ''}`}>
                  <div className="rounded-2xl bg-[#0d0d18] px-3 py-3 h-full flex flex-col gap-1">
                    {isFirst && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-400 to-yellow-300 text-black text-[8px] font-black px-2 py-0.5 rounded-full shadow-lg">
                        🏆 LÍDER
                      </div>
                    )}
                    {/* Avatar */}
                    <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${c.bg} flex items-center justify-center text-base font-black shadow-lg ${c.glow} mx-auto`}>
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <p className={`text-center font-black text-sm truncate ${isFirst ? 'text-white' : 'text-white/80'}`}>{s.name}</p>
                    <div className="grid grid-cols-3 gap-1 mt-1">
                      <div className="text-center">
                        <p className="text-base font-black text-white">{s.leads}</p>
                        <p className="text-[8px] text-white/40">leads</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-black text-emerald-400">{s.won}</p>
                        <p className="text-[8px] text-white/40">ganhos</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] font-black text-white/70">{fmt(s.value)}</p>
                        <p className="text-[8px] text-white/40">valor</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── PIPELINE ───────────────────────────────────── */}
      <section className="flex-none px-4 pb-3">
        <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mb-2">Pipeline</p>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(uniqueStages.length, 5)}, 1fr)` }}>
          {uniqueStages.map(stage => {
            const count = leads.filter(l => l.stage_id === stage.id).length;
            const pct = metrics.total > 0 ? (count / metrics.total) * 100 : 0;
            return (
              <div key={stage.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: stage.color, boxShadow: `0 0 6px ${stage.color}` }} />
                  <span className="text-[10px] font-semibold truncate text-white/80">{stage.name}</span>
                </div>
                <p className="text-2xl font-black" style={{ color: stage.color, textShadow: `0 0 20px ${stage.color}88` }}>{count}</p>
                <div className="h-1 rounded-full bg-white/10 mt-1.5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: stage.color, boxShadow: `0 0 8px ${stage.color}` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── LEADS RECENTES ─────────────────────────────── */}
      <section className="flex-1 px-4 pb-4 min-h-0 flex flex-col">
        <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mb-2 flex-none">Últimos Leads</p>
        <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
          {recentLeads.map(lead => {
            const stageColor = getStageColor(lead.stage_id);
            const vendedor = (lead.custom_fields?.vendedor as string) || null;
            const age = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 60000);
            const ageStr = age < 60 ? `${age}min` : age < 1440 ? `${Math.floor(age / 60)}h` : `${Math.floor(age / 1440)}d`;
            return (
              <div key={lead.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                {/* avatar */}
                <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                  style={{ backgroundColor: `${stageColor}22`, color: stageColor, border: `1.5px solid ${stageColor}55`, boxShadow: `0 0 10px ${stageColor}33` }}>
                  {lead.name.charAt(0).toUpperCase()}
                </div>

                {/* info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate text-white">{lead.name}</p>
                  <p className="text-[10px] text-white/40 truncate">{lead.company || lead.phone || '—'}</p>
                </div>

                {/* vendedor */}
                {vendedor && (
                  <div className="shrink-0 rounded-lg bg-violet-500/20 border border-violet-500/30 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                    👤 {vendedor}
                  </div>
                )}

                {/* stage */}
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-bold" style={{ color: stageColor }}>{getStageName(lead.stage_id)}</p>
                  <p className="text-[9px] text-white/30">{ageStr} atrás</p>
                </div>

                {/* value */}
                {lead.value > 0 && (
                  <div className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                    {fmt(lead.value)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
