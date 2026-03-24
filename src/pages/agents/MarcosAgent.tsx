import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const agent = getAgent('marcos')!;
const dailyLeads = Array.from({ length: 14 }, (_, i) => ({ day: `${i + 10}/03`, leads: Math.floor(60 + Math.random() * 80) }));
const pipeline = [
  { stage: 'Novo', count: 42, color: '#3b82f6', leads: [{ name: 'Ana S.', source: 'Meta', value: 'R$1.2k' }, { name: 'Carlos L.', source: 'Google', value: 'R$3.4k' }] },
  { stage: 'Qualificado', count: 28, color: '#f59e0b', leads: [{ name: 'Julia M.', source: 'Orgânico', value: 'R$2.8k' }] },
  { stage: 'Em Negociação', count: 15, color: '#8b5cf6', leads: [{ name: 'Pedro C.', source: 'Meta', value: 'R$5.6k' }] },
  { stage: 'Convertido', count: 8, color: '#22c55e', leads: [{ name: 'Marina R.', source: 'Google', value: 'R$8.2k' }] },
];

export default function MarcosAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Total Leads" value="1.284" trend="+89" color={agent.color} />
              <AgentMetricCard label="Leads Quentes" value="89" trend="+12" color={agent.color} />
              <AgentMetricCard label="Taxa Qualificação" value="34%" trend="+3%" color={agent.color} />
              <AgentMetricCard label="Custo por Lead" value="R$12" trend="-R$2" color={agent.color} />
            </div>
            <div className="rounded-2xl border border-border/50 bg-card p-5">
              <h3 className="font-heading font-semibold text-sm mb-4">Leads Captados — Últimos 14 dias</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={dailyLeads}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
                  <Line type="monotone" dataKey="leads" stroke={agent.color} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
        if (section === 'pipeline') return (
          <div className="grid sm:grid-cols-4 gap-4">
            {pipeline.map((p) => (
              <div key={p.stage} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <div className="p-3 border-b border-border/30 flex items-center justify-between" style={{ borderTopColor: p.color, borderTopWidth: 2 }}>
                  <span className="text-sm font-semibold">{p.stage}</span>
                  <Badge variant="secondary" className="text-[10px]">{p.count}</Badge>
                </div>
                <div className="p-3 space-y-2">
                  {p.leads.map((l, i) => (
                    <div key={i} className="p-2 rounded-xl bg-secondary/30 text-xs">
                      <p className="font-medium">{l.name}</p>
                      <p className="text-muted-foreground">{l.source} · {l.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
        if (section === 'captures') return (
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <h3 className="font-heading font-semibold text-sm mb-4">Fontes de Captação</h3>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-xs text-muted-foreground"><th className="text-left py-2 px-3">Fonte</th><th className="text-left py-2 px-3">Leads</th><th className="text-left py-2 px-3">Taxa Conv.</th><th className="text-left py-2 px-3">Custo</th></tr></thead>
              <tbody>
                {[{ s: 'Meta Ads', l: 520, t: '38%', c: 'R$9.80' }, { s: 'Google Ads', l: 340, t: '31%', c: 'R$14.20' }, { s: 'Orgânico', l: 280, t: '42%', c: 'R$0' }, { s: 'Indicação', l: 144, t: '55%', c: 'R$0' }].map((r) => (
                  <tr key={r.s} className="border-b border-border/30 hover:bg-secondary/20"><td className="py-2 px-3 font-medium">{r.s}</td><td className="py-2 px-3">{r.l}</td><td className="py-2 px-3">{r.t}</td><td className="py-2 px-3">{r.c}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        if (section === 'qualification') return (
          <div className="space-y-3">
            {[{ name: 'Ana Silva', temp: 'Quente', color: '#ef4444' }, { name: 'Carlos Lima', temp: 'Morno', color: '#f59e0b' }, { name: 'Julia Santos', temp: 'Frio', color: '#3b82f6' }].map((l) => (
              <div key={l.name} className="rounded-2xl border border-border/50 bg-card p-4 flex items-center justify-between">
                <div><p className="text-sm font-medium">{l.name}</p><p className="text-xs text-muted-foreground">Aguardando qualificação</p></div>
                <Badge style={{ backgroundColor: l.color + '18', color: l.color, borderColor: l.color + '30' }}>{l.temp}</Badge>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
