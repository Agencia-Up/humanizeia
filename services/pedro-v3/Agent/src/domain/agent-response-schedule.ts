// Janela de resposta automática do agente.
//
// A configuração é por agente/tenant e é contexto operacional, não uma
// decisão comercial: fora da janela o bridge continua ingerindo e o CRM pode
// continuar vinculando o lead, mas o v3 não envia resposta nem follow-up.

export const AGENT_RESPONSE_TIMEZONE = "America/Sao_Paulo" as const;
export const DEFAULT_RESPONSE_DAYS = Object.freeze([1, 2, 3, 4, 5, 6] as const);

export type AgentResponseSchedule = {
  readonly enabled: boolean;
  readonly start: string;
  readonly end: string;
  /** ISO weekday: Monday=1 ... Sunday=7. The selected day is the window start day. */
  readonly days: readonly number[];
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

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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
  return Object.freeze({
    enabled,
    start: asTime(source.start ?? input.businessHoursStart, "08:00"),
    end: asTime(source.end ?? input.businessHoursEnd, "18:00"),
    days: Object.freeze([...asDays(source.days ?? input.businessHoursDays)]),
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

function parseMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function previousWeekday(day: number): number {
  return day === 1 ? 7 : day - 1;
}

/** Returns whether an automatic response may be sent at the supplied instant. */
export function isWithinAgentResponseSchedule(
  at: string | Date,
  schedule: AgentResponseSchedule | null | undefined,
): boolean {
  if (!schedule?.enabled) return true;
  const local = localParts(at);
  if (!local) return false;
  const days = schedule.days.length > 0 ? schedule.days : DEFAULT_RESPONSE_DAYS;
  const start = parseMinutes(schedule.start);
  const end = parseMinutes(schedule.end);

  // Equal endpoints mean the whole selected start day. This avoids silently
  // disabling a tenant that intentionally configured a full-day window.
  if (start === end) return days.includes(local.weekday);

  if (start < end) {
    return days.includes(local.weekday) && local.minutes >= start && local.minutes < end;
  }

  // Overnight: 18:00-08:00 selected on Sunday means Sunday 18:00 through
  // Monday 08:00. The previous selected day owns the after-midnight portion.
  return (days.includes(local.weekday) && local.minutes >= start)
    || (days.includes(previousWeekday(local.weekday)) && local.minutes < end);
}
