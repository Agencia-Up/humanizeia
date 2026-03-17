import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Activity, MousePointerClick, UserCheck, ShoppingCart, Heart } from 'lucide-react';

export interface FunnelStage {
  name: string;
  score: number;
  metric: string;
  value: string;
  benchmark: string;
  icon: 'impressions' | 'clicks' | 'leads' | 'sales' | 'retention';
}

const iconMap = {
  impressions: Activity,
  clicks: MousePointerClick,
  leads: UserCheck,
  sales: ShoppingCart,
  retention: Heart,
};

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function getScoreBg(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

function getStatusBadge(score: number) {
  if (score >= 80) return { label: 'Saudável', variant: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
  if (score >= 60) return { label: 'Atenção', variant: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
  return { label: 'Crítico', variant: 'bg-red-500/20 text-red-400 border-red-500/30' };
}

interface FunnelHealthCardProps {
  stages: FunnelStage[];
  overallScore?: number;
}

export function FunnelHealthCard({ stages, overallScore }: FunnelHealthCardProps) {
  const avgScore = overallScore ?? Math.round(stages.reduce((s, st) => s + st.score, 0) / stages.length);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Saúde do Funil
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${getScoreColor(avgScore)}`}>{avgScore}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((stage, i) => {
          const Icon = iconMap[stage.icon];
          const status = getStatusBadge(stage.score);
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{stage.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] px-1.5 py-0 ${status.variant}`}>{status.label}</Badge>
                  <span className={`text-sm font-bold ${getScoreColor(stage.score)}`}>{stage.score}</span>
                </div>
              </div>
              <Progress value={stage.score} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{stage.metric}: <strong className="text-foreground">{stage.value}</strong></span>
                <span>Benchmark: {stage.benchmark}</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
