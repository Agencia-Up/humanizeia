import { useState } from 'react';
import { FileText, Gauge, Lightbulb, PackageSearch, ShieldCheck, Users } from 'lucide-react';
import { FeedbackPorVendedorTab } from './FeedbackPorVendedorTab';
import { FeedbackNepqTab } from './FeedbackNepqTab';
import { RelatoriosHistoricoTab } from './RelatoriosHistoricoTab';
import { FeedbackPorProdutoTab } from './FeedbackPorProdutoTab';

type Aba = 'vendedor' | 'produto' | 'nepq' | 'historico';

export function FeedbacksArea() {
  const [aba, setAba] = useState<Aba>('vendedor');
  const tabs: { id: Aba; label: string; icon: typeof Users }[] = [
    { id: 'vendedor', label: 'Treinamento por vendedor', icon: Users },
    { id: 'produto', label: 'Produtos e campanhas', icon: PackageSearch },
    { id: 'nepq', label: 'Qualidade do atendimento', icon: Gauge },
    { id: 'historico', label: 'Historico diario', icon: FileText },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
              <Lightbulb className="h-3.5 w-3.5" />
              Painel de decisao
            </div>
            <h2 className="text-lg font-semibold text-foreground">Feedbacks que explicam o que fazer agora</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Organizado para o gestor entender rapido: o que aconteceu, qual prova sustenta o numero e qual acao tomar.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Regra de confianca
            </div>
            <p className="mt-1 text-emerald-100/80">Todo numero deve ter fonte, periodo e contexto antes de virar decisao.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/50 bg-muted/50 p-1">
        {tabs.map((t) => {
          const Ic = t.icon;
          const on = aba === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Ic className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {aba === 'vendedor' && <FeedbackPorVendedorTab />}
      {aba === 'produto' && <FeedbackPorProdutoTab />}
      {aba === 'nepq' && <FeedbackNepqTab />}
      {aba === 'historico' && <RelatoriosHistoricoTab />}
    </div>
  );
}
