// ============================================================================
// integrationAccess.tsx — Controle de acesso a Integracoes por plano
// ----------------------------------------------------------------------------
// Regra de produto: o plano BASICO so libera as integracoes essenciais do
// fluxo automotivo: BNDV (estoque) + Webhook (eventos). Todas as outras
// integracoes exigem Plano Pro ou superior.
//
// Pro / Pro Max (enterprise) => todas as integracoes liberadas.
//
// Uso:
//   const { isBasico, isLocked } = useIntegrationAccess();
//   if (isLocked('ga4')) { ...mostra cadeado... }
// ============================================================================

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Lock, Crown, Sparkles } from 'lucide-react';

// Integracoes liberadas no plano Basico. Todas as demais exigem Pro+.
// RevendaMais e fonte de ESTOQUE (alternativa ao BNDV) -> essencial do fluxo automotivo, liberada no basico.
export const BASICO_ALLOWED_INTEGRATIONS = new Set<string>(['bndv', 'revendamais', 'webhook']);

// Mensagem exata exibida no modal/tooltip de upgrade.
export const UPGRADE_MESSAGE =
  'Esta integracao esta disponivel no Plano Pro. Faca upgrade para acessar.';

export function useIntegrationAccess() {
  const { subscription, loading } = useSubscription();
  const planId = subscription?.plan_id ?? null;

  // Enquanto carrega NAO trava (evita "piscar" o cadeado). Sem assinatura
  // tratamos como basico (useSubscription cria basico por padrao).
  const isBasico = !loading && (planId === 'basico' || planId == null);

  const isLocked = useMemo(() => {
    return (integrationId: string) =>
      isBasico && !BASICO_ALLOWED_INTEGRATIONS.has(integrationId);
  }, [isBasico]);

  return { planId, loading, isBasico, isLocked };
}

// Badge "Plano Pro" (dourado) para sinalizar item bloqueado.
export function PlanProBadge({ className = '' }: { className?: string }) {
  return (
    <Badge
      className={`border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] ${className}`}
    >
      <Crown className="mr-1 h-3 w-3" />
      Plano Pro
    </Badge>
  );
}

// Overlay de cadeado para sobrepor num card bloqueado.
// O card pai precisa ter `position: relative` (classe `relative`).
export function ProLockOverlay({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <button
      type="button"
      onClick={onUpgrade}
      aria-label="Disponivel no Plano Pro - fazer upgrade"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5
                 rounded-[inherit] bg-background/60 backdrop-blur-[2px]
                 transition-colors hover:bg-background/45 cursor-pointer"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
        <Lock className="h-5 w-5" />
      </div>
      <span className="text-xs font-semibold text-foreground">Disponivel no Plano Pro</span>
      <span className="text-[11px] text-primary underline-offset-2 hover:underline">
        Fazer upgrade
      </span>
    </button>
  );
}

// Modal de upgrade. Reutilizado pelas duas abas de integracoes.
export function UpgradeProDialog({
  open,
  onOpenChange,
  integrationName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  integrationName?: string | null;
}) {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>
                {integrationName ? `${integrationName} - Plano Pro` : 'Recurso do Plano Pro'}
              </DialogTitle>
              <DialogDescription>Desbloqueie todas as integracoes</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{UPGRADE_MESSAGE}</p>

        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Sparkles className="h-4 w-4 text-amber-500" /> No Plano Pro voce libera:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Conexoes de anuncios (Meta, Google, TikTok, LinkedIn)</li>
            <li>Google Analytics 4, Google Sheets, Hotmart e Zapier</li>
            <li>Publicacao no Instagram e outras ferramentas</li>
          </ul>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Agora nao
          </Button>
          <Button
            className="gradient-primary text-primary-foreground"
            onClick={() => {
              onOpenChange(false);
              navigate('/meu-plano');
            }}
          >
            <Crown className="mr-2 h-4 w-4" /> Fazer upgrade
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
