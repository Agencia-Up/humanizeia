import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, BarChart3, Zap, Shield } from 'lucide-react';

export default function LandingPage() {
  const { user, loading } = useAuth();

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logosia-brand.png" alt="Logos IA" className="h-14 w-auto max-w-[200px] object-contain mix-blend-multiply dark:mix-blend-normal dark:bg-white dark:p-1.5 dark:rounded-xl" />
        </div>

        {/* Botões de ação no menu */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild className="text-muted-foreground hover:text-foreground">
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild className="gradient-primary text-primary-foreground">
            <Link to="/auth?tab=signup">Criar conta</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary font-medium mb-6">
          <Sparkles className="h-3.5 w-3.5" />
          Plataforma alimentada por IA
        </div>

        <h1 className="text-4xl md:text-5xl font-bold max-w-2xl leading-tight mb-4">
          Plataforma inteligente de <span className="text-primary">marketing e IA</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mb-10">
          Otimize suas campanhas publicitárias com inteligência artificial. Gerencie Meta Ads, Google Ads e TikTok Ads em um só lugar.
        </p>

        <div className="flex items-center gap-4 flex-wrap justify-center">
          <Button asChild size="lg" className="gradient-primary text-primary-foreground px-8">
            <Link to="/auth?tab=signup">Comece grátis agora</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Já tenho conta</Link>
          </Button>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-16 max-w-4xl w-full">
          {[
            { icon: Sparkles, title: 'IA Avançada', desc: 'Insights e otimizações automáticas com IA' },
            { icon: BarChart3, title: 'Analytics', desc: 'Métricas em tempo real de todas as plataformas' },
            { icon: Zap, title: 'Automação', desc: 'Regras automáticas e relatórios agendados' },
            { icon: Shield, title: 'Segurança', desc: 'Dados criptografados e proteção avançada' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border/50 bg-card/50 p-5 text-left hover:border-primary/30 hover:bg-card transition-colors">
              <f.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-3 flex-wrap">
        <span>© {new Date().getFullYear()} Logos IA. Todos os direitos reservados.</span>
        <span className="text-border">•</span>
        <a href="/privacy-policy.html" className="hover:text-primary transition-colors">Política de Privacidade</a>
        <span className="text-border">•</span>
        <a href="/terms-of-service.html" className="hover:text-primary transition-colors">Termos de Serviço</a>
        <span className="text-border">•</span>
        <a href="mailto:carvalho@scalpergx.com.br" className="hover:text-primary transition-colors">Contato</a>
      </footer>
    </div>
  );
}
