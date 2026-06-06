// ============================================================================
// MetaAdsConnect — onboarding simples do Meta Ads (estilo Stripe/Notion OAuth)
// Fluxo: [Conectar com Facebook] -> wizard 3 passos (Empresa -> Contas ->
// Confirmar) -> Sucesso. Avancado (App ID/Secret) so para admin, num acordeao.
// Rota: /integrations/meta. O retorno do OAuth cai NESTA pagina (?code).
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  ArrowLeft, ArrowRight, Loader2, CheckCircle2, Megaphone, Users, BarChart3,
  Wallet, ShieldAlert, AlertCircle, PartyPopper, Building2, Check,
} from 'lucide-react';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { OperatorAppConfig } from '@/components/settings/OperatorAppConfig';

const REDIRECT_PATH = '/integrations/meta?meta_callback=true';

// Os 4 tipos de dado que serao importados — mostrados como chips simples.
const IMPORT_ITEMS = [
  { icon: Megaphone, label: 'Campanhas' },
  { icon: Users, label: 'Leads' },
  { icon: BarChart3, label: 'Métricas' },
  { icon: Wallet, label: 'Contas de anúncio' },
];

type Step = 1 | 2 | 3;
const STEP_LABELS = ['Empresa', 'Contas', 'Confirmar'];

function FacebookGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

/* Stepper horizontal simples e acessivel. */
function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center justify-center gap-2" aria-label={`Passo ${current} de 3`}>
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  active ? 'bg-blue-500 text-white'
                  : done ? 'bg-emerald-500 text-white'
                  : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : n}
              </span>
              <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'} hidden sm:inline`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && <span className="h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}

