import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';

const agent = getAgent('jose')!;

const weeklyRoas = [
  { day: 'Seg', roas: 3.8, meta: 2800, google: 1200 },
  { day: 'Ter', roas: 4.1, meta: 3200, google: 1400 },
  { day: 'Qua', roas: 3.6, meta: 2600, google: 1100 },
  { day: 'Qui', roas: 4.5, meta: 3800, google: 1600 },
  { day: 'Sex', roas: 4.2, meta: 3500, google: 1500 },
  { day: 'Sáb', roas: 3.9, meta: 2900, google: 1300 },
  { day: 'Dom', roas: 4.8, meta: 4200, google: 1800 },
];

const campaigns = [
  { name: 'Black Friday 2026', platform: 'Meta Ads', status: 'active', roas: '5.2x', cpa: 'R$28', spend: 'R$4.200', conversions: 150 },
  { name: 'Remarketing Quente', platform: 'Meta Ads', status: 'active', roas: '6.8x', cpa: 'R$22', spend: 'R$1.800', conversions: 82 },
  { name: 'Pesquisa Marca', platform: 'Google Ads', status: 'active', roas: '8.1x', cpa: 'R$15', spend: 'R$2.100', conversions: 140 },
  { name: 'Display Awareness', platform: 'Google Ads', status: 'paused', roas: '1.4x', cpa: 'R$65', spend: 'R$890', conversions: 14 },
  { name: 'Stories Conversão', platform: 'Meta Ads', status: 'paused', roas: '2.1x', cpa: 'R$48', spend: 'R$1.200', conversions: 25 },
];

const leads = [
  { name: 'Ana Silva', email: 'ana@email.com', source: 'Meta Ads', status: 'convertido', date: '22/03', value: 'R$2.800' },
  { name: 'Carlos Lima', email: 'carlos@corp.com', source: 'Google Ads', status: 'em contato', date: '22/03', value: 'R$4.200' },
  { name: 'Julia Santos', email: 'julia@loja.com', source: 'Meta Ads', status: 'novo', date: '21/03', value: 'R$1.500' },
  { name: 'Pedro Mota', email: 'pedro@tech.com', source: 'Meta Ads', status: 'perdido', date: '20/03', value: 'R$3.100' },
  { name: 'Marina Costa', email: 'marina@dig.com', source: 'Google Ads', status: 'em contato', date: '19/03', value: 'R$5.600' },
];

const statusColor: Record<string, string> = {
  active: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  paused: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
  novo: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
  'em contato': 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  convertido: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
  perdido: 'bg-red-400/10 text-red-400 border-red-400/20',
};

export default function JoseAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return <OverviewSection />;
        if (section === 'campaigns') return <CampaignsSection />;
        if (section === 'leads') return <LeadsSection />;
        if (section === 'integrations') return <IntegrationsSection />;
        return <OverviewSection />;
      }}
    </AgentLayout>
  );
}

function OverviewSection() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AgentMetricCard label="ROAS" value="4.2x" trend="+0.3" color={agent.color} />
        <AgentMetricCard label="CPA" value="R$38" trend="-R$4" color={agent.color} />
        <AgentMetricCard label="CPC" value="R$1.24" trend="-R$0.12" color={agent.color} />
        <AgentMetricCard label="CTR" value="3.7%" trend="+0.4%" color={agent.color} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AgentMetricCard label="Conversões" value="284" trend="+18" color={agent.color} />
        <AgentMetricCard label="Investimento" value="R$4.3k" trend="+R$500" color={agent.color} />
        <AgentMetricCard label="Receita" value="R$18k" trend="+R$2.1k" color={agent.color} />
        <AgentMetricCard label="Impressões" value="142k" trend="+12k" color={agent.color} />
      </div>

      <div className="rounded-2xl border border-border/50 bg-card p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">ROAS Semanal</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weeklyRoas}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
            <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="meta" fill="#7c5cfc" radius={[4, 4, 0, 0]} name="Meta Ads" />
            <Bar dataKey="google" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Google Ads" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CampaignsSection() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-heading font-semibold text-sm">Campanhas</h3>
        <button onClick={() => toast.success('Nova campanha criada!')} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90">+ Nova Campanha</button>
      </div>
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border/50 text-xs text-muted-foreground">
            <th className="text-left py-2.5 px-4">Campanha</th>
            <th className="text-left py-2.5 px-4">Plataforma</th>
            <th className="text-left py-2.5 px-4">Status</th>
            <th className="text-left py-2.5 px-4">ROAS</th>
            <th className="text-left py-2.5 px-4">CPA</th>
            <th className="text-left py-2.5 px-4">Investimento</th>
            <th className="text-left py-2.5 px-4">Conversões</th>
          </tr></thead>
          <tbody>
            {campaigns.map((c, i) => (
              <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                <td className="py-2.5 px-4 font-medium">{c.name}</td>
                <td className="py-2.5 px-4"><Badge variant="outline" className="text-[10px]">{c.platform}</Badge></td>
                <td className="py-2.5 px-4"><Badge className={`text-[10px] ${statusColor[c.status]}`}>{c.status === 'active' ? 'Ativa' : 'Pausada'}</Badge></td>
                <td className="py-2.5 px-4">{c.roas}</td>
                <td className="py-2.5 px-4">{c.cpa}</td>
                <td className="py-2.5 px-4">{c.spend}</td>
                <td className="py-2.5 px-4">{c.conversions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadsSection() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AgentMetricCard label="Total Leads" value="284" trend="+18" color={agent.color} />
        <AgentMetricCard label="Convertidos" value="89" trend="+12" color={agent.color} />
        <AgentMetricCard label="Em Contato" value="56" trend="+8" color={agent.color} />
        <AgentMetricCard label="Ticket Médio" value="R$3.4k" trend="+R$200" color={agent.color} />
      </div>
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border/50 text-xs text-muted-foreground">
            <th className="text-left py-2.5 px-4">Nome</th>
            <th className="text-left py-2.5 px-4">Origem</th>
            <th className="text-left py-2.5 px-4">Status</th>
            <th className="text-left py-2.5 px-4">Data</th>
            <th className="text-left py-2.5 px-4">Valor</th>
          </tr></thead>
          <tbody>
            {leads.map((l, i) => (
              <tr key={i} className="border-b border-border/30 hover:bg-secondary/20 transition-colors">
                <td className="py-2.5 px-4"><div><p className="font-medium">{l.name}</p><p className="text-[10px] text-muted-foreground">{l.email}</p></div></td>
                <td className="py-2.5 px-4 text-xs">{l.source}</td>
                <td className="py-2.5 px-4"><Badge className={`text-[10px] ${statusColor[l.status]}`}>{l.status}</Badge></td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground">{l.date}</td>
                <td className="py-2.5 px-4 text-xs font-medium">{l.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntegrationsSection() {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {[{ name: 'Meta Ads', status: 'Conectado', account: 'Act 12345678', color: '#7c5cfc' },
        { name: 'Google Ads', status: 'Conectado', account: 'ID 987654321', color: '#3b82f6' }].map((int) => (
        <div key={int.name} className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-heading font-semibold text-sm">{int.name}</h4>
            <Badge className="bg-emerald-400/10 text-emerald-400 border-emerald-400/20 text-[10px]">{int.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Conta: {int.account}</p>
          <button onClick={() => toast.success('Reconectado!')} className="text-xs px-3 py-1.5 rounded-lg border border-border/50 hover:bg-secondary transition-colors">Reconectar</button>
        </div>
      ))}
    </div>
  );
}
