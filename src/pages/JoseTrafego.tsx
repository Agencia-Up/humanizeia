import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JoseChat } from '@/components/jose/JoseChat';
import { SegmentKnowledgeBase } from '@/components/jose/SegmentKnowledgeBase';
import { JoseCreativeLibrary } from '@/components/jose/JoseCreativeLibrary';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import {
  useApolloAgent, useApolloCronConfig,
  ApolloAction, ApolloEnrichedCampaign, ApolloDatePreset,
} from '@/hooks/useApolloAgent';
import {
  Activity, AlertTriangle, Brain, CheckCircle, CheckCircle2, Clock,
  Loader2, MessageCircle, Phone, Plug, Radar, RefreshCw,
  Settings, TrendingDown, TrendingUp, Zap, ChevronRight, Layers, Image,
} from 'lucide-react';

// ── Segment Profiles (hardcoded base — extends DB records) ────────────────────
const BUILTIN_SEGMENTS = [
  {
    slug: 'veiculos',
    name: 'Agência de Veículos',
    description: 'Concessionárias, revendas e lojas de veículos novos e usados',
    icon: '🚗',
    color: 'border-blue-500/30 bg-blue-500/5 hover:border-blue-400/60',
    activeBg: 'border-blue-500 bg-blue-500/15',
    badge: 'bg-blue-500/20 text-blue-400',
    highlights: ['CPL R$30–80 ideal', 'Foco em leads', 'Remarketing essencial'],
  },
];

