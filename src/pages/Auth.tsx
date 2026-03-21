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
import { Mail, Lock, User, Loader2, ArrowLeft, Eye, EyeOff } from 'lucide-react';
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
  const { signIn, signUp, user, loading: authLoading } = useAuth();
  const { toast } = useToast();

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

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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
    const { error } = await signIn(loginEmail, loginPassword);
    setIsLoading(false);

    if (error) {
      let msg = 'Não foi possível fazer login.';
      if (error.message.includes('Invalid login credentials')) msg = 'Email ou senha incorretos.';
      else if (error.message.includes('Email not confirmed')) msg = 'Confirme seu email antes de fazer login.';
      toast({ title: 'Erro no login', description: msg, variant: 'destructive' });
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
    const { error } = await signUp(signupEmail, signupPassword, signupName);
    setIsLoading(false);

    if (error) {
      let msg = 'Não foi possível criar sua conta.';
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        msg = 'Este email já está cadastrado. Tente fazer login.';
      }
      toast({ title: 'Erro no cadastro', description: msg, variant: 'destructive' });
    } else {
      // Envia email de boas-vindas via Resend
      await sendEmail({
        type: 'welcome',
        email: signupEmail,
        name: signupName || 'Usuário',
        redirectTo: window.location.origin,
      });

      toast({
        title: '🎉 Conta criada com sucesso!',
        description: 'Verifique seu email para confirmar o cadastro.',
      });
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

    // Usa nossa Edge Function (Resend) para enviar o email bonito com link de recuperação
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        type: 'reset_password',
        email: forgotEmail,
        name: forgotName || 'Usuário',
        redirectTo: `${window.location.origin}/reset-password`,
      },
    });

    setIsLoading(false);

    if (error || data?.error) {
      // Fallback: usa o Supabase padrão
      await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      toast({
        title: '📧 Email enviado!',
        description: 'Verifique sua caixa de entrada para redefinir sua senha.',
      });
    } else {
      toast({
        title: '📧 Email de recuperação enviado!',
        description: 'Verifique seu email e clique no link para redefinir sua senha.',
      });
    }

    setShowForgotPassword(false);
  };

  // ─── TELA DE RECUPERAÇÃO ──────────────────────────────────────────────────
  if (showForgotPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <img src="/logosia-brand.png" alt="Logos IA" className="h-16 w-auto object-contain" />
            <h1 className="text-xl font-bold text-foreground">Recuperar Senha</h1>
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
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 text-center pb-2">
          <img src="/logosia-brand.png" alt="Logos IA" className="h-16 sm:h-20 w-auto object-contain" />
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
