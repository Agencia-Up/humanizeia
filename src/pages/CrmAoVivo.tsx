import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Activity,
  ArrowLeft,
  Bell,
  CalendarClock,
  Crown,
  Expand,
  Flame,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/* ── palette ──────────────────────────────────────────── */
const NEON = {
  orange: { hex: '#ff6b00', glow: '#ff6b0066', bg: 'rgba(255,107,0,0.15)', border: 'rgba(255,107,0,0.45)' },
  purple: { hex: '#b44fff', glow: '#b44fff66', bg: 'rgba(180,79,255,0.15)', border: 'rgba(180,79,255,0.45)' },
  cyan:   { hex: '#00e5ff', glow: '#00e5ff55', bg: 'rgba(0,229,255,0.12)', border: 'rgba(0,229,255,0.40)' },
  green:  { hex: '#00e676', glow: '#00e67655', bg: 'rgba(0,230,118,0.12)', border: 'rgba(0,230,118,0.40)' },
  amber:  { hex: '#ffcc00', glow: '#ffcc0055', bg: 'rgba(255,204,0,0.13)', border: 'rgba(255,204,0,0.42)' },
  pink:   { hex: '#ff4081', glow: '#ff408166', bg: 'rgba(255,64,129,0.14)', border: 'rgba(255,64,129,0.44)' },
};

const SELLER_PALETTE = [
  NEON.orange, NEON.purple, NEON.cyan, NEON.green, NEON.amber, NEON.pink,
];

const LIVE_COLUMNS = [
  { id: 'novo',        title: 'Novos Leads',    neon: NEON.cyan },
  { id: 'interessado', title: 'Interessados',   neon: NEON.amber },
  { id: 'qualificado', title: 'Qualificados',   neon: NEON.green },
  { id: 'transferido', title: 'Em Atendimento', neon: NEON.orange },
];

/* ── helpers ──────────────────────────────────────────── */
function formatRelative(dateString?: string | null) {
  if (!dateString) return 'Sem atualização';
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(dateString).getTime()) / 60000));
  if (diffMin < 1) return 'Agora';
  if (diffMin < 60) return `${diffMin} min`;
  const h = Math.floor(diffMin / 60); const m = diffMin % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function getTransferReasonLabel(transfer: any) {
  if (transfer?.transfer_reason === 'manual') return 'Manual';
  if (transfer?.transfer_reason === 'round_robin') return 'Rodízio';
  if (String(transfer?.notes || '').toLowerCase().includes('round-robin')) return 'Rodízio';
  return 'Transferência';
}

function getNextInQueue(members: any[], transfers: any[]) {
  const active = members.filter(m => m.is_active);
  if (active.length === 0) return null;
  const lastMap = new Map<string, Date>();
  for (const t of transfers) {
    if (t?.to_member_id && !lastMap.has(t.to_member_id)) lastMap.set(t.to_member_id, new Date(t.created_at));
  }
  const never = active.filter(m => !lastMap.has(m.id));
  if (never.length > 0) return never[0];
  return [...active].sort((a, b) => (lastMap.get(a.id)?.getTime() || 0) - (lastMap.get(b.id)?.getTime() || 0))[0] || null;
}

function getMemberStats(members: any[], transfers: any[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return members.map(m => ({
    ...m,
    todayCount: transfers.filter(t => t.to_member_id === m.id && new Date(t.created_at) >= today).length,
    totalCount: transfers.filter(t => t.to_member_id === m.id).length,
  })).sort((a, b) => b.todayCount !== a.todayCount ? b.todayCount - a.todayCount : (b.totalCount - a.totalCount));
}

function playAlert() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [523, 659, 784].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      const s = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, s);
      gain.gain.linearRampToValueAtTime(0.4, s + 0.03);
      gain.gain.linearRampToValueAtTime(0, s + 0.18);
      osc.start(s); osc.stop(s + 0.2);
    });
  } catch (_) {}
}

