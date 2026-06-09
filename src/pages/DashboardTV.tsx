// ============================================================================
// DashboardTV
// ----------------------------------------------------------------------------
// Dashboard comercial em tempo real pra projetar em TV (fullscreen F11).
// Mostra produção do dia agregando leads do Pedro (ai_crm_leads) +
// Marcos (crm_leads) por vendedor e por origem.
//
// Regras de agregação (spec 27/05/2026 Bug 1: 5 colunas, OLX e Outros removidos):
//   • TRÁFEGO PAGO = ai_crm_leads com assigned_to_id IS NOT NULL
//   • PORTA        = crm_leads WHERE origem='porta'
//   • MARKETPLACE  = crm_leads WHERE origem='marketplace'
//   • CONSIGNADO   = crm_leads WHERE origem='consignado'
//   • INDICAÇÃO    = crm_leads WHERE origem='indicacao'
// Leads com origem='olx', 'outros', 'instagram' ou NULL são IGNORADOS.
//
// Período: apenas leads do dia atual (created_at >= 00:00 local).
// Atualização: polling a cada 30s + relógio digital atualiza a cada 1s.
// Permissão: APENAS master (vendedor redirecionado pra /dashboard).
// Branding: usa colunas profiles.dashboard_tv_* (configurável na Etapa 3).
//
// Layout inspirado em painel ICOM Motors — mas marca/cores customizáveis.
// ============================================================================

import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { Calendar, Clock, DollarSign, Loader2, Target, DoorOpen, ShoppingBag, Globe, Users, Phone, Trophy, Maximize2, Minimize2, RefreshCw, Tag, Instagram } from 'lucide-react';
import { CplComparativo } from '@/components/pedro/CplComparativo';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────

interface VendedorData {
  id: string;
  name: string;
  /** Foto exibida no card. Prioridade: profiles.avatar_url (vendedor) > ai_team_members.profile_picture (master) > null (fallback iniciais). */
  effective_avatar: string | null;
  rank: number;
  // Spec 27/05/2026 Bug 1: removidas OLX e Outros do painel. Tipos mantidos
  // como propriedades obrigatórias do agg pra simplicidade.
  // MELHORIA 1 (29/05/2026): + Redes Sociais → 6 colunas:
  // Tráfego Pago / Porta / Marketplace / Consignado / Indicação / Redes Sociais.
  trafico_pago: number;
  porta: number;
  marketplace: number;
  consignado: number;
  indicacao: number;
  redes_sociais: number;
  total: number;
}

interface KPIsData {
  total_leads: number;
  /** Leads contados no total_leads que NÃO estão atribuídos a nenhum vendedor.
   *  Não aparecem em vendedor específico, mas precisam aparecer no KPI total
   *  pra TV refletir TUDO que foi cadastrado no dia. */
  nao_atribuidos: number;
  por_origem: Record<string, number>;
  percentuais: Record<string, number>;
  /** 0-100 — média ponderada IA(50%) + Feedback(30%) + Notas(20%) */
  qualidade_media: number;
  qualidade_label: 'Ótimo' | 'Bom' | 'Médio' | 'Baixo' | 'Sem dados';
  /** % de leads Pedro que foram transferidos pra vendedor humano */
  taxa_transferencia: number;
  taxa_transferencia_texto: string; // "32 de 44 leads"
  total_spend: number;
  custo_por_lead: number;
}

interface LeadNaoTransferido {
  id: string;
  nome: string;
  telefone: string;
  remote_jid: string | null;
  agent_id: string | null;
}

// ─── Cálculo de qualidade do lead (50% IA + 30% Feedback + 20% Notas) ────────

/** Score 0-100 baseado em status_crm do Pedro */
function scorePedroStatus(status: string | null | undefined): number {
  if (!status) return 0;
  const map: Record<string, number> = {
    qualificado: 100, medio_qualificado: 70, pouco_qualificado: 40,
    transferido: 100, em_atendimento: 50, novo: 20, inativo: 0,
    fechado: 100, perdido: 0,
  };
  return map[status] ?? 20;
}

/** Score 0-100 baseado no nome da stage do Marcos */
function scoreMarcosStage(stageName: string | null | undefined): number {
  if (!stageName) return 0;
  const n = stageName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const map: Record<string, number> = {
    'fechado': 100, 'negociacao': 85, 'agendamento': 60, 'porta/loja': 30,
    'marketing place': 20, 'leads inativos': 0, 'nao tem no estoque': 0,
    // legados (caso ainda exista em algum master)
    'novo lead': 20, 'proposta': 75, 'qualificado': 80, 'perdido': 0,
    'lead inativo': 0, 'carro nao disponivel': 0, 'porta': 30,
  };
  return map[n] ?? 20;
}

/** Score 0-100 baseado em priority do pedro_manager_feedback */
function scoreFeedbackPriority(priority: string | null | undefined): number {
  if (!priority) return 0;
  const map: Record<string, number> = {
    urgent: 100, high: 75, normal: 50, low: 25,
  };
  return map[priority] ?? 0;
}

/** Score 0-100 baseado em quantidade de notas do vendedor */
function scoreNotasCount(count: number | null | undefined): number {
  const c = count || 0;
  if (c >= 3) return 100;
  if (c >= 1) return 60;
  return 0;
}

/** Combina os 3 scores com pesos 50% / 30% / 20% */
function combineLeadScore(iaScore: number, fbScore: number | null, notesScore: number): number {
  // Se NÃO tiver feedback, redistribui os 30% pros outros 2 (IA 70% + Notas 30%)
  if (fbScore === null) {
    return Math.round((iaScore * 0.7) + (notesScore * 0.3));
  }
  return Math.round((iaScore * 0.5) + (fbScore * 0.3) + (notesScore * 0.2));
}

function qualidadeLabel(score: number, hasData: boolean): KPIsData['qualidade_label'] {
  if (!hasData) return 'Sem dados';
  if (score >= 80) return 'Ótimo';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Médio';
  return 'Baixo';
}

interface BrandingConfig {
  logo_url: string | null;
  company_name: string;
  primary_color: string;
  secondary_color: string;
}

// ─── Config visual das origens (ordem da imagem ICOM) ───────────────────────

