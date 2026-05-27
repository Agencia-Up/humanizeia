import { useState, lazy, Suspense, useMemo, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Loader2, Users, Inbox, Send, Smartphone, Zap, Kanban, ClipboardList, Contact } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { FEATURES } from '@/config/features';

// Lazy load cada sub-página
const FluxCRM           = lazy(() => import('./FluxCRM'));
const WhatsAppInbox     = lazy(() => import('./WhatsAppInbox'));
const WhatsAppBroadcast = lazy(() => import('./WhatsAppBroadcast'));
const WhatsAppInstances = lazy(() => import('./WhatsAppInstances'));
const WhatsAppAutomations = lazy(() => import('./WhatsAppAutomations'));
const CrmFormularios    = lazy(() => import('./CrmFormularios'));
const WhatsAppContacts  = lazy(() => import('./WhatsAppContacts'));
const MarcosPerformance = lazy(() => import('./MarcosPerformance'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// Performance é filtrada por FEATURES.agentPerformanceTab (default off, 27/05/2026).
// Métricas consolidadas vivem em /painel-geral pra master.
const ALL_TABS: { id: string; label: string; icon: any; emoji: string; featureKey: keyof VisibleFeatures }[] = [
  { id: 'performance', label: 'Performance',      icon: BarChart3,    emoji: '📈', featureKey: 'marcos_crm' },
  { id: 'crm',         label: 'CRM',              icon: Kanban,       emoji: '📊', featureKey: 'marcos_crm' },
  { id: 'formularios', label: 'Formulários',      icon: ClipboardList,emoji: '📋', featureKey: 'marcos_formularios' },
  { id: 'contacts',    label: 'Contatos',         icon: Contact,      emoji: '👥', featureKey: 'marcos_contatos' },
  { id: 'broadcast',   label: 'Disparo em Massa', icon: Send,         emoji: '📤', featureKey: 'marcos_disparo' },
  { id: 'inbox',       label: 'Inbox',            icon: Inbox,        emoji: '💬', featureKey: 'marcos_inbox' },
  { id: 'instances',   label: 'Instâncias',       icon: Smartphone,   emoji: '📱', featureKey: 'marcos_instancias' },
  { id: 'automations', label: 'Automações',       icon: Zap,          emoji: '⚡', featureKey: 'marcos_automacoes' },
].filter(t => t.id !== 'performance' || FEATURES.agentPerformanceTab);

export default function MarcosLeads() {
  const { user } = useAuth();
  const { isSeller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  // Filtra tabs por permissão (master vê tudo, seller vê só o que master liberou)
  const tabs = useMemo(() => {
    if (!isSeller) return ALL_TABS;
    return ALL_TABS.filter(t => visibleFeatures[t.featureKey]);
  }, [isSeller, visibleFeatures]);

  // Default tab — quando agentPerformanceTab off (27/05/2026), cai em 'crm'.
  const initialDefault = FEATURES.agentPerformanceTab ? 'performance' : 'crm';
  const [activeTab, setActiveTab] = useState(() => tabParam || initialDefault);

  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', newTab);
      return next;
    }, { replace: true });
  };

  useEffect(() => {
    if (sellerLoading || tabs.length === 0) return;

    const tabExists = (id: string | null | undefined) => !!id && tabs.some(t => t.id === id);
    const nextTab = tabExists(tabParam)
      ? tabParam!
      : tabExists(activeTab)
        ? activeTab
        : (tabs[0]?.id || 'crm');

    if (activeTab !== nextTab) {
      setActiveTab(nextTab);
    }

    if (tabParam !== nextTab) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', nextTab);
        return next;
      }, { replace: true });
    }
  }, [sellerLoading, tabs, tabParam, activeTab, setSearchParams]);

  // Se vendedor não tem permissão para Marcos OU nenhuma sub-feature, bloqueia acesso
  if (!sellerLoading && isSeller && (!visibleFeatures.agent_marcos || tabs.length === 0)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (sellerLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

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
            <p className="text-xs text-muted-foreground">Captação de Leads, Formulários & Disparo em Massa</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
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

          <div className="flex-1 min-h-0 overflow-hidden">
            <Suspense fallback={<TabLoader />}>
              {/* Performance — desativada via FEATURES.agentPerformanceTab (27/05/2026).
                  Conteúdo consolidado vive em /painel-geral pra master.
                  Componente MarcosPerformance (lazy import linha 19) intacto. */}
              {FEATURES.agentPerformanceTab && (
                <TabsContent value="performance" className="mt-0 h-full">
                  <MarcosPerformance embedded />
                </TabsContent>
              )}
              <TabsContent value="crm" className="mt-0 h-full">
                <FluxCRM embedded />
              </TabsContent>
              <TabsContent value="formularios" className="mt-0 h-full">
                <CrmFormularios embedded />
              </TabsContent>
              <TabsContent value="contacts" className="mt-0 h-full">
                <WhatsAppContacts embedded />
              </TabsContent>
              <TabsContent value="broadcast" className="mt-0 h-full">
                <WhatsAppBroadcast embedded />
              </TabsContent>
              <TabsContent value="inbox" className="mt-0 h-full">
                <WhatsAppInbox embedded />
              </TabsContent>
              <TabsContent value="instances" className="mt-0 h-full">
                <WhatsAppInstances embedded />
              </TabsContent>
              <TabsContent value="automations" className="mt-0 h-full">
                <WhatsAppAutomations embedded />
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
