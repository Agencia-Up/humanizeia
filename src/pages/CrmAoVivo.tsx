import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Activity,
  ArrowLeft,
  Bell,
  BellOff,
  CalendarClock,
  Crown,
  Expand,
  Flame,
  History as HistoryIcon,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/* ── Paleta corporativa — cores fortes, sem neon ─────── */
const C = {
  blue:   '#1565C0',  // azul forte
  cyan:   '#0097A7',  // ciano corporativo
  green:  '#2E7D32',  // verde sólido
  orange: '#E65100',  // laranja forte
  amber:  '#F57F17',  // âmbar escuro
  purple: '#6A1B9A',  // roxo corporativo
  red:    '#C62828',  // vermelho alerta
  // light variants (texto/ícones)
  blueL:   '#90CAF9',
  cyanL:   '#80DEEA',
  greenL:  '#A5D6A7',
  orangeL: '#FFCC80',
  amberL:  '#FFE082',
  purpleL: '#CE93D8',
  redL:    '#EF9A9A',
  // backgrounds sutis
  blueBg:   'rgba(21,101,192,0.18)',
  cyanBg:   'rgba(0,151,167,0.16)',
  greenBg:  'rgba(46,125,50,0.18)',
  orangeBg: 'rgba(230,81,0,0.18)',
  amberBg:  'rgba(245,127,23,0.16)',
  purpleBg: 'rgba(106,27,154,0.18)',
  redBg:    'rgba(198,40,40,0.18)',
};

const SELLER_PALETTE = [
  { main: C.blue,   light: C.blueL,   bg: C.blueBg },
  { main: C.orange, light: C.orangeL, bg: C.orangeBg },
  { main: C.cyan,   light: C.cyanL,   bg: C.cyanBg },
  { main: C.purple, light: C.purpleL, bg: C.purpleBg },
  { main: C.green,  light: C.greenL,  bg: C.greenBg },
  { main: C.amber,  light: C.amberL,  bg: C.amberBg },
];

const LIVE_COLUMNS = [
  { id: 'novo',        title: 'Novos Leads',    main: C.cyan,   light: C.cyanL,   bg: C.cyanBg },
  { id: 'interessado', title: 'Interessados',   main: C.amber,  light: C.amberL,  bg: C.amberBg },
  { id: 'qualificado', title: 'Qualificados',   main: C.green,  light: C.greenL,  bg: C.greenBg },
  { id: 'transferido', title: 'Em Atendimento', main: C.orange, light: C.orangeL, bg: C.orangeBg },
];

/* ── helpers ──────────────────────────────────────────── */
function formatRelative(d?: string | null) {
  if (!d) return '—';
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  if (m < 1) return 'Agora';
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60); return `${h}h${m % 60 > 0 ? `${m % 60}m` : ''}`;
}

function getTransferLabel(t: any) {
  if (t?.transfer_reason === 'manual') return 'Manual';
  if (t?.transfer_reason === 'round_robin') return 'Rodízio';
  if (String(t?.notes || '').toLowerCase().includes('round-robin')) return 'Rodízio';
  return 'Transferência';
}

function getNextInQueue(members: any[], transfers: any[]) {
  const active = members.filter(m => m.is_active);
  if (!active.length) return null;
  const last = new Map<string, Date>();
  for (const t of transfers) if (t?.to_member_id && !last.has(t.to_member_id)) last.set(t.to_member_id, new Date(t.created_at));
  const never = active.filter(m => !last.has(m.id));
  if (never.length) return never[0];
  return [...active].sort((a, b) => (last.get(a.id)?.getTime() || 0) - (last.get(b.id)?.getTime() || 0))[0] || null;
}

function getMemberStats(members: any[], transfers: any[]) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return members.map(m => ({
    ...m,
    todayCount: transfers.filter(t => t.to_member_id === m.id && new Date(t.created_at) >= today).length,
    totalCount: transfers.filter(t => t.to_member_id === m.id).length,
  })).sort((a, b) => b.todayCount - a.todayCount || b.totalCount - a.totalCount);
}

