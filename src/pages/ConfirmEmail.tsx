import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ConfirmEmail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('Redirecionando para o dashboard...');

  /** Verifica se o usuário é seller e decide para onde redirecionar */
  const redirectAfterConfirm = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/dashboard'); return; }

    // Checa se é seller via profiles.role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role === 'seller') {
      setSuccessMsg('Convite confirmado! Redirecionando para criar sua senha...');
      setStatus('success');
      setTimeout(() => navigate('/criar-senha'), 2000);
    } else {
      setStatus('success');
      setTimeout(() => navigate('/dashboard'), 2000);
    }
  };

  useEffect(() => {
    const handleConfirm = async () => {
      try {
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type') as any;
        const code = url.searchParams.get('code');

        // 1. PKCE code flow (invite, magiclink, signup, recovery)
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          await redirectAfterConfirm();
          return;
        }

        // 2. Token hash flow (email confirmation, invite)
        if (tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
          await redirectAfterConfirm();
          return;
        }

        // 3. Hash fragment flow (#access_token=...) — Supabase detecta automaticamente
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await redirectAfterConfirm();
            return;
          }
        }

        // 4. Fallback: sessão já criada pelo onAuthStateChange
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await redirectAfterConfirm();
          return;
        }

        throw new Error('Link de confirmação inválido ou expirado. Solicite um novo convite.');
      } catch (err: any) {
        console.error('[ConfirmEmail] Erro:', err);
        setErrorMsg(err.message || 'Erro ao confirmar email.');
        setStatus('error');
      }
    };

    handleConfirm();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8 max-w-md">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Confirmando seu email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 mx-auto text-green-500" />
            <h2 className="text-xl font-semibold">Email confirmado!</h2>
            <p className="text-muted-foreground">{successMsg}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">Falha na confirmação</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button onClick={() => navigate('/auth')} variant="outline">
              Voltar ao login
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