// ── SegmentSelector ────────────────────────────────────────────────────────────
function SegmentSelector({
  activeSlug, onToggle,
}: {
  activeSlug: string | null;
  onToggle: (slug: string | null) => void;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <p className="font-semibold text-sm">Segmento de Negócio</p>
          <Badge variant="outline" className="text-[10px] ml-auto">Beta</Badge>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Ative um segmento para que o José use benchmarks e regras específicas do seu tipo de negócio ao analisar suas campanhas.
        </p>

        <div className="space-y-2">
          {BUILTIN_SEGMENTS.map(seg => {
            const isActive = activeSlug === seg.slug;
            return (
              <button
                key={seg.slug}
                onClick={() => onToggle(isActive ? null : seg.slug)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${isActive ? seg.activeBg : seg.color}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{seg.icon}</span>
                    <div>
                      <p className="font-semibold text-sm">{seg.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{seg.description}</p>
                    </div>
                  </div>
                  <div className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${isActive ? 'border-blue-500 bg-blue-500' : 'border-border'}`}>
                    {isActive && <CheckCircle2 className="h-3 w-3 text-white" />}
                  </div>
                </div>
                {isActive && (
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {seg.highlights.map(h => (
                      <Badge key={h} variant="outline" className={`text-[10px] px-1.5 ${seg.badge}`}>
                        {h}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {activeSlug && (
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Segmento ativo — José usará as regras deste segmento na próxima análise
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const healthColor = (s: number) =>
  s >= 70 ? 'text-emerald-400' : s >= 45 ? 'text-amber-400' : 'text-red-400';
const healthBg = (s: number) =>
  s >= 70
    ? 'bg-emerald-500/10 border-emerald-500/20'
    : s >= 45
    ? 'bg-amber-500/10 border-amber-500/20'
    : 'bg-red-500/10 border-red-500/20';
const healthLabel = (s: number) =>
  s >= 70 ? '🟢 Saudável' : s >= 45 ? '🟡 Atenção' : '🔴 Crítico';
const healthEmoji = (s: number) =>
  s >= 70 ? '🟢' : s >= 45 ? '🟡' : '🔴';

const fmt = (n: number, d = 2) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function actionHumanLabel(type: string, campaignName: string): string {
  const name = campaignName ? `"${campaignName.slice(0, 35)}${campaignName.length > 35 ? '…' : ''}"` : 'esta campanha';
  const map: Record<string, string> = {
    pause: `Pausar ${name}`,
    activate: `Reativar ${name}`,
    increase_budget: `Aumentar o orçamento de ${name}`,
    decrease_budget: `Reduzir o orçamento de ${name}`,
    pause_adset: `Pausar um conjunto de anúncios em ${name}`,
    activate_adset: `Reativar um conjunto de anúncios em ${name}`,
    clone_campaign: `Duplicar ${name} (que está indo bem)`,
    rotate_creative: `Trocar os criativos de ${name} (estão saturados)`,
    reallocate_budget: `Redistribuir o orçamento entre as campanhas`,
    notify: `Verificar manualmente ${name}`,
  };
  return map[type] || `Executar ação em ${name}`;
}

const priorityLabel: Record<string, { label: string; cls: string }> = {
  critical: { label: 'Urgente', cls: 'bg-red-500/20 text-red-400 border-red-500/30' },
  high:     { label: 'Alta',    cls: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  medium:   { label: 'Média',   cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  low:      { label: 'Baixa',   cls: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
};

const DATE_PRESETS: { value: ApolloDatePreset; label: string }[] = [
  { value: 'today',    label: 'Hoje' },
  { value: 'last_7d',  label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
];

// ── CampaignCard (simplificado) ───────────────────────────────────────────────

function CampaignCard({
  campaign, currencySymbol,
}: {
  campaign: ApolloEnrichedCampaign; currencySymbol: string;
}) {
  const s = campaign.health_score;
  const isActive = campaign.effective_status === 'ACTIVE';

  const mainResult =
    campaign.roas > 0
      ? { label: 'Retorno (ROAS)', val: `${fmt(campaign.roas)}x`, good: campaign.roas >= 3 }
      : campaign.conversions > 0
      ? { label: 'Conversões', val: String(campaign.conversions), good: true }
      : { label: 'Cliques (CTR)', val: `${fmt(campaign.ctr)}%`, good: campaign.ctr >= 1.5 };

  return (
    <div className={`rounded-xl border p-4 space-y-4 ${healthBg(s)}`}>
      {/* Name + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight truncate" title={campaign.name}>
            {campaign.name}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 ${isActive ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}
            >
              {isActive ? 'Ativa' : 'Pausada'}
            </Badge>
            {campaign.objective && (
              <span className="text-[10px] text-muted-foreground capitalize">
                {campaign.objective.replace(/_/g, ' ').toLowerCase()}
              </span>
            )}
          </div>
        </div>
        {/* Health circle */}
        <div className="text-center flex-shrink-0">
          <div
            className={`w-12 h-12 rounded-full border-4 flex items-center justify-center ${
              s >= 70 ? 'border-emerald-500 bg-emerald-500/10'
              : s >= 45 ? 'border-amber-500 bg-amber-500/10'
              : 'border-red-500 bg-red-500/10'
            }`}
          >
            <span className={`text-base font-bold ${healthColor(s)}`}>{s}</span>
          </div>
          <p className={`text-[10px] font-semibold mt-0.5 ${healthColor(s)}`}>
            {s >= 70 ? 'Ótimo' : s >= 45 ? 'Atenção' : 'Crítico'}
          </p>
        </div>
      </div>

      <Progress value={s} className="h-1.5" />

      {/* 3 key metrics */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground">💰 Investido</p>
          <p className="text-xs font-bold mt-0.5">
            {currencySymbol} {fmt(campaign.spend)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">📈 {mainResult.label}</p>
          <p className={`text-xs font-bold mt-0.5 ${mainResult.good ? 'text-emerald-400' : 'text-amber-400'}`}>
            {mainResult.val}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">💵 Custo/Clique</p>
          <p className="text-xs font-bold mt-0.5">
            {campaign.cpc > 0 ? `${currencySymbol} ${fmt(campaign.cpc)}` : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── ActionCard (linguagem humana) ─────────────────────────────────────────────

function ActionCard({
  action, onExecute, onDismiss, isExecuting,
}: {
  action: ApolloAction; onExecute: () => void; onDismiss: () => void; isExecuting: boolean;
}) {
  const p = priorityLabel[action.priority] ?? priorityLabel.low;
  const humanLabel = actionHumanLabel(action.action_type, action.campaign_name ?? '');

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-snug">
            O José quer: <span className="text-foreground">{humanLabel}</span>
          </p>
        </div>
        <Badge variant="outline" className={`text-[10px] px-1.5 shrink-0 ${p.cls}`}>
          {p.label}
        </Badge>
      </div>

      {action.reason && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Por quê? </span>
          {action.reason}
        </p>
      )}
      {action.impact && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">O que muda? </span>
          {action.impact}
        </p>
      )}

      {action.action_type === 'clone_campaign' && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>A cópia será criada <strong>pausada</strong> — você ativa quando quiser no Meta Ads Manager.</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1 h-9 gap-1.5 text-xs font-semibold"
          onClick={onExecute}
          disabled={isExecuting}
        >
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          Confirmar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs text-muted-foreground"
          onClick={onDismiss}
          disabled={isExecuting}
        >
          Ignorar
        </Button>
      </div>
    </div>
  );
}

// ── CronSettings ──────────────────────────────────────────────────────────────

function CronSettings({
  activeSegment,
  setActiveSegment,
}: {
  activeSegment: string | null;
  setActiveSegment: (s: string | null) => void;
}) {
  const { config, isLoading, saveConfig } = useApolloCronConfig();
  const [hour, setHour] = useState(config?.run_hour ?? 8);
  const [autoExec, setAutoExec] = useState(config?.auto_execute ?? false);
  const [sendWa, setSendWa] = useState(config?.send_whatsapp_on_critical ?? true);
  const [sendDailyReport, setSendDailyReport] = useState(config?.send_daily_report ?? true);
  const [waNumber, setWaNumber] = useState(config?.whatsapp_report_number ?? '');
  const [enabled, setEnabled] = useState(config?.is_enabled ?? false);

  // Sync activeSegment from loaded config when it first arrives
  useEffect(() => {
    if (config?.active_segment_slug !== undefined && activeSegment === null) {
      setActiveSegment(config.active_segment_slug ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.active_segment_slug]);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length <= 11) setWaNumber(digits);
  };

  const save = () => {
    saveConfig.mutate({
      is_enabled: enabled,
      run_hour: hour,
      run_minute: 0,
      auto_execute: autoExec,
      send_whatsapp_on_critical: sendWa,
      send_daily_report: sendDailyReport,
      whatsapp_report_number: waNumber || null,
      active_segment_slug: activeSegment,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      {/* Auto-analysis */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">Análise automática diária</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                O José analisa suas campanhas sozinho todo dia e te avisa o que fazer
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <>
              <div className="flex items-center gap-3">
                <Label className="text-sm text-muted-foreground whitespace-nowrap">Horário da análise</Label>
                <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                  <SelectTrigger className="w-28 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {String(i).padStart(2, '0')}:00
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Executar ações automaticamente</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    José executa ajustes simples sem precisar da sua aprovação
                  </p>
                </div>
                <Switch checked={autoExec} onCheckedChange={setAutoExec} />
              </div>

              {config?.last_run_at && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Última análise: {new Date(config.last_run_at).toLocaleString('pt-BR')}
                </p>
              )}
              {config?.next_run_at && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Próxima análise: {new Date(config.next_run_at).toLocaleString('pt-BR')}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* WhatsApp alerts */}
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <MessageCircle className="h-4 w-4" />
            <p className="font-semibold text-sm">Alertas no WhatsApp</p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Seu número do WhatsApp</Label>
            <div className="relative mt-1.5">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="(11) 99999-9999"
                value={formatPhone(waNumber)}
                onChange={handlePhoneChange}
                className="pl-9 h-9 text-sm bg-background/50"
                maxLength={16}
              />
            </div>
            {waNumber.length > 0 && waNumber.length < 10 && (
              <p className="text-[11px] text-amber-400 mt-1">Número incompleto — inclua o DDD</p>
            )}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Relatório diário</p>
              <p className="text-xs text-muted-foreground mt-0.5">Resumo das campanhas toda manhã</p>
            </div>
            <Switch checked={sendDailyReport} onCheckedChange={setSendDailyReport} />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Alerta urgente</p>
              <p className="text-xs text-muted-foreground mt-0.5">Aviso imediato quando detectar problema grave</p>
            </div>
            <Switch checked={sendWa} onCheckedChange={setSendWa} />
          </div>
        </CardContent>
      </Card>

      <SegmentSelector activeSlug={activeSegment} onToggle={setActiveSegment} />

      <Button className="w-full gap-2 h-11" onClick={save} disabled={saveConfig.isPending}>
        {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
        Salvar configurações
      </Button>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function JoseTrafego() {
  const navigate = useNavigate();
  const {
    connectedAccount, connectedAccounts, selectConnectedAccount,
    startOAuth, isConnecting, isLoading: isLoadingAccount,
  } = useMetaConnection();

  const {
    session, isAnalyzing, isLoadingSession,
    pendingActions, executedActions,
    analyze, loadSavedSession, executeAction, dismissAction,
  } = useApolloAgent();

  const [datePreset, setDatePreset] = useState<ApolloDatePreset>('last_30d');
  const [activeTab, setActiveTab] = useState('chat');
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [activeSegment, setActiveSegment] = useState<string | null>(null);

  const accountId = connectedAccount?.account_id;
  const currency = session?.account?.currency || connectedAccount?.currency || 'BRL';
  const currencySymbol = currency === 'USD' ? 'US$' : 'R$';

  // Load last session on mount
  useEffect(() => {
    if (!sessionLoaded && !session && !isAnalyzing && accountId) {
      setSessionLoaded(true);
      loadSavedSession(accountId).catch(() => {});
    }
  }, [sessionLoaded, session, isAnalyzing, accountId, loadSavedSession]);

  // Switch to Recomendações tab when analysis finishes with actions
  useEffect(() => {
    if (session && pendingActions.length > 0 && activeTab === 'chat') {
      // don't auto-switch — user may be chatting
    }
  }, [session, pendingActions.length, activeTab]);

  const handleAnalyze = useCallback(() => {
    analyze({ targetAccountId: accountId, datePreset, auto_execute: false }).catch(() => {});
  }, [analyze, accountId, datePreset]);

  const handleExecute = useCallback((action: ApolloAction) => {
    executeAction.mutate({ ...action, targetAccountId: accountId });
  }, [executeAction, accountId]);

  const overallScore = session?.health_score ?? null;

  /* ═══ SEM CONTA CONECTADA ══════════════════════════════════════════════════ */
  if (!isLoadingAccount && !accountId) {
    return (
      <MainLayout>
        <div className="flex flex-1 items-center justify-center py-10 px-4">
          <div className="w-full max-w-md">
            <Card className="border-border/50 bg-card/80 overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-orange-500 to-amber-400" />
              <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-500/10 text-4xl">
                  🎯
                </div>
                <div>
                  <h2 className="text-2xl font-bold mb-2">Conectar Meta Ads</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Para o José monitorar e otimizar suas campanhas, precisa da permissão de acesso à sua conta do Meta.
                  </p>
                </div>
                <div className="w-full space-y-2 text-left">
                  {[
                    { emoji: '⚡', text: 'Conexão em menos de 2 minutos' },
                    { emoji: '🔒', text: 'Acesso seguro via Meta OAuth' },
                    { emoji: '🤖', text: 'José analisa e otimiza automaticamente' },
                  ].map(item => (
                    <div key={item.text} className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3">
                      <span className="text-xl">{item.emoji}</span>
                      <span className="text-sm font-medium">{item.text}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={startOAuth}
                  disabled={isConnecting}
                  className="w-full h-12 text-base bg-orange-500 hover:bg-orange-600"
                >
                  {isConnecting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Plug className="mr-2 h-5 w-5" />}
                  {isConnecting ? 'Conectando...' : 'Conectar minha conta'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </MainLayout>
    );
  }

  /* ═══ DASHBOARD PRINCIPAL ══════════════════════════════════════════════════ */
  return (
    <MainLayout>
      <div className="space-y-5 max-w-5xl mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Radar className="h-6 w-6 text-orange-400" />
              José
              <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse inline-block mr-1" />
                Gestor de Tráfego
              </Badge>
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Meta Ads · Análise e otimização automática
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Account switcher */}
            {connectedAccounts.length > 1 && (
              <Select value={connectedAccount?.id ?? ''} onValueChange={selectConnectedAccount}>
                <SelectTrigger className="w-44 h-9 text-sm">
                  <SelectValue placeholder="Conta" />
                </SelectTrigger>
                <SelectContent>
                  {connectedAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Date preset */}
            <Select value={datePreset} onValueChange={v => setDatePreset(v as ApolloDatePreset)}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Analyze button */}
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || isLoadingSession || !accountId}
              className="gap-2 h-9 bg-orange-500 hover:bg-orange-600"
            >
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {isAnalyzing ? 'Analisando...' : 'Analisar agora'}
            </Button>
          </div>
        </div>

        {/* ── Health banner (só após análise) ── */}
        {session && overallScore !== null && (
          <div
            className={`rounded-xl border p-4 flex items-center justify-between gap-4 ${
              overallScore >= 70
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : overallScore >= 45
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-red-500/10 border-red-500/20'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-3xl">{healthEmoji(overallScore)}</span>
              <div>
                <p className={`font-semibold ${healthColor(overallScore)}`}>
                  {healthLabel(overallScore)} — Score {overallScore}/100
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {overallScore >= 70
                    ? 'Suas campanhas estão gerando bons resultados!'
                    : overallScore >= 45
                    ? 'Algumas campanhas precisam de atenção.'
                    : 'Atenção! Há campanhas com problemas sérios.'}
                </p>
              </div>
            </div>
            {pendingActions.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActiveTab('actions')}
                className="shrink-0 text-xs h-8"
              >
                {pendingActions.length} recomendação(ões)
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        )}

        {/* ── Loading / empty states ── */}
        {(isAnalyzing || isLoadingSession) && !session && (
          <Card>
            <CardContent className="flex flex-col items-center py-16 gap-4">
              <div className="relative">
                <Brain className="h-12 w-12 text-orange-400 animate-pulse" />
                <Loader2 className="h-5 w-5 text-orange-400 animate-spin absolute -bottom-1 -right-1" />
              </div>
              <div className="text-center">
                <p className="font-semibold">
                  {isLoadingSession ? 'Carregando última análise...' : 'José analisando suas campanhas...'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {isLoadingSession ? 'Recuperando dados salvos' : 'Conectando ao Meta Ads e processando com IA...'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!session && !isAnalyzing && !isLoadingSession && accountId && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center py-14 gap-5">
              <div className="text-5xl">🎯</div>
              <div className="text-center">
                <p className="font-semibold text-lg">José está pronto</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Clique em "Analisar agora" para o José verificar suas campanhas e te dizer o que otimizar.
                </p>
              </div>
              <Button onClick={handleAnalyze} className="gap-2 bg-orange-500 hover:bg-orange-600">
                <Brain className="h-4 w-4" />
                Analisar agora
              </Button>
              {session?.analyzed_at && (
                <p className="text-xs text-muted-foreground">
                  Última análise: {new Date(session.analyzed_at).toLocaleString('pt-BR')}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 4 Tabs ── */}
        {accountId && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full grid grid-cols-5 h-10">
              <TabsTrigger value="chat" className="text-xs gap-1">
                <MessageCircle className="h-3.5 w-3.5" />
                Conversar
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="text-xs gap-1">
                <Radar className="h-3.5 w-3.5" />
                Campanhas
                {session && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
                    {session.campaigns.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="actions" className="text-xs gap-1 relative">
                <Zap className="h-3.5 w-3.5" />
                Recomendações
                {pendingActions.length > 0 && (
                  <Badge className="text-[10px] h-4 px-1 ml-1 bg-orange-500">
                    {pendingActions.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="creatives" className="text-xs gap-1">
                <Image className="h-3.5 w-3.5" />
                Biblioteca
              </TabsTrigger>
              <TabsTrigger value="config" className="text-xs gap-1">
                <Settings className="h-3.5 w-3.5" />
                Configurações
              </TabsTrigger>
            </TabsList>

            {/* ── CONVERSAR ── */}
            <TabsContent value="chat" className="mt-4">
              <JoseChat
                session={session}
                currencySymbol={currencySymbol}
                accountId={accountId}
              />
            </TabsContent>

            {/* ── CAMPANHAS ── */}
            <TabsContent value="campaigns" className="mt-4">
              {!session ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 gap-3">
                    <Radar className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      Clique em <strong>Analisar agora</strong> para ver suas campanhas.
                    </p>
                  </CardContent>
                </Card>
              ) : session.campaigns.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 gap-2">
                    <AlertTriangle className="h-8 w-8 text-amber-400" />
                    <p className="text-sm text-muted-foreground">
                      Nenhuma campanha encontrada no período selecionado.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {/* Quick summary */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        emoji: '💰',
                        label: 'Total investido',
                        val: `${currencySymbol} ${fmt(session.campaigns.reduce((s: number, c: any) => s + c.spend, 0))}`,
                      },
                      {
                        emoji: '📢',
                        label: 'Campanhas ativas',
                        val: String(session.campaigns.filter((c: any) => c.effective_status === 'ACTIVE').length),
                      },
                      {
                        emoji: '⚠️',
                        label: 'Precisam atenção',
                        val: String(session.campaigns.filter((c: any) => c.health_score < 45).length),
                      },
                    ].map(item => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-border/50 bg-card/60 p-3 text-center"
                      >
                        <span className="text-2xl">{item.emoji}</span>
                        <p className="text-[10px] text-muted-foreground mt-1">{item.label}</p>
                        <p className="text-base font-bold mt-0.5">{item.val}</p>
                      </div>
                    ))}
                  </div>

                  {/* Campaign cards sorted by health (worst first) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[...session.campaigns]
                      .sort((a: any, b: any) => a.health_score - b.health_score)
                      .map((c: any) => (
                        <CampaignCard
                          key={c.id}
                          campaign={c}
                          currencySymbol={currencySymbol}
                        />
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── RECOMENDAÇÕES ── */}
            <TabsContent value="actions" className="mt-4">
              {!session ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 gap-3">
                    <Zap className="h-10 w-10 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      Clique em <strong>Analisar agora</strong> para o José gerar recomendações.
                    </p>
                  </CardContent>
                </Card>
              ) : pendingActions.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center py-12 gap-3">
                    <CheckCircle className="h-10 w-10 text-emerald-400" />
                    <p className="font-semibold">Tudo certo!</p>
                    <p className="text-sm text-muted-foreground text-center max-w-xs">
                      O José não encontrou nenhuma ação urgente. Suas campanhas estão sob controle.
                    </p>
                    {executedActions.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {executedActions.length} ação(ões) já foram executadas.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      O José preparou <strong>{pendingActions.length} recomendação(ões)</strong> para você:
                    </p>
                    {pendingActions.filter((a: any) => a.auto_safe).length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8 text-xs"
                        disabled={executeAction.isPending}
                        onClick={() =>
                          pendingActions
                            .filter((a: any) => a.auto_safe)
                            .forEach((a: any) => handleExecute(a))
                        }
                      >
                        <Zap className="h-3 w-3" />
                        Confirmar todas seguras ({pendingActions.filter((a: any) => a.auto_safe).length})
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[...pendingActions]
                      .sort((a: any, b: any) =>
                        ['critical', 'high', 'medium', 'low'].indexOf(a.priority) -
                        ['critical', 'high', 'medium', 'low'].indexOf(b.priority)
                      )
                      .map((action: any, i: number) => (
                        <ActionCard
                          key={`${action.campaign_id}-${action.action_type}-${i}`}
                          action={action}
                          onExecute={() => handleExecute(action)}
                          onDismiss={() => dismissAction(action)}
                          isExecuting={
                            executeAction.isPending &&
                            executeAction.variables?.campaign_id === action.campaign_id
                          }
                        />
                      ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── BIBLIOTECA DE CRIATIVOS ── */}
            <TabsContent value="creatives" className="mt-4">
              <JoseCreativeLibrary segmentSlug={activeSegment} accountId={accountId} />
            </TabsContent>

            {/* ── CONFIGURAÇÕES ── */}
            <TabsContent value="config" className="mt-4">
              <div className="space-y-6 max-w-lg">
                <CronSettings activeSegment={activeSegment} setActiveSegment={setActiveSegment} />
                {activeSegment && (
                  <div className="border-t border-border/50 pt-6">
                    <SegmentKnowledgeBase segmentSlug={activeSegment} />
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </MainLayout>
  );
}
