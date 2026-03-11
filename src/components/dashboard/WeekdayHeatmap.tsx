import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';

interface TrendDataPoint {
  date: string;
  ctr: number;
  cpm: number;
  investimento: number;
}

interface WeekdayHeatmapProps {
  data: TrendDataPoint[];
  isLoading?: boolean;
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const METRICS = [
  { key: 'ctr', label: 'CTR (%)', fmt: (v: number) => v.toFixed(2) + '%' },
  { key: 'cpm', label: 'CPM (R$)', fmt: (v: number) => 'R$ ' + v.toFixed(2) },
  { key: 'investimento', label: 'Gasto (R$)', fmt: (v: number) => 'R$ ' + v.toFixed(0) },
];

function getIntensity(value: number, min: number, max: number): string {
  if (max === min) return 'bg-primary/20';
  const pct = (value - min) / (max - min);
  if (pct < 0.2) return 'bg-primary/10';
  if (pct < 0.4) return 'bg-primary/20';
  if (pct < 0.6) return 'bg-primary/40';
  if (pct < 0.8) return 'bg-primary/60';
  return 'bg-primary/80';
}

export function WeekdayHeatmap({ data, isLoading }: WeekdayHeatmapProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Performance por Dia da Semana</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Performance por Dia da Semana</CardTitle></CardHeader>
        <CardContent><p className="text-center text-muted-foreground py-10">Nenhum dado disponível.</p></CardContent>
      </Card>
    );
  }

  // Group by weekday
  const grouped: Record<number, { ctr: number[]; cpm: number[]; investimento: number[] }> = {};
  for (let i = 0; i < 7; i++) grouped[i] = { ctr: [], cpm: [], investimento: [] };

  data.forEach(d => {
    if (!d.date) return;
    const day = new Date(d.date + 'T12:00:00').getDay();
    grouped[day].ctr.push(d.ctr || 0);
    grouped[day].cpm.push(d.cpm || 0);
    grouped[day].investimento.push(d.investimento || 0);
  });

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  const heatData = METRICS.map(metric => {
    const values = DAYS.map((_, i) => avg(grouped[i][metric.key as keyof typeof grouped[0]]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { metric, values, min, max };
  });

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Performance por Dia da Semana</CardTitle>
        <p className="text-xs text-muted-foreground">Média dos últimos 30 dias</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="py-2 pr-3 text-left text-muted-foreground font-medium">Métrica</th>
                {DAYS.map(d => (
                  <th key={d} className="py-2 px-1.5 text-center text-muted-foreground font-medium">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heatData.map(({ metric, values, min, max }, ri) => (
                <tr key={metric.key}>
                  <td className="py-1.5 pr-3 font-medium text-foreground whitespace-nowrap">{metric.label}</td>
                  {values.map((val, ci) => (
                    <td key={ci} className="py-1.5 px-1">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: (ri * 7 + ci) * 0.02 }}
                        className={`rounded-md px-1.5 py-2 text-center font-medium tabular-nums ${getIntensity(val, min, max)} text-primary-foreground`}
                        title={metric.fmt(val)}
                      >
                        {metric.fmt(val)}
                      </motion.div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
