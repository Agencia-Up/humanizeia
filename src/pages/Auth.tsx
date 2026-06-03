import { useState } from 'react';
import { Navigate, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Mail, Lock, User, Loader2, ArrowLeft, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';
import { z } from 'zod';

const emailSchema = z.string().email('Email inválido');
const passwordSchema = z.string().min(6, 'Senha deve ter no mínimo 6 caracteres');

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, user } = useAuth();
  const { toast } = useToast();
  const { isDarkMode, toggleDarkMode } = useAppStore();

  // Aba inicial: se vier ?tab=signup abre Cadastro direto
  const initialTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';

  // URL pós-login: se ProtectedRoute mandou ?redirect=/foo?tab=bar, vai pra lá
  const redirectTo = (() => {
    const r = searchParams.get('redirect');
    // Aceita só paths internos (segurança contra open-redirect)
    if (r && r.startsWith('/') && !r.startsWith('//')) return r;
    return '/tela-inicial';
  })();

  // Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Recuperação de senha
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotName, setForgotName] = useState('');

  const [isLoading, setIsLoading] = useState(false);

  // Redirect se já autenticado — respeita ?redirect= se válido
  if (user) return <Navigate to={redirectTo} replace />;

  // ─── LOGIN ────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailResult = emailSchema.safeParse(loginEmail);
    if (!emailResult.success) {
      toast({ title: 'Email inválido', description: emailResult.error.errors[0].message, variant: 'destructive' });
      return;
    }
    const passResult = passwordSchema.safeParse(loginPassword);
    if (!passResult.success) {
      toast({ title: 'Senha inválida', description: passResult.error.errors[0].message, variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await signIn(loginEmail, loginPassword);

      if (error) {
        let msg = 'Não foi possível fazer login.';
        if (error.message.includes('Invalid login credentials')) msg = 'Email ou senha incorretos.';
        else if (error.message.includes('Email not confirmed')) msg = 'Confirme seu email antes de fazer login.';
        toast({ title: 'Erro no login', description: error.message || msg, variant: 'destructive' });
      }
    } catch (err: any) {
      console.error("Erro crítico no Login:", err);
      toast({ title: 'Erro Crítico de Conexão', description: err.message || 'Falha ao comunicar com o servidor. Verifique o console.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  // ─── RECUPERAÇÃO DE SENHA ─────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailResult = emailSchema.safeParse(forgotEmail);
    if (!emailResult.success) {
      toast({ title: 'Email inválido', description: emailResult.error.errors[0].message, variant: 'destructive' });
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setIsLoading(false);

    if (error) {
      toast({
        title: 'Erro ao enviar email',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: '📧 Email de recuperação enviado!',
        description: 'Verifique sua caixa de entrada e clique no link para redefinir sua senha.',
      });
    }

    setShowForgotPassword(false);
  };

  // ─── TELA DE RECUPERAÇÃO ──────────────────────────────────────────────────
  if (showForgotPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <button
          onClick={toggleDarkMode}
          className="fixed top-4 right-4 p-2 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
        >
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <LogosIALogo size="xl" variant={isDarkMode ? 'dark' : 'light'} />
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mt-1" style={{ fontFamily: 'var(--font-display)' }}>
              Recuperar Senha
            </h1>
            <p className="text-sm text-muted-foreground max-w-xs">Enviaremos um link pra você redefinir sua senha em segundos.</p>
          </div>

          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Esqueceu sua senha?</CardTitle>
              <CardDescription>Informe seu nome e email cadastrado</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="forgot-name">Seu nome</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="forgot-name"
                      type="text"
                      placeholder="Como devemos te chamar?"
                      className="pl-10"
                      value={forgotName}
                      onChange={(e) => setForgotName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="forgot-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="forgot-email"
                      type="email"
                      placeholder="seu@email.com"
                      className="pl-10"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Enviar link de recuperação
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm"
                  onClick={() => setShowForgotPassword(false)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar ao login
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ─── TELA PRINCIPAL (LOGIN + CADASTRO) ───────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* Botão voltar pra página de vendas (canto superior esquerdo) */}
      <Link
        to="/"
        className="fixed top-4 left-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
        title="Voltar pra página de vendas"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Voltar pra página</span>
      </Link>
      {/* Toggle modo claro/escuro (canto superior direito) */}
      <button
        onClick={toggleDarkMode}
        className="fixed top-4 right-4 p-2 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
      >
        {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <div className="w-full max-w-md space-y-6">
        {/* Logo (Prompt redesign 16/05 — logo grande + tagline) */}
        <div className="flex flex-col items-center gap-3 text-center mb-2">
          <LogosIALogo size="xl" variant={isDarkMode ? 'dark' : 'light'} />
          <p className="text-sm md:text-base text-muted-foreground max-w-xs">
            Atendimento + CRM com IA pra quem vive de <span className="font-semibold" style={{ color: 'var(--brand-gold)' }}>WhatsApp</span>
          </p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <Tabs defaultValue={initialTab}>
            <CardHeader className="pb-2">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="login">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar Conta</TabsTrigger>
              </TabsList>
            </CardHeader>

            <CardContent className="pt-4">
              {/* ── ABA LOGIN ── */}
              <TabsContent value="login" className="mt-0">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="seu@email.com"
                        className="pl-10"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">Senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="login-password"
                        type={showLoginPass ? 'text' : 'password'}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowLoginPass(!showLoginPass)}
                      >
                        {showLoginPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Entrar
                  </Button>

                  <Button
                    type="button"
                    variant="link"
                    className="w-full text-sm text-muted-foreground"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Esqueci minha senha
                  </Button>
                </form>
              </TabsContent>

              {/* ── ABA CRIAR CONTA — pagamento primeiro ── */}
              {/* Para abrir conta é preciso assinar um plano. O cadastro
                  acontece automaticamente após o pagamento confirmado na
                  Asaas (o webhook cria o login e envia o acesso por email). */}
              <TabsContent value="signup" className="mt-0">
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                    <Lock className="h-6 w-6 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-foreground">
                      Crie sua conta assinando um plano
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      O acesso é liberado assim que o pagamento for confirmado.
                      Você escolhe o plano, paga com segurança e recebe seu
                      login por email — tudo automático.
                    </p>
                  </div>

                  <Button
                    type="button"
                    className="w-full gradient-primary text-primary-foreground"
                    onClick={() => navigate('/checkout?plano=pro&ciclo=mensal')}
                  >
                    Ver planos e assinar
                  </Button>

                  <p className="text-xs text-muted-foreground">
                    Já tem conta? Use a aba <span className="font-medium text-foreground">Entrar</span> aqui em cima.
                  </p>
                </div>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <p>
            Ao continuar, você concorda com os{' '}
            <a href="/terms-of-service.html" className="text-primary hover:underline">Termos de Serviço</a>
            {' '}e a{' '}
            <a href="/privacy-policy.html" className="text-primary hover:underline">Política de Privacidade</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
