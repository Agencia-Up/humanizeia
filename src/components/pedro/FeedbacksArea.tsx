import { useState } from 'react';
import { Users, FileText, Gauge, PackageSearch } from 'lucide-react';
import { FeedbackPorVendedorTab } from './FeedbackPorVendedorTab';
import { FeedbackNepqTab } from './FeedbackNepqTab';
import { RelatoriosHistoricoTab } from './RelatoriosHistoricoTab';
import { FeedbackPorProdutoTab } from './FeedbackPorProdutoTab';

// ── Área de Feedbacks (master) ───────────────────────────────────────────────
// Três lentes: "Por vendedor" (desempenho conversa a conversa + coaching),
// "NEPQ / Desempenho" (o Power BI: ranking + KPIs + radar por dimensão) e
// "Histórico diário" (os relatórios que a IA gerou/enviou).

type Aba = 'vendedor' | 'produto' | 'nepq' | 'historico';

export function FeedbacksArea() {
  const [aba, setAba] = useState<Aba>('vendedor');
  const tabs: { id: Aba; label: string; icon: typeof Users }[] = [
    { id: 'vendedor', label: 'Por vendedor', icon: Users },
    { id: 'produto', label: 'Por produto', icon: PackageSearch },
    { id: 'nepq', label: 'NEPQ / Desempenho', icon: Gauge },
    { id: 'historico', label: 'Histórico diário', icon: FileText },
  ];
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 bg-muted/50 border border-border/50 rounded-xl p-1">
        {tabs.map((t) => {
          const Ic = t.icon;
          const on = aba === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setAba(t.id)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
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
