import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlugZap, Save, Loader2, Clock, MessageSquareText, ArrowRightLeft, FileClock, Users, Plus, Target, Brain, Activity, FlaskConical, RotateCcw, RefreshCw, ShieldCheck, Smartphone, Megaphone } from 'lucide-react';
import { StatusPill, InfoNote, StatTile } from './RegrasUi';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  CAPI_QUALITY_EVENTS, classifyCapiEventStatus, CAPI_EVENT_STATUS_LABEL,
  customConversionInstruction,
} from '@/lib/capiEventStatus';

// Reconexão + relatório de atendimento: sem linha => defaults = comportamento legado.
const DEFAULTS = {
  reconexao_enabled: true, reconexao_intervalo_min: 60, reconexao_hora_ini: 7, reconexao_hora_fim: 21,
  relatorio_atendimento_enabled: true, relatorio_atendimento_hora: 8,
  relatorio_atendimento_frequencia: 'diario' as string,
  relatorio_atendimento_dias: null as number[] | null,
  relatorio_atendimento_horarios: null as number[] | null,
  relatorio_janela_tipo: 'padrao_atual' as string,
};

// Convenção de dias: 0=domingo..6=sábado (EXTRACT(dow) do Postgres).
const DIAS_SEMANA = [
  { v: 1, l: 'Seg' }, { v: 2, l: 'Ter' }, { v: 3, l: 'Qua' }, { v: 4, l: 'Qui' },
  { v: 5, l: 'Sex' }, { v: 6, l: 'Sáb' }, { v: 0, l: 'Dom' },
];
const JANELAS = [
  { v: 'padrao_atual', l: 'Padrão atual (últimos 7 dias)' },
  { v: 'ultimas_24h', l: 'Últimas 24h' },
  { v: 'ultimos_2_dias', l: 'Últimos 2 dias' },
  { v: 'ultimos_3_dias', l: 'Últimos 3 dias' },
  { v: 'ultimos_7_dias', l: 'Últimos 7 dias' },
  { v: 'semana_atual', l: 'Semana atual (desde segunda)' },
  { v: 'desde_chegada_lead', l: 'Desde a chegada de cada lead (máx. 30 dias)' },
];
const TONS = [
  { v: 'direto', l: 'Direto' }, { v: 'consultivo', l: 'Consultivo' },
  { v: 'educativo', l: 'Educativo' }, { v: 'exigente', l: 'Exigente' },
];
const BRAIN_DEFAULT = {
  enabled: false, name: '', tone: 'direto',
  specialist_prompt: '', evaluation_criteria: '', never_do: '',
};
const INTERVALOS = [
  { v: 30, l: '30 minutos' }, { v: 60, l: '1 hora' }, { v: 120, l: '2 horas' },
  { v: 180, l: '3 horas' }, { v: 360, l: '6 horas' }, { v: 720, l: '12 horas' },
];
const horas = Array.from({ length: 24 }, (_, i) => i);

// Follow-up/transfer: mesmos defaults/shape do _shared/automation/rules.ts.
const FU_DEFAULT = { enabled: true, t1: 5, t2: 8, t3: 12, t3_transfers: true };
const TR_DEFAULT = { enabled: true, seller_min: 10, window_custom: false, start: '10:11', end: '19:29' };

