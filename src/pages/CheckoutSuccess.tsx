/**
 * CheckoutSuccess.tsx — confirmação de checkout (Prompt 12)
 *
 * Lê sessionStorage.checkout_result (gravado por Checkout.tsx após sucesso da
 * edge function checkout-create-subscription) e renderiza UI apropriada:
 *
 *   - PIX     → QR Code + código copia-e-cola + timer
 *   - Boleto  → linha digitável + link PDF
 *   - Cartão  → confirmação + próximos passos (login, conectar WhatsApp, etc)
 *   - Sem dados → fallback genérico com link de volta
 *
 * Acesso à conta vem por e-mail (recovery link enviado pelo webhook quando
 * o Asaas confirma o pagamento).
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { useAppStore } from '@/store/appStore';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, CheckCircle2, Copy, ExternalLink,
  FileText, LineChart, Mail, QrCode, Settings2, Shield, Smartphone,
  Sparkles, XCircle,
} from 'lucide-react';

/* ── Tipo do resultado salvo em sessionStorage ─────────────────────────── */
interface CheckoutResult {
  pendingId?: string;
  method: 'pix' | 'cartao' | 'boleto';
  plano: 'pro' | 'basico' | 'mensal' | 'anual'; // pro|basico (legado: mensal|anual)
  ciclo?: 'mensal' | 'anual';
  email: string;
  pix?: {
    payload?: string;
    qrCode?: string;          // base64 sem prefixo
    expirationDate?: string;
  };
  boleto?: {
    url?: string;
    barcode?: string;
  };
  creditCard?: {
    status?: string;
    authorizationCode?: string;
  };
  invoiceUrl?: string;
}

/* ── Helper: copia texto e mostra toast ────────────────────────────────── */
async function copyToClipboard(text: string, label = 'Texto') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  } catch {
    toast.error('Falha ao copiar. Selecione e copie manualmente.');
  }
}

