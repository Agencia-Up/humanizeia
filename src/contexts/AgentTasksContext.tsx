import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export interface AgentTask {
  id: string;
  agent_id: string;
  task_type: string;
  status: 'processing' | 'completed' | 'failed';
  payload: any;
  result: any;
  error?: string;
  created_at: string;
  updated_at: string;
}

interface AgentTasksContextType {
  activeTasks: AgentTask[];
  recentTasks: AgentTask[];
  createTask: (agentId: string, taskType: string, payload: any) => Promise<string>;
  isLoading: boolean;
}

const AgentTasksContext = createContext<AgentTasksContextType | undefined>(undefined);

export function AgentTasksProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [activeTasks, setActiveTasks] = useState<AgentTask[]>([]);
  const [recentTasks, setRecentTasks] = useState<AgentTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial state
  const fetchTasks = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('agent_tasks' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      
      const tasks = data as AgentTask[];
      setActiveTasks(tasks.filter(t => t.status === 'processing'));
      setRecentTasks(tasks);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('agent_tasks_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_tasks',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updatedTask = payload.new as AgentTask;
          
          if (payload.eventType === 'INSERT') {
            if (updatedTask.status === 'processing') {
              setActiveTasks(prev => [updatedTask, ...prev]);
            }
            setRecentTasks(prev => [updatedTask, ...prev.slice(0, 19)]);
          } else if (payload.eventType === 'UPDATE') {
            // Update active tasks
            setActiveTasks(prev => {
              if (updatedTask.status !== 'processing') {
                return prev.filter(t => t.id !== updatedTask.id);
              }
              return prev.map(t => t.id === updatedTask.id ? updatedTask : t);
            });

            // Update recent tasks
            setRecentTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));

            // Show notifications for completion/failure
            if (updatedTask.status === 'completed') {
              const url = getAgentUrl(updatedTask.agent_id);
              
              toast({
                title: `✨ Tarefa Concluída!`,
                description: `${getAgentName(updatedTask.agent_id)} terminou o que estava fazendo. Clique para ver.`,
                variant: 'default',
                onClick: () => {
                  if (url) {
                    navigate(`${url}?taskId=${updatedTask.id}`);
                  }
                }
              } as any);
            } else if (updatedTask.status === 'failed') {
              toast({
                title: `⚠️ Erro no Agente`,
                description: `Houve um problema com a tarefa de ${getAgentName(updatedTask.agent_id)}.`,
                variant: 'destructive',
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast, navigate]);

  const createTask = async (agentId: string, taskType: string, payload: any) => {
    if (!user) throw new Error('User not authenticated');

    const { data, error } = await supabase
      .from('agent_tasks')
      .insert({
        user_id: user.id,
        agent_id: agentId,
        task_type: taskType,
        status: 'processing',
        payload,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  };

  return (
    <AgentTasksContext.Provider value={{ activeTasks, recentTasks, createTask, isLoading }}>
      {children}
    </AgentTasksContext.Provider>
  );
}

export function useAgentTasks() {
  const context = useContext(AgentTasksContext);
  if (context === undefined) {
    throw new Error('useAgentTasks must be used within an AgentTasksProvider');
  }
  return context;
}

function getAgentName(id: string) {
  const names: Record<string, string> = {
    'maria': 'Maria (Designer)',
    'paulo': 'Paulo (Copywriter)',
    'jose': 'José (Tráfego)',
    'daniel': 'Daniel (Estrategista)',
    'salomao': 'Salomão (Orquestrador)',
  };
  return names[id] || id.toUpperCase();
}

function getAgentUrl(id: string) {
  const urls: Record<string, string> = {
    'maria': '/creative-studio',
    'paulo': '/copywriter',
    'jose': '/jose',
    'daniel': '/daniel',
    'salomao': '/salomao',
  };
  return urls[id] || null;
}

