// ============================================================================
// FunilDoAgenteTab — configuração estruturada de 9 blocos do agente SDR
// ----------------------------------------------------------------------------
// Renderiza dentro da aba "Agente IA" do Pedro (master). Permite ao master
// configurar o funil em 8 acordeons (BLOCO 2 é fixo, não editável). Ao salvar,
// chama a edge function generate-agent-funnel-prompt que monta o system_prompt
// final e sobrescreve wa_ai_agents.system_prompt (com backup automático).
//
// Botão "Restaurar Prompt Anterior" → rollback 1-clique.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
// Dialog do shadcn removido: causa conflito Radix quando usado dentro de
// outro Dialog (AgentFormDialog). Preview do prompt agora é Card inline.
import {
  Loader2,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Sparkles,
  ShieldCheck,
  Brain,
  Eye,
  AlertCircle,
  Wand2,
} from 'lucide-react';

// ── Tipos dos blocos ────────────────────────────────────────────────────────
interface Bloco1 { agent_name: string; role: string; company: string; niche: string; }
interface Bloco3 { objective: string; presentation: string; first_question: string; avoid: string[]; }
interface Bloco4 { objective: string; questions: string[]; required_data: string[]; }
interface Branch { trigger: string; questions: string[]; }
interface Bloco5 { branches: Branch[]; }
interface Bloco6 { qualified_when: string[]; disqualified_when: string[]; closing_message: string; }
interface Bloco7 { required_data: string[]; customer_message: string; internal_summary_template: string; }
interface Bloco8 { always: string[]; never: string[]; }
interface Bloco9 { name: string; address: string; hours: string; website: string; price_range: string; differentiators: string; }

interface FunnelConfig {
  bloco1_identidade: Bloco1;
  bloco3_abordagem: Bloco3;
  bloco4_qualificacao: Bloco4;
  bloco5_ramificacoes: Bloco5;
  bloco6_criterios: Bloco6;
  bloco7_transferencia: Bloco7;
  bloco8_regras: Bloco8;
  bloco9_empresa: Bloco9;
}

const DEFAULT_CONFIG: FunnelConfig = {
  bloco1_identidade: { agent_name: '', role: '', company: '', niche: '' },
  bloco3_abordagem: { objective: '', presentation: '', first_question: '', avoid: [] },
  bloco4_qualificacao: { objective: '', questions: [], required_data: [] },
  bloco5_ramificacoes: { branches: [] },
  bloco6_criterios: { qualified_when: [], disqualified_when: [], closing_message: '' },
  bloco7_transferencia: { required_data: [], customer_message: '', internal_summary_template: '' },
  bloco8_regras: { always: [], never: [] },
  bloco9_empresa: { name: '', address: '', hours: '', website: '', price_range: '', differentiators: '' },
};

