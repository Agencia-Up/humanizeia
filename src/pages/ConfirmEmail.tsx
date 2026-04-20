import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ConfirmEmail() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const handleConfirm = async () => {
      try {
        // Supabase PKCE: token vem como query param
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type') as any;
        const code = url.searchParams.get('code');

        if (code) {
          // OAuth / PKCE code flow
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) throw error;
          setStatus('success');
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        }

        if (tokenHash && type) {
          // Email confirmation via token_hash
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
          setStatus('success');
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        }

        // Fallback: token no fragment (#access_token=...) — Supabase detecta automaticamente
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setStatus('success');
          setTimeout(() => navigate('/dashboard'), 2000);
          return;
        }

        throw new Error('Link de confirmação inválido ou expirado.');
      } catch (err: any) {
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
            <p className="text-muted-foreground">Redirecionando para o dashboard...</p>
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
