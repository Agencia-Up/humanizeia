import { useEffect, useMemo, useState, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import {
  AlertCircle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Megaphone,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';

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
  sellers: SellerRanking[];
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
  sellers: [],
  alerts: [],
};

const pedroStatusLabels: Record<string, { label: string; accent: string; description: string }> = {
  novo: { label: 'Novo', accent: 'bg-sky-400', description: 'Entraram pelo Pedro' },
  inativo: { label: 'Lead Inativo', accent: 'bg-slate-400', description: 'Sem resposta recente' },
  carro_nao_disponivel: { label: 'Carro nao disponivel', accent: 'bg-rose-400', description: 'Opcao fora de estoque' },
  em_atendimento: { label: 'Agendamento', accent: 'bg-cyan-400', description: 'Visita ou contato marcado' },
  negociacao: { label: 'Negociacao', accent: 'bg-purple-400', description: 'Vendedor em tratativa' },
  fechado: { label: 'Fechado', accent: 'bg-emerald-400', description: 'Venda concluida' },
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

function CompactKpi({
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

function FunnelPanel({
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

function useCommercialDashboardData(userId: string | undefined) {
  const { isSeller, seller, masterUserId, loading: sellerLoading } = useSellerProfile(userId);
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
        const sellerId = isSeller ? seller?.id : null;

        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, status, status_crm, assigned_to_id, created_at')
          .eq('user_id', effectiveUserId)
          .order('created_at', { ascending: false })
          .limit(5000);
        if (sellerId) pedroQuery = pedroQuery.eq('assigned_to_id', sellerId);

        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, stage_id, assigned_to, source, created_at, custom_fields')
          .eq('user_id', effectiveUserId)
          .not('source', 'like', 'Pedro SDR%')
          .order('created_at', { ascending: false })
          .limit(5000);
        if (sellerId) marcosQuery = marcosQuery.eq('assigned_to', sellerId);

        let campaignsQuery = (supabase as any)
          .from('wa_campaigns')
          .select('id, status, sent_count, failed_count, total_contacts, seller_member_id, created_at')
          .eq('user_id', effectiveUserId);
        if (sellerId) campaignsQuery = campaignsQuery.eq('seller_member_id', sellerId);

        let followupsQuery = (supabase as any)
          .from('marcos_followup_schedules')
          .select('id, status, seller_member_id, created_at')
          .eq('user_id', effectiveUserId);
        if (sellerId) followupsQuery = followupsQuery.eq('seller_member_id', sellerId);

        const [pedroRes, marcosRes, stagesRes, teamRes, campaignsRes, followupsRes] = await Promise.all([
          pedroQuery,
          marcosQuery,
          (supabase as any)
            .from('crm_pipeline_stages')
            .select('id, name, color, position')
            .eq('user_id', effectiveUserId)
            .order('position', { ascending: true }),
          (supabase as any)
            .from('ai_team_members')
            .select('id, name, whatsapp_number, is_active')
            .eq('user_id', effectiveUserId)
            .order('is_active', { ascending: false })
            .order('name', { ascending: true }),
          campaignsQuery,
          followupsQuery,
        ]);

        if (cancelled) return;

        const pedroLeads = pedroRes.data || [];
        const marcosLeads = marcosRes.data || [];
        const stages = stagesRes.data || [];
        const team = teamRes.data || [];
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

        const sellers = team.map((member: any) => {
          const pedro = pedroLeads.filter((lead: any) => lead.assigned_to_id === member.id).length;
          const marcos = marcosLeads.filter((lead: any) => lead.assigned_to === member.id || lead.custom_fields?.seller_member_id === member.id).length;
          return {
            id: member.id,
            name: member.name || 'Vendedor',
            pedro,
            marcos,
            total: pedro + marcos,
          };
        }).sort((a: SellerRanking, b: SellerRanking) => b.total - a.total).slice(0, 5);

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
          sellers,
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
  }, [effectiveUserId, isSeller, seller?.id, sellerLoading, refreshKey]);

  return { data, loading, refresh: () => setRefreshKey(key => key + 1) };
}

export default function CommercialDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, refresh } = useCommercialDashboardData(user?.id);

  const totalLeads = data.pedroTotal + data.marcosTotal;
  const paidShare = totalLeads > 0 ? Math.round((data.pedroTotal / totalLeads) * 100) : 0;
  const manualShare = totalLeads > 0 ? 100 - paidShare : 0;
  const closedPedro = data.pedroFunnel.find(item => item.label === 'Fechado')?.value || 0;
  const closedMarcos = data.marcosFunnel.find(item => item.label.toLowerCase().includes('fechado'))?.value || 0;
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
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
              <TrendingUp className="h-4 w-4 text-emerald-300" />
              Ranking da equipe
            </h3>
            <div className="space-y-3">
              {data.sellers.map((seller, index) => (
                <div key={seller.id} className="rounded-xl border border-border/40 bg-background/35 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-foreground">#{index + 1} {seller.name}</p>
                    <span className="text-lg font-bold text-primary">{seller.total}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{seller.pedro} Pedro · {seller.marcos} Marcos</p>
                </div>
              ))}
              {data.sellers.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  Sem vendedores carregados.
                </div>
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
