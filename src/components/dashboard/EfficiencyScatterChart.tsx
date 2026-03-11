import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from 'recharts';

interface CampaignRow {
  id: string;
  name: string;
  cpc: number;
  ctr: number;
  spend: number;
}

interface EfficiencyScatterChartProps {
  data: CampaignRow[];
  isLoading?: boolean;
}

const fmtCur = (n: number) => `R$ ${n.toFixed(2)}`;

export function EfficiencyScatterChart({ data, isLoading }: EfficiencyScatterChartProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Eficiência por Campanha</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
    );
  }

  const chartData = data.filter(c => c.cpc > 0 && c.ctr > 0).map(c => ({
    name: c.name,
    cpc: Number(c.cpc.toFixed(2)),
    ctr: Number(c.ctr.toFixed(2)),
    spend: c.spend,
  }));

  if (!chartData.length) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Eficiência por Campanha</CardTitle></CardHeader>
        <CardContent><p className="text-center text-muted-foreground py-10">Nenhum dado disponível.</p></CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload?.[0]?.payload) {
      const d = payload[0].payload;
      return (
        <div className="rounded-lg border border-border bg-popover p-3 shadow-lg max-w-[220px]">
          <p className="text-sm font-medium text-foreground truncate">{d.name}</p>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <p>CPC: {fmtCur(d.cpc)}</p>
            <p>CTR: {d.ctr}%</p>
            <p>Gasto: {fmtCur(d.spend)}</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Eficiência por Campanha</CardTitle>
        <p className="text-xs text-muted-foreground">CPC (eixo X) vs CTR (eixo Y) — bolha = gasto</p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis type="number" dataKey="cpc" name="CPC" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
              <YAxis type="number" dataKey="ctr" name="CTR" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <ZAxis type="number" dataKey="spend" range={[40, 400]} />
              <Tooltip content={<CustomTooltip />} />
              <Scatter data={chartData} fill="hsl(217, 91%, 60%)" fillOpacity={0.7} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
