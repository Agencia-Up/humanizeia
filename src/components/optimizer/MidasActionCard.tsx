import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Pause, Play, TrendingUp, TrendingDown, Bell, Zap,
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';

export interface MidasAction {
  id: string;
  type: 'pause' | 'activate' | 'increase_budget' | 'decrease_budget' | 'notify';
  campaignId: string;
  campaignName: string;
  reason: string;
  impact: string;
  percentage?: number;
  priority: 'high' | 'medium' | 'low';
}

interface MidasActionCardProps {
  action: MidasAction;
  onExecute: (action: MidasAction) => Promise<void>;
}

const actionMeta: Record<MidasAction['type'], { icon: typeof Pause; label: string; color: string; bgColor: string }> = {
  pause: { icon: Pause, label: 'Pausar Campanha', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  activate: { icon: Play, label: 'Ativar Campanha', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  increase_budget: { icon: TrendingUp, label: 'Aumentar Orçamento', color: 'text-primary', bgColor: 'bg-primary/20' },
  decrease_budget: { icon: TrendingDown, label: 'Reduzir Orçamento', color: 'text-destructive', bgColor: 'bg-destructive/20' },
  notify: { icon: Bell, label: 'Monitorar', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
};

const priorityColors: Record<string, string> = {
  high: 'border-destructive/50 text-destructive',
  medium: 'border-amber-500/50 text-amber-400',
  low: 'border-muted-foreground/50 text-muted-foreground',
};

export function MidasActionCard({ action, onExecute }: MidasActionCardProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [expanded, setExpanded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const meta = actionMeta[action.type];
  const Icon = meta.icon;

  const handleExecute = async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      await onExecute(action);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Erro ao executar ação');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-lg border transition-all ${
        status === 'success' ? 'border-green-500/40 bg-green-500/5' :
        status === 'error' ? 'border-destructive/40 bg-destructive/5' :
        'border-border/50 bg-card/50'
      }`}
    >
      <div className="p-3 flex items-center gap-3">
        {/* Icon */}
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.bgColor}`}>
          {status === 'success' ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : status === 'error' ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Icon className={`h-4 w-4 ${meta.color}`} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{meta.label}</p>
            <Badge variant="outline" className={`text-[10px] h-4 ${priorityColors[action.priority]}`}>
              {action.priority === 'high' ? '🔴 Alta' : action.priority === 'medium' ? '🟡 Média' : '🟢 Baixa'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">{action.campaignName}</p>
        </div>

        {/* Action Button */}
        <div className="flex items-center gap-1.5 shrink-0">
          {status === 'idle' && (
            <Button
              size="sm"
              onClick={handleExecute}
              className="h-7 text-xs gap-1 gradient-primary text-primary-foreground"
            >
              <Zap className="h-3 w-3" />
              Aplicar
            </Button>
          )}
          {status === 'loading' && (
            <Button size="sm" disabled className="h-7 text-xs gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Aplicando...
            </Button>
          )}
          {status === 'success' && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
              ✅ Aplicado
            </Badge>
          )}
          {status === 'error' && (
            <Button size="sm" variant="outline" onClick={handleExecute} className="h-7 text-xs gap-1 border-destructive/50 text-destructive">
              Tentar novamente
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-2">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Motivo</p>
                <p className="text-xs">{action.reason}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Impacto Estimado</p>
                <p className="text-xs">{action.impact}</p>
              </div>
              {action.percentage && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Ajuste</p>
                  <p className="text-xs font-mono">{action.type === 'increase_budget' ? '+' : '-'}{action.percentage}%</p>
                </div>
              )}
              {status === 'error' && errorMsg && (
                <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {errorMsg}
                </div>
              )}
              {status === 'success' && (
                <div className="rounded-md bg-green-500/10 p-2 text-xs text-green-400">
                  ✅ Ação executada com sucesso no Gerenciador de Anúncios
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function MidasActionList({
  actions,
  onExecute,
}: {
  actions: MidasAction[];
  onExecute: (action: MidasAction) => Promise<void>;
}) {
  if (!actions.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <h4 className="font-semibold text-sm">Ações Recomendadas pelo MIDAS</h4>
        <Badge variant="secondary" className="text-xs">{actions.length}</Badge>
      </div>
      <div className="space-y-2">
        {actions.map((action) => (
          <MidasActionCard key={action.id} action={action} onExecute={onExecute} />
        ))}
      </div>
    </div>
  );
}
