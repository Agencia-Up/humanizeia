import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Rocket,
  Lightbulb,
  Users,
  Target,
  Sparkles,
  RefreshCw,
  Settings,
  Link2Off,
  Pause,
  Play,
  DollarSign,
  AlertTriangle,
  Copy,
  Zap,
  BarChart3,
  Eye,
  MousePointerClick,
  FileText,
  ChevronLeft,
  Signal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useMetaApi } from '@/hooks/useMetaApi';
import { useGoogleAdsConnection } from '@/hooks/useGoogleAdsConnection';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { MidasActionList, type MidasAction } from '@/components/optimizer/MidasActionCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangeFilter } from '@/components/dashboard/DateRangeFilter';
import { type MetaDatePreset } from '@/hooks/useMetaDashboard';

// ── Helpers ──────────────────────────────────────────────

const statusLabel = (s: string) =>
  ({ ACTIVE: 'Ativo', PAUSED: 'Pausado', DELETED: 'Excluído', ARCHIVED: 'Arquivado' }[s] || s);

const statusVariant = (s: string) => {
  if (s === 'ACTIVE') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
  if (s === 'PAUSED') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-muted text-muted-foreground';
};

// fmtCurrency is defined dynamically inside the component using account currency
const fmtCurrencyStatic = (v: number, currency = 'BRL') => {
  const symbol = currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : currency;
  return `${symbol} ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtBudget = (cents: number | string | undefined, currency = 'BRL') => {
  if (!cents) return 'N/A';
  return fmtCurrencyStatic(Number(cents) / 100, currency);
};

const fmtNum = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : n.toLocaleString('pt-BR');

const healthColor = (metric: string, value: number): string => {
  if (metric === 'ctr') return value >= 1.5 ? 'text-emerald-400' : value >= 0.8 ? 'text-amber-400' : 'text-red-400';
  if (metric === 'cpc') return value <= 1.5 ? 'text-emerald-400' : value <= 3 ? 'text-amber-400' : 'text-red-400';
  if (metric === 'cpm') return value <= 15 ? 'text-emerald-400' : value <= 30 ? 'text-amber-400' : 'text-red-400';
  if (metric === 'frequency') return value <= 3 ? 'text-emerald-400' : value <= 5 ? 'text-amber-400' : 'text-red-400';
  return 'text-foreground';
};

const healthDotColor = (metric: string, value: number) => {
  if (metric === 'ctr') return value >= 1.5 ? 'bg-emerald-400' : value >= 0.8 ? 'bg-amber-400' : 'bg-red-400';
  if (metric === 'cpc') return value <= 1.5 ? 'bg-emerald-400' : value <= 3 ? 'bg-amber-400' : 'bg-red-400';
  if (metric === 'cpm') return value <= 15 ? 'bg-emerald-400' : value <= 30 ? 'bg-amber-400' : 'bg-red-400';
  if (metric === 'frequency') return value <= 3 ? 'bg-emerald-400' : value <= 5 ? 'bg-amber-400' : 'bg-red-400';
  return 'bg-muted-foreground';
};

// ── Types ────────────────────────────────────────────────

interface CampaignWithMetrics {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  score: number;
}

// ── Component ────────────────────────────────────────────

export default function CampaignOptimizer() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [diagnosticMd, setDiagnosticMd] = useState('');
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [opportunitiesMd, setOpportunitiesMd] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [audienceMd, setAudienceMd] = useState('');
  const [isAnalyzingAudience, setIsAnalyzingAudience] = useState(false);
  const [budgetEditId, setBudgetEditId] = useState<string | null>(null);
  const [budgetValue, setBudgetValue] = useState('');
  const [manualOppData, setManualOppData] = useState('');
  const [manualAudData, setManualAudData] = useState('');
  const [midasActions, setMidasActions] = useState<MidasAction[]>([]);
  const [dateRange, setDateRange] = useState<MetaDatePreset>('last_30d');

  // Connections
  const { connectedAccount: metaAccount, connectedAccounts: metaAccounts, selectConnectedAccount, isLoading: metaLoading } = useMetaConnection();
  const { connectedAccount: googleAccount, isLoading: googleLoading } = useGoogleAdsConnection();
  const { callMetaApi } = useMetaApi();
  const isMetaConnected = !!metaAccount;
  const isGoogleConnected = !!googleAccount;

  const accountId = metaAccount?.account_id;
  const accountCurrency = metaAccount?.currency || 'BRL';

  // Currency-aware formatter bound to selected account
  const fmtCurrency = useCallback(
    (v: number) => fmtCurrencyStatic(v, accountCurrency),
    [accountCurrency]
  );

  // Campaigns + insights — always pass accountId so edge function fetches the correct account
  const { campaigns, isLoading: campaignsLoading, error: campaignsError, refetch, updateCampaignStatus, updateCampaignBudget } =
    useMetaCampaigns({ accountId });

  const campaignInsights = useMetaInsights({
    accountId,
    datePreset: dateRange,
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency',
    enabled: isMetaConnected && !!accountId,
  });

  // Merge campaigns + metrics
  const enrichedCampaigns = useMemo<CampaignWithMetrics[]>(() => {
    const insightsArr: any[] = campaignInsights.data?.data || campaignInsights.data || [];
    const insightsMap = new Map<string, any>();
    insightsArr.forEach((r: any) => insightsMap.set(r.campaign_id, r));

    return campaigns.map((c: any) => {
      const m = insightsMap.get(c.id) || {};
      const ctr = Number(m.ctr || 0);
      const cpc = Number(m.cpc || 0);
      const score = ctr * 100 - cpc * 10;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status || c.status,
        objective: c.objective || '',
        daily_budget: c.daily_budget,
        lifetime_budget: c.lifetime_budget,
        start_time: c.start_time,
        spend: Number(m.spend || 0),
        impressions: Number(m.impressions || 0),
        clicks: Number(m.clicks || 0),
        ctr,
        cpc,
        cpm: Number(m.cpm || 0),
        reach: Number(m.reach || 0),
        frequency: Number(m.frequency || 0),
        score,
      };
    }).sort((a, b) => b.score - a.score);
  }, [campaigns, campaignInsights.data]);

  const selected = enrichedCampaigns.find((c) => c.id === selectedId) || null;

  // ── MIDAS Action Parsing ─────────────────────────────────
  const parseMidasActions = useCallback((text: string) => {
    if (!selected) return;
    const actions: MidasAction[] = [];
    
    // Parse structured actions from AI response
    // Look for action blocks: [ACTION:type:priority] reason | impact
    const actionRegex = /\[ACTION:(pause|activate|increase_budget|decrease_budget|notify):?(high|medium|low)?\]([^|]+)\|([^\n]+)/gi;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
      actions.push({
        id: `${selected.id}-${match[1]}-${Date.now()}-${actions.length}`,
        type: match[1] as MidasAction['type'],
        campaignId: selected.id,
        campaignName: selected.name,
        reason: match[3].trim(),
        impact: match[4].trim(),
        priority: (match[2] as MidasAction['priority']) || 'medium',
        percentage: match[1].includes('budget') ? 20 : undefined,
      });
    }

    // Fallback: detect action patterns from natural language
    if (actions.length === 0) {
      const patterns = [
        { regex: /pausar.*campanha|parar.*campanha|desativar/i, type: 'pause' as const, priority: 'high' as const },
        { regex: /ativar.*campanha|reativar|ligar/i, type: 'activate' as const, priority: 'medium' as const },
        { regex: /aumentar.*orçamento|escalar|investir mais|subir.*budget/i, type: 'increase_budget' as const, priority: 'medium' as const },
        { regex: /reduzir.*orçamento|diminuir.*budget|cortar.*gasto/i, type: 'decrease_budget' as const, priority: 'high' as const },
        { regex: /monitorar|acompanhar|observar/i, type: 'notify' as const, priority: 'low' as const },
      ];

      // Split into action items (look for numbered lists or bullet points)
      const lines = text.split('\n');
      for (const line of lines) {
        if (!/^\s*(\d+[\.\)]|\-|\*|•)/.test(line)) continue;
        for (const { regex, type, priority } of patterns) {
          if (regex.test(line)) {
            const cleanLine = line.replace(/^\s*(\d+[\.\)]|\-|\*|•)\s*\**/, '').replace(/\*+/g, '').trim();
            if (cleanLine.length > 10 && !actions.find(a => a.type === type)) {
              actions.push({
                id: `${selected.id}-${type}-${Date.now()}`,
                type,
                campaignId: selected.id,
                campaignName: selected.name,
                reason: cleanLine.slice(0, 150),
                impact: 'Melhoria estimada na performance geral',
                priority,
                percentage: type.includes('budget') ? 20 : undefined,
              });
            }
            break;
          }
        }
      }
    }

    setMidasActions(actions);
  }, [selected]);

  // ── Execute MIDAS Action via Meta API ──────────────────
  const executeMidasAction = useCallback(async (action: MidasAction) => {
    if (action.type === 'pause') {
      await callMetaApi({
        endpoint: action.campaignId,
        method: 'POST',
        body: { status: 'PAUSED' },
        targetAccountId: accountId,
      });
      toast({ title: '⏸️ Campanha pausada com sucesso!', description: action.campaignName });
    } else if (action.type === 'activate') {
      await callMetaApi({
        endpoint: action.campaignId,
        method: 'POST',
        body: { status: 'ACTIVE' },
        targetAccountId: accountId,
      });
      toast({ title: '▶️ Campanha ativada com sucesso!', description: action.campaignName });
    } else if (action.type === 'increase_budget') {
      const campaign = enrichedCampaigns.find(c => c.id === action.campaignId);
      if (campaign?.daily_budget) {
        const currentBudget = Number(campaign.daily_budget);
        const pct = action.percentage || 20;
        const newBudget = Math.round(currentBudget * (1 + pct / 100));
        await callMetaApi({
          endpoint: action.campaignId,
          method: 'POST',
          body: { daily_budget: newBudget },
          targetAccountId: accountId,
        });
        toast({ title: '📈 Orçamento aumentado!', description: `${fmtBudget(campaign.daily_budget, accountCurrency)} → ${fmtBudget(String(newBudget), accountCurrency)}` });
      }
    } else if (action.type === 'decrease_budget') {
      const campaign = enrichedCampaigns.find(c => c.id === action.campaignId);
      if (campaign?.daily_budget) {
        const currentBudget = Number(campaign.daily_budget);
        const pct = action.percentage || 20;
        const newBudget = Math.round(currentBudget * (1 - pct / 100));
        await callMetaApi({
          endpoint: action.campaignId,
          method: 'POST',
          body: { daily_budget: Math.max(newBudget, 100) },
          targetAccountId: accountId,
        });
        toast({ title: '📉 Orçamento reduzido!', description: `${fmtBudget(campaign.daily_budget, accountCurrency)} → ${fmtBudget(String(newBudget), accountCurrency)}` });
      }
    } else if (action.type === 'notify') {
      toast({ title: '🔔 Alerta registrado', description: `Monitorando: ${action.campaignName}` });
    }

    // Refresh campaign data after action
    refetch();
  }, [callMetaApi, enrichedCampaigns, toast, refetch, accountId, accountCurrency]);

  const diagDelta = useRef('');
  const { sendMessage: sendDiag } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { diagDelta.current += d; setDiagnosticMd(diagDelta.current); },
    onComplete: (fullResponse) => {
      setIsDiagnosing(false);
      // Parse MIDAS actions from response
      parseMidasActions(fullResponse);
    },
    onError: () => setIsDiagnosing(false),
  });

  const oppDelta = useRef('');
  const { sendMessage: sendOpp } = useClaudeChat({
    context: 'insights',
    onDelta: (d) => { oppDelta.current += d; setOpportunitiesMd(oppDelta.current); },
    onComplete: () => setIsDiscovering(false),
    onError: () => setIsDiscovering(false),
  });

  const audDelta = useRef('');
  const { sendMessage: sendAud } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => { audDelta.current += d; setAudienceMd(audDelta.current); },
    onComplete: () => setIsAnalyzingAudience(false),
    onError: () => setIsAnalyzingAudience(false),
  });

  // ── Handlers ───────────────────────────────────────────

  const handleDiagnose = useCallback(async () => {
    if (!selected) return;
    setIsDiagnosing(true);
    setMidasActions([]);
    diagDelta.current = '';
    setDiagnosticMd('');
    await sendDiag([{
      role: 'user',
      content: `Você é o MIDAS, analista sênior de tráfego pago. Analise esta campanha do Meta Ads e forneça um diagnóstico completo usando os benchmarks MIDAS (CTR saudável >= 1.5%, CPC saudável <= R$1.50, CPM saudável <= R$15, Frequência saudável <= 3).

Dados da campanha:
- Nome: ${selected.name}
- ID: ${selected.id}
- Status: ${selected.effective_status}
- Objetivo: ${selected.objective}
- Orçamento diário: ${fmtBudget(selected.daily_budget, accountCurrency)}

Métricas (período: ${dateRange === 'today' ? 'hoje' : dateRange === 'yesterday' ? 'ontem' : dateRange === 'last_7d' ? 'últimos 7 dias' : 'últimos 30 dias'}):
- Gasto: ${fmtCurrency(selected.spend)}
- Impressões: ${fmtNum(selected.impressions)}
- Cliques: ${selected.clicks}
- CTR: ${selected.ctr.toFixed(2)}%
- CPC: ${fmtCurrency(selected.cpc)}
- CPM: ${fmtCurrency(selected.cpm)}
- Alcance: ${fmtNum(selected.reach)}
- Frequência: ${selected.frequency.toFixed(2)}

Responda em Markdown com:
1. **Health Score** (0-100) e resumo de 1 linha
2. **Diagnóstico por área** (Criativo, Público, Orçamento, Entrega) com status 🟢🟡🔴 em formato de tabela markdown
3. **Top 3 Ações Prioritárias** — para cada ação, inclua uma tag no formato exato:
   [ACTION:tipo:prioridade] descrição da ação | impacto estimado
   Tipos válidos: pause, activate, increase_budget, decrease_budget, notify
   Prioridades: high, medium, low
   Exemplo: [ACTION:pause:high] CTR muito baixo e frequência alta indicam saturação | Economia estimada de R$200/dia
   Exemplo: [ACTION:increase_budget:medium] ROAS excelente, há espaço para escalar | +30% de conversões estimadas
4. **Previsão**: O que acontece se continuar assim vs implementar as ações

IMPORTANTE: Sempre inclua pelo menos 2 tags [ACTION:...] com ações específicas e executáveis.`
    }]);
  }, [selected, sendDiag]);

  const handleDiscoverOpportunities = useCallback(async () => {
    const hasAuto = enrichedCampaigns.length > 0;
    const hasManual = manualOppData.trim().length > 0;
    if (!hasAuto && !hasManual) return;

    setIsDiscovering(true);
    oppDelta.current = '';
    setOpportunitiesMd('');

    let dataBlock: string;
    if (hasAuto) {
      const summary = enrichedCampaigns.map((c) =>
        `${c.name} | Status: ${c.effective_status} | Gasto: ${fmtCurrency(c.spend)} | CTR: ${c.ctr.toFixed(2)}% | CPC: ${fmtCurrency(c.cpc)} | CPM: ${fmtCurrency(c.cpm)} | Alcance: ${fmtNum(c.reach)} | Freq: ${c.frequency.toFixed(2)} | Orç: ${fmtBudget(c.daily_budget, accountCurrency)}`
      ).join('\n');
      dataBlock = summary;
    } else {
      dataBlock = manualOppData.trim();
    }

    await sendOpp([{
      role: 'user',
      content: `Você é um estrategista de mídia paga sênior. Analise o portfólio completo de campanhas abaixo e identifique oportunidades de otimização.

CAMPANHAS:
${dataBlock}

Responda em Markdown com:
1. **🚀 Campanhas para Escalar** — quais têm melhor CTR/CPC e merecem mais investimento
2. **⏸️ Campanhas para Pausar** — quais estão desperdiçando orçamento
3. **💰 Redistribuição de Orçamento** — tabela markdown com sugestão de realocação
4. **🧪 Novos Testes Recomendados** — ideias de testes baseados nos dados
5. **📊 Resumo Executivo** — impacto estimado das mudanças em CPC e CTR geral`
    }]);
  }, [enrichedCampaigns, manualOppData, sendOpp]);

  const handleAnalyzeAudience = useCallback(async () => {
    const hasAuto = enrichedCampaigns.length > 0;
    const hasManual = manualAudData.trim().length > 0;
    if (!hasAuto && !hasManual) return;

    setIsAnalyzingAudience(true);
    audDelta.current = '';
    setAudienceMd('');

    let dataBlock: string;
    if (hasAuto) {
      const summary = enrichedCampaigns.map((c) =>
        `${c.name} | Alcance: ${fmtNum(c.reach)} | Freq: ${c.frequency.toFixed(2)} | CTR: ${c.ctr.toFixed(2)}% | Impressões: ${fmtNum(c.impressions)} | Gasto: ${fmtCurrency(c.spend)}`
      ).join('\n');
      dataBlock = summary;
    } else {
      dataBlock = manualAudData.trim();
    }

    await sendAud([{
      role: 'user',
      content: `Você é especialista em audiências e segmentação de Meta Ads. Analise os dados de alcance, frequência e performance das campanhas abaixo.

CAMPANHAS:
${dataBlock}

Responda em Markdown com:
1. **📊 Análise de Frequência** — quais campanhas estão com frequência alta (fadiga de audiência)
2. **🎯 Audiências Top** — quais campanhas indicam audiências de melhor performance
3. **🔄 Sugestões de Novos Públicos** — lookalikes, interesses ou exclusões recomendadas
4. **⚠️ Alertas de Saturação** — campanhas com sinais de saturação (alta freq + CTR em queda)
5. **📋 Plano de Ação** — próximos passos concretos para otimizar audiências`
    }]);
  }, [enrichedCampaigns, manualAudData, sendAud]);

  const handleToggleStatus = useCallback(
    (campaignId: string, currentStatus: string) => {
      const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      updateCampaignStatus.mutate({ campaignId, status: newStatus as any });
    },
    [updateCampaignStatus]
  );

  const handleSaveBudget = useCallback(
    (campaignId: string) => {
      const val = parseFloat(budgetValue);
      if (isNaN(val) || val <= 0) {
        toast({ title: 'Valor inválido', variant: 'destructive' });
        return;
      }
      updateCampaignBudget.mutate({ campaignId, dailyBudget: val });
      setBudgetEditId(null);
      setBudgetValue('');
    },
    [budgetValue, updateCampaignBudget, toast]
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!' });
  };

  const handleSelectCampaign = (id: string) => {
    setSelectedId(id);
    setShowDetail(true);
  };

  // Auto-analyze on campaign selection
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selected && selected.id !== prevSelectedRef.current && selected.spend > 0) {
      prevSelectedRef.current = selected.id;
      handleDiagnose();
    }
  }, [selected?.id]);

  const isDataLoading = campaignsLoading || campaignInsights.isLoading;

  const insightsError = campaignInsights.error as any;
  const campaignsErr = campaignsError as any;
  const isTokenExpired =
    insightsError?.message?.includes('TOKEN_EXPIRED') ||
    insightsError?.code === 'TOKEN_EXPIRED' ||
    (insightsError?.message && insightsError.message.includes('token expired')) ||
    insightsError?.message?.includes('NO_ACCOUNT') ||
    insightsError?.message?.includes('No active Meta ad account') ||
    campaignsErr?.message?.includes('TOKEN_EXPIRED') ||
    campaignsErr?.message?.includes('token expired') ||
    campaignsErr?.message?.includes('NO_ACCOUNT') ||
    campaignsErr?.message?.includes('No active Meta ad account') ||
    campaignsErr?.message?.includes('401');

  const hasNoData = enrichedCampaigns.length === 0;

  // ── Render ─────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl lg:text-3xl">Campaign Optimizer</h1>
            <p className="text-sm text-muted-foreground">
              Otimize suas campanhas com análises e recomendações de IA
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            {metaAccounts.length > 1 && (
              <Select
                value={metaAccount?.id || ''}
                onValueChange={(id) => selectConnectedAccount(id)}
              >
                <SelectTrigger className="h-8 min-w-[160px] max-w-[220px] text-xs">
                  <SelectValue placeholder="Selecionar conta" />
                </SelectTrigger>
                <SelectContent>
                  {metaAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate max-w-[130px]">{account.account_name}</span>
                        <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                          {account.currency || 'BRL'}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            <Button variant="outline" size="sm" onClick={() => { refetch(); campaignInsights.refresh(); }} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Connection Cards */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <ConnectionCard
            name="Meta Ads"
            isConnected={isMetaConnected}
            isLoading={metaLoading}
            accountName={metaAccount?.account_name}
            onConnect={() => navigate('/settings')}
          />
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="diagnostic" className="space-y-4 md:space-y-6">
          <TabsList className="bg-muted/50 w-full sm:w-auto flex">
            <TabsTrigger value="diagnostic" className="gap-1.5 flex-1 sm:flex-initial text-xs sm:text-sm">
              <Rocket className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden xs:inline">Diagnóstico</span>
              <span className="xs:hidden">Diag.</span>
            </TabsTrigger>
            <TabsTrigger value="opportunities" className="gap-1.5 flex-1 sm:flex-initial text-xs sm:text-sm">
              <Lightbulb className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Oportunidades</span>
              <span className="sm:hidden">Oport.</span>
            </TabsTrigger>
            <TabsTrigger value="audience" className="gap-1.5 flex-1 sm:flex-initial text-xs sm:text-sm">
              <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Audience Intelligence</span>
              <span className="sm:hidden">Audiência</span>
            </TabsTrigger>
          </TabsList>

          {/* ── TAB: Diagnóstico ── */}
          <TabsContent value="diagnostic" className="mt-0">
            {isTokenExpired ? (
              <TokenExpiredCard onReconnect={() => navigate('/settings')} />
            ) : !isMetaConnected && !metaLoading ? (
              <NotConnectedCard onConnect={() => navigate('/settings')} />
            ) : (
              <>
                {/* Mobile: show list or detail */}
                <div className="lg:hidden">
                  <AnimatePresence mode="wait">
                    {!showDetail || !selected ? (
                      <motion.div
                        key="list"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                      >
                        <CampaignList
                          campaigns={enrichedCampaigns}
                          selectedId={selectedId}
                          isLoading={isDataLoading}
                          onSelect={handleSelectCampaign}
                          currency={accountCurrency}
                        />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="detail"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mb-3 gap-1.5 text-muted-foreground"
                          onClick={() => setShowDetail(false)}
                        >
                          <ChevronLeft className="h-4 w-4" /> Voltar ao ranking
                        </Button>
                        <CampaignDetail
                          selected={selected}
                          diagnosticMd={diagnosticMd}
                          isDiagnosing={isDiagnosing}
                          budgetEditId={budgetEditId}
                          budgetValue={budgetValue}
                          midasActions={midasActions}
                          onExecuteAction={executeMidasAction}
                          onDiagnose={handleDiagnose}
                          onToggleStatus={handleToggleStatus}
                          onBudgetEdit={(id) => {
                            setBudgetEditId(id);
                            setBudgetValue(
                              selected.daily_budget
                                ? (Number(selected.daily_budget) / 100).toString()
                                : ''
                            );
                          }}
                          onBudgetSave={handleSaveBudget}
                          onBudgetCancel={() => setBudgetEditId(null)}
                          onBudgetChange={setBudgetValue}
                          onCopy={copyToClipboard}
                          isStatusPending={updateCampaignStatus.isPending}
                          currency={accountCurrency}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Desktop: side-by-side */}
                <div className="hidden lg:grid lg:grid-cols-5 lg:gap-4 xl:gap-6 overflow-hidden">
                  <div className="lg:col-span-2 min-w-0">
                    <CampaignList
                      campaigns={enrichedCampaigns}
                      selectedId={selectedId}
                      isLoading={isDataLoading}
                      onSelect={(id) => setSelectedId(id)}
                      currency={accountCurrency}
                    />
                  </div>
                  <div className="lg:col-span-3 min-w-0">
                    <CampaignDetail
                      selected={selected}
                      diagnosticMd={diagnosticMd}
                      isDiagnosing={isDiagnosing}
                      budgetEditId={budgetEditId}
                      budgetValue={budgetValue}
                      midasActions={midasActions}
                      onExecuteAction={executeMidasAction}
                      onDiagnose={handleDiagnose}
                      onToggleStatus={handleToggleStatus}
                      onBudgetEdit={(id) => {
                        if (!selected) return;
                        setBudgetEditId(id);
                        setBudgetValue(
                          selected.daily_budget
                            ? (Number(selected.daily_budget) / 100).toString()
                            : ''
                        );
                      }}
                      onBudgetSave={handleSaveBudget}
                      onBudgetCancel={() => setBudgetEditId(null)}
                      onBudgetChange={setBudgetValue}
                      onCopy={copyToClipboard}
                      isStatusPending={updateCampaignStatus.isPending}
                      currency={accountCurrency}
                    />
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ── TAB: Oportunidades ── */}
          <TabsContent value="opportunities" className="mt-0">
            {isTokenExpired && <TokenExpiredCard onReconnect={() => navigate('/settings')} />}
            {!isMetaConnected && !metaLoading && !isTokenExpired && (
              <NotConnectedCard onConnect={() => navigate('/settings')} />
            )}
            <AnalysisPanel
              icon={<Lightbulb className="h-5 w-5 text-amber-400" />}
              title="Oportunidades de Otimização"
              description={
                hasNoData
                  ? 'Cole seus dados de campanha abaixo para a IA analisar'
                  : `A IA analisa todas as ${enrichedCampaigns.length} campanhas e identifica oportunidades`
              }
              content={opportunitiesMd}
              isLoading={isDiscovering}
              loadingText="Analisando portfólio..."
              emptyIcon={<Lightbulb className="h-10 w-10 md:h-12 md:w-12" />}
              emptyText='Clique em "Descobrir Oportunidades" para a IA analisar seu portfólio completo e recomendar campanhas para escalar, pausar e redistribuir orçamento.'
              hasNoData={hasNoData}
              manualData={manualOppData}
              onManualDataChange={setManualOppData}
              manualPlaceholder="Cole aqui os dados das suas campanhas (nome, gasto, CTR, CPC, impressões, etc.)..."
              buttonLabel="Descobrir Oportunidades"
              buttonIcon={<Zap className="h-4 w-4" />}
              onAction={handleDiscoverOpportunities}
              onCopy={copyToClipboard}
            />
          </TabsContent>

          {/* ── TAB: Audience Intelligence ── */}
          <TabsContent value="audience" className="mt-0">
            {isTokenExpired && <TokenExpiredCard onReconnect={() => navigate('/settings')} />}
            {!isMetaConnected && !metaLoading && !isTokenExpired && (
              <NotConnectedCard onConnect={() => navigate('/settings')} />
            )}
            <AnalysisPanel
              icon={<Users className="h-5 w-5 text-primary" />}
              title="Audience Intelligence"
              description={
                hasNoData
                  ? 'Cole seus dados de campanha abaixo para análise de audiência'
                  : 'Análise de audiências, frequência e fadiga baseada em dados reais'
              }
              content={audienceMd}
              isLoading={isAnalyzingAudience}
              loadingText="Analisando audiências..."
              emptyIcon={<Users className="h-10 w-10 md:h-12 md:w-12" />}
              emptyText='Clique em "Analisar Audiências" para detectar fadiga, saturação e oportunidades de segmentação nas suas campanhas.'
              hasNoData={hasNoData}
              manualData={manualAudData}
              onManualDataChange={setManualAudData}
              manualPlaceholder="Cole aqui os dados das suas campanhas (alcance, frequência, CTR, impressões, etc.)..."
              buttonLabel="Analisar Audiências"
              buttonIcon={<Sparkles className="h-4 w-4" />}
              onAction={handleAnalyzeAudience}
              onCopy={copyToClipboard}
            />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// ── Sub-components ───────────────────────────────────────

function ConnectionCard({
  name,
  isConnected,
  isLoading,
  accountName,
  onConnect,
}: {
  name: string;
  isConnected: boolean;
  isLoading: boolean;
  accountName?: string;
  onConnect: () => void;
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border p-3 sm:p-4 transition-colors ${
      isConnected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border/50 bg-card/50'
    }`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg ${
          isConnected ? 'bg-emerald-500/20' : 'bg-muted'
        }`}>
          <Signal className={`h-4 w-4 sm:h-5 sm:w-5 ${isConnected ? 'text-emerald-400' : 'text-muted-foreground'}`} />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm sm:text-base">{name}</p>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {isLoading ? 'Verificando...' : isConnected ? accountName : 'Não conectado'}
          </p>
        </div>
      </div>
      {isConnected ? (
        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shrink-0">Ativo</Badge>
      ) : (
        <Button size="sm" variant="outline" onClick={onConnect} className="shrink-0 gap-1.5">
          <Settings className="h-3.5 w-3.5" /> Conectar
        </Button>
      )}
    </div>
  );
}

function CampaignList({
  campaigns,
  selectedId,
  isLoading,
  onSelect,
  currency = 'BRL',
}: {
  campaigns: CampaignWithMetrics[];
  selectedId: string | null;
  isLoading: boolean;
  onSelect: (id: string) => void;
  currency?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="border-b border-border/50 p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Ranking de Campanhas</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Ordenadas por performance (CTR/CPC)</p>
      </div>
      <ScrollArea className="h-[calc(100vh-420px)] min-h-[300px] max-h-[600px]">
        <div className="p-3 space-y-2">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          ) : campaigns.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma campanha encontrada
            </p>
          ) : (
            campaigns.map((c, idx) => {
              const st = c.effective_status || c.status;
              const isSelected = selectedId === c.id;
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  onClick={() => onSelect(c.id)}
                  className={`cursor-pointer rounded-lg border p-3 transition-all duration-200 ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm shadow-primary/10'
                      : 'border-border/30 hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm leading-tight line-clamp-2 flex-1 break-all">{c.name}</p>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0 mt-0.5">#{idx + 1}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-[10px] h-5">Meta</Badge>
                    <Badge className={`text-[10px] h-5 border ${statusVariant(st)}`}>{statusLabel(st)}</Badge>
                  </div>
                  {c.spend > 0 && (
                    <div className="mt-2.5 flex items-center gap-4 text-[11px]">
                      <div className="flex items-center gap-1">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${healthDotColor('ctr', c.ctr)}`} />
                        <span className="text-muted-foreground">CTR</span>
                        <span className={`font-semibold ${healthColor('ctr', c.ctr)}`}>{c.ctr.toFixed(2)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${healthDotColor('cpc', c.cpc)}`} />
                        <span className="text-muted-foreground">CPC</span>
                        <span className={`font-semibold ${healthColor('cpc', c.cpc)}`}>{fmtCurrencyStatic(c.cpc, currency)}</span>
                      </div>
                      <div className="ml-auto text-muted-foreground">
                        {fmtCurrencyStatic(c.spend, currency)}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function CampaignDetail({
  selected,
  diagnosticMd,
  isDiagnosing,
  budgetEditId,
  budgetValue,
  midasActions,
  onExecuteAction,
  onDiagnose,
  onToggleStatus,
  onBudgetEdit,
  onBudgetSave,
  onBudgetCancel,
  onBudgetChange,
  onCopy,
  isStatusPending,
  currency = 'BRL',
}: {
  selected: CampaignWithMetrics | null;
  diagnosticMd: string;
  isDiagnosing: boolean;
  budgetEditId: string | null;
  budgetValue: string;
  midasActions: MidasAction[];
  onExecuteAction: (action: MidasAction) => Promise<void>;
  onDiagnose: () => void;
  onToggleStatus: (id: string, status: string) => void;
  onBudgetEdit: (id: string) => void;
  onBudgetSave: (id: string) => void;
  onBudgetCancel: () => void;
  onBudgetChange: (val: string) => void;
  onCopy: (text: string) => void;
  isStatusPending: boolean;
  currency?: string;
}) {
  if (!selected) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
        <Target className="h-10 w-10" />
        <p className="text-sm">Selecione uma campanha para ver o diagnóstico</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Campaign Header */}
      <div className="border-b border-border/50 p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="font-semibold text-base sm:text-lg leading-tight line-clamp-2 flex-1 min-w-0 break-all">
            {selected.name}
          </h3>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onToggleStatus(selected.id, selected.effective_status)}
              disabled={isStatusPending}
              className="gap-1.5 h-8 text-xs"
            >
              {selected.effective_status === 'ACTIVE' ? (
                <><Pause className="h-3.5 w-3.5" /> Pausar</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Ativar</>
              )}
            </Button>
            {budgetEditId === selected.id ? (
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  value={budgetValue}
                  onChange={(e) => onBudgetChange(e.target.value)}
                  placeholder="R$ novo"
                  className="w-24 h-8 text-xs"
                />
                <Button size="sm" className="h-8 text-xs" onClick={() => onBudgetSave(selected.id)}>OK</Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onBudgetCancel}>✕</Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onBudgetEdit(selected.id)}
                className="gap-1.5 h-8 text-xs"
              >
                <DollarSign className="h-3.5 w-3.5" /> Orçamento
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="h-[calc(100vh-420px)] min-h-[300px] max-h-[600px] overflow-y-auto overflow-x-hidden">
        <div className="p-4 space-y-5 w-full max-w-full">
          {/* No activity warning */}
          {selected.spend === 0 && selected.impressions === 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Sem dados no período selecionado. Tente um intervalo maior (ex: 30 dias) ou verifique se a campanha teve veiculação ativa.</span>
            </div>
          )}
          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            <MetricCard label="Gasto" value={fmtCurrencyStatic(selected.spend, currency)} icon={<DollarSign className="h-3.5 w-3.5" />} />
            <MetricCard label="Impressões" value={fmtNum(selected.impressions)} icon={<Eye className="h-3.5 w-3.5" />} />
            <MetricCard label="Cliques" value={fmtNum(selected.clicks)} icon={<MousePointerClick className="h-3.5 w-3.5" />} />
            <MetricCard label="Alcance" value={fmtNum(selected.reach)} icon={<Users className="h-3.5 w-3.5" />} />
            <MetricCard
              label="CPC"
              value={fmtCurrencyStatic(selected.cpc, currency)}
              dotColor={healthDotColor('cpc', selected.cpc)}
              valueColor={healthColor('cpc', selected.cpc)}
            />
            <MetricCard
              label="CPM"
              value={fmtCurrencyStatic(selected.cpm, currency)}
              dotColor={healthDotColor('cpm', selected.cpm)}
              valueColor={healthColor('cpm', selected.cpm)}
            />
            <MetricCard
              label="CTR"
              value={`${selected.ctr.toFixed(2)}%`}
              dotColor={healthDotColor('ctr', selected.ctr)}
              valueColor={healthColor('ctr', selected.ctr)}
            />
            <MetricCard
              label="Frequência"
              value={selected.frequency.toFixed(2)}
              dotColor={healthDotColor('frequency', selected.frequency)}
              valueColor={healthColor('frequency', selected.frequency)}
            />
          </div>

          {/* AI Analysis */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Diagnóstico IA
              </h4>
              <div className="flex gap-1.5">
                {diagnosticMd && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCopy(diagnosticMd)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={onDiagnose}
                  disabled={isDiagnosing}
                  className="gap-1.5 h-7 text-xs"
                >
                  {isDiagnosing ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {isDiagnosing ? 'Analisando...' : 'Reanalisar'}
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {(diagnosticMd || isDiagnosing) && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-lg border border-primary/20 bg-primary/5 p-4 overflow-x-auto [overflow-wrap:anywhere]"
                >
                  {isDiagnosing && !diagnosticMd && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      A IA está analisando a campanha...
                    </div>
                  )}
                  {diagnosticMd && <MarkdownRenderer content={diagnosticMd} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* MIDAS Action Cards */}
          {midasActions.length > 0 && (
            <MidasActionList actions={midasActions} onExecute={onExecuteAction} />
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  dotColor,
  valueColor,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  dotColor?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {dotColor ? <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} /> : icon}
        {label}
      </div>
      <p className={`mt-1 font-semibold text-sm ${valueColor || ''}`}>{value}</p>
    </div>
  );
}

function AnalysisPanel({
  icon,
  title,
  description,
  content,
  isLoading,
  loadingText,
  emptyIcon,
  emptyText,
  hasNoData,
  manualData,
  onManualDataChange,
  manualPlaceholder,
  buttonLabel,
  buttonIcon,
  onAction,
  onCopy,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  content: string;
  isLoading: boolean;
  loadingText: string;
  emptyIcon: React.ReactNode;
  emptyText: string;
  hasNoData: boolean;
  manualData: string;
  onManualDataChange: (val: string) => void;
  manualPlaceholder: string;
  buttonLabel: string;
  buttonIcon: React.ReactNode;
  onAction: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/50 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold flex items-center gap-2 text-base">
            {icon} {title}
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {content && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onCopy(content)}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={onAction}
            disabled={isLoading || (hasNoData && !manualData.trim())}
            className="gap-2 h-8 text-xs sm:text-sm sm:h-9"
          >
            {isLoading ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> Analisando...</>
            ) : (
              <>{buttonIcon} {buttonLabel}</>
            )}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-h-[60vh] overflow-y-auto overflow-x-hidden">
        {hasNoData && !content && !isLoading && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>Sem dados automáticos. Cole seus dados de campanha para análise manual:</span>
            </div>
            <Textarea
              placeholder={manualPlaceholder}
              value={manualData}
              onChange={(e) => onManualDataChange(e.target.value)}
              rows={6}
              className="resize-y"
            />
          </div>
        )}
        {!hasNoData && !content && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 md:py-16 gap-4 text-muted-foreground">
            {emptyIcon}
            <p className="text-center text-sm max-w-md">{emptyText}</p>
          </div>
        )}
        {(content || isLoading) && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {isLoading && !content && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {loadingText}
              </div>
            )}
            {content && <MarkdownRenderer content={content} />}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function NotConnectedCard({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col items-center justify-center gap-4 py-12 md:py-16 px-4">
      <Link2Off className="h-10 w-10 md:h-12 md:w-12 text-muted-foreground" />
      <h3 className="font-semibold text-base md:text-lg">Nenhuma plataforma conectada</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        Conecte sua conta Meta Ads nas configurações para visualizar e otimizar suas campanhas.
      </p>
      <Button onClick={onConnect} className="gap-2">
        <Settings className="h-4 w-4" /> Ir para Configurações
      </Button>
    </div>
  );
}

function TokenExpiredCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 backdrop-blur-sm flex flex-col items-center justify-center gap-4 py-12 md:py-16 px-4">
      <AlertTriangle className="h-10 w-10 md:h-12 md:w-12 text-amber-400" />
      <h3 className="font-semibold text-base md:text-lg">Token do Meta expirou</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        Seu token de acesso ao Meta Ads expirou. Reconecte sua conta nas configurações para continuar.
      </p>
      <Button onClick={onReconnect} className="gap-2">
        <Settings className="h-4 w-4" /> Reconectar
      </Button>
    </div>
  );
}
