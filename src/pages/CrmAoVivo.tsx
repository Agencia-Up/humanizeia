import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  ArrowLeft,
  CalendarClock,
  Crown,
  Expand,
  Flame,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const LIVE_COLUMNS = [
  { id: 'novo', title: 'Novos Leads', accent: 'from-slate-500/30 to-slate-700/10', badge: 'bg-slate-400/15 text-slate-100 border-slate-300/20' },
  { id: 'interessado', title: 'Interessados', accent: 'from-amber-400/25 to-orange-500/10', badge: 'bg-amber-300/15 text-amber-100 border-amber-300/25' },
  { id: 'qualificado', title: 'Qualificados', accent: 'from-emerald-400/25 to-teal-500/10', badge: 'bg-emerald-300/15 text-emerald-100 border-emerald-300/25' },
  { id: 'transferido', title: 'Em Atendimento', accent: 'from-blue-400/25 to-indigo-500/10', badge: 'bg-blue-300/15 text-blue-100 border-blue-300/25' },
];

function formatRelative(dateString?: string | null) {
  if (!dateString) return 'Sem atualização';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return 'Agora';
  if (diffMin < 60) return `${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

function getTransferReasonLabel(transfer: any) {
  if (transfer?.transfer_reason === 'manual') return 'Manual';
  if (transfer?.transfer_reason === 'round_robin') return 'Rodízio';
  if (String(transfer?.notes || '').toLowerCase().includes('round-robin')) return 'Rodízio';
  return 'Transferência';
}

function getNextInQueue(members: any[], transfers: any[]) {
  const active = members.filter((member) => member.is_active);
  if (active.length === 0) return null;

  const lastTransferMap = new Map<string, Date>();
  for (const transfer of transfers) {
    if (transfer?.to_member_id && !lastTransferMap.has(transfer.to_member_id)) {
      lastTransferMap.set(transfer.to_member_id, new Date(transfer.created_at));
    }
  }

  const neverReceived = active.filter((member) => !lastTransferMap.has(member.id));
  if (neverReceived.length > 0) return neverReceived[0];

  const sorted = [...active].sort((a, b) => {
    const aDate = lastTransferMap.get(a.id)?.getTime() || 0;
    const bDate = lastTransferMap.get(b.id)?.getTime() || 0;
    return aDate - bDate;
  });

  return sorted[0] || null;
}

function getMemberStats(members: any[], transfers: any[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return members
    .map((member) => {
      const memberTransfers = transfers.filter((transfer) => transfer.to_member_id === member.id);
      const todayCount = memberTransfers.filter((transfer) => new Date(transfer.created_at) >= startOfToday).length;

      return {
        ...member,
        todayCount,
        totalCount: memberTransfers.length,
      };
    })
    .sort((a, b) => {
      if (b.todayCount !== a.todayCount) return b.todayCount - a.todayCount;
      return (b.totalCount || 0) - (a.totalCount || 0);
    });
}

export default function CrmAoVivo() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const fetchLiveData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const [{ data: leadsData }, { data: transfersData }, { data: membersData }, { data: agentsData }] = await Promise.all([
        (supabase as any)
          .from('ai_crm_leads')
          .select('*, agent:wa_ai_agents(name), member:ai_team_members(name, whatsapp_number)')
          .eq('user_id', user.id)
          .neq('status', 'encerrado')
          .order('last_interaction_at', { ascending: false }),
        (supabase as any)
          .from('ai_lead_transfers')
          .select('*, member:ai_team_members(name), agent:wa_ai_agents(name), lead:ai_crm_leads(lead_name, remote_jid)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(12),
        (supabase as any)
          .from('ai_team_members')
          .select('*')
          .eq('user_id', user.id)
          .order('is_active', { ascending: false })
          .order('last_lead_received_at', { ascending: true, nullsFirst: true }),
        (supabase as any)
          .from('wa_ai_agents')
          .select('id, name')
          .eq('user_id', user.id),
      ]);

      setLeads(leadsData || []);
      setTransfers(transfersData || []);
      setTeamMembers(membersData || []);
      setAgents(agentsData || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchLiveData();
  }, [fetchLiveData]);

  useEffect(() => {
    if (!user) return;

    const interval = window.setInterval(() => {
      fetchLiveData();
    }, 120000);

    const channel = supabase
      .channel('crm-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${user.id}` }, () => fetchLiveData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_lead_transfers', filter: `user_id=eq.${user.id}` }, () => fetchLiveData())
      .subscribe();

    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [fetchLiveData, user]);

  const activeMembers = useMemo(() => teamMembers.filter((member) => member.is_active), [teamMembers]);
  const memberStats = useMemo(() => getMemberStats(activeMembers, transfers), [activeMembers, transfers]);
  const nextSeller = useMemo(() => getNextInQueue(teamMembers, transfers), [teamMembers, transfers]);
  const leadsByColumn = useMemo(() => {
    return Object.fromEntries(
      LIVE_COLUMNS.map((column) => [
        column.id,
        leads.filter((lead) => (lead.status || 'novo') === column.id).slice(0, 6),
      ]),
    ) as Record<string, any[]>;
  }, [leads]);

  const totalQualified = leads.filter((lead) => lead.status === 'qualificado' || lead.status === 'transferido').length;
  const attendedNow = leads.filter((lead) => lead.status === 'transferido').length;

  const handleFullscreen = async () => {
    const element = document.documentElement;
    if (!document.fullscreenElement) {
      await element.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060816] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-200">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-lg">Carregando CRM ao vivo...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#060816] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.28),_transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(251,191,36,0.16),_transparent_24%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative z-10 p-6 xl:p-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/55 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge className="border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-cyan-100">
                    <MonitorPlay className="mr-2 h-4 w-4" />
                    CRM Ao Vivo
                  </Badge>
                  <Badge className="border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">
                    <Activity className="mr-2 h-4 w-4" />
                    Atualiza em tempo real + backup de 2 em 2 min
                  </Badge>
                </div>

                <div>
                  <h1 className="font-heading text-4xl font-bold tracking-tight text-white xl:text-5xl">
                    Central de Leads da Garagem
                  </h1>
                  <p className="mt-2 max-w-3xl text-base text-slate-300 xl:text-lg">
                    Um painel pensado para TV: fácil de ler à distância, com os leads chegando, o vendedor responsável por cada atendimento e o próximo da fila do Pedro.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => navigate(-1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Voltar
                </Button>
                <Button variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={fetchLiveData}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Atualizar agora
                </Button>
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-400 text-slate-950 hover:opacity-95" onClick={handleFullscreen}>
                  <Expand className="mr-2 h-4 w-4" />
                  Tela cheia
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              <LiveMetricCard icon={<Users className="h-5 w-5" />} label="Leads no painel" value={leads.length} tone="blue" />
              <LiveMetricCard icon={<Flame className="h-5 w-5" />} label="Leads qualificados" value={totalQualified} tone="emerald" />
              <LiveMetricCard icon={<UserCheck className="h-5 w-5" />} label="Em atendimento" value={attendedNow} tone="amber" />
              <LiveMetricCard icon={<Crown className="h-5 w-5" />} label="Vendedores ativos" value={activeMembers.length} tone="violet" />
              <LiveMetricCard
                icon={<CalendarClock className="h-5 w-5" />}
                label="Última atualização"
                value={lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                tone="slate"
              />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.9fr_1fr]">
            <div className="grid gap-4 md:grid-cols-2">
              {LIVE_COLUMNS.map((column) => (
                <section
                  key={column.id}
                  className={`rounded-[26px] border border-white/10 bg-gradient-to-br ${column.accent} p-[1px] shadow-[0_20px_50px_rgba(0,0,0,0.35)]`}
                >
                  <div className="h-full rounded-[25px] bg-slate-950/90 p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Status</p>
                        <h2 className="mt-1 text-2xl font-semibold text-white">{column.title}</h2>
                      </div>
                      <Badge className={column.badge}>{(leadsByColumn[column.id] || []).length}</Badge>
                    </div>

                    <div className="space-y-3">
                      {(leadsByColumn[column.id] || []).length === 0 ? (
                        <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-center text-slate-400">
                          Nenhum lead neste estágio
                        </div>
                      ) : (
                        (leadsByColumn[column.id] || []).map((lead) => (
                          <div key={lead.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-lg font-semibold text-white">
                                  {lead.lead_name || 'Lead sem nome'}
                                </h3>
                                <p className="mt-1 text-sm text-slate-400">
                                  {(lead.remote_jid || '').replace('@s.whatsapp.net', '')}
                                </p>
                              </div>
                              <Badge className="border border-white/10 bg-white/5 text-slate-100">
                                {formatRelative(lead.last_interaction_at)}
                              </Badge>
                            </div>

                            {lead.summary && (
                              <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">
                                {lead.summary}
                              </p>
                            )}

                            <div className="mt-4 grid gap-2 text-sm text-slate-200 md:grid-cols-2">
                              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Agente</p>
                                <p className="mt-1 truncate font-medium">{lead.agent?.name || 'Pedro'}</p>
                              </div>
                              <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Vendedor</p>
                                <p className="mt-1 truncate font-medium text-cyan-100">{lead.member?.name || 'Aguardando distribuição'}</p>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <div className="grid gap-4">
              <section className="rounded-[26px] border border-cyan-400/15 bg-slate-950/80 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Rodízio do Pedro</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Próximo da fila</h2>
                  </div>
                  <Sparkles className="h-6 w-6 text-cyan-300" />
                </div>

                <div className="mt-5 rounded-3xl border border-cyan-300/15 bg-cyan-400/10 p-5">
                  <p className="text-sm text-cyan-100/80">Próximo vendedor a receber um lead qualificado</p>
                  <p className="mt-2 text-3xl font-bold text-white">
                    {nextSeller?.name || 'Nenhum vendedor ativo'}
                  </p>
                  <p className="mt-2 text-sm text-cyan-50/70">
                    {nextSeller?.whatsapp_number || 'Cadastre vendedores ativos para ativar o rodízio.'}
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  {memberStats.slice(0, 5).map((member, index) => (
                    <div key={member.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-400">#{index + 1}</p>
                        <p className="truncate text-lg font-semibold text-white">{member.name}</p>
                        <p className="text-sm text-slate-400">{member.whatsapp_number}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-cyan-100">{member.todayCount}</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Hoje</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[26px] border border-white/10 bg-slate-950/80 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Transferências recentes</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Quem pegou o lead</h2>
                  </div>
                  <TrendingUp className="h-6 w-6 text-amber-300" />
                </div>

                <div className="mt-4 space-y-3">
                  {transfers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-slate-400">
                      Nenhuma transferência registrada ainda.
                    </div>
                  ) : (
                    transfers.map((transfer) => (
                      <div key={transfer.id} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-lg font-semibold text-white">
                              {transfer.lead?.lead_name || transfer.lead?.remote_jid || 'Lead'}
                            </p>
                            <p className="mt-1 truncate text-sm text-slate-400">
                              {transfer.member?.name || 'Sem vendedor'} • {getTransferReasonLabel(transfer)}
                            </p>
                          </div>
                          <Badge className="border border-white/10 bg-white/5 text-slate-100">
                            {new Date(transfer.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-[26px] border border-white/10 bg-slate-950/80 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Agentes em operação</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">Base do painel</h2>
                  </div>
                  <Users className="h-6 w-6 text-violet-300" />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {agents.length === 0 ? (
                    <p className="text-slate-400">Nenhum agente encontrado.</p>
                  ) : (
                    agents.map((agent) => (
                      <Badge key={agent.id} className="border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-violet-100">
                        {agent.name}
                      </Badge>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveMetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone: 'blue' | 'emerald' | 'amber' | 'violet' | 'slate';
}) {
  const toneClasses = {
    blue: 'border-blue-300/15 bg-blue-400/10 text-blue-100',
    emerald: 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-300/15 bg-amber-400/10 text-amber-100',
    violet: 'border-violet-300/15 bg-violet-400/10 text-violet-100',
    slate: 'border-white/10 bg-white/[0.04] text-slate-100',
  } as const;

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] opacity-70">{label}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
          {icon}
        </div>
      </div>
    </div>
  );
}
