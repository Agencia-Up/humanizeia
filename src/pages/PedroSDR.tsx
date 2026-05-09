import { useState, useEffect, lazy, Suspense } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Bot, MonitorPlay, BarChart3, Loader2, Users, MessageSquare,
  ArrowRightLeft, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Zap, PhoneCall,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';

const WhatsAppAIAgent = lazy(() => import('./WhatsAppAIAgent'));
const CrmAoVivo       = lazy(() => import('./CrmAoVivo'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// ─── Tipos de dados ──────────────────────────────────────────────────────────

interface PerfData {
  totalLeads: number;
  leadsHoje: number;
  transferencias: number;
  taxaConversao: number;
  totalRespostas: number;
  agentesAtivos: number;
  leadsPorStatus: { name: string; value: number; color: string }[];
  atividadeSemanal: { dia: string; leads: number; transferencias: number }[];
  agentes: { nome: string; respostas: number; leads: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  novo:       '#3B82F6',
  qualificado:'#10B981',
  aguardando: '#F59E0B',
  transferido:'#8B5CF6',
  encerrado:  '#EF4444',
  perdido:    '#6B7280',
};

// ─── Hook de dados ───────────────────────────────────────────────────────────

function usePerfData(userId: string | undefined) {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    async function load() {
      setLoading(true);
      try {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const seteAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [leadsRes, transRes, agentRes] = await Promise.all([
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, status, created_at')
            .eq('user_id', userId),
          (supabase as any)
            .from('ai_lead_transfers')
            .select('id, created_at, lead_id')
            .eq('user_id', userId),
          (supabase as any)
            .from('wa_ai_agents')
            .select('id, name, total_replies, is_active')
            .eq('user_id', userId),
        ]);

        const leads: any[]  = leadsRes.data  || [];
        const trans: any[]  = transRes.data  || [];
        const agents: any[] = agentRes.data  || [];

        // ── métricas brutas ─────────────────────────────────────────────────
        const totalLeads     = leads.length;
        const leadsHoje      = leads.filter(l => new Date(l.created_at) >= hoje).length;
        const transferencias = trans.length;
        const taxaConversao  = totalLeads > 0 ? Math.round((transferencias / totalLeads) * 100) : 0;
        const totalRespostas = agents.reduce((s: number, a: any) => s + (a.total_replies || 0), 0);
        const agentesAtivos  = agents.filter((a: any) => a.is_active).length;

        // ── leads por status ─────────────────────────────────────────────────
        const statusCount: Record<string, number> = {};
        leads.forEach((l: any) => {
          const s = l.status || 'novo';
          statusCount[s] = (statusCount[s] || 0) + 1;
        });
        const leadsPorStatus = Object.entries(statusCount).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
          color: STATUS_COLORS[name] || '#6B7280',
        }));

        // ── atividade últimos 7 dias ──────────────────────────────────────────
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const atividadeSemanal = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          d.setHours(0, 0, 0, 0);
          const fim = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          return {
            dia: dias[d.getDay()],
            leads: leads.filter((l: any) => {
              const t = new Date(l.created_at);
              return t >= d && t < fim;
            }).length,
            transferencias: trans.filter((t: any) => {
              const tt = new Date(t.created_at);
              return tt >= d && tt < fim;
            }).length,
          };
        });

        // ── ranking de agentes ────────────────────────────────────────────────
        const agentesRank = agents.map((a: any) => ({
          nome: a.name,
          respostas: a.total_replies || 0,
          leads: leads.filter((l: any) => l.agent_id === a.id).length,
        })).sort((a, b) => b.respostas - a.respostas).slice(0, 5);

        setData({
          totalLeads, leadsHoje, transferencias, taxaConversao,
          totalRespostas, agentesAtivos, leadsPorStatus,
          atividadeSemanal, agentes: agentesRank,
        });
      } catch {
        // silently ignore — tables may not exist in all envs
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [userId]);

  return { data, loading };
}

