import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CheckCircle, XCircle, Loader2, LogOut, ExternalLink, 
  BarChart3, LineChart, Tag, ChevronRight, Info, AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Google logo SVG component
function GoogleLogo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function GoogleSettingsTab() {
  const {
    isConnecting, isLoading, connectedAccount, availableAccounts,
    startOAuth, handleCallback, selectAccount, disconnect
  } = useGoogleAdsConnection();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle Google OAuth callback
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

  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20">
                <GoogleLogo />
              </div>
              <div>
                <CardTitle className="text-lg">Google Integração</CardTitle>
                <CardDescription>
                  Google Ads, Analytics 4 e Tag Manager em um só lugar
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
                  <span className="text-muted-foreground">Conta Google Ads:</span>
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
                    <span className="text-muted-foreground">Última sincronização:</span>
                    <span>{new Date(connectedAccount.last_sync_at).toLocaleString('pt-BR')}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="destructive" size="sm" onClick={disconnect}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Desconectar Google
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Main OAuth Button */}
              <Button
                className="w-full h-12 text-base bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm"
                onClick={startOAuth}
                disabled={isConnecting}
                size="lg"
              >
                {isConnecting ? (
                  <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                ) : (
                  <GoogleLogo className="h-5 w-5 mr-3" />
                )}
                Conectar com Google
              </Button>

              {/* Account selection if multiple accounts returned */}
              {availableAccounts.length > 1 && (
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
              )}

              {/* Security notice */}
              <div className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-success shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground/80">Conexão segura via OAuth 2.0</p>
                  <p className="mt-0.5">Você será redirecionado para o Google. Nenhuma senha é compartilhada com a plataforma.</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Services Tabs */}
      {connectedAccount ? (
        <ConnectedServicesView />
      ) : (
        <PreConnectionGuide />
      )}
    </div>
  );
}

