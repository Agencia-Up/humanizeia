// ============================================================================
// DashboardTV
// ----------------------------------------------------------------------------
// Dashboard comercial em tempo real pra projetar em TV (fullscreen F11).
// Mostra produção do dia agregando leads do Pedro (ai_crm_leads) +
// Marcos (crm_leads) por vendedor e por origem.
//
// Regras de agregação:
//   • TRÁFEGO PAGO = ai_crm_leads com assigned_to_id IS NOT NULL
//   • PORTA        = crm_leads WHERE origem='porta'
//   • OLX          = crm_leads WHERE origem='olx'
//   • MARKETPLACE  = crm_leads WHERE origem='marketplace'
//   • CONSIGNADO   = crm_leads WHERE origem='consignado'
//   • INDICAÇÃO    = crm_leads WHERE origem='indicacao'
//
// Período: apenas leads do dia atual (created_at >= 00:00 local).
// Atualização: polling a cada 30s + relógio digital atualiza a cada 1s.
// Permissão: APENAS master (vendedor redirecionado pra /dashboard).
// Branding: usa colunas profiles.dashboard_tv_* (configurável na Etapa 3).
//
// Layout inspirado em painel ICOM Motors — mas marca/cores customizáveis.
// ============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { Calendar, Clock, Loader2, Target, DoorOpen, ShoppingBag, Globe, Users, Phone, Trophy, Maximize2, Minimize2, RefreshCw, Tag } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface VendedorData {
  id: string;
  name: string;
  /** Foto exibida no card. Prioridade: profiles.avatar_url (vendedor) > ai_team_members.profile_picture (master) > null (fallback iniciais). */
  effective_avatar: string | null;
  rank: number;
  trafico_pago: number;
  porta: number;
  olx: number;
  marketplace: number;
  consignado: number;
  indicacao: number;
  outros: number;
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

// ─── Config visual das 6 origens (ordem da imagem ICOM) ─────────────────────

