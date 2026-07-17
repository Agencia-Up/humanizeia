import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle, XCircle, Loader2, LogOut, ExternalLink,
  Globe, Building2, Radio, FileImage
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
    consumeOAuthSession,
    selectAccount,
    disconnect,
  } = useMetaConnection();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAddAnother, setShowAddAnother] = useState(false);
  // Trava pra o auto-disparo do OAuth acontecer no máximo uma vez por montagem.
  const autoStartedRef = useRef(false);

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code');
    const isCallback = searchParams.get('meta_callback');
    const oauthSession = searchParams.get('meta_oauth_session');
    const oauthError = searchParams.get('meta_error');

    if (oauthSession) {
      consumeOAuthSession(oauthSession);
      searchParams.delete('meta_oauth_session');
      searchParams.delete('meta_accounts');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    if (oauthError) {
      searchParams.delete('meta_error');
      setSearchParams(searchParams, { replace: true });
      return;
    }

    if (code && isCallback) {
      handleCallback(code);
      searchParams.delete('code');
      searchParams.delete('meta_callback');
      searchParams.delete('state');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const handleSelectFromList = (account: any) => {
    setSelectedAccountId(account.id);
    selectAccount(account);
    setShowAddAnother(false);
  };

  const hasDetectedAssets = availableAccounts.length > 0 || pixels.length > 0 || pages.length > 0 || businesses.length > 0;

  // Auto-inicia o login do Facebook quando o usuário chega aqui pelo botão
  // "Conectar" das Integrações (que navega com ?autoconnect=1). Assim ele cai
  // DIRETO no Facebook, sem tela intermediária de token manual — que é como
  // 100% dos clientes conectam. Guardas pra nunca entrar em loop:
  //  - só age 1x por montagem (autoStartedRef);
  //  - espera a conexão carregar (isLoading) pra não redirecionar quem já está
  //    conectado (ex.: quem abriu esta tela pra ver "Detalhes");
  //  - NÃO dispara no meio de um retorno do OAuth (meta_oauth_session/meta_error/
  //    code+meta_callback) — senão nunca consumiria o retorno / nunca veria o erro;
  //  - remove o ?autoconnect da URL pra o "voltar" do navegador não re-disparar.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (searchParams.get('autoconnect') !== '1') return;
    if (isLoading) return;
    const emRetornoOAuth =
      !!searchParams.get('meta_oauth_session') ||
      !!searchParams.get('meta_error') ||
      (!!searchParams.get('code') && !!searchParams.get('meta_callback'));
    if (emRetornoOAuth) return;
    if (connectedAccount || hasDetectedAssets || isConnecting) return;

    autoStartedRef.current = true;
    searchParams.delete('autoconnect');
    setSearchParams(searchParams, { replace: true });
    startOAuth();
  }, [isLoading, connectedAccount, hasDetectedAssets, isConnecting, searchParams, setSearchParams, startOAuth]);

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
          {connectedAccount && !showAddAnother ? (
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
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" onClick={disconnect}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Desconectar
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowAddAnother(true)}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Conectar outra conta
                </Button>
              </div>
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
                Conectar com Facebook
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
