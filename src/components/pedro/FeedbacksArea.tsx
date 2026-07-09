import { useState } from 'react';
import { Users, FileText } from 'lucide-react';
import { FeedbackPorVendedorTab } from './FeedbackPorVendedorTab';
import { RelatoriosHistoricoTab } from './RelatoriosHistoricoTab';

// ── Área de Feedbacks (master) ───────────────────────────────────────────────
// Duas lentes: "Por vendedor" (desempenho conversa a conversa, o que faltava) e
// "Histórico diário" (os relatórios que a IA gerou/enviou, como já existia).

type Aba = 'vendedor' | 'historico';

export function FeedbacksArea() {
  const [aba, setAba] = useState<Aba>('vendedor');
  const tabs: { id: Aba; label: string; icon: typeof Users }[] = [
    { id: 'vendedor', label: 'Por vendedor', icon: Users },
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
      {aba === 'vendedor' ? <FeedbackPorVendedorTab /> : <RelatoriosHistoricoTab />}
    </div>
  );
}
