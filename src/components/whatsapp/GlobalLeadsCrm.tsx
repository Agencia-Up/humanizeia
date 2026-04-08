import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  Loader2, Users, Search, 
  MoreVertical, ArrowRightLeft, Flag
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const KANBAN_COLUMNS = [
  { id: 'novo', title: '🔰 Novo Lead', borderColor: 'border-slate-500/30', headerBg: 'bg-slate-500/10' },
  { id: 'interessado', title: '👀 Interessado', borderColor: 'border-yellow-500/30', headerBg: 'bg-yellow-500/10' },
  { id: 'qualificado', title: '🎯 Qualificado', borderColor: 'border-green-500/30', headerBg: 'bg-green-500/10' },
  { id: 'encerrado', title: '🚫 Encerrado', borderColor: 'border-red-500/30', headerBg: 'bg-red-500/10' },
];

export function GlobalLeadsCrm() {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_crm_leads')
        .select(`
          *,
          agent:wa_ai_agents(name),
          assigned_to:ai_team_members(name)
        `)
        .order('last_interaction_at', { ascending: false });

      if (error) throw error;
      setLeads(data || []);
    } catch (err) {
      console.error('Erro ao buscar leads', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    
    const channel = supabase.channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ai_crm_leads' },
        () => {
          fetchLeads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLeads]);

  const handleUpdateStatus = async (leadId: string, newStatus: string) => {
    try {
      // Optimistic update
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
      
      const { error } = await supabase
        .from('ai_crm_leads')
        .update({ status: newStatus })
        .eq('id', leadId);

      if (error) throw error;
      toast({ title: 'Status atualizado com sucesso!' });
    } catch (err) {
      console.error(err);
      toast({ title: 'Erro ao atualizar', variant: 'destructive' });
      fetchLeads(); // revert
    }
  };

  const filteredLeads = leads.filter(lead => 
    (lead.lead_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (lead.remote_jid || '').includes(searchTerm) ||
    (lead.summary || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            CRM Pipeline (SDR IA)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Seus Agentes movem os clientes de forma autônoma. Você também mudar o status manualmente.
          </p>
        </div>
        
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Pesquisar leads..." 
            className="pl-9 h-10 w-full bg-card"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <p>Carregando pipeline...</p>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-6 pt-2 h-[70vh] min-h-[500px] snap-x snap-mandatory scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
          {KANBAN_COLUMNS.map(column => {
            const columnLeads = filteredLeads.filter(lead => (lead.status || 'novo') === column.id);

            return (
              <div 
                key={column.id} 
                className={`flex flex-col shrink-0 w-[340px] snap-center rounded-2xl border ${column.borderColor} bg-card/40`}
              >
                <div className={`p-4 rounded-t-2xl ${column.headerBg} border-b ${column.borderColor} flex items-center justify-between`}>
                  <h3 className="font-semibold">{column.title}</h3>
                  <Badge variant="secondary" className="bg-background/50 font-mono">
                    {columnLeads.length}
                  </Badge>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
                  {columnLeads.length === 0 ? (
                    <div className="h-24 border border-dashed rounded-xl flex items-center justify-center text-xs text-muted-foreground bg-muted/20">
                      Nenhum card aqui
                    </div>
                  ) : (
                    columnLeads.map(lead => (
                      <div key={lead.id} className="relative group p-4 rounded-xl border bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-default">
                        <div className="flex items-start justify-between mb-2">
                          <div className="max-w-[85%]">
                            <h4 className="font-semibold text-sm truncate" title={lead.lead_name || 'Lead'}>
                              {lead.lead_name || '👤 Lead Anônimo'}
                            </h4>
                            <p className="text-xs font-mono text-muted-foreground mt-0.5">
                              {lead.remote_jid.replace('@s.whatsapp.net', '')}
                            </p>
                          </div>
                          
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel className="text-xs">Mover para...</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {KANBAN_COLUMNS.filter(c => c.id !== column.id).map(c => (
                                <DropdownMenuItem key={c.id} onClick={() => handleUpdateStatus(lead.id, c.id)} className="text-xs gap-2 cursor-pointer">
                                  <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                                  {c.title}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        {lead.summary ? (
                          <div className="my-3 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50 text-foreground/80 leading-relaxed line-clamp-4 hover:line-clamp-none transition-all">
                            {lead.summary}
                          </div>
                        ) : (
                          <div className="my-3 h-8 flex items-center justify-center text-[10px] text-muted-foreground bg-muted/20 rounded-lg">
                            Sem anotações
                          </div>
                        )}

                        <div className="flex items-end justify-between mt-auto pt-2">
                          <div className="text-[10px] text-muted-foreground flex flex-col gap-1">
                            <span className="flex items-center gap-1">
                              <Flag className="h-3 w-3" />
                              IA: {lead.agent?.name || '?'}
                            </span>
                          </div>
                          {lead.assigned_to && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-500 bg-blue-500/5">
                              Repassado: {lead.assigned_to.name}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
