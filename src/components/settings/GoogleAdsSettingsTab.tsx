import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, LogOut, ExternalLink } from 'lucide-react';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { OAuthButton } from '@/components/onboarding/OAuthButton';
import { AccountSelector } from '@/components/onboarding/AccountSelector';

export function GoogleAdsSettingsTab() {
  const { isConnecting, isLoading, connectedAccount, availableAccounts, startOAuth, handleCallback, selectAccount, disconnect } = useGoogleAdsConnection();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle Google OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const isGoogleCallback = searchParams.get('google_callback');
    if (code && isGoogleCallback) {
      handleCallback(code);
      // Clean up URL
      searchParams.delete('code');
      searchParams.delete('google_callback');
      searchParams.delete('scope');
      searchParams.delete('authuser');
      searchParams.delete('prompt');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const status = connectedAccount
    ? 'connected' as const
    : isConnecting
      ? 'connecting' as const
      : 'disconnected' as const;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/20">
                <svg viewBox="0 0 24 24" className="h-6 w-6">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              </div>
              <div>
                <CardTitle className="text-lg">Google Ads</CardTitle>
                <CardDescription>
                  Conecte sua conta para acessar dados reais de campanhas
                </CardDescription>
              </div>
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : connectedAccount ? (
              <Badge className="bg-success/20 text-success border-success/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                Não conectado
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {connectedAccount ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Conta:</span>
                  <span className="font-medium">{connectedAccount.account_name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Customer ID:</span>
                  <span className="font-mono text-xs">{connectedAccount.account_id}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Moeda:</span>
                  <span>{connectedAccount.currency || 'BRL'}</span>
                </div>
                {connectedAccount.last_sync_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Última sync:</span>
                    <span>{new Date(connectedAccount.last_sync_at).toLocaleString('pt-BR')}</span>
                  </div>
                )}
              </div>
              <Button variant="destructive" size="sm" onClick={disconnect}>
                <LogOut className="h-4 w-4 mr-2" />
                Desconectar
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <OAuthButton
                platform="google"
                status={status}
                onClick={startOAuth}
              />

              {/* Account selection if multiple accounts returned */}
              {availableAccounts.length > 1 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Selecione a conta:</p>
                  <AccountSelector
                    accounts={availableAccounts.map(a => ({
                      ...a,
                      timezone_name: a.timezone,
                      account_status: 1,
                    }))}
                    selectedId={null}
                    onSelect={(account) => selectAccount(account as any)}
                    emptyMessage="Nenhuma conta encontrada."
                  />
                </div>
              )}

              <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>💡 Ao clicar em "Conectar com Google", você será redirecionado para autorizar o acesso às suas campanhas do Google Ads.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Help */}
      {!connectedAccount && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">❓ Precisa de ajuda?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>A conexão é feita via OAuth — você só precisa autorizar com sua conta Google. Não é necessário inserir tokens manualmente.</p>
            <Button variant="link" className="p-0 h-auto text-xs" asChild>
              <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                Abrir Google Ads <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
