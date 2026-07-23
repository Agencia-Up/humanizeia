import { useState } from 'react';
import { FileText, Gauge, Lightbulb, PackageSearch, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { FeedbackResumoExecutivoTab } from './FeedbackResumoExecutivoTab';
import { FeedbackPorVendedorTab } from './FeedbackPorVendedorTab';
import { FeedbackNepqTab } from './FeedbackNepqTab';
import { RelatoriosHistoricoTab } from './RelatoriosHistoricoTab';
import { FeedbackPorProdutoTab } from './FeedbackPorProdutoTab';

type Aba = 'resumo' | 'vendedor' | 'produto' | 'nepq' | 'historico';

export function FeedbacksArea() {
  const [aba, setAba] = useState<Aba>('resumo');
  const tabs: { id: Aba; label: string; icon: typeof Users }[] = [
    { id: 'resumo', label: 'Resumo executivo', icon: Sparkles },
    { id: 'vendedor', label: 'Vendedores', icon: Users },
    { id: 'produto', label: 'Produtos e campanhas', icon: PackageSearch },
    { id: 'nepq', label: 'Qualidade', icon: Gauge },
    { id: 'historico', label: 'Historico', icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <div className="feedback-report-hero rounded-2xl p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              <Lightbulb className="h-3.5 w-3.5" />
              Centro de decisao
            </div>
            <h2 className="text-lg font-semibold text-foreground">Feedbacks para decidir o que fazer hoje</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Primeiro vem a leitura executiva. Depois, se precisar, voce abre os detalhes por vendedor, produto, qualidade e historico.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Regra de confianca
            </div>
            <p className="mt-1 text-emerald-700/80 dark:text-emerald-100/80">Toda conclusao precisa ter fonte, periodo, contexto e proxima acao.</p>
          </div>
        </div>
      </div>

      <div className="feedback-report-control flex flex-wrap items-center gap-1 rounded-xl p-1">
        {tabs.map((t) => {
          const Ic = t.icon;
          const on = aba === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? 'bg-white text-foreground shadow-sm dark:bg-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Ic className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {aba === 'resumo' && <FeedbackResumoExecutivoTab />}
      {aba === 'vendedor' && <FeedbackPorVendedorTab />}
      {aba === 'produto' && <FeedbackPorProdutoTab />}
      {aba === 'nepq' && <FeedbackNepqTab />}
      {aba === 'historico' && <RelatoriosHistoricoTab />}
    </div>
  );
}
