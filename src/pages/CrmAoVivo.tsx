import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { usePendingTransfers, formatPendingAge, type PendingTransfer } from '@/hooks/usePendingTransfers';
import { Button } from '@/components/ui/button';
import { CplTrafegoPago } from '@/components/crm/CplTrafegoPago';
import {
  Activity,
  ArrowLeft,
  Bell,
  CalendarClock,
  CalendarDays,
  Crown,
  DollarSign,
  Expand,
  Flame,
  GripVertical,
  History as HistoryIcon,
  Loader2,
  MonitorPlay,
  Phone,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  Volume2,
  VolumeX,
  X,
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
  { id: 'novo',               title: 'Novos Leads',      main: C.cyan,   light: C.cyanL,   bg: C.cyanBg },
  { id: 'interessado',        title: 'Interessados',     main: C.amber,  light: C.amberL,  bg: C.amberBg },
  { id: 'pouco_qualificado',  title: 'Pouco Qualif.',    main: C.red,    light: C.redL,    bg: C.redBg },
  { id: 'medio_qualificado',  title: 'Médio Qualif.',    main: C.orange, light: C.orangeL, bg: C.orangeBg },
  { id: 'qualificado',        title: 'Qualificados',     main: C.green,  light: C.greenL,  bg: C.greenBg },
  { id: 'em_atendimento',     title: 'Atendimento IA',   main: C.purple, light: C.purpleL, bg: C.purpleBg },
  { id: 'transferido',        title: 'Em Atendimento',   main: C.blue,   light: C.blueL,   bg: C.blueBg },
];

/* ── helpers ──────────────────────────────────────────── */
const CRM_STATUS_COLUMNS = [
  { id: 'novo',                 title: 'Novo',                 main: C.cyan,   light: C.cyanL,   bg: C.cyanBg },
  { id: 'inativo',              title: 'Lead Inativo',         main: C.red,    light: C.redL,    bg: C.redBg },
  { id: 'carro_nao_disponivel', title: 'Carro não disponível', main: C.red,    light: C.redL,    bg: C.redBg },
  { id: 'em_atendimento',       title: 'Agendamento',          main: C.purple, light: C.purpleL, bg: C.purpleBg },
  { id: 'negociacao',           title: 'Negociação',           main: C.orange, light: C.orangeL, bg: C.orangeBg },
  { id: 'fechado',              title: 'Fechado',              main: C.green,  light: C.greenL,  bg: C.greenBg },
  { id: 'perdido',              title: 'Perdido',              main: C.red,    light: C.redL,    bg: C.redBg },
];

const PEDRO_LIVE_COLUMNS = [
  { id: 'nao_transferido', title: 'Não transferido', main: C.amber, light: C.amberL, bg: C.amberBg, assignmentOnly: true },
  ...CRM_STATUS_COLUMNS,
];

const CRM_STATUS_IDS = new Set(CRM_STATUS_COLUMNS.map(col => col.id));

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
function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCostDateBounds(f: DateFilter, customStart?: string, customEnd?: string) {
  const today = new Date();
  if (f === 'all') return { from: null as string | null, to: null as string | null };
  if (f === 'custom') {
    return {
      from: customStart || null,
      to: customEnd || customStart || null,
    };
  }
  const from = getThreshold(f, customStart) || today;
  return { from: formatDateKey(from), to: formatDateKey(today) };
}

function formatLeadPhone(raw?: string | null) {
  const digits = String(raw || '').replace(/\D/g, '');
  const br = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return br || 'Sem telefone';
}

