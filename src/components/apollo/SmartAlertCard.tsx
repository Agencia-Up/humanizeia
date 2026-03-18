import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingDown, TrendingUp, Bell, ChevronRight } from 'lucide-react';

export interface SmartAlert {
  id: string;
  level: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  description: string;
  metric?: string;
  currentValue?: string;
  benchmark?: string;
  deviation?: string;
  actions?: string[];
  timestamp: Date;
}

const levelConfig = {
  critical: { emoji: '🔴', bg: 'border-red-500/30 bg-red-500/5', badge: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Crítico' },
  warning: { emoji: '🟠', bg: 'border-amber-500/30 bg-amber-500/5', badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30', label: 'Alerta' },
  info: { emoji: '🟡', bg: 'border-yellow-500/30 bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', label: 'Atenção' },
  success: { emoji: '🟢', bg: 'border-emerald-500/30 bg-emerald-500/5', badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'Normal' },
};

interface SmartAlertCardProps {
  alerts: SmartAlert[];
  onAction?: (alertId: string, action: string) => void;
}

export function SmartAlertCard({ alerts, onAction }: SmartAlertCardProps) {
  if (alerts.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex flex-col items-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <Bell className="h-6 w-6 text-emerald-400" />
          </div>
          <p className="mt-3 text-sm font-medium text-emerald-400">Tudo saudável</p>
          <p className="text-xs text-muted-foreground">Nenhum alerta no momento</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Alertas Inteligentes
          <Badge className="ml-auto bg-muted text-foreground">{alerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.slice(0, 5).map((alert) => {
          const config = levelConfig[alert.level];
          return (
            <div key={alert.id} className={`rounded-lg border p-3 ${config.bg}`}>
              <div className="flex items-start gap-2">
                <span className="text-sm mt-0.5">{config.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground">{alert.title}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 ${config.badge}`}>{config.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{alert.description}</p>
                  {alert.metric && (
                    <div className="flex items-center gap-3 mt-1.5 text-xs">
                      <span>
                        {alert.metric}: <strong className="text-foreground">{alert.currentValue}</strong>
                      </span>
                      {alert.benchmark && <span className="text-muted-foreground">Benchmark: {alert.benchmark}</span>}
                      {alert.deviation && (
                        <span className="flex items-center gap-0.5 text-red-400">
                          <TrendingDown className="h-3 w-3" />
                          {alert.deviation}
                        </span>
                      )}
                    </div>
                  )}
                  {alert.actions && alert.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {alert.actions.map((action, i) => (
                        <Button
                          key={i}
                          size="sm"
                          variant={i === 0 ? 'default' : 'outline'}
                          className="h-6 text-[11px] px-2"
                          onClick={() => onAction?.(alert.id, action)}
                        >
                          {action}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
