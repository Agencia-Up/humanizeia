import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, ArrowLeft, ArrowRight, ShieldCheck, ChevronRight,
  Zap, BarChart3, Target, Lightbulb, Lock, Eye, TrendingUp, CheckCircle,
  Key, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WizardProgress } from '@/components/onboarding/WizardProgress';
import { OAuthButton } from '@/components/onboarding/OAuthButton';
import { AccountSelector } from '@/components/onboarding/AccountSelector';
import { SuccessAnimation } from '@/components/onboarding/SuccessAnimation';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { useLinkedInConnection } from '@/hooks/useLinkedInConnection';
import { useToast } from '@/hooks/use-toast';

const STEPS = ['Boas-vindas', 'Conectar', 'Escolher conta', 'Pronto!'];

// Contextual tips per step
const STEP_TIPS = [
  {
    icon: Lightbulb,
    text: 'Leva menos de 2 minutos para configurar tudo!',
  },
  {
    icon: Lock,
    text: 'Nós nunca publicamos ou alteramos nada nas suas campanhas. Apenas leitura!',
  },
  {
    icon: Eye,
    text: 'Se tiver mais de uma conta, escolha a principal. Você pode trocar depois.',
  },
  {
    icon: TrendingUp,
    text: 'A partir de agora, nossa IA vai analisar seus dados e sugerir melhorias!',
  },
];

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.35, ease: 'easeOut' as const },
};

