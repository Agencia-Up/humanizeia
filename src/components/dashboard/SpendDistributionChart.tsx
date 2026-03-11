import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface CampaignRow {
  id: string;
  name: string;
  spend: number;
}

interface SpendDistributionChartProps {
  data: CampaignRow[];
  isLoading?: boolean;
}

const COLORS = [
  'hsl(217, 91%, 60%)',
  'hsl(160, 84%, 39%)',
  'hsl(38, 92%, 50%)',
  'hsl(280, 67%, 55%)',
  'hsl(350, 80%, 55%)',
  'hsl(200, 50%, 50%)',
];

const fmtCur = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

export function SpendDistributionChart({ data, isLoading }: SpendDistributionChartProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Distribuição de Gasto</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
    );
  }

  const sorted = [...data].sort((a, b) => b.spend - a.spend);
  const top5 = sorted.slice(0, 5);
  const othersSpend = sorted.slice(5).reduce((sum, c) => sum + c.spend, 0);

  const chartData = [
    ...top5.map(c => ({ name: c.name.length > 20 ? c.name.slice(0, 20) + '…' : c.name, value: c.spend })),
    ...(othersSpend > 0 ? [{ name: 'Outros', value: othersSpend }] : []),
  ];

  if (!chartData.length) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Distribuição de Gasto</CardTitle></CardHeader>
        <CardContent><p className="text-center text-muted-foreground py-10">Nenhum dado disponível.</p></CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload?.[0]) {
      const total = chartData.reduce((s, d) => s + d.value, 0);
      const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : '0';
      return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg">
          <p className="text-sm font-medium text-foreground">{payload[0].name}</p>
          <p className="text-sm text-muted-foreground">{fmtCur(payload[0].value)} ({pct}%)</p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader><CardTitle className="text-lg">Distribuição de Gasto</CardTitle></CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value">
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value: string) => <span className="text-xs text-muted-foreground">{value}</span>}
                wrapperStyle={{ fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
