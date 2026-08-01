import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Check, Clock3, MoonStar, Plus, ShieldCheck, Sun, Trash2, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  buildResponseWeekPreset,
  describeResponseDay,
  RESPONSE_WEEK_DAYS,
  type ResponseDayMode,
  type ResponseDayPlan,
  type ResponseTimeWindow,
  type ResponseWeekPlan,
  type ResponseWeekPreset,
} from '@/lib/agentResponseSchedule';

type AgentResponseScheduleEditorProps = {
  readonly enabled: boolean;
  readonly week: ResponseWeekPlan;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onWeekChange: (week: ResponseWeekPlan) => void;
};

const HALF_HOUR_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? '00' : '30';
  return `${String(hour).padStart(2, '0')}:${minute}`;
});

const MODE_OPTIONS: Array<{ value: ResponseDayMode; label: string }> = [
  { value: 'closed', label: 'Fechado' },
  { value: 'all_day', label: '24 horas' },
  { value: 'custom', label: 'Personalizado' },
];

const PRESETS: Array<{
  value: ResponseWeekPreset;
  label: string;
  description: string;
  icon: typeof Clock3;
}> = [
  {
    value: 'outside_business_hours',
    label: 'Fora do comercial',
    description: 'Noites nos dias úteis e fim de semana 24h',
    icon: MoonStar,
  },
  {
    value: 'business_hours',
    label: 'Horário comercial',
    description: 'Segunda a sábado, das 08h às 18h',
    icon: Sun,
  },
  {
    value: 'always',
    label: 'Sempre disponível',
    description: 'Todos os dias, 24 horas',
    icon: Zap,
  },
];

function minutes(value: string): number {
  if (value === '24:00') return 24 * 60;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function optionsWithCurrent(value: string, allowEndOfDay: boolean): string[] {
  const values = allowEndOfDay ? [...HALF_HOUR_OPTIONS, '24:00'] : [...HALF_HOUR_OPTIONS];
  if (!values.includes(value)) values.push(value);
  return values.sort((left, right) => minutes(left) - minutes(right));
}

function firstAvailableWindow(windows: readonly ResponseTimeWindow[]): ResponseTimeWindow | null {
  const occupied = windows
    .map((window) => ({ start: minutes(window.start), end: minutes(window.end) }))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.start < window.end)
    .sort((left, right) => left.start - right.start);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  for (const window of occupied) {
    if (window.start > cursor) gaps.push({ start: cursor, end: window.start });
    cursor = Math.max(cursor, window.end);
  }
  if (cursor < 24 * 60) gaps.push({ start: cursor, end: 24 * 60 });

  const gap = gaps
    .filter((candidate) => candidate.end - candidate.start >= 30)
    .sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
  if (!gap) return null;

  const format = (value: number) => value === 24 * 60
    ? '24:00'
    : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { start: format(gap.start), end: format(gap.end) };
}

