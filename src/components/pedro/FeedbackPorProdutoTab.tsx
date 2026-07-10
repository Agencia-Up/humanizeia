import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCcw, PackageSearch, Loader2, AlertTriangle } from 'lucide-react';

// ── Por produto ──────────────────────────────────────────────────────────────
// Cruza a QUALIDADE do lead (qualificado / pouco / ruim / nem-é-lead) com o
// PRODUTO que a conversa era (carro, no nicho auto — genérico p/ outros nichos).
// Fonte: RPC feedback_produtos_qualidade (escopo do tenant). O produto vem do que a
// IA identificou na conversa (feedback_conversas.produto_interesse) com fallback no
// ai_crm_leads.vehicle_interest. Serve pra ver qual produto/anúncio traz os melhores leads.

interface Row {
  produto: string; total: number;
  qualificados: number; pouco_qualificados: number; ruins: number; nao_lead: number; sem_classe: number;
  pct_qualificado: number;
}

const PERIODOS = [{ v: 30, l: '30 dias' }, { v: 90, l: '90 dias' }, { v: 365, l: '1 ano' }];

export function FeedbackPorProdutoTab() {
  const [dias, setDias] = useState(30);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data, error } = await (supabase as any).rpc('feedback_produtos_qualidade', { p_dias: dias });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, [dias]);
  useEffect(() => { carregar(); }, [carregar]);

  const tot = rows.reduce((a, r) => ({
    total: a.total + r.total, q: a.q + r.qualificados, p: a.p + r.pouco_qualificados,
    r: a.r + r.ruins, n: a.n + r.nao_lead,
  }), { total: 0, q: 0, p: 0, r: 0, n: 0 });

  // barra empilhada (qualificado/pouco/ruim/nem-é-lead) por produto
  const Barra = ({ r }: { r: Row }) => {
    const seg = (n: number, cor: string) => n > 0 ? <div className={cor} style={{ width: `${(n / r.total) * 100}%` }} /> : null;
    return (
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {seg(r.qualificados, 'bg-emerald-500')}
        {seg(r.pouco_qualificados, 'bg-amber-400')}
        {seg(r.ruins, 'bg-red-500')}
        {seg(r.nao_lead, 'bg-slate-400')}
        {seg(r.sem_classe, 'bg-muted-foreground/30')}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <PackageSearch className="h-4 w-4 text-primary" /> Qualidade do lead por produto
          </h3>
          <p className="text-xs text-muted-foreground">Qual produto/carro traz os leads mais qualificados — e quais só trazem curioso.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {PERIODOS.map((o) => (
              <button key={o.v} onClick={() => setDias(o.v)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${dias === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {o.l}
              </button>
            ))}
          </div>
          <button onClick={carregar} disabled={loading} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {/* legenda */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Qualificado</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pouco qualificado</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Ruim</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> Nem é lead</span>
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">
          <AlertTriangle className="h-4 w-4" /> {erro}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border/50 py-10 text-center text-sm text-muted-foreground">
          Sem análises no período. (A área de Feedbacks precisa da "Análise" ligada e conversas avaliadas.)
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30 text-[11px] uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Produto</th>
                <th className="px-3 py-2 text-right font-medium">Leads</th>
                <th className="px-3 py-2 text-right font-medium">Qualif.</th>
                <th className="px-3 py-2 text-right font-medium">Pouco</th>
                <th className="px-3 py-2 text-right font-medium">Ruim</th>
                <th className="px-3 py-2 text-right font-medium">Nem é lead</th>
                <th className="w-[26%] px-3 py-2 text-left font-medium">Distribuição</th>
                <th className="px-3 py-2 text-right font-medium">% Bom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-accent/30">
                  <td className="max-w-[220px] truncate px-3 py-2 font-medium text-foreground" title={r.produto}>{r.produto}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{r.qualificados || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{r.pouco_qualificados || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{r.ruins || '·'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.nao_lead || '·'}</td>
                  <td className="px-3 py-2"><Barra r={r} /></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{r.pct_qualificado}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/50 bg-muted/20 text-[12px] font-medium">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{tot.total}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{tot.q}</td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{tot.p}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600 dark:text-red-400">{tot.r}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{tot.n}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{tot.total ? Math.round((100 * tot.q) / tot.total) : 0}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        O produto vem do que a IA identificou na conversa; quando não dá pra identificar (ex.: clique sem querer, assunto
        fora), cai em "(não identificado)". "Nem é lead" = quem nem estava atrás do produto anunciado.
      </p>
    </div>
  );
}
