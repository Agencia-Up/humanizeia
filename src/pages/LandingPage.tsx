import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sparkles, BarChart3, Zap, Shield } from 'lucide-react';

export default function LandingPage() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/humanizeai-logo.png" alt="HumanizeAI TF" className="h-10 w-10 rounded-xl object-contain" />
          <span className="text-xl font-bold">HumanizeAI TF</span>
        </div>
        <Button asChild>
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-4xl md:text-5xl font-bold max-w-2xl leading-tight mb-4">
          Plataforma inteligente de <span className="text-primary">marketing e IA</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mb-8">
          Otimize suas campanhas publicitárias com inteligência artificial. Gerencie Meta Ads, Google Ads e TikTok Ads em um só lugar.
        </p>
        <Button asChild size="lg" className="gradient-primary text-primary-foreground">
          <Link to="/auth">Comece agora</Link>
        </Button>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-16 max-w-4xl w-full">
          {[
            { icon: Sparkles, title: 'IA Avançada', desc: 'Insights e otimizações automáticas com IA' },
            { icon: BarChart3, title: 'Analytics', desc: 'Métricas em tempo real de todas as plataformas' },
            { icon: Zap, title: 'Automação', desc: 'Regras automáticas e relatórios agendados' },
            { icon: Shield, title: 'Segurança', desc: 'Dados criptografados e proteção avançada' },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border/50 bg-card/50 p-5 text-left">
              <f.icon className="h-8 w-8 text-primary mb-3" />
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-3 flex-wrap">
        <span>© {new Date().getFullYear()} HumanizeAI TF. Todos os direitos reservados.</span>
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
