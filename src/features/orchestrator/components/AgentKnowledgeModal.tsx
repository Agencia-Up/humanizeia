import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ArrowLeft, BrainCircuit, Save } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface AgentDef {
  id: string;
  name: string;
  role: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}

interface AgentKnowledgeModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentDef[];
}

export function AgentKnowledgeModal({ isOpen, onOpenChange, agents }: AgentKnowledgeModalProps) {
  const { toast } = useToast();
  const [selectedAgent, setSelectedAgent] = useState<AgentDef | null>(null);
  const [knowledgeText, setKnowledgeText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // When modal closes, reset selection
  useEffect(() => {
    if (!isOpen) {
      setSelectedAgent(null);
      setKnowledgeText('');
    }
  }, [isOpen]);

  const handleSelectAgent = async (agent: AgentDef) => {
    setSelectedAgent(agent);
    setIsLoading(true);
    setKnowledgeText('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { data, error } = await supabase
        .from('agent_knowledge' as any)
        .select('knowledge_text')
        .eq('user_id', user.id)
        .eq('agent_id', agent.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setKnowledgeText((data as any).knowledge_text);
      }
    } catch (err: any) {
      toast({ title: 'Erro ao carregar', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedAgent) return;
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const { error } = await supabase
        .from('agent_knowledge' as any)
        .upsert({
          user_id: user.id,
          agent_id: selectedAgent.id,
          knowledge_text: knowledgeText,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id, agent_id' });

      if (error) throw error;

      toast({ 
        title: 'Sucesso!', 
        description: `Base de conhecimento do(a) ${selectedAgent.name} atualizada.`,
      });
      setSelectedAgent(null); // Back to list
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden bg-background">
        
        {/* Modal Header */}
        <div className="p-6 pb-4 border-b border-border/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Base de Conhecimento dos Agentes
            </DialogTitle>
            <DialogDescription>
              {selectedAgent 
                ? `Defina a identidade, as regras e a especialidade do agente ${selectedAgent.name}.`
                : "Selecione um agente para treinar sua inteligência e comportamento."
              }
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedAgent ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {agents.map(agent => (
                <Card 
                  key={agent.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors p-4 flex flex-col items-center text-center gap-3 border-border/50 bg-card/40"
                  onClick={() => handleSelectAgent(agent)}
                >
                  <div className={`p-3 rounded-xl ${agent.bg}`}>
                    <agent.icon className={`h-6 w-6 ${agent.color}`} />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm text-foreground">{agent.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">{agent.role}</p>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-5 h-full animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setSelectedAgent(null)}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">{selectedAgent.name} • {selectedAgent.role}</span>
                  <span className="text-xs text-muted-foreground">Instruções de Personalidade e Nicho</span>
                </div>
              </div>

              {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground min-h-[300px]">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-sm">Carregando cérebro do agente...</span>
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-2 min-h-[300px]">
                  <Label className="sr-only">Instruções do Agente</Label>
                  <Textarea
                    placeholder={`Ex: "Sua especialidade é o nicho automotivo. Aja como um gestor de tráfego focado em concessionárias... O tom deve ser formal e focado em métricas de Custo Por Lead."`}
                    className="flex-1 resize-none h-full min-h-[300px] text-sm leading-relaxed p-4"
                    value={knowledgeText}
                    onChange={(e) => setKnowledgeText(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Essa base de conhecimento será concatenada ao Prompt do Salomão quando você gerar o briefing.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer (only visible when editing) */}
        {selectedAgent && !isLoading && (
          <div className="p-4 border-t border-border/40 bg-muted/20 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setSelectedAgent(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Treinamento
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