function TimeSelect(props: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly allowEndOfDay?: boolean;
  readonly ariaLabel: string;
}) {
  return (
    <Select value={props.value} onValueChange={props.onValueChange}>
      <SelectTrigger className="h-9 min-w-[106px] bg-background/70" aria-label={props.ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {optionsWithCurrent(props.value, props.allowEndOfDay === true).map((value) => (
          <SelectItem key={value} value={value}>{value}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AgentResponseScheduleEditor({
  enabled,
  week,
  onEnabledChange,
  onWeekChange,
}: AgentResponseScheduleEditorProps) {
  const byDay = new Map(week.map((plan) => [plan.day, plan]));
  const planFor = (day: number): ResponseDayPlan => byDay.get(day) ?? { day, mode: 'closed', windows: [] };
  const openDays = RESPONSE_WEEK_DAYS.filter(({ value }) => planFor(value).mode !== 'closed').length;

  const replaceDay = (day: number, next: ResponseDayPlan) => {
    onWeekChange(RESPONSE_WEEK_DAYS.map(({ value }) => value === day ? next : planFor(value)));
  };

  const setMode = (day: number, mode: ResponseDayMode) => {
    const current = planFor(day);
    if (mode === 'closed') {
      replaceDay(day, { day, mode, windows: [] });
      return;
    }
    if (mode === 'all_day') {
      replaceDay(day, { day, mode, windows: [{ start: '00:00', end: '24:00' }] });
      return;
    }
    replaceDay(day, {
      day,
      mode,
      windows: current.mode === 'custom' && current.windows.length > 0
        ? current.windows
        : [{ start: '08:00', end: '18:00' }],
    });
  };

  const updateWindow = (day: number, index: number, patch: Partial<ResponseTimeWindow>) => {
    const current = planFor(day);
    replaceDay(day, {
      ...current,
      mode: 'custom',
      windows: current.windows.map((window, windowIndex) => windowIndex === index
        ? { ...window, ...patch }
        : window),
    });
  };

  const removeWindow = (day: number, index: number) => {
    const current = planFor(day);
    const windows = current.windows.filter((_, windowIndex) => windowIndex !== index);
    replaceDay(day, windows.length > 0
      ? { ...current, mode: 'custom', windows }
      : { day, mode: 'closed', windows: [] });
  };

  const addWindow = (day: number) => {
    const current = planFor(day);
    const candidate = firstAvailableWindow(current.windows);
    if (!candidate || current.windows.length >= 3) return;
    replaceDay(day, { ...current, mode: 'custom', windows: [...current.windows, candidate] });
  };

  const applyPreset = (preset: ResponseWeekPreset) => {
    onWeekChange(buildResponseWeekPreset(preset));
    if (!enabled) onEnabledChange(true);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-background/40">
      <div className="flex flex-col gap-4 border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-background/40 to-background px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="h-4 w-4" />
            </div>
            <div>
              <Label className="text-sm font-semibold">Horários de atendimento da IA</Label>
              <p className="text-xs text-muted-foreground">
                Defina quando este agente pode responder automaticamente.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-full border border-border/70 bg-background/80 px-3 py-2 sm:justify-start">
          <span className={cn('text-xs font-medium', enabled ? 'text-emerald-500' : 'text-muted-foreground')}>
            {enabled ? `${openDays} ${openDays === 1 ? 'dia ativo' : 'dias ativos'}` : 'Sem restrição'}
          </span>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} aria-label="Restringir respostas da IA por horário" />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {enabled ? (
          <motion.div
            key="schedule"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="space-y-3 border-b border-border/60 px-4 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">Comece por um modelo</p>
                <p className="mt-1 text-xs text-muted-foreground">O modelo só preenche a agenda. Você pode ajustar cada dia logo abaixo.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {PRESETS.map(({ value, label, description, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => applyPreset(value)}
                    className="group flex min-h-[72px] items-start gap-3 rounded-xl border border-border/70 bg-background/55 p-3 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>
                      <span className="block text-xs font-semibold text-foreground">{label}</span>
                      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-border/55 px-4">
              {RESPONSE_WEEK_DAYS.map((dayInfo) => {
                const plan = planFor(dayInfo.value);
                return (
                  <div key={dayInfo.value} className="py-3.5">
                    <div className="grid gap-3 lg:grid-cols-[140px_1fr] lg:items-start">
                      <div className="flex items-center justify-between gap-3 lg:block">
                        <div>
                          <p className="text-sm font-semibold">{dayInfo.label}</p>
                          <p className={cn(
                            'mt-0.5 text-[11px]',
                            plan.mode === 'closed' ? 'text-muted-foreground' : 'text-emerald-500',
                          )}>
                            {describeResponseDay(plan)}
                          </p>
                        </div>
                        {plan.mode !== 'closed' && <Check className="h-4 w-4 text-emerald-500 lg:hidden" />}
                      </div>

                      <div className="space-y-3">
                        <div className="inline-flex w-full rounded-lg border border-border/70 bg-muted/25 p-1 sm:w-auto">
                          {MODE_OPTIONS.map((mode) => (
                            <button
                              key={mode.value}
                              type="button"
                              onClick={() => setMode(dayInfo.value, mode.value)}
                              className={cn(
                                'min-h-8 flex-1 rounded-md px-3 text-[11px] font-medium transition-colors sm:flex-none',
                                plan.mode === mode.value
                                  ? 'bg-primary text-primary-foreground shadow-sm'
                                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                              )}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>

                        <AnimatePresence initial={false}>
                          {plan.mode === 'custom' && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.16 }}
                              className="space-y-2"
                            >
                              {plan.windows.map((window, index) => (
                                <div key={`${dayInfo.value}-${index}`} className="flex flex-wrap items-center gap-2">
                                  <TimeSelect
                                    value={window.start}
                                    onValueChange={(start) => updateWindow(dayInfo.value, index, { start })}
                                    ariaLabel={`Início de ${dayInfo.label}`}
                                  />
                                  <span className="text-xs text-muted-foreground">até</span>
                                  <TimeSelect
                                    value={window.end}
                                    onValueChange={(end) => updateWindow(dayInfo.value, index, { end })}
                                    allowEndOfDay
                                    ariaLabel={`Fim de ${dayInfo.label}`}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeWindow(dayInfo.value, index)}
                                    aria-label={`Remover intervalo de ${dayInfo.label}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                              {plan.windows.length < 3 && firstAvailableWindow(plan.windows) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1.5 px-2 text-xs text-primary"
                                  onClick={() => addWindow(dayInfo.value)}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Adicionar intervalo
                                </Button>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-start gap-2.5 border-t border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              <p>
                Esta agenda pausa somente as respostas automáticas da IA e os follow-ups T1/T2/T3.
                CRM, inbox e transferência manual continuam funcionando. Fuso: São Paulo (UTC−3).
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="unrestricted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2.5 px-4 py-3 text-xs text-muted-foreground"
          >
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>A IA pode responder em qualquer dia e horário. CRM, inbox e transferências permanecem disponíveis em todos os modos.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
