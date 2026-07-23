/**
 * Checkout.tsx — Página de pagamento do plano PRO (Prompt 10 — landing redesign 16/05)
 *
 * Fluxo (links separados por plano; ciclo alternável na própria tela):
 *   /checkout?plano=pro&ciclo=mensal    → Plano PRO mensal
 *   /checkout?plano=pro&ciclo=anual     → Plano PRO anual
 *   /checkout?plano=basico&ciclo=mensal → Plano Básico mensal
 *   Compat: ?plano=mensal|anual ainda cai no PRO com o ciclo correspondente.
 *   Preços vêm ao vivo da edge function checkout-pricing (fundador/normal).
 *
 * 3 etapas:
 *   1) Dados pessoais (nome, e-mail, CPF/CNPJ, telefone)
 *   2) Método de pagamento (PIX / Cartão / Boleto)
 *   3) Revisão + termos + botão "Pagar agora"
 *
 * IMPORTANTE:
 *   - Dados de cartão NÃO são armazenados no banco. Vão direto pro gateway (Asaas — Prompt 11).
 *   - Por ora, "Pagar agora" só mostra toast "Integração em breve" — o backend vem no Prompt 11.
 *   - Validação inline de CPF/CNPJ/e-mail/telefone no front antes de enviar.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { LogosIALogo } from '@/components/brand/LogosIALogo';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, CheckCircle2, CreditCard, FileText,
  Loader2, Lock, LogOut, QrCode, Shield, Sparkles, User,
} from 'lucide-react';

/* ── Tipos ─────────────────────────────────────────────────────────────── */
type Step = 1 | 2 | 3;
type Ciclo = 'mensal' | 'anual';
type PlanType = 'pro' | 'enterprise' | 'basico';
type PaymentMethod = 'pix' | 'cartao' | 'boleto';
type PersonType = 'pf' | 'pj';

