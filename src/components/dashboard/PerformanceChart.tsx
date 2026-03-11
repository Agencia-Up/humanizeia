import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { MetaRefreshIndicator } from '@/components/dashboard/MetaRefreshIndicator';
import { Skeleton } from '@/components/ui/skeleton';

type MetricType = 'vendas' | 'gasto' | 'cpa' | 'receita';

const metricLabels: Record<MetricType, string> = {
  vendas: 'Vendas',
  receita: 'Receita (R$)',
  gasto: 'Gasto (R$)',
  cpa: 'CPA (R$)',
};

const metricColors: Record<MetricType, string> = {
  vendas: '#10B981',
  receita: '#8B5CF6',
  gasto: '#3B82F6',
  cpa: '#F59E0B',
};

export function PerformanceChart() {
  const [selectedMetrics, setSelectedMetrics] = useState<MetricType[]>(['vendas', 'cpa']);
  const { connectedAccount } = useMetaConnection();

  const { data: rawData, isLoading, isRefreshing, lastUpdated, refresh } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: 'last_30d',
    timeIncrement: '1',
    fields: 'spend,actions,action_values',
    enabled: !!connectedAccount,
  });

  const chartData = (rawData?.data || []).map((day: any) => {
    const spend = Number(day.spend || 0);
    const purchases = Number(
      day.actions?.find((a: any) => a.action_type === 'purchase')?.value || 0
    );
    const revenue = Number(
      day.action_values?.find((a: any) => a.action_type === 'purchase')?.value || 0
    );
    return {
      date: day.date_start,
      vendas: purchases,
      gasto: spend,
      cpa: purchases > 0 ? spend / purchases : 0,
      receita: revenue,
    };
  });

  const toggleMetric = (metric: MetricType) => {
    if (selectedMetrics.includes(metric)) {
      if (selectedMetrics.length > 1) {
        setSelectedMetrics(selectedMetrics.filter((m) => m !== metric));
      }
    } else {
      setSelectedMetrics([...selectedMetrics, metric]);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
          <p className="mb-2 text-sm font-medium text-foreground">{formatDate(label)}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{metricLabels[entry.dataKey as MetricType]}:</span>
              <span className="font-medium text-foreground">
                {entry.dataKey === 'vendas'
                  ? entry.value
                  : `R$ ${Number(entry.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Performance - Últimos 30 dias</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-80 w-full" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">Performance - Últimos 30 dias</CardTitle>
          <MetaRefreshIndicator isRefreshing={isRefreshing} lastUpdated={lastUpdated} onRefresh={refresh} />
        </div>
        <Tabs value="all" className="w-auto">
          <TabsList className="bg-muted/50">
            {(Object.keys(metricLabels) as MetricType[]).map((metric) => (
              <TabsTrigger
                key={metric}
                value={metric}
                onClick={() => toggleMetric(metric)}
                className={`text-xs ${
                  selectedMetrics.includes(metric)
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {metricLabels[metric].split(' ')[0]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-80 items-center justify-center text-muted-foreground">
            Nenhum dado disponível para o período
          </div>
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  {(Object.keys(metricColors) as MetricType[]).map((metric) => (
                    <linearGradient key={metric} id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={metricColors[metric]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={metricColors[metric]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDate}
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                {selectedMetrics.map((metric) => (
                  <Area
                    key={metric}
                    type="monotone"
                    dataKey={metric}
                    name={metricLabels[metric]}
                    stroke={metricColors[metric]}
                    strokeWidth={2}
                    fill={`url(#gradient-${metric})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
