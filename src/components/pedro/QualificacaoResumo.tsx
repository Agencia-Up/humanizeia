// ============================================================================
// QualificacaoResumo — Resumo da qualificação da IA (topo da aba Feedbacks)
// ----------------------------------------------------------------------------
// Mostra a contagem de TODOS os leads do Pedro por nível de qualificação,
// classificados automaticamente pela IA (ai_crm_leads.status_crm via a função
// auto-classify-leads + cron de hora em hora):
//
//   - Qualificado        (qualificado)
//   - Pouco qualificado  (pouco_qualificado)
//   - Inativo            (inativo)
//   - Em andamento       (novo + estágios manuais: negociação, fechado...)
//
// Busca própria, escopada no master. Filtro de período. Apenas Master.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Award, Activity, CircleSlash, Users, Filter, Loader2, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

type Period = 'today' | '7d' | '30d' | '90d' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

function periodCutoff(period: Period): number {
  const now = Date.now();
  switch (period) {
    case 'today': return new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    case '90d': return now - 90 * 24 * 60 * 60 * 1000;
    case 'all': return 0;
  }
}

// CSV: escapa valor (aspas, ;, quebra de linha) pro formato Excel/Sheets
function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface RawLead { status_crm: string | null; created_at: string; }

export function QualificacaoResumo({ masterUserId }: { masterUserId: string }) {
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<RawLead[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!masterUserId) { setLoading(false); return; }
      setLoading(true);
      try {
        const { data } = await (supabase as any)
          .from('ai_crm_leads')
          .select('status_crm, created_at')
          .eq('user_id', masterUserId)
          .limit(10000);
        if (!cancelled) setLeads((data || []) as RawLead[]);
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [masterUserId]);

  const m = useMemo(() => {
    const cutoff = periodCutoff(period);
    const f = leads.filter(l => new Date(l.created_at).getTime() >= cutoff);
    let q = 0, p = 0, i = 0, o = 0;
    for (const l of f) {
      const s = (l.status_crm || '').toLowerCase();
      if (s === 'qualificado') q++;
      else if (s === 'pouco_qualificado') p++;
      else if (s === 'inativo') i++;
      else o++;
    }
    const classif = q + p + i;
    const pct = classif > 0 ? Math.round((q / classif) * 100) : 0;
    // proporções pra barra (sobre os classificados)
    const wq = classif > 0 ? (q / classif) * 100 : 0;
    const wp = classif > 0 ? (p / classif) * 100 : 0;
    const wi = classif > 0 ? (i / classif) * 100 : 0;
    return { total: f.length, q, p, i, o, classif, pct, wq, wp, wi };
  }, [leads, period]);

  // ─── Exportar CSV (pra mandar pro gestor no Excel/Sheets) ───────────────────
  function exportCsv() {
    const sep = ';'; // Excel pt-BR usa ; como separador de coluna
    const periodLabel = PERIODS.find(x => x.id === period)?.label || '';
    const pctOf = (n: number) => (m.classif > 0 ? `${Math.round((n / m.classif) * 100)}%` : '—');
    const lines: string[] = [];
    lines.push(cell('Resumo de Qualificação dos Leads pela IA'));
    lines.push(cell(`Período: ${periodLabel}`));
    lines.push(cell(`Gerado em: ${new Date().toLocaleString('pt-BR')}`));
    lines.push('');
    lines.push(['Nível', 'Leads', '% sobre classificados'].map(cell).join(sep));
    lines.push(['Qualificados', m.q, pctOf(m.q)].map(cell).join(sep));
    lines.push(['Pouco qualificados', m.p, pctOf(m.p)].map(cell).join(sep));
    lines.push(['Inativos', m.i, pctOf(m.i)].map(cell).join(sep));
    lines.push(['Em andamento (novo/negociação)', m.o, '—'].map(cell).join(sep));
    lines.push(['TOTAL', m.total, ''].map(cell).join(sep));

    const csv = '﻿' + lines.join('\r\n'); // BOM p/ Excel ler acentos certo
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qualificacao-leads-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-400" />
              Qualificação dos Leads pela IA
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Todos os leads classificados automaticamente pela IA no período
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {m.total > 0 && (
              <button
                onClick={exportCsv}
                title="Baixar planilha (CSV) pra enviar ao gestor"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/25 transition-colors"
              >
                <Download className="h-3 w-3" />
                Exportar CSV
              </button>
            )}
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              <Filter className="h-3 w-3 text-muted-foreground ml-1" />
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    period === p.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando qualificação…
          </div>
        ) : m.total === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Nenhum lead no período selecionado.
          </div>
        ) : (
          <>
            {/* Cards por nível */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <NivelCard icon={Award} label="Qualificados" value={m.q} color="text-emerald-400" ring="border-emerald-500/30 bg-emerald-500/5" />
              <NivelCard icon={Activity} label="Pouco qualificados" value={m.p} color="text-amber-400" ring="border-amber-500/30 bg-amber-500/5" />
              <NivelCard icon={CircleSlash} label="Inativos" value={m.i} color="text-slate-400" ring="border-slate-500/30 bg-slate-500/5" />
              <NivelCard icon={Users} label="Em andamento" value={m.o} color="text-blue-400" ring="border-blue-500/30 bg-blue-500/5" sub="novo / negociação" />
            </div>

            {/* Barra de proporção (sobre os já classificados) */}
            {m.classif > 0 && (
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Proporção dos leads classificados ({m.classif})</span>
                  <span className="font-semibold text-emerald-400">{m.pct}% qualificados</span>
                </div>
                <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted/40">
                  {m.wq > 0 && <div style={{ width: `${m.wq}%`, background: '#34d399' }} title={`Qualificados: ${m.q}`} />}
                  {m.wp > 0 && <div style={{ width: `${m.wp}%`, background: '#fbbf24' }} title={`Pouco qualificados: ${m.p}`} />}
                  {m.wi > 0 && <div style={{ width: `${m.wi}%`, background: '#94a3b8' }} title={`Inativos: ${m.i}`} />}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NivelCard({ icon: Icon, label, value, color, ring, sub }: { icon: any; label: string; value: number; color: string; ring: string; sub?: string }) {
  return (
    <div className={`border rounded-lg px-3 py-2.5 ${ring}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color} shrink-0`} />
        <p className={`text-2xl font-bold text-foreground leading-none`}>{value}</p>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">{label}</p>
      {sub && <p className="text-[9px] text-muted-foreground/70 leading-tight">{sub}</p>}
    </div>
  );
}
