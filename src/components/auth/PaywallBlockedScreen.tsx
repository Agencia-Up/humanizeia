/**
 * PaywallBlockedScreen — tela do master bloqueado por mensalidade em atraso.
 *
 * POR QUE ESTA TELA EXISTE: antes, master bloqueado era redirecionado pro
 * `/checkout`, que é a tela de VENDA NOVA — ela cobra
 * `implantação (R$1.497,90) + mensalidade`. Um cliente que já pagou a
 * implantação e só atrasou a mensalidade pagaria a implantação DE NOVO.
 * Aqui ele vê a fatura REAL da mensalidade (a mesma do e-mail de cobrança).
 *
 * Regra de segurança do dinheiro: só mandamos pro /checkout quem
 * comprovadamente NUNCA comprou (sem assinatura no Asaas). Em qualquer
 * dúvida — erro de rede, edge fora, fatura não encontrada — a tela
 * **falha fechado**: bloqueia o acesso mas NUNCA oferece uma cobrança nova.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Loader2, LogOut, RefreshCw } from 'lucide-react';
import { invokeWithReauth } from '@/lib/invokeWithReauth';
import { useAuth } from '@/hooks/useAuth';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { Button } from '@/components/ui/button';

interface FaturaResposta {
  is_customer?: boolean;
  invoice_url?: string | null;
  value?: number | null;
  due_date?: string | null;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'nunca_comprou' }
  | { fase: 'fatura'; url: string; valor: number | null; vencimento: string | null }
  | { fase: 'sem_fatura' };

/** Asaas manda 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` seria lido como UTC e
 *  mostraria o dia ANTERIOR no fuso do Brasil — por isso formatamos na mão. */
function formatarData(iso: string | null): string | null {
  if (!iso) return null;
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : null;
}

function formatarValor(v: number | null): string | null {
  if (typeof v !== 'number') return null;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function PaywallBlockedScreen() {
  const { signOut } = useAuth();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await invokeWithReauth<FaturaResposta>('subscription-invoice', {
          body: {},
        });
        if (!vivo) return;
        if (error || !data) {
          // Falha fechado: bloqueia, mas não oferece cobrança nova.
          setEstado({ fase: 'sem_fatura' });
          return;
        }
        if (data.is_customer === false) {
          setEstado({ fase: 'nunca_comprou' });
          return;
        }
        if (data.invoice_url) {
          setEstado({
            fase: 'fatura',
            url: data.invoice_url,
            valor: data.value ?? null,
            vencimento: data.due_date ?? null,
          });
          return;
        }
        setEstado({ fase: 'sem_fatura' });
      } catch {
        if (vivo) setEstado({ fase: 'sem_fatura' });
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // O cache do ProtectedRoute é de módulo; recarregar a página é o jeito
  // honesto de reavaliar o pagamento depois que o cliente quita a fatura.
  const jaPaguei = useCallback(() => window.location.reload(), []);

  if (estado.fase === 'carregando') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Nunca comprou (sem assinatura no Asaas) -> aí sim o checkout é o caminho certo.
  if (estado.fase === 'nunca_comprou') {
    return <Navigate to="/checkout?plano=pro&ciclo=mensal" replace />;
  }

  const valor = estado.fase === 'fatura' ? formatarValor(estado.valor) : null;
  const vencimento = estado.fase === 'fatura' ? formatarData(estado.vencimento) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-6 flex justify-center">
          <LogosIALogo size="md" />
        </div>

        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>

        <h1 className="mb-2 text-center text-xl font-semibold">Mensalidade em aberto</h1>

        {estado.fase === 'fatura' ? (
          <>
            <p className="text-center text-sm text-muted-foreground">
              O acesso da sua conta esta suspenso ate a regularizacao da mensalidade.
              {valor ? <> O valor em aberto e <strong className="text-foreground">{valor}</strong>.</> : null}
              {vencimento ? <> Vencimento: <strong className="text-foreground">{vencimento}</strong>.</> : null}
            </p>

            <div className="mt-6 space-y-2">
              <Button asChild className="w-full">
                <a href={estado.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Pagar mensalidade
                </a>
              </Button>
              <Button variant="outline" className="w-full" onClick={jaPaguei}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Ja paguei, atualizar
              </Button>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              O pagamento e da mensalidade do seu plano atual. A implantacao, ja quitada,
              nao e cobrada novamente.
            </p>
          </>
        ) : (
          <>
            <p className="text-center text-sm text-muted-foreground">
              O acesso da sua conta esta suspenso por pendencia de pagamento, mas nao
              conseguimos carregar a fatura agora. Fale com o suporte da Logos para
              receber o link de pagamento — nao refaca a contratacao.
            </p>
            <div className="mt-6">
              <Button variant="outline" className="w-full" onClick={jaPaguei}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-6 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair da conta
        </button>
      </div>
    </div>
  );
}
