import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const agent = getAgent('davi')!;
const networks = [
  { name: 'Instagram', followers: '24.3k', posts: 142, engagement: '4.8%', reach: '18k', color: '#E1306C' },
  { name: 'Facebook', followers: '12.1k', posts: 98, engagement: '2.1%', reach: '8.4k', color: '#4267B2' },
  { name: 'TikTok', followers: '8.7k', posts: 45, engagement: '6.2%', reach: '32k', color: '#000000' },
  { name: 'LinkedIn', followers: '5.2k', posts: 67, engagement: '3.4%', reach: '4.1k', color: '#0A66C2' },
];

export default function DaviAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'metrics') return (
          <div className="space-y-6">
            <div className="flex gap-2">{networks.map((n) => <Badge key={n.name} variant="outline" className="text-xs">{n.name}</Badge>)}</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <AgentMetricCard label="Curtidas" value="4.2k" trend="+320" color={agent.color} />
              <AgentMetricCard label="Comentários" value="318" trend="+24" color={agent.color} />
              <AgentMetricCard label="Compartilhamentos" value="892" trend="+45" color={agent.color} />
              <AgentMetricCard label="Cliques" value="1.7k" trend="+180" color={agent.color} />
              <AgentMetricCard label="Alcance" value="38k" trend="+4.2k" color={agent.color} />
              <AgentMetricCard label="Engajamento" value="4.2%" trend="+0.3%" color={agent.color} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {networks.map((n) => (
                <div key={n.name} className="rounded-2xl border border-border/50 bg-card p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium">{n.name}</span>
                    <span className="text-xs text-muted-foreground">{n.followers} seguidores</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: n.engagement.replace('%', '') + '0%', backgroundColor: agent.color }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Engajamento: {n.engagement}</p>
                </div>
              ))}
            </div>
          </div>
        );
        if (section === 'calendar') return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-semibold text-sm">Março 2026</h3>
              <button onClick={() => toast.success('Post agendado!')} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground">+ Agendar Post</button>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="text-center text-[10px] text-muted-foreground py-1">{d}</div>)}
              {Array.from({ length: 31 }, (_, i) => {
                const hasPost = [3, 5, 8, 12, 15, 18, 20, 22, 24, 27].includes(i + 1);
                const isToday = i + 1 === 24;
                return (
                  <div key={i} className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs relative ${isToday ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-secondary/50'}`}>
                    {i + 1}
                    {hasPost && <span className="w-1 h-1 rounded-full mt-0.5" style={{ backgroundColor: agent.color }} />}
                  </div>
                );
              })}
            </div>
          </div>
        );
        if (section === 'insights') return (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border-2 border-emerald-400/30 bg-card p-5">
              <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 text-[10px] mb-2">Melhor Post</Badge>
              <p className="text-sm font-medium mb-1">Carrossel — 5 Dicas de Marketing</p>
              <p className="text-xs text-muted-foreground">Curtidas: 842 · Comentários: 124 · Salvamentos: 312</p>
            </div>
            <div className="rounded-2xl border-2 border-red-400/30 bg-card p-5">
              <Badge className="bg-red-400/10 text-red-400 border-red-400/20 text-[10px] mb-2">Pior Post</Badge>
              <p className="text-sm font-medium mb-1">Imagem — Frase Motivacional</p>
              <p className="text-xs text-muted-foreground">Curtidas: 23 · Comentários: 2 · Salvamentos: 1</p>
            </div>
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
