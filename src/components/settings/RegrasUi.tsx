// Peças visuais leves da área "Regras & Automações" — SEM lógica de negócio.
// Só apresentação: pílula de status, nota informativa e tile de métrica.
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PillTone = 'on' | 'off' | 'ok' | 'warn' | 'fail' | 'wait' | 'muted';

const PILL_TONE: Record<PillTone, string> = {
  on: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  off: 'border-border/60 bg-muted/30 text-muted-foreground',
  muted: 'border-border/60 bg-muted/30 text-muted-foreground',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  fail: 'border-red-500/40 bg-red-500/10 text-red-400',
  wait: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
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
    <div className={cn('rounded-lg border px-3 py-2 flex items-start gap-2',
      tone === 'warn' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/40 bg-background/40')}>
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
    <div className={cn('rounded-lg border border-border/40 bg-background/40 px-3 py-2 min-w-0', className)}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium', warn ? 'text-amber-400' : '')}>{value}</p>
      {sub && <p className="text-[10px] text-amber-400/80 truncate" title={subTitle}>{sub}</p>}
    </div>
  );
}
