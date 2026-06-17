import { MainLayout } from '@/components/layout/MainLayout';
import { ConnectionsTab } from '@/components/settings/ConnectionsTab';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { LeadCaptureTab } from '@/components/settings/LeadCaptureTab';
import { ClientAiKeysCard } from '@/components/settings/ClientAiKeysCard';
import { useIntegrationAccess } from '@/components/settings/integrationAccess';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plug, Wrench, Terminal, Crown, Smartphone, Loader2, KeyRound } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { lazy, Suspense } from 'react';

const WhatsAppInstances = lazy(() => import('./WhatsAppInstances'));

function BasicoPlanBanner() {
  const { isBasico } = useIntegrationAccess();
  const navigate = useNavigate();
  if (!isBasico) return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
          <Crown className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Você está no Plano Básico</p>
          <p className="text-xs text-muted-foreground">
            Seu plano inclui <strong className="text-foreground">BNDV (estoque)</strong> e{' '}
            <strong className="text-foreground">Webhook</strong>. Faça upgrade para o Plano Pro e
            desbloqueie todas as conexões e integrações.
          </p>
        </div>
      </div>
      <Button
        size="sm"
        className="gradient-primary text-primary-foreground shrink-0"
        onClick={() => navigate('/meu-plano')}
      >
        <Crown className="mr-2 h-4 w-4" />
        Fazer upgrade
      </Button>
    </div>
  );
}

export default function Integrations() {
  const { user } = useAuth();
  // Vendedor (role='seller') só enxerga a conexão do WhatsApp. As demais abas
  // (Conexões de anúncios, Outras Integrações, Captura de Leads) e o banner de
  // plano são exclusivos do master — não têm nada a ver com o vendedor.
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = isSeller ? 'whatsapp' : (searchParams.get('tab') || 'connections');
  const handleTabChange = (v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', v);
    setSearchParams(next, { replace: true });
  };

  // Enquanto não sabemos se é vendedor, segura a renderização para não piscar as
  // abas restritas.
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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Integrações</h1>
          <p className="text-muted-foreground">
            {isSeller
              ? 'Conecte o número de WhatsApp da sua operação'
              : 'Conecte suas plataformas de anúncios e ferramentas externas'}
          </p>
        </div>

        {!isSeller && <BasicoPlanBanner />}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="bg-muted/50">
            {!isSeller && (
              <TabsTrigger value="connections" className="gap-2">
                <Plug className="h-4 w-4" />
                Conexões
              </TabsTrigger>
            )}
            <TabsTrigger value="whatsapp" className="gap-2">
              <Smartphone className="h-4 w-4" />
              Instâncias do WhatsApp
            </TabsTrigger>
            {!isSeller && (
              <TabsTrigger value="other" className="gap-2">
                <Wrench className="h-4 w-4" />
                Outras Integrações
              </TabsTrigger>
            )}
            {!isSeller && (
              <TabsTrigger value="capture" className="gap-2">
                <Terminal className="h-4 w-4" />
                Captura de Leads
              </TabsTrigger>
            )}
            {!isSeller && (
              <TabsTrigger value="ai-key" className="gap-2">
                <KeyRound className="h-4 w-4" />
                Chave API IA
              </TabsTrigger>
            )}
          </TabsList>

          {!isSeller && (
            <TabsContent value="connections" className="space-y-4">
              <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
                <span className="text-lg shrink-0">🔌</span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Conexões</strong> — Conecte suas contas de anúncios (Meta Ads, Google Ads, TikTok) e o WhatsApp Business. Depois de conectar, seus dados aparecem automaticamente nos dashboards e relatórios.
                </p>
              </div>
              <ConnectionsTab />
            </TabsContent>
          )}

          <TabsContent value="whatsapp" className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
              <span className="text-lg shrink-0">📱</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Instâncias do WhatsApp</strong> — Conecte aqui o número do WhatsApp da operação. Esse número é usado no follow-up manual do Pedro e do Marcos e no disparo em massa. O número do agente de IA é conectado dentro do próprio agente.
              </p>
            </div>
            <Suspense fallback={<div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
              <WhatsAppInstances embedded />
            </Suspense>
          </TabsContent>

          {!isSeller && (
            <TabsContent value="other" className="space-y-4">
              <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
                <span className="text-lg shrink-0">🔧</span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Outras Integrações</strong> — Conecte ferramentas externas como Zapier, n8n, webhooks personalizados ou sua loja Shopify para automatizar fluxos de dados.
                </p>
              </div>
              <IntegrationsTab />
            </TabsContent>
          )}

          {!isSeller && (
            <TabsContent value="capture" className="space-y-4">
              <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
                <span className="text-lg shrink-0">📋</span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Captura de Leads</strong> — Crie formulários para coletar leads diretamente no WhatsApp ou em páginas externas. Os contatos capturados entram automaticamente no seu CRM.
                </p>
              </div>
              <LeadCaptureTab />
            </TabsContent>
          )}

          {!isSeller && (
            <TabsContent value="ai-key" className="space-y-4">
              <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
                <span className="text-lg shrink-0">🔑</span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Chave API IA</strong> — Conecte a sua chave da <strong className="text-foreground">OpenAI</strong> para o agente de atendimento funcionar, com conversas ilimitadas pagas na sua conta da OpenAI. A chave fica cifrada no cofre (Vault) e nunca é exibida de volta.
                </p>
              </div>
              <ClientAiKeysCard />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </MainLayout>
  );
}
