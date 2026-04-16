import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { 
  Loader2, Users, Search, MoreVertical, ArrowRightLeft, Flag,
  TrendingUp, Calendar, CalendarDays, CalendarRange,
  UserCheck, PhoneForwarded, BarChart3, MessageSquare, Trash2, MonitorPlay, RefreshCw
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const KANBAN_COLUMNS = [
  { id: 'novo', title: '🔰 Novo', borderColor: 'border-slate-500/30', headerBg: 'bg-slate-500/10', dotColor: 'bg-slate-400' },
  { id: 'interessado', title: '👀 Interessado', borderColor: 'border-yellow-500/30', headerBg: 'bg-yellow-500/10', dotColor: 'bg-yellow-400' },
  { id: 'qualificado', title: '🎯 Qualificado', borderColor: 'border-green-500/30', headerBg: 'bg-green-500/10', dotColor: 'bg-green-400' },
  { id: 'transferido', title: '🤝 Transferido', borderColor: 'border-blue-500/30', headerBg: 'bg-blue-500/10', dotColor: 'bg-blue-400' },
  { id: 'encerrado', title: '🚫 Encerrado', borderColor: 'border-red-500/30', headerBg: 'bg-red-500/10', dotColor: 'bg-red-400' },
];

interface TransferStats {
  memberId: string;
  memberName: string;
  today: number;
  week: number;
  month: number;
  total: number;
}

export function GlobalLeadsCrm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [agentFilter, setAgentFilter] = useState('all');
  const [agents, setAgents] = useState<any[]>([]);
  const { toast } = useToast();

  const fetchAll = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try {
      // Fetch leads
      const { data: leadsData } = await (supabase as any)
        .from('ai_crm_leads')
        .select('*, agent:wa_ai_agents(name), member:ai_team_members(name, whatsapp_number)')
        .eq('user_id', user.id)
        .order('last_interaction_at', { ascending: false });

      // Fetch transfers
      const { data: transfersData } = await (supabase as any)
        .from('ai_lead_transfers')
        .select('*, member:ai_team_members(name), agent:wa_ai_agents(name), lead:ai_crm_leads(lead_name, remote_jid)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);

      // Fetch team members
      const { data: teamData } = await (supabase as any)
        .from('ai_team_members')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      // Fetch agents
      const { data: agentsData } = await (supabase as any)
        .from('wa_ai_agents')
        .select('id, name')
        .eq('user_id', user.id);

      setLeads(leadsData || []);
      setTransfers(transfersData || []);
      setTeamMembers(teamData || []);
      setAgents(agentsData || []);
    } catch (err) {
      console.error('Erro ao buscar dados do CRM:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    fetchAll();

    const channel = supabase.channel('crm-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` }, (payload) => {
        fetchAll();
        if (payload.eventType === 'INSERT') {
          const newLead = payload.new as any;
          toast({
            title: '🆕 Novo lead recebido!',
            description: `${newLead.lead_name || newLead.remote_jid} entrou no CRM.`,
          });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_lead_transfers', filter: `user_id=eq.${user.id}` }, () => fetchAll())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAll, user]);

  // Transfer stats calculation
  const transferStats = useMemo((): TransferStats[] => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    return teamMembers.map(member => {
      const memberTransfers = transfers.filter(t => t.to_member_id === member.id);
      return {
        memberId: member.id,
        memberName: member.name,
        today: memberTransfers.filter(t => new Date(t.created_at) >= startOfDay).length,
        week: memberTransfers.filter(t => new Date(t.created_at) >= startOfWeek).length,
        month: memberTransfers.filter(t => new Date(t.created_at) >= startOfMonth).length,
        total: memberTransfers.length,
      };
    });
  }, [teamMembers, transfers]);

  const totalStats = useMemo(() => ({
    today: transferStats.reduce((s, m) => s + m.today, 0),
    week: transferStats.reduce((s, m) => s + m.week, 0),
    month: transferStats.reduce((s, m) => s + m.month, 0),
    total: transferStats.reduce((s, m) => s + m.total, 0),
  }), [transferStats]);

  const handleUpdateStatus = async (leadId: string, newStatus: string) => {
    try {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', leadId);
      if (error) throw error;
      toast({ title: 'Status atualizado!' });
    } catch {
      toast({ title: 'Erro ao atualizar', variant: 'destructive' });
      fetchAll();
    }
  };

  const handleManualTransfer = async (leadId: string, memberId: string) => {
    if (!user) return;
    try {
      const lead = leads.find(l => l.id === leadId);
      // Update lead
      await (supabase as any).from('ai_crm_leads').update({
        status: 'transferido',
        assigned_to_member_id: memberId,
        transferred_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', leadId);

      // Log transfer
      await (supabase as any).from('ai_lead_transfers').insert({
        user_id: user.id,
        lead_id: leadId,
        from_agent_id: lead?.agent_id || null,
        to_member_id: memberId,
        transfer_reason: 'manual',
        notes: 'Transferência manual pelo gerente',
      });

      // Increment member counter
      const member = teamMembers.find(m => m.id === memberId);
      if (member) {
        await (supabase as any).from('ai_team_members').update({
          total_leads_received: (member.total_leads_received || 0) + 1,
          last_lead_received_at: new Date().toISOString(),
        }).eq('id', memberId);
      }

      toast({ title: 'Lead transferido com sucesso!' });
      fetchAll();
    } catch {
      toast({ title: 'Erro ao transferir', variant: 'destructive' });
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!confirm('Deseja realmente remover este lead do CRM? Isso não apagará o histórico de conversas.')) return;
    try {
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .delete()
        .eq('id', leadId);
      if (error) throw error;
      toast({ title: 'Lead removido com sucesso!' });
      setLeads(prev => prev.filter(l => l.id !== leadId));
    } catch (error: any) {
      console.error('Erro ao remover lead manualmente:', error);
      toast({
        title: 'Erro ao remover lead',
        description: error?.message || 'Nao foi possivel excluir este lead agora.',
        variant: 'destructive'
      });
    }
  };

  const filteredLeads = leads.filter(lead => {
    const matchSearch = (lead.lead_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (lead.remote_jid || '').includes(searchTerm) ||
      (lead.summary || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchAgent = agentFilter === 'all' || lead.agent_id === agentFilter;
    return matchSearch && matchAgent;
  });

  const activeMembers = teamMembers.filter(m => m.is_active);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Carregando CRM...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <Tabs defaultValue="pipeline" className="w-full">
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary/80">Novo modo de exibição</p>
            <h2 className="text-lg font-semibold">CRM Ao Vivo para TV</h2>
            <p className="text-sm text-muted-foreground">
              Abra uma visualização em tela cheia com atualização automática, rodízio do Pedro e vendedor responsável em destaque.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-primary/20 bg-background/60 hover:bg-primary/10"
              onClick={fetchAll}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Atualizar CRM
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => window.open('/whatsapp/crm-ao-vivo', '_blank', 'noopener,noreferrer')}
            >
              <MonitorPlay className="mr-2 h-4 w-4" />
              CRM Ao Vivo
            </Button>
          </div>
        </div>

        <TabsList className="bg-card border mb-4">
          <TabsTrigger value="pipeline" className="gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
          <TabsTrigger value="manager" className="gap-1.5 text-xs"><BarChart3 className="h-3.5 w-3.5" /> Visão Gerente</TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5 text-xs"><PhoneForwarded className="h-3.5 w-3.5" /> Transferências</TabsTrigger>
        </TabsList>

        {/* ── KPI Strip ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiCard icon={<MessageSquare className="h-4 w-4" />} label="Total Leads" value={leads.length} color="text-primary" />
          <KpiCard icon={<Calendar className="h-4 w-4" />} label="Transferências Hoje" value={totalStats.today} color="text-emerald-400" />
          <KpiCard icon={<CalendarDays className="h-4 w-4" />} label="Na Semana" value={totalStats.week} color="text-blue-400" />
          <KpiCard icon={<CalendarRange className="h-4 w-4" />} label="No Mês" value={totalStats.month} color="text-violet-400" />
        </div>

        {/* ── Pipeline Tab ── */}
        <TabsContent value="pipeline" className="mt-0">
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between mb-4">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Pesquisar leads..." className="pl-9 h-9 bg-card text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {agents.length > 1 && (
                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger className="w-48 h-9 text-xs"><SelectValue placeholder="Filtrar por agente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os agentes</SelectItem>
                    {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="outline"
                className="h-9 border-primary/20 bg-background/60 text-xs hover:bg-primary/10"
                onClick={() => navigate('/whatsapp/crm-ao-vivo')}
              >
                <MonitorPlay className="mr-2 h-3.5 w-3.5" />
                Abrir CRM Ao Vivo
              </Button>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-6 pt-1 h-[65vh] min-h-[450px] snap-x snap-mandatory scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            {KANBAN_COLUMNS.map(column => {
              const columnLeads = filteredLeads.filter(lead => (lead.status || 'novo') === column.id);
              return (
                <div key={column.id} className={`flex flex-col shrink-0 w-[300px] snap-center rounded-2xl border ${column.borderColor} bg-card/40`}>
                  <div className={`p-3 rounded-t-2xl ${column.headerBg} border-b ${column.borderColor} flex items-center justify-between`}>
                    <h3 className="font-semibold text-sm">{column.title}</h3>
                    <Badge variant="secondary" className="bg-background/50 font-mono text-[10px]">{columnLeads.length}</Badge>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 scrollbar-hide">
                    {columnLeads.length === 0 ? (
                      <div className="h-20 border border-dashed rounded-xl flex items-center justify-center text-xs text-muted-foreground bg-muted/20">Nenhum lead</div>
                    ) : (
                      columnLeads.map(lead => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          column={column}
                          activeMembers={activeMembers}
                          onUpdateStatus={handleUpdateStatus}
                          onTransfer={handleManualTransfer}
                          onDelete={handleDeleteLead}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Manager View Tab ── */}
        <TabsContent value="manager" className="mt-0">
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-foreground/80">
              <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              <span><strong>Visão do Gerente:</strong> Acompanhe a distribuição de leads por vendedor e o rodízio automático.</span>
            </div>

            <div className="grid gap-3">
              {transferStats.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  <Users className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  Nenhum vendedor cadastrado. Adicione vendedores na aba de Equipe do agente.
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="hidden md:grid grid-cols-6 gap-2 px-4 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                    <span className="col-span-2">Vendedor</span>
                    <span className="text-center">Hoje</span>
                    <span className="text-center">Semana</span>
                    <span className="text-center">Mês</span>
                    <span className="text-center">Total</span>
                  </div>

                  {transferStats.map(stat => {
                    const member = teamMembers.find(m => m.id === stat.memberId);
                    const isActive = member?.is_active;
                    return (
                      <Card key={stat.memberId} className={`p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-center ${!isActive ? 'opacity-50' : ''}`}>
                        <div className="col-span-2 flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${isActive ? 'bg-emerald-500/10' : 'bg-muted'}`}>
                            <UserCheck className={`h-4 w-4 ${isActive ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold">{stat.memberName}</h4>
                            <span className="text-[10px] text-muted-foreground font-mono">{member?.whatsapp_number}</span>
                          </div>
                          <Badge variant="outline" className={`ml-auto text-[9px] ${isActive ? 'border-emerald-500/30 text-emerald-500' : 'border-red-500/30 text-red-400'}`}>
                            {isActive ? 'Ativo' : 'Ausente'}
                          </Badge>
                        </div>
                        <StatCell value={stat.today} label="Hoje" />
                        <StatCell value={stat.week} label="Semana" />
                        <StatCell value={stat.month} label="Mês" />
                        <StatCell value={stat.total} label="Total" accent />
                      </Card>
                    );
                  })}

                  {/* Rodízio info */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-muted-foreground mt-2">
                    <ArrowRightLeft className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Rodízio Automático:</strong> Os leads qualificados são distribuídos em sequência entre os vendedores ativos. 
                      Quando todos recebem, a fila reinicia. Próximo na fila: <strong className="text-foreground">{getNextInQueue(teamMembers, transfers)}</strong>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Transfer History Tab ── */}
        <TabsContent value="history" className="mt-0">
          <div className="space-y-3">
            {transfers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <PhoneForwarded className="h-8 w-8 mx-auto mb-3 opacity-40" />
                Nenhuma transferência registrada ainda.
              </div>
            ) : (
              transfers.slice(0, 50).map(t => (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:border-primary/30 transition-colors">
                  <div className="h-8 w-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <PhoneForwarded className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold truncate">{t.lead?.lead_name || t.lead?.remote_jid || 'Lead'}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-primary font-medium">{t.member?.name || '?'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                      <span>Agente: {t.agent?.name || '—'}</span>
                      <span>Motivo: {getTransferReasonLabel(t)}</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(t.created_at).toLocaleDateString('pt-BR')} {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sub-components ──

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <div className={`${color}`}>{icon}</div>
      <div>
        <p className="text-lg font-bold">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

function StatCell({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold ${accent ? 'text-primary' : ''}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground md:hidden">{label}</p>
    </div>
  );
}

function LeadCard({ lead, column, activeMembers, onUpdateStatus, onTransfer, onDelete }: {
  lead: any;
  column: typeof KANBAN_COLUMNS[0];
  activeMembers: any[];
  onUpdateStatus: (id: string, status: string) => void;
  onTransfer: (leadId: string, memberId: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="relative group p-3 rounded-xl border bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all cursor-default">
      <div className="flex items-start justify-between mb-1.5">
        <div className="max-w-[80%]">
          <h4 className="font-semibold text-xs truncate" title={lead.lead_name || 'Lead'}>
            {lead.lead_name || '👤 Lead Anônimo'}
          </h4>
          <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
            {(lead.remote_jid || '').replace('@s.whatsapp.net', '')}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 -mt-1 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px]">Mover para...</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {KANBAN_COLUMNS.filter(c => c.id !== column.id).map(c => (
              <DropdownMenuItem key={c.id} onClick={() => onUpdateStatus(lead.id, c.id)} className="text-xs gap-2 cursor-pointer">
                <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                {c.title}
              </DropdownMenuItem>
            ))}
            {activeMembers.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px]">Transferir para vendedor</DropdownMenuLabel>
                {activeMembers.map(m => (
                  <DropdownMenuItem key={m.id} onClick={() => onTransfer(lead.id, m.id)} className="text-xs gap-2 cursor-pointer">
                    <UserCheck className="h-3 w-3 text-emerald-500" />
                    {m.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(lead.id)} className="text-xs gap-2 cursor-pointer text-red-500 focus:text-red-500 focus:bg-red-500/10">
              <Trash2 className="h-3 w-3" />
              Excluir Lead
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {lead.summary && (
        <div className="my-2 text-[10px] bg-muted/40 p-2 rounded-lg border border-border/50 text-foreground/80 leading-relaxed line-clamp-3 hover:line-clamp-none transition-all">
          {lead.summary}
        </div>
      )}

      <div className="flex items-end justify-between mt-auto pt-1.5">
        <div className="text-[10px] text-muted-foreground flex flex-col gap-0.5">
          <span className="flex items-center gap-1">
            <Flag className="h-3 w-3" />
            {lead.agent?.name || '?'}
          </span>
          {lead.message_count > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {lead.message_count} msgs
            </span>
          )}
        </div>
        {lead.member && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-blue-500/30 text-blue-400 bg-blue-500/5">
            → {lead.member.name}
          </Badge>
        )}
      </div>
    </div>
  );
}

function getNextInQueue(members: any[], transfers: any[]): string {
  const active = members.filter(m => m.is_active);
  if (active.length === 0) return 'Nenhum vendedor ativo';
  if (transfers.length === 0) return active[0]?.name || '—';

  // Find who received least recently to determine next in round-robin
  const lastTransferMap = new Map<string, Date>();
  for (const t of transfers) {
    if (!lastTransferMap.has(t.to_member_id)) {
      lastTransferMap.set(t.to_member_id, new Date(t.created_at));
    }
  }

  // Members who never received get priority
  const neverReceived = active.filter(m => !lastTransferMap.has(m.id));
  if (neverReceived.length > 0) return neverReceived[0].name;

  // Otherwise, the one who received longest ago
  const sorted = [...active].sort((a, b) => {
    const aDate = lastTransferMap.get(a.id)?.getTime() || 0;
    const bDate = lastTransferMap.get(b.id)?.getTime() || 0;
    return aDate - bDate;
  });

  return sorted[0]?.name || '—';
}


function getTransferReasonLabel(transfer: any) {
  if (transfer?.transfer_reason === 'manual') return 'Manual';
  if (transfer?.transfer_reason === 'round_robin') return 'Rod�zio';
  if (String(transfer?.notes || '').toLowerCase().includes('round-robin')) return 'Rod�zio';
  return transfer?.transfer_reason || '—';
}
