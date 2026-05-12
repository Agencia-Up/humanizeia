import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AutomationFlowBuilder } from '@/components/marcos/AutomationFlowBuilder';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Plus, Loader2, Zap, Play, Pause, Trash2,
  GitBranch, Calendar, MoreHorizontal, Pencil,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AutomationFlow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  nodes: any[];
  edges: any[];
  created_at: string;
  updated_at: string;
}

export default function WhatsAppAutomations({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  // View state
  const [view, setView] = useState<'list' | 'builder'>('list');
  const [selectedFlow, setSelectedFlow] = useState<AutomationFlow | null>(null);

  // List state
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteFlow, setDeleteFlow] = useState<AutomationFlow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch flows
  const fetchFlows = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('wa_automation_flows')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setFlows((data || []) as AutomationFlow[]);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar automações', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => { fetchFlows(); }, [fetchFlows]);

  // Open builder
  const openBuilder = (flow: AutomationFlow | null) => {
    setSelectedFlow(flow);
    setView('builder');
  };

  const handleBack = () => {
    setView('list');
    setSelectedFlow(null);
    fetchFlows();
  };

  // Toggle active
  const toggleActive = async (flow: AutomationFlow) => {
    const newState = !flow.is_active;
    setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, is_active: newState } : f));
    const { error } = await (supabase as any)
      .from('wa_automation_flows')
      .update({ is_active: newState })
      .eq('id', flow.id);
    if (error) {
      setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, is_active: !newState } : f));
      toast({ title: 'Erro', description: error.message, variant: 'destructive' });
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteFlow) return;
    setDeleting(true);
    const { error } = await (supabase as any)
      .from('wa_automation_flows')
      .delete()
      .eq('id', deleteFlow.id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    } else {
      setFlows(prev => prev.filter(f => f.id !== deleteFlow.id));
      toast({ title: 'Automação excluída' });
    }
    setDeleteFlow(null);
    setDeleting(false);
  };

  // ═══ Builder View ═══
  if (view === 'builder') {
    const builderContent = (
      <AutomationFlowBuilder
        flowId={selectedFlow?.id || null}
        initialName={selectedFlow?.name}
        initialNodes={selectedFlow?.nodes}
        initialEdges={selectedFlow?.edges}
        isActive={selectedFlow?.is_active}
        onBack={handleBack}
      />
    );

    if (embedded) {
      return <div className="h-full overflow-hidden">{builderContent}</div>;
    }
    return <MainLayout>{builderContent}</MainLayout>;
  }

  // ═══ List View ═══
  const listContent = (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Automações de Fluxo
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crie sequências visuais de mensagens, e-mails e ações automáticas
          </p>
        </div>
        <Button className="gap-2" onClick={() => openBuilder(null)}>
          <Plus className="h-4 w-4" /> Nova Automação
        </Button>
      </div>

      {/* Onboarding */}
      {!loading && flows.length === 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex gap-3">
            <span className="text-2xl shrink-0">⚡</span>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Construtor Visual de Automações</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Monte fluxos de automação arrastando e conectando blocos no canvas visual, igual ao SellFlux.
                Selecione uma lista de contatos como gatilho e crie sequências de mensagens WhatsApp,
                e-mails, condições e muito mais.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { emoji: '💬', title: 'Sequência de WhatsApp', desc: 'Envie uma série de mensagens com intervalos personalizados' },
              { emoji: '📧', title: 'Nurturing por E-mail', desc: 'Combine WhatsApp + Email para máximo engajamento' },
              { emoji: '🔀', title: 'Fluxo Condicional', desc: 'Ramifique o fluxo baseado na resposta do lead' },
            ].map(ex => (
              <button
                key={ex.emoji}
                onClick={() => openBuilder(null)}
                className="group flex flex-col gap-2 rounded-lg border border-border/40 bg-background/50 p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="text-2xl">{ex.emoji}</span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{ex.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ex.desc}</p>
                </div>
                <span className="text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  Criar automação →
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Flow Cards */}
      {!loading && flows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map(flow => {
            const nodeCount = flow.nodes?.length || 0;
            const edgeCount = flow.edges?.length || 0;
            return (
              <Card
                key={flow.id}
                className={`group hover:border-primary/50 transition-all cursor-pointer ${!flow.is_active ? 'opacity-60' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0" onClick={() => openBuilder(flow)}>
                      <div className="flex items-center gap-2 mb-1">
                        <GitBranch className="h-4 w-4 text-primary shrink-0" />
                        <p className="font-semibold text-sm truncate">{flow.name}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {nodeCount} {nodeCount === 1 ? 'bloco' : 'blocos'}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {edgeCount} {edgeCount === 1 ? 'conexão' : 'conexões'}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={flow.is_active}
                        onCheckedChange={() => toggleActive(flow)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openBuilder(flow)}>
                            <Pencil className="h-4 w-4 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteFlow(flow)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3" onClick={() => openBuilder(flow)}>
                    <Badge
                      className={flow.is_active
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]'
                        : 'bg-muted text-muted-foreground text-[10px]'
                      }
                    >
                      {flow.is_active
                        ? <><Play className="h-3 w-3 mr-1" /> Ativo</>
                        : <><Pause className="h-3 w-3 mr-1" /> Inativo</>
                      }
                    </Badge>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(flow.updated_at), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteFlow} onOpenChange={() => setDeleteFlow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Automação</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir "{deleteFlow?.name}"? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFlow(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (embedded) {
    return <div className="h-full overflow-y-auto">{listContent}</div>;
  }
  return <MainLayout>{listContent}</MainLayout>;
}
