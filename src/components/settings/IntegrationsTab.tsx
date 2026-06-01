import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, LogOut, ExternalLink, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  useIntegrationAccess,
  PlanProBadge,
  ProLockOverlay,
  UpgradeProDialog,
} from './integrationAccess';

interface IntegrationConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  fields: { key: string; label: string; placeholder: string; type?: string }[];
  helpUrl?: string;
  helpText?: string;
  helpSteps?: string[];
  // Quando true: integracao ainda sem backend (so a casca). Renderiza como
  // "Em breve" desabilitada para nao expor um botao quebrado.
  comingSoon?: boolean;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'bndv',
    name: 'BNDV Estoque',
    icon: '🚗',
    description: 'Permite ao Pedro consultar estoque, preço e versão dos veículos',
    fields: [
      { key: 'api_token', label: 'Bearer Token', placeholder: 'Cole aqui o token do BNDV...', type: 'password' },
    ],
    helpText:
      'A integração é individual por cliente. O token salvo aqui será usado somente na conta logada para consultar o estoque automotivo desse cliente.',
    helpSteps: [
      'Acesse o painel ou suporte do BNDV e solicite o Bearer Token da API GraphQL do estoque.',
      'Se existir um menu de API / Integrações / Tokens no painel, gere a chave por lá.',
      'Cole o token abaixo e clique em "Testar Conexão".',
      'Se o teste passar, clique em "Conectar e Salvar" para liberar a consulta de estoque no agente.',
    ],
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    icon: '📊',
    description: 'Envie eventos de conversão para o GA4',
    fields: [
      { key: 'measurement_id', label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX' },
      { key: 'api_secret', label: 'API Secret', placeholder: 'Seu API Secret...', type: 'password' },
    ],
    helpUrl: 'https://support.google.com/analytics/answer/9539598',
    helpText: 'Encontre em: GA4 → Admin → Data Streams → selecione o stream → Measurement Protocol API Secrets',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    icon: '📗',
    description: 'Exporte relatórios automaticamente para planilhas',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'AIzaSy...', type: 'password' },
      { key: 'sheet_id', label: 'Sheet ID', placeholder: 'ID da planilha (da URL)' },
    ],
    helpUrl: 'https://console.cloud.google.com/apis/credentials',
    helpText: 'API Key: Google Cloud Console → Credentials. Sheet ID: é o código na URL da planilha entre /d/ e /edit',
  },
  {
    id: 'hotmart',
    name: 'Hotmart',
    icon: '🔥',
    description: 'Importe dados de vendas e comissões',
    fields: [
      { key: 'api_token', label: 'Token da API', placeholder: 'Seu token Hotmart...', type: 'password' },
    ],
    helpUrl: 'https://developers.hotmart.com/',
    helpText: 'Encontre em: Hotmart → Ferramentas → Credenciais da API → Gerar Token',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    icon: '⚡',
    description: 'Envie dados via webhooks para automações',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/...' },
    ],
    helpUrl: 'https://zapier.com/apps/webhook/integrations',
    helpText: 'Crie um Zap → Trigger: Webhooks by Zapier → Catch Hook → copie a URL',
  },
  {
    id: 'webhook',
    name: 'Webhook Personalizado',
    icon: '🔗',
    description: 'Envie notificações para qualquer endpoint',
    fields: [
      { key: 'webhook_url', label: 'URL do Webhook', placeholder: 'https://seu-servidor.com/webhook' },
      { key: 'secret', label: 'Secret (opcional)', placeholder: 'Chave secreta...', type: 'password' },
    ],
  },
  {
    id: 'apify',
    name: 'Apify',
    icon: '🕷️',
    description: 'Web scraping para análise de concorrentes, leads e dados de redes sociais',
    fields: [
      { key: 'api_token', label: 'API Token', placeholder: 'apify_api_xxxxxxxx...', type: 'password' },
    ],
    helpUrl: 'https://console.apify.com/account/integrations',
    helpText: 'Encontre em: console.apify.com → Account → Integrations → API tokens. Usado por Daniel (análise de concorrentes) e Davi (dados sociais).',
    comingSoon: true,
  },
  {
    id: 'resend',
    name: 'Resend (Email)',
    icon: '📧',
    description: 'Envio transacional de emails para campanhas do João',
    fields: [
      { key: 'api_key', label: 'API Key', placeholder: 're_xxxxxxxx...', type: 'password' },
      { key: 'from_email', label: 'Email de Envio', placeholder: 'noreply@seudominio.com' },
    ],
    helpUrl: 'https://resend.com/api-keys',
    helpText: 'Crie em: resend.com → API Keys → Create API Key. Domínio precisa ser verificado.',
    comingSoon: true,
  },
];

