import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertOctagon, Info, TrendingUp, TrendingDown, CheckCircle } from 'lucide-react';
import type { Anomaly } from '@/hooks/useMetaDashboard';

interface AnomalyAlertsWidgetProps {
  anomalies: Anomaly[];
}

const iconMap = {
  danger: AlertOctagon,
  warning: AlertTriangle,
  info: Info,
};

const styleMap = {
  danger: {
    border: 'border-destructive/30',
    bg: 'bg-destructive/5',
    badge: 'bg-destructive/10 text-destructive border-destructive/20',
    icon: 'text-destructive',
    label: 'Crítico',
  },
  warning: {
    border: 'border-warning/30',
    bg: 'bg-warning/5',
    badge: 'bg-warning/10 text-warning border-warning/20',
    icon: 'text-warning',
    label: 'Atenção',
  },
  info: {
    border: 'border-primary/30',
    bg: 'bg-primary/5',
    badge: 'bg-primary/10 text-primary border-primary/20',
    icon: 'text-primary',
    label: 'Destaque',
  },
};

export function AnomalyAlertsWidget({ anomalies }: AnomalyAlertsWidgetProps) {
  if (anomalies.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center gap-3 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
            <CheckCircle className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Tudo normal! ✨</p>
            <p className="text-xs text-muted-foreground">
              Nenhuma variação significativa detectada em relação ao período anterior.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Alertas de Performance
          <Badge variant="outline" className="ml-auto text-xs">
            {anomalies.length} {anomalies.length === 1 ? 'alerta' : 'alertas'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <AnimatePresence>
          {anomalies.map((anomaly, i) => {
            const style = styleMap[anomaly.type];
            const Icon = iconMap[anomaly.type];
            const TrendIcon = anomaly.changePercent > 0 ? TrendingUp : TrendingDown;

            return (
              <motion.div
                key={anomaly.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className={`flex items-start gap-3 rounded-lg border p-3 ${style.border} ${style.bg}`}
              >
                <div className={`mt-0.5 shrink-0 ${style.icon}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{anomaly.title}</p>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${style.badge}`}>
                      {style.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{anomaly.description}</p>
                </div>
                <div className={`flex items-center gap-1 shrink-0 text-xs font-medium ${style.icon}`}>
                  <TrendIcon className="h-3 w-3" />
                  <span>{anomaly.changePercent > 0 ? '+' : ''}{anomaly.changePercent.toFixed(0)}%</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
