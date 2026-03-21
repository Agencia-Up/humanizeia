import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Radar, PenTool, Palette, Send,
  Layers, Megaphone, Bot, Brain, Lock, CheckCircle,
} from 'lucide-react';

const AGENTS = [
  {
    id: 'salomao', name: 'SALOMÃO', role: 'Orquestrador', icon: Sparkles,
    description: 'Coordena todos os agentes. Recebe o briefing do cliente e distribui tarefas.',
    status: 'coming', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20',
    url: null,
  },
  {
    id: 'jose', name: 'JOSÉ', role: 'Tráfego Pago', icon: Radar,
    description: 'Gerencia Meta Ads, Google Ads e TikTok com autonomia total. Analisa, otimiza, pausa e escala campanhas.',
    status: 'active', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',
    url: '/apollo',
  },
  {
    id: 'paulo', name: 'PAULO', role: 'Copywriter', icon: PenTool,
    description: 'Escreve headlines, body copy, CTAs, scripts de vídeo e sequências de email que convertem.',
    status: 'active', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20',
    url: '/copywriter',
  },
  {
    id: 'miriam', name: 'MIRIAM', role: 'Designer', icon: Palette,
    description: 'Cria imagens, banners e criativos com IA. Remove fundo, redimensiona e gera variações.',
    status: 'active', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20',
    url: '/creative-studio',
  },
  {
    id: 'daniel', name: 'DANIEL', role: 'Estrategista', icon: Brain,
    description: 'Analisa mercado, concorrentes e posicionamento. Define personas, ângulos e plano de 90 dias.',
    status: 'coming', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20',
    url: null,
  },
  {
    id: 'davi', name: 'DAVI', role: 'Social Media', icon: Send,
    description: 'Cria calendário editorial, escreve legendas e publica automaticamente no melhor horário.',
    status: 'coming', color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20',
    url: null,
  },
  {
    id: 'lucas', name: 'LUCAS', role: 'Gestor de Funil', icon: Layers,
    description: 'Mapeia e otimiza toda a jornada do cliente: anúncio → landing page → checkout → retenção.',
    status: 'coming', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20',
    url: null,
  },
  {
    id: 'joao', name: 'JOÃO', role: 'Email Marketing', icon: Megaphone,
    description: 'Cria sequências de nutrição, segmenta listas e envia campanhas no timing certo.',
    status: 'coming', color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20',
    url: null,
  },
  {
    id: 'pedro', name: 'PEDRO', role: 'SDR & Atendimento', icon: Bot,
    description: 'Qualifica leads, agenda reuniões e responde clientes 24/7 via WhatsApp com inteligência humana.',
    status: 'active', color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20',
    url: '/whatsapp/ai-agent',
  },
];

export default function SalomaoOrchestrator() {
  const navigate = useNavigate();
  const activeCount = AGENTS.filter(a => a.status === 'active').length;

  return (
    <MainLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-3 py-6">
          <div className="flex items-center justify-center gap-3">
            <Sparkles className="h-8 w-8 text-yellow-400" />
            <h1 className="text-3xl font-bold tracking-tight">SALOMÃO</h1>
            <Sparkles className="h-8 w-8 text-yellow-400" />
          </div>
          <p className="text-muted-foreground text-lg">A Agência de Marketing Digital do Futuro</p>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            9 agentes especializados de IA trabalhando em equipe. Cada um é um especialista completo na sua área —
            juntos formam a primeira agência 100% autônoma do Brasil.
          </p>
          <div className="flex items-center justify-center gap-4 pt-2">
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-sm px-3 py-1">
              <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
              {activeCount} agentes ativos
            </Badge>
            <Badge variant="outline" className="text-muted-foreground text-sm px-3 py-1">
              {AGENTS.length - activeCount} em desenvolvimento
            </Badge>
          </div>
        </div>

        {/* Agent Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {AGENTS.map((agent) => {
            const Icon = agent.icon;
            const isActive = agent.status === 'active';

            return (
              <Card
                key={agent.id}
                className={`border transition-all duration-200 ${agent.bg} ${isActive ? 'cursor-pointer hover:scale-[1.02] hover:shadow-lg' : 'opacity-70'}`}
                onClick={() => isActive && agent.url && navigate(agent.url)}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${agent.bg} border`}>
                        <Icon className={`h-5 w-5 ${agent.color}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className={`font-bold text-base ${agent.color}`}>{agent.name}</h3>
                          {isActive ? (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                            </span>
                          ) : (
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-medium">{agent.role}</p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={isActive
                        ? 'text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                        : 'text-[10px] text-muted-foreground'
                      }
                    >
                      {isActive ? 'Ativo' : 'Em breve'}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">{agent.description}</p>

                  {isActive && (
                    <div className="flex items-center gap-1 text-xs font-medium" style={{ color: agent.color.replace('text-', '') }}>
                      <span className={agent.color}>Acessar agente</span>
                      <span className={agent.color}>→</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Architecture diagram */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-6">
            <h3 className="text-sm font-semibold text-muted-foreground mb-4 text-center">ARQUITETURA DA EQUIPE</h3>
            <div className="font-mono text-xs text-muted-foreground space-y-1 text-center">
              <p className="text-yellow-400 font-bold">👑 SALOMÃO (Orquestrador)</p>
              <p>│</p>
              <div className="grid grid-cols-3 gap-2 text-center max-w-xl mx-auto">
                <div className="space-y-1">
                  <p className="text-emerald-400">├── JOSÉ</p>
                  <p className="text-[10px]">Tráfego Pago</p>
                </div>
                <div className="space-y-1">
                  <p className="text-blue-400">├── PAULO</p>
                  <p className="text-[10px]">Copywriter</p>
                </div>
                <div className="space-y-1">
                  <p className="text-purple-400">├── MIRIAM</p>
                  <p className="text-[10px]">Design</p>
                </div>
                <div className="space-y-1">
                  <p className="text-cyan-400">├── DANIEL</p>
                  <p className="text-[10px]">Estratégia</p>
                </div>
                <div className="space-y-1">
                  <p className="text-pink-400">├── DAVI</p>
                  <p className="text-[10px]">Social Media</p>
                </div>
                <div className="space-y-1">
                  <p className="text-orange-400">├── LUCAS</p>
                  <p className="text-[10px]">Funil</p>
                </div>
                <div className="space-y-1">
                  <p className="text-indigo-400">├── JOÃO</p>
                  <p className="text-[10px]">Email</p>
                </div>
                <div className="space-y-1">
                  <p className="text-teal-400">└── PEDRO</p>
                  <p className="text-[10px]">Atendimento</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
