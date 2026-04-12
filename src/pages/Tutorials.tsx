import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Play, Clock, Sparkles, Radar, PenTool, Palette, Send, Bot, BookOpen, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const tutorials = [
  { title: 'Primeiros Passos na Logos IA', desc: 'Aprenda a navegar e configurar sua conta.', icon: Sparkles, duration: '5 min', category: 'Início', color: '#f59e0b' },
  { title: 'Como usar o Gestor de Tráfego (José)', desc: 'Configure e otimize campanhas de Meta e Google Ads.', icon: Radar, duration: '10 min', category: 'Tráfego', color: '#7c5cfc' },
  { title: 'Gerando Copies com IA (Paulo)', desc: 'Crie textos persuasivos para seus anúncios.', icon: PenTool, duration: '7 min', category: 'Copy', color: '#22d3a0' },
  { title: 'Criando Artes com IA (Maria)', desc: 'Gere imagens e criativos profissionais.', icon: Palette, duration: '8 min', category: 'Design', color: '#f472b6' },
  { title: 'Social Media com Davi', desc: 'Planeje e publique conteúdo nas redes.', icon: Send, duration: '6 min', category: 'Social', color: '#60a5fa' },
  { title: 'Funil WhatsApp (Pedro)', desc: 'Configure automações e atendimento com IA.', icon: Bot, duration: '12 min', category: 'WhatsApp', color: '#34d399' },
  { title: 'Dashboard de Métricas', desc: 'Interprete seus KPIs e tome decisões inteligentes.', icon: GraduationCap, duration: '8 min', category: 'Analytics', color: '#a78bfa' },
];

// Quick-start guides — links to the actual pages
const quickGuides = [
  { emoji: '🏁', title: 'Por onde começar?', desc: 'Siga estes 5 passos para deixar a plataforma pronta para uso', route: '/settings', cta: 'Ir para Configurações' },
  { emoji: '🤖', title: 'Conheça seus Agentes', desc: 'Veja o que cada agente faz e quando usar cada um', route: '/salomao', cta: 'Abrir Salomão' },
  { emoji: '📢', title: 'Sua primeira campanha', desc: 'Importe contatos e dispare sua primeira mensagem em massa', route: '/whatsapp/broadcast', cta: 'Ir para Disparo' },
  { emoji: '✍️', title: 'Gerar copy com IA', desc: 'Peça ao Paulo para criar anúncios, legendas e e-mails', route: '/copywriter', cta: 'Abrir Paulo' },
  { emoji: '📊', title: 'Ver métricas dos anúncios', desc: 'Conecte seu Meta Ads e acompanhe resultados em tempo real', route: '/connect-accounts', cta: 'Conectar Anúncios' },
];

export default function Tutorials() {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="mx-auto max-w-5xl space-y-8 py-4">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <GraduationCap className="h-8 w-8 text-primary" />
            Tutoriais
          </h1>
          <p className="text-muted-foreground">Aprenda a usar cada ferramenta. Vídeo-aulas chegando em breve!</p>
        </motion.div>

        {/* Quick-start guides */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">Guias Rápidos — comece por aqui</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {quickGuides.map((g, i) => (
              <motion.button
                key={g.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => navigate(g.route)}
                className="group flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="text-2xl">{g.emoji}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{g.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{g.desc}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-primary font-medium mt-1">
                  {g.cta} <ArrowRight className="h-3 w-3" />
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Video tutorials - coming soon */}
        <div>
          <p className="text-sm font-semibold text-foreground mb-3">🎬 Vídeo-aulas (em breve)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tutorials.map((t, i) => (
              <motion.div
                key={t.title}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="border-border/30 bg-card/50 backdrop-blur-sm h-full opacity-70">
                  <CardContent className="flex flex-col gap-4 p-5">
                    <div className="flex items-start justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: `${t.color}15` }}>
                        <t.icon className="h-5 w-5" style={{ color: t.color }} />
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-sm text-foreground">{t.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{t.desc}</p>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/30">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" /> {t.duration}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Play className="h-3 w-3" /> Em breve
                      </span>
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