// ── Auto-seed: pré-preenche o funil com dados que o agente JÁ TEM em wa_ai_agents
// Roda quando o usuário abre o Funil pela primeira vez (sem config salva ainda).
// Aproveita: name, company_name, services, address, sdr_goal, qualification_questions.
// Campos vazios o usuário preenche depois.
function seedConfigFromAgent(agent: any): FunnelConfig {
  const name = (agent?.name || '').trim();
  const company = (agent?.company_name || '').trim();
  const address = (agent?.address || '').trim();
  const services = (agent?.services || '').trim();
  const sdrGoal = (agent?.sdr_goal || '').trim();
  const qq: string[] = Array.isArray(agent?.qualification_questions)
    ? agent.qualification_questions.filter((q: any) => typeof q === 'string' && q.trim())
    : [];

  return {
    bloco1_identidade: {
      agent_name: name,
      role: 'consultor de vendas',
      company,
      niche: '',
    },
    bloco3_abordagem: {
      objective: 'Criar conexão e identificar o cliente',
      presentation: name && company ? `Oi! Sou o ${name}, da ${company} 😊` : '',
      first_question: 'Você é de qual cidade?',
      avoid: ['Falar preço antes de qualificar', 'Pressionar o cliente', 'Pular etapas do funil'],
    },
    bloco4_qualificacao: {
      objective: 'Entender o perfil e necessidade do cliente',
      questions: qq.length > 0 ? qq : ['Qual é o seu nome?', 'O que você está procurando?'],
      required_data: ['Nome completo', 'Contato (telefone)', 'Interesse específico'],
    },
    bloco5_ramificacoes: { branches: [] },
    bloco6_criterios: {
      qualified_when: ['Tem interesse real de compra', 'Tem condições financeiras compatíveis', 'Forneceu todos os dados obrigatórios'],
      disqualified_when: ['Sem condições financeiras mínimas no momento'],
      closing_message: '{nome}, prefiro ser honesto com você — no momento talvez não seja o melhor cenário, mas pode me chamar quando a situação mudar 😊',
    },
    bloco7_transferencia: {
      required_data: ['Nome completo', 'Contato (telefone)', 'Interesse específico'],
      customer_message: name && company
        ? `{nome}, vou te conectar agora com nosso especialista da ${company}! 🤝`
        : '{nome}, vou te conectar agora com nosso especialista! 🤝',
      internal_summary_template: company
        ? `🔔 NOVO LEAD QUALIFICADO — ${company}\nNome: {nome}\nContato: {telefone}\nInteresse: {interesse}\nTemperatura: (FRIO/MORNO/QUENTE)\nObservações: (contexto da conversa)`
        : `🔔 NOVO LEAD QUALIFICADO\nNome: {nome}\nContato: {telefone}\nInteresse: {interesse}\nTemperatura: (FRIO/MORNO/QUENTE)\nObservações: (contexto da conversa)`,
    },
    bloco8_regras: {
      always: ['Tratar o cliente pelo nome assim que souber', 'Variar tom e aberturas das mensagens'],
      never: ['Dar desconto sem consultar o vendedor', 'Prometer prazo de entrega sem confirmar'],
    },
    bloco9_empresa: {
      name: company,
      address,
      hours: '',
      website: '',
      price_range: '',
      differentiators: services || (sdrGoal ? `Objetivo: ${sdrGoal}` : ''),
    },
  };
}

