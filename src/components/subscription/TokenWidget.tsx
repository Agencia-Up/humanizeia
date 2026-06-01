import { useNavigate } from 'react-router-dom';
import { Zap, AlertTriangle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function TokenWidget() {
  const navigate = useNavigate();
  const { subscription, tokensAvailable, tokensTotal, usagePercent, planInfo, loading } = useSubscription();
  const { user } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);

  // O plano (ex.: 150 atendimentos) e da CONTA MASTER que contratou. Vendedores
  // vinculados nao compram credito nem rodam a IA (ela so existe na master),
  // entao o widget de uso nunca aparece pra eles.
  if (sellerLoading || isSeller) return null;
  if (loading || !subscription) return null;

  const remaining = 100 - usagePercent;
  const isLow = remaining <= 20;
  const isCritical = remaining <= 10;

  const barColor = isCritical
    ? 'bg-red-500'
    : isLow
    ? 'bg-yellow-500'
    : 'bg-primary';

  const renewDate = new Date(subscription.renewal_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => navigate('/meu-plano')}
          className="hidden md:flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 hover:bg-accent/60 transition-colors group"
        >
          {/* Icon */}
          <div className="flex items-center gap-1">
            {isCritical ? (
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 animate-pulse" />
            ) : isLow ? (
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-400" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-primary" />
            )}
          </div>

          {/* Bar + numbers */}
          <div className="flex flex-col gap-0.5 min-w-[90px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{fmt(tokensAvailable)} restantes</span>
              <span className={`text-[10px] font-semibold ${isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                {remaining}%
              </span>
            </div>
            {/* Custom progress with colored bar */}
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.max(2, remaining)}%` }}
              />
            </div>
          </div>

          {/* Plan badge */}
          <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {planInfo.name}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-56 p-3">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between font-semibold">
            <span>Plano {planInfo.name}</span>
            <span className={isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-green-400'}>
              {isCritical ? 'Crítico' : isLow ? 'Baixo' : 'OK'}
            </span>
          </div>
          <div className="text-muted-foreground">
            <div>{subscription.tokens_used.toLocaleString('pt-BR')} usados</div>
            <div>{tokensAvailable.toLocaleString('pt-BR')} restantes</div>
            <div>{tokensTotal.toLocaleString('pt-BR')} total</div>
          </div>
          <div className="pt-1 border-t border-border/50 text-muted-foreground">
            Renova em {renewDate}
          </div>
          {isLow && (
            <div className={`flex items-center gap-1 font-medium ${isCritical ? 'text-red-400' : 'text-yellow-400'}`}>
              <TrendingUp className="h-3 w-3" />
              Clique para recarregar
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/* ── Mobile compact version for sidebar footer ── */
export function TokenWidgetCompact() {
  const navigate = useNavigate();
  const { tokensAvailable, usagePercent, planInfo, loading } = useSubscription();
  const { user } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);

  // So a conta master ve o plano/uso (ver comentario em TokenWidget).
  if (sellerLoading || isSeller) return null;
  if (loading) return null;

  const remaining = 100 - usagePercent;
  const isCritical = remaining <= 10;
  const isLow = remaining <= 20;

  return (
    <button
      onClick={() => navigate('/meu-plano')}
      className="w-full flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card/40 p-2.5 hover:bg-accent/40 transition-colors text-left"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isCritical ? (
            <AlertTriangle className="h-3 w-3 text-red-400 animate-pulse" />
          ) : (
            <Zap className="h-3 w-3 text-primary" />
          )}
          <span className="text-[10px] font-medium">{planInfo.name}</span>
        </div>
        <span className={`text-[10px] font-semibold ${isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-muted-foreground'}`}>
          {fmt(tokensAvailable)} left
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-primary'}`}
          style={{ width: `${Math.max(2, remaining)}%` }}
        />
      </div>
    </button>
  );
}
