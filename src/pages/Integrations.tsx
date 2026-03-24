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

          <TabsContent value="connections">
            <ConnectionsTab />
          </TabsContent>

          <TabsContent value="other">
            <IntegrationsTab />
          </TabsContent>

          <TabsContent value="capture">
            <LeadCaptureTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
