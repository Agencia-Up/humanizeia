import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AIAssistantButton } from '@/components/ai/AIAssistantButton';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';

interface MainLayoutProps {
  children: ReactNode;
}

// Rotas onde o botão voltar não deve aparecer (pontos de entrada)
const NO_BACK_ROUTES = ['/dashboard', '/metrics'];

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

  const showBackButton = !NO_BACK_ROUTES.includes(location.pathname);

  return (
    <SidebarProvider defaultOpen={sidebarOpen} open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 flex flex-col overflow-auto p-4 lg:p-6">

            {/* Botão Voltar — aparece em todas as páginas exceto no Dashboard */}
            {showBackButton && (
              <div className="mb-3 -mt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Se há histórico de navegação na sessão, volta; senão vai pro dashboard
                    const canGoBack = (window.history.state?.idx ?? 0) > 0;
                    if (canGoBack) {
                      navigate(-1);
                    } else {
                      navigate('/dashboard');
                    }
                  }}
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 px-2 rounded-lg transition-colors group"
                >
                  <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                  Voltar
                </Button>
              </div>
            )}

            {children}

            <footer className="mt-auto pt-6 pb-3 border-t border-border/40 text-center text-xs text-muted-foreground flex items-center justify-center gap-3 flex-wrap">
              <span>© {new Date().getFullYear()} LogosIA</span>
              <span className="text-border">•</span>
              <Link to="/privacy" className="hover:text-primary transition-colors">Política de Privacidade</Link>
              <span className="text-border">•</span>
              <Link to="/terms" className="hover:text-primary transition-colors">Termos de Serviço</Link>
            </footer>
          </div>
        </SidebarInset>
      </div>
      <AIAssistantButton />
      <ProductTour />
    </SidebarProvider>
  );
}