const ORIGENS = [
  { key: 'trafico_pago', label: 'Tráfego Pago', icon: Target,      color: '#3b82f6' },
  { key: 'porta',        label: 'Porta',        icon: DoorOpen,    color: '#f59e0b' },
  { key: 'olx',          label: 'OLX',          icon: ShoppingBag, color: '#84cc16' },
  { key: 'marketplace',  label: 'Marketplace',  icon: Globe,       color: '#a855f7' },
  { key: 'indicacao',    label: 'Indicação',    icon: Users,       color: '#fb923c' },
  { key: 'consignado',   label: 'Consignado',   icon: Phone,       color: '#06b6d4' },
  { key: 'outros',       label: 'Outros',       icon: Tag,         color: '#94a3b8' },
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

  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vendedores, setVendedores] = useState<VendedorData[]>([]);
  const [kpis, setKpis] = useState<KPIsData | null>(null);
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

  // Trigger pra refresh manual (incrementa = força reload)
  const [reloadTrigger, setReloadTrigger] = useState(0);

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
        let sellersQuery = (supabase as any)
          .from('ai_team_members')
          .select('id, name, profile_picture, auth_user_id')
          .eq('user_id', effectiveUserId)
          .eq('is_active', true);
        if (sellerMemberId) sellersQuery = sellersQuery.eq('id', sellerMemberId);

        // 3. Leads Pedro do período. +status_crm +seller_notes_count pra cálculo de qualidade.
        //    Pra "Taxa Transferência" precisamos contar TODOS leads Pedro (com e sem assigned_to_id).
        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, assigned_to_id, status_crm, seller_notes_count')
          .eq('user_id', effectiveUserId)
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd);
        if (sellerMemberId) pedroQuery = pedroQuery.eq('assigned_to_id', sellerMemberId);
        // (sem filtro 'assigned_to_id not null' — preciso do total pra taxa)

        // 4. Leads Marcos do período. +stage_id +seller_notes_count + JOIN com stages pra nome.
        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, origem, assigned_to, stage_id, seller_notes_count, stage:crm_pipeline_stages(name)')
          .eq('user_id', effectiveUserId)
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd);
        if (sellerMemberId) marcosQuery = marcosQuery.eq('assigned_to', sellerMemberId);

        const [profileRes, sellersRes, pedroRes, marcosRes] = await Promise.all([
          profilePromise, sellersQuery, pedroQuery, marcosQuery,
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
        const sellersList = (sellersRes.data || []) as Array<{ id: string; name: string; profile_picture: string | null; auth_user_id: string | null }>;
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
            trafico_pago: 0, porta: 0, olx: 0, marketplace: 0, consignado: 0, indicacao: 0, outros: 0, total: 0,
          };
        }

        // 4. Pedro: contar trafico_pago (precisa de assigned_to_id) E coletar dados pra qualidade/taxa
        const pedroLeads = (pedroRes.data || []) as Array<{
          id: string; assigned_to_id: string | null; status_crm: string | null; seller_notes_count: number | null;
        }>;
        let pedroTotal = 0;       // total leads Pedro no período (todos)
        let pedroAtribuidos = 0;  // leads Pedro com assigned_to_id != null
        let naoAtribuidos = 0;    // leads (Pedro+Marcos) que não foram pra vendedor — contam no total mas não no card de vendedor
        for (const l of pedroLeads) {
          pedroTotal++;
          if (l.assigned_to_id) {
            pedroAtribuidos++;
            const v = agg[l.assigned_to_id];
            if (v) { v.trafico_pago++; v.total++; }
            else naoAtribuidos++; // assigned_to_id aponta pra vendedor que sumiu da lista
          } else {
            naoAtribuidos++; // lead Pedro novo, ainda sem transfer pra vendedor
          }
        }

        // 5. Marcos: agrupa por origem (6 categorias). 'outros' agora conta
        //    também (era o default do form e ficava invisível). Leads sem
        //    vendedor sao somados em naoAtribuidos pra TV refletir TUDO.
        const marcosLeads = (marcosRes.data || []) as Array<{
          id: string; origem: string | null; assigned_to: string | null; stage_id: string | null;
          seller_notes_count: number | null; stage: { name: string } | null;
        }>;
        for (const l of marcosLeads) {
          const v = agg[l.assigned_to || ''];
          const o = (l.origem || 'outros') as string;
          if (!v) {
            // Lead sem vendedor (ou vendedor desativado/removido): conta no
            // total geral mas nao em vendedor especifico.
            naoAtribuidos++;
            continue;
          }
          if (o === 'porta')           { v.porta++;       v.total++; }
          else if (o === 'olx')        { v.olx++;         v.total++; }
          else if (o === 'marketplace'){ v.marketplace++; v.total++; }
          else if (o === 'consignado') { v.consignado++;  v.total++; }
          else if (o === 'indicacao')  { v.indicacao++;   v.total++; }
          else                         { v.outros++;      v.total++; } // 'outros' + qualquer origem desconhecida
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
          const notesScore = scoreNotasCount(l.seller_notes_count);
          scores.push(combineLeadScore(iaScore, fbScore, notesScore));
        }
        const qualidadeMedia = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;
        const qualidadeLbl = qualidadeLabel(qualidadeMedia, scores.length > 0);

        // 8. Taxa de Transferência (Pedro: leads atribuídos / total leads Pedro)
        const taxaTransf = pedroTotal > 0 ? Math.round((pedroAtribuidos / pedroTotal) * 1000) / 10 : 0;
        const taxaTransfTexto = `${pedroAtribuidos} de ${pedroTotal} leads do Pedro`;

        // 9. Rank por total desc, tie-breaker alfabético
        const sorted = Object.values(agg)
          .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name))
          .map((v, i) => ({ ...v, rank: i + 1 }));
        setVendedores(sorted);

        // 10. KPIs gerais — incluem 'outros' (7a categoria) e os leads
        //     sem vendedor (nao_atribuidos) somam no total_leads geral.
        const porOrigem: Record<string, number> = {
          trafico_pago: 0, porta: 0, olx: 0, marketplace: 0, consignado: 0, indicacao: 0, outros: 0,
        };
        for (const v of sorted) {
          porOrigem.trafico_pago += v.trafico_pago;
          porOrigem.porta        += v.porta;
          porOrigem.olx          += v.olx;
          porOrigem.marketplace  += v.marketplace;
          porOrigem.consignado   += v.consignado;
          porOrigem.indicacao    += v.indicacao;
          porOrigem.outros       += v.outros;
        }
        // total_leads = soma dos atribuidos + os nao_atribuidos (TV
        // mostra TUDO que foi cadastrado no periodo).
        const totalAtribuidos = Object.values(porOrigem).reduce((a, b) => a + b, 0);
        const total = totalAtribuidos + naoAtribuidos;
        const percentuais: Record<string, number> = {};
        const baseParaPct = total > 0 ? total : 1;
        for (const k of Object.keys(porOrigem)) {
          percentuais[k] = Math.round((porOrigem[k] / baseParaPct) * 1000) / 10;
        }
        setKpis({
          total_leads: total,
          nao_atribuidos: naoAtribuidos,
          por_origem: porOrigem,
          percentuais,
          qualidade_media: qualidadeMedia,
          qualidade_label: qualidadeLbl,
          taxa_transferencia: taxaTransf,
          taxa_transferencia_texto: taxaTransfTexto,
        });
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

  // Vendedor sem master_id resolvido: redirect (RLS bloquearia tudo de qualquer jeito)
  if (!embedded && !profileLoading && isSeller && !masterUserId) {
    return <Navigate to="/dashboard" replace />;
  }

  const wrapperClass = embedded
    ? 'min-h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
    : 'min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden';

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

  return (
    <div ref={containerRef} className={wrapperClass}>
      {/* ───── Header ───── */}
      <header className="border-b border-blue-900/50 px-8 py-4 flex items-center justify-between bg-slate-900/40 backdrop-blur">
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
      <div className="px-8 py-3 border-b border-slate-800/60 bg-slate-900/30 flex items-center gap-4 flex-wrap">
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
      <section className="px-8 py-6 grid grid-cols-3 gap-4">
        {/* KPI 1: Leads Gerais */}
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Users className="h-7 w-7 text-blue-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">
            Leads Gerais · {dateRange.label}
          </p>
          <p className="text-6xl font-black tabular-nums leading-none" style={{ color: branding.primary_color }}>
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
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-blue-900/40 flex flex-col items-center justify-center text-center">
          {(() => {
            const score = kpis?.qualidade_media ?? 0;
            const label = kpis?.qualidade_label ?? 'Sem dados';
            const color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <>
                <Trophy className="h-7 w-7 mb-2" style={{ color }} />
                <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Qualidade Média</p>
                <p className="text-6xl font-black tabular-nums leading-none" style={{ color }}>
                  {score}<span className="text-2xl text-slate-500">%</span>
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
        <div className="bg-slate-900/60 rounded-2xl p-6 border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Target className="h-7 w-7 text-purple-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Taxa Transferência</p>
          <p className="text-6xl font-black tabular-nums leading-none" style={{ color: branding.secondary_color }}>
            {(kpis?.taxa_transferencia ?? 0).toFixed(1)}<span className="text-2xl text-slate-500">%</span>
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">
            {kpis?.taxa_transferencia_texto ?? '0 leads'}
          </p>
        </div>
      </section>

      {/* ───── 7 cards de Origem (linha completa abaixo) ───── */}
      <section className="px-8 pb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-3 font-bold">Origem dos Leads</h2>
        <div className="grid grid-cols-7 gap-3">
          {ORIGENS.map(origem => {
            const Icon = origem.icon;
            const valor = kpis?.por_origem[origem.key] ?? 0;
            const pct = kpis?.percentuais[origem.key] ?? 0;
            return (
              <div key={origem.key} className="bg-slate-900/60 rounded-xl p-4 border border-slate-800 hover:border-slate-700 transition-colors">
                <Icon className="h-5 w-5 mb-2" style={{ color: origem.color }} />
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 truncate">{origem.label}</p>
                <p className="text-3xl font-black tabular-nums leading-none">{valor}</p>
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
      <section className="px-8 pb-20">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">Produção Individual dos Vendedores</h2>
          <p className="text-[10px] text-slate-500 italic">Total de Leads Trabalhados</p>
        </div>

        {vendedores.length === 0 ? (
          <div className="text-center text-slate-500 py-16 bg-slate-900/40 rounded-xl border border-slate-800">
            Nenhum vendedor ativo. Cadastre vendedores em Pedro SDR → Vendedores.
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {vendedores.slice(0, 10).map(v => (
              <VendedorCard key={v.id} v={v} secondary={branding.secondary_color} />
            ))}
          </div>
        )}
      </section>

      {/* ───── Destaque do Dia (fixed bottom) ───── */}
      {vendedores[0] && vendedores[0].total > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/40 rounded-full px-6 py-2.5 flex items-center gap-3 backdrop-blur shadow-2xl">
          <Trophy className="h-5 w-5 text-amber-400" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300">Destaque do Dia</span>
          <span className="text-sm font-bold">{vendedores[0].name}</span>
          <span className="text-xs text-amber-300/80 font-semibold">· {vendedores[0].total} leads</span>
        </div>
      )}
    </div>
  );
}

// ─── Card individual de vendedor ────────────────────────────────────────────

function VendedorCard({ v, secondary }: { v: VendedorData; secondary: string }) {
  const rColor = rankColor(v.rank);
  const avatarColor = hashColor(v.id);

  return (
    <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800">
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
            className="h-16 w-16 rounded-full object-cover border-2"
            style={{ borderColor: rColor }}
            onError={(e) => {
              // Se URL quebrar (ex: foto deletada), esconde a img → React Fragment vazio mostra fallback no próximo render
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            className="h-16 w-16 rounded-full flex items-center justify-center font-bold text-xl border-2 text-white"
            style={{ background: avatarColor, borderColor: rColor }}
          >
            {getInitials(v.name)}
          </div>
        )}
      </div>

      {/* Breakdown por origem */}
      <div className="space-y-1">
        <BreakdownRow label="Tráfego Pago" value={v.trafico_pago} color="#3b82f6" />
        <BreakdownRow label="Porta"        value={v.porta}        color="#f59e0b" />
        <BreakdownRow label="OLX"          value={v.olx}          color="#84cc16" />
        <BreakdownRow label="Marketplace"  value={v.marketplace}  color="#a855f7" />
        <BreakdownRow label="Consignado"   value={v.consignado}   color="#06b6d4" />
        <BreakdownRow label="Indicação"    value={v.indicacao}    color="#fb923c" />
        <BreakdownRow label="Outros"       value={v.outros}       color="#94a3b8" />
      </div>

      {/* Total */}
      <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total</span>
        <span className="text-2xl font-black tabular-nums" style={{ color: secondary }}>{v.total}</span>
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
