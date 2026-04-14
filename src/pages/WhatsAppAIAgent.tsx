import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, Plus, Loader2, MessageSquare, Sparkles, Trash2, Edit2, Copy, Webhook,
  Brain, Zap, BookOpen, Shield, Globe, ChevronRight, MoreVertical,
  Activity, Users, Clock, CheckCircle2, XCircle, Database,
} from 'lucide-react';
import { AgentFormDialog } from '@/components/whatsapp/AgentFormDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GlobalLeadsCrm } from '@/components/whatsapp/GlobalLeadsCrm';

interface AIAgent {
  id: string;
  name: string;
  system_prompt: string;
  is_active: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  reply_delay_ms: number;
  business_hours_only: boolean;
  business_hours_start: string;
  business_hours_end: string;
  blocked_categories: string[];
  total_replies: number;
  instance_id: string | null;
  instance_ids: string[];
  created_at: string;
  agent_type?: string;
  company_name?: string;
  services?: string;
  address?: string;
  human_whatsapp?: string;
  n8n_webhook_url?: string;
  avatar_url?: string;
  description?: string;
  rag_restricted?: boolean;
  prompt_protection?: boolean;
  context_size?: string;
}

interface Instance {
  id: string;
  friendly_name: string;
  instance_name: string;
  is_active: boolean;
  provider: string;
}