function playBell(muted: boolean) {
  if (muted) return;
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const bellNote = (freq: number, startTime: number, vol = 0.45) => {
      // inharmonic partials — characteristic of real bells
      ([
        [1.0, vol],
        [2.756, vol * 0.45],
        [5.404, vol * 0.18],
      ] as [number, number][]).forEach(([mult, gain]) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.value = freq * mult;
        osc.type = 'sine';
        g.gain.setValueAtTime(0, startTime);
        g.gain.linearRampToValueAtTime(gain, startTime + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + 1.8);
        osc.start(startTime); osc.stop(startTime + 1.85);
      });
    };
    bellNote(659, ctx.currentTime);        // "Ding" — Mi5
    bellNote(494, ctx.currentTime + 0.65); // "Dong" — Si4
  } catch (_) {}
}

/* ── component ────────────────────────────────────────── */
export default function CrmAoVivo({ embedded }: { embedded?: boolean } = {}) {
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
  const [muted, setMuted] = useState(false);
  const prevCount = useRef<number | null>(null);
  const [transferMessages, setTransferMessages] = useState<Record<string, string>>({});
  const [transferringLeadId, setTransferringLeadId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});


  useEffect(() => { const i = setInterval(() => setTick(p => !p), 900); return () => clearInterval(i); }, []);

  const fetchLiveData = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const [{ data: leadsData }, { data: transfersData }, { data: membersData }, { data: agentsData }] = await Promise.all([
        (supabase as any).from('ai_crm_leads').select('*, agent:wa_ai_agents(name), member:ai_team_members(name, whatsapp_number)')
          .eq('user_id', user.id).neq('status', 'encerrado').order('last_interaction_at', { ascending: false }),
        (supabase as any).from('ai_lead_transfers').select('*, member:ai_team_members(name), agent:wa_ai_agents(name), lead:ai_crm_leads(lead_name, remote_jid)')
          .eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
        (supabase as any).from('ai_team_members').select('*').eq('user_id', user.id)
          .order('is_active', { ascending: false }).order('last_lead_received_at', { ascending: true, nullsFirst: true }),
        (supabase as any).from('wa_ai_agents').select('id, name').eq('user_id', user.id),
      ]);
      setLeads(leadsData || []); setTransfers(transfersData || []);
      setTeamMembers(membersData || []); setAgents(agentsData || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (loading) return;
    if (prevCount.current === null) { prevCount.current = leads.length; return; }
    if (leads.length > prevCount.current) {
      playBell(muted); setNewLeadFlash(true); setTimeout(() => setNewLeadFlash(false), 3000);
    }
    prevCount.current = leads.length;
  }, [leads.length, loading, muted]);

  useEffect(() => {
    if (!user) return;
    const iv = window.setInterval(fetchLiveData, 120000);
    const ch = supabase.channel('crm-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_crm_leads',    filter: `user_id=eq.${user.id}` }, fetchLiveData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_lead_transfers',filter: `user_id=eq.${user.id}` }, fetchLiveData)
      .subscribe();
    return () => { window.clearInterval(iv); supabase.removeChannel(ch); };
  }, [fetchLiveData, user]);

  useEffect(() => {
    const h = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', h); return () => window.removeEventListener('resize', h);
  }, []);

  const activeMembers  = useMemo(() => teamMembers.filter(m => m.is_active), [teamMembers]);
  const memberStats    = useMemo(() => getMemberStats(activeMembers, transfers), [activeMembers, transfers]);
  const nextSeller     = useMemo(() => getNextInQueue(teamMembers, transfers), [teamMembers, transfers]);
  const leadsByColumn  = useMemo(() =>
    Object.fromEntries(LIVE_COLUMNS.map(col => [col.id, leads.filter(l => (l.status || 'novo') === col.id).slice(0, isPortrait ? 4 : 6)])),
  [isPortrait, leads]) as Record<string, any[]>;

  const totalQualified = leads.filter(l => l.status === 'qualificado' || l.status === 'transferido').length;
  const attendedNow    = leads.filter(l => l.status === 'transferido').length;

  const handleFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  const handleManualTransfer = async (leadId: string) => {
    if (!nextSeller || !user) return;
    const msg = transferMessages[leadId] || '';
    setTransferringLeadId(leadId);
    
    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer', {
        body: {
          leadId,
          memberId: nextSeller.id,
          notes: msg
        }
      });

      if (error) throw error;

      // 3. Registrar no histórico geral de tarefas do Salomão (opcional, mas solicitado pelo usuário anteriormente)
      try {
        await (supabase as any).from('orchestrator_tasks').insert({
          user_id: user.id,
          lead_id: leadId,
          title: 'Transferência de Lead (Manual)',
          description: `Lead transferido para ${nextSeller.name}. ${msg ? `Mensagem: ${msg}` : ''}`,
          status: 'completed',
          created_at: new Date().toISOString()
        });
      } catch (e) {
        console.warn('orchestrator_tasks not found or error:', e);
      }

      setTransferMessages(prev => { const n = { ...prev }; delete n[leadId]; return n; });
      fetchLiveData();
    } catch (e) {
      console.error('Transfer error:', e);
    } finally {
      setTransferringLeadId(null);
    }
  };


  /* ── estilos base ───────────────────────────────────── */
  const card: React.CSSProperties = {
    borderRadius: 14,
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.10)',
  };

  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <>{children}</> : ({ children }: { children: React.ReactNode }) => <>{children}</>; // CrmAoVivo already doesn't use MainLayout in its return

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0F1A', color: C.cyanL }}>
      <Loader2 className="h-8 w-8 animate-spin" style={{ marginRight: 12 }} />
      <span style={{ fontSize: 18, fontWeight: 600 }}>Carregando CRM ao vivo...</span>
    </div>
  );

  return (
    <Wrapper>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.3} }
        @keyframes slide-in { from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none} }
        @keyframes active-pulse { 0%,100%{opacity:1}50%{opacity:.75} }
        .seller-active { animation: active-pulse 2s ease-in-out infinite; }
        .alert-badge { animation: slide-in .3s ease-out; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#0B0F1A', color: '#E2E8F0', fontFamily: "'Inter','Segoe UI',sans-serif" }}>

        {/* ── TOP BAR ─────────────────────────────────── */}
        {!embedded && (
          <div style={{ background: '#0F1629', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* logo strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, borderRight: '1px solid rgba(255,255,255,0.12)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: '#fff' }}>L</div>
                <span style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '-0.3px' }}>LogosIA</span>
              </div>

              {/* badge CRM */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: C.cyanBg, border: `1px solid ${C.cyan}`, color: C.cyanL, fontSize: 12, fontWeight: 700 }}>
                <MonitorPlay style={{ width: 13, height: 13 }} />
                CRM Ao Vivo
              </div>

              {/* badge ao vivo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: C.greenBg, border: `1px solid ${C.green}`, color: C.greenL, fontSize: 12, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: tick ? 'blink .9s step-end infinite' : 'none' }} />
                <Activity style={{ width: 13, height: 13 }} />
                Tempo real
              </div>

              {/* alerta novo lead */}
              {newLeadFlash && (
                <div className="alert-badge" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 6, background: C.redBg, border: `1.5px solid ${C.red}`, color: C.redL, fontSize: 13, fontWeight: 800 }}>
                  <Bell style={{ width: 14, height: 14 }} />
                  NOVO LEAD
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" variant="outline" style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: 13 }} onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/dashboard')}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Voltar
              </Button>
              <Button size="sm" variant="outline" style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: 13 }} onClick={fetchLiveData}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={muted ? 'Ativar campainha' : 'Silenciar campainha'}
                style={{
                  borderColor: muted ? 'rgba(255,255,255,0.15)' : C.amber,
                  background: muted ? 'transparent' : C.amberBg,
                  color: muted ? '#64748B' : C.amberL,
                  fontSize: 13,
                }}
                onClick={() => setMuted(m => !m)}
              >
                {muted ? <VolumeX className="mr-1.5 h-3.5 w-3.5" /> : <Volume2 className="mr-1.5 h-3.5 w-3.5" />}
                {muted ? 'Mudo' : 'Som ligado'}
              </Button>
              <Button size="sm" style={{ background: C.blue, color: '#fff', fontWeight: 700, fontSize: 13 }} onClick={handleFullscreen}>
                <Expand className="mr-1.5 h-3.5 w-3.5" /> Tela cheia
              </Button>
            </div>
          </div>
        )}

        {/* ── PAGE TITLE ─────────────────────────────── */}
        {!embedded && (
          <div style={{ padding: '22px 24px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h1 style={{ fontSize: 36, fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.5px', margin: 0 }}>Central de Leads</h1>
            <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: 14 }}>
              Painel para TV — leads em tempo real, vendedor responsável e próximo da fila.
            </p>
          </div>
        )}

        {/* ── MÉTRICAS ──────────────────────────────── */}
        <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 12 }}>
          {[
            { icon: <Users    className="h-5 w-5" />, label: 'Leads no painel',    value: leads.length,         main: C.blue,   light: C.blueL,   bg: C.blueBg },
            { icon: <Flame    className="h-5 w-5" />, label: 'Leads qualificados', value: totalQualified,       main: C.green,  light: C.greenL,  bg: C.greenBg },
            { icon: <UserCheck className="h-5 w-5" />,label: 'Em atendimento',     value: attendedNow,          main: C.orange, light: C.orangeL, bg: C.orangeBg },
            { icon: <Crown    className="h-5 w-5" />, label: 'Vendedores ativos',  value: activeMembers.length, main: C.purple, light: C.purpleL, bg: C.purpleBg },
            { icon: <CalendarClock className="h-5 w-5" />, label: 'Última atualização',
              value: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--',
              main: C.cyan, light: C.cyanL, bg: C.cyanBg },
          ].map(m => (
            <div key={m.label} style={{ ...card, padding: '14px 16px', borderLeft: `4px solid ${m.main}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748B', fontWeight: 700, marginBottom: 6 }}>{m.label}</p>
                  <p style={{ fontSize: 30, fontWeight: 800, color: m.light, lineHeight: 1 }}>{m.value}</p>
                </div>
                <div style={{ padding: 10, borderRadius: 10, background: m.bg, color: m.light }}>
                  {m.icon}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── BODY ─────────────────────────────────── */}
        <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 20 }}>

          {/* PIPELINE */}
          <div style={{ flex: '1.9', display: 'grid', gridTemplateColumns: isPortrait ? '1fr' : 'repeat(2,1fr)', gap: 16 }}>
            {LIVE_COLUMNS.map(col => {
              const colLeads = leadsByColumn[col.id] || [];
              return (
                <section key={col.id} style={{ ...card, overflow: 'hidden' }}>
                  {/* header colorido */}
                  <div style={{ background: col.bg, borderBottom: `2px solid ${col.main}`, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: col.light, fontWeight: 700, opacity: 0.7 }}>Status</p>
                      <h2 style={{ fontSize: 18, fontWeight: 800, color: col.light, marginTop: 1 }}>{col.title}</h2>
                    </div>
                    <div style={{ width: 30, height: 30, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: col.main, color: '#fff', fontWeight: 900, fontSize: 15 }}>
                      {colLeads.length}
                    </div>
                  </div>



                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {colLeads.length === 0 ? (
                      <div style={{ borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
                        Nenhum lead neste estágio
                      </div>
                    ) : colLeads.map(lead => (
                      <div key={lead.id} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#16213E', padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#F1F5F9', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {lead.lead_name || 'Lead sem nome'}
                            </h3>
                            <p style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                              {(lead.remote_jid || '').replace('@s.whatsapp.net', '')}
                            </p>
                          </div>
                          <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, background: col.bg, border: `1px solid ${col.main}`, color: col.light, fontSize: 11, fontWeight: 700 }}>
                            {formatRelative(lead.last_interaction_at)}
                          </span>
                        </div>
                        {lead.summary && (
                          <p style={{ marginTop: 8, fontSize: 12, color: '#94A3B8', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as any}>
                            {lead.summary}
                          </p>
                        )}
                        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                          <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', padding: '7px 10px' }}>
                            <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#475569', fontWeight: 700 }}>Agente</p>
                            <p style={{ marginTop: 3, fontSize: 13, fontWeight: 600, color: '#CBD5E1', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{lead.agent?.name || 'Pedro'}</p>
                          </div>
                          <div style={{ borderRadius: 8, background: col.bg, border: `1px solid ${col.main}`, padding: '7px 10px' }}>
                            <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: col.light, fontWeight: 700, opacity: 0.7 }}>Vendedor</p>
                            <p style={{ marginTop: 3, fontSize: 13, fontWeight: 800, color: col.light, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {lead.member?.name || 'Aguardando'}
                            </p>
                          </div>
                        </div>

                        {/* Ações e Histórico */}
                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              placeholder="Observação para o vendedor..."
                              value={transferMessages[lead.id] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setTransferMessages(p => ({ ...p, [lead.id]: val }));
                              }}
                              style={{
                                flex: 1,
                                padding: '6px 8px',
                                fontSize: 11,
                                borderRadius: 6,
                                background: 'rgba(0,0,0,0.4)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                color: '#fff',
                                outline: 'none'
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              title="Ver histórico"
                              onClick={() => setShowHistory(p => ({ ...p, [lead.id]: !p[lead.id] }))}
                              style={{ 
                                borderColor: 'rgba(255,255,255,0.1)', 
                                background: showHistory[lead.id] ? C.blueBg : 'transparent',
                                color: showHistory[lead.id] ? C.blueL : '#64748B',
                                padding: '0 8px'
                              }}
                            >
                              <HistoryIcon style={{ width: 14, height: 14 }} />
                            </Button>
                          </div>

                          <Button
                            size="sm"
                            disabled={transferringLeadId === lead.id || !nextSeller}
                            style={{
                              background: lead.status === 'transferido' ? 'transparent' : C.orange,
                              border: lead.status === 'transferido' ? `1px solid ${C.orange}` : 'none',
                              color: lead.status === 'transferido' ? C.orangeL : '#fff',
                              fontWeight: 800,
                              fontSize: 11,
                              height: 32,
                              borderRadius: 8,
                              boxShadow: lead.status === 'transferido' ? 'none' : '0 4px 12px rgba(230,81,0,0.2)'
                            }}
                            onClick={() => handleManualTransfer(lead.id)}
                          >
                            {transferringLeadId === lead.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                            )}
                            {lead.status === 'transferido' ? 'Re-transferir lead' : `Transferir para ${nextSeller?.name || 'fila'}`}
                          </Button>

                          {/* Mini Histórico */}
                          {showHistory[lead.id] && (
                            <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                              <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', fontWeight: 700, marginBottom: 4 }}>Histórico de transferências</p>
                              {transfers.filter(t => t.lead_id === lead.id).length === 0 ? (
                                <p style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>Nenhuma transferência registrada.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {transfers.filter(t => t.lead_id === lead.id).map(t => (
                                    <div key={t.id} style={{ fontSize: 10.5, color: '#94A3B8', borderLeft: `2px solid ${C.orange}`, paddingLeft: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <strong style={{ color: C.orangeL }}>{t.member?.name || 'Vendedor'}</strong>
                                        <span style={{ fontSize: 9, opacity: 0.6 }}>{new Date(t.created_at).toLocaleDateString()}</span>
                                      </div>
                                      {t.notes && <p style={{ marginTop: 2, color: '#CBD5E1' }}>"{t.notes}"</p>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {/* SIDEBAR */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

            {/* Próximo da fila */}
            <section style={{ ...card, overflow: 'hidden' }}>
              <div style={{ background: C.cyanBg, borderBottom: `2px solid ${C.cyan}`, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.cyanL, fontWeight: 700, opacity: 0.7 }}>Rodízio do Pedro</p>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: C.cyanL, marginTop: 1 }}>Próximo da fila</h2>
                </div>
                <Sparkles style={{ width: 20, height: 20, color: C.cyanL }} />
              </div>

              <div style={{ padding: 14 }}>
                <div style={{ borderRadius: 10, background: C.cyanBg, border: `1px solid ${C.cyan}`, padding: '14px 16px', marginBottom: 12 }}>
                  <p style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>Próximo vendedor a receber lead qualificado</p>
                  <p style={{ fontSize: 22, fontWeight: 900, color: C.cyanL }}>
                    {nextSeller?.name || 'Nenhum vendedor ativo'}
                  </p>
                  <p style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
                    {nextSeller?.whatsapp_number || 'Cadastre vendedores ativos para ativar o rodízio.'}
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {memberStats.slice(0, 5).map((m, i) => {
                    const pal = SELLER_PALETTE[i % SELLER_PALETTE.length];
                    return (
                      <div key={m.id} className={m.is_active ? 'seller-active' : ''} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, background: pal.bg, border: `1.5px solid ${pal.main}`, padding: '10px 14px' }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 10, color: '#475569', fontWeight: 700, marginBottom: 1 }}>#{i + 1} {m.is_active ? '● Ativo' : '○ Inativo'}</p>
                          <p style={{ fontSize: 16, fontWeight: 800, color: pal.light, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{m.name}</p>
                          <p style={{ fontSize: 11, color: '#475569' }}>{m.whatsapp_number}</p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: 26, fontWeight: 900, color: pal.light, lineHeight: 1 }}>{m.todayCount}</p>
                          <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#475569', fontWeight: 700 }}>Hoje</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Transferências recentes */}
            <section style={{ ...card, overflow: 'hidden' }}>
              <div style={{ background: C.amberBg, borderBottom: `2px solid ${C.amber}`, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.amberL, fontWeight: 700, opacity: 0.7 }}>Transferências recentes</p>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: C.amberL, marginTop: 1 }}>Quem pegou o lead</h2>
                </div>
                <TrendingUp style={{ width: 20, height: 20, color: C.amberL }} />
              </div>

              <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {transfers.length === 0 ? (
                  <div style={{ borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '24px 16px', textAlign: 'center', color: '#475569' }}>
                    Nenhuma transferência registrada ainda.
                  </div>
                ) : transfers.map(t => (
                  <div key={t.id} style={{ borderRadius: 10, background: C.amberBg, border: `1px solid ${C.amber}`, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#F1F5F9', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {t.lead?.lead_name || t.lead?.remote_jid || 'Lead'}
                      </p>
                      <p style={{ fontSize: 12, color: C.amberL, marginTop: 2, fontWeight: 600 }}>
                        {t.member?.name || 'Sem vendedor'} · {getTransferLabel(t)}
                      </p>
                    </div>
                    <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.amber}`, color: C.amberL, fontSize: 11, fontWeight: 700 }}>
                      {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Agentes em operação */}
            <section style={{ ...card, overflow: 'hidden' }}>
              <div style={{ background: C.purpleBg, borderBottom: `2px solid ${C.purple}`, padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.purpleL, fontWeight: 700, opacity: 0.7 }}>Agentes em operação</p>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: C.purpleL, marginTop: 1 }}>Base do painel</h2>
                </div>
                <Users style={{ width: 20, height: 20, color: C.purpleL }} />
              </div>
              <div style={{ padding: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agents.length === 0 ? (
                  <p style={{ color: '#475569', fontSize: 13 }}>Nenhum agente encontrado.</p>
                ) : agents.map(a => (
                  <span key={a.id} style={{ padding: '6px 14px', borderRadius: 6, background: C.purpleBg, border: `1px solid ${C.purple}`, color: C.purpleL, fontWeight: 700, fontSize: 13 }}>
                    {a.name}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
