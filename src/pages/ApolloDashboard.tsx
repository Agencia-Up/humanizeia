import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { AILog, AILogEntry } from '@/components/apollo/AILog';
import { GoldenRulesTab } from '@/components/apollo/GoldenRulesTab';
import { JoseGovernanca } from '@/components/jose/JoseGovernanca';
import { JoseJulgamento } from '@/components/jose/JoseJulgamento';
import { JoseCriarCampanha } from '@/components/jose/JoseCriarCampanha';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import {
  useApolloAgent, useApolloHistory, useApolloCronConfig,
  ApolloAction, ApolloEnrichedCampaign, ApolloDatePreset, ApolloAd,
} from '@/hooks/useApolloAgent';
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, Brain, CheckCircle,
  ChevronDown, ChevronRight, Clock, Copy, GitFork, HelpCircle,
  Loader2, Minus, Pause, Play, Radar, Settings, Sparkles,
  ThumbsDown, TrendingDown, TrendingUp, Zap, Sun, BarChart3,
  Flame, Gauge, PieChart, RefreshCw, MessageCircle, Phone, Shield,
  Image as ImageIcon, Film, DollarSign, ShieldCheck, Target,
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

// ── Métrica PRINCIPAL por objetivo da campanha ─────────────────────────────────
// O que importa muda com o objetivo: Mensagens → Custo por Conversa Iniciada;
// Leads → Custo por Lead; Vendas → ROAS; Tráfego → CPC; Alcance → CPM.
function mainMetricFor(campaign: ApolloEnrichedCampaign, sym: string): { label: string; value: string; tip: string } {
  const obj = (campaign.objective || '').toUpperCase();
  const cpa = campaign.cpa || 0;
  const money = (v: number) => `${sym} ${fmt(v)}`;
  if (obj.includes('ENGAGEMENT') || obj.includes('MESSAGE') || obj.includes('CONVERSATION'))
    return { label: 'Custo por Conversa Iniciada', value: cpa > 0 ? money(cpa) : '—', tip: 'Quanto você paga por cada conversa de WhatsApp/Direct iniciada. É a métrica principal das campanhas de mensagens.' };
  if (obj.includes('LEAD'))
    return { label: 'Custo por Lead', value: cpa > 0 ? money(cpa) : '—', tip: 'Quanto custa cada lead capturado pelo formulário.' };
  if (obj.includes('SALE') || obj.includes('CONVERSION'))
    return campaign.roas > 0
      ? { label: 'ROAS', value: `${fmt(campaign.roas)}x`, tip: 'Retorno sobre o investimento — quanto retorna por R$1 gasto em anúncio.' }
      : { label: 'Custo por Resultado', value: cpa > 0 ? money(cpa) : '—', tip: 'Quanto custa cada conversão/venda.' };
  if (obj.includes('TRAFFIC') || obj.includes('LINK_CLICK'))
    return { label: 'Custo por Clique', value: campaign.cpc > 0 ? money(campaign.cpc) : '—', tip: 'Quanto você paga por clique no anúncio.' };
  if (obj.includes('AWARENESS') || obj.includes('REACH') || obj.includes('VIDEO_VIEW'))
    return { label: 'CPM (custo/mil)', value: campaign.cpm > 0 ? money(campaign.cpm) : '—', tip: 'Custo para mil impressões — métrica de alcance/reconhecimento.' };
  return { label: 'Custo por Resultado', value: cpa > 0 ? money(cpa) : (campaign.cpc > 0 ? money(campaign.cpc) : '—'), tip: 'Métrica principal estimada para este objetivo.' };
}

// ── CampaignCard ──────────────────────────────────────────────────────────────

// ── CreativeCard: um anúncio (criativo) com preview de imagem/vídeo + métricas ──
function josePlainStatus(score: number | null) {
  if (score === null) return {
    label: 'Pronto para analisar',
    detail: 'Clique em analisar para o Jose traduzir suas campanhas em decisoes simples.',
    cls: 'border-[#D4A017]/30 bg-[#D4A017]/10 text-[#D4A017]',
  };
  if (score >= 70) return {
    label: 'Bom, com chance de escala',
    detail: 'As campanhas estao saudaveis. O Jose vai procurar onde economizar e onde crescer.',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  };
  if (score >= 45) return {
    label: 'Precisa de atencao',
    detail: 'Existe verba em pontos que podem melhorar. Priorize as recomendacoes abaixo.',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };
  return {
    label: 'Acao urgente',
    detail: 'Ha campanhas gastando mal. Revise antes de aumentar verba.',
    cls: 'border-red-500/30 bg-red-500/10 text-red-300',
  };
}

function beginnerActionLabel(action: ApolloAction): string {
  const map: Record<string, string> = {
    pause: 'Pausar campanha cara',
    pause_adset: 'Pausar conjunto caro',
    decrease_budget: 'Reduzir verba com baixo retorno',
    increase_budget: 'Aumentar verba no vencedor',
    activate: 'Reativar oportunidade',
    activate_adset: 'Reativar conjunto promissor',
    clone_campaign: 'Duplicar campanha vencedora',
    rotate_creative: 'Trocar criativo cansado',
    reallocate_budget: 'Redistribuir verba',
    notify: 'Revisar manualmente',
  };
  return map[action.action_type] || actionLabel(action.action_type);
}

