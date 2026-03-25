import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrchestratorTask } from "../types";
import { Clock, AlertCircle, CheckCircle2, PlayCircle } from "lucide-react";

interface TaskCardProps {
  task: OrchestratorTask;
  onAction?: (task: OrchestratorTask) => void;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pendente' },
  in_progress: { icon: PlayCircle, color: 'text-blue-500', label: 'Em Progresso' },
  completed: { icon: CheckCircle2, color: 'text-green-500', label: 'Concluído' },
  cancelled: { icon: AlertCircle, color: 'text-red-500', label: 'Cancelado' },
};

const priorityConfig = {
  low: 'bg-white/5 text-muted-foreground',
  medium: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  urgent: 'bg-red-500/10 text-red-500 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.2)]',
};

const TaskCard = ({ task, onAction }: TaskCardProps) => {
  const StatusIcon = statusConfig[task.status as keyof typeof statusConfig]?.icon || Clock;
  const statusInfo = statusConfig[task.status as keyof typeof statusConfig];

  return (
    <Card className="bg-black/40 border-white/5 hover:border-purple-500/30 transition-all duration-300 group overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white group-hover:text-purple-400 transition-colors">
              {task.title}
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          </div>
          <Badge variant="outline" className={`text-[10px] uppercase ${priorityConfig[task.priority as keyof typeof priorityConfig]}`}>
            {task.priority}
          </Badge>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-3.5 h-3.5 ${statusInfo?.color}`} />
            <span className="text-[10px] text-muted-foreground font-medium">{statusInfo?.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {new Date(task.created_at).toLocaleDateString()}
            </span>
            {task.status === 'pending' && (
              <button 
                className="text-[10px] bg-purple-500 hover:bg-purple-600 text-white px-2 py-0.5 rounded transition-colors"
                onClick={() => onAction?.(task)}
              >
                Ativar
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TaskCard;
