import { useState, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2, Plus, Pause, Trash2, Copy, Edit, Clock, Zap,
  Play, Sparkles, Brain, AlertCircle, X, Loader2, Eye, EyeOff,
  TrendingUp, TrendingDown, Shield, Activity, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, FileText, History, ListChecks, Filter,
} from 'lucide-react';

/* ─── types ─── */
interface Condition {
  metric: string;
  operator: string;
  value: number;
  period: string;
}

interface RuleFormData {
  name: string;
  description: string;
  conditions: Condition[];
  conditionLogic: 'AND' | 'OR';
  actionType: string;
  actionConfig: { percentage?: number };
  applyToCampaigns: string[];
  checkFrequency: string;
  notifyOnTrigger: boolean;
  simulationMode: boolean;
}

interface EvaluationResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  simulationMode: boolean;
  conditionResults: { condition: Condition; met: boolean; currentValue: number | null }[];
  actionType: string;
  actionConfig: any;
  campaignsAffected: string[];
  timestamp: Date;
}

const EMPTY_FORM: RuleFormData = {
  name: '',
  description: '',
  conditions: [{ metric: 'cpa', operator: '>', value: 0, period: '7d' }],
  conditionLogic: 'AND',
  actionType: 'pause',
  actionConfig: {},
  applyToCampaigns: [],
  checkFrequency: '1h',
  notifyOnTrigger: true,
  simulationMode: false,
};

const METRICS = [
  { value: 'cpa', label: 'CPA (Custo por Resultado)', friendly: 'custo por resultado', unit: 'R$' },
  { value: 'ctr', label: 'CTR (%)', friendly: 'taxa de cliques', unit: '%' },
  { value: 'roas', label: 'ROAS', friendly: 'retorno sobre investimento', unit: 'x' },
  { value: 'cpc', label: 'CPC', friendly: 'custo por clique', unit: 'R$' },
  { value: 'cpm', label: 'CPM', friendly: 'custo por mil impressões', unit: 'R$' },
  { value: 'spend', label: 'Gasto (R$)', friendly: 'gasto', unit: 'R$' },
  { value: 'impressions', label: 'Impressões', friendly: 'impressões', unit: '' },
  { value: 'clicks', label: 'Cliques', friendly: 'cliques', unit: '' },
  { value: 'conversions', label: 'Conversões', friendly: 'conversões', unit: '' },
  { value: 'frequency', label: 'Frequência', friendly: 'frequência', unit: '' },
  { value: 'reach', label: 'Alcance', friendly: 'alcance', unit: '' },
];

const OPERATORS = [
  { value: '>', label: 'maior que', symbol: '>' },
  { value: '<', label: 'menor que', symbol: '<' },
  { value: '>=', label: 'maior ou igual a', symbol: '≥' },
  { value: '<=', label: 'menor ou igual a', symbol: '≤' },
  { value: '=', label: 'igual a', symbol: '=' },
];

const ACTION_TYPES = [
  { value: 'pause', label: '⏸️ Pausar campanha', friendly: 'pausar a campanha' },
  { value: 'activate', label: '▶️ Ativar campanha', friendly: 'ativar a campanha' },
  { value: 'increase_budget', label: '📈 Aumentar orçamento', friendly: 'aumentar o orçamento' },
  { value: 'decrease_budget', label: '📉 Diminuir orçamento', friendly: 'diminuir o orçamento' },
  { value: 'notify', label: '🔔 Apenas notificar', friendly: 'enviar notificação' },
];

const FREQUENCIES = [
  { value: '1h', label: 'A cada 1 hora' },
  { value: '6h', label: 'A cada 6 horas' },
  { value: '12h', label: 'A cada 12 horas' },
  { value: '24h', label: 'Diariamente' },
];

