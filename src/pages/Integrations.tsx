import { MainLayout } from '@/components/layout/MainLayout';
import { ConnectionsTab } from '@/components/settings/ConnectionsTab';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { LeadCaptureTab } from '@/components/settings/LeadCaptureTab';
import { useIntegrationAccess } from '@/components/settings/integrationAccess';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Plug, Wrench, Terminal, Crown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Integrações</h1>
          <p className="text-muted-foreground">
            Conecte suas plataformas de anúncios e ferramentas externas
          </p>
        </div>

        <BasicoPlanBanner />

        <Tabs defaultValue="connections" className="space-y-6">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="connections" className="gap-2">
              <Plug className="h-4 w-4" />
              Conexões
            </TabsTrigger>
            <TabsTrigger value="other" className="gap-2">
              <Wrench className="h-4 w-4" />
              Outras Integrações
            </TabsTrigger>
            <TabsTrigger value="capture" className="gap-2">
              <Terminal className="h-4 w-4" />
              Captura de Leads
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connections" className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
              <span className="text-lg shrink-0">🔌</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Conexões</strong> — Conecte suas contas de anúncios (Meta Ads, Google Ads, TikTok) e o WhatsApp Business. Depois de conectar, seus dados aparecem automaticamente nos dashboards e relatórios.
              </p>
            </div>
            <ConnectionsTab />
          </TabsContent>

          <TabsContent value="other" className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
              <span className="text-lg shrink-0">🔧</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Outras Integrações</strong> — Conecte ferramentas externas como Zapier, n8n, webhooks personalizados ou sua loja Shopify para automatizar fluxos de dados.
              </p>
            </div>
            <IntegrationsTab />
          </TabsContent>

          <TabsContent value="capture" className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-card/40 p-4 flex gap-3">
              <span className="text-lg shrink-0">📋</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Captura de Leads</strong> — Crie formulários para coletar leads diretamente no WhatsApp ou em páginas externas. Os contatos capturados entram automaticamente no seu CRM.
              </p>
            </div>
            <LeadCaptureTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
