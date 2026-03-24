import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const agent = getAgent('lucas')!;
const funnelSteps = [
  { name: 'Lead Captado', count: 320, rate: '100%', color: '#fb923c' },
  { name: 'Mensagem Enviada', count: 288, rate: '90%', color: '#f59e0b' },
  { name: 'Respondeu', count: 249, rate: '78%', color: '#22d3a0' },
  { name: 'Qualificado', count: 148, rate: '46%', color: '#3b82f6' },
  { name: 'Convertido', count: 99, rate: '31%', color: '#8b5cf6' },
];

export default function LucasAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Entradas" value="320" trend="+45" color={agent.color} />
              <AgentMetricCard label="Taxa Resposta" value="78%" trend="+5%" color={agent.color} />
              <AgentMetricCard label="Conversão" value="31%" trend="+2%" color={agent.color} />
              <AgentMetricCard label="Ticket Médio" value="R$890" trend="+R$120" color={agent.color} />
            </div>
            {/* Flow nodes */}
            <div className="flex flex-col items-center gap-2">
              {funnelSteps.map((s, i) => (
                <div key={s.name} className="w-full max-w-md">
                  <div className="rounded-2xl border border-border/50 bg-card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-sm font-medium">{s.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{s.count}</p>
                      <p className="text-[10px] text-muted-foreground">{s.rate}</p>
                    </div>
                  </div>
                  {i < funnelSteps.length - 1 && <div className="w-0.5 h-4 bg-border/50 mx-auto" />}
                </div>
              ))}
            </div>
          </div>
        );
        if (section === 'stages') return (
          <div className="space-y-3">
            {funnelSteps.map((s) => (
              <div key={s.name} className="rounded-2xl border border-border/50 bg-card p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{s.count} leads</Badge>
                </div>
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: s.rate, backgroundColor: s.color }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">Taxa de passagem: {s.rate}</p>
              </div>
            ))}
          </div>
        );
        if (section === 'whatsapp') return (
          <div className="space-y-3">
            {['Oi {{nome}}, vi que você se interessou pelo nosso serviço! Posso te ajudar?', 'Legal! Vou te mandar mais detalhes agora. Qual a melhor forma de contato?', 'Perfeito, {{nome}}! Vou preparar uma proposta personalizada pra você.'].map((s, i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card p-4 flex justify-between items-center">
                <p className="text-sm flex-1 mr-4">{s}</p>
                <button onClick={() => toast.success('Script copiado!')} className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-secondary shrink-0">Copiar</button>
              </div>
            ))}
          </div>
        );
        if (section === 'automations') return (
          <div className="space-y-3">
            {[{ name: 'Follow-up 24h', active: true }, { name: 'Reativação 7 dias', active: true }, { name: 'Boas-vindas Auto', active: false }].map((a) => (
              <div key={a.name} className="rounded-2xl border border-border/50 bg-card p-4 flex justify-between items-center">
                <span className="text-sm font-medium">{a.name}</span>
                <button className={`w-10 h-5 rounded-full relative transition-colors ${a.active ? 'bg-emerald-400' : 'bg-secondary'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${a.active ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
