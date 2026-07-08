import { ReactNode, useLayoutEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { Topbar } from './Topbar';
import { TokenAlertBanner } from '@/components/subscription/TokenAlertBanner';

interface MainLayoutProps {
  children: ReactNode;
}

// Rotas onde o botão voltar não deve aparecer (pontos de entrada)
const NO_BACK_ROUTES = ['/tela-inicial', '/dashboard', '/metrics'];

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useAppStore();
  const location = useLocation();
  const navigate = useNavigate();

  const showBackButton = !NO_BACK_ROUTES.includes(location.pathname);
  const isAgentHubHome = location.pathname === '/tela-inicial';

  // ── HMR safety net ───────────────────────────────────────────────────────
  // If a Radix UI modal was open when HMR fired, the `inert` / `aria-hidden`
  // cleanup may not have completed. We re-check on every layout paint and
  // remove any stuck markers so the layout is always interactive.
  useLayoutEffect(() => {
    // Radix UI applies `inert` to SIBLINGS of the portal inside #root,
    // not to #root itself — so we must querySelectorAll the whole document.
    document.querySelectorAll<HTMLElement>('[inert]').forEach(el => {
      el.removeAttribute('inert');
      el.removeAttribute('data-inert-ed');
    });
    document.querySelectorAll<HTMLElement>('[data-aria-hidden="true"]').forEach(el => {
      el.removeAttribute('aria-hidden');
      el.removeAttribute('data-aria-hidden');
    });
    // Unstick body scroll-lock that Radix/vaul applies when a modal is open
    document.body.removeAttribute('data-scroll-locked');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('pointer-events');
  });

  const isFullPageApp = ['/marcos', '/pedro', '/whatsapp/inbox', '/painel-ao-vivo'].includes(location.pathname);

  return (
    <SidebarProvider defaultOpen={sidebarOpen} open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className={`flex h-screen w-full overflow-hidden bg-background ${isAgentHubHome ? 'logos-home-layout' : ''}`}>
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col overflow-hidden relative">
          
          <Topbar />

          <TokenAlertBanner />

          <div
            id="main-scroll-container"
            className={`flex-1 flex flex-col ${
              isFullPageApp
                ? 'overflow-hidden px-2 pb-2 pt-2 sm:px-4 lg:px-6 lg:pb-3 lg:pt-3'
                : isAgentHubHome
                ? 'overflow-auto px-3 pb-4 pt-4 sm:px-4 sm:pt-5 lg:px-10 lg:pb-6 lg:pt-7'
                : 'overflow-auto p-3 sm:p-4 lg:p-6'
            }`}
          >
            {/* Botão Voltar — aparece em todas as páginas exceto no Dashboard */}
            {showBackButton && (
              <div
                className={`${isFullPageApp ? 'px-1 sm:px-4 lg:px-6' : 'px-4 lg:px-6'} ${
                  isFullPageApp ? 'mb-2 -mt-2 pt-0' : 'mb-3 -mt-1 pt-2'
                }`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Funil do Agente (/agente/:id/funil): "Voltar" SEMPRE volta pra
                    // DENTRO do Pedro (aba Agente IA), nunca pro AgentHub. Antes, sem
                    // histórico (refresh/entrada direta) o navigate(-1) caía no
                    // fallback /tela-inicial (AgentHub) e o usuário "saía do agente".
                    if (location.pathname.startsWith('/agente/')) {
                      navigate('/pedro?tab=agente');
                      return;
                    }
                    // Painel de agente (Pedro/Marcos/José): "Voltar" SEMPRE vai pra a
                    // home dos agentes (/tela-inicial), nunca o history-back (que caía
                    // em qualquer lugar de onde o usuário veio).
                    if (['/pedro', '/marcos', '/jose'].includes(location.pathname)) {
                      navigate('/tela-inicial');
                      return;
                    }
                    const canGoBack = (window.history.state?.idx ?? 0) > 0;
                    if (canGoBack) {
                      navigate(-1);
                    } else {
                      navigate('/tela-inicial');
                    }
                  }}
                  className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 px-2 rounded-lg transition-colors group"
                >
                  <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                  Voltar
                </Button>
              </div>
            )}

            <main className={`flex-1 ${isFullPageApp ? 'flex flex-col min-h-0' : ''}`}>
              {children}
            </main>

            {!isFullPageApp && (
              <footer id="main-layout-footer" className="mt-auto pt-6 pb-3 border-t border-border/40 text-center text-xs text-muted-foreground flex items-center justify-center gap-3 flex-wrap">
                <span>© {new Date().getFullYear()} LOGOS<span style={{ color: 'var(--brand-gold)' }}>|IA</span></span>
                <span className="text-border">•</span>
                <Link to="/privacy" className="hover:text-primary transition-colors">Política de Privacidade</Link>
                <span className="text-border">•</span>
                <Link to="/terms" className="hover:text-primary transition-colors">Termos de Serviço</Link>
              </footer>
            )}
          </div>
        </SidebarInset>
      </div>
      <ProductTour />
    </SidebarProvider>
  );
}
