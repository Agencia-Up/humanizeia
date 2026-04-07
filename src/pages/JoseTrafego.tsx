import { useState, useCallback, useEffect, useRef } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AILog, AILogEntry } from '@/components/jose/AILog';
import { GoldenRulesTab } from '@/components/jose/GoldenRulesTab';
import { ExecutiveSummary, ExecutiveSkeleton } from '@/components/jose/ExecutiveSummary';
import { JoseChat } from '@/components/jose/JoseChat';
import CampanhaCreator from '@/components/jose/CampanhaCreator';
import PublicosManager from '@/components/jose/PublicosManager';
import AbTestManager from '@/components/jose/AbTestManager';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import {
  useApolloAgent, useApolloHistory, useApolloCronConfig,
  ApolloAction, ApolloEnrichedCampaign, ApolloDatePreset,
} from '@/hooks/useApolloAgent';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Brain, CheckCircle,
  ChevronDown, ChevronRight, Clock, Copy, GitFork, HelpCircle,
  Loader2, Minus, Pause, Play, Radar, Settings, Sparkles,
  ThumbsDown, TrendingDown, TrendingUp, Zap, Sun, BarChart3,
  Flame, Gauge, PieChart, RefreshCw, MessageCircle, Phone, Shield,
  ExternalLink, Target, Layers, FlaskConical, BookOpen, Users, Code2, Wallet,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────────────

const healthColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 45 ? 'text-amber-400' : 'text-red-400';
const healthBg = (s: number) => s >= 70 ? 'bg-emerald-500/10 border-emerald-500/20' : s >= 45 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';
const healthLabel = (s: number) => s >= 70 ? 'Saudável' : s >= 45 ? 'Atenção' : 'Crítico';
const priorityStyle = (p: string) => ({
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}[p] || 'bg-muted text-muted-foreground');

function actionIcon(t: string) {
  const icons: Record<string, JSX.Element> = {
    pause: <Pause className="h-4 w-4" />, activate: <Play className="h-4 w-4" />,
    increase_budget: <TrendingUp className="h-4 w-4" />, decrease_budget: <TrendingDown className="h-4 w-4" />,
    pause_adset: <Pause className="h-4 w-4" />, activate_adset: <Play className="h-4 w-4" />,
    clone_campaign: <GitFork className="h-4 w-4" />, notify: <AlertTriangle className="h-4 w-4" />,
    rotate_creative: <RefreshCw className="h-4 w-4" />, reallocate_budget: <PieChart className="h-4 w-4" />,
  };
  return icons[t] || <Zap className="h-4 w-4" />;
}

function actionLabel(t: string) {
  return ({
    pause: 'Pausar Campanha', activate: 'Ativar Campanha',
    increase_budget: 'Aumentar Orçamento', decrease_budget: 'Reduzir Orçamento',
    pause_adset: 'Pausar Ad Set', activate_adset: 'Ativar Ad Set',
    clone_campaign: 'Clonar Campanha', notify: 'Notificação',
    rotate_creative: 'Rotacionar Criativos', reallocate_budget: 'Realocar Verba',
  } as Record<string, string>)[t] || t;
}

