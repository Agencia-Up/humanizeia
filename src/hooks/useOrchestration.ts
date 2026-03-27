import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type OrchestrationStage = 'idle' | 'daniel_strategy' | 'paulo_copy' | 'maria_design' | 'approval_gate' | 'jose_campaign' | 'completed' | 'failed';

export interface AgentStatus {
  agent: string;
  emoji: string;
  name: string;
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'pending_approval';
  output?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface OrchestrationState {
  taskId: string | null;
  stage: OrchestrationStage;
  status: string;
  agents: AgentStatus[];
  context: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  executions: any[];
}

const AGENTS: Omit<AgentStatus, 'status'>[] = [
  { agent: 'salomao', emoji: '👑', name: 'Salomão' },
  { agent: 'daniel', emoji: '🧠', name: 'Daniel' },
  { agent: 'paulo', emoji: '✍️', name: 'Paulo' },
  { agent: 'maria', emoji: '🎨', name: 'Maria' },
  { agent: 'jose', emoji: '🎯', name: 'José' },
];

function stageToAgentStatuses(stage: OrchestrationStage, executions: any[]): AgentStatus[] {
  const executedAgents = new Set(executions.map((e: any) => e.agent_name));

  return AGENTS.map((agent) => {
    if (executedAgents.has(agent.agent)) {
      const lastExec = executions.filter((e: any) => e.agent_name === agent.agent).pop();
      return {
        ...agent,
        status: 'completed' as const,
        output: lastExec?.output_data ? JSON.stringify(lastExec.output_data).slice(0, 100) : undefined,
        completedAt: lastExec ? new Date(lastExec.executed_at) : undefined,
      };
    }

    // Determine status based on current stage
    const stageOrder: OrchestrationStage[] = ['daniel_strategy', 'paulo_copy', 'approval_gate', 'jose_campaign', 'completed'];
    const currentIdx = stageOrder.indexOf(stage);
    const agentStageMap: Record<string, number> = {
      salomao: -1, // always completed when task exists
      daniel: 0,
      paulo: 1,
      maria: 1,
      jose: 3,
    };
    const agentStageIdx = agentStageMap[agent.agent] ?? 99;

    if (agent.agent === 'salomao') return { ...agent, status: 'completed' as const };
    if (stage === 'approval_gate' && (agent.agent === 'paulo' || agent.agent === 'maria')) {
      return { ...agent, status: 'completed' as const };
    }
    if (agentStageIdx < currentIdx) return { ...agent, status: 'completed' as const };
    if (agentStageIdx === currentIdx) return { ...agent, status: 'running' as const };
    return { ...agent, status: 'waiting' as const };
  });
}

export function useOrchestration() {
  const { user } = useAuth();
  const [state, setState] = useState<OrchestrationState>({
    taskId: null,
    stage: 'idle',
    status: 'idle',
    agents: AGENTS.map(a => ({ ...a, status: 'waiting' })),
    context: {},
    result: null,
    error: null,
    executions: [],
  });
  const [loading, setLoading] = useState(false);

  const callOrchestrator = useCallback(async (action: string, payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Não autenticado');

    const { data, error } = await supabase.functions.invoke('orchestrate-campaign', {
      body: { action, ...payload },
    });
    if (error) throw new Error(error.message);
    return data;
  }, []);

  const startOrchestration = useCallback(async (briefingId: string) => {
    setLoading(true);
    setState(prev => ({
      ...prev,
      stage: 'daniel_strategy',
      status: 'in_progress',
      error: null,
      agents: prev.agents.map(a => a.agent === 'salomao' ? { ...a, status: 'completed' } : { ...a, status: 'waiting' }),
    }));

    try {
      const result = await callOrchestrator('start', { briefing_id: briefingId });
      setState(prev => ({
        ...prev,
        taskId: result.task_id,
        stage: result.stage || 'daniel_strategy',
        status: result.status || 'in_progress',
      }));
      // Start polling
    } catch (err: any) {
      setState(prev => ({ ...prev, stage: 'failed', status: 'failed', error: err.message }));
    } finally {
      setLoading(false);
    }
  }, [callOrchestrator]);

  const approveAndContinue = useCallback(async () => {
    if (!state.taskId) return;
    setLoading(true);
    try {
      await callOrchestrator('approve', { task_id: state.taskId });
      setState(prev => ({ ...prev, stage: 'jose_campaign', status: 'in_progress' }));
      await refreshStatus();
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message }));
    } finally {
      setLoading(false);
    }
  }, [state.taskId, callOrchestrator]);

  const rejectAndRevise = useCallback(async (feedback: string) => {
    if (!state.taskId) return;
    setLoading(true);
    try {
      await callOrchestrator('reject', { task_id: state.taskId, feedback });
      setState(prev => ({ ...prev, stage: 'paulo_copy', status: 'pending' }));
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message }));
    } finally {
      setLoading(false);
    }
  }, [state.taskId, callOrchestrator]);

  const refreshStatus = useCallback(async () => {
    if (!state.taskId) return;
    try {
      const result = await callOrchestrator('status', { task_id: state.taskId });
      const { task, executions } = result;
      if (!task) return;
      setState(prev => ({
        ...prev,
        stage: task.stage as OrchestrationStage,
        status: task.status,
        context: task.context || {},
        result: task.result || null,
        error: task.error || null,
        executions: executions || [],
        agents: stageToAgentStatuses(task.stage as OrchestrationStage, executions || []),
      }));
    } catch (err) {
      console.error('Error refreshing status:', err);
    }
  }, [state.taskId, callOrchestrator]);

  // Auto-refresh when task is running
  useEffect(() => {
    if (!state.taskId || state.stage === 'idle' || state.stage === 'completed' || state.stage === 'failed' || state.stage === 'approval_gate') return;
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, [state.taskId, state.stage, refreshStatus]);

  const reset = useCallback(() => {
    setState({
      taskId: null,
      stage: 'idle',
      status: 'idle',
      agents: AGENTS.map(a => ({ ...a, status: 'waiting' })),
      context: {},
      result: null,
      error: null,
      executions: [],
    });
  }, []);

  return {
    state,
    loading,
    startOrchestration,
    approveAndContinue,
    rejectAndRevise,
    refreshStatus,
    reset,
  };
}