const MODEL_LABELS: Record<string, { short: string; color: string }> = {
  'openai/gpt-4o': { short: 'GPT-4o', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  'openai/gpt-4o-mini': { short: 'GPT-4o Mini', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  'google/gemini-2.0-flash': { short: 'Gemini Flash', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'google/gemini-3-flash-preview': { short: 'Gemini 3', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'anthropic/claude-3-5-sonnet': { short: 'Claude 3.5', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  'deepseek/deepseek-v3': { short: 'DeepSeek V3', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
};

const AGENT_TYPE_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  sdr: { emoji: '📞', label: 'SDR', color: 'text-teal-400' },
  support: { emoji: '🛠️', label: 'Suporte', color: 'text-blue-400' },
  sales: { emoji: '💰', label: 'Vendas', color: 'text-yellow-400' },
  generic: { emoji: '🤖', label: 'Genérico', color: 'text-slate-400' },
};

function AgentAvatar({ agent }: { agent: AIAgent }) {
  const typeConfig = AGENT_TYPE_CONFIG[agent.agent_type || 'generic'];
  const initials = agent.name.slice(0, 2).toUpperCase();

  if (agent.avatar_url) {
    return (
      <div className="relative">
        <img src={agent.avatar_url} alt={agent.name} className="w-12 h-12 rounded-xl object-cover" />
        <span className={`absolute -bottom-1 -right-1 text-lg`}>{typeConfig.emoji}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-sm
        ${agent.is_active
          ? 'bg-gradient-to-br from-primary/30 to-primary/10 text-primary border border-primary/30'
          : 'bg-muted text-muted-foreground'}`}>
        {initials}
      </div>
      <span className="absolute -bottom-1 -right-1 text-base">{typeConfig.emoji}</span>
    </div>
  );
}

function TokenBar({ used, max = 15000 }: { used: number; max?: number }) {
  const pct = Math.min((used / max) * 100, 100);
  const color = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-primary';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Prompt</span>
        <span className={pct > 80 ? 'text-red-400' : ''}>{used.toLocaleString()} / {(max / 1000).toFixed(0)}k</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  instances,
  agents,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
}: {
  agent: AIAgent;
  instances: Instance[];
  agents: AIAgent[];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const modelInfo = MODEL_LABELS[agent.model] || { short: agent.model.split('/').pop() || agent.model, color: 'bg-muted text-muted-foreground border-border' };
  const tokenCount = Math.ceil((agent.system_prompt || '').length / 4);

  const getInstanceNames = () => {
    const ids = agent.instance_ids?.length ? agent.instance_ids : (agent.instance_id ? [agent.instance_id] : []);
    if (ids.length === 0) return null;
    return ids.map(id => instances.find(i => i.id === id)?.friendly_name || '').filter(Boolean).join(', ');
  };

  const instanceName = getInstanceNames();
  const instanceConnected = agent.instance_ids?.length
    ? agent.instance_ids.some(id => instances.find(i => i.id === id)?.is_active)
    : (agent.instance_id ? instances.find(i => i.id === agent.instance_id)?.is_active : false);

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-200 overflow-hidden
        ${agent.is_active
          ? 'border-primary/25 bg-gradient-to-br from-primary/5 via-card to-card shadow-md shadow-primary/5'
          : 'border-border/50 bg-card hover:border-border'}`}
    >
      {/* Active glow bar */}
      {agent.is_active && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
      )}

      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <AgentAvatar agent={agent} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{agent.name}</h3>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 h-4 border cursor-pointer select-none
                  ${agent.is_active
                    ? 'bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                onClick={onToggle}
              >
                {agent.is_active ? '● Ativo' : '○ Inativo'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {agent.description || agent.company_name || 'Agente de atendimento'}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onEdit}>
                <Edit2 className="h-3.5 w-3.5 mr-2" /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stats badges */}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={`text-[10px] px-1.5 border ${modelInfo.color}`}>
            {modelInfo.short}
          </Badge>

          {agent.n8n_webhook_url && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-1 bg-orange-500/10 text-orange-400 border-orange-500/30">
              <Webhook className="h-2.5 w-2.5" /> n8n
            </Badge>
          )}

          {agent.rag_restricted && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-1 bg-violet-500/10 text-violet-400 border-violet-500/30">
              <Database className="h-2.5 w-2.5" /> RAG
            </Badge>
          )}

          {agent.prompt_protection && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-1 bg-slate-500/10 text-slate-400 border-slate-500/30">
              <Shield className="h-2.5 w-2.5" /> Protegido
            </Badge>
          )}

          {agent.business_hours_only && (
            <Badge variant="outline" className="text-[10px] px-1.5 gap-1">
              <Clock className="h-2.5 w-2.5" />
              {agent.business_hours_start?.slice(0, 5)}-{agent.business_hours_end?.slice(0, 5)}
            </Badge>
          )}
        </div>

        {/* Token bar */}
        <TokenBar used={tokenCount} />

        {/* WhatsApp instance */}
        {instanceName && (
          <div className="flex items-center gap-1.5 text-xs">
            {instanceConnected
              ? <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
              : <XCircle className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="text-muted-foreground truncate">{instanceName}</span>
          </div>
        )}

        {/* Footer metrics */}
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {(agent.total_replies || 0).toLocaleString()}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-primary hover:text-primary hover:bg-primary/10"
            onClick={onEdit}
          >
            Configurar <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppAIAgent({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const isInitialMount = useRef(true);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    if (isInitialMount.current) setLoading(true);
    try {
      const [{ data: inst }, { data: agentsData }] = await Promise.all([
        supabase.from('wa_instances').select('id, friendly_name, instance_name, is_active, provider').eq('user_id', user.id),
        (supabase as any).from('wa_ai_agents').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);
      setInstances((inst as Instance[]) || []);
      setAgents((agentsData as unknown as AIAgent[]) || []);
    } finally {
      setLoading(false);
      isInitialMount.current = false;
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (agent: AIAgent) => {
    if (!confirm(`Deseja realmente excluir o agente "${agent.name}"?`)) return;
    setLoading(true);
    try {
      const ids = agent.instance_ids?.length ? agent.instance_ids : (agent.instance_id ? [agent.instance_id] : []);
      if (ids.length > 0) {
        await Promise.all(ids.map(id => supabase.functions.invoke('delete-evolution-instance', { body: { instance_id: id, user_id: user?.id } })));
      }
      const { error } = await (supabase as any).from('wa_ai_agents').delete().eq('id', agent.id);
      if (error) throw error;
      toast({ title: 'Agente excluído!' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (agent: AIAgent) => {
    const { id, created_at, total_replies, ...rest } = agent;
    const { error } = await (supabase as any).from('wa_ai_agents').insert({ ...rest, name: `${agent.name} (cópia)`, user_id: user!.id, total_replies: 0, is_active: false });
    if (error) toast({ title: 'Erro ao duplicar', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Agente duplicado!' }); fetchData(); }
  };

  const handleToggleActive = async (agent: AIAgent) => {
    const { error } = await (supabase as any).from('wa_ai_agents').update({ is_active: !agent.is_active, updated_at: new Date().toISOString() }).eq('id', agent.id);
    if (!error) fetchData();
  };

  const Wrapper = embedded ? ({ children }: { children: React.ReactNode }) => <>{children}</> : MainLayout;

  if (loading) {
    return (
      <Wrapper>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Wrapper>
    );
  }

  const activeCount = agents.filter(a => a.is_active).length;
  const totalReplies = agents.reduce((s, a) => s + (a.total_replies || 0), 0);

  return (
    <Wrapper>
      <div className="space-y-4 max-w-6xl">
        <Tabs defaultValue="agentes" className="w-full">
          <div className="px-1 mb-4 flex justify-between items-center w-full">
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="agentes" className="gap-2 px-6 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all">
                <Bot className="h-4 w-4" /> Configuração do Agente
              </TabsTrigger>
              <TabsTrigger value="crm" className="gap-2 px-6 data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-500 transition-all">
                <Users className="h-4 w-4" /> CRM de Leads
              </TabsTrigger>
            </TabsList>
            
            {/* Action buttons could go here if needed in the future */}
          </div>

          <TabsContent value="crm" className="mt-0 outline-none">
            <GlobalLeadsCrm />
          </TabsContent>

          <TabsContent value="agentes" className="space-y-8 mt-0 outline-none">
            {/* ── Hero Header ─────────────────────────────────── */}
        <div className="relative rounded-2xl overflow-hidden border border-border/50 bg-gradient-to-br from-primary/10 via-card to-card p-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,theme(colors.primary/0.15),transparent_60%)]" />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                <Bot className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Pedro — Agente IA</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Gerencie seus agentes de inteligência artificial para WhatsApp
                </p>
              </div>
            </div>
            <Button
              className="gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
              onClick={() => { setEditingAgent(null); setDialogOpen(true); }}
            >
              <Plus className="h-4 w-4" /> Novo Agente
            </Button>
          </div>

          {/* Quick stats */}
          <div className="relative grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-border/30">
            <div className="text-center">
              <div className="text-2xl font-bold">{agents.length}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                <Bot className="h-3 w-3" /> Agentes
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{activeCount}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                <Activity className="h-3 w-3" /> Ativos
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{totalReplies.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-0.5">
                <MessageSquare className="h-3 w-3" /> Respostas
              </div>
            </div>
          </div>
        </div>

        {/* ── How it works (colapsável) ──────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { icon: MessageSquare, color: 'text-green-400 bg-green-500/10 border-green-500/20', title: '1. Mensagem recebida', desc: 'Cliente envia mensagem no WhatsApp' },
            { icon: Brain, color: 'text-primary bg-primary/10 border-primary/20', title: '2. IA processa', desc: 'Pedro entende o contexto e consulta a base de conhecimento' },
            { icon: Sparkles, color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', title: '3. Resposta humanizada', desc: 'IA gera resposta natural, personalizada e no timing certo' },
          ].map(({ icon: Icon, color, title, desc }) => (
            <div key={title} className="flex items-start gap-3 p-4 rounded-xl border border-border/50 bg-card/50">
              <div className={`p-2 rounded-lg border ${color} shrink-0`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-medium">{title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Agent Grid ────────────────────────────────── */}
        {agents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-12 text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Nenhum agente criado</h3>
            <p className="text-muted-foreground text-sm mt-2 mb-6 max-w-sm mx-auto">
              Crie seu primeiro agente IA e comece a atender leads automaticamente no WhatsApp
            </p>
            <Button onClick={() => { setEditingAgent(null); setDialogOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Criar Primeiro Agente
            </Button>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {agents.length} {agents.length === 1 ? 'agente' : 'agentes'}
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  instances={instances}
                  agents={agents}
                  onEdit={() => { setEditingAgent(agent); setDialogOpen(true); }}
                  onDuplicate={() => handleDuplicate(agent)}
                  onDelete={() => handleDelete(agent)}
                  onToggle={() => handleToggleActive(agent)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Feature highlights ─────────────────────────── */}
        <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/50 p-6">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Recursos Disponíveis
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: BookOpen, label: 'Base de Conhecimento', desc: 'RAG com pgvector', color: 'text-violet-400' },
              { icon: Shield, label: 'Proteção de Prompt', desc: 'Anti-extração', color: 'text-blue-400' },
              { icon: Globe, label: 'Multi-Canal', desc: 'WhatsApp + Widget', color: 'text-teal-400' },
              { icon: Users, label: 'Multi-Agente', desc: 'Equipe Salomão', color: 'text-orange-400' },
            ].map(({ icon: Icon, label, desc, color }) => (
              <div key={label} className="p-3 rounded-xl bg-muted/20 border border-border/30 space-y-1">
                <Icon className={`h-4 w-4 ${color}`} />
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[10px] text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </TabsContent>
      </Tabs>
      </div>

      <AgentFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agent={editingAgent}
        instances={instances}
        
        onSaved={() => { setDialogOpen(false); fetchData(); }}
      />
    </Wrapper>
  );
}
