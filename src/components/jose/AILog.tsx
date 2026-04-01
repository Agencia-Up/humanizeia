import { Brain, Lightbulb, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

export type AILogEntryType = 'analyzing' | 'insight' | 'action' | 'warning' | 'success';

export interface AILogEntry {
  id: string;
  type: AILogEntryType;
  message: string;
  timestamp: Date;
}

const typeConfig: Record<AILogEntryType, { icon: JSX.Element; color: string; label: string }> = {
  analyzing: {
    icon: <Brain className="h-3.5 w-3.5" />,
    color: 'text-blue-400',
    label: 'Analisando',
  },
  insight: {
    icon: <Lightbulb className="h-3.5 w-3.5" />,
    color: 'text-amber-400',
    label: 'Insight',
  },
  action: {
    icon: <Zap className="h-3.5 w-3.5" />,
    color: 'text-primary',
    label: 'Ação',
  },
  warning: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-red-400',
    label: 'Alerta',
  },
  success: {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    color: 'text-emerald-400',
    label: 'Sucesso',
  },
};

interface AILogProps {
  entries: AILogEntry[];
  isAnalyzing?: boolean;
}

export function AILog({ entries, isAnalyzing = false }: AILogProps) {
  if (entries.length === 0) return null;

  return (
    <Card className="border-primary/20 bg-card/50">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          JOSÉ — Log de Pensamento IA
          {isAnalyzing && (
            <span className="flex items-center gap-1.5 ml-auto">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span className="text-xs text-primary font-normal">Processando...</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <ScrollArea className="h-[200px] pr-3">
          <div className="space-y-2">
            {entries.map((entry) => {
              const config = typeConfig[entry.type];
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 rounded-md bg-muted/30 border border-border/50 px-3 py-2 text-xs animate-in fade-in slide-in-from-left-2 duration-300"
                >
                  <div className={`mt-0.5 flex-shrink-0 ${config.color}`}>
                    {config.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1 py-0 h-4 ${config.color} border-current/30`}
                      >
                        {config.label}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                        {entry.timestamp.toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">{entry.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
