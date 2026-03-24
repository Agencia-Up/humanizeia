import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const agent = getAgent('joao')!;
const openData = Array.from({ length: 14 }, (_, i) => ({ day: `${i + 10}/03`, rate: (22 + Math.random() * 12).toFixed(1) }));
const campaigns = [
  { name: 'Newsletter Semanal', status: 'Enviada', sent: 4200, opens: '32%', clicks: '8.1%', date: '22/03' },
  { name: 'Promoção Março', status: 'Ativa', sent: 3800, opens: '28%', clicks: '6.4%', date: '20/03' },
  { name: 'Onboarding Flow', status: 'Ativa', sent: 1200, opens: '45%', clicks: '12%', date: '18/03' },
  { name: 'Re-engajamento', status: 'Rascunho', sent: 0, opens: '-', clicks: '-', date: '-' },
];

export default function JoaoAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Emails Enviados" value="12.4k" trend="+1.2k" color={agent.color} />
              <AgentMetricCard label="Taxa Abertura" value="28.4%" trend="+1.2%" color={agent.color} />
              <AgentMetricCard label="Taxa Clique" value="6.2%" trend="+0.4%" color={agent.color} />
              <AgentMetricCard label="Descadastros" value="0.8%" trend="-0.1%" color={agent.color} />
            </div>
            <div className="rounded-2xl border border-border/50 bg-card p-5">
              <h3 className="font-heading font-semibold text-sm mb-4">Taxa de Abertura — 14 dias</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={openData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
                  <Line type="monotone" dataKey="rate" stroke={agent.color} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
        if (section === 'campaigns') return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-semibold text-sm">Campanhas de Email</h3>
              <button onClick={() => toast.success('Campanha criada!')} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground">+ Nova Campanha</button>
            </div>
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border/50 text-xs text-muted-foreground"><th className="text-left py-2.5 px-4">Nome</th><th className="text-left py-2.5 px-4">Status</th><th className="text-left py-2.5 px-4">Enviados</th><th className="text-left py-2.5 px-4">Abertos</th><th className="text-left py-2.5 px-4">Cliques</th><th className="text-left py-2.5 px-4">Data</th></tr></thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i} className="border-b border-border/30 hover:bg-secondary/20"><td className="py-2.5 px-4 font-medium">{c.name}</td><td className="py-2.5 px-4"><Badge variant="secondary" className="text-[10px]">{c.status}</Badge></td><td className="py-2.5 px-4">{c.sent}</td><td className="py-2.5 px-4">{c.opens}</td><td className="py-2.5 px-4">{c.clicks}</td><td className="py-2.5 px-4 text-muted-foreground">{c.date}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
        if (section === 'templates') return (
          <div className="grid sm:grid-cols-3 gap-3">
            {['Newsletter', 'Promoção', 'Onboarding', 'Re-engajamento', 'Boas-vindas', 'Aniversário'].map((t) => (
              <div key={t} className="rounded-2xl border border-border/50 bg-card p-4 hover:-translate-y-0.5 transition-all">
                <div className="aspect-[4/3] rounded-xl bg-gradient-to-br from-secondary to-secondary/30 flex items-center justify-center mb-3"><span className="text-2xl opacity-30">📧</span></div>
                <p className="text-sm font-medium">{t}</p>
                <button onClick={() => toast.success('Template selecionado!')} className="text-[10px] mt-2 px-2 py-1 rounded border border-border/50 hover:bg-secondary">Usar</button>
              </div>
            ))}
          </div>
        );
        if (section === 'sequences') return (
          <div className="space-y-3">
            {[{ name: 'Onboarding 7 dias', emails: 5, active: 342, conv: '18%' }, { name: 'Carrinho Abandonado', emails: 3, active: 128, conv: '24%' }, { name: 'Reativação 30 dias', emails: 4, active: 89, conv: '8%' }].map((s) => (
              <div key={s.name} className="rounded-2xl border border-border/50 bg-card p-4 flex items-center justify-between">
                <div><p className="text-sm font-medium">{s.name}</p><p className="text-[10px] text-muted-foreground">{s.emails} emails · {s.active} ativos · Conv: {s.conv}</p></div>
                <button onClick={() => toast.success('Sequência criada!')} className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-secondary">+ Nova</button>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