// Spec 27/05/2026 Bug 1: colunas Trafego Pago / Porta / Marketplace /
// Consignado / Indicacao. OLX e Outros removidos.
// MELHORIA 1 (29/05/2026): + Redes Sociais ao final (ícone Instagram, rosa).
const ORIGENS = [
  { key: 'trafico_pago',  label: 'Tráfego Pago', icon: Target,      color: '#3b82f6' },
  { key: 'porta',         label: 'Porta',        icon: DoorOpen,    color: '#f59e0b' },
  { key: 'marketplace',   label: 'Marketplace',  icon: Globe,       color: '#a855f7' },
  { key: 'consignado',    label: 'Consignado',   icon: Phone,       color: '#06b6d4' },
  { key: 'indicacao',     label: 'Indicação',    icon: Users,       color: '#fb923c' },
  { key: 'redes_sociais', label: 'Redes Sociais', icon: Instagram,  color: '#ec4899' },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashColor(id: string): string {
  // Hash determinístico: mesmo vendedor sempre tem mesma cor de avatar
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
  return colors[Math.abs(h) % colors.length];
}

// ─── Filtros de período ─────────────────────────────────────────────────────

type PeriodPreset = 'today' | 'yesterday' | '7days' | '30days' | 'custom';

interface CustomRange {
  start: string; // YYYY-MM-DD (date input format)
  end: string;
}

const PERIOD_STORAGE_KEY = 'dashboard_tv_period';

/** Retorna { start, end } em ISO baseado no preset e range custom */
function resolveDateRange(preset: PeriodPreset, custom: CustomRange): { start: string; end: string; label: string } {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Hoje' };
  }
  if (preset === 'yesterday') {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Ontem' };
  }
  if (preset === '7days') {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 7 dias' };
  }
  if (preset === '30days') {
    const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 30 dias' };
  }
  // custom
  const s = custom.start ? new Date(custom.start + 'T00:00:00') : new Date(now.setHours(0,0,0,0));
  const e = custom.end   ? new Date(custom.end   + 'T23:59:59.999') : new Date(now.setHours(23,59,59,999));
  return { start: s.toISOString(), end: e.toISOString(), label: 'Personalizado' };
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatPhone(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  const br = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return br || 'Sem telefone';
}

function isoToDateKey(iso: string): string {
  return toDateInput(new Date(iso));
}

const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7f32' };
function rankColor(rank: number): string {
  return RANK_COLORS[rank] || '#475569';
}

// ─── Componente principal ───────────────────────────────────────────────────

interface DashboardTVProps {
  /** Quando true, renderiza sem min-h-screen pra caber dentro de outra página (ex: tab do Pedro SDR). */
  embedded?: boolean;
}

export default function DashboardTV({ embedded = false }: DashboardTVProps = {}) {
  const { user } = useAuth();
  const { isSeller, seller, masterUserId, loading: profileLoading } = useSellerProfile(user?.id);
  const navigate = useNavigate();

  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vendedores, setVendedores] = useState<VendedorData[]>([]);
  const [kpis, setKpis] = useState<KPIsData | null>(null);
  const [leadsNaoTransferidos, setLeadsNaoTransferidos] = useState<LeadNaoTransferido[]>([]);
  const [branding, setBranding] = useState<BrandingConfig>({
    logo_url: null,
    company_name: 'Painel Comercial',
    primary_color: '#3b82f6',
    secondary_color: '#f59e0b',
  });

  // Filtro de período (persistido em localStorage)
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    try {
      const saved = localStorage.getItem(PERIOD_STORAGE_KEY) as PeriodPreset | null;
      return saved && ['today','yesterday','7days','30days','custom'].includes(saved) ? saved : 'today';
    } catch { return 'today'; }
  });
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date();
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    return { start: toDateInput(weekAgo), end: toDateInput(today) };
  });

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref do "canvas" do painel (modo TV/tela cheia).
  const contentRef = useRef<HTMLDivElement>(null);

  // Trigger pra refresh manual (incrementa = força reload)
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Vendedores ativos (com last_lead_received_at) pro rodízio do clique-pra-transferir.
  const [queueSellers, setQueueSellers] = useState<any[]>([]);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  // Tick incrementado a cada evento realtime/poll — passado pros componentes
  // filhos (ex.: card Real vs Falso) re-buscarem junto, sem re-assinar o canal.
  const [liveTick, setLiveTick] = useState(0);

  // Tamanho da tela — pra ESCALAR o painel inteiro e caber 100% em tela cheia,
  // respeitando os formatos: 1920×1080 (deitado) / 1080×1920 (em pé/totem).
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onResize);
    };
  }, []);

  // ZOOM estilo navegador (modo TV/tela cheia) — escala o painel inteiro pra
  // CABER na tela. `auto` calcula o zoom ideal pela altura da tela; `manual` usa
  // o que o usuário definiu no slider. Tudo salvo no localStorage, então o ajuste
  // persiste quando a TV reinicia ou a página atualiza.
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('dashtv_zoom') || '');
      return v >= 0.5 && v <= 2 ? v : 1;
    } catch { return 1; }
  });
  const [zoomMode, setZoomMode] = useState<'auto' | 'manual'>(() => {
    try { return localStorage.getItem('dashtv_zoom_mode') === 'manual' ? 'manual' : 'auto'; }
    catch { return 'auto'; }
  });
  useEffect(() => { try { localStorage.setItem('dashtv_zoom', String(zoom)); } catch { /* ignore */ } }, [zoom]);
  useEffect(() => { try { localStorage.setItem('dashtv_zoom_mode', zoomMode); } catch { /* ignore */ } }, [zoomMode]);

  // Auto-ajuste: mede a altura real do painel e calcula o zoom que faz tudo caber
  // na altura da tela (a largura já é preenchida via width:100/zoom%). Converge em
  // poucos quadros e para quando estabiliza (guard de 0.012). Só roda no modo auto.
  useLayoutEffect(() => {
    if (embedded || zoomMode !== 'auto') return;
    const el = contentRef.current;
    if (!el) return;
    const fit = () => {
      const h = el.scrollHeight;
      if (!h) return;
      const ideal = Math.max(0.5, Math.min(2, (viewport.h * 0.99) / h));
      setZoom(prev => (Math.abs(prev - ideal) > 0.012 ? ideal : prev));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, zoomMode, viewport, profileLoading, loading, kpis, liveTick]);

  // Controle de zoom some sozinho: aparece quando o mouse mexe na tela e
  // desaparece após 5s de mouse parado (pra não atrapalhar a visualização na TV).
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    if (embedded) return;
    let timer: number | undefined;
    const show = () => {
      setControlsVisible(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 5000);
    };
    window.addEventListener('mousemove', show);
    show(); // começa visível e já agenda o sumiço
    return () => {
      window.removeEventListener('mousemove', show);
      if (timer) window.clearTimeout(timer);
    };
  }, [embedded]);


  // Persiste período escolhido
  useEffect(() => {
    try { localStorage.setItem(PERIOD_STORAGE_KEY, period); } catch {}
  }, [period]);

  // Listener pra mudanças no fullscreen (ex: ESC sai do fullscreen)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('[DashboardTV] Fullscreen falhou:', err);
    }
  }, []);

  // Relógio digital ao vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Decisão de escopo (master vs vendedor):
  //   master:  effectiveUserId = user.id        | sellerMemberId = null  (vê tudo)
  //   seller:  effectiveUserId = masterUserId   | sellerMemberId = seller.id (vê só ele)
  const effectiveUserId = isSeller ? masterUserId : user?.id;
  const sellerMemberId = isSeller ? seller?.id || null : null;

  // Calcula range atual (usado tanto na query quanto no label da toolbar)
  const dateRange = resolveDateRange(period, customRange);

  // Carregar dados (1ª vez + polling 30s + realtime + manual refresh)
  useEffect(() => {
    if (!user?.id || profileLoading || !effectiveUserId) return;

    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        // Usa range do filtro atual (hoje/7d/30d/custom)
        const todayStart = dateRange.start;
        const todayEnd = dateRange.end;

        // 1. Branding sempre do MASTER (mesmo pra vendedor logado vê branding do master dele)
        const profilePromise = (supabase as any)
          .from('profiles')
          .select('dashboard_tv_logo_url, dashboard_tv_company_name, dashboard_tv_primary_color, dashboard_tv_secondary_color, full_name, company_name')
          .eq('id', effectiveUserId)
          .maybeSingle();

        // 2. Vendedores ativos do master.
        //    Se for vendedor logado, filtra só ele próprio (member_id == seller.id).
        // select('*') + filtro client-side por active_in_system (ativo NO SISTEMA),
        // não pelo status do agente de IA. select('*') evita quebra se a migration
        // ainda não rodou; o filtro active_in_system !== false é aplicado abaixo.
        let sellersQuery = (supabase as any)
          .from('ai_team_members')
          .select('*')
          .eq('user_id', effectiveUserId);
        if (sellerMemberId) sellersQuery = sellersQuery.eq('id', sellerMemberId);

        // 3. Leads Pedro do período. +status_crm +seller_notes_count pra cálculo de qualidade.
        //    Pra "Taxa Transferência" precisamos contar TODOS leads Pedro (com e sem assigned_to_id).
        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, lead_name, remote_jid, agent_id, assigned_to_id, status_crm, seller_notes_count')
          .eq('user_id', effectiveUserId)
          // Periodo pela DATA REAL DE CHEGADA: arrived_at quando o vendedor informou
          // (lead de porta/dia passado), senao created_at.
          .or(`and(arrived_at.gte.${todayStart},arrived_at.lte.${todayEnd}),and(arrived_at.is.null,created_at.gte.${todayStart},created_at.lte.${todayEnd})`);
        if (sellerMemberId) pedroQuery = pedroQuery.eq('assigned_to_id', sellerMemberId);
        // (sem filtro 'assigned_to_id not null' — preciso do total pra taxa)

        // 4. Leads Marcos do período. +stage_id + JOIN com stages pra nome.
        // FIX 28/05/2026: removida coluna `seller_notes_count` que NAO existe
        // em crm_leads (so existe em ai_crm_leads do Pedro). A query inteira
        // estava falhando silenciosamente, fazendo todo Painel mostrar 0 leads
        // do Marcos desde sempre. Bug exposto pelo banner de debug.
        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, origem, assigned_to, stage_id, arrived_at, created_at, stage:crm_pipeline_stages(name)')
          .eq('user_id', effectiveUserId)
          // Periodo pela DATA REAL DE CHEGADA (arrived_at) quando informada, senao created_at.
          .or(`and(arrived_at.gte.${todayStart},arrived_at.lte.${todayEnd}),and(arrived_at.is.null,created_at.gte.${todayStart},created_at.lte.${todayEnd})`);
        if (sellerMemberId) marcosQuery = marcosQuery.eq('assigned_to', sellerMemberId);

        let costsQuery = (supabase as any)
          .from('campaign_costs')
          .select('entity_level, spend, date')
          .eq('user_id', effectiveUserId)
          .gte('date', isoToDateKey(todayStart))
          .lte('date', isoToDateKey(todayEnd));

        const [profileRes, sellersRes, pedroRes, marcosRes, costsRes] = await Promise.all([
          profilePromise, sellersQuery, pedroQuery, marcosQuery, costsQuery,
        ]);

        if (cancelled) return;


        // 1. Branding (com fallbacks razoáveis)
        const p = profileRes.data || {};
        setBranding({
          logo_url: p.dashboard_tv_logo_url || null,
          company_name: p.dashboard_tv_company_name || p.company_name || p.full_name || 'Painel Comercial',
          primary_color: p.dashboard_tv_primary_color || '#3b82f6',
          secondary_color: p.dashboard_tv_secondary_color || '#f59e0b',
        });

        // 2. Carrega avatar_url do profile DE CADA VENDEDOR (prioridade > profile_picture do master)
        // Ativos NO SISTEMA (visibilidade no painel) — independe do status no agente de IA.
        const sellersList = ((sellersRes.data || []) as any[]).filter((s: any) => s.active_in_system !== false) as Array<{ id: string; name: string; profile_picture: string | null; auth_user_id: string | null }>;
        // Fila do rodízio do botão "Transferir (próximo da fila)": SÓ vendedores
        // ATIVOS NO AGENTE DE IA (is_active=true) — igual ao rodízio AUTOMÁTICO do
        // Pedro (transferRouter / uazapi-webhook / bulk-transfer). Diferente dos
        // CARDS, que mostram todos os ativos no sistema. Assim o botão nunca passa
        // lead pra quem está pausado no agente. Só no master (sem sellerMemberId).
        if (!sellerMemberId) {
          setQueueSellers((sellersList as any[]).filter((s: any) => s.is_active === true));
        }
        const authIds = sellersList.map(s => s.auth_user_id).filter((x): x is string => !!x);
        const profileAvatarMap = new Map<string, string>();
        if (authIds.length > 0) {
          const { data: avatarRows } = await (supabase as any)
            .from('profiles')
            .select('id, avatar_url')
            .in('id', authIds);
          for (const r of (avatarRows || []) as Array<{ id: string; avatar_url: string | null }>) {
            if (r.avatar_url) profileAvatarMap.set(r.id, r.avatar_url);
          }
        }

        // 3. Inicializa agregador por vendedor com avatar resolvido
        const agg: Record<string, VendedorData> = {};
        for (const s of sellersList) {
          const effectiveAvatar =
            (s.auth_user_id && profileAvatarMap.get(s.auth_user_id)) ||
            s.profile_picture ||
            null;
          agg[s.id] = {
            id: s.id, name: s.name, effective_avatar: effectiveAvatar, rank: 0,
            trafico_pago: 0, porta: 0, marketplace: 0, consignado: 0, indicacao: 0, redes_sociais: 0, total: 0,
          };
        }

        // Spec 27/05/2026 Bug integração Marcos: cria uma row virtual "Sem
        // vendedor" pros leads com assigned_to=NULL (Marcos importados em
        // planilha sem vendedor, ou criados pelo master sem auto-atribuir).
        // Sem isso esses leads cairiam em naoAtribuidos++ (subtexto invisível)
        // e nunca apareceriam no breakdown por origem. Filtrada do ranking
        // mais abaixo se ficar com total=0.
        const NAO_ATRIBUIDO_ID = '__nao_atribuido__';
        agg[NAO_ATRIBUIDO_ID] = {
          id: NAO_ATRIBUIDO_ID, name: 'Sem vendedor atribuído', effective_avatar: null, rank: 0,
          trafico_pago: 0, porta: 0, marketplace: 0, consignado: 0, indicacao: 0, redes_sociais: 0, total: 0,
        };

        // 4. Pedro: contar trafico_pago (precisa de assigned_to_id) E coletar dados pra qualidade/taxa
        const pedroLeads = (pedroRes.data || []) as Array<{
          id: string; lead_name: string | null; remote_jid: string | null; agent_id: string | null; assigned_to_id: string | null; status_crm: string | null; seller_notes_count: number | null;
        }>;
        const pedroLeadIds = pedroLeads.map(l => l.id);
        const pendingOrConfirmedTransferIds = new Set<string>();
        if (pedroLeadIds.length > 0) {
          const { data: transferRows } = await (supabase as any)
            .from('ai_lead_transfers')
            .select('lead_id, transfer_status')
            .in('lead_id', pedroLeadIds)
            .neq('transfer_status', 'expired');
          for (const row of (transferRows || []) as Array<{ lead_id: string | null }>) {
            if (row.lead_id) pendingOrConfirmedTransferIds.add(row.lead_id);
          }
        }
        const pedroNaoTransferidos: LeadNaoTransferido[] = [];
        let pedroTotal = 0;       // total leads Pedro no período (todos)
        let pedroAtribuidos = 0;  // leads Pedro com assigned_to_id != null
        let naoAtribuidos = 0;    // leads (Pedro+Marcos) que não foram pra vendedor — contam no total mas não no card de vendedor
        for (const l of pedroLeads) {
          pedroTotal++;
          if (l.assigned_to_id) {
            pedroAtribuidos++;
            const v = agg[l.assigned_to_id];
            if (v) {
              v.trafico_pago++; v.total++;
            } else {
              // assigned_to_id aponta pra vendedor que sumiu — registra na row
              // virtual "Sem vendedor" pra aparecer no breakdown (Bug integração).
              agg[NAO_ATRIBUIDO_ID].trafico_pago++;
              agg[NAO_ATRIBUIDO_ID].total++;
              naoAtribuidos++;
            }
          } else if (!pendingOrConfirmedTransferIds.has(l.id)) {
            // Lead Pedro novo, ainda sem transfer. Tecnicamente não conta como
            // "Tráfego Pago" (já que essa categoria precisa de assigned_to_id),
            // mas pra visibilidade aparece no total da row "Sem vendedor".
            agg[NAO_ATRIBUIDO_ID].total++;
            naoAtribuidos++;
            pedroNaoTransferidos.push({
              id: l.id,
              nome: l.lead_name || formatPhone(l.remote_jid),
              telefone: formatPhone(l.remote_jid),
              remote_jid: l.remote_jid,
              agent_id: l.agent_id,
            });
          } else {
            agg[NAO_ATRIBUIDO_ID].total++;
            naoAtribuidos++;
          }
        }

        // 5. Marcos: agrupa por STAGE NAME (coluna do Kanban) — fix 28/05/2026.
        // Spec do usuario: "o que aparece na coluna do Marcos tem que aparecer
        // no Painel ao Vivo". Antes contava por `origem` que dava mismatch:
        // ex: form "Consignado-Indicacao" -> kanban Consignado mas origem=indicacao
        // -> Painel mostrava como Indicacao em vez de Consignado.
        // Agora usa stage.name diretamente do JOIN com crm_pipeline_stages.
        function stageToCol(stageName: string | null | undefined): keyof Pick<VendedorData, 'porta'|'marketplace'|'consignado'|'indicacao'|'redes_sociais'> | null {
          if (!stageName) return null;
          const n = stageName.trim().toLowerCase();
          // Porta/loja, Porta, Loja -> porta
          if (n === 'porta/loja' || n === 'porta' || n === 'loja' || n === 'porta loja') return 'porta';
          if (n === 'marketplace') return 'marketplace';
          if (n === 'consignado') return 'consignado';
          if (n === 'indicação' || n === 'indicacao') return 'indicacao';
          // MELHORIA 1 (29/05/2026): coluna "Redes Sociais"
          if (n === 'redes sociais' || n === 'redes_sociais' || n === 'redes') return 'redes_sociais';
          return null; // outras stages (Leads Inativos, Negociacao, Fechado, etc.) nao contam
        }
        const marcosLeads = (marcosRes.data || []) as Array<{
          id: string; origem: string | null; assigned_to: string | null; stage_id: string | null;
          stage: { name: string } | null;
        }>;
        for (const l of marcosLeads) {
          // Fallback pra row virtual "Sem vendedor atribuído" quando assigned_to=NULL
          // ou aponta pra vendedor inexistente.
          const v = agg[l.assigned_to || ''] || agg[NAO_ATRIBUIDO_ID];
          if (!l.assigned_to || !agg[l.assigned_to]) {
            naoAtribuidos++; // conta no contador geral (UI sub-texto)
          }
          // PRIORIDADE: usar stage.name (coluna Kanban onde o lead esta visualmente).
          // Fallback pra origem se stage for null (lead sem stage_id ou stage deletada).
          const col = stageToCol(l.stage?.name) || (
            l.origem === 'porta' ? 'porta' :
            l.origem === 'marketplace' ? 'marketplace' :
            l.origem === 'consignado' ? 'consignado' :
            l.origem === 'indicacao' ? 'indicacao' :
            l.origem === 'redes_sociais' ? 'redes_sociais' : null // MELHORIA 1 (29/05/2026)
          );
          if (col) {
            v[col]++;
            v.total++;
          }
          // Stages "Leads Inativos", "Negociacao", "Fechado", "Nao tem no Estoque",
          // "Agendamento" nao tem coluna no Painel — sao ignorados.
        }

        // 6. Busca feedbacks (priority) dos leads do período (Pedro + Marcos)
        //    Usado pra calcular o peso 30% da qualidade
        const allPedroIds  = pedroLeads.map(l => l.id);
        const allMarcosIds = marcosLeads.map(l => l.id);
        const feedbackByLead = new Map<string, string>(); // lead_id → priority (mais recente)
        if (allPedroIds.length > 0 || allMarcosIds.length > 0) {
          // Pedro: filter por lead_id IN
          if (allPedroIds.length > 0) {
            const { data: pedroFb } = await (supabase as any)
              .from('pedro_manager_feedback')
              .select('lead_id, priority, created_at')
              .in('lead_id', allPedroIds)
              .order('created_at', { ascending: false });
            for (const fb of (pedroFb || []) as Array<{ lead_id: string; priority: string }>) {
              if (!feedbackByLead.has(fb.lead_id)) feedbackByLead.set(fb.lead_id, fb.priority);
            }
          }
          // Marcos: filter por crm_lead_id IN
          if (allMarcosIds.length > 0) {
            const { data: marcosFb } = await (supabase as any)
              .from('pedro_manager_feedback')
              .select('crm_lead_id, priority, created_at')
              .in('crm_lead_id', allMarcosIds)
              .order('created_at', { ascending: false });
            for (const fb of (marcosFb || []) as Array<{ crm_lead_id: string; priority: string }>) {
              if (!feedbackByLead.has(fb.crm_lead_id)) feedbackByLead.set(fb.crm_lead_id, fb.priority);
            }
          }
        }

        // 7. Calcula score de qualidade de cada lead, depois média geral
        const scores: number[] = [];
        for (const l of pedroLeads) {
          const iaScore    = scorePedroStatus(l.status_crm);
          const fbPriority = feedbackByLead.get(l.id);
          const fbScore    = fbPriority ? scoreFeedbackPriority(fbPriority) : null;
          const notesScore = scoreNotasCount(l.seller_notes_count);
          scores.push(combineLeadScore(iaScore, fbScore, notesScore));
        }
        for (const l of marcosLeads) {
          const iaScore    = scoreMarcosStage(l.stage?.name);
          const fbPriority = feedbackByLead.get(l.id);
          const fbScore    = fbPriority ? scoreFeedbackPriority(fbPriority) : null;
          // seller_notes_count nao existe em crm_leads — passa null pra
          // calculo de qualidade nao quebrar.
          const notesScore = scoreNotasCount(null);
          scores.push(combineLeadScore(iaScore, fbScore, notesScore));
        }
        const qualidadeMedia = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;
        const qualidadeLbl = qualidadeLabel(qualidadeMedia, scores.length > 0);

        // 8. Taxa de Transferência (Pedro: leads atribuídos / total leads Pedro)
        const taxaTransf = pedroTotal > 0 ? Math.round((pedroAtribuidos / pedroTotal) * 1000) / 10 : 0;
        const taxaTransfTexto = `${pedroAtribuidos} de ${pedroTotal} leads do Pedro`;

        // 9. Rank por total desc, tie-breaker alfabético.
        //    Spec usuario (30/05/2026): a row virtual "Sem vendedor atribuído"
        //    NUNCA aparece como card no ranking — nem quando tem leads. Leads sem
        //    vendedor (inclusive os de um vendedor EXCLUÍDO, cujos leads o painel
        //    desvincula) nao podem virar um card fantasma "Sem vendedor". Eles
        //    seguem contabilizados nos KPIs (Total + Origem) e no subtexto
        //    "(N sem vendedor atribuído)" — so nao ganham card proprio.
        const sorted = Object.values(agg)
          .filter(v => v.id !== NAO_ATRIBUIDO_ID)
          .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name))
          .map((v, i) => ({ ...v, rank: i + 1 }));
        setVendedores(sorted);

        // 10. KPIs gerais — 5 categorias visiveis. Spec 27/05/2026 Bug 1:
        //     OLX e Outros removidos. IMPORTANTE: os KPIs somam TODAS as rows
        //     (vendedores reais + virtual "Sem vendedor"), entao "Total de Leads"
        //     e "Origem dos Leads" continuam refletindo todos os leads mesmo
        //     agora que a row virtual saiu do ranking de cards (passo 9).
        const allRows = Object.values(agg); // reais + virtual "Sem vendedor"
        const porOrigem: Record<string, number> = {
          trafico_pago: 0, porta: 0, marketplace: 0, consignado: 0, indicacao: 0, redes_sociais: 0,
        };
        for (const v of allRows) {
          porOrigem.trafico_pago += v.trafico_pago;
          porOrigem.porta        += v.porta;
          porOrigem.marketplace  += v.marketplace;
          porOrigem.consignado   += v.consignado;
          porOrigem.indicacao    += v.indicacao;
          porOrigem.redes_sociais += v.redes_sociais; // MELHORIA 1 (29/05/2026)
        }
        // "Tráfego Pago" = TODOS os leads do Pedro (ai_crm_leads) no período:
        // atendidos pela IA + adicionados manual + transferidos. Inclui os ainda
        // NÃO atribuídos a vendedor. Assim bate com a contagem do CRM Avançado do
        // Pedro (que conta todos) e com o card "Real". Antes contava só atribuídos.
        porOrigem.trafico_pago = pedroTotal;
        // total_leads = soma dos v.total de todas as rows (vendedores reais
        // + virtual "Sem vendedor"). Sem duplo-contar: cada lead vai pra
        // exatamente uma row e incrementa apenas o v.total dela.
        const total = allRows.reduce((sum, v) => sum + v.total, 0);
        const percentuais: Record<string, number> = {};
        const baseParaPct = total > 0 ? total : 1;
        for (const k of Object.keys(porOrigem)) {
          percentuais[k] = Math.round((porOrigem[k] / baseParaPct) * 1000) / 10;
        }
        const costRows = Array.isArray(costsRes.data) ? costsRes.data : [];
        const costLevel = costRows.some((r: any) => r.entity_level === 'campaign')
          ? 'campaign'
          : costRows.some((r: any) => r.entity_level === 'adset')
            ? 'adset'
            : 'ad';
        const totalSpend = costRows
          .filter((r: any) => r.entity_level === costLevel)
          .reduce((sum: number, r: any) => sum + (Number(r.spend) || 0), 0);
        // Custo por Lead = gasto ÷ leads de TRÁFEGO PAGO (não todos os leads do
        // painel). Tráfego pago = leads do Pedro atribuídos (SDR + transferências
        // manuais + leads adicionados no Pedro). Não mistura porta/marketplace/etc.
        const custoPorLead = porOrigem.trafico_pago > 0 ? totalSpend / porOrigem.trafico_pago : 0;

        setLeadsNaoTransferidos(pedroNaoTransferidos);
        setKpis({
          total_leads: total,
          nao_atribuidos: naoAtribuidos,
          por_origem: porOrigem,
          percentuais,
          qualidade_media: qualidadeMedia,
          qualidade_label: qualidadeLbl,
          taxa_transferencia: taxaTransf,
          taxa_transferencia_texto: taxaTransfTexto,
          total_spend: totalSpend,
          custo_por_lead: custoPorLead,
        });
        // Sincroniza os cards filhos (ex.: Real vs Falso) a cada reload —
        // mount, poll de 30s e realtime (lead novo) — sem re-assinar o canal.
        setLiveTick(t => t + 1);
      } catch (err) {
        console.error('[DashboardTV] erro ao carregar:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Reload com debounce (evita reload-storm quando vários eventos chegam em sequência)
    const debouncedReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { if (!cancelled) load(); }, 1000);
    };

    load();

    // Polling 30s como fallback (caso realtime caia)
    const pollT = setInterval(load, 30_000);

    // Realtime subscription: dispara reload sempre que algo muda em qualquer das 3 tabelas
    // (com debounce 1s pra agrupar bursts). Garante "ao vivo" sem esperar polling.
    const channel = supabase
      .channel(`dashboard-tv-${effectiveUserId}-${sellerMemberId || 'master'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_team_members',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_crm_leads',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_lead_transfers',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'campaign_costs',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'crm_leads',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(pollT);
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [user?.id, profileLoading, effectiveUserId, sellerMemberId, dateRange.start, dateRange.end, reloadTrigger]);

  // Refresh manual (botão na toolbar) — incrementa trigger pra forçar useEffect a rodar de novo
  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTrigger(t => t + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // ── Próximo vendedor da fila (rodízio): quem nunca recebeu primeiro, senão o
  // que recebeu há mais tempo. Espelha a lógica do CrmAoVivo/uazapi-webhook.
  const nextSeller = useMemo(() => {
    const list = (queueSellers || []) as any[];
    if (!list.length) return null;
    const never = list.filter(s => !s.last_lead_received_at);
    if (never.length) return never[0];
    return [...list].sort((a, b) =>
      new Date(a.last_lead_received_at).getTime() - new Date(b.last_lead_received_at).getTime()
    )[0] || null;
  }, [queueSellers]);

  // Transfere o lead pro próximo da fila via manual-transfer (mesma função do
  // CRM). Confirma antes (envia WhatsApp real pro vendedor). Dedup de 30s no back.
  const handleTransferToNext = useCallback(async (lead: LeadNaoTransferido) => {
    const seller = nextSeller;
    if (!seller) { toast.warning('Nenhum vendedor ativo na fila pra receber.'); return; }
    const ok = window.confirm(`Transferir "${lead.nome}" para ${seller.name} (próximo da fila)?`);
    if (!ok) return;
    setTransferringId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer', {
        body: {
          leadId: lead.id,
          memberId: seller.id,
          notes: '',
          remoteJid: lead.remote_jid,
          agentId: lead.agent_id,
          leadName: lead.nome,
          ownerUserId: effectiveUserId,
        },
      });
      if (error) {
        let message = error.message || 'Não foi possível transferir.';
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); message = b?.error || message; } catch { /* ignore */ } }
        throw new Error(message);
      }
      if ((data as any)?.deduplicated) {
        toast.info(`"${lead.nome}" já estava em transferência (clique recente).`);
      } else {
        toast.success(`"${lead.nome}" transferido para ${seller.name}.`, { description: 'Briefing enviado ao vendedor no WhatsApp.' });
      }
      setReloadTrigger(t => t + 1);
    } catch (e: any) {
      toast.error('Erro ao transferir', { description: e?.message || 'Verifique a instância do WhatsApp.' });
    } finally {
      setTransferringId(null);
    }
  }, [nextSeller, effectiveUserId]);

  // Vendedor sem master_id resolvido: redirect (RLS bloquearia tudo de qualquer jeito)
  if (!embedded && !profileLoading && isSeller && !masterUserId) {
    return <Navigate to="/dashboard" replace />;
  }

  // Embedded (tab do Pedro SDR): fluxo normal, cresce com o conteúdo.
  // Standalone (TV): preenche exatamente a viewport (100dvh/100dvw) como
  // coluna flex, sem scroll. ~2% de padding em cada eixo = margem de overscan
  // pra TVs que cortam as bordas. A área de vendedores (flex-1) absorve a sobra.
  const wrapperClass = embedded
    ? 'min-h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
    : 'relative flex flex-col h-[100dvh] w-[100dvw] overflow-hidden px-[2vw] py-[2vh] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white';

  // Loading inicial (perfil + dados)
  if (profileLoading || (loading && !kpis)) {
    return (
      <div className={`${wrapperClass} flex items-center justify-center`}>
        <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
      </div>
    );
  }

  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Conteúdo do painel — reusado no modo embedded (aba do Pedro) e no modo
  // TV/tela cheia (renderizado num canvas escalado pra caber 100% na tela).
  const panelContent = (
    <>
      {/* ───── Header ───── */}
      <header className="shrink-0 border-b border-blue-900/50 px-8 py-4 flex items-center justify-between bg-slate-900/40 backdrop-blur">
        <div className="flex items-center gap-5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="logo" className="h-14 w-auto object-contain" />
          ) : (
            <div
              className="h-14 w-14 rounded-xl flex items-center justify-center font-bold text-2xl"
              style={{ background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.secondary_color})` }}
            >
              {(branding.company_name || '?')[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider">{branding.company_name}</h1>
            <p className="text-xs uppercase tracking-widest text-blue-300/70 mt-0.5">Dashboard Comercial · Produção em Tempo Real</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Data
            </span>
            <span className="text-base font-bold tabular-nums">{dateStr}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Hora
            </span>
            <span className="text-base font-bold tabular-nums">{timeStr}</span>
          </div>
          {/* Botões de ação */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={handleManualRefresh}
              className="h-9 w-9 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/50 flex items-center justify-center text-slate-300 transition-colors"
              title="Atualizar agora"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="h-9 w-9 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/50 flex items-center justify-center text-slate-300 transition-colors"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia (F11)'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ───── Toolbar de filtro de período ───── */}
      <div className="shrink-0 px-8 py-3 border-b border-slate-800/60 bg-slate-900/30 flex items-center gap-4 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-blue-300/60 font-bold">Período</span>
        <div className="flex items-center gap-1.5 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
          {([
            { id: 'today',     label: 'Hoje' },
            { id: 'yesterday', label: 'Ontem' },
            { id: '7days',     label: '7 dias' },
            { id: '30days',    label: '30 dias' },
            { id: 'custom',    label: 'Personalizado' },
          ] as const).map(opt => {
            const active = period === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setPeriod(opt.id)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={customRange.start}
              max={customRange.end}
              onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
            <span className="text-slate-500">até</span>
            <input
              type="date"
              value={customRange.end}
              min={customRange.start}
              onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
          </div>
        )}
        <span className="text-[10px] text-slate-500 italic ml-auto">
          📊 {dateRange.label} · sincronização em tempo real ativa
        </span>
      </div>

      {/* ───── Bloco KPIs principais (3 cards lado a lado) ───── */}
      <section className="shrink-0 px-8 py-[clamp(0.5rem,2.2vmin,1.5rem)] grid grid-cols-4 portrait:grid-cols-1 gap-4">
        {/* KPI 1: Leads Gerais */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Users className="h-7 w-7 text-blue-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">
            Leads Gerais · {dateRange.label}
          </p>
          <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color: branding.primary_color }}>
            {kpis?.total_leads ?? 0}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">Total de Leads</p>
          {(kpis?.nao_atribuidos ?? 0) > 0 && (
            <p className="text-[9px] text-amber-400/70 italic mt-1">
              ({kpis!.nao_atribuidos} sem vendedor atribuído)
            </p>
          )}
        </div>

        {/* KPI 2: Qualidade Média (IA 50% + Feedback 30% + Notas 20%) */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <DollarSign className="h-7 w-7 text-emerald-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Custo por Lead · Tráfego Pago</p>
          <p className="text-[clamp(1.4rem,4.2vmin,2.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none text-emerald-400">
            {formatBRL(kpis?.custo_por_lead ?? 0)}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">
            {formatBRL(kpis?.total_spend ?? 0)} investidos · {kpis?.por_origem?.trafico_pago ?? 0} leads
          </p>
        </div>

        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          {(() => {
            const score = kpis?.qualidade_media ?? 0;
            const label = kpis?.qualidade_label ?? 'Sem dados';
            const color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <>
                <Trophy className="h-7 w-7 mb-2" style={{ color }} />
                <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Qualidade Média</p>
                <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color }}>
                  {score}<span className="text-[clamp(0.9rem,2.2vmin,1.5rem)] portrait:text-[clamp(1rem,3vw,2rem)] text-slate-500">%</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest mt-3 font-bold" style={{ color }}>
                  {label}
                </p>
                <p className="text-[9px] text-slate-500 italic mt-1">IA 50% + Feedback 30% + Notas 20%</p>
              </>
            );
          })()}
        </div>

        {/* KPI 3: Taxa Transferência (% leads Pedro atribuídos a vendedor) */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Target className="h-7 w-7 text-purple-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Taxa Transferência</p>
          <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color: branding.secondary_color }}>
            {(kpis?.taxa_transferencia ?? 0).toFixed(1)}<span className="text-[clamp(0.9rem,2.2vmin,1.5rem)] portrait:text-[clamp(1rem,3vw,2rem)] text-slate-500">%</span>
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">
            {kpis?.taxa_transferencia_texto ?? '0 leads'}
          </p>
        </div>
      </section>

      {/* ───── Custo por Lead — Real vs Falso (Meta), só master ───── */}
      {!sellerMemberId && <CplComparativo userId={effectiveUserId} reloadKey={liveTick} />}

      {/* ───── Cards de Origem (linha completa abaixo) ───── */}
      <section className="shrink-0 px-8 pb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-3 font-bold">Origem dos Leads</h2>
        <div className="grid grid-cols-6 portrait:grid-cols-2 gap-3">
          {ORIGENS.map(origem => {
            const Icon = origem.icon;
            const valor = kpis?.por_origem[origem.key] ?? 0;
            const pct = kpis?.percentuais[origem.key] ?? 0;
            return (
              <div key={origem.key} className="bg-slate-900/60 rounded-xl p-[clamp(0.5rem,1.8vmin,1rem)] border border-slate-800 hover:border-slate-700 transition-colors">
                <Icon className="h-5 w-5 mb-2" style={{ color: origem.color }} />
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 truncate">{origem.label}</p>
                <p className="text-[clamp(1.25rem,3vmin,1.875rem)] font-black tabular-nums leading-none">{valor}</p>
                <p className="text-[10px] text-slate-500 mt-1.5">{pct.toFixed(2)}%</p>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: origem.color }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-center text-[10px] text-slate-500 italic mt-2">Dados atualizados automaticamente em tempo real via CRM</p>
      </section>

      {/* ───── PRODUÇÃO INDIVIDUAL DOS VENDEDORES ───── */}
      <section className="shrink-0 px-8 pb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-amber-300/80 font-bold">Leads Não Transferidos</h2>
          <p className="text-[10px] text-slate-500 italic">{leadsNaoTransferidos.length} pendente(s) no período</p>
        </div>

        {leadsNaoTransferidos.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-5 text-center text-sm text-slate-500">
            Nenhum lead pendente de transferência.
          </div>
        ) : (
          <div className="grid grid-cols-3 portrait:grid-cols-1 gap-3 max-h-44 overflow-y-auto pr-1">
            {leadsNaoTransferidos.map(lead => (
              <div
                key={lead.id}
                className="group rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 transition-colors hover:border-amber-400/60 hover:bg-amber-500/15"
              >
                <p className="truncate text-sm font-bold text-slate-100 group-hover:text-white">{lead.nome}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-amber-200/80">
                  <Phone className="h-3 w-3" />
                  {lead.telefone}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={transferringId === lead.id || !nextSeller}
                    onClick={() => handleTransferToNext(lead)}
                    className="flex-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title={nextSeller ? `Transferir para ${nextSeller.name} (próximo da fila)` : 'Sem vendedor ativo na fila'}
                  >
                    {transferringId === lead.id ? 'Transferindo…' : `→ Transferir${nextSeller ? ` (${nextSeller.name})` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/pedro?tab=crm&leadId=${lead.id}`)}
                    className="rounded-lg bg-slate-700/40 border border-slate-600/40 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700/60 transition-colors"
                    title="Abrir no CRM Avançado"
                  >
                    CRM
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="shrink-0 px-8 pb-16">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">Produção Individual dos Vendedores</h2>
          <p className="text-[10px] text-slate-500 italic">Total de Leads Trabalhados</p>
        </div>

        {vendedores.length === 0 ? (
          <div className="text-center text-slate-500 py-16 bg-slate-900/40 rounded-xl border border-slate-800">
            Nenhum vendedor ativo. Cadastre vendedores em Pedro SDR → Vendedores.
          </div>
        ) : (
          // auto-fit: os cards esticam pra preencher a largura inteira (menos
          // linhas em telas largas). Sem rolagem interna — o zoom da TV encaixa
          // tudo na tela. auto-rows-fr deixa as linhas com a mesma altura.
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] portrait:grid-cols-2 gap-3 auto-rows-fr">
            {vendedores.slice(0, 12).map(v => (
              <VendedorCard key={v.id} v={v} secondary={branding.secondary_color} />
            ))}
          </div>
        )}
      </section>

      {/* ───── Destaque do Dia (fixed bottom) — pula row virtual "Sem vendedor" ───── */}
      {(() => {
        const destaque = vendedores.find(v => v.id !== '__nao_atribuido__' && v.total > 0);
        if (!destaque) return null;
        return (
          <div className={`${embedded ? 'fixed bottom-4' : 'absolute bottom-[3vh]'} left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/40 rounded-full px-6 py-2.5 flex items-center gap-3 backdrop-blur shadow-2xl`}>
            <Trophy className="h-5 w-5 text-amber-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300">Destaque do Dia</span>
            <span className="text-sm font-bold">{destaque.name}</span>
            <span className="text-xs text-amber-300/80 font-semibold">· {destaque.total} leads</span>
          </div>
        );
      })()}
    </>
  );

  // Embedded (aba do Pedro SDR): cresce com o conteúdo, sem escala.
  if (embedded) {
    return (
      <div ref={containerRef} className={wrapperClass}>
        {panelContent}
      </div>
    );
  }

  // TV / TELA CHEIA: ZOOM estilo navegador. O painel é escalado por `zoom` a partir
  // do canto superior esquerdo; a largura é compensada (100/zoom%) pra PREENCHER a
  // largura sem barra horizontal. O fundo cobre 100% da tela real. Sem barras de
  // rolagem (overflow-hidden). O controle de zoom fica por cima, fora da escala.
  return (
    <div
      ref={containerRef}
      className="relative h-[100dvh] w-[100dvw] overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
    >
      <div
        ref={contentRef}
        className="relative flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white"
        style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        {panelContent}
      </div>
      <ZoomControl
        zoom={zoom}
        mode={zoomMode}
        visible={controlsVisible}
        onZoom={(z) => { setZoom(z); setZoomMode('manual'); }}
        onAuto={() => setZoomMode('auto')}
      />
    </div>
  );
}

// ─── Controle de Zoom (modo TV) — slider + botões + Auto ─────────────────────
// Fica por cima do painel, FORA da área escalada. Discreto (some um pouco quando
// não está com o mouse em cima). Ajusta o zoom estilo navegador.
function ZoomControl({
  zoom, mode, onZoom, onAuto, visible,
}: {
  zoom: number;
  mode: 'auto' | 'manual';
  onZoom: (z: number) => void;
  onAuto: () => void;
  visible: boolean;
}) {
  const pct = Math.round(zoom * 100);
  const step = (d: number) => onZoom(Math.max(0.5, Math.min(2, +(zoom + d).toFixed(2))));
  return (
    <div
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-slate-900/85 border border-slate-700 px-3 py-1.5 backdrop-blur shadow-xl transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <button
        onClick={() => step(-0.05)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 text-lg leading-none"
        title="Diminuir zoom"
      >−</button>
      <input
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={zoom}
        onChange={(e) => onZoom(parseFloat(e.target.value))}
        className="w-32 accent-blue-500 cursor-pointer"
        title="Ajustar zoom"
      />
      <button
        onClick={() => step(0.05)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 text-lg leading-none"
        title="Aumentar zoom"
      >+</button>
      <span className="text-[11px] tabular-nums text-slate-300 w-10 text-center">{pct}%</span>
      <button
        onClick={onAuto}
        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors ${
          mode === 'auto'
            ? 'bg-blue-500/30 border-blue-400 text-blue-200'
            : 'border-slate-600 text-slate-300 hover:bg-slate-700'
        }`}
        title="Ajuste automático à tela"
      >Auto</button>
    </div>
  );
}

// ─── Card individual de vendedor ────────────────────────────────────────────

function VendedorCard({ v, secondary }: { v: VendedorData; secondary: string }) {
  const rColor = rankColor(v.rank);
  const avatarColor = hashColor(v.id);

  return (
    <div className="h-full flex flex-col bg-slate-900/60 rounded-xl p-[clamp(0.4rem,1.5vmin,0.75rem)] border border-slate-800">
      {/* Header: rank + nome */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-md"
          style={{ color: rColor, background: `${rColor}22`, border: `1px solid ${rColor}44` }}
        >
          {v.rank}º
        </span>
        <span className="text-sm font-bold uppercase truncate flex-1">{v.name}</span>
      </div>

      {/* Avatar — prioridade: profiles.avatar_url > ai_team_members.profile_picture > iniciais */}
      <div className="flex justify-center mb-3">
        {v.effective_avatar ? (
          <img
            src={v.effective_avatar}
            alt={v.name}
            className="h-16 w-16 portrait:h-12 portrait:w-12 rounded-full object-cover border-2"
            style={{ borderColor: rColor }}
            onError={(e) => {
              // Se URL quebrar (ex: foto deletada), esconde a img → React Fragment vazio mostra fallback no próximo render
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            className="h-16 w-16 portrait:h-12 portrait:w-12 rounded-full flex items-center justify-center font-bold text-xl border-2 text-white"
            style={{ background: avatarColor, borderColor: rColor }}
          >
            {getInitials(v.name)}
          </div>
        )}
      </div>

      {/* Breakdown por origem — 6 colunas (MELHORIA 1 29/05/2026: + Redes Sociais) */}
      <div className="space-y-1">
        <BreakdownRow label="Tráfego Pago" value={v.trafico_pago}  color="#3b82f6" />
        <BreakdownRow label="Porta"        value={v.porta}         color="#f59e0b" />
        <BreakdownRow label="Marketplace"  value={v.marketplace}   color="#a855f7" />
        <BreakdownRow label="Consignado"   value={v.consignado}    color="#06b6d4" />
        <BreakdownRow label="Indicação"    value={v.indicacao}     color="#fb923c" />
        <BreakdownRow label="Redes Sociais" value={v.redes_sociais} color="#ec4899" />
      </div>

      {/* Total */}
      <div className="mt-auto pt-2 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total</span>
        <span className="text-[clamp(1.1rem,2.6vmin,1.5rem)] font-black tabular-nums" style={{ color: secondary }}>{v.total}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 text-slate-400 truncate">{label}</span>
      <span className="font-bold tabular-nums" style={{ color: value > 0 ? '#ffffff' : '#475569' }}>{value}</span>
    </div>
  );
}
