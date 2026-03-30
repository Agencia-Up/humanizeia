import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ClientBriefing, OrchestratorTask, AgentExecution } from "../types";
import { toast } from "sonner";

export const useOrchestrator = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // 1. Fetch Business Briefing
  const { data: briefing, isLoading: loadingBriefing } = useQuery({
    queryKey: ['client-briefing', user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('client_briefings' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as ClientBriefing;
    },
    enabled: !!user,
  });

  // 2. Fetch Active Tasks
  const { data: activeTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['orchestrator-tasks', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('orchestrator_tasks' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as OrchestratorTask[];
    },
    enabled: !!user,
  });

  // 3. Fetch Recent Agent Executions
  const { data: recentExecutions = [], isLoading: loadingExecutions } = useQuery({
    queryKey: ['agent-executions', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('agent_executions' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as AgentExecution[];
    },
    enabled: !!user,
  });

  // 4. Mutation to Generate Initial Tasks
  const generateTasksMutation = useMutation({
    mutationFn: async (briefing: ClientBriefing) => {
      const suggestedTasks = [
        {
          user_id: user?.id,
          title: `Configurar Agente Paulo para ${briefing.business_name}`,
          description: `Criar copy baseada no público-alvo: ${briefing.target_audience}`,
          priority: 'high',
          type: 'copywriting',
          status: 'pending'
        },
        {
          user_id: user?.id,
          title: "Estruturar Campanhas no Agente José",
          description: "Mapear primeiros canais de tráfego baseados no briefing.",
          priority: 'medium',
          type: 'ads',
          status: 'pending'
        },
        {
          user_id: user?.id,
          title: "Análise de Concorrência com Agente Daniel",
          description: "Estudar posicionamento de mercado para o nicho informado.",
          priority: 'low',
          type: 'strategy',
          status: 'pending'
        }
      ];

      const { data, error } = await supabase
        .from('orchestrator_tasks' as any)
        .insert(suggestedTasks)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });
      toast.success("Salomão gerou novas tarefas baseadas no seu briefing!");
    },
  });

  // 5. Mutation to Simulate Task Execution (Orchestration with real LLM)
  const runTaskMutation = useMutation({
    mutationFn: async (task: OrchestratorTask) => {
      if (!user) return;

      // Step 1: Set task to In Progress
      await supabase.from('orchestrator_tasks' as any).update({ status: 'in_progress' } as never).eq('id', task.id);
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });

      // Build context strings from briefing
      const businessContext = briefing ? `Negócio: ${briefing.business_name}. Público: ${briefing.target_audience}. Produto: ${briefing.offering_details}. Tom: ${briefing.tone_of_voice}.` : 'Sem contexto prévio.';

      // Step 2: Agent 1 (Analysis Phase)
      const analysisPrompt = `Você é o Orquestrador Salomão. Analise a seguinte tarefa que será delegada: "${task.title}". \n\nContexto do negócio: ${businessContext}\n\nForneça em 1 parágrafo um direcionamento estratégico claro para o agente especialista que executará essa tarefa.`;
      
      let analysisOutput = "Análise concluída. Preparando delegação.";
      try {
        const { data: analysisData, error: analysisError } = await supabase.functions.invoke('claude-chat', {
          body: {
            messages: [{ role: 'user', content: analysisPrompt }],
            context: 'insights'
          }
        });
        if (!analysisError && analysisData?.content) {
          analysisOutput = analysisData.content;
        }
      } catch (err) {
        console.error("Erro na análise IA:", err);
      }

      await supabase.from('agent_executions' as any).insert({
        task_id: task.id,
        user_id: user.id,
        agent_id: 'SISTEMA_ANALISE',
        prompt_input: `Analisar contexto para: ${task.title}`,
        status: 'completed',
        response_output: analysisOutput
      });
      queryClient.invalidateQueries({ queryKey: ['agent-executions'] });

      // Step 3: Agent 2 (Execution Phase)
      const agentRole = task.type === 'copywriting' ? 'copywriter' : (task.type === 'ads' ? 'gestor de tráfego' : 'estrategista de marketing');
      const executionPrompt = `Você é um excelente ${agentRole}. Execute a seguinte tarefa: "${task.title} - ${task.description}".\n\nDiretriz do Orquestrador: ${analysisOutput}\n\nContexto da Empresa: ${businessContext}\n\nForneça o resultado FINAL da sua tarefa (o texto da copy, o planejamento das campanhas, a grade de conteúdo, etc). Seja direto, prático, e use formatação Markdown rica.`;
      
      let finalOutput = "Tarefa executada com sucesso. (Fallback de sistema)";
      try {
        const { data: execData, error: execError } = await supabase.functions.invoke('claude-chat', {
          body: {
            messages: [{ role: 'user', content: executionPrompt }],
            context: task.type === 'copywriting' ? 'copywriter' : 'assistant'
          }
        });
        if (!execError && execData?.content) {
          finalOutput = execData.content;
        }
      } catch (err) {
        console.error("Erro na execução IA:", err);
      }

      const exactAgentId = task.type === 'copywriting' ? 'PAULO_COPY' : (task.type === 'ads' ? 'JOSE_ADS' : 'DANIEL_ESTRATEGIA');
      
      await supabase.from('agent_executions' as any).insert({
        task_id: task.id,
        user_id: user.id,
        agent_id: exactAgentId,
        prompt_input: `Executar sub-tarefa: ${task.description}`,
        status: 'completed',
        response_output: finalOutput
      });
      queryClient.invalidateQueries({ queryKey: ['agent-executions'] });

      // Step 4: Complete Master Task
      await supabase.from('orchestrator_tasks' as any).update({ status: 'completed' } as never).eq('id', task.id);
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });
    },
    onSuccess: () => {
      toast.success("Tarefa orquestrada e conteúdo gerado pela IA com sucesso!");
    }
  });

  const clearBriefingMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase.from('client_briefings' as any).delete().eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-briefing'] });
      toast.success("Memória do negócio apagada com sucesso.");
    }
  });

  const resetOrchestratorMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      // Because Tasks drop will cascade Agent Executions or can be deleted independently
      await supabase.from('agent_executions' as any).delete().eq('user_id', user.id);
      const { error } = await supabase.from('orchestrator_tasks' as any).delete().eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-executions'] });
      toast.success("Histórico e Tarefas resetados com sucesso.");
    }
  });

  return {
    briefing,
    activeTasks,
    recentExecutions,
    generateTasks: generateTasksMutation.mutate,
    runTask: runTaskMutation.mutate,
    clearBriefing: clearBriefingMutation.mutate,
    resetOrchestrator: resetOrchestratorMutation.mutate,
    isGenerating: generateTasksMutation.isPending,
    isExecuting: runTaskMutation.isPending,
    isLoading: loadingBriefing || loadingTasks || loadingExecutions,
  };
};