const LiveLeadCard = memo(({ lead, col, nextSeller, activeMembers, transferringLeadId, onTransfer, transfers, dragHandleProps, hideTransfer, pendingTransfer, onStatusChange, statusUpdatingLeadId }: any) => {
  const [msg, setMsg] = useState('');
  const [showHist, setShowHist] = useState(false);
  // Vendedor escolhido pelo master no select. Se vazio, usa nextSeller (round-robin).
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');

  // BUG-NOVO-10: state local pode ficar apontando pra vendedor que sumiu
  // (desativado por outro master, deletado, etc.). Sem este reset, o <select>
  // mostra a primeira opção visualmente mas state ainda guarda o ID antigo —
  // master clica "Transferir" e manda pro vendedor inativo, recebe erro.
  useEffect(() => {
    if (selectedSellerId && !activeMembers?.some((m: any) => m.id === selectedSellerId)) {
      setSelectedSellerId('');
    }
  }, [activeMembers, selectedSellerId]);

  const isTransferring = transferringLeadId === lead.id;
  const isUpdatingStatus = statusUpdatingLeadId === lead.id;
  const targetSellerId = selectedSellerId || nextSeller?.id || null;
  const targetSellerName = selectedSellerId
    ? (activeMembers?.find((m: any) => m.id === selectedSellerId)?.name || 'selecionado')
    : (nextSeller?.name || 'vendedor');
  const hasSellerOrPending = Boolean(lead.assigned_to_id || pendingTransfer);

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
        <p style={{ marginTop: 8, fontSize: 12, color: '#94A3B8', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-line' } as any}>
          {lead.summary}
        </p>
      )}

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={{ borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', padding: '7px 10px' }}>
          <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#475569', fontWeight: 700 }}>Agente</p>
          <p style={{ marginTop: 3, fontSize: 13, fontWeight: 600, color: '#CBD5E1', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{lead.agent?.name || 'Pedro'}</p>
        </div>
        {/* BUG-NOVO-04: badge muda se transfer ainda pending (vendedor nao confirmou Ok) */}
        <div
          style={{
            borderRadius: 8,
            background: !lead.member && pendingTransfer ? 'rgba(245,158,11,0.15)' : col.bg,
            border: `1px solid ${!lead.member && pendingTransfer ? 'rgba(245,158,11,0.5)' : col.main}`,
            padding: '7px 10px',
          }}
          title={!lead.member && pendingTransfer
            ? `${pendingTransfer.member_name} aguardando confirmacao via WhatsApp ${pendingTransfer.created_at ? formatPendingAge(pendingTransfer.created_at) : ''}. Reescala em 15min se nao responder.`
            : undefined}
        >
          <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: !lead.member && pendingTransfer ? '#fbbf24' : col.light, fontWeight: 700, opacity: 0.7 }}>
            {!lead.member && pendingTransfer ? '⏳ Aguardando' : 'Vendedor'}
          </p>
          <p style={{ marginTop: 3, fontSize: 13, fontWeight: 800, color: !lead.member && pendingTransfer ? '#fcd34d' : col.light, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {lead.member?.name || pendingTransfer?.member_name || 'Sem vendedor'}
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

        <select
          value={CRM_STATUS_IDS.has(lead.status_crm) ? lead.status_crm : 'novo'}
          onChange={(e) => onStatusChange?.(lead.id, e.target.value)}
          disabled={isUpdatingStatus}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 11,
            borderRadius: 8,
            background: 'rgba(0,0,0,0.25)',
            border: `1px solid ${col.main}`,
            color: '#fff',
            outline: 'none',
          }}
          title="Etapa do CRM Avançado"
        >
          {CRM_STATUS_COLUMNS.map((status) => (
            <option key={status.id} value={status.id}>{status.title}</option>
          ))}
        </select>

        {!hideTransfer && (
          <>
            {/* Select de vendedor — vazio = round-robin (nextSeller). Master
                pode forçar um vendedor especifico aqui. */}
            {activeMembers && activeMembers.length > 0 && (
              <select
                value={selectedSellerId}
                onChange={(e) => setSelectedSellerId(e.target.value)}
                disabled={isTransferring}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: 11,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff',
                  outline: 'none',
                }}
              >
                <option value="">Rodízio automático ({nextSeller?.name || 'sem vendedor ativo'})</option>
                {activeMembers.map((m: any) => (
                  <option key={m.id} value={m.id}>👤 {m.name}</option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              disabled={isTransferring || !targetSellerId}
              style={{
                background: hasSellerOrPending ? 'transparent' : C.orange,
                border: hasSellerOrPending ? `1px solid ${C.orange}` : 'none',
                color: hasSellerOrPending ? C.orangeL : '#fff',
                fontWeight: 800,
                fontSize: 11,
                height: 32,
                borderRadius: 8,
                boxShadow: hasSellerOrPending ? 'none' : '0 4px 12px rgba(230,81,0,0.2)'
              }}
              onClick={() => {
                onTransfer(lead.id, msg, selectedSellerId || undefined);
                setMsg('');
                setSelectedSellerId('');
              }}
            >
              {isTransferring ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
              )}
              {hasSellerOrPending ? 'Re-transferir lead' : `Transferir para ${targetSellerName}`}
            </Button>
          </>
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

const TvLeadCard = memo(({ lead, col, pendingTransfer }: any) => {
  const phone = String(lead.remote_jid || '').replace('@s.whatsapp.net', '');

  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(12,18,34,0.92)',
      padding: 10,
      minHeight: 102,
      boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 13, lineHeight: 1.15, fontWeight: 850, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.lead_name || 'Lead sem nome'}
          </h3>
          <p style={{ marginTop: 3, fontSize: 10.5, color: '#7C8AA5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {phone}
          </p>
        </div>
        <span style={{ flexShrink: 0, borderRadius: 6, border: `1px solid ${col.main}`, background: col.bg, color: col.light, padding: '3px 7px', fontSize: 10, fontWeight: 800 }}>
          {formatRelative(lead.last_interaction_at)}
        </span>
      </div>

      {lead.summary && (
        <p style={{
          marginTop: 7,
          fontSize: 10.5,
          lineHeight: 1.35,
          color: '#A7B4CF',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          whiteSpace: 'pre-line',
        } as any}>
          {lead.summary}
        </p>
      )}

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ minWidth: 0, color: '#7C8AA5', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.agent?.name || 'Pedro'}
        </span>
        <span
          style={{
            maxWidth: '58%',
            borderRadius: 6,
            background: !lead.member && pendingTransfer ? 'rgba(245,158,11,0.18)' : 'rgba(37,99,235,0.18)',
            color: !lead.member && pendingTransfer ? '#fcd34d' : '#93C5FD',
            padding: '3px 7px',
            fontSize: 10.5,
            fontWeight: 800,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={!lead.member && pendingTransfer ? `Aguardando ${pendingTransfer.member_name} confirmar (ate 15min)` : undefined}
        >
          {lead.member?.name || pendingTransfer?.member_name || 'Sem vendedor'}
        </span>
      </div>
    </div>
  );
});

/* ── COMPONENTE PRINCIPAL ──────────────────────────────── */
export default function CrmAoVivo({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [sellerMemberIds, setSellerMemberIds] = useState<string[]>([]);

  // effectiveUserId: master's ID for sellers, own ID for masters
  // null while sellerProfile is loading to avoid queries with wrong ID
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);

  // Fetch all member IDs for the seller (may have records across multiple agents)
  useEffect(() => {
    if (!isSeller || !user?.id) { setSellerMemberIds([]); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('ai_team_members')
        .select('id')
        .eq('auth_user_id', user.id);
      setSellerMemberIds(Array.isArray(data) ? data.map((r: any) => r.id) : []);
    })();
  }, [isSeller, user?.id]);
  const [refreshing, setRefreshing] = useState(false);
  const [isPortrait, setIsPortrait] = useState(() => window.innerHeight >= window.innerWidth);
  const [leads, setLeads] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [totalAdSpend, setTotalAdSpend] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [detailSellerId, setDetailSellerId] = useState('');
  const [detailNotes, setDetailNotes] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [newLeadFlash, setNewLeadFlash] = useState(false);
  const [muted, setMuted] = useState(false);
  const prevCount = useRef<number | null>(null);
  const mutedRef = useRef(muted); // sempre atual para callbacks de subscription
  const [transferringLeadId, setTransferringLeadId] = useState<string | null>(null);
  const [statusUpdatingLeadId, setStatusUpdatingLeadId] = useState<string | null>(null);
  // Abre em "Tudo" (igual ao CRM avançado) pra a contagem de leads bater — lead
  // transferido/adicionado manualmente entrou em outro dia, mas é lead de tráfego
  // pago e tem que contar. O usuário ainda pode filtrar por "Hoje" quando quiser.
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [exportingMarcos, setExportingMarcos] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [branding, setBranding] = useState<{ logo_url: string | null; company_name: string | null }>({ logo_url: null, company_name: null });
  const containerRef = useRef<HTMLDivElement>(null);

  // Controla quais leads já foram enviados ao Marcos CRM nesta sessão (evita duplicatas)
  const syncedToMarcosRef = useRef<Set<string>>(new Set());

  useEffect(() => { mutedRef.current = muted; }, [muted]); // mantém ref sempre sincronizada

  const fetchLiveData = useCallback(async () => {
    if (!user || !effectiveUserId) { setLoading(false); return; }
    try {
      // ── Estratégia "JOIN no JS": query simples + hidratação no frontend ──
      // Evita JOIN PostgREST que falhava silenciosamente (RLS de wa_ai_agents).
      let leadsQ = (supabase as any).from('ai_crm_leads')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('last_interaction_at', { ascending: false })
        .limit(2000); // teto alto: sem isso o PostgREST corta em 1000 e a contagem não bateria com o CRM avançado
      if (isSeller && sellerMemberIds.length > 0) {
        leadsQ = leadsQ.in('assigned_to_id', sellerMemberIds);
      }

      // Lista do Marcos (crm_leads) — juntada no painel pra mostrar TODOS os leads
      // do cliente (Pedro + Marcos). Dedupe por telefone mais abaixo.
      let crmLeadsQ = (supabase as any).from('crm_leads')
        .select('id, name, phone, created_at, arrived_at, assigned_to, stage_id, origem')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (isSeller && sellerMemberIds.length > 0) {
        crmLeadsQ = crmLeadsQ.in('assigned_to', sellerMemberIds);
      }

      const [leadsRes, crmLeadsRes, transfersRes, membersRes, agentsRes, brandingRes] = await Promise.all([
        leadsQ,
        crmLeadsQ,
        (supabase as any).from('ai_lead_transfers').select('*, member:ai_team_members!ai_lead_transfers_to_member_id_fkey(name), lead:ai_crm_leads(lead_name, remote_jid)')
          .eq('user_id', effectiveUserId).order('created_at', { ascending: false }).limit(500),
        (supabase as any).from('ai_team_members').select('*').eq('user_id', effectiveUserId)
          .order('is_active', { ascending: false }).order('last_lead_received_at', { ascending: true, nullsFirst: true }),
        (supabase as any).from('wa_ai_agents').select('id, name, is_active').eq('user_id', effectiveUserId),
        // Branding (logo + nome) sempre do MASTER — o vendedor logado tambem ve a marca do master dele.
        (supabase as any).from('profiles').select('dashboard_tv_logo_url, dashboard_tv_company_name').eq('id', effectiveUserId).maybeSingle(),
      ]);

      const bp = (brandingRes as any)?.data || {};
      setBranding({ logo_url: bp.dashboard_tv_logo_url || null, company_name: bp.dashboard_tv_company_name || null });

      if ((leadsRes as any)?.error) console.error('[CrmAoVivo] ERRO ao buscar leads:', (leadsRes as any).error);
      const rawLeads = leadsRes.data || [];
      const agentsArr = agentsRes.data || [];
      const activeAgentIds = new Set(agentsArr.filter((a: any) => a.is_active !== false).map((a: any) => a.id));
      const teamArr = (membersRes.data || []).filter((member: any) =>
        !member.agent_id || activeAgentIds.has(member.agent_id)
      );

      // Hidrata member + agent via lookup map (evita N+1 e JOIN PostgREST quebrado)
      const teamById = new Map(teamArr.map((t: any) => [t.id, { id: t.id, name: t.name, whatsapp_number: t.whatsapp_number }]));
      const agentsById = new Map(agentsArr.map((a: any) => [a.id, { name: a.name }]));
      const leadsData = rawLeads.map((l: any) => ({
        ...l,
        member: l.assigned_to_id ? (teamById.get(l.assigned_to_id) ?? null) : null,
        agent: l.agent_id ? (agentsById.get(l.agent_id) ?? null) : null,
      }));

      // ── Junta a lista do Marcos (crm_leads), SEM repetir (dedupe por telefone) ──
      // Telefone normalizado: tira o "55" do Brasil pra bater Pedro (5511...) com
      // Marcos (11...). Lead que ja esta na lista do Pedro nao entra de novo; se o
      // do Marcos tiver data de chegada e o do Pedro nao, o do Pedro herda a data.
      const normPhone = (raw: string): string => {
        const d = (raw || '').replace(/\D/g, '');
        return (d.startsWith('55') && (d.length === 12 || d.length === 13)) ? d.slice(2) : d;
      };
      const aiByPhone = new Map<string, any>();
      for (const l of leadsData) {
        const k = normPhone(l.remote_jid || '');
        if (k) aiByPhone.set(k, l);
      }
      const marcosLeads: any[] = [];
      for (const c of (((crmLeadsRes as any)?.data) || [])) {
        const k = normPhone(c.phone || '');
        const dupe = k ? aiByPhone.get(k) : null;
        if (dupe) {
          if (c.arrived_at && !dupe.arrived_at) dupe.arrived_at = c.arrived_at;
          continue;
        }
        marcosLeads.push({
          id: c.id,
          lead_name: c.name,
          remote_jid: c.phone,
          created_at: c.created_at,
          arrived_at: c.arrived_at || null,
          last_interaction_at: c.created_at,
          assigned_to_id: c.assigned_to || null,
          agent_id: null,
          status_crm: 'novo',
          origem: c.origem || null,
          _crm: 'marcos', // marca: lead da lista do Marcos (crm_leads), nao do Pedro
          member: c.assigned_to ? (teamById.get(c.assigned_to) ?? null) : null,
          agent: null,
        });
      }
      const mergedLeads = [...leadsData, ...marcosLeads];

      setLeads(mergedLeads); setTransfers(transfersRes.data || []);
      setTeamMembers(teamArr); setAgents(agentsArr);
      setLastUpdatedAt(new Date().toISOString());
    } finally { setLoading(false); }
  }, [user, effectiveUserId, isSeller, sellerMemberIds]);

  // Ref estável para o callback — evita recriar subscriptions a cada render
  const fetchLiveDataRef = useRef(fetchLiveData);
  useEffect(() => { fetchLiveDataRef.current = fetchLiveData; }, [fetchLiveData]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (!effectiveUserId || isSeller) {
      setTotalAdSpend(0);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const bounds = getCostDateBounds(dateFilter, customStart, customEnd);
        let q = (supabase as any)
          .from('campaign_costs')
          .select('entity_level, spend, date')
          .eq('user_id', effectiveUserId);

        if (bounds.from) q = q.gte('date', bounds.from);
        if (bounds.to) q = q.lte('date', bounds.to);

        const { data, error } = await q;
        if (error) throw error;

        const rows = Array.isArray(data) ? data : [];
        const level = rows.some((r: any) => r.entity_level === 'campaign')
          ? 'campaign'
          : rows.some((r: any) => r.entity_level === 'adset')
            ? 'adset'
            : 'ad';
        const spend = rows
          .filter((r: any) => r.entity_level === level)
          .reduce((sum: number, r: any) => sum + (Number(r.spend) || 0), 0);

        if (!cancelled) setTotalAdSpend(spend);
      } catch (error) {
        console.warn('[CrmAoVivo] erro ao buscar custos de campanha', error);
        if (!cancelled) setTotalAdSpend(0);
      }
    })();

    return () => { cancelled = true; };
  }, [effectiveUserId, isSeller, dateFilter, customStart, customEnd]);

  // ── Auto-sync: envia leads transferidos para o CRM do Marcos ──────────────
  // Roda toda vez que leads muda; o Set evita re-enviar o mesmo lead.
  // Envia também para wa_contacts (lista de disparo) com nome do vendedor.
  // Normaliza telefone: remove "55" do Brasil para bater com o formato do crm_leads
  // remote_jid gera "5512996200820" (13 dígitos), mas crm_leads armazena "12996200820" (11 dígitos)
  const normalizePhone = useCallback((rawJid: string): string => {
    const digits = rawJid.replace(/\D/g, '');
    // BR com DDI: 13 dígitos (55 + DDD 2 + celular 9) ou 12 (55 + DDD 2 + fixo 8) → strip "55"
    if (digits.startsWith('55') && (digits.length === 13 || digits.length === 12)) {
      return digits.slice(2);
    }
    return digits;
  }, []);

  const syncTransferredToMarcos = useCallback(async (transferredLeads: any[]): Promise<{ synced: number; errors: number }> => {
    if (!effectiveUserId) return { synced: 0, errors: 0 };
    const unsync = transferredLeads.filter(l => !syncedToMarcosRef.current.has(l.id));
    if (unsync.length === 0) return { synced: 0, errors: 0 };

    let synced = 0, errors = 0;

    // Busca o primeiro estágio do pipeline do Marcos (para posicionar no CRM)
    const { data: firstStage } = await (supabase as any)
      .from('crm_pipeline_stages')
      .select('id')
      .eq('user_id', effectiveUserId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Busca a posição máxima atual no estágio para evitar colisão de posição
    const { data: maxPosRow } = await (supabase as any)
      .from('crm_leads')
      .select('position')
      .eq('user_id', effectiveUserId)
      .eq('stage_id', firstStage?.id || null)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextPosition = (maxPosRow?.position ?? -1) + 1;

    for (const lead of unsync) {
      try {
        const phone = normalizePhone(lead.remote_jid || '');
        if (!phone) { syncedToMarcosRef.current.add(lead.id); continue; }

        const sellerName  = lead.member?.name  || 'Aguardando';
        const agentName   = lead.agent?.name   || 'Pedro SDR';
        const notes = `Vendedor: ${sellerName}\nAgente IA: ${agentName}${lead.summary ? `\n\nResumo: ${lead.summary}` : ''}`;
        const tags  = ['Pedro SDR', sellerName].filter(Boolean);

        // ── 1. crm_leads (FluxCRM / Kanban do Marcos) ───────────────────────
        const { data: existing, error: lookupErr } = await (supabase as any)
          .from('crm_leads')
          .select('id')
          .eq('user_id', effectiveUserId)
          .eq('phone', phone)
          .maybeSingle();

        if (lookupErr) throw lookupErr;

        if (existing?.id) {
          const { error: updErr } = await (supabase as any)
            .from('crm_leads').update({ notes, tags }).eq('id', existing.id);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await (supabase as any).from('crm_leads').insert({
            user_id:  effectiveUserId,
            stage_id: firstStage?.id || null,
            name:     lead.lead_name || phone,
            phone,
            source:   `Pedro SDR — ${agentName}`,
            notes,
            tags,
            value:    0,
            currency: 'BRL',
            priority: 'medium',
            position: nextPosition++,
          });
          if (insErr) throw insErr;
        }

        // ── 2. wa_contacts (lista "Leads Pedro CRM" para disparo) ───────────
        const { data: list } = await (supabase as any)
          .from('wa_contact_lists').select('id')
          .eq('user_id', effectiveUserId).eq('name', 'Leads Pedro CRM').maybeSingle();

        let listId = list?.id;
        if (!listId) {
          const { data: newList } = await (supabase as any)
            .from('wa_contact_lists')
            .insert({ user_id: effectiveUserId, name: 'Leads Pedro CRM', description: 'Leads qualificados pelo Pedro SDR' })
            .select('id').single();
          listId = newList?.id;
        }

        if (listId) {
          await (supabase as any).from('wa_contacts').upsert({
            user_id: effectiveUserId, list_id: listId, phone,
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
        synced++;
      } catch (err) {
        console.error('[CrmAoVivo] Erro ao sincronizar lead com Marcos:', err);
        errors++;
      }
    }

    return { synced, errors };
  }, [effectiveUserId, normalizePhone]);

  // CRM do Marcos isolado: leads do Pedro nao sincronizam automaticamente
  // para o funil manual do Marcos.

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
    if (!user || !effectiveUserId) return;
    const iv = window.setInterval(() => fetchLiveDataRef.current(), 30000); // 30s fallback poll

    const triggerNewLeadAlert = () => {
      playBell(mutedRef.current);
      setNewLeadFlash(true);
      setTimeout(() => setNewLeadFlash(false), 4000);
    };

    const ch = supabase
      .channel(`crm-ao-vivo-${user.id}-${effectiveUserId}`)   // nome único por usuário/master
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${effectiveUserId}` },
        (payload) => {
          triggerNewLeadAlert();
          fetchLiveDataRef.current();
        }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${effectiveUserId}` },
        () => fetchLiveDataRef.current()
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${effectiveUserId}` },
        () => fetchLiveDataRef.current()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ai_lead_transfers', filter: `user_id=eq.${effectiveUserId}` },
        () => fetchLiveDataRef.current()
      )
      .subscribe();

    return () => { window.clearInterval(iv); supabase.removeChannel(ch); };
  }, [user, effectiveUserId]);

  useEffect(() => {
    const h = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', h); return () => window.removeEventListener('resize', h);
  }, []);

  // Vendedores VISÍVEIS no CRM/painel = ativos NO SISTEMA (fonte de verdade do
  // painel "Vendedores"). Independe do status no agente de IA — um vendedor
  // "Ausente" no agente (não recebe lead automático) CONTINUA aparecendo aqui.
  const visibleMembers = useMemo(() => teamMembers.filter(m => m.active_in_system !== false), [teamMembers]);
  // Vendedores elegíveis ao RODÍZIO automático = espelha o backend (uazapi-webhook
  // só distribui pra quem tem is_active=true). Usado só na prévia "próximo vendedor".
  const distributionMembers = useMemo(() => teamMembers.filter(m => m.is_active), [teamMembers]);
  // Exibição (dropdown de transferência manual, KPIs, stats) usa a lista do SISTEMA.
  const activeMembers = visibleMembers;

  // Leads filtrados pelo período selecionado
  const filteredLeads = useMemo(() => {
    const threshold = getThreshold(dateFilter, customStart);
    const endDate = dateFilter === 'custom' && customEnd
      ? new Date(customEnd + 'T23:59:59')
      : null;
    if (!threshold && !endDate) return leads;
    return leads.filter(l => {
      // arrived_at = data real de chegada informada pelo vendedor (lead de porta/
      // manual). Quando vazia (leads automaticos), cai no created_at.
      const d = new Date(l.arrived_at || l.created_at || l.last_interaction_at);
      if (threshold && d < threshold) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
  }, [leads, dateFilter, customStart, customEnd]);

  // BUG-NOVO-04: carrega pending transfers pros leads visiveis pra mostrar
  // badge amarela 'Aguardando' quando vendedor ainda nao confirmou Ok via WhatsApp.
  const visibleLeadIds = useMemo(() => filteredLeads.map(l => l.id), [filteredLeads]);
  const pendingTransfersMap = usePendingTransfers(visibleLeadIds);

  // Contagem de hoje (sempre fixa no KPI, independente do filtro)
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const todayLeadsCount = useMemo(
    () => leads.filter(l => new Date(l.arrived_at || l.created_at || l.last_interaction_at) >= todayStart).length,
    [leads, todayStart]
  );

  const nextSeller = useMemo(() => {
    if (!distributionMembers.length) return null;

    // Dedupe por TELEFONE (mesmo vendedor pode ter múltiplas rows em
    // ai_team_members, uma por agent_id). Sem dedupe, vendedor com 3 rows
    // domina a fila — backend só atualiza last_lead_received_at em 1 row.
    // Espelha lógica do backend (uazapi-webhook/uniqueSellersByPhone).
    const phoneKey = (num: string | null | undefined): string => {
      if (!num) return '';
      const digits = String(num).replace(/\D/g, '');
      // Últimos 10 dígitos (sem código país 55, sem 9 inicial de celular)
      const last10 = digits.slice(-10);
      return last10.length === 10 ? last10 : last10.slice(1);
    };
    const dedupedByPhone = (() => {
      const seen = new Set<string>();
      const out: any[] = [];
      for (const m of distributionMembers) {
        const key = phoneKey(m.whatsapp_number);
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        out.push(m);
      }
      return out;
    })();

    // Usa last_lead_received_at do próprio membro — atualizado tanto por transferência
    // manual quanto automática do Pedro SDR, nunca fica desatualizado
    const never = dedupedByPhone.filter(m => !m.last_lead_received_at);
    if (never.length) return never[0];
    return [...dedupedByPhone].sort((a, b) =>
      new Date(a.last_lead_received_at).getTime() - new Date(b.last_lead_received_at).getTime()
    )[0] || null;
  }, [distributionMembers]);

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
    PEDRO_LIVE_COLUMNS.forEach(col => {
      res[col.id] = [];
    });
    filteredLeads.forEach(lead => {
      const hasSellerOrPending = Boolean(lead.assigned_to_id || pendingTransfersMap.get(lead.id));
      const columnId = !hasSellerOrPending
        ? 'nao_transferido'
        : (CRM_STATUS_IDS.has(lead.status_crm) ? lead.status_crm : 'novo');
      res[columnId] = res[columnId] || [];
      res[columnId].push(lead);
    });
    return res;
  }, [filteredLeads, pendingTransfersMap]);

  const untransferredLeads = useMemo(
    () => filteredLeads.filter(lead => !lead.assigned_to_id && !pendingTransfersMap.get(lead.id)),
    [filteredLeads, pendingTransfersMap],
  );

  // CPL = gasto ÷ leads de TRÁFEGO PAGO (quem chegou pelo WhatsApp), sem misturar
  // com leads manuais de porta/marketplace/indicação/OLX/site. Mantém o KPI
  // coerente com a seção "Custo por Lead — Tráfego Pago".
  const MANUAL_ORIGEM_KPI = new Set(['porta', 'marketplace', 'indicacao', 'indicação', 'olx', 'site', 'importacao', 'importação', 'loja', 'presencial', 'feirao', 'feirão']);
  const paidFilteredCount = filteredLeads.filter(l => !MANUAL_ORIGEM_KPI.has((l.origem || '').trim().toLowerCase())).length;
  const costPerLead = paidFilteredCount > 0 ? totalAdSpend / paidFilteredCount : 0;
  const selectedLead = useMemo(
    () => selectedLeadId ? (leads.find(lead => lead.id === selectedLeadId) || null) : null,
    [leads, selectedLeadId],
  );

  useEffect(() => {
    setDetailSellerId('');
    setDetailNotes('');
  }, [selectedLeadId]);

  // ── Exportar/forçar sync de TODOS leads do filtro para Marcos ─────────────
  const handleExportToMarcos = useCallback(async () => {
    if (!effectiveUserId || filteredLeads.length === 0) return;
    setExportingMarcos(true);
    try {
      // Limpa o cache de synced para forçar re-sync de todos do filtro
      filteredLeads.forEach(l => syncedToMarcosRef.current.delete(l.id));

      // Envia leads transferidos para o CRM do Marcos (kanban FluxCRM).
      // Leads que ja vieram da lista do Marcos (_crm) sao ignorados — ja estao la.
      const transferred = filteredLeads.filter(l => l.status === 'transferido' && (l as any)._crm !== 'marcos');
      const { synced, errors } = await syncTransferredToMarcos(transferred);

      // Para leads não-transferidos (interessado/qualificado), envia só para wa_contacts
      const nonTransferred = filteredLeads.filter(l => l.status !== 'transferido' && (l as any)._crm !== 'marcos');
      let contactsSynced = 0;
      if (nonTransferred.length > 0) {
        const { data: list } = await (supabase as any)
          .from('wa_contact_lists').select('id')
          .eq('user_id', effectiveUserId).eq('name', 'Leads Pedro CRM').maybeSingle();
        let listId = list?.id;
        if (!listId) {
          const { data: newList } = await (supabase as any)
            .from('wa_contact_lists')
            .insert({ user_id: effectiveUserId, name: 'Leads Pedro CRM', description: 'Leads qualificados pelo Pedro SDR' })
            .select('id').single();
          listId = newList?.id;
        }
        if (listId) {
          const batch = nonTransferred
            .map(l => {
              const phone = normalizePhone(l.remote_jid || '');
              return {
                user_id: effectiveUserId, list_id: listId,
                phone,
                name: l.lead_name || phone,
                is_valid: true,
                metadata: {
                  lead_status: l.status, lead_summary: l.summary,
                  qualified_by: l.agent?.name || 'Pedro SDR',
                  assigned_to: l.member?.name || null,
                  synced_at: new Date().toISOString(),
                },
              };
            })
            .filter(c => c.phone);
          contactsSynced = batch.length;
          for (let i = 0; i < batch.length; i += 50) {
            await (supabase as any).from('wa_contacts')
              .upsert(batch.slice(i, i + 50), { onConflict: 'user_id,list_id,phone', ignoreDuplicates: false });
          }
        }
      }

      if (errors > 0) {
        toast.error(`⚠️ ${synced} leads enviados ao CRM do Marcos, ${errors} com erro (verifique console). ${contactsSynced} adicionados à lista de contatos.`);
      } else if (synced === 0 && contactsSynced === 0) {
        toast.warning('Nenhum lead transferido encontrado para exportar ao CRM do Marcos.');
      } else {
        toast.success(`✅ ${synced} leads enviados ao CRM do Marcos + ${contactsSynced} leads adicionados à lista de contatos.`);
      }
    } catch (err: any) {
      toast.error(`Erro ao exportar: ${err.message}`);
    } finally {
      setExportingMarcos(false);
    }
  }, [effectiveUserId, filteredLeads, syncTransferredToMarcos, normalizePhone]);

  // ── Drag-and-drop: muda status do lead entre colunas ─────────────────────
  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    if (destination.droppableId === 'nao_transferido') return;

    const newStatus = destination.droppableId;
    const leadId = draggableId;

    // Optimistic update — move card imediatamente na UI
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status_crm: newStatus } : l));

    // Persistir no banco
    const { error } = await (supabase as any)
      .from('ai_crm_leads')
      .update({ status_crm: newStatus, updated_at: new Date().toISOString() })
      .eq('id', leadId);

    if (error) {
      console.error('Erro ao atualizar status do lead:', error);
      toast.error('Erro ao mover lead — revertendo');
      fetchLiveDataRef.current(); // rollback via refetch
    }
  }, []);

  const handleStatusChange = useCallback(async (leadId: string, statusCrm: string) => {
    if (!CRM_STATUS_IDS.has(statusCrm)) return;
    setStatusUpdatingLeadId(leadId);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status_crm: statusCrm } : l));
    try {
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status_crm: statusCrm, updated_at: new Date().toISOString() })
        .eq('id', leadId);
      if (error) throw error;
      toast.success('Etapa atualizada no CRM.');
    } catch (error: any) {
      toast.error('Erro ao atualizar etapa', { description: error?.message || 'Tente novamente.' });
      fetchLiveDataRef.current();
    } finally {
      setStatusUpdatingLeadId(null);
    }
  }, []);

  const totalQualified = filteredLeads.filter(l => ['em_atendimento', 'negociacao', 'fechado'].includes(l.status_crm)).length;
  const attendedNow    = filteredLeads.filter(l => l.assigned_to_id || pendingTransfersMap.get(l.id)).length;

  const handleManualTransfer = useCallback(async (leadId: string, notes: string, sellerIdOverride?: string) => {
    // sellerIdOverride: master escolheu vendedor especifico no select do card.
    // Se nao tiver override, usa nextSeller (round-robin padrao).
    const targetSellerId = sellerIdOverride || nextSeller?.id;
    if (!targetSellerId || !user) {
      toast.warning('Selecione um vendedor ou ative ao menos um na fila.');
      return false;
    }
    const targetSeller = sellerIdOverride
      ? activeMembers.find((m: any) => m.id === sellerIdOverride)
      : nextSeller;
    const lead = leads.find((l: any) => l.id === leadId);
    setTransferringLeadId(leadId);

    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer', {
        body: {
          leadId,
          memberId: targetSellerId,
          notes,
          remoteJid: lead?.remote_jid || null,
          agentId: lead?.agent_id || null,
          leadName: lead?.lead_name || null,
          ownerUserId: lead?.user_id || effectiveUserId || null,
        }
      });
      if (error) {
        let message = error.message || 'Nao foi possivel transferir este lead.';
        const context = (error as any).context;
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json();
            message = body?.error || message;
          } catch {
            // Mantem a mensagem padrao do Supabase.
          }
        }
        throw new Error(message);
      }
      // BUG-NOVO-03: respeitar deduplicated=true do backend (clique duplo < 30s)
      if ((data as any)?.deduplicated) {
        toast.info(`Já estava transferido pra ${targetSeller?.name || 'vendedor'}`, {
          description: 'Clique anterior detectado (< 30s). Sem mensagem duplicada.',
        });
      } else {
        toast.success(`Lead transferido para ${targetSeller?.name || 'vendedor'}.`, {
          description: 'Briefing IA enviado ao vendedor. Gerente notificado.',
        });
      }
      await fetchLiveData();
      return true;
    } catch (e: any) {
      console.error('Transfer error:', e);
      toast.error('Erro ao transferir lead', {
        description: e?.message || 'Verifique a instancia do WhatsApp e tente novamente.',
      });
      return false;
    } finally {
      setTransferringLeadId(null);
    }
  }, [nextSeller, activeMembers, user, leads, effectiveUserId, fetchLiveData]);

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

  const handleOpenTvMode = useCallback(async () => {
    setTvMode(true);
    try {
      // Fullscreen the whole document (not an inner div): a position:fixed
      // overlay nested inside a non-root fullscreen element gets clipped and
      // refuses to scroll in Chrome. Fullscreening documentElement keeps the
      // overlay anchored to the real viewport so it scrolls like a normal page.
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Browsers may deny fullscreen; the fixed TV layer still opens.
    }
  }, []);

  const handleCloseTvMode = useCallback(async () => {
    setTvMode(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // Ignore fullscreen exit errors; closing the overlay is enough.
      }
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setTvMode(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const dateLabel = dateFilter === 'custom'
    ? `${customStart || '?'} até ${customEnd || '?'}`
    : DATE_FILTERS.find(f => f.value === dateFilter)?.label || 'Hoje';

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
    <div ref={containerRef} style={{ minHeight: embedded ? '100%' : '100vh', height: embedded ? '100%' : undefined, overflowY: embedded ? 'auto' : undefined, background: '#0B0F1A', color: '#E2E8F0', fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.3} }
        @keyframes slide-in { from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none} }
        @keyframes active-pulse { 0%,100%{opacity:1}50%{opacity:.75} }
        .seller-active { animation: active-pulse 2s ease-in-out infinite; }
        .alert-badge { animation: slide-in .3s ease-out; }
        .tv-scroll {
          scrollbar-width: auto;
          scrollbar-color: rgba(103,232,249,.95) rgba(15,23,42,.9);
        }
        .tv-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .tv-scroll::-webkit-scrollbar-track {
          background: rgba(15,23,42,.72);
          border-radius: 999px;
        }
        .tv-scroll::-webkit-scrollbar-thumb {
          background: rgba(128,222,234,.48);
          border: 2px solid rgba(15,23,42,.92);
          border-radius: 999px;
        }
        .tv-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(128,222,234,.72);
        }
        .tv-scroll-y {
          overflow-y: auto !important;
          padding-right: 8px !important;
        }
        .tv-scroll-y::-webkit-scrollbar {
          width: 14px !important;
        }
        .tv-scroll-y::-webkit-scrollbar-button {
          width: 0 !important;
          height: 0 !important;
          display: none !important;
          background: transparent !important;
        }
        .tv-scroll-y::-webkit-scrollbar-track {
          background: rgba(3,7,18,.86) !important;
          border: 1px solid rgba(148,163,184,.22);
          border-radius: 999px;
        }
        .tv-scroll-y::-webkit-scrollbar-thumb {
          min-height: 52px;
          background: linear-gradient(180deg, rgba(103,232,249,.95), rgba(59,130,246,.92)) !important;
          border: 3px solid rgba(3,7,18,.88) !important;
          border-radius: 999px;
          box-shadow: 0 0 10px rgba(34,211,238,.32);
        }
      `}</style>

      {tvMode && (
        <div className="tv-scroll tv-scroll-y" style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          background: '#070B14',
          color: '#E2E8F0',
          padding: 'clamp(14px, 1.2vw, 22px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                {branding.logo_url ? (
                  <img src={branding.logo_url} alt="logo" style={{ height: 34, width: 'auto', maxWidth: 180, objectFit: 'contain', borderRadius: 8 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff' }}>{(branding.company_name || 'L').charAt(0).toUpperCase()}</div>
                )}
                <span style={{ fontSize: 13, fontWeight: 850, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.cyanL }}>{branding.company_name || 'LogosIA'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, background: C.greenBg, border: `1px solid ${C.green}`, color: C.greenL, padding: '5px 10px', fontSize: 11, fontWeight: 850 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, animation: 'blink .9s step-end infinite' }} />
                  Tempo real
                </span>
                {newLeadFlash && (
                  <span className="alert-badge" style={{ borderRadius: 999, background: C.redBg, border: `1px solid ${C.red}`, color: C.redL, padding: '5px 10px', fontSize: 11, fontWeight: 900 }}>
                    Novo lead
                  </span>
                )}
              </div>
              <h1 style={{ margin: 0, fontSize: 'clamp(24px, 2.1vw, 40px)', lineHeight: 1, fontWeight: 950, color: '#F8FAFC', letterSpacing: 0 }}>
                CRM ao Vivo - Pedro
              </h1>
              <p style={{ margin: '6px 0 0', color: '#7C8AA5', fontSize: 'clamp(11px, .85vw, 14px)' }}>
                Período: {dateLabel} · {filteredLeads.length} de {leads.length} leads · atualização {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <Button size="sm" variant="outline" disabled={refreshing} onClick={handleRefresh} style={{ borderColor: 'rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.04)', color: '#CBD5E1' }}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5${refreshing ? ' animate-spin' : ''}`} /> Atualizar
              </Button>
              <Button size="sm" variant="outline" onClick={handleMuteToggle} style={{ borderColor: muted ? 'rgba(255,255,255,0.16)' : C.amber, background: muted ? 'rgba(255,255,255,0.04)' : C.amberBg, color: muted ? '#94A3B8' : C.amberL }}>
                {muted ? <VolumeX className="mr-1.5 h-3.5 w-3.5" /> : <Volume2 className="mr-1.5 h-3.5 w-3.5" />}
                {muted ? 'Mudo' : 'Som ativo'}
              </Button>
              <Button size="sm" onClick={handleCloseTvMode} style={{ background: C.blue, color: '#fff', fontWeight: 850 }}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Sair
              </Button>
            </div>
          </header>

          <section style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
            {[
              { icon: <Users className="h-5 w-5" />, label: dateFilter === 'all' ? 'Leads no pipeline' : `Leads - ${dateLabel}`, value: filteredLeads.length, main: C.blue, light: C.blueL, bg: C.blueBg },
              { icon: <Flame className="h-5 w-5" />, label: 'Qualificados', value: totalQualified, main: C.green, light: C.greenL, bg: C.greenBg },
              { icon: <DollarSign className="h-5 w-5" />, label: 'Custo por Lead', value: formatBRL(costPerLead), main: C.amber, light: C.amberL, bg: C.amberBg },
              { icon: <UserCheck className="h-5 w-5" />, label: 'Em atendimento', value: attendedNow, main: C.orange, light: C.orangeL, bg: C.orangeBg },
              { icon: <Crown className="h-5 w-5" />, label: 'Vendedores online', value: activeMembers.length, main: C.purple, light: C.purpleL, bg: C.purpleBg },
              { icon: <CalendarClock className="h-5 w-5" />, label: 'Atualização', value: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--', main: C.cyan, light: C.cyanL, bg: C.cyanBg },
            ].map(m => (
              <div key={m.label} style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', borderLeft: `4px solid ${m.main}`, background: '#101827', padding: 'clamp(12px, 1vw, 16px)', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: m.main }}>
                  {m.icon}
                  <p style={{ margin: 0, fontSize: 'clamp(9px, .78vw, 12px)', fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#70809B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</p>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 2.4vw, 46px)', lineHeight: .9, fontWeight: 950, color: m.light }}>{m.value}</p>
              </div>
            ))}
          </section>

          {!isSeller && (
            <section style={{
              flexShrink: 0,
              display: 'grid',
              gridTemplateColumns: isPortrait ? '1fr' : 'minmax(210px, .72fr) minmax(0, 1.18fr) minmax(0, 1.45fr)',
              gap: 10,
              minHeight: 0,
            }}>
              <div style={{ borderRadius: 14, border: `1px solid ${C.cyan}`, background: C.cyanBg, padding: '12px 14px', minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.16em', color: C.cyanL, fontWeight: 850, opacity: .78 }}>Rodízio inteligente</p>
                <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0, color: C.cyanL, fontSize: 'clamp(18px, 1.25vw, 26px)', lineHeight: 1.05, fontWeight: 950, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nextSeller?.name || 'Nenhum ativo'}
                    </h2>
                    <p style={{ margin: '4px 0 0', color: '#7C8AA5', fontSize: 12 }}>{nextSeller?.whatsapp_number || 'Sem número configurado'}</p>
                  </div>
                  <Sparkles style={{ width: 22, height: 22, color: C.cyanL, flexShrink: 0 }} />
                </div>
              </div>

              <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#101827', padding: '12px 14px', minWidth: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: '0 0 9px', color: '#F8FAFC', fontSize: 14, fontWeight: 900 }}>Fila de vendedores</h3>
                <div
                  className="tv-scroll"
                  style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 3, scrollbarGutter: 'stable' }}
                >
                  {memberStats.length === 0 ? (
                    <div style={{ borderRadius: 10, border: '1px dashed rgba(255,255,255,0.12)', padding: 12, color: '#7C8AA5', fontSize: 12, textAlign: 'center' }}>Sem vendedores ativos</div>
                  ) : memberStats.map((m, i) => {
                    const pal = SELLER_PALETTE[i % SELLER_PALETTE.length];
                    return (
                      <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 7, alignItems: 'center', borderRadius: 10, border: `1px solid ${pal.main}`, background: pal.bg, padding: '8px 10px', minWidth: 148, maxWidth: 178 }}>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, color: pal.light, fontSize: 12.5, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{i + 1} {m.name}</p>
                          <p style={{ margin: '2px 0 0', color: '#7C8AA5', fontSize: 10 }}>{m.is_active ? 'Ativo' : 'Off'} · hoje {m.todayCount}</p>
                        </div>
                        <strong style={{ color: pal.light, fontSize: 20, lineHeight: 1 }}>{m.periodCount}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ borderRadius: 14, border: `1px solid ${C.amber}`, background: C.amberBg, padding: '12px 14px', minWidth: 0, overflow: 'hidden' }}>
                <h3 style={{ margin: '0 0 9px', color: C.amberL, fontSize: 14, fontWeight: 900 }}>Transferências recentes</h3>
                <div
                  className="tv-scroll"
                  style={{ display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 3, scrollbarGutter: 'stable' }}
                >
                  {transfers.length === 0 ? (
                    <div style={{ borderRadius: 10, border: '1px dashed rgba(255,255,255,0.12)', padding: 12, color: '#7C8AA5', fontSize: 12, textAlign: 'center' }}>Aguardando movimentações</div>
                  ) : transfers.map(t => (
                    <div key={t.id} style={{ borderRadius: 10, background: 'rgba(0,0,0,0.18)', border: '1px solid rgba(255,255,255,0.08)', padding: '8px 10px', minWidth: 210, maxWidth: 260 }}>
                      <p style={{ margin: 0, color: '#F8FAFC', fontSize: 12.5, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.lead?.lead_name || 'Lead'}</p>
                      <p style={{ margin: '3px 0 0', color: C.amberL, fontSize: 11, fontWeight: 750, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getTransferLabel(t)} para {t.member?.name || 'Vendedor'} · {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {!isSeller && (
            <div style={{ flexShrink: 0 }}>
              <CplTrafegoPago userId={effectiveUserId} leads={leads} />
            </div>
          )}

          <main style={{ flexShrink: 0, minHeight: 0, display: 'grid' }}>
            <section style={{ display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(2, minmax(0, 1fr))' : `repeat(${PEDRO_LIVE_COLUMNS.length}, minmax(0, 1fr))`, gap: 10, minHeight: 0, alignItems: 'stretch' }}>
              {PEDRO_LIVE_COLUMNS.map(col => {
                const colLeads = leadsByColumn[col.id] || [];
                return (
                  <div key={col.id} style={{ height: 'clamp(360px, 62vh, 760px)', borderRadius: 14, border: `1px solid ${col.main}`, background: 'rgba(15,23,42,0.72)', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 10px 8px', background: col.bg, borderBottom: `1px solid ${col.main}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.main, flexShrink: 0 }} />
                          <h2 style={{ margin: 0, fontSize: 'clamp(10px, .82vw, 13px)', lineHeight: 1.1, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em', color: col.light, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {col.title}
                          </h2>
                        </div>
                        <strong style={{ color: col.light, fontSize: 'clamp(18px, 1.7vw, 30px)', lineHeight: .9 }}>{colLeads.length}</strong>
                      </div>
                    </div>

                    <div
                      className="tv-scroll tv-scroll-y"
                      style={{ minHeight: 0, height: '100%', maxHeight: '100%', padding: 9, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}
                    >
                      {colLeads.length === 0 ? (
                        <div style={{ height: '100%', minHeight: 86, borderRadius: 10, border: '1px dashed rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.025)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#55627A', fontSize: 12, fontWeight: 650 }}>
                          Sem leads
                        </div>
                      ) : colLeads.map(lead => (
                        <TvLeadCard key={lead.id} lead={lead} col={col} pendingTransfer={pendingTransfersMap.get(lead.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          </main>
        </div>
      )}

      {/* ── TOP BAR ─────────────────────────────────── */}
      {!embedded && (
        <div style={{ background: '#0F1629', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 16, borderRight: '1px solid rgba(255,255,255,0.12)' }}>
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="logo" style={{ height: 32, width: 'auto', maxWidth: 180, objectFit: 'contain', borderRadius: 6 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: 8, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, color: '#fff' }}>{(branding.company_name || 'L').charAt(0).toUpperCase()}</div>
              )}
              <span style={{ fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '-0.3px' }}>{branding.company_name || 'LogosIA'}</span>
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
            <Button size="sm" style={{ background: C.blue, color: '#fff', fontWeight: 700, fontSize: 13 }} onClick={handleOpenTvMode}>
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

        {/* TV and export actions */}
        <button
          onClick={handleOpenTvMode}
          style={{
            marginLeft: 'auto',
            padding: '5px 14px',
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 800,
            border: `1px solid ${C.blue}`,
            cursor: 'pointer',
            background: C.blueBg,
            color: C.blueL,
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title="Abrir CRM ao Vivo em modo TV"
        >
          <Expand style={{ width: 14, height: 14 }} /> Tela cheia
        </button>

        {!isSeller && <button
          onClick={handleExportToMarcos}
          disabled={exportingMarcos || filteredLeads.length === 0}
          style={{
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
        </button>}
      </div>

      {/* ── MÉTRICAS ──────────────────────────────── */}
      <div style={{ padding: '8px 24px 20px', display: 'grid', gridTemplateColumns: isPortrait ? 'repeat(2,1fr)' : 'repeat(6, minmax(0, 1fr))', gap: 14 }}>
        {[
          { icon: <Users className="h-5 w-5" />, label: dateFilter === 'all' ? 'Leads no pipeline' : dateFilter === 'custom' ? `Leads — ${customStart || '?'} a ${customEnd || '?'}` : `Leads — ${DATE_FILTERS.find(f=>f.value===dateFilter)?.label}`, value: filteredLeads.length, main: C.blue, light: C.blueL, bg: C.blueBg },
          { icon: <Flame className="h-5 w-5" />, label: 'Qualificados', value: totalQualified, main: C.green, light: C.greenL, bg: C.greenBg },
          { icon: <DollarSign className="h-5 w-5" />, label: 'Custo por Lead', value: formatBRL(costPerLead), main: C.amber, light: C.amberL, bg: C.amberBg },
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

      {/* ── CUSTO POR LEAD — TRÁFEGO PAGO + REAL/NÃO REAL (só master) ── */}
      {!isSeller && (
        <div style={{ padding: '0 24px 16px' }}>
          <CplTrafegoPago userId={effectiveUserId} leads={leads} />
        </div>
      )}

      {/* ── KANBAN + SIDEBAR ──────────────────────── */}
      <div style={{ padding: '0 24px 40px', display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 24 }}>
        
        {/* COLUNAS KANBAN — com Drag & Drop */}
        <DragDropContext onDragEnd={handleDragEnd}>
          <div style={{ flex: isPortrait ? 'none' : 3, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: 16 }}>
            {PEDRO_LIVE_COLUMNS.map(col => {
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
                  <Droppable droppableId={col.id} isDropDisabled={Boolean((col as any).assignmentOnly)}>
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
                                  activeMembers={isSeller ? [] : activeMembers}
                                  transferringLeadId={transferringLeadId}
                                  onTransfer={handleManualTransfer}
                                  transfers={transfers}
                                  dragHandleProps={isSeller || (col as any).assignmentOnly ? null : prov.dragHandleProps}
                                  hideTransfer={isSeller}
                                  pendingTransfer={pendingTransfersMap.get(lead.id)}
                                  onStatusChange={handleStatusChange}
                                  statusUpdatingLeadId={statusUpdatingLeadId}
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

          {/* LEADS NAO TRANSFERIDOS */}
          <section style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ background: C.orangeBg, borderBottom: `2px solid ${C.orange}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.orangeL, fontWeight: 700, opacity: 0.7 }}>Pendentes de repasse</p>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: C.orangeL, marginTop: 1 }}>Leads Não Transferidos</h2>
              </div>
              <span style={{ minWidth: 32, height: 32, borderRadius: 10, background: 'rgba(0,0,0,0.22)', border: `1px solid ${C.orange}`, color: C.orangeL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
                {untransferredLeads.length}
              </span>
            </div>

            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 330, overflowY: 'auto' }}>
              {untransferredLeads.length === 0 ? (
                <div style={{ borderRadius: 10, border: '1.5px dashed rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', padding: '22px 14px', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                  Nenhum lead sem vendedor no período.
                </div>
              ) : untransferredLeads.map(lead => {
                const selected = selectedLeadId === lead.id;
                return (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedLeadId(lead.id)}
                    style={{
                      borderRadius: 10,
                      border: `1.5px solid ${selected ? C.orange : 'rgba(255,255,255,0.08)'}`,
                      background: selected ? C.orangeBg : 'rgba(255,255,255,0.035)',
                      padding: '11px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Phone style={{ width: 15, height: 15, color: selected ? C.orangeL : '#64748B', flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#F8FAFC', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lead.lead_name || 'Lead sem nome'}
                      </span>
                      <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatLeadPhone(lead.remote_jid)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedLead && (
            <section style={{ ...cardStyle, overflow: 'hidden', borderColor: C.orange }}>
              <div style={{ background: C.orangeBg, borderBottom: `2px solid ${C.orange}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.2em', color: C.orangeL, fontWeight: 700, opacity: 0.7 }}>Detalhe do lead</p>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: C.orangeL, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedLead.lead_name || 'Lead sem nome'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLeadId(null)}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.2)', color: '#CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                  title="Fechar detalhe"
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>

              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', padding: '11px 12px' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#64748B', fontWeight: 800 }}>Telefone</p>
                  <p style={{ marginTop: 4, fontSize: 14, fontWeight: 800, color: '#F8FAFC' }}>{formatLeadPhone(selectedLead.remote_jid)}</p>
                </div>

                <select
                  value={CRM_STATUS_IDS.has(selectedLead.status_crm) ? selectedLead.status_crm : 'novo'}
                  onChange={(e) => handleStatusChange(selectedLead.id, e.target.value)}
                  disabled={statusUpdatingLeadId === selectedLead.id}
                  style={{ width: '100%', padding: '9px 10px', fontSize: 12, borderRadius: 9, background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.orange}`, color: '#fff', outline: 'none' }}
                  title="Etapa do CRM Avançado"
                >
                  {CRM_STATUS_COLUMNS.map(status => (
                    <option key={status.id} value={status.id}>{status.title}</option>
                  ))}
                </select>

                <select
                  value={detailSellerId}
                  onChange={(e) => setDetailSellerId(e.target.value)}
                  disabled={transferringLeadId === selectedLead.id}
                  style={{ width: '100%', padding: '9px 10px', fontSize: 12, borderRadius: 9, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }}
                >
                  <option value="">Selecionar vendedor</option>
                  {activeMembers.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>

                <textarea
                  value={detailNotes}
                  onChange={(e) => setDetailNotes(e.target.value)}
                  placeholder="Observação para o vendedor"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', minHeight: 72, padding: '9px 10px', fontSize: 12, borderRadius: 9, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }}
                />

                <Button
                  size="sm"
                  disabled={transferringLeadId === selectedLead.id || !detailSellerId}
                  onClick={async () => {
                    const ok = await handleManualTransfer(selectedLead.id, detailNotes, detailSellerId);
                    if (ok) {
                      setDetailNotes('');
                      setDetailSellerId('');
                    }
                  }}
                  style={{ background: C.orange, color: '#fff', fontWeight: 850, fontSize: 12, height: 36, borderRadius: 9 }}
                >
                  {transferringLeadId === selectedLead.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  ) : (
                    <UserCheck className="h-3.5 w-3.5 mr-2" />
                  )}
                  Transferir lead
                </Button>
              </div>
            </section>
          )}

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
