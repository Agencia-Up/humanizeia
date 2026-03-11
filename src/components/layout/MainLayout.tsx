import { ReactNode } from 'react';
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
          </div>
        </SidebarInset>
      </div>
      <AIAssistantButton />
    </SidebarProvider>
  );
}
