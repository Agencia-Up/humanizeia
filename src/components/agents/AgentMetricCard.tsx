import { TrendingUp, TrendingDown } from 'lucide-react';

interface AgentMetricCardProps {
  label: string;
  value: string;
  trend?: string;
  color: string;
  icon?: React.ReactNode;
}

export function AgentMetricCard({ label, value, trend, color, icon }: AgentMetricCardProps) {
  const isPositive = trend && !trend.startsWith('-');

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4 relative overflow-hidden group hover:-translate-y-0.5 transition-all duration-300">
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        {icon && <div className="text-muted-foreground/50">{icon}</div>}
      </div>
      <p className="text-2xl font-heading font-bold text-foreground">{value}</p>
      {trend && (
        <div className={`flex items-center gap-1 mt-1 text-xs ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{trend}</span>
        </div>
      )}
    </div>
  );
}
