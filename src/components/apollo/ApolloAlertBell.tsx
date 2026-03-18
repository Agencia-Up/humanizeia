import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, X, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { useApolloEngine, ApolloAlert } from '@/hooks/useApolloEngine';
import { format } from 'date-fns';

export function ApolloAlertBell() {
  const { getUnreadAlertCount, markAlertsRead, loadDashboard, dashboardData, dismissAlert } = useApolloEngine();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getUnreadAlertCount().then(setUnreadCount);
    const interval = setInterval(() => getUnreadAlertCount().then(setUnreadCount), 30000);
    return () => clearInterval(interval);
  }, [getUnreadAlertCount]);

  const handleOpen = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      await loadDashboard();
      await markAlertsRead();
      setUnreadCount(0);
    }
  };

  const alerts = dashboardData?.alerts || [];

  const levelIcon = (level: string) => {
    switch (level) {
      case 'critical': return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default: return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-semibold">Alertas Apollo</h4>
          <p className="text-xs text-muted-foreground">{alerts.length} alerta(s) ativo(s)</p>
        </div>
        <ScrollArea className="max-h-80">
          {alerts.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum alerta ativo 🎉
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map(alert => (
                <div key={alert.id} className="px-4 py-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      {levelIcon(alert.level)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{alert.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                        {alert.current_value && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Atual: {alert.current_value} | Benchmark: {alert.benchmark_value}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {format(new Date(alert.created_at), 'dd/MM HH:mm')}
                        </p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => dismissAlert(alert.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
