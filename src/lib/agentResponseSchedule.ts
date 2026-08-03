export const AGENT_RESPONSE_TIMEZONE = 'America/Sao_Paulo' as const;

export const RESPONSE_WEEK_DAYS = [
  { value: 1, shortLabel: 'Seg', label: 'Segunda-feira' },
  { value: 2, shortLabel: 'Ter', label: 'Terça-feira' },
  { value: 3, shortLabel: 'Qua', label: 'Quarta-feira' },
  { value: 4, shortLabel: 'Qui', label: 'Quinta-feira' },
  { value: 5, shortLabel: 'Sex', label: 'Sexta-feira' },
  { value: 6, shortLabel: 'Sáb', label: 'Sábado' },
  { value: 7, shortLabel: 'Dom', label: 'Domingo' },
] as const;

export type ResponseDayMode = 'closed' | 'all_day' | 'custom';

export type ResponseTimeWindow = {
  readonly start: string;
  readonly end: string;
};

export type ResponseDayPlan = {
  readonly day: number;
  readonly mode: ResponseDayMode;
  readonly windows: readonly ResponseTimeWindow[];
};

export type ResponseWeekPlan = readonly ResponseDayPlan[];
export type ResponseWeekPreset = 'business_hours' | 'outside_business_hours' | 'always';

type UnknownObject = Record<string, unknown>;

function objectOf(value: unknown): UnknownObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownObject
    : null;
}

function validDay(value: unknown): number | null {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 7 ? day : null;
}

function timeToMinutes(value: unknown, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === '24:00') return 24 * 60;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToTime(minutes: number): string {
  if (minutes === 24 * 60) return '24:00';
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function normalizeWindows(windows: readonly ResponseTimeWindow[]): ResponseTimeWindow[] {
  const parsed = windows
    .map((window) => ({
      start: timeToMinutes(window.start),
      end: timeToMinutes(window.end, true),
    }))
    .filter((window): window is { start: number; end: number } => (
      window.start != null && window.end != null && window.start < window.end
    ))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const current of parsed) {
    const previous = merged[merged.length - 1];
    if (previous && current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged.map((window) => ({
    start: minutesToTime(window.start),
    end: minutesToTime(window.end),
  }));
}

function planFromWindows(day: number, windows: readonly ResponseTimeWindow[]): ResponseDayPlan {
  const normalized = normalizeWindows(windows);
  if (normalized.length === 0) return { day, mode: 'closed', windows: [] };
  if (normalized.length === 1 && normalized[0].start === '00:00' && normalized[0].end === '24:00') {
    return { day, mode: 'all_day', windows: normalized };
  }
  return { day, mode: 'custom', windows: normalized };
}

function emptyWeek(): ResponseDayPlan[] {
  return RESPONSE_WEEK_DAYS.map(({ value }) => ({ day: value, mode: 'closed', windows: [] }));
}

function nextDay(day: number): number {
  return day === 7 ? 1 : day + 1;
}

function legacyDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5, 6];
  const days = [...new Set(value.map(validDay).filter((day): day is number => day != null))].sort((a, b) => a - b);
  return days.length > 0 ? days : [1, 2, 3, 4, 5, 6];
}

function legacyWeek(startValue: unknown, endValue: unknown, daysValue: unknown): ResponseDayPlan[] {
  const start = timeToMinutes(typeof startValue === 'string' ? startValue.slice(0, 5) : null) ?? 8 * 60;
  const end = timeToMinutes(typeof endValue === 'string' ? endValue.slice(0, 5) : null) ?? 18 * 60;
  const selectedDays = legacyDays(daysValue);
  const byDay = new Map<number, ResponseTimeWindow[]>(emptyWeek().map((plan) => [plan.day, []]));
  const add = (day: number, from: number, to: number) => {
    byDay.get(day)?.push({ start: minutesToTime(from), end: minutesToTime(to) });
  };

  for (const day of selectedDays) {
    if (start === end) {
      add(day, 0, 24 * 60);
    } else if (start < end) {
      add(day, start, end);
    } else {
      add(day, start, 24 * 60);
      add(nextDay(day), 0, end);
    }
  }

  return RESPONSE_WEEK_DAYS.map(({ value }) => planFromWindows(value, byDay.get(value) ?? []));
}

