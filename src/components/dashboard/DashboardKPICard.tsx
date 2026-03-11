import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import { DashboardKPI } from '@/hooks/useMetaDashboard';
import { DollarSign, Eye, MousePointerClick, Percent, CreditCard, BarChart3, Users, Repeat, TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';

const iconMap: Record<string, React.ElementType> = {
  gasto: DollarSign,
  impressoes: Eye,
  cliques: MousePointerClick,
  ctr: Percent,
  cpc: CreditCard,
  cpm: BarChart3,
  roas: TrendingUp,
  cpa: CreditCard,
};

const tooltipMap: Record<string, string> = {
  gasto: 'Quanto você investiu no total em anúncios neste período.',
  impressoes: 'Quantas vezes seus anúncios foram exibidos para as pessoas.',
  cliques: 'Quantas vezes as pessoas clicaram nos seus anúncios.',
  ctr: 'Porcentagem de pessoas que viram e clicaram. Quanto maior, melhor!',
  cpc: 'Quanto você pagou, em média, por cada clique. Quanto menor, melhor!',
  cpm: 'Custo para exibir seu anúncio 1.000 vezes. Quanto menor, melhor!',
  roas: 'Retorno sobre o investimento em anúncios. Ex: 3x = para cada R$1 investido, voltaram R$3.',
  cpa: 'Quanto você pagou, em média, por cada conversão (compra, lead, etc). Quanto menor, melhor!',
};

const friendlyLabelMap: Record<string, string> = {
  gasto: '💰 Investimento',
  impressoes: '👁️ Visualizações',
  cliques: '👆 Cliques',
  ctr: '🎯 Taxa de Cliques',
  cpc: '💳 Custo por Clique',
  cpm: '📊 Custo por Mil',
  roas: '📈 Retorno (ROAS)',
  cpa: '🛒 Custo por Ação',
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

  const trendBg = isInverse
    ? isNegative ? 'bg-success/10' : isPositive ? 'bg-destructive/10' : 'bg-muted/50'
    : isPositive ? 'bg-success/10' : isNegative ? 'bg-destructive/10' : 'bg-muted/50';

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const friendlyLabel = friendlyLabelMap[kpi.id] || kpi.label;
  const tooltipText = tooltipMap[kpi.id];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="group overflow-hidden border transition-all hover:shadow-lg hover:shadow-primary/5 border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 cursor-default">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">{friendlyLabel}</p>
                  </div>
                  <p className="text-xl font-bold tracking-tight">{kpi.formattedValue}</p>
                </div>
                {change !== 0 && (
                  <div className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${trendColor} ${trendBg} mt-1`}>
                    <TrendIcon className="h-3 w-3" />
                    <span>{isPositive ? '+' : ''}{change}%</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        {tooltipText && (
          <TooltipContent side="bottom" className="max-w-xs text-sm">
            <div className="flex items-start gap-2">
              <HelpCircle className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <span>{tooltipText}</span>
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </motion.div>
  );
}
