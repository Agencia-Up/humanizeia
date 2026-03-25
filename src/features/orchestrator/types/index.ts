export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type FollowupStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'paused';

export interface ClientBriefing {
  id: string;
  user_id: string;
  organization_id?: string | null;
  business_name?: string | null;
  target_audience?: string | null;
  offering_details?: string | null;
  tone_of_voice?: string | null;
  goals?: any;
  custom_context?: any;
  created_at: string;
  updated_at: string;
}

export interface OrchestratorTask {
  id: string;
  user_id: string;
  organization_id?: string | null;
  lead_id?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  type?: string | null;
  metadata?: any;
  due_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentExecution {
  id: string;
  task_id?: string | null;
  agent_id?: string | null;
  user_id: string;
  prompt_input?: string | null;
  response_output?: string | null;
  tokens_used?: number | null;
  status?: string | null;
  duration_ms?: number | null;
  created_at: string;
}

export interface FollowupQueue {
  id: string;
  lead_id: string;
  user_id: string;
  task_id?: string | null;
  scheduled_for: string;
  channel?: string | null;
  message_content?: string | null;
  status: FollowupStatus;
  attempt_count?: number | null;
  last_error?: string | null;
  sent_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrchestratorContext {
  briefing: ClientBriefing | null;
  activeTasks: OrchestratorTask[];
  recentExecutions: AgentExecution[];
}

