import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Lock, Loader2 } from 'lucide-react';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';

export default function ResetPassword() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isDarkMode } = useAppStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast({ title: 'Senha inválida', description: 'A senha deve ter no mínimo 6 caracteres.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Senhas não coincidem', description: 'Verifique e tente novamente.', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (error) {
      toast({ title: 'Erro', description: 'Não foi possível redefinir a senha. Tente novamente.', variant: 'destructive' });
    } else {
      toast({ title: '✅ Senha redefinida!', description: 'Você será redirecionado para o painel.' });
      setTimeout(() => navigate('/dashboard'), 1500);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center mb-2">
          <LogosIALogo size="xl" variant={isDarkMode ? 'dark' : 'light'} />
          <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mt-1" style={{ fontFamily: 'var(--font-display)' }}>
            Redefinir Senha
          </h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            Crie sua nova senha pra acessar a <span className="font-semibold" style={{ color: 'var(--brand-gold)' }}>Logos</span>
          </p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">Nova senha</CardTitle>
            <CardDescription>Escolha uma senha segura para sua conta</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    className="pl-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Confirmar nova senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-new-password"
                    type="password"
                    placeholder="Repita a senha"
                    className="pl-10"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Redefinir senha
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
