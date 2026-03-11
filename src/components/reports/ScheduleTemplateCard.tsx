import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface ScheduleTemplateCardProps {
  template: any;
  onToggleSchedule: (id: string, ativo: boolean) => void;
  onChangeTime: (id: string, time: string) => void;
  onToggleDay: (id: string, days: number[]) => void;
}

export function ScheduleTemplateCard({ template, onToggleSchedule, onChangeTime, onToggleDay }: ScheduleTemplateCardProps) {
  const dias: number[] = template.dias_envio || [1, 2, 3, 4, 5];

  const handleDayToggle = (day: number) => {
    const newDays = dias.includes(day) ? dias.filter(d => d !== day) : [...dias, day];
    onToggleDay(template.id, newDays);
  };

  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{template.nome}</p>
          {template.descricao && <p className="text-xs text-muted-foreground">{template.descricao}</p>}
        </div>
        <Switch
          checked={template.agendamento_ativo}
          onCheckedChange={(checked) => onToggleSchedule(template.id, checked)}
        />
      </div>

      {template.agendamento_ativo && (
        <>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <Input
              type="time"
              value={template.horario_envio || '08:00'}
              onChange={e => onChangeTime(template.id, e.target.value)}
              className="w-28"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {DAYS.map((day, idx) => (
              <Badge
                key={idx}
                variant={dias.includes(idx) ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => handleDayToggle(idx)}
              >
                {day}
              </Badge>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
