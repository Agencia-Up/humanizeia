import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { motion } from 'framer-motion';
import {
  Sparkles, Radar, Users, PenTool, Palette, Send,
  Layers, Megaphone, Bot, Brain, BarChart3, GraduationCap,
  ArrowRight, Lock
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const agents = [
  { name: 'Salomão', role: 'Orquestrador', icon: Sparkles, color: '#f59e0b', url: '/salomao', desc: 'Coordena todos os agentes e estratégias', active: true },
  { name: 'José', role: 'Tráfego Pago', icon: Radar, color: '#f97316', url: '/jose', desc: 'Meta Ads, Google Ads e otimização de campanhas', active: true },
  { name: 'Marcos', role: 'Leads', icon: Users, color: '#3b82f6', url: '/leads', desc: 'Captação e gestão de leads qualificados', active: true },
  { name: 'Paulo', role: 'Copywriter', icon: PenTool, color: '#22d3a0', url: '/copywriter', desc: 'Copies persuasivas geradas por IA', active: true },
  { name: 'Maria', role: 'Design', icon: Palette, color: '#f472b6', url: '/creative-studio', desc: 'Criativos, imagens e vídeos com IA', active: true },
  { name: 'Davi', role: 'Social Media', icon: Send, color: '#60a5fa', url: '/davi', desc: 'Gestão de redes sociais e conteúdo', active: true },
  { name: 'Lucas', role: 'Funil', icon: Layers, color: '#fb923c', url: '/crm', desc: 'Funis de vendas e CRM inteligente', active: true },
  { name: 'João', role: 'Email', icon: Megaphone, color: '#a78bfa', url: '/joao', desc: 'Email marketing e automações', active: true },
  { name: 'Pedro', role: 'Atendimento', icon: Bot, color: '#34d399', url: '/whatsapp/ai-agent', desc: 'WhatsApp com IA humanizada', active: true },
  { name: 'Daniel', role: 'Estratégia', icon: Brain, color: '#f87171', url: '/daniel', desc: 'Planejamento e análise estratégica', active: true },
];

const quickLinks = [
  { label: 'Dashboard de Métricas', icon: BarChart3, url: '/metrics', desc: 'Visão unificada de todos os KPIs' },
  { label: 'Tutoriais', icon: GraduationCap, url: '/tutorials', desc: 'Aprenda a usar a plataforma' },
];

export default function AgentHub() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const firstName = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuário';

  useEffect(() => {
    if (!loading && profile && !profile.quiz_completed) {
      navigate('/niche-quiz');
    }
  }, [loading, profile, navigate]);

  return (
    <MainLayout>
      <div className="mx-auto max-w-6xl space-y-10 py-4">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
            Oi, <span className="gradient-text">{firstName}</span>! 👋
          </h1>
          <p className="text-muted-foreground">Escolha um agente para começar ou acesse o dashboard de métricas.</p>
        </motion.div>

        {/* Quick Links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {quickLinks.map((link) => (
            <motion.div key={link.url} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Card
                className="cursor-pointer border-border/40 bg-card/60 backdrop-blur-sm hover:border-primary/40 transition-all group"
                onClick={() => navigate(link.url)}
              >
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <link.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{link.label}</p>
                    <p className="text-sm text-muted-foreground">{link.desc}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Agents Grid */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Agentes Especializados
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {agents.map((agent, i) => (
              <motion.div
                key={agent.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ scale: 1.04, y: -4 }}
                whileTap={{ scale: 0.97 }}
              >
                <Card
                  className={`relative cursor-pointer border-border/30 bg-card/50 backdrop-blur-sm hover:shadow-lg transition-all h-full group ${
                    !agent.active && 'opacity-60 grayscale-[0.5]'
                  }`}
                  style={{ '--agent-color': agent.color } as React.CSSProperties}
                  onClick={() => agent.active && navigate(agent.url)}
                >
                  {!agent.active && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className="bg-black/60 backdrop-blur-md rounded-full p-1 border border-white/10">
                        <Lock className="h-3 w-3 text-amber-500" />
                      </div>
                    </div>
                  )}
                  <CardContent className="flex flex-col items-center text-center gap-3 p-5">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-hover:scale-110"
                      style={{ backgroundColor: `${agent.color}15` }}
                    >
                      <agent.icon className="h-7 w-7" style={{ color: agent.color }} />
                    </div>
                    <div>
                      <p className="font-bold text-sm text-foreground">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {agent.active ? agent.role : 'Em breve'}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
