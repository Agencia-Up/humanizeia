import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useOrchestration, type AgentStatus } from '@/hooks/useOrchestration';
import {
  CheckCircle2, Clock, Loader2, XCircle, Play, ThumbsUp, ThumbsDown,
  RefreshCw, ChevronRight, AlertCircle, Zap,
} from 'lucide-react';

interface OrchestrationPanelProps {
  briefingId: string | null;
  clientName: string;
}

function AgentStatusCard({ agent }: { agent: AgentStatus }) {
  const statusConfig = {
    waiting: { icon: <Clock className="h-4 w-4 text-muted-foreground" />, color: 'bg-muted/30 border-border/40', textColor: 'text-muted-foreground', label: 'Aguardando' },
    running: { icon: <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />, color: 'bg-blue-500/10 border-blue-500/30', textColor: 'text-blue-400', label: 'Executando...' },
    completed: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, color: 'bg-emerald-500/10 border-emerald-500/30', textColor: 'text-emerald-400', label: 'Concluído' },
    failed: { icon: <XCircle className="h-4 w-4 text-red-400" />, color: 'bg-red-500/10 border-red-500/30', textColor: 'text-red-400', label: 'Falhou' },
    pending_approval: { icon: <AlertCircle className="h-4 w-4 text-amber-400" />, color: 'bg-amber-500/10 border-amber-500/30', textColor: 'text-amber-400', label: 'Aguardando aprovação' },
  };

  const config = statusConfig[agent.status];

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${config.color}`}>
      <div className="text-2xl">{agent.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{agent.name}</span>
          <span className={`text-[10px] font-medium ${config.textColor}`}>{config.label}</span>
        </div>
        {agent.output && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{agent.output}</p>
        )}
      </div>
      {config.icon}
    </div>
  );
}

export function OrchestrationPanel({ briefingId, clientName }: OrchestrationPanelProps) {
  const { state, loading, startOrchestration, approveAndContinue, rejectAndRevise, refreshStatus, reset } = useOrchestration();
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const isIdle = state.stage === 'idle';
  const isRunning = ['daniel_strategy', 'paulo_copy', 'jose_campaign'].includes(state.stage) && state.status === 'in_progress';
  const isApprovalGate = state.stage === 'approval_gate';
  const isCompleted = state.stage === 'completed';
  const isFailed = state.stage === 'failed';

  const handleStart = () => {
    if (!briefingId) return;
    startOrchestration(briefingId);
  };

  const handleApprove = () => {
    approveAndContinue();
  };

  const handleReject = () => {
    if (!rejectFeedback.trim()) return;
    rejectAndRevise(rejectFeedback);
    setRejectFeedback('');
    setShowRejectForm(false);
  };

  // Stage label
  const stageLabels: Record<string, string> = {
    idle: 'Pronto para iniciar',
    daniel_strategy: 'Daniel montando estratégia...',
    paulo_copy: 'Paulo e Maria trabalhando em paralelo...',
    approval_gate: '⏳ Aguardando aprovação do Salomão',
    jose_campaign: 'José configurando campanha...',
    completed: '✅ Campanha pronta!',
    failed: '❌ Erro no processo',
  };

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              Fluxo Organizado de Etapas
            </CardTitle>
            {state.taskId && (
              <Button variant="ghost" size="sm" onClick={refreshStatus} className="h-7 text-xs gap-1.5 text-muted-foreground">
                <RefreshCw className="h-3 w-3" /> Atualizar
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[10px]">{clientName}</Badge>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{stageLabels[state.stage]}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Agent pipeline visual */}
          <div className="space-y-2">
            {state.agents.map((agent, idx) => (
              <div key={agent.agent}>
                <AgentStatusCard agent={agent} />
                {idx < state.agents.length - 1 && (
                  <div className="flex justify-center py-0.5">
                    <div className={`w-0.5 h-3 rounded-full transition-colors ${
                      agent.status === 'completed' ? 'bg-emerald-500/40' : 'bg-border/40'
                    }`} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <Separator className="my-3" />

          {isIdle && (
            <Button
              onClick={handleStart}
              disabled={!briefingId || loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Iniciar Fluxo Organizado de Etapas
            </Button>
          )}

          {!briefingId && isIdle && (
            <p className="text-xs text-center text-muted-foreground">
              Selecione um cliente/briefing para iniciar o pipeline
            </p>
          )}

          {isRunning && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span>Agentes trabalhando em tempo real...</span>
            </div>
          )}

          {isApprovalGate && !showRejectForm && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <p className="text-xs text-amber-400 font-medium">
                  👑 Paulo e Maria concluíram. Revise o resultado e aprove para o José configurar a campanha no Meta Ads.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleApprove}
                  disabled={loading}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                >
                  <ThumbsUp className="h-4 w-4" /> Aprovar → José
                </Button>
                <Button
                  onClick={() => setShowRejectForm(true)}
                  variant="outline"
                  className="flex-1 border-red-500/40 text-red-400 hover:bg-red-500/10 gap-2"
                >
                  <ThumbsDown className="h-4 w-4" /> Revisar
                </Button>
              </div>
            </div>
          )}

          {isApprovalGate && showRejectForm && (
            <div className="space-y-3">
              <Textarea
                value={rejectFeedback}
                onChange={(e) => setRejectFeedback(e.target.value)}
                placeholder="Descreva o que precisa ser ajustado na copy ou no criativo..."
                className="text-sm min-h-[80px] bg-background/50 border-border/60"
              />
              <div className="flex gap-2">
                <Button onClick={handleReject} disabled={!rejectFeedback.trim()} variant="destructive" className="flex-1 gap-2" size="sm">
                  <ThumbsDown className="h-3.5 w-3.5" /> Enviar Feedback
                </Button>
                <Button onClick={() => setShowRejectForm(false)} variant="ghost" size="sm" className="text-muted-foreground">
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {isCompleted && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
                <p className="text-emerald-400 font-semibold text-sm">🎉 Fluxo organizado de etapas concluído com sucesso!</p>
                <p className="text-xs text-muted-foreground mt-1">Todos os agentes executaram. Campanha pronta para veiculação.</p>
              </div>
              <Button onClick={reset} variant="outline" className="w-full gap-2" size="sm">
                <RefreshCw className="h-4 w-4" /> Novo Fluxo de Etapas
              </Button>
            </div>
          )}

          {isFailed && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30">
                <p className="text-red-400 text-xs font-medium">Erro: {state.error}</p>
              </div>
              <Button onClick={reset} variant="outline" className="w-full gap-2" size="sm">
                <RefreshCw className="h-4 w-4" /> Tentar Novamente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Execution Log */}
      {state.executions.length > 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Log de Execuções</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-48">
              <div className="px-4 pb-4 space-y-2">
                {state.executions.map((exec: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground/60 shrink-0 font-mono mt-0.5">
                      {new Date(exec.executed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="font-medium text-foreground/80">{exec.agent_name}</span>
                    <span className="text-muted-foreground">→ {exec.action}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
