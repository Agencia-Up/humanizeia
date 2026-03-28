import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { ArrowLeft, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error('404 Error: Rota não encontrada:', location.pathname);
  }, [location.pathname]);

  const handleBack = () => {
    const canGoBack = (window.history.state?.idx ?? 0) > 0;
    if (canGoBack) navigate(-1);
    else navigate('/dashboard');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-6 px-4">
      <div className="text-center space-y-3">
        <p className="text-6xl font-bold text-primary/40">404</p>
        <h1 className="text-2xl font-bold text-foreground">Página não encontrada</h1>
        <p className="text-muted-foreground text-sm max-w-xs mx-auto">
          A página que você tentou acessar não existe ou foi movida.
        </p>
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={handleBack}
          className="gap-2 group"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
          Voltar
        </Button>
        <Button
          onClick={() => navigate('/dashboard')}
          className="gap-2"
        >
          <Home className="h-4 w-4" />
          Ir para o Dashboard
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
