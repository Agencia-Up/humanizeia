import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { Badge } from '@/components/ui/badge';

const agent = getAgent('daniel')!;
const projects = [
  { name: 'Expansão Sudeste', status: 'Em andamento', progress: 65, responsible: 'Salomão' },
  { name: 'Lançamento Produto B', status: 'Planejando', progress: 25, responsible: 'Maria' },
  { name: 'Rebranding Q2', status: 'Em andamento', progress: 80, responsible: 'Paulo' },
];
const insights = [
  { title: 'Aumento de 30% no ticket médio B2B', type: 'Oportunidade', desc: 'Dados mostram que empresas com mais de 50 funcionários têm ticket 30% maior.', color: '#22c55e' },
  { title: 'Concorrente lançou ferramenta similar', type: 'Ameaça', desc: 'XYZ Corp lançou produto concorrente com preço 20% menor.', color: '#ef4444' },
  { title: 'Crescimento de vídeo curto em B2B', type: 'Tendência', desc: 'LinkedIn reporta 3x mais engajamento em vídeos curtos.', color: '#3b82f6' },
];
const okrs = [
  { objective: 'Aumentar receita recorrente em 40%', krs: [{ name: 'Atingir 200 novos clientes', progress: 72 }, { name: 'Reduzir churn para < 3%', progress: 85 }, { name: 'Upsell em 30% da base', progress: 45 }] },
  { objective: 'Expandir presença digital', krs: [{ name: 'Alcançar 100k seguidores', progress: 62 }, { name: 'Publicar 60 conteúdos/mês', progress: 90 }, { name: 'ROAS > 5x em todas plataformas', progress: 55 }] },
];

export default function DanielAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Projetos Ativos" value="7" trend="+1" color={agent.color} />
              <AgentMetricCard label="Metas no Prazo" value="78%" trend="+5%" color={agent.color} />
              <AgentMetricCard label="ROI Médio" value="4.1x" trend="+0.2" color={agent.color} />
              <AgentMetricCard label="NPS" value="72" trend="+4" color={agent.color} />
            </div>
            <div className="space-y-3">
              {projects.map((p) => (
                <div key={p.name} className="rounded-2xl border border-border/50 bg-card p-4">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm font-medium">{p.name}</p>
                    <Badge variant="secondary" className="text-[10px]">{p.status}</Badge>
                  </div>
                  <div className="w-full h-2 rounded-full bg-secondary overflow-hidden mb-1">
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.progress}%`, backgroundColor: agent.color }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">{p.progress}% · Responsável: {p.responsible}</p>
                </div>
              ))}
            </div>
          </div>
        );
        if (section === 'plans') return (
          <div className="space-y-3">
            {[{ name: 'Plano Estratégico Q2 2026', deadline: '30/06/2026', resp: 'Daniel', progress: 35 }, { name: 'Go-to-Market Produto C', deadline: '15/05/2026', resp: 'José', progress: 60 }].map((p) => (
              <div key={p.name} className="rounded-2xl border border-border/50 bg-card p-4">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-[10px] text-muted-foreground mb-2">Prazo: {p.deadline} · {p.resp}</p>
                <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${p.progress}%`, backgroundColor: agent.color }} />
                </div>
              </div>
            ))}
          </div>
        );
        if (section === 'market') return (
          <div className="space-y-3">
            {insights.map((ins) => (
              <div key={ins.title} className="rounded-2xl border border-border/50 bg-card p-4">
                <Badge className="text-[10px] mb-2" style={{ backgroundColor: ins.color + '18', color: ins.color, borderColor: ins.color + '30' }}>{ins.type}</Badge>
                <p className="text-sm font-medium mb-1">{ins.title}</p>
                <p className="text-xs text-muted-foreground">{ins.desc}</p>
              </div>
            ))}
          </div>
        );
        if (section === 'okrs') return (
          <div className="space-y-6">
            {okrs.map((okr) => (
              <div key={okr.objective} className="rounded-2xl border border-border/50 bg-card p-5">
                <h4 className="text-sm font-heading font-semibold mb-3" style={{ color: agent.color }}>{okr.objective}</h4>
                <div className="space-y-3">
                  {okr.krs.map((kr) => (
                    <div key={kr.name}>
                      <div className="flex justify-between items-center mb-1">
                        <p className="text-xs">{kr.name}</p>
                        <Badge variant="secondary" className="text-[9px]">{kr.progress >= 80 ? 'On Track' : kr.progress >= 50 ? 'At Risk' : 'Behind'}</Badge>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${kr.progress}%`, backgroundColor: kr.progress >= 80 ? '#22c55e' : kr.progress >= 50 ? '#f59e0b' : '#ef4444' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
