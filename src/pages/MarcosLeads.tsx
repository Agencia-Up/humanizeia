import { useState, lazy, Suspense } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Inbox, Send, Smartphone, Zap, Bot, Kanban, ClipboardList, MonitorPlay } from 'lucide-react';

// Lazy load each sub-page content to keep bundle lean
const FluxCRM = lazy(() => import('./FluxCRM'));
const WhatsAppInbox = lazy(() => import('./WhatsAppInbox'));
const WhatsAppBroadcast = lazy(() => import('./WhatsAppBroadcast'));
const WhatsAppInstances = lazy(() => import('./WhatsAppInstances'));
const WhatsAppAutomations = lazy(() => import('./WhatsAppAutomations'));
const WhatsAppAIAgent = lazy(() => import('./WhatsAppAIAgent'));
const CrmFormularios = lazy(() => import('./CrmFormularios'));
const CrmAoVivo = lazy(() => import('./CrmAoVivo'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

const tabs = [
  { id: 'crm',         label: 'CRM',              icon: Kanban,       emoji: '📊' },
  { id: 'formularios', label: 'Formulários',      icon: ClipboardList,emoji: '📋' },
  { id: 'ao-vivo',     label: 'CRM ao Vivo',      icon: MonitorPlay,  emoji: '📺' },
  { id: 'inbox',       label: 'Inbox',            icon: Inbox,        emoji: '💬' },
  { id: 'broadcast',   label: 'Disparo em Massa', icon: Send,         emoji: '📤' },
  { id: 'instances',   label: 'Instâncias',       icon: Smartphone,   emoji: '📱' },
  { id: 'automations', label: 'Automações',       icon: Zap,          emoji: '⚡' },
  { id: 'ai-agent',    label: 'Agente IA',        icon: Bot,          emoji: '🤖' },
];

export default function MarcosLeads() {
  const [activeTab, setActiveTab] = useState('crm');

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500/20 to-violet-600/20 border border-purple-500/30 flex items-center justify-center">
            <Users className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Marcos</h1>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse mr-1.5 inline-block" />
                Agente Online
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">CRM, Leads & WhatsApp</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="px-6 border-b border-border/40">
            <TabsList className="bg-transparent h-auto p-0 gap-1">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none rounded-t-md px-3 py-2 text-xs gap-1.5"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <Suspense fallback={<TabLoader />}>
              <TabsContent value="crm" className="mt-0 h-full">
                <FluxCRM embedded />
              </TabsContent>
              <TabsContent value="formularios" className="mt-0 h-full">
                <CrmFormularios />
              </TabsContent>
              <TabsContent value="ao-vivo" className="mt-0 h-full">
                <CrmAoVivo embedded />
              </TabsContent>
              <TabsContent value="inbox" className="mt-0 h-full">
                <WhatsAppInbox embedded />
              </TabsContent>
              <TabsContent value="broadcast" className="mt-0 h-full">
                <WhatsAppBroadcast embedded />
              </TabsContent>
              <TabsContent value="instances" className="mt-0 h-full">
                <WhatsAppInstances embedded />
              </TabsContent>
              <TabsContent value="automations" className="mt-0 h-full">
                <WhatsAppAutomations embedded />
              </TabsContent>
              <TabsContent value="ai-agent" className="mt-0 h-full">
                <WhatsAppAIAgent embedded />
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
