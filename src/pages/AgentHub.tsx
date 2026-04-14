import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { motion } from 'framer-motion';
import {
  Sparkles, Radar, Users, PenTool, Palette, Send,
  Layers, Megaphone, Bot, Brain, BarChart3,
  ArrowRight, Lock, MessageCircle, FileText, Zap,
  TrendingUp, Mail, Instagram, MessageSquare,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// ── Agentes ──────────────────────────────────────────────────────────────────
const agents = [
  { name: 'Salomão', role: 'Orquestrador', icon: Sparkles, color: '#f59e0b', url: '/salomao', desc: 'Coordena todos os agentes e estratégias', active: true },
  { name: 'José', role: 'Tráfego Pago', icon: Radar, color: '#f97316', url: '/jose', desc: 'Meta Ads, Google Ads e otimização de campanhas', active: true },
  { name: 'Paulo', role: 'Copywriter', icon: PenTool, color: '#22d3a0', url: '/copywriter', desc: 'Copies persuasivas geradas por IA', active: true },
  { name: 'Maria', role: 'Design', icon: Palette, color: '#f472b6', url: '/creative-studio', desc: 'Criativos, imagens e vídeos com IA', active: true },
  { name: 'Davi', role: 'Social Media', icon: Instagram, color: '#60a5fa', url: '/davi', desc: 'Gestão de redes sociais e conteúdo', active: true },
  { name: 'João', role: 'Email', icon: Mail, color: '#a78bfa', url: '/joao', desc: 'Email marketing e automações', active: true },
  { name: 'Marcos', role: 'CRM & WhatsApp', icon: Users, color: '#a855f7', url: '/marcos', desc: 'CRM, leads e toda estrutura WhatsApp', active: true },
  { name: 'Pedro', role: 'WhatsApp IA', icon: Bot, color: '#34d399', url: '/whatsapp/ai-agent', desc: 'Atendimento automatizado no WhatsApp', active: true },
  { name: 'Daniel', role: 'Estratégia', icon: Brain, color: '#f87171', url: '/daniel', desc: 'Planejamento e análise estratégica', active: true },
];

// ── Ações Rápidas — o que o usuário faz com mais frequência ──────────────────
const quickActions = [
  {
    label: 'Criar um texto / anúncio',
    desc: 'Paulo escreve o copy perfeito para você em segundos',
    icon: FileText,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10 border-violet-500/20 hover:border-violet-500/40',
    url: '/copywriter',
  },
  {
    label: 'Disparar mensagem no WhatsApp',
    desc: 'Envie campanha em massa para sua lista de contatos',
    icon: MessageCircle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/40',
    url: '/whatsapp/broadcast',
  },
  {
    label: 'Ver resultados dos anúncios',
    desc: 'Métricas do Meta Ads e Google Ads atualizadas',
    icon: TrendingUp,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20 hover:border-blue-500/40',
    url: '/metrics',
  },
  {
    label: 'Criar conteúdo para redes sociais',
    desc: 'Davi gera posts, legendas e calendário editorial',
    icon: Instagram,
    color: 'text-pink-400',
    bg: 'bg-pink-500/10 border-pink-500/20 hover:border-pink-500/40',
    url: '/davi',
  },
  {
    label: 'Ver leads e pipeline de vendas',
    desc: 'Acompanhe cada lead do primeiro contato ao fechamento',
    icon: Users,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20 hover:border-orange-500/40',
    url: '/crm',
  },
  {
    label: 'Montar estratégia de negócio',
    desc: 'Daniel analisa seu mercado e cria o plano de ação',
    icon: Zap,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20 hover:border-amber-500/40',
    url: '/daniel',
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function AgentHub() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuário';

  return (
    <MainLayout>
      <div className="mx-auto max-w-6xl space-y-10 py-4">

        {/* ── Saudação ─────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-1"
        >
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
            Oi, <span className="gradient-text">{firstName}</span>! 👋
          </h1>
          <p className="text-muted-foreground text-sm">
            O que você quer fazer hoje? Escolha uma ação ou um agente abaixo.
          </p>
        </motion.div>

        {/* ── Ações Rápidas ─────────────────────────────────────────────────── */}
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <Zap className="h-4 w-4 text-primary" />
            Ações rápidas
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map((action, i) => (
              <motion.button
                key={action.url}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate(action.url)}
                className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-all ${action.bg}`}
              >
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60`}>
                  <action.icon className={`h-5 w-5 ${action.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{action.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-tight">{action.desc}</p>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/50" />
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── Agentes Especializados ────────────────────────────────────────── */}
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Todos os agentes
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {agents.map((agent, i) => (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ scale: 1.04, y: -3 }}
                whileTap={{ scale: 0.97 }}
              >
                <Card
                  className={`relative cursor-pointer border-border/30 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all h-full group ${
                    !agent.active && 'opacity-60 grayscale-[0.5]'
                  }`}
                  onClick={() => agent.active && navigate(agent.url)}
                >
                  {!agent.active && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className="bg-black/60 backdrop-blur-md rounded-full p-1 border border-white/10">
                        <Lock className="h-3 w-3 text-amber-500" />
                      </div>
                    </div>
                  )}
                  <CardContent className="flex flex-col items-center text-center gap-3 p-4">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-110"
                      style={{ backgroundColor: `${agent.color}18` }}
                    >
                      <agent.icon className="h-6 w-6" style={{ color: agent.color }} />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-foreground">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {agent.active ? agent.role : 'Em breve'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Banner de resultados ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex cursor-pointer items-center gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 transition-all hover:border-primary/40 hover:bg-primary/8"
          onClick={() => navigate('/metrics')}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Ver resultados das campanhas</p>
            <p className="text-xs text-muted-foreground">Métricas em tempo real — investimento, cliques, leads e muito mais</p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-primary/60" />
        </motion.div>

      </div>
    </MainLayout>
  );
}