// ============================================================
// View when connected - shows status of each service
// ============================================================
function ConnectedServicesView() {
  return (
    <Tabs defaultValue="ads" className="space-y-4">
      <TabsList className="w-full grid grid-cols-3 bg-muted/50">
        <TabsTrigger value="ads" className="gap-1.5 text-xs sm:text-sm">
          <BarChart3 className="h-4 w-4" />
          Google Ads
        </TabsTrigger>
        <TabsTrigger value="analytics" className="gap-1.5 text-xs sm:text-sm">
          <LineChart className="h-4 w-4" />
          Analytics 4
        </TabsTrigger>
        <TabsTrigger value="gtm" className="gap-1.5 text-xs sm:text-sm">
          <Tag className="h-4 w-4" />
          Tag Manager
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ads">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <BarChart3 className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Google Ads</CardTitle>
                  <CardDescription className="text-xs">
                    Gerencie campanhas, orçamentos e métricas
                  </CardDescription>
                </div>
              </div>
              <Badge className="bg-success/20 text-success border-success/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                Ativo
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>✅ Campanhas e métricas sendo sincronizadas</p>
              <p>✅ Controle de orçamento e status disponível</p>
              <p>✅ Dados de conversão e ROAS integrados</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground/80 mb-1">📊 O que você pode fazer:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Ver performance de todas as campanhas no Dashboard</li>
                <li>Pausar ou ativar campanhas diretamente</li>
                <li>Receber alertas automáticos de anomalias</li>
                <li>Usar o MIDAS para otimizar campanhas automaticamente</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="analytics">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <LineChart className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Google Analytics 4</CardTitle>
                  <CardDescription className="text-xs">
                    Dados de tráfego, conversões e comportamento do usuário
                  </CardDescription>
                </div>
              </div>
              <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Em breve
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>🔜 Relatórios de tráfego do site</p>
              <p>🔜 Funil de conversão (visita → compra)</p>
              <p>🔜 Origens de tráfego (de onde vêm seus visitantes)</p>
              <p>🔜 Dados demográficos da audiência</p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs">
              <p className="text-amber-400 font-medium">⚡ Este recurso será ativado em breve.</p>
              <p className="text-muted-foreground mt-1">
                Sua conta Google já está conectada com as permissões necessárias. 
                Quando o recurso for liberado, seus dados do Analytics estarão disponíveis automaticamente.
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="gtm">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
                  <Tag className="h-5 w-5 text-cyan-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Google Tag Manager</CardTitle>
                  <CardDescription className="text-xs">
                    Gerencie tags e pixels do seu site
                  </CardDescription>
                </div>
              </div>
              <Badge variant="secondary">
                <Info className="h-3 w-3 mr-1" />
                Opcional
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>🏷️ Visualize todas as tags instaladas no site</p>
              <p>🏷️ Gerencie pixels do Meta, Google e TikTok</p>
              <p>🏷️ Adicione novas tags sem precisar mexer no código</p>
            </div>
            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground/80 mb-1">ℹ️ O que é Tag Manager?</p>
              <p>
                É uma ferramenta do Google que permite adicionar códigos de rastreamento (como o Pixel do Facebook 
                ou Google Analytics) no seu site sem precisar de um programador. Se você já usa GTM, essa integração 
                permite gerenciar tudo por aqui.
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

// ============================================================
// Pre-connection guide - step by step for beginners
// ============================================================
function PreConnectionGuide() {
  return (
    <div className="space-y-6">
      {/* What will be connected */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">🔗 O que será conectado?</CardTitle>
          <CardDescription>
            Com um único login, você terá acesso a todos os serviços Google:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ServicePreviewCard
            icon={<BarChart3 className="h-5 w-5 text-blue-500" />}
            title="Google Ads"
            description="Veja quanto está gastando, quantas pessoas clicaram nos seus anúncios e quantas compraram."
            features={[
              'Ver todas as campanhas em um só lugar',
              'Saber quanto está gastando por dia',
              'Descobrir quais anúncios vendem mais',
              'Pausar anúncios que não funcionam'
            ]}
            priority="Alta"
            priorityColor="text-red-400"
          />

          <ServicePreviewCard
            icon={<LineChart className="h-5 w-5 text-orange-500" />}
            title="Google Analytics 4"
            description="Entenda quem visita seu site, de onde vêm e o que fazem antes de comprar."
            features={[
              'Quantas pessoas visitam seu site por dia',
              'De onde vêm (Google, Instagram, direto)',
              'Quais páginas são mais acessadas',
              'Quantos visitantes viram compradores'
            ]}
            priority="Alta"
            priorityColor="text-red-400"
          />

          <ServicePreviewCard
            icon={<Tag className="h-5 w-5 text-cyan-500" />}
            title="Google Tag Manager"
            description="Gerencie os códigos de rastreamento do seu site sem precisar de programador."
            features={[
              'Ver quais tags estão instaladas',
              'Adicionar novos pixels de rastreamento',
              'Tudo sem mexer no código do site'
            ]}
            priority="Opcional"
            priorityColor="text-muted-foreground"
          />
        </CardContent>
      </Card>

      {/* Step by step guide */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">📋 Passo a passo para conectar</CardTitle>
          <CardDescription>
            Siga estas etapas para integrar sua conta Google. Leva menos de 2 minutos!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0">
          <StepItem
            number={1}
            title='Clique em "Conectar com Google"'
            description="Use o botão azul no topo desta página. Você será levado para a página de login do Google."
            isLast={false}
          />
          <StepItem
            number={2}
            title="Faça login com sua conta Google"
            description="Use a mesma conta que você usa no Google Ads. Se não sabe qual é, abra ads.google.com e veja com qual e-mail está logado."
            isLast={false}
          />
          <StepItem
            number={3}
            title="Autorize o acesso"
            description='O Google vai mostrar uma tela pedindo permissão. Clique em "Permitir" para que possamos acessar os dados das suas campanhas. Nenhuma senha é compartilhada.'
            isLast={false}
          />
          <StepItem
            number={4}
            title="Selecione sua conta de anúncios"
            description="Se você tem mais de uma conta no Google Ads, vamos mostrar uma lista para você escolher qual quer usar aqui na plataforma."
            isLast={false}
          />
          <StepItem
            number={5}
            title="Pronto! Seus dados começam a aparecer"
            description="Após conectar, suas campanhas, métricas e dados de conversão começam a ser carregados no Dashboard automaticamente."
            isLast={true}
          />
        </CardContent>
      </Card>

      {/* Pre-requisites */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">⚙️ Pré-requisitos (para quem vai configurar)</CardTitle>
          <CardDescription>
            Se você é o responsável técnico, estas são as configurações necessárias no Google Cloud Console.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <PrerequisiteItem
              number={1}
              title="Criar projeto no Google Cloud Console"
              description="Acesse console.cloud.google.com e crie um novo projeto para sua empresa."
              link="https://console.cloud.google.com"
              linkText="Abrir Google Cloud Console"
            />
            <PrerequisiteItem
              number={2}
              title="Ativar as APIs necessárias"
              description="No console, ative: Google Ads API, Google Analytics Data API v1 e Tag Manager API."
              link="https://console.cloud.google.com/apis/library"
              linkText="Ver APIs disponíveis"
            />
            <PrerequisiteItem
              number={3}
              title="Criar credenciais OAuth 2.0"
              description='Vá em "Credenciais" e crie um "ID do cliente OAuth". Tipo: Aplicativo Web. Adicione a URL de callback da sua plataforma.'
              link="https://console.cloud.google.com/apis/credentials"
              linkText="Gerenciar Credenciais"
            />
            <PrerequisiteItem
              number={4}
              title="Configurar tela de consentimento"
              description='Configure a tela que aparece para o usuário. Adicione os escopos: adwords, analytics.readonly e tagmanager.readonly.'
              link="https://console.cloud.google.com/apis/credentials/consent"
              linkText="Configurar Consentimento"
            />
            <PrerequisiteItem
              number={5}
              title="Obter Developer Token do Google Ads"
              description="No Google Ads, vá em Ferramentas > Central de API e solicite um Developer Token. É necessário para acessar dados das campanhas."
              link="https://ads.google.com/aw/apicenter"
              linkText="Abrir Central de API"
            />
            <PrerequisiteItem
              number={6}
              title="Adicionar os Secrets na plataforma"
              description="Após obter as credenciais, adicione GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_ADS_DEVELOPER_TOKEN nos Secrets da plataforma."
            />
          </div>

          <div className="rounded-lg bg-muted/30 border border-border/50 p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground/80 text-sm">📝 Escopos OAuth necessários:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <code className="bg-muted px-2 py-1 rounded text-[11px]">googleapis.com/auth/adwords</code>
              <code className="bg-muted px-2 py-1 rounded text-[11px]">googleapis.com/auth/analytics.readonly</code>
              <code className="bg-muted px-2 py-1 rounded text-[11px]">googleapis.com/auth/tagmanager.readonly</code>
              <code className="bg-muted px-2 py-1 rounded text-[11px]">googleapis.com/auth/userinfo.email</code>
              <code className="bg-muted px-2 py-1 rounded text-[11px]">googleapis.com/auth/userinfo.profile</code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">❓ Dúvidas frequentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FAQItem
            question="É seguro conectar minha conta?"
            answer="Sim! Usamos OAuth 2.0, o mesmo padrão de segurança usado por empresas como Spotify, Uber e Airbnb. Suas senhas nunca são compartilhadas com a plataforma."
          />
          <FAQItem
            question="Vocês podem alterar meus anúncios sem minha permissão?"
            answer="Não. Todas as ações (como pausar ou ativar campanhas) precisam da sua confirmação explícita. Nunca alteramos nada automaticamente sem você aprovar."
          />
          <FAQItem
            question="E se eu quiser desconectar depois?"
            answer='Você pode desconectar a qualquer momento clicando em "Desconectar Google" nesta página. Todos os dados sincronizados serão removidos da plataforma.'
          />
          <FAQItem
            question="Preciso ter Google Analytics instalado?"
            answer="Não é obrigatório. O Google Ads funciona independentemente. Mas se você já tem o Analytics no seu site, os dados serão integrados automaticamente para dar uma visão mais completa."
          />
          <FAQItem
            question="Funciona com conta MCC (conta administrador)?"
            answer="Sim! Se você gerencia várias contas pelo Google Ads Manager (MCC), todas as contas vinculadas aparecerão para seleção."
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ServicePreviewCard({
  icon, title, description, features, priority, priorityColor
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  priority: string;
  priorityColor: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
            {icon}
          </div>
          <div>
            <p className="font-medium text-sm">{title}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant="secondary" className={`text-[10px] ${priorityColor}`}>
          {priority}
        </Badge>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-muted-foreground">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <ChevronRight className="h-3 w-3 mt-0.5 text-primary shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
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

function PrerequisiteItem({ number, title, description, link, linkText }: {
  number: number; title: string; description: string; link?: string; linkText?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground shrink-0">
          {number}
        </span>
        <p className="font-medium text-sm">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground ml-8">{description}</p>
      {link && linkText && (
        <Button variant="link" className="p-0 h-auto ml-8 text-xs" asChild>
          <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
            {linkText} <ExternalLink className="h-3 w-3" />
          </a>
        </Button>
      )}
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{question}</p>
      <p className="text-sm text-muted-foreground">{answer}</p>
    </div>
  );
}
