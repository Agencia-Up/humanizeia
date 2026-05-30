import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem('token-alert-dismissed') || null;
  } catch {
    return null;
  }
}

/**
 * Faixa de aviso no topo do painel quando os tokens de IA estão acabando
 * (≤10% do plano) ou já acabaram (≤0). Espelha o mesmo limite usado no
 * backend (consume_user_tokens) e o mesmo tom do aviso enviado no WhatsApp.
 *
 * É dispensável: ao fechar, fica escondida até o fim da sessão do navegador.
 * Se a situação piorar (de "acabando" para "acabou"), uma nova faixa aparece,
 * porque a chave de dispensa muda junto com o tipo do alerta.
 */
export function TokenAlertBanner() {
  const navigate = useNavigate();
  const { subscription, tokensAvailable, tokensTotal, loading } = useSubscription();
  // Lê a dispensa já na inicialização pra não "piscar" a faixa antes de esconder.
  const [dismissedKind, setDismissedKind] = useState<string | null>(readDismissed);

  if (loading || !subscription || tokensTotal <= 0) return null;

  const depleted = tokensAvailable <= 0;
  const low = !depleted && tokensAvailable <= tokensTotal * 0.1;
  if (!depleted && !low) return null;

  const kind = depleted ? 'depleted' : 'low';
  if (dismissedKind === kind) return null;

  const dismiss = () => {
    setDismissedKind(kind);
    try {
      sessionStorage.setItem('token-alert-dismissed', kind);
    } catch {
      /* ignora */
    }
  };

  const styles = depleted
    ? {
        wrap: 'border-red-500/40 bg-red-500/10 text-red-200',
        icon: 'text-red-400',
        btn: 'bg-red-500 hover:bg-red-600 text-white',
      }
    : {
        wrap: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-100',
        icon: 'text-yellow-400',
        btn: 'bg-yellow-500 hover:bg-yellow-600 text-black',
      };

  const title = depleted
    ? 'Seus tokens de IA acabaram'
    : 'Seus tokens de IA estão acabando';

  const message = depleted
    ? 'O Pedro continua atendendo seus leads normalmente, mas o consumo já passou do limite do seu plano. Recarregue para manter o controle de uso em dia.'
    : `Restam menos de 10% (${tokensAvailable.toLocaleString('pt-BR')} de ${tokensTotal.toLocaleString('pt-BR')}). Recarregue para não ficar sem antes da renovação.`;

  return (
    <div className={`flex items-center gap-3 border-b px-4 py-2.5 lg:px-6 ${styles.wrap}`}>
      <AlertTriangle className={`h-4 w-4 shrink-0 ${styles.icon} ${depleted ? 'animate-pulse' : ''}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold leading-tight sm:text-sm">{title}</p>
        <p className="truncate text-[11px] opacity-90 sm:text-xs">{message}</p>
      </div>
      <button
        onClick={() => navigate('/meu-plano')}
        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${styles.btn}`}
      >
        Recarregar
      </button>
      <button
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
