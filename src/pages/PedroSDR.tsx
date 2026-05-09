import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, MonitorPlay, BarChart3, Loader2, Users, MessageSquare,
  ArrowRightLeft, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Zap, PhoneCall, NotebookPen, Send, CalendarClock, Flag,
  ChevronRight, StickyNote, BellRing, RefreshCw, Eye, EyeOff,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const WhatsAppAIAgent = lazy(() => import('./WhatsAppAIAgent'));
const CrmAoVivo       = lazy(() => import('./CrmAoVivo'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-6 w-6 animate-spin text-primary" />
  </div>
);

// ─── Tipos de dados ──────────────────────────────────────────────────────────

interface PerfData {
  totalLeads: number;
  leadsHoje: number;
  transferencias: number;
  taxaConversao: number;
  totalRespostas: number;
  agentesAtivos: number;
  leadsPorStatus: { name: string; value: number; color: string }[];
  atividadeSemanal: { dia: string; leads: number; transferencias: number }[];
  agentes: { nome: string; respostas: number; leads: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  novo:       '#3B82F6',
  qualificado:'#10B981',
  aguardando: '#F59E0B',
  transferido:'#8B5CF6',
  encerrado:  '#EF4444',
  perdido:    '#6B7280',
};

// ─── Hook de dados ───────────────────────────────────────────────────────────

function usePerfData(userId: string | undefined) {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    async function load() {
      setLoading(true);
      try {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const seteAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [leadsRes, transRes, agentRes] = await Promise.all([
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, status, created_at')
            .eq('user_id', userId),
          (supabase as any)
            .from('ai_lead_transfers')
            .select('id, created_at, lead_id')
            .eq('user_id', userId),
          (supabase as any)
            .from('wa_ai_agents')
            .select('id, name, total_replies, is_active')
            .eq('user_id', userId),
        ]);

        const leads: any[]  = leadsRes.data  || [];
        const trans: any[]  = transRes.data  || [];
        const agents: any[] = agentRes.data  || [];

        // ── métricas brutas ─────────────────────────────────────────────────
        const totalLeads     = leads.length;
        const leadsHoje      = leads.filter(l => new Date(l.created_at) >= hoje).length;
        const transferencias = trans.length;
        const taxaConversao  = totalLeads > 0 ? Math.round((transferencias / totalLeads) * 100) : 0;
        const totalRespostas = agents.reduce((s: number, a: any) => s + (a.total_replies || 0), 0);
        const agentesAtivos  = agents.filter((a: any) => a.is_active).length;

        // ── leads por status ─────────────────────────────────────────────────
        const statusCount: Record<string, number> = {};
        leads.forEach((l: any) => {
          const s = l.status || 'novo';
          statusCount[s] = (statusCount[s] || 0) + 1;
        });
        const leadsPorStatus = Object.entries(statusCount).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
          color: STATUS_COLORS[name] || '#6B7280',
        }));

        // ── atividade últimos 7 dias ──────────────────────────────────────────
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const atividadeSemanal = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          d.setHours(0, 0, 0, 0);
          const fim = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          return {
            dia: dias[d.getDay()],
            leads: leads.filter((l: any) => {
              const t = new Date(l.created_at);
              return t >= d && t < fim;
            }).length,
            transferencias: trans.filter((t: any) => {
              const tt = new Date(t.created_at);
              return tt >= d && tt < fim;
            }).length,
          };
        });

        // ── ranking de agentes ────────────────────────────────────────────────
        const agentesRank = agents.map((a: any) => ({
          nome: a.name,
          respostas: a.total_replies || 0,
          leads: leads.filter((l: any) => l.agent_id === a.id).length,
        })).sort((a, b) => b.respostas - a.respostas).slice(0, 5);

        setData({
          totalLeads, leadsHoje, transferencias, taxaConversao,
          totalRespostas, agentesAtivos, leadsPorStatus,
          atividadeSemanal, agentes: agentesRank,
        });
      } catch {
        // silently ignore — tables may not exist in all envs
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [userId]);

  return { data, loading };
}