// ─── Componente de métrica ────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; trend?: number;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`mt-3 flex items-center gap-1 text-[11px] font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            <TrendingUp className={`h-3 w-3 ${trend < 0 ? 'rotate-180' : ''}`} />
            {trend >= 0 ? '+' : ''}{trend}% vs. semana anterior
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tab Performance ──────────────────────────────────────────────────────────

function PerformanceTab({ userId }: { userId: string | undefined }) {
  const { data, loading } = usePerfData(userId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8 opacity-40" />
        <p className="text-sm">Não foi possível carregar os dados de performance.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* ── KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Leads Totais"
          value={data.totalLeads}
          sub="todos os períodos"
          icon={Users}
          color="bg-blue-500/15 text-blue-400"
        />
        <MetricCard
          label="Leads Hoje"
          value={data.leadsHoje}
          sub="nas últimas 24h"
          icon={Zap}
          color="bg-cyan-500/15 text-cyan-400"
        />
        <MetricCard
          label="Transferências"
          value={data.transferencias}
          sub="para humano"
          icon={ArrowRightLeft}
          color="bg-purple-500/15 text-purple-400"
        />
        <MetricCard
          label="Taxa de Conversão"
          value={`${data.taxaConversao}%`}
          sub="lead → transferência"
          icon={CheckCircle2}
          color="bg-emerald-500/15 text-emerald-400"
        />
        <MetricCard
          label="Respostas IA"
          value={data.totalRespostas.toLocaleString()}
          sub="total de mensagens"
          icon={MessageSquare}
          color="bg-orange-500/15 text-orange-400"
        />
        <MetricCard
          label="Agentes Ativos"
          value={data.agentesAtivos}
          sub="em operação agora"
          icon={Bot}
          color="bg-rose-500/15 text-rose-400"
        />
      </div>

      {/* ── Gráficos ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Atividade Semanal */}
        <Card className="lg:col-span-2 bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Atividade — Últimos 7 Dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.atividadeSemanal.every(d => d.leads === 0 && d.transferencias === 0) ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum dado no período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.atividadeSemanal} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1E2533', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#E2E8F0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                  <Bar dataKey="leads"         name="Leads"          fill="#3B82F6" radius={[3,3,0,0]} />
                  <Bar dataKey="transferencias" name="Transferências" fill="#8B5CF6" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Leads por Status */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-purple-400" />
              Leads por Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.leadsPorStatus.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum lead cadastrado
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.leadsPorStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {data.leadsPorStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1E2533', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, n: string) => [v, n]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ranking de Agentes ───────────────────────────────────── */}
      {data.agentes.length > 0 && (
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-400" />
              Ranking de Agentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.agentes.map((a, i) => {
                const maxR = Math.max(...data.agentes.map(x => x.respostas), 1);
                const pct  = Math.round((a.respostas / maxR) * 100);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                        <span className="font-medium text-foreground">{a.nome}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{a.respostas.toLocaleString()} respostas</span>
                        {a.leads > 0 && <span className="text-blue-400">{a.leads} leads</span>}
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'performance', label: 'Performance',  icon: BarChart3,    emoji: '📊' },
  { id: 'agente',      label: 'Agente IA',    icon: Bot,          emoji: '🤖' },
  { id: 'ao-vivo',     label: 'CRM ao Vivo',  icon: MonitorPlay,  emoji: '📺' },
];

export default function PedroSDR() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('performance');

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-1 pt-1 pb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center">
            <Bot className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Pedro</h1>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 inline-block" />
                Agente Online
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">SDR — Qualificação de Leads & Automação Comercial</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-border/40">
            <TabsList className="h-auto bg-transparent p-0 gap-1">
              {TABS.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-500 data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-all"
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <TabsContent value="performance" className="mt-0">
              <PerformanceTab userId={user?.id} />
            </TabsContent>

            <Suspense fallback={<TabLoader />}>
              <TabsContent value="agente"   className="mt-0 h-full">
                <WhatsAppAIAgent embedded />
              </TabsContent>
              <TabsContent value="ao-vivo"  className="mt-0 h-full">
                <CrmAoVivo embedded />
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