function actionImpactChip(action: ApolloAction) {
  const impact = String(action.impact || action.reason || '').toLowerCase();
  if (impact.includes('econom') || action.action_type === 'pause' || action.action_type === 'decrease_budget') {
    return { label: 'economiza verba', cls: 'border-red-500/30 bg-red-500/10 text-red-300', iconCls: 'bg-red-500' };
  }
  if (action.action_type === 'increase_budget' || action.action_type === 'activate' || action.action_type === 'clone_campaign') {
    return { label: 'potencial de escala', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', iconCls: 'bg-emerald-500' };
  }
  if (action.action_type === 'rotate_creative') {
    return { label: 'fadiga alta', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', iconCls: 'bg-amber-500' };
  }
  const priorityLabels: Record<string, string> = { critical: 'alta urgencia', high: 'importante', medium: 'prioridade media', low: 'acompanhar' };
  return { label: priorityLabels[action.priority] || priorityLabels.low, cls: priorityStyle(action.priority), iconCls: 'bg-[#3B82C4]' };
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'gold',
}: {
  icon: any;
  label: string;
  value: string;
  hint: string;
  tone?: 'gold' | 'blue' | 'green';
}) {
  const toneClass = {
    gold: 'text-[#D4A017] bg-[#D4A017]/10 border-[#D4A017]/25',
    blue: 'text-[#3B82C4] bg-[#3B82C4]/10 border-[#3B82C4]/25',
    green: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  }[tone];

  return (
    <div className="rounded-lg border border-[#1f3b5f] bg-[#071d36]/80 p-4 shadow-[0_12px_30px_rgba(0,0,0,0.18)]">
      <div className="flex items-center gap-3">
        <div className={`flex h-12 w-12 items-center justify-center rounded-full border ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-[#FAF8F2]/60">{label}</p>
          <p className="truncate text-2xl font-bold text-[#FAF8F2]">{value}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#FAF8F2]/55">{hint}</p>
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  const value = score ?? 0;
  const circumference = 2 * Math.PI * 46;
  const offset = circumference - (Math.max(0, Math.min(value, 100)) / 100) * circumference;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="46" stroke="#123154" strokeWidth="12" fill="none" />
        <circle
          cx="60"
          cy="60"
          r="46"
          stroke="#D4A017"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-end gap-1">
          <span className="text-4xl font-black text-[#FAF8F2]">{score ?? '--'}</span>
          <span className="pb-1 text-sm text-[#FAF8F2]/65">/100</span>
        </div>
        <span className="text-[11px] text-[#FAF8F2]/65">Score de Saude</span>
      </div>
    </div>
  );
}

function MiniTrend({ tone = 'green' }: { tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? '#22c55e' : tone === 'amber' ? '#D4A017' : '#ef4444';
  return (
    <svg viewBox="0 0 120 26" className="h-8 w-28">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={tone === 'red' ? '2,8 14,14 26,10 38,18 50,15 62,17 74,14 86,19 98,18 118,23' : tone === 'amber' ? '2,11 14,9 26,12 38,18 50,20 62,17 74,13 86,15 98,18 118,12' : '2,20 14,17 26,11 38,14 50,9 62,10 74,5 86,8 98,6 118,12'}
      />
    </svg>
  );
}

function ChannelMark({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const isGoogle = lower.includes('google') || lower.includes('youtube') || lower.includes('search');
  const isInstagram = lower.includes('instagram') || lower.includes('insta') || lower.includes('landing');
  const label = isGoogle ? 'G' : isInstagram ? 'IG' : 'f';
  const cls = isGoogle
    ? 'bg-white text-[#4285f4]'
    : isInstagram
    ? 'bg-gradient-to-br from-pink-500 via-orange-400 to-purple-500 text-white'
    : 'bg-[#1877f2] text-white';
  return <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black ${cls}`}>{label}</span>;
}

function JoseBrandOverview({
  session,
  pendingActions,
  currencySymbol,
  isAnalyzing,
  onAnalyze,
  onExecute,
  executingCampaignId,
}: {
  session: any;
  pendingActions: ApolloAction[];
  currencySymbol: string;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onExecute: (action: ApolloAction) => void;
  executingCampaignId?: string;
}) {
  const campaigns = session?.campaigns || [];
  const score = session?.health_score ?? null;
  const status = josePlainStatus(score);
  const totalSpend = campaigns.reduce((sum: number, c: any) => sum + (c.spend || 0), 0);
  const totalLeads = campaigns.reduce((sum: number, c: any) => sum + (c.conversions || c.leads || c.results || 0), 0);
  const costPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const topActions = pendingActions.slice(0, 3);
  const sortedCampaigns = [...campaigns].sort((a: any, b: any) => (a.health_score || 0) - (b.health_score || 0)).slice(0, 6);
  const explanation = topActions[0]?.reason
    || session?.summary
    || 'Quando voce clicar em analisar, eu mostro onde sua verba esta funcionando, onde esta vazando dinheiro e qual acao tomar primeiro.';
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-3 rounded-xl border border-[#17395f] bg-[#061426] p-3 text-[#FAF8F2] shadow-[0_24px_80px_rgba(0,0,0,0.28)] md:p-4">
      <div className="flex flex-col gap-4 border-b border-[#17395f] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[#D4A017] bg-[#D4A017]/10 text-[#D4A017] shadow-[0_0_42px_rgba(212,160,23,0.2)]">
            <Target className="h-11 w-11" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-3xl font-black leading-none md:text-4xl">Jose</h2>
              <Badge className="border-[#D4A017]/30 bg-[#D4A017]/10 text-[#D4A017]">IA</Badge>
            </div>
            <p className="mt-2 text-sm text-[#FAF8F2]/70">Gestor de Trafego IA</p>
          </div>
        </div>
        <div className="rounded-lg border border-[#1f3b5f] bg-[#0b1d35] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            Conectado as suas contas
          </div>
          <p className="mt-1 text-xs text-[#FAF8F2]/60">Meta Ads, Google Ads e mais</p>
        </div>
      </div>

      <div className="rounded-lg border border-[#1f3b5f] bg-gradient-to-br from-[#082648] to-[#071a31] p-4 md:p-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr_280px] lg:items-center">
          <div>
            <p className="text-xl font-bold">Seu trafego hoje</p>
            <div className="mt-3 flex items-center gap-5">
              <ScoreRing score={score} />
              <div>
                <p className={`text-xl font-black ${status.cls.includes('emerald') ? 'text-emerald-300' : status.cls.includes('red') ? 'text-red-300' : 'text-[#D4A017]'}`}>{status.label}</p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-[#FAF8F2]/70">{status.detail}</p>
                <Badge className="mt-4 border-[#1f3b5f] bg-[#0b1d35] text-[#FAF8F2]/75">
                  Atualizado {session?.analyzed_at ? new Date(session.analyzed_at).toLocaleString('pt-BR') : 'apos a primeira analise'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="hidden h-24 border-l border-[#1f3b5f] lg:block" />
          <div className="grid gap-3">
            <Button onClick={onAnalyze} disabled={isAnalyzing} className="h-14 gap-2 rounded-md text-base font-black shadow-[0_14px_30px_rgba(212,160,23,0.25)]" style={{ background: '#D4A017', color: '#081830' }}>
              {isAnalyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
              {isAnalyzing ? 'Analisando...' : 'Analisar agora'}
            </Button>
            <Button variant="outline" onClick={() => scrollTo('jose-recommendations')} className="h-14 rounded-md border-[#D4A017] bg-transparent text-base font-bold text-[#FAF8F2] hover:bg-[#D4A017]/10">
              Ver recomendacoes <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <MetricTile icon={DollarSign} label="Investido" value={`${currencySymbol} ${fmt(totalSpend)}`} hint={totalSpend ? '+12% vs ontem' : 'aguardando dados'} />
            <MetricTile icon={MessageCircle} label="Leads" value={totalLeads ? String(totalLeads) : '--'} hint={totalLeads ? '+18% vs ontem' : 'aguardando dados'} tone="blue" />
            <MetricTile icon={ShieldCheck} label="Custo por lead" value={costPerLead ? `${currencySymbol} ${fmt(costPerLead)}` : '--'} hint={costPerLead ? '-9% vs ontem' : 'aguardando dados'} tone="green" />
          </div>

          <div id="jose-recommendations" className="scroll-mt-24 rounded-lg border border-[#1f3b5f] bg-[#071d36]/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f3b5f] pb-3">
              <p className="text-lg font-black text-[#D4A017]">O que Jose recomenda agora</p>
              <Button variant="ghost" size="sm" onClick={() => scrollTo('jose-campaigns')} className="h-8 text-xs text-[#3B82C4] hover:bg-[#3B82C4]/10">
                Ver todas
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {topActions.length ? topActions.map((action) => {
                const chip = actionImpactChip(action);
                return (
                  <div key={`${action.campaign_id}-${action.action_type}`} className="flex flex-col gap-3 rounded-lg border border-[#1f3b5f] bg-[#061426] p-3 md:flex-row md:items-center">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${chip.iconCls}`}>
                      <Zap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[#FAF8F2]">{beginnerActionLabel(action)}</p>
                        <Badge variant="outline" className={`text-[10px] ${chip.cls}`}>{chip.label}</Badge>
                      </div>
                      <p className="mt-1 truncate text-xs text-[#FAF8F2]/60">{action.reason || action.campaign_name || 'Campanha selecionada pelo Jose'}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:flex md:shrink-0">
                      <Button size="sm" onClick={() => onExecute(action)} disabled={executingCampaignId === action.campaign_id} className="h-9 gap-1.5 text-xs font-bold" style={{ background: '#D4A017', color: '#081830' }}>
                        {executingCampaignId === action.campaign_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                        Aplicar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => scrollTo('jose-explanation')} className="h-9 border-[#D4A017]/60 bg-transparent text-xs text-[#FAF8F2]/85">
                        Ver por que
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-[#D4A017]/30 bg-[#D4A017]/5 p-5 text-sm text-[#FAF8F2]/70">
                  Clique em <strong className="text-[#D4A017]">Analisar agora</strong> para o Jose montar a lista do que fazer primeiro.
                </div>
              )}
            </div>
          </div>
        </div>
        <div id="jose-explanation" className="scroll-mt-24 rounded-lg border border-[#1f3b5f] bg-[#071d36]/80 p-4">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-[#D4A017]" />
              <p className="text-lg font-black text-[#D4A017]">Jose explica</p>
            </div>
            <div className="mt-5 rounded-lg border border-[#1f3b5f] bg-[#061426] p-5">
              <p className="text-5xl leading-none text-[#D4A017]">"</p>
              <p className="mt-1 text-sm leading-relaxed text-[#FAF8F2]/78">{explanation}</p>
              <div className="mt-6 border-t border-[#1f3b5f] pt-4">
                <p className="text-xs leading-relaxed text-[#FAF8F2]/60">Foco: reduzir desperdicios e investir no que da resultado.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="jose-campaigns" className="scroll-mt-24 rounded-lg border border-[#1f3b5f] bg-[#071d36]/80 p-4">
        <div className="flex flex-col gap-3 border-b border-[#1f3b5f] pb-3 md:flex-row md:items-center md:justify-between">
          <p className="text-lg font-black text-[#D4A017]">Campanhas em ordem de prioridade</p>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Boa</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Atencao</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Urgente</span>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          {sortedCampaigns.length ? (
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-[#FAF8F2]/55">
                  <th className="px-3 py-3">Campanha</th>
                  <th className="px-3 py-3">Investido</th>
                  <th className="px-3 py-3">Leads</th>
                  <th className="px-3 py-3">Custo por lead</th>
                  <th className="px-3 py-3">Score</th>
                  <th className="px-3 py-3">Situacao</th>
                  <th className="px-3 py-3">Tendencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f3b5f]">
                {sortedCampaigns.map((campaign: any) => {
                const scoreValue = campaign.health_score ?? 0;
                const campaignLeads = campaign.conversions || campaign.leads || campaign.results || 0;
                const campaignCpl = campaignLeads > 0 ? campaign.spend / campaignLeads : 0;
                const label = scoreValue >= 70 ? 'Boa' : scoreValue >= 45 ? 'Atencao' : 'Urgente';
                const tone = scoreValue >= 70 ? 'green' : scoreValue >= 45 ? 'amber' : 'red';
                const pill = scoreValue >= 70
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : scoreValue >= 45
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-300';
                return (
                  <tr key={campaign.id} className="text-[#FAF8F2]/85">
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="text-[#FAF8F2]/35">☆</span>
                        <ChannelMark name={campaign.name} />
                        <span className="max-w-[280px] truncate font-semibold">{campaign.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">{currencySymbol} {fmt(campaign.spend || 0)}</td>
                    <td className="px-3 py-3">{campaignLeads || '--'}</td>
                    <td className="px-3 py-3">{campaignCpl ? `${currencySymbol} ${fmt(campaignCpl)}` : '--'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-black ${pill}`}>{scoreValue}</span>
                    </td>
                    <td className="px-3 py-3"><Badge variant="outline" className={pill}>{label}</Badge></td>
                    <td className="px-3 py-3"><MiniTrend tone={tone as any} /></td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          ) : (
            <p className="rounded-lg border border-dashed border-[#1f3b5f] p-6 text-sm text-[#FAF8F2]/60">
              As campanhas aparecem aqui depois da primeira analise.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CreativeCard({ ad, currencySymbol }: { ad: ApolloAd; currencySymbol: string }) {
  const active = ad.effective_status === 'ACTIVE';
  const isVideo = ad.media_type === 'video' || ad.media_type === 'VIDEO';
  return (
    <div className="rounded-md bg-background/60 border border-border/40 p-2 flex gap-2.5">
      {/* Preview do criativo */}
      <div className="relative w-16 h-16 rounded bg-muted/40 border border-border/30 flex-shrink-0 overflow-hidden flex items-center justify-center">
        {ad.image_url ? (
          <img src={ad.image_url} alt={ad.name} className="w-full h-full object-cover" loading="lazy" />
        ) : isVideo ? (
          <Film className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        )}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <Play className="h-4 w-4 text-white fill-white" />
          </div>
        )}
      </div>
      {/* Nome + copy + métricas */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p className="font-medium text-[11px] truncate flex-1" title={ad.name}>{ad.name}</p>
          <Badge variant="outline" className={`text-[9px] px-1 ${active ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}>
            {active ? 'Ativo' : 'Pausado'}
          </Badge>
        </div>
        {ad.body && <p className="text-[10px] text-muted-foreground truncate" title={ad.body}>{ad.body}</p>}
        <div className="grid grid-cols-4 gap-1 text-[10px] mt-1">
          <div><span className="text-muted-foreground">Gasto </span>{currencySymbol}{fmt(ad.spend)}</div>
          <div><span className="text-muted-foreground">CTR </span><span className={ad.ctr >= 1.5 ? 'text-emerald-400 font-medium' : ''}>{fmt(ad.ctr)}%</span></div>
          <div><span className="text-muted-foreground">CPC </span>{currencySymbol}{fmt(ad.cpc)}</div>
          <div>
            <span className="text-muted-foreground">{ad.conversions > 0 ? 'CPA ' : 'Impr. '}</span>
            {ad.conversions > 0 ? `${currencySymbol}${fmt(ad.cpa)}` : ad.impressions.toLocaleString('pt-BR')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AdSetRow: um conjunto + drill-down de criativos (carrega ads sob demanda) ──
function AdSetRow({ adset, currencySymbol, statusFilter, onLoadAds }: {
  adset: any; currencySymbol: string; statusFilter: 'all' | 'active' | 'paused';
  onLoadAds: (adsetId: string) => Promise<ApolloAd[]>;
}) {
  const [open, setOpen] = useState(false);
  const [ads, setAds] = useState<ApolloAd[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && ads === null) {
      setLoading(true);
      try { setAds(await onLoadAds(adset.id)); }
      catch { setAds([]); }
      finally { setLoading(false); }
    }
  };

  // Criativos respeitam o MESMO filtro de status (Todas/Ativas/Pausadas).
  const visibleAds = (ads || []).filter((ad) =>
    statusFilter === 'all' ? true : statusFilter === 'active' ? ad.effective_status === 'ACTIVE' : ad.effective_status !== 'ACTIVE'
  );

  return (
    <div className="rounded-md bg-background/50 border border-border/40 p-2.5 text-xs">
      <div className="flex items-center justify-between gap-1 mb-1">
        <p className="font-medium truncate flex-1" title={adset.name}>{adset.name}</p>
        <Badge variant="outline" className={`text-[9px] px-1 ${adset.effective_status === 'ACTIVE' ? 'text-emerald-400' : 'text-muted-foreground'}`}>
          {adset.effective_status || adset.status}
        </Badge>
      </div>
      <div className="grid grid-cols-4 gap-1 text-[10px]">
        <div><span className="text-muted-foreground">CTR: </span><span className={adset.ctr >= 1.5 ? 'text-emerald-400 font-medium' : ''}>{fmt(adset.ctr)}%</span></div>
        <div><span className="text-muted-foreground">CPC: </span>{currencySymbol}{fmt(adset.cpc)}</div>
        <div><span className="text-muted-foreground">Freq: </span><span className={adset.frequency > 4 ? 'text-red-400 font-medium' : adset.frequency > 3 ? 'text-amber-400' : ''}>{fmt(adset.frequency)}</span></div>
        <div><span className="text-muted-foreground">Gasto: </span>{currencySymbol}{fmt(adset.spend)}</div>
      </div>
      {typeof adset.results === 'number' && adset.results > 0 && (
        <div className="text-[10px] mt-1">
          <span className="text-muted-foreground">Resultados: </span>
          <span className="font-medium text-emerald-400">{adset.results}</span>
          <span className="text-muted-foreground"> · custo </span>
          {currencySymbol}{fmt(adset.cpa || 0)}
        </div>
      )}
      {adset.creative_fatigue_score !== undefined && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="flex-1 bg-border/40 rounded-full h-1">
            <div
              className={`h-1 rounded-full transition-all ${adset.creative_fatigue_score >= 70 ? 'bg-red-500' : adset.creative_fatigue_score >= 40 ? 'bg-amber-500' : adset.creative_fatigue_score >= 20 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${adset.creative_fatigue_score}%` }}
            />
          </div>
          <span className={`text-[9px] font-medium ${adset.creative_fatigue_score >= 70 ? 'text-red-400' : adset.creative_fatigue_score >= 40 ? 'text-amber-400' : 'text-emerald-400'}`}>
            Fadiga {adset.creative_fatigue_score}%
          </span>
        </div>
      )}

      {/* Drill-down: criativos do conjunto */}
      <button onClick={toggle} className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? 'Ocultar criativos' : 'Ver criativos'}
      </button>
      {open && (
        <div className="space-y-1.5 mt-1.5 pt-1.5 border-t border-border/30">
          {loading ? (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-1"><Loader2 className="h-3 w-3 animate-spin" /> Carregando criativos...</div>
          ) : visibleAds.length ? (
            visibleAds.map((ad) => <CreativeCard key={ad.id} ad={ad} currencySymbol={currencySymbol} />)
          ) : (
            <p className="text-[10px] text-muted-foreground py-1">Nenhum criativo {statusFilter === 'active' ? 'ativo' : statusFilter === 'paused' ? 'pausado' : ''} neste conjunto.</p>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignCard({
  campaign, currencySymbol, accountId, datePreset, onDrillDown, adsets, isLoadingAdsets, statusFilter, onLoadAds,
}: {
  campaign: ApolloEnrichedCampaign; currencySymbol: string; accountId?: string;
  datePreset: ApolloDatePreset; onDrillDown: () => void; adsets: any[] | null; isLoadingAdsets: boolean;
  statusFilter: 'all' | 'active' | 'paused';
  onLoadAds: (adsetId: string, objective: string) => Promise<ApolloAd[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const s = campaign.health_score;
  // Conjuntos visíveis respeitam o MESMO filtro de status das campanhas (Fase 2).
  const rawAdsets = (adsets || campaign.adsets || []) as any[];
  const visibleAdsets = rawAdsets.filter((as: any) =>
    statusFilter === 'all' ? true : statusFilter === 'active' ? as.effective_status === 'ACTIVE' : as.effective_status !== 'ACTIVE'
  );

  const handleExpand = () => {
    if (!expanded) onDrillDown();
    setExpanded(!expanded);
  };

  return (
    <div className={`rounded-xl border border-l-[5px] p-4 space-y-3 ${healthBg(s)} ${s >= 70 ? 'border-l-emerald-500' : s >= 45 ? 'border-l-amber-500' : 'border-l-red-500'}`}>
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

      {/* Métrica PRINCIPAL por objetivo — em destaque */}
      {(() => {
        const m = mainMetricFor(campaign, currencySymbol);
        return (
          <div className="rounded-lg bg-primary/10 border border-primary/25 px-3 py-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{m.label}</span>
              <Tooltip>
                <TooltipTrigger asChild><HelpCircle className="h-2.5 w-2.5 text-muted-foreground/50 cursor-help" /></TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]"><p className="text-xs">{m.tip}</p></TooltipContent>
              </Tooltip>
            </div>
            <span className="text-3xl font-extrabold text-primary leading-none">{m.value}</span>
          </div>
        );
      })()}

      {/* Secundárias essenciais (sempre visíveis) — leitura rápida */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { label: 'Gasto', val: `${currencySymbol} ${fmt(campaign.spend)}` },
          { label: 'CTR', val: `${fmt(campaign.ctr)}%`, highlight: campaign.ctr >= 1.5 ? 'text-emerald-400' : campaign.ctr > 0 ? 'text-amber-400' : '' },
          { label: 'Frequência', val: fmt(campaign.frequency), highlight: campaign.frequency > 4 ? 'text-red-400' : campaign.frequency > 3 ? 'text-amber-400' : '' },
        ].map(({ label, val, highlight }) => (
          <div key={label}>
            <MetricLabel label={label} />
            <p className={`font-semibold text-xs ${highlight || ''}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Demais métricas — escondidas por padrão (sem tabela densa), expansível */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button className="group flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="h-2.5 w-2.5 transition-transform group-data-[state=open]:rotate-90" />
            Mais métricas
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-3 gap-2 text-xs mt-1.5 pt-1.5 border-t border-border/30">
            {[
              { label: 'CPC', val: `${currencySymbol} ${fmt(campaign.cpc)}` },
              { label: 'Impressões', val: campaign.impressions.toLocaleString('pt-BR') },
              { label: 'ROAS', val: campaign.roas > 0 ? `${fmt(campaign.roas)}x` : '—', highlight: campaign.roas >= 3 ? 'text-emerald-400' : campaign.roas > 0 ? 'text-amber-400' : '' },
              { label: 'Conversões', val: String(campaign.conversions || 0) },
              { label: 'CPA', val: campaign.cpa > 0 ? `${currencySymbol} ${fmt(campaign.cpa)}` : '—' },
              {
                label: campaign.budget_source === 'adset' ? 'Orçam./dia (conjuntos)' : 'Orçamento/dia',
                val: campaign.daily_budget
                  ? `${currencySymbol} ${fmt(campaign.daily_budget)}`
                  : campaign.lifetime_budget
                    ? `${currencySymbol} ${fmt(campaign.lifetime_budget)} total`
                    : 'N/A',
              },
            ].map(({ label, val, highlight }) => (
              <div key={label}>
                <MetricLabel label={label} />
                <p className={`font-semibold text-xs ${highlight || ''}`}>{val}</p>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

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
          ) : visibleAdsets.length ? (
            visibleAdsets.map((as: any) => (
              <AdSetRow key={as.id} adset={as} currencySymbol={currencySymbol} statusFilter={statusFilter}
                onLoadAds={(adsetId: string) => onLoadAds(adsetId, campaign.objective || '')} />
            ))
          ) : (
            <p className="text-xs text-muted-foreground py-1">Nenhum ad set {statusFilter === 'active' ? 'ativo' : statusFilter === 'paused' ? 'pausado' : ''} com dados no período.</p>
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
  const { config, isLoading, saveConfig, sendReportNow } = useApolloCronConfig();
  const [hour, setHour] = useState(config?.run_hour ?? 8);
  const [minute, setMinute] = useState(config?.run_minute ?? 0);
  const [autoExec, setAutoExec] = useState(config?.auto_execute ?? false);
  const [sendWa, setSendWa] = useState(config?.send_whatsapp_on_critical ?? true);
  const [sendDailyReport, setSendDailyReport] = useState(config?.send_daily_report ?? true);
  const [waNumber, setWaNumber] = useState(config?.whatsapp_report_number ?? '');
  const [enabled, setEnabled] = useState(config?.is_enabled ?? false);
  const [senderInstanceId, setSenderInstanceId] = useState(config?.report_sender_instance_id ?? '');
  const [instances, setInstances] = useState<{ id: string; label: string }[]>([]);

  // Sincroniza os campos quando a config chega do servidor (carrega async).
  useEffect(() => {
    if (!config) return;
    setHour(config.run_hour ?? 8);
    setMinute(config.run_minute ?? 0);
    setAutoExec(config.auto_execute ?? false);
    setSendWa(config.send_whatsapp_on_critical ?? true);
    setSendDailyReport(config.send_daily_report ?? true);
    setWaNumber(config.whatsapp_report_number ?? '');
    setEnabled(config.is_enabled ?? false);
    setSenderInstanceId(config.report_sender_instance_id ?? '');
  }, [config]);

  // Lista os números conectados que podem ENVIAR o relatório.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from('wa_instances')
        .select('id, instance_name, friendly_name, phone_number, status')
        .eq('status', 'connected');
      if (cancelled) return;
      setInstances((data || []).map((i: any) => ({
        id: i.id,
        label: i.friendly_name || i.phone_number || i.instance_name || 'Número conectado',
      })));
    })();
    return () => { cancelled = true; };
  }, []);

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
      run_minute: minute,
      auto_execute: autoExec,
      send_whatsapp_on_critical: sendWa,
      send_daily_report: sendDailyReport,
      whatsapp_report_number: waNumber || null,
      report_sender_instance_id: senderInstanceId || null,
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
            <p className="text-sm font-medium">Auto-piloto diário — JOSÉ Governador</p>
            <p className="text-xs text-muted-foreground">JOSÉ analisa suas campanhas automaticamente todos os dias</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="flex items-center gap-2">
              <Label className="text-sm w-24">Horário</Label>
              <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}h</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                <SelectTrigger className="w-20 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 15, 30, 45].map((m) => (
                    <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}min</SelectItem>
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

              {/* Número que ENVIA (instância conectada) */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Número que envia (sua instância conectada)</Label>
                <Select value={senderInstanceId} onValueChange={setSenderInstanceId}>
                  <SelectTrigger className="h-9 text-sm bg-background/50">
                    <SelectValue placeholder={instances.length ? 'Selecione o número que envia' : 'Nenhum número conectado'} />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Se não escolher, o José usa o primeiro número conectado.</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Relatório diário resumido</p>
                  <p className="text-xs text-muted-foreground">Resultado do dia anterior (completo) + últimos 7 dias, com o custo do objetivo da campanha (conversa, lead ou compra)</p>
                </div>
                <Switch checked={sendDailyReport} onCheckedChange={setSendDailyReport} />
              </div>

              <Button variant="outline" size="sm" className="w-full gap-2"
                onClick={() => sendReportNow.mutate()}
                disabled={sendReportNow.isPending || waNumber.length < 10}>
                {sendReportNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                Enviar agora (teste)
              </Button>

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

// ── Persistência local (Fase 1) ─────────────────────────────────────────────────
// Cacheia a última sessão + estado da UI POR CONTA no localStorage, pra restaurar
// instantâneo ao sair e voltar pra tela — SEM refazer chamadas à API do Meta.
const APOLLO_CACHE_PREFIX = 'jose:apollo:v1:';
interface ApolloUICache { session: unknown; datePreset: string; activeTab: string; statusFilter?: string; topMetrics?: string[]; savedAt: number; }

// Catálogo de métricas do topo (nível conta). O usuário escolhe quais aparecem.
const ALL_TOP_METRICS = ['cost_per_result', 'results', 'spend', 'ctr', 'cpc', 'cpm', 'frequency', 'impressions', 'reach', 'clicks', 'roas', 'health', 'active'] as const;
// Padrão pensado pra concessionária/WhatsApp (sem ROAS, que fica 0): custo por
// conversa, conversas, gasto e CTR.
const DEFAULT_TOP_METRICS = ['cost_per_result', 'results', 'spend', 'ctr'];
function readApolloCache(accountId?: string): ApolloUICache | null {
  if (!accountId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(APOLLO_CACHE_PREFIX + accountId);
    return raw ? (JSON.parse(raw) as ApolloUICache) : null;
  } catch { return null; }
}
function writeApolloCache(accountId: string, data: ApolloUICache) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(APOLLO_CACHE_PREFIX + accountId, JSON.stringify(data)); } catch { /* quota/serialize */ }
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ApolloDashboard() {
  const { connectedAccount, connectedAccounts, selectConnectedAccount, isLoading: isLoadingAccount } = useMetaConnection();
  const { session, isAnalyzing, isLoadingSession, pendingActions, executedActions, analyze, loadSavedSession, hydrateSession, executeAction, getAdSets, getAds, dismissAction, testConnection } = useApolloAgent();
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const { data: history, isLoading: isLoadingHistory } = useApolloHistory(connectedAccount?.account_id);

  const [datePreset, setDatePreset] = useState<ApolloDatePreset>('last_30d');
  const [autoExecute, setAutoExecute] = useState(false);
  // Auto-Pilot do topo: PERSISTE no banco (config do cron, auto_execute) pra ficar
  // ligado depois de sair/voltar da página. Sincroniza com a aba Agendamento.
  const { config: cronCfg, saveConfig: saveCronCfg } = useApolloCronConfig();
  useEffect(() => { if (cronCfg) setAutoExecute(cronCfg.auto_execute ?? false); }, [cronCfg]);
  const handleAutoPilot = useCallback((v: boolean) => {
    setAutoExecute(v);
    if (cronCfg) saveCronCfg.mutate({
      is_enabled: cronCfg.is_enabled ?? false,
      run_hour: cronCfg.run_hour ?? 8,
      run_minute: cronCfg.run_minute ?? 0,
      auto_execute: v,
      send_whatsapp_on_critical: cronCfg.send_whatsapp_on_critical ?? true,
      send_daily_report: cronCfg.send_daily_report ?? true,
      whatsapp_report_number: cronCfg.whatsapp_report_number ?? null,
      report_sender_instance_id: cronCfg.report_sender_instance_id ?? null,
    });
  }, [cronCfg, saveCronCfg]);
  const [activeTab, setActiveTab] = useState('campaigns');
  const [adsetCache, setAdsetCache] = useState<Record<string, any[]>>({});
  const [loadingAdsets, setLoadingAdsets] = useState<Record<string, boolean>>({});
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null); // timestamp da última sincronização (Fase 1)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all'); // filtro de status (Fase 2)
  const [topMetrics, setTopMetrics] = useState<string[]>(DEFAULT_TOP_METRICS); // métricas escolhidas no topo
  const [metricsPickerOpen, setMetricsPickerOpen] = useState(false);
  const toggleTopMetric = useCallback((k: string) => {
    setTopMetrics(prev => prev.includes(k) ? (prev.length > 1 ? prev.filter(x => x !== k) : prev) : [...prev, k]);
  }, []);
  const [aiLogEntries, setAiLogEntries] = useState<AILogEntry[]>([]);
  const [aiLogOpen, setAiLogOpen] = useState(true);
  const prevIsAnalyzing = useRef(false);

  const accountId = connectedAccount?.account_id;

  // ── Restaura o estado no mount: cache LOCAL primeiro (instantâneo, ZERO chamada
  //    à Meta), senão a última sessão salva no BANCO. NUNCA dispara analyze. ──
  useEffect(() => {
    if (!sessionLoaded && !session && !isAnalyzing && accountId) {
      setSessionLoaded(true);
      const cached = readApolloCache(accountId);
      if (cached?.session) {
        hydrateSession(cached.session as any);
        if (cached.datePreset) setDatePreset(cached.datePreset as ApolloDatePreset);
        if (cached.activeTab) setActiveTab(cached.activeTab);
        if (cached.statusFilter) setStatusFilter(cached.statusFilter as 'all' | 'active' | 'paused');
        if (Array.isArray(cached.topMetrics) && cached.topMetrics.length) setTopMetrics(cached.topMetrics);
        if (cached.savedAt) setLastUpdatedAt(cached.savedAt);
      } else {
        loadSavedSession(accountId).then((saved: any) => {
          if (saved?.last_run_at) setLastUpdatedAt(new Date(saved.last_run_at).getTime());
        });
      }
    }
  }, [sessionLoaded, session, isAnalyzing, accountId, loadSavedSession, hydrateSession]);

  // ── Persiste sessão + estado da UI no localStorage (por conta) sempre que muda.
  //    Usa o lastUpdatedAt como carimbo — trocar de aba/período NÃO refaz a sync. ──
  useEffect(() => {
    if (accountId && session && lastUpdatedAt) {
      writeApolloCache(accountId, { session, datePreset, activeTab, statusFilter, topMetrics, savedAt: lastUpdatedAt });
    }
  }, [accountId, session, datePreset, activeTab, statusFilter, topMetrics, lastUpdatedAt]);
  // ── AI Log: populate when analysis starts ──
  useEffect(() => {
    if (isAnalyzing && !prevIsAnalyzing.current) {
      const now = new Date();
      const campaignCount = session?.campaigns?.length || 0;
      const initial: AILogEntry[] = [
        { id: 'start', type: 'analyzing', message: `Iniciando análise JOSÉ Governador — Nível 6...`, timestamp: new Date(now.getTime()) },
        { id: 'fetch', type: 'analyzing', message: `Conectando à Meta API e coletando dados de ${campaignCount || 'todas as'} campanhas...`, timestamp: new Date(now.getTime() + 500) },
        { id: 'dimensions', type: 'analyzing', message: 'Processando 8 dimensões: WoW · Fadiga Criativa · Pacing · Portfólio · Sazonalidade · Anomalias · Aprendizado · IA', timestamp: new Date(now.getTime() + 1200) },
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
      setLastUpdatedAt(Date.now()); // análise explícita completou → carimba a "última atualização"
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

  // ── Métricas agregadas da conta (nível topo), no período da sessão. Rótulos
  //    se adaptam ao objetivo dominante (conversa/lead/venda/resultado). ──
  const topMetricCatalog = useMemo(() => {
    const cs = (session?.campaigns || []) as any[];
    let spend = 0, impr = 0, clicks = 0, results = 0, reach = 0, freqW = 0, roasSum = 0, roasN = 0, healthSum = 0, active = 0;
    const objCount = { msg: 0, lead: 0, sale: 0, other: 0 };
    for (const c of cs) {
      spend += c.spend || 0; impr += c.impressions || 0; clicks += c.clicks || 0;
      results += (c.results ?? c.conversions ?? 0); reach += c.reach || 0;
      freqW += (c.frequency || 0) * (c.impressions || 0);
      if ((c.roas || 0) > 0) { roasSum += c.roas; roasN++; }
      healthSum += c.health_score || 0;
      if (c.effective_status === 'ACTIVE') active++;
      const o = String(c.objective || '').toUpperCase();
      if (o.includes('ENGAGEMENT') || o.includes('MESSAGE') || o.includes('CONVERSATION')) objCount.msg++;
      else if (o.includes('LEAD')) objCount.lead++;
      else if (o.includes('SALE') || o.includes('CONVERSION') || o.includes('PURCHASE')) objCount.sale++;
      else objCount.other++;
    }
    const n = cs.length || 1;
    const dominant = (['msg', 'lead', 'sale', 'other'] as const).reduce((a, b) => objCount[b] > objCount[a] ? b : a, 'other' as 'msg' | 'lead' | 'sale' | 'other');
    const resLabel = dominant === 'msg' ? 'Conversas iniciadas' : dominant === 'lead' ? 'Leads' : dominant === 'sale' ? 'Vendas' : 'Resultados';
    const costLabel = dominant === 'msg' ? 'Custo por Conversa' : dominant === 'lead' ? 'Custo por Lead' : dominant === 'sale' ? 'Custo por Venda' : 'Custo por Resultado';
    const money = (v: number) => `${currencySymbol} ${fmt(v)}`;
    const freq = impr > 0 ? freqW / impr : 0;
    const cat: Record<string, { label: string; value: string }> = {
      cost_per_result: { label: costLabel, value: results > 0 ? money(spend / results) : '—' },
      results: { label: resLabel, value: Math.round(results).toLocaleString('pt-BR') },
      spend: { label: 'Gasto total', value: money(spend) },
      ctr: { label: 'CTR médio', value: impr > 0 ? `${fmt((clicks / impr) * 100)}%` : '—' },
      cpc: { label: 'CPC médio', value: clicks > 0 ? money(spend / clicks) : '—' },
      cpm: { label: 'CPM médio', value: impr > 0 ? money((spend / impr) * 1000) : '—' },
      frequency: { label: 'Frequência média', value: fmt(freq) },
      impressions: { label: 'Impressões', value: Math.round(impr).toLocaleString('pt-BR') },
      reach: { label: 'Alcance', value: Math.round(reach).toLocaleString('pt-BR') },
      clicks: { label: 'Cliques', value: Math.round(clicks).toLocaleString('pt-BR') },
      roas: { label: 'ROAS médio', value: roasN ? `${fmt(roasSum / roasN)}x` : '—' },
      health: { label: 'Score médio', value: `${Math.round(healthSum / n)}/100` },
      active: { label: 'Campanhas ativas', value: String(active) },
    };
    return cat;
  }, [session, currencySymbol]);

  const handleAnalyze = useCallback(() => {
    analyze({ targetAccountId: accountId, datePreset, auto_execute: autoExecute });
  }, [analyze, accountId, datePreset, autoExecute]);

  // Trocar o período é uma AÇÃO do usuário: além de mudar o filtro, re-analisa
  // na hora (se já houver uma análise) pra os números baterem com o período
  // escolhido — senão os cards continuariam mostrando o período anterior, que é
  // justamente o que causava a impressão de "número errado" vs o Meta.
  const handlePeriodChange = useCallback((v: ApolloDatePreset) => {
    setDatePreset(v);
    if (session && accountId) {
      analyze({ targetAccountId: accountId, datePreset: v, auto_execute: false });
    }
  }, [session, accountId, analyze]);

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

  // Carrega criativos de um conjunto sob demanda, com cache por adset (sobrevive
  // a re-render). A própria AdSetRow já evita refetch enquanto montada.
  const adsCacheRef = useRef<Record<string, ApolloAd[]>>({});
  const handleLoadAds = useCallback(async (adsetId: string, objective: string): Promise<ApolloAd[]> => {
    if (adsCacheRef.current[adsetId]) return adsCacheRef.current[adsetId];
    const ads = await getAds.mutateAsync({ adsetId, targetAccountId: accountId, datePreset, objective });
    adsCacheRef.current[adsetId] = ads;
    return ads;
  }, [getAds, accountId, datePreset]);

  // Quando muda a conta ou o período, o cache de criativos fica obsoleto.
  useEffect(() => { adsCacheRef.current = {}; setAdsetCache({}); }, [accountId, datePreset]);

  const overallScore = session?.health_score ?? null;
  const overallHealthText = overallScore === null ? '' :
    overallScore >= 70 ? 'Suas campanhas estão saudáveis e gerando bons resultados!' :
    overallScore >= 45 ? 'Algumas campanhas precisam de atenção. Confira as recomendações do JOSÉ.' :
    'Atenção! Campanhas com problemas sérios detectados. Ação recomendada!';
  const snapshots = history?.snapshots || [];
  const outcomes = history?.outcomes || [];
  const clones = history?.clones || [];
  const showLegacyOverview = false;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* ── Header ── */}
        {showLegacyOverview && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" />
              JOSÉ
              <span className="text-base font-light text-muted-foreground tracking-wide">Governador</span>
              <Badge className="text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-semibold">Nível 6</Badge>
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Gestor de Tráfego Autônomo · WoW · Fadiga Criativa · Pacing · Portfólio · Sazonalidade · Aprendizado
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

            <Select value={datePreset} onValueChange={(v) => handlePeriodChange(v as ApolloDatePreset)}>
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
              <Switch id="auto-exec" checked={autoExecute} onCheckedChange={handleAutoPilot} className="scale-75" />
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
              Período dos números: <span className="font-semibold text-foreground">{DATE_PRESETS.find(p => p.value === (session.date_preset || datePreset))?.label || '—'}</span>
              {' · '}Última análise: {new Date(session.analyzed_at).toLocaleString('pt-BR')}
            </p>
          )}
        </div>

        {/* ── No account ── */}
        )}

        {!isLoadingAccount && accountId && !isLoadingSession && (
          <JoseBrandOverview
            session={session}
            pendingActions={pendingActions}
            currencySymbol={currencySymbol}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyze}
            onExecute={handleExecute}
            executingCampaignId={executeAction.variables?.campaign_id}
          />
        )}

        {!isLoadingAccount && !accountId && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-4">
              <AlertTriangle className="h-10 w-10 text-amber-400" />
              <div className="text-center space-y-1">
                <p className="font-semibold text-amber-400">Conta Meta Ads não conectada</p>
                <p className="text-xs text-muted-foreground max-w-sm">Para o JOSÉ analisar suas campanhas, conecte sua conta Meta Ads primeiro.</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => { window.location.href = '/connect-accounts'; }} className="gap-2 bg-amber-500 hover:bg-amber-600 text-black">
                  <Zap className="h-4 w-4" />
                  Conectar Meta Ads
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

        {/* ── Métricas principais (período da sessão, escolhidas pelo usuário) ── */}
        {showLegacyOverview && session && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <BarChart3 className="h-3.5 w-3.5" /> Métricas principais · {DATE_PRESETS.find(p => p.value === datePreset)?.label}
              </p>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setMetricsPickerOpen(v => !v)}>
                <Settings className="h-3 w-3" /> Escolher métricas
              </Button>
            </div>
            {metricsPickerOpen && (
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border/40 bg-background/30">
                {ALL_TOP_METRICS.map(k => {
                  const sel = topMetrics.includes(k);
                  return (
                    <button key={k} onClick={() => toggleTopMetric(k)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${sel ? 'bg-primary/15 border-primary/40 text-primary font-medium' : 'border-border/50 text-muted-foreground hover:border-border'}`}>
                      {topMetricCatalog[k]?.label || k}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {topMetrics.map(k => topMetricCatalog[k] && (
                <div key={k} className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
                  <p className="text-[11px] text-muted-foreground mb-1 truncate" title={topMetricCatalog[k].label}>{topMetricCatalog[k].label}</p>
                  <p className="text-2xl font-extrabold text-primary leading-none">{topMetricCatalog[k].value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Tendência WoW (recolhível, secundário — ROAS/semana a semana) ── */}
        {showLegacyOverview && snapshots.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                <Activity className="h-3.5 w-3.5" /> Tendências semana a semana ({snapshots.length} semanas)
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <TrendSummary snapshots={snapshots} currencySymbol={currencySymbol} />
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* ── After analysis: overview ── */}
        {showLegacyOverview && session && (
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

            {/* ── AI Log ── */}
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
                {isLoadingSession ? 'Carregando última análise...' : 'JOSÉ Governador analisando — 8 dimensões de inteligência'}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isLoadingSession ? 'Recuperando dados salvos' : 'Meta API · WoW · Fadiga Criativa · Pacing · Portfólio · Sazonalidade · IA'}
              </p>
            </div>
          </CardContent></Card>
        )}

        {showLegacyOverview && !session && !isAnalyzing && !isLoadingSession && accountId && (
          <Card className="border-dashed"><CardContent className="flex flex-col items-center py-14 gap-4">
            <Brain className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center"><p className="font-semibold text-muted-foreground">JOSÉ Governador — Pronto para Operar</p><p className="text-xs text-muted-foreground mt-1">Nível 6 · WoW · Fadiga Criativa · Pacing · Portfólio · Sazonalidade · Aprendizado</p></div>
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

        {/* ── Main tabs ── */}
        {showLegacyOverview && (session || snapshots.length > 0) && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex-wrap h-auto gap-1">
              {session && <TabsTrigger value="campaigns" className="gap-1 text-xs"><Radar className="h-3 w-3" />Campanhas <Badge variant="secondary" className="text-[10px] h-4 px-1">{session.campaigns.length}</Badge></TabsTrigger>}
              {session && <TabsTrigger value="actions" className="gap-1 text-xs"><Zap className="h-3 w-3" />Ações {pendingActions.length > 0 && <Badge className="text-[10px] h-4 px-1 bg-primary">{pendingActions.length}</Badge>}</TabsTrigger>}
              {session && <TabsTrigger value="analysis" className="gap-1 text-xs"><Brain className="h-3 w-3" />Análise IA</TabsTrigger>}
              {session && <TabsTrigger value="portfolio" className="gap-1 text-xs"><PieChart className="h-3 w-3" />Portfólio</TabsTrigger>}
              <TabsTrigger value="learning" className="gap-1 text-xs"><Activity className="h-3 w-3" />Aprendizado</TabsTrigger>
              <TabsTrigger value="history" className="gap-1 text-xs"><Clock className="h-3 w-3" />Histórico {executedActions.length > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1">{executedActions.length}</Badge>}</TabsTrigger>
              <TabsTrigger value="seasonal" className="gap-1 text-xs"><Sun className="h-3 w-3" />Sazonalidade</TabsTrigger>
              <TabsTrigger value="golden-rules" className="gap-1 text-xs"><Shield className="h-3 w-3" />Regras de Ouro</TabsTrigger>
              <TabsTrigger value="schedule" className="gap-1 text-xs"><Settings className="h-3 w-3" />Agendamento</TabsTrigger>
              <TabsTrigger value="governanca" className="gap-1 text-xs"><Gauge className="h-3 w-3" />Governança</TabsTrigger>
              <TabsTrigger value="julgamento" className="gap-1 text-xs"><Brain className="h-3 w-3" />Julgamento</TabsTrigger>
              <TabsTrigger value="criar" className="gap-1 text-xs"><Sparkles className="h-3 w-3" />Criar campanha</TabsTrigger>
            </TabsList>

            {/* Campaigns */}
            {session && (
              <TabsContent value="campaigns" className="mt-4">
                {(() => {
                  const all = session.campaigns;
                  const activeCount = all.filter((c: any) => c.effective_status === 'ACTIVE').length;
                  const pausedCount = all.length - activeCount;
                  const filtered = [...all]
                    .filter((c: any) => statusFilter === 'all' ? true : statusFilter === 'active' ? c.effective_status === 'ACTIVE' : c.effective_status !== 'ACTIVE')
                    .sort((a: any, b: any) => a.health_score - b.health_score);
                  return (
                    <>
                      {/* Filtro de status (Fase 2) */}
                      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        {(([['all', `Todas (${all.length})`], ['active', `Ativas (${activeCount})`], ['paused', `Pausadas (${pausedCount})`]]) as const).map(([val, label]) => (
                          <Button key={val} size="sm" variant={statusFilter === val ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setStatusFilter(val as 'all' | 'active' | 'paused')}>
                            {label}
                          </Button>
                        ))}
                      </div>
                      {filtered.length === 0
                        ? <Card><CardContent className="py-12 flex flex-col items-center gap-2"><AlertTriangle className="h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Nenhuma campanha {statusFilter === 'active' ? 'ativa' : statusFilter === 'paused' ? 'pausada' : ''} no período.</p></CardContent></Card>
                        : <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                            {filtered.map((c: any) => (
                              <CampaignCard
                                key={c.id} campaign={c} currencySymbol={currencySymbol}
                                accountId={accountId} datePreset={datePreset}
                                onDrillDown={() => handleDrillDown(c.id)}
                                adsets={adsetCache[c.id] || null}
                                isLoadingAdsets={!!loadingAdsets[c.id]}
                                statusFilter={statusFilter}
                                onLoadAds={handleLoadAds}
                              />
                            ))}
                          </div>
                      }
                    </>
                  );
                })()}
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
                        <p className="text-xs font-semibold mb-2 flex items-center gap-1"><Activity className="h-3 w-3" />Contexto Histórico — JOSÉ Governador</p>
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
                      <CardHeader><CardTitle className="text-base flex items-center gap-2"><PieChart className="h-4 w-4 text-primary" />Inteligência de Portfólio — JOSÉ Nível 6</CardTitle></CardHeader>
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
                    <p className="text-xs">Após 7 dias, o Apollo mede se as ações tomadas melhoraram as métricas.</p>
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
                                  <Badge variant="outline" className="text-[10px]">{log.executed_by === 'apollo_auto' ? '🤖 Auto-piloto' : '👤 Manual'}</Badge>
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

            {/* Governança (José v3.1 — Fase 0): aprovações, limites/kill-switch, permissões, custo, recursos */}
            <TabsContent value="governanca" className="mt-4">
              <JoseGovernanca />
            </TabsContent>

            {/* Julgamento (José v3.1 — Fase 1): veredito em pirâmide + base de inteligência por nicho */}
            <TabsContent value="julgamento" className="mt-4">
              <JoseJulgamento />
            </TabsContent>

            {/* Criar campanha (José v3.1 — Fase 4): rascunho gerado pelo José + simulação */}
            <TabsContent value="criar" className="mt-4">
              <JoseCriarCampanha />
            </TabsContent>
          </Tabs>
        )}

        {/* Auto-executed banner */}
        {session?.execution_log?.length > 0 && executedActions.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <Zap className="h-4 w-4 text-emerald-400 flex-shrink-0" />
            <p className="text-sm text-emerald-400">
              🤖 JOSÉ Governador executou <strong>{session.execution_log.length}</strong> ação(ões) no auto-piloto.
            </p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
