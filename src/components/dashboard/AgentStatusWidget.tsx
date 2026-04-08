import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { motion } from 'framer-motion';
import {
  Sparkles,
  Radar,
  PenTool,
  Palette,
  Send,
  Layers,
  Megaphone,
  Bot,
  Brain,
} from 'lucide-react';

interface Agent {
  name: string;
  role: string;
  icon: React.ElementType;
  active: boolean;
  color: string;
}

const agents: Agent[] = [
  { name: 'SALOMÃO', role: 'Orquestrador', icon: Sparkles, active: true, color: 'text-amber-500' },
  { name: 'JOSÉ', role: 'Tráfego Pago', icon: Radar, active: true, color: 'text-blue-500' },
  { name: 'PAULO', role: 'Copywriter', icon: PenTool, active: true, color: 'text-violet-500' },
  { name: 'MARIA', role: 'Design', icon: Palette, active: true, color: 'text-pink-500' },
  { name: 'DAVI', role: 'Social Media', icon: Send, active: true, color: 'text-cyan-500' },
  { name: 'LUCAS', role: 'Funil', icon: Layers, active: true, color: 'text-orange-500' },
  { name: 'JOÃO', role: 'Email', icon: Megaphone, active: true, color: 'text-emerald-500' },
  { name: 'PEDRO', role: 'Atendimento', icon: Bot, active: true, color: 'text-rose-500' },
  { name: 'DANIEL', role: 'Estratégia', icon: Brain, active: true, color: 'text-indigo-500' },
];

export function AgentStatusWidget() {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
            <Sparkles className="h-4 w-4 text-amber-500" />
          </div>
          Equipe Salomão
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {agents.map((agent, i) => {
          const AgentIcon = agent.icon;
          return (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                agent.active
                  ? 'bg-primary/5 hover:bg-primary/10'
                  : 'bg-muted/30 hover:bg-muted/50 opacity-60'
              }`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                agent.active ? 'bg-primary/10' : 'bg-muted/50'
              }`}>
                <AgentIcon className={`h-3.5 w-3.5 ${agent.active ? agent.color : 'text-muted-foreground'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold leading-tight ${
                  agent.active ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {agent.name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">{agent.role}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] font-medium ${
                  agent.active ? 'text-success' : 'text-muted-foreground'
                }`}>
                  {agent.active ? 'Ativo' : 'Em breve'}
                </span>
                <span className="relative flex h-2 w-2">
                  {agent.active ? (
                    <>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                    </>
                  ) : (
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground/40" />
                  )}
                </span>
              </div>
            </motion.div>
          );
        })}
      </CardContent>
    </Card>
  );
}
