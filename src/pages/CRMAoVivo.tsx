import { useEffect, useRef, useState, useMemo } from 'react';
import { useFluxCRM } from '@/hooks/useFluxCRM';
import { Trophy, Zap, Star, TrendingUp, Bell } from 'lucide-react';

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

function playAlert() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [523, 659, 784]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.03);
      gain.gain.linearRampToValueAtTime(0, start + 0.18);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch (_) {}
}

const SELLER_PALETTE = [
  { from: '#a855f7', to: '#7c3aed', glow: '#a855f780' },
  { from: '#06b6d4', to: '#0284c7', glow: '#06b6d480' },
  { from: '#f43f5e', to: '#e11d48', glow: '#f43f5e80' },
  { from: '#f59e0b', to: '#d97706', glow: '#f59e0b80' },
  { from: '#10b981', to: '#059669', glow: '#10b98180' },
  { from: '#ec4899', to: '#db2777', glow: '#ec489980' },
];

/* ── component ────────────────────────────────────────── */

export default function CRMAoVivo() {
  const { stages, leads, loading } = useFluxCRM();
  const now = useClock();
  const [tick, setTick] = useState(false);
  const [newLeadFlash, setNewLeadFlash] = useState(false);
  const prevLeadCount = useRef<number | null>(null);

  /* blink AO VIVO */
  useEffect(() => {
    const i = setInterval(() => setTick(p => !p), 800);
    return () => clearInterval(i);
  }, []);

  /* sound + flash on new lead */
  useEffect(() => {
    if (loading) return;
    if (prevLeadCount.current === null) { prevLeadCount.current = leads.length; return; }
    if (leads.length > prevLeadCount.current) {
      playAlert();
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 2000);
    }
    prevLeadCount.current = leads.length;
  }, [leads.length, loading]);

  const uniqueStages = useMemo(() => {
    const seen = new Set<string>();
    return stages
      .filter(s => { const k = s.name.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.position - b.position);
  }, [stages]);

  const metrics = useMemo(() => {
    const total = leads.length;
    const totalValue = leads.reduce((s, l) => s + (l.value || 0), 0);
    const won = leads.filter(l => l.won_at).length;
    const convRate = total > 0 ? Math.round((won / total) * 100) : 0;
    return { total, totalValue, won, convRate };
  }, [leads]);

  /* sellers — ordered by leads today then total */
  const sellers = useMemo(() => {
    const map = new Map<string, { leads: number; value: number; won: number; lastLead: string }>();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    leads.forEach(l => {
      const v = (l.custom_fields?.vendedor as string)?.trim();
      if (!v) return;
      const cur = map.get(v) || { leads: 0, value: 0, won: 0, lastLead: '' };
      cur.leads++;
      cur.value += l.value || 0;
      if (l.won_at) cur.won++;
      if (!cur.lastLead || l.created_at > cur.lastLead) cur.lastLead = l.created_at;
      map.set(v, cur);
    });
    return [...map.entries()]
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.leads - a.leads || b.value - a.value);
  }, [leads]);

  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5),
    [leads]
  );

  const getStageName = (id: string | null) => uniqueStages.find(s => s.id === id)?.name ?? '—';
  const getStageColor = (id: string | null) => uniqueStages.find(s => s.id === id)?.color ?? '#ffffff';

  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  if (loading) return (
    <div className="h-screen w-screen bg-[#03030a] flex items-center justify-center">
      <p className="text-white text-3xl font-bold animate-pulse">Carregando...</p>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes neon-pulse { 0%,100% { opacity:1; } 50% { opacity:.6; } }
        @keyframes flash-in { 0% { transform:scale(1.04); box-shadow:0 0 40px #a855f7; } 100% { transform:scale(1); } }
        @keyframes seller-glow { 0%,100% { box-shadow: 0 0 18px var(--sg); } 50% { box-shadow: 0 0 36px var(--sg); } }
        .seller-active { animation: seller-glow 1.6s ease-in-out infinite; }
        .new-lead-flash { animation: flash-in .4s ease-out; }
      `}</style>

      <div
        className="h-screen w-screen overflow-hidden flex flex-col text-white select-none"
        style={{
          fontFamily: "'Inter', sans-serif",
          background: 'radial-gradient(ellipse at 15% 15%, #1f0544 0%, transparent 55%), radial-gradient(ellipse at 85% 85%, #001133 0%, transparent 55%), #03030a',
        }}
      >
        {/* ── HEADER ───────────────────────────────────── */}
        <header className="flex-none px-5 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl flex items-center justify-center text-lg font-black"
              style={{ background: 'linear-gradient(135deg,#a855f7,#3b82f6)', boxShadow: '0 0 20px #a855f780' }}>L</div>
            <div>
              <p className="text-[9px] text-white/30 uppercase tracking-[0.25em]">LogosIA</p>
              <p className="text-xl font-black tracking-wide"
                style={{ background: 'linear-gradient(90deg,#c084fc,#38bdf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                CRM AO VIVO
              </p>
            </div>
          </div>

          <div className="text-center">
            <p className="text-3xl font-mono font-black tabular-nums" style={{ textShadow: '0 0 20px #38bdf8aa' }}>{timeStr}</p>
            <p className="text-[10px] text-white/30 capitalize">{dateStr}</p>
          </div>

          <div className="flex items-center gap-2">
            {newLeadFlash && <Bell className="h-5 w-5 text-yellow-300 animate-bounce" style={{ filter: 'drop-shadow(0 0 8px #fde047)' }} />}
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: '#ef4444', boxShadow: tick ? '0 0 12px #ef4444' : 'none', transition: 'box-shadow .3s' }}
            />
            <span className="text-xs font-black tracking-widest" style={{ color: '#ef4444', textShadow: tick ? '0 0 10px #ef4444' : 'none' }}>AO VIVO</span>
          </div>
        </header>

        {/* ── MÉTRICAS ─────────────────────────────────── */}
        <section className="flex-none px-4 pb-2 grid grid-cols-4 gap-2">
          {[
            { label: 'LEADS', value: metrics.total, from: '#a855f7', to: '#7c3aed', glow: '#a855f7', icon: <Zap className="h-4 w-4" /> },
            { label: 'PIPELINE', value: fmt(metrics.totalValue), from: '#06b6d4', to: '#0284c7', glow: '#06b6d4', icon: <TrendingUp className="h-4 w-4" /> },
            { label: 'FECHADOS', value: metrics.won, from: '#10b981', to: '#059669', glow: '#10b981', icon: <Trophy className="h-4 w-4" /> },
            { label: 'CONVERSÃO', value: `${metrics.convRate}%`, from: '#f59e0b', to: '#d97706', glow: '#f59e0b', icon: <Star className="h-4 w-4" /> },
          ].map(m => (
            <div key={m.label} className="rounded-2xl p-[1.5px]"
              style={{ background: `linear-gradient(135deg,${m.from},${m.to})`, boxShadow: `0 0 16px ${m.glow}55` }}>
              <div className="rounded-2xl h-full px-3 py-3" style={{ background: '#0a0a16' }}>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: m.from }}>{m.icon}{m.label}</div>
                <p className="text-3xl font-black tabular-nums leading-none text-white">{m.value}</p>
              </div>
            </div>
          ))}
        </section>

        {/* ── VENDEDORES ───────────────────────────────── */}
        <section className="flex-none px-4 pb-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.25em] mb-2" style={{ color: '#f59e0b' }}>
            🏆 Ranking de Vendedores
          </p>
          {sellers.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-white/30 text-xs">
              Nenhum vendedor vinculado — preencha o campo "Vendedor" nos leads
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(sellers.length, 4)}, 1fr)` }}>
              {sellers.slice(0, 4).map((s, i) => {
                const pal = SELLER_PALETTE[i % SELLER_PALETTE.length];
                const isFirst = i === 0;
                const minsAgo = s.lastLead ? Math.floor((Date.now() - new Date(s.lastLead).getTime()) / 60000) : 999;
                const isActive = minsAgo < 30;
                return (
                  <div
                    key={s.name}
                    className={`relative rounded-2xl p-[2px] ${isActive ? 'seller-active' : ''}`}
                    style={{
                      background: `linear-gradient(135deg,${pal.from},${pal.to})`,
                      ['--sg' as any]: pal.glow,
                      boxShadow: isFirst ? `0 0 28px ${pal.glow}` : `0 0 12px ${pal.glow}66`,
                    }}
                  >
                    <div className="rounded-2xl px-3 py-3 flex flex-col items-center gap-1.5" style={{ background: '#0a0a16' }}>
                      {isFirst && (
                        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[8px] font-black px-2.5 py-0.5 rounded-full"
                          style={{ background: 'linear-gradient(90deg,#fbbf24,#f59e0b)', color: '#000', boxShadow: '0 0 12px #fbbf2480' }}>
                          🏆 LÍDER
                        </div>
                      )}

                      {/* avatar */}
                      <div className="h-12 w-12 rounded-full flex items-center justify-center text-xl font-black mt-1"
                        style={{ background: `linear-gradient(135deg,${pal.from},${pal.to})`, boxShadow: `0 0 20px ${pal.glow}` }}>
                        {s.name.charAt(0).toUpperCase()}
                      </div>

                      {/* nome destacado */}
                      <p className="font-black text-base text-center w-full truncate"
                        style={{ color: pal.from, textShadow: `0 0 14px ${pal.glow}` }}>
                        {s.name}
                      </p>

                      {/* badge ativo */}
                      {isActive && (
                        <div className="rounded-full px-2 py-0.5 text-[8px] font-black"
                          style={{ background: `${pal.from}25`, border: `1px solid ${pal.from}60`, color: pal.from, animation: 'neon-pulse 1.5s infinite' }}>
                          ● EM ATENDIMENTO
                        </div>
                      )}

                      {/* stats */}
                      <div className="grid grid-cols-3 gap-1 w-full mt-0.5">
                        <div className="text-center">
                          <p className="text-lg font-black text-white">{s.leads}</p>
                          <p className="text-[8px] text-white/40">leads</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-black" style={{ color: '#10b981' }}>{s.won}</p>
                          <p className="text-[8px] text-white/40">ganhos</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-black text-white/70">{fmt(s.value)}</p>
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

        {/* ── PIPELINE ─────────────────────────────────── */}
        <section className="flex-none px-4 pb-2">
          <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.25em] mb-2">Pipeline</p>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(uniqueStages.length, 5)}, 1fr)` }}>
            {uniqueStages.map(stage => {
              const count = leads.filter(l => l.stage_id === stage.id).length;
              const pct = metrics.total > 0 ? (count / metrics.total) * 100 : 0;
              return (
                <div key={stage.id} className="rounded-xl px-3 py-2"
                  style={{ background: `${stage.color}12`, border: `1px solid ${stage.color}40` }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: stage.color, boxShadow: `0 0 8px ${stage.color}` }} />
                    <span className="text-[10px] font-semibold truncate text-white/80">{stage.name}</span>
                  </div>
                  <p className="text-2xl font-black" style={{ color: stage.color, textShadow: `0 0 16px ${stage.color}` }}>{count}</p>
                  <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: `${stage.color}20` }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: stage.color, boxShadow: `0 0 8px ${stage.color}` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── LEADS RECENTES ───────────────────────────── */}
        <section className="flex-1 px-4 pb-4 min-h-0 flex flex-col">
          <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.25em] mb-2 flex-none">Últimos Leads</p>
          <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
            {recentLeads.map((lead, idx) => {
              const stageColor = getStageColor(lead.stage_id);
              const vendedor = (lead.custom_fields?.vendedor as string) || null;
              const sellerIdx = vendedor ? sellers.findIndex(s => s.name === vendedor) : -1;
              const sellerPal = sellerIdx >= 0 ? SELLER_PALETTE[sellerIdx % SELLER_PALETTE.length] : null;
              const age = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 60000);
              const ageStr = age < 60 ? `${age}min` : age < 1440 ? `${Math.floor(age / 60)}h` : `${Math.floor(age / 1440)}d`;
              const isNewest = idx === 0;
              return (
                <div
                  key={lead.id}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isNewest && newLeadFlash ? 'new-lead-flash' : ''}`}
                  style={{
                    background: isNewest ? `${stageColor}18` : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isNewest ? stageColor + '50' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                    style={{ background: `${stageColor}20`, color: stageColor, border: `1.5px solid ${stageColor}60`, boxShadow: `0 0 12px ${stageColor}44` }}>
                    {lead.name.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate text-white">{lead.name}</p>
                    <p className="text-[10px] text-white/40 truncate">{lead.company || lead.phone || '—'}</p>
                  </div>

                  {/* vendedor badge — cor do vendedor */}
                  {vendedor && sellerPal && (
                    <div className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-black"
                      style={{
                        background: `${sellerPal.from}22`,
                        border: `1.5px solid ${sellerPal.from}70`,
                        color: sellerPal.from,
                        textShadow: `0 0 8px ${sellerPal.glow}`,
                        boxShadow: `0 0 10px ${sellerPal.glow}`,
                      }}>
                      👤 {vendedor}
                    </div>
                  )}

                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-bold" style={{ color: stageColor }}>{getStageName(lead.stage_id)}</p>
                    <p className="text-[9px] text-white/30">{ageStr} atrás</p>
                  </div>

                  {lead.value > 0 && (
                    <div className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-black"
                      style={{ background: '#10b98120', border: '1px solid #10b98150', color: '#10b981', boxShadow: '0 0 8px #10b98144' }}>
                      {fmt(lead.value)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
