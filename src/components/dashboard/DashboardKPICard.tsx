import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import { DashboardKPI } from '@/hooks/useMetaDashboard';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { DollarSign, Eye, MousePointerClick, Percent, CreditCard, BarChart3, TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';

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
  gasto: 'Investimento',
  impressoes: 'Visualizações',
  cliques: 'Cliques',
  ctr: 'Taxa de Cliques',
  cpc: 'Custo por Clique',
  cpm: 'Custo por Mil',
  roas: 'Retorno (ROAS)',
  cpa: 'Custo por Ação',
};

const emojiMap: Record<string, string> = {
  gasto: '💰',
  impressoes: '👁️',
  cliques: '👆',
  ctr: '🎯',
  cpc: '💳',
  cpm: '📊',
  roas: '📈',
  cpa: '🛒',
};

const lowerIsBetter = new Set(['cpc', 'cpm', 'cpa']);

function generateSparklineData(value: number, change: number, points = 7): { v: number }[] {
  const data: { v: number }[] = [];
  const startValue = value / (1 + change / 100);
  const step = (value - startValue) / (points - 1);
  for (let i = 0; i < points; i++) {
    const base = startValue + step * i;
    const jitter = base * (Math.random() * 0.15 - 0.075);
    data.push({ v: Math.max(0, base + jitter) });
  }
  data[data.length - 1] = { v: value };
  return data;
}

interface DashboardKPICardProps {
  kpi: DashboardKPI;
  index: number;
  sparklineData?: number[];
}

export function DashboardKPICard({ kpi, index, sparklineData }: DashboardKPICardProps) {
  const Icon = iconMap[kpi.id] || DollarSign;
  const change = kpi.change;
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isInverse = lowerIsBetter.has(kpi.id);

  const isGoodTrend = isInverse ? isNegative : isPositive;
  const isBadTrend = isInverse ? isPositive : isNegative;

  const trendColor = isGoodTrend ? 'text-success' : isBadTrend ? 'text-destructive' : 'text-muted-foreground';
  const trendBg = isGoodTrend ? 'bg-success/10' : isBadTrend ? 'bg-destructive/10' : 'bg-muted/50';

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const friendlyLabel = friendlyLabelMap[kpi.id] || kpi.label;
  const emoji = emojiMap[kpi.id] || '📊';
  const tooltipText = tooltipMap[kpi.id];

  const sparklineColor = isGoodTrend
    ? 'hsl(var(--success))'
    : isBadTrend
      ? 'hsl(var(--destructive))'
      : 'hsl(var(--muted-foreground))';

  const gradientId = `sparkline-gradient-${kpi.id}`;

  const chartData = useMemo(() => {
    if (sparklineData && sparklineData.length > 0) {
      return sparklineData.map((v) => ({ v }));
    }
    return generateSparklineData(kpi.value, kpi.change);
  }, [sparklineData, kpi.value, kpi.change]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="group relative overflow-hidden border border-border/40 bg-card/70 backdrop-blur-md transition-all duration-300 hover:shadow-xl hover:shadow-primary/8 hover:border-primary/40 hover:-translate-y-0.5 cursor-default">
            {/* Subtle top accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/60 via-accent/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            
            <CardContent className="p-5 pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 group-hover:bg-primary/15 transition-colors duration-300 ring-1 ring-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wider">{emoji} {friendlyLabel}</p>
                    </div>
                  </div>
                  <p className="text-2xl font-bold tracking-tight text-foreground">{kpi.formattedValue}</p>
                </div>
                {change !== 0 && (
                  <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${trendColor} ${trendBg} mt-1 ring-1 ring-current/10`}>
                    <TrendIcon className="h-3 w-3" />
                    <span>{isPositive ? '+' : ''}{change}%</span>
                  </div>
                )}
              </div>
              {/* Sparkline */}
              <div className="mt-3 -mx-1">
                <ResponsiveContainer width="100%" height={32}>
                  <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={sparklineColor} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={sparklineColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="v"
                      stroke={sparklineColor}
                      strokeWidth={1.5}
                      fill={`url(#${gradientId})`}
                      dot={false}
                      isAnimationActive={true}
                      animationDuration={800}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        {tooltipText && (
          <TooltipContent side="bottom" className="max-w-xs text-sm bg-popover/95 backdrop-blur-sm border-border/60">
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
