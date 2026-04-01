/**
 * ExecutiveSummary.tsx — Modo Simplificado do José
 * Apresenta o resultado da análise em linguagem de negócios, sem jargões técnicos.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
  Zap, DollarSign, Target, Pause, Play, Loader2,
} from 'lucide-react';

interface ExecutiveSummaryProps {
  session: any;
  pendingActions: any[];
  isAnalyzing: boolean;
  currencySymbol: string;
  onExecuteAction: (action: any) => void;
  onExecuteAll: () => void;
  isExecuting: boolean;
}

/** Skeleton de loading — percepção de velocidade */
export function ExecutiveSkeleton() {
  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className="border-orange-500/20 bg-orange-500/5">
        <CardContent className="pt-5 pb-4 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
      {/* Money metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="pt-4 pb-3 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-24" />
          </CardContent></Card>
        ))}
      </div>
      {/* Actions */}
      <Card><CardContent className="pt-4 pb-4 space-y-3">
        <Skeleton className="h-4 w-32" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </CardContent></Card>
    </div>
  );
}

export function ExecutiveSummary({
  session, pendingActions, isAnalyzing,
  currencySymbol, onExecuteAction, onExecuteAll, isExecuting,
}: ExecutiveSummaryProps) {
  const [executingId, setExecutingId] = useState<string | null>(null);

  if (isAnalyzing) return <ExecutiveSkeleton />;
  if (!session)    return null;

  // ── Métricas financeiras agregadas ──────────────────────────────────────────
  const totalSpend     = session.campaigns?.reduce((s: number, c: any) => s + (c.spend ?? 0), 0) ?? 0;
  const totalRevenue   = session.campaigns?.reduce((s: number, c: any) => s + (c.revenue ?? 0), 0) ?? 0;
  const totalConv      = session.campaigns?.reduce((s: number, c: any) => s + (c.conversions ?? 0), 0) ?? 0;
  const avgRoas        = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCpa         = totalConv > 0  ? totalSpend / totalConv   : 0;

  const score = session.overall_health_score ?? session.campaigns?.reduce(
    (s: number, c: any, _: any, arr: any[]) => s + (c.health_score ?? 50) / arr.length, 0
  ) ?? 50;

  // ── Status geral ─────────────────────────────────────────────────────────────
  const statusInfo = score >= 70
    ? { label: 'Conta Saudável ✅', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5' }
    : score >= 45
    ? { label: 'Atenção Necessária ⚠️', color: 'text-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/5' }
    : { label: 'Ação Urgente 🚨', color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/5' };

  // ── Ações prioritárias (max 3) ────────────────────────────────────────────────
  const topActions = pendingActions
    .filter((a: any) => ['pause', 'increase_budget', 'decrease_budget', 'activate'].includes(a.type))
    .slice(0, 3);

  // ── Impacto financeiro estimado ─────────────────────────────────────────────
  const savingsEstimate  = pendingActions
    .filter((a: any) => a.type === 'pause' || a.type === 'decrease_budget')
    .reduce((s: number, a: any) => s + (a.estimated_impact?.spend_change ? Math.abs(a.estimated_impact.spend_change) : 0), 0);

  const roasGainEstimate = pendingActions
    .filter((a: any) => a.type === 'increase_budget' || a.type === 'activate')
    .reduce((s: number, a: any) => s + (a.estimated_impact?.roas_change ?? 0), 0);

  // ── Handler de ação individual ───────────────────────────────────────────────
  const handleSingle = async (action: any) => {
    setExecutingId(action.id);
    await onExecuteAction(action);
    setExecutingId(null);
  };

  // ── Labels amigáveis ─────────────────────────────────────────────────────────
  const actionLabel = (type: string, name: string) => ({
    pause:           `Pausar "${name}" (não está gerando resultado)`,
    activate:        `Ativar "${name}" (alta probabilidade de resultado)`,
    increase_budget: `Investir mais em "${name}" (está funcionando bem)`,
    decrease_budget: `Reduzir verba de "${name}" (retorno baixo)`,
    clone_campaign:  `Duplicar "${name}" para testar`,
  } as Record<string, string>)[type] || `Otimizar "${name}"`;

  const actionIcon = (type: string) => ({
    pause:           <Pause className="h-4 w-4 text-red-400" />,
    activate:        <Play className="h-4 w-4 text-emerald-400" />,
    increase_budget: <TrendingUp className="h-4 w-4 text-emerald-400" />,
    decrease_budget: <TrendingDown className="h-4 w-4 text-orange-400" />,
  } as Record<string, JSX.Element>)[type] || <Zap className="h-4 w-4 text-orange-400" />;

  const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">

      {/* ── Status Geral ─────────────────────────────────────────────────────── */}
      <Card className={`${statusInfo.border} ${statusInfo.bg}`}>
        <CardContent className="pt-5 pb-4 space-y-2">
          <p className={`font-bold text-lg ${statusInfo.color}`}>{statusInfo.label}</p>
          {session.summary && (
            <p className="text-sm text-foreground/80 leading-relaxed">{session.summary}</p>
          )}
          {(savingsEstimate > 0 || roasGainEstimate > 0) && (
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border/30">
              {savingsEstimate > 0 && (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs gap-1 py-1">
                  <DollarSign className="h-3 w-3" />
                  Economia estimada: {currencySymbol} {fmt(savingsEstimate)}/mês
                </Badge>
              )}
              {roasGainEstimate > 0 && (
                <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/30 text-xs gap-1 py-1">
                  <TrendingUp className="h-3 w-3" />
                  Ganho de ROAS estimado: +{roasGainEstimate.toFixed(1)}x
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Métricas de Dinheiro ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">💸 Valor Investido</p>
            <p className="text-2xl font-bold">{currencySymbol} {fmt(totalSpend)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">no período</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">📈 Retorno (ROAS)</p>
            <p className={`text-2xl font-bold ${avgRoas >= 3 ? 'text-emerald-400' : avgRoas >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
              {avgRoas > 0 ? `${avgRoas.toFixed(1)}x` : '—'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {avgRoas >= 3 ? 'Excelente' : avgRoas >= 1.5 ? 'Razoável' : avgRoas > 0 ? 'Abaixo do ideal' : 'Sem dados'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">🎯 Custo por Resultado</p>
            <p className="text-2xl font-bold">{avgCpa > 0 ? `${currencySymbol} ${fmt(avgCpa)}` : '—'}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">por conversão</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground mb-1">✅ Conversões</p>
            <p className="text-2xl font-bold text-emerald-400">{totalConv.toLocaleString('pt-BR')}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">no período</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Ações Prioritárias ────────────────────────────────────────────────── */}
      {topActions.length > 0 && (
        <Card className="border-orange-500/20">
          <CardContent className="pt-5 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-400" />
                O que JOSÉ recomenda agora
              </p>
              {topActions.length > 1 && (
                <Button
                  size="sm"
                  onClick={onExecuteAll}
                  disabled={isExecuting}
                  className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white gap-1"
                >
                  {isExecuting
                    ? <><Loader2 className="h-3 w-3 animate-spin" />Aplicando...</>
                    : <><Zap className="h-3 w-3" />Aplicar Tudo</>}
                </Button>
              )}
            </div>

            <div className="space-y-2">
              {topActions.map((action: any) => (
                <div key={action.id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                  {actionIcon(action.type)}
                  <p className="text-sm flex-1 leading-snug">
                    {actionLabel(action.type, action.campaign_name || action.target_id || 'Campanha')}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSingle(action)}
                    disabled={executingId === action.id || isExecuting}
                    className="h-7 text-xs shrink-0 border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                  >
                    {executingId === action.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : 'Aplicar'}
                  </Button>
                </div>
              ))}
            </div>

            {/* Botões de ação rápida em massa */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border/20">
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => {
                  const pauseActions = pendingActions.filter((a: any) => a.type === 'pause');
                  pauseActions.forEach(onExecuteAction);
                }}
                disabled={isExecuting || !pendingActions.some((a: any) => a.type === 'pause')}
              >
                <Pause className="h-3 w-3" /> Pausar o que não vende
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={() => {
                  const scaleActions = pendingActions.filter((a: any) => a.type === 'increase_budget');
                  scaleActions.forEach(onExecuteAction);
                }}
                disabled={isExecuting || !pendingActions.some((a: any) => a.type === 'increase_budget')}
              >
                <TrendingUp className="h-3 w-3" /> Escalar o que funciona
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Nenhuma ação pendente ─────────────────────────────────────────────── */}
      {topActions.length === 0 && session && (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-400 text-sm">Tudo em ordem!</p>
              <p className="text-xs text-muted-foreground">JOSÉ não identificou ações urgentes no momento.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
