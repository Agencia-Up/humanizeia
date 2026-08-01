// Janela de resposta automática do agente.
//
// A configuração é por agente/tenant e é contexto operacional, não uma
// decisão comercial: fora da janela o bridge continua ingerindo e o CRM pode
// continuar vinculando o lead, mas o v3 não envia resposta nem follow-up.

export const AGENT_RESPONSE_TIMEZONE = "America/Sao_Paulo" as const;
export const DEFAULT_RESPONSE_DAYS = Object.freeze([1, 2, 3, 4, 5, 6] as const);

export type AgentResponseWindow = {
  /** Minute of the local day. Inclusive. */
  readonly startMinute: number;
  /** Minute of the local day. Exclusive. 1440 represents the end of the day. */
  readonly endMinute: number;
};

export type AgentResponseDaySchedule = {
  /** ISO weekday: Monday=1 ... Sunday=7. */
  readonly weekday: number;
  readonly windows: readonly AgentResponseWindow[];
};

export type AgentResponseSchedule = {
  readonly enabled: boolean;
  /** Calendar-day windows in America/Sao_Paulo. Overnight V1 windows are split across two days. */
  readonly weekly: readonly AgentResponseDaySchedule[];
  readonly timezone: typeof AGENT_RESPONSE_TIMEZONE;
};

type ScheduleObject = Record<string, unknown>;

function objectOf(value: unknown): ScheduleObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ScheduleObject
    : null;
}

function asTime(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.slice(0, 5))
    ? value.slice(0, 5)
    : fallback;
}

function asDays(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return DEFAULT_RESPONSE_DAYS;
  const days = [...new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 7))]
    .sort((a, b) => a - b);
  return days.length > 0 ? days : DEFAULT_RESPONSE_DAYS;
}

function asWeekday(value: unknown): number | null {
  const weekday = Number(value);
  return Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? weekday : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function timeToMinutes(value: unknown, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === "24:00") return 24 * 60;
  if (typeof value !== "string") return null;
  const normalized = value.slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? parseMinutes(normalized) : null;
}

function nextWeekday(day: number): number {
  return day === 7 ? 1 : day + 1;
}

function normalizeWindows(windows: readonly AgentResponseWindow[]): readonly AgentResponseWindow[] {
  const sorted = windows
    .filter((window) => Number.isInteger(window.startMinute)
      && Number.isInteger(window.endMinute)
      && window.startMinute >= 0
      && window.endMinute <= 24 * 60
      && window.startMinute < window.endMinute)
    .map((window) => ({ ...window }))
    .sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);

  const merged: AgentResponseWindow[] = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && current.startMinute <= previous.endMinute) {
      merged[merged.length - 1] = Object.freeze({
        startMinute: previous.startMinute,
        endMinute: Math.max(previous.endMinute, current.endMinute),
      });
    } else {
      merged.push(Object.freeze(current));
    }
  }
  return Object.freeze(merged);
}

function emptyWeek(): Map<number, AgentResponseWindow[]> {
  return new Map(Array.from({ length: 7 }, (_, index) => [index + 1, []]));
}

function freezeWeek(byDay: ReadonlyMap<number, readonly AgentResponseWindow[]>): readonly AgentResponseDaySchedule[] {
  return Object.freeze(Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    return Object.freeze({
      weekday,
      windows: normalizeWindows(byDay.get(weekday) ?? []),
    });
  }));
}

function legacyWeek(source: ScheduleObject, input: {
  readonly businessHoursStart?: unknown;
  readonly businessHoursEnd?: unknown;
  readonly businessHoursDays?: unknown;
}): readonly AgentResponseDaySchedule[] {
  const start = parseMinutes(asTime(source.start ?? input.businessHoursStart, "08:00"));
  const end = parseMinutes(asTime(source.end ?? input.businessHoursEnd, "18:00"));
  const days = asDays(source.days ?? input.businessHoursDays);
  const byDay = emptyWeek();
  const addWindow = (weekday: number, startMinute: number, endMinute: number): void => {
    byDay.get(weekday)?.push({ startMinute, endMinute });
  };

  for (const weekday of days) {
    if (start === end) {
      addWindow(weekday, 0, 24 * 60);
    } else if (start < end) {
      addWindow(weekday, start, end);
    } else {
      // V1 semantics: the selected day owned the overnight window. Split it
      // into calendar-day ranges so V2 can express each day independently.
      addWindow(weekday, start, 24 * 60);
      addWindow(nextWeekday(weekday), 0, end);
    }
  }
  return freezeWeek(byDay);
}

function v2Week(value: unknown): readonly AgentResponseDaySchedule[] {
  const byDay = emptyWeek();
  if (!Array.isArray(value)) return freezeWeek(byDay);

  for (const rawDay of value) {
    const day = objectOf(rawDay);
    const weekday = asWeekday(day?.day ?? day?.weekday);
    if (!day || weekday == null) continue;
    if (day.mode === "closed") {
      byDay.set(weekday, []);
      continue;
    }
    if (day.mode === "all_day") {
      byDay.set(weekday, [{ startMinute: 0, endMinute: 24 * 60 }]);
      continue;
    }
    const windows: AgentResponseWindow[] = [];
    if (Array.isArray(day.windows)) {
      for (const rawWindow of day.windows) {
        const window = objectOf(rawWindow);
        const startMinute = timeToMinutes(window?.start);
        const endMinute = timeToMinutes(window?.end, true);
        if (startMinute != null && endMinute != null && startMinute < endMinute) {
          windows.push({ startMinute, endMinute });
        }
      }
    }
    byDay.set(weekday, windows);
  }
  return freezeWeek(byDay);
}

/**
 * Normalizes both the new JSON schedule and the legacy three-column fields.
 * The JSON schedule wins when present; existing agents therefore keep their
 * old behavior until the portal saves the new day selection.
 */
export function normalizeAgentResponseSchedule(input: {
  readonly automationRules?: unknown;
  readonly businessHoursOnly?: unknown;
  readonly businessHoursStart?: unknown;
  readonly businessHoursEnd?: unknown;
  readonly businessHoursDays?: unknown;
}): AgentResponseSchedule {
  const rules = objectOf(input.automationRules);
  const configured = objectOf(rules?.response_schedule);
  const legacyEnabled = asBool(input.businessHoursOnly, false);
  const source = configured ?? {};
  const enabled = configured
    ? asBool(source.enabled, legacyEnabled)
    : legacyEnabled;
  const isV2 = source.version === 2 || Array.isArray(source.weekly);
  return Object.freeze({
    enabled,
    weekly: isV2 ? v2Week(source.weekly) : legacyWeek(source, input),
    timezone: AGENT_RESPONSE_TIMEZONE,
  });
}

function localParts(at: string | Date): { weekday: number; minutes: number } | null {
  const date = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENT_RESPONSE_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekdayText = parts.find((part) => part.type === "weekday")?.value;
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekday = weekdayText ? weekdays[weekdayText] : undefined;
  return weekday && Number.isInteger(hour) && Number.isInteger(minute)
    ? { weekday, minutes: hour * 60 + minute }
    : null;
}

/** Returns whether an automatic response may be sent at the supplied instant. */
export function isWithinAgentResponseSchedule(
  at: string | Date,
  schedule: AgentResponseSchedule | null | undefined,
): boolean {
  if (!schedule?.enabled) return true;
  const local = localParts(at);
  if (!local) return false;
  const day = schedule.weekly.find((candidate) => candidate.weekday === local.weekday);
  return day?.windows.some((window) => (
    local.minutes >= window.startMinute && local.minutes < window.endMinute
  )) === true;
}
