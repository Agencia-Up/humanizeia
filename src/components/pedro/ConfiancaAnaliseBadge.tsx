import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

// Fase 3 — mostra o quão confiável é a análise, em linguagem simples pro gestor.
// Regras (aprovadas): 'alta' => "Análise completa"; 'media'/'baixa' => "Análise
// parcial" (+ motivo curto/tooltip); NULL/ausente => NADA (não rotula análise
// antiga sem cálculo). Só consome o campo já exposto — não recalcula.
export function ConfiancaAnaliseBadge({
  confianca,
  motivo,
  className,
  showMotivo = true,
}: {
  confianca?: string | null;
  motivo?: string | null;
  className?: string;
  showMotivo?: boolean;
}) {
  if (!confianca) return null; // NULL/legado: sem badge

  const parcial = confianca === 'media' || confianca === 'baixa';

  if (parcial) {
    return (
      <Badge
        variant="outline"
        title={motivo || 'Faltou parte da conversa ou do áudio — leia com cautela.'}
        className={`max-w-full gap-1 border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 ${className || ''}`}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate">
          Análise parcial{showMotivo && motivo ? ` · ${motivo}` : ''}
        </span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      title="Conversa completa do cliente e do vendedor."
      className={`gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ${className || ''}`}
    >
      <ShieldCheck className="h-3 w-3 shrink-0" />
      Análise completa
    </Badge>
  );
}
