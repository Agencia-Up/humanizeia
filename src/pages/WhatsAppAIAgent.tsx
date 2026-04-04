import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, Plus, Loader2, MessageSquare, Sparkles, Trash2, Edit2, Copy, Webhook,
} from 'lucide-react';
import { AgentFormDialog } from '@/components/whatsapp/AgentFormDialog';

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
}

interface Instance {
  id: string;
  friendly_name: string;
  instance_name: string;
  is_active: boolean;
  provider: string;
}

export default function WhatsAppAIAgent() {
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
    if (isInitialMount.current) {
        setLoading(true);
    }

    try {
        const [{ data: inst }, { data: agentsData }] = await Promise.all([
          supabase
            .from('wa_instances')
            .select('id, friendly_name, instance_name, is_active, provider')
            .eq('user_id', user.id),
          (supabase as any)
            .from('wa_ai_agents')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
        ]);

        setInstances((inst as Instance[]) || []);
        setAgents((agentsData as unknown as AIAgent[]) || []);
    } finally {
        setLoading(false);
        isInitialMount.current = false;
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (agentId: string) => {
    const { error } = await (supabase as any).from('wa_ai_agents').delete().eq('id', agentId);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Agente excluído' });
      fetchData();
    }
  };

  const handleDuplicate = async (agent: AIAgent) => {
    const { id, created_at, total_replies, ...rest } = agent;
    const payload = { ...rest, name: `${agent.name} (cópia)`, user_id: user!.id, total_replies: 0, is_active: false };
    const { error } = await (supabase as any).from('wa_ai_agents').insert(payload);
    if (error) {
      toast({ title: 'Erro ao duplicar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Agente duplicado!' });
      fetchData();
    }
  };

  const handleToggleActive = async (agent: AIAgent) => {
    const { error } = await (supabase as any)
      .from('wa_ai_agents')
      .update({ is_active: !agent.is_active, updated_at: new Date().toISOString() })
      .eq('id', agent.id);
    if (!error) fetchData();
  };

  const getInstanceNames = (agent: AIAgent) => {
    const ids = agent.instance_ids?.length ? agent.instance_ids : (agent.instance_id ? [agent.instance_id] : []);
    if (ids.length === 0) return 'Todas as instâncias';
    return ids.map(id => instances.find(i => i.id === id)?.friendly_name || 'Desconhecido').join(', ');
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-7 w-7 text-primary" />
              Agentes IA WhatsApp
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Crie múltiplos agentes com funções distintas para atender seus leads automaticamente
            </p>
          </div>
          <Button onClick={() => { setEditingAgent(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Agente
          </Button>
        </div>

        {/* How it works */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <MessageSquare className="h-7 w-7 mx-auto mb-2 text-green-500" />
                <h4 className="font-medium text-sm">1. Mensagem recebida</h4>
                <p className="text-xs text-muted-foreground mt-1">Cliente envia mensagem no WhatsApp</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Bot className="h-7 w-7 mx-auto mb-2 text-primary" />
                <h4 className="font-medium text-sm">2. Agente certo responde</h4>
                <p className="text-xs text-muted-foreground mt-1">Cada agente cuida dos seus números</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <Sparkles className="h-7 w-7 mx-auto mb-2 text-yellow-500" />
                <h4 className="font-medium text-sm">3. Resposta humanizada</h4>
                <p className="text-xs text-muted-foreground mt-1">IA gera respostas naturais e contextuais</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agent list */}
        {agents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center">
              <Bot className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
              <h3 className="font-semibold text-lg">Nenhum agente criado</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">
                Crie seu primeiro agente para começar a responder automaticamente
              </p>
              <Button onClick={() => { setEditingAgent(null); setDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />
                Criar Agente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map(agent => (
              <Card key={agent.id} className={`transition-all ${agent.is_active ? 'border-green-500/40 bg-green-500/5' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-full ${agent.is_active ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                        <Bot className="h-4 w-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{agent.name}</CardTitle>
                        <CardDescription className="text-xs">{getInstanceNames(agent)}</CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={agent.is_active ? 'default' : 'secondary'}
                      className="cursor-pointer text-xs"
                      onClick={() => handleToggleActive(agent)}
                    >
                      {agent.is_active ? '✅ Ativo' : '⏸️ Inativo'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {agent.system_prompt.substring(0, 120)}...
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="text-xs gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {agent.total_replies} respostas
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {agent.model.split('/').pop()}
                    </Badge>
                    {agent.agent_type && agent.agent_type !== 'generic' && (
                      <Badge variant="outline" className="text-xs">
                        {agent.agent_type === 'sdr' ? '📞 SDR' : agent.agent_type === 'support' ? '🛠️ Suporte' : '💰 Vendas'}
                      </Badge>
                    )}
                    {agent.n8n_webhook_url && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Webhook className="h-3 w-3" /> n8n
                      </Badge>
                    )}
                    {agent.business_hours_only && (
                      <Badge variant="outline" className="text-xs">
                        🕐 {agent.business_hours_start?.slice(0,5)}-{agent.business_hours_end?.slice(0,5)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditingAgent(agent); setDialogOpen(true); }}>
                      <Edit2 className="h-3 w-3 mr-1" /> Editar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDuplicate(agent)}>
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => handleDelete(agent.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AgentFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agent={editingAgent}
        instances={instances}
        onSaved={() => { setDialogOpen(false); fetchData(); }}
      />
    </MainLayout>
  );
}