const PERIODS = [
  { value: '24h', label: 'Últimas 24h' },
  { value: '3d', label: 'Últimos 3 dias' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '14d', label: 'Últimos 14 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

const ruleTemplates = [
  {
    name: '⏸️ Pausar quando CPA > 2x meta',
    description: 'Quando o custo por venda passar de R$50, pausar a campanha',
    icon: Pause,
    form: { ...EMPTY_FORM, name: 'Pausar CPA alto', description: 'Pausa campanhas com custo por resultado acima de R$50', conditions: [{ metric: 'cpa', operator: '>', value: 50, period: '3d' }], actionType: 'pause' },
  },
  {
    name: '🚀 Escalar quando ROAS > 3',
    description: 'Aumentar orçamento em 20% quando o retorno for bom',
    icon: TrendingUp,
    form: { ...EMPTY_FORM, name: 'Escalar ROAS alto', description: 'Aumenta orçamento quando ROAS está acima de 3x', conditions: [{ metric: 'roas', operator: '>', value: 3, period: '7d' }], actionType: 'increase_budget', actionConfig: { percentage: 20 } },
  },
  {
    name: '🛡️ Proteger aprendizado',
    description: 'Não alterar campanhas com menos de 50 conversões',
    icon: Shield,
    form: { ...EMPTY_FORM, name: 'Proteger fase de aprendizado', description: 'Notifica quando campanha tem poucas conversões para não interferir', conditions: [{ metric: 'conversions', operator: '<', value: 50, period: '7d' }], actionType: 'notify' },
  },
  {
    name: '⚠️ Controle de frequência',
    description: 'Pausar se frequência passar de 3 (saturação de audiência)',
    icon: Activity,
    form: { ...EMPTY_FORM, name: 'Controle de frequência', description: 'Pausa campanhas saturadas com frequência alta', conditions: [{ metric: 'frequency', operator: '>', value: 3, period: '7d' }], actionType: 'pause' },
  },
  {
    name: '📉 Cortar gastos altos',
    description: 'Diminuir orçamento em 30% quando CPC estiver alto',
    icon: TrendingDown,
    form: { ...EMPTY_FORM, name: 'Cortar CPC alto', description: 'Reduz orçamento de campanhas com custo por clique elevado', conditions: [{ metric: 'cpc', operator: '>', value: 5, period: '3d' }], actionType: 'decrease_budget', actionConfig: { percentage: 30 } },
  },
  {
    name: '🔔 Alerta de CTR baixo',
    description: 'Notificar quando CTR cair abaixo de 1%',
    icon: AlertCircle,
    form: { ...EMPTY_FORM, name: 'Alerta CTR baixo', description: 'Envia notificação quando taxa de cliques está muito baixa', conditions: [{ metric: 'ctr', operator: '<', value: 1, period: '3d' }], actionType: 'notify' },
  },
];

/* ─── friendly rule description ─── */
function buildFriendlyDescription(conditions: Condition[], conditionLogic: string, actionType: string, actionConfig: any): string {
  const metricMap = Object.fromEntries(METRICS.map((m) => [m.value, m.friendly]));
  const operatorMap: Record<string, string> = { '>': 'passar de', '<': 'ficar abaixo de', '>=': 'atingir', '<=': 'ficar em até', '=': 'for igual a' };
  const actionMap = Object.fromEntries(ACTION_TYPES.map((a) => [a.value, a.friendly]));
  const periodMap: Record<string, string> = { '24h': 'nas últimas 24h', '3d': 'nos últimos 3 dias', '7d': 'nos últimos 7 dias', '14d': 'nos últimos 14 dias', '30d': 'nos últimos 30 dias' };

  const condParts = conditions.map((c) => {
    const metric = metricMap[c.metric] || c.metric;
    const op = operatorMap[c.operator] || c.operator;
    const period = periodMap[c.period] || '';
    const prefix = c.metric === 'spend' || c.metric === 'cpa' || c.metric === 'cpc' || c.metric === 'cpm' ? 'R$' : '';
    const suffix = c.metric === 'ctr' ? '%' : c.metric === 'roas' ? 'x' : '';
    return `${metric} ${op} ${prefix}${c.value}${suffix}${period ? ' ' + period : ''}`;
  });

  const connector = conditionLogic === 'OR' ? ' ou ' : ' e ';
  let action = actionMap[actionType] || actionType;
  if ((actionType === 'increase_budget' || actionType === 'decrease_budget') && actionConfig?.percentage) {
    action += ` em ${actionConfig.percentage}%`;
  }

  return `Quando ${condParts.join(connector)}, ${action}`;
}

/* ─── condition evaluator ─── */
function evaluateCondition(operator: string, currentValue: number, targetValue: number): boolean {
  switch (operator) {
    case '>': return currentValue > targetValue;
    case '<': return currentValue < targetValue;
    case '>=': return currentValue >= targetValue;
    case '<=': return currentValue <= targetValue;
    case '=': return Math.abs(currentValue - targetValue) < 0.01;
    default: return false;
  }
}

function extractMetricFromCampaign(campaign: any, metric: string): number | null {
  const val = Number(campaign[metric]);
  return isNaN(val) ? null : val;
}

export default function AutomatedRules() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { connectedAccount } = useMetaConnection();
  const { campaigns } = useMetaCampaigns();

  /* ─── state ─── */
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [manualData, setManualData] = useState('');
  const [evaluationResults, setEvaluationResults] = useState<EvaluationResult[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'success' | 'error' | 'simulation'>('all');
  const [activeTab, setActiveTab] = useState('rules');
  const [viewMode, setViewMode] = useState<'simplified' | 'expert'>('simplified');

  /* ─── AI hooks ─── */
  const { sendSingleMessage: sendSuggestion, isLoading: isSuggesting } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => setAiSuggestion((p) => p + d),
  });

  /* ─── queries ─── */
  const { data: rules, isLoading: isLoadingRules } = useQuery({
    queryKey: ['automation-rules', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('automation_rules').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: logs, isLoading: isLoadingLogs } = useQuery({
    queryKey: ['rule-execution-logs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('rule_execution_log').select('*, automation_rules(name)').order('triggered_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const campaignInsights = useMetaInsights({
    accountId: connectedAccount?.account_id,
    level: 'campaign',
    fields: 'campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency',
    enabled: !!connectedAccount,
  });

  /* ─── mutations ─── */
  const toggleRule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('automation_rules').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation-rules'] }),
  });

  const createRule = useMutation({
    mutationFn: async (data: RuleFormData) => {
      const { error } = await supabase.from('automation_rules').insert({
        user_id: user!.id,
        name: data.name,
        description: data.description || buildFriendlyDescription(data.conditions, data.conditionLogic, data.actionType, data.actionConfig),
        conditions: data.conditions as any,
        condition_logic: data.conditionLogic,
        action_type: data.actionType as any,
        action_config: { ...data.actionConfig, simulationMode: data.simulationMode } as any,
        apply_to_campaigns: data.applyToCampaigns.length ? data.applyToCampaigns : null,
        check_frequency: data.checkFrequency,
        notify_on_trigger: data.notifyOnTrigger,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      toast({ title: '✅ Regra criada com sucesso!' });
      closeDialog();
    },
    onError: (e: any) => toast({ title: 'Erro ao criar regra', description: e.message, variant: 'destructive' }),
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: RuleFormData }) => {
      const { error } = await supabase.from('automation_rules').update({
        name: data.name,
        description: data.description || buildFriendlyDescription(data.conditions, data.conditionLogic, data.actionType, data.actionConfig),
        conditions: data.conditions as any,
        condition_logic: data.conditionLogic,
        action_type: data.actionType as any,
        action_config: { ...data.actionConfig, simulationMode: data.simulationMode } as any,
        apply_to_campaigns: data.applyToCampaigns.length ? data.applyToCampaigns : null,
        check_frequency: data.checkFrequency,
        notify_on_trigger: data.notifyOnTrigger,
      }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      toast({ title: '✅ Regra atualizada!' });
      closeDialog();
    },
    onError: (e: any) => toast({ title: 'Erro ao atualizar', description: e.message, variant: 'destructive' }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('automation_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      toast({ title: 'Regra excluída.' });
      setDeleteConfirmId(null);
    },
  });

  const duplicateRule = useMutation({
    mutationFn: async (rule: any) => {
      const { error } = await supabase.from('automation_rules').insert({
        user_id: user!.id,
        name: `${rule.name} (cópia)`,
        description: rule.description,
        conditions: rule.conditions,
        condition_logic: rule.condition_logic,
        action_type: rule.action_type,
        action_config: rule.action_config,
        apply_to_campaigns: rule.apply_to_campaigns,
        check_frequency: rule.check_frequency,
        notify_on_trigger: rule.notify_on_trigger,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
      toast({ title: '✅ Regra duplicada!' });
    },
  });

  /* ─── helpers ─── */
  const closeDialog = () => {
    setIsCreateOpen(false);
    setEditingRule(null);
    setFormData(EMPTY_FORM);
  };

  const openCreate = (template?: RuleFormData) => {
    setFormData(template ? { ...template } : EMPTY_FORM);
    setEditingRule(null);
    setIsCreateOpen(true);
  };

  const openEdit = (rule: any) => {
    const conditions = Array.isArray(rule.conditions) ? rule.conditions.map((c: any) => ({ ...c, period: c.period || '7d' })) : [];
    setFormData({
      name: rule.name,
      description: rule.description || '',
      conditions: conditions.length ? conditions : [{ metric: 'cpa', operator: '>', value: 0, period: '7d' }],
      conditionLogic: rule.condition_logic || 'AND',
      actionType: rule.action_type,
      actionConfig: rule.action_config || {},
      applyToCampaigns: rule.apply_to_campaigns || [],
      checkFrequency: rule.check_frequency || '1h',
      notifyOnTrigger: rule.notify_on_trigger ?? true,
      simulationMode: rule.action_config?.simulationMode ?? false,
    });
    setEditingRule(rule);
    setIsCreateOpen(true);
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    if (editingRule) {
      updateRule.mutate({ id: editingRule.id, data: formData });
    } else {
      createRule.mutate(formData);
    }
  };

  const addCondition = () => {
    setFormData((p) => ({ ...p, conditions: [...p.conditions, { metric: 'cpa', operator: '>', value: 0, period: '7d' }] }));
  };

  const removeCondition = (idx: number) => {
    setFormData((p) => ({ ...p, conditions: p.conditions.filter((_, i) => i !== idx) }));
  };

  const updateCondition = (idx: number, field: keyof Condition, value: any) => {
    setFormData((p) => {
      const updated = [...p.conditions];
      updated[idx] = { ...updated[idx], [field]: field === 'value' ? Number(value) : value };
      return { ...p, conditions: updated };
    });
  };

  /* ─── Rule evaluation engine ─── */
  const evaluateRules = useCallback(async () => {
    const activeRules = rules?.filter((r: any) => r.is_active) || [];
    if (!activeRules.length) {
      toast({ title: 'Nenhuma regra ativa para avaliar', variant: 'destructive' });
      return;
    }

    const campaignData = campaignInsights.data?.data || [];
    if (!campaignData.length && !manualData.trim()) {
      toast({ title: 'Sem dados de campanhas disponíveis', description: 'Conecte Meta Ads ou insira dados manualmente.', variant: 'destructive' });
      return;
    }

    setIsEvaluating(true);
    const results: EvaluationResult[] = [];

    for (const rule of activeRules) {
      const rawConditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      const conditions: Condition[] = rawConditions.map((c: any) => ({ metric: c.metric, operator: c.operator, value: c.value, period: c.period }));
      const logic = rule.condition_logic || 'AND';
      const actionConfig = rule.action_config as Record<string, any> | null;
      const isSimulation = actionConfig?.simulationMode === true;
      const affectedCampaigns: string[] = [];

      // Evaluate against each campaign
      for (const campaign of campaignData) {
        const conditionResults = conditions.map((cond) => {
          const currentValue = extractMetricFromCampaign(campaign, cond.metric);
          const met = currentValue !== null ? evaluateCondition(cond.operator, currentValue, cond.value) : false;
          return { condition: cond, met, currentValue };
        });

        const allMet = logic === 'AND'
          ? conditionResults.every((r) => r.met)
          : conditionResults.some((r) => r.met);

        if (allMet) {
          affectedCampaigns.push(campaign.campaign_name || campaign.campaign_id);
        }
      }

      const triggered = affectedCampaigns.length > 0;

      const conditionResults = conditions.map((cond) => {
        // Aggregate: use average across campaigns
        const values = campaignData.map((c: any) => extractMetricFromCampaign(c, cond.metric)).filter((v: any): v is number => v !== null);
        const avgValue = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : null;
        const met = avgValue !== null ? evaluateCondition(cond.operator, avgValue, cond.value) : false;
        return { condition: cond, met, currentValue: avgValue };
      });

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        triggered,
        simulationMode: isSimulation,
        conditionResults,
        actionType: rule.action_type,
        actionConfig: rule.action_config,
        campaignsAffected: affectedCampaigns,
        timestamp: new Date(),
      });

      // Log execution if triggered and NOT simulation
      if (triggered) {
        const actionLabel = ACTION_TYPES.find((a) => a.value === rule.action_type)?.friendly || rule.action_type;
        const logEntry = {
          rule_id: rule.id,
          action_taken: isSimulation
            ? `[SIMULAÇÃO] Sugestão: ${actionLabel} para ${affectedCampaigns.length} campanha(s)`
            : `${actionLabel} em ${affectedCampaigns.length} campanha(s)`,
          conditions_met: conditionResults.map((r) => ({
            metric: r.condition.metric,
            operator: r.condition.operator,
            target: r.condition.value,
            actual: r.currentValue,
            met: r.met,
          })),
          success: true,
          metrics_snapshot: { campaigns: affectedCampaigns, evaluatedAt: new Date().toISOString() },
          action_result: isSimulation ? 'simulation_only' : 'pending_execution',
        };

        await supabase.from('rule_execution_log').insert(logEntry);

        // Update rule trigger count
        await supabase.from('automation_rules').update({
          trigger_count: (rule.trigger_count || 0) + 1,
          last_triggered_at: new Date().toISOString(),
        }).eq('id', rule.id);

        // Toast notification
        if (rule.notify_on_trigger) {
          toast({
            title: isSimulation ? `🔍 Sugestão: ${rule.name}` : `⚡ Regra disparada: ${rule.name}`,
            description: `${affectedCampaigns.length} campanha(s) afetada(s)`,
            variant: isSimulation ? 'default' : 'destructive',
          });
        }
      }
    }

    setEvaluationResults(results);
    queryClient.invalidateQueries({ queryKey: ['rule-execution-logs'] });
    queryClient.invalidateQueries({ queryKey: ['automation-rules'] });
    setIsEvaluating(false);
    setActiveTab('results');
  }, [rules, campaignInsights.data, manualData, toast, queryClient]);

  /* ─── AI Suggest ─── */
  const handleSuggestRules = async () => {
    const metricsData = manualData.trim() || JSON.stringify({
      campanhas: campaignInsights.data?.data?.slice(0, 20) || [],
    });

    setAiSuggestion('');
    await sendSuggestion(
      `Você é um especialista em automação de campanhas Meta Ads.

Analise as métricas atuais e sugira 3-5 regras automáticas inteligentes:

## Métricas Atuais:
${metricsData}

Para cada sugestão, forneça:
- **Nome da regra** (em linguagem simples)
- **Quando** (descreva a condição de forma humana, ex: "Quando o custo por venda passar de R$50")
- **Então** (ação, ex: "pausar a campanha")
- **Por quê** (justificativa baseada nos dados)
- **Modo sugerido**: Sugerir ou Executar

Formate em Markdown com emojis e bullet points. Use linguagem simples e acessível.`
    );
  };

  const hasConnection = !!connectedAccount;

  const getRuleFriendlyText = (rule: any) => {
    const conditions = Array.isArray(rule.conditions) ? rule.conditions.map((c: any) => ({ ...c, period: c.period || '7d' })) : [];
    if (!conditions.length) return rule.description || '';
    return buildFriendlyDescription(conditions, rule.condition_logic || 'AND', rule.action_type, rule.action_config);
  };

  const isSimulationRule = (rule: any) => rule.action_config?.simulationMode === true;

  const activeRulesCount = rules?.filter((r: any) => r.is_active).length || 0;
  const simulationRulesCount = rules?.filter((r: any) => r.is_active && isSimulationRule(r)).length || 0;
  const executeRulesCount = activeRulesCount - simulationRulesCount;

  const filteredLogs = (logs || []).filter((log: any) => {
    if (logFilter === 'all') return true;
    if (logFilter === 'success') return log.success && !log.action_result?.includes('simulation');
    if (logFilter === 'error') return !log.success;
    if (logFilter === 'simulation') return log.action_result === 'simulation_only';
    return true;
  });

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* ─── Header ─── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Regras Automáticas</h1>
            <p className="text-muted-foreground">Automatize decisões sobre suas campanhas com regras inteligentes</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* Toggle Simplificado / Especialista */}
            <div className="flex h-9 overflow-hidden rounded-xl border border-border/60 bg-muted/30 text-xs">
              <button
                onClick={() => setViewMode('simplified')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'simplified' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                📋 Simplificado
              </button>
              <button
                onClick={() => setViewMode('expert')}
                className={`h-full px-3.5 font-medium transition-all ${viewMode === 'expert' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                ⚙️ Especialista
              </button>
            </div>
            <Button variant="outline" onClick={handleSuggestRules} disabled={isSuggesting}>
              {isSuggesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Sugerir com IA
            </Button>
            <Button className="gradient-primary" onClick={() => openCreate()}>
              <Plus className="mr-2 h-4 w-4" /> Criar Regra
            </Button>
          </div>
        </div>

        {/* ── MODO SIMPLIFICADO ── */}
        {viewMode === 'simplified' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-medium text-foreground">💡 Como funciona?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Você define uma condição (<span className="text-foreground font-medium">ex: quando o custo estiver alto</span>) e uma ação automática (<span className="text-foreground font-medium">ex: pausar a campanha</span>). A regra roda sozinha no piloto automático.
              </p>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-1">🚀 Começar com um modelo pronto</h2>
              <p className="text-sm text-muted-foreground mb-4">Clique em qualquer modelo abaixo para criar sua regra em segundos</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ruleTemplates.map((template, index) => (
                  <button
                    key={index}
                    onClick={() => { openCreate(template.form); }}
                    className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card/60 p-5 text-left transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <template.icon className="h-5 w-5 text-primary" />
                      </div>
                      <p className="font-semibold text-sm text-foreground leading-tight">{template.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{template.description}</p>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="h-3 w-3" /> Usar este modelo
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {rules && rules.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Minhas Regras Ativas</h2>
                <div className="space-y-2">
                  {rules.map((rule: any) => (
                    <div key={rule.id} className="flex items-center justify-between gap-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${rule.is_active ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{rule.name}</p>
                          <p className="text-xs text-muted-foreground">Disparada {rule.trigger_count || 0}x</p>
                        </div>
                      </div>
                      <Switch checked={rule.is_active} onCheckedChange={(checked) => toggleRule.mutate({ id: rule.id, is_active: checked })} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/50 bg-card/50 p-4 text-center space-y-2">
              <p className="text-sm font-medium">Quer configurar regras mais avançadas?</p>
              <p className="text-xs text-muted-foreground">Defina condições múltiplas, frequências e modo simulação.</p>
              <button
                onClick={() => setViewMode('expert')}
                className="mt-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                ⚙️ Abrir modo especialista
              </button>
            </div>
          </div>
        )}

        {/* ── MODO ESPECIALISTA ── */}
        {viewMode === 'expert' && (<>

        {/* ─── Stats row ─── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
                <ListChecks className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{rules?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Total de Regras</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <Zap className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{executeRulesCount}</p>
                <p className="text-xs text-muted-foreground">Modo Executar</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
                <Eye className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{simulationRulesCount}</p>
                <p className="text-xs text-muted-foreground">Modo Sugerir</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                <History className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{logs?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Execuções</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Connection warning ─── */}
        {!hasConnection && (
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="h-5 w-5 text-accent-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Meta Ads não conectado</p>
                <p className="text-xs text-muted-foreground">Conecte sua conta em Configurações ou use o modo manual para analisar com IA.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Main Tabs ─── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="rules" className="gap-2">
              <ListChecks className="h-4 w-4" /> Regras
              {rules?.length ? <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{rules.length}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="results" className="gap-2">
              <Play className="h-4 w-4" /> Resultados
              {evaluationResults.length ? <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{evaluationResults.filter(r => r.triggered).length}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" /> Histórico
              {logs?.length ? <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{logs.length}</Badge> : null}
            </TabsTrigger>
          </TabsList>

          {/* ─── RULES TAB ─── */}
          <TabsContent value="rules">
            <div className="grid gap-6 lg:grid-cols-3 overflow-hidden">
              {/* Rules list */}
              <div className="lg:col-span-2 space-y-4 min-w-0">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Suas Regras</h2>
                  <Button variant="outline" size="sm" onClick={evaluateRules} disabled={isEvaluating || !rules?.length}>
                    {isEvaluating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Avaliar Agora
                  </Button>
                </div>

                {isLoadingRules ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)
                ) : !rules?.length ? (
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex flex-col items-center gap-4 py-16">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Settings2 className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <h3 className="font-semibold">Nenhuma regra criada ainda</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Crie regras para automatizar suas campanhas ou use um template pronto.</p>
                      </div>
                      <Button variant="outline" onClick={() => openCreate()}>
                        <Plus className="mr-2 h-4 w-4" /> Criar Primeira Regra
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  rules.map((rule: any, index: number) => (
                    <motion.div key={rule.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                      <Card className={`border-border/50 bg-card/50 backdrop-blur-sm transition-all ${rule.is_active ? 'border-primary/30' : 'opacity-60'} ${isSimulationRule(rule) ? 'border-dashed' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-2 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold">{rule.name}</h3>
                                <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                                  {rule.is_active ? 'Ativa' : 'Pausada'}
                                </Badge>
                                {isSimulationRule(rule) ? (
                                  <Badge variant="outline" className="text-xs border-accent text-accent-foreground">
                                    <Eye className="h-3 w-3 mr-1" /> Sugerir
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
                                    <Zap className="h-3 w-3 mr-1" /> Executar
                                  </Badge>
                                )}
                              </div>

                              <p className="text-sm text-muted-foreground italic">
                                "{getRuleFriendlyText(rule)}"
                              </p>

                              <div className="flex flex-wrap gap-1">
                                {Array.isArray(rule.conditions) && rule.conditions.map((c: any, i: number) => (
                                  <Badge key={i} variant="outline" className="text-xs font-mono">
                                    {c.metric} {c.operator} {c.value}{c.period ? ` (${c.period})` : ''}
                                  </Badge>
                                ))}
                                {Array.isArray(rule.conditions) && rule.conditions.length > 1 && (
                                  <Badge variant="outline" className="text-xs">{rule.condition_logic || 'AND'}</Badge>
                                )}
                              </div>

                              <div className="flex gap-4 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {FREQUENCIES.find((f) => f.value === rule.check_frequency)?.label || rule.check_frequency || '1h'}</span>
                                <span>Disparada {rule.trigger_count || 0}x</span>
                                {rule.last_triggered_at && (
                                  <span>Última: {new Date(rule.last_triggered_at).toLocaleDateString('pt-BR')}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              <Switch checked={rule.is_active} onCheckedChange={(checked) => toggleRule.mutate({ id: rule.id, is_active: checked })} />
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rule)} title="Editar">
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateRule.mutate(rule)} title="Duplicar">
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteConfirmId(rule.id)} title="Excluir">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Templates sidebar */}
              <div className="space-y-4 min-w-0">
                <h2 className="text-lg font-semibold">Templates Prontos</h2>
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-3 space-y-2">
                    {ruleTemplates.map((template, index) => (
                      <button
                        key={index}
                        className="w-full rounded-lg border border-border/50 bg-muted/20 p-3 text-left transition-all hover:border-primary/50 hover:bg-primary/5"
                        onClick={() => openCreate(template.form)}
                      >
                        <div className="flex items-center gap-2">
                          <template.icon className="h-4 w-4 shrink-0 text-primary" />
                          <span className="text-sm font-medium truncate">{template.name}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                      </button>
                    ))}
                  </CardContent>
                </Card>

                {/* Manual mode */}
                {!hasConnection && (
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardHeader className="pb-2"><CardTitle className="text-sm">Modo Manual</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-xs text-muted-foreground">Cole métricas das campanhas para análise com IA</p>
                      <Textarea
                        placeholder="Cole aqui os dados das campanhas..."
                        className="text-xs min-h-[120px]"
                        value={manualData}
                        onChange={(e) => setManualData(e.target.value)}
                      />
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ─── RESULTS TAB ─── */}
          <TabsContent value="results">
            <div className="space-y-4">
              {evaluationResults.length === 0 ? (
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="flex flex-col items-center gap-4 py-16">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                      <Play className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="text-center">
                      <h3 className="font-semibold">Nenhuma avaliação executada</h3>
                      <p className="mt-1 text-sm text-muted-foreground">Clique em "Avaliar Agora" na aba de regras para verificar quais condições seriam disparadas.</p>
                    </div>
                    <Button variant="outline" onClick={() => setActiveTab('rules')}>
                      <ListChecks className="mr-2 h-4 w-4" /> Ir para Regras
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">
                      Resultado da Avaliação
                      <span className="text-sm font-normal text-muted-foreground ml-2">
                        {evaluationResults[0]?.timestamp.toLocaleString('pt-BR')}
                      </span>
                    </h2>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="text-green-400 border-green-500/50">
                        {evaluationResults.filter((r) => r.triggered).length} disparada(s)
                      </Badge>
                      <Badge variant="outline" className="text-muted-foreground">
                        {evaluationResults.filter((r) => !r.triggered).length} ok
                      </Badge>
                    </div>
                  </div>

                  {evaluationResults.map((result) => (
                    <Card key={result.ruleId} className={`border-border/50 bg-card/50 backdrop-blur-sm transition-all ${result.triggered ? 'border-destructive/40' : 'border-green-500/30'}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {result.triggered ? (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/20">
                                <AlertCircle className="h-4 w-4 text-destructive" />
                              </div>
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20">
                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                              </div>
                            )}
                            <div>
                              <h3 className="font-semibold">{result.ruleName}</h3>
                              <p className="text-xs text-muted-foreground">
                                {result.triggered ? `${result.campaignsAffected.length} campanha(s) afetada(s)` : 'Nenhuma campanha atingiu as condições'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {result.simulationMode ? (
                              <Badge variant="outline" className="text-xs border-accent text-accent-foreground">
                                <Eye className="h-3 w-3 mr-1" /> Sugerir
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-green-500/50 text-green-400">
                                <Zap className="h-3 w-3 mr-1" /> Executar
                              </Badge>
                            )}
                            <Badge variant={result.triggered ? 'destructive' : 'secondary'}>
                              {result.triggered ? 'Disparada' : 'OK'}
                            </Badge>
                          </div>
                        </div>

                        {/* Condition details */}
                        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Condições Avaliadas</p>
                          {result.conditionResults.map((cr, i) => {
                            const metricInfo = METRICS.find((m) => m.value === cr.condition.metric);
                            return (
                              <div key={i} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2">
                                  {cr.met ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-destructive" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5 text-green-400" />
                                  )}
                                  <span>{metricInfo?.label || cr.condition.metric}</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs font-mono">
                                  <span className="text-muted-foreground">
                                    Atual: <span className="text-foreground">{cr.currentValue !== null ? cr.currentValue.toFixed(2) : 'N/A'}</span>
                                  </span>
                                  <span className="text-muted-foreground">
                                    Meta: {cr.condition.operator} {cr.condition.value}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Action to take */}
                        {result.triggered && (
                          <div className={`rounded-lg p-3 ${result.simulationMode ? 'bg-accent/10 border border-accent/30' : 'bg-destructive/10 border border-destructive/30'}`}>
                            <div className="flex items-center gap-2">
                              {result.simulationMode ? (
                                <Eye className="h-4 w-4 text-accent-foreground" />
                              ) : (
                                <Zap className="h-4 w-4 text-destructive" />
                              )}
                              <span className="text-sm font-medium">
                                {result.simulationMode ? 'Sugestão' : 'Ação executada'}:
                              </span>
                              <span className="text-sm">
                                {ACTION_TYPES.find((a) => a.value === result.actionType)?.friendly || result.actionType}
                                {result.actionConfig?.percentage ? ` em ${result.actionConfig.percentage}%` : ''}
                              </span>
                            </div>
                            {result.campaignsAffected.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {result.campaignsAffected.slice(0, 5).map((name, i) => (
                                  <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                                ))}
                                {result.campaignsAffected.length > 5 && (
                                  <Badge variant="outline" className="text-xs">+{result.campaignsAffected.length - 5} mais</Badge>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>
          </TabsContent>

          {/* ─── HISTORY TAB ─── */}
          <TabsContent value="history">
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
              <CardHeader className="flex-row items-center justify-between pb-4">
                <CardTitle className="text-lg">Histórico de Ações</CardTitle>
                <div className="flex gap-1">
                  {(['all', 'success', 'simulation', 'error'] as const).map((f) => (
                    <Button
                      key={f}
                      variant={logFilter === f ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setLogFilter(f)}
                    >
                      {f === 'all' && 'Todos'}
                      {f === 'success' && '✅ Executados'}
                      {f === 'simulation' && '🔍 Sugestões'}
                      {f === 'error' && '❌ Erros'}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingLogs ? (
                  <Skeleton className="h-48 w-full" />
                ) : !filteredLogs.length ? (
                  <div className="flex flex-col items-center gap-2 py-10">
                    <Clock className="h-8 w-8 text-muted-foreground" />
                    <p className="text-muted-foreground">Nenhuma ação registrada{logFilter !== 'all' ? ' nesta categoria' : ''}.</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[500px]">
                    <div className="space-y-2">
                      {filteredLogs.map((log: any) => {
                        const isExpanded = expandedLogId === log.id;
                        const isSimLog = log.action_result === 'simulation_only';
                        const conditionsMet = log.conditions_met;
                        const metricsSnapshot = log.metrics_snapshot;

                        return (
                          <div key={log.id} className="rounded-lg border border-border/50 transition-all hover:border-border">
                            <button
                              className="w-full flex items-center gap-4 p-3 text-left"
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            >
                              <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                                isSimLog ? 'bg-accent/20' : log.success ? 'bg-primary/20' : 'bg-destructive/20'
                              }`}>
                                {isSimLog ? (
                                  <Eye className="h-4 w-4 text-accent-foreground" />
                                ) : log.success ? (
                                  <Zap className="h-4 w-4 text-primary" />
                                ) : (
                                  <XCircle className="h-4 w-4 text-destructive" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{(log as any).automation_rules?.name || 'Regra'}</p>
                                <p className="text-xs text-muted-foreground truncate">{log.action_taken}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="secondary" className={`text-xs ${
                                  isSimLog ? 'bg-accent/20 text-accent-foreground' :
                                  log.success ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'
                                }`}>
                                  {isSimLog ? '🔍 Sugestão' : log.success ? '✅ Executado' : '❌ Erro'}
                                </Badge>
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {new Date(log.triggered_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                              </div>
                            </button>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
                                    {/* Conditions met */}
                                    {Array.isArray(conditionsMet) && conditionsMet.length > 0 && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Condições Avaliadas</p>
                                        <div className="space-y-1">
                                          {conditionsMet.map((cm: any, i: number) => {
                                            const metricInfo = METRICS.find((m) => m.value === cm.metric);
                                            return (
                                              <div key={i} className="flex items-center justify-between text-xs bg-muted/20 rounded-md px-2 py-1.5">
                                                <div className="flex items-center gap-1.5">
                                                  {cm.met ? (
                                                    <CheckCircle2 className="h-3 w-3 text-destructive" />
                                                  ) : (
                                                    <XCircle className="h-3 w-3 text-green-400" />
                                                  )}
                                                  <span>{metricInfo?.label || cm.metric}</span>
                                                </div>
                                                <span className="font-mono">
                                                  {cm.actual !== null && cm.actual !== undefined ? Number(cm.actual).toFixed(2) : 'N/A'} {cm.operator} {cm.target}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {/* Metrics snapshot */}
                                    {metricsSnapshot?.campaigns && (
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Campanhas Afetadas</p>
                                        <div className="flex flex-wrap gap-1">
                                          {metricsSnapshot.campaigns.map((name: string, i: number) => (
                                            <Badge key={i} variant="outline" className="text-xs">{name}</Badge>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Error message */}
                                    {log.error_message && (
                                      <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                                        {log.error_message}
                                      </div>
                                    )}

                                    <p className="text-xs text-muted-foreground">
                                      {new Date(log.triggered_at).toLocaleString('pt-BR')}
                                    </p>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ─── AI Suggestions ─── */}
        {aiSuggestion && (
          <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Sugestões da IA</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setAiSuggestion('')}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              <MarkdownRenderer content={aiSuggestion} />
            </CardContent>
          </Card>
        )}
        </>)}
      </div>

      {/* ─── Create/Edit Dialog ─── */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Editar Regra' : 'Criar Nova Regra'}</DialogTitle>
            <DialogDescription>Configure quando e o que fazer automaticamente com suas campanhas</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Name & description */}
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Nome da regra *</label>
                <Input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder="Ex: Pausar campanhas com custo alto" />
              </div>
              <div>
                <label className="text-sm font-medium">Descrição (opcional)</label>
                <Textarea value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} placeholder="Descreva o objetivo da regra em linguagem simples..." className="min-h-[60px]" />
              </div>
            </div>

            {/* Execution mode — Sugerir vs Executar */}
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <div className="grid grid-cols-2">
                <button
                  type="button"
                  className={`flex items-center justify-center gap-2 p-3 text-sm font-medium transition-all ${
                    formData.simulationMode
                      ? 'bg-accent/10 border-r border-border/50 text-accent-foreground'
                      : 'bg-muted/10 border-r border-border/50 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => setFormData((p) => ({ ...p, simulationMode: true }))}
                >
                  <Eye className="h-4 w-4" />
                  <div className="text-left">
                    <p className="font-semibold">Sugerir</p>
                    <p className="text-xs opacity-70">Apenas notifica, não executa</p>
                  </div>
                </button>
                <button
                  type="button"
                  className={`flex items-center justify-center gap-2 p-3 text-sm font-medium transition-all ${
                    !formData.simulationMode
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-muted/10 text-muted-foreground hover:bg-muted/20'
                  }`}
                  onClick={() => setFormData((p) => ({ ...p, simulationMode: false }))}
                >
                  <Zap className="h-4 w-4" />
                  <div className="text-left">
                    <p className="font-semibold">Executar</p>
                    <p className="text-xs opacity-70">Executa ações automaticamente</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Conditions — SE */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">📌 SE (Condições)</label>
                <div className="flex items-center gap-2">
                  {formData.conditions.length > 1 && (
                    <Select value={formData.conditionLogic} onValueChange={(v) => setFormData((p) => ({ ...p, conditionLogic: v as 'AND' | 'OR' }))}>
                      <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AND">E</SelectItem>
                        <SelectItem value="OR">OU</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" size="sm" onClick={addCondition}><Plus className="h-3 w-3 mr-1" /> Condição</Button>
                </div>
              </div>

              {formData.conditions.map((cond, idx) => (
                <div key={idx} className="flex items-center gap-2 flex-wrap">
                  <Select value={cond.metric} onValueChange={(v) => updateCondition(idx, 'metric', v)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {METRICS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={cond.operator} onValueChange={(v) => updateCondition(idx, 'operator', v)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" value={cond.value} onChange={(e) => updateCondition(idx, 'value', e.target.value)} className="w-24" placeholder="Valor" />
                  <Select value={cond.period || '7d'} onValueChange={(v) => updateCondition(idx, 'period', v)}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {formData.conditions.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeCondition(idx)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}

              {/* Live preview */}
              <div className="rounded-md bg-muted/30 p-2.5 text-sm text-muted-foreground italic">
                "{buildFriendlyDescription(formData.conditions, formData.conditionLogic, formData.actionType, formData.actionConfig)}"
              </div>
            </div>

            {/* Action — ENTÃO */}
            <div className="space-y-3">
              <label className="text-sm font-medium">⚡ ENTÃO (Ação)</label>
              <Select value={formData.actionType} onValueChange={(v) => setFormData((p) => ({ ...p, actionType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {(formData.actionType === 'increase_budget' || formData.actionType === 'decrease_budget') && (
                <div>
                  <label className="text-sm text-muted-foreground">Percentual de ajuste (%)</label>
                  <Input
                    type="number"
                    value={formData.actionConfig.percentage ?? 20}
                    onChange={(e) => setFormData((p) => ({ ...p, actionConfig: { ...p.actionConfig, percentage: Number(e.target.value) } }))}
                    className="w-32"
                  />
                </div>
              )}
            </div>

            {/* Target campaigns */}
            {campaigns.length > 0 && (
              <div className="space-y-3">
                <label className="text-sm font-medium">🎯 Campanhas Alvo</label>
                <p className="text-xs text-muted-foreground">Deixe vazio para aplicar a todas as campanhas</p>
                <ScrollArea className="h-32 rounded-md border p-2">
                  {campaigns.map((c: any) => (
                    <div key={c.id} className="flex items-center gap-2 py-1">
                      <Checkbox
                        checked={formData.applyToCampaigns.includes(c.id)}
                        onCheckedChange={(checked) => {
                          setFormData((p) => ({
                            ...p,
                            applyToCampaigns: checked
                              ? [...p.applyToCampaigns, c.id]
                              : p.applyToCampaigns.filter((id) => id !== c.id),
                          }));
                        }}
                      />
                      <span className="text-sm truncate">{c.name}</span>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}

            {/* Frequency & notification */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">🔄 Frequência de Checagem</label>
                <Select value={formData.checkFrequency} onValueChange={(v) => setFormData((p) => ({ ...p, checkFrequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={formData.notifyOnTrigger} onCheckedChange={(v) => setFormData((p) => ({ ...p, notifyOnTrigger: v }))} />
                <label className="text-sm">Notificar ao disparar</label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createRule.isPending || updateRule.isPending} className="gradient-primary">
              {(createRule.isPending || updateRule.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingRule ? 'Salvar Alterações' : 'Criar Regra'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete Confirm Dialog ─── */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir Regra</DialogTitle>
            <DialogDescription>Tem certeza que deseja excluir esta regra? Esta ação não pode ser desfeita.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteRule.mutate(deleteConfirmId)} disabled={deleteRule.isPending}>
              {deleteRule.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
