import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Lock, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';

export default function SetSellerPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isDarkMode } = useAppStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({
        title: 'Senha muito curta',
        description: 'A senha deve ter no minimo 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }
    if (password !== confirmPassword) {
      toast({
        title: 'Senhas diferentes',
        description: 'As senhas digitadas nao coincidem. Verifique e tente novamente.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast({
        title: 'Senha criada com sucesso!',
        description: 'Bem-vindo ao painel! Redirecionando...',
      });
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch (err: any) {
      toast({
        title: 'Erro ao criar senha',
        description: err.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo + Titulo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <LogosIALogo size="xl" variant={isDarkMode ? 'dark' : 'light'} />
          <div className="mt-2">
            <h1 className="text-2xl font-bold text-foreground">Criar sua Senha</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Seu convite foi confirmado! Agora crie uma senha para acessar seu painel de vendedor.
            </p>
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              Defina sua senha de acesso
            </CardTitle>
            <CardDescription>
              Essa senha sera usada para entrar no seu painel. Escolha uma senha segura.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Minimo 6 caracteres"
                    className="pl-10 pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Repita a senha"
                    className="pl-10 pr-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {password.length > 0 && password.length < 6 && (
                <p className="text-xs text-amber-400">A senha precisa ter pelo menos 6 caracteres.</p>
              )}

              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-xs text-red-400">As senhas nao coincidem.</p>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary text-primary-foreground"
                disabled={isLoading || password.length < 6 || password !== confirmPassword}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Criar Senha e Entrar
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Depois de criar sua senha, use seu e-mail e essa senha para fazer login sempre que precisar.
        </p>
      </div>
    </div>
  );
}
