import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent, agents } from '@/data/agentsData';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const activityFeed = [
  { time: '14:32', agent: 'José', action: 'Otimizou CPA da campanha "Black Friday"', color: '#7c5cfc' },
  { time: '14:15', agent: 'Paulo', action: 'Gerou 4 novas variações de copy', color: '#22d3a0' },
  { time: '13:58', agent: 'Marcos', action: 'Qualificou 12 leads novos', color: '#3b82f6' },
  { time: '13:40', agent: 'Maria', action: 'Criou 3 criativos para Stories', color: '#f472b6' },
  { time: '13:22', agent: 'Davi', action: 'Agendou 5 posts para Instagram', color: '#60a5fa' },
  { time: '12:55', agent: 'Pedro', action: 'Resolveu 8 tickets de suporte', color: '#34d399' },
  { time: '12:30', agent: 'Lucas', action: 'Adicionou etapa no funil de vendas', color: '#fb923c' },
  { time: '12:10', agent: 'João', action: 'Enviou campanha para 2.4k contatos', color: '#a78bfa' },
];

const performanceData = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  leads: Math.floor(30 + Math.random() * 50),
  conversions: Math.floor(8 + Math.random() * 20),
  revenue: Math.floor(800 + Math.random() * 1200),
}));

const agentPerformance = agents.map((a) => ({
  name: a.name,
  score: Math.floor(75 + Math.random() * 25),
  color: a.color,
}));

const agent = getAgent('salomao')!;

export default function SalomaoAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return <OverviewSection />;
        if (section === 'activity') return <ActivitySection />;
        if (section === 'reports') return <ReportsSection />;
        if (section === 'settings') return <SettingsSection />;
        return <OverviewSection />;
      }}
    </AgentLayout>
  );
}

function OverviewSection() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AgentMetricCard label="Agentes Online" value="10/10" trend="+0" color={agent.color} />
        <AgentMetricCard label="Total Leads" value="1.284" trend="+89" color={agent.color} />
        <AgentMetricCard label="Receita Gerada" value="R$142k" trend="+12%" color={agent.color} />
        <AgentMetricCard label="Taxa Conversão" value="31%" trend="+2.1%" color={agent.color} />
      </div>

      {/* Status de todos os agentes */}
      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">Status dos Agentes</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 p-2 rounded-xl bg-secondary/30">
              <span className="text-base">{a.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{a.name}</p>
                <p className="text-[10px] text-muted-foreground">{a.role}</p>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {/* Feed + Chart */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Atividade Recente</h3>
          <div className="space-y-3">
            {activityFeed.slice(0, 6).map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-xs">
                <span className="text-muted-foreground w-10 shrink-0">{item.time}</span>
                <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: item.color }} />
                <div>
                  <span className="font-medium" style={{ color: item.color }}>{item.agent}</span>
                  <span className="text-muted-foreground ml-1">{item.action}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Performance — 30 dias</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={performanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="leads" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="conversions" stroke="#22d3a0" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ActivitySection() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5">
      <h3 className="font-heading font-semibold text-sm mb-4">Atividade dos Agentes</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-xs text-muted-foreground">
              <th className="text-left py-2 px-3">Agente</th>
              <th className="text-left py-2 px-3">Status</th>
              <th className="text-left py-2 px-3">Última Atividade</th>
              <th className="text-left py-2 px-3">Tarefas</th>
              <th className="text-left py-2 px-3">Performance</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                <td className="py-2.5 px-3 flex items-center gap-2">
                  <span>{a.emoji}</span>
                  <span className="font-medium" style={{ color: a.color }}>{a.name}</span>
                </td>
                <td className="py-2.5 px-3">
                  <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 text-[10px]">Online</Badge>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground text-xs">Há {Math.floor(Math.random() * 30) + 1} min</td>
                <td className="py-2.5 px-3 text-xs">{Math.floor(50 + Math.random() * 150)}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${75 + Math.random() * 25}%`, backgroundColor: a.color }} />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsSection() {
  const reports = [
    { title: 'Relatório Semanal — Meta Ads', date: '22/03/2026', agent: 'José' },
    { title: 'Resumo de Leads — Março', date: '20/03/2026', agent: 'Marcos' },
    { title: 'Performance de Copies Q1', date: '18/03/2026', agent: 'Paulo' },
    { title: 'Análise de Criativos', date: '15/03/2026', agent: 'Maria' },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-heading font-semibold text-sm">Relatórios</h3>
        <button className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity">
          + Gerar Relatório
        </button>
      </div>
      {reports.map((r, i) => (
        <div key={i} className="rounded-2xl border border-border/50 bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{r.title}</p>
            <p className="text-xs text-muted-foreground">{r.date} · {r.agent}</p>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-secondary transition-colors">Ver</button>
        </div>
      ))}
    </div>
  );
}

function SettingsSection() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 space-y-4">
      <h3 className="font-heading font-semibold text-sm">Configurações do Orquestrador</h3>
      {agents.map((a) => (
        <div key={a.id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
          <div className="flex items-center gap-2">
            <span>{a.emoji}</span>
            <span className="text-sm font-medium" style={{ color: a.color }}>{a.name}</span>
            <span className="text-xs text-muted-foreground">— {a.role}</span>
          </div>
          <button className="w-10 h-5 rounded-full bg-emerald-400 relative transition-colors">
            <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform" />
          </button>
        </div>
      ))}
    </div>
  );
}
