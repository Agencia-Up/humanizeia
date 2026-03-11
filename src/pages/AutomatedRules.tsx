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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMetaCampaigns } from '@/hooks/useMetaCampaigns';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useToast } from '@/hooks/use-toast';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { motion } from 'framer-motion';
import {
  Settings2, Plus, Pause, Trash2, Copy, Edit, Clock, Zap,
  Play, Sparkles, Brain, AlertCircle, X, Loader2, Eye, EyeOff,
  TrendingUp, TrendingDown, Shield, Activity,
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
  { value: 'cpa', label: 'CPA (Custo por Resultado)', friendly: 'custo por resultado' },
  { value: 'ctr', label: 'CTR (%)', friendly: 'taxa de cliques' },
  { value: 'roas', label: 'ROAS', friendly: 'retorno sobre investimento' },
  { value: 'cpc', label: 'CPC', friendly: 'custo por clique' },
  { value: 'cpm', label: 'CPM', friendly: 'custo por mil impressões' },
  { value: 'spend', label: 'Gasto (R$)', friendly: 'gasto' },
  { value: 'impressions', label: 'Impressões', friendly: 'impressões' },
  { value: 'clicks', label: 'Cliques', friendly: 'cliques' },
  { value: 'conversions', label: 'Conversões', friendly: 'conversões' },
  { value: 'frequency', label: 'Frequência', friendly: 'frequência' },
  { value: 'reach', label: 'Alcance', friendly: 'alcance' },
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
  const [aiExecution, setAiExecution] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [manualData, setManualData] = useState('');

  /* ─── AI hooks ─── */
  const { sendSingleMessage: sendExecution, isLoading: isExecuting } = useClaudeChat({
    context: 'optimizer',
    onDelta: (d) => setAiExecution((p) => p + d),
  });

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
      const { data, error } = await supabase.from('rule_execution_log').select('*, automation_rules(name)').order('triggered_at', { ascending: false }).limit(20);
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

  /* ─── AI execution ─── */
  const handleExecuteRules = async () => {
    const activeRules = rules?.filter((r: any) => r.is_active) || [];
    if (!activeRules.length) {
      toast({ title: 'Nenhuma regra ativa para executar', variant: 'destructive' });
      return;
    }

    const metricsData = manualData.trim() || JSON.stringify({
      campanhas: campaignInsights.data?.data?.slice(0, 20) || [],
    });

    const rulesData = activeRules.map((r: any) => ({
      name: r.name,
      conditions: r.conditions,
      condition_logic: r.condition_logic,
      action_type: r.action_type,
      action_config: r.action_config,
      simulationMode: r.action_config?.simulationMode ?? false,
    }));

    const hasSimulation = rulesData.some((r) => r.simulationMode);

    setAiExecution('');
    await sendExecution(
      `Você é um analista de automação de campanhas Meta Ads.

Analise estas REGRAS AUTOMÁTICAS vs as MÉTRICAS ATUAIS e determine quais regras seriam disparadas:

## Regras Configuradas:
${JSON.stringify(rulesData, null, 2)}

## Métricas Atuais das Campanhas:
${metricsData}

Para cada regra, responda:
1. ✅ ou ❌ se seria disparada
2. Quais condições foram atendidas
3. Qual ação seria executada
4. Impacto estimado

${hasSimulation ? '⚠️ IMPORTANTE: Regras em MODO SIMULAÇÃO devem ser marcadas com 🔍 e mostrar "SIMULAÇÃO: Esta ação NÃO seria executada, apenas sugerida".' : ''}

Formate em Markdown com headers, emojis e tabelas quando possível.
Use linguagem simples e acessível para não-técnicos.
No final, liste as ações recomendadas de forma clara.`
    );
  };

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

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* ─── Header ─── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Regras Automáticas</h1>
            <p className="text-muted-foreground">Automatize decisões sobre suas campanhas com regras inteligentes</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSuggestRules} disabled={isSuggesting}>
              {isSuggesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Sugerir com IA
            </Button>
            <Button className="gradient-primary" onClick={() => openCreate()}>
              <Plus className="mr-2 h-4 w-4" /> Criar Nova Regra
            </Button>
          </div>
        </div>

        {/* ─── Connection warning ─── */}
        {!hasConnection && (
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="h-5 w-5 text-accent-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Meta Ads não conectado</p>
                <p className="text-xs text-muted-foreground">Conecte sua conta em Configurações ou use o modo manual abaixo para analisar com IA.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Main grid ─── */}
        <div className="grid gap-6 lg:grid-cols-3 overflow-hidden">
          {/* Rules list */}
          <div className="lg:col-span-2 space-y-4 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Suas Regras ({rules?.length || 0})</h2>
              <Button variant="outline" size="sm" onClick={handleExecuteRules} disabled={isExecuting || !rules?.length}>
                {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Simular Execução
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
                            {isSimulationRule(rule) && (
                              <Badge variant="outline" className="text-xs border-accent text-accent-foreground">
                                <Eye className="h-3 w-3 mr-1" /> Simulação
                              </Badge>
                            )}
                          </div>

                          {/* Friendly description */}
                          <p className="text-sm text-muted-foreground italic">
                            "{getRuleFriendlyText(rule)}"
                          </p>

                          {/* Conditions preview */}
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

        {/* ─── AI Results ─── */}
        {aiExecution && (
          <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Resultado da Simulação</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setAiExecution('')}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent>
              <MarkdownRenderer content={aiExecution} />
            </CardContent>
          </Card>
        )}

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

        {/* ─── Execution Log ─── */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader><CardTitle className="text-lg">📋 Log de Execuções</CardTitle></CardHeader>
          <CardContent>
            {isLoadingLogs ? <Skeleton className="h-48 w-full" /> : !logs?.length ? (
              <div className="flex flex-col items-center gap-2 py-10">
                <Clock className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground">Nenhuma execução registrada ainda.</p>
                <p className="text-xs text-muted-foreground">As ações das regras aparecerão aqui quando forem disparadas.</p>
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {logs.map((log: any) => (
                    <div key={log.id} className="flex items-center gap-4 rounded-lg border border-border/50 p-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${log.success ? 'bg-primary/20' : 'bg-destructive/20'}`}>
                        <Zap className={`h-4 w-4 ${log.success ? 'text-primary' : 'text-destructive'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate"><span className="font-medium">{(log as any).automation_rules?.name || 'Regra'}</span></p>
                        <p className="text-xs text-muted-foreground truncate">{log.action_taken}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="secondary" className={log.success ? 'bg-primary/20 text-primary' : 'bg-destructive/20 text-destructive'}>
                          {log.success ? '✅ Executado' : '❌ Erro'}
                        </Badge>
                        <p className="mt-1 text-xs text-muted-foreground">{new Date(log.triggered_at).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
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

            {/* Simulation mode */}
            <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 p-3">
              <div className="flex items-center gap-2">
                {formData.simulationMode ? <Eye className="h-4 w-4 text-accent-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">Modo Simulação</p>
                  <p className="text-xs text-muted-foreground">
                    {formData.simulationMode ? 'Apenas sugere ações, não executa automaticamente' : 'A regra executará ações automaticamente'}
                  </p>
                </div>
              </div>
              <Switch checked={formData.simulationMode} onCheckedChange={(v) => setFormData((p) => ({ ...p, simulationMode: v }))} />
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
