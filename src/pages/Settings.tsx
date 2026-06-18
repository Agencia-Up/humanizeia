import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  User,
  Building2,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  Circle,
  ArrowRight,
  Tv,
  KanbanSquare,
} from 'lucide-react';
import { CompanySettingsTab } from '@/components/settings/CompanySettingsTab';
import { AISettingsTab } from '@/components/settings/AISettingsTab';
import { DataSyncSettingsTab } from '@/components/settings/DataSyncSettingsTab';
import { AdminSettingsTab } from '@/components/settings/AdminSettingsTab';
import { DashboardTVSettingsTab } from '@/components/settings/DashboardTVSettingsTab';
import { KanbanSettingsTab } from '@/components/settings/KanbanSettingsTab';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useAuth } from '@/hooks/useAuth';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile } = useAuth();
  const { isSeller } = useSellerProfile(user?.id);
  const tabParam = searchParams.get('tab');
  const validTabs = ['company', 'ai', 'whatsapp', 'sync', 'dashboard-tv', 'kanban-marcos', 'admin'];
  const [activeTab, setActiveTab] = useState(
    tabParam && validTabs.includes(tabParam) ? tabParam : 'company'
  );

  const isSuperAdmin = profile?.is_superadmin === true;
  // Vendedor não precisa de: Dados da empresa, Configurar IA, Dashboard TV
  // (nem o checklist de setup, nem "Conectar anúncios"). Some das contas de todos
  // os vendedores e dos novos automaticamente (gate por profiles.role='seller').
  const sellerHiddenTabs = ['company', 'ai', 'dashboard-tv'];
  const isTabHidden = (t: string) => isSeller && sellerHiddenTabs.includes(t);

  // Se o vendedor cair numa aba escondida (ex.: default 'company'), joga pra
  // primeira aba visível pra ele.
  useEffect(() => {
    if (isSeller && sellerHiddenTabs.includes(activeTab)) {
      setActiveTab('kanban-marcos');
    }
  }, [isSeller, activeTab]);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Atalho do checklist: rota -> navega; aba -> seleciona E rola ate o formulario.
  // (Sem o scroll, clicar em "Dados da empresa" — que ja e a aba padrao — nao
  // movia a tela e parecia que "nao funcionava".)
  const handleStepClick = (step: { tab: string | null; route?: string }) => {
    if (step.route) {
      navigate(step.route);
      return;
    }
    if (step.tab) setActiveTab(step.tab);
    requestAnimationFrame(() => {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Atualiza tab quando URL muda (ex: clicar em "Perfil" no Topbar)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && validTabs.includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    const code = searchParams.get('code');
    const isGoogleCallback = searchParams.get('google_callback');
    if (code && isGoogleCallback) {
      navigate(`/connect-accounts?${searchParams.toString()}`, { replace: true });
    }
  }, [navigate, searchParams]);

  const setupSteps = [
    { label: 'Dados da empresa', description: 'Nome, nicho e informações do negócio', tab: 'company', icon: Building2 },
    { label: 'Seu perfil', description: 'Nome e preferências pessoais', tab: null, route: '/perfil', icon: User },
    { label: 'Conectar anúncios', description: 'Meta Ads, Google Ads e WhatsApp', tab: null, route: '/connect-accounts', icon: RefreshCw },
    { label: 'Configurar IA', description: 'Personalizar como os agentes falam', tab: 'ai', icon: Sparkles },
  ];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Configurações</h1>
          <p className="text-muted-foreground">Gerencie suas preferências e integrações</p>
        </div>

        {/* ── Checklist de configuração (só dono; vendedor não faz setup da conta) ── */}
        {!isSeller && (
        <div className="rounded-xl border border-border/50 bg-card/50 p-5">
          <p className="text-sm font-semibold text-foreground mb-1">📋 Configure em ordem para começar</p>
          <p className="text-xs text-muted-foreground mb-4">Siga os passos abaixo para deixar a plataforma pronta para usar</p>
          <div className="space-y-2">
            {setupSteps.map((step, i) => {
              const Icon = step.icon;
              return (
                <button
                  key={i}
                  onClick={() => handleStepClick(step)}
                  className="group w-full flex items-center gap-4 rounded-lg border border-border/40 bg-background/50 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                    {i + 1}
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
        )}

        {/* ── Tabs ── */}
        <div ref={tabsRef} className="scroll-mt-20">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="flex-wrap bg-muted/50">
            {!isTabHidden('company') && (
            <TabsTrigger value="company" className="gap-2">
              <Building2 className="h-4 w-4" />
              Empresa
            </TabsTrigger>
            )}
            {!isTabHidden('ai') && (
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="h-4 w-4" />
              IA
            </TabsTrigger>
            )}
            <TabsTrigger value="sync" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Sincronização
            </TabsTrigger>
            {!isTabHidden('dashboard-tv') && (
            <TabsTrigger value="dashboard-tv" className="gap-2">
              <Tv className="h-4 w-4" />
              Dashboard TV
            </TabsTrigger>
            )}
            <TabsTrigger value="kanban-marcos" className="gap-2">
              <KanbanSquare className="h-4 w-4" />
              Kanban Marcos
            </TabsTrigger>
            {isSuperAdmin && (
              <TabsTrigger value="admin" className="gap-2 text-yellow-500 font-bold border-yellow-500/20">
                <ShieldCheck className="h-4 w-4" />
                Administração
              </TabsTrigger>
            )}
          </TabsList>

          {!isTabHidden('company') && <TabsContent value="company"><CompanySettingsTab /></TabsContent>}
          {!isTabHidden('ai') && <TabsContent value="ai"><AISettingsTab /></TabsContent>}
          <TabsContent value="sync"><DataSyncSettingsTab /></TabsContent>
          {!isTabHidden('dashboard-tv') && <TabsContent value="dashboard-tv"><DashboardTVSettingsTab /></TabsContent>}
          <TabsContent value="kanban-marcos"><KanbanSettingsTab /></TabsContent>
          {isSuperAdmin && (
            <TabsContent value="admin"><AdminSettingsTab /></TabsContent>
          )}
        </Tabs>
        </div>
      </div>
    </MainLayout>
  );
}
