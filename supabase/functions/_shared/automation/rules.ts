// ════════════════════════════════════════════════════════════════════════════
// Regras de automacao do Pedro (follow-up + transferencia), configuraveis por
// agente via portal (wa_ai_agents.automation_rules JSONB). Fonte UNICA de verdade
// + defaults. Modulo PURO (sem dependencias externas) para ser importado tanto
// pelas edge functions com client inline (cron-lead-followup, transfer-timeout-
// checker) quanto pelo bundle do pedro-webhook-v2.
//
// REGRA DE OURO: agente SEM automation_rules (NULL) = comportamento LEGADO
// (follow-up 5/8/12, 3o transfere, timeout 15min, janela de repasse fixa).
// `window` so e considerado configurado quando o objeto existe; senao usa a
// janela legada definida neste modulo (seg-sab; domingo sem repasse).
// ════════════════════════════════════════════════════════════════════════════

export type FollowupRules = {
  enabled: boolean;
  t1_min: number;
  t2_min: number;
  t3_min: number;
  t3_transfers: boolean;
};

export type RepassTimeWindow = { start: string; end: string };

export type RepassDaySchedule = {
  day: number; // ISO: segunda=1 ... domingo=7
  mode: "closed" | "all_day" | "custom";
  windows: RepassTimeWindow[];
};

export type LegacyRepassWindow = { enabled: boolean; start: string; end: string };

export type WeeklyRepassWindow = {
  version: 2;
  enabled: boolean;
  timezone: "America/Sao_Paulo";
  weekly: RepassDaySchedule[];
};

export type RepassWindow = LegacyRepassWindow | WeeklyRepassWindow;

export type TransferRules = {
  enabled: boolean;
  seller_response_min: number;
  window: RepassWindow | null; // null = janela legada
};

export type AutomationRules = {
  followup: FollowupRules;
  transfer: TransferRules;
  configured: boolean; // true quando o agente tem automation_rules salvo
};

export const DEFAULT_FOLLOWUP: FollowupRules = {
  enabled: true,
  t1_min: 5,
  t2_min: 8,
  t3_min: 12,
  t3_transfers: true,
};

// seller_response_min default = 10. Toda transferencia nova persiste o prazo
// efetivo em confirmation_timeout_at; os workers devem obedecer esse mesmo
// relogio para nao divergirem depois de um rearm fora da janela comercial.
export const DEFAULT_TRANSFER: TransferRules = {
  enabled: true,
  seller_response_min: 10,
  window: null,
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asTime(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim()) ? value.trim() : fallback;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseStrictTime(value: unknown, allowEndOfDay = false): number | null {
  if (allowEndOfDay && value === "24:00") return 24 * 60;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToHHMM(value: number): string {
  if (value === 24 * 60) return "24:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function normalizeDayWindows(value: unknown): RepassTimeWindow[] {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((candidate) => {
      const raw = isObject(candidate) ? candidate : null;
      const start = parseStrictTime(raw?.start);
      const end = parseStrictTime(raw?.end, true);
      return start != null && end != null && start < end ? { start, end } : null;
    })
    .filter((window): window is { start: number; end: number } => window != null)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const current of parsed) {
    const previous = merged[merged.length - 1];
    if (previous && current.start <= previous.end) previous.end = Math.max(previous.end, current.end);
    else merged.push({ ...current });
  }
  return merged.map(({ start, end }) => ({ start: minutesToHHMM(start), end: minutesToHHMM(end) }));
}

function normalizeWeeklyWindow(raw: Record<string, any>): WeeklyRepassWindow {
  const byDay = new Map<number, RepassDaySchedule>();
  if (Array.isArray(raw.weekly)) {
    for (const candidate of raw.weekly) {
      const entry = isObject(candidate) ? candidate : null;
      const day = Number(entry?.day);
      if (!entry || !Number.isInteger(day) || day < 1 || day > 7) continue;
      if (entry.mode === "closed") {
        byDay.set(day, { day, mode: "closed", windows: [] });
        continue;
      }
      if (entry.mode === "all_day") {
        byDay.set(day, { day, mode: "all_day", windows: [{ start: "00:00", end: "24:00" }] });
        continue;
      }
      const windows = normalizeDayWindows(entry.windows);
      byDay.set(day, windows.length > 0
        ? { day, mode: "custom", windows }
        : { day, mode: "closed", windows: [] });
    }
  }
  return {
    version: 2,
    enabled: asBool(raw.enabled, true),
    timezone: "America/Sao_Paulo",
    weekly: Array.from({ length: 7 }, (_, index) => byDay.get(index + 1) ?? {
      day: index + 1,
      mode: "closed" as const,
      windows: [],
    }),
  };
}

