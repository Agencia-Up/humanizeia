import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Loader2, LogOut, ExternalLink, Eye, EyeOff, KeyRound, Hash } from 'lucide-react';
import { useMetaConnection } from '@/hooks/useMetaConnection';

export function MetaAdsSettingsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    isConnecting,
    isLoading,
    connectedAccount,
    availableAccounts,
    startOAuth,
    handleCallback,
    selectAccount,
    disconnect,
    connectWithToken,
  } = useMetaConnection();

  const [accessToken, setAccessToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const isCallback = searchParams.get('meta_callback');
    if (code && isCallback) {
      handleCallback(code);
      searchParams.delete('code');
      searchParams.delete('meta_callback');
      searchParams.delete('state');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const handleConnectWithToken = async () => {
    if (!accessToken.trim()) return;
    const result = await connectWithToken(accessToken.trim(), accountId.trim() || undefined);
    if (result.success && !result.needsSelection) {
      setAccessToken('');
      setAccountId('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/20">
                <span className="text-2xl">📘</span>
              </div>
              <div>
                <CardTitle className="text-lg">Meta Ads</CardTitle>
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
                  <span className="text-muted-foreground">ID:</span>
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
          ) : availableAccounts.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecione a conta de anúncios que deseja usar:
              </p>
              {availableAccounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 p-3"
                >
                  <div>
                    <p className="font-medium text-sm">{account.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{account.id}</p>
                  </div>
                  <Button
                    size="sm"
                    className="gradient-primary"
                    onClick={() => selectAccount(account)}
                    disabled={isConnecting}
                  >
                    {isConnecting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Selecionar
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Manual Token Fields */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="meta-token" className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4" />
                    Access Token
                  </Label>
                  <div className="relative">
                    <Input
                      id="meta-token"
                      type={showToken ? 'text' : 'password'}
                      placeholder="Cole seu Access Token aqui..."
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      disabled={isConnecting}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meta-account-id" className="flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    Ad Account ID
                    <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Input
                    id="meta-account-id"
                    placeholder="Ex: 123456789 ou act_123456789"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={isConnecting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Se não informar, mostraremos todas as contas para você escolher.
                  </p>
                </div>

                <Button
                  className="gradient-primary w-full"
                  onClick={handleConnectWithToken}
                  disabled={isConnecting || !accessToken.trim()}
                  size="lg"
                >
                  {isConnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Conectar e Validar
                </Button>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* Step-by-Step Guide */}
      {!connectedAccount && availableAccounts.length === 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">📋 Como obter suas credenciais</CardTitle>
            <CardDescription>
              Siga estes passos para conectar sua conta Meta Ads em menos de 5 minutos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            {/* Step 1 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  1
                </div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Acesse o Gerenciador de Negócios</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Vá em <strong>Configurações do Negócio → Contas → Contas de Anúncio</strong> e copie o <strong>ID da conta</strong> (número abaixo do nome).
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://business.facebook.com/settings/ad-accounts" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Gerenciador de Negócios
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  2
                </div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Abra o Graph API Explorer</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Selecione seu app (ou crie um no Meta for Developers). Em <strong>Permissões</strong>, marque:
                </p>
                <ul className="text-sm text-muted-foreground mt-1 space-y-0.5 list-disc list-inside">
                  <li><code className="bg-muted px-1 rounded text-xs">ads_read</code></li>
                  <li><code className="bg-muted px-1 rounded text-xs">ads_management</code></li>
                  <li><code className="bg-muted px-1 rounded text-xs">read_insights</code></li>
                  <li><code className="bg-muted px-1 rounded text-xs">business_management</code></li>
                </ul>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Graph API Explorer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  3
                </div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Gere o Token de Acesso</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Clique em <strong>"Generate Access Token"</strong> e autorize o app. Copie o token gerado.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-4 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">
                  4
                </div>
              </div>
              <div className="pt-1">
                <p className="font-medium text-sm">Estenda para Token de Longa Duração (60 dias)</p>
                <p className="text-sm text-muted-foreground mt-1">
                  No Explorer, clique no <strong>ℹ️</strong> ao lado do token → <strong>"Open in Access Token Debugger"</strong> → <strong>"Extend Access Token"</strong>. Copie o novo token de longa duração.
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Access Token Debugger
                    <ExternalLink className="h-3 w-3" />
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
