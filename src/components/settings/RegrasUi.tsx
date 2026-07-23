// Peças visuais leves da área "Regras & Automações" — SEM lógica de negócio.
// Só apresentação: pílula de status, nota informativa e tile de métrica.
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PillTone = 'on' | 'off' | 'ok' | 'warn' | 'fail' | 'wait' | 'muted';

const PILL_TONE: Record<PillTone, string> = {
  on: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  off: 'border-slate-300/80 bg-slate-100/80 text-slate-600 dark:border-border/60 dark:bg-muted/30 dark:text-muted-foreground',
  muted: 'border-slate-300/80 bg-slate-100/80 text-slate-600 dark:border-border/60 dark:bg-muted/30 dark:text-muted-foreground',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  fail: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  wait: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
};

/** Pílula de status curta: Ativo, Desligado, Saudável, Atenção, Falhando, Pendente… */
export function StatusPill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap', PILL_TONE[tone], className)}>
      {children}
    </span>
  );
}

/** Nota curta dentro de um bloco — borda leve, nunca card dentro de card. */
export function InfoNote({ icon, children, tone = 'muted' }: { icon?: ReactNode; children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2 flex items-start gap-2 shadow-sm',
      tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10'
        : 'border-slate-200/90 bg-white/80 dark:border-border/40 dark:bg-background/40')}>
      {icon}
      <p className="text-[11px] text-muted-foreground min-w-0">{children}</p>
    </div>
  );
}

/** Tile de métrica da área de diagnóstico (rótulo + valor + linha extra opcional). */
export function StatTile({ label, value, warn, sub, subTitle, className }: {
  label: string; value: ReactNode; warn?: boolean; sub?: ReactNode; subTitle?: string; className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-slate-200/90 bg-white/80 px-3 py-2 min-w-0 shadow-sm dark:border-border/40 dark:bg-background/40', className)}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-semibold', warn ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>{value}</p>
      {sub && <p className="text-[10px] text-amber-700/85 truncate dark:text-amber-400/80" title={subTitle}>{sub}</p>}
    </div>
  );
}
