import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Brain, User, Zap, MessageSquare, CheckCircle2, PlayCircle, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AgentExecution } from '../types';

interface ExecutionTimelineProps {
  executions: AgentExecution[];
  isLoading?: boolean;
}

const ExecutionTimeline = ({ executions, isLoading }: ExecutionTimelineProps) => {
  if (isLoading) return <div className="flex items-center justify-center p-12 text-muted-foreground"><Loader2 className="animate-spin w-8 h-8" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" />
          Log de Execução em Tempo Real
        </h3>
        <Badge variant="outline" className="text-[10px] bg-white/5 border-white/10 text-yellow-500">
          Sincronizado
        </Badge>
      </div>

      <ScrollArea className="h-[500px] pr-4">
        <div className="relative space-y-8 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-yellow-500/50 before:via-purple-500/30 before:to-transparent pb-8">
          {executions.length > 0 ? (
            executions.map((exec, idx) => (
              <div key={exec.id || idx} className="relative flex items-start gap-4 group">
                <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black shadow-lg transition-all duration-300 group-hover:scale-110 border-yellow-500/30 text-yellow-400">
                  <Brain className="h-5 w-5" />
                </div>
                
                <div className="flex-1 space-y-2 bg-white/5 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white uppercase">
                        Agente {exec.agent_id || 'SALOMÃO'}
                      </span>
                      <Badge className="bg-white/10 text-[10px] h-4 px-1.5">{exec.status}</Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(exec.created_at).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase font-bold text-yellow-500/70">Prompt de Entrada</p>
                      <p className="text-xs text-muted-foreground leading-relaxed italic">
                        "{exec.prompt_input}"
                      </p>
                    </div>

                    <div className="space-y-1 p-3 bg-black/40 rounded-lg border border-white/5">
                      <p className="text-[10px] uppercase font-bold text-green-500/70">Resposta Consolidada</p>
                      <p className="text-xs text-white leading-relaxed font-mono">
                        {exec.response_output || 'Aguardando resposta do agente...'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
             <div className="flex flex-col items-center justify-center pt-24 space-y-4 opacity-40">
                <div className="w-16 h-16 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                  <Zap className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground italic text-center px-12">
                  Inicie uma tarefa master para visualizar a orquestração entre agentes em tempo real.
                </p>
              </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ExecutionTimeline;