export default function MetaAdsConnect() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { isAdmin } = useIsAdmin();
  const meta = useMetaConnection();
  const {
    isConnecting, availableAccounts, businesses, hasPendingToken,
    connectedAccount, startOAuth, handleCallback, saveAccounts,
  } = meta;

  const [step, setStep] = useState<Step>(1);
  const [businessId, setBusinessId] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);
  const [callbackHandled, setCallbackHandled] = useState(false);

  // Retorno do OAuth: troca o ?code e abre o wizard.
  useEffect(() => {
    const code = params.get('code');
    if (code && !callbackHandled) {
      setCallbackHandled(true);
      handleCallback(code, REDIRECT_PATH).finally(() => {
        const next = new URLSearchParams(params);
        next.delete('code'); next.delete('state'); next.delete('meta_callback');
        setParams(next, { replace: true });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, callbackHandled]);

  // Filtra contas pela empresa escolhida (quando ha empresas).
  const accountsForBusiness = useMemo(() => {
    if (businessId === 'all' || businesses.length === 0) return availableAccounts;
    const biz = businesses.find((b) => b.id === businessId);
    if (!biz) return availableAccounts;
    const filtered = availableAccounts.filter((a) => (a.business_name || '') === biz.name);
    return filtered.length > 0 ? filtered : availableAccounts;
  }, [availableAccounts, businesses, businessId]);

  const toggleAccount = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedAccounts = availableAccounts.filter((a) => selected.has(a.id));
  const selectedBusinessName = businesses.find((b) => b.id === businessId)?.name || null;

  const finish = async () => {
    const ok = await saveAccounts(selectedAccounts);
    if (ok) setDone(true);
  };

  /* ─────────────────────────── ESTADOS DE TELA ─────────────────────────── */

  // Carregando o retorno do OAuth.
  const loadingCallback = isConnecting && !hasPendingToken && !done;

  // Em modo wizard quando o OAuth voltou com token.
  const inWizard = hasPendingToken && !done;

  // Erro: voltou do OAuth mas nenhuma conta de anuncio.
  const noAccounts = hasPendingToken && availableAccounts.length === 0;

  return (
    <MainLayout>
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-2xl flex-col justify-center px-4 py-6">
        {/* Voltar */}
        <button
          onClick={() => navigate('/integrations')}
          className="mb-4 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>

        {/* ============ SUCESSO ============ */}
        {done ? (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
                <PartyPopper className="h-8 w-8 text-emerald-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Integração concluída</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sua conta Meta foi conectada com sucesso.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {IMPORT_ITEMS.map((it) => (
                  <Badge key={it.label} className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" /> {it.label}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Estamos importando seus dados. Isso pode levar alguns minutos.</p>
              <Button className="mt-2 gap-2" onClick={() => navigate('/apollo')}>
                Ir para o Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

        /* ============ ERRO: SEM CONTAS ============ */
        ) : noAccounts ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <h2 className="text-lg font-bold">Nenhuma conta de anúncio encontrada</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Verifique se a conta possui campanhas ativas e se você tem acesso de
                administrador às contas de anúncio.
              </p>
              <Button variant="outline" onClick={() => navigate('/integrations')}>Voltar</Button>
            </CardContent>
          </Card>

        /* ============ CARREGANDO CALLBACK ============ */
        ) : loadingCallback ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              <p className="text-sm text-muted-foreground">Conectando com a Meta…</p>
            </CardContent>
          </Card>

        /* ============ WIZARD (3 PASSOS) ============ */
        ) : inWizard ? (
          <Card>
            <CardContent className="space-y-5 py-6">
              <Stepper current={step} />

              {/* Passo 1 — Empresa */}
              {step === 1 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-bold">Qual empresa deseja conectar?</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Escolha onde estão suas campanhas.</p>
                  <Select value={businessId} onValueChange={setBusinessId}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as empresas</SelectItem>
                      {businesses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex justify-end pt-1">
                    <Button className="gap-2" onClick={() => setStep(2)}>
                      Continuar <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Passo 2 — Contas */}
              {step === 2 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-bold">Quais contas deseja sincronizar?</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Você pode escolher mais de uma.</p>
                  <div className="max-h-[42vh] space-y-2 overflow-auto">
                    {accountsForBusiness.map((a) => {
                      const checked = selected.has(a.id);
                      return (
                        <label
                          key={a.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                            checked ? 'border-blue-500/50 bg-blue-500/5' : 'border-border/60 hover:border-border'
                          }`}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggleAccount(a.id)} aria-label={`Selecionar ${a.name}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{a.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {a.currency || ''}{a.business_name ? ` · ${a.business_name}` : ''}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
                      <ArrowLeft className="h-4 w-4" /> Voltar
                    </Button>
                    <Button className="gap-2" disabled={selected.size === 0} onClick={() => setStep(3)}>
                      Continuar ({selected.size}) <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Passo 3 — Confirmar */}
              {step === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-blue-500" />
                    <h2 className="text-lg font-bold">Confirmar integração</h2>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border/60 p-4 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Empresa</span><span className="font-medium">{selectedBusinessName || 'Todas'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Contas</span><span className="font-medium">{selected.size} selecionada{selected.size > 1 ? 's' : ''}</span></div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Dados que serão importados</p>
                    <div className="flex flex-wrap gap-2">
                      {IMPORT_ITEMS.map((it) => (
                        <Badge key={it.label} variant="outline" className="gap-1"><Check className="h-3 w-3 text-emerald-500" /> {it.label}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Button variant="ghost" onClick={() => setStep(2)} className="gap-2" disabled={isConnecting}>
                      <ArrowLeft className="h-4 w-4" /> Voltar
                    </Button>
                    <Button className="gap-2 bg-blue-600 hover:bg-blue-700 text-white" onClick={finish} disabled={isConnecting}>
                      {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Finalizar Integração
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        /* ============ JA CONECTADO ============ */
        ) : connectedAccount ? (
          <Card className="border-emerald-500/30">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <h2 className="text-lg font-bold">Meta Ads conectado</h2>
              <p className="text-sm text-muted-foreground">
                {connectedAccount.account_name} já está sincronizando.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate('/apollo')}>Ir para o Dashboard</Button>
                <Button variant="ghost" onClick={() => startOAuth(REDIRECT_PATH)} disabled={isConnecting}>
                  {isConnecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Conectar outra conta
                </Button>
              </div>
            </CardContent>
          </Card>

        /* ============ TELA INICIAL (CONECTAR) ============ */
        ) : (
          <div className="space-y-5">
            <Card>
              <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-500">
                  <FacebookGlyph />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Conectar Meta Ads</h1>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Conecte sua conta Meta para importar campanhas, leads e métricas automaticamente.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {IMPORT_ITEMS.map((it) => (
                    <Badge key={it.label} variant="outline" className="gap-1">
                      <it.icon className="h-3 w-3 text-blue-500" /> {it.label}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="lg"
                  className="mt-1 w-full gap-2 bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"
                  onClick={() => startOAuth(REDIRECT_PATH)}
                  disabled={isConnecting}
                >
                  {isConnecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <FacebookGlyph />}
                  Conectar com Facebook
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Conexão segura (OAuth). Não pedimos sua senha — você autoriza direto na Meta.
                </p>
              </CardContent>
            </Card>

            {/* Configuracoes avancadas — SO admin (App ID / Secret) */}
            {isAdmin && (
              <Accordion type="single" collapsible className="rounded-lg border border-border/60">
                <AccordionItem value="advanced" className="border-0">
                  <AccordionTrigger className="px-4 text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <ShieldAlert className="h-4 w-4 text-amber-500" /> Configurações avançadas (admin)
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4">
                    <OperatorAppConfig platformId="meta" />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
