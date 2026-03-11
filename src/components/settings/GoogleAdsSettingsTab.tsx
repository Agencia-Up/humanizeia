import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, LogOut, ExternalLink, Eye, EyeOff, KeyRound, Hash, Shield, RefreshCw } from 'lucide-react';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';

export function GoogleAdsSettingsTab() {
  const { isConnecting, isLoading, connectedAccount, connect, disconnect } = useGoogleAdsConnection();

  const [developerToken, setDeveloperToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);

  const handleConnect = async () => {
    const result = await connect({
      developer_token: developerToken.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      refresh_token: refreshToken.trim(),
      customer_id: customerId.trim(),
    });
    if (result.success) {
      setDeveloperToken('');
      setClientId('');
      setClientSecret('');
      setRefreshToken('');
      setCustomerId('');
    }
  };

  const isFormValid = developerToken.trim() && clientId.trim() && clientSecret.trim() && refreshToken.trim() && customerId.trim();

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/20">
                <span className="text-2xl">🔴</span>
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
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Cole suas credenciais abaixo para conectar instantaneamente.
                </p>
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {showSecrets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showSecrets ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="g-customer-id" className="flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    Customer ID
                  </Label>
                  <Input
                    id="g-customer-id"
                    placeholder="123-456-7890"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    disabled={isConnecting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="g-dev-token" className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    Developer Token
                  </Label>
                  <Input
                    id="g-dev-token"
                    type={showSecrets ? 'text' : 'password'}
                    placeholder="Seu developer token..."
                    value={developerToken}
                    onChange={(e) => setDeveloperToken(e.target.value)}
                    disabled={isConnecting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="g-client-id" className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    OAuth Client ID
                  </Label>
                  <Input
                    id="g-client-id"
                    type={showSecrets ? 'text' : 'password'}
                    placeholder="xxxxxxx.apps.googleusercontent.com"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    disabled={isConnecting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="g-client-secret" className="flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    OAuth Client Secret
                  </Label>
                  <Input
                    id="g-client-secret"
                    type={showSecrets ? 'text' : 'password'}
                    placeholder="GOCSPX-xxxxxxxx"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    disabled={isConnecting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="g-refresh-token" className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Refresh Token
                </Label>
                <Input
                  id="g-refresh-token"
                  type={showSecrets ? 'text' : 'password'}
                  placeholder="1//xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  disabled={isConnecting}
                />
              </div>

              <Button
                className="gradient-primary w-full"
                onClick={handleConnect}
                disabled={isConnecting || !isFormValid}
                size="lg"
              >
                {isConnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Conectar e Validar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step-by-Step Guide */}
      {!connectedAccount && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">📋 Como obter suas credenciais</CardTitle>
            <CardDescription>
              5 dados necessários — siga os passos abaixo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            {/* Step 1 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">1</div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Customer ID</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Abra o Google Ads → o ID aparece no canto superior direito no formato <code className="bg-muted px-1 rounded text-xs">xxx-xxx-xxxx</code>.
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Google Ads <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">2</div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Developer Token</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No Google Ads, vá em <strong>Tools → API Center</strong>. Copie seu Developer Token. Se não tiver, solicite acesso à API.
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir API Center <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">3</div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">OAuth Client ID e Client Secret</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No Google Cloud Console → <strong>APIs & Services → Credentials</strong> → crie um <strong>OAuth 2.0 Client ID</strong> (tipo: Web Application). Copie o Client ID e Client Secret.
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Google Cloud Console <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">4</div>
              </div>
              <div className="pt-1">
                <p className="font-medium text-sm">Refresh Token</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Abra o <strong>OAuth 2.0 Playground</strong> → use seu Client ID/Secret → selecione o scope <code className="bg-muted px-1 rounded text-xs">https://www.googleapis.com/auth/adwords</code> → autorize e copie o <strong>Refresh Token</strong>.
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir OAuth Playground <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
