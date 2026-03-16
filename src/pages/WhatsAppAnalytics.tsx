import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart3, Send, MessageCircle, CheckCheck, XCircle,
  Sparkles, Heart, TrendingUp, Loader2, Activity,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const CATEGORY_COLORS: Record<string, string> = {
  interested: '#22c55e',
  question: '#3b82f6',
  'opt-out': '#ef4444',
  positive: '#10b981',
  negative: '#f97316',
  neutral: '#6b7280',
  spam: '#eab308',
};

const CATEGORY_LABELS: Record<string, string> = {
  interested: 'Interessado',
  question: 'Pergunta',
  'opt-out': 'Opt-out',
  positive: 'Positivo',
  negative: 'Negativo',
  neutral: 'Neutro',
  spam: 'Spam',
};

interface CampaignStats {
  id: string;
  name: string;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  status: string;
}

interface InstanceHealth {
  id: string;
  friendly_name: string | null;
  instance_name: string;
  health_score: number;
  messages_sent_today: number;
  messages_sent_period?: number;
  status: string;
  is_active: boolean;
}

export default function WhatsAppAnalytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');
  const [kpis, setKpis] = useState({ sent: 0, delivered: 0, responses: 0, qualified: 0, optOut: 0 });
  const [categoryData, setCategoryData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [volumeData, setVolumeData] = useState<{ date: string; enviadas: number; recebidas: number }[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignStats[]>([]);
  const [instances, setInstances] = useState<InstanceHealth[]>([]);

  const getPeriodDate = useCallback(() => {
    const now = new Date();
    const days = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
    now.setDate(now.getDate() - days);
    return now.toISOString();
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const since = getPeriodDate();

    // Fetch queue stats for KPIs
    const [queueRes, inboxRes, campaignsRes, instancesRes] = await Promise.all([
      supabase
        .from('wa_queue')
        .select('status, sent_at, instance_id')
        .eq('user_id', user.id)
        .in('status', ['sent', 'delivered', 'read'])
        .gte('sent_at', since),
      supabase
        .from('wa_inbox')
        .select('direction, ai_category, created_at, phone')
        .eq('user_id', user.id)
        .gte('created_at', since),
      supabase
        .from('wa_campaigns')
        .select('id, name, total_contacts, sent_count, delivered_count, failed_count, status')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('wa_instances')
        .select('id, friendly_name, instance_name, health_score, messages_sent_today, status, is_active')
        .eq('user_id', user.id),
    ]);

    // KPIs
    const queueItems = queueRes.data || [];
    const inboxItems = inboxRes.data || [];

    const sent = queueItems.length;
    const delivered = queueItems.filter(q => ['delivered', 'read'].includes(q.status)).length;
    const incoming = inboxItems.filter(m => m.direction === 'incoming');
    const responses = incoming.length;
    const qualified = incoming.filter(m => m.ai_category === 'interested' || m.ai_category === 'question').length;
    const optOut = incoming.filter(m => m.ai_category === 'opt-out').length;

    setKpis({ sent, delivered, responses, qualified, optOut });

    // Category pie chart
    const catCounts: Record<string, number> = {};
    for (const m of incoming) {
      const cat = m.ai_category || 'neutral';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
    setCategoryData(
      Object.entries(catCounts).map(([key, value]) => ({
        name: CATEGORY_LABELS[key] || key,
        value,
        color: CATEGORY_COLORS[key] || '#6b7280',
      }))
    );

    // Volume over time (line chart)
    const dayMap = new Map<string, { enviadas: number; recebidas: number }>();
    for (const q of queueItems) {
      if (!q.sent_at) continue;
      const day = q.sent_at.substring(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { enviadas: 0, recebidas: 0 });
      dayMap.get(day)!.enviadas++;
    }
    for (const m of incoming) {
      const day = m.created_at.substring(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { enviadas: 0, recebidas: 0 });
      dayMap.get(day)!.recebidas++;
    }
    const sortedDays = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date: date.substring(5), ...data }));
    setVolumeData(sortedDays);

    // Campaigns
    setCampaigns((campaignsRes.data || []) as unknown as CampaignStats[]);

    // Instances: derive daily/period counts from queue (source of truth)
    const today = new Date().toISOString().substring(0, 10);
    const periodCounts = new Map<string, number>();
    const todayCounts = new Map<string, number>();
    for (const q of queueItems) {
      if (!q.instance_id || !q.sent_at) continue;
      periodCounts.set(q.instance_id, (periodCounts.get(q.instance_id) || 0) + 1);
      if (q.sent_at.substring(0, 10) === today) {
        todayCounts.set(q.instance_id, (todayCounts.get(q.instance_id) || 0) + 1);
      }
    }

    const normalizedInstances = ((instancesRes.data || []) as unknown as InstanceHealth[]).map(inst => ({
      ...inst,
      messages_sent_today: todayCounts.get(inst.id) || 0,
      messages_sent_period: periodCounts.get(inst.id) || 0,
    }));

    setInstances(normalizedInstances);

    setLoading(false);
  }, [user, getPeriodDate]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const deliveryRate = kpis.sent > 0 ? Math.round((kpis.delivered / kpis.sent) * 100) : 0;
  const responseRate = kpis.sent > 0 ? Math.round((kpis.responses / kpis.sent) * 100) : 0;
  const qualificationRate = kpis.responses > 0 ? Math.round((kpis.qualified / kpis.responses) * 100) : 0;

  return (
    <MainLayout>
      <div className="space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Analytics WhatsApp
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Monitore a performance das suas campanhas e instâncias
            </p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Send className="h-4 w-4" />
                    <span className="text-xs">Enviadas</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{kpis.sent.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <CheckCheck className="h-4 w-4" />
                    <span className="text-xs">Taxa Entrega</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{deliveryRate}%</p>
                  <p className="text-xs text-muted-foreground">{kpis.delivered.toLocaleString()} entregues</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-xs">Taxa Resposta</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{responseRate}%</p>
                  <p className="text-xs text-muted-foreground">{kpis.responses} respostas</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-xs">Taxa Qualificação</span>
                  </div>
                  <p className="text-2xl font-bold text-primary">{qualificationRate}%</p>
                  <p className="text-xs text-muted-foreground">{kpis.qualified} qualificados</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-destructive mb-1">
                    <XCircle className="h-4 w-4" />
                    <span className="text-xs">Opt-outs</span>
                  </div>
                  <p className="text-2xl font-bold text-destructive">{kpis.optOut}</p>
                </CardContent>
              </Card>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Pie */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Distribuição de Respostas por Categoria IA</CardTitle>
                </CardHeader>
                <CardContent>
                  {categoryData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Nenhuma resposta categorizada ainda</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {categoryData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Volume Line Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Volume de Mensagens</CardTitle>
                </CardHeader>
                <CardContent>
                  {volumeData.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Sem dados no período</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={volumeData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="enviadas" stroke="hsl(var(--primary))" strokeWidth={2} name="Enviadas" />
                        <Line type="monotone" dataKey="recebidas" stroke="hsl(var(--secondary))" strokeWidth={2} name="Recebidas" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Campaign Performance Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance por Campanha</CardTitle>
                <CardDescription>Resultados das suas campanhas mais recentes</CardDescription>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhuma campanha encontrada</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 font-medium text-muted-foreground">Campanha</th>
                          <th className="text-center py-2 px-3 font-medium text-muted-foreground">Status</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Contatos</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Enviadas</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Entregues</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Falhas</th>
                          <th className="text-right py-2 px-3 font-medium text-muted-foreground">Taxa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.map(c => {
                          const rate = c.total_contacts > 0 ? Math.round((c.sent_count / c.total_contacts) * 100) : 0;
                          return (
                            <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                              <td className="py-2 px-3 font-medium max-w-[200px] truncate">{c.name}</td>
                              <td className="py-2 px-3 text-center">
                                <Badge variant={c.status === 'completed' ? 'secondary' : c.status === 'running' ? 'default' : 'outline'}>
                                  {c.status}
                                </Badge>
                              </td>
                              <td className="py-2 px-3 text-right text-muted-foreground">{c.total_contacts}</td>
                              <td className="py-2 px-3 text-right">{c.sent_count}</td>
                              <td className="py-2 px-3 text-right text-primary">{c.delivered_count}</td>
                              <td className="py-2 px-3 text-right text-destructive">{c.failed_count}</td>
                              <td className="py-2 px-3 text-right font-medium">{rate}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Instance Health */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Saúde das Instâncias
                </CardTitle>
                <CardDescription>Status e health score das instâncias WhatsApp</CardDescription>
              </CardHeader>
              <CardContent>
                {instances.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Nenhuma instância encontrada</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {instances.map(inst => {
                      const healthColor = inst.health_score >= 70 ? 'text-green-600' : inst.health_score >= 40 ? 'text-yellow-600' : 'text-red-600';
                      const healthBg = inst.health_score >= 70 ? 'bg-green-500' : inst.health_score >= 40 ? 'bg-yellow-500' : 'bg-red-500';
                      return (
                        <div key={inst.id} className="border rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm truncate">
                              {inst.friendly_name || inst.instance_name}
                            </span>
                            <Badge variant={inst.status === 'connected' ? 'default' : 'destructive'}>
                              {inst.status === 'connected' ? 'Conectada' : inst.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                                <span>Health Score</span>
                                <span className={`font-bold ${healthColor}`}>{inst.health_score}</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${healthBg}`} style={{ width: `${inst.health_score}%` }} />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Mensagens hoje</span>
                            <span className="font-medium text-foreground">{inst.messages_sent_today}</span>
                          </div>
                          {!inst.is_active && (
                            <p className="text-xs text-destructive font-medium">⚠️ Instância desativada</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MainLayout>
  );
}