/* ── Componente principal ──────────────────────────────────────────────── */
export default function CheckoutSuccess() {
  const navigate = useNavigate();
  const { isDarkMode } = useAppStore();
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    document.title = 'Pedido confirmado · LOGOS|IA';
    try {
      const raw = sessionStorage.getItem('checkout_result');
      if (raw) {
        const parsed = JSON.parse(raw) as CheckoutResult;
        setResult(parsed);
      }
    } catch (err) {
      console.warn('[CheckoutSuccess] erro lendo sessionStorage:', err);
    }
    setLoaded(true);
  }, []);

  // Pagamento de cartão aprovado dispara "confete" via CSS (sem dep nova)
  const cardApproved = result?.method === 'cartao'
    && (result.creditCard?.status === 'CONFIRMED' || result.creditCard?.status === 'RECEIVED');

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* ── HEADER ─────────────────────────────────────────────────── */}
      <header
        className="border-b sticky top-0 z-50 backdrop-blur-md"
        style={{
          borderColor: 'rgba(15, 38, 71, 0.10)',
          background: 'rgba(255, 255, 255, 0.92)',
        }}
      >
        <div className="px-4 md:px-6 py-3.5 max-w-6xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center shrink-0 hover:opacity-80 transition-opacity">
            <LogosIALogo size="sm" variant={isDarkMode ? 'dark' : 'light'} />
          </Link>
          <div
            className="flex items-center gap-1.5 text-xs md:text-sm font-medium"
            style={{ color: 'var(--brand-success)' }}
          >
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Pagamento seguro · SSL</span>
            <span className="sm:hidden">Seguro</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-6 py-10 md:py-16">

        {/* ── Loading inicial ─────────────────────────── */}
        {!loaded && (
          <div className="text-center py-20 text-muted-foreground">Carregando...</div>
        )}

        {/* ── Fallback: sem dados ─────────────────────── */}
        {loaded && !result && (
          <div className="text-center animate-fade-in">
            <div
              className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-6"
              style={{ background: 'rgba(15, 38, 71, 0.08)' }}
            >
              <FileText className="h-8 w-8" style={{ color: 'var(--brand-navy)' }} />
            </div>
            <h1
              className="text-2xl md:text-3xl font-extrabold mb-3"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
            >
              Não encontramos seu pedido recente
            </h1>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
              Se você acabou de pagar e este link foi enviado por e-mail, o pagamento já está sendo processado.
              Caso contrário, talvez você queira voltar ao checkout.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
              <Button
                asChild
                variant="outline"
                className="w-full sm:w-auto gap-2"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                <Link to="/">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar ao site
                </Link>
              </Button>
              <Button
                asChild
                className="w-full sm:w-auto gap-2"
                style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy)' }}
              >
                <Link to="/checkout?plano=pro&ciclo=mensal">
                  Ir pro checkout <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* ── Cenário PIX ─────────────────────────────── */}
        {loaded && result?.method === 'pix' && (
          <div className="animate-fade-in">
            {/* Header de sucesso */}
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-5"
                style={{ background: 'var(--brand-success-bg)' }}
              >
                <CheckCircle2 className="h-9 w-9" style={{ color: 'var(--brand-success)' }} />
              </div>
              <h1
                className="text-2xl md:text-3xl font-extrabold mb-2"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
              >
                Pedido recebido! <span style={{ color: 'var(--brand-gold)' }}>Pague o PIX</span> pra liberar.
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Use o QR Code abaixo ou copie o código PIX. Acesso liberado automaticamente em até 5 minutos após o pagamento.
              </p>
            </div>

            {/* Card com QR + copia-e-cola */}
            <div
              className="rounded-2xl p-6 md:p-8"
              style={{
                border: '2px solid var(--brand-gold)',
                background: 'var(--brand-light)',
                boxShadow: 'var(--shadow-strong)',
              }}
            >
              {/* QR Code */}
              {result.pix?.qrCode ? (
                <div className="flex justify-center mb-6">
                  <div
                    className="p-4 rounded-xl bg-white"
                    style={{ boxShadow: 'var(--shadow-soft)' }}
                  >
                    <img
                      src={`data:image/png;base64,${result.pix.qrCode}`}
                      alt="QR Code PIX"
                      className="w-56 h-56 md:w-64 md:h-64 block"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center mb-6 py-12">
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <QrCode className="h-5 w-5" />
                    QR Code não disponível — use o código copia-e-cola abaixo.
                  </div>
                </div>
              )}

              {/* Código copia-e-cola */}
              {result.pix?.payload && (
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-navy)' }}>
                    Código PIX (copia-e-cola)
                  </p>
                  <div
                    className="rounded-xl p-3 font-mono text-xs break-all"
                    style={{
                      background: 'rgba(15, 38, 71, 0.04)',
                      border: '1px solid rgba(15, 38, 71, 0.15)',
                      color: 'var(--brand-navy)',
                    }}
                  >
                    {result.pix.payload}
                  </div>
                  <Button
                    onClick={() => copyToClipboard(result.pix!.payload!, 'Código PIX')}
                    className="w-full mt-3 gap-2 font-semibold"
                    style={{ background: 'var(--brand-navy)', color: 'var(--brand-cream)' }}
                  >
                    <Copy className="h-4 w-4" />
                    Copiar código PIX
                  </Button>
                </div>
              )}

              {/* Expiração */}
              {result.pix?.expirationDate && (
                <p className="text-xs text-center text-muted-foreground mt-4">
                  ⏱️ Código expira em: <strong>{new Date(result.pix.expirationDate).toLocaleString('pt-BR')}</strong>
                </p>
              )}
            </div>

            {/* Próximos passos */}
            <NextStepsBox email={result.email} />
          </div>
        )}

        {/* ── Cenário Boleto ──────────────────────────── */}
        {loaded && result?.method === 'boleto' && (
          <div className="animate-fade-in">
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-5"
                style={{ background: 'var(--brand-success-bg)' }}
              >
                <CheckCircle2 className="h-9 w-9" style={{ color: 'var(--brand-success)' }} />
              </div>
              <h1
                className="text-2xl md:text-3xl font-extrabold mb-2"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
              >
                Boleto gerado!
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Você também recebeu uma cópia por e-mail. Compensação em até 3 dias úteis após o pagamento.
              </p>
            </div>

            <div
              className="rounded-2xl p-6 md:p-8"
              style={{
                border: '1px solid rgba(15, 38, 71, 0.15)',
                background: 'var(--brand-light)',
                boxShadow: 'var(--shadow-medium)',
              }}
            >
              {/* Linha digitável */}
              {result.boleto?.barcode && (
                <div className="mb-5">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-navy)' }}>
                    Linha digitável
                  </p>
                  <div
                    className="rounded-xl p-3 font-mono text-xs md:text-sm break-all"
                    style={{
                      background: 'rgba(15, 38, 71, 0.04)',
                      border: '1px solid rgba(15, 38, 71, 0.15)',
                      color: 'var(--brand-navy)',
                    }}
                  >
                    {result.boleto.barcode}
                  </div>
                  <Button
                    onClick={() => copyToClipboard(result.boleto!.barcode!, 'Linha digitável')}
                    className="w-full mt-3 gap-2 font-semibold"
                    style={{ background: 'var(--brand-navy)', color: 'var(--brand-cream)' }}
                  >
                    <Copy className="h-4 w-4" />
                    Copiar linha digitável
                  </Button>
                </div>
              )}

              {/* Link do PDF */}
              {result.boleto?.url && (
                <Button
                  asChild
                  className="w-full gap-2 font-bold"
                  style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy)' }}
                >
                  <a href={result.boleto.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Abrir boleto em nova aba
                  </a>
                </Button>
              )}
            </div>

            <NextStepsBox email={result.email} />
          </div>
        )}

        {/* ── Cenário Cartão APROVADO ─────────────────── */}
        {loaded && cardApproved && (
          <div className="animate-fade-in relative">
            {/* "Confete" sutil via CSS (não usa libs externas) */}
            <div className="absolute inset-x-0 -top-4 pointer-events-none overflow-hidden h-32">
              {[...Array(20)].map((_, i) => (
                <span
                  key={i}
                  className="absolute block animate-bounce"
                  style={{
                    left: `${(i * 7) % 100}%`,
                    top: `${(i * 13) % 40}px`,
                    width: 6,
                    height: 6,
                    background: i % 3 === 0 ? 'var(--brand-gold)' : i % 3 === 1 ? 'var(--brand-navy)' : 'var(--brand-success)',
                    borderRadius: i % 2 === 0 ? '50%' : '2px',
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: `${1.5 + (i % 3) * 0.3}s`,
                  }}
                />
              ))}
            </div>

            <div className="text-center mb-8">
              <div
                className="w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-5"
                style={{ background: 'var(--brand-success-bg)' }}
              >
                <CheckCircle2 className="h-12 w-12" style={{ color: 'var(--brand-success)' }} />
              </div>
              <Badge
                className="mb-3 border-0 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'var(--brand-success)', color: 'white' }}
              >
                Pagamento confirmado
              </Badge>
              <h1
                className="text-2xl md:text-4xl font-extrabold mb-2"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
              >
                Sua conta foi <span style={{ color: 'var(--brand-gold)' }}>liberada</span>!
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Pedro e Marcos estão prontos pra trabalhar. Falta só você configurar seu WhatsApp.
              </p>
            </div>

            <NextStepsBox email={result.email} highlighted />
          </div>
        )}

        {/* ── Cenário Cartão RECUSADO ─────────────────── */}
        {loaded && result?.method === 'cartao' && !cardApproved && (
          <div className="animate-fade-in">
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-5"
                style={{ background: 'rgba(220, 38, 38, 0.10)' }}
              >
                <XCircle className="h-9 w-9" style={{ color: 'var(--brand-error)' }} />
              </div>
              <h1
                className="text-2xl md:text-3xl font-extrabold mb-2"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
              >
                Pagamento <span style={{ color: 'var(--brand-error)' }}>recusado</span>
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Pode ser saldo, limite ou bloqueio do banco. Tente outro cartão ou outro método de pagamento.
              </p>
              {result.creditCard?.status && (
                <p className="text-xs text-muted-foreground mt-2">
                  Status retornado: <code className="text-xs">{result.creditCard.status}</code>
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
              <Button
                asChild
                variant="outline"
                className="w-full sm:w-auto gap-2"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                <a href={`https://wa.me/5512992197330?text=${encodeURIComponent('Olá, meu pagamento foi recusado no checkout do PRO. Pode me ajudar?')}`} target="_blank" rel="noopener noreferrer">
                  Falar com suporte
                </a>
              </Button>
              <Button
                onClick={() => {
                  sessionStorage.removeItem('checkout_result');
                  navigate(`/checkout?plano=${result.plano}&ciclo=${result.ciclo || 'mensal'}`, { replace: true });
                }}
                className="w-full sm:w-auto gap-2 font-bold"
                style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy)' }}
              >
                Tentar novamente <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

/* ── Bloco "Próximos passos" reutilizado em PIX/Boleto/Cartão aprovado ── */
function NextStepsBox({ email, highlighted = false }: { email: string; highlighted?: boolean }) {
  return (
    <div
      className="mt-8 rounded-2xl p-6"
      style={{
        background: highlighted
          ? 'linear-gradient(135deg, var(--brand-navy) 0%, var(--brand-navy-light) 100%)'
          : 'rgba(15, 38, 71, 0.04)',
        border: highlighted ? 'none' : '1px solid rgba(15, 38, 71, 0.10)',
        color: highlighted ? 'var(--brand-cream)' : 'inherit',
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Sparkles
          className="h-5 w-5"
          style={{ color: highlighted ? 'var(--brand-gold)' : 'var(--brand-navy)' }}
        />
        <h3
          className="text-base md:text-lg font-bold"
          style={{
            fontFamily: 'var(--font-display)',
            color: highlighted ? 'var(--brand-cream)' : 'var(--brand-navy)',
          }}
        >
          Próximos passos
        </h3>
      </div>

      <ol className="space-y-3 text-sm">
        {[
          { Icon: Mail, text: <>Verifique seu e-mail <strong>{email}</strong> — enviamos o link pra você definir senha.</> },
          { Icon: Smartphone, text: <>Faça login e <strong>conecte seu WhatsApp</strong> (leva 5 minutos).</> },
          { Icon: Settings2, text: <><strong>Ative Pedro e Marcos</strong> — configure as regras de qualificação.</> },
          { Icon: LineChart, text: <>Acompanhe os leads no <strong>CRM ao vivo</strong> e veja a IA trabalhar.</> },
        ].map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{
                background: highlighted ? 'rgba(212, 160, 23, 0.20)' : 'rgba(212, 160, 23, 0.10)',
              }}
            >
              <step.Icon className="h-3.5 w-3.5" style={{ color: 'var(--brand-gold)' }} />
            </div>
            <span style={{ opacity: highlighted ? 0.90 : 1 }}>
              <strong style={{ color: highlighted ? 'var(--brand-gold)' : 'var(--brand-navy)' }}>{i + 1}.</strong>{' '}
              {step.text}
            </span>
          </li>
        ))}
      </ol>

      <Button
        asChild
        size="lg"
        className="w-full mt-6 gap-2 font-bold"
        style={{
          background: 'var(--brand-gold)',
          color: 'var(--brand-navy)',
          boxShadow: highlighted ? 'var(--shadow-gold)' : 'none',
        }}
      >
        <Link to="/auth">
          Ir pro painel <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