function normalizeRepassWindow(raw: unknown): RepassWindow | null {
  if (!isObject(raw)) return null;
  if (raw.version === 2 || Array.isArray(raw.weekly)) return normalizeWeeklyWindow(raw);
  return {
    enabled: asBool(raw.enabled, true),
    start: asTime(raw.start, "10:11"),
    end: asTime(raw.end, "19:29"),
  };
}

/**
 * Normaliza o JSON cru de wa_ai_agents.automation_rules para uma estrutura
 * completa e segura, aplicando defaults legados quando faltar qualquer campo.
 * Tambem CORRIGE silenciosamente tempos fora de ordem (t1<t2<t3) para nunca
 * bugar o cron.
 */
export function resolveAutomationRules(raw: unknown): AutomationRules {
  const root = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  const f = root?.followup && typeof root.followup === "object" ? root.followup : {};
  const t = root?.transfer && typeof root.transfer === "object" ? root.transfer : {};

  let t1 = asInt(f.t1_min, DEFAULT_FOLLOWUP.t1_min, 1, 1440);
  let t2 = asInt(f.t2_min, DEFAULT_FOLLOWUP.t2_min, 1, 1440);
  let t3 = asInt(f.t3_min, DEFAULT_FOLLOWUP.t3_min, 1, 1440);
  if (t2 <= t1) t2 = t1 + 1;
  if (t3 <= t2) t3 = t2 + 1;

  const w = normalizeRepassWindow(t.window);

  return {
    followup: {
      enabled: asBool(f.enabled, DEFAULT_FOLLOWUP.enabled),
      t1_min: t1,
      t2_min: t2,
      t3_min: t3,
      t3_transfers: asBool(f.t3_transfers, DEFAULT_FOLLOWUP.t3_transfers),
    },
    transfer: {
      enabled: asBool(t.enabled, DEFAULT_TRANSFER.enabled),
      seller_response_min: asInt(t.seller_response_min, DEFAULT_TRANSFER.seller_response_min, 1, 1440),
      window: w,
    },
    configured: !!root,
  };
}

/** Minutos do dia (0-1439) em Brasilia (UTC-3) para um Date UTC. */
export function brasiliaMinutesOfDay(dt: Date): number {
  const utcMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  return ((utcMin - 180) + 1440) % 1440;
}

function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * O `now` (UTC) esta dentro da janela de repasse CONFIGURADA do agente?
 * - window === null  -> retorna null (caller deve usar a janela LEGADA).
 * - window.enabled === false -> sempre true (repassa a qualquer hora).
 * - window.enabled === true  -> true somente entre start e end (horario Brasilia).
 */
export function isWithinConfiguredWindow(window: RepassWindow | null, now: Date): boolean | null {
  if (!window) return null;
  if (!window.enabled) return true;
  if ("weekly" in window) {
    const plan = window.weekly.find((entry) => entry.day === brasiliaIsoWeekday(now));
    if (!plan || plan.mode === "closed") return false;
    if (plan.mode === "all_day") return true;
    const current = brasiliaMinutesOfDay(now);
    return plan.windows.some(({ start, end }) => {
      const startMinute = parseStrictTime(start);
      const endMinute = parseStrictTime(end, true);
      return startMinute != null && endMinute != null && current >= startMinute && current < endMinute;
    });
  }
  if (brasiliaWeekday(now) === 0) return false;
  const min = brasiliaMinutesOfDay(now);
  return min >= parseHHMM(window.start) && min <= parseHHMM(window.end);
}