function v2Week(weekly: unknown): ResponseDayPlan[] {
  const plans = new Map<number, ResponseDayPlan>();
  if (Array.isArray(weekly)) {
    for (const rawEntry of weekly) {
      const entry = objectOf(rawEntry);
      const day = validDay(entry?.day);
      if (!entry || day == null) continue;
      if (entry.mode === 'closed') {
        plans.set(day, { day, mode: 'closed', windows: [] });
        continue;
      }
      if (entry.mode === 'all_day') {
        plans.set(day, { day, mode: 'all_day', windows: [{ start: '00:00', end: '24:00' }] });
        continue;
      }
      const windows = Array.isArray(entry.windows)
        ? entry.windows.map(objectOf).filter((window): window is UnknownObject => window != null).map((window) => ({
          start: String(window.start ?? ''),
          end: String(window.end ?? ''),
        }))
        : [];
      plans.set(day, planFromWindows(day, windows));
    }
  }
  return RESPONSE_WEEK_DAYS.map(({ value }) => plans.get(value) ?? { day: value, mode: 'closed', windows: [] });
}

export function readResponseWeekPlan(input: {
  readonly responseSchedule?: unknown;
  readonly legacyStart?: unknown;
  readonly legacyEnd?: unknown;
  readonly legacyDays?: unknown;
}): ResponseDayPlan[] {
  const schedule = objectOf(input.responseSchedule);
  if (schedule && (schedule.version === 2 || Array.isArray(schedule.weekly))) {
    return v2Week(schedule.weekly);
  }
  return legacyWeek(
    schedule?.start ?? input.legacyStart,
    schedule?.end ?? input.legacyEnd,
    schedule?.days ?? input.legacyDays,
  );
}

export function serializeResponseScheduleV2(
  enabled: boolean,
  week: ResponseWeekPlan,
): UnknownObject {
  const byDay = new Map(week.map((plan) => [plan.day, plan]));
  return {
    version: 2,
    enabled,
    timezone: AGENT_RESPONSE_TIMEZONE,
    weekly: RESPONSE_WEEK_DAYS.map(({ value }) => {
      const plan = byDay.get(value) ?? { day: value, mode: 'closed' as const, windows: [] };
      if (plan.mode === 'closed') return { day: value, mode: 'closed', windows: [] };
      if (plan.mode === 'all_day') {
        return { day: value, mode: 'all_day', windows: [{ start: '00:00', end: '24:00' }] };
      }
      return { day: value, mode: 'custom', windows: normalizeWindows(plan.windows) };
    }),
  };
}

export function validateResponseWeekPlan(
  enabled: boolean,
  week: ResponseWeekPlan,
  activityLabel = 'atendimento',
): string[] {
  if (!enabled) return [];
  const errors: string[] = [];
  let openDays = 0;

  for (const dayInfo of RESPONSE_WEEK_DAYS) {
    const plan = week.find((candidate) => candidate.day === dayInfo.value);
    if (!plan || plan.mode === 'closed') continue;
    openDays += 1;
    if (plan.mode === 'all_day') continue;
    if (plan.windows.length === 0) {
      errors.push(`${dayInfo.label}: adicione pelo menos um intervalo.`);
      continue;
    }
    const parsed = plan.windows.map((window) => ({
      start: timeToMinutes(window.start),
      end: timeToMinutes(window.end, true),
    }));
    if (parsed.some((window) => window.start == null || window.end == null || window.start >= window.end)) {
      errors.push(`${dayInfo.label}: há um intervalo inválido.`);
      continue;
    }
    const sorted = [...parsed] as Array<{ start: number; end: number }>;
    sorted.sort((left, right) => left.start - right.start);
    if (sorted.some((window, index) => index > 0 && window.start < sorted[index - 1].end)) {
      errors.push(`${dayInfo.label}: os intervalos não podem se sobrepor.`);
    }
  }

  if (openDays === 0) errors.unshift(`Defina pelo menos um dia de ${activityLabel} ou desligue a restrição de horário.`);
  return errors;
}

export function buildResponseWeekPreset(preset: ResponseWeekPreset): ResponseDayPlan[] {
  if (preset === 'always') {
    return RESPONSE_WEEK_DAYS.map(({ value }) => ({
      day: value,
      mode: 'all_day',
      windows: [{ start: '00:00', end: '24:00' }],
    }));
  }

  if (preset === 'outside_business_hours') {
    return RESPONSE_WEEK_DAYS.map(({ value }) => value <= 5
      ? {
        day: value,
        mode: 'custom',
        windows: [{ start: '00:00', end: '08:30' }, { start: '17:00', end: '24:00' }],
      }
      : {
        day: value,
        mode: 'all_day',
        windows: [{ start: '00:00', end: '24:00' }],
      });
  }

  return RESPONSE_WEEK_DAYS.map(({ value }) => value <= 6
    ? { day: value, mode: 'custom', windows: [{ start: '08:00', end: '18:00' }] }
    : { day: value, mode: 'closed', windows: [] });
}

export function describeResponseDay(plan: ResponseDayPlan): string {
  if (plan.mode === 'closed') return 'Fechado';
  if (plan.mode === 'all_day') return '24 horas';
  return plan.windows.map((window) => `${window.start}–${window.end}`).join(' · ');
}