export default function ConnectAccounts() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const meta = useMetaConnection();
  const google = useGoogleAdsConnection();
  const linkedin = useLinkedInConnection();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<'meta' | 'google' | 'linkedin' | null>(null);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualAccountId, setManualAccountId] = useState('1576723380197751');
  const [isConnectingToken, setIsConnectingToken] = useState(false);

  // Handle OAuth callbacks (single-use code)
  useEffect(() => {
    const metaCode = searchParams.get('code');
    const isMetaCallback = searchParams.get('meta_callback');
    const isGoogleCallback = searchParams.get('google_callback');

    if (metaCode && isMetaCallback) {
      setActivePlatform('meta');
      meta.handleCallback(metaCode);
      setCurrentStep(2);
      navigate('/connect-accounts', { replace: true });
    } else if (metaCode && isGoogleCallback) {
      setActivePlatform('google');
      google.handleCallback(metaCode);
      setCurrentStep(2);
      navigate('/connect-accounts', { replace: true });
    }
  }, [navigate, searchParams]);

  const handleMetaConnect = async () => {
    setActivePlatform('meta');
    await meta.startOAuth();
  };

  const handleGoogleConnect = async () => {
    setActivePlatform('google');
    await google.startOAuth();
  };

  const handleLinkedInConnect = async () => {
    setActivePlatform('linkedin');
    await linkedin.startOAuth();
  };

  const handleConnectWithToken = async () => {
    if (!manualToken.trim()) {
      toast({ title: 'Token obrigatório', description: 'Cole seu Token de Acesso Meta antes de continuar.', variant: 'destructive' });
      return;
    }
    setIsConnectingToken(true);
    setActivePlatform('meta');
    const result = await meta.connectWithToken(manualToken.trim(), manualAccountId.trim() || undefined);
    setIsConnectingToken(false);
    if (result.success) {
      if (result.needsSelection) {
        setCurrentStep(2);
      } else {
        setCurrentStep(3);
      }
    }
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

  const linkedinStatus = linkedin.connectedAccount
    ? 'connected'
    : linkedin.isConnecting
      ? 'connecting'
      : 'disconnected';

  const anyConnected = metaStatus === 'connected' || googleStatus === 'connected' || linkedinStatus === 'connected';
  const anyAccountsAvailable = meta.availableAccounts.length > 0 || google.availableAccounts.length > 0;
  const canProceedFromConnect = anyConnected || anyAccountsAvailable;

  const activeAccounts = activePlatform === 'google'
    ? google.availableAccounts.map(a => ({ ...a, timezone_name: a.timezone, account_status: 1 }))
    : meta.availableAccounts;

  const activeConnected = activePlatform === 'google' ? google.connectedAccount : meta.connectedAccount;

  const currentTip = STEP_TIPS[currentStep];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl space-y-6">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-2 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary shadow-lg">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            <span className="gradient-text">LogosIA</span>
          </h1>
          <p className="text-xs text-muted-foreground">Configuração inicial</p>
        </motion.div>

        {/* Progress */}
        <WizardProgress currentStep={currentStep} totalSteps={STEPS.length} labels={STEPS} />

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} {...fadeUp}>
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
              <CardContent className="p-6">
                {/* STEP 0 - Welcome */}
                {currentStep === 0 && (
                  <div className="space-y-6">
                    <div className="text-center space-y-3">
                      <div className="mx-auto text-6xl">👋</div>
                      <h2 className="text-2xl font-bold text-foreground">
                        Olá! Vamos começar?
                      </h2>
                      <p className="text-muted-foreground text-sm leading-relaxed max-w-sm mx-auto">
                        Configure sua conta em <strong>3 passos simples</strong> e deixe nossa inteligência artificial trabalhar para você.
                      </p>
                    </div>

                    {/* Visual feature cards */}
                    <div className="grid gap-3">
                      {[
                        {
                          icon: Zap,
                          emoji: '⚡',
                          title: 'Conexão rápida',
                          desc: 'Conecte suas campanhas com apenas um clique',
                          color: 'bg-amber-500/10 text-amber-600',
                        },
                        {
                          icon: BarChart3,
                          emoji: '📊',
                          title: 'Análises inteligentes',
                          desc: 'Receba insights automáticos sobre seus anúncios',
                          color: 'bg-blue-500/10 text-blue-600',
                        },
                        {
                          icon: Target,
                          emoji: '🎯',
                          title: 'Otimização com IA',
                          desc: 'Sugestões personalizadas para melhorar seus resultados',
                          color: 'bg-emerald-500/10 text-emerald-600',
                        },
                      ].map((item, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.2 + i * 0.1 }}
                          className="flex items-center gap-4 rounded-xl bg-muted/40 p-4"
                        >
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.color}`}>
                            <span className="text-xl">{item.emoji}</span>
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-foreground">{item.title}</p>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    <Button
                      onClick={() => setCurrentStep(1)}
                      className="w-full gradient-primary text-primary-foreground h-13 text-base font-semibold"
                    >
                      Começar agora
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Button>
                  </div>
                )}

                {/* STEP 1 - Connect */}
                {currentStep === 1 && (
                  <div className="space-y-5">
                    <div className="text-center space-y-2">
                      <div className="mx-auto text-5xl">🔗</div>
                      <h2 className="text-xl font-bold text-foreground">
                        Conecte onde você anuncia
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Clique no botão da plataforma que você usa. Vai abrir uma tela de login — é só autorizar!
                      </p>
                    </div>

                    {/* Visual example */}
                    <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 space-y-3">
                      <p className="text-xs font-medium text-primary flex items-center gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5" />
                        Como funciona?
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">1</span>
                        <span>Clique no botão abaixo</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">2</span>
                        <span>Faça login na sua conta (Facebook ou Google)</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">3</span>
                        <span>Autorize a leitura dos dados — pronto! ✨</span>
                      </div>
                    </div>

                    <div className="space-y-3">
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
                      <OAuthButton
                        platform="linkedin"
                        status={linkedinStatus}
                        onClick={handleLinkedInConnect}
                      />
                    </div>

                    {/* SEPARADOR */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-border/60" />
                      <span className="text-xs text-muted-foreground">ou</span>
                      <div className="flex-1 h-px bg-border/60" />
                    </div>

                    {/* CONECTAR COM TOKEN */}
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowTokenForm(!showTokenForm)}
                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-primary" />
                          Conectar Meta com Token de Acesso
                        </div>
                        {showTokenForm ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      {showTokenForm && (
                        <div className="border-t border-border/60 bg-muted/20 p-4 space-y-3">
                          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              Use um <strong>token de longa duração</strong> do Meta Business Suite. Tokens temporários expiram em 60 dias.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">Token de Acesso Meta *</Label>
                            <Input
                              type="password"
                              placeholder="EAAxxxxxxxxx..."
                              value={manualToken}
                              onChange={(e) => setManualToken(e.target.value)}
                              className="text-xs font-mono"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">ID da Conta de Anúncios (opcional)</Label>
                            <Input
                              type="text"
                              placeholder="ex: 1576723380197751"
                              value={manualAccountId}
                              onChange={(e) => setManualAccountId(e.target.value)}
                              className="text-xs font-mono"
                            />
                            <p className="text-[10px] text-muted-foreground">Se deixar em branco, vamos buscar todas as contas disponíveis.</p>
                          </div>

                          <Button
                            onClick={handleConnectWithToken}
                            disabled={isConnectingToken || !manualToken.trim()}
                            className="w-full gradient-primary text-primary-foreground text-sm"
                          >
                            {isConnectingToken ? (
                              <><span className="animate-spin mr-2">⟳</span> Validando token...</>
                            ) : (
                              <><Key className="h-4 w-4 mr-2" /> Conectar com Token</>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-success/5 border border-success/20 p-3 text-xs text-muted-foreground">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                      <span>
                        <strong className="text-foreground">100% seguro.</strong> Nós só lemos dados — nunca alteramos suas campanhas.
                      </span>
                    </div>

                    <div className="flex gap-3 pt-1">
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
                          onClick={() => navigate('/dashboard')}
                          className="flex-1 text-muted-foreground"
                        >
                          Pular por enquanto
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* STEP 2 - Select Account */}
                {currentStep === 2 && (
                  <div className="space-y-5">
                    <div className="text-center space-y-2">
                      <div className="mx-auto text-5xl">🎯</div>
                      <h2 className="text-xl font-bold text-foreground">
                        Qual conta você quer otimizar?
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {activeConnected
                          ? 'Sua conta já está conectada e pronta!'
                          : activeAccounts.length > 0
                            ? 'Encontramos suas contas! Toque na que você quer usar como principal.'
                            : 'Volte e conecte sua plataforma primeiro.'
                        }
                      </p>
                    </div>

                    {activeConnected ? (
                      <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex flex-col items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-6 text-center"
                      >
                        <CheckCircle className="h-10 w-10 text-success" />
                        <p className="font-semibold text-foreground text-lg">{activeConnected.account_name}</p>
                        <p className="text-xs text-muted-foreground">Conta conectada e pronta para análise!</p>
                      </motion.div>
                    ) : (
                      <>
                        {/* Visual hint for account selection */}
                        {activeAccounts.length > 1 && (
                          <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
                            <Lightbulb className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
                            <span>
                              <strong className="text-foreground">Dica:</strong> Escolha a conta onde estão suas campanhas principais. Você pode trocar depois em Configurações.
                            </span>
                          </div>
                        )}
                        <AccountSelector
                          accounts={activeAccounts}
                          selectedId={selectedAccountId}
                          onSelect={handleSelectAccount}
                          emptyMessage="Nenhuma conta encontrada. Volte e conecte sua plataforma primeiro."
                        />
                      </>
                    )}

                    {/* Detected assets summary */}
                    {activePlatform === 'meta' && (meta.pixels.length > 0 || meta.pages.length > 0) && (
                      <div className="rounded-lg bg-muted/40 p-3 space-y-1.5">
                        <p className="text-xs font-medium text-foreground">Também detectamos:</p>
                        <div className="flex flex-wrap gap-2">
                          {meta.pixels.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                              📡 {meta.pixels.length} pixel{meta.pixels.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {meta.pages.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                              📄 {meta.pages.length} página{meta.pages.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {meta.businesses.length > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                              🏢 {meta.businesses.length} Business Manager{meta.businesses.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <Button variant="outline" onClick={() => setCurrentStep(1)} className="flex-1">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                      </Button>
                      <Button
                        onClick={activeConnected ? () => setCurrentStep(3) : handleConfirmAccount}
                        disabled={!activeConnected && !selectedAccountId}
                        className="flex-1 gradient-primary text-primary-foreground"
                      >
                        {activeConnected ? 'Continuar' : 'Usar esta conta'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* STEP 3 - Success */}
                {currentStep === 3 && (
                  <div className="py-6">
                    <SuccessAnimation show={currentStep === 3} />
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 1.2 }}
                      className="mt-8 space-y-4"
                    >
                      {/* What happens next */}
                      <div className="rounded-xl bg-muted/40 p-4 space-y-3">
                        <p className="text-sm font-semibold text-foreground">O que acontece agora?</p>
                        <div className="space-y-2">
                          {[
                            { emoji: '🔍', text: 'Nossa IA vai analisar suas campanhas recentes' },
                            { emoji: '💡', text: 'Você receberá dicas personalizadas no painel' },
                            { emoji: '📈', text: 'Acompanhe métricas em tempo real' },
                          ].map((item, i) => (
                            <div key={i} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                              <span className="text-base">{item.emoji}</span>
                              <span>{item.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <Button
                        onClick={() => navigate('/dashboard')}
                        className="w-full gradient-primary text-primary-foreground h-13 text-base font-semibold"
                      >
                        Ir para o Painel 🚀
                      </Button>
                    </motion.div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>

        {/* Contextual tip */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ delay: 0.3, duration: 0.3 }}
            className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
          >
            <currentTip.icon className="h-3.5 w-3.5 text-primary" />
            <span>{currentTip.text}</span>
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/60">
          ✦ LogosIA — Inteligência que transforma seus resultados ✦
        </p>
      </div>
    </div>
  );
}
