import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { AIAssistantButton } from '@/components/ai/AIAssistantButton';
import { useAppStore } from '@/store/appStore';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useAppStore();

  return (
    <SidebarProvider defaultOpen={sidebarOpen} open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 flex flex-col overflow-auto p-4 lg:p-6">
            {children}
            <footer className="mt-auto pt-6 pb-3 border-t border-border/40 text-center text-xs text-muted-foreground flex items-center justify-center gap-3 flex-wrap">
              <span>© {new Date().getFullYear()} Logos IA</span>
              <span className="text-border">•</span>
              <Link to="/privacy" className="hover:text-primary transition-colors">Política de Privacidade</Link>
              <span className="text-border">•</span>
              <Link to="/terms" className="hover:text-primary transition-colors">Termos de Serviço</Link>
            </footer>
          </div>
        </SidebarInset>
      </div>
      <AIAssistantButton />
    </SidebarProvider>
  );
}
