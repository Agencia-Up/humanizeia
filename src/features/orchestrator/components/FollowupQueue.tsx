import React from 'react';
import { useFollowups } from '../hooks/useFollowups';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, AlertCircle, Calendar, MessageSquare, Check, X, Phone, User } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const FollowupQueue = () => {
  const { overdue, today, upcoming, isLoading, updateStatus } = useFollowups();

  const renderSection = (title: string, tasks: any[], icon: any, color: string) => {
    const Icon = icon;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-2">
          <Icon className={`h-4 w-4 ${color}`} />
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{title}</h3>
          <Badge variant="outline" className={`ml-auto text-[10px] bg-white/5 ${color} border-white/10`}>
            {tasks.length}
          </Badge>
        </div>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3 pb-6">
            {tasks.map(task => (
              <Card key={task.id} className="bg-black/40 border-white/5 hover:border-purple-500/20 transition-all group relative overflow-hidden">
                {/* Status Indicator Bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${color && color.replace('text-', 'bg-')}`} />
                
                <CardContent className="p-4 space-y-3 pl-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-bold text-white uppercase">{task.crm_leads?.name || 'Lead sem nome'}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-tighter">
                         {task.crm_leads?.company || 'Pessoa Física'} • {task.crm_leads?.phone || 'Sem Telefone'}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground line-clamp-2 italic leading-relaxed">
                    "{task.message_content || 'Nenhuma mensagem recomendada pelo Salomão.'}"
                  </p>

                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">
                            {new Date(task.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button 
                            className="p-1.5 rounded-md hover:bg-green-500/10 text-muted-foreground hover:text-green-500 transition-colors"
                            title="Completar"
                            onClick={() => updateStatus({ id: task.id, status: 'completed' })}
                        >
                            <Check className="w-4 h-4" />
                        </button>
                        <button 
                            className="p-1.5 rounded-md hover:bg-blue-500/10 text-muted-foreground hover:text-blue-500 transition-colors"
                            title="WhatsApp"
                        >
                            <MessageSquare className="w-4 h-4" />
                        </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {tasks.length === 0 && (
                <div className="p-12 text-center bg-white/5 rounded-xl border border-dashed border-white/10 opacity-30">
                    <Check className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-[10px] uppercase font-bold text-muted-foreground">Fila Vazia</p>
                </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  if (isLoading) return <div className="p-12 text-center text-xs animate-pulse">Sincronizando fila com Salomão...</div>;

  return (
    <div className="grid gap-6 md:grid-cols-3">
        {renderSection('Vencidos & Alertas', overdue, AlertCircle, 'text-red-500')}
        {renderSection('Prioridade de Hoje', today, Clock, 'text-purple-500')}
        {renderSection('Agendados no Futuro', upcoming, Calendar, 'text-blue-400')}
    </div>
  );
};

export default FollowupQueue;
