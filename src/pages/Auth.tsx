import { useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Mail, Lock, User, Loader2, ArrowLeft } from 'lucide-react';
import { z } from 'zod';

const emailSchema = z.string().email('Email inválido');
const passwordSchema = z.string().min(6, 'Senha deve ter no mínimo 6 caracteres');

export default function Auth() {
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  // Redirect if already authenticated
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

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
      if (error.message.includes('Invalid login credentials')) {
        msg = 'Email ou senha incorretos.';
      } else if (error.message.includes('Email not confirmed')) {
        msg = 'Confirme seu email antes de fazer login.';
      }
      toast({ title: 'Erro no login', description: msg, variant: 'destructive' });
    }
  };

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
      toast({
        title: '🎉 Conta criada!',
        description: 'Você já pode fazer login com suas credenciais.',
      });
    }
  };

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
      toast({ title: 'Erro', description: 'Não foi possível enviar o email. Tente novamente.', variant: 'destructive' });
    } else {
      toast({
        title: '📧 Email enviado!',
        description: 'Verifique sua caixa de entrada para redefinir sua senha.',
      });
      setShowForgotPassword(false);
    }
  };

  if (showForgotPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <img src="/humanizeai-logo.png" alt="HumanizeAI TF" className="h-14 w-14 rounded-xl object-contain" />
            <h1 className="text-2xl font-bold text-foreground">Recuperar Senha</h1>
            <p className="text-sm text-muted-foreground">Enviaremos um link para redefinir sua senha</p>
          </div>

          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Esqueceu sua senha?</CardTitle>
              <CardDescription>Informe seu email cadastrado</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleForgotPassword} className="space-y-4">
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/humanizeai-logo.png" alt="HumanizeAI TF" className="h-14 w-14 rounded-xl object-contain" />
          <h1 className="text-2xl font-bold text-foreground">HumanizeAI TF</h1>
          <p className="text-sm text-muted-foreground">Plataforma inteligente de marketing e IA</p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">Bem-vindo de volta</CardTitle>
            <CardDescription>Faça login para acessar sua conta</CardDescription>
          </CardHeader>
          <CardContent>
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
                    type="password"
                    placeholder="••••••••"
                    className="pl-10"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                  />
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
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground space-y-1">
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
