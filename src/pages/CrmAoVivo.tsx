import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Button } from '@/components/ui/button';
import {
  Activity,
  ArrowLeft,
  Bell,
  CalendarClock,
  CalendarDays,
  Crown,
  Expand,
  Flame,
  GripVertical,
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
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

/* ── Filtro de período ──────────────────────────────────── */
type DateFilter = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';
const DATE_FILTERS: { value: DateFilter; label: string }[] = [
  { value: 'today',  label: 'Hoje'          },
  { value: '7d',     label: '7 dias'        },
  { value: '30d',    label: '30 dias'       },
  { value: '90d',    label: '90 dias'       },
  { value: 'all',    label: 'Tudo'          },
  { value: 'custom', label: 'Personalizado' },
];
function getThreshold(f: DateFilter, customStart?: string): Date | null {
  if (f === 'all' || f === 'custom') return customStart ? new Date(customStart + 'T00:00:00') : null;
  const now = new Date();
  if (f === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const days = f === '7d' ? 7 : f === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/* ── Paleta corporativa — cores fortes ─────── */
const C = {
  blue:   '#1565C0',
  cyan:   '#0097A7',
  green:  '#2E7D32',
  orange: '#E65100',
  amber:  '#F57F17',
  purple: '#6A1B9A',
  red:    '#C62828',
  blueL:   '#90CAF9',
  cyanL:   '#80DEEA',
  greenL:  '#A5D6A7',
  orangeL: '#FFCC80',
  amberL:  '#FFE082',
  purpleL: '#CE93D8',
  redL:    '#EF9A9A',
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
  return 'Transferência';
}

/* ── COMPONENTE CARD (Memoizado para performance) ─────────── */
const LiveLeadCard = memo(({ lead, col, nextSeller, transferringLeadId, onTransfer, transfers, dragHandleProps, hideTransfer }: any) => {
  const [msg, setMsg] = useState('');
  const [showHist, setShowHist] = useState(false);
  const isTransferring = transferringLeadId === lead.id;

  const leadTransfers = useMemo(() =>
    transfers.filter((t: any) => t.lead_id === lead.id),
  [transfers, lead.id]);

  return (
    <div style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: '#16213E', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        {/* Drag handle */}
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            style={{ cursor: 'grab', padding: '3px 4px 0 0', color: 'rgba(255,255,255,0.18)', flexShrink: 0, marginTop: 1 }}
            title="Arrastar para outra coluna"
          >
            <GripVertical style={{ width: 13, height: 13 }} />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
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

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            placeholder="Observação (campo personalizado)..."
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 11,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
              outline: 'none'
            }}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowHist(!showHist)}
            style={{ borderColor: 'rgba(255,255,255,0.1)', background: showHist ? C.blueBg : 'transparent', color: showHist ? C.blueL : '#64748B', padding: '0 8px' }}
          >
            <HistoryIcon style={{ width: 14, height: 14 }} />
          </Button>
        </div>

        {!hideTransfer && (
          <Button
            size="sm"
            disabled={isTransferring || !nextSeller}
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
            onClick={() => {
              onTransfer(lead.id, msg);
              setMsg('');
            }}
          >
            {isTransferring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
            )}
            {lead.status === 'transferido' ? 'Re-transferir lead' : `Transferir para ${nextSeller?.name || 'vendedor'}`}
          </Button>
        )}

        {showHist && (
          <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', fontWeight: 700, marginBottom: 4 }}>Histórico</p>
            {leadTransfers.length === 0 ? (
              <p style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>Nenhuma transferência registrada.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {leadTransfers.map((t: any) => (
                  <div key={t.id} style={{ fontSize: 10.5, color: '#94A3B8', borderLeft: `2px solid ${C.orange}`, paddingLeft: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ color: C.orangeL }}>{t.member?.name || 'Vendedor'}</strong>
                      <span style={{ fontSize: 9, opacity: 0.6 }}>{new Date(t.created_at).toLocaleTimeString()}</span>
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
  );
});

/* ── COMPONENTE PRINCIPAL ──────────────────────────────── */
export default function CrmAoVivo({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isSeller, seller } = useSellerProfile(user?.id);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight >= window.innerWidth);
  const [leads, setLeads] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [newLeadFlash, setNewLeadFlash] = useState(false);
  const [muted, setMuted] = useState(false);
  const prevCount = useRef<number | null>(null);
  const mutedRef = useRef(muted); // sempre atual para callbacks de subscription
  const [transferringLeadId, setTransferringLeadId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [exportingMarcos, setExportingMarcos] = useState(false);

  // Controla quais leads já foram enviados ao Marcos CRM nesta sessão (evita duplicatas)
  const syncedToMarcosRef = useRef<Set<string>>(new Set());

  useEffect(() => { mutedRef.current = muted; }, [muted]); // mantém ref sempre sincronizada

  const fetchLiveData = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    // Sellers use the master's user_id for filtering; RLS further restricts rows to only their leads
    const effectiveUserId = (isSeller && seller?.user_id) ? seller.user_id : user.id;
    try {
      const [{ data: leadsData }, { data: transfersData }, { data: membersData }, { data: agentsData }] = await Promise.all([
        (supabase as any).from('ai_crm_leads').select('*, agent:wa_ai_agents(name), member:ai_team_members(id, name, whatsapp_number)')
          .eq('user_id', effectiveUserId).neq('status', 'encerrado').order('last_interaction_at', { ascending: false }),
        (supabase as any).from('ai_lead_transfers').select('*, member:ai_team_members(name), agent:wa_ai_agents(name), lead:ai_crm_leads(lead_name, remote_jid)')
          .eq('user_id', effectiveUserId).order('created_at', { ascending: false }).limit(500),
        isSeller
          // Sellers see all team members of their master (for display), RLS allows this
          ? (supabase as any).from('ai_team_members').select('*').eq('user_id', effectiveUserId)
              .order('is_active', { ascending: false }).order('last_lead_received_at', { ascending: true, nullsFirst: true })
          : (supabase as any).from('ai_team_members').select('*').eq('user_id', user.id)
              .order('is_active', { ascending: false }).order('last_lead_received_at', { ascending: true, nullsFirst: true }),
        (supabase as any).from('wa_ai_agents').select('id, name').eq('user_id', effectiveUserId),
      ]);
      setLeads(leadsData || []); setTransfers(transfersData || []);
      setTeamMembers(membersData || []); setAgents(agentsData || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally { setLoading(false); }
  }, [user, isSeller, seller]);

  // Ref estável para o callback — evita recriar subscriptions a cada render
  const fetchLiveDataRef = useRef(fetchLiveData);
  useEffect(() => { fetchLiveDataRef.current = fetchLiveData; }, [fetchLiveData]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  // ── Auto-sync: envia leads transferidos para o CRM do Marcos ──────────────
  // Roda toda vez que leads muda; o Set evita re-enviar o mesmo lead.
  // Envia também para wa_contacts (lista de disparo) com nome do vendedor.
  const syncTransferredToMarcos = useCallback(async (transferredLeads: any[]) => {
    if (!user) return;
    const unsync = transferredLeads.filter(l => !syncedToMarcosRef.current.has(l.id));
    if (unsync.length === 0) return;

    // Busca o primeiro estágio do pipeline do Marcos (para posicionar no CRM)
    const { data: firstStage } = await (supabase as any)
      .from('crm_pipeline_stages')
      .select('id')
      .eq('user_id', user.id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    for (const lead of unsync) {
      try {
        const phone = (lead.remote_jid || '').replace(/\D/g, '');
        if (!phone) { syncedToMarcosRef.current.add(lead.id); continue; }

        const sellerName  = lead.member?.name  || 'Aguardando';
        const agentName   = lead.agent?.name   || 'Pedro SDR';
        const notes = `Vendedor: ${sellerName}\nAgente IA: ${agentName}${lead.summary ? `\n\nResumo: ${lead.summary}` : ''}`;
        const tags  = ['Pedro SDR', sellerName].filter(Boolean);

        // ── 1. crm_leads (FluxCRM / Kanban do Marcos) ───────────────────────
        const { data: existing } = await (supabase as any)
          .from('crm_leads')
          .select('id')
          .eq('user_id', user.id)
          .eq('phone', phone)
          .maybeSingle();

        if (existing?.id) {
          await (supabase as any).from('crm_leads').update({ notes, tags }).eq('id', existing.id);
        } else {
          await (supabase as any).from('crm_leads').insert({
            user_id:  user.id,
            stage_id: firstStage?.id || null,
            name:     lead.lead_name || phone,
            phone,
            source:   `Pedro SDR — ${agentName}`,
            notes,
            tags,
            value:    0,
            currency: 'BRL',
            priority: 'medium',
            position: 0,
          });
        }

        // ── 2. wa_contacts (lista "Leads Pedro CRM" para disparo) ───────────
        const { data: list } = await (supabase as any)
          .from('wa_contact_lists').select('id')
          .eq('user_id', user.id).eq('name', 'Leads Pedro CRM').maybeSingle();

        let listId = list?.id;
        if (!listId) {
          const { data: newList } = await (supabase as any)
            .from('wa_contact_lists')
            .insert({ user_id: user.id, name: 'Leads Pedro CRM', description: 'Leads qualificados pelo Pedro SDR' })
            .select('id').single();
          listId = newList?.id;
        }

        if (listId) {
          await (supabase as any).from('wa_contacts').upsert({
            user_id: user.id, list_id: listId, phone,
            name: lead.lead_name || phone,
            is_valid: true,
            metadata: {
              lead_status: lead.status, lead_summary: lead.summary,
              qualified_by: agentName, assigned_to: sellerName,
              assigned_to_phone: lead.member?.whatsapp_number || null,
              synced_at: new Date().toISOString(),
            },
          }, { onConflict: 'user_id,list_id,phone', ignoreDuplicates: false });
        }

        syncedToMarcosRef.current.add(lead.id);
      } catch (err) {
        console.error('[CrmAoVivo] Erro ao sincronizar lead com Marcos:', err);
      }
    }
  }, [user]);

  // Dispara o sync sempre que novos leads 'transferido' aparecem
  useEffect(() => {
    if (loading) return;
    const transferred = leads.filter(l => l.status === 'transferido');
    if (transferred.length > 0) syncTransferredToMarcos(transferred);
  }, [leads, loading, syncTransferredToMarcos]);

  // ── Alerta de novo lead ───────────────────────────────────────────────────
  // Dispara alerta visual + campainha quando leads.length aumenta após o
  // carregamento inicial. Não depende de muted (usa mutedRef para evitar
  // stale closure e re-execuções desnecessárias quando muted muda).
  useEffect(() => {
    if (loading) return;
    if (prevCount.current === null) {
      prevCount.current = leads.length; // inicializa silenciosamente na 1ª carga
      return;
    }
    if (leads.length > prevCount.current) {
      playBell(mutedRef.current);
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 4000);
    }
    prevCount.current = leads.length;
  }, [leads.length, loading]); // ← muted FORA das deps — usa ref para evitar re-runs

  // ── Realtime + polling ────────────────────────────────────────────────────
  // Subscription criada UMA ÚNICA VEZ por sessão de user.
  // INSERT → dispara alerta diretamente (mais confiável que detecção por contagem)
  //          + atualiza dados
  // UPDATE / DELETE → só atualiza dados (drag-and-drop não gera alertas)
  useEffect(() => {
    if (!user) return;
    const iv = window.setInterval(() => fetchLiveDataRef.current(), 30000); // 30s fallback poll

    const triggerNewLeadAlert = () => {
      playBell(mutedRef.current);
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 4000);
    };

    const ch = supabase
      .channel(`crm-ao-vivo-${user.id}`)   // nome único por usuário evita conflito de canais
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` },
        (payload) => {
          // Alerta apenas para leads não-encerrados
          if ((payload.new as any)?.status !== 'encerrado') {
            triggerNewLeadAlert();
          }
          fetchLiveDataRef.current();
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` },
        () => fetchLiveDataRef.current()
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` },
        () => fetchLiveDataRef.current()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ai_lead_transfers', filter: `user_id=eq.${user.id}` },
        () => fetchLiveDataRef.current()
      )
      .subscribe();

    return () => { window.clearInterval(iv); supabase.removeChannel(ch); };
  }, [user]); // apenas user

  useEffect(() => {
    const h = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', h); return () => window.removeEventListener('resize', h);
  }, []);

  const activeMembers  = useMemo(() => teamMembers.filter(m => m.is_active), [teamMembers]);

  // Leads filtrados pelo período selecionado
  const filteredLeads = useMemo(() => {
    const threshold = getThreshold(dateFilter, customStart);
    const endDate = dateFilter === 'custom' && customEnd
      ? new Date(customEnd + 'T23:59:59')
      : null;
    if (!threshold && !endDate) return leads;
    return leads.filter(l => {
      const d = new Date(l.created_at || l.last_interaction_at);
      if (threshold && d < threshold) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }, [leads, dateFilter, customStart, customEnd]);

  // Contagem de hoje (sempre fixa no KPI, independente do filtro)
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const todayLeadsCount = useMemo(
    () => leads.filter(l => new Date(l.created_at || l.last_interaction_at) >= todayStart).length,
    [leads, todayStart]
  );

  const nextSeller = useMemo(() => {
    if (!activeMembers.length) return null;
    // Usa last_lead_received_at do próprio membro — atualizado tanto por transferência
    // manual quanto automática do Pedro SDR, nunca fica desatualizado
    const never = activeMembers.filter(m => !m.last_lead_received_at);
    if (never.length) return never[0];
    return [...activeMembers].sort((a, b) =>
      new Date(a.last_lead_received_at).getTime() - new Date(b.last_lead_received_at).getTime()
    )[0] || null;
  }, [activeMembers]);

  const memberStats = useMemo(() => {
    // ── Usa ai_lead_transfers para contar atendimentos por vendedor ──────────
    // Mais confiável do que o join FK de leads.member (que depende do assigned_to_id
    // estar preenchido) e não usa transferred_at (campo que não existe na tabela).
    const threshold = getThreshold(dateFilter, customStart);
    const endDate = dateFilter === 'custom' && customEnd ? new Date(customEnd + 'T23:59:59') : null;
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);

    return activeMembers.map(m => {
      // Transfers deste vendedor que não expiraram (pending ou confirmed)
      const myTransfers = transfers.filter(t =>
        t.to_member_id === m.id && t.transfer_status !== 'expired'
      );

      // Leads únicos no período — usa lead_id quando disponível, senão usa id do transfer
      const periodSet = new Set(
        myTransfers.filter(t => {
          const d = new Date(t.created_at);
          if (threshold && d < threshold) return false;
          if (endDate && d > endDate) return false;
          return true;
        }).map(t => t.lead_id || t.id)
      );

      const todaySet = new Set(
        myTransfers
          .filter(t => new Date(t.created_at) >= todayDate)
          .map(t => t.lead_id || t.id)
      );

      return {
        ...m,
        periodCount: periodSet.size,
        todayCount:  todaySet.size,
        totalCount:  new Set(myTransfers.map(t => t.lead_id || t.id)).size,
      };
    }).sort((a, b) => b.periodCount - a.periodCount || b.todayCount - a.todayCount);
  }, [activeMembers, transfers, dateFilter, customStart, customEnd]);

  const leadsByColumn = useMemo(() => {
    const res: Record<string, any[]> = {};
    LIVE_COLUMNS.forEach(col => {
      res[col.id] = filteredLeads.filter(l => (l.status || 'novo') === col.id);
    });
    return res;
  }, [filteredLeads]);

  // ── Exportar/forçar sync de TODOS leads do filtro para Marcos ─────────────
  const handleExportToMarcos = useCallback(async () => {
    if (!user || filteredLeads.length === 0) return;
    setExportingMarcos(true);
    try {
      // Limpa o cache de synced para forçar re-sync de todos do filtro
      filteredLeads.forEach(l => syncedToMarcosRef.current.delete(l.id));
      await syncTransferredToMarcos(filteredLeads.filter(l => l.status === 'transferido'));
      // Para leads não-transferidos (interessado/qualificado), envia só para wa_contacts
      const nonTransferred = filteredLeads.filter(l => l.status !== 'transferido');
      if (nonTransferred.length > 0) {
        const { data: list } = await (supabase as any)
          .from('wa_contact_lists').select('id')
          .eq('user_id', user.id).eq('name', 'Leads Pedro CRM').maybeSingle();
        let listId = list?.id;
        if (!listId) {
          const { data: newList } = await (supabase as any)
            .from('wa_contact_lists')
            .insert({ user_id: user.id, name: 'Leads Pedro CRM', description: 'Leads qualificados pelo Pedro SDR' })
            .select('id').single();
          listId = newList?.id;
        }
        if (listId) {
          const batch = nonTransferred.map(l => ({
            user_id: user.id, list_id: listId,
            phone: (l.remote_jid || '').replace(/\D/g, ''),
            name: l.lead_name || (l.remote_jid || '').replace(/\D/g, ''),
            is_valid: true,
            metadata: {
              lead_status: l.status, lead_summary: l.summary,
              qualified_by: l.agent?.name || 'Pedro SDR',
              assigned_to: l.member?.name || null,
              synced_at: new Date().toISOString(),
            },
          })).filter(c => c.phone);
          for (let i = 0; i < batch.length; i += 50) {
            await (supabase as any).from('wa_contacts')
              .upsert(batch.slice(i, i + 50), { onConflict: 'user_id,list_id,phone', ignoreDuplicates: false });
          }
        }
      }
      toast.success(`✅ ${filteredLeads.length} leads sincronizados com o Marcos (CRM + lista de contatos)`);
    } catch (err: any) {
      toast.error(`Erro ao exportar: ${err.message}`);
    } finally {
      setExportingMarcos(false);
    }
  }, [user, filteredLeads, syncTransferredToMarcos]);

  // ── Drag-and-drop: muda status do lead entre colunas ─────────────────────
  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const newStatus = destination.droppableId;
    const leadId = draggableId;

    // Optimistic update — move card imediatamente na UI
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));

    // Persistir no banco
    const { error } = await (supabase as any)
      .from('ai_crm_leads')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (error) {
      console.error('Erro ao atualizar status do lead:', error);
      toast.error('Erro ao mover lead — revertendo');
      fetchLiveDataRef.current(); // rollback via refetch
    }
  }, []);

  const totalQualified = filteredLeads.filter(l => l.status === 'qualificado' || l.status === 'transferido').length;
  const attendedNow    = filteredLeads.filter(l => l.status === 'transferido').length;

  const handleManualTransfer = useCallback(async (leadId: string, notes: string) => {
    if (!nextSeller || !user) return;
    setTransferringLeadId(leadId);
    
    try {
      const { error } = await supabase.functions.invoke('manual-transfer', {
        body: { leadId, memberId: nextSeller.id, notes }
      });
      if (error) throw error;
      fetchLiveData();
    } catch (e) {
      console.error('Transfer error:', e);
    } finally {
      setTransferringLeadId(null);
    }
  }, [nextSeller, user, fetchLiveData]);

  // Atualizar manualmente com feedback visual
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchLiveData();
    } finally {
      setRefreshing(false);
    }
  }, [fetchLiveData]);

  // Mute toggle — também faz warm-up do AudioContext para garantir que o som funcione
  const handleMuteToggle = useCallback(async () => {
    await warmUpAudio();   // resume o contexto singleton na interação do usuário
    setMuted(m => !m);
  }, []);

  const handleFullscreen = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 14,
    background: '#111827',
    border: '1px solid rgba(255,255,255,0.10)',
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0F1A', color: C.cyanL }}>
      <Loader2 className="h-8 w-8 animate-spin mr-3" />
      <span style={{ fontSize: 18, fontWeight: 600 }}>Carregando CRM ao vivo...</span>
    </div>
  );

  return (
    <div style={{ minHeight: embedded ? '100%' : '100vh', height: embedded ? '100%' : undefined, overflowY: embedded ? 'auto' : undefined, background: '#0B0F1A', color: '#E2E8F0', fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.3} }
        @keyframes slide-in { from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none} }
        @keyframes active-pulse { 0%,100%{opacity:1}50%{opacity:.75} }
        .seller-active { animation: active-pulse 2s ease-in-out infinite; }
        .alert-badge { animation: slide-in .3s ease-out; }
      `}</style>

      {/* ── TOP BAR ─────────────────────────────────── */}
      {!embedded && (
        <div style={{ background: '#0F1629', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, borderRight: '1px solid rgba(255,255,255,0.12)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: '#fff' }}>L</div>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '-0.3px' }}>LogosIA</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: C.cyanBg, border: `1px solid ${C.cyan}`, color: C.cyanL, fontSize: 12, fontWeight: 700 }}>
              <MonitorPlay style={{ width: 13, height: 13 }} />
              CRM Ao Vivo
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, background: C.greenBg, border: `1px solid ${C.green}`, color: C.greenL, fontSize: 12, fontWeight: 700 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'blink .9s step-end infinite' }} />
              <Activity style={{ width: 13, height: 13 }} />
              Tempo real
            </div>
            {newLeadFlash && (
              <div className="alert-badge" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 14px', borderRadius: 6, background: C.redBg, border: `1.5px solid ${C.red}`, color: C.redL, fontSize: 13, fontWeight: 800 }}>
                <Bell style={{ width: 14, height: 14 }} />
                NOVO LEAD
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="outline" style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: 13 }} onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Painel
            </Button>
            <Button size="sm" variant="outline" disabled={refreshing} style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'transparent', color: '#cbd5e1', fontSize: 13 }} onClick={handleRefresh}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5${refreshing ? ' animate-spin' : ''}`} /> {refreshing ? 'Atualizando…' : 'Atualizar'}
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
              onClick={handleMuteToggle}
            >
              {muted ? <VolumeX className="mr-1.5 h-3.5 w-3.5" /> : <Volume2 className="mr-1.5 h-3.5 w-3.5" />}
              {muted ? 'Mudo' : 'Campainha'}
            </Button>
            <Button size="sm" style={{ background: C.blue, color: '#fff', fontWeight: 700, fontSize: 13 }} onClick={handleFullscreen}>
              <Expand className="mr-1.5 h-3.5 w-3.5" /> Tela cheia
            </Button>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────── */}
      {!embedded && (
        <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#F8FAFC', margin: 0 }}>Distribuição Live — Pedro</h1>
          <p style={{ margin: '6px 0 0', color: '#64748B', fontSize: 14 }}>
            Monitoramento de leads qualificados pelo Pedro e transferência manual para vendedores.
          </p>
        </div>
      )}

      {/* ── FILTRO DE PERÍODO ─────────────────────── */}
      <div style={{ padding: '0 24px 8px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CalendarDays style={{ width: 14, height: 14, color: '#64748B' }} />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B' }}>Período</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {DATE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setDateFilter(f.value)}
              style={{
                padding: '5px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: dateFilter === f.value
                  ? f.value === 'custom' ? C.purple : C.cyan
                  : 'rgba(255,255,255,0.06)',
                color: dateFilter === f.value ? '#fff' : '#94A3B8',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Date range inputs — visible only when 'custom' is selected */}
        {dateFilter === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#94A3B8' }}>De</span>
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              style={{
                background: 'rgba(106,27,154,0.2)',
                border: `1px solid ${C.purple}`,
                borderRadius: 8,
                color: '#E9D5FF',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 11, color: '#94A3B8' }}>até</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              style={{
                background: 'rgba(106,27,154,0.2)',
                border: `1px solid ${C.purple}`,
                borderRadius: 8,
                color: '#E9D5FF',
                fontSize: 12,
                padding: '4px 10px',
                cursor: 'pointer',
                outline: 'none',
              }}
            />
          </div>
        )}

        {dateFilter !== 'all' && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6, background: C.cyanBg, border: `1px solid ${C.cyan}`, color: C.cyanL }}>
            {filteredLeads.length} de {leads.length} leads
          </span>
        )}

        {/* Export to Marcos button */}
        <button
          onClick={handleExportToMarcos}
          disabled={exportingMarcos || filteredLeads.length === 0}
          style={{
            marginLeft: 'auto',
            padding: '5px 14px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            border: `1px solid ${C.green}`,
            cursor: exportingMarcos || filteredLeads.length === 0 ? 'not-allowed' : 'pointer',
            background: 'rgba(46,125,50,0.15)',
            color: exportingMarcos || filteredLeads.length === 0 ? '#64748B' : C.greenL,
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Exportar leads do período para lista de contatos do Marcos (disparo em massa / follow-up)"
        >
          {exportingMarcos ? '⏳' : '📤'} Exportar para Marcos ({filteredLeads.length})
        </button>
      </div>

      {/* ── MÉTRICAS ──────────────────────────────── */}
      <div style={{ padding: '8px 24px 20px', display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 14 }}>
        {[
          { icon: <Users className="h-5 w-5" />, label: dateFilter === 'all' ? 'Leads no pipeline' : dateFilter === 'custom' ? `Leads — ${customStart || '?'} a ${customEnd || '?'}` : `Leads — ${DATE_FILTERS.find(f=>f.value===dateFilter)?.label}`, value: filteredLeads.length, main: C.blue, light: C.blueL, bg: C.blueBg },
          { icon: <Flame className="h-5 w-5" />, label: 'Qualificados', value: totalQualified, main: C.green, light: C.greenL, bg: C.greenBg },
          { icon: <UserCheck className="h-5 w-5" />, label: 'Em atendimento', value: attendedNow, main: C.orange, light: C.orangeL, bg: C.orangeBg },
          { icon: <Crown className="h-5 w-5" />, label: 'Vendedores online', value: activeMembers.length, main: C.purple, light: C.purpleL, bg: C.purpleBg },
          { icon: <CalendarClock className="h-5 w-5" />, label: 'Atualização',
            value: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--',
            main: C.cyan, light: C.cyanL, bg: C.cyanBg },
        ].map(m => (
          <div key={m.label} style={{ ...cardStyle, padding: '16px', borderLeft: `4px solid ${m.main}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ color: m.main }}>{m.icon}</div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748B' }}>{m.label}</p>
            </div>
            <p style={{ fontSize: 28, fontWeight: 900, color: m.light, margin: 0 }}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* ── KANBAN + SIDEBAR ──────────────────────── */}
      <div style={{ padding: '0 24px 40px', display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 24 }}>
        
        {/* COLUNAS KANBAN — com Drag & Drop */}
        <DragDropContext onDragEnd={handleDragEnd}>
          <div style={{ flex: isPortrait ? 'none' : 3, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 16 }}>
            {LIVE_COLUMNS.map(col => {
              const colLeads = leadsByColumn[col.id] || [];
              return (
                <section key={col.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: isPortrait ? '100%' : 260 }}>
                  {/* Cabeçalho da coluna */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.main }} />
                    <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: col.light }}>{col.title}</h2>
                    <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, marginLeft: 'auto' }}>{colLeads.length}</span>
                  </div>

                  {/* Droppable — área de drop */}
                  <Droppable droppableId={col.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          minHeight: 90,
                          maxHeight: isPortrait ? 'none' : 'calc(100vh - 340px)',
                          overflowY: 'auto',
                          borderRadius: 12,
                          padding: snapshot.isDraggingOver ? '8px 8px' : '0',
                          background: snapshot.isDraggingOver ? col.bg : 'transparent',
                          border: snapshot.isDraggingOver ? `1.5px dashed ${col.main}` : '1.5px solid transparent',
                          transition: 'background 0.15s, border 0.15s, padding 0.15s',
                        }}
                      >
                        {colLeads.length === 0 && !snapshot.isDraggingOver && (
                          <div style={{ borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>
                            Arraste um lead aqui
                          </div>
                        )}

                        {colLeads.map((lead, index) => (
                          <Draggable key={lead.id} draggableId={lead.id} index={index}>
                            {(prov, snap) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                style={{
                                  ...prov.draggableProps.style,
                                  opacity: snap.isDragging ? 0.92 : 1,
                                  boxShadow: snap.isDragging ? '0 12px 32px rgba(0,0,0,0.5)' : 'none',
                                  borderRadius: 10,
                                }}
                              >
                                <LiveLeadCard
                                  lead={lead}
                                  col={col}
                                  nextSeller={nextSeller}
                                  transferringLeadId={transferringLeadId}
                                  onTransfer={handleManualTransfer}
                                  transfers={transfers}
                                  dragHandleProps={prov.dragHandleProps}
                                  hideTransfer={isSeller}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </section>
              );
            })}
          </div>
        </DragDropContext>

        {/* SIDEBAR — hidden for sellers */}
        {!isSeller && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          
          {/* PRÓXIMO DA FILA */}
          <section style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ background: C.cyanBg, borderBottom: `2px solid ${C.cyan}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.cyanL, fontWeight: 700, opacity: 0.7 }}>Rodízio Inteligente</p>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: C.cyanL, marginTop: 1 }}>Próximo Vendedor</h2>
              </div>
              <Sparkles style={{ width: 20, height: 20, color: C.cyanL }} />
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ borderRadius: 10, background: C.cyanBg, border: `1px solid ${C.cyan}`, padding: '16px', marginBottom: 12 }}>
                <p style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>O Pedro enviará o próximo para:</p>
                <p style={{ fontSize: 24, fontWeight: 900, color: C.cyanL }}>
                  {nextSeller?.name || 'Nenhum ativo'}
                </p>
                <p style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                  {nextSeller?.whatsapp_number || 'Sem número configurado'}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {memberStats.slice(0, 5).map((m, i) => {
                  const pal = SELLER_PALETTE[i % SELLER_PALETTE.length];
                  const periodLabel = dateFilter === 'today' ? 'Hoje'
                    : dateFilter === '7d' ? '7 dias'
                    : dateFilter === '30d' ? '30 dias'
                    : dateFilter === '90d' ? '90 dias'
                    : dateFilter === 'custom' ? `${customStart || '?'} → ${customEnd || '?'}`
                    : 'Total';
                  return (
                    <div key={m.id} className={m.is_active ? 'seller-active' : ''} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, background: pal.bg, border: `1.5px solid ${pal.main}`, padding: '12px' }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 10, color: '#475569', fontWeight: 700, marginBottom: 2 }}>#{i + 1} {m.is_active ? '● Ativo' : '○ Off'}</p>
                        <p style={{ fontSize: 16, fontWeight: 800, color: pal.light, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{m.name}</p>
                        {dateFilter !== 'today' && (
                          <p style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Hoje: {m.todayCount}</p>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 24, fontWeight: 900, color: pal.light, lineHeight: 1 }}>{m.periodCount}</p>
                        <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#475569', fontWeight: 700 }}>{periodLabel}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* TRANSFERÊNCIAS RECENTES */}
          <section style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ background: C.amberBg, borderBottom: `2px solid ${C.amber}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.amberL, fontWeight: 700, opacity: 0.7 }}>Log de Transferências</p>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: C.amberL, marginTop: 1 }}>Histórico Recente</h2>
              </div>
              <TrendingUp style={{ width: 20, height: 20, color: C.amberL }} />
            </div>

            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {transfers.length === 0 ? (
                <div style={{ borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '24px 16px', textAlign: 'center', color: '#475569' }}>
                  Aguardando movimentações...
                </div>
              ) : transfers.slice(0, 30).map(t => (
                <div key={t.id} style={{ borderRadius: 10, background: C.amberBg, border: `1px solid ${C.amber}`, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#F1F5F9', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {t.lead?.lead_name || 'Lead'}
                    </p>
                    <p style={{ fontSize: 12, color: C.amberL, marginTop: 2, fontWeight: 600 }}>
                      → {t.member?.name || 'Vendedor'}
                    </p>
                  </div>
                  <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 5, background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.amber}`, color: C.amberL, fontSize: 11, fontWeight: 700 }}>
                    {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>}
      </div>
    </div>
  );
}

// ── AudioContext singleton ──────────────────────────────────────────────────
// Browsers block audio until the user interacts with the page (autoplay policy).
// We keep a single AudioContext alive and call resume() before playing so that
// sounds triggered by Realtime subscriptions (no user gesture) still work after
// the user has already interacted at least once (e.g. clicked the mute toggle).
let _sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _sharedAudioCtx;
}

// Call this inside any user-gesture handler to unlock audio for the session.
async function warmUpAudio(): Promise<void> {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (_) {}
}

async function playBell(muted: boolean) {
  if (muted) return;
  try {
    const ctx = getAudioCtx();
    // Resume in case context was suspended (autoplay policy)
    if (ctx.state === 'suspended') await ctx.resume();

    const bellNote = (freq: number, startTime: number, vol = 0.45) => {
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
    bellNote(659, ctx.currentTime);
    bellNote(494, ctx.currentTime + 0.65);
  } catch (_) {}
}
