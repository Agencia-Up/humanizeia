import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GraduationCap, Play, Clock, Sparkles, Radar, PenTool, Palette, Send, Bot, Layers } from 'lucide-react';
import { motion } from 'framer-motion';

const tutorials = [
  { title: 'Primeiros Passos na Logos IA', desc: 'Aprenda a navegar e configurar sua conta.', icon: Sparkles, duration: '5 min', category: 'Início', color: '#f59e0b' },
  { title: 'Como usar o Gestor de Tráfego (José)', desc: 'Configure e otimize campanhas de Meta e Google Ads.', icon: Radar, duration: '10 min', category: 'Tráfego', color: '#7c5cfc' },
  { title: 'Gerando Copies com IA (Paulo)', desc: 'Crie textos persuasivos para seus anúncios.', icon: PenTool, duration: '7 min', category: 'Copy', color: '#22d3a0' },
  { title: 'Criando Artes com IA (Maria)', desc: 'Gere imagens e criativos profissionais.', icon: Palette, duration: '8 min', category: 'Design', color: '#f472b6' },
  { title: 'Social Media com Davi', desc: 'Planeje e publique conteúdo nas redes.', icon: Send, duration: '6 min', category: 'Social', color: '#60a5fa' },
  { title: 'Funil WhatsApp (Pedro)', desc: 'Configure automações e atendimento com IA.', icon: Bot, duration: '12 min', category: 'WhatsApp', color: '#34d399' },
  { title: 'CRM e Gestão de Leads (Lucas)', desc: 'Organize seus leads e funis de vendas.', icon: Layers, duration: '9 min', category: 'CRM', color: '#fb923c' },
  { title: 'Dashboard de Métricas', desc: 'Interprete seus KPIs e tome decisões inteligentes.', icon: GraduationCap, duration: '8 min', category: 'Analytics', color: '#a78bfa' },
];

export default function Tutorials() {
  return (
    <MainLayout>
      <div className="mx-auto max-w-5xl space-y-8 py-4">
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <GraduationCap className="h-8 w-8 text-primary" />
            Tutoriais
          </h1>
          <p className="text-muted-foreground">Aprenda a usar cada ferramenta da plataforma. Em breve, vídeo-aulas!</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tutorials.map((t, i) => (
            <motion.div
              key={t.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="border-border/30 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-all h-full group cursor-pointer">
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
                    <span className="flex items-center gap-1 text-xs text-primary group-hover:underline">
                      <Play className="h-3 w-3" /> Em breve
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
