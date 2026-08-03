import { describe, expect, it } from 'vitest';
import {
  buildResponseWeekPreset,
  readResponseWeekPlan,
  serializeResponseScheduleV2,
  validateResponseWeekPlan,
} from './agentResponseSchedule';

describe('agentResponseSchedule', () => {
  it('converte a agenda noturna legada sem alterar a semântica', () => {
    const week = readResponseWeekPlan({
      responseSchedule: { enabled: true, start: '17:00', end: '08:30', days: [1, 2, 3, 4, 5] },
    });

    expect(week[0]).toMatchObject({ day: 1, windows: [{ start: '17:00', end: '24:00' }] });
    expect(week[1]).toMatchObject({
      day: 2,
      windows: [{ start: '00:00', end: '08:30' }, { start: '17:00', end: '24:00' }],
    });
    expect(week[5]).toMatchObject({ day: 6, windows: [{ start: '00:00', end: '08:30' }] });
    expect(week[6]).toMatchObject({ day: 7, mode: 'closed' });
  });

  it('lê e serializa a agenda semanal v2 sem perder os sete dias', () => {
    const expected = buildResponseWeekPreset('outside_business_hours');
    const encoded = serializeResponseScheduleV2(true, expected);
    const decoded = readResponseWeekPlan({ responseSchedule: encoded });

    expect(encoded).toMatchObject({ version: 2, enabled: true, timezone: 'America/Sao_Paulo' });
    expect(decoded).toEqual(expected);
  });

  it('migra a janela antiga do rodízio para segunda a sábado sem abrir domingo', () => {
    const week = readResponseWeekPlan({
      responseSchedule: { enabled: true, start: '09:11', end: '18:29' },
      legacyDays: [1, 2, 3, 4, 5, 6],
    });

    expect(week.slice(0, 6).every((day) => (
      day.mode === 'custom'
      && day.windows[0]?.start === '09:11'
      && day.windows[0]?.end === '18:29'
    ))).toBe(true);
    expect(week[6]).toMatchObject({ day: 7, mode: 'closed', windows: [] });
  });

  it('preset fora do comercial deixa sábado e domingo em 24 horas', () => {
    const week = buildResponseWeekPreset('outside_business_hours');
    expect(week[0].windows).toEqual([
      { start: '00:00', end: '08:30' },
      { start: '17:00', end: '24:00' },
    ]);
    expect(week[5].mode).toBe('all_day');
    expect(week[6].mode).toBe('all_day');
  });

  it('rejeita agenda ligada sem nenhum dia aberto', () => {
    const closed = buildResponseWeekPreset('business_hours').map((day) => ({ ...day, mode: 'closed' as const, windows: [] }));
    expect(validateResponseWeekPlan(true, closed)[0]).toContain('pelo menos um dia');
  });

  it('rejeita intervalos sobrepostos e aceita intervalos adjacentes', () => {
    const base = buildResponseWeekPreset('business_hours');
    const overlap = base.map((day) => day.day === 1
      ? { ...day, windows: [{ start: '08:00', end: '12:00' }, { start: '11:30', end: '18:00' }] }
      : day);
    const adjacent = base.map((day) => day.day === 1
      ? { ...day, windows: [{ start: '08:00', end: '12:00' }, { start: '12:00', end: '18:00' }] }
      : day);

    expect(validateResponseWeekPlan(true, overlap)).toContain('Segunda-feira: os intervalos não podem se sobrepor.');
    expect(validateResponseWeekPlan(true, adjacent)).toEqual([]);
  });

  it('restrição desligada não bloqueia o salvamento de uma agenda vazia', () => {
    expect(validateResponseWeekPlan(false, [])).toEqual([]);
  });
});
