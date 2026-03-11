import { RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MetaRefreshIndicatorProps {
  isRefreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  className?: string;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min atrás`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atrás`;
  return `${Math.floor(diffHours / 24)}d atrás`;
}

export function MetaRefreshIndicator({
  isRefreshing,
  lastUpdated,
  onRefresh,
  className,
}: MetaRefreshIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      {lastUpdated && (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {isRefreshing ? 'Atualizando...' : `Atualizado ${formatTimeAgo(lastUpdated)}`}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
      </Button>
    </div>
  );
}
