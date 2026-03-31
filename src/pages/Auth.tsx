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

// Helper: chama a Edge Function send-email
async function sendEmail(payload: Record<string, string>) {
  try {
    await supabase.functions.invoke('send-email', { body: payload });
  } catch (err) {
    console.warn('send-email error (não crítico):', err);
  }
}

export default function Auth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();
  const { isDarkMode, toggleDarkMode } = useAppStore();

  // Aba inicial: se vier ?tab=signup abre Cadastro direto
  const initialTab = searchParams.get('tab') === 'signup' ? 'signup' : 'login';

  // Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPass, setShowLoginPass] = useState(false);

  // Cadastro
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [showSignupPass, setShowSignupPass] = useState(false);
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);

  // Recuperação de senha
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotName, setForgotName] = useState('');

  const [isLoading, setIsLoading] = useState(false);

  // Redirect se já autenticado
  if (user) return <Navigate to="/dashboard" replace />;

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

  // ─── CADASTRO ─────────────────────────────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailResult = emailSchema.safeParse(signupEmail);
    if (!emailResult.success) {
      toast({ title: 'Email inválido', description: emailResult.error.errors[0].message, variant: 'destructive' });
      return;
    }
    const passResult = passwordSchema.safeParse(signupPassword);
    if (!passResult.success) {
      toast({ title: 'Senha inválida', description: passResult.error.errors[0].message, variant: 'destructive' });
      return;
    }
    if (signupPassword !== signupConfirm) {
      toast({ title: 'Senhas não coincidem', description: 'Verifique e tente novamente.', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: {
          data: { full_name: signupName },
        },
      });

      if (error) {
        let msg = 'Não foi possível criar sua conta.';
        if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          msg = 'Este e-mail já está cadastrado em nossa base.';
        }
        toast({ 
          title: 'Erro no cadastro', 
          description: msg, 
          variant: 'destructive' 
        });
        return;
      }

      // Verificação específica do Supabase: se o usuário já existe e a confirmação está pendente,
      // ele pode retornar sucesso mas com a lista de identidades vazia para evitar vazamento de dados.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        toast({
          title: 'Conta já existente',
          description: 'Este e-mail já possui um cadastro pendente ou ativo. Tente fazer login.',
          variant: 'destructive',
        });
        return;
      }

      // Sucesso no Supabase
      toast({
        title: '🎉 Cadastro realizado!',
        description: 'Enviamos um e-mail de confirmação. Por favor, verifique sua caixa de entrada.',
      });

      // Envia email de boas-vindas/onboarding via Edge Function (Auxiliar)
      try {
        await sendEmail({
          type: 'welcome',
          email: signupEmail,
          name: signupName || 'Usuário',
          redirectTo: window.location.origin,
        });
      } catch (e) {
        console.warn('Erro ao enviar e-mail de boas-vindas:', e);
      }
    } catch (err: any) {
      console.error("Erro crítico no Cadastro:", err);
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
          <div className="flex flex-col items-center gap-2 text-center">
            <LogosIALogo size="lg" />
            <h1 className="text-2xl font-bold text-foreground">Recuperar Senha</h1>
            <p className="text-sm text-muted-foreground">Enviaremos um link para redefinir sua senha</p>
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
      <button
        onClick={toggleDarkMode}
        className="fixed top-4 right-4 p-2 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
      >
        {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="logo-container p-2">
            <img src="/logosia-logo.png" alt="LogosIA" className="h-16 w-16 rounded-lg object-contain" />
          </span>
          <h1 className="text-2xl font-bold text-foreground">LogosIA</h1>
          <p className="text-sm text-muted-foreground">Plataforma inteligente de marketing e IA</p>
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

              {/* ── ABA CADASTRO ── */}
              <TabsContent value="signup" className="mt-0">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Nome completo</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="Seu nome"
                        className="pl-10"
                        value={signupName}
                        onChange={(e) => setSignupName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="seu@email.com"
                        className="pl-10"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showSignupPass ? 'text' : 'password'}
                        placeholder="Mínimo 6 caracteres"
                        className="pl-10 pr-10"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSignupPass(!showSignupPass)}
                      >
                        {showSignupPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirmar senha</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="signup-confirm"
                        type={showSignupConfirm ? 'text' : 'password'}
                        placeholder="Repita sua senha"
                        className="pl-10 pr-10"
                        value={signupConfirm}
                        onChange={(e) => setSignupConfirm(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSignupConfirm(!showSignupConfirm)}
                      >
                        {showSignupConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Criar minha conta
                  </Button>
                </form>
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