/* ── Validações inline (sem libs externas) ─────────────────────────────── */
function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function onlyDigits(v: string): string {
  return (v || '').replace(/\D/g, '');
}
function isValidCPF(v: string): boolean {
  const d = onlyDigits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i], 10) * (10 - i);
  let chk = (sum * 10) % 11;
  if (chk === 10) chk = 0;
  if (chk !== parseInt(d[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i], 10) * (11 - i);
  chk = (sum * 10) % 11;
  if (chk === 10) chk = 0;
  return chk === parseInt(d[10], 10);
}
function isValidCNPJ(v: string): boolean {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (slice: string, weights: number[]) => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(slice[i], 10) * w, 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(d.slice(0, 12), w1) === parseInt(d[12], 10) && calc(d.slice(0, 13), w2) === parseInt(d[13], 10);
}
function isValidPhone(v: string): boolean {
  const d = onlyDigits(v);
  return d.length === 10 || d.length === 11;
}
function maskCPF(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}
function maskCNPJ(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
function maskPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d)/, '($1) $2-$3');
  return d.replace(/^(\d{2})(\d{5})(\d)/, '($1) $2-$3');
}
function maskCard(v: string): string {
  return onlyDigits(v).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
}
function maskExpiry(v: string): string {
  const d = onlyDigits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ── Componente principal ──────────────────────────────────────────────── */
export default function Checkout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [billingGate, setBillingGate] = useState<'checking' | 'public'>('checking');
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  // ?plano=pro|basico (links separados por plano). Compat: plano=mensal|anual → Pro.
  const planoRaw = searchParams.get('plano') || 'pro';
  const planType: PlanType =
    planoRaw === 'basico' ? 'basico' : planoRaw === 'enterprise' ? 'enterprise' : 'pro';
  const cicloFromPlano: Ciclo | null =
    planoRaw === 'anual' ? 'anual' : planoRaw === 'mensal' ? 'mensal' : null;
  const cicloParam = searchParams.get('ciclo');
  const initialCiclo: Ciclo =
    cicloParam === 'anual' ? 'anual'
    : cicloParam === 'mensal' ? 'mensal'
    : (cicloFromPlano ?? 'mensal');
  const [ciclo, setCiclo] = useState<Ciclo>(initialCiclo);

  // Preços ao vivo (checkout-pricing): resolve fundador/normal + setup/recorrência.
  const [pricing, setPricing] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('checkout-pricing', { body: {} });
        if (alive && !error && data) setPricing(data);
      } catch { /* mantém o estado de carregamento; UI mostra "—" até resolver */ }
    })();
    return () => { alive = false; };
  }, []);

  const [step, setStep] = useState<Step>(1);

  // Etapa 1
  const [personType, setPersonType] = useState<PersonType>('pf');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [docNumber, setDocNumber] = useState(''); // CPF ou CNPJ
  const [phone, setPhone] = useState('');

  // Etapa 2
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');

  // Etapa 3
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // O checkout também é uma rota pública para novos clientes, mas uma conta
  // interna/administrativa autenticada nunca deve permanecer nele. Isso evita
  // que o usuário fique preso na tela depois que o paywall foi corrigido no
  // RPC: a rota já estava aberta e não reavaliava o destino.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) {
          if (alive) {
            setSignedInEmail(null);
            setBillingGate('public');
          }
          return;
        }

        setSignedInEmail(user.email ?? null);

        const { data: status, error } = await (supabase as any).rpc(
          'get_effective_subscription_status',
          { p_user_id: user.id },
        );
        if (!alive) return;

        const isBillingExempt = !error && (
          status?.billing_exempt === true
          || status?.status === 'administrativa'
          || status?.status === 'interna'
        );

        if (isBillingExempt) {
          navigate('/tela-inicial', { replace: true });
          return;
        }

        setBillingGate('public');
      } catch {
        // Falha de rede não bloqueia o checkout público.
        if (alive) setBillingGate('public');
      }
    })();

    return () => {
      alive = false;
    };
  }, [navigate]);

  // Validações da etapa 1
  const docValid = personType === 'pf' ? isValidCPF(docNumber) : isValidCNPJ(docNumber);
  const step1Valid = fullName.trim().length >= 3 && isValidEmail(email) && docValid && isValidPhone(phone);

  // Validações da etapa 2
  const step2Valid = useMemo(() => {
    if (paymentMethod === 'pix' || paymentMethod === 'boleto') return true;
    const numD = onlyDigits(cardNumber);
    return numD.length >= 13 && cardExpiry.length === 5 && cardCvv.length >= 3 && cardName.trim().length >= 3;
  }, [paymentMethod, cardNumber, cardExpiry, cardCvv, cardName]);

  const canGoToStep3 = step1Valid && step2Valid;
  const canSubmit = canGoToStep3 && agreedTerms && !submitting;

  // ── Valores do plano (do checkout-pricing; mostra "—" enquanto carrega) ──
  const planLabel = planType === 'pro' ? 'PRO' : planType === 'enterprise' ? 'PRO MAX' : 'Básico';
  const planPricing: any = pricing ? pricing[planType] : null;
  const cyclePricing: any = planPricing ? planPricing[ciclo] : null;
  const setupValue: number | null = cyclePricing?.setup ?? null;
  const recurrenceValue: number | null = cyclePricing?.recurrence ?? null;
  const totalTodayValue: number | null =
    setupValue != null && recurrenceValue != null ? setupValue + recurrenceValue : null;
  const hasTier = planType === 'pro' || planType === 'enterprise';
  const isFundador: boolean = hasTier && planPricing?.tier === 'fundador';
  const foundersLeft: number | null = hasTier ? (planPricing?.foundersLeft ?? null) : null;

  const recurrenceDisplay =
    recurrenceValue != null ? `${brl(recurrenceValue)}${ciclo === 'anual' ? '/ano' : '/mês'}` : '—';
  const setupDisplay = setupValue != null ? brl(setupValue) : '—';
  const totalTodayDisplay = totalTodayValue != null ? brl(totalTodayValue) : '—';
  const priceEquivalent =
    ciclo === 'anual' && recurrenceValue != null
      ? `${brl(recurrenceValue / 12)}/mês equivalente`
      : 'cobrado mensalmente';
  const economiaAnual =
    planPricing && ciclo === 'anual'
      ? planPricing.mensal.recurrence * 12 - planPricing.anual.recurrence
      : 0;

  const benefits = planType === 'enterprise'
    ? [
        'Conversas ilimitadas · sua chave de IA',
        'Tudo do Pro incluso',
        'Todos os agentes liberados',
        'Conexões de WhatsApp ilimitadas',
        'Todas as integrações',
        'Acompanhe as conversas dos vendedores',
        'Suporte VIP prioritário',
      ]
    : planType === 'pro'
    ? [
        'Conversas ilimitadas · sua chave de IA',
        'Pedro 24/7 no WhatsApp',
        'Marcos · CRM ao vivo + disparo',
        'Importação ilimitada',
        'Multi-vendedor',
        'Suporte humano via WhatsApp',
      ]
    : [
        'Conversas ilimitadas · sua chave de IA',
        'Pedro 24/7 no WhatsApp',
        'CRM com seus leads',
        'Suporte humano via WhatsApp',
      ];

  // Persiste plano/ciclo no <title> pra clareza
  useEffect(() => {
    document.title = `Checkout ${planLabel} ${ciclo === 'anual' ? 'Anual' : 'Mensal'} · LOGOS|IA`;
  }, [planLabel, ciclo]);

  // Submit final — chama edge function checkout-create-subscription (Prompt 11)
  // Se a edge function não estiver deployada ainda, mostra mensagem amigável.
  const handlePayment = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      const payload: any = {
        plano: planType,
        ciclo,
        personType,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        document: onlyDigits(docNumber),
        phone: onlyDigits(phone),
        paymentMethod,
      };

      // Dados do cartão (só se método cartão) — vão direto pra Asaas, não armazenados
      if (paymentMethod === 'cartao') {
        payload.cardData = {
          number: cardNumber,
          expiry: cardExpiry,
          cvv: cardCvv,
          holderName: cardName.trim(),
        };
      }

      const { data, error } = await supabase.functions.invoke('checkout-create-subscription', {
        body: payload,
      });

      if (error) {
        // Edge function não deployada ainda OU erro de rede
        const errMsg = (error as any)?.message || 'Erro desconhecido';
        if (errMsg.includes('not found') || errMsg.includes('404')) {
          toast.error('Pagamento ainda não disponível', {
            description: 'A integração com Asaas está sendo finalizada. Tente novamente em alguns minutos ou entre em contato pelo WhatsApp.',
            duration: 10000,
          });
        } else {
          toast.error('Erro ao processar pagamento', {
            description: errMsg,
            duration: 8000,
          });
        }
        setSubmitting(false);
        return;
      }

      if (!data?.success) {
        toast.error('Falha no checkout', {
          description: data?.error || 'Erro desconhecido. Tente novamente.',
          duration: 8000,
        });
        setSubmitting(false);
        return;
      }

      // Sucesso! Redirecionar pra /checkout/sucesso passando os dados
      // (Página de sucesso é o Prompt 12)
      const pendingId = data.pendingId;
      const setup = data.setupPayment;

      // Guardar dados de pagamento em sessionStorage pra página de sucesso usar
      sessionStorage.setItem('checkout_result', JSON.stringify({
        pendingId,
        method: paymentMethod,
        plano: planType,
        ciclo,
        email,
        pix: setup?.pix,
        boleto: setup?.boleto,
        creditCard: setup?.creditCard,
        invoiceUrl: setup?.invoiceUrl,
      }));

      navigate('/checkout/sucesso', { replace: true });
    } catch (err: any) {
      console.error('[Checkout] erro inesperado:', err);
      toast.error('Erro inesperado', {
        description: err?.message || 'Tente novamente em instantes.',
        duration: 8000,
      });
      setSubmitting(false);
    }
  };

  const docMasked = personType === 'pf' ? maskCPF(docNumber) : maskCNPJ(docNumber);

  if (billingGate === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className="checkout-light min-h-screen text-foreground"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(212,160,23,0.06), transparent 60%), linear-gradient(180deg, #FBFCFE 0%, #EEF2F8 100%)',
      }}
    >

      {/* ── HEADER simplificado ───────────────────────────────────── */}
      <header
        className="border-b sticky top-0 z-50 backdrop-blur-md"
        style={{
          borderColor: 'rgba(15, 38, 71, 0.10)',
          background: 'rgba(255, 255, 255, 0.92)',
        }}
      >
        <div className="px-4 md:px-6 py-3.5 max-w-6xl mx-auto flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center shrink-0 hover:opacity-80 transition-opacity">
            <LogosIALogo size="sm" variant="light" />
          </Link>
          <div
            className="flex items-center gap-1.5 text-xs md:text-sm font-medium"
            style={{ color: 'var(--brand-success)' }}
          >
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Pagamento seguro · SSL</span>
            <span className="sm:hidden">Seguro · SSL</span>
            {signedInEmail && (
              <button
                type="button"
                className="ml-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5"
                style={{ color: 'var(--brand-navy)' }}
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate('/auth', { replace: true });
                }}
                title={`Sair de ${signedInEmail}`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Trocar conta
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">

        {/* Voltar pra landing */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm mb-6 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--brand-navy)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar pro site
        </Link>

        {/* Grid 2 colunas: form + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 lg:gap-10">

          {/* ── COLUNA ESQUERDA — FORMULÁRIO ─────────────────────── */}
          <div>

            {/* Progress indicator */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                {[1, 2, 3].map((s) => {
                  const isComplete = step > s;
                  const isCurrent = step === s;
                  return (
                    <div key={s} className="flex items-center flex-1 last:flex-initial">
                      <div
                        className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold transition-all shrink-0"
                        style={{
                          background: isComplete ? 'var(--brand-success)' : isCurrent ? 'var(--brand-gold)' : 'rgba(15, 38, 71, 0.10)',
                          color: isComplete || isCurrent ? (isComplete ? 'white' : 'var(--brand-navy)') : 'var(--brand-navy)',
                          border: isCurrent ? `2px solid var(--brand-gold)` : 'none',
                        }}
                      >
                        {isComplete ? <CheckCircle2 className="h-5 w-5" /> : s}
                      </div>
                      {s < 3 && (
                        <div
                          className="flex-1 h-0.5 mx-2"
                          style={{ background: step > s ? 'var(--brand-success)' : 'rgba(15, 38, 71, 0.10)' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[11px] md:text-xs text-muted-foreground">
                <span>Dados</span>
                <span>Pagamento</span>
                <span>Revisão</span>
              </div>
            </div>

            {/* ── ETAPA 1 — DADOS PESSOAIS ─────────────────────── */}
            {step === 1 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h2
                    className="text-2xl md:text-3xl font-extrabold mb-2"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
                  >
                    Quem está assinando?
                  </h2>
                  <p className="text-sm text-muted-foreground">Usamos esses dados pra emitir a nota fiscal e liberar o acesso.</p>
                </div>

                {/* Toggle PF/PJ */}
                <div className="inline-flex p-1 rounded-full" style={{ background: 'rgba(15, 38, 71, 0.06)' }}>
                  <button
                    type="button"
                    onClick={() => { setPersonType('pf'); setDocNumber(''); }}
                    className="px-5 py-1.5 rounded-full text-xs md:text-sm font-semibold transition-all"
                    style={{
                      background: personType === 'pf' ? 'var(--brand-navy)' : 'transparent',
                      color: personType === 'pf' ? 'var(--brand-cream)' : 'var(--brand-navy)',
                    }}
                  >
                    Pessoa Física
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPersonType('pj'); setDocNumber(''); }}
                    className="px-5 py-1.5 rounded-full text-xs md:text-sm font-semibold transition-all"
                    style={{
                      background: personType === 'pj' ? 'var(--brand-navy)' : 'transparent',
                      color: personType === 'pj' ? 'var(--brand-cream)' : 'var(--brand-navy)',
                    }}
                  >
                    Pessoa Jurídica
                  </button>
                </div>

                {/* Formulário */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <Label htmlFor="fullName" className="text-xs font-semibold mb-1.5 block">
                      {personType === 'pf' ? 'Nome completo *' : 'Razão social *'}
                    </Label>
                    <Input
                      id="fullName"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={personType === 'pf' ? 'João da Silva' : 'Empresa LTDA'}
                      autoComplete={personType === 'pf' ? 'name' : 'organization'}
                    />
                  </div>

                  <div>
                    <Label htmlFor="email" className="text-xs font-semibold mb-1.5 block">E-mail *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="voce@empresa.com.br"
                      autoComplete="email"
                    />
                    {email.length > 0 && !isValidEmail(email) && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--brand-error)' }}>E-mail inválido</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="doc" className="text-xs font-semibold mb-1.5 block">
                      {personType === 'pf' ? 'CPF *' : 'CNPJ *'}
                    </Label>
                    <Input
                      id="doc"
                      value={docMasked}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder={personType === 'pf' ? '000.000.000-00' : '00.000.000/0001-00'}
                      inputMode="numeric"
                    />
                    {docNumber.length > 0 && !docValid && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--brand-error)' }}>
                        {personType === 'pf' ? 'CPF inválido' : 'CNPJ inválido'}
                      </p>
                    )}
                  </div>

                  <div className="sm:col-span-2">
                    <Label htmlFor="phone" className="text-xs font-semibold mb-1.5 block">Telefone WhatsApp *</Label>
                    <Input
                      id="phone"
                      value={maskPhone(phone)}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                    {phone.length > 0 && !isValidPhone(phone) && (
                      <p className="text-[11px] mt-1" style={{ color: 'var(--brand-error)' }}>Telefone inválido</p>
                    )}
                  </div>
                </div>

                {/* CTA continuar */}
                <Button
                  onClick={() => setStep(2)}
                  disabled={!step1Valid}
                  size="lg"
                  className="w-full text-base font-semibold gap-2"
                  style={{
                    background: step1Valid ? 'var(--brand-gold)' : 'rgba(15, 38, 71, 0.20)',
                    color: step1Valid ? 'var(--brand-navy)' : 'var(--brand-cream)',
                    cursor: step1Valid ? 'pointer' : 'not-allowed',
                  }}
                >
                  Continuar <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* ── ETAPA 2 — PAGAMENTO ─────────────────────── */}
            {step === 2 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h2
                    className="text-2xl md:text-3xl font-extrabold mb-2"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
                  >
                    Como você quer pagar?
                  </h2>
                  <p className="text-sm text-muted-foreground">PIX libera mais rápido. Cartão é recorrente automático.</p>
                </div>

                {/* Radio cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { id: 'pix', label: 'PIX', desc: 'Mais rápido', Icon: QrCode },
                    { id: 'cartao', label: 'Cartão', desc: 'Recorrente', Icon: CreditCard },
                    { id: 'boleto', label: 'Boleto', desc: '3 dias úteis', Icon: FileText },
                  ] as const).map((opt) => {
                    const selected = paymentMethod === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPaymentMethod(opt.id)}
                        className="rounded-2xl p-4 text-left transition-all hover:translate-y-[-2px]"
                        style={{
                          border: selected ? `2px solid var(--brand-gold)` : '1px solid rgba(15, 38, 71, 0.10)',
                          background: selected ? 'rgba(212, 160, 23, 0.06)' : 'var(--brand-light)',
                          boxShadow: selected ? 'var(--shadow-medium)' : 'var(--shadow-soft)',
                        }}
                      >
                        <opt.Icon
                          className="h-6 w-6 mb-2"
                          style={{ color: selected ? 'var(--brand-gold)' : 'var(--brand-navy)' }}
                        />
                        <p className="font-bold text-sm" style={{ color: 'var(--brand-navy)' }}>{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Detalhes por método */}
                {paymentMethod === 'pix' && (
                  <div
                    className="rounded-xl p-5"
                    style={{ background: 'rgba(22, 163, 74, 0.06)', border: '1px solid var(--brand-success)' }}
                  >
                    <div className="flex items-start gap-3">
                      <QrCode className="h-6 w-6 mt-0.5 shrink-0" style={{ color: 'var(--brand-success)' }} />
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--brand-navy)' }}>
                          PIX — pagamento instantâneo
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ao confirmar, você verá o QR Code e o código copia-e-cola. Liberação automática em até 5 minutos após o pagamento.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'boleto' && (
                  <div
                    className="rounded-xl p-5"
                    style={{ background: 'rgba(15, 38, 71, 0.04)', border: '1px solid rgba(15, 38, 71, 0.15)' }}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="h-6 w-6 mt-0.5 shrink-0" style={{ color: 'var(--brand-navy)' }} />
                      <div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--brand-navy)' }}>
                          Boleto bancário
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Você receberá o boleto por e-mail e poderá pagar em qualquer banco. Compensação em até 3 dias úteis.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'cartao' && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="cardNumber" className="text-xs font-semibold mb-1.5 block">Número do cartão *</Label>
                      <Input
                        id="cardNumber"
                        value={maskCard(cardNumber)}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="0000 0000 0000 0000"
                        inputMode="numeric"
                        autoComplete="cc-number"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="cardExpiry" className="text-xs font-semibold mb-1.5 block">Validade (MM/AA) *</Label>
                        <Input
                          id="cardExpiry"
                          value={maskExpiry(cardExpiry)}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          placeholder="12/28"
                          inputMode="numeric"
                          autoComplete="cc-exp"
                        />
                      </div>
                      <div>
                        <Label htmlFor="cardCvv" className="text-xs font-semibold mb-1.5 block">CVV *</Label>
                        <Input
                          id="cardCvv"
                          value={onlyDigits(cardCvv).slice(0, 4)}
                          onChange={(e) => setCardCvv(e.target.value)}
                          placeholder="123"
                          inputMode="numeric"
                          autoComplete="cc-csc"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="cardName" className="text-xs font-semibold mb-1.5 block">Nome impresso no cartão *</Label>
                      <Input
                        id="cardName"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value.toUpperCase())}
                        placeholder="JOÃO DA SILVA"
                        autoComplete="cc-name"
                      />
                    </div>
                    <p className="text-[11px] flex items-center gap-1.5 text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Dados do cartão são enviados criptografados direto pro gateway. Não armazenamos.
                    </p>
                  </div>
                )}

                {/* Navegação */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep(1)}
                    size="lg"
                    className="gap-2"
                    style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                  >
                    <ArrowLeft className="h-4 w-4" /> Voltar
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    disabled={!step2Valid}
                    size="lg"
                    className="flex-1 text-base font-semibold gap-2"
                    style={{
                      background: step2Valid ? 'var(--brand-gold)' : 'rgba(15, 38, 71, 0.20)',
                      color: step2Valid ? 'var(--brand-navy)' : 'var(--brand-cream)',
                      cursor: step2Valid ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Revisar pedido <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── ETAPA 3 — REVISÃO ─────────────────────── */}
            {step === 3 && (
              <div className="space-y-6 animate-fade-in">
                <div>
                  <h2
                    className="text-2xl md:text-3xl font-extrabold mb-2"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-navy)' }}
                  >
                    Conferir e confirmar
                  </h2>
                  <p className="text-sm text-muted-foreground">Confira os dados antes de pagar.</p>
                </div>

                {/* Resumo dados pessoais */}
                <div
                  className="rounded-xl p-5"
                  style={{ background: 'var(--brand-light)', border: '1px solid rgba(15, 38, 71, 0.10)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4" style={{ color: 'var(--brand-navy)' }} />
                      <p className="font-bold text-sm" style={{ color: 'var(--brand-navy)' }}>Seus dados</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="text-xs underline hover:no-underline"
                      style={{ color: 'var(--brand-navy)' }}
                    >
                      Editar
                    </button>
                  </div>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{personType === 'pf' ? 'Nome' : 'Razão social'}:</dt><dd className="text-right font-medium">{fullName}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">E-mail:</dt><dd className="text-right font-medium truncate">{email}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{personType === 'pf' ? 'CPF' : 'CNPJ'}:</dt><dd className="text-right font-medium">{docMasked}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">WhatsApp:</dt><dd className="text-right font-medium">{maskPhone(phone)}</dd></div>
                  </dl>
                </div>

                {/* Resumo pagamento */}
                <div
                  className="rounded-xl p-5"
                  style={{ background: 'var(--brand-light)', border: '1px solid rgba(15, 38, 71, 0.10)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {paymentMethod === 'pix' && <QrCode className="h-4 w-4" style={{ color: 'var(--brand-navy)' }} />}
                      {paymentMethod === 'cartao' && <CreditCard className="h-4 w-4" style={{ color: 'var(--brand-navy)' }} />}
                      {paymentMethod === 'boleto' && <FileText className="h-4 w-4" style={{ color: 'var(--brand-navy)' }} />}
                      <p className="font-bold text-sm" style={{ color: 'var(--brand-navy)' }}>Método de pagamento</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStep(2)}
                      className="text-xs underline hover:no-underline"
                      style={{ color: 'var(--brand-navy)' }}
                    >
                      Alterar
                    </button>
                  </div>
                  <p className="text-sm font-medium">
                    {paymentMethod === 'pix' && 'PIX — QR Code instantâneo'}
                    {paymentMethod === 'cartao' && `Cartão final ${onlyDigits(cardNumber).slice(-4)} · ${cardName}`}
                    {paymentMethod === 'boleto' && 'Boleto bancário — compensação em 3 dias úteis'}
                  </p>
                </div>

                {/* Aceite termos */}
                <div
                  className="rounded-xl p-4 flex items-start gap-3"
                  style={{ background: 'rgba(212, 160, 23, 0.05)', border: '1px solid rgba(212, 160, 23, 0.25)' }}
                >
                  <Checkbox
                    id="terms"
                    checked={agreedTerms}
                    onCheckedChange={(v) => setAgreedTerms(v === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="terms" className="text-xs leading-relaxed cursor-pointer">
                    Li e aceito os{' '}
                    <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="underline font-medium" style={{ color: 'var(--brand-navy)' }}>
                      Termos de Uso
                    </a>{' '}
                    e a{' '}
                    <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="underline font-medium" style={{ color: 'var(--brand-navy)' }}>
                      Política de Privacidade
                    </a>
                    . Entendo que o plano {planLabel} é cobrado de forma recorrente e posso cancelar a qualquer momento.
                  </label>
                </div>

                {/* Navegação */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep(2)}
                    size="lg"
                    className="gap-2"
                    style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                  >
                    <ArrowLeft className="h-4 w-4" /> Voltar
                  </Button>
                  <Button
                    onClick={handlePayment}
                    disabled={!canSubmit}
                    size="lg"
                    className="flex-1 text-base font-bold gap-2 py-6"
                    style={{
                      background: canSubmit ? 'var(--brand-gold)' : 'rgba(15, 38, 71, 0.20)',
                      color: canSubmit ? 'var(--brand-navy)' : 'var(--brand-cream)',
                      cursor: canSubmit ? 'pointer' : 'not-allowed',
                      boxShadow: canSubmit ? 'var(--shadow-gold)' : 'none',
                    }}
                  >
                    {submitting ? 'Processando...' : (
                      <>
                        <Lock className="h-5 w-5" />
                        Pagar agora — {totalTodayDisplay}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── COLUNA DIREITA — SIDEBAR DE RESUMO ──────────────── */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(160deg, #12305C 0%, var(--brand-navy) 55%, #0A1C36 100%)',
                color: 'var(--brand-cream)',
                boxShadow: '0 24px 60px -20px rgba(15, 38, 71, 0.55)',
                border: '1px solid rgba(212, 160, 23, 0.22)',
              }}
            >
              {/* Faixa de destaque dourada no topo */}
              <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--brand-gold), #F0C75A, var(--brand-gold))' }} />

              <div className="p-6 md:p-7">
                {/* Badge + fundador */}
                <div className="flex items-center justify-between gap-2 mb-5">
                  <Badge
                    className="border-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: 'var(--brand-gold)', color: 'var(--brand-navy)' }}
                  >
                    ★ Plano {planLabel}
                  </Badge>
                  {isFundador && foundersLeft != null && foundersLeft > 0 && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
                      style={{ background: 'rgba(212, 160, 23, 0.15)', color: 'var(--brand-gold)', border: '1px solid rgba(212, 160, 23, 0.35)' }}
                    >
                      {foundersLeft === 1 ? 'Resta 1 vaga' : `Fundador · ${foundersLeft} vagas`}
                    </span>
                  )}
                </div>

                {/* Toggle Mensal/Anual */}
                <div className="inline-flex p-1 rounded-full mb-5" style={{ background: 'rgba(250, 248, 242, 0.10)', border: '1px solid rgba(250, 248, 242, 0.10)' }}>
                  {(['mensal', 'anual'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCiclo(c)}
                      className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
                      style={{
                        background: ciclo === c ? 'var(--brand-gold)' : 'transparent',
                        color: ciclo === c ? 'var(--brand-navy)' : 'rgba(250, 248, 242, 0.85)',
                        boxShadow: ciclo === c ? '0 2px 8px rgba(212, 160, 23, 0.35)' : 'none',
                      }}
                    >
                      {c === 'mensal' ? 'Mensal' : 'Anual'}
                    </button>
                  ))}
                </div>

                {/* Tipo de cobrança */}
                <h3 className="text-2xl font-extrabold mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-cream)' }}>
                  {planLabel} · {ciclo === 'anual' ? 'Anual' : 'Mensal'}
                </h3>
                <p className="text-xs mb-5" style={{ color: 'rgba(250, 248, 242, 0.65)' }}>
                  Cobrança {ciclo === 'anual' ? 'anual' : 'mensal'} · cancelamento livre
                </p>

                {/* Mensalidade */}
                <div className="mb-5 pb-5" style={{ borderBottom: '1px solid rgba(250, 248, 242, 0.14)' }}>
                  <p
                    className="text-4xl md:text-[2.75rem] leading-none font-black"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-gold)' }}
                  >
                    {recurrenceDisplay}
                  </p>
                  <p className="text-xs mt-2" style={{ color: 'rgba(250, 248, 242, 0.70)' }}>{priceEquivalent}</p>
                  {economiaAnual > 0 && (
                    <p
                      className="text-[11px] mt-2 inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md"
                      style={{ background: 'rgba(22, 163, 74, 0.18)', color: '#5BE49B' }}
                    >
                      Economia de {brl(economiaAnual)} no ano
                    </p>
                  )}
                </div>

                {/* Taxa de implementação */}
                <div className="mb-5 pb-5" style={{ borderBottom: '1px solid rgba(250, 248, 242, 0.14)' }}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm" style={{ color: 'rgba(250, 248, 242, 0.88)' }}>Taxa de implementação</span>
                    <span className="text-sm font-bold" style={{ color: 'var(--brand-cream)' }}>{setupDisplay}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'rgba(250, 248, 242, 0.55)' }}>Cobrada uma única vez no primeiro pagamento</p>
                </div>

                {/* Total hoje — painel dourado em destaque */}
                <div
                  className="mb-6 rounded-xl p-4"
                  style={{ background: 'rgba(212, 160, 23, 0.10)', border: '1px solid rgba(212, 160, 23, 0.30)' }}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'rgba(250, 248, 242, 0.80)' }}>Total hoje</span>
                    <span className="text-[1.75rem] leading-none font-black" style={{ fontFamily: 'var(--font-display)', color: 'var(--brand-gold)' }}>
                      {totalTodayDisplay}
                    </span>
                  </div>
                  <p className="text-[10px] mt-1.5 text-right" style={{ color: 'rgba(250, 248, 242, 0.60)' }}>
                    {setupDisplay} de setup + {recurrenceDisplay}
                  </p>
                </div>

                {/* Lista de benefícios */}
                <ul className="space-y-2.5 text-[13px]">
                  {benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 shrink-0 rounded-full flex items-center justify-center"
                        style={{ width: 18, height: 18, background: 'rgba(212, 160, 23, 0.18)' }}
                      >
                        <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--brand-gold)' }} />
                      </span>
                      <span style={{ color: 'rgba(250, 248, 242, 0.92)' }}>{b}</span>
                    </li>
                  ))}
                </ul>

                {/* Selo de segurança */}
                <div
                  className="mt-6 pt-5 flex items-center justify-center gap-2 text-[11px]"
                  style={{ borderTop: '1px solid rgba(250, 248, 242, 0.14)', color: 'rgba(250, 248, 242, 0.72)' }}
                >
                  <Shield className="h-3.5 w-3.5" style={{ color: 'var(--brand-gold)' }} />
                  <span>Pagamento 100% seguro · SSL/TLS</span>
                </div>
              </div>
            </div>

            {/* Nota lateral */}
            <p className="mt-5 text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
              <Sparkles className="h-3 w-3" style={{ color: 'var(--brand-gold)' }} />
              Acesso liberado em até 5 minutos após confirmação
            </p>
          </aside>

        </div>
      </main>

      {/* ── RODAPE — identidade legal da empresa (conformidade Meta/WhatsApp) ── */}
      <footer className="border-t mt-4" style={{ borderColor: 'rgba(15, 38, 71, 0.10)' }}>
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(15, 38, 71, 0.80)' }}>
            <span className="font-semibold" style={{ color: 'var(--brand-navy)' }}>Agencia Up Business LTDA</span>
            <span style={{ opacity: 0.75 }}>&nbsp;·&nbsp;CNPJ 45.660.833/0001-17&nbsp;·&nbsp;Taubaté/SP</span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs" style={{ color: 'rgba(15, 38, 71, 0.60)' }}>
            <span>© {new Date().getFullYear()} LOGOS|IA</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <a href="/privacy-policy.html" target="_blank" rel="noopener noreferrer" className="hover:underline">Privacidade</a>
            <span style={{ opacity: 0.4 }}>·</span>
            <a href="/terms-of-service.html" target="_blank" rel="noopener noreferrer" className="hover:underline">Termos de Uso</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
