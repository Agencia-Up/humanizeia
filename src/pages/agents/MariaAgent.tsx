import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const agent = getAgent('maria')!;
const creatives = Array.from({ length: 9 }, (_, i) => ({
  name: `Criativo ${i + 1}`,
  type: ['Imagem', 'Vídeo', 'GIF'][i % 3],
  dimensions: ['1080x1080', '1080x1920', '1200x628'][i % 3],
  status: i < 6 ? 'Aprovado' : 'Pendente',
}));

export default function MariaAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'library') return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>47 criativos</span>·<span>12 vídeos</span>·<span>8 GIFs</span>
            </div>
            <div className="flex gap-2">{['Todos', 'Imagens', 'Vídeos', 'Aprovados'].map((t) => <button key={t} className="text-xs px-3 py-1.5 rounded-full border border-border/50 hover:bg-secondary transition-colors">{t}</button>)}</div>
            <div className="grid grid-cols-3 gap-3">
              {creatives.map((c, i) => (
                <div key={i} className="rounded-2xl border border-border/50 bg-card overflow-hidden group hover:-translate-y-0.5 transition-all">
                  <div className="aspect-square bg-gradient-to-br from-secondary to-secondary/30 flex items-center justify-center">
                    <span className="text-3xl opacity-30">{c.type === 'Vídeo' ? '🎬' : c.type === 'GIF' ? '✨' : '🖼️'}</span>
                  </div>
                  <div className="p-3">
                    <p className="text-xs font-medium truncate">{c.name}</p>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[10px] text-muted-foreground">{c.dimensions}</span>
                      <Badge variant="secondary" className="text-[9px]">{c.status}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
        if (section === 'create') return (
          <div className="rounded-2xl border border-border/50 bg-card p-6">
            <h3 className="font-heading font-semibold text-sm mb-4">Criar com IA</h3>
            <div className="space-y-4">
              <div><label className="text-xs text-muted-foreground block mb-1">Descrição</label><textarea className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm h-24" placeholder="Descreva o criativo que deseja..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground block mb-1">Formato</label><select className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm"><option>1080x1080</option><option>1080x1920</option><option>1200x628</option></select></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Estilo</label><select className="w-full px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-sm"><option>Moderno</option><option>Minimalista</option><option>Bold</option></select></div>
              </div>
              <button onClick={() => toast.success('Criativo gerado!')} className="w-full py-2.5 rounded-xl text-sm font-medium text-white" style={{ backgroundColor: agent.color }}>✨ Gerar Criativo</button>
            </div>
          </div>
        );
        if (section === 'prompts') return (
          <div className="space-y-3">
            {['Produto em fundo clean com iluminação suave', 'Antes e depois com grid dividido ao meio', 'Carrossel educativo com ícones flat'].map((p, i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card p-4 flex justify-between items-center">
                <div><p className="text-sm">{p}</p><Badge variant="secondary" className="text-[9px] mt-1">Prompt</Badge></div>
                <button onClick={() => toast.success('Prompt copiado!')} className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-secondary">Usar</button>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