export function RegrasAutomacoesTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Reconexão (config de conta) ──
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRel, setSavingRel] = useState(false);
  const [cfg, setCfg] = useState(DEFAULTS);

  // ── Destinatários do relatório de atendimento (conta_responsaveis.recebe_atendimento) ──
  const [resp, setResp] = useState<any[]>([]);
  const [loadingResp, setLoadingResp] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [novoWa, setNovoWa] = useState('');
  const [addingResp, setAddingResp] = useState(false);

  // ── Follow-up / Transferência (por agente, em wa_ai_agents.automation_rules) ──
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [loadingAg, setLoadingAg] = useState(true);
  const [savingAg, setSavingAg] = useState(false);
  const [fu, setFu] = useState(FU_DEFAULT);
  const [tr, setTr] = useState(TR_DEFAULT);

  // ── Cérebro da análise (feedback_brain_config, por tenant/master) ──
  const [brain, setBrain] = useState<any>(BRAIN_DEFAULT);
  const [loadingBrain, setLoadingBrain] = useState(true);
  const [savingBrain, setSavingBrain] = useState(false);
  const [testingBrain, setTestingBrain] = useState(false);
  const [brainTest, setBrainTest] = useState<any>(null); // resultado do último teste

  // ── Saúde do Cérebro (feedback_status_operacional) + saúde executiva
  //    (feedback_operational_health) + CAPI (capi_quality_status) + checklist
  //    de Custom Conversions (meta_custom_conversion_checks) ──
  const [saude, setSaude] = useState<any>(null);
  const [loadingSaude, setLoadingSaude] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [capi, setCapi] = useState<any>(null);
  const [ccheck, setCcheck] = useState<Record<string, any>>({});
  const [savingCheck, setSavingCheck] = useState<string | null>(null);

  // ── Relatório do José (Fluxo A — apollo_cron_config, por conta) ──
  // Só mexemos nos campos DO RELATÓRIO (send_daily_report / run_hour / run_minute /
  // whatsapp_report_number). NÃO tocamos em is_enabled/auto_execute/account_id — isso
  // é a autonomia do agente José e sai do escopo desta aba.
  const [jose, setJose] = useState<any>(null); // null = sem linha (José não configurado)
  const [loadingJose, setLoadingJose] = useState(true);
  const [savingJose, setSavingJose] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from('conta_automacao_regras')
        .select('reconexao_enabled, reconexao_intervalo_min, reconexao_hora_ini, reconexao_hora_fim, relatorio_atendimento_enabled, relatorio_atendimento_hora, relatorio_atendimento_frequencia, relatorio_atendimento_dias, relatorio_atendimento_horarios, relatorio_janela_tipo')
        .eq('user_id', user.id).maybeSingle();
      if (!cancelled) { setCfg(data ? { ...DEFAULTS, ...data } : DEFAULTS); setLoading(false); }
    })();
    (async () => {
      setLoadingResp(true);
      const { data } = await (supabase as any)
        .from('conta_responsaveis')
        .select('id, nome, whatsapp, recebe_atendimento, recebe_alertas, ativo')
        .eq('user_id', user.id).order('created_at', { ascending: true });
      if (!cancelled) { setResp(Array.isArray(data) ? data : []); setLoadingResp(false); }
    })();
    (async () => {
      setLoadingBrain(true);
      const { data } = await (supabase as any)
        .from('feedback_brain_config')
        .select('enabled, name, tone, specialist_prompt, evaluation_criteria, never_do, version')
        .eq('tenant_id', user.id).maybeSingle();
      if (!cancelled) { setBrain(data ? { ...BRAIN_DEFAULT, ...data } : BRAIN_DEFAULT); setLoadingBrain(false); }
    })();
    (async () => {
      setLoadingSaude(true);
      // As 3 RPCs são somente leitura; feedback_operational_health e
      // capi_quality_status resolvem a conta pelo próprio auth.uid (sem p_user).
      const [st, he, cq, ck] = await Promise.all([
        (supabase as any).rpc('feedback_status_operacional', { p_tenant: user.id }),
        (supabase as any).rpc('feedback_operational_health'),
        (supabase as any).rpc('capi_quality_status'),
        (supabase as any).from('meta_custom_conversion_checks')
          .select('event_name, marked_configured, checked_at, notes').eq('user_id', user.id),
      ]);
      if (!cancelled) {
        setSaude(st?.data || null);
        setHealth(he?.data || null);
        setCapi(cq?.data || null);
        const map: Record<string, any> = {};
        for (const r of (Array.isArray(ck?.data) ? ck.data : [])) map[r.event_name] = r;
        setCcheck(map);
        setLoadingSaude(false);
      }
    })();
    (async () => {
      setLoadingAg(true);
      const { data } = await (supabase as any)
        .from('wa_ai_agents')
        .select('id, name, automation_rules')
        .eq('user_id', user.id).order('created_at', { ascending: true });
      if (cancelled) return;
      const list = Array.isArray(data) ? data : [];
      setAgents(list);
      if (list.length > 0) setAgentId((prev) => prev || list[0].id);
      setLoadingAg(false);
    })();
    (async () => {
      setLoadingJose(true);
      const { data } = await (supabase as any)
        .from('apollo_cron_config')
        .select('id, is_enabled, send_daily_report, run_hour, run_minute, timezone, whatsapp_report_number')
        .eq('user_id', user.id).maybeSingle();
      if (!cancelled) { setJose(data || null); setLoadingJose(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Carrega as regras do agente selecionado nos campos.
  useEffect(() => {
    const a = agents.find((x) => x.id === agentId);
    if (!a) return;
    const ar: any = a.automation_rules || {};
    const arF: any = ar.followup || {}; const arT: any = ar.transfer || {};
    setFu({
      enabled: arF.enabled !== false,
      t1: Number(arF.t1_min) > 0 ? Number(arF.t1_min) : 5,
      t2: Number(arF.t2_min) > 0 ? Number(arF.t2_min) : 8,
      t3: Number(arF.t3_min) > 0 ? Number(arF.t3_min) : 12,
      t3_transfers: arF.t3_transfers !== false,
    });
    setTr({
      enabled: arT.enabled !== false,
      seller_min: Number(arT.seller_response_min) > 0 ? Number(arT.seller_response_min) : 10,
      window_custom: !!arT.window,
      start: arT.window?.start || '10:11',
      end: arT.window?.end || '19:29',
    });
  }, [agentId, agents]);

  const salvarReconexao = async () => {
    if (!user?.id) return;
    if (cfg.reconexao_hora_fim <= cfg.reconexao_hora_ini) {
      toast({ title: 'Janela inválida', description: 'A hora final precisa ser maior que a inicial.', variant: 'destructive' }); return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from('conta_automacao_regras')
      .upsert({ user_id: user.id, ...cfg, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    setSaving(false);
    error ? toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' })
          : toast({ title: '✅ Regra salva', description: 'O lembrete de reconexão foi atualizado.' });
  };

  // Salva a config do relatório de atendimento (mesma linha da conta; upserta cfg inteiro
  // pra não zerar a reconexão). O cron roda de hora em hora e cruza frequência+dias+horários.
  const salvarRelatorioAtendimento = async () => {
    if (!user?.id) return;
    const freq = cfg.relatorio_atendimento_frequencia || 'diario';
    const dias = Array.isArray(cfg.relatorio_atendimento_dias) ? cfg.relatorio_atendimento_dias : [];
    if (freq === 'dias_especificos' && dias.length === 0) {
      toast({ title: 'Escolha os dias', description: 'Selecione ao menos um dia da semana para o relatório.', variant: 'destructive' }); return;
    }
    if (freq === 'semanal' && dias.length === 0) {
      toast({ title: 'Escolha o dia', description: 'Selecione o dia da semana do relatório semanal.', variant: 'destructive' }); return;
    }
    // Horários: array novo (ordenado, único). Vazio -> mantém legado (hora única).
    const horarios = Array.isArray(cfg.relatorio_atendimento_horarios) && cfg.relatorio_atendimento_horarios.length
      ? [...new Set(cfg.relatorio_atendimento_horarios)].sort((a: number, b: number) => a - b)
      : null;
    const payload = {
      user_id: user.id, ...cfg,
      relatorio_atendimento_frequencia: freq,
      relatorio_atendimento_dias: freq === 'diario' ? null : dias,
      relatorio_atendimento_horarios: horarios,
      // compat legado: mantém a hora única espelhando o 1º horário do array
      relatorio_atendimento_hora: horarios ? horarios[0] : cfg.relatorio_atendimento_hora,
      updated_at: new Date().toISOString(),
    };
    setSavingRel(true);
    const { error } = await (supabase as any).from('conta_automacao_regras')
      .upsert(payload, { onConflict: 'user_id' });
    setSavingRel(false);
    error ? toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' })
          : toast({ title: '✅ Relatório atualizado', description: 'Frequência, horários e janela do relatório salvos.' });
  };

  // Liga/desliga um responsável no relatório (recebe_atendimento) ou nos alertas
  // (recebe_alertas) — só mexe no campo pedido.
  const toggleRecebe = async (id: string, campo: 'recebe_atendimento' | 'recebe_alertas', val: boolean) => {
    setResp((prev) => prev.map((r) => r.id === id ? { ...r, [campo]: val } : r));
    const { error } = await (supabase as any).from('conta_responsaveis')
      .update({ [campo]: val, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      setResp((prev) => prev.map((r) => r.id === id ? { ...r, [campo]: !val } : r));
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    }
  };

  // ── Cérebro: salvar / restaurar padrão / testar prompt ──
  const salvarBrain = async () => {
    if (!user?.id) return;
    setSavingBrain(true);
    const { error } = await (supabase as any).from('feedback_brain_config').upsert({
      tenant_id: user.id,
      enabled: !!brain.enabled,
      name: String(brain.name || '').slice(0, 120) || null,
      tone: brain.tone || 'direto',
      specialist_prompt: String(brain.specialist_prompt || '').slice(0, 8000) || null,
      evaluation_criteria: String(brain.evaluation_criteria || '').slice(0, 8000) || null,
      never_do: String(brain.never_do || '').slice(0, 4000) || null,
    }, { onConflict: 'tenant_id' });
    setSavingBrain(false);
    error ? toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' })
          : toast({ title: '✅ Cérebro salvo', description: brain.enabled ? 'As próximas análises usam o cérebro personalizado.' : 'Cérebro personalizado desligado — análises usam o padrão Logos.' });
  };

  const restaurarPadraoBrain = async () => {
    if (!user?.id) return;
    setSavingBrain(true);
    const { error } = await (supabase as any).from('feedback_brain_config').upsert({
      tenant_id: user.id, enabled: false, name: null, tone: 'direto',
      specialist_prompt: null, evaluation_criteria: null, never_do: null,
    }, { onConflict: 'tenant_id' });
    setSavingBrain(false);
    if (error) { toast({ title: 'Erro', description: error.message, variant: 'destructive' }); return; }
    setBrain({ ...BRAIN_DEFAULT });
    setBrainTest(null);
    toast({ title: '✅ Padrão Logos restaurado', description: 'As análises voltam ao cérebro padrão da plataforma.' });
  };

  const testarBrain = async () => {
    setTestingBrain(true);
    setBrainTest(null);
    const { data, error } = await (supabase as any).functions.invoke('feedback-brain-test', {
      body: {
        dry_run: true,
        brain: {
          name: brain.name, tone: brain.tone,
          specialist_prompt: brain.specialist_prompt,
          evaluation_criteria: brain.evaluation_criteria,
          never_do: brain.never_do,
        },
      },
    });
    setTestingBrain(false);
    if (error || !data?.ok) {
      toast({ title: 'Falha no teste', description: String(error?.message || data?.error || 'erro'), variant: 'destructive' });
      return;
    }
    setBrainTest(data);
  };

  const recarregarSaude = async () => {
    if (!user?.id) return;
    setLoadingSaude(true);
    const [st, he, cq, ck] = await Promise.all([
      (supabase as any).rpc('feedback_status_operacional', { p_tenant: user.id }),
      (supabase as any).rpc('feedback_operational_health'),
      (supabase as any).rpc('capi_quality_status'),
      (supabase as any).from('meta_custom_conversion_checks')
        .select('event_name, marked_configured, checked_at, notes').eq('user_id', user.id),
    ]);
    setSaude(st?.data || null);
    setHealth(he?.data || null);
    setCapi(cq?.data || null);
    const map: Record<string, any> = {};
    for (const r of (Array.isArray(ck?.data) ? ck.data : [])) map[r.event_name] = r;
    setCcheck(map);
    setLoadingSaude(false);
  };

  // Checklist manual de Custom Conversion: só marca "configurei na Meta".
  // NÃO cria nada na Meta e NÃO altera o envio CAPI.
  const marcarConversao = async (eventName: string, val: boolean) => {
    if (!user?.id) return;
    setSavingCheck(eventName);
    const { error } = await (supabase as any).from('meta_custom_conversion_checks').upsert({
      user_id: user.id, event_name: eventName, marked_configured: val,
      checked_at: val ? new Date().toISOString() : null,
    }, { onConflict: 'user_id,event_name' });
    setSavingCheck(null);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    setCcheck((prev) => ({ ...prev, [eventName]: { ...(prev[eventName] || {}), event_name: eventName, marked_configured: val, checked_at: val ? new Date().toISOString() : null } }));
  };

  // Adiciona um destinatário (mesmo padrão do ResponsaveisTab: upsert por user_id+whatsapp).
  const addResp = async () => {
    if (!user?.id) return;
    const wa = novoWa.replace(/\D/g, '');
    if (!novoNome.trim() || wa.length < 10) {
      toast({ title: 'Dados incompletos', description: 'Informe nome e um WhatsApp válido (com DDD).', variant: 'destructive' }); return;
    }
    setAddingResp(true);
    const { error } = await (supabase as any).from('conta_responsaveis')
      .upsert({ user_id: user.id, nome: novoNome.trim(), whatsapp: wa, recebe_atendimento: true, ativo: true, updated_at: new Date().toISOString() }, { onConflict: 'user_id,whatsapp' });
    if (error) { setAddingResp(false); toast({ title: 'Erro ao adicionar', description: error.message, variant: 'destructive' }); return; }
    const { data } = await (supabase as any).from('conta_responsaveis')
      .select('id, nome, whatsapp, recebe_atendimento, ativo')
      .eq('user_id', user.id).order('created_at', { ascending: true });
    setResp(Array.isArray(data) ? data : []);
    setNovoNome(''); setNovoWa(''); setAddingResp(false);
    toast({ title: '✅ Destinatário adicionado', description: `${novoNome.trim()} vai receber o relatório de atendimento.` });
  };

  // Salva SÓ os campos do relatório do José (Fluxo A). Nunca toca em is_enabled/auto_execute.
  const salvarJose = async () => {
    if (!user?.id || !jose) return;
    const wa = String(jose.whatsapp_report_number || '').replace(/\D/g, '');
    if (jose.send_daily_report && wa.length < 10) {
      toast({ title: 'WhatsApp inválido', description: 'Informe o número (com DDD) que recebe o relatório do José.', variant: 'destructive' }); return;
    }
    const hour = Math.min(23, Math.max(0, Math.round(Number(jose.run_hour)) || 0));
    const minute = Math.min(59, Math.max(0, Math.round(Number(jose.run_minute)) || 0));
    setSavingJose(true);
    const { error } = await (supabase as any).from('apollo_cron_config')
      .update({ send_daily_report: !!jose.send_daily_report, run_hour: hour, run_minute: minute, whatsapp_report_number: wa || jose.whatsapp_report_number })
      .eq('user_id', user.id);
    setSavingJose(false);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    setJose((j: any) => ({ ...j, run_hour: hour, run_minute: minute, whatsapp_report_number: wa || j.whatsapp_report_number }));
    toast({ title: '✅ Relatório do José atualizado', description: 'Vale a partir do próximo ciclo diário.' });
  };

  const salvarAgente = async () => {
    if (!agentId) return;
    // Mesmo shape/clamp do AgentFormDialog (fonte que os motores já leem).
    const t1 = Math.max(1, Math.round(Number(fu.t1)) || 5);
    const t2 = Math.max(t1 + 1, Math.round(Number(fu.t2)) || 8);
    const t3 = Math.max(t2 + 1, Math.round(Number(fu.t3)) || 12);
    const rules = {
      followup: { enabled: fu.enabled, t1_min: t1, t2_min: t2, t3_min: t3, t3_transfers: fu.t3_transfers },
      transfer: {
        enabled: tr.enabled,
        seller_response_min: Math.max(1, Math.round(Number(tr.seller_min)) || 10),
        window: tr.window_custom ? { enabled: true, start: tr.start, end: tr.end } : null,
      },
    };
    setSavingAg(true);
    const { error } = await (supabase as any).from('wa_ai_agents')
      .update({ automation_rules: rules, updated_at: new Date().toISOString() }).eq('id', agentId);
    setSavingAg(false);
    if (error) { toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' }); return; }
    setAgents((prev) => prev.map((a) => a.id === agentId ? { ...a, automation_rules: rules } : a));
    // reflete o clamp de volta nos campos
    setFu((f) => ({ ...f, t1, t2, t3 }));
    toast({ title: '✅ Regras salvas', description: 'Follow-up e transferência atualizados para este agente.' });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Regras & Automações</h2>
        <p className="text-sm text-muted-foreground">
          A central de configuração da sua conta, organizada por setor. As mudanças valem para toda a conta.
        </p>
      </div>

      <Tabs defaultValue="whatsapp" className="w-full">
        <TabsList className="h-auto w-full flex flex-wrap justify-start gap-1 p-1">
          <TabsTrigger value="whatsapp" className="gap-1.5 text-xs"><Smartphone className="h-3.5 w-3.5" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="feedback" className="gap-1.5 text-xs"><FileClock className="h-3.5 w-3.5" /> Feedback</TabsTrigger>
          <TabsTrigger value="cerebro" className="gap-1.5 text-xs"><Brain className="h-3.5 w-3.5" /> Cérebro</TabsTrigger>
          <TabsTrigger value="diagnostico" className="gap-1.5 text-xs"><Activity className="h-3.5 w-3.5" /> Diagnóstico</TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs"><Target className="h-3.5 w-3.5" /> Meta</TabsTrigger>
          <TabsTrigger value="jose" className="gap-1.5 text-xs"><Megaphone className="h-3.5 w-3.5" /> José</TabsTrigger>
        </TabsList>

        {/* ════ Setor 1 · Operação WhatsApp ════ */}
        <TabsContent value="whatsapp" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4 text-emerald-400" /> Operação WhatsApp</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Reconexão de vendedores, follow-up automático da IA e repasse de leads entre vendedores.</p>
          </div>

      {/* ── Reconexão do vendedor ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <PlugZap className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-base">Lembrete de reconexão do vendedor</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Quando o vendedor fica desconectado, a Logos envia um aviso para ele reconectar.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill tone={cfg.reconexao_enabled ? 'on' : 'off'}>{cfg.reconexao_enabled ? 'Ativo' : 'Desligado'}</StatusPill>
              <Switch checked={cfg.reconexao_enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, reconexao_enabled: v }))} disabled={loading} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className={cfg.reconexao_enabled ? '' : 'opacity-50 pointer-events-none'}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Repetir o lembrete a cada</Label>
                    <Select value={String(cfg.reconexao_intervalo_min)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_intervalo_min: Number(v) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{INTERVALOS.map((i) => <SelectItem key={i.v} value={String(i.v)}>{i.l}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">Só reenvia enquanto o vendedor continuar desconectado.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Só enviar entre (horário de Brasília)</Label>
                    <div className="flex items-center gap-2">
                      <Select value={String(cfg.reconexao_hora_ini)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_hora_ini: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">até</span>
                      <Select value={String(cfg.reconexao_hora_fim)} onValueChange={(v) => setCfg((c) => ({ ...c, reconexao_hora_fim: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.filter((h) => h >= 1).map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Fora dessa janela nenhum lembrete é enviado.</p>
                  </div>
                </div>
              </div>
              {!cfg.reconexao_enabled && <p className="text-xs text-amber-500">Desligado: nenhum lembrete de reconexão será enviado aos vendedores.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarReconexao} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Seletor de agente (follow-up + transferência são por agente) ── */}
      {!loadingAg && agents.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-4">
          <p className="text-xs text-muted-foreground">Nenhum agente de IA configurado ainda. Crie um agente em <span className="font-medium text-foreground">WhatsApp → Agente IA</span> para configurar follow-up e transferência aqui.</p>
        </CardContent></Card>
      ) : (
        <>
          {agents.length > 1 && (
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground">Agente:</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name || 'Agente'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          {/* ── Follow-up da IA ── */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/30">
                    <MessageSquareText className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Follow-up da IA</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Quando o cliente para de responder, a IA manda até 2 mensagens de retomada e depois passa para um vendedor.
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill tone={fu.enabled ? 'on' : 'off'}>{fu.enabled ? 'Ativo' : 'Desligado'}</StatusPill>
                  <Switch checked={fu.enabled} onCheckedChange={(v) => setFu((f) => ({ ...f, enabled: v }))} disabled={loadingAg} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {loadingAg ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
              ) : (
                <>
                  <div className={fu.enabled ? '' : 'opacity-50 pointer-events-none'}>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label className="text-xs">1ª mensagem (min. de inatividade)</Label>
                        <Input type="number" min={1} value={fu.t1} onChange={(e) => setFu((f) => ({ ...f, t1: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">2ª mensagem (min.)</Label>
                        <Input type="number" min={1} value={fu.t2} onChange={(e) => setFu((f) => ({ ...f, t2: Number(e.target.value) }))} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Transferir pro vendedor (min.)</Label>
                        <Input type="number" min={1} value={fu.t3} onChange={(e) => setFu((f) => ({ ...f, t3: Number(e.target.value) }))} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                      <Label className="text-xs">No 3º tempo, transferir para um vendedor</Label>
                      <Switch checked={fu.t3_transfers} onCheckedChange={(v) => setFu((f) => ({ ...f, t3_transfers: v }))} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">A ordem é corrigida automaticamente (1ª &lt; 2ª &lt; transferência).</p>
                  </div>
                  {!fu.enabled && <p className="text-xs text-amber-500">Desligado: a IA não fará follow-up automático dos clientes inativos.</p>}
                  <div className="flex justify-end">
                    <Button onClick={salvarAgente} disabled={savingAg} className="gap-2">
                      {savingAg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ── Transferência pro próximo vendedor ── */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/30">
                    <ArrowRightLeft className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Transferência para o próximo vendedor</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Se o vendedor não confirmar o lead a tempo, a Logos repassa para o próximo da fila.
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusPill tone={tr.enabled ? 'on' : 'off'}>{tr.enabled ? 'Ativo' : 'Desligado'}</StatusPill>
                  <Switch checked={tr.enabled} onCheckedChange={(v) => setTr((t) => ({ ...t, enabled: v }))} disabled={loadingAg} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {!loadingAg && (
                <>
                  <div className={tr.enabled ? '' : 'opacity-50 pointer-events-none'}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-xs">Tempo pro vendedor confirmar (min.)</Label>
                        <Input type="number" min={1} value={tr.seller_min} onChange={(e) => setTr((t) => ({ ...t, seller_min: Number(e.target.value) }))} />
                        <p className="text-[11px] text-muted-foreground">Sem confirmação nesse tempo, o lead passa pro próximo.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Janela de horário do repasse</Label>
                          <Switch checked={tr.window_custom} onCheckedChange={(v) => setTr((t) => ({ ...t, window_custom: v }))} />
                        </div>
                        {tr.window_custom ? (
                          <div className="flex items-center gap-2">
                            <Input type="time" value={tr.start} onChange={(e) => setTr((t) => ({ ...t, start: e.target.value }))} />
                            <span className="text-muted-foreground text-sm">até</span>
                            <Input type="time" value={tr.end} onChange={(e) => setTr((t) => ({ ...t, end: e.target.value }))} />
                          </div>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">Usando a janela padrão da plataforma (seg–sex 10:11–19:29; sáb/dom reduzida). Ligue pra personalizar.</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {!tr.enabled && <p className="text-xs text-amber-500">Desligado: leads não são repassados automaticamente ao próximo vendedor.</p>}
                  <div className="flex justify-end">
                    <Button onClick={salvarAgente} disabled={savingAg} className="gap-2">
                      {savingAg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        {/* ════ Setor 2 · Feedback e Relatórios ════ */}
        <TabsContent value="feedback" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><FileClock className="h-4 w-4 text-amber-400" /> Feedback e Relatórios</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Escolha quando o relatório de atendimento será enviado, o período analisado e quem recebe.</p>
          </div>

      {/* ── Relatório de atendimento (feedback diário no WhatsApp) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30">
                <FileClock className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-base">Relatório de atendimento</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  A Logos envia no WhatsApp o resumo do atendimento: funil, gargalo e desempenho por vendedor.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill tone={cfg.relatorio_atendimento_enabled ? 'on' : 'off'}>{cfg.relatorio_atendimento_enabled ? 'Ativo' : 'Desligado'}</StatusPill>
              <Switch checked={cfg.relatorio_atendimento_enabled} onCheckedChange={(v) => setCfg((c) => ({ ...c, relatorio_atendimento_enabled: v }))} disabled={loading} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className={cfg.relatorio_atendimento_enabled ? 'space-y-4' : 'space-y-4 opacity-50 pointer-events-none'}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Frequência</Label>
                    <Select value={cfg.relatorio_atendimento_frequencia || 'diario'} onValueChange={(v) => setCfg((c: any) => ({ ...c, relatorio_atendimento_frequencia: v, relatorio_atendimento_dias: v === 'diario' ? null : (Array.isArray(c.relatorio_atendimento_dias) && c.relatorio_atendimento_dias.length ? c.relatorio_atendimento_dias : [1]) }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="diario">Todo dia</SelectItem>
                        <SelectItem value="semanal">1x por semana</SelectItem>
                        <SelectItem value="dias_especificos">Dias específicos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Janela de análise do relatório</Label>
                    <Select value={cfg.relatorio_janela_tipo || 'padrao_atual'} onValueChange={(v) => setCfg((c: any) => ({ ...c, relatorio_janela_tipo: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{JANELAS.map((j) => <SelectItem key={j.v} value={j.v}>{j.l}</SelectItem>)}</SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">A janela define quanto tempo de conversa entra no relatório.</p>
                  </div>
                </div>

                {(cfg.relatorio_atendimento_frequencia === 'semanal' || cfg.relatorio_atendimento_frequencia === 'dias_especificos') && (
                  <div className="space-y-2">
                    <Label className="text-xs">{cfg.relatorio_atendimento_frequencia === 'semanal' ? 'Dia da semana' : 'Dias da semana'}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {DIAS_SEMANA.map((d) => {
                        const sel = (cfg.relatorio_atendimento_dias || []).includes(d.v);
                        return (
                          <button key={d.v} type="button"
                            onClick={() => setCfg((c: any) => {
                              const atual: number[] = Array.isArray(c.relatorio_atendimento_dias) ? c.relatorio_atendimento_dias : [];
                              if (c.relatorio_atendimento_frequencia === 'semanal') return { ...c, relatorio_atendimento_dias: [d.v] };
                              return { ...c, relatorio_atendimento_dias: sel ? atual.filter((x) => x !== d.v) : [...atual, d.v] };
                            })}
                            className={cn('rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                              sel ? 'border-primary bg-primary/15 text-primary' : 'border-border/50 bg-background/40 text-muted-foreground hover:border-primary/40')}>
                            {d.l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Horário(s) de envio (Brasília) — clique para marcar mais de um</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {horas.map((h) => {
                      const selecionados: number[] = Array.isArray(cfg.relatorio_atendimento_horarios) && cfg.relatorio_atendimento_horarios.length
                        ? cfg.relatorio_atendimento_horarios : [cfg.relatorio_atendimento_hora ?? 8];
                      const sel = selecionados.includes(h);
                      return (
                        <button key={h} type="button"
                          onClick={() => setCfg((c: any) => {
                            const atual: number[] = Array.isArray(c.relatorio_atendimento_horarios) && c.relatorio_atendimento_horarios.length
                              ? c.relatorio_atendimento_horarios : [c.relatorio_atendimento_hora ?? 8];
                            const novo = sel ? atual.filter((x) => x !== h) : [...atual, h];
                            return { ...c, relatorio_atendimento_horarios: novo.length ? novo : atual };
                          })}
                          className={cn('w-12 rounded-md border px-0 py-1.5 text-xs font-medium transition text-center',
                            sel ? 'border-primary bg-primary/15 text-primary' : 'border-border/50 bg-background/40 text-muted-foreground hover:border-primary/40')}>
                          {String(h).padStart(2, '0')}h
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Sem configuração o padrão continua: todo dia às 08:00.</p>
                </div>

                <p className="text-[11px] text-amber-500/90">💡 Janelas maiores analisam mais conversas e podem aumentar o consumo de IA.</p>
              </div>
              {!cfg.relatorio_atendimento_enabled && <p className="text-xs text-amber-500">Desligado: o relatório de atendimento não será enviado.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarRelatorioAtendimento} disabled={savingRel} className="gap-2">
                  {savingRel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar agenda do relatório
                </Button>
              </div>

              {/* Destinatários */}
              <div className="border-t border-border/40 pt-4">
                <Label className="text-xs flex items-center gap-1.5 mb-3"><Users className="h-3.5 w-3.5" /> Quem recebe este relatório</Label>
                {loadingResp ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
                ) : (
                  <div className="space-y-2">
                    {resp.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum responsável cadastrado ainda. Adicione abaixo.</p>}
                    {resp.map((r) => (
                      <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{r.nome || 'Sem nome'}</p>
                          <p className="text-[11px] text-muted-foreground">{r.whatsapp}</p>
                        </div>
                        <div className="flex items-center gap-4 shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">Relatório</span>
                            <Switch checked={!!r.recebe_atendimento} onCheckedChange={(v) => toggleRecebe(r.id, 'recebe_atendimento', v)} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">Alertas</span>
                            <Switch checked={!!r.recebe_alertas} onCheckedChange={(v) => toggleRecebe(r.id, 'recebe_alertas', v)} />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-1">
                      <Input placeholder="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="sm:max-w-[40%]" />
                      <Input placeholder="WhatsApp com DDD" value={novoWa} onChange={(e) => setNovoWa(e.target.value)} className="sm:max-w-[40%]" />
                      <Button variant="outline" onClick={addResp} disabled={addingResp} className="gap-1.5 shrink-0">
                        {addingResp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Adicionar
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Ligar/desligar aqui só controla este relatório — não remove o responsável da conta. Os mesmos responsáveis aparecem na aba <span className="font-medium text-foreground">Responsáveis</span>.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ════ Setor 3 · Cérebro da Análise ════ */}
        <TabsContent value="cerebro" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-fuchsia-400" /> Cérebro da Análise</h3>
            <p className="text-xs text-muted-foreground mt-0.5">O Cérebro personalizado muda o jeito da IA avaliar os atendimentos. O formato técnico continua protegido pela Logos.</p>
          </div>

      {/* ── Cérebro da análise (camada de inteligência do Feedback) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30">
                <Brain className="h-5 w-5 text-fuchsia-400" />
              </div>
              <div>
                <CardTitle className="text-base">Cérebro da análise</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Diga quem é o especialista, o que ele valoriza e o tom do feedback. Desligado, a análise usa o padrão Logos.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusPill tone={brain.enabled ? 'on' : 'off'}>{brain.enabled ? 'Ativo' : 'Desligado'}</StatusPill>
              <Switch checked={!!brain.enabled} onCheckedChange={(v) => setBrain((b: any) => ({ ...b, enabled: v }))} disabled={loadingBrain} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingBrain ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : (
            <>
              <div className={brain.enabled ? 'space-y-4' : 'space-y-4 opacity-50 pointer-events-none'}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs">Nome do cérebro</Label>
                    <Input maxLength={120} placeholder="Ex.: Especialista em vendas WhatsApp automotivo"
                      value={brain.name || ''} onChange={(e) => setBrain((b: any) => ({ ...b, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Tom do feedback</Label>
                    <Select value={brain.tone || 'direto'} onValueChange={(v) => setBrain((b: any) => ({ ...b, tone: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{TONS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Instruções do especialista <span className="text-muted-foreground">({String(brain.specialist_prompt || '').length}/8000)</span></Label>
                  <Textarea rows={5} maxLength={8000} placeholder="Descreva como o especialista pensa, o que valoriza num atendimento e o contexto do seu negócio…"
                    value={brain.specialist_prompt || ''} onChange={(e) => setBrain((b: any) => ({ ...b, specialist_prompt: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Critérios de avaliação <span className="text-muted-foreground">({String(brain.evaluation_criteria || '').length}/8000)</span></Label>
                  <Textarea rows={4} maxLength={8000} placeholder="O que torna um atendimento nota 90+? O que derruba a nota? Liste os critérios do seu jeito…"
                    value={brain.evaluation_criteria || ''} onChange={(e) => setBrain((b: any) => ({ ...b, evaluation_criteria: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">O que nunca fazer <span className="text-muted-foreground">({String(brain.never_do || '').length}/4000)</span></Label>
                  <Textarea rows={3} maxLength={4000} placeholder="Ex.: nunca elogiar resposta que demorou mais de 1h; nunca sugerir desconto sem autorização…"
                    value={brain.never_do || ''} onChange={(e) => setBrain((b: any) => ({ ...b, never_do: e.target.value }))} />
                </div>
              </div>

              <InfoNote icon={<ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />}>
                O <span className="text-foreground font-medium">formato técnico é protegido</span>: a Logos sempre anexa o formato obrigatório da resposta (nota, sinais, ações do gestor e do vendedor). Seu texto muda o jeito de avaliar, nunca remove o formato. Prompts muito longos podem aumentar o consumo de IA.
              </InfoNote>

              {brainTest && (
                <div className={cn('rounded-lg border px-3 py-2 text-xs space-y-1',
                  brainTest.json_valido ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5')}>
                  <p className="font-medium">
                    {brainTest.json_valido ? '✅ Teste OK — a IA respondeu no formato esperado.' : '❌ Teste falhou — o formato obrigatório não foi respeitado.'}
                    <span className="text-muted-foreground font-normal"> Camada usada: {brainTest.camada_usada} · {brainTest.tokens} tokens · ~US$ {Number(brainTest.custo_usd || 0).toFixed(4)}</span>
                  </p>
                  {!brainTest.json_valido && brainTest.aviso && <p className="text-red-400">{brainTest.aviso}</p>}
                  {brainTest.exemplo?.resumo_executivo && (
                    <p className="text-muted-foreground"><span className="text-foreground">Resumo gerado:</span> {brainTest.exemplo.resumo_executivo}</p>
                  )}
                  {brainTest.exemplo?.frase_coaching && (
                    <p className="text-muted-foreground"><span className="text-foreground">Coaching:</span> {brainTest.exemplo.frase_coaching}</p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" onClick={restaurarPadraoBrain} disabled={savingBrain} className="gap-1.5">
                  <RotateCcw className="h-4 w-4" /> Restaurar padrão Logos
                </Button>
                <Button variant="outline" onClick={testarBrain} disabled={testingBrain} className="gap-1.5">
                  {testingBrain ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />} Testar prompt
                </Button>
                <Button onClick={salvarBrain} disabled={savingBrain} className="gap-2">
                  {savingBrain ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground text-right">O teste roda numa conversa de exemplo — não altera análises reais e não grava nada.</p>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ════ Setor 4 · Saúde e Diagnóstico ════ */}
        <TabsContent value="diagnostico" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4 text-sky-400" /> Saúde e Diagnóstico</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Acompanhe se está tudo rodando: relatórios, análises, custo e envio de eventos à Meta. Somente leitura.</p>
          </div>

      {/* ── Saúde do Cérebro de Feedback ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/30">
                <Activity className="h-5 w-5 text-sky-400" />
              </div>
              <div>
                <CardTitle className="text-base">Saúde do Cérebro e CAPI</CardTitle>
                <CardDescription className="text-xs mt-0.5">Relatórios, análises, custo, confiança, alertas e envio de eventos à Meta.</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!loadingSaude && saude?.rotina && (
                <StatusPill tone={saude.rotina === 'alerta' ? 'warn' : 'ok'}>{saude.rotina === 'alerta' ? 'Atenção' : 'Saudável'}</StatusPill>
              )}
              <Button variant="ghost" size="sm" onClick={recarregarSaude} disabled={loadingSaude} className="gap-1.5">
                {loadingSaude ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSaude ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : !saude ? (
            <p className="text-xs text-muted-foreground">Ainda não há dados de saúde. As métricas aparecem depois das primeiras análises de atendimento.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Última análise"
                value={saude.ultima_analise ? new Date(saude.ultima_analise).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} />
              <StatTile label="Último relatório enviado"
                value={saude?.relatorios?.ultimo_envio ? new Date(saude.relatorios.ultimo_envio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} />
              <StatTile label={`Falhas recentes (${saude.janela_dias ?? 7} dias)`}
                warn={Number(saude?.analises?.falharam) > 0}
                value={`${Number(saude?.analises?.falharam ?? 0)} análise(s) · ${Number(saude?.relatorios?.falhas ?? 0)} relatório(s)`} />
              <StatTile label="Análises pendentes"
                value={Number(saude?.pendentes?.total ?? saude?.pendentes_estimados ?? 0)} />
              {saude.rotina_motivo && (
                <p className="sm:col-span-2 lg:col-span-4 text-[11px] text-muted-foreground">Status: <span className={cn('font-medium', saude.rotina === 'alerta' ? 'text-amber-400' : 'text-emerald-400')}>{saude.rotina === 'alerta' ? 'atenção' : 'saudável'}</span> — {saude.rotina_motivo}</p>
              )}
            </div>
          )}

          {/* ── Saúde executiva (feedback_operational_health, janela 7d) ── */}
          {!loadingSaude && health?.ok && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Relatórios (7 dias)"
                warn={Number(health?.relatorio?.falhas_7d) > 0}
                value={`${Number(health?.relatorio?.enviados_7d ?? 0)} enviado(s) · ${Number(health?.relatorio?.falhas_7d ?? 0)} falha(s)`}
                sub={health?.relatorio?.ultima_falha_em ? `Última falha: ${new Date(health.relatorio.ultima_falha_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : undefined}
                subTitle={String(health?.relatorio?.ultima_falha_erro || '')} />
              <StatTile label="Análises (7 dias)"
                value={<>{Number(health?.analises?.concluidas ?? 0)} ok · {Number(health?.analises?.pendentes ?? 0)} pend. · <span className={Number(health?.analises?.falharam) > 0 ? 'text-amber-400' : ''}>{Number(health?.analises?.falharam ?? 0)} falha(s)</span></>} />
              <StatTile label="Custo da análise (7 dias)"
                value={`${Number(health?.custo?.custo_usd_7d ?? 0) > 0 ? `US$ ${Number(health.custo.custo_usd_7d).toFixed(4)}` : '—'}${Number(health?.custo?.tokens_7d ?? 0) > 0 ? ` · ${Number(health.custo.tokens_7d).toLocaleString('pt-BR')} tokens` : ''}`} />
              <StatTile label="Confiança das análises (7 dias)"
                value={<>{Number(health?.confianca?.alta ?? 0)} alta · {Number(health?.confianca?.media ?? 0)} média · <span className={Number(health?.confianca?.baixa) > 0 ? 'text-amber-400' : ''}>{Number(health?.confianca?.baixa ?? 0)} baixa</span></>} />
              <StatTile className="sm:col-span-2 lg:col-span-2" label="Alertas de risco"
                value={`${Number(health?.alertas?.pendentes ?? 0)} pendente(s) · ${Number(health?.alertas?.enviados_7d ?? 0)} enviado(s) 7d${health?.alertas?.ultimo_envio ? ` · último ${new Date(health.alertas.ultimo_envio).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}`}
                sub={health?.alertas?.ultima_falha_em ? `Última falha: ${new Date(health.alertas.ultima_falha_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : undefined}
                subTitle={String(health?.alertas?.ultima_falha_erro || '')} />
              {/* CAPI (capi_quality_status — leitura; não altera o envio) */}
              <StatTile className="sm:col-span-2 lg:col-span-2" label="Meta CAPI (eventos de qualidade)"
                value={capi?.ok
                  ? (Number(capi?.sent ?? 0) + Number(capi?.pending ?? 0) + Number(capi?.failed ?? 0) === 0
                    ? 'Sem evento enviado ainda'
                    : <>{Number(capi?.sent ?? 0)} enviado(s) · {Number(capi?.pending ?? 0)} pendente(s) · <span className={Number(capi?.failed) > 0 ? 'text-amber-400' : ''}>{Number(capi?.failed ?? 0)} falha(s)</span>{capi?.last_sent_at ? ` · último ${new Date(capi.last_sent_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}</>)
                  : 'Sem evento enviado ainda'}
                sub={capi?.last_failed_at ? `Última falha: ${new Date(capi.last_failed_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${capi?.last_error ? ` — ${String(capi.last_error).slice(0, 80)}` : ''}` : undefined}
                subTitle={String(capi?.last_error || '')} />
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ════ Setor 5 · Meta e Conversões ════ */}
        <TabsContent value="meta" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-violet-400" /> Meta e Conversões</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Esses eventos já são enviados para o seu Pixel. A conversão personalizada precisa ser criada por você na Meta.</p>
          </div>

      {/* ── Conversões personalizadas na Meta (fluxo ASSISTIDO — checklist manual) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/30">
              <Target className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-base">Conversões personalizadas (Meta)</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                A Meta não cria a conversão personalizada sozinha. Crie no Gerenciador de Eventos e marque aqui quando concluir.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {CAPI_QUALITY_EVENTS.map((ev) => {
            const counts = capi?.por_evento?.[ev];
            const st = classifyCapiEventStatus(counts);
            const check = ccheck[ev];
            return (
              <div key={ev} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{ev}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium border',
                      st === 'enviado' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : st === 'falhando' ? 'border-red-500/40 bg-red-500/10 text-red-400'
                      : st === 'pendente' ? 'border-sky-500/40 bg-sky-500/10 text-sky-400'
                      : 'border-border/60 bg-muted/30 text-muted-foreground')}>
                      {CAPI_EVENT_STATUS_LABEL[st]}
                    </span>
                    {Number(counts?.sent ?? 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground">{Number(counts.sent)} envio(s)</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{customConversionInstruction(ev)}</p>
                  {st === 'falhando' && capi?.last_error && (
                    <p className="text-[10px] text-amber-400/80 truncate" title={String(capi.last_error)}>Último erro: {String(capi.last_error).slice(0, 90)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Configurei na Meta</span>
                  <Switch
                    checked={!!check?.marked_configured}
                    disabled={savingCheck === ev || loadingSaude}
                    onCheckedChange={(v) => marcarConversao(ev, v)}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-muted-foreground">
            Passo a passo: Meta Gerenciador de Eventos → Conversões personalizadas → Criar → escolha o Pixel da conta → regra "Evento = nome acima". A marcação é só um checklist seu — nada é criado automaticamente na Meta.
          </p>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ════ Setor 6 · José / Tráfego Pago ════ */}
        <TabsContent value="jose" className="mt-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Megaphone className="h-4 w-4 text-orange-400" /> José / Tráfego Pago</h3>
            <p className="text-xs text-muted-foreground mt-0.5">O resumo diário das campanhas que o José envia no WhatsApp: horário e número que recebe.</p>
          </div>

      {/* ── Relatório do José (campanhas — Fluxo A / apollo_cron_config) ── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/30">
                <Target className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-base">Relatório do José (campanhas)</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Resumo diário do tráfego pago no WhatsApp. Defina se envia, a que horas e para qual número.
                </CardDescription>
              </div>
            </div>
            {jose && (
              <div className="flex items-center gap-2 shrink-0">
                {jose.is_enabled === false && <StatusPill tone="warn">José pausado</StatusPill>}
                <StatusPill tone={jose.send_daily_report ? 'on' : 'off'}>{jose.send_daily_report ? 'Ativo' : 'Desligado'}</StatusPill>
                <Switch checked={!!jose.send_daily_report} onCheckedChange={(v) => setJose((j: any) => ({ ...j, send_daily_report: v }))} disabled={loadingJose} />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadingJose ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : !jose ? (
            <p className="text-xs text-muted-foreground">
              O relatório do José ainda não está configurado nesta conta. Ele é ativado quando você conecta a conta de anúncios e liga o José no painel dele — depois o controle de horário e destinatário aparece aqui.
            </p>
          ) : (
            <>
              <div className={jose.send_daily_report ? '' : 'opacity-50 pointer-events-none'}>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Enviar todo dia às</Label>
                    <div className="flex items-center gap-2">
                      <Select value={String(jose.run_hour ?? 8)} onValueChange={(v) => setJose((j: any) => ({ ...j, run_hour: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{horas.map((h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}h</SelectItem>)}</SelectContent>
                      </Select>
                      <span className="text-muted-foreground text-sm">:</span>
                      <Select value={String(jose.run_minute ?? 0)} onValueChange={(v) => setJose((j: any) => ({ ...j, run_minute: Number(v) }))}>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{[0, 15, 30, 45].map((m) => <SelectItem key={m} value={String(m)}>{String(m).padStart(2, '0')}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Fuso: {jose.timezone || 'America/Sao_Paulo'}. Vale a partir do próximo ciclo.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">WhatsApp que recebe</Label>
                    <Input placeholder="Número com DDD" value={jose.whatsapp_report_number || ''} onChange={(e) => setJose((j: any) => ({ ...j, whatsapp_report_number: e.target.value }))} />
                    <p className="text-[11px] text-muted-foreground">O relatório do José vai para este único número.</p>
                  </div>
                </div>
              </div>
              {!jose.send_daily_report && <p className="text-xs text-amber-500">Desligado: o relatório diário do José não será enviado.</p>}
              {jose.is_enabled === false && <p className="text-xs text-amber-500">Atenção: o José está pausado no painel dele — enquanto isso o relatório não sai, mesmo ligado aqui.</p>}
              <div className="flex justify-end">
                <Button onClick={salvarJose} disabled={savingJose} className="gap-2">
                  {savingJose ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
