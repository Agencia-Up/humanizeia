import { useState, lazy, Suspense } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Bot, MonitorPlay } from 'lucide-react';

const WhatsAppAIAgent = lazy(() => import('./WhatsAppAIAgent'));
const CrmAoVivo       = lazy(() => import('./CrmAoVivo'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { id: 'agente',    label: 'Agente IA',    icon: Bot,         emoji: '🤖' },
  { id: 'ao-vivo',   label: 'CRM ao Vivo',  icon: MonitorPlay, emoji: '📺' },
];

export default function PedroSDR() {
  const [activeTab, setActiveTab] = useState('agente');

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center">
            <Bot className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Pedro</h1>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 inline-block" />
                Agente Online
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">SDR — Agente IA & CRM ao Vivo</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b border-border/40">
            <TabsList className="h-auto bg-transparent p-0 gap-1">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-500 data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-all"
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<TabLoader />}>
              <TabsContent value="agente"  className="mt-0 h-full">
                <WhatsAppAIAgent embedded />
              </TabsContent>
              <TabsContent value="ao-vivo" className="mt-0 h-full">
                <CrmAoVivo embedded />
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
