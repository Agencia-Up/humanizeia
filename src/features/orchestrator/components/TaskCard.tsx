import React, { useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OrchestratorTask, AgentExecution } from "../types";
import { Clock, AlertCircle, CheckCircle2, PlayCircle, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface TaskCardProps {
  task: OrchestratorTask;
  onAction?: (task: OrchestratorTask) => void;
  execution?: AgentExecution;
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

const TaskCard = ({ task, onAction, execution }: TaskCardProps) => {
  const StatusIcon = statusConfig[task.status as keyof typeof statusConfig]?.icon || Clock;
  const statusInfo = statusConfig[task.status as keyof typeof statusConfig];
  const [isOpen, setIsOpen] = useState(false);

  // If there's an execution and it's completed, we make the card clickable
  const isClickable = task.status === 'completed' && execution;

  const CardContentBlock = (
    <Card className={`bg-black/40 border-white/5 transition-all duration-300 group overflow-hidden ${isClickable ? 'cursor-pointer hover:border-purple-500/50 hover:bg-black/60 shadow-lg' : 'hover:border-purple-500/30'}`}>
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
          <Badge variant="outline" className={`shrink-0 text-[10px] uppercase ${priorityConfig[task.priority as keyof typeof priorityConfig]}`}>
            {task.priority}
          </Badge>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-3.5 h-3.5 ${statusInfo?.color}`} />
            <span className="text-[10px] text-muted-foreground font-medium">{statusInfo?.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {isClickable && (
              <span className="text-[10px] flex items-center gap-1 text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
                <Eye className="w-3 h-3" /> Ver Resultado
              </span>
            )}
            <span className="text-[10px] text-muted-foreground hidden sm:inline-block">
              {new Date(task.created_at).toLocaleDateString()}
            </span>
            {task.status === 'pending' && (
              <button 
                className="text-[10px] bg-purple-500 hover:bg-purple-600 text-white px-2 py-0.5 rounded transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onAction?.(task);
                }}
              >
                Ativar
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (isClickable) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <div className="h-full">
            {CardContentBlock}
          </div>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[600px] border-white/10 bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-white">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Resultado: {task.title}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="rounded-md bg-white/5 p-4 border border-white/5">
               <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Instrução Original</h4>
               <p className="text-sm text-zinc-300">{execution?.prompt_input || task.description}</p>
            </div>
            <div className="rounded-md bg-purple-900/10 p-4 border border-purple-500/20">
               <h4 className="text-xs font-semibold uppercase text-purple-400 mb-2">Conteúdo Gerado pela IA</h4>
               <div className="text-sm text-zinc-100 whitespace-pre-wrap font-mono leading-relaxed max-h-[40vh] overflow-y-auto custom-scrollbar">
                  {execution?.response_output}
               </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return CardContentBlock;
};

export default TaskCard;
