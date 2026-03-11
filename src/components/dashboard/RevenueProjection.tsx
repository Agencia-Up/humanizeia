import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, MousePointerClick, DollarSign, Users } from 'lucide-react';
import { motion } from 'framer-motion';

const fmtCur = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(n);

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

interface PerformanceSummaryProps {
  totalSpend: number;
  avgCPC: number;
  avgCPM: number;
  totalReach: number;
  frequency: number;
}

export function PerformanceSummary({ totalSpend, avgCPC, avgCPM, totalReach, frequency }: PerformanceSummaryProps) {
  const items = [
    { label: 'Gasto Acumulado', value: fmtCur(totalSpend), icon: DollarSign, delay: 0 },
    { label: 'CPC Médio', value: fmtCur(avgCPC), icon: MousePointerClick, delay: 0.1 },
    { label: 'CPM Médio', value: fmtCur(avgCPM), icon: BarChart3, delay: 0.2 },
    { label: 'Alcance Total', value: fmt(totalReach), icon: Users, delay: 0.3 },
  ];

  return (
    <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-5 w-5 text-primary" />
          Resumo de Performance
          <Badge className="bg-primary/20 text-primary text-xs">
            Freq. {frequency.toFixed(1)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {items.map((item) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: item.delay }}
              className="space-y-1"
            >
              <div className="flex items-center gap-1.5">
                <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{item.label}</p>
              </div>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
