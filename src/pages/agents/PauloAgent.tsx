import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const agent = getAgent('paulo')!;
const copies = [
  { title: 'Hook Curiosidade — Skincare', text: 'Você sabia que 87% das mulheres cometem esse erro na rotina de skincare?', ctr: '8.2%', tags: ['Meta Ads', 'Topo'] },
  { title: 'Prova Social — E-commerce', text: 'Mais de 12.000 clientes satisfeitos em todo o Brasil. Descubra o motivo.', ctr: '6.4%', tags: ['Google', 'Meio'] },
  { title: 'Urgência — Promoção', text: '⚡ Últimas 24h com 40% OFF. Depois disso, o preço volta ao normal.', ctr: '7.1%', tags: ['Stories', 'Fundo'] },
  { title: 'Benefício Direto — SaaS', text: 'Reduza em até 60% o tempo gasto em planilhas. Automatize agora.', ctr: '5.8%', tags: ['LinkedIn', 'Topo'] },
];

export default function PauloAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Total Copies" value="24" trend="+6" color={agent.color} />
              <AgentMetricCard label="CTR Médio" value="6.8%" trend="+0.4%" color={agent.color} />
              <AgentMetricCard label="Conversão" value="3.2%" trend="+0.3%" color={agent.color} />
              <AgentMetricCard label="Em Uso" value="8" trend="+2" color={agent.color} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border-2 border-emerald-400/30 bg-card p-5">
                <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 text-[10px] mb-2">Melhor Copy</Badge>
                <p className="text-sm font-medium mb-1">Hook Curiosidade — Skincare</p>
                <p className="text-xs text-muted-foreground">CTR: 8.2% · 342 conversões</p>
              </div>
              <div className="rounded-2xl border-2 border-red-400/30 bg-card p-5">
                <Badge className="bg-red-400/10 text-red-400 border-red-400/20 text-[10px] mb-2">Pior Copy</Badge>
                <p className="text-sm font-medium mb-1">Genérico — Promo Natal</p>
                <p className="text-xs text-muted-foreground">CTR: 1.2% · 8 conversões</p>
              </div>
            </div>
          </div>
        );
        if (section === 'library') return (
          <div className="space-y-3">
            {copies.map((c, i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card p-4">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-medium">{c.title}</p>
                  <span className="text-xs font-bold" style={{ color: agent.color }}>{c.ctr}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">"{c.text}"</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">{c.tags.map((t) => <Badge key={t} variant="secondary" className="text-[9px]">{t}</Badge>)}</div>
                  <button onClick={() => toast.success('Copy duplicado!')} className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-secondary">Duplicar</button>
                </div>
              </div>
            ))}
          </div>
        );
        if (section === 'create') return (
          <div className="rounded-2xl border border-border/50 bg-card p-6" style={{ background: `linear-gradient(135deg, ${agent.color}08, transparent)` }}>
            <Badge className="mb-4 text-[10px]" style={{ backgroundColor: agent.color + '18', color: agent.color }}>✨ IA</Badge>
            <div className="space-y-4">
              <div><label className="text-xs text-muted-foreground block mb-1">Produto</label><input className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm" placeholder="Ex: Curso de Marketing Digital" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground block mb-1">Objetivo</label><select className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm"><option>Conversão</option><option>Awareness</option><option>Engajamento</option></select></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Tom</label><select className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm"><option>Persuasivo</option><option>Informal</option><option>Técnico</option></select></div>
              </div>
              <div><label className="text-xs text-muted-foreground block mb-1">Público</label><input className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm" placeholder="Ex: Mulheres 25-45 anos" /></div>
              <button onClick={() => toast.success('4 variações geradas!')} className="w-full py-2.5 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90" style={{ backgroundColor: agent.color }}>✨ Gerar Copy</button>
            </div>
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