/* ── component ────────────────────────────────────────── */
export default function CrmAoVivo() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight >= window.innerWidth);
  const [leads, setLeads] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [newLeadFlash, setNewLeadFlash] = useState(false);
  const [tick, setTick] = useState(false);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    const i = setInterval(() => setTick(p => !p), 800);
    return () => clearInterval(i);
  }, []);

  const fetchLiveData = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const [{ data: leadsData }, { data: transfersData }, { data: membersData }, { data: agentsData }] = await Promise.all([
        (supabase as any).from('ai_crm_leads').select('*, agent:wa_ai_agents(name), member:ai_team_members(name, whatsapp_number)')
          .eq('user_id', user.id).neq('status', 'encerrado').order('last_interaction_at', { ascending: false }),
        (supabase as any).from('ai_lead_transfers').select('*, member:ai_team_members(name), agent:wa_ai_agents(name), lead:ai_crm_leads(lead_name, remote_jid)')
          .eq('user_id', user.id).order('created_at', { ascending: false }).limit(12),
        (supabase as any).from('ai_team_members').select('*').eq('user_id', user.id)
          .order('is_active', { ascending: false }).order('last_lead_received_at', { ascending: true, nullsFirst: true }),
        (supabase as any).from('wa_ai_agents').select('id, name').eq('user_id', user.id),
      ]);
      setLeads(leadsData || []);
      setTransfers(transfersData || []);
      setTeamMembers(membersData || []);
      setAgents(agentsData || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (loading) return;
    if (prevCount.current === null) { prevCount.current = leads.length; return; }
    if (leads.length > prevCount.current) {
      playAlert();
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 2500);
    }
    prevCount.current = leads.length;
  }, [leads.length, loading]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(fetchLiveData, 120000);
    const channel = supabase.channel('crm-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` }, fetchLiveData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_lead_transfers', filter: `user_id=eq.${user.id}` }, fetchLiveData)
      .subscribe();
    return () => { window.clearInterval(interval); supabase.removeChannel(channel); };
  }, [fetchLiveData, user]);

  useEffect(() => {
    const h = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const activeMembers = useMemo(() => teamMembers.filter(m => m.is_active), [teamMembers]);
  const memberStats   = useMemo(() => getMemberStats(activeMembers, transfers), [activeMembers, transfers]);
  const nextSeller    = useMemo(() => getNextInQueue(teamMembers, transfers), [teamMembers, transfers]);
  const leadsByColumn = useMemo(() =>
    Object.fromEntries(LIVE_COLUMNS.map(col => [col.id, leads.filter(l => (l.status || 'novo') === col.id).slice(0, isPortrait ? 4 : 6)])),
  [isPortrait, leads]) as Record<string, any[]>;

  const totalQualified = leads.filter(l => l.status === 'qualificado' || l.status === 'transferido').length;
  const attendedNow    = leads.filter(l => l.status === 'transferido').length;

  const handleFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#040410' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: NEON.cyan.hex }}>
        <Loader2 className="h-8 w-8 animate-spin" />
        <span style={{ fontSize: 18, fontWeight: 700 }}>Carregando CRM ao vivo...</span>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes neon-pulse { 0%,100%{opacity:1}50%{opacity:.55} }
        @keyframes flash-screen { 0%{box-shadow:inset 0 0 120px #ff6b0066}100%{box-shadow:none} }
        @keyframes seller-glow { 0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)} }
        .seller-active { animation: seller-glow 1.8s ease-in-out infinite; }
        .new-flash { animation: flash-screen .6s ease-out; }
      `}</style>

      <div
        className={newLeadFlash ? 'new-flash' : ''}
        style={{ minHeight: '100vh', overflowX: 'hidden', background: 'radial-gradient(ellipse at 20% 10%, #1a0040 0%, transparent 45%), radial-gradient(ellipse at 80% 90%, #001830 0%, transparent 45%), #040410', color: '#fff' }}
      >
        {/* HEADER */}
        <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 99, background: NEON.cyan.bg, border: `1px solid ${NEON.cyan.border}`, color: NEON.cyan.hex, fontSize: 12, fontWeight: 700 }}>
              <MonitorPlay style={{ width: 14, height: 14 }} />
              CRM Ao Vivo
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 99, background: NEON.green.bg, border: `1px solid ${NEON.green.border}`, color: NEON.green.hex, fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: NEON.green.hex, boxShadow: tick ? `0 0 8px ${NEON.green.hex}` : 'none', display: 'inline-block', transition: 'box-shadow .3s' }} />
              <Activity style={{ width: 14, height: 14 }} />
              Tempo real + backup 2 min
            </div>
            {newLeadFlash && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 99, background: NEON.orange.bg, border: `1px solid ${NEON.orange.border}`, color: NEON.orange.hex, fontSize: 13, fontWeight: 900, animation: 'neon-pulse 0.5s infinite' }}>
                <Bell style={{ width: 14, height: 14 }} />
                NOVO LEAD!
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff' }} onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
            <Button variant="outline" style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff' }} onClick={fetchLiveData}>
              <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
            </Button>
            <Button style={{ background: `linear-gradient(135deg,${NEON.purple.hex},${NEON.cyan.hex})`, color: '#000', fontWeight: 700 }} onClick={handleFullscreen}>
              <Expand className="mr-2 h-4 w-4" /> Tela cheia
            </Button>
          </div>
        </div>

        <div style={{ padding: '0 24px 20px' }}>
          <h1 style={{ fontSize: 44, fontWeight: 900, letterSpacing: '-1px', background: `linear-gradient(90deg,${NEON.purple.hex},${NEON.cyan.hex})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Central de Leads
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
            Painel para TV — leads em tempo real, vendedor responsável e próximo da fila.
          </p>
        </div>

        {/* MÉTRICAS */}
        <div style={{ padding: '0 24px 20px', display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12 }}>
          {[
            { icon: <Users className="h-5 w-5" />,        label: 'Leads no painel',    value: leads.length,         neon: NEON.cyan },
            { icon: <Flame className="h-5 w-5" />,         label: 'Leads qualificados', value: totalQualified,       neon: NEON.green },
            { icon: <UserCheck className="h-5 w-5" />,     label: 'Em atendimento',     value: attendedNow,          neon: NEON.orange },
            { icon: <Crown className="h-5 w-5" />,         label: 'Vendedores ativos',  value: activeMembers.length, neon: NEON.purple },
            { icon: <CalendarClock className="h-5 w-5" />, label: 'Última atualização',
              value: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--',
              neon: NEON.amber },
          ].map(m => (
            <div key={m.label} style={{ borderRadius: 18, padding: '16px 18px', background: m.neon.bg, border: `1px solid ${m.neon.border}`, boxShadow: `0 0 22px ${m.neon.glow}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.25em', color: m.neon.hex, fontWeight: 700, opacity: 0.85, marginBottom: 6 }}>{m.label}</p>
                  <p style={{ fontSize: 32, fontWeight: 900, color: m.neon.hex, textShadow: `0 0 20px ${m.neon.glow}`, lineHeight: 1 }}>{m.value}</p>
                </div>
                <div style={{ padding: 10, borderRadius: 12, background: `${m.neon.hex}22`, color: m.neon.hex, boxShadow: `0 0 16px ${m.neon.glow}` }}>
                  {m.icon}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 20 }}>
          {/* PIPELINE */}
          <div style={{ flex: '1.9', display: 'grid', gridTemplateColumns: isPortrait ? '1fr' : 'repeat(2,1fr)', gap: 16 }}>
            {LIVE_COLUMNS.map(col => {
              const colLeads = leadsByColumn[col.id] || [];
              const n = col.neon;
              return (
                <section key={col.id} style={{ borderRadius: 24, padding: 1.5, background: `linear-gradient(135deg,${n.hex}66,${n.hex}15)`, boxShadow: `0 0 32px ${n.glow}` }}>
                  <div style={{ borderRadius: 23, background: '#070716', padding: 20, height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <div>
                        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.35)', fontWeight: 700 }}>Status</p>
                        <h2 style={{ fontSize: 22, fontWeight: 800, color: n.hex, textShadow: `0 0 16px ${n.glow}`, marginTop: 2 }}>{col.title}</h2>
                      </div>
                      <div style={{ minWidth: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: n.bg, border: `1.5px solid ${n.border}`, color: n.hex, fontWeight: 900, fontSize: 14, boxShadow: `0 0 10px ${n.glow}` }}>
                        {colLeads.length}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {colLeads.length === 0 ? (
                        <div style={{ borderRadius: 16, border: '1.5px dashed rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 14 }}>
                          Nenhum lead neste estágio
                        </div>
                      ) : colLeads.map(lead => (
                        <div key={lead.id} style={{ borderRadius: 16, border: `1.5px solid ${n.border}`, background: n.bg, padding: 16, boxShadow: `0 0 12px ${n.glow}` }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ minWidth: 0 }}>
                              <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {lead.lead_name || 'Lead sem nome'}
                              </h3>
                              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                                {(lead.remote_jid || '').replace('@s.whatsapp.net', '')}
                              </p>
                            </div>
                            <div style={{ padding: '4px 10px', borderRadius: 99, background: n.bg, border: `1px solid ${n.border}`, color: n.hex, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {formatRelative(lead.last_interaction_at)}
                            </div>
                          </div>
                          {lead.summary && (
                            <p style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as any}>
                              {lead.summary}
                            </p>
                          )}
                          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div style={{ borderRadius: 12, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)', padding: '8px 12px' }}>
                              <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>Agente</p>
                              <p style={{ marginTop: 4, fontSize: 14, fontWeight: 600, color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{lead.agent?.name || 'Pedro'}</p>
                            </div>
                            <div style={{ borderRadius: 12, background: n.bg, border: `1.5px solid ${n.border}`, padding: '8px 12px' }}>
                              <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: n.hex, opacity: 0.75, fontWeight: 700 }}>Vendedor</p>
                              <p style={{ marginTop: 4, fontSize: 14, fontWeight: 800, color: n.hex, textShadow: `0 0 12px ${n.glow}`, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {lead.member?.name || 'Aguardando'}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          {/* SIDEBAR */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

            {/* Próximo da fila */}
            <section style={{ borderRadius: 24, background: '#070716', border: `1.5px solid ${NEON.cyan.border}`, padding: 20, boxShadow: `0 0 28px ${NEON.cyan.glow}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>Rodízio do Pedro</p>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>Próximo da fila</h2>
                </div>
                <Sparkles style={{ width: 22, height: 22, color: NEON.cyan.hex, filter: `drop-shadow(0 0 6px ${NEON.cyan.hex})` }} />
              </div>
              <div style={{ borderRadius: 18, background: NEON.cyan.bg, border: `1.5px solid ${NEON.cyan.border}`, padding: 18, boxShadow: `0 0 18px ${NEON.cyan.glow}` }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>Próximo vendedor a receber um lead qualificado</p>
                <p style={{ marginTop: 6, fontSize: 28, fontWeight: 900, color: NEON.cyan.hex, textShadow: `0 0 20px ${NEON.cyan.glow}` }}>
                  {nextSeller?.name || 'Nenhum vendedor ativo'}
                </p>
                <p style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                  {nextSeller?.whatsapp_number || 'Cadastre vendedores ativos para ativar o rodízio.'}
                </p>
              </div>

              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {memberStats.slice(0, 5).map((m, i) => {
                  const pal = SELLER_PALETTE[i % SELLER_PALETTE.length];
                  const isActive = m.is_active;
                  return (
                    <div key={m.id} className={isActive ? 'seller-active' : ''} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, background: pal.bg, border: `1.5px solid ${pal.border}`, padding: '12px 16px', boxShadow: isActive ? `0 0 22px ${pal.glow}` : 'none' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>#{i + 1}</p>
                        <p style={{ fontSize: 18, fontWeight: 900, color: pal.hex, textShadow: `0 0 14px ${pal.glow}`, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{m.name}</p>
                        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{m.whatsapp_number}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 30, fontWeight: 900, color: pal.hex, textShadow: `0 0 16px ${pal.glow}` }}>{m.todayCount}</p>
                        <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>Hoje</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Transferências recentes */}
            <section style={{ borderRadius: 24, background: '#070716', border: `1.5px solid ${NEON.amber.border}`, padding: 20, boxShadow: `0 0 20px ${NEON.amber.glow}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>Transferências recentes</p>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>Quem pegou o lead</h2>
                </div>
                <TrendingUp style={{ width: 20, height: 20, color: NEON.amber.hex, filter: `drop-shadow(0 0 5px ${NEON.amber.hex})` }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transfers.length === 0 ? (
                  <div style={{ borderRadius: 14, border: '1.5px dashed rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', padding: '28px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.25)' }}>
                    Nenhuma transferência registrada ainda.
                  </div>
                ) : transfers.map(t => (
                  <div key={t.id} style={{ borderRadius: 14, background: NEON.amber.bg, border: `1.5px solid ${NEON.amber.border}`, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {t.lead?.lead_name || t.lead?.remote_jid || 'Lead'}
                      </p>
                      <p style={{ fontSize: 12, color: NEON.amber.hex, marginTop: 2, fontWeight: 700, textShadow: `0 0 8px ${NEON.amber.glow}` }}>
                        {t.member?.name || 'Sem vendedor'} • {getTransferReasonLabel(t)}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 99, background: NEON.amber.bg, border: `1px solid ${NEON.amber.border}`, color: NEON.amber.hex, fontSize: 11, fontWeight: 700 }}>
                      {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Agentes em operação */}
            <section style={{ borderRadius: 24, background: '#070716', border: `1.5px solid ${NEON.purple.border}`, padding: 20, boxShadow: `0 0 20px ${NEON.purple.glow}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>Agentes em operação</p>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>Base do painel</h2>
                </div>
                <Users style={{ width: 20, height: 20, color: NEON.purple.hex, filter: `drop-shadow(0 0 5px ${NEON.purple.hex})` }} />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agents.length === 0 ? (
                  <p style={{ color: 'rgba(255,255,255,0.3)' }}>Nenhum agente encontrado.</p>
                ) : agents.map(a => (
                  <div key={a.id} style={{ padding: '6px 16px', borderRadius: 99, background: NEON.purple.bg, border: `1.5px solid ${NEON.purple.border}`, color: NEON.purple.hex, fontWeight: 700, fontSize: 13, boxShadow: `0 0 12px ${NEON.purple.glow}`, textShadow: `0 0 8px ${NEON.purple.glow}` }}>
                    {a.name}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
