import { Bell, Loader2, CheckCircle2, AlertCircle, Clock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAgentTasks, type AgentTask } from '@/contexts/AgentTasksContext';
import { useNavigate } from 'react-router-dom';

export function ActivityCenter() {
  const { activeTasks, recentTasks, isLoading } = useAgentTasks();
  const navigate = useNavigate();

  const totalActive = activeTasks.length;

  const handleTaskClick = (task: AgentTask) => {
    // Navigate to the appropriate agent page if applicable
    const routes: Record<string, string> = {
      'maria': '/creative-studio',
      'paulo': '/copywriter',
      'jose': '/apollo',
      'daniel': '/daniel',
      'salomao': '/salomao',
    };
    if (routes[task.agent_id]) {
      const extraParams = task.task_type === 'generate_image' ? `?tab=generate&taskId=${task.id}` : '';
      navigate(`${routes[task.agent_id]}${extraParams}`);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {totalActive > 0 && (
            <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-[10px] gradient-primary border-0 animate-pulse">
              {totalActive}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 border border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="p-4 bg-muted/30 border-b border-border/40">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm tracking-tight">Central de Atividades</h3>
            {totalActive > 0 && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 animate-pulse uppercase tracking-wider font-bold">
                {totalActive} AGENTE(S) EM AÇÃO
              </Badge>
            )}
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">Sincronizando tarefas...</span>
            </div>
          ) : recentTasks.length === 0 ? (
            <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
              <div className="h-12 w-12 rounded-full bg-muted/30 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-muted-foreground/40" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Nenhuma atividade recente</p>
                <p className="text-xs text-muted-foreground">Inicie uma tarefa com seus agentes para vê-los trabalhando aqui.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {recentTasks.map((task) => (
                <DropdownMenuItem
                  key={task.id}
                  className="flex items-start gap-3 p-4 focus:bg-primary/5 transition-colors cursor-pointer group"
                  onClick={() => handleTaskClick(task)}
                >
                  <div className={`mt-0.5 h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 ${getStatusStyles(task.status).bg}`}>
                    {task.status === 'processing' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : task.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {getAgentName(task.agent_id)}
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTimeAgo(new Date(task.created_at))}
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-tight line-clamp-2">
                      {getTaskDescription(task)}
                    </p>
                    {task.status === 'processing' && (
                      <div className="pt-2">
                        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary animate-progress-indeterminate" />
                        </div>
                      </div>
                    )}
                    {task.status === 'failed' && (
                      <p className="text-[10px] text-destructive font-medium bg-destructive/5 p-1.5 rounded-md mt-1 italic border border-destructive/10">
                        "{task.error || 'Erro inesperado na geração'}"
                      </p>
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          )}
        </div>

        <DropdownMenuSeparator />
        <div className="p-2.5 bg-muted/10">
          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={() => navigate('/notifications')}>
            Ver todas as notificações
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getStatusStyles(status: string) {
  switch (status) {
    case 'processing': return { bg: 'bg-primary/5 border-primary/20' };
    case 'completed': return { bg: 'bg-emerald-500/5 border-emerald-500/20' };
    case 'failed': return { bg: 'bg-destructive/5 border-destructive/20' };
    default: return { bg: 'bg-muted border-border' };
  }
}

function getAgentName(id: string) {
  const names: Record<string, string> = {
    'maria': 'MARIA',
    'paulo': 'PAULO',
    'jose': 'JOSÉ',
    'daniel': 'DANIEL',
    'salomao': 'SALOMÃO',
  };
  return names[id] || id.toUpperCase();
}

function getTaskDescription(task: AgentTask) {
  const types: Record<string, (p: any) => string> = {
    'generate_image': (p) => `Gerando criativos: "${p.prompt?.slice(0, 30)}..."`,
    'generate_copy': (p) => `Criando copy: "${p.title || p.product}"`,
    'orchestrate': () => `Orquestrando projeto...`,
  };
  return (types[task.task_type] ? types[task.task_type](task.payload) : 'Processando solicitação...') || 'Tarefa em andamento';
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
  if (diffInMinutes < 1) return `agora`;
  if (diffInMinutes < 60) return `${diffInMinutes}m`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h`;
  return `${Math.floor(diffInHours / 24)}d`;
}
