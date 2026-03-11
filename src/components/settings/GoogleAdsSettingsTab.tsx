import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle, XCircle, Loader2, LogOut, ExternalLink, ChevronRight
} from 'lucide-react';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';

function GoogleAdsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function GoogleAdsSettingsTab() {
  const {
    isConnecting, isLoading, connectedAccount, availableAccounts,
    startOAuth, handleCallback, selectAccount, disconnect
  } = useGoogleAdsConnection();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const isGoogleCallback = searchParams.get('google_callback');
    if (code && isGoogleCallback) {
      handleCallback(code);
      searchParams.delete('code');
      searchParams.delete('google_callback');
      searchParams.delete('scope');
      searchParams.delete('authuser');
      searchParams.delete('prompt');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const isConnected = !!connectedAccount;

  return (
    <div className="space-y-6">
      {/* Connection Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <GoogleAdsIcon />
              </div>
              <div>
                <CardTitle className="text-lg">Google Ads</CardTitle>
                <CardDescription>Conecte sua conta para gerenciar campanhas e ver métricas de performance</CardDescription>
              </div>
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Badge
                variant={isConnected ? 'default' : 'secondary'}
                className={isConnected ? 'bg-success/20 text-success border-success/30' : ''}
              >
                {isConnected ? <><CheckCircle className="h-3 w-3 mr-1" /> Conectado</> : <><XCircle className="h-3 w-3 mr-1" /> Desconectado</>}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected ? (
            <>
              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Conta:</span>
                  <span className="font-medium">{connectedAccount!.account_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Customer ID:</span>
                  <span className="font-mono text-xs">{connectedAccount!.account_id}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Moeda:</span>
                  <span>{connectedAccount!.currency || 'BRL'}</span>
                </div>
                {connectedAccount!.last_sync_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Última sync:</span>
                    <span>{new Date(connectedAccount!.last_sync_at).toLocaleString('pt-BR')}</span>
                  </div>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={disconnect} className="gap-2">
                <LogOut className="h-4 w-4" />
                Desconectar
              </Button>
            </>
          ) : (
            <>
              {/* Account selection */}
              {availableAccounts.length > 1 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span className="font-medium">
                      {availableAccounts.length} conta(s) encontrada(s). Selecione qual usar:
                    </span>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {availableAccounts.map((account) => (
                      <div
                        key={account.id}
                        className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:border-primary/40 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{account.name}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-mono">{account.id}</span>
                            {account.currency && <span>• {account.currency}</span>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="gradient-primary shrink-0 ml-3"
                          onClick={() => selectAccount(account)}
                          disabled={isConnecting}
                        >
                          {isConnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Usar esta'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Alert>
                    <AlertDescription>
                      Conecte sua conta Google para importar automaticamente campanhas, métricas e conversões do Google Ads.
                    </AlertDescription>
                  </Alert>
                  <Button
                    onClick={startOAuth}
                    disabled={isConnecting}
                    className="gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm"
                  >
                    {isConnecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <GoogleAdsIcon className="h-4 w-4" />
                    )}
                    Conectar com Google
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Metrics Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">Métricas Google Ads Disponíveis</CardTitle>
          <CardDescription>Métricas sincronizadas automaticamente após a conexão</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {[
              'Impressões', 'Cliques', 'CTR', 'CPC Médio', 'Custo Total',
              'Conversões', 'ROAS', 'Custo/Conversão',
              'Valor de Conversão', 'Taxa de Impressão',
              'Quality Score', 'Orçamento Diário', 'Status da Campanha',
              'Tipo de Campanha', 'Alcance',
            ].map((metric) => (
              <div key={metric} className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-2 text-xs bg-muted/20">
                <CheckCircle className="h-3 w-3 text-primary" />
                {metric}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step by step guide */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">📋 Como conectar</CardTitle>
          <CardDescription>Siga o passo a passo para integrar sua conta Google Ads</CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <StepItem number={1} title='Clique em "Conectar com Google"' description="Você será redirecionado para a página de login do Google. Use a mesma conta que você usa no Google Ads." isLast={false} />
          <StepItem number={2} title="Autorize o acesso" description='O Google vai pedir permissão para acessar seus dados de campanhas. Clique em "Permitir". Nenhuma senha é compartilhada.' isLast={false} />
          <StepItem number={3} title="Selecione sua conta" description="Se você tem mais de uma conta no Google Ads, escolha qual deseja usar aqui na plataforma." isLast={false} />
          <StepItem number={4} title="Pronto!" description="Suas campanhas, métricas e dados de conversão serão carregados automaticamente no Dashboard." isLast={true} />
        </CardContent>
      </Card>

      {/* Pre-requisites for admins */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">⚙️ Pré-requisitos técnicos</CardTitle>
          <CardDescription>Para o responsável técnico configurar a integração</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="space-y-2">
            <p>1. Criar projeto no <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></p>
            <p>2. Ativar a <strong>Google Ads API</strong> no projeto</p>
            <p>3. Criar credenciais <strong>OAuth 2.0</strong> (tipo: Aplicativo Web)</p>
            <p>4. Obter <strong>Developer Token</strong> em <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Central de API <ExternalLink className="h-3 w-3" /></a></p>
            <p>5. Configurar os Secrets: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">GOOGLE_CLIENT_ID</code>, <code className="bg-muted px-1.5 py-0.5 rounded text-xs">GOOGLE_CLIENT_SECRET</code>, <code className="bg-muted px-1.5 py-0.5 rounded text-xs">GOOGLE_ADS_DEVELOPER_TOKEN</code></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepItem({ number, title, description, isLast }: {
  number: number; title: string; description: string; isLast: boolean;
}) {
  return (
    <div className="flex gap-4 pb-5 relative">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
          {number}
        </div>
        {!isLast && <div className="w-px flex-1 bg-border/50 mt-2" />}
      </div>
      <div className="pt-1 pb-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}
