import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';

/**
 * BriefingDetails — Página de transição.
 * O briefing é gerado diretamente pelo agente no NicheQuiz e salvo no histórico do Salomão.
 * Esta página apenas redireciona para o Salomão onde o briefing aparece automaticamente.
 */
export default function BriefingDetails() {
  const { nicho } = useParams<{ nicho: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    // Redireciona imediatamente para o Salomão
    const timer = setTimeout(() => {
      navigate('/salomao', { replace: true });
    }, 800);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">Redirecionando para o Salomão...</p>
      </div>
    </div>
  );
}
