import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { DashboardKPI } from '@/hooks/useMetaDashboard';
import { DollarSign, Eye, MousePointerClick, Percent, CreditCard, BarChart3, Users, Repeat } from 'lucide-react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  gasto: DollarSign,
  impressoes: Eye,
  cliques: MousePointerClick,
  ctr: Percent,
  cpc: CreditCard,
  cpm: BarChart3,
  alcance: Users,
  frequencia: Repeat,
};

// For CPC, CPM, Frequency — lower is better (down = green)
const lowerIsBetter = new Set(['cpc', 'cpm', 'frequencia']);

interface DashboardKPICardProps {
  kpi: DashboardKPI;
  index: number;
}

export function DashboardKPICard({ kpi, index }: DashboardKPICardProps) {
  const Icon = iconMap[kpi.id] || DollarSign;
  const change = kpi.change;
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isInverse = lowerIsBetter.has(kpi.id);

  const trendColor = isInverse
    ? isNegative ? 'text-success' : isPositive ? 'text-destructive' : 'text-muted-foreground'
    : isPositive ? 'text-success' : isNegative ? 'text-destructive' : 'text-muted-foreground';

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Card className="overflow-hidden border transition-all hover:shadow-lg hover:shadow-primary/5 border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
              </div>
              <p className="text-xl font-bold tracking-tight">{kpi.formattedValue}</p>
            </div>
            {change !== 0 && (
              <div className={`flex items-center gap-0.5 text-xs font-medium ${trendColor} mt-1`}>
                <TrendIcon className="h-3 w-3" />
                <span>{isPositive ? '+' : ''}{change}%</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
