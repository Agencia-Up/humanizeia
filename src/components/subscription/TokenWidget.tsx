import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Zap, AlertTriangle, TrendingUp, Infinity as InfinityIcon, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';

function fmt(n: number) {
  return n.toLocaleString('pt-BR');
}

// Cota ILIMITADA (BYOK / ponte 999999): o cliente usa a propria chave de IA e
// paga o provedor, entao a "cota de atendimentos" nao se aplica — mostra
// "Ilimitado" em vez de numero/percentual (que ficava negativo).
const UNLIMITED_AT = 999999;

// Puxa o saldo da chave OpenAI (mesmo RPC do Meu Plano). Se o cliente informou
// o saldo, o widget mostra conversas restantes em vez de "ilimitado".
// `enabled` evita buscar pra vendedor/sem assinatura.
function useSaldoOpenAI(enabled: boolean) {
  const [saldo, setSaldo] = useState<any>(null);
  useEffect(() => {
    if (!enabled) { setSaldo(null); return; }
    let alive = true;
    (async () => {
      try {
        const { data } = await (supabase as any).rpc('cliente_saldo_ia');
        if (alive) setSaldo(data || null);
      } catch { if (alive) setSaldo(null); }
    })();
    return () => { alive = false; };
  }, [enabled]);
  return saldo;
}

export function TokenWidget() {
  const navigate = useNavigate();
  const { subscription, tokensAvailable, tokensTotal, usagePercent, planInfo, loading } = useSubscription();
  const { user } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);
  const saldo = useSaldoOpenAI(!sellerLoading && !isSeller && !!subscription);

  // O plano (ex.: 150 atendimentos) e da CONTA MASTER que contratou. Vendedores
  // vinculados nao compram credito nem rodam a IA (ela so existe na master),
  // entao o widget de uso nunca aparece pra eles.
  if (sellerLoading || isSeller) return null;
  if (loading || !subscription) return null;

  // Prioridade: se informou o saldo da OpenAI, mostra conversas; senao,
  // "ilimitado" (cota ponte 999999); senao, o velho modelo de atendimentos.
  const hasSaldo = !!saldo?.tem_saldo;
  const conversasRestantes = hasSaldo ? Number(saldo.conversas_restantes ?? 0) : 0;
  const conversasTotal = hasSaldo ? Number(saldo.conversas_total ?? 0) : 0;
  const isUnlimited = (subscription.tokens_included ?? 0) >= UNLIMITED_AT;
  const showInfinity = isUnlimited && !hasSaldo;
  const safeAvailable = Math.max(0, tokensAvailable);
  const remaining = hasSaldo
    ? (conversasTotal > 0 ? Math.max(0, Math.min(100, (conversasRestantes / conversasTotal) * 100)) : 100)
    : isUnlimited ? 100 : Math.max(0, 100 - usagePercent);
  const isLow = hasSaldo ? remaining <= 20 : (!isUnlimited && remaining <= 20);
  const isCritical = hasSaldo ? remaining <= 10 : (!isUnlimited && remaining <= 10);

  const barColor = isCritical
    ? 'bg-red-500'
    : isLow
    ? 'bg-yellow-500'
    : (hasSaldo || showInfinity)
    ? 'bg-emerald-400'
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
            ) : hasSaldo ? (
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
            ) : showInfinity ? (
              <InfinityIcon className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-primary" />
            )}
          </div>

          {/* Bar + numbers */}
          <div className="flex flex-col gap-0.5 min-w-[90px]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {hasSaldo
                  ? `≈ ${fmt(conversasRestantes)} conversas`
                  : showInfinity ? 'Conversas ilimitadas' : `${fmt(safeAvailable)} restantes`}
              </span>
              {!hasSaldo && !showInfinity && (
                <span className={`text-[10px] font-semibold ${isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                  {remaining}%
                </span>
              )}
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
            <span className={(hasSaldo || showInfinity) ? 'text-emerald-400' : isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-green-400'}>
              {hasSaldo ? (isCritical ? 'Crítico' : isLow ? 'Baixo' : 'OK') : showInfinity ? 'Ilimitado' : isCritical ? 'Crítico' : isLow ? 'Baixo' : 'OK'}
            </span>
          </div>
          <div className="text-muted-foreground">
            {hasSaldo ? (
              <>
                <div className="text-emerald-400 font-semibold">≈ {fmt(conversasRestantes)} conversas restantes</div>
                <div>{fmt(conversasTotal)} conversas adicionadas por este saldo</div>
                <div>Atualize o saldo em Meu Plano.</div>
              </>
            ) : showInfinity ? (
              <div>Conversas ilimitadas — você usa sua própria chave de IA. Informe seu saldo em Meu Plano para ver quantas conversas tem.</div>
            ) : (
              <>
                <div>{subscription.tokens_used.toLocaleString('pt-BR')} atendimentos usados</div>
                <div>{safeAvailable.toLocaleString('pt-BR')} restantes</div>
                <div>{tokensTotal.toLocaleString('pt-BR')} no total</div>
              </>
            )}
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
  const { subscription, tokensAvailable, usagePercent, planInfo, loading } = useSubscription();
  const { user } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);
  const saldo = useSaldoOpenAI(!sellerLoading && !isSeller && !!subscription);

  // So a conta master ve o plano/uso (ver comentario em TokenWidget).
  if (sellerLoading || isSeller) return null;
  if (loading) return null;

  const hasSaldo = !!saldo?.tem_saldo;
  const conversasRestantes = hasSaldo ? Number(saldo.conversas_restantes ?? 0) : 0;
  const conversasTotal = hasSaldo ? Number(saldo.conversas_total ?? 0) : 0;
  const isUnlimited = (subscription?.tokens_included ?? 0) >= UNLIMITED_AT;
  const showInfinity = isUnlimited && !hasSaldo;
  const safeAvailable = Math.max(0, tokensAvailable);
  const remaining = hasSaldo
    ? (conversasTotal > 0 ? Math.max(0, Math.min(100, (conversasRestantes / conversasTotal) * 100)) : 100)
    : isUnlimited ? 100 : Math.max(0, 100 - usagePercent);
  const isCritical = hasSaldo ? remaining <= 10 : (!isUnlimited && remaining <= 10);
  const isLow = hasSaldo ? remaining <= 20 : (!isUnlimited && remaining <= 20);

  return (
    <button
      onClick={() => navigate('/meu-plano')}
      className="w-full flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card/40 p-2.5 hover:bg-accent/40 transition-colors text-left"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isCritical ? (
            <AlertTriangle className="h-3 w-3 text-red-400 animate-pulse" />
          ) : hasSaldo ? (
            <Coins className="h-3 w-3 text-emerald-400" />
          ) : showInfinity ? (
            <InfinityIcon className="h-3 w-3 text-emerald-400" />
          ) : (
            <Zap className="h-3 w-3 text-primary" />
          )}
          <span className="text-[10px] font-medium">{planInfo.name}</span>
        </div>
        <span className={`text-[10px] font-semibold ${(hasSaldo || showInfinity) ? 'text-emerald-400' : isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-muted-foreground'}`}>
          {hasSaldo ? `≈ ${fmt(conversasRestantes)} conversas` : showInfinity ? 'Ilimitado' : `${fmt(safeAvailable)} restantes`}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : (hasSaldo || showInfinity) ? 'bg-emerald-400' : 'bg-primary'}`}
          style={{ width: `${Math.max(2, remaining)}%` }}
        />
      </div>
    </button>
  );
}