function brasiliaParts(dt: Date): { year: number; month: number; day: number; weekday: number } {
  const shifted = new Date(dt.getTime() - 3 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function brasiliaWeekday(dt: Date): number {
  return brasiliaParts(dt).weekday;
}

function brasiliaIsoWeekday(dt: Date): number {
  const weekday = brasiliaWeekday(dt);
  return weekday === 0 ? 7 : weekday;
}

export function legacyTransferWindow(now: Date): { start: number; end: number } {
  return brasiliaWeekday(now) === 6
    ? { start: 10 * 60 + 11, end: 18 * 60 + 29 }
    : { start: 10 * 60 + 11, end: 19 * 60 + 29 };
}

/** Janela efetiva do agente: customizada quando habilitada, legada nos demais casos. */
export function isWithinTransferWindow(window: RepassWindow | null, now: Date): boolean {
  if (window && "weekly" in window && window.enabled) return isWithinConfiguredWindow(window, now) === true;
  if (brasiliaWeekday(now) === 0) return false;
  if (window?.enabled === true && "start" in window) return isWithinConfiguredWindow(window, now) === true;
  const min = brasiliaMinutesOfDay(now);
  const legacy = legacyTransferWindow(now);
  return min >= legacy.start && min <= legacy.end;
}

/** Próxima abertura em UTC; domingo sempre salta para segunda-feira. */
function weeklyStarts(window: WeeklyRepassWindow, isoDay: number): number[] {
  const plan = window.weekly.find((entry) => entry.day === isoDay);
  if (!plan || plan.mode === "closed") return [];
  if (plan.mode === "all_day") return [0];
  return plan.windows
    .map(({ start }) => parseStrictTime(start))
    .filter((minute): minute is number => minute != null)
    .sort((left, right) => left - right);
}

export function nextTransferWindowStart(window: RepassWindow | null, now: Date): Date {
  if (window && "weekly" in window && window.enabled) {
    const current = brasiliaParts(now);
    const currentMinute = brasiliaMinutesOfDay(now);
    const localMidnightUtc = Date.UTC(current.year, current.month, current.day, 3, 0, 0, 0);
    for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
      const candidateDay = new Date(localMidnightUtc + daysAhead * 24 * 60 * 60 * 1000);
      for (const start of weeklyStarts(window, brasiliaIsoWeekday(candidateDay))) {
        if (daysAhead === 0 && start <= currentMinute) continue;
        return new Date(localMidnightUtc + (daysAhead * 24 * 60 + start) * 60 * 1000);
      }
    }
    // Agenda V2 sem nenhuma abertura valida: falha fechada. O worker nao deve
    // inventar expediente nem cair na janela legada por causa de JSON incompleto.
    return new Date("2099-12-31T23:00:00.000Z");
  }
  const current = brasiliaParts(now);
  const start = window?.enabled === true && "start" in window ? parseHHMM(window.start) : legacyTransferWindow(now).start;
  const currentMin = brasiliaMinutesOfDay(now);
  let daysAhead = current.weekday === 0 ? 1 : currentMin >= start ? 1 : 0;
  if (current.weekday === 6 && currentMin >= start && !isWithinTransferWindow(window, now)) daysAhead = 2;
  const localMidnightUtc = Date.UTC(current.year, current.month, current.day, 3, 0, 0, 0);
  let result = new Date(localMidnightUtc + (daysAhead * 24 * 60 + start) * 60 * 1000);
  if (brasiliaWeekday(result) === 0) result = new Date(result.getTime() + 24 * 60 * 60 * 1000);
  return result;
}

export function rearmTransferAtNextWindow(window: RepassWindow | null, now: Date, sellerResponseMin: number): Date {
  return new Date(nextTransferWindowStart(window, now).getTime() + Math.max(1, sellerResponseMin) * 60 * 1000);
}

/** Prazo autoritativo; registros legados caem em created_at + regra. */
export function effectiveTransferDeadline(
  transfer: { created_at: string; confirmation_timeout_at?: string | null },
  sellerResponseMin: number,
): Date {
  const persisted = typeof transfer.confirmation_timeout_at === "string"
    ? Date.parse(transfer.confirmation_timeout_at)
    : Number.NaN;
  if (Number.isFinite(persisted)) return new Date(persisted);

  const created = Date.parse(transfer.created_at);
  const safeCreated = Number.isFinite(created) ? created : 0;
  return new Date(safeCreated + Math.max(1, sellerResponseMin) * 60 * 1000);
}