// ── Helpers de UI para arrays editáveis ─────────────────────────────────────
function ArrayEditor({
  label,
  items,
  onChange,
  placeholder = 'Adicionar item...',
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="text-xs h-8"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-red-400 hover:text-red-300"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onChange([...items, draft.trim()]);
                setDraft('');
              }
            }}
            placeholder={placeholder}
            className="text-xs h-8"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-blue-400 hover:text-blue-300"
            onClick={() => {
              if (draft.trim()) {
                onChange([...items, draft.trim()]);
                setDraft('');
              }
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────────────────────

interface FunilDoAgenteTabProps {
  agentId: string;          // wa_ai_agents.id
  userId: string;           // master user_id
}

export default function FunilDoAgenteTab({ agentId, userId }: FunilDoAgenteTabProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [useFunnelConfig, setUseFunnelConfig] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [cfg, setCfg] = useState<FunnelConfig>(DEFAULT_CONFIG);

  // ── Autosave: salva alterações automaticamente em background a cada 2s
  // sem digitação. NÃO gera prompt (só persiste no agent_funnel_config).
  // Garantia: mesmo que modal feche, navegação ocorra ou aba seja trocada,
  // os blocos preenchidos ficam salvos no DB. Pra usar prompt novo na IA,
  // usuário ainda precisa clicar "Salvar e Gerar Prompt".
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const cfgInitializedRef = useRef(false);  // só autosaveia depois do load inicial
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!agentId || !userId || !cfgInitializedRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setAutosaveStatus('saving');
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const { error: upErr } = await (supabase as any)
          .from('agent_funnel_config')
          .upsert({ agent_id: agentId, user_id: userId, ...cfg }, { onConflict: 'agent_id' });
        if (upErr) throw upErr;
        setAutosaveStatus('saved');
        // Volta pra idle após 2s pra UI não ficar permanente
        setTimeout(() => setAutosaveStatus('idle'), 2000);
      } catch {
        setAutosaveStatus('error');
      }
    }, 2000);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [cfg, agentId, userId]);

  // Aviso ao tentar fechar a aba/janela com mudanças não salvas pendentes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (autosaveStatus === 'saving' || autosaveStatus === 'error') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autosaveStatus]);

  // Preview do prompt gerado
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState('');

  // Validação: blocos críticos pra IA funcionar bem (não bloqueiam, só avisam)
  const validation = useMemo(() => {
    const missing: string[] = [];
    if (!cfg.bloco1_identidade.agent_name?.trim()) missing.push('Bloco 1: Nome do agente');
    if (!cfg.bloco1_identidade.company?.trim()) missing.push('Bloco 1: Empresa');
    if (!cfg.bloco3_abordagem.presentation?.trim()) missing.push('Bloco 3: Apresentação inicial');
    if (!cfg.bloco3_abordagem.first_question?.trim()) missing.push('Bloco 3: Primeira pergunta');
    if (!cfg.bloco4_qualificacao.questions || cfg.bloco4_qualificacao.questions.length === 0)
      missing.push('Bloco 4: Pelo menos 1 pergunta de qualificação');
    if (!cfg.bloco7_transferencia.required_data || cfg.bloco7_transferencia.required_data.length === 0)
      missing.push('Bloco 7: Dados obrigatórios para transferência');
    if (!cfg.bloco7_transferencia.customer_message?.trim()) missing.push('Bloco 7: Mensagem ao cliente');
    if (!cfg.bloco9_empresa.name?.trim()) missing.push('Bloco 9: Nome da empresa');
    return { isValid: missing.length === 0, missing };
  }, [cfg]);

  // ── Carrega config existente + status do agente ───────────────────────────
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1) Carrega DADOS COMPLETOS do agente (precisamos pra fazer auto-seed
        //    se a config ainda não foi salva).
        const { data: agent } = await (supabase as any)
          .from('wa_ai_agents')
          .select('name, company_name, services, address, sdr_goal, qualification_questions, use_funnel_config, system_prompt_backup')
          .eq('id', agentId)
          .maybeSingle();
        if (!cancelled && agent) {
          setUseFunnelConfig(!!agent.use_funnel_config);
          setHasBackup(!!agent.system_prompt_backup);
        }

        // 2) Config do funil (pode não existir ainda)
        const { data: cfgRow } = await (supabase as any)
          .from('agent_funnel_config')
          .select('*')
          .eq('agent_id', agentId)
          .maybeSingle();

        if (cancelled) return;

        if (cfgRow) {
          // Config já salva — usa ela
          setCfg({
            bloco1_identidade: { ...DEFAULT_CONFIG.bloco1_identidade, ...(cfgRow.bloco1_identidade || {}) },
            bloco3_abordagem: { ...DEFAULT_CONFIG.bloco3_abordagem, ...(cfgRow.bloco3_abordagem || {}) },
            bloco4_qualificacao: { ...DEFAULT_CONFIG.bloco4_qualificacao, ...(cfgRow.bloco4_qualificacao || {}) },
            bloco5_ramificacoes: { ...DEFAULT_CONFIG.bloco5_ramificacoes, ...(cfgRow.bloco5_ramificacoes || {}) },
            bloco6_criterios: { ...DEFAULT_CONFIG.bloco6_criterios, ...(cfgRow.bloco6_criterios || {}) },
            bloco7_transferencia: { ...DEFAULT_CONFIG.bloco7_transferencia, ...(cfgRow.bloco7_transferencia || {}) },
            bloco8_regras: { ...DEFAULT_CONFIG.bloco8_regras, ...(cfgRow.bloco8_regras || {}) },
            bloco9_empresa: { ...DEFAULT_CONFIG.bloco9_empresa, ...(cfgRow.bloco9_empresa || {}) },
          });
        } else if (agent) {
          // Sem config ainda — aplica seed automático com dados do agente
          const seeded = seedConfigFromAgent(agent);
          setCfg(seeded);
          toast({
            title: '🪄 Funil pré-preenchido',
            description: 'Usamos os dados do agente como base. Revise os blocos e clique em Salvar e Gerar Prompt.',
          });
        }
        // Marca que carga inicial terminou — daqui pra frente, qualquer
        // mudança em `cfg` dispara autosave. (Sem isso, autosave dispararia
        // imediatamente após load com dados que vieram do próprio DB.)
        cfgInitializedRef.current = true;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // toast intencionalmente fora das deps — useToast retorna função estável
    // e incluí-la causaria loops em alguns ambientes (re-render → setLoading
    // → re-render). Lint suprimido pra preservar essa decisão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // ── Salvar config + gerar prompt ──────────────────────────────────────────
  const handleSaveAndGenerate = async () => {
    if (!agentId || !userId) return;
    setSaving(true);
    try {
      // Upsert config
      const { error: upErr } = await (supabase as any)
        .from('agent_funnel_config')
        .upsert({
          agent_id: agentId,
          user_id: userId,
          ...cfg,
        }, { onConflict: 'agent_id' });
      if (upErr) throw upErr;

      // Chama edge function pra gerar e sobrescrever o system_prompt
      const { data, error } = await supabase.functions.invoke('generate-agent-funnel-prompt', {
        body: { action: 'generate', agent_id: agentId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setUseFunnelConfig(true);
      if (data?.backup_created) setHasBackup(true);

      toast({
        title: '✅ Funil salvo e prompt gerado',
        description: `O agente agora usa a configuração do funil (${data?.prompt_length || '?'} chars).`,
      });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Re-aplicar seed dos dados do agente (sobrescreve cfg local sem salvar) ──
  const handleReseed = async () => {
    if (!agentId) return;
    if (!confirm('Sobrescrever o que está preenchido com os dados originais do agente? Suas alterações nos blocos serão perdidas (mas a config salva no banco continua intacta até você clicar em Salvar).')) return;
    try {
      const { data: agent } = await (supabase as any)
        .from('wa_ai_agents')
        .select('name, company_name, services, address, sdr_goal, qualification_questions')
        .eq('id', agentId)
        .maybeSingle();
      if (!agent) {
        toast({ title: 'Agente não encontrado', variant: 'destructive' });
        return;
      }
      setCfg(seedConfigFromAgent(agent));
      toast({ title: '🪄 Funil re-preenchido com os dados do agente' });
    } catch (err: any) {
      toast({ title: 'Erro ao re-preencher', description: err.message, variant: 'destructive' });
    }
  };

  // ── Preview do prompt gerado (lê o atual do agente OU mostra gerado on-the-fly) ──
  const handlePreview = async () => {
    if (!agentId) return;
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      // 1) Tenta ler o prompt gerado da tabela agent_funnel_config (último salvo)
      const { data: cfgRow } = await (supabase as any)
        .from('agent_funnel_config')
        .select('generated_system_prompt')
        .eq('agent_id', agentId)
        .maybeSingle();

      if (cfgRow?.generated_system_prompt) {
        setPreviewText(cfgRow.generated_system_prompt);
        return;
      }

      // 2) Fallback: lê o system_prompt atual do agente (pode ser manual)
      const { data: agent } = await (supabase as any)
        .from('wa_ai_agents')
        .select('system_prompt')
        .eq('id', agentId)
        .maybeSingle();
      setPreviewText(
        agent?.system_prompt
        || '(O funil ainda não foi gerado. Clique em "Salvar e Gerar Prompt" pra criar.)'
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Restaurar prompt anterior (rollback) ──────────────────────────────────
  const handleRestore = async () => {
    if (!agentId) return;
    if (!confirm('Restaurar o prompt anterior? O funil configurado continua salvo, mas o agente voltará a usar o prompt antigo.')) return;
    setRestoring(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-agent-funnel-prompt', {
        body: { action: 'restore', agent_id: agentId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setUseFunnelConfig(false);
      toast({ title: '↩️ Prompt anterior restaurado', description: 'O agente voltou ao prompt original.' });
    } catch (err: any) {
      toast({ title: 'Erro ao restaurar', description: err.message, variant: 'destructive' });
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header com status + ações */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-cyan-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4 text-blue-400" />
                Funil do Agente
              </CardTitle>
              <CardDescription className="text-xs">
                Configure os 9 blocos da estrutura SDR. Ao salvar, geramos um system prompt
                otimizado com diretriz de inteligência adaptativa.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {useFunnelConfig ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                  <Sparkles className="h-2.5 w-2.5 mr-1" /> Funil ativo
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  Usando prompt manual
                </Badge>
              )}
              {hasBackup && (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                  <ShieldCheck className="h-2.5 w-2.5 mr-1" /> Backup disponível
                </Badge>
              )}
              {/* Status do autosave — visível pra usuário saber que está protegido */}
              {autosaveStatus === 'saving' && (
                <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400">
                  <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" /> Salvando rascunho...
                </Badge>
              )}
              {autosaveStatus === 'saved' && (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                  ✓ Rascunho salvo
                </Badge>
              )}
              {autosaveStatus === 'error' && (
                <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
                  ⚠ Erro no autosave
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {/* Alerta de campos faltando */}
          {!validation.isValid && (
            <div className="flex items-start gap-2 p-2 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-300/90">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="text-[11px] leading-relaxed">
                <span className="font-medium">Campos recomendados não preenchidos ({validation.missing.length}):</span>{' '}
                {validation.missing.slice(0, 3).join(' · ')}
                {validation.missing.length > 3 && ` · +${validation.missing.length - 3} outros`}
                <div className="text-[10px] text-amber-300/60 mt-0.5">
                  Você pode salvar mesmo assim, mas a IA pode ter respostas com lacunas.
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={handleSaveAndGenerate}
              disabled={saving}
              className="text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar e Gerar Prompt
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreview}
              className="text-xs gap-1.5"
            >
              <Eye className="h-3.5 w-3.5" />
              Ver Prompt Gerado
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReseed}
              className="text-xs gap-1.5 text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
              title="Reaproveita nome, empresa, endereço, sdr_goal e qualification_questions do agente"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Auto-preencher do Agente
            </Button>
            {hasBackup && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestore}
                disabled={restoring}
                className="text-xs gap-1.5"
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Restaurar Prompt Anterior
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 2 — Comportamento Obrigatório (READ-ONLY, fixo) */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs flex items-center gap-2 text-amber-400">
            <ShieldCheck className="h-3.5 w-3.5" /> BLOCO 2 — Comportamento Obrigatório (FIXO)
          </CardTitle>
          <CardDescription className="text-[11px]">
            Regras que sempre se aplicam, independente do nicho. Não editáveis.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
            <li>Uma mensagem curta por vez (1–2 linhas), direto ao ponto</li>
            <li>Uma pergunta por mensagem, só se avança a qualificação — pode terminar SEM pergunta</li>
            <li>Sem pergunta-isca genérica e sem elogiar o cliente ou o produto</li>
            <li>Nunca pressiona; lê o tom e desqualifica lead frio/hostil (1 resgate, depois encerra)</li>
            <li>Nunca fala preço antes de qualificar, nunca tenta fechar a venda</li>
            <li>Trata o cliente pelo nome quando souber e varia o tom (não repete frases)</li>
          </ul>
        </CardContent>
      </Card>

      {/* Acordeons editáveis */}
      <Accordion type="multiple" defaultValue={['bloco1']} className="space-y-2">

        {/* BLOCO 1 — IDENTIDADE */}
        <AccordionItem value="bloco1" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">1</Badge>
              Identidade do Agente
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome do agente</Label>
                <Input
                  value={cfg.bloco1_identidade.agent_name}
                  onChange={(e) => setCfg({ ...cfg, bloco1_identidade: { ...cfg.bloco1_identidade, agent_name: e.target.value } })}
                  placeholder="Ex: Carvalho"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Cargo</Label>
                <Input
                  value={cfg.bloco1_identidade.role}
                  onChange={(e) => setCfg({ ...cfg, bloco1_identidade: { ...cfg.bloco1_identidade, role: e.target.value } })}
                  placeholder="Ex: consultor de vendas"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Empresa</Label>
                <Input
                  value={cfg.bloco1_identidade.company}
                  onChange={(e) => setCfg({ ...cfg, bloco1_identidade: { ...cfg.bloco1_identidade, company: e.target.value } })}
                  placeholder="Ex: Icom Motors"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Nicho</Label>
                <Input
                  value={cfg.bloco1_identidade.niche}
                  onChange={(e) => setCfg({ ...cfg, bloco1_identidade: { ...cfg.bloco1_identidade, niche: e.target.value } })}
                  placeholder="Ex: automóveis seminovos"
                  className="text-xs h-8"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 3 — ABORDAGEM */}
        <AccordionItem value="bloco3" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">3</Badge>
              Etapa 1 — Abordagem
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Objetivo da etapa</Label>
              <Input
                value={cfg.bloco3_abordagem.objective}
                onChange={(e) => setCfg({ ...cfg, bloco3_abordagem: { ...cfg.bloco3_abordagem, objective: e.target.value } })}
                placeholder="Ex: Criar conexão e identificar o cliente"
                className="text-xs h-8"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Apresentação na primeira mensagem</Label>
              <Textarea
                value={cfg.bloco3_abordagem.presentation}
                onChange={(e) => setCfg({ ...cfg, bloco3_abordagem: { ...cfg.bloco3_abordagem, presentation: e.target.value } })}
                placeholder="Ex: Oi! Sou o Carvalho, da Icom Motors 😊"
                className="text-xs min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Primeira pergunta de conexão</Label>
              <Input
                value={cfg.bloco3_abordagem.first_question}
                onChange={(e) => setCfg({ ...cfg, bloco3_abordagem: { ...cfg.bloco3_abordagem, first_question: e.target.value } })}
                placeholder="Ex: Você é de qual cidade?"
                className="text-xs h-8"
              />
            </div>
            <ArrayEditor
              label="O que NÃO fazer nesta etapa"
              items={cfg.bloco3_abordagem.avoid}
              onChange={(avoid) => setCfg({ ...cfg, bloco3_abordagem: { ...cfg.bloco3_abordagem, avoid } })}
              placeholder="Ex: Não falar preço"
            />
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 4 — QUALIFICAÇÃO */}
        <AccordionItem value="bloco4" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">4</Badge>
              Etapa 2 — Qualificação
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div>
              <Label className="text-xs text-muted-foreground">Objetivo da etapa</Label>
              <Input
                value={cfg.bloco4_qualificacao.objective}
                onChange={(e) => setCfg({ ...cfg, bloco4_qualificacao: { ...cfg.bloco4_qualificacao, objective: e.target.value } })}
                placeholder="Ex: Entender o perfil e necessidade do cliente"
                className="text-xs h-8"
              />
            </div>
            <ArrayEditor
              label="Perguntas obrigatórias (na ordem)"
              items={cfg.bloco4_qualificacao.questions}
              onChange={(questions) => setCfg({ ...cfg, bloco4_qualificacao: { ...cfg.bloco4_qualificacao, questions } })}
              placeholder="Ex: Qual é o seu nome?"
            />
            <ArrayEditor
              label="Dados obrigatórios a coletar"
              items={cfg.bloco4_qualificacao.required_data}
              onChange={(required_data) => setCfg({ ...cfg, bloco4_qualificacao: { ...cfg.bloco4_qualificacao, required_data } })}
              placeholder="Ex: Nome completo"
            />
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 5 — RAMIFICAÇÕES */}
        <AccordionItem value="bloco5" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">5</Badge>
              Ramificações do Funil
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <p className="text-[11px] text-muted-foreground">
              Defina ramos: cada ramo tem um <span className="text-blue-400">gatilho</span> (resposta do cliente)
              e perguntas específicas que vêm depois.
            </p>
            {cfg.bloco5_ramificacoes.branches.map((br, i) => (
              <Card key={i} className="border-border/40 bg-background/50">
                <CardContent className="pt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={br.trigger}
                      onChange={(e) => {
                        const next = [...cfg.bloco5_ramificacoes.branches];
                        next[i] = { ...next[i], trigger: e.target.value };
                        setCfg({ ...cfg, bloco5_ramificacoes: { branches: next } });
                      }}
                      placeholder="Gatilho (ex: Financiamento)"
                      className="text-xs h-8 font-medium"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-red-400 hover:text-red-300"
                      onClick={() => setCfg({
                        ...cfg,
                        bloco5_ramificacoes: { branches: cfg.bloco5_ramificacoes.branches.filter((_, idx) => idx !== i) },
                      })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <ArrayEditor
                    label="Perguntas neste ramo"
                    items={br.questions}
                    onChange={(questions) => {
                      const next = [...cfg.bloco5_ramificacoes.branches];
                      next[i] = { ...next[i], questions };
                      setCfg({ ...cfg, bloco5_ramificacoes: { branches: next } });
                    }}
                    placeholder="Ex: Qual sua idade?"
                  />
                </CardContent>
              </Card>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCfg({
                ...cfg,
                bloco5_ramificacoes: { branches: [...cfg.bloco5_ramificacoes.branches, { trigger: '', questions: [] }] },
              })}
              className="text-xs gap-1.5 w-full"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar ramificação
            </Button>
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 6 — CRITÉRIOS */}
        <AccordionItem value="bloco6" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">6</Badge>
              Critérios de Qualificação
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <ArrayEditor
              label="✅ Lead QUALIFICADO quando..."
              items={cfg.bloco6_criterios.qualified_when}
              onChange={(qualified_when) => setCfg({ ...cfg, bloco6_criterios: { ...cfg.bloco6_criterios, qualified_when } })}
              placeholder="Ex: Tem orçamento compatível"
            />
            <Separator />
            <ArrayEditor
              label="❌ Lead DESQUALIFICADO quando..."
              items={cfg.bloco6_criterios.disqualified_when}
              onChange={(disqualified_when) => setCfg({ ...cfg, bloco6_criterios: { ...cfg.bloco6_criterios, disqualified_when } })}
              placeholder="Ex: Menor de 18 anos"
            />
            <div>
              <Label className="text-xs text-muted-foreground">Mensagem para encerrar lead desqualificado</Label>
              <Textarea
                value={cfg.bloco6_criterios.closing_message}
                onChange={(e) => setCfg({ ...cfg, bloco6_criterios: { ...cfg.bloco6_criterios, closing_message: e.target.value } })}
                placeholder="Ex: (nome), prefiro ser honesto com você. No momento talvez não seja..."
                className="text-xs min-h-[70px]"
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 7 — TRANSFERÊNCIA */}
        <AccordionItem value="bloco7" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">7</Badge>
              Etapa 3 — Transferência
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <ArrayEditor
              label="Dados obrigatórios para transferir"
              items={cfg.bloco7_transferencia.required_data}
              onChange={(required_data) => setCfg({ ...cfg, bloco7_transferencia: { ...cfg.bloco7_transferencia, required_data } })}
              placeholder="Ex: Nome completo"
            />
            <div>
              <Label className="text-xs text-muted-foreground">Mensagem para o cliente ao transferir</Label>
              <Textarea
                value={cfg.bloco7_transferencia.customer_message}
                onChange={(e) => setCfg({ ...cfg, bloco7_transferencia: { ...cfg.bloco7_transferencia, customer_message: e.target.value } })}
                placeholder="Ex: (nome), vou te conectar agora com nosso especialista! 🤝"
                className="text-xs min-h-[60px]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Template do resumo interno (vendedor)</Label>
              <Textarea
                value={cfg.bloco7_transferencia.internal_summary_template}
                onChange={(e) => setCfg({ ...cfg, bloco7_transferencia: { ...cfg.bloco7_transferencia, internal_summary_template: e.target.value } })}
                placeholder="Ex: 🔔 NOVO LEAD — Icom Motors&#10;Nome: (nome)&#10;Contato: (telefone)&#10;Modelo: (interesse)..."
                className="text-xs min-h-[100px] font-mono"
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 8 — REGRAS ESPECÍFICAS */}
        <AccordionItem value="bloco8" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">8</Badge>
              Regras Específicas do Negócio
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <ArrayEditor
              label="O agente SEMPRE deve..."
              items={cfg.bloco8_regras.always}
              onChange={(always) => setCfg({ ...cfg, bloco8_regras: { ...cfg.bloco8_regras, always } })}
              placeholder="Ex: Mencionar o endereço completo"
            />
            <ArrayEditor
              label="O agente NUNCA deve..."
              items={cfg.bloco8_regras.never}
              onChange={(never) => setCfg({ ...cfg, bloco8_regras: { ...cfg.bloco8_regras, never } })}
              placeholder="Ex: Dar desconto sem consultar"
            />
          </AccordionContent>
        </AccordionItem>

        {/* BLOCO 9 — EMPRESA */}
        <AccordionItem value="bloco9" className="border border-border/50 rounded-lg px-3">
          <AccordionTrigger className="text-xs hover:no-underline">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">9</Badge>
              Informações da Empresa
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Nome da empresa</Label>
                <Input
                  value={cfg.bloco9_empresa.name}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, name: e.target.value } })}
                  placeholder="Icom Motors"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Horário</Label>
                <Input
                  value={cfg.bloco9_empresa.hours}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, hours: e.target.value } })}
                  placeholder="Seg a Sáb 9h às 19h"
                  className="text-xs h-8"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Endereço completo</Label>
                <Input
                  value={cfg.bloco9_empresa.address}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, address: e.target.value } })}
                  placeholder="Av. Charles Schneider, 1700 — Taubaté Shopping"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Site / Instagram</Label>
                <Input
                  value={cfg.bloco9_empresa.website}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, website: e.target.value } })}
                  placeholder="@icommotors"
                  className="text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Faixa de preço</Label>
                <Input
                  value={cfg.bloco9_empresa.price_range}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, price_range: e.target.value } })}
                  placeholder="R$ 60.000 a R$ 200.000"
                  className="text-xs h-8"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs text-muted-foreground">Diferenciais</Label>
                <Textarea
                  value={cfg.bloco9_empresa.differentiators}
                  onChange={(e) => setCfg({ ...cfg, bloco9_empresa: { ...cfg.bloco9_empresa, differentiators: e.target.value } })}
                  placeholder="Garantia de 3 meses, laudo incluso, transferência facilitada..."
                  className="text-xs min-h-[60px]"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* Botão final (mesmo do header, pra usuário não ter que rolar pra cima) */}
      <div className="flex flex-wrap justify-end gap-2 pt-2 pb-6">
        <Button
          size="sm"
          variant="outline"
          onClick={handlePreview}
          className="text-xs gap-1.5"
        >
          <Eye className="h-3.5 w-3.5" />
          Ver Prompt Gerado
        </Button>
        {hasBackup && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRestore}
            disabled={restoring}
            className="text-xs gap-1.5"
          >
            {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Restaurar Prompt Anterior
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSaveAndGenerate}
          disabled={saving}
          className="text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar e Gerar Prompt
        </Button>
      </div>

      {/* Preview INLINE do prompt gerado (não Dialog aninhado — Radix tem
          conflitos com Dialog dentro de Dialog que faziam o conteúdo do
          Funil sumir quando aberto dentro do AgentFormDialog). */}
      {previewOpen && (
        <Card className="border-blue-500/30 bg-card/95 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Eye className="h-4 w-4 text-blue-400" />
                  Prompt gerado — o que a IA recebe
                </CardTitle>
                <CardDescription className="text-[11px]">
                  Conteúdo atual de <code className="text-blue-400">wa_ai_agents.system_prompt</code>.
                </CardDescription>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(previewText);
                    toast({ title: '📋 Prompt copiado' });
                  }}
                  disabled={previewLoading || !previewText}
                  className="text-xs h-7"
                >
                  Copiar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPreviewOpen(false)} className="text-xs h-7">
                  Fechar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-border/50 bg-muted/30 p-3 max-h-[400px] overflow-auto">
              {previewLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                </div>
              ) : (
                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                  {previewText}
                </pre>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
              {previewText.length.toLocaleString()} caracteres
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
