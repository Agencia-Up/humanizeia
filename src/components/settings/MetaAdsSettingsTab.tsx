import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle, XCircle, Loader2, LogOut, ExternalLink, Eye, EyeOff,
  KeyRound, Hash, Globe, Building2, Radio, FileImage
} from 'lucide-react';
import { useMetaConnection, MetaPixel, MetaPage, MetaBusiness } from '@/hooks/useMetaConnection';
import { AccountSelector } from '@/components/onboarding/AccountSelector';

export function MetaAdsSettingsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    isConnecting,
    isLoading,
    connectedAccount,
    availableAccounts,
    pixels,
    pages,
    businesses,
    startOAuth,
    handleCallback,
    selectAccount,
    disconnect,
    connectWithToken,
  } = useMetaConnection();

  const [accessToken, setAccessToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAddAnother, setShowAddAnother] = useState(false);

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

  const handleSelectFromList = (account: any) => {
    setSelectedAccountId(account.id);
    selectAccount(account);
  };

  const hasDetectedAssets = availableAccounts.length > 0 || pixels.length > 0 || pages.length > 0 || businesses.length > 0;

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
          ) : hasDetectedAssets ? (
            <DetectedAssetsView
              accounts={availableAccounts}
              pixels={pixels}
              pages={pages}
              businesses={businesses}
              isConnecting={isConnecting}
              selectedAccountId={selectedAccountId}
              onSelectAccount={handleSelectFromList}
            />
          ) : (
            <div className="space-y-5">
              {/* OAuth Button */}
              <Button
                className="w-full h-12 text-base bg-[#1877F2] hover:bg-[#166FE5] text-white"
                onClick={startOAuth}
                disabled={isConnecting}
                size="lg"
              >
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <span className="mr-2 text-lg">f</span>
                )}
                Login com Facebook
              </Button>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>ou conecte manualmente</span>
                <div className="h-px flex-1 bg-border" />
              </div>

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
                    Se não informar, detectaremos automaticamente todas as contas, pixels e páginas.
                  </p>
                </div>

                <Button
                  className="gradient-primary w-full"
                  onClick={handleConnectWithToken}
                  disabled={isConnecting || !accessToken.trim()}
                  size="lg"
                >
                  {isConnecting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Conectar e Detectar Contas
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Guide - only show when not connected and no assets detected */}
      {!connectedAccount && !hasDetectedAssets && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">📋 Como conectar</CardTitle>
            <CardDescription>
              Use o botão "Login com Facebook" acima — é a forma mais rápida e segura. Ou siga o guia manual abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            <div className="flex gap-4 pb-6 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">1</div>
                <div className="w-px flex-1 bg-border/50 mt-2" />
              </div>
              <div className="pt-1 pb-2">
                <p className="font-medium text-sm">Abra o Graph API Explorer</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Selecione seu app e marque as permissões: <code className="bg-muted px-1 rounded text-xs">ads_read</code>, <code className="bg-muted px-1 rounded text-xs">ads_management</code>, <code className="bg-muted px-1 rounded text-xs">read_insights</code>, <code className="bg-muted px-1 rounded text-xs">business_management</code>
                </p>
                <Button variant="link" className="p-0 h-auto mt-1 text-xs" asChild>
                  <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Abrir Graph API Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex gap-4 relative">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shrink-0">2</div>
              </div>
              <div className="pt-1">
                <p className="font-medium text-sm">Gere e cole o Token acima</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Nós detectamos automaticamente suas contas de anúncios, pixels e páginas.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Detected assets view with tabs
function DetectedAssetsView({
  accounts,
  pixels,
  pages,
  businesses,
  isConnecting,
  selectedAccountId,
  onSelectAccount,
}: {
  accounts: any[];
  pixels: MetaPixel[];
  pages: MetaPage[];
  businesses: MetaBusiness[];
  isConnecting: boolean;
  selectedAccountId: string | null;
  onSelectAccount: (account: any) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-primary/10 p-3 text-sm text-primary">
        <CheckCircle className="h-4 w-4 shrink-0" />
        <span className="font-medium">
          Detectamos {accounts.length} conta(s), {pixels.length} pixel(s), {pages.length} página(s)
          {businesses.length > 0 && `, ${businesses.length} Business Manager(s)`}
        </span>
      </div>

      <Tabs defaultValue="accounts" className="w-full">
        <TabsList className="w-full grid grid-cols-4 bg-muted/50">
          <TabsTrigger value="accounts" className="gap-1 text-xs">
            <Globe className="h-3 w-3" />
            Contas ({accounts.length})
          </TabsTrigger>
          <TabsTrigger value="pixels" className="gap-1 text-xs">
            <Radio className="h-3 w-3" />
            Pixels ({pixels.length})
          </TabsTrigger>
          <TabsTrigger value="pages" className="gap-1 text-xs">
            <FileImage className="h-3 w-3" />
            Páginas ({pages.length})
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-1 text-xs">
            <Building2 className="h-3 w-3" />
            BM ({businesses.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-3">
          <p className="text-sm text-muted-foreground mb-3">
            Selecione a conta de anúncios principal:
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between rounded-lg border border-border/50 p-3 hover:border-primary/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{account.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono">{account.id}</span>
                    {account.currency && <span>• {account.currency}</span>}
                    {account.business_name && (
                      <span className="truncate">• {account.business_name}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="gradient-primary shrink-0 ml-3"
                  onClick={() => onSelectAccount(account)}
                  disabled={isConnecting}
                >
                  {isConnecting && selectedAccountId === account.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Usar esta'
                  )}
                </Button>
              </div>
            ))}
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma conta de anúncios encontrada.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="pixels" className="mt-3">
          <p className="text-sm text-muted-foreground mb-3">
            Pixels vinculados às suas contas:
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pixels.map((pixel) => (
              <div
                key={pixel.id}
                className="flex items-center justify-between rounded-lg border border-border/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{pixel.name}</p>
                    {pixel.is_unavailable ? (
                      <Badge variant="secondary" className="text-[10px] shrink-0">Inativo</Badge>
                    ) : (
                      <Badge className="bg-success/20 text-success border-success/30 text-[10px] shrink-0">Ativo</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{pixel.id}</span>
                    <span>• {pixel.ad_account_name}</span>
                  </div>
                  {pixel.last_fired_time && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Último disparo: {new Date(pixel.last_fired_time).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {pixels.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum pixel encontrado.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="pages" className="mt-3">
          <p className="text-sm text-muted-foreground mb-3">
            Páginas do Facebook vinculadas:
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {pages.map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 p-3"
              >
                {page.picture_url ? (
                  <img
                    src={page.picture_url}
                    alt={page.name}
                    className="h-10 w-10 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                    <FileImage className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{page.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {page.category && <span>{page.category}</span>}
                    {page.fan_count > 0 && (
                      <span>• {page.fan_count.toLocaleString('pt-BR')} curtidas</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {pages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma página encontrada.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="business" className="mt-3">
          <p className="text-sm text-muted-foreground mb-3">
            Business Managers identificados:
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {businesses.map((bm) => (
              <div
                key={bm.id}
                className="flex items-center gap-3 rounded-lg border border-border/50 p-3"
              >
                {bm.picture_url ? (
                  <img
                    src={bm.picture_url}
                    alt={bm.name}
                    className="h-10 w-10 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{bm.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{bm.id}</span>
                    {bm.verification_status && (
                      <Badge
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {bm.verification_status === 'verified' ? '✓ Verificado' : bm.verification_status}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {businesses.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum Business Manager encontrado.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
