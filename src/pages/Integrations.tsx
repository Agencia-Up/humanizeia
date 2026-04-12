import { MainLayout } from '@/components/layout/MainLayout';
import { ConnectionsTab } from '@/components/settings/ConnectionsTab';
import { IntegrationsTab } from '@/components/settings/IntegrationsTab';
import { LeadCaptureTab } from '@/components/settings/LeadCaptureTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plug, Wrench, Terminal } from 'lucide-react';

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
