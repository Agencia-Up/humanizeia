import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import {
  Activity, AlertCircle, BarChart3, CalendarClock, CheckCircle2, Clock,
  Database, Layers3, Loader2, Megaphone, RefreshCw, Send, ShieldCheck,
  Smartphone, Target, TrendingUp, UserCheck, Users,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

type StageMetric = {
  id: string;
  name: string;
  count: number;
  color: string;
};

type SellerMetric = {
  id: string;
  name: string;
  whatsapp: string;
  total: number;
  closed: number;
  pending: number;
};

type MarcosPerfData = {
  totalLeads: number;
  leadsHoje: number;
  leadsSemana: number;
  leadsMes: number;
  semVendedor: number;
  vendedoresAtivos: number;
  instanciasConectadas: number;
  totalInstancias: number;
  campanhasAtivas: number;
  mensagensEnviadas: number;
  falhasCampanha: number;
  contatosListas: number;
  followupsPendentes: number;
  followupsEnviados: number;
  taxaFechamento: number;
  coberturaVendedor: number;
  taxaFalhaCampanhas: number;
  stages: StageMetric[];
  atividadeSemanal: { dia: string; leads: number; mensagens: number; followups: number }[];
  sellers: SellerMetric[];
  origem: { name: string; value: number; color: string }[];
  insights: { tone: 'good' | 'warn' | 'info'; title: string; body: string }[];
};

const STAGE_COLORS = ['#38bdf8', '#f59e0b', '#ef4444', '#22c55e', '#8b5cf6', '#06b6d4', '#f97316', '#64748b'];
const SOURCE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

const normalizeText = (value: string | null | undefined) =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatPct = (value: number) => `${Math.round(value)}%`;

function KpiCard({
  label, value, sub, icon: Icon, color, footer,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: ElementType;
  color: string;
  footer?: string;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
          </div>
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {footer && <p className="mt-4 text-[11px] text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

function InsightCard({ insight }: { insight: MarcosPerfData['insights'][number] }) {
  const style = {
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  }[insight.tone];

  return (
    <div className={`rounded-xl border p-4 ${style}`}>
      <p className="text-sm font-semibold text-foreground">{insight.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
    </div>
  );
}

function useMarcosPerformanceData(userId: string | undefined) {
  const { isSeller, seller, masterUserId, loading: sellerLoading } = useSellerProfile(userId);
  const [data, setData] = useState<MarcosPerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const effectiveUserId = isSeller ? masterUserId : userId;

  useEffect(() => {
    if (sellerLoading || !effectiveUserId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
        const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

        let leadsQuery = (supabase as any)
          .from('crm_leads')
          .select('id, name, phone, source, stage_id, assigned_to, custom_fields, created_at')
          .eq('user_id', effectiveUserId)
          .not('source', 'like', 'Pedro SDR%')
          .order('created_at', { ascending: false })
          .limit(5000);
        if (isSeller && seller?.id) leadsQuery = leadsQuery.eq('assigned_to', seller.id);

        let campaignsQuery = (supabase as any)
          .from('wa_campaigns')
          .select('id, status, sent_count, failed_count, total_contacts, created_at')
          .eq('user_id', effectiveUserId);
        if (isSeller && seller?.id) campaignsQuery = campaignsQuery.eq('seller_member_id', seller.id);

        let listsQuery = (supabase as any)
          .from('wa_contact_lists')
          .select('id, contact_count, source, created_at')
          .eq('user_id', effectiveUserId);
        if (isSeller && seller?.id) listsQuery = listsQuery.eq('seller_member_id', seller.id);

        let instancesQuery = (supabase as any)
          .from('wa_instances')
          .select('id, status, is_active, seller_member_id')
          .eq('user_id', effectiveUserId);
        if (isSeller && seller?.id) instancesQuery = instancesQuery.eq('seller_member_id', seller.id);

        let followupsQuery = (supabase as any)
          .from('marcos_followup_schedules')
          .select('id, status, scheduled_at, created_at, seller_member_id')
          .eq('user_id', effectiveUserId);
        if (isSeller && seller?.id) followupsQuery = followupsQuery.eq('seller_member_id', seller.id);

        const [stagesRes, leadsRes, teamRes, instancesRes, campaignsRes, listsRes, followupsRes] = await Promise.all([
          (supabase as any)
            .from('crm_pipeline_stages')
            .select('id, name, color, position')
            .eq('user_id', effectiveUserId)
            .order('position', { ascending: true }),
          leadsQuery,
          (supabase as any)
            .from('ai_team_members')
            .select('*')
            .eq('user_id', effectiveUserId)
            .order('is_active', { ascending: false })
            .order('name', { ascending: true }),
          instancesQuery,
          campaignsQuery,
          listsQuery,
          followupsQuery,
        ]);

        const stages = (stagesRes.data || []) as any[];
        const leads = (leadsRes.data || []) as any[];
        const team = (teamRes.data || []) as any[];
        const instances = (instancesRes.data || []) as any[];
        const campaigns = (campaignsRes.data || []) as any[];
        const lists = (listsRes.data || []) as any[];
        const followups = (followupsRes.data || []) as any[];

        const stageById = new Map(stages.map((s: any, index: number) => [
          s.id,
          {
            name: s.name || 'Sem etapa',
            color: s.color || STAGE_COLORS[index % STAGE_COLORS.length],
          },
        ]));
        const fallbackStageId = stages[0]?.id || 'novo';

        const stageMetrics = (stages.length > 0 ? stages : [{ id: 'novo', name: 'Novo Lead' }]).map((stage: any, index: number) => ({
          id: stage.id,
          name: stage.name || 'Sem etapa',
          count: leads.filter((lead: any) => (lead.stage_id || fallbackStageId) === stage.id).length,
          color: stage.color || STAGE_COLORS[index % STAGE_COLORS.length],
        }));

        const closedStageIds = new Set(
          stages
            .filter((s: any) => {
              const n = normalizeText(s.name);
              return n.includes('fechado') || n.includes('vendido') || n.includes('venda');
            })
            .map((s: any) => s.id)
        );

        const totalLeads = leads.length;
        const leadsHoje = leads.filter((l: any) => new Date(l.created_at) >= todayStart).length;
        const leadsSemana = leads.filter((l: any) => new Date(l.created_at) >= weekStart).length;
        const leadsMes = leads.filter((l: any) => new Date(l.created_at) >= monthStart).length;
        const semVendedor = leads.filter((l: any) => !l.assigned_to && !l.custom_fields?.seller_member_id).length;
        const leadsFechados = leads.filter((l: any) => closedStageIds.has(l.stage_id)).length;
        const taxaFechamento = totalLeads > 0 ? (leadsFechados / totalLeads) * 100 : 0;
        const coberturaVendedor = totalLeads > 0 ? ((totalLeads - semVendedor) / totalLeads) * 100 : 100;
        // "Vendedores ativos" = ativos no SISTEMA (visíveis em CRM/módulos), não distribuição do agente.
        // active_in_system !== false → resiliente a pré-migration (coluna ausente conta como visível).
        const vendedoresAtivos = team.filter((t: any) => t.active_in_system !== false).length;
        const instanciasConectadas = instances.filter((i: any) => i.is_active && ['connected', 'open'].includes(String(i.status || '').toLowerCase())).length;
        const campanhasAtivas = campaigns.filter((c: any) => ['running', 'scheduled'].includes(c.status)).length;
        const mensagensEnviadas = campaigns.reduce((sum: number, c: any) => sum + (Number(c.sent_count) || 0), 0);
        const falhasCampanha = campaigns.reduce((sum: number, c: any) => sum + (Number(c.failed_count) || 0), 0);
        const taxaFalhaCampanhas = mensagensEnviadas + falhasCampanha > 0
          ? (falhasCampanha / (mensagensEnviadas + falhasCampanha)) * 100
          : 0;
        const contatosListas = lists.reduce((sum: number, l: any) => sum + (Number(l.contact_count) || 0), 0);
        const followupsPendentes = followups.filter((f: any) => ['pending', 'scheduled'].includes(String(f.status || '').toLowerCase())).length;
        const followupsEnviados = followups.filter((f: any) => ['sent', 'completed'].includes(String(f.status || '').toLowerCase())).length;

        const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
        const atividadeSemanal = Array.from({ length: 7 }).map((_, i) => {
          const day = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          day.setHours(0, 0, 0, 0);
          const end = new Date(day.getTime() + 24 * 60 * 60 * 1000);
          return {
            dia: dias[day.getDay()],
            leads: leads.filter((l: any) => {
              const d = new Date(l.created_at);
              return d >= day && d < end;
            }).length,
            mensagens: campaigns
              .filter((c: any) => {
                const d = new Date(c.created_at);
                return d >= day && d < end;
              })
              .reduce((sum: number, c: any) => sum + (Number(c.sent_count) || 0), 0),
            followups: followups.filter((f: any) => {
              const d = new Date(f.scheduled_at || f.created_at);
              return d >= day && d < end;
            }).length,
          };
        });

        const sourceCounts = new Map<string, number>();
        for (const lead of leads) {
          const rawSource = lead.custom_fields?.input_mode || lead.source || 'manual';
          const label = String(rawSource).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          sourceCounts.set(label, (sourceCounts.get(label) || 0) + 1);
        }
        const origem = Array.from(sourceCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([name, value], index) => ({ name, value, color: SOURCE_COLORS[index % SOURCE_COLORS.length] }));

        const sellers = team.map((member: any) => {
          const memberLeads = leads.filter((lead: any) => {
            const assigned = lead.assigned_to || lead.custom_fields?.seller_member_id;
            return assigned === member.id;
          });
          return {
            id: member.id,
            name: member.name || 'Vendedor',
            whatsapp: member.whatsapp_number || '',
            total: memberLeads.length,
            closed: memberLeads.filter((lead: any) => closedStageIds.has(lead.stage_id)).length,
            pending: memberLeads.filter((lead: any) => !closedStageIds.has(lead.stage_id)).length,
          };
        }).sort((a, b) => b.total - a.total);

        const insights: MarcosPerfData['insights'] = [
          semVendedor > 0
            ? {
                tone: 'warn',
                title: `${semVendedor} lead(s) sem vendedor`,
                body: 'Existem leads na carteira sem responsavel. Vale distribuir antes de rodar follow-ups ou novas campanhas.',
              }
            : {
                tone: 'good',
                title: 'Carteira distribuida',
                body: 'Todos os leads visiveis estao com vendedor definido ou a carteira esta vazia.',
              },
          taxaFalhaCampanhas > 5
            ? {
                tone: 'warn',
                title: `Falhas em ${formatPct(taxaFalhaCampanhas)} dos envios`,
                body: 'Acompanhe instancias, numeros invalidos e midias antes de aumentar o volume de disparos.',
              }
            : {
                tone: 'good',
                title: 'Disparos saudaveis',
                body: 'A taxa de falha das campanhas esta sob controle no historico atual.',
              },
          followupsPendentes > 0
            ? {
                tone: 'info',
                title: `${followupsPendentes} follow-up(s) pendente(s)`,
                body: 'Ha oportunidades programadas para retomar conversa automaticamente pelo Marcos.',
              }
            : {
                tone: 'info',
                title: 'Sem follow-ups pendentes',
                body: 'Nenhuma retomada automatica aguardando execucao neste momento.',
              },
        ];

        if (!cancelled) {
          setData({
            totalLeads,
            leadsHoje,
            leadsSemana,
            leadsMes,
            semVendedor,
            vendedoresAtivos,
            instanciasConectadas,
            totalInstancias: instances.length,
            campanhasAtivas,
            mensagensEnviadas,
            falhasCampanha,
            contatosListas,
            followupsPendentes,
            followupsEnviados,
            taxaFechamento,
            coberturaVendedor,
            taxaFalhaCampanhas,
            stages: stageMetrics,
            atividadeSemanal,
            sellers,
            origem,
            insights,
          });
        }
      } catch (err) {
        console.error('[MarcosPerformance] failed to load data', err);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [effectiveUserId, isSeller, seller?.id, sellerLoading, refreshKey]);

  return { data, loading: loading || sellerLoading, refresh: () => setRefreshKey(v => v + 1) };
}

export default function MarcosPerformance({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { data, loading, refresh } = useMarcosPerformanceData(user?.id);

  const Wrapper = embedded
    ? ({ children }: { children: ReactNode }) => <>{children}</>
    : MainLayout;

  const topStage = useMemo(() => {
    if (!data || data.stages.length === 0) return null;
    return [...data.stages].sort((a, b) => b.count - a.count)[0];
  }, [data]);

  if (loading) {
    return (
      <Wrapper>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </Wrapper>
    );
  }

  if (!data) {
    return (
      <Wrapper>
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <AlertCircle className="h-8 w-8 opacity-40" />
          <p className="text-sm">Nao foi possivel carregar a performance do Marcos.</p>
        </div>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="h-full overflow-auto px-6 py-5 space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Performance do Marcos</h2>
              <Badge className="bg-purple-500/15 text-purple-300 border-purple-500/30">CRM manual</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Leitura operacional da carteira, disparos, follow-ups e vendedores.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2 self-start lg:self-auto" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard label="Leads totais" value={data.totalLeads} sub="carteira do Marcos" icon={Users} color="bg-blue-500/15 text-blue-400" />
          <KpiCard label="Hoje" value={data.leadsHoje} sub={`${data.leadsSemana} na semana`} icon={Clock} color="bg-cyan-500/15 text-cyan-400" />
          <KpiCard label="Cobertura" value={formatPct(data.coberturaVendedor)} sub={`${data.semVendedor} sem vendedor`} icon={UserCheck} color="bg-emerald-500/15 text-emerald-400" />
          <KpiCard label="Fechamento" value={formatPct(data.taxaFechamento)} sub="leads em etapa final" icon={Target} color="bg-violet-500/15 text-violet-400" />
          <KpiCard label="Campanhas" value={data.campanhasAtivas} sub={`${data.mensagensEnviadas.toLocaleString('pt-BR')} envios`} icon={Megaphone} color="bg-amber-500/15 text-amber-400" />
          <KpiCard label="Instancias" value={`${data.instanciasConectadas}/${data.totalInstancias}`} sub="conectadas" icon={Smartphone} color="bg-rose-500/15 text-rose-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-cyan-400" />
                Atividade dos ultimos 7 dias
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.atividadeSemanal} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#151a2b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#E2E8F0' }}
                  />
                  <Bar dataKey="leads" name="Leads" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="mensagens" name="Mensagens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="followups" name="Follow-ups" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-purple-400" />
                Distribuicao por etapa
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.stages.every(s => s.count === 0) ? (
                <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                  Nenhum lead na carteira
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={data.stages.filter(s => s.count > 0)} dataKey="count" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3}>
                      {data.stages.filter(s => s.count > 0).map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#151a2b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Diagnostico rapido
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.insights.map((insight, index) => <InsightCard key={index} insight={insight} />)}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Saude da operacao
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Leads com responsavel</span>
                  <span className="font-semibold text-foreground">{formatPct(data.coberturaVendedor)}</span>
                </div>
                <Progress value={Math.min(data.coberturaVendedor, 100)} className="h-2" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Falhas em campanhas</span>
                  <span className="font-semibold text-foreground">{formatPct(data.taxaFalhaCampanhas)}</span>
                </div>
                <Progress value={Math.min(data.taxaFalhaCampanhas, 100)} className="h-2" />
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-[11px] text-muted-foreground">Follow-ups pendentes</p>
                  <p className="mt-1 text-xl font-bold text-cyan-300">{data.followupsPendentes}</p>
                </div>
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-[11px] text-muted-foreground">Contatos em listas</p>
                  <p className="mt-1 text-xl font-bold text-amber-300">{data.contatosListas.toLocaleString('pt-BR')}</p>
                </div>
              </div>
              {topStage && (
                <div className="rounded-lg border border-border/60 p-3">
                  <p className="text-[11px] text-muted-foreground">Etapa mais carregada</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{topStage.name} - {topStage.count} lead(s)</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Database className="h-4 w-4 text-violet-400" />
                Origem dos leads
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.origem.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Sem origem registrada</div>
              ) : data.origem.map((item) => {
                const max = Math.max(...data.origem.map(o => o.value), 1);
                return (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{item.name}</span>
                      <span className="text-muted-foreground">{item.value}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                Vendedores e carteira
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.sellers.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Nenhum vendedor cadastrado</div>
              ) : (
                <div className="space-y-3">
                  {data.sellers.slice(0, 8).map((sellerMetric, index) => {
                    const max = Math.max(...data.sellers.map(s => s.total), 1);
                    return (
                      <div key={sellerMetric.id} className="space-y-2">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="w-6 h-6 rounded-md bg-muted flex items-center justify-center font-bold text-muted-foreground">{index + 1}</span>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{sellerMetric.name}</p>
                              <p className="text-[10px] text-muted-foreground">{sellerMetric.whatsapp}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
                            <span>{sellerMetric.total} leads</span>
                            <span className="text-emerald-300">{sellerMetric.closed} fechados</span>
                          </div>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" style={{ width: `${(sellerMetric.total / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-amber-400" />
                Etapas do funil
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.stages.map((stage) => {
                const max = Math.max(...data.stages.map(s => s.count), 1);
                return (
                  <div key={stage.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
                        <span className="font-medium text-foreground truncate">{stage.name}</span>
                      </div>
                      <span className="text-muted-foreground">{stage.count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(stage.count / max) * 100}%`, backgroundColor: stage.color }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Leads no mes" value={data.leadsMes} sub="entrada mensal" icon={CalendarClock} color="bg-blue-500/15 text-blue-400" />
          <KpiCard label="Follow-ups enviados" value={data.followupsEnviados} sub="retomadas executadas" icon={Send} color="bg-cyan-500/15 text-cyan-400" />
          <KpiCard label="Falhas" value={data.falhasCampanha} sub="campanhas WhatsApp" icon={AlertCircle} color="bg-red-500/15 text-red-400" />
          <KpiCard label="Vendedores ativos" value={data.vendedoresAtivos} sub="equipe disponivel" icon={CheckCircle2} color="bg-emerald-500/15 text-emerald-400" />
        </div>
      </div>
    </Wrapper>
  );
}
