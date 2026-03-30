import { supabase } from "@/integrations/supabase/client";
import { ClientBriefing, OrchestratorTask, AgentExecution } from "../types";

export const orchestratorService = {
  // Analyze a briefing and generate initial master tasks
  async generateInitialTasks(briefing: ClientBriefing) {
    const userId = briefing.user_id;
    
    // In a real scenario, this would call an Edge Function with LLM
    // For now, let's simulate the "Salomão Thinking" process
    const suggestedTasks = [
      {
        title: `Configurar Agente Paulo para ${briefing.business_name}`,
        description: `Criar copy baseada no público-alvo: ${briefing.target_audience}`,
        priority: 'high',
        type: 'copywriting'
      },
      {
        title: "Estruturar Campanhas no Agente José",
        description: "Mapear primeiros canais de tráfego baseados no briefing.",
        priority: 'medium',
        type: 'ads'
      },
      {
        title: "Análise de Concorrência com Agente Daniel",
        description: "Estudar posicionamento de mercado para o nicho informado.",
        priority: 'low',
        type: 'strategy'
      }
    ];

    const tasksToInsert = suggestedTasks.map(task => ({
      user_id: userId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      type: task.type,
      status: 'pending',
    }));

    const { data, error } = await supabase
      .from('orchestrator_tasks' as any)
      .insert(tasksToInsert)
      .select();

    if (error) throw error;
    return data;
  },

  // Log an agent execution
  async logExecution(taskId: string, agentId: string, input: string, output: string, userId: string) {
    const { data, error } = await supabase
      .from('agent_executions' as any)
      .insert({
        task_id: taskId,
        agent_id: agentId,
        user_id: userId,
        prompt_input: input,
        response_output: output,
        status: 'success'
      })
      .select();

    if (error) throw error;
    return data[0];
  }
};