function deltaBadge(val: number | null | undefined, invert = false) {
  if (val === null || val === undefined) return null;
  const isGood = invert ? val < 0 : val > 0;
  const icon = val > 0 ? <ArrowUp className="h-3 w-3" /> : val < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const cls = val === 0 ? 'text-muted-foreground' : isGood ? 'text-emerald-400' : 'text-red-400';
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${cls}`}>
      {icon}{Math.abs(val).toFixed(1)}%
    </span>
  );
}

const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

// ── Metric translations for non-technical users ──
const METRIC_HELP: Record<string, { friendly: string; tip: string }> = {
  'CTR': { friendly: 'Taxa de Interesse', tip: 'Percentual de pessoas que viram seu anúncio e clicaram. Acima de 1.5% é ótimo!' },
  'CPC': { friendly: 'Custo por Visita', tip: 'Quanto você paga cada vez que alguém clica no anúncio. Quanto menor, melhor!' },
  'ROAS': { friendly: 'Retorno (ROI)', tip: 'Para cada R$1 investido, quanto voltou em vendas. Acima de 3x é excelente!' },
  'CPA': { friendly: 'Custo por Resultado', tip: 'Quanto custa cada conversão ou venda. Quanto menor, mais eficiente!' },
  'Gasto': { friendly: 'Investimento', tip: 'Total investido no período selecionado' },
  'Impressões': { friendly: 'Visualizações', tip: 'Quantas vezes seu anúncio apareceu para as pessoas' },
  'Frequência': { friendly: 'Repetição', tip: 'Quantas vezes a mesma pessoa viu seu anúncio. Acima de 4x pode causar irritação!' },
  'Conversões': { friendly: 'Resultados', tip: 'Número de ações valiosas (vendas, leads) geradas pelo anúncio' },
  'Orçamento/dia': { friendly: 'Limite Diário', tip: 'Valor máximo que será gasto por dia nesta campanha' },
};

function MetricLabel({ label, currencySymbol }: { label: string; currencySymbol?: string }) {
  const help = METRIC_HELP[label];
  if (!help) return <p className="text-muted-foreground text-[10px]">{label}</p>;
  return (
    <div className="flex items-center gap-0.5">
      <p className="text-muted-foreground text-[10px]">{help.friendly}</p>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-2.5 w-2.5 text-muted-foreground/50 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          <p className="text-xs font-medium mb-0.5">{label}</p>
          <p className="text-xs text-muted-foreground">{help.tip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

const DATE_PRESETS: { value: ApolloDatePreset; label: string }[] = [
  { value: 'today', label: 'Hoje' }, { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' }, { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
];

// ── CampaignCard ──────────────────────────────────────────────────────────────

function CampaignCard({
  campaign, currencySymbol, accountId, datePreset, onDrillDown, adsets, isLoadingAdsets,
}: {
  campaign: ApolloEnrichedCampaign; currencySymbol: string; accountId?: string;
  datePreset: ApolloDatePreset; onDrillDown: () => void; adsets: any[] | null; isLoadingAdsets: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const s = campaign.health_score;

  const handleExpand = () => {
    if (!expanded) onDrillDown();
    setExpanded(!expanded);
  };

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${healthBg(s)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate" title={campaign.name}>{campaign.name}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="outline" className={`text-[10px] px-1.5 ${campaign.effective_status === 'ACTIVE' ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}>
              {campaign.effective_status}
            </Badge>
            {campaign.objective && <span className="text-[10px] text-muted-foreground">{campaign.objective.replace(/_/g, ' ')}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="flex flex-col items-center">
            <div className={`relative w-12 h-12 rounded-full border-4 flex items-center justify-center ${s >= 70 ? 'border-emerald-500 bg-emerald-500/10' : s >= 45 ? 'border-amber-500 bg-amber-500/10' : 'border-red-500 bg-red-500/10'}`}>
              <span className={`text-lg font-bold ${healthColor(s)}`}>{s}</span>
            </div>
            <div className={`text-[10px] font-semibold mt-0.5 ${healthColor(s)}`}>{healthLabel(s)}</div>
          </div>
        </div>
      </div>

      <Progress value={s} className="h-1.5" />

      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { label: 'Gasto', val: `${currencySymbol} ${fmt(campaign.spend)}` },
          { label: 'CTR', val: `${fmt(campaign.ctr)}%`, highlight: campaign.ctr >= 1.5 ? 'text-emerald-400' : campaign.ctr > 0 ? 'text-amber-400' : '' },
          { label: 'CPC', val: `${currencySymbol} ${fmt(campaign.cpc)}` },
          { label: 'Impressões', val: campaign.impressions.toLocaleString('pt-BR') },
          { label: 'Frequência', val: fmt(campaign.frequency), highlight: campaign.frequency > 4 ? 'text-red-400' : campaign.frequency > 3 ? 'text-amber-400' : '' },
          { label: 'ROAS', val: campaign.roas > 0 ? `${fmt(campaign.roas)}x` : '—', highlight: campaign.roas >= 3 ? 'text-emerald-400' : campaign.roas > 0 ? 'text-amber-400' : '' },
          { label: 'Conversões', val: String(campaign.conversions || 0) },
          { label: 'CPA', val: campaign.cpa > 0 ? `${currencySymbol} ${fmt(campaign.cpa)}` : '—' },
          { label: 'Orçamento/dia', val: campaign.daily_budget ? `${currencySymbol} ${fmt(campaign.daily_budget)}` : 'N/A' },
        ].map(({ label, val, highlight }) => (
          <div key={label}>
            <MetricLabel label={label} />
            <p className={`font-semibold text-xs ${highlight || ''}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Level 6: Creative Fatigue + Budget Pacing */}
      {(campaign as any).creative_fatigue && (
        <div className="flex items-center gap-2 flex-wrap">
          {(() => {
            const f = (campaign as any).creative_fatigue;
            const fColor = f.score >= 70 ? 'text-red-400 bg-red-500/10 border-red-500/20'
              : f.score >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : f.score >= 20 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
              : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] cursor-help ${fColor}`}>
                    <Flame className="h-2.5 w-2.5" />
                    Fadiga {f.score}%
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px]"><p className="text-xs">{f.recommendation}</p></TooltipContent>
              </Tooltip>
            );
          })()}
          {(() => {
            const p = (campaign as any).budget_pacing;
            if (!p || p.status === 'sem_orçamento') return null;
            const pColor = p.status === 'overpacing' ? 'text-red-400 bg-red-500/10 border-red-500/20'
              : p.status === 'underpacing' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            const pIcon = p.status === 'overpacing' ? '⬆️' : p.status === 'underpacing' ? '⬇️' : '✅';
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`flex items-center gap-1 rounded px-1.5 py-0.5 border text-[10px] cursor-help ${pColor}`}>
                    <Gauge className="h-2.5 w-2.5" />
                    {pIcon} Pacing {Math.round(p.ratio * 100)}%
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px]"><p className="text-xs">{p.insight}</p></TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
      )}

      {/* Ad Set drill-down */}
      <button
        onClick={handleExpand}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {isLoadingAdsets ? <Loader2 className="h-3 w-3 animate-spin" /> : expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {expanded ? 'Ocultar Ad Sets' : `Ver Ad Sets ${campaign.adsets?.length ? `(${campaign.adsets.length})` : ''}`}
      </button>

      {expanded && (
        <div className="space-y-2 pt-1 border-t border-border/30">
          {isLoadingAdsets ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando Ad Sets...
            </div>
          ) : (adsets || campaign.adsets)?.length ? (
            (adsets || campaign.adsets)!.map((as: any) => (
              <div key={as.id} className="rounded-md bg-background/50 border border-border/40 p-2.5 text-xs">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <p className="font-medium truncate flex-1" title={as.name}>{as.name}</p>
                  <Badge variant="outline" className={`text-[9px] px-1 ${as.effective_status === 'ACTIVE' ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                    {as.effective_status || as.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <div><span className="text-muted-foreground">CTR: </span><span className={as.ctr >= 1.5 ? 'text-emerald-400 font-medium' : ''}>{fmt(as.ctr)}%</span></div>
                  <div><span className="text-muted-foreground">CPC: </span>{currencySymbol}{fmt(as.cpc)}</div>
                  <div><span className="text-muted-foreground">Freq: </span><span className={as.frequency > 4 ? 'text-red-400 font-medium' : as.frequency > 3 ? 'text-amber-400' : ''}>{fmt(as.frequency)}</span></div>
                  <div><span className="text-muted-foreground">Gasto: </span>{currencySymbol}{fmt(as.spend)}</div>
                </div>
                {as.creative_fatigue_score !== undefined && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <div className="flex-1 bg-border/40 rounded-full h-1">
                      <div
                        className={`h-1 rounded-full transition-all ${as.creative_fatigue_score >= 70 ? 'bg-red-500' : as.creative_fatigue_score >= 40 ? 'bg-amber-500' : as.creative_fatigue_score >= 20 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                        style={{ width: `${as.creative_fatigue_score}%` }}
                      />
                    </div>
                    <span className={`text-[9px] font-medium ${as.creative_fatigue_score >= 70 ? 'text-red-400' : as.creative_fatigue_score >= 40 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      Fadiga {as.creative_fatigue_score}%
                    </span>
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground py-1">Nenhum ad set com dados no período.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActionCard ────────────────────────────────────────────────────────────────

function ActionCard({ action, onExecute, onDismiss, isExecuting }: {
  action: ApolloAction; onExecute: () => void; onDismiss: () => void; isExecuting: boolean;
}) {
  const isClone = action.action_type === 'clone_campaign';
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{actionIcon(action.action_type)}</div>
          <div>
            <p className="text-sm font-semibold">{actionLabel(action.action_type)}</p>
            <p className="text-xs text-muted-foreground truncate max-w-[200px]" title={action.campaign_name}>{action.campaign_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          <Badge variant="outline" className={`text-[10px] px-1.5 ${priorityStyle(action.priority)}`}>{action.priority}</Badge>
          {action.auto_safe && <Badge variant="outline" className="text-[10px] px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Auto-safe</Badge>}
          {action.confidence !== undefined && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] text-muted-foreground cursor-help">{action.confidence}% conf.</span>
              </TooltipTrigger>
              <TooltipContent><p>Confiança baseada em dados históricos e aprendizado acumulado</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="space-y-1 text-xs">
        <p><span className="font-medium">Motivo: </span><span className="text-muted-foreground">{action.reason}</span></p>
        <p><span className="font-medium">Impacto: </span><span className="text-muted-foreground">{action.impact}</span></p>
      </div>
      {isClone && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>A campanha clonada será criada em modo <strong>PAUSADO</strong>. Você precisará ativá-la no Meta Ads Manager.</span>
        </div>
      )}
      {(action.priority === 'critical' || action.priority === 'high') && (
        <Button
          size="sm"
          className="w-full h-9 text-xs gap-1.5 font-semibold gradient-primary glow-primary text-primary-foreground"
          onClick={onExecute}
          disabled={isExecuting}
        >
          {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          JOSÉ, Resolver Agora
        </Button>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 h-8 text-xs gap-1" onClick={onExecute} disabled={isExecuting}>
          {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : actionIcon(action.action_type)}
          {isClone ? 'Clonar' : 'Executar'}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-muted-foreground" onClick={onDismiss} disabled={isExecuting}>
          <ThumbsDown className="h-3 w-3" /> Ignorar
        </Button>
      </div>
    </div>
  );
}

// ── CronSettings ──────────────────────────────────────────────────────────────

function CronSettings() {
  const { config, isLoading, saveConfig } = useApolloCronConfig();
  const [hour, setHour] = useState(config?.run_hour ?? 8);
  const [autoExec, setAutoExec] = useState(config?.auto_execute ?? false);
  const [sendWa, setSendWa] = useState(config?.send_whatsapp_on_critical ?? true);
  const [sendDailyReport, setSendDailyReport] = useState(config?.send_daily_report ?? true);
  const [waNumber, setWaNumber] = useState(config?.whatsapp_report_number ?? '');
  const [enabled, setEnabled] = useState(config?.is_enabled ?? false);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length <= 11) {
      setWaNumber(digits);
    }
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
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          JOSÉ — Agendamento Automático
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-piloto diário — JOSÉ</p>
            <p className="text-xs text-muted-foreground">JOSÉ analisa suas campanhas automaticamente todos os dias</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="flex items-center gap-3">
              <Label className="text-sm w-24">Horário</Label>
              <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                <SelectTrigger className="w-32 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Executar ações auto-safe</p>
                <p className="text-xs text-muted-foreground">Pausar/escalar campanhas obviamente ruins/vencedoras automaticamente</p>
              </div>
              <Switch checked={autoExec} onCheckedChange={setAutoExec} />
            </div>

            {/* ── WhatsApp Section ── */}
            <div className="border border-emerald-500/20 rounded-lg p-4 space-y-4 bg-emerald-500/5">
              <div className="flex items-center gap-2 text-emerald-400">
                <MessageCircle className="h-4 w-4" />
                <p className="text-sm font-semibold">Relatório via WhatsApp</p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Número do WhatsApp</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="(11) 99999-9999"
                    value={formatPhone(waNumber)}
                    onChange={handlePhoneChange}
                    className="pl-9 h-9 text-sm bg-background/50"
                    maxLength={16}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  DDD + número. Ex: 11999887766
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Relatório diário resumido</p>
                  <p className="text-xs text-muted-foreground">Enviar resumo das campanhas, health score e ações tomadas</p>
                </div>
                <Switch checked={sendDailyReport} onCheckedChange={setSendDailyReport} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Alerta crítico imediato</p>
                  <p className="text-xs text-muted-foreground">Avisar na hora quando encontrar problemas graves</p>
                </div>
                <Switch checked={sendWa} onCheckedChange={setSendWa} />
              </div>

              {waNumber.length > 0 && waNumber.length < 10 && (
                <p className="text-[11px] text-amber-400">Número incompleto — insira DDD + 9 dígitos</p>
              )}
            </div>

            {config?.last_run_at && (
              <p className="text-xs text-muted-foreground">
                Última análise: {new Date(config.last_run_at).toLocaleString('pt-BR')}
              </p>
            )}
            {config?.next_run_at && (
              <p className="text-xs text-muted-foreground">
                Próxima análise: {new Date(config.next_run_at).toLocaleString('pt-BR')}
              </p>
            )}
          </>
        )}

        <Button className="w-full gap-2" onClick={save} disabled={saveConfig.isPending}>
          {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
          Salvar Configuração
        </Button>
      </CardContent>
    </Card>
  );
}

// ── TrendChart ────────────────────────────────────────────────────────────────

function TrendSummary({ snapshots, currencySymbol }: { snapshots: any[]; currencySymbol: string }) {
  if (!snapshots?.length) return null;
  const latest = snapshots[0];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'ROAS', val: `${fmt(latest.avg_roas || 0)}x`, delta: latest.wow_roas_delta, invert: false },
        { label: 'CTR', val: `${fmt(latest.avg_ctr || 0)}%`, delta: latest.wow_ctr_delta, invert: false },
        { label: 'CPC', val: `${currencySymbol} ${fmt(latest.avg_cpc || 0)}`, delta: latest.wow_cpc_delta, invert: true },
        { label: 'Score', val: `${latest.overall_health_score}/100`, delta: latest.wow_health_delta ? Number(latest.wow_health_delta) : null, invert: false },
      ].map(({ label, val, delta, invert }) => (
        <div key={label} className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground mb-1">{label} (vs semana ant.)</p>
          <p className="text-lg font-bold">{val}</p>
          {deltaBadge(delta as number | null, invert)}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function JoseTrafego() {
  const navigate = useNavigate();
  const { connectedAccount, connectedAccounts, selectConnectedAccount, startOAuth, isConnecting, isLoading: isLoadingAccount } = useMetaConnection();
  const { session, isAnalyzing, isLoadingSession, pendingActions, executedActions, analyze, loadSavedSession, executeAction, getAdSets, dismissAction, testConnection } = useApolloAgent();
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const { data: history, isLoading: isLoadingHistory } = useApolloHistory(connectedAccount?.account_id);

  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');
  const [datePreset, setDatePreset] = useState<ApolloDatePreset>('last_30d');
  const [autoExecute, setAutoExecute] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [adsetCache, setAdsetCache] = useState<Record<string, any[]>>({});
  const [loadingAdsets, setLoadingAdsets] = useState<Record<string, boolean>>({});
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [aiLogEntries, setAiLogEntries] = useState<AILogEntry[]>([]);
  const [aiLogOpen, setAiLogOpen] = useState(true);
  const prevIsAnalyzing = useRef(false);

  const accountId = connectedAccount?.account_id;

  // ── Load last saved session on mount ──
  useEffect(() => {
    if (!sessionLoaded && !session && !isAnalyzing && accountId) {
      setSessionLoaded(true);
      loadSavedSession(accountId).catch(() => {});
    }
  }, [sessionLoaded, session, isAnalyzing, accountId, loadSavedSession]);
  // ── AI Log: populate when analysis starts ──
  useEffect(() => {
    if (isAnalyzing && !prevIsAnalyzing.current) {
      const now = new Date();
      const campaignCount = session?.campaigns?.length || 0;
      const initial: AILogEntry[] = [
        { id: 'start', type: 'analyzing', message: `Iniciando análise JOSÉ analisando suas campanhas...`, timestamp: new Date(now.getTime()) },
        { id: 'fetch', type: 'analyzing', message: `Conectando à Meta API e coletando dados de ${campaignCount || 'todas as'} campanhas...`, timestamp: new Date(now.getTime() + 500) },
        { id: 'dimensions', type: 'analyzing', message: 'Analisando campanhas: Performance · Criativos · Públicos · Orçamento · Conversões · IA', timestamp: new Date(now.getTime() + 1200) },
        { id: 'health', type: 'analyzing', message: 'Calculando health scores individuais e score geral do portfólio...', timestamp: new Date(now.getTime() + 2000) },
      ];
      setAiLogEntries(initial);
      setAiLogOpen(true);
    }
    prevIsAnalyzing.current = isAnalyzing;
  }, [isAnalyzing, session?.campaigns?.length]);

  // ── AI Log: add completion entries when session loads ──
  useEffect(() => {
    if (session && !isAnalyzing && aiLogEntries.length > 0) {
      const now = new Date();
      const completionEntries: AILogEntry[] = [];
      const campaignCount = session.campaigns?.length || 0;
      const criticalCount = session.campaigns?.filter((c: any) => c.health_score < 45).length || 0;
      const actionCount = session.actions?.length || 0;

      completionEntries.push({
        id: 'campaigns-done',
        type: 'success',
        message: `${campaignCount} campanhas analisadas com sucesso.`,
        timestamp: new Date(now.getTime()),
      });

      if (criticalCount > 0) {
        completionEntries.push({
          id: 'critical-alert',
          type: 'warning',
          message: `${criticalCount} campanha(s) em estado crítico detectada(s) — ação imediata recomendada.`,
          timestamp: new Date(now.getTime() + 200),
        });
      }

      if (session.health_score !== undefined) {
        const scoreType = session.health_score >= 70 ? 'success' : session.health_score >= 45 ? 'insight' : 'warning';
        completionEntries.push({
          id: 'health-score',
          type: scoreType as AILogEntry['type'],
          message: `Health Score geral: ${session.health_score}/100 — ${session.health_score >= 70 ? 'Saudável' : session.health_score >= 45 ? 'Atenção necessária' : 'Crítico'}.`,
          timestamp: new Date(now.getTime() + 400),
        });
      }

      if (actionCount > 0) {
        completionEntries.push({
          id: 'actions-generated',
          type: 'action',
          message: `${actionCount} ação(ões) gerada(s) pelo JOSÉ para otimização.`,
          timestamp: new Date(now.getTime() + 600),
        });
      }

      completionEntries.push({
        id: 'complete',
        type: 'success',
        message: 'Análise concluída. Revise as recomendações nas abas abaixo.',
        timestamp: new Date(now.getTime() + 800),
      });

      setAiLogEntries(prev => [...prev, ...completionEntries]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isAnalyzing]);

  const currency = session?.account?.currency || connectedAccount?.currency || 'BRL';
  const currencySymbol = currency === 'USD' ? 'US$' : 'R$';

  const handleAnalyze = useCallback(() => {
    analyze({ targetAccountId: accountId, datePreset, auto_execute: autoExecute, viewMode }).catch(() => {
      // Error already shown via toast inside useApolloAgent
    });
  }, [analyze, accountId, datePreset, autoExecute, viewMode]);

  const handleDiagnose = useCallback(async () => {
    setIsDiagnosing(true);
    setDiagResult(null);
    try {
      // Chama a função de diagnóstico dedicada
      const { data, error } = await (supabase as any).functions.invoke('jose-debug', { body: {} });
      const res = data as any;

      if (error || !res) {
        setDiagResult(`❌ Erro ao chamar diagnóstico: ${error?.message || 'sem resposta'}`);
        return;
      }

      const lines: string[] = [`🔍 DIAGNÓSTICO JOSE — ${res.summary || ''}\n`];
      (res.steps || []).forEach((s: any) => {
        const icon = s.status === 'ok' ? '✅' : '❌';
        lines.push(`${icon} ${s.step.toUpperCase()}`);
        if (s.status === 'ok') {
          lines.push(`   ${JSON.stringify(s.data, null, 0).slice(0, 120)}`);
        } else {
          lines.push(`   ERRO: ${s.error}`);
        }
      });
      setDiagResult(lines.join('\n'));
      return;
    } catch (err: any) {
      setDiagResult(`❌ Erro ao diagnosticar: ${err.message}`);
    } finally {
      setIsDiagnosing(false);
    }
  }, [testConnection, accountId]);

  const handleExecute = useCallback((action: ApolloAction) => {
    executeAction.mutate({ ...action, targetAccountId: accountId });
  }, [executeAction, accountId]);

  const handleExecuteAll = useCallback(() => {
    const topActions = pendingActions
      .filter((a: any) => ['pause', 'increase_budget', 'decrease_budget', 'activate'].includes(a.action_type || a.type))
      .slice(0, 3);
    topActions.forEach((a: any) => executeAction.mutate({ ...a, targetAccountId: accountId }));
  }, [pendingActions, executeAction, accountId]);

  const handleDrillDown = useCallback(async (campaignId: string) => {
    if (adsetCache[campaignId]) return;
    setLoadingAdsets(prev => ({ ...prev, [campaignId]: true }));
    try {
      const adsets = await getAdSets.mutateAsync({ campaignId, targetAccountId: accountId, datePreset });
      setAdsetCache(prev => ({ ...prev, [campaignId]: adsets }));
    } catch { /* ignore */ } finally {
      setLoadingAdsets(prev => ({ ...prev, [campaignId]: false }));
    }
  }, [adsetCache, getAdSets, accountId, datePreset]);

  const overallScore = session?.health_score ?? null;
  const overallHealthText = overallScore === null ? '' :
    overallScore >= 70 ? 'Suas campanhas estão saudáveis e gerando bons resultados!' :
    overallScore >= 45 ? 'Algumas campanhas precisam de atenção. Confira as recomendações do JOSÉ.' :
    'Atenção! Campanhas com problemas sérios detectados. Ação recomendada!';
  const snapshots = history?.snapshots || [];
  const outcomes = history?.outcomes || [];
  const clones = history?.clones || [];

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" />
              JOSÉ
              <Badge className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse inline-block mr-1" />
                Agente Online
              </Badge>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Gestor de Tráfego Pago · Meta Ads · Google Ads · Otimização Autônoma 24/7
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* ── Mode switcher ── */}
            <div className="flex items-center rounded-lg border border-border bg-card overflow-hidden h-9">
              <button
                onClick={() => setViewMode('simplified')}
                className={`px-3 h-full text-xs font-medium transition-colors ${
                  viewMode === 'simplified'
                    ? 'bg-orange-500 text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                📊 Simplificado
              </button>
              <button
                onClick={() => setViewMode('expert')}
                className={`px-3 h-full text-xs font-medium transition-colors ${
                  viewMode === 'expert'
                    ? 'bg-orange-500 text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                ⚙️ Especialista
              </button>
            </div>

            {connectedAccounts.length > 1 && (
              <Select value={connectedAccount?.id ?? ''} onValueChange={selectConnectedAccount}>
                <SelectTrigger className="w-48 h-9 text-sm">
                  <SelectValue placeholder="Selecionar conta" />
                </SelectTrigger>
                <SelectContent>
                  {connectedAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>{acc.account_name} ({acc.currency})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={datePreset} onValueChange={(v) => setDatePreset(v as ApolloDatePreset)}>
              <SelectTrigger className="w-40 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className={`flex items-center gap-2 border rounded-lg px-3 h-9 transition-all duration-500 ${autoExecute ? 'bg-primary/10 border-primary/40 animate-pulse-glow' : 'bg-card'}`}>
              <Switch id="auto-exec" checked={autoExecute} onCheckedChange={setAutoExecute} className="scale-75" />
              <Label htmlFor="auto-exec" className={`text-xs cursor-pointer whitespace-nowrap ${autoExecute ? 'text-primary font-semibold' : ''}`}>
                {autoExecute ? '⚡ Auto-Pilot ATIVO' : 'Auto-Pilot'}
              </Label>
            </div>

            <Button onClick={handleAnalyze} disabled={isAnalyzing || isLoadingSession || !accountId} className="gap-2 h-9">
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {isAnalyzing ? 'Analisando...' : 'Nova Análise'}
            </Button>
          </div>
          {session?.analyzed_at && (
            <p className="text-[11px] text-muted-foreground text-right">
              Última análise: {new Date(session.analyzed_at).toLocaleString('pt-BR')}
            </p>
          )}
        </div>

        {/* ── No account ── */}
        {!isLoadingAccount && !accountId && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-4">
              <AlertTriangle className="h-10 w-10 text-amber-400" />
              <div className="text-center space-y-1">
                <p className="font-semibold text-amber-400">Conta Meta Ads não conectada</p>
                <p className="text-xs text-muted-foreground max-w-sm">Para o JOSÉ analisar suas campanhas, conecte sua conta Meta Ads primeiro.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={startOAuth} disabled={isConnecting} className="gap-2 bg-amber-500 hover:bg-amber-600 text-black">
                  {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {isConnecting ? 'Conectando...' : 'Conectar Meta Ads'}
                </Button>
                <Button variant="outline" size="sm" onClick={handleDiagnose} disabled={isDiagnosing} className="gap-2 text-xs">
                  {isDiagnosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                  Diagnosticar
                </Button>
              </div>
              {diagResult && (
                <pre className="text-xs text-left bg-muted/50 rounded-lg p-3 max-w-lg w-full whitespace-pre-wrap font-mono border">
                  {diagResult}
                </pre>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Historical WoW trend (expert only) ── */}
        {viewMode === 'expert' && snapshots.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Tendências Acumuladas ({snapshots.length} semanas de dados)
            </p>
            <TrendSummary snapshots={snapshots} currencySymbol={currencySymbol} />
          </div>
        )}

        {/* ── After analysis: overview (expert only) ── */}
        {session && viewMode === 'expert' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className={`col-span-2 md:col-span-1 ${overallScore !== null ? healthBg(overallScore) : ''}`}>
                <CardContent className="pt-5 pb-4">
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2"><Activity className="h-3 w-3" />Score Geral</p>
                  <div className={`text-4xl font-bold ${overallScore !== null ? healthColor(overallScore) : ''}`}>{overallScore ?? '—'}</div>
                  {overallScore !== null && <p className={`text-xs font-semibold mt-0.5 ${healthColor(overallScore)}`}>{healthLabel(overallScore)}</p>}
                  {overallHealthText && <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{overallHealthText}</p>}
                </CardContent>
              </Card>
              <Card><CardContent className="pt-5 pb-4"><p className="text-xs text-muted-foreground mb-2">Campanhas</p><div className="text-4xl font-bold">{session.campaigns.length}</div><p className="text-xs text-muted-foreground">analisadas</p></CardContent></Card>
              <Card><CardContent className="pt-5 pb-4"><p className="text-xs text-muted-foreground mb-2">Ações Pendentes</p><div className={`text-4xl font-bold ${pendingActions.length > 0 ? 'text-amber-400' : ''}`}>{pendingActions.length}</div></CardContent></Card>
              <Card><CardContent className="pt-5 pb-4"><p className="text-xs text-muted-foreground mb-2">Executadas</p><div className="text-4xl font-bold text-emerald-400">{executedActions.length}</div></CardContent></Card>
            </div>

            {session.summary && (
              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
                <Sparkles className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-sm leading-relaxed">{session.summary}</p>
              </div>
            )}

            {/* ── AI Log (expert only) ── */}
            {aiLogEntries.length > 0 && (
              <Collapsible open={aiLogOpen} onOpenChange={setAiLogOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                    {aiLogOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    <Brain className="h-3.5 w-3.5 text-primary" />
                    Log de Pensamento IA
                    <Badge variant="outline" className="text-[9px] px-1 h-4">{aiLogEntries.length}</Badge>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <AILog entries={aiLogEntries} isAnalyzing={isAnalyzing} />
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}

        {/* ── Loading / Empty states ── */}
        {(isAnalyzing || isLoadingSession) && !session && (
          <Card><CardContent className="flex flex-col items-center py-16 gap-4">
            <div className="relative"><Brain className="h-12 w-12 text-primary animate-pulse" /><Loader2 className="h-5 w-5 text-primary animate-spin absolute -bottom-1 -right-1" /></div>
            <div className="text-center">
              <p className="font-semibold">
                {isLoadingSession ? 'Carregando última análise...' : 'JOSÉ analisando suas campanhas...'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isLoadingSession ? 'Recuperando dados salvos' : 'Meta API · Google Ads · IA Autônoma'}
              </p>
            </div>
          </CardContent></Card>
        )}

        {!session && !isAnalyzing && !isLoadingSession && accountId && (
          <Card className="border-dashed"><CardContent className="flex flex-col items-center py-14 gap-4">
            <Brain className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center"><p className="font-semibold text-muted-foreground">JOSÉ — Pronto para Operar</p><p className="text-xs text-muted-foreground mt-1">Gestor de Tráfego Pago · Meta Ads · Google Ads · 24/7</p></div>
            <div className="flex gap-2">
              <Button onClick={handleAnalyze} className="gap-2"><Brain className="h-4 w-4" />Iniciar Análise</Button>
              <Button variant="outline" size="sm" onClick={handleDiagnose} disabled={isDiagnosing} className="gap-2 text-xs">
                {isDiagnosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                Diagnosticar Conexão
              </Button>
            </div>
            {diagResult && (
              <pre className="text-xs text-left bg-muted/50 rounded-lg p-3 max-w-lg w-full whitespace-pre-wrap font-mono border">
                {diagResult}
              </pre>
            )}
          </CardContent></Card>
        )}

        {/* ── SIMPLIFIED MODE ── */}
        {viewMode === 'simplified' && accountId && (
          <>
            {(isAnalyzing || isLoadingSession) && !session
              ? <ExecutiveSkeleton />
              : session && (
                  <ExecutiveSummary
                    session={session}
                    pendingActions={pendingActions.map((a: any) => ({
                      ...a,
                      type: a.action_type ?? a.type,
                      campaign_name: a.campaign_name ?? a.target_id,
                    }))}
                    isAnalyzing={isAnalyzing}
                    currencySymbol={currencySymbol}
                    onExecuteAction={(action: any) => handleExecute(action)}
                    onExecuteAll={handleExecuteAll}
                    isExecuting={executeAction.isPending}
                  />
                )
            }
            {/* Chat always visible in simplified mode */}
            <JoseChat session={session} currencySymbol={currencySymbol} accountId={accountId} />
          </>
        )}

        {/* ── EXPERT MODE: Main tabs ── */}
        {viewMode === 'expert' && (session || snapshots.length > 0 || accountId) && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="chat" className="gap-1 text-xs bg-orange-500/10 data-[state=active]:bg-orange-500 data-[state=active]:text-white"><MessageCircle className="h-3 w-3" />💬 Chat IA</TabsTrigger>
              {session && <TabsTrigger value="campaigns" className="gap-1 text-xs"><Radar className="h-3 w-3" />Campanhas <Badge variant="secondary" className="text-[10px] h-4 px-1">{session.campaigns.length}</Badge></TabsTrigger>}
              {session && <TabsTrigger value="actions" className="gap-1 text-xs"><Zap className="h-3 w-3" />Ações {pendingActions.length > 0 && <Badge className="text-[10px] h-4 px-1 bg-primary">{pendingActions.length}</Badge>}</TabsTrigger>}
              {session && <TabsTrigger value="analysis" className="gap-1 text-xs"><Brain className="h-3 w-3" />Análise IA</TabsTrigger>}
              {session && <TabsTrigger value="portfolio" className="gap-1 text-xs"><PieChart className="h-3 w-3" />Portfólio</TabsTrigger>}
              <TabsTrigger value="learning" className="gap-1 text-xs"><Activity className="h-3 w-3" />Aprendizado</TabsTrigger>
              <TabsTrigger value="history" className="gap-1 text-xs"><Clock className="h-3 w-3" />Histórico {executedActions.length > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1">{executedActions.length}</Badge>}</TabsTrigger>
              <TabsTrigger value="seasonal" className="gap-1 text-xs"><Sun className="h-3 w-3" />Sazonalidade</TabsTrigger>
              <TabsTrigger value="golden-rules" className="gap-1 text-xs"><Shield className="h-3 w-3" />Regras de Ouro</TabsTrigger>
              <TabsTrigger value="schedule" className="gap-1 text-xs"><Settings className="h-3 w-3" />Agendamento</TabsTrigger>
              <TabsTrigger value="criar" className="gap-1 text-xs">🚀 Criar Campanha</TabsTrigger>
              <TabsTrigger value="publicos" className="gap-1 text-xs">🎯 Públicos</TabsTrigger>
              <TabsTrigger value="abtests" className="gap-1 text-xs">🧪 Testes A/B</TabsTrigger>
              <TabsTrigger value="ferramentas" className="gap-1 text-xs"><Layers className="h-3 w-3" />Ferramentas</TabsTrigger>
            </TabsList>

            {/* Chat IA */}
            <TabsContent value="chat" className="mt-4">
              <JoseChat
                session={session}
                currencySymbol={currencySymbol}
                accountId={accountId}
              />
            </TabsContent>

            {/* Campaigns */}
            {session && (
              <TabsContent value="campaigns" className="mt-4">
                {session.campaigns.length === 0
                  ? <Card><CardContent className="py-12 flex flex-col items-center gap-2"><AlertTriangle className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Nenhuma campanha no período.</p></CardContent></Card>
                  : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {[...session.campaigns].sort((a, b) => a.health_score - b.health_score).map(c => (
                        <CampaignCard
                          key={c.id} campaign={c} currencySymbol={currencySymbol}
                          accountId={accountId} datePreset={datePreset}
                          onDrillDown={() => handleDrillDown(c.id)}
                          adsets={adsetCache[c.id] || null}
                          isLoadingAdsets={!!loadingAdsets[c.id]}
                        />
                      ))}
                    </div>
                }
              </TabsContent>
            )}

            {/* Actions */}
            {session && (
              <TabsContent value="actions" className="mt-4">
                <div className="space-y-4">
                  {pendingActions.length === 0
                    ? <Card><CardContent className="py-12 flex flex-col items-center gap-2"><CheckCircle className="h-8 w-8 text-emerald-400" /><p className="text-sm text-muted-foreground">Nenhuma ação pendente!</p></CardContent></Card>
                    : <>
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-muted-foreground">{pendingActions.length} ação(ões) recomendada(s)</p>
                          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
                            onClick={() => pendingActions.filter(a => a.auto_safe).forEach(a => handleExecute(a))}
                            disabled={executeAction.isPending || !pendingActions.some(a => a.auto_safe)}>
                            <Zap className="h-3 w-3" />Executar auto-safe ({pendingActions.filter(a => a.auto_safe).length})
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {[...pendingActions]
                            .sort((a, b) => ['critical','high','medium','low'].indexOf(a.priority) - ['critical','high','medium','low'].indexOf(b.priority))
                            .map((action, i) => (
                              <ActionCard
                                key={`${action.campaign_id}-${action.action_type}-${i}`}
                                action={action}
                                onExecute={() => handleExecute(action)}
                                onDismiss={() => dismissAction(action)}
                                isExecuting={executeAction.isPending && executeAction.variables?.campaign_id === action.campaign_id}
                              />
                            ))}
                        </div>
                      </>
                  }
                </div>
              </TabsContent>
            )}

            {/* Analysis */}
            {session && (
              <TabsContent value="analysis" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Brain className="h-5 w-5 text-primary" />
                      JOSÉ — Análise Profunda · Claude claude-opus-4-5
                      <Badge variant="outline" className="text-xs ml-auto font-normal text-muted-foreground">
                        {session.analyzed_at ? new Date(session.analyzed_at).toLocaleString('pt-BR') : ''}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {session.ai_analysis
                      ? <MarkdownRenderer content={session.ai_analysis} />
                      : <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground"><Brain className="h-8 w-8 opacity-30" /><p className="text-sm">Análise IA não disponível.</p></div>
                    }
                    {session.trend_context && (
                      <div className="rounded-lg border border-border bg-card/50 p-4">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Activity className="h-3 w-3" />Contexto Histórico — JOSÉ</p>
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{session.trend_context}</pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {/* Portfolio */}
            {session && (
              <TabsContent value="portfolio" className="mt-4">
                <div className="space-y-4">
                  {/* Portfolio Intelligence from Level 6 */}
                  {(session as any).portfolio_context && (
                    <Card className="border-primary/20 bg-primary/5">
                      <CardHeader><CardTitle className="text-base flex items-center gap-2"><PieChart className="h-4 w-4 text-primary" />Portfólio de Campanhas — JOSÉ</CardTitle></CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {((session as any).portfolio_context as string).split('\n').filter(Boolean).map((line: string, i: number) => (
                            <p key={i} className="text-sm leading-relaxed">{line}</p>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Budget distribution table */}
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4" />Distribuição de Orçamento</CardTitle></CardHeader>
                    <CardContent>
                      {session.campaigns.filter((c: any) => c.daily_budget > 0).length === 0
                        ? <p className="text-sm text-muted-foreground text-center py-4">Nenhuma campanha com orçamento diário definido.</p>
                        : (() => {
                            const withBudget = session.campaigns.filter((c: any) => c.daily_budget > 0);
                            const totalBudget = withBudget.reduce((s: number, c: any) => s + c.daily_budget, 0);
                            const sorted = [...withBudget].sort((a: any, b: any) => b.daily_budget - a.daily_budget);
                            return (
                              <div className="space-y-3">
                                {sorted.map((c: any) => {
                                  const share = (c.daily_budget / totalBudget) * 100;
                                  return (
                                    <div key={c.id} className="space-y-1">
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="truncate max-w-[200px] font-medium" title={c.name}>{c.name}</span>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                          <span className={`text-[10px] font-semibold ${healthColor(c.health_score)}`}>{c.health_score} pts</span>
                                          <span className="text-muted-foreground">{currencySymbol}{fmt(c.daily_budget)}/dia</span>
                                          <span className="font-semibold">{share.toFixed(0)}%</span>
                                        </div>
                                      </div>
                                      <div className="relative h-2 bg-border/40 rounded-full overflow-hidden">
                                        <div
                                          className={`h-2 rounded-full ${c.health_score >= 70 ? 'bg-emerald-500' : c.health_score >= 45 ? 'bg-amber-500' : 'bg-red-500'}`}
                                          style={{ width: `${share}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                                <div className="pt-2 border-t border-border/50 flex justify-between text-xs font-semibold">
                                  <span>Total</span>
                                  <span>{currencySymbol}{fmt(totalBudget)}/dia</span>
                                </div>
                              </div>
                            );
                          })()
                      }
                    </CardContent>
                  </Card>

                  {/* Creative fatigue overview */}
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><Flame className="h-4 w-4" />Fadiga Criativa por Campanha</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {session.campaigns.map((c: any) => {
                          const f = c.creative_fatigue;
                          if (!f) return null;
                          const fColor = f.score >= 70 ? 'text-red-400' : f.score >= 40 ? 'text-amber-400' : f.score >= 20 ? 'text-yellow-400' : 'text-emerald-400';
                          const fBg = f.score >= 70 ? 'bg-red-500' : f.score >= 40 ? 'bg-amber-500' : f.score >= 20 ? 'bg-yellow-500' : 'bg-emerald-500';
                          return (
                            <div key={c.id} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="truncate max-w-[240px]" title={c.name}>{c.name}</span>
                                <span className={`font-semibold ${fColor}`}>{f.level} ({f.score}%)</span>
                              </div>
                              <div className="h-1.5 bg-border/40 rounded-full overflow-hidden">
                                <div className={`h-1.5 rounded-full ${fBg}`} style={{ width: `${f.score}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            )}

            {/* Learning */}
            <TabsContent value="learning" className="mt-4">
              <div className="space-y-4">
                {/* WoW trend table */}
                {snapshots.length > 1 && (
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Histórico Semanal</CardTitle></CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="border-b border-border/50 text-muted-foreground">
                            <th className="text-left py-2 pr-3">Semana</th><th className="text-right pr-3">Score</th>
                            <th className="text-right pr-3">ROAS</th><th className="text-right pr-3">CTR</th>
                            <th className="text-right pr-3">CPC</th><th className="text-right">Gasto</th>
                          </tr></thead>
                          <tbody>{snapshots.map((s: any, i: number) => (
                            <tr key={s.snapshot_date} className="border-b border-border/20 hover:bg-muted/20">
                              <td className="py-2 pr-3">{new Date(s.snapshot_date).toLocaleDateString('pt-BR')}</td>
                              <td className={`text-right pr-3 font-medium ${healthColor(s.overall_health_score)}`}>{s.overall_health_score}</td>
                              <td className="text-right pr-3">{fmt(s.avg_roas || 0)}x</td>
                              <td className="text-right pr-3">{fmt(s.avg_ctr || 0)}%</td>
                              <td className="text-right pr-3">{currencySymbol}{fmt(s.avg_cpc || 0)}</td>
                              <td className="text-right">{currencySymbol}{fmt(s.total_spend || 0)}</td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Action outcomes */}
                {outcomes.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle className="h-4 w-4" />Resultado das Ações Passadas</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {outcomes.map((o: any) => (
                          <div key={o.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3 text-xs">
                            <div className={o.outcome === 'improved' ? 'text-emerald-400' : o.outcome === 'declined' ? 'text-red-400' : 'text-muted-foreground'}>
                              {o.outcome === 'improved' ? <TrendingUp className="h-4 w-4" /> : o.outcome === 'declined' ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium">{actionLabel(o.action_type)}</p>
                              <p className="text-muted-foreground">{o.campaign_id_meta}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`font-bold ${o.improvement_score > 0 ? 'text-emerald-400' : o.improvement_score < 0 ? 'text-red-400' : ''}`}>
                                {o.improvement_score > 0 ? '+' : ''}{o.improvement_score ?? 0} pts
                              </p>
                              <p className="text-muted-foreground text-[10px]">{o.outcome || 'pendente'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Campaign clones */}
                {clones.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><GitFork className="h-4 w-4" />Campanhas Clonadas</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {clones.map((c: any) => (
                          <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3 text-xs">
                            <GitFork className={`h-4 w-4 flex-shrink-0 ${c.clone_status === 'success' ? 'text-emerald-400' : c.clone_status === 'failed' ? 'text-red-400' : 'text-amber-400'}`} />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{c.source_campaign_name} → {c.cloned_campaign_name || 'Processando...'}</p>
                              <p className="text-muted-foreground">{new Date(c.created_at).toLocaleString('pt-BR')}</p>
                            </div>
                            <Badge variant="outline" className={`text-[10px] ${c.clone_status === 'success' ? 'text-emerald-400 border-emerald-500/30' : c.clone_status === 'failed' ? 'text-red-400 border-red-500/30' : 'text-amber-400'}`}>
                              {c.clone_status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {!snapshots.length && !outcomes.length && !clones.length && (
                  <Card><CardContent className="flex flex-col items-center py-12 gap-2 text-muted-foreground">
                    <Activity className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Execute análises para acumular aprendizado.</p>
                    <p className="text-xs">Após 7 dias, o José mede se as ações tomadas melhoraram as métricas.</p>
                  </CardContent></Card>
                )}
              </div>
            </TabsContent>

            {/* History log */}
            <TabsContent value="history" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Histórico de Execuções</CardTitle></CardHeader>
                <CardContent>
                  {executedActions.length === 0
                    ? <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground"><Clock className="h-8 w-8 opacity-30" /><p className="text-sm">Nenhuma ação executada ainda.</p></div>
                    : <ScrollArea className="h-[400px]">
                        <div className="space-y-2 pr-4">
                          {executedActions.map((log: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-card/50 p-3">
                              <div className={`mt-0.5 ${log.result?.success === false ? 'text-red-400' : 'text-emerald-400'}`}>
                                {log.result?.success === false ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">{actionLabel(log.action_type)}</span>
                                  <Badge variant="outline" className="text-[10px]">{log.executed_by === 'jose_auto' ? '🤖 José Auto' : '👤 Manual'}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground truncate">{log.campaign_name}</p>
                                {log.executed_at && <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(log.executed_at).toLocaleString('pt-BR')}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                  }
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sazonalidade */}
            <TabsContent value="seasonal" className="mt-4">
              <div className="space-y-4">
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sun className="h-4 w-4 text-amber-400" />
                      Contexto Sazonal Atual
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 ml-auto">Brasil · {new Date().toLocaleDateString('pt-BR')}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(session as any)?.seasonal_context
                      ? <div className="space-y-2">
                          {((session as any).seasonal_context as string).split('\n').filter(Boolean).map((line: string, i: number) => (
                            <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-background/50 border border-border/40">
                              <p className="text-sm leading-relaxed">{line}</p>
                            </div>
                          ))}
                        </div>
                      : <p className="text-sm text-muted-foreground">Execute uma análise para ver o contexto sazonal atual.</p>
                    }
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-2"><RefreshCw className="h-4 w-4" />Calendário Comercial Brasileiro</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {[
                        { date: 'Nov 24-30', event: '🛒 Black Friday', impact: 'Pico máximo anual', color: 'text-red-400' },
                        { date: 'Dez 1-24', event: '🎄 Natal', impact: 'Alta temporada', color: 'text-emerald-400' },
                        { date: 'Mai (2ª dom)', event: '💐 Dia das Mães', impact: 'Pico presenteáveis', color: 'text-pink-400' },
                        { date: 'Ago (2ª dom)', event: '👔 Dia dos Pais', impact: 'Tech e moda masc.', color: 'text-blue-400' },
                        { date: 'Out (2ª dom)', event: '🧸 Dia das Crianças', impact: 'Games e brinquedos', color: 'text-amber-400' },
                        { date: 'Jun 10-30', event: '🎪 Mid-Year Sale', impact: 'Liquidações', color: 'text-purple-400' },
                        { date: 'Fev (Carnaval)', event: '🎭 Carnaval', impact: 'Queda B2B', color: 'text-orange-400' },
                        { date: 'Jan 1-20', event: '❄️ Pós-Festas', impact: 'Ressaca de consumo', color: 'text-cyan-400' },
                      ].map(({ date, event, impact, color }) => (
                        <div key={date} className="flex items-center gap-2 rounded-lg border border-border/40 p-2.5">
                          <div className="flex-1">
                            <p className={`font-semibold ${color}`}>{event}</p>
                            <p className="text-muted-foreground text-[10px]">{date} · {impact}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Regras de Ouro */}
            <TabsContent value="golden-rules" className="mt-4">
              <GoldenRulesTab />
            </TabsContent>

            {/* Schedule */}
            <TabsContent value="schedule" className="mt-4">
              <div className="max-w-md mx-auto">
                <CronSettings />
              </div>
            </TabsContent>

            {/* Criar Campanha */}
            <TabsContent value="criar" className="mt-4">
              <CampanhaCreator connectedAccount={connectedAccount} />
            </TabsContent>

            {/* Públicos */}
            <TabsContent value="publicos" className="mt-4">
              <PublicosManager connectedAccount={connectedAccount} />
            </TabsContent>

            {/* Testes A/B */}
            <TabsContent value="abtests" className="mt-4">
              <AbTestManager connectedAccount={connectedAccount} />
            </TabsContent>

            {/* Ferramentas Integradas */}
            <TabsContent value="ferramentas" className="mt-4">
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Ferramentas Integradas</h2>
                  <p className="text-sm text-muted-foreground">Todas as ferramentas de tráfego pago disponíveis para você</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { title: 'Analytics Avançado', description: 'Análise detalhada de performance das campanhas', url: '/analytics', icon: BarChart3, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
                    { title: 'Alocação de Orçamento', description: 'Distribua seu investimento de forma inteligente', url: '/budget', icon: Wallet, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                    { title: 'Otimizador de Campanhas', description: 'Sugestões automáticas para melhorar resultados', url: '/optimizer', icon: Target, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
                    { title: 'Regras Automáticas', description: 'Crie regras para otimizar campanhas no piloto automático', url: '/rules', icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
                    { title: 'Testes A/B', description: 'Compare criativos, públicos e configurações', url: '/ab-testing', icon: FlaskConical, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
                    { title: 'Google Ads', description: 'Dashboard e métricas do Google Ads', url: '/google-ads', icon: BarChart3, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
                    { title: 'LinkedIn Ads', description: 'Gestão de campanhas no LinkedIn', url: '/linkedin-ads', icon: Users, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20' },
                    { title: 'Meta Pixels', description: 'Gerencie seus pixels de rastreamento Meta', url: '/meta-pixels', icon: Code2, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20' },
                    { title: 'Públicos Meta', description: 'Crie e gerencie públicos personalizados e semelhantes', url: '/meta-audiences', icon: Users, color: 'text-pink-400', bg: 'bg-pink-500/10 border-pink-500/20' },
                    { title: 'Biblioteca de Criativos', description: 'Todos os seus criativos e assets em um lugar', url: '/library', icon: BookOpen, color: 'text-teal-400', bg: 'bg-teal-500/10 border-teal-500/20' },
                  ].map((tool) => (
                    <button
                      key={tool.url}
                      onClick={() => navigate(tool.url)}
                      className={`group flex items-start gap-4 rounded-xl border p-4 text-left transition-all hover:scale-[1.01] hover:shadow-md ${tool.bg}`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/50 ${tool.color}`}>
                        <tool.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm ${tool.color}`}>{tool.title}</p>
                          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{tool.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Auto-executed banner */}
        {session?.execution_log?.length > 0 && executedActions.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Zap className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-emerald-400">
              🤖 JOSÉ executou <strong>{session.execution_log.length}</strong> ação(ões) no auto-piloto.
            </p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
