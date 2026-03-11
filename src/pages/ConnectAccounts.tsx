import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, ArrowLeft, ArrowRight, Plug, ShieldCheck, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WizardProgress } from '@/components/onboarding/WizardProgress';
import { OAuthButton } from '@/components/onboarding/OAuthButton';
import { AccountSelector } from '@/components/onboarding/AccountSelector';
import { SuccessAnimation } from '@/components/onboarding/SuccessAnimation';
import { HelpTooltip } from '@/components/onboarding/HelpTooltip';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { useToast } from '@/hooks/use-toast';

const STEPS = ['Boas-vindas', 'Conectar', 'Conta de Anúncios', 'Pronto!'];

export default function ConnectAccounts() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const meta = useMetaConnection();
  const google = useGoogleAdsConnection();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<'meta' | 'google' | null>(null);

  // Handle OAuth callbacks
  useEffect(() => {
    const metaCode = searchParams.get('code');
    const isMetaCallback = searchParams.get('meta_callback');
    const isGoogleCallback = searchParams.get('google_callback');

    if (metaCode && isMetaCallback) {
      setActivePlatform('meta');
      meta.handleCallback(metaCode);
      setCurrentStep(2);
    } else if (metaCode && isGoogleCallback) {
      setActivePlatform('google');
      google.handleCallback(metaCode);
      setCurrentStep(2);
    }
  }, [searchParams]);

  const handleMetaConnect = async () => {
    setActivePlatform('meta');
    await meta.startOAuth();
  };

  const handleGoogleConnect = async () => {
    setActivePlatform('google');
    await google.startOAuth();
  };

  const handleSelectAccount = (account: any) => {
    setSelectedAccountId(account.id);
  };

  const handleConfirmAccount = async () => {
    if (activePlatform === 'meta') {
      const selected = meta.availableAccounts.find((a) => a.id === selectedAccountId);
      if (selected) {
        await meta.selectAccount(selected);
        setCurrentStep(3);
      }
    } else if (activePlatform === 'google') {
      const selected = google.availableAccounts.find((a) => a.id === selectedAccountId);
      if (selected) {
        await google.selectAccount(selected);
        setCurrentStep(3);
      }
    }
  };

  const metaStatus = meta.connectedAccount
    ? 'connected'
    : meta.isConnecting
      ? 'connecting'
      : 'disconnected';

  const googleStatus = google.connectedAccount
    ? 'connected'
    : google.isConnecting
      ? 'connecting'
      : 'disconnected';

  const anyConnected = metaStatus === 'connected' || googleStatus === 'connected';
  const anyAccountsAvailable = meta.availableAccounts.length > 0 || google.availableAccounts.length > 0;
  const canProceedFromConnect = anyConnected || anyAccountsAvailable;

  // Get active accounts list for selection step
  const activeAccounts = activePlatform === 'google'
    ? google.availableAccounts.map(a => ({ ...a, timezone_name: a.timezone, account_status: 1 }))
    : meta.availableAccounts;

  const activeConnected = activePlatform === 'google' ? google.connectedAccount : meta.connectedAccount;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
            <Sparkles className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            <span className="gradient-text">HumanizeAI</span>
          </h1>
        </div>

        {/* Progress */}
        <WizardProgress currentStep={currentStep} totalSteps={STEPS.length} labels={STEPS} />

        {/* Step Content */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          {/* STEP 0 - Welcome */}
          {currentStep === 0 && (
            <>
              <CardHeader className="text-center">
                <div className="mx-auto mb-3 text-5xl">👋</div>
                <CardTitle className="text-xl">Vamos configurar sua conta!</CardTitle>
                <CardDescription>
                  Em poucos passos, você vai conectar seus anúncios e começar a usar toda a inteligência do HumanizeAI.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {[
                    { icon: Plug, text: 'Conecte sua conta de anúncios' },
                    { icon: ShieldCheck, text: 'Seus dados ficam 100% seguros' },
                    { icon: Sparkles, text: 'Nossa IA começa a trabalhar para você' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <item.icon className="h-4 w-4 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{item.text}</span>
                    </div>
                  ))}
                </div>
                <Button onClick={() => setCurrentStep(1)} className="w-full gradient-primary text-primary-foreground h-12 text-base">
                  Começar configuração 🚀
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </>
          )}

          {/* STEP 1 - Connect */}
          {currentStep === 1 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  🔗 Conecte sua plataforma de anúncios
                  <HelpTooltip text="Conecte a plataforma onde você faz seus anúncios. Isso permite que o HumanizeAI analise e otimize suas campanhas automaticamente." />
                </CardTitle>
                <CardDescription>
                  Escolha a plataforma onde você anuncia. É rápido e seguro!
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <OAuthButton
                  platform="meta"
                  status={metaStatus}
                  onClick={handleMetaConnect}
                />
                <OAuthButton
                  platform="google"
                  status={googleStatus}
                  onClick={handleGoogleConnect}
                />

                <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                  <span>Seus dados são criptografados e nunca compartilhados com terceiros.</span>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setCurrentStep(0)} className="flex-1">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Button>
                  {canProceedFromConnect ? (
                    <Button
                      onClick={() => setCurrentStep(2)}
                      className="flex-1 gradient-primary text-primary-foreground"
                    >
                      Continuar
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        navigate('/');
                      }}
                      className="flex-1 text-muted-foreground"
                    >
                      Pular por enquanto
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </>
          )}

          {/* STEP 2 - Select Account */}
          {currentStep === 2 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  🎯 Escolha sua Conta de Anúncios
                  <HelpTooltip text="Se você tem mais de uma conta de anúncios, escolha a principal que deseja gerenciar com o HumanizeAI." />
                </CardTitle>
                <CardDescription>
                  Selecione a conta que você quer otimizar com IA
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeConnected ? (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-6 text-center">
                    <span className="text-3xl">✅</span>
                    <p className="font-medium text-foreground">{activeConnected.account_name}</p>
                    <p className="text-xs text-muted-foreground">Conta já conectada e pronta!</p>
                  </div>
                ) : (
                  <AccountSelector
                    accounts={activeAccounts}
                    selectedId={selectedAccountId}
                    onSelect={handleSelectAccount}
                    emptyMessage="Nenhuma conta encontrada. Volte e conecte sua plataforma primeiro."
                  />
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </Button>
                  <Button
                    onClick={activeConnected ? () => setCurrentStep(3) : handleConfirmAccount}
                    disabled={!activeConnected && !selectedAccountId}
                    className="flex-1 gradient-primary text-primary-foreground"
                  >
                    Continuar
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* STEP 3 - Success */}
          {currentStep === 3 && (
            <CardContent className="py-10">
              <SuccessAnimation show={currentStep === 3} />
              <div className="mt-8">
                <Button
                  onClick={() => navigate('/')}
                  className="w-full gradient-primary text-primary-foreground h-12 text-base"
                >
                  Ir para o Painel 🚀
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          ✦ HumanizeAI — Inteligência que humaniza seus resultados ✦
        </p>
      </div>
    </div>
  );
}
