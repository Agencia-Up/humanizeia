import React, { useState } from 'react';
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

interface AgentKnowledgeBaseProps {
  agents: AgentDef[];
}

export function AgentKnowledgeBase({ agents }: AgentKnowledgeBaseProps) {
  const { toast } = useToast();
  const [selectedAgent, setSelectedAgent] = useState<AgentDef | null>(null);
  const [knowledgeText, setKnowledgeText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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

      if (error && (error as any).code !== 'PGRST116') {
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
    <Card className="border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden min-h-[500px] flex flex-col">
      {/* Header Area */}
      <div className="p-6 border-b border-border/40 bg-card/60">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-6 w-6 text-primary" />
          <div>
            <h3 className="text-xl font-bold tracking-tight">Treinamento dos Agentes</h3>
            <p className="text-sm text-muted-foreground">
              {selectedAgent 
                ? `Personalizando o comportamento de ${selectedAgent.name}` 
                : 'Selecione um agente para definir seu nicho e comportamento específico.'}
            </p>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selectedAgent ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {agents.map(agent => (
              <Card 
                key={agent.id}
                className="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all p-4 flex flex-col items-center text-center gap-3 border-border/50 bg-card/40 group"
                onClick={() => handleSelectAgent(agent)}
              >
                <div className={`p-3 rounded-xl ${agent.bg} border border-transparent group-hover:border-current transition-all`}>
                  <agent.icon className={`h-6 w-6 ${agent.color}`} />
                </div>
                <div>
                  <h4 className="font-bold text-sm text-foreground">{agent.name}</h4>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">{agent.role}</p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setSelectedAgent(null)}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-4">
                <div className={`p-2.5 rounded-lg ${selectedAgent.bg} border`}>
                  <selectedAgent.icon className={`h-5 w-5 ${selectedAgent.color}`} />
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-bold">{selectedAgent.name} • <span className="text-muted-foreground">{selectedAgent.role}</span></span>
                  <span className="text-xs text-muted-foreground">O que este agente deve saber para atuar neste negócio?</span>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <span className="text-sm font-medium">Lendo registros de treinamento...</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Base de Conhecimento e Diretrizes</Label>
                  <Textarea
                    placeholder={`Ex: "Sua especialidade é o nicho imobiliário de alto padrão. Você deve falar de forma sofisticada e focar nos benefícios de exclusividade e rentabilidade dos imóveis..."`}
                    className="min-h-[300px] text-sm leading-relaxed p-5 bg-card/50 border-primary/10 focus:border-primary/30 transition-all font-sans"
                    value={knowledgeText}
                    onChange={(e) => setKnowledgeText(e.target.value)}
                  />
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <BrainCircuit className="h-4 w-4 text-primary" />
                    <p className="text-[11px] text-muted-foreground">
                      <strong>Dica:</strong> Quanto mais específico você for sobre o nicho, gírias do setor e dores dos clientes, mais poderoso será o prompt gerado pelo Salomão.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button variant="ghost" onClick={() => setSelectedAgent(null)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSave} disabled={isSaving} className="gap-2 px-8 bg-primary hover:bg-primary/90">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar Treinamento
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
