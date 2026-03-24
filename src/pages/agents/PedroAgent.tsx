import { AgentLayout } from '@/components/layout/AgentLayout';
import { AgentMetricCard } from '@/components/agents/AgentMetricCard';
import { getAgent } from '@/data/agentsData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const agent = getAgent('pedro')!;
const conversations = [
  { name: 'Ana Silva', msg: 'Preciso de ajuda com meu pedido #1234', time: '2 min', unread: true, status: 'Aberta' },
  { name: 'Carlos Lima', msg: 'Obrigado pelo suporte! Resolvido.', time: '15 min', unread: false, status: 'Resolvida' },
  { name: 'Julia Santos', msg: 'Quando chega meu produto?', time: '22 min', unread: true, status: 'Aguardando' },
  { name: 'Pedro Mota', msg: 'Quero cancelar minha assinatura', time: '1h', unread: false, status: 'Aberta' },
  { name: 'Marina Costa', msg: 'Vocês aceitam PIX?', time: '2h', unread: false, status: 'Resolvida' },
];

const chatMessages = [
  { from: 'customer', text: 'Olá! Comprei o produto ontem mas ainda não recebi o código.' },
  { from: 'agent', text: 'Olá Ana! Vou verificar seu pedido agora. Qual o email cadastrado?' },
  { from: 'customer', text: 'ana@email.com' },
  { from: 'agent', text: 'Encontrei! Seu código de acesso é: XK49-BETA. Já enviei por email também 😊' },
];

export default function PedroAgent() {
  return (
    <AgentLayout agent={agent}>
      {(section) => {
        if (section === 'overview') return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <AgentMetricCard label="Conversas Hoje" value="48" trend="+12" color={agent.color} />
              <AgentMetricCard label="Tempo Médio" value="3 min" trend="-30s" color={agent.color} />
              <AgentMetricCard label="Satisfação" value="4.8/5" trend="+0.1" color={agent.color} />
              <AgentMetricCard label="Resolvidos" value="92%" trend="+3%" color={agent.color} />
            </div>
            <div className="rounded-2xl border border-border/50 bg-card p-5">
              <h3 className="font-heading font-semibold text-sm mb-4">Conversas Recentes</h3>
              <div className="space-y-2">
                {conversations.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-secondary/30 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">{c.name[0]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">{c.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.msg}</p>
                    </div>
                    {c.unread && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
        if (section === 'inbox') return (
          <div className="grid grid-cols-[280px,1fr] gap-4 h-[500px]">
            <div className="rounded-2xl border border-border/50 bg-card overflow-y-auto">
              <div className="p-3 border-b border-border/30">
                <div className="flex gap-1">{['Todas', 'Abertas', 'Aguardando'].map((f) => <button key={f} className="text-[10px] px-2 py-1 rounded-full border border-border/50 hover:bg-secondary">{f}</button>)}</div>
              </div>
              {conversations.map((c, i) => (
                <div key={i} className={`p-3 border-b border-border/30 hover:bg-secondary/20 cursor-pointer ${i === 0 ? 'bg-secondary/30' : ''}`}>
                  <div className="flex justify-between"><span className="text-xs font-medium">{c.name}</span><span className="text-[9px] text-muted-foreground">{c.time}</span></div>
                  <p className="text-[10px] text-muted-foreground truncate">{c.msg}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-border/50 bg-card flex flex-col">
              <div className="p-3 border-b border-border/30 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">A</div>
                <div><p className="text-xs font-medium">Ana Silva</p><Badge className="bg-emerald-400/10 text-emerald-400 text-[9px]">Online</Badge></div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'agent' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-3 py-2 rounded-2xl text-xs ${m.from === 'agent' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary rounded-bl-sm'}`}>{m.text}</div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-border/30">
                <input className="w-full px-3 py-2 rounded-xl border border-border/50 bg-secondary/30 text-sm" placeholder="Digite uma mensagem..." />
              </div>
            </div>
          </div>
        );
        if (section === 'history') return (
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-xs text-muted-foreground"><th className="text-left py-2.5 px-4">Cliente</th><th className="text-left py-2.5 px-4">Data</th><th className="text-left py-2.5 px-4">Duração</th><th className="text-left py-2.5 px-4">Avaliação</th><th className="text-left py-2.5 px-4">Status</th></tr></thead>
              <tbody>
                {[{ n: 'Ana Silva', d: '22/03', dur: '4 min', r: '⭐⭐⭐⭐⭐', s: 'Resolvida' }, { n: 'Carlos L.', d: '22/03', dur: '8 min', r: '⭐⭐⭐⭐', s: 'Resolvida' }, { n: 'Julia S.', d: '21/03', dur: '12 min', r: '⭐⭐⭐', s: 'Escalada' }].map((r, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-secondary/20"><td className="py-2.5 px-4 font-medium">{r.n}</td><td className="py-2.5 px-4 text-muted-foreground">{r.d}</td><td className="py-2.5 px-4">{r.dur}</td><td className="py-2.5 px-4">{r.r}</td><td className="py-2.5 px-4"><Badge variant="secondary" className="text-[10px]">{r.s}</Badge></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        if (section === 'scripts') return (
          <div className="space-y-3">
            {[{ cat: 'Saudação', text: 'Olá {{nome}}! Seja bem-vindo(a)! Como posso te ajudar hoje?' }, { cat: 'Objeção', text: 'Entendo sua preocupação! Posso te oferecer uma condição especial para resolver isso.' }, { cat: 'Fechamento', text: 'Perfeito! Vou enviar o link de pagamento agora. Qualquer dúvida, estou aqui!' }].map((s) => (
              <div key={s.cat} className="rounded-2xl border border-border/50 bg-card p-4">
                <Badge variant="secondary" className="text-[9px] mb-2">{s.cat}</Badge>
                <p className="text-sm mb-2">{s.text}</p>
                <button onClick={() => toast.success('Script copiado!')} className="text-[10px] px-2 py-1 rounded border border-border/50 hover:bg-secondary">Copiar</button>
              </div>
            ))}
          </div>
        );
        return null;
      }}
    </AgentLayout>
  );
}
