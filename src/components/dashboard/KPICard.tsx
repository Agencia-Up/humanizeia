import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { motion } from 'framer-motion';

interface KPICardProps {
  label: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  sparkline: number[];
  index?: number;
}

export function KPICard({ label, value, change, trend, sparkline, index = 0 }: KPICardProps) {
  const isPositive = trend === 'up';
  const isNegative = trend === 'down';
  const isNeutral = trend === 'stable';

  // For CPA, down is good (green), up is bad (red)
  const isCPA = label === 'CPA';
  const trendColor = isCPA
    ? isNegative
      ? 'text-success'
      : isPositive
      ? 'text-destructive'
      : 'text-muted-foreground'
    : isPositive
    ? 'text-success'
    : isNegative
    ? 'text-destructive'
    : 'text-muted-foreground';

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;

  // Generate sparkline SVG path
  const maxVal = Math.max(...sparkline);
  const minVal = Math.min(...sparkline);
  const range = maxVal - minVal || 1;
  const width = 100;
  const height = 32;
  const points = sparkline
    .map((val, i) => {
      const x = (i / (sparkline.length - 1)) * width;
      const y = height - ((val - minVal) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold tracking-tight">{value}</p>
              <div className={`flex items-center gap-1 text-sm ${trendColor}`}>
                <TrendIcon className="h-4 w-4" />
                <span className="font-medium">
                  {isPositive ? '+' : ''}
                  {change}%
                </span>
                <span className="text-muted-foreground">vs anterior</span>
              </div>
            </div>
            <div className="h-10 w-24">
              <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
                <defs>
                  <linearGradient id={`sparkline-gradient-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="hsl(var(--primary))" />
                    <stop offset="100%" stopColor="hsl(var(--accent))" />
                  </linearGradient>
                </defs>
                <polyline
                  fill="none"
                  stroke={`url(#sparkline-gradient-${index})`}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
              </svg>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