// ─── Componente de métrica ────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; trend?: number;
}) {
  return (
    <Card className="bg-card border-border/50">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`mt-3 flex items-center gap-1 text-[11px] font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            <TrendingUp className={`h-3 w-3 ${trend < 0 ? 'rotate-180' : ''}`} />
            {trend >= 0 ? '+' : ''}{trend}% vs. semana anterior
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Tab Performance ──────────────────────────────────────────────────────────

function PerformanceTab({ userId }: { userId: string | undefined }) {
  const { data, loading } = usePerfData(userId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <AlertCircle className="h-8 w-8 opacity-40" />
        <p className="text-sm">Não foi possível carregar os dados de performance.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* ── KPIs ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Leads Totais"
          value={data.totalLeads}
          sub="todos os períodos"
          icon={Users}
          color="bg-blue-500/15 text-blue-400"
        />
        <MetricCard
          label="Leads Hoje"
          value={data.leadsHoje}
          sub="nas últimas 24h"
          icon={Zap}
          color="bg-cyan-500/15 text-cyan-400"
        />
        <MetricCard
          label="Transferências"
          value={data.transferencias}
          sub="para humano"
          icon={ArrowRightLeft}
          color="bg-purple-500/15 text-purple-400"
        />
        <MetricCard
          label="Taxa de Conversão"
          value={`${data.taxaConversao}%`}
          sub="lead → transferência"
          icon={CheckCircle2}
          color="bg-emerald-500/15 text-emerald-400"
        />
        <MetricCard
          label="Respostas IA"
          value={data.totalRespostas.toLocaleString()}
          sub="total de mensagens"
          icon={MessageSquare}
          color="bg-orange-500/15 text-orange-400"
        />
        <MetricCard
          label="Agentes Ativos"
          value={data.agentesAtivos}
          sub="em operação agora"
          icon={Bot}
          color="bg-rose-500/15 text-rose-400"
        />
      </div>

      {/* ── Gráficos ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Atividade Semanal */}
        <Card className="lg:col-span-2 bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Atividade — Últimos 7 Dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.atividadeSemanal.every(d => d.leads === 0 && d.transferencias === 0) ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum dado no período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.atividadeSemanal} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1E2533', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#E2E8F0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }} />
                  <Bar dataKey="leads"         name="Leads"          fill="#3B82F6" radius={[3,3,0,0]} />
                  <Bar dataKey="transferencias" name="Transferências" fill="#8B5CF6" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Leads por Status */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-purple-400" />
              Leads por Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.leadsPorStatus.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum lead cadastrado
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.leadsPorStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {data.leadsPorStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1E2533', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number, n: string) => [v, n]}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ranking de Agentes ───────────────────────────────────── */}
      {data.agentes.length > 0 && (
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 text-cyan-400" />
              Ranking de Agentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.agentes.map((a, i) => {
                const maxR = Math.max(...data.agentes.map(x => x.respostas), 1);
                const pct  = Math.round((a.respostas / maxR) * 100);
                return (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-4 text-right">{i + 1}.</span>
                        <span className="font-medium text-foreground">{a.nome}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{a.respostas.toLocaleString()} respostas</span>
                        {a.leads > 0 && <span className="text-blue-400">{a.leads} leads</span>}
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  low:    { label: 'Baixa',   color: 'text-slate-400',   bg: 'bg-slate-500/10' },
  normal: { label: 'Normal',  color: 'text-blue-400',    bg: 'bg-blue-500/10'  },
  high:   { label: 'Alta',    color: 'text-orange-400',  bg: 'bg-orange-500/10'},
  urgent: { label: 'Urgente', color: 'text-red-400',     bg: 'bg-red-500/10'   },
} as const;

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Tab CRM Avançado ─────────────────────────────────────────────────────────

interface CrmLead {
  id: string;
  lead_name: string;
  remote_jid: string;
  status_crm: string;
  next_followup_at: string | null;
  seller_notes_count: number;
  assigned_to_id: string | null;
  member?: { id: string; name: string } | null;
  created_at: string;
}

interface Note {
  id: string;
  lead_id: string;
  content: string;
  created_at: string;
  member?: { name: string } | null;
}

interface Feedback {
  id: string;
  lead_id: string;
  content: string;
  priority: string;
  read_at: string | null;
  created_at: string;
  member?: { name: string } | null;
  lead?: { lead_name: string } | null;
}

interface FollowupSchedule {
  id: string;
  lead_id: string;
  scheduled_at: string;
  message_template: string;
  status: string;
  created_at: string;
}

function CrmAvancadoTab({ userId }: { userId: string | undefined }) {
  const { toast } = useToast();
  const [isSeller, setIsSeller] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [schedules, setSchedules] = useState<FollowupSchedule[]>([]);
  const [view, setView] = useState<'leads' | 'feedbacks'>('leads');

  // form states
  const [newNote, setNewNote]             = useState('');
  const [noteLoading, setNoteLoading]     = useState(false);
  const [fbContent, setFbContent]         = useState('');
  const [fbPriority, setFbPriority]       = useState<'low'|'normal'|'high'|'urgent'>('normal');
  const [fbLoading, setFbLoading]         = useState(false);
  const [fuMsg, setFuMsg]                 = useState('');
  const [fuDate, setFuDate]               = useState('');
  const [fuInstance, setFuInstance]       = useState('');
  const [fuLoading, setFuLoading]         = useState(false);
  const [refreshing, setRefreshing]       = useState(false);

  // detect seller vs gerente
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('ai_team_members')
        .select('id, user_id')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (data) { setIsSeller(true); setMemberId(data.id); }
    })();
  }, [userId]);

  const fetchData = async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).maybeSingle()).data?.user_id ?? userId
        : userId;

      const [leadsRes, fbRes, instRes] = await Promise.all([
        (supabase as any)
          .from('ai_crm_leads')
          .select('id, lead_name, remote_jid, status_crm, next_followup_at, seller_notes_count, assigned_to_id, created_at, member:ai_team_members(id, name)')
          .eq('user_id', effectiveUserId)
          .order('created_at', { ascending: false })
          .limit(60),
        (supabase as any)
          .from('pedro_manager_feedback')
          .select('id, lead_id, content, priority, read_at, created_at, member:ai_team_members(name), lead:ai_crm_leads(lead_name)')
          .eq('user_id', isSeller ? userId : effectiveUserId)
          .order('created_at', { ascending: false })
          .limit(50),
        (supabase as any)
          .from('wa_instances')
          .select('id, friendly_name')
          .eq('user_id', effectiveUserId)
          .eq('is_active', true),
      ]);

      setLeads(leadsRes.data || []);
      setFeedbacks(fbRes.data || []);
      setInstances(instRes.data || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [userId, isSeller]);

  const loadLeadDetail = async (lead: CrmLead) => {
    setSelectedLead(lead);
    const [notesRes, schedRes] = await Promise.all([
      (supabase as any)
        .from('pedro_crm_notes')
        .select('id, lead_id, content, created_at, member:ai_team_members(name)')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('pedro_followup_schedules')
        .select('id, lead_id, scheduled_at, message_template, status, created_at')
        .eq('lead_id', lead.id)
        .order('scheduled_at', { ascending: true }),
    ]);
    setNotes(notesRes.data || []);
    setSchedules(schedRes.data || []);
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedLead || !userId) return;
    setNoteLoading(true);
    try {
      const { error } = await (supabase as any).from('pedro_crm_notes').insert({
        lead_id:   selectedLead.id,
        user_id:   userId,
        member_id: memberId,
        content:   newNote.trim(),
      });
      if (error) throw error;
      setNewNote('');
      toast({ title: '✅ Anotação salva!' });
      await loadLeadDetail(selectedLead);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setNoteLoading(false);
    }
  };

  const handleScheduleFollowup = async () => {
    if (!fuMsg.trim() || !fuDate || !selectedLead || !userId) return;
    setFuLoading(true);
    try {
      const { error } = await (supabase as any).from('pedro_followup_schedules').insert({
        lead_id:          selectedLead.id,
        user_id:          userId,
        member_id:        memberId,
        scheduled_at:     new Date(fuDate).toISOString(),
        message_template: fuMsg.trim(),
        instance_id:      fuInstance || null,
        status:           'pending',
      });
      if (error) throw error;
      // Atualiza next_followup_at no lead
      await (supabase as any).from('ai_crm_leads').update({ next_followup_at: new Date(fuDate).toISOString() }).eq('id', selectedLead.id);
      setFuMsg(''); setFuDate(''); setFuInstance('');
      toast({ title: '✅ Follow-up agendado!' });
      await loadLeadDetail(selectedLead);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setFuLoading(false);
    }
  };

  const handleSendFeedback = async () => {
    if (!fbContent.trim() || !selectedLead || !userId) return;
    setFbLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await supabase.functions.invoke('pedro-process-feedback', {
        body: {
          lead_id:   selectedLead.id,
          member_id: memberId,
          content:   fbContent.trim(),
          priority:  fbPriority,
        },
      });
      if (res.error) throw res.error;
      setFbContent(''); setFbPriority('normal');
      toast({ title: '✅ Feedback enviado ao gerente!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setFbLoading(false);
    }
  };

  const markFeedbackRead = async (id: string) => {
    await (supabase as any).from('pedro_manager_feedback').update({ read_at: new Date().toISOString() }).eq('id', id);
    setFeedbacks(prev => prev.map(f => f.id === id ? { ...f, read_at: new Date().toISOString() } : f));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  // ── Lead Detail Panel ──────────────────────────────────────────────────────
  if (selectedLead) {
    return (
      <div className="p-4 lg:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedLead(null)} className="h-8 px-2 gap-1 text-xs text-muted-foreground">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Voltar
          </Button>
          <div>
            <h2 className="text-base font-semibold text-foreground">{selectedLead.lead_name || selectedLead.remote_jid}</h2>
            <p className="text-xs text-muted-foreground">{selectedLead.member?.name ?? 'Sem vendedor'} · {fmtDate(selectedLead.created_at)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── Anotações ─────────────────────────────────────────────── */}
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-yellow-400" /> Anotações
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Escreva uma anotação sobre este lead..."
                  className="min-h-[70px] text-xs resize-none"
                />
                <Button onClick={handleAddNote} disabled={noteLoading || !newNote.trim()} size="sm" className="h-auto px-3 self-end">
                  {noteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {notes.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhuma anotação ainda.</p>
                )}
                {notes.map(n => (
                  <div key={n.id} className="bg-muted/40 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-foreground leading-relaxed">{n.content}</p>
                    <p className="text-[10px] text-muted-foreground">{n.member?.name ?? 'Vendedor'} · {fmtDate(n.created_at)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Follow-up ─────────────────────────────────────────────── */}
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-cyan-400" /> Agendar Follow-up
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={fuMsg}
                onChange={e => setFuMsg(e.target.value)}
                placeholder="Mensagem a enviar ao lead..."
                className="min-h-[60px] text-xs resize-none"
              />
              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={fuDate}
                  onChange={e => setFuDate(e.target.value)}
                  className="text-xs h-8 flex-1"
                />
                {instances.length > 0 && (
                  <Select value={fuInstance} onValueChange={setFuInstance}>
                    <SelectTrigger className="h-8 text-xs w-36">
                      <SelectValue placeholder="Instância" />
                    </SelectTrigger>
                    <SelectContent>
                      {instances.map(i => (
                        <SelectItem key={i.id} value={i.id} className="text-xs">{i.friendly_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button
                onClick={handleScheduleFollowup}
                disabled={fuLoading || !fuMsg.trim() || !fuDate}
                size="sm" className="w-full h-8 text-xs"
              >
                {fuLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CalendarClock className="h-3.5 w-3.5 mr-1.5" />}
                Agendar Follow-up
              </Button>

              {/* Lista de agendamentos */}
              {schedules.filter(s => s.status === 'pending').length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Agendados</p>
                  {schedules.filter(s => s.status === 'pending').map(s => (
                    <div key={s.id} className="flex items-start gap-2 bg-muted/40 rounded-lg px-3 py-2">
                      <Clock className="h-3 w-3 text-cyan-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[10px] text-cyan-400 font-medium">{fmtDate(s.scheduled_at)}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{s.message_template}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Feedback para Gerente ──────────────────────────────────── */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BellRing className="h-4 w-4 text-orange-400" /> Feedback para Gerente
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Textarea
                value={fbContent}
                onChange={e => setFbContent(e.target.value)}
                placeholder="Descreva o que o gerente precisa saber sobre este lead..."
                className="min-h-[80px] text-xs resize-none flex-1"
              />
              <div className="flex flex-col gap-2 sm:w-40">
                <Select value={fbPriority} onValueChange={v => setFbPriority(v as any)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_CONFIG) as [string, typeof PRIORITY_CONFIG[keyof typeof PRIORITY_CONFIG]][]).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        <span className={v.color}>{v.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleSendFeedback}
                  disabled={fbLoading || !fbContent.trim()}
                  size="sm" className="h-8 text-xs"
                >
                  {fbLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Enviar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main Panel ─────────────────────────────────────────────────────────────
  const unreadFeedbacks = feedbacks.filter(f => !f.read_at);

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Sub-nav + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-muted/40 rounded-lg p-1">
          {[
            { id: 'leads',     label: 'Leads',    icon: Users },
            { id: 'feedbacks', label: 'Feedbacks', icon: BellRing, badge: unreadFeedbacks.length },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === v.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
              {v.badge ? (
                <span className="ml-0.5 bg-orange-500 text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold">{v.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
        <Button
          variant="ghost" size="sm"
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* ── Leads List ──────────────────────────────────────────────── */}
      {view === 'leads' && (
        <div className="space-y-2">
          {leads.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              Nenhum lead encontrado.
            </div>
          )}
          {leads.map(lead => (
            <button
              key={lead.id}
              onClick={() => loadLeadDetail(lead)}
              className="w-full text-left bg-card border border-border/50 rounded-xl px-4 py-3 hover:border-blue-500/40 hover:bg-blue-500/5 transition-all group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <Users className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {lead.lead_name || lead.remote_jid}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {lead.member?.name ?? 'Sem vendedor'} · {fmtDate(lead.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.seller_notes_count > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                      <StickyNote className="h-3 w-3" />{lead.seller_notes_count}
                    </span>
                  )}
                  {lead.next_followup_at && (
                    <span className="flex items-center gap-1 text-[10px] text-cyan-400">
                      <Clock className="h-3 w-3" />{fmtDate(lead.next_followup_at)}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[10px] h-5 capitalize">
                    {lead.status_crm || 'novo'}
                  </Badge>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Feedbacks List (gerente) ─────────────────────────────────── */}
      {view === 'feedbacks' && (
        <div className="space-y-2">
          {feedbacks.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <BellRing className="h-8 w-8 mx-auto mb-3 opacity-30" />
              Nenhum feedback recebido ainda.
            </div>
          )}
          {feedbacks.map(fb => {
            const pCfg = PRIORITY_CONFIG[fb.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.normal;
            return (
              <div
                key={fb.id}
                className={`bg-card border rounded-xl px-4 py-3 transition-colors ${
                  fb.read_at ? 'border-border/40 opacity-70' : 'border-orange-500/30 bg-orange-500/5'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pCfg.bg} ${pCfg.color}`}>
                        {pCfg.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {fb.member?.name ?? 'Vendedor'} · {fb.lead?.lead_name ?? 'Lead'} · {fmtDate(fb.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{fb.content}</p>
                  </div>
                  {!fb.read_at && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => markFeedbackRead(fb.id)}
                      className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Eye className="h-3 w-3 mr-1" /> Lido
                    </Button>
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

// ─── Página principal ─────────────────────────────────────────────────────────

const TABS = [
  { id: 'performance', label: 'Performance',  icon: BarChart3,    emoji: '📊' },
  { id: 'crm',         label: 'CRM Avançado', icon: NotebookPen,  emoji: '🗒️' },
  { id: 'agente',      label: 'Agente IA',    icon: Bot,          emoji: '🤖' },
  { id: 'ao-vivo',     label: 'CRM ao Vivo',  icon: MonitorPlay,  emoji: '📺' },
];

export default function PedroSDR() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('performance');

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-1 pt-1 pb-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center">
            <Bot className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-foreground">Pedro</h1>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 inline-block" />
                Agente Online
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">SDR — Qualificação de Leads & Automação Comercial</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-border/40">
            <TabsList className="h-auto bg-transparent p-0 gap-1">
              {TABS.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-500 data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-all"
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <TabsContent value="performance" className="mt-0">
              <PerformanceTab userId={user?.id} />
            </TabsContent>

            <TabsContent value="crm" className="mt-0">
              <CrmAvancadoTab userId={user?.id} />
            </TabsContent>

            <Suspense fallback={<TabLoader />}>
              <TabsContent value="agente"   className="mt-0 h-full">
                <WhatsAppAIAgent embedded />
              </TabsContent>
              <TabsContent value="ao-vivo"  className="mt-0 h-full">
                <CrmAoVivo embedded />
              </TabsContent>
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
