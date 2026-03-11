import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Zap, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

interface CreativeData {
  id: string;
  name: string;
  platform: string;
  ctr: number;
  cpc: number;
  impressions: number;
  spend: number;
  clicks: number;
}

interface CreativeAlertsWidgetProps {
  bestCreatives: CreativeData[];
  worstCreatives: CreativeData[];
  isLoading?: boolean;
}

const fmtCur = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export function CreativeAlertsWidget({ bestCreatives, worstCreatives, isLoading }: CreativeAlertsWidgetProps) {
  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/50 bg-card/50"><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
        <Card className="border-border/50 bg-card/50"><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
      </div>
    );
  }

  if (!bestCreatives.length && !worstCreatives.length) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-6 text-center text-muted-foreground">Nenhum dado de criativo disponível.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-success/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-success" /> Melhores Anúncios
            <Badge className="bg-success/20 text-success text-xs">Por CTR</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bestCreatives.map((creative, i) => (
            <motion.div key={creative.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 transition-colors hover:bg-muted/40">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-xl">📢</div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{creative.name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{fmt(creative.impressions)} imp.</span>
                  <span>{fmt(creative.clicks)} cliques</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1 text-sm font-bold text-success">
                  <TrendingUp className="h-3 w-3" /> {creative.ctr.toFixed(2)}% CTR
                </div>
                <span className="text-xs font-medium">CPC {fmtCur(creative.cpc)}</span>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-destructive/30 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-destructive" /> CPC Mais Alto
            <Badge className="bg-destructive/20 text-destructive text-xs">Por CPC</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {worstCreatives.map((creative, i) => (
            <motion.div key={creative.id} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 transition-colors hover:bg-muted/40">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-xl">⚠️</div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium">{creative.name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{fmt(creative.impressions)} imp.</span>
                  <span>{fmt(creative.clicks)} cliques</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1 text-sm font-bold text-destructive">
                  <TrendingDown className="h-3 w-3" /> CPC {fmtCur(creative.cpc)}
                </div>
                <span className="text-xs font-medium">{creative.ctr.toFixed(2)}% CTR</span>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
