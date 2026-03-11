import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';
import { MetaDatePreset } from '@/hooks/useMetaDashboard';

interface DateRangeFilterProps {
  value: MetaDatePreset;
  onChange: (range: MetaDatePreset) => void;
}

const options: { value: MetaDatePreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
];

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5">
        {options.map((opt) => (
          <Button
            key={opt.value}
            variant={value === opt.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onChange(opt.value)}
            className={`h-7 px-3 text-xs ${
              value === opt.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
