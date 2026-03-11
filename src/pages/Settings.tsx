import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  User, 
  MessageCircle,
  Building2,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { WhatsAppSettingsTab } from '@/components/settings/WhatsAppSettingsTab';
import { CompanySettingsTab } from '@/components/settings/CompanySettingsTab';
import { ProfileSettingsTab } from '@/components/settings/ProfileSettingsTab';
import { AISettingsTab } from '@/components/settings/AISettingsTab';
import { DataSyncSettingsTab } from '@/components/settings/DataSyncSettingsTab';

export default function SettingsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Settings</h1>
          <p className="text-muted-foreground">
            Gerencie suas configurações e preferências
          </p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="flex-wrap bg-muted/50">
            <TabsTrigger value="company" className="gap-2">
              <Building2 className="h-4 w-4" />
              Empresa
            </TabsTrigger>
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              Perfil
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Sparkles className="h-4 w-4" />
              IA
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-2">
              <MessageCircle className="h-4 w-4" />
              WhatsApp
            </TabsTrigger>
            <TabsTrigger value="sync" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Sincronização
            </TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <CompanySettingsTab />
          </TabsContent>

          <TabsContent value="profile">
            <ProfileSettingsTab />
          </TabsContent>

          <TabsContent value="ai">
            <AISettingsTab />
          </TabsContent>

          <TabsContent value="whatsapp">
            <WhatsAppSettingsTab />
          </TabsContent>

          <TabsContent value="sync">
            <DataSyncSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
