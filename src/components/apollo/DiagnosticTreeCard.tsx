import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitBranch, ArrowRight, Lightbulb, XCircle, CheckCircle } from 'lucide-react';

export interface DiagnosticNode {
  problem: string;
  diagnosis: string;
  cause: string;
  severity: 'high' | 'medium' | 'low';
  recommendations: string[];
  resolved?: boolean;
}

interface DiagnosticTreeCardProps {
  diagnostics: DiagnosticNode[];
}

const severityConfig = {
  high: { badge: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Alta' },
  medium: { badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30', label: 'Média' },
  low: { badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Baixa' },
};

export function DiagnosticTreeCard({ diagnostics }: DiagnosticTreeCardProps) {
  if (diagnostics.length === 0) return null;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          Diagnósticos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {diagnostics.map((diag, i) => {
          const config = severityConfig[diag.severity];
          return (
            <div key={i} className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
              <div className="flex items-start gap-2">
                {diag.resolved ? (
                  <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{diag.problem}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 ${config.badge}`}>{config.label}</Badge>
                    {diag.resolved && (
                      <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Resolvido</Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <span>Causa</span>
                    <ArrowRight className="h-3 w-3" />
                    <span className="text-foreground">{diag.cause}</span>
                  </div>

                  <div className="space-y-1">
                    {diag.recommendations.map((rec, j) => (
                      <div key={j} className="flex items-start gap-1.5 text-xs">
                        <Lightbulb className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{rec}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