interface SavedIntegration {
  id: string;
  platform: string;
  is_active: boolean;
  last_sync_at: string | null;
}

export function IntegrationsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isLocked } = useIntegrationAccess();
  const [savedIntegrations, setSavedIntegrations] = useState<SavedIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, Record<string, string>>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('platform_integrations')
        .select('id, platform, is_active, last_sync_at')
        .eq('user_id', user.id);
      setSavedIntegrations((data || []) as SavedIntegration[]);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const getStatus = (platformId: string) => {
    return savedIntegrations.find((item) => item.platform === platformId && item.is_active);
  };

  const handleFieldChange = (platformId: string, fieldKey: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [platformId]: { ...(prev[platformId] || {}), [fieldKey]: value },
    }));
  };

  const handleTest = async (integration: IntegrationConfig) => {
    const credentials = formData[integration.id] || {};
    const missingFields = integration.fields.filter((field) => !credentials[field.key]?.trim());
    if (missingFields.length > 0) {
      toast({
        title: 'Campos obrigatórios',
        description: `Preencha: ${missingFields.map((field) => field.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setTesting(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke('test-integration', {
        body: { platform: integration.id, credentials },
      });
      if (error) throw error;
      toast({
        title: data?.success ? '✅ Teste bem-sucedido' : '❌ Teste falhou',
        description: data?.message || 'Resultado inesperado.',
        variant: data?.success ? 'default' : 'destructive',
      });
    } catch (err: any) {
      toast({
        title: 'Erro no teste',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setTesting(null);
    }
  };

  const handleSave = async (integration: IntegrationConfig) => {
    const credentials = formData[integration.id] || {};
    const requiredMissing = integration.fields
      .filter((field) => !field.label.toLowerCase().includes('opcional'))
      .filter((field) => !credentials[field.key]?.trim());

    if (requiredMissing.length > 0) {
      toast({
        title: 'Campos obrigatórios',
        description: `Preencha: ${requiredMissing.map((field) => field.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setSaving(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke('test-integration', {
        body: { platform: integration.id, credentials, action: 'save' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Integração salva!',
        description: `${integration.name} conectado com sucesso.`,
      });
      setExpandedId(null);
      setFormData((prev) => ({ ...prev, [integration.id]: {} }));
      await fetchIntegrations();
    } catch (err: any) {
      toast({
        title: 'Erro ao salvar',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  const handleDisconnect = async (integration: IntegrationConfig) => {
    try {
      const { error } = await supabase.functions.invoke('test-integration', {
        body: { platform: integration.id, action: 'disconnect' },
      });
      if (error) throw error;
      toast({
        title: 'Desconectado',
        description: `${integration.name} foi desconectado.`,
      });
      await fetchIntegrations();
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const upgradeIntegration = INTEGRATIONS.find((i) => i.id === upgradeFor) || null;

  return (
    <div className="space-y-4">
      {INTEGRATIONS.map((integration) => {
        const status = getStatus(integration.id);
        const isExpanded = expandedId === integration.id;
        const fields = formData[integration.id] || {};
        const comingSoon = integration.comingSoon === true;
        const locked = !comingSoon && isLocked(integration.id);

        // Integracao sem backend ainda (so a casca) -> "Em breve" desabilitada.
        if (comingSoon) {
          return (
            <Card key={integration.id} className="overflow-hidden border-border/50 bg-card/40 opacity-70">
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl grayscale">{integration.icon}</div>
                    <div>
                      <p className="font-medium">{integration.name}</p>
                      <p className="text-xs text-muted-foreground">{integration.description}</p>
                    </div>
                  </div>
                  <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-500">
                    <Clock className="mr-1 h-3 w-3" />
                    Em breve
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        }

        // Bloqueada pelo plano Basico -> card visivel + cadeado + CTA upgrade.
        if (locked) {
          return (
            <Card key={integration.id} className="relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
              <div className="absolute right-3 top-3 z-30">
                <PlanProBadge />
              </div>
              <CardContent className="p-0">
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">{integration.icon}</div>
                    <div>
                      <p className="font-medium">{integration.name}</p>
                      <p className="text-xs text-muted-foreground">{integration.description}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled>
                    Conectar
                  </Button>
                </div>
              </CardContent>
              <ProLockOverlay onUpgrade={() => setUpgradeFor(integration.id)} />
            </Card>
          );
        }

        return (
          <Card key={integration.id} className="overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{integration.icon}</div>
                  <div>
                    <p className="font-medium">{integration.name}</p>
                    <p className="text-xs text-muted-foreground">{integration.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status ? (
                    <>
                      <Badge className="border-success/30 bg-success/20 text-success">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Conectado
                      </Badge>
                      <Button variant="outline" size="sm" onClick={() => handleDisconnect(integration)}>
                        <LogOut className="mr-1 h-3 w-3" />
                        Desconectar
                      </Button>
                    </>
                  ) : (
                    <>
                      <Badge variant="secondary">
                        <XCircle className="mr-1 h-3 w-3" />
                        Não conectado
                      </Badge>
                      <Button
                        size="sm"
                        variant={isExpanded ? 'secondary' : 'default'}
                        className={isExpanded ? '' : 'gradient-primary'}
                        onClick={() => setExpandedId(isExpanded ? null : integration.id)}
                      >
                        {isExpanded ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                        {isExpanded ? 'Fechar' : 'Conectar'}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && !status && (
                <div className="space-y-4 border-t border-border/50 bg-muted/20 p-4">
                  {integration.fields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={`${integration.id}-${field.key}`} className="text-sm">
                        {field.label}
                      </Label>
                      <Input
                        id={`${integration.id}-${field.key}`}
                        type={field.type || 'text'}
                        placeholder={field.placeholder}
                        value={fields[field.key] || ''}
                        onChange={(event) => handleFieldChange(integration.id, field.key, event.target.value)}
                      />
                    </div>
                  ))}

                  {integration.helpText && (
                    <p className="text-xs leading-relaxed text-muted-foreground">{integration.helpText}</p>
                  )}

                  {integration.helpSteps && integration.helpSteps.length > 0 && (
                    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
                      <p className="text-xs font-medium text-foreground">Como conseguir a chave</p>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {integration.helpSteps.map((step, index) => (
                          <li key={`${integration.id}-step-${index}`}>
                            {index + 1}. {step}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => handleTest(integration)} disabled={testing === integration.id}>
                      {testing === integration.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Testar Conexão
                    </Button>
                    <Button size="sm" className="gradient-primary" onClick={() => handleSave(integration)} disabled={saving === integration.id}>
                      {saving === integration.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      Conectar e Salvar
                    </Button>
                    {integration.helpUrl && (
                      <Button variant="link" size="sm" className="h-auto p-0" asChild>
                        <a href={integration.helpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs">
                          Ver documentação <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <UpgradeProDialog
        open={!!upgradeFor}
        onOpenChange={(o) => !o && setUpgradeFor(null)}
        integrationName={upgradeIntegration?.name}
      />
    </div>
  );
}
