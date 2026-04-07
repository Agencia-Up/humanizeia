import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessagesSquare, Users, CheckCircle2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function GlobalLeadsCrm() {
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

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
    
    // Subscribe to changes for live updates
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'qualificado': return <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20 px-3 py-1">🎯 Qualificado</Badge>;
      case 'em_atendimento': return <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 px-3 py-1">💬 Em Atendimento</Badge>;
      case 'finalizado': return <Badge className="bg-muted text-muted-foreground px-3 py-1">🔒 Finalizado</Badge>;
      default: return <Badge variant="outline" className="opacity-70 px-3 py-1">✨ Novo</Badge>;
    }
  };

  const filteredLeads = leads.filter(lead => 
    (lead.lead_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (lead.remote_jid || '').includes(searchTerm) ||
    (lead.summary || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            CRM de Leads Inteligente
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Acompanhe os clientes potenciais mapeados pelos seus agentes IA.
          </p>
        </div>
        
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar por nome, número ou resumo..." 
            className="pl-9 h-10 w-full bg-card"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <p>Carregando carteira de clientes...</p>
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-16 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <MessagesSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-lg">Nenhum lead qualificado ainda</h3>
          <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
            Quando seus agentes interagirem com clientes reais e os qualificarem, eles aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredLeads.map(lead => (
            <div key={lead.id} className="group relative overflow-hidden rounded-2xl border bg-card hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              {/* Header decorativo leve */}
              <div className="h-2 w-full bg-gradient-to-r from-blue-500/50 to-purple-500/50" />
              
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-foreground mb-0.5">
                      {lead.lead_name || 'Lead Anônimo'}
                    </h3>
                    <p className="text-sm font-mono text-muted-foreground tracking-wide">
                      {lead.remote_jid.replace('@s.whatsapp.net', '')}
                    </p>
                  </div>
                  <div>
                    {getStatusBadge(lead.status)}
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4 text-xs font-medium bg-muted/50 w-max px-2.5 py-1 rounded-md">
                  <span className="text-muted-foreground">Agente Original:</span>
                  <span className="text-primary">{lead.agent?.name || 'Desconhecido'}</span>
                </div>

                {lead.summary ? (
                  <div className="bg-primary/5 rounded-xl p-4 border border-primary/10 mb-4 h-24 overflow-y-auto scrollbar-hide text-sm leading-relaxed text-foreground/90">
                    <span className="font-semibold block mb-1">📝 Resumo do Atendimento:</span>
                    {lead.summary}
                  </div>
                ) : (
                  <div className="h-24 flex items-center justify-center text-xs text-muted-foreground italic mb-4 bg-muted/30 rounded-xl">
                    Sem resumo armazenado
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <div className="text-xs text-muted-foreground">
                    Captado há {Math.floor((new Date().getTime() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))} dias
                  </div>
                  {lead.assigned_to && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-500 bg-blue-500/10 px-2 py-1 rounded-full">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {lead.assigned_to.name}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
