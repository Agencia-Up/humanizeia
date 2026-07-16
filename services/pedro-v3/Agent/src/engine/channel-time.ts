export type BrazilChannelTime = {
  readonly timeZone: "America/Sao_Paulo";
  readonly localDateTime: string | null;
  readonly period: "manha" | "tarde" | "noite" | null;
};

/** Fato de canal para a LLM e para validacoes factuais; nunca redige uma saudacao. */
export function getBrazilChannelTime(now: string): BrazilChannelTime {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return { timeZone: "America/Sao_Paulo", localDateTime: null, period: null };
  const timeZone = "America/Sao_Paulo" as const;
  const localDateTime = new Intl.DateTimeFormat("pt-BR", {
    timeZone, dateStyle: "full", timeStyle: "short",
  }).format(date);
  const hourPart = new Intl.DateTimeFormat("pt-BR", {
    timeZone, hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour");
  const hour = hourPart ? Number(hourPart.value) : NaN;
  const period = Number.isFinite(hour)
    ? hour < 6 ? "noite" : hour < 12 ? "manha" : hour < 18 ? "tarde" : "noite"
    : null;
  return { timeZone, localDateTime, period };
}

export function invalidBrazilGreeting(text: string, now: string): string | null {
  const period = getBrazilChannelTime(now).period;
  if (!period) return null;
  const greeting = text.match(/\b(?:bom|boa)\s+(?:dia|tarde|noite)\b/iu)?.[0]?.toLocaleLowerCase("pt-BR");
  if (!greeting) return null;
  const expected = period === "manha" ? "bom dia" : period === "tarde" ? "boa tarde" : "boa noite";
  return greeting === expected ? null : `A saudacao "${greeting}" contradiz o horario do canal no Brasil. Reescreva usando "${expected}" ou omita a saudacao.`;
}
