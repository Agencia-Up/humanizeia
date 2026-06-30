/**
 * RecargaDialog — pagamento de recarga avulsa de atendimentos (dentro do painel).
 *
 * Aberto em "Meu Plano -> Recarregar". Mesma experiencia premium do checkout,
 * porem autenticado e com 1-clique quando o cliente ja tem cartao salvo.
 *
 * Fluxos:
 *   - Cartao salvo  -> 1 clique, credita na hora (edge credita sincrono).
 *   - Cartao novo   -> formulario; salva o cartao p/ proximas recargas (opcional).
 *   - PIX           -> mostra QR + copia-e-cola; credita quando o Asaas confirma.
 *
 * Chama a edge function `recarga-create-payment` (JWT do usuario logado).
 */

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { descricaoErro } from '@/lib/erroAmigavel';
import {
  CreditCard, QrCode, Lock, CheckCircle2, Zap, Copy, Loader2, ShieldCheck,
} from 'lucide-react';

/* ── helpers ────────────────────────────────────────────────────────── */
function onlyDigits(v: string): string { return (v || '').replace(/\D/g, ''); }
function maskCard(v: string): string {
  return onlyDigits(v).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
}
function maskExpiry(v: string): string {
  const d = onlyDigits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function maskDoc(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}
function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmt(n: number): string { return n.toLocaleString('pt-BR'); }

type Metodo = 'cartao_salvo' | 'cartao' | 'pix';

interface SavedCard { last4: string | null; brand: string | null; }
interface Pkg { atendimentos: number; price: number; }
interface RecargaResult {
  credited: boolean;
  status: string;
  balanceAfter: number | null;
  pix: { payload: string; qrCode: string; expirationDate?: string } | null;
  savedCard: SavedCard | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg: Pkg | null;
  savedCard: SavedCard | null;
  onCredited: () => void;
}

export default function RecargaDialog({ open, onOpenChange, pkg, savedCard, onCredited }: Props) {
  const { toast } = useToast();
  const hasSaved = !!savedCard?.last4;

  const [metodo, setMetodo] = useState<Metodo>(hasSaved ? 'cartao_salvo' : 'cartao');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardName, setCardName] = useState('');
  const [doc, setDoc] = useState('');
  const [saveCard, setSaveCard] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RecargaResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Mantem o ultimo pacote enquanto o dialog fecha (evita desmontar o Radix de
  // forma abrupta no meio da animacao de fechamento).
  const lastPkgRef = useRef<Pkg | null>(null);
  if (pkg) lastPkgRef.current = pkg;
  const shownPkg = pkg ?? lastPkgRef.current;

  // Reseta tudo ao (re)abrir.
  useEffect(() => {
    if (open) {
      setMetodo(hasSaved ? 'cartao_salvo' : 'cartao');
      setCardNumber(''); setCardExpiry(''); setCardCvv(''); setCardName('');
      setDoc(''); setSaveCard(true); setSubmitting(false); setResult(null); setCopied(false);
    }
  }, [open, hasSaved]);

  // Rede de seguranca: o Radix Dialog as vezes deixa o body com
  // `pointer-events: none` (tela inteira fica sem clicar) se o componente
  // desmonta no meio do fechamento. Garante a liberacao ao fechar/desmontar.
  useEffect(() => {
    if (!open) {
      const id = window.setTimeout(() => {
        if (document.body.style.pointerEvents === 'none') {
          document.body.style.pointerEvents = '';
        }
      }, 350);
      return () => window.clearTimeout(id);
    }
  }, [open]);
  useEffect(() => () => { document.body.style.pointerEvents = ''; }, []);

  if (!shownPkg) return null;

  const cardValid =
    onlyDigits(cardNumber).length >= 13 &&
    cardExpiry.length === 5 &&
    onlyDigits(cardCvv).length >= 3 &&
    cardName.trim().length >= 3;

  const canPay =
    !submitting &&
    (metodo === 'cartao_salvo' || metodo === 'pix' || (metodo === 'cartao' && cardValid));

  const handlePay = async () => {
    if (!canPay || !shownPkg) return;
    setSubmitting(true);
    try {
      const payload: any = {
        pacote: shownPkg.atendimentos,
        paymentMethod: metodo,
        document: onlyDigits(doc) || undefined,
      };
      if (metodo === 'cartao') {
        payload.cardData = {
          number: cardNumber,
          expiry: cardExpiry,
          cvv: cardCvv,
          holderName: cardName.trim(),
        };
        payload.saveCard = saveCard;
      }

      const { data, error } = await supabase.functions.invoke('recarga-create-payment', { body: payload });

      if (error || !data?.success) {
        const msg = data?.error || (error as any)?.message || 'Não foi possível processar a recarga.';
        toast({ title: 'Erro na recarga', description: msg, variant: 'destructive' });
        setSubmitting(false);
        return;
      }

      const res: RecargaResult = {
        credited: !!data.credited,
        status: data.status,
        balanceAfter: data.balanceAfter ?? null,
        pix: data.pix || null,
        savedCard: data.savedCard || null,
      };
      setResult(res);
      setSubmitting(false);

      if (res.credited) {
        toast({
          title: 'Recarga concluída!',
          description: `+${fmt(shownPkg.atendimentos)} atendimentos adicionados ao seu saldo.`,
        });
        onCredited();
      } else if (res.pix) {
        // PIX: aguarda confirmacao do Asaas (webhook credita). Nada a fazer agora.
      } else {
        toast({
          title: 'Pagamento registrado',
          description: 'Assim que for confirmado, os atendimentos entram no seu saldo.',
        });
        onCredited();
      }
    } catch (err: any) {
      toast({ title: 'Erro inesperado', description: descricaoErro(err) || 'Tente novamente.', variant: 'destructive' });
      setSubmitting(false);
    }
  };

  const copyPix = async () => {
    if (!result?.pix?.payload) return;
    try {
      await navigator.clipboard.writeText(result.pix.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard pode falhar em http; ignora */ }
  };

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
        {/* Cabecalho premium (navy) */}
        <div
          className="px-6 pt-6 pb-5"
          style={{ background: 'linear-gradient(135deg, #0F2647 0%, #1B3A66 100%)' }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold" style={{ color: '#FAF8F2' }}>
              <Zap className="h-4 w-4" style={{ color: '#D4A017' }} />
              Recarregar atendimentos
            </DialogTitle>
          </DialogHeader>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(250,248,242,0.65)' }}>Pacote</p>
              <p className="text-lg font-extrabold" style={{ color: '#FAF8F2' }}>{fmt(shownPkg.atendimentos)} atendimentos</p>
            </div>
            <p className="text-2xl font-black" style={{ color: '#D4A017' }}>{brl(shownPkg.price)}</p>
          </div>
        </div>

        <div className="px-6 py-5">
          {/* ── Estado: SUCESSO (cartao creditado) ───────────────────── */}
          {result?.credited ? (
            <div className="flex flex-col items-center text-center py-4">
              <div className="rounded-full p-3 mb-3" style={{ background: 'rgba(22,163,74,0.12)' }}>
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <h3 className="font-bold text-lg">Recarga concluída!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                +{fmt(shownPkg.atendimentos)} atendimentos adicionados.
                {result.balanceAfter != null && <> Saldo atual: <strong>{fmt(result.balanceAfter)}</strong>.</>}
              </p>
              <Button className="mt-5 w-full" onClick={() => onOpenChange(false)}>Fechar</Button>
            </div>

          /* ── Estado: PIX (aguardando) ─────────────────────────────── */
          ) : result?.pix ? (
            <div className="flex flex-col items-center text-center">
              <p className="text-sm text-muted-foreground mb-3">
                Escaneie o QR Code ou copie o código. Os atendimentos entram no seu saldo automaticamente
                após a confirmação (até ~5 min).
              </p>
              {result.pix.qrCode && (
                <img
                  src={`data:image/png;base64,${result.pix.qrCode}`}
                  alt="QR Code PIX"
                  className="w-44 h-44 rounded-lg border border-border bg-white p-2"
                />
              )}
              <Button variant="outline" className="mt-4 w-full gap-2" onClick={copyPix}>
                <Copy className="h-4 w-4" />
                {copied ? 'Código copiado!' : 'Copiar código PIX'}
              </Button>
              <Button className="mt-2 w-full" onClick={() => onOpenChange(false)}>Já paguei / Fechar</Button>
            </div>

          /* ── Estado: FORMULARIO ───────────────────────────────────── */
          ) : (
            <div className="space-y-4">
              {/* Seletor de metodo */}
              <div className="grid grid-cols-1 gap-2">
                {hasSaved && (
                  <button
                    type="button"
                    onClick={() => setMetodo('cartao_salvo')}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                      metodo === 'cartao_salvo' ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-border'
                    }`}
                  >
                    <CreditCard className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">Cartão salvo · 1 clique</p>
                      <p className="text-xs text-muted-foreground">
                        {savedCard?.brand ? `${savedCard.brand} ` : ''}final •••• {savedCard?.last4}
                      </p>
                    </div>
                    {metodo === 'cartao_salvo' && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMetodo('cartao')}
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                      metodo === 'cartao' ? 'border-primary bg-primary/5 text-foreground' : 'border-border/60 text-muted-foreground hover:border-border'
                    }`}
                  >
                    <CreditCard className="h-4 w-4" /> {hasSaved ? 'Outro cartão' : 'Cartão'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMetodo('pix')}
                    className={`flex items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-all ${
                      metodo === 'pix' ? 'border-primary bg-primary/5 text-foreground' : 'border-border/60 text-muted-foreground hover:border-border'
                    }`}
                  >
                    <QrCode className="h-4 w-4" /> PIX
                  </button>
                </div>
              </div>

              {/* Form cartao novo */}
              {metodo === 'cartao' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <Label htmlFor="rc-num" className="text-xs font-semibold mb-1 block">Número do cartão</Label>
                    <Input id="rc-num" value={maskCard(cardNumber)} onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="0000 0000 0000 0000" inputMode="numeric" autoComplete="cc-number" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="rc-exp" className="text-xs font-semibold mb-1 block">Validade</Label>
                      <Input id="rc-exp" value={maskExpiry(cardExpiry)} onChange={(e) => setCardExpiry(e.target.value)}
                        placeholder="12/28" inputMode="numeric" autoComplete="cc-exp" />
                    </div>
                    <div>
                      <Label htmlFor="rc-cvv" className="text-xs font-semibold mb-1 block">CVV</Label>
                      <Input id="rc-cvv" value={onlyDigits(cardCvv).slice(0, 4)} onChange={(e) => setCardCvv(e.target.value)}
                        placeholder="123" inputMode="numeric" autoComplete="cc-csc" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="rc-name" className="text-xs font-semibold mb-1 block">Nome impresso no cartão</Label>
                    <Input id="rc-name" value={cardName} onChange={(e) => setCardName(e.target.value.toUpperCase())}
                      placeholder="JOÃO DA SILVA" autoComplete="cc-name" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={saveCard} onCheckedChange={(v) => setSaveCard(v === true)} />
                    <span className="text-xs text-muted-foreground">Salvar cartão para recargas em 1 clique</span>
                  </label>
                </div>
              )}

              {/* CPF/CNPJ opcional (fallback p/ criar cadastro no gateway) */}
              {(metodo === 'cartao' || metodo === 'pix') && (
                <div>
                  <Label htmlFor="rc-doc" className="text-xs font-semibold mb-1 block">
                    CPF/CNPJ <span className="text-muted-foreground font-normal">(se for sua 1ª recarga)</span>
                  </Label>
                  <Input id="rc-doc" value={maskDoc(doc)} onChange={(e) => setDoc(e.target.value)}
                    placeholder="000.000.000-00" inputMode="numeric" />
                </div>
              )}

              {metodo === 'pix' && (
                <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.25)' }}>
                  <QrCode className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                  <p className="text-xs text-muted-foreground">Ao confirmar, mostramos o QR Code e o copia-e-cola. Liberação automática após o pagamento.</p>
                </div>
              )}

              {/* Botao pagar */}
              <Button
                className="w-full gap-2 text-base font-bold py-5"
                style={{ background: '#D4A017', color: '#0F2647' }}
                disabled={!canPay}
                onClick={handlePay}
              >
                {submitting ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> Processando...</>
                ) : (
                  <><Lock className="h-4 w-4" /> Pagar {brl(shownPkg.price)}</>
                )}
              </Button>

              <p className="text-[11px] flex items-center justify-center gap-1.5 text-muted-foreground">
                <ShieldCheck className="h-3 w-3" /> Pagamento seguro · dados do cartão não são armazenados por nós
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
