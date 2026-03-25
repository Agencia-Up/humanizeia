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
        .from('client_briefings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return data as ClientBriefing;
    },
    enabled: !!user,
  });

  // 2. Fetch Active Tasks
  const { data: activeTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['orchestrator-tasks', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('orchestrator_tasks')
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
        .from('agent_executions')
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
        .from('orchestrator_tasks')
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

  // 5. Mutation to Simulate Task Execution (Orchestration)
  const runTaskMutation = useMutation({
    mutationFn: async (task: OrchestratorTask) => {
      if (!user) return;

      // Step 1: Set task to In Progress
      await supabase.from('orchestrator_tasks').update({ status: 'in_progress' } as never).eq('id', task.id);
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });

      // Step 2: Simulate Agent 1 (e.g., Analysis)
      const { data: exec1 } = await supabase.from('agent_executions').insert({
        task_id: task.id,
        user_id: user.id,
        agent_id: 'SISTEMA_ANALISE',
        prompt_input: `Analisar contexto para: ${task.title}`,
        status: 'completed',
        response_output: `Análise concluída. Mapeados 3 pontos críticos de execução para o Agente especialista.`
      }).select().single();
      queryClient.invalidateQueries({ queryKey: ['agent-executions'] });

      // Delay for "Thinking" effect
      await new Promise(r => setTimeout(r, 1500));

      // Step 3: Simulate Agent 2 (e.g., Execution)
      await supabase.from('agent_executions').insert({
        task_id: task.id,
        user_id: user.id,
        agent_id: task.type === 'copywriting' ? 'PAULO_COPY' : 'JOSE_ADS',
        prompt_input: `Executar sub-tarefa: ${task.description}`,
        status: 'completed',
        response_output: `Tarefa executada com sucesso. Resultados anexados ao histórico do lead.`
      });
      queryClient.invalidateQueries({ queryKey: ['agent-executions'] });

      // Step 4: Complete Master Task
      await supabase.from('orchestrator_tasks').update({ status: 'completed' } as never).eq('id', task.id);
      queryClient.invalidateQueries({ queryKey: ['orchestrator-tasks'] });
    },
    onSuccess: () => {
      toast.success("Tarefa orquestrada com sucesso pelo Salomão!");
    }
  });

  return {
    briefing,
    activeTasks,
    recentExecutions,
    generateTasks: generateTasksMutation.mutate,
    runTask: runTaskMutation.mutate,
    isGenerating: generateTasksMutation.isPending,
    isExecuting: runTaskMutation.isPending,
    isLoading: loadingBriefing || loadingTasks || loadingExecutions,
  };
};
