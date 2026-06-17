import { useEffect, useMemo, useState, type ElementType } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import {
  AlertCircle,
  BarChart3,
  Bot,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Megaphone,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  UserCircle2,
  Users,
} from 'lucide-react';

// ─── Tipos dos filtros ──────────────────────────────────────────────────────
// today = dia atual; week = semana atual seg→dom; month = mês atual;
// custom = intervalo personalizado via date picker.
type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

interface CustomRange { start: string; end: string }

interface DateRange { start: string; end: string; label: string }

function resolveDateRange(preset: PeriodPreset, custom: CustomRange): DateRange {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Hoje' };
  }
  if (preset === 'week') {
    const dow = now.getDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const s = new Date(now); s.setDate(now.getDate() + diffToMonday); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Esta semana' };
  }
  if (preset === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Este mês' };
  }
  const s = custom.start ? new Date(custom.start + 'T00:00:00') : new Date();
  const e = custom.end   ? new Date(custom.end   + 'T23:59:59.999') : new Date();
  return { start: s.toISOString(), end: e.toISOString(), label: 'Personalizado' };
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PERIOD_OPTIONS: ReadonlyArray<{ id: PeriodPreset; label: string }> = [
  { id: 'today', label: 'Dia' },
  { id: 'week',  label: 'Semana' },
  { id: 'month', label: 'Mês' },
  { id: 'custom', label: 'Personalizado' },
];

type FunnelMetric = {
  label: string;
  value: number;
  accent: string;
  description: string;
};

type SellerRanking = {
  id: string;
  name: string;
  pedro: number;
  marcos: number;
  total: number;
};

// DashboardData: tudo EXCETO o ranking (que vive em hook próprio
// com filtros independentes — spec 27/05/2026).
type DashboardData = {
  pedroTotal: number;
  pedroToday: number;
  pedroTransferred: number;
  pedroWaiting: number;
  marcosTotal: number;
  marcosToday: number;
  marcosFollowups: number;
  marcosCampaigns: number;
  pedroFunnel: FunnelMetric[];
  marcosFunnel: FunnelMetric[];
  weekly: { label: string; pedro: number; marcos: number }[];
  alerts: { title: string; body: string; tone: 'info' | 'warn' | 'good' }[];
};

const emptyData: DashboardData = {
  pedroTotal: 0,
  pedroToday: 0,
  pedroTransferred: 0,
  pedroWaiting: 0,
  marcosTotal: 0,
  marcosToday: 0,
  marcosFollowups: 0,
  marcosCampaigns: 0,
  pedroFunnel: [],
  marcosFunnel: [],
  weekly: [],
  alerts: [],
};

const pedroStatusLabels: Record<string, { label: string; accent: string; description: string }> = {
  novo: { label: 'Novo', accent: 'bg-sky-400', description: 'Entraram pelo Pedro' },
  inativo: { label: 'Lead Inativo', accent: 'bg-slate-400', description: 'Sem resposta recente' },
  carro_nao_disponivel: { label: 'Carro nao disponivel', accent: 'bg-rose-400', description: 'Opcao fora de estoque' },
  em_atendimento: { label: 'Agendamento', accent: 'bg-cyan-400', description: 'Visita ou contato marcado' },
  negociacao: { label: 'Negociacao', accent: 'bg-purple-400', description: 'Vendedor em tratativa' },
  fechado: { label: 'Venda concluída', accent: 'bg-emerald-400', description: 'Venda concluida' },
};

const normalizeStatus = (status: string | null | undefined) => {
  const value = (status || 'novo').trim();
  if (['interessado', 'qualificado', 'pouco_qualificado', 'medio_qualificado'].includes(value)) return 'novo';
  if (value === 'transferido') return 'em_atendimento';
  return value;
};

const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const shortWeekday = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', '');

