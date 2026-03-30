import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Brain, MessageSquare, Clock, CheckCircle2, AlertCircle, PlayCircle, User } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LeadTimelineProps {
  leadId: string;
}

const LeadTimeline = ({ leadId }: LeadTimelineProps) => {
  // Fetch unified events (Tasks + Executions + Followups)
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['lead-timeline', leadId],
    queryFn: async () => {
      // 1. Fetch Tasks
      const { data: tasks } = await supabase
        .from('orchestrator_tasks' as any)
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false });

      // 2. Fetch Followups
      const { data: followups } = await supabase
        .from('followup_queue' as any)
        .select('*')
        .eq('lead_id', leadId)
        .order('scheduled_for', { ascending: false });

      // Combine and sort
      const combined = [
        ...(tasks || []).map(t => ({ ...t, eventType: 'task' })),
        ...(followups || []).map(f => ({ ...f, eventType: 'followup', created_at: f.scheduled_for })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return combined;
    }
  });

  if (isLoading) return <div className="p-4 text-center text-xs text-muted-foreground">Carregando timeline...</div>;

  return (
    <ScrollArea className="h-[450px] pr-4">
      <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-purple-500/50 before:via-blue-500/30 before:to-transparent pb-8">
        {events.length > 0 ? (
          events.map((event: any, idx) => (
            <div key={event.id || idx} className="relative flex items-start gap-4 group">
              <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black shadow-lg transition-all duration-300 group-hover:scale-110 ${
                event.eventType === 'task' ? 'border-purple-500/30 text-purple-400' : 'border-blue-500/30 text-blue-400'
              }`}>
                {event.eventType === 'task' ? (
                  <Brain className="h-5 w-5" />
                ) : (
                  <MessageSquare className="h-5 w-5" />
                )}
              </div>
              <div className="flex flex-col space-y-1 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {event.eventType === 'task' ? event.title : 'Mensagem / Follow-up'}
                  </span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 bg-white/5 border-white/10 text-muted-foreground uppercase">
                    {event.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {event.description || event.message_content}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-[10px] text-muted-foreground/70">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center pt-12 space-y-4 opacity-40">
            <div className="w-12 h-12 rounded-full border border-dashed border-white/20 flex items-center justify-center">
              <User className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground italic text-center px-8">
              Nenhuma atividade registrada pelo Salomão para este lead ainda.
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default LeadTimeline;