function statByDate(items: any[], date: Date) {
  const start = startOfDay(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return items.filter(item => {
    const created = new Date(item.created_at);
    return created >= start && created < end;
  }).length;
}

export function CompactKpi({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  sub: string;
  icon: ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
          <p className="mt-3 text-3xl font-bold leading-none text-foreground">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function FunnelPanel({
  title,
  badge,
  items,
}: {
  title: string;
  badge: string;
  items: FunnelMetric[];
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
          {badge}
        </span>
      </div>
      <div className="space-y-2.5">
        {items.map(item => (
          <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-border/40 bg-background/35 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.accent}`} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{item.label}</p>
                <p className="truncate text-xs text-muted-foreground">{item.description}</p>
              </div>
            </div>
            <span className="text-2xl font-bold tabular-nums text-foreground">{item.value}</span>
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum dado encontrado.
          </div>
        )}
      </div>
    </div>
  );
}

export function useCommercialDashboardData(userId: string | undefined, dateRange: DateRange, filterSellerId?: string | null) {
  const { isSeller, seller, masterUserId, memberIds, loading: sellerLoading } = useSellerProfile(userId);
  const memberIdsKey = (memberIds || []).join(',');
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const effectiveUserId = isSeller ? masterUserId : userId;

  useEffect(() => {
    if (sellerLoading || !effectiveUserId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const today = startOfDay();
        // Vendedor logado: TODOS os registros dele (modelo matriz = 1 por agente),
        // via .in(memberIds). Master: filtro global opcional (1 vendedor), via .eq.
        const sellerMemberIds = isSeller
          ? ((memberIds && memberIds.length) ? memberIds : ['00000000-0000-0000-0000-000000000000'])
          : null;
        const masterSellerId = !isSeller ? (filterSellerId || null) : null;
        const applySeller = (qb: any, col: string) =>
          sellerMemberIds ? qb.in(col, sellerMemberIds) : (masterSellerId ? qb.eq(col, masterSellerId) : qb);

        // Filtros DATA aplicados em todas as queries de leads/campanhas/followups
        // (spec: filtro global afeta TUDO menos o Ranking, que tem hook próprio).
        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, status, status_crm, assigned_to_id, created_at')
          .eq('user_id', effectiveUserId)
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end)
          .order('created_at', { ascending: false })
          .limit(5000);
        pedroQuery = applySeller(pedroQuery, 'assigned_to_id');

        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, stage_id, assigned_to, source, created_at, custom_fields')
          .eq('user_id', effectiveUserId)
          .not('source', 'like', 'Pedro SDR%')
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end)
          .order('created_at', { ascending: false })
          .limit(5000);
        marcosQuery = applySeller(marcosQuery, 'assigned_to');

        let campaignsQuery = (supabase as any)
          .from('wa_campaigns')
          .select('id, status, sent_count, failed_count, total_contacts, seller_member_id, created_at')
          .eq('user_id', effectiveUserId)
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end);
        campaignsQuery = applySeller(campaignsQuery, 'seller_member_id');

        let followupsQuery = (supabase as any)
          .from('marcos_followup_schedules')
          .select('id, status, seller_member_id, created_at')
          .eq('user_id', effectiveUserId)
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end);
        followupsQuery = applySeller(followupsQuery, 'seller_member_id');

        const [pedroRes, marcosRes, stagesRes, campaignsRes, followupsRes] = await Promise.all([
          pedroQuery,
          marcosQuery,
          (supabase as any)
            .from('crm_pipeline_stages')
            .select('id, name, color, position')
            .eq('user_id', effectiveUserId)
            .order('position', { ascending: true }),
          campaignsQuery,
          followupsQuery,
        ]);

        if (cancelled) return;

        const pedroLeads = pedroRes.data || [];
        const marcosLeads = marcosRes.data || [];
        const stages = stagesRes.data || [];
        const campaigns = campaignsRes.data || [];
        const followups = followupsRes.data || [];

        const pedroFunnel = Object.entries(pedroStatusLabels).map(([status, config]) => ({
          label: config.label,
          value: pedroLeads.filter((lead: any) => normalizeStatus(lead.status_crm || lead.status) === status).length,
          accent: config.accent,
          description: config.description,
        }));

        const firstStageId = stages[0]?.id || 'novo';
        const marcosFunnel = (stages.length ? stages : [{ id: 'novo', name: 'Novo Lead', color: '#38bdf8' }])
          .slice(0, 6)
          .map((stage: any, index: number) => ({
            label: stage.name || 'Sem etapa',
            value: marcosLeads.filter((lead: any) => (lead.stage_id || firstStageId) === stage.id).length,
            accent: ['bg-sky-400', 'bg-cyan-400', 'bg-amber-400', 'bg-purple-400', 'bg-emerald-400', 'bg-rose-400'][index] || 'bg-slate-400',
            description: index === 0 ? 'Entrada manual' : 'Etapa do Marcos',
          }));

        const weekly = Array.from({ length: 7 }).map((_, index) => {
          const date = new Date();
          date.setDate(date.getDate() - (6 - index));
          return {
            label: shortWeekday(date),
            pedro: statByDate(pedroLeads, date),
            marcos: statByDate(marcosLeads, date),
          };
        });

        const pedroTransferred = pedroLeads.filter((lead: any) => lead.assigned_to_id).length;
        const pedroWaiting = pedroLeads.filter((lead: any) => normalizeStatus(lead.status_crm || lead.status) === 'novo' && !lead.assigned_to_id).length;
        const marcosFollowups = followups.filter((f: any) => ['scheduled', 'pending'].includes(String(f.status || '').toLowerCase())).length;
        const marcosCampaigns = campaigns.filter((c: any) => ['running', 'scheduled'].includes(String(c.status || '').toLowerCase())).length;
        const marcosWithoutSeller = marcosLeads.filter((lead: any) => !lead.assigned_to && !lead.custom_fields?.seller_member_id).length;

        const alerts: DashboardData['alerts'] = [
          pedroWaiting > 0
            ? { tone: 'warn', title: `${pedroWaiting} lead(s) novos no Pedro`, body: 'Acompanhe se precisam de transferencia ou retorno humano.' }
            : { tone: 'good', title: 'Pedro sem fila critica', body: 'Nao ha volume relevante parado sem vendedor.' },
          marcosWithoutSeller > 0
            ? { tone: 'warn', title: `${marcosWithoutSeller} lead(s) sem vendedor no Marcos`, body: 'Vale revisar imports manuais e distribuicao da equipe.' }
            : { tone: 'good', title: 'Marcos com responsaveis em dia', body: 'Os leads manuais estao atribuidos corretamente.' },
          marcosCampaigns > 0
            ? { tone: 'info', title: `${marcosCampaigns} campanha(s) ativa(s)`, body: 'Monitore entregas e falhas no disparo em massa.' }
            : { tone: 'info', title: 'Nenhuma campanha ativa agora', body: 'Bom momento para planejar uma nova acao de retomada.' },
        ];

        setData({
          pedroTotal: pedroLeads.length,
          pedroToday: pedroLeads.filter((lead: any) => new Date(lead.created_at) >= today).length,
          pedroTransferred,
          pedroWaiting,
          marcosTotal: marcosLeads.length,
          marcosToday: marcosLeads.filter((lead: any) => new Date(lead.created_at) >= today).length,
          marcosFollowups,
          marcosCampaigns,
          pedroFunnel,
          marcosFunnel,
          weekly,
          alerts,
        });
      } catch (err) {
        console.error('[CommercialDashboard] failed to load dashboard data', err);
        if (!cancelled) setData(emptyData);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [effectiveUserId, isSeller, seller?.id, memberIdsKey, sellerLoading, refreshKey, dateRange.start, dateRange.end, filterSellerId]);

  return { data, loading, refresh: () => setRefreshKey(key => key + 1) };
}

// ─── Hook RANKING (filtros INDEPENDENTES do global) ──────────────────────
// Recebe rankDateRange + rankSellerId, retorna ranking + lista de vendedores
// pra popular o dropdown.
function useRankingData(userId: string | undefined, rankDateRange: DateRange, rankSellerId: string) {
  const { isSeller, seller, masterUserId, loading: sellerLoading } = useSellerProfile(userId);
  const [ranking, setRanking] = useState<SellerRanking[]>([]);
  const [allSellers, setAllSellers] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const effectiveUserId = isSeller ? masterUserId : userId;

  // Fetch da lista de vendedores ao montar (1×, sem filtros).
  useEffect(() => {
    if (sellerLoading || !effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const { data: teamData } = await (supabase as any)
        .from('ai_team_members')
        .select('*')
        .eq('user_id', effectiveUserId)
        .order('name', { ascending: true });
      if (cancelled) return;
      // Vendedores ATIVOS NO SISTEMA — não filtra pelo status do agente de IA
      // (is_active). !== false p/ resiliência se a migration ainda não rodou.
      setAllSellers((teamData || []).filter((s: any) => s.active_in_system !== false) as Array<{ id: string; name: string }>);
    })();
    return () => { cancelled = true; };
  }, [effectiveUserId, sellerLoading]);

  // Fetch do ranking quando filtros mudam.
  useEffect(() => {
    if (sellerLoading || !effectiveUserId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Seller vê só ele mesmo (spec: filtro de vendedor fixado no logado).
        const forcedSellerId = isSeller ? seller?.id : null;
        const targetSellerId = forcedSellerId || (rankSellerId === 'all' ? null : rankSellerId);

        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, assigned_to_id, created_at')
          .eq('user_id', effectiveUserId)
          .gte('created_at', rankDateRange.start).lte('created_at', rankDateRange.end)
          .limit(5000);
        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, assigned_to, custom_fields, created_at')
          .eq('user_id', effectiveUserId)
          .not('source', 'like', 'Pedro SDR%')
          .gte('created_at', rankDateRange.start).lte('created_at', rankDateRange.end)
          .limit(5000);
        const teamQuery = (supabase as any)
          .from('ai_team_members')
          .select('*')
          .eq('user_id', effectiveUserId);

        if (targetSellerId) {
          pedroQuery = pedroQuery.eq('assigned_to_id', targetSellerId);
          marcosQuery = marcosQuery.eq('assigned_to', targetSellerId);
        }

        const [pedroRes, marcosRes, teamRes] = await Promise.all([pedroQuery, marcosQuery, teamQuery]);
        if (cancelled) return;

        const pedroLeads = pedroRes.data || [];
        const marcosLeads = marcosRes.data || [];
        // Ativos NO SISTEMA (visibilidade) — não filtra pelo status do agente.
        const team = ((teamRes.data || []) as any[]).filter((t: any) => t.active_in_system !== false) as Array<{ id: string; name: string }>;
        const targetTeam = targetSellerId ? team.filter(t => t.id === targetSellerId) : team;

        const computed = targetTeam.map((member): SellerRanking => {
          const pedro = pedroLeads.filter((lead: any) => lead.assigned_to_id === member.id).length;
          const marcos = marcosLeads.filter((lead: any) => lead.assigned_to === member.id || lead.custom_fields?.seller_member_id === member.id).length;
          return {
            id: member.id,
            name: member.name || 'Vendedor',
            pedro,
            marcos,
            total: pedro + marcos,
          };
        }).sort((a, b) => b.total - a.total).slice(0, targetSellerId ? 1 : 5);

        setRanking(computed);
      } catch (err) {
        console.error('[CommercialDashboard] failed to load ranking', err);
        if (!cancelled) setRanking([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [effectiveUserId, isSeller, seller?.id, sellerLoading, rankDateRange.start, rankDateRange.end, rankSellerId]);

  return { ranking, allSellers, loading, isSeller };
}

export default function CommercialDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Filtros persistidos em URL params (survive navegação entre abas) ───
  // GLOBAL:  ?period=today|week|month|custom + ?from=...&to=... (default 'today')
  // RANKING: ?rankPeriod + ?rankSeller + ?rankFrom + ?rankTo (default 'month' / 'all')
  const urlPeriod = (searchParams.get('period') as PeriodPreset | null) || 'today';
  const urlRankPeriod = (searchParams.get('rankPeriod') as PeriodPreset | null) || 'month';
  const urlRankSeller = searchParams.get('rankSeller') || 'all';

  // ── State GLOBAL ──────────────────────────────────────────────────────
  const [period, setPeriod] = useState<PeriodPreset>(urlPeriod);
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    return {
      start: searchParams.get('from') || toDateInput(weekAgo),
      end: searchParams.get('to') || toDateInput(today),
    };
  });
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomRange>(customRange);

  // ── State RANKING (independente do global) ────────────────────────────
  const [rankPeriod, setRankPeriod] = useState<PeriodPreset>(urlRankPeriod);
  const [rankSellerId, setRankSellerId] = useState<string>(urlRankSeller);
  const [rankCustomRange, setRankCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 29);
    return {
      start: searchParams.get('rankFrom') || toDateInput(monthAgo),
      end: searchParams.get('rankTo') || toDateInput(today),
    };
  });
  const [rankAppliedCustomRange, setRankAppliedCustomRange] = useState<CustomRange>(rankCustomRange);

  const dateRange = useMemo(() => resolveDateRange(period, appliedCustomRange), [period, appliedCustomRange]);
  const rankDateRange = useMemo(() => resolveDateRange(rankPeriod, rankAppliedCustomRange), [rankPeriod, rankAppliedCustomRange]);

  const { data, loading, refresh } = useCommercialDashboardData(user?.id, dateRange);
  const { ranking, allSellers, loading: rankingLoading, isSeller: rankIsSeller } = useRankingData(user?.id, rankDateRange, rankSellerId);

  // ── Handlers GLOBAL ───────────────────────────────────────────────────
  const handlePeriodChange = (next: PeriodPreset) => {
    setPeriod(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('period', next);
      if (next !== 'custom') { u.delete('from'); u.delete('to'); }
      return u;
    }, { replace: true });
  };

  const handleApplyCustom = () => {
    setAppliedCustomRange(customRange);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('period', 'custom');
      u.set('from', customRange.start);
      u.set('to', customRange.end);
      return u;
    }, { replace: true });
  };

  // ── Handlers RANKING (independentes) ──────────────────────────────────
  const handleRankPeriodChange = (next: PeriodPreset) => {
    setRankPeriod(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankPeriod', next);
      if (next !== 'custom') { u.delete('rankFrom'); u.delete('rankTo'); }
      return u;
    }, { replace: true });
  };

  const handleRankSellerChange = (next: string) => {
    setRankSellerId(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankSeller', next);
      return u;
    }, { replace: true });
  };

  const handleApplyRankCustom = () => {
    setRankAppliedCustomRange(rankCustomRange);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankPeriod', 'custom');
      u.set('rankFrom', rankCustomRange.start);
      u.set('rankTo', rankCustomRange.end);
      return u;
    }, { replace: true });
  };

  const totalLeads = data.pedroTotal + data.marcosTotal;
  const paidShare = totalLeads > 0 ? Math.round((data.pedroTotal / totalLeads) * 100) : 0;
  const manualShare = totalLeads > 0 ? 100 - paidShare : 0;
  // Casa pelo nome novo ("Venda concluída") e pelo legado ("Fechado").
  const isClosedLabel = (l: string) => { const n = (l || '').toLowerCase(); return n.includes('venda conclu') || n.includes('fechado'); };
  const closedPedro = data.pedroFunnel.find(item => isClosedLabel(item.label))?.value || 0;
  const closedMarcos = data.marcosFunnel.find(item => isClosedLabel(item.label))?.value || 0;
  const closedRate = totalLeads > 0 ? Math.round(((closedPedro + closedMarcos) / totalLeads) * 100) : 0;
  const maxWeekly = Math.max(1, ...data.weekly.map(item => Math.max(item.pedro, item.marcos)));

  const originCards = useMemo(() => [
    { label: 'IA / Pago', value: `${paidShare}%`, sub: `${data.pedroTotal} leads do Pedro`, color: 'bg-blue-500/15 text-blue-300' },
    { label: 'Manual', value: `${manualShare}%`, sub: `${data.marcosTotal} leads do Marcos`, color: 'bg-purple-500/15 text-purple-300' },
    { label: 'Fechados', value: `${closedRate}%`, sub: `${closedPedro + closedMarcos} oportunidades`, color: 'bg-emerald-500/15 text-emerald-300' },
  ], [closedMarcos, closedPedro, closedRate, data.marcosTotal, data.pedroTotal, manualShare, paidShare]);

  return (
    <MainLayout>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Dashboard Comercial
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground lg:text-4xl">Visao unificada de vendas</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Compare leads que entram pelo trafego pago e IA do Pedro com os leads manuais do Marcos, sem abrir os CRMs separadamente.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/70 px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/70 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {/* ── Filtro GLOBAL de Data ────────────────────────────────────────
            Aplica-se a TODOS os cards/métricas exceto o Ranking de Equipe
            (que tem filtros próprios no card abaixo). */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            <CalendarIcon className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
            Período
          </span>
          <div className="flex items-center gap-1 bg-card/60 rounded-lg p-1 border border-border/50">
            {PERIOD_OPTIONS.map(opt => {
              const active = period === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handlePeriodChange(opt.id)}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {period === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs">
              <input type="date" value={customRange.start} max={customRange.end}
                onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
                className="bg-card/60 border border-border/50 rounded px-2 py-1" />
              <span className="text-muted-foreground">até</span>
              <input type="date" value={customRange.end} min={customRange.start}
                onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
                className="bg-card/60 border border-border/50 rounded px-2 py-1" />
              <Button
                size="sm"
                onClick={handleApplyCustom}
                disabled={
                  !customRange.start || !customRange.end ||
                  (customRange.start === appliedCustomRange.start &&
                   customRange.end === appliedCustomRange.end)
                }
                className="h-7 px-3 text-xs"
              >
                Aplicar
              </Button>
            </div>
          )}
          <span className="text-xs text-muted-foreground ml-2">· Filtro aplicado: <strong className="text-foreground">{dateRange.label}</strong></span>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CompactKpi title="Pedro · IA/Pago" value={data.pedroToday} sub={`${data.pedroTotal} leads totais`} icon={Bot} accent="bg-blue-500/15 text-blue-300" />
          <CompactKpi title="Transferencias" value={data.pedroTransferred} sub={`${data.pedroWaiting} aguardando acao`} icon={UserCheck} accent="bg-cyan-500/15 text-cyan-300" />
          <CompactKpi title="Marcos · Manual" value={data.marcosToday} sub={`${data.marcosTotal} leads manuais`} icon={Users} accent="bg-purple-500/15 text-purple-300" />
          <CompactKpi title="Retomadas" value={data.marcosFollowups} sub={`${data.marcosCampaigns} campanhas ativas`} icon={Megaphone} accent="bg-amber-500/15 text-amber-300" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelPanel title="Funil Pedro" badge="IA responde e transfere" items={data.pedroFunnel} />
            <FunnelPanel title="Funil Marcos" badge="CRM manual" items={data.marcosFunnel} />
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
              <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
                <Target className="h-4 w-4 text-primary" />
                Origem e conversao
              </h3>
              <div className="grid gap-3">
                {originCards.map(card => (
                  <div key={card.label} className="flex items-center justify-between rounded-xl border border-border/40 bg-background/35 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{card.label}</p>
                      <p className="text-xs text-muted-foreground">{card.sub}</p>
                    </div>
                    <span className={`rounded-xl px-3 py-1.5 text-xl font-bold ${card.color}`}>{card.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
              <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
                <AlertCircle className="h-4 w-4 text-amber-300" />
                Alertas inteligentes
              </h3>
              <div className="space-y-3">
                {data.alerts.map(alert => {
                  const Icon = alert.tone === 'good' ? CheckCircle2 : alert.tone === 'warn' ? AlertCircle : Clock;
                  const tone = alert.tone === 'good'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : alert.tone === 'warn'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
                  return (
                    <div key={alert.title} className={`flex gap-3 rounded-xl border p-3 ${tone}`}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{alert.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr_0.8fr]">
          <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
            <h3 className="mb-5 flex items-center gap-2 text-base font-bold text-foreground">
              <BarChart3 className="h-4 w-4 text-primary" />
              Entrada de leads · ultimos 7 dias
            </h3>
            <div className="flex h-48 items-end gap-3">
              {data.weekly.map(day => (
                <div key={day.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-36 w-full items-end justify-center gap-1.5 rounded-xl border border-border/30 bg-background/30 px-2 py-2">
                    <div className="w-4 rounded-t bg-blue-500" style={{ height: `${Math.max(8, (day.pedro / maxWeekly) * 100)}%` }} />
                    <div className="w-4 rounded-t bg-purple-500" style={{ height: `${Math.max(8, (day.marcos / maxWeekly) * 100)}%` }} />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{day.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Pedro</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-purple-500" /> Marcos</span>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
            <div className="mb-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
                  <TrendingUp className="h-4 w-4 text-emerald-300" />
                  Ranking da equipe
                </h3>
              </div>

              {/* ── Filtros INDEPENDENTES do ranking (vendedor + período) ── */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Vendedor — oculto pra vendedor (spec: fixado no logado) */}
                {!rankIsSeller && (
                  <Select value={rankSellerId} onValueChange={handleRankSellerChange}>
                    <SelectTrigger className="w-[170px] bg-card/60 border-border/50 h-7 text-[11px]">
                      <UserCircle2 className="h-3 w-3 mr-1 text-muted-foreground" />
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os vendedores</SelectItem>
                      {allSellers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Período do ranking (segmentado compacto) */}
                <div className="flex items-center gap-0.5 bg-card/60 rounded-md p-0.5 border border-border/50">
                  {PERIOD_OPTIONS.map(opt => {
                    const active = rankPeriod === opt.id;
                    const compact = opt.id === 'custom' ? 'Custom' : opt.label;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleRankPeriodChange(opt.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                          active
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        {compact}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom date inputs (quando rankPeriod=custom) */}
              {rankPeriod === 'custom' && (
                <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
                  <input type="date" value={rankCustomRange.start} max={rankCustomRange.end}
                    onChange={e => setRankCustomRange(r => ({ ...r, start: e.target.value }))}
                    className="bg-card/60 border border-border/50 rounded px-1.5 py-0.5" />
                  <span className="text-muted-foreground">até</span>
                  <input type="date" value={rankCustomRange.end} min={rankCustomRange.start}
                    onChange={e => setRankCustomRange(r => ({ ...r, end: e.target.value }))}
                    className="bg-card/60 border border-border/50 rounded px-1.5 py-0.5" />
                  <Button
                    size="sm"
                    onClick={handleApplyRankCustom}
                    disabled={
                      !rankCustomRange.start || !rankCustomRange.end ||
                      (rankCustomRange.start === rankAppliedCustomRange.start &&
                       rankCustomRange.end === rankAppliedCustomRange.end)
                    }
                    className="h-6 px-2 text-[11px]"
                  >
                    Aplicar
                  </Button>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                {rankDateRange.label} · {rankSellerId === 'all' || rankIsSeller ? 'todos vendedores' : 'vendedor filtrado'}
              </p>
            </div>

            <div className="space-y-3">
              {rankingLoading ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  Carregando ranking…
                </div>
              ) : ranking.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  {rankSellerId === 'all'
                    ? 'Nenhum vendedor recebeu leads no período.'
                    : 'Esse vendedor não recebeu leads no período.'}
                </div>
              ) : (
                ranking.map((seller, index) => (
                  <div key={seller.id} className="rounded-xl border border-border/40 bg-background/35 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-foreground">#{index + 1} {seller.name}</p>
                      <span className="text-lg font-bold text-primary">{seller.total}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {seller.pedro} Pedro · {seller.marcos} Marcos · <strong className="text-foreground">{seller.total} leads recebidos</strong>
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
              <Sparkles className="h-4 w-4 text-yellow-300" />
              Acoes sugeridas
            </h3>
            <div className="space-y-3">
              <button onClick={() => navigate('/pedro?tab=crm')} className="w-full rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left transition-colors hover:bg-blue-500/15">
                <p className="text-sm font-semibold text-foreground">Revisar leads do Pedro</p>
                <p className="text-xs text-muted-foreground">Acompanhar IA, transferencias e vendedores.</p>
              </button>
              <button onClick={() => navigate('/marcos?tab=performance')} className="w-full rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-left transition-colors hover:bg-purple-500/15">
                <p className="text-sm font-semibold text-foreground">Ver performance do Marcos</p>
                <p className="text-xs text-muted-foreground">Campanhas, listas, follow-ups e CRM manual.</p>
              </button>
              <button onClick={() => navigate('/whatsapp/broadcast')} className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/15">
                <p className="text-sm font-semibold text-foreground">Criar campanha</p>
                <p className="text-xs text-muted-foreground">Retomar leads parados com seguranca.</p>
              </button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
