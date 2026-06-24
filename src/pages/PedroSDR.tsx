import { useState, useEffect, useMemo, useRef, lazy, Suspense, useCallback, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Fase 6.4 — Campos dinâmicos (cidades + origens cadastráveis pelo vendedor)
import { DynamicSelect } from '@/components/dynamic-fields/DynamicSelect';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, MonitorPlay, BarChart3, Loader2, Users, MessageSquare, Inbox,
  ArrowRightLeft, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Zap, PhoneCall, NotebookPen, Send, CalendarClock, Flag,
  ChevronRight, StickyNote, BellRing, RefreshCw, Eye, EyeOff,
  Pin, PinOff, Image, Mic, Video, Upload, X, Trash2,
  Plus, GripVertical, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle,
  Pencil, Check, Trophy,
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import * as XLSX from 'xlsx';

const WhatsAppAIAgent    = lazy(() => import('./WhatsAppAIAgent'));
const CrmAoVivo          = lazy(() => import('./CrmAoVivo')); // mantido pra retrocompat (rota /whatsapp/crm-ao-vivo)
const DashboardTV        = lazy(() => import('./DashboardTV'));
const WhatsAppInbox      = lazy(() => import('./WhatsAppInbox'));
import { FollowupFunnelBuilder } from '@/components/pedro/FollowupFunnelBuilder';
import { FollowupIAConfigModal } from '@/components/pedro/FollowupIAConfigModal';
import { ConsignadoVehicleForm } from '@/components/marcos/ConsignadoVehicleForm';
import { SellerManagerTab } from '@/components/pedro/SellerManagerTab';
import { FeedbackAnalytics } from '@/components/pedro/FeedbackAnalytics';
import { ManagerFeedbackConfigCard } from '@/components/pedro/ManagerFeedbackConfigCard';
import { CampanhaAnalytics } from '@/components/pedro/CampanhaAnalytics';
import { QualificacaoResumo } from '@/components/pedro/QualificacaoResumo';
import { AgentInboxTab } from '@/components/pedro/AgentInboxTab';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { usePendingTransfers, formatPendingAge } from '@/hooks/usePendingTransfers';
import { FEATURES } from '@/config/features';

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
  /** 0-100 — média ponderada IA 50% + Feedback 30% + Notas 20% (Fase 3 DashboardTV) */
  qualidadeMedia: number;
  qualidadeLabel: 'Ótimo' | 'Bom' | 'Médio' | 'Baixo' | 'Sem dados';
  leadsPorStatus: { name: string; value: number; color: string }[];
  atividadeSemanal: { dia: string; leads: number; transferencias: number }[];
  agentes: { nome: string; respostas: number; leads: number }[];
  vendedores: { nome: string; leads: number; qualificados: number; whatsapp: string }[];
}

// ─── Cálculo de qualidade do lead (compartilhado entre DashboardTV e Performance) ───

function scorePedroStatusCrm(status: string | null | undefined): number {
  if (!status) return 0;
  const map: Record<string, number> = {
    qualificado: 100, medio_qualificado: 70, pouco_qualificado: 40,
    transferido: 100, em_atendimento: 50, novo: 20, inativo: 0,
    fechado: 100, perdido: 0,
  };
  return map[status] ?? 20;
}

function scorePedroFeedback(priority: string | null | undefined): number {
  if (!priority) return 0;
  const map: Record<string, number> = { urgent: 100, high: 75, normal: 50, low: 25 };
  return map[priority] ?? 0;
}

function scorePedroNotes(count: number | null | undefined): number {
  const c = count || 0;
  if (c >= 3) return 100;
  if (c >= 1) return 60;
  return 0;
}

function combinePedroQuality(iaScore: number, fbScore: number | null, notesScore: number): number {
  if (fbScore === null) return Math.round((iaScore * 0.7) + (notesScore * 0.3));
  return Math.round((iaScore * 0.5) + (fbScore * 0.3) + (notesScore * 0.2));
}

function qualidadeLabelFor(score: number, hasData: boolean): PerfData['qualidadeLabel'] {
  if (!hasData) return 'Sem dados';
  if (score >= 80) return 'Ótimo';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Médio';
  return 'Baixo';
}

const STATUS_COLORS: Record<string, string> = {
  novo:               '#3B82F6',
  inativo:            '#9CA3AF',
  pouco_qualificado:  '#F97316',
  medio_qualificado:  '#F59E0B',
  qualificado:        '#10B981',
  aguardando:         '#F59E0B',
  transferido:        '#8B5CF6',
  perdido:            '#6B7280',
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
        // ── 1. Detecta se é vendedor e resolve IDs ──────────────────────────
        const { data: memberRows } = await (supabase as any)
          .from('ai_team_members')
          .select('id, user_id')
          .eq('auth_user_id', userId);
        const memberList = Array.isArray(memberRows) && memberRows.length > 0 ? memberRows : null;
        const isSeller    = !!memberList;
        const masterUid   = isSeller ? memberList![0].user_id : userId;
        const memberIds   = isSeller ? memberList!.map((m: any) => m.id) : [];

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        // ── 2. Queries base (usa masterUid para buscar dados certos) ────────
        const [leadsRes, transRes, agentRes, teamRes] = await Promise.all([
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, status, status_crm, assigned_to_id, agent_id, created_at, seller_notes_count')
            .eq('user_id', masterUid),
          (supabase as any)
            .from('ai_lead_transfers')
            .select('id, created_at, lead_id, to_member_id')
            .eq('user_id', masterUid),
          (supabase as any)
            .from('wa_ai_agents')
            .select('id, name, total_replies, is_active')
            .eq('user_id', masterUid),
          (supabase as any)
            .from('ai_team_members')
            .select('id, name, whatsapp_number, is_active')
            .eq('user_id', masterUid),
        ]);

        const allLeads: any[] = leadsRes.data  || [];
        const allTrans: any[] = transRes.data  || [];
        const agents: any[]   = agentRes.data  || [];
        const sellers: any[]  = teamRes.data   || [];

        // ── 3. Filtra para o vendedor (se for seller) ───────────────────────
        const leads = isSeller
          ? allLeads.filter(l => l.assigned_to_id && memberIds.includes(l.assigned_to_id))
          : allLeads;
        const trans = isSeller
          ? allTrans.filter(t => t.to_member_id && memberIds.includes(t.to_member_id))
          : allTrans;

        // ── métricas brutas ─────────────────────────────────────────────────
        const totalLeads     = leads.length;
        const leadsHoje      = leads.filter(l => new Date(l.created_at) >= hoje).length;
        const transferencias = isSeller ? leads.filter(l => l.status === 'transferido').length : trans.length;
        const taxaConversao  = totalLeads > 0 ? Math.round((transferencias / totalLeads) * 100) : 0;
        const totalRespostas = agents.reduce((s: number, a: any) => s + (a.total_replies || 0), 0);
        const agentesAtivos  = agents.filter((a: any) => a.is_active).length;

        // ── qualidade média (IA 50% + Feedback 30% + Notas 20%) ─────────────
        // Busca feedbacks dos leads do escopo
        const leadIds = leads.map((l: any) => l.id);
        const feedbackByLead = new Map<string, string>();
        if (leadIds.length > 0) {
          const { data: fbRows } = await (supabase as any)
            .from('pedro_manager_feedback')
            .select('lead_id, priority, created_at')
            .in('lead_id', leadIds)
            .order('created_at', { ascending: false });
          for (const fb of (fbRows || []) as Array<{ lead_id: string; priority: string }>) {
            if (!feedbackByLead.has(fb.lead_id)) feedbackByLead.set(fb.lead_id, fb.priority);
          }
        }
        const scores = leads.map((l: any) => {
          const ia    = scorePedroStatusCrm(l.status_crm);
          const fbPri = feedbackByLead.get(l.id);
          const fb    = fbPri ? scorePedroFeedback(fbPri) : null;
          const notes = scorePedroNotes(l.seller_notes_count);
          return combinePedroQuality(ia, fb, notes);
        });
        const qualidadeMedia = scores.length > 0
          ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
          : 0;
        const qualidadeLabel = qualidadeLabelFor(qualidadeMedia, scores.length > 0);

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
            transferencias: isSeller
              ? leads.filter((l: any) => {
                  const t = new Date(l.created_at);
                  return t >= d && t < fim && l.status === 'transferido';
                }).length
              : trans.filter((t: any) => {
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

        // ── ranking de vendedores ─────────────────────────────────────────────
        // Deduplica por whatsapp_number
        const sellerMap = new Map<string, { nome: string; whatsapp: string; ids: string[] }>();
        for (const s of sellers) {
          const key = s.whatsapp_number || s.id;
          const existing = sellerMap.get(key);
          if (!existing) {
            sellerMap.set(key, { nome: s.name, whatsapp: s.whatsapp_number || '', ids: [s.id] });
          } else {
            existing.ids.push(s.id);
          }
        }
        const vendedoresRank = Array.from(sellerMap.values()).map(s => ({
          nome: s.nome,
          whatsapp: s.whatsapp,
          leads: allLeads.filter((l: any) => l.assigned_to_id && s.ids.includes(l.assigned_to_id)).length,
          qualificados: allLeads.filter((l: any) => l.assigned_to_id && s.ids.includes(l.assigned_to_id) && ['qualificado', 'medio_qualificado', 'pouco_qualificado'].includes(l.status_crm)).length,
        })).sort((a, b) => b.leads - a.leads);

        setData({
          totalLeads, leadsHoje, transferencias, taxaConversao,
          totalRespostas, agentesAtivos,
          qualidadeMedia, qualidadeLabel,
          leadsPorStatus,
          atividadeSemanal, agentes: agentesRank, vendedores: vendedoresRank,
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
      {/* ── KPIs (grid 7 com qualidade média adicionada) ─────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
          label="Qualidade Média"
          value={data.qualidadeLabel === 'Sem dados' ? '—' : `${data.qualidadeMedia}%`}
          sub={data.qualidadeLabel}
          icon={Trophy}
          color={
            data.qualidadeMedia >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
            data.qualidadeMedia >= 60 ? 'bg-blue-500/15 text-blue-400' :
            data.qualidadeMedia >= 40 ? 'bg-amber-500/15 text-amber-400' :
            'bg-red-500/15 text-red-400'
          }
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

      {/* ── Rankings ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ranking de Vendedores */}
        {data.vendedores.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                Ranking de Vendedores
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.vendedores.map((v, i) => {
                  const maxL = Math.max(...data.vendedores.map(x => x.leads), 1);
                  const pct  = Math.round((v.leads / maxL) * 100);
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            i === 0 ? 'bg-amber-500/20 text-amber-400' :
                            i === 1 ? 'bg-slate-400/20 text-slate-300' :
                            i === 2 ? 'bg-orange-500/20 text-orange-400' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="min-w-0">
                            <span className="font-medium text-foreground">{v.nome}</span>
                            {v.whatsapp && <p className="text-[10px] text-muted-foreground">{v.whatsapp}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                          <span className="text-blue-400 font-semibold">{v.leads} leads</span>
                          <span className="text-emerald-400">{v.qualificados} qualif.</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-700"
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

        {/* Ranking de Agentes */}
        {data.agentes.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-4 w-4 text-cyan-400" />
                Ranking de Agentes IA
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
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Qualificação do lead pelo vendedor (no feedback ao gerente). 3 níveis.
// Mantemos os valores internos low/normal/high para compatibilidade com o banco;
// 'urgent' é legado (antigo "Pronto pra comprar") e hoje conta como Qualificado.
const PRIORITY_CONFIG = {
  low:    { label: '🔴 Inativo',           color: 'text-red-400',     bg: 'bg-red-500/10',     desc: 'Não responde',         tip: 'Lead que não responde' },
  normal: { label: '🟡 Pouco qualificado', color: 'text-amber-400',   bg: 'bg-amber-500/10',   desc: 'Parou de responder',   tip: 'Lead que parou de responder' },
  high:   { label: '🟢 Qualificado',       color: 'text-emerald-400', bg: 'bg-emerald-500/10', desc: 'Demonstrou interesse', tip: 'Lead que demonstrou real interesse' },
} as const;

// Config de exibição para qualquer valor salvo (inclui o legado 'urgent' → Qualificado).
function priorityCfg(p: string | null | undefined): typeof PRIORITY_CONFIG[keyof typeof PRIORITY_CONFIG] {
  if (p === 'urgent') return PRIORITY_CONFIG.high;
  return PRIORITY_CONFIG[p as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.normal;
}

// ─── Filtro de data dos leads (Hoje / Ontem / Semana / Mês / Personalizado) ───
// Usado nos DOIS CRMs (Pedro e Marcos), pra vendedor ou master ver quais leads
// chegaram em cada período. Retorna [inicioMs, fimMs] inclusivo, ou null = sem filtro.
type LeadDatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';

const LEAD_DATE_PRESETS: { value: LeadDatePreset; label: string }[] = [
  { value: 'all',       label: 'Todo período' },
  { value: 'today',     label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'week',      label: 'Esta semana' },
  { value: 'month',     label: 'Este mês' },
  { value: 'custom',    label: 'Personalizado' },
];

function leadDateRange(preset: LeadDatePreset, customFrom: string, customTo: string): [number, number] | null {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  switch (preset) {
    case 'today':
      return [today.getTime(), now.getTime()];
    case 'yesterday': {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return [y.getTime(), today.getTime() - 1];
    }
    case 'week': {
      const w = new Date(today); w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
      return [w.getTime(), now.getTime()];
    }
    case 'month': {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      return [m.getTime(), now.getTime()];
    }
    case 'custom': {
      if (!customFrom && !customTo) return null;
      const from = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : 0;
      const to   = customTo   ? new Date(customTo   + 'T23:59:59').getTime() : now.getTime();
      return [from, to];
    }
    case 'all':
    default:
      return null;
  }
}

// ─── Diagnóstico: motivos de NÃO-transferência ───────────────────────────────
// As 8 categorias pelas quais um lead pode NÃO ter sido transferido pro vendedor.
// Os códigos batem 1:1 com o CHECK da tabela pedro_transfer_failures.
type TransferFailureReason =
  | 'lead_nao_qualificado' | 'lead_inativo' | 'sem_vendedor_disponivel'
  | 'erro_tecnico' | 'funil_timeout' | 'regra_nao_atingida'
  | 'agente_nao_executou' | 'outros';

const TRANSFER_FAILURE_REASONS: {
  value: TransferFailureReason; label: string; short: string;
  color: string; bg: string; hex: string;
}[] = [
  { value: 'lead_nao_qualificado',    label: 'Lead não qualificado',       short: 'Não qualificado', color: 'text-amber-400',   bg: 'bg-amber-500/10',   hex: '#fbbf24' },
  { value: 'lead_inativo',            label: 'Lead inativo',               short: 'Inativo',         color: 'text-red-400',     bg: 'bg-red-500/10',     hex: '#f87171' },
  { value: 'sem_vendedor_disponivel', label: 'Nenhum vendedor disponível', short: 'Sem vendedor',    color: 'text-orange-400',  bg: 'bg-orange-500/10',  hex: '#fb923c' },
  { value: 'erro_tecnico',            label: 'Erro técnico',               short: 'Erro técnico',    color: 'text-rose-400',    bg: 'bg-rose-500/10',    hex: '#fb7185' },
  { value: 'funil_timeout',           label: 'Funil expirou (timeout)',    short: 'Funil timeout',   color: 'text-purple-400',  bg: 'bg-purple-500/10',  hex: '#c084fc' },
  { value: 'regra_nao_atingida',      label: 'Regra não atingida',         short: 'Regra',           color: 'text-sky-400',     bg: 'bg-sky-500/10',     hex: '#38bdf8' },
  { value: 'agente_nao_executou',     label: 'Agente IA não executou',     short: 'IA não rodou',    color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', hex: '#e879f9' },
  { value: 'outros',                  label: 'Outros',                     short: 'Outros',          color: 'text-slate-400',   bg: 'bg-slate-500/10',   hex: '#94a3b8' },
];

const reasonCfg = (code?: string | null) =>
  TRANSFER_FAILURE_REASONS.find(r => r.value === code) ?? null;

// ─── Feedback Estruturado: Opções ────────────────────────────────────────────

const FEEDBACK_CITIES = [
  'Pindamonhangaba', 'Taubaté', 'Tremembé', 'Caçapava',
  'São Luís do Paraitinga', 'Redenção da Serra', 'Jacareí',
  'São José dos Campos', 'Guaratinguetá', 'Campos do Jordão', 'Lorena',
];

const FEEDBACK_REASONS: { category: string; emoji: string; options: string[] }[] = [
  {
    category: 'Financeiros', emoji: '💰',
    options: [
      'Financiamento não aprovado',
      'Parcela mais alta que o esperado',
      'Entrada insuficiente',
      'Score de crédito baixo',
      'Preferiu pagar à vista mas não tinha o valor',
    ],
  },
  {
    category: 'Negociação', emoji: '🤝',
    options: [
      'Avaliação do carro da troca abaixo do esperado',
      'Não aceitou o preço do veículo',
      'Encontrou preço menor na concorrência',
      'Não houve acordo no desconto',
    ],
  },
  {
    category: 'Produto', emoji: '🚗',
    options: [
      'Cor ou versão indisponível',
      'Veículo sem os opcionais desejados',
      'Preferiu outro modelo',
      'Não gostou do veículo no test drive',
    ],
  },
  {
    category: 'Comportamento do cliente', emoji: '👤',
    options: [
      'Cliente não respondeu mais',
      'Cliente sumiu após proposta',
      'Está só pesquisando (sem intenção imediata)',
      'Decidiu adiar a compra',
      'Comprou em outra loja',
    ],
  },
  {
    category: 'Outros', emoji: '📌',
    options: [
      'Problemas pessoais/familiares',
      'Perda de emprego ou renda',
      'Mudou de ideia sobre comprar carro',
      'Prazo de entrega longo demais',
      'Desconfiança na loja ou vendedor',
    ],
  },
];

const STATUS_CRM_OPTIONS = [
  { value: 'novo',               label: 'Novo',              color: 'text-blue-400'    },
  { value: 'inativo',            label: 'Lead Inativo',      color: 'text-gray-400'    },
  { value: 'carro_nao_disponivel', label: 'Carro não disponível', color: 'text-rose-400' },
  { value: 'em_atendimento',     label: 'Agendamento',       color: 'text-cyan-400'    },
  { value: 'negociacao',         label: 'Negociação',        color: 'text-purple-400'  },
  { value: 'fechado',            label: 'Venda concluída',   color: 'text-green-400'   },
  { value: 'perdido',            label: 'Perdido',           color: 'text-red-400'     },
];

// Normaliza telefone BR -> JID do WhatsApp com DDI 55. SEM isso, um número
// digitado/importado em formato local ("12 99999-9999") vira um lead SEPARADO
// da conversa real (que chega do WhatsApp já com 55) -> lead DUPLICADO.
// Espelha o normalizeDestination do backend (uazapiSender): 10-11 dígitos = local
// (DDD+número, sem país) -> prefixa 55; 12-13 dígitos = já normalizado -> mantém.
function phoneToBrJid(phone: string | null | undefined): string {
  const d = String(phone || '').replace(/\D/g, '');
  const e164 = (d.length === 10 || d.length === 11) ? `55${d}` : d;
  return `${e164}@s.whatsapp.net`;
}

// ─── Origem do Lead (Prompt 1.1) ───────────────────────────────────────────
// Bate com CHECK constraint da migration 20260516120000_lead_origem
// Usado pelo PEDRO. Marcos tem lista propria abaixo (MARCOS_ORIGEM_OPTIONS).
export const LEAD_ORIGEM_OPTIONS = [
  { value: 'porta',                  label: '🚪 Porta (loja)',     short: 'Porta' },
  { value: 'marketplace_facebook',   label: '🛒 Marketplace FB',   short: 'FB Marketplace' },
  { value: 'marketplace_olx',        label: '🛒 OLX',              short: 'OLX' },
  { value: 'marketplace_mercadolivre', label: '🛒 Mercado Livre',  short: 'Mercado Livre' },
  { value: 'instagram_vendedor',     label: '📷 Instagram',        short: 'Instagram' },
  { value: 'outros',                 label: '📌 Outros',           short: 'Outros' },
] as const;
const LEAD_ORIGEM_VALUES = LEAD_ORIGEM_OPTIONS.map(o => o.value) as readonly string[];

// ─── Origem do Lead — MARCOS CRM (spec 27/05/2026) ─────────────────────────
// Lista FIXA pro form "Adicionar Lead" do Marcos. Substitui o DynamicSelect
// que usava lead_sources (esse continua disponivel pro Pedro).
// Valores salvos em crm_leads.source como slugs snake_case. Leads antigos
// com source='marketplace_facebook', 'instagram_vendedor' etc. continuam
// existindo no banco (sem migration de mapping — compatibilidade preservada).
export const MARCOS_ORIGEM_OPTIONS = [
  { value: 'marketplace',           label: 'Marketplace' },
  { value: 'porta',                 label: 'Porta' },
  { value: 'loja',                  label: 'Loja' },
  { value: 'indicacao',             label: 'Indicação' },
  { value: 'consignado',            label: 'Consignado' },
  { value: 'consignado_indicacao',  label: 'Consignado-Indicação' },
  { value: 'redes_sociais',         label: 'Redes Sociais' }, // MELHORIA 1 (29/05/2026)
] as const;

/**
 * Mapeia o slug salvo em crm_leads.source (lista MARCOS_ORIGEM_OPTIONS) pro
 * slug canônico da coluna crm_leads.origem que o Painel ao Vivo lê pra
 * agregar contadores. Spec 27/05/2026:
 *   marketplace          → marketplace
 *   porta                → porta
 *   indicacao            → indicacao
 *   consignado           → consignado
 *   consignado_indicacao → indicacao (conta como Indicação no Painel)
 *   loja                 → porta     (spec original 27/05 22:00: "Loja → Porta")
 *
 * CORREÇÃO 28/05/2026: 'loja' estava caindo em 'outros' por engano meu —
 * a spec original do usuário pedia explicitamente "Loja → Porta" no Painel
 * ao Vivo (mesma coluna do Porta). Migration de retrofit 20260528100000
 * corrige leads ja criados com origem='outros' que deveriam ser 'porta'.
 *
 * CHECK constraint de crm_leads.origem aceita só: porta/olx/marketplace/
 * instagram/consignado/indicacao/outros. Qualquer slug fora dessa lista
 * cai em "outros" pra nunca quebrar o INSERT.
 */
export function marcosOrigemSlugToCanonical(slug: string | null | undefined): string | null {
  if (!slug) return null;
  switch (slug) {
    case 'marketplace':           return 'marketplace';
    case 'porta':                 return 'porta';
    case 'loja':                  return 'porta'; // 28/05/2026: spec original
    case 'indicacao':             return 'indicacao';
    case 'consignado':            return 'consignado';
    case 'consignado_indicacao':  return 'indicacao';
    case 'redes_sociais':         return 'redes_sociais'; // MELHORIA 1 (29/05/2026): CHECK ja aceita
    default:                      return 'outros';
  }
}

/**
 * Bug 1 (spec 27/05/2026): mapeia origem do form Adicionar Lead pro stage_id
 * da coluna correspondente no kanban Marcos. Diferente do canonical pra
 * Painel ao Vivo: aqui consignado_indicacao vai pra coluna "Consignado"
 * (no Painel ao Vivo, vai pra Indicação como contador).
 *
 * Mapping spec:
 *   marketplace          → Marketplace
 *   porta                → Porta/loja
 *   loja                 → Porta/loja
 *   indicacao            → Indicação
 *   consignado           → Consignado
 *   consignado_indicacao → Consignado
 *
 * Match por substring case-insensitive + sem acento, pra tolerar variações
 * ("Porta/loja" vs "Porta / Loja", "Marketplace" vs "Marketing Place").
 * Retorna null se nenhuma stage casar — caller deve fallback pra firstStageId.
 */
export function resolveMarcosStageIdForOrigem(
  slug: string | null | undefined,
  stages: Array<{ id: string; title: string }>,
): string | null {
  if (!slug) return null;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const findByName = (target: string): string | null => {
    const t = norm(target);
    return stages.find(s => norm(s.title) === t)?.id
        || stages.find(s => norm(s.title).includes(t))?.id
        || null;
  };
  switch (slug) {
    case 'marketplace':
      return findByName('marketplace') || findByName('marketing place');
    case 'porta':
    case 'loja':
      return findByName('porta/loja') || findByName('porta');
    case 'indicacao':
      return findByName('indicacao');
    case 'consignado':
    case 'consignado_indicacao':
      return findByName('consignado');
    case 'redes_sociais': // MELHORIA 1 (29/05/2026): coluna "Redes Sociais" no Kanban
      return findByName('redes sociais') || findByName('redes');
    default:
      return null;
  }
}

function leadOrigemLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  // Tenta resolver primeiro pela lista do Marcos (mais novas), depois pela legacy do Pedro,
  // pra garantir que ambos os formatos rendam um label legivel no badge do detalhe.
  return (
    MARCOS_ORIGEM_OPTIONS.find(o => o.value === v)?.label ||
    LEAD_ORIGEM_OPTIONS.find(o => o.value === v)?.short ||
    v
  );
}

// Mapeia status legacy no kanban. Etapas antigas de qualificacao do Pedro voltam para Novo na tela.
const STATUS_DISPLAY_MAP: Record<string, string> = {
  interessado: 'novo',
  medio_qualificado: 'novo',
  pouco_qualificado: 'novo',
  qualificado: 'novo',
  encerrado: 'perdido',
};
function normalizeStatus(status: string): string {
  return STATUS_DISPLAY_MAP[status] || status;
}

const MARCOS_STAGE_STYLE_BY_NAME: Record<string, { emoji: string; border: string; bg: string; dot: string }> = {
  'novo lead': { emoji: '🔰', border: 'border-indigo-500/30', bg: 'bg-indigo-500/10', dot: 'bg-indigo-400' },
  // 'qualificado' removido do default em 2026-05-22, mas preservado aqui pra retrocompat
  // (users que customizaram pra manter Qualificado ainda renderiza com style amarelo).
  qualificado: { emoji: '🎯', border: 'border-amber-500/30', bg: 'bg-amber-500/10', dot: 'bg-amber-400' },
  'marketing place': { emoji: '🛒', border: 'border-orange-500/30', bg: 'bg-orange-500/10', dot: 'bg-orange-400' },
  agendamento: { emoji: '📅', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', dot: 'bg-cyan-400' },
  proposta: { emoji: '📋', border: 'border-blue-500/30', bg: 'bg-blue-500/10', dot: 'bg-blue-400' },
  negociacao: { emoji: '🤝', border: 'border-purple-500/30', bg: 'bg-purple-500/10', dot: 'bg-purple-400' },
  // Etapa de venda — 'fechado' (legado) e 'venda concluida' (nome novo) usam o
  // mesmo estilo verde. Sem a chave nova, a coluna renomeada caía no cinza padrão.
  fechado: { emoji: '✅', border: 'border-green-500/30', bg: 'bg-green-500/10', dot: 'bg-green-400' },
  'venda concluida': { emoji: '✅', border: 'border-green-500/30', bg: 'bg-green-500/10', dot: 'bg-green-400' },
  perdido: { emoji: '❌', border: 'border-red-500/30', bg: 'bg-red-500/10', dot: 'bg-red-400' },
  'lead inativo': { emoji: '😴', border: 'border-gray-500/30', bg: 'bg-gray-500/10', dot: 'bg-gray-400' },
  'carro nao disponivel': { emoji: '🚫', border: 'border-rose-500/30', bg: 'bg-rose-500/10', dot: 'bg-rose-400' },
  porta: { emoji: '🚪', border: 'border-teal-500/30', bg: 'bg-teal-500/10', dot: 'bg-teal-400' },
};

function normalizeStageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getMarcosStageStyle(name: string, index: number) {
  return MARCOS_STAGE_STYLE_BY_NAME[normalizeStageName(name)] || {
    emoji: ['🔰', '🎯', '📋', '🤝', '✅'][index] || '📌',
    border: 'border-slate-500/30',
    bg: 'bg-slate-500/10',
    dot: 'bg-slate-400',
  };
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Tab CRM Avançado ─────────────────────────────────────────────────────────

const PIPELINE_COLUMNS = [
  { id: 'novo',               title: 'Novo',               emoji: '🔰', border: 'border-slate-500/30',   bg: 'bg-slate-500/10',   dot: 'bg-slate-400'   },
  { id: 'inativo',            title: 'Lead Inativo',       emoji: '😴', border: 'border-gray-500/30',    bg: 'bg-gray-500/10',    dot: 'bg-gray-400'    },
  { id: 'carro_nao_disponivel', title: 'Carro não disponível', emoji: '🚫', border: 'border-rose-500/30', bg: 'bg-rose-500/10', dot: 'bg-rose-400' },
  { id: 'em_atendimento',     title: 'Agendamento',        emoji: '📅', border: 'border-cyan-500/30',    bg: 'bg-cyan-500/10',    dot: 'bg-cyan-400'   },
  { id: 'negociacao',         title: 'Negociação',         emoji: '🤝', border: 'border-purple-500/30',  bg: 'bg-purple-500/10',  dot: 'bg-purple-400'  },
  { id: 'fechado',            title: 'Venda concluída',    emoji: '✅', border: 'border-green-500/30',   bg: 'bg-green-500/10',   dot: 'bg-green-400'   },
  { id: 'perdido',            title: 'Perdido',            emoji: '❌', border: 'border-red-500/30',     bg: 'bg-red-500/10',     dot: 'bg-red-400'     },
];

type PipelineColumn = (typeof PIPELINE_COLUMNS)[number] & { color?: string | null };

function reorderItems<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

function applyColumnOrder<T extends { id: string }>(columns: T[], order: string[]) {
  if (!order.length) return columns;
  const byId = new Map(columns.map(column => [column.id, column]));
  const ordered = order
    .map(id => byId.get(id))
    .filter((column): column is T => Boolean(column));
  const missing = columns.filter(column => !order.includes(column.id));
  return [...ordered, ...missing];
}

interface CrmLead {
  id: string;
  lead_name: string;
  remote_jid: string;
  status?: string | null;
  status_crm: string;
  summary?: string | null;
  next_followup_at: string | null;
  // Status da reativacao (Follow-up IA) pra badge do card: sent/responded/transferred.
  reactivation_status?: string | null;
  seller_notes_count: number;
  assigned_to_id: string | null;
  member?: { id: string; name: string } | null;
  agent?: { name: string } | null;
  created_at: string;
  source?: string | null;
  custom_fields?: Record<string, any> | null;
  // Fase 6 — campos enriched (todos opcionais; só renderizam badge se vierem)
  client_city?: string | null;
  vehicle_interest?: string | null;
  visit_scheduled?: string | null;             // texto livre / leitura humana (legacy)
  visit_scheduled_at?: string | null;          // Item 2: timestamptz pra comparar com hoje (banner laranja)
  // Feature C: pro cálculo de inativo (>7 dias sem resposta)
  last_user_reply_at?: string | null;
  // Marcos Consignado (27/05/2026) — 6 campos do veículo do cliente.
  // Só preenchidos quando lead está em stage "Consignado". Renderizados pelo
  // ConsignadoVehicleForm + badge 🚗 no card kanban.
  consignado_modelo?: string | null;
  consignado_ano?: number | null;
  consignado_versao?: string | null;
  consignado_km?: number | null;
  consignado_cor?: string | null;
  consignado_estado?: 'bom' | 'medio' | 'ruim' | null;
}

interface Note {
  id: string;
  lead_id: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  member?: { name: string } | null;
}

interface Feedback {
  id: string;
  lead_id: string | null;            // M5: Pedro popula isso, Marcos NULL
  crm_lead_id?: string | null;       // M5: Marcos popula isso, Pedro NULL
  content: string;
  city?: string | null;
  reason?: string | null;
  observations?: string | null;
  priority: string;
  read_at: string | null;
  created_at: string;
  member?: { name: string } | null;
  member_id?: string | null;
  lead?: { lead_name: string } | null;
  ia_status_crm?: string | null;       // status_crm do lead = classificação da IA (compara com o feedback do vendedor)
}

// Feedback da IA gerado no momento da transferência (ai_lead_transfers.notes)
interface LeadTransfer {
  id: string;
  lead_id: string;
  transfer_reason: string | null;
  notes: string | null;
  created_at: string;
  to_member?: { name: string } | null;
}

// Registro de POR QUE um lead não foi transferido (tabela pedro_transfer_failures).
// Alimenta o painel de Diagnóstico. Fica vazio até a instrumentação das edge
// functions (Impl 2-b); o painel funciona mesmo assim derivando "sem vendedor".
interface TransferFailure {
  id: string;
  lead_id: string | null;
  agent_id: string | null;
  member_id: string | null;
  lead_name: string | null;
  remote_jid: string | null;
  reason_code: string;
  reason_detail: string | null;
  lead_status: string | null;
  lead_status_crm: string | null;
  attempted_transfer: boolean;
  source: string | null;
  attempt_count: number;
  last_attempt_at: string;
  resolved_at: string | null;
  created_at: string;
}

interface FollowupSchedule {
  id: string;
  lead_id: string;
  scheduled_at: string;
  message_template: string;
  status: string;
  created_at: string;
  sent_at?: string | null;
  media_url?: string | null;
  media_type?: string | null;
}

interface TeamMember {
  id: string;
  name: string;
  whatsapp_number: string | null;
  is_active: boolean;              // ativo no AGENTE de IA (distribuição automática)
  active_in_system?: boolean;      // ativo no SISTEMA (visibilidade no CRM e módulos)
  last_lead_received_at: string | null;
  total_leads_received?: number | null;  // contador acumulado — chave da fila round-robin
  agent_id: string | null;
  leadsCount?: number;
  qualifiedCount?: number;
}

interface LeadMetrics {
  total: number;
  today: number;
  week: number;
  month: number;
}

type CrmMode = 'pedro' | 'marcos';

export function CrmAvancadoTab({ userId, mode = 'pedro' }: { userId: string | undefined; mode?: CrmMode }) {
  const { toast } = useToast();
  const isMarcosCrm = mode === 'marcos';
  const [isSeller, setIsSeller] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  // Fase 6.4 hotfix: effectiveUserId no escopo do componente (era local em fns,
  // causava ReferenceError no JSX do DynamicSelect e quebrava a pagina toda)
  const [effectiveUserIdState, setEffectiveUserIdState] = useState<string | null>(null);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [leadMetrics, setLeadMetrics] = useState<LeadMetrics>({ total: 0, today: 0, week: 0, month: 0 });
  const [manualStages, setManualStages] = useState<PipelineColumn[]>([]);
  // Kanban do Pedro configurável: colunas vêm de ai_crm_pipeline_stages (Configurações
  // > Kanban Pedro). Effect separado pra NÃO mexer no fetchData grande. Fallback no
  // render: se vazio/erro, usa PIPELINE_COLUMNS — o board nunca fica sem coluna.
  const [pedroStages, setPedroStages] = useState<PipelineColumn[]>([]);
  useEffect(() => {
    if (isMarcosCrm || !effectiveUserIdState) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('ai_crm_pipeline_stages')
          .select('status_key, name, color, position, ativo')
          .eq('user_id', effectiveUserIdState)
          // Escopo por vendedor: colunas da conta (null) + as do proprio vendedor.
          .or(`seller_auth_id.is.null,seller_auth_id.eq.${userId}`)
          .order('position', { ascending: true });
        if (cancelled) return;
        const emojiByKey: Record<string, string> = Object.fromEntries(
          (PIPELINE_COLUMNS as any[]).map((c: any) => [c.id, c.emoji]),
        );
        const cols = ((data as any[]) || [])
          .filter((s) => s.ativo !== false)
          .map((s) => ({ id: s.status_key, title: s.name, emoji: emojiByKey[s.status_key] || '📋', color: s.color || null }));
        setPedroStages(cols as PipelineColumn[]);
      } catch { /* fallback PIPELINE_COLUMNS no render */ }
    })();
    return () => { cancelled = true; };
  }, [isMarcosCrm, effectiveUserIdState]);
  // Popup "Registrar venda" — aberto quando um lead entra em "Venda concluída".
  // Grava carro + data (+ valor) na venda criada pelo gatilho (comercial_vendas).
  const [vendaDialog, setVendaDialog] = useState<{ leadId: string; nome: string } | null>(null);
  const [vendaCarro, setVendaCarro] = useState('');
  const [vendaData, setVendaData] = useState('');
  const [vendaValor, setVendaValor] = useState('');
  const [vendaSaving, setVendaSaving] = useState(false);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [schedules, setSchedules] = useState<FollowupSchedule[]>([]);
  const [cancellingFollowupId, setCancellingFollowupId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<LeadTransfer[]>([]);
  const [view, setView] = useState<'pipeline' | 'leads' | 'feedbacks' | 'trafego' | 'sellers' | 'diagnostico'>('pipeline');

  // filter states
  const [filterStatus, setFilterStatus]   = useState<string>('all');
  const [filterSeller, setFilterSeller]   = useState<string>('all');
  const [searchTerm,   setSearchTerm]     = useState('');
  // filtro de data dos leads (barra superior — Pedro e Marcos)
  const [dateFilter, setDateFilter]       = useState<LeadDatePreset>('all');
  const [dateFrom,   setDateFrom]         = useState('');
  const [dateTo,     setDateTo]           = useState('');
  // transferência manual pro próximo vendedor da fila (confirmação)
  const [confirmQueueTransfer, setConfirmQueueTransfer] = useState<{ lead: CrmLead; seller: TeamMember } | null>(null);
  const [queueTransferring, setQueueTransferring]       = useState(false);
  // painel de Diagnóstico (leads sem transferência) — só master no CRM do Pedro
  const [transferFailures, setTransferFailures] = useState<TransferFailure[]>([]);
  const [diagReason, setDiagReason] = useState<string>('all');   // filtro por motivo
  const [diagAgent,  setDiagAgent]  = useState<string>('all');   // filtro por agente
  const [diagClass,  setDiagClass]  = useState<string>('all');   // filtro por classificação
  // Fase 6 Feature C: modo seleção pro disparo em massa (toggle + IDs marcados)
  const [selectionMode, setSelectionMode]   = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  // Resgate de leads órfãos (transferido preso, sem vendedor, sem pending) — botão no Diagnóstico
  const [rescueOpen, setRescueOpen]       = useState(false);
  const [rescueLoading, setRescueLoading] = useState(false);   // dry-run (prévia) em andamento
  const [rescueRunning, setRescueRunning] = useState(false);   // execução real em andamento
  const [rescuePreview, setRescuePreview] = useState<any | null>(null);  // resultado do dry-run
  const [rescueSelected, setRescueSelected] = useState<Set<string>>(new Set()); // lead_ids marcados pra resgatar

  // form states
  const [newNote, setNewNote]             = useState('');
  const [noteLoading, setNoteLoading]     = useState(false);
  const [fbContent, setFbContent]         = useState('');
  const [fbPriority, setFbPriority]       = useState<'low'|'normal'|'high'|'urgent'>('normal');
  const [fbLoading, setFbLoading]         = useState(false);
  // Structured feedback form
  const [fbCity, setFbCity]               = useState('');
  const [fbCityCustom, setFbCityCustom]   = useState('');
  const [fbReason, setFbReason]           = useState('');
  const [fbReasonOpen, setFbReasonOpen]   = useState<string | null>(null);
  const [fbObservations, setFbObservations] = useState('');
  // Lead feedback history popup
  const [fbHistoryOpen, setFbHistoryOpen] = useState(false);
  const [leadFeedbacks, setLeadFeedbacks] = useState<Feedback[]>([]);
  const [fbHistoryLoading, setFbHistoryLoading] = useState(false);
  const [fuMsg, setFuMsg]                 = useState('');
  const [fuDate, setFuDate]               = useState('');
  const [fuInstance, setFuInstance]       = useState('');
  const [fuLoading, setFuLoading]         = useState(false);
  const [fuMediaFile, setFuMediaFile]     = useState<File | null>(null);
  const [fuMediaUrl, setFuMediaUrl]       = useState('');
  const [fuUploading, setFuUploading]     = useState(false);
  const fuFileRef = useRef<HTMLInputElement>(null);
  const draggedColumnIdRef = useRef<string | null>(null);
  // Auto-scroll horizontal do board enquanto arrasta o lead. O @hello-pangea/dnd só
  // rola o scroll do PRÓPRIO droppable (cada coluna tem overflow-y) + a janela; o
  // scroll horizontal do board é um ancestral, então o card não alcançava as colunas
  // do fim. Aqui rolamos o board quando o ponteiro chega perto da borda esq/dir.
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const autoScrollDirRef = useRef(0);            // -1 esquerda, 0 nada, 1 direita
  const autoScrollRafRef = useRef<number | null>(null);
  const boardAutoScrollStep = useCallback(() => {
    const el = boardScrollRef.current;
    if (el && autoScrollDirRef.current !== 0) el.scrollLeft += autoScrollDirRef.current * 22;
    autoScrollRafRef.current = requestAnimationFrame(boardAutoScrollStep);
  }, []);
  const onLeadDragPointerMove = useCallback((e: MouseEvent | TouchEvent) => {
    const el = boardScrollRef.current;
    if (!el) return;
    const x = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
    const rect = el.getBoundingClientRect();
    const EDGE = 100;
    autoScrollDirRef.current = x > rect.right - EDGE ? 1 : x < rect.left + EDGE ? -1 : 0;
  }, []);
  const startBoardAutoScroll = useCallback(() => {
    window.addEventListener('mousemove', onLeadDragPointerMove);
    window.addEventListener('touchmove', onLeadDragPointerMove, { passive: true });
    if (autoScrollRafRef.current == null) autoScrollRafRef.current = requestAnimationFrame(boardAutoScrollStep);
  }, [onLeadDragPointerMove, boardAutoScrollStep]);
  const stopBoardAutoScroll = useCallback(() => {
    window.removeEventListener('mousemove', onLeadDragPointerMove);
    window.removeEventListener('touchmove', onLeadDragPointerMove);
    autoScrollDirRef.current = 0;
    if (autoScrollRafRef.current != null) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null; }
  }, [onLeadDragPointerMove]);
  const [funnelOpen, setFunnelOpen]       = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  // F1 Follow-up IA: modal de configuração (substitui o disparo direto do botão "Follow-ups")
  const [followupIAModalOpen, setFollowupIAModalOpen] = useState(false);
  const [isFollowupActive, setIsFollowupActive] = useState(false);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [reassigning, setReassigning]       = useState<string | null>(null);

  // detect seller vs gerente (vendedor pode ter múltiplos registros em agentes diferentes)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('ai_team_members')
        .select('id, user_id, is_active')
        .eq('auth_user_id', userId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length > 0) {
        setIsSeller(true);
        setMemberId(rows[0].id);
        setMemberIds(rows.map((r: any) => r.id));
      }
    })();
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    const loadColumnPreference = async () => {
      if (!userId) {
        setColumnOrder([]);
        return;
      }

      const { data, error } = await (supabase as any)
        .from('crm_column_preferences')
        .select('column_order')
        .eq('auth_user_id', userId)
        .eq('crm_mode', mode)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn('Erro ao carregar preferência de colunas', error);
        setColumnOrder([]);
        return;
      }
      setColumnOrder(Array.isArray(data?.column_order) ? data.column_order : []);
    };

    loadColumnPreference();
    return () => {
      cancelled = true;
    };
  }, [userId, mode]);

  // Diagnóstico: carrega os registros de falha de transferência (master + Pedro).
  // Tabela owner-only (RLS user_id = auth.uid()). Recarrega ao abrir a aba e
  // sempre que o conjunto de leads muda (ex.: após uma transferência manual,
  // o lead resolvido some da lista). Sem realtime por ora — a tabela só recebe
  // dados quando a instrumentação das edge functions (Impl 2-b) estiver ativa.
  useEffect(() => {
    if (!userId || isSeller || isMarcosCrm) { setTransferFailures([]); return; }
    const ownerId = effectiveUserIdState || userId;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase as any)
        .from('pedro_transfer_failures')
        .select('id, lead_id, agent_id, member_id, lead_name, remote_jid, reason_code, reason_detail, lead_status, lead_status_crm, attempted_transfer, source, attempt_count, last_attempt_at, resolved_at, created_at')
        .eq('user_id', ownerId)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (cancelled) return;
      if (error) { console.warn('[Diagnóstico] erro ao buscar falhas de transferência', error); setTransferFailures([]); return; }
      setTransferFailures(Array.isArray(data) ? data : []);
    })();
    return () => { cancelled = true; };
  }, [userId, isSeller, isMarcosCrm, effectiveUserIdState, view, leads.length]);

  const fetchData = async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;
      // Fase 6.4 hotfix: expõe pro escopo do componente pra DynamicSelect usar
      if (effectiveUserId && effectiveUserId !== effectiveUserIdState) {
        setEffectiveUserIdState(effectiveUserId);
      }

      // Carrega o status do follow-up automático (Checklist 2.2)
      try {
        const { data: followConfig } = await (supabase as any)
          .from('followup_ia_config')
          .select('is_active')
          .eq('user_id', effectiveUserId)
          .maybeSingle();
        setIsFollowupActive(!!followConfig?.is_active);
      } catch (err) {
        console.warn('[PedroSDR] Erro ao carregar status do follow-up:', err);
      }

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      if (isMarcosCrm) {
        const { data: stagesData } = await (supabase as any)
          .from('crm_pipeline_stages')
          .select('id, name, color, position')
          .eq('user_id', effectiveUserId)
          // Escopo por vendedor: colunas da conta (null) + as do proprio vendedor.
          .or(`seller_auth_id.is.null,seller_auth_id.eq.${userId}`)
          .order('position', { ascending: true });
        const stages = (stagesData || []) as any[];
        const fallbackStage = stages[0]?.id || 'novo';
        const columns = stages.length > 0
          ? stages.map((s: any, index: number) => {
              const stageStyle = getMarcosStageStyle(s.name, index);
              return {
                id: s.id,
                title: s.name,
                ...stageStyle,
                color: s.color || null, // hex configurado nas Configurações do Kanban (crm_pipeline_stages)
              };
            })
          : PIPELINE_COLUMNS;
        setManualStages(columns);

        const leadCountQuery = (from?: Date) => {
          let query = (supabase as any)
            .from('crm_leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', effectiveUserId)
            .not('source', 'like', 'Pedro SDR%');
          if (isSeller && memberIds.length > 0) query = query.in('assigned_to', memberIds);
          if (from) query = query.gte('created_at', from.toISOString());
          return query;
        };

        let marcosLeadsQuery = (supabase as any)
          .from('crm_leads')
          // Feature M1: campos enriched (Marcos agora tem client_city, vehicle_interest, visit_scheduled)
          // Marcos Consignado (27/05/2026): 6 campos do veiculo do cliente (consignado_*)
          .select('id, name, phone, source, notes, stage_id, priority, assigned_to, custom_fields, created_at, arrived_at, client_city, vehicle_interest, visit_scheduled, visit_scheduled_at, consignado_modelo, consignado_ano, consignado_versao, consignado_km, consignado_cor, consignado_estado')
          .eq('user_id', effectiveUserId)
          .not('source', 'like', 'Pedro SDR%')
          .order('created_at', { ascending: false })
          .limit(500);
        if (isSeller && memberIds.length > 0) {
          marcosLeadsQuery = marcosLeadsQuery.in('assigned_to', memberIds);
        }

        let marcosInstancesQuery = (supabase as any)
          .from('wa_instances')
          .select('id, friendly_name, phone_number, instance_name, status, is_active, seller_member_id')
          .eq('user_id', effectiveUserId)
          .eq('is_active', true);
        if (isSeller && memberIds.length > 0) {
          marcosInstancesQuery = marcosInstancesQuery.in('seller_member_id', memberIds);
        }

        const [leadsRes, teamRes, instRes, totalCountRes, todayCountRes, weekCountRes, monthCountRes] = await Promise.all([
          marcosLeadsQuery,
          (supabase as any)
            .from('ai_team_members')
            .select('*')
            .eq('user_id', effectiveUserId)
            .order('is_active', { ascending: false })
            .order('name', { ascending: true }),
          marcosInstancesQuery,
          leadCountQuery(),
          leadCountQuery(todayStart),
          leadCountQuery(weekStart),
          leadCountQuery(monthStart),
        ]);

        const teamData: TeamMember[] = teamRes.data || [];
        const teamById = new Map(teamData.map((t: any) => [t.id, { id: t.id, name: t.name }]));
        const mappedLeads: CrmLead[] = (leadsRes.data || []).map((lead: any) => ({
          id: lead.id,
          lead_name: lead.name || lead.phone || 'Lead',
          remote_jid: phoneToBrJid(lead.phone),
          status: null,
          status_crm: lead.stage_id || fallbackStage,
          summary: lead.notes || null,
          next_followup_at: null,
          seller_notes_count: 0,
          assigned_to_id: lead.assigned_to || lead.custom_fields?.seller_member_id || lead.custom_fields?.migrated_from_assigned_to_id || null,
          member: (() => {
            const sellerId = lead.assigned_to || lead.custom_fields?.seller_member_id || lead.custom_fields?.migrated_from_assigned_to_id || null;
            return sellerId
              ? (teamById.get(sellerId) ?? (lead.custom_fields?.seller_name ? { id: sellerId, name: lead.custom_fields.seller_name } : null))
              : null;
          })(),
          agent: null,
          created_at: lead.created_at,
          arrived_at: lead.arrived_at || null, // data real de chegada (estava sendo perdida no mapeamento)
          source: lead.source || 'manual',
          custom_fields: lead.custom_fields || null,
          // Feature M1: campos enriched do Marcos (mesma estrutura do Pedro)
          client_city: lead.client_city || null,
          vehicle_interest: lead.vehicle_interest || null,
          visit_scheduled: lead.visit_scheduled || null,
          visit_scheduled_at: lead.visit_scheduled_at || null,
          // Marcos Consignado (27/05/2026): 6 campos do veiculo
          consignado_modelo: lead.consignado_modelo || null,
          consignado_ano: lead.consignado_ano ?? null,
          consignado_versao: lead.consignado_versao || null,
          consignado_km: lead.consignado_km ?? null,
          consignado_cor: lead.consignado_cor || null,
          consignado_estado: lead.consignado_estado || null,
        }));

        // MATRIZ: o mesmo vendedor tem 1 linha por agente em ai_team_members → sem
        // deduplicar por telefone, o dropdown/lista do Marcos mostrava o vendedor EM
        // DOBRO (7 vendedores apareciam 14x). Mesmo dedup do caminho do Pedro (abaixo):
        // junta os ids do mesmo telefone e mantém 1 linha por pessoa.
        const dedupedTeam = new Map<string, TeamMember>();
        for (const m of teamData) {
          const key = m.whatsapp_number || m.id; // fallback p/ id se sem número
          const existing = dedupedTeam.get(key);
          if (!existing) {
            dedupedTeam.set(key, m);
          } else if ((m.active_in_system !== false) && (existing.active_in_system === false)) {
            dedupedTeam.set(key, { ...m, _allIds: [...(existing as any)._allIds || [existing.id], m.id] });
          } else {
            (existing as any)._allIds = [...((existing as any)._allIds || [existing.id]), m.id];
          }
        }
        const enrichedTeam = Array.from(dedupedTeam.values()).map(m => {
          const allIds: string[] = (m as any)._allIds || [m.id];
          return {
            ...m,
            leadsCount: mappedLeads.filter(l => l.assigned_to_id && allIds.includes(l.assigned_to_id)).length,
            qualifiedCount: mappedLeads.filter(l => l.assigned_to_id && allIds.includes(l.assigned_to_id) && l.status_crm === 'qualificado').length,
          };
        });

        setLeads(mappedLeads);
        setFeedbacks([]);
        const connectedInstances = (instRes.data || []).filter((i: any) => i.status === 'connected' || i.is_active);
        setInstances(connectedInstances);
        if (connectedInstances.length > 0 && !fuInstance) {
          setFuInstance(connectedInstances[0].id);
        }
        setTeamMembers(enrichedTeam);
        setTransfers([]);
        setLeadMetrics({
          total: totalCountRes.count || 0,
          today: todayCountRes.count || 0,
          week: weekCountRes.count || 0,
          month: monthCountRes.count || 0,
        });
        return;
      }

      const leadCountQuery = (from?: Date) => {
        let query = (supabase as any)
          .from('ai_crm_leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', effectiveUserId);

        if (from) query = query.gte('created_at', from.toISOString());
        if (isSeller && memberIds.length > 0) query = query.in('assigned_to_id', memberIds);

        return query;
      };

      // ========================================================================
      // ESTRATÉGIA "JOIN no JS" — mais robusta que JOIN PostgREST
      // ========================================================================
      // Antes: JOIN embedded com ai_team_members + wa_ai_agents fazia PostgREST
      // retornar erro silencioso (provavelmente RLS de wa_ai_agents). Resultado:
      // CRM totalmente vazio. Agora busca leads SEM JOIN e hidrata member/agent
      // no JavaScript usando os arrays teamRes e agentsRes que já buscamos.
      // ========================================================================
      const leadsQuery = (supabase as any)
        .from('ai_crm_leads')
        // Fase 6: adiciona client_city, vehicle_interest, visit_scheduled (todos opcionais)
        .select('id, lead_name, remote_jid, status, status_crm, summary, next_followup_at, seller_notes_count, assigned_to_id, agent_id, created_at, arrived_at, client_city, vehicle_interest, visit_scheduled, visit_scheduled_at, last_user_reply_at')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (isSeller && memberIds.length > 0) {
        leadsQuery.in('assigned_to_id', memberIds);
      } else {
        // Master vê até 500 leads (margem segura). Antes era 100 e escondia
        // leads das colunas Inativo/Qualificado/Negociação/etc quando o volume
        // de "novo" passava de 100. Index em (user_id, created_at) garante perf.
        leadsQuery.limit(500);
      }
      const agentsQuery = (supabase as any)
        .from('wa_ai_agents')
        .select('id, name')
        .eq('user_id', effectiveUserId);

      const [leadsRes, fbRes, instRes, teamRes, agentsRes, totalCountRes, todayCountRes, weekCountRes, monthCountRes] = await Promise.all([
        leadsQuery,
        // M5: feedbacks vêm de Pedro (lead_id → ai_crm_leads) E Marcos (crm_lead_id → crm_leads).
        // Buscamos sem JOIN e hidratamos `lead.lead_name` em JS a partir de 2 lookups.
        (() => {
          let q = (supabase as any)
            .from('pedro_manager_feedback')
            .select('id, lead_id, crm_lead_id, member_id, content, city, reason, observations, priority, read_at, created_at, member:ai_team_members(name)')
            .order('created_at', { ascending: false })
            .limit(2000); // 2000 cobre o volume real; o filtro de período é feito no cliente
          // Master vê os feedbacks da conta; VENDEDOR vê só os DELE (RLS seller_manage_feedback por member_id).
          if (isSeller && memberIds.length > 0) q = q.in('member_id', memberIds);
          else q = q.eq('user_id', effectiveUserId);
          return q;
        })(),
        // Follow-up: vendedor usa apenas a instância DELE; master usa apenas
        // as próprias dele (seller_member_id IS NULL). Master NÃO usa
        // instâncias de vendedores mesmo enxergando-as em outras telas.
        (() => {
          let q = (supabase as any)
            .from('wa_instances')
            .select('id, friendly_name, phone_number, instance_name, status, seller_member_id')
            .eq('user_id', effectiveUserId)
            .eq('is_active', true);
          if (isSeller && memberIds.length > 0) {
            q = q.in('seller_member_id', memberIds);
          } else {
            q = q.is('seller_member_id', null);
          }
          return q;
        })(),
        (supabase as any)
          .from('ai_team_members')
          .select('*')
          .eq('user_id', effectiveUserId)
          .order('is_active', { ascending: false })
          .order('name', { ascending: true }),
        agentsQuery,
        leadCountQuery(),
        leadCountQuery(todayStart),
        leadCountQuery(weekStart),
        leadCountQuery(monthStart),
      ]);

      // ── LOG DEFENSIVO: captura erro silencioso de query ──
      if ((leadsRes as any)?.error) {
        console.error('[PedroSDR] ERRO ao buscar leads:', (leadsRes as any).error);
        toast({
          title: '⚠️ Erro ao carregar leads',
          description: (leadsRes as any).error?.message || 'Erro desconhecido',
          variant: 'destructive',
        });
      }
      const rawLeads: any[] = leadsRes.data || [];
      const teamData:  TeamMember[] = teamRes.data || [];
      const agentsData: any[] = agentsRes.data || [];

      // Status de FOLLOW-UP (reativacao) por lead, pro badge discreto do card.
      // 1 query por master (RLS: so o dono ve os proprios). Opcional — se falhar, sem badge.
      const reactByLead = new Map<string, string>();
      try {
        const { data: reactRows } = await (supabase as any)
          .from('pedro_followup_reactivation')
          .select('lead_id, status')
          .eq('user_id', effectiveUserId);
        for (const r of reactRows || []) reactByLead.set(r.lead_id, r.status);
      } catch { /* badge de follow-up e opcional */ }

      // ── HIDRATAÇÃO JS: monta lead.member e lead.agent usando os arrays já buscados
      // Substitui o JOIN PostgREST que falhava silenciosamente. Mais robusto.
      const teamById = new Map(teamData.map((t: any) => [t.id, { id: t.id, name: t.name }]));
      const agentsById = new Map(agentsData.map((a: any) => [a.id, { name: a.name }]));
      const hydratedLeads: CrmLead[] = rawLeads.map((l: any) => ({
        ...l,
        member: l.assigned_to_id ? (teamById.get(l.assigned_to_id) ?? null) : null,
        agent: l.agent_id ? (agentsById.get(l.agent_id) ?? null) : null,
        reactivation_status: reactByLead.get(l.id) ?? null,
      }));
      const leadsByPhone = new Map<string, CrmLead>();
      for (const lead of hydratedLeads) {
        const phoneKey = String(lead.remote_jid || lead.id || '').replace(/\D/g, '');
        const existing = leadsByPhone.get(phoneKey);
        if (!existing) {
          leadsByPhone.set(phoneKey, lead);
          continue;
        }

        const leadTime = new Date(lead.created_at || 0).getTime();
        const existingTime = new Date(existing.created_at || 0).getTime();
        if (leadTime > existingTime) leadsByPhone.set(phoneKey, lead);
      }
      const leadsData: CrmLead[] = Array.from(leadsByPhone.values());

      // Deduplica vendedores pelo whatsapp_number (mesmo vendedor pode estar em vários agentes)
      const deduped = new Map<string, TeamMember>();
      for (const m of teamData) {
        const key = m.whatsapp_number || m.id; // fallback para id se sem número
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, m);
        } else {
          // Mantém o registro ativo NO SISTEMA; junta IDs para contagem
          if ((m.active_in_system !== false) && (existing.active_in_system === false)) {
            deduped.set(key, { ...m, _allIds: [...(existing as any)._allIds || [existing.id], m.id] });
          } else {
            (existing as any)._allIds = [...((existing as any)._allIds || [existing.id]), m.id];
          }
        }
      }
      const uniqueTeam = Array.from(deduped.values());

      // Calcula leads por vendedor (soma de todos os IDs do mesmo vendedor)
      const enrichedTeam = uniqueTeam.map(m => {
        const allIds: string[] = (m as any)._allIds || [m.id];
        return {
          ...m,
          leadsCount:     leadsData.filter(l => l.assigned_to_id && allIds.includes(l.assigned_to_id)).length,
          qualifiedCount: leadsData.filter(l => l.assigned_to_id && allIds.includes(l.assigned_to_id) && l.status_crm === 'qualificado').length,
        };
      });

      setLeads(leadsData);
      setLeadMetrics({
        total: totalCountRes.count ?? 0,
        today: todayCountRes.count ?? 0,
        week: weekCountRes.count ?? 0,
        month: monthCountRes.count ?? 0,
      });
      // ── M5: hidrata lead.lead_name para feedbacks do Pedro (ai_crm_leads) E Marcos (crm_leads).
      //    Substitui o JOIN PostgREST que só funcionava pra ai_crm_leads e deixava o lead "vazio" pros feedbacks do Marcos.
      const rawFeedbacks: any[] = fbRes.data || [];
      const pedroLeadIds  = Array.from(new Set(rawFeedbacks.filter(f => f.lead_id).map(f => f.lead_id))) as string[];
      const marcosLeadIds = Array.from(new Set(rawFeedbacks.filter(f => f.crm_lead_id).map(f => f.crm_lead_id))) as string[];
      const [pedroNames, marcosNames] = await Promise.all([
        pedroLeadIds.length > 0
          ? (supabase as any).from('ai_crm_leads').select('id, lead_name, status_crm').in('id', pedroLeadIds)
          : Promise.resolve({ data: [] }),
        marcosLeadIds.length > 0
          ? (supabase as any).from('crm_leads').select('id, name, status').in('id', marcosLeadIds)
          : Promise.resolve({ data: [] }),
      ]);
      const nameMap = new Map<string, string>();
      const statusMap = new Map<string, string>(); // status_crm do lead = classificação da IA (compara c/ vendedor)
      (pedroNames.data  || []).forEach((l: any) => { nameMap.set(l.id, l.lead_name || 'Lead'); if (l.status_crm) statusMap.set(l.id, l.status_crm); });
      (marcosNames.data || []).forEach((l: any) => { nameMap.set(l.id, l.name || 'Lead'); if (l.status) statusMap.set(l.id, l.status); });
      const hydratedFeedbacks: Feedback[] = rawFeedbacks.map((f: any) => ({
        ...f,
        lead: { lead_name: nameMap.get(f.lead_id || f.crm_lead_id || '') ?? 'Lead' },
        ia_status_crm: statusMap.get(f.lead_id || f.crm_lead_id || '') ?? null,
      }));
      setFeedbacks(hydratedFeedbacks);
      const connectedInstances = (instRes.data || []).filter((i: any) => i.status === 'connected');
      setInstances(connectedInstances);
      // Auto-seleciona a primeira instância conectada
      if (connectedInstances.length > 0 && !fuInstance) {
        setFuInstance(connectedInstances[0].id);
      }
      setTeamMembers(enrichedTeam);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [userId, isSeller, memberIds.length]);

  const resolveCurrentSellerForMarcos = async () => {
    if (!isMarcosCrm || !isSeller || !memberId) return null;
    const cached = teamMembers.find(m => m.id === memberId);
    if (cached) return cached;

    const { data } = await (supabase as any)
      .from('ai_team_members')
      .select('*')
      .eq('id', memberId)
      .maybeSingle();
    return data || null;
  };

  const resolveFirstMarcosStageId = async (effectiveUserId: string) => {
    const cachedStageId = manualStages.find(s => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.id))?.id;
    if (cachedStageId) return cachedStageId;

    const { data, error } = await (supabase as any)
      .from('crm_pipeline_stages')
      .select('id')
      .eq('user_id', effectiveUserId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      throw new Error('Nenhuma etapa do CRM do Marcos foi encontrada para esta conta.');
    }
    return data.id as string;
  };

  const loadLeadDetail = async (lead: CrmLead) => {
    setSelectedLead(lead);

    if (isMarcosCrm) {
      const [notesRes, schedRes] = await Promise.all([
        (supabase as any)
          .from('marcos_crm_notes')
          .select('id, lead_id, content, is_pinned, created_at, member:ai_team_members(name)')
          .eq('lead_id', lead.id)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('marcos_followup_schedules')
          .select('id, lead_id, scheduled_at, message_template, status, created_at, sent_at, media_url, media_type')
          .eq('lead_id', lead.id)
          .order('scheduled_at', { ascending: true }),
      ]);

      if (notesRes.error) {
        toast({ title: 'Erro ao carregar anotacoes', description: notesRes.error.message, variant: 'destructive' });
      }
      if (schedRes.error) {
        toast({ title: 'Erro ao carregar follow-ups', description: schedRes.error.message, variant: 'destructive' });
      }

      setNotes(notesRes.data || []);
      setTransfers([]);
      setSchedules(schedRes.data || []);
      return;
    }

    const [notesRes, schedRes, transfersRes] = await Promise.all([
      (supabase as any)
        .from('pedro_crm_notes')
        .select('id, lead_id, content, is_pinned, created_at, member:ai_team_members(name)')
        .eq('lead_id', lead.id)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false }),
      (supabase as any)
        .from('pedro_followup_schedules')
        .select('id, lead_id, scheduled_at, message_template, status, created_at')
        .eq('lead_id', lead.id)
        .order('scheduled_at', { ascending: true }),
      // Feedback da IA gerado em cada transferência (ai_lead_transfers.notes)
      (supabase as any)
        .from('ai_lead_transfers')
        .select('id, lead_id, transfer_reason, notes, created_at, to_member:ai_team_members!ai_lead_transfers_to_member_id_fkey(name)')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
    ]);
    setNotes(notesRes.data || []);
    setSchedules(schedRes.data || []);
    setTransfers(transfersRes.data || []);
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedLead || !userId) return;
    setNoteLoading(true);
    try {
      const table = isMarcosCrm ? 'marcos_crm_notes' : 'pedro_crm_notes';
      const currentSeller = isMarcosCrm ? await resolveCurrentSellerForMarcos() : null;
      const effectiveUserId = isMarcosCrm && isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;

      const { error } = await (supabase as any).from(table).insert({
        lead_id:   selectedLead.id,
        user_id:   effectiveUserId,
        member_id: currentSeller?.id || memberId,
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

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Apagar esta anotação? Esta ação não pode ser desfeita.')) return;
    try {
      const table = isMarcosCrm ? 'marcos_crm_notes' : 'pedro_crm_notes';
      const { error } = await (supabase as any).from(table).delete().eq('id', noteId);
      if (error) throw error;
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast({ title: 'Anotação apagada.' });
    } catch (err: any) {
      toast({ title: 'Erro ao apagar', description: err.message, variant: 'destructive' });
    }
  };

  const toggleNotePin = async (noteId: string, currentPinned: boolean) => {
    try {
      const table = isMarcosCrm ? 'marcos_crm_notes' : 'pedro_crm_notes';
      await (supabase as any).from(table).update({ is_pinned: !currentPinned }).eq('id', noteId);
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_pinned: !currentPinned } : n)
        .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)));
      toast({ title: !currentPinned ? '📌 Nota fixada!' : 'Nota desafixada' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const sendNoteToManager = async (note: Note) => {
    if (!selectedLead || !userId) return;
    try {
      await supabase.functions.invoke('pedro-process-feedback', {
        body: {
          lead_id: selectedLead.id,
          member_id: memberId,
          content: `📌 Anotação: ${note.content}`,
          priority: 'normal',
        },
      });
      toast({ title: '✅ Nota enviada ao gerente!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const maxSize = file.type.startsWith('video/') ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: 'Arquivo muito grande', description: `Máximo ${maxSize / (1024 * 1024)}MB`, variant: 'destructive' });
      return;
    }
    setFuUploading(true);
    setFuMediaFile(file);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('followup-media').upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('followup-media').getPublicUrl(path);
      setFuMediaUrl(urlData.publicUrl);
    } catch (err: any) {
      toast({ title: 'Erro ao enviar arquivo', description: err.message, variant: 'destructive' });
      setFuMediaFile(null);
    } finally {
      setFuUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleScheduleFollowup = async () => {
    if (!fuMsg.trim() || !fuDate || !selectedLead || !userId || fuUploading || (fuMediaFile && !fuMediaUrl)) return;
    if (isMarcosCrm && !fuInstance) {
      toast({
        title: 'Selecione uma instância',
        description: 'Conecte ou selecione o WhatsApp que enviará este follow-up.',
        variant: 'destructive',
      });
      return;
    }

    setFuLoading(true);
    try {
      const mediaType = fuMediaFile ? fuMediaFile.type.split('/')[0] : null; // 'image' | 'video' | 'audio'

      if (isMarcosCrm) {
        const effectiveUserId = isSeller
          ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
          : userId;
        const currentSeller = await resolveCurrentSellerForMarcos();
        const { error } = await (supabase as any).from('marcos_followup_schedules').insert({
          lead_id:          selectedLead.id,
          user_id:          effectiveUserId,
          member_id:        currentSeller?.id || selectedLead.assigned_to_id || memberId,
          scheduled_at:     new Date(fuDate).toISOString(),
          message_template: fuMsg.trim(),
          instance_id:      fuInstance,
          status:           'pending',
          media_url:        fuMediaUrl || null,
          media_type:       mediaType,
        });
        if (error) throw error;
        setFuMsg(''); setFuDate('');
        setFuMediaFile(null); setFuMediaUrl('');
        toast({ title: 'Follow-up do Marcos agendado!' });
        await loadLeadDetail(selectedLead);
        return;
      }

      const { error } = await (supabase as any).from('pedro_followup_schedules').insert({
        lead_id:          selectedLead.id,
        user_id:          userId,
        member_id:        memberId,
        scheduled_at:     new Date(fuDate).toISOString(),
        message_template: fuMsg.trim(),
        instance_id:      fuInstance || null,
        status:           'pending',
        media_url:        fuMediaUrl || null,
        media_type:       mediaType,
      });
      if (error) throw error;
      // Atualiza next_followup_at no lead
      await (supabase as any).from('ai_crm_leads').update({ next_followup_at: new Date(fuDate).toISOString() }).eq('id', selectedLead.id);
      setFuMsg(''); setFuDate('');
      // Mantém a instância selecionada para próximos follow-ups
      setFuMediaFile(null); setFuMediaUrl('');
      toast({ title: '✅ Follow-up agendado!' });
      await loadLeadDetail(selectedLead);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setFuLoading(false);
    }
  };

  // Cancela um follow-up agendado ANTES de ser disparado.
  // Não DELETE — só marca status='cancelled' (auditável + edge function
  // pedro-trigger-followup já filtra por status='pending', logo ignora).
  // Race condition aceita: se o cron disparar nos 60s entre cliques, mensagem
  // pode ir mesmo assim (probabilidade baixa, impacto: 1 msg fora de hora).
  const handleCancelFollowup = async (id: string) => {
    if (!id || cancellingFollowupId) return;
    if (!confirm('Cancelar este follow-up agendado? Ele NÃO será enviado pro lead.')) return;
    setCancellingFollowupId(id);
    try {
      const followupTable = isMarcosCrm ? 'marcos_followup_schedules' : 'pedro_followup_schedules';
      const { error } = await (supabase as any)
        .from(followupTable)
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'pending'); // só cancela se ainda estiver pending (atômico)
      if (error) throw error;
      // Remove da lista local imediatamente (otimista)
      setSchedules(prev => prev.filter(s => s.id !== id));
      // Se era o próximo follow-up do lead, limpa o next_followup_at
      if (!isMarcosCrm && selectedLead?.id) {
        const remainingPending = schedules.filter(s => s.status === 'pending' && s.id !== id);
        const nextScheduledAt = remainingPending.length > 0
          ? remainingPending.reduce((min, s) =>
              new Date(s.scheduled_at) < new Date(min) ? s.scheduled_at : min, remainingPending[0].scheduled_at)
          : null;
        await (supabase as any).from('ai_crm_leads')
          .update({ next_followup_at: nextScheduledAt })
          .eq('id', selectedLead.id);
      }
      toast({ title: '✅ Follow-up cancelado', description: 'Não será enviado pro lead.' });
    } catch (err: any) {
      toast({ title: 'Erro ao cancelar', description: err.message, variant: 'destructive' });
      // Em caso de erro, recarrega pra garantir estado consistente
      if (selectedLead) await loadLeadDetail(selectedLead);
    } finally {
      setCancellingFollowupId(null);
    }
  };

  const handleSendFeedback = async () => {
    if (!selectedLead || !userId) return;
    // Validações do formulário estruturado
    if (!fbCity) {
      toast({ title: 'Selecione a cidade do cliente', variant: 'destructive' });
      return;
    }
    // Fase 6.4: removida validação de "Outros" — cidade nova é cadastrada via modal
    if (!fbReason) {
      toast({ title: 'Selecione o motivo da não-compra', variant: 'destructive' });
      return;
    }
    setFbLoading(true);
    try {
      const finalCity = fbCity; // Fase 6.4: nome direto do DynamicSelect
      // Monta content legível para compatibilidade
      const contentLines = [
        `Cidade: ${finalCity}`,
        `Motivo: ${fbReason}`,
      ];
      if (fbObservations.trim()) contentLines.push(`Obs: ${fbObservations.trim()}`);
      const content = contentLines.join(' | ');

      const res = await supabase.functions.invoke('pedro-process-feedback', {
        body: {
          // M5: Marcos manda crm_lead_id (aponta crm_leads); Pedro manda lead_id (aponta ai_crm_leads)
          ...(isMarcosCrm
            ? { crm_lead_id: selectedLead.id }
            : { lead_id: selectedLead.id }),
          member_id:    memberId,
          content,
          priority:     fbPriority,
          city:         finalCity,
          reason:       fbReason,
          observations: fbObservations.trim() || null,
        },
      });
      if (res.error) throw res.error;
      // Reset form
      setFbCity(''); setFbCityCustom(''); setFbReason('');
      setFbObservations(''); setFbPriority('normal'); setFbReasonOpen(null);
      toast({ title: '✅ Feedback enviado ao gerente!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setFbLoading(false);
    }
  };

  const loadLeadFeedbackHistory = async (leadId: string) => {
    setFbHistoryLoading(true);
    try {
      // M5: Marcos filtra por crm_lead_id; Pedro por lead_id.
      const filterCol = isMarcosCrm ? 'crm_lead_id' : 'lead_id';
      const { data } = await (supabase as any)
        .from('pedro_manager_feedback')
        .select('id, lead_id, crm_lead_id, content, city, reason, observations, priority, read_at, created_at, member:ai_team_members(name)')
        .eq(filterCol, leadId)
        .order('created_at', { ascending: false });
      setLeadFeedbacks(data || []);
    } catch { /* ignore */ }
    setFbHistoryLoading(false);
    setFbHistoryOpen(true);
  };

  const markFeedbackRead = async (id: string) => {
    await (supabase as any).from('pedro_manager_feedback').update({ read_at: new Date().toISOString() }).eq('id', id);
    setFeedbacks(prev => prev.map(f => f.id === id ? { ...f, read_at: new Date().toISOString() } : f));
  };

  const updateLeadStatus = async (newStatus: string) => {
    if (!selectedLead || !userId) return;
    setStatusUpdating(true);
    try {
      if (isMarcosCrm) {
        const { error } = await (supabase as any)
          .from('crm_leads')
          .update({ stage_id: newStatus })
          .eq('id', selectedLead.id);
        if (error) throw error;
        setSelectedLead({ ...selectedLead, status_crm: newStatus });
        setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, status_crm: newStatus } : l));
        toast({ title: '✅ Status atualizado!' });
        if (isWinStatus(newStatus)) openVendaDialogFor(selectedLead.id);
        return;
      }
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status_crm: newStatus })
        .eq('id', selectedLead.id);
      if (error) throw error;
      setSelectedLead({ ...selectedLead, status_crm: newStatus });
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, status_crm: newStatus } : l));
      toast({ title: '✅ Status atualizado!' });
      if (isWinStatus(newStatus)) openVendaDialogFor(selectedLead.id);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setStatusUpdating(false);
    }
  };

  // Salva a data real de chegada do lead direto da tela de detalhe (sem abrir o lapis).
  // Salva na tabela certa (Marcos = crm_leads / Pedro = ai_crm_leads). Vazio = limpa (usa created_at).
  const updateLeadArrived = async (dateStr: string) => {
    if (!selectedLead) return;
    const iso = dateStr ? new Date(dateStr + 'T12:00:00').toISOString() : null;
    try {
      const table = isMarcosCrm ? 'crm_leads' : 'ai_crm_leads';
      const { error } = await (supabase as any).from(table).update({ arrived_at: iso }).eq('id', selectedLead.id);
      if (error) throw error;
      setSelectedLead({ ...selectedLead, arrived_at: iso } as any);
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, arrived_at: iso } : l));
      toast({ title: '✅ Data de chegada atualizada!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const reassignLead = async (leadId: string, newMemberId: string | null) => {
    setReassigning(leadId);
    try {
      if (isMarcosCrm) {
        const lead = leads.find(l => l.id === leadId) || selectedLead;
        const newMember = newMemberId ? teamMembers.find(m => m.id === newMemberId) ?? null : null;

        // FASE 2 PLANO_CORRECAO_BUGS — Marcos passa a chamar manual-transfer
        // (edge function) quando ATRIBUIR vendedor. Edge function envia
        // briefing WhatsApp pro vendedor + relatorio pro gerente Marcos
        // (manager_feedback_config.gerente_phone_marcos). Antes era so UPDATE
        // direto no banco — vendedor recebia lead "no escuro".
        // DESATRIBUIR (newMemberId=null) continua so UPDATE direto, sem msg.
        let marcosDeduplicated = false;
        if (newMemberId) {
          const { data, error } = await supabase.functions.invoke('manual-transfer', {
            body: {
              crmLeadId: leadId,
              memberId: newMemberId,
              notes: 'Transferência manual via Marcos CRM',
            }
          });
          if (error) {
            let message = error.message || 'Falha ao transferir';
            const context = (error as any).context;
            if (context && typeof context.json === 'function') {
              try { const body = await context.json(); message = body?.error || message; } catch {}
            }
            throw new Error(message);
          }
          marcosDeduplicated = !!(data as any)?.deduplicated;
        } else {
          // Desatribuição — só UPDATE direto
          const nextCustomFields = {
            ...(lead?.custom_fields || {}),
            seller_member_id: null,
            seller_name: null,
            seller_assigned_at: null,
            seller_assigned_by_auth_user_id: userId || null,
            seller_unassigned_at: new Date().toISOString(),
          };
          const { error } = await (supabase as any)
            .from('crm_leads')
            .update({ assigned_to: null, custom_fields: nextCustomFields })
            .eq('id', leadId);
          if (error) throw error;
        }

        // Optimistic UI update (edge function ja persistiu o estado correto)
        const nextCustomFields = {
          ...(lead?.custom_fields || {}),
          seller_member_id: newMemberId,
          seller_name: newMember?.name || null,
          seller_assigned_at: newMemberId ? new Date().toISOString() : null,
          seller_assigned_by_auth_user_id: userId || null,
        };
        setLeads(prev => prev.map(l => l.id === leadId ? {
          ...l,
          assigned_to_id: newMemberId,
          member: newMember ? { id: newMember.id, name: newMember.name } : null,
          custom_fields: nextCustomFields,
        } : l));
        if (selectedLead?.id === leadId) {
          setSelectedLead({
            ...selectedLead,
            assigned_to_id: newMemberId,
            member: newMember ? { id: newMember.id, name: newMember.name } : null,
            custom_fields: nextCustomFields,
          });
        }
        // BUG-NOVO-03: respeitar deduplicated do backend (clique duplo < 30s)
        if (marcosDeduplicated) {
          toast({
            title: 'ℹ️ Já estava atribuído',
            description: `Clique recente detectado. ${newMember?.name} não recebeu mensagem duplicada.`,
          });
        } else {
          toast({
            title: newMemberId ? '✅ Lead transferido!' : '✅ Lead desatribuído',
            description: newMemberId
              ? `${newMember?.name} recebeu o briefing. Gerente Marcos notificado (se configurado).`
              : undefined,
          });
        }
        return;
      }

      // Pedro: atribuir vendedor passa pela edge function manual-transfer
      // que ALÉM de atualizar o banco, dispara:
      //   1. briefing IA via WhatsApp pro vendedor (resumo do lead + histórico)
      //   2. relatório de transferência pro gerente
      //   3. registro em ai_lead_transfers
      // Desatribuir (newMemberId=null) continua só fazendo UPDATE.
      const newMember = newMemberId ? teamMembers.find(m => m.id === newMemberId) ?? null : null;

      let pedroDeduplicated = false;
      if (newMemberId) {
        const lead = leads.find(l => l.id === leadId) || selectedLead;
        const { data, error } = await supabase.functions.invoke('manual-transfer', {
          body: {
            leadId,
            memberId: newMemberId,
            notes: 'Transferência manual via CRM Avançado',
            remoteJid: lead?.remote_jid || null,
            agentId: lead?.agent_id || null,
            leadName: lead?.lead_name || null,
            ownerUserId: userId || null,
          }
        });
        if (error) {
          let message = error.message || 'Falha ao transferir';
          const context = (error as any).context;
          if (context && typeof context.json === 'function') {
            try { const body = await context.json(); message = body?.error || message; } catch {}
          }
          throw new Error(message);
        }
        pedroDeduplicated = !!(data as any)?.deduplicated;
      } else {
        // Desatribuição — só UPDATE
        const { error } = await (supabase as any)
          .from('ai_crm_leads')
          .update({ assigned_to_id: null })
          .eq('id', leadId);
        if (error) throw error;
      }

      setLeads(prev => prev.map(l => l.id === leadId ? {
        ...l,
        assigned_to_id: newMemberId,
        member: newMember ? { id: newMember.id, name: newMember.name } : null,
      } : l));
      if (selectedLead?.id === leadId) {
        setSelectedLead({
          ...selectedLead,
          assigned_to_id: newMemberId,
          member: newMember ? { id: newMember.id, name: newMember.name } : null,
        });
      }
      // BUG-NOVO-03: respeitar deduplicated do backend (clique duplo < 30s)
      if (pedroDeduplicated) {
        toast({
          title: 'ℹ️ Já estava transferido',
          description: `Clique anterior detectado (< 30s). ${newMember?.name} não recebeu mensagem duplicada.`,
        });
      } else {
        toast({
          title: newMemberId ? '✅ Lead transferido!' : '✅ Lead desatribuído',
          description: newMemberId
            ? `${newMember?.name} recebeu o briefing IA. Aguardando confirmação do vendedor (até 15min). Se não responder, lead será reescalado.`
            : undefined,
        });
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setReassigning(null);
    }
  };

  // ── Transferência manual pro PRÓXIMO vendedor da fila (round-robin) ──────────
  // Mesma ordem do backend: total_leads_received ASC, depois last_lead_received_at
  // ASC (quem nunca recebeu / recebeu há mais tempo vem primeiro). Só entram na
  // fila vendedores ATIVOS, visíveis no sistema e com WhatsApp cadastrado.
  const nextSellerInQueue = (): TeamMember | null => {
    const eligible = teamMembers.filter(m =>
      m.is_active && m.active_in_system !== false && !!m.whatsapp_number
    );
    if (eligible.length === 0) return null;
    return [...eligible].sort((a, b) => {
      const ta = a.total_leads_received ?? 0;
      const tb = b.total_leads_received ?? 0;
      if (ta !== tb) return ta - tb;
      const la = a.last_lead_received_at ? new Date(a.last_lead_received_at).getTime() : 0;
      const lb = b.last_lead_received_at ? new Date(b.last_lead_received_at).getTime() : 0;
      return la - lb;
    })[0];
  };

  // Abre a confirmação de transferência pro próximo da fila.
  const startQueueTransfer = (lead: CrmLead) => {
    const seller = nextSellerInQueue();
    if (!seller) {
      toast({
        title: 'Nenhum vendedor disponível',
        description: 'Não há vendedor ativo com WhatsApp na fila para receber este lead.',
        variant: 'destructive',
      });
      return;
    }
    setConfirmQueueTransfer({ lead, seller });
  };

  // Confirma e executa. Reusa reassignLead, que já: envia o briefing pro
  // vendedor no WhatsApp, manda o relatório pro gerente, registra em
  // ai_lead_transfers e atualiza o painel em tempo real.
  const confirmQueueTransferNow = async () => {
    if (!confirmQueueTransfer) return;
    setQueueTransferring(true);
    try {
      await reassignLead(confirmQueueTransfer.lead.id, confirmQueueTransfer.seller.id);
      setConfirmQueueTransfer(null);
    } finally {
      setQueueTransferring(false);
    }
  };

  // ── Resgate de leads órfãos (transferido preso, sem vendedor, sem pending) ──
  // 1) Prévia (dry-run, read-only): mostra quais leads iriam pra quais vendedores.
  // 2) Confirmar → roda de verdade (envia WhatsApp + cria a transferência pendente).
  // Escopado ao dono do painel (ownerId); a edge function valida a permissão.
  const ownerIdForRescue = effectiveUserIdState || userId || null;

  const handleRescuePreview = async () => {
    if (!ownerIdForRescue) return;
    setRescueLoading(true);
    setRescuePreview(null);
    setRescueOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke('rescue-orphan-transfers', {
        body: { dry_run: true, user_id: ownerIdForRescue },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setRescuePreview(data);
      // Por padrão, marca TODOS os que dá pra reencaminhar (o gerente desmarca quem não quer).
      const ids = ((data as any)?.detalhe || [])
        .filter((d: any) => d.acao === 'reencaminharia' && d.lead_id)
        .map((d: any) => d.lead_id as string);
      setRescueSelected(new Set(ids));
    } catch (err: any) {
      setRescueOpen(false);
      toast({ title: 'Erro ao pré-visualizar', description: err.message, variant: 'destructive' });
    } finally {
      setRescueLoading(false);
    }
  };

  const handleRescueConfirm = async () => {
    if (!ownerIdForRescue) return;
    const leadIds = Array.from(rescueSelected);
    if (leadIds.length === 0) {
      toast({ title: 'Selecione ao menos um lead', description: 'Marque quem você quer resgatar.' });
      return;
    }
    setRescueRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('rescue-orphan-transfers', {
        // force: o gerente clicou confirmar -> envia agora mesmo fora do horário.
        body: { dry_run: false, user_id: ownerIdForRescue, lead_ids: leadIds, force: true },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.error) throw new Error(d.error);
      if (d?.fora_do_horario) {
        toast({ title: 'Fora do horário de repasse', description: d.message || 'O envio só roda dentro do horário comercial.' });
      } else {
        const n = d?.reencaminhados ?? 0;
        const extra = [
          d?.pulados_com_pending ? `${d.pulados_com_pending} já aguardando confirmação` : '',
          d?.sem_vendedor ? `${d.sem_vendedor} sem vendedor ativo` : '',
          d?.sem_instancia ? `${d.sem_instancia} sem WhatsApp conectado` : '',
          d?.falha_envio ? `${d.falha_envio} falha no envio` : '',
        ].filter(Boolean).join(' · ');
        toast({
          title: n > 0 ? `✅ ${n} lead(s) reencaminhado(s)` : 'Nenhum lead reencaminhado',
          description: extra || undefined,
        });
      }
      setRescueOpen(false);
      setRescuePreview(null);
      await fetchData(true);
    } catch (err: any) {
      toast({ title: 'Erro ao resgatar', description: err.message, variant: 'destructive' });
    } finally {
      setRescueRunning(false);
    }
  };

  // Toggle da aba "Vendedores" = ativo NO SISTEMA (fonte de verdade do vendedor).
  // Pausar no sistema também tira da distribuição automática (is_active=false) —
  // vendedor fora do sistema não pode receber leads. Ativar restaura ambos.
  // `currentActive` = active_in_system atual.
  const toggleSellerActive = async (memberId: string, currentActive: boolean) => {
    try {
      // Encontra todos os IDs deste vendedor (pode ter múltiplos agent_id)
      const member = teamMembers.find(m => m.id === memberId);
      const allIds: string[] = (member as any)?._allIds || [memberId];
      const next = !currentActive;
      const update = next
        ? { active_in_system: true, is_active: true }
        : { active_in_system: false, is_active: false };

      // Atualiza todos os registros do mesmo vendedor
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update(update)
        .in('id', allIds);
      if (error) throw error;
      setTeamMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...update } : m));
      toast({ title: next ? '✅ Vendedor ativado' : '⛔ Vendedor pausado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleTriggerFollowups = async () => {
    setTriggerLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('pedro-trigger-followup', { body: {} });
      if (error) throw error;
      const { processed = 0, failed = 0 } = (data as any) ?? {};
      toast({
        title: processed > 0 ? `✅ ${processed} follow-up(s) disparado(s)` : 'Nenhum follow-up pendente',
        description: failed > 0 ? `${failed} falharam — verifique as instâncias.` : undefined,
        variant: failed > 0 ? 'destructive' : 'default',
      });
      if (processed > 0) await fetchData(true);
    } catch (err: any) {
      toast({ title: 'Erro ao disparar follow-ups', description: err.message, variant: 'destructive' });
    } finally {
      setTriggerLoading(false);
    }
  };

  // "Iniciar Follow-up agora" -> dispara o MOTOR DE REATIVACAO (pedro-auto-followup) na
  // coluna de inativos. O motor respeita SEMPRE as regras do painel (horario, dias,
  // teto/dia, intervalo, pausa) — manda o 1o agora e o cron (5/5min) continua o lote
  // espacado, sem blast (protege o numero). Se o motor estiver desligado globalmente,
  // avisa em vez de prometer envio.
  const handleStartReactivation = async () => {
    setTriggerLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('pedro-auto-followup', { body: {} });
      if (error) throw error;
      const d = (data as any) ?? {};
      if (d.disabled) {
        toast({
          title: '⏸️ Follow-up ainda não está ativo no servidor',
          description: 'O motor de reativação está desligado globalmente. Avise o suporte para liberar.',
          variant: 'destructive',
        });
        return;
      }
      const sent = Number(d.total_sent) || 0;
      toast({
        title: sent > 0 ? `✅ Follow-up iniciado — ${sent} enviado(s) agora` : '✅ Follow-up iniciado',
        description: 'As próximas mensagens vão saindo espaçadas, respeitando o horário, o teto por dia e o intervalo configurados.',
      });
      await fetchData(true);
    } catch (err: any) {
      toast({ title: 'Erro ao iniciar follow-up', description: err.message, variant: 'destructive' });
    } finally {
      setTriggerLoading(false);
    }
  };

  // Re-classifica leads nos 3 níveis SDR (Inativo / Pouco Qualificado / Qualificado)
  // Roda a edge function auto-classify-leads que analisa cada lead e ajusta status_crm
  // baseado em campos preenchidos + tempo de inatividade do cliente.
  const handleClassifyLeads = async () => {
    setClassifyLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-classify-leads', { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const total = (data as any)?.total_changes || 0;
      const summary = (data as any)?.summary_by_new_status || {};
      const desc = Object.keys(summary).length > 0
        ? Object.entries(summary).map(([k, v]) => `${v} → ${k}`).join(', ')
        : undefined;
      toast({
        title: total > 0 ? `🤖 ${total} lead(s) reclassificado(s)` : 'Nenhum lead precisava de reclassificação',
        description: desc,
      });
      if (total > 0) await fetchData(true);
    } catch (err: any) {
      toast({ title: 'Erro ao reclassificar', description: err.message, variant: 'destructive' });
    } finally {
      setClassifyLoading(false);
    }
  };

  // ── Estados e handlers: adicionar lead manual, apagar lead, drag-drop ────
  const [addLeadOpen, setAddLeadOpen]   = useState(false);
  const [addLeadName, setAddLeadName]   = useState('');
  const [addLeadPhone, setAddLeadPhone] = useState('');
  const [addLeadOrigem, setAddLeadOrigem] = useState<string>(''); // '' = origem NULL no banco (LEGACY — mantém compat). '__custom__' = modo personalizado (Marcos)
  const [addLeadOrigemOutros, setAddLeadOrigemOutros] = useState<string>('');
  // Spec 28/05/2026: Marcos — origem personalizada (texto livre) + opção
  // de criar nova coluna no Kanban com o nome digitado
  const [addLeadCustomOrigem, setAddLeadCustomOrigem] = useState<string>('');
  const [addLeadCustomOrigemCreateColumn, setAddLeadCustomOrigemCreateColumn] = useState<boolean>(false);
  // Fase 6.4: novo source_id (uuid) — referência a lead_sources
  const [addLeadSourceId, setAddLeadSourceId] = useState<string | null>(null);
  const [addLeadSourceName, setAddLeadSourceName] = useState<string>('');
  // Fase 6 Feature B: 3 campos extras (texto livre, sem hook novo)
  const [addLeadCity, setAddLeadCity] = useState<string>('');
  const [addLeadVehicle, setAddLeadVehicle] = useState<string>('');
  const [addLeadVisit, setAddLeadVisit] = useState<string>('');
  const [addLeadArrived, setAddLeadArrived] = useState<string>(''); // data real que o lead chegou (porta/manual); vazio = hoje
  const [addLeadSaving, setAddLeadSaving] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);
  const [editingLead, setEditingLead] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  // Fase 6 Feature D: edit inline tambem permite cidade + carro
  const [editCity, setEditCity] = useState('');
  const [editVehicle, setEditVehicle] = useState('');
  const [editVisitAt, setEditVisitAt] = useState(''); // Item 2: datetime-local ISO (vazio = sem visita marcada)
  const [editArrived, setEditArrived] = useState(''); // data real que o lead chegou (YYYY-MM-DD; vazio = usa created_at)
  const [editSaving, setEditSaving] = useState(false);

  // ── Bulk upload states ──
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  // Prompt 1.1: bulkLeads agora carrega origem opcional (validada contra LEAD_ORIGEM_VALUES)
  const [bulkLeads, setBulkLeads] = useState<{ name: string; phone: string; valid: boolean; origem?: string | null; origemError?: string }[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number } | null>(null);
  const [bulkArrived, setBulkArrived] = useState<string>(''); // data de chegada aplicada a TODOS os leads do lote (porta/manual)
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const handleBulkFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        // Detect columns: look for name/nome, phone/telefone/whatsapp/numero, origem (Prompt 1.1)
        let nameCol = -1;
        let phoneCol = -1;
        let origemCol = -1;
        const headerRow = (rows[0] || []).map((h: any) => String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
        headerRow.forEach((h: string, i: number) => {
          if (nameCol === -1 && (h.includes('nome') || h.includes('name') || h.includes('cliente') || h.includes('lead'))) nameCol = i;
          if (phoneCol === -1 && (h.includes('telefone') || h.includes('phone') || h.includes('whatsapp') || h.includes('celular') || h.includes('numero') || h.includes('fone'))) phoneCol = i;
          if (origemCol === -1 && (h === 'origem' || h === 'source' || h === 'canal' || h === 'origin')) origemCol = i;
        });
        // Fallback: first col = name, second col = phone
        if (nameCol === -1) nameCol = 0;
        if (phoneCol === -1) phoneCol = nameCol === 0 ? 1 : 0;

        const startRow = headerRow.some((h: string) => h.includes('nome') || h.includes('name') || h.includes('telefone') || h.includes('phone') || h.includes('whatsapp') || h === 'origem') ? 1 : 0;

        const parsed: { name: string; phone: string; valid: boolean; origem?: string | null; origemError?: string }[] = [];
        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const rawName = String(row[nameCol] || '').trim();
          const rawPhone = String(row[phoneCol] || '').replace(/\D/g, '');
          if (!rawName && !rawPhone) continue;
          const valid = rawName.length >= 2 && rawPhone.length >= 10 && rawPhone.length <= 15;
          // Origem: opcional. Se preenchida, valida contra os 6 valores. Default 'outros'.
          let origem: string | null = null;
          let origemError: string | undefined;
          if (origemCol >= 0) {
            const rawOrigem = String(row[origemCol] || '').trim().toLowerCase();
            if (rawOrigem) {
              if (LEAD_ORIGEM_VALUES.includes(rawOrigem)) {
                origem = rawOrigem;
              } else {
                origemError = `Origem inválida: "${rawOrigem}". Valores aceitos: ${LEAD_ORIGEM_VALUES.join(', ')}.`;
              }
            }
          }
          parsed.push({ name: rawName, phone: rawPhone, valid: valid && !origemError, origem, origemError });
        }
        setBulkLeads(parsed);
        setBulkResult(null);
        setBulkProgress(0);
        setBulkDialogOpen(true);
      } catch (err: any) {
        toast({ title: 'Erro ao ler arquivo', description: 'Verifique se o arquivo é .csv, .xlsx ou .xls válido.', variant: 'destructive' });
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input so the same file can be selected again
    e.target.value = '';
  };

  const handleBulkInsert = async () => {
    if (!userId) return;
    const validLeads = bulkLeads.filter(l => l.valid);
    if (validLeads.length === 0) return;
    setBulkSaving(true);
    setBulkProgress(0);
    setBulkResult(null);
    let success = 0;
    let failed = 0;
    try {
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;

      if (isMarcosCrm) {
        const firstStageId = await resolveFirstMarcosStageId(effectiveUserId);
        const currentSeller = await resolveCurrentSellerForMarcos();
        const sellerCustomFields = currentSeller ? {
          seller_member_id: currentSeller.id,
          seller_name: currentSeller.name,
          created_by_auth_user_id: userId,
        } : {
          created_by_auth_user_id: userId,
        };
        const { data: maxPosRow } = await (supabase as any)
          .from('crm_leads')
          .select('position')
          .eq('user_id', effectiveUserId)
          .eq('stage_id', firstStageId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        let nextPosition = (maxPosRow?.position ?? -1) + 1;
        const batchSize = 50;
        for (let i = 0; i < validLeads.length; i += batchSize) {
          const batch = validLeads.slice(i, i + batchSize).map(l => ({
            user_id: effectiveUserId,
            stage_id: firstStageId,
            name: l.name,
            phone: l.phone,
            source: l.origem || 'importacao',
            notes: null,
            tags: ['Marcos Manual', 'Importado'],
            value: 0,
            currency: 'BRL',
            priority: 'medium',
            position: nextPosition++,
            assigned_to: currentSeller?.id || null,
            custom_fields: { crm_owner: 'marcos', input_mode: 'import', ...sellerCustomFields },
            // Data real de chegada do lote (porta/dia passado). Vazio = null -> usa created_at.
            arrived_at: bulkArrived ? new Date(bulkArrived + 'T12:00:00').toISOString() : null,
          }));
          const { error } = await (supabase as any).from('crm_leads').insert(batch);
          if (error) failed += batch.length;
          else success += batch.length;
          setBulkProgress(Math.min(100, Math.round(((i + batch.length) / validLeads.length) * 100)));
        }
        setBulkResult({ success, failed });
        if (success > 0) await fetchData(true);
        toast({
          title: `✅ ${success} lead(s) importado(s)!`,
          description: failed > 0 ? `${failed} falharam.` : undefined,
          variant: failed > 0 && success === 0 ? 'destructive' : 'default',
        });
        return;
      }

      // Resolve agent_id: team member > any member > first active agent
      const selectedMember = memberId ? teamMembers.find(m => m.id === memberId) : null;
      let agentId = selectedMember?.agent_id
        || teamMembers.find(m => m.agent_id)?.agent_id
        || null;
      if (!agentId) {
        const { data: firstAgent } = await (supabase as any)
          .from('wa_ai_agents').select('id').eq('user_id', effectiveUserId).eq('is_active', true).limit(1).single();
        agentId = firstAgent?.id || null;
      }
      if (!agentId) {
        toast({ title: 'Nenhum agente IA configurado', description: 'Crie um agente IA antes de importar leads.', variant: 'destructive' });
        setBulkSaving(false);
        return;
      }

      // Insert in batches of 50
      const batchSize = 50;
      for (let i = 0; i < validLeads.length; i += batchSize) {
        const batch = validLeads.slice(i, i + batchSize).map(l => ({
          user_id:     effectiveUserId,
          agent_id:    agentId,
          lead_name:   l.name,
          remote_jid:  phoneToBrJid(l.phone),
          status_crm:  'novo',
          status:      'novo',
          assigned_to_id: memberId || null,
          // Prompt 1.1: usa origem da planilha se válida, senão 'outros' como default no bulk
          origem: l.origem || 'outros',
          // Data real de chegada do lote (porta/manual). Vazio = null -> painel usa created_at.
          arrived_at: bulkArrived ? new Date(bulkArrived + 'T12:00:00').toISOString() : null,
        }));
        const { error } = await (supabase as any).from('ai_crm_leads').insert(batch);
        if (error) {
          failed += batch.length;
        } else {
          success += batch.length;
        }
        setBulkProgress(Math.min(100, Math.round(((i + batch.length) / validLeads.length) * 100)));
      }
      setBulkResult({ success, failed });
      if (success > 0) await fetchData(true);
      toast({
        title: `✅ ${success} lead(s) importado(s)!`,
        description: failed > 0 ? `${failed} falharam.` : undefined,
        variant: failed > 0 && success === 0 ? 'destructive' : 'default',
      });
    } catch (err: any) {
      toast({ title: 'Erro na importação', description: err.message, variant: 'destructive' });
    } finally {
      setBulkSaving(false);
    }
  };

  const handleAddLeadManual = async () => {
    if (!addLeadName.trim() || !addLeadPhone.trim() || !userId) return;
    setAddLeadSaving(true);
    try {
      const cleanPhone = addLeadPhone.replace(/\D/g, '');
      const remoteJid = phoneToBrJid(cleanPhone);
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;

      if (isMarcosCrm) {
        const firstStageId = await resolveFirstMarcosStageId(effectiveUserId);
        // Spec 28/05/2026: modo personalizado — vendedor digitou um nome
        // custom (ex: "Feira do automovel") + opcionalmente marcou pra criar
        // coluna nova no Kanban.
        const isCustomOrigem = addLeadOrigem === '__custom__';
        const customOrigemText = addLeadCustomOrigem.trim();
        let customStageId: string | null = null;
        if (isCustomOrigem && addLeadCustomOrigemCreateColumn && customOrigemText) {
          // Tenta achar stage existente com esse nome (case-insensitive) antes
          // de criar nova — evita duplicatas se vendedor digitar igual de novo.
          const { data: existingStage } = await (supabase as any)
            .from('crm_pipeline_stages')
            .select('id')
            .eq('user_id', effectiveUserId)
            // so reaproveita coluna da conta (null) ou a do proprio vendedor
            .or(`seller_auth_id.is.null,seller_auth_id.eq.${userId}`)
            .ilike('name', customOrigemText)
            .maybeSingle();
          if (existingStage?.id) {
            customStageId = existingStage.id;
          } else {
            // Cria nova coluna no fim do pipeline (maior position + 1)
            const { data: maxStagePos } = await (supabase as any)
              .from('crm_pipeline_stages')
              .select('position')
              .eq('user_id', effectiveUserId)
              .order('position', { ascending: false })
              .limit(1)
              .maybeSingle();
            const nextPos = (maxStagePos?.position ?? -1) + 1;
            const { data: newStage, error: stageErr } = await (supabase as any)
              .from('crm_pipeline_stages')
              .insert({
                user_id: effectiveUserId,
                name: customOrigemText,
                position: nextPos,
                color: '#a78bfa', // roxo neutro pra origens personalizadas
                // coluna criada por vendedor pertence SO a ele (master = null)
                seller_auth_id: isSeller ? userId : null,
                // origem personalizada criada no add-lead não entra sozinha no
                // Painel ao Vivo — o dono liga no botão do olho se quiser.
                show_in_live: false,
              })
              .select('id')
              .single();
            if (stageErr) throw stageErr;
            customStageId = newStage?.id || null;
          }
        }
        // Bug 1 (spec 27/05/2026): lead vai pra coluna que casa com a origem
        // selecionada. Fallback pra firstStageId se origem nao tiver mapping.
        const stageIdForOrigem = isCustomOrigem
          ? (customStageId || firstStageId)  // 28/05: prioriza coluna personalizada criada
          : resolveMarcosStageIdForOrigem(addLeadOrigem, manualStages);
        const targetStageId = stageIdForOrigem || firstStageId;
        const currentSeller = await resolveCurrentSellerForMarcos();
        const sellerCustomFields = currentSeller ? {
          seller_member_id: currentSeller.id,
          seller_name: currentSeller.name,
          created_by_auth_user_id: userId,
        } : {
          created_by_auth_user_id: userId,
        };
        const { data: maxPosRow } = await (supabase as any)
          .from('crm_leads')
          .select('position')
          .eq('user_id', effectiveUserId)
          .eq('stage_id', targetStageId)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        const { error } = await (supabase as any).from('crm_leads').insert({
          user_id: effectiveUserId,
          stage_id: targetStageId,
          name: addLeadName.trim(),
          phone: cleanPhone,
          // Spec 28/05/2026: source guarda o NOME real digitado quando custom
          // (ex: 'Feira do automovel') pro vendedor ver no detalhe do lead;
          // senao usa o slug fixo (ex: 'consignado').
          source: isCustomOrigem ? (customOrigemText || 'manual') : (addLeadOrigem || 'manual'),
          // Spec 27/05/2026: grava tambem em crm_leads.origem (slug canonico)
          // pro Painel ao Vivo do Pedro contar esse lead na seção correta.
          // Custom origem: cai em 'outros' (CHECK constraint nao aceita custom).
          origem: isCustomOrigem ? 'outros' : marcosOrigemSlugToCanonical(addLeadOrigem),
          notes: isCustomOrigem
            ? `Origem personalizada: ${customOrigemText}`
            : (addLeadOrigem === 'outros' ? (addLeadOrigemOutros.trim() || null) : null),
          tags: ['Marcos Manual'],
          value: 0,
          currency: 'BRL',
          priority: 'medium',
          position: (maxPosRow?.position ?? -1) + 1,
          assigned_to: currentSeller?.id || null,
          custom_fields: { crm_owner: 'marcos', input_mode: 'manual', ...sellerCustomFields },
          // Feature M2: enriched fields no Marcos
          client_city:      addLeadCity.trim() || null,
          vehicle_interest: addLeadVehicle.trim() || null,
          // Item 2: addLeadVisit é datetime-local ISO ("2026-05-22T14:00"). Salva os 2:
          //   visit_scheduled: leitura humana ("22/05/2026 14:00")
          //   visit_scheduled_at: timestamp pra comparar com hoje (banner)
          visit_scheduled:    addLeadVisit ? new Date(addLeadVisit).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null,
          visit_scheduled_at: addLeadVisit ? new Date(addLeadVisit).toISOString() : null,
          // Data real que o lead chegou (porta/manual). Vazio = null -> usa created_at.
          arrived_at:         addLeadArrived ? new Date(addLeadArrived + 'T12:00:00').toISOString() : null,
        });
        if (error) throw error;
        toast({
          title: '✅ Lead adicionado ao CRM!',
          description: isCustomOrigem && addLeadCustomOrigemCreateColumn && customStageId
            ? `Coluna "${customOrigemText}" criada no Kanban.`
            : undefined,
        });
        setAddLeadName(''); setAddLeadPhone(''); setAddLeadOrigem(''); setAddLeadOrigemOutros('');
        setAddLeadCustomOrigem(''); setAddLeadCustomOrigemCreateColumn(false);
        setAddLeadCity(''); setAddLeadVehicle(''); setAddLeadVisit(''); setAddLeadArrived('');
        setAddLeadOpen(false);
        await fetchData(true);
        return;
      }

      // Resolve agent_id: team member > any member > first active agent
      const selectedMember = memberId ? teamMembers.find(m => m.id === memberId) : null;
      let agentId = selectedMember?.agent_id
        || teamMembers.find(m => m.agent_id)?.agent_id
        || null;
      if (!agentId) {
        const { data: firstAgent } = await (supabase as any)
          .from('wa_ai_agents').select('id').eq('user_id', effectiveUserId).eq('is_active', true).limit(1).single();
        agentId = firstAgent?.id || null;
      }
      if (!agentId) {
        toast({ title: 'Nenhum agente IA configurado', description: 'Crie um agente IA antes de adicionar leads.', variant: 'destructive' });
        setAddLeadSaving(false);
        return;
      }

      // Spec 28/05/2026: Pedro form so aceita "Tráfego Pago" como origem
      // (campo eh um label read-only). Lead manual no Pedro = sempre vindo
      // de campanha de tráfego pago.
      const { error } = await (supabase as any).from('ai_crm_leads').insert({
        user_id:     effectiveUserId,
        agent_id:    agentId,
        lead_name:   addLeadName.trim(),
        remote_jid:  remoteJid,
        status_crm:  'novo',
        status:      'novo',
        assigned_to_id: memberId || null,
        // Fase 6.4: source_id (nova FK pra lead_sources) — nao usado mais pra
        // Pedro form (deixado null). Origem agora eh sempre 'trafico_pago'
        // conforme spec 28/05/2026.
        source_id:     null,
        origem:        'trafico_pago',
        origem_outros: null,
        // Fase 6 Feature B + Item 2: cidade/carro/visita (visita agora salva texto + timestamp)
        client_city:        addLeadCity.trim() || null,
        vehicle_interest:   addLeadVehicle.trim() || null,
        visit_scheduled:    addLeadVisit ? new Date(addLeadVisit).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null,
        visit_scheduled_at: addLeadVisit ? new Date(addLeadVisit).toISOString() : null,
        // Data real que o lead chegou (porta/manual). Vazio = null -> painel usa created_at.
        arrived_at:         addLeadArrived ? new Date(addLeadArrived + 'T12:00:00').toISOString() : null,
      });
      if (error) throw error;
      toast({ title: '✅ Lead adicionado ao CRM!' });
      setAddLeadName(''); setAddLeadPhone('');
      setAddLeadOrigem(''); setAddLeadOrigemOutros('');
      setAddLeadSourceId(null); setAddLeadSourceName('');
      setAddLeadCity(''); setAddLeadVehicle(''); setAddLeadVisit(''); setAddLeadArrived('');
      setAddLeadOpen(false);
      await fetchData(true);
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar lead', description: err.message, variant: 'destructive' });
    } finally {
      setAddLeadSaving(false);
    }
  };

  const startEditLead = () => {
    if (!selectedLead) return;
    const phone = selectedLead.remote_jid?.split('@')[0]?.replace(/\D/g, '') || '';
    setEditName(selectedLead.lead_name || '');
    setEditPhone(phone);
    // Fase 6 Feature D: populates cidade + carro
    setEditCity((selectedLead as any).client_city || '');
    setEditVehicle((selectedLead as any).vehicle_interest || '');
    // Item 2: pre-popula com visit_scheduled_at convertido pra <input datetime-local> (YYYY-MM-DDTHH:MM, sem timezone)
    const vsa = (selectedLead as any).visit_scheduled_at;
    if (vsa) {
      const d = new Date(vsa);
      const pad = (n: number) => String(n).padStart(2, '0');
      setEditVisitAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      setEditVisitAt('');
    }
    // Pre-popula a data real de chegada (arrived_at) no <input type="date"> (YYYY-MM-DD).
    const arr = (selectedLead as any).arrived_at;
    setEditArrived(arr ? String(arr).slice(0, 10) : '');
    setEditingLead(true);
  };

  const handleSaveLeadEdit = async () => {
    if (!selectedLead) return;
    setEditSaving(true);
    try {
      const cleanPhone = editPhone.replace(/\D/g, '');
      const newJid = cleanPhone ? phoneToBrJid(cleanPhone) : selectedLead.remote_jid;
      const updateData: Record<string, string | null> = {};
      if (editName !== (selectedLead.lead_name || '')) updateData.lead_name = editName;
      if (newJid !== selectedLead.remote_jid) updateData.remote_jid = newJid;
      // Feature M4: cidade + carro agora valem pros 2 CRMs (Marcos ja tem as cols)
      const newCity = editCity.trim();
      const oldCity = (selectedLead as any).client_city || '';
      if (newCity !== oldCity) updateData.client_city = newCity || null;
      const newVehicle = editVehicle.trim();
      const oldVehicle = (selectedLead as any).vehicle_interest || '';
      if (newVehicle !== oldVehicle) updateData.vehicle_interest = newVehicle || null;

      // Item 2: visita agendada. editVisitAt é ISO local (YYYY-MM-DDTHH:MM).
      // Salva timestamp (visit_scheduled_at) + texto humano (visit_scheduled) coerentes.
      const newVisitIso  = editVisitAt ? new Date(editVisitAt).toISOString() : null;
      const newVisitText = editVisitAt ? new Date(editVisitAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
      const oldVisitIso  = (selectedLead as any).visit_scheduled_at || null;
      const visitChanged = (newVisitIso || '') !== (oldVisitIso || '');
      if (visitChanged) {
        updateData.visit_scheduled    = newVisitText;
        updateData.visit_scheduled_at = newVisitIso;
      }

      // Data real que o lead chegou (porta/manual). editArrived = 'YYYY-MM-DD'.
      // Compara so a parte da data; salva meio-dia pra nao virar de dia por fuso.
      const oldArrivedDay = (selectedLead as any).arrived_at ? String((selectedLead as any).arrived_at).slice(0, 10) : '';
      if ((editArrived || '') !== oldArrivedDay) {
        updateData.arrived_at = editArrived ? new Date(editArrived + 'T12:00:00').toISOString() : null;
      }

      if (isMarcosCrm) {
        const crmUpdate: Record<string, string | null> = {};
        if (editName !== (selectedLead.lead_name || '')) crmUpdate.name = editName;
        if (newJid !== selectedLead.remote_jid) crmUpdate.phone = cleanPhone;
        // Feature M4: Marcos tambem grava client_city + vehicle_interest
        if (newCity !== oldCity) crmUpdate.client_city = newCity || null;
        if (newVehicle !== oldVehicle) crmUpdate.vehicle_interest = newVehicle || null;
        // Item 2: Marcos também grava visita
        if (visitChanged) {
          crmUpdate.visit_scheduled    = newVisitText;
          crmUpdate.visit_scheduled_at = newVisitIso;
        }
        // Data real de chegada (corrige lead de porta/dia passado) tambem no Marcos.
        if ((editArrived || '') !== oldArrivedDay) {
          crmUpdate.arrived_at = editArrived ? new Date(editArrived + 'T12:00:00').toISOString() : null;
        }
        if (Object.keys(crmUpdate).length === 0) {
          setEditingLead(false);
          return;
        }
        const { error } = await (supabase as any)
          .from('crm_leads')
          .update(crmUpdate)
          .eq('id', selectedLead.id);
        if (error) throw error;
        const updatedLead = {
          ...selectedLead,
          lead_name: editName,
          remote_jid: phoneToBrJid(cleanPhone),
          client_city: newCity || null,
          vehicle_interest: newVehicle || null,
          visit_scheduled: newVisitText,
          visit_scheduled_at: newVisitIso,
        };
        setSelectedLead(updatedLead as CrmLead);
        setLeads(prev => prev.map(l => l.id === selectedLead.id ? (updatedLead as CrmLead) : l));
        setEditingLead(false);
        toast({ title: '✅ Lead atualizado!' });
        return;
      }
      if (Object.keys(updateData).length === 0) {
        setEditingLead(false);
        return;
      }
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update(updateData)
        .eq('id', selectedLead.id);
      if (error) throw error;
      const updatedLead = { ...selectedLead, ...updateData };
      setSelectedLead(updatedLead);
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, ...updateData } : l));
      setEditingLead(false);
      toast({ title: '✅ Lead atualizado!' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!confirm('Deseja excluir este lead permanentemente? Esta ação não pode ser desfeita.')) return;
    setDeletingLead(true);
    try {
      if (isMarcosCrm) {
        const { error } = await (supabase as any).from('crm_leads').delete().eq('id', leadId);
        if (error) throw error;
        toast({ title: '🗑️ Lead excluído!' });
        setSelectedLead(null);
        setLeads(prev => prev.filter(l => l.id !== leadId));
        return;
      }
      // Remove notas, followups, feedbacks e a MEMORIA da conversa associados
      // primeiro. Limpar pedro_conversation_state garante que o Pedro v2 recomeca
      // a conversa do zero (se reapresenta) ao apagar o lead do CRM.
      // wa_chat_history e por remote_jid (NAO tem lead_id): sem apagar tambem o
      // historico bruto, o Pedro recarrega a conversa antiga e "lembra" do lead
      // mesmo apos excluir (tratava como lead existente em vez de novo). Busca o
      // remote_jid/agent do lead antes de apagar p/ limpar o historico tambem.
      const { data: _leadRow } = await (supabase as any)
        .from('ai_crm_leads').select('remote_jid, agent_id').eq('id', leadId).maybeSingle();
      const _cascades: any[] = [
        (supabase as any).from('pedro_crm_notes').delete().eq('lead_id', leadId),
        (supabase as any).from('pedro_followup_schedules').delete().eq('lead_id', leadId),
        (supabase as any).from('pedro_manager_feedback').delete().eq('lead_id', leadId),
        (supabase as any).from('pedro_conversation_state').delete().eq('lead_id', leadId),
      ];
      if (_leadRow?.remote_jid && _leadRow?.agent_id) {
        _cascades.push(
          (supabase as any).from('wa_chat_history').delete()
            .eq('agent_id', _leadRow.agent_id).eq('remote_jid', _leadRow.remote_jid)
        );
      }
      await Promise.all(_cascades);
      const { error } = await (supabase as any).from('ai_crm_leads').delete().eq('id', leadId);
      if (error) throw error;
      toast({ title: '🗑️ Lead excluído!' });
      setSelectedLead(null);
      setLeads(prev => prev.filter(l => l.id !== leadId));
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' });
    } finally {
      setDeletingLead(false);
    }
  };

  const saveColumnOrder = async (nextOrder: string[]) => {
    if (!userId) return;
    const { error } = await (supabase as any)
      .from('crm_column_preferences')
      .upsert({
        auth_user_id: userId,
        crm_mode: mode,
        column_order: nextOrder,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'auth_user_id,crm_mode' });
    if (error) throw error;
  };

  const handleColumnReorder = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const from = pipelineColumns.findIndex(column => column.id === draggedId);
    const to = pipelineColumns.findIndex(column => column.id === targetId);
    if (from < 0 || to < 0 || from === to) return;

    const previousOrder = columnOrder;
    const nextOrder = reorderItems(pipelineColumns, from, to).map(column => column.id);
    setColumnOrder(nextOrder);
    try {
      await saveColumnOrder(nextOrder);
      toast({ title: '✅ Ordem das colunas salva!' });
    } catch (err: any) {
      setColumnOrder(previousOrder);
      toast({ title: 'Erro ao salvar ordem', description: err.message, variant: 'destructive' });
    }
  };

  // Detecta se o status/etapa de destino é "Venda concluída" (Pedro: id 'fechado';
  // Marcos: etapa cujo nome começa com "venda conclu").
  const isWinStatus = (newStatus: string): boolean => {
    if (!isMarcosCrm) return newStatus === 'fechado';
    const st = (manualStages.length ? manualStages : PIPELINE_COLUMNS).find(c => c.id === newStatus);
    return st ? normalizeStageName(st.title || '').startsWith('venda conclu') : false;
  };
  // Abre o popup de venda já pré-preenchido (carro do lead + data de hoje).
  const openVendaDialogFor = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setVendaCarro((lead as any)?.vehicle_interest || '');
    setVendaData(today);
    setVendaValor('');
    setVendaDialog({ leadId, nome: lead?.lead_name || 'Lead' });
  };
  // Salva carro + data (+ valor) na venda derivada do lead (criada pelo gatilho).
  const saveVenda = async () => {
    if (!vendaDialog) return;
    setVendaSaving(true);
    try {
      const tipo = isMarcosCrm ? 'marcos' : 'pedro';
      const valorNum = vendaValor ? Number(String(vendaValor).replace(/\./g, '').replace(',', '.')) : 0;
      const { error } = await (supabase as any)
        .from('comercial_vendas')
        .update({
          veiculo: vendaCarro.trim() || null,
          data_venda: vendaData,
          valor: Number.isFinite(valorNum) ? valorNum : 0,
        })
        .eq('origem_lead_tipo', tipo)
        .eq('origem_lead_id', vendaDialog.leadId);
      if (error) throw error;
      toast({ title: '✅ Venda registrada!', description: 'Carro e data salvos — já aparece no Painel Geral.' });
      setVendaDialog(null);
    } catch (err: any) {
      toast({ title: 'Erro ao salvar venda', description: err.message, variant: 'destructive' });
    } finally {
      setVendaSaving(false);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination, source, type } = result;
    if (!destination) return;

    if (type === 'COLUMN') {
      if (destination.index === source.index) return;
      const previousOrder = columnOrder;
      const nextColumns = reorderItems(pipelineColumns, source.index, destination.index);
      const nextOrder = nextColumns.map(column => column.id);
      setColumnOrder(nextOrder);
      try {
        await saveColumnOrder(nextOrder);
        toast({ title: '✅ Ordem das colunas salva!' });
      } catch (err: any) {
        setColumnOrder(previousOrder);
        toast({ title: 'Erro ao salvar ordem', description: err.message, variant: 'destructive' });
      }
      return;
    }

    if (destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId;
    // Atualiza localmente de imediato (optimistic)
    setLeads(prev => prev.map(l => l.id === draggableId ? { ...l, status_crm: newStatus } : l));
    try {
      if (isMarcosCrm) {
        const { error } = await (supabase as any)
          .from('crm_leads')
          .update({ stage_id: newStatus })
          .eq('id', draggableId);
        if (error) throw error;
        toast({ title: `✅ Lead movido para ${manualStages.find(c => c.id === newStatus)?.title || newStatus}` });
        if (isWinStatus(newStatus)) openVendaDialogFor(draggableId);
        return;
      }
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status_crm: newStatus })
        .eq('id', draggableId);
      if (error) throw error;
      toast({ title: `✅ Lead movido para ${(isMarcosCrm ? manualStages : (pedroStages.length ? pedroStages : PIPELINE_COLUMNS)).find(c => c.id === newStatus)?.title || newStatus}` });
      if (isWinStatus(newStatus)) openVendaDialogFor(draggableId);
    } catch (err: any) {
      toast({ title: 'Erro ao mover lead', description: err.message, variant: 'destructive' });
      await fetchData(true); // Revert on failure
    }
  };

  // BUG-NOVO-04: carregar pending transfers pra mostrar "Aguardando confirmacao"
  // baseado em ai_lead_transfers em vez de so assigned_to_id. Esse hook so faz
  // SELECT (sem render extra), entao impacto perf e minimo.
  const leadIds = useMemo(() => leads.map(l => l.id), [leads]);
  const pendingTransfers = usePendingTransfers(leadIds);

  /**
   * Resolve o que mostrar como vendedor no card do lead.
   * Prioridade:
   *   1. member.name (assigned_to_id setado = vendedor confirmou)
   *   2. pending transfer (manual recente, vendedor ainda nao respondeu Ok)
   *   3. status='transferido' = aguardando (legacy)
   *   4. Sem vendedor
   */
  const sellerLabelForLead = (lead?: CrmLead | null) => {
    if (!lead) return 'Sem vendedor';
    if (lead.member?.name) return lead.member.name;
    const pending = pendingTransfers.get(lead.id);
    if (pending) return `${pending.member_name} (aguardando)`;
    return lead.status === 'transferido' ? 'Aguardando' : 'Sem vendedor';
  };

  /**
   * Retorna info pra renderizar badge de status do vendedor.
   * - confirmed: assigned_to_id setado (verde, "Em atendimento")
   * - pending: transfer recente sem Ok (amarelo, "Aguardando confirmacao")
   * - none: sem vendedor
   */
  const sellerStatusForLead = (lead?: CrmLead | null): {
    status: 'confirmed' | 'pending' | 'none';
    member_name: string | null;
    pending_since: string | null;
  } => {
    if (!lead) return { status: 'none', member_name: null, pending_since: null };
    if (lead.member?.name) return { status: 'confirmed', member_name: lead.member.name, pending_since: null };
    const pending = pendingTransfers.get(lead.id);
    if (pending) {
      return {
        status: 'pending',
        member_name: pending.member_name,
        pending_since: pending.created_at,
      };
    }
    return { status: 'none', member_name: null, pending_since: null };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  // ── Lead Detail Panel ──────────────────────────────────────────────────────
  const basePipelineColumns: PipelineColumn[] = isMarcosCrm
    ? (manualStages.length > 0 ? manualStages : PIPELINE_COLUMNS)
    : (pedroStages.length > 0 ? pedroStages : PIPELINE_COLUMNS);
  const pipelineColumns = applyColumnOrder(basePipelineColumns, columnOrder);
  const statusOptions = isMarcosCrm
    ? pipelineColumns.map(c => ({ value: c.id, label: c.title, color: 'text-blue-400' }))
    : STATUS_CRM_OPTIONS;
  const canManageLeadStatus = !isMarcosCrm || !isSeller;
  const canReassignLeadSeller = !isSeller && teamMembers.length > 0;

  if (selectedLead) {
    return (
      <div className="p-4 lg:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedLead(null)} className="h-8 px-2 gap-1 text-xs text-muted-foreground">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Voltar
          </Button>
          <div className="flex-1 min-w-0">
            {editingLead ? (
              <div className="flex flex-col gap-1.5">
                {/* Fase 6 Feature D: agora 4 inputs (nome + tel + cidade + carro). flex-wrap pra quebrar bem em mobile */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    placeholder="Nome do lead"
                    className="h-8 text-sm font-semibold max-w-[200px]"
                    autoFocus
                  />
                  <Input
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="5511999999999"
                    className="h-8 text-sm max-w-[160px]"
                  />
                  {/* Feature M4: edit inline cidade+carro agora vale pros 2 CRMs */}
                  <Input
                    value={editCity}
                    onChange={e => setEditCity(e.target.value)}
                    placeholder="📍 Cidade"
                    className="h-8 text-sm max-w-[160px]"
                  />
                  <Input
                    value={editVehicle}
                    onChange={e => setEditVehicle(e.target.value)}
                    placeholder="🚗 Carro de interesse"
                    className="h-8 text-sm max-w-[200px]"
                  />
                  {/* Item 2: datetime-local pra agendar visita — com legenda */}
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground font-medium leading-none">📅 Agendamento (visita)</label>
                    <Input
                      type="datetime-local"
                      value={editVisitAt}
                      onChange={e => setEditVisitAt(e.target.value)}
                      title="Data e hora da visita agendada do cliente"
                      className="h-8 text-sm max-w-[200px]"
                    />
                  </div>
                  {/* Data real que o lead chegou (corrige lead de porta/dia passado) — com legenda */}
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground font-medium leading-none">📆 Chegou (data do lead)</label>
                    <Input
                      type="date"
                      value={editArrived}
                      onChange={e => setEditArrived(e.target.value)}
                      title="Data que o lead realmente chegou (ex: porta no domingo). Vazio = data de cadastro."
                      className="h-8 text-sm max-w-[160px]"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleSaveLeadEdit} disabled={editSaving} className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                    {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingLead(false)} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{sellerLabelForLead(selectedLead)} · {fmtDate(selectedLead.created_at)}</p>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground truncate">{selectedLead.lead_name || selectedLead.remote_jid}</h2>
                  <p className="text-xs text-muted-foreground">
                    {(() => { const p = selectedLead.remote_jid?.split('@')[0]?.replace(/\D/g, '') || ''; return p.length >= 12 ? `📱 (${p.slice(2,4)}) ${p.slice(4,9)}-${p.slice(9)}` : p.length >= 10 ? `📱 (${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}` : p ? `📱 ${p}` : ''; })()}
                    {selectedLead.remote_jid && ' · '}{sellerLabelForLead(selectedLead)} · {fmtDate(selectedLead.created_at)}
                  </p>
                  {/* Prompt 1.1: linha discreta de origem (badge bonita virá no Prompt 5.1) */}
                  {(selectedLead as any).origem && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Origem: {leadOrigemLabel((selectedLead as any).origem)}
                      {(selectedLead as any).origem === 'outros' && (selectedLead as any).origem_outros
                        ? ` (${(selectedLead as any).origem_outros})` : ''}
                    </p>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={startEditLead} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0 mt-0.5" title="Editar lead">
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canManageLeadStatus ? (
              <>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">Status:</span>
                <Select
                  value={selectedLead.status_crm || 'novo'}
                  onValueChange={updateLeadStatus}
                  disabled={statusUpdating}
                >
                  <SelectTrigger className="h-8 text-xs w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        <span className={opt.color}>{opt.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <Badge variant="outline" className="h-8 px-3 text-[10px] capitalize">
                {statusOptions.find(opt => opt.value === selectedLead.status_crm)?.label || selectedLead.status_crm || 'Novo'}
              </Badge>
            )}
            {/* Data real que o lead chegou — visivel direto no detalhe (porta/dia passado). */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground hidden sm:inline">Chegou:</span>
              <input
                type="date"
                value={String((selectedLead as any).arrived_at || selectedLead.created_at || '').slice(0, 10)}
                onChange={e => updateLeadArrived(e.target.value)}
                className="h-8 text-xs rounded-md border border-input bg-background px-2 [&::-webkit-calendar-picker-indicator]:invert"
                title="Data que o lead realmente chegou (ex: porta no domingo). Muda em que dia ele aparece no painel."
              />
            </div>
            {canReassignLeadSeller && (
              <Select
                value={selectedLead.assigned_to_id || 'unassigned'}
                onValueChange={v => reassignLead(selectedLead.id, v === 'unassigned' ? null : v)}
                disabled={reassigning === selectedLead.id}
              >
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="Atribuir vendedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned" className="text-xs text-muted-foreground">Sem vendedor</SelectItem>
                  {teamMembers.filter(m => m.active_in_system !== false).map(m => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteLead(selectedLead.id)}
              disabled={deletingLead}
              className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              title="Excluir lead"
            >
              {deletingLead ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* ── Feedback da IA ──────────────────────────────────────────────
            Mostra o que o Pedro escreveu sobre esse lead. Prioridade:
            1) Transferências com notes rico (não começa com "via cron")
            2) ai_crm_leads.summary (resumo da IA durante qualificação)
            3) Fallback "via cron" — texto curto antigo.
            Renderiza pra ambos Pedro e Marcos — se Marcos não tem dados de IA,
            o IIFE retorna null e a card não aparece (sem visual quebrado). */}
        {(() => {
          // Identifica transferências com texto rico (mais que 1 linha ou >100 chars)
          const richTransfers = transfers.filter(t =>
            t.notes && (t.notes.length > 100 || t.notes.includes('\n'))
          );
          const cronTransfers = transfers.filter(t =>
            t.notes && !(t.notes.length > 100 || t.notes.includes('\n'))
          );
          const summary = selectedLead.summary;
          const hasAnything = richTransfers.length > 0 || summary || cronTransfers.length > 0;
          if (!hasAnything) return null;

          return (
            <Card className="bg-gradient-to-br from-blue-500/5 to-violet-500/5 border-blue-500/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Bot className="h-4 w-4 text-blue-400" />
                  Feedback da IA
                  <Badge className="text-[9px] h-4 px-1.5 bg-blue-500/15 text-blue-300 border-blue-500/30">
                    Funil do Agente
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 1) Transferências com texto rico (briefing completo da IA) */}
                {richTransfers.map(t => (
                  <div key={t.id} className="rounded-lg bg-card/60 border border-blue-500/20 p-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2 text-[10px]">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Repassado para:</span>
                        <span className="text-blue-300 font-semibold">
                          {t.to_member?.name || 'Vendedor'}
                        </span>
                      </div>
                      <span className="text-muted-foreground">{fmtDate(t.created_at)}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                      {t.notes}
                    </p>
                  </div>
                ))}

                {/* 2) Summary do lead (se não houver transfer rico mas existir summary) */}
                {richTransfers.length === 0 && summary && (
                  <div className="rounded-lg bg-card/60 border border-blue-500/15 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                      📋 Resumo da IA
                    </p>
                    <p className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
                      {summary}
                    </p>
                  </div>
                )}

                {/* 3) Transferências antigas com texto curto — só se NÃO houver nada melhor */}
                {richTransfers.length === 0 && !summary && cronTransfers.map(t => {
                  const reasonLabel =
                    t.transfer_reason === 'round_robin' ? 'Rodízio automático' :
                    t.transfer_reason === 'manual'      ? 'Repasse manual'    :
                    t.transfer_reason || '—';
                  return (
                    <div key={t.id} className="rounded-lg bg-muted/30 border border-border/30 p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between flex-wrap gap-2 text-[10px]">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Repassado para:</span>
                          <span className="text-foreground font-semibold">
                            {t.to_member?.name || 'Vendedor'}
                          </span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">{reasonLabel}</span>
                        </div>
                        <span className="text-muted-foreground">{fmtDate(t.created_at)}</span>
                      </div>
                      <p className="text-muted-foreground italic">{t.notes}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })()}

        {/* Marcos Consignado (27/05/2026) — formulário inline com 6 campos do veículo
            do cliente. Aparece SÓ no Marcos E quando lead está na stage "Consignado". */}
        {isMarcosCrm && (() => {
          const consignadoStageId = manualStages.find(s => s.title === 'Consignado')?.id;
          if (!consignadoStageId || selectedLead.status_crm !== consignadoStageId) return null;
          return (
            <ConsignadoVehicleForm
              leadId={selectedLead.id}
              initialData={{
                consignado_modelo: selectedLead.consignado_modelo ?? null,
                consignado_ano: selectedLead.consignado_ano ?? null,
                consignado_versao: selectedLead.consignado_versao ?? null,
                consignado_km: selectedLead.consignado_km ?? null,
                consignado_cor: selectedLead.consignado_cor ?? null,
                consignado_estado: selectedLead.consignado_estado ?? null,
              }}
              onUpdated={(data) => {
                // Atualiza state local pra badge no kanban refletir sem reload
                setSelectedLead(prev => prev ? { ...prev, ...data } : prev);
                setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, ...data } : l));
              }}
            />
          );
        })()}

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
                  <div key={n.id} className={`rounded-lg p-3 space-y-1 ${n.is_pinned ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-muted/40'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-foreground leading-relaxed flex-1">{n.content}</p>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => toggleNotePin(n.id, n.is_pinned)}
                          className={`h-6 w-6 p-0 ${n.is_pinned ? 'text-yellow-400 hover:text-yellow-300' : 'text-muted-foreground hover:text-foreground'}`}
                          title={n.is_pinned ? 'Desafixar nota' : 'Fixar nota'}
                        >
                          {n.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => sendNoteToManager(n)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-blue-400"
                          title="Enviar ao gerente"
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => handleDeleteNote(n.id)}
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                          title="Apagar anotação"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {n.is_pinned && <Pin className="h-2.5 w-2.5 text-yellow-400" />}
                      <p className="text-[10px] text-muted-foreground">{n.member?.name ?? 'Vendedor'} · {fmtDate(n.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Follow-up ─────────────────────────────────────────────── */}
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-cyan-400" /> Agendar Follow-up
                </span>
                {!isMarcosCrm && (
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setFunnelOpen(!funnelOpen)}
                    className="h-7 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Zap className="h-3 w-3" />
                    {funnelOpen ? 'Fechar Funil' : 'Funil Automático'}
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Funil automático */}
              {!isMarcosCrm && funnelOpen && selectedLead && (
                <FollowupFunnelBuilder
                  leadId={selectedLead.id}
                  userId={userId!}
                  memberId={memberId}
                  instanceId={fuInstance}
                  onClose={() => setFunnelOpen(false)}
                  onSaved={() => loadLeadDetail(selectedLead)}
                />
              )}

              <Textarea
                value={fuMsg}
                onChange={e => setFuMsg(e.target.value)}
                placeholder={isMarcosCrm ? 'Mensagem que o robo de follow-up enviara ao lead...' : 'Mensagem a enviar ao lead...'}
                className="min-h-[60px] text-xs resize-none"
              />

              {/* Upload de mídia */}
              <div className="flex items-center gap-1.5">
                <input
                  ref={fuFileRef}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  className="hidden"
                  onChange={handleMediaUpload}
                />
                <Button
                  variant="outline" size="sm"
                  onClick={() => { if (fuFileRef.current) { fuFileRef.current.accept = 'image/*'; fuFileRef.current.click(); } }}
                  className="h-7 text-[10px] gap-1 flex-1"
                  disabled={fuUploading}
                >
                  <Image className="h-3 w-3" /> Imagem
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { if (fuFileRef.current) { fuFileRef.current.accept = 'audio/*'; fuFileRef.current.click(); } }}
                  className="h-7 text-[10px] gap-1 flex-1"
                  disabled={fuUploading}
                >
                  <Mic className="h-3 w-3" /> Áudio
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { if (fuFileRef.current) { fuFileRef.current.accept = 'video/*'; fuFileRef.current.click(); } }}
                  className="h-7 text-[10px] gap-1 flex-1"
                  disabled={fuUploading}
                >
                  <Video className="h-3 w-3" /> Vídeo
                </Button>
              </div>

              {/* Preview da mídia selecionada */}
              {fuUploading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Enviando arquivo...
                </div>
              )}
              {fuMediaFile && !fuUploading && (
                <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
                  {fuMediaFile.type.startsWith('image/') && <Image className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {fuMediaFile.type.startsWith('audio/') && <Mic className="h-3.5 w-3.5 text-primary shrink-0" />}
                  {fuMediaFile.type.startsWith('video/') && <Video className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span className="text-[10px] text-foreground truncate flex-1">{fuMediaFile.name}</span>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { setFuMediaFile(null); setFuMediaUrl(''); }}
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  type="datetime-local"
                  value={fuDate}
                  onChange={e => setFuDate(e.target.value)}
                  className="text-xs h-8 flex-1 [&::-webkit-calendar-picker-indicator]:brightness-0 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:sepia [&::-webkit-calendar-picker-indicator]:saturate-[10] [&::-webkit-calendar-picker-indicator]:hue-rotate-[10deg]"
                />
                {instances.length > 0 && (
                  <Select value={fuInstance} onValueChange={setFuInstance}>
                    <SelectTrigger className="h-8 text-xs w-44">
                      <SelectValue placeholder="Instância" />
                    </SelectTrigger>
                    <SelectContent>
                      {instances.map(i => {
                        const phone = i.phone_number?.replace(/\D/g, '') || '';
                        const label = phone
                          ? `📱 ${phone.length > 8 ? `(${phone.slice(-11,-9)}) ${phone.slice(-9,-5)}-${phone.slice(-5)}` : phone}`
                          : i.friendly_name || i.instance_name;
                        return <SelectItem key={i.id} value={i.id} className="text-xs">{label}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {isMarcosCrm && instances.length === 0 && (
                <p className="text-[10px] text-amber-300">
                  Conecte uma instancia na aba Instancias do Marcos para enviar follow-ups.
                </p>
              )}
              <Button
                onClick={handleScheduleFollowup}
                disabled={fuLoading || fuUploading || !fuMsg.trim() || !fuDate || !!(fuMediaFile && !fuMediaUrl) || (isMarcosCrm && !fuInstance)}
                size="sm" className="w-full h-8 text-xs"
              >
                {fuLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CalendarClock className="h-3.5 w-3.5 mr-1.5" />}
                Agendar Follow-up{fuMediaFile ? ' (com mídia)' : ''}
              </Button>

              {/* Lista de agendamentos */}
              {schedules.filter(s => s.status === 'pending').length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Agendados</p>
                  {schedules.filter(s => s.status === 'pending').map(s => (
                    <div key={s.id} className="flex items-start gap-2 bg-muted/40 rounded-lg px-3 py-2 group">
                      <Clock className="h-3 w-3 text-cyan-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-cyan-400 font-medium">{fmtDate(s.scheduled_at)}</p>
                        <p className="text-[10px] text-muted-foreground line-clamp-1">{s.message_template}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive opacity-60 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleCancelFollowup(s.id)}
                        disabled={cancellingFollowupId === s.id}
                        title="Cancelar follow-up agendado (não será enviado)"
                      >
                        {cancellingFollowupId === s.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Feedback Estruturado para Gerente ────────────────────────
            Renderiza pra Pedro E Marcos. handleSendFeedback + loadLeadFeedbackHistory
            já tratam o XOR lead_id/crm_lead_id internamente. */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <BellRing className="h-4 w-4 text-orange-400" /> Feedback para Gerente
              </CardTitle>
              <Button
                variant="ghost" size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground hover:text-orange-400"
                onClick={() => selectedLead && loadLeadFeedbackHistory(selectedLead.id)}
              >
                <Clock className="h-3 w-3 mr-1" /> Historico
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Pergunta 1: Cidade — Fase 6.4 dinâmico (cadastrar nova pelo modal) */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">1. Cliente veio de qual cidade?</p>
              <DynamicSelect
                entity="city"
                userId={effectiveUserIdState || userId}
                value={null /* fbCity é por nome, não id — usamos onChange pra setar */}
                onChange={(_id, row) => {
                  setFbCity(row?.name || '');
                }}
                placeholder="Selecione a cidade..."
                triggerClassName="h-8 text-xs"
                filter={(r) => r.status === 'active'}
              />
              {fbCity && (
                <p className="text-[10px] text-muted-foreground">
                  Selecionada: <span className="font-medium text-foreground">{fbCity}</span>
                </p>
              )}
            </div>

            {/* Pergunta 2: Motivo (agrupado por categorias) */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">2. Por qual motivo o cliente nao comprou?</p>
              <div className="space-y-1">
                {FEEDBACK_REASONS.map(group => (
                  <div key={group.category} className="border border-border/50 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors"
                      onClick={() => setFbReasonOpen(prev => prev === group.category ? null : group.category)}
                    >
                      <span>{group.emoji} {group.category}</span>
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${fbReasonOpen === group.category ? 'rotate-90' : ''}`} />
                    </button>
                    {fbReasonOpen === group.category && (
                      <div className="px-2 pb-2 space-y-0.5">
                        {group.options.map(opt => (
                          <button
                            key={opt}
                            type="button"
                            className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                              fbReason === opt
                                ? 'bg-orange-500/20 text-orange-300 font-medium'
                                : 'hover:bg-muted/50 text-muted-foreground'
                            }`}
                            onClick={() => setFbReason(opt)}
                          >
                            {fbReason === opt && <Check className="h-3 w-3 inline mr-1.5" />}
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {fbReason && (
                <div className="flex items-center gap-2 px-2 py-1 bg-orange-500/10 rounded-md">
                  <CheckCircle className="h-3 w-3 text-orange-400 shrink-0" />
                  <span className="text-[10px] text-orange-300">{fbReason}</span>
                  <button type="button" onClick={() => setFbReason('')} className="ml-auto">
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              )}
            </div>

            {/* Observacoes adicionais (opcional) */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">3. Observacoes adicionais <span className="text-muted-foreground/60">(opcional)</span></p>
              <Textarea
                value={fbObservations}
                onChange={e => setFbObservations(e.target.value)}
                placeholder="Informacoes extras que o gerente precisa saber..."
                className="min-h-[60px] text-xs resize-none"
              />
            </div>

            {/* Qualificação + Enviar */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  🎯 Qualificação do lead
                </span>
                <span className="text-[10px] text-muted-foreground/70 italic">
                  (passe o mouse em cada opção pra ver o que significa)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Select value={fbPriority} onValueChange={v => setFbPriority(v as any)}>
                  <SelectTrigger className="h-9 text-xs w-56" title="Como o lead se comportou no atendimento">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_CONFIG) as [string, typeof PRIORITY_CONFIG[keyof typeof PRIORITY_CONFIG]][]).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs" title={v.tip}>
                        <div className="flex flex-col gap-0.5">
                          <span className={v.color}>{v.label}</span>
                          <span className="text-[10px] text-muted-foreground/70">{v.desc}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleSendFeedback}
                  disabled={fbLoading || !fbCity || !fbReason}
                  size="sm" className="h-9 text-xs flex-1"
                >
                  {fbLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Enviar Feedback
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Popup Historico de Feedbacks do Lead ──────────────────────── */}

        <Dialog open={fbHistoryOpen} onOpenChange={setFbHistoryOpen}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <BellRing className="h-4 w-4 text-orange-400" />
                Historico de Feedbacks — {selectedLead?.lead_name}
              </DialogTitle>
            </DialogHeader>
            {fbHistoryLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : leadFeedbacks.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">Nenhum feedback enviado para este lead.</p>
            ) : (
              <div className="space-y-3">
                {leadFeedbacks.map(fb => {
                  const pCfg = priorityCfg(fb.priority);
                  return (
                    <div key={fb.id} className="border border-border/50 rounded-lg px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pCfg.bg} ${pCfg.color}`}>{pCfg.label}</span>
                        <span className="text-[10px] text-muted-foreground">{fb.member?.name ?? 'Vendedor'} · {fmtDate(fb.created_at)}</span>
                      </div>
                      {fb.city && <p className="text-xs"><span className="text-muted-foreground">Cidade:</span> {fb.city}</p>}
                      {fb.reason && <p className="text-xs"><span className="text-muted-foreground">Motivo:</span> {fb.reason}</p>}
                      {fb.observations && <p className="text-xs"><span className="text-muted-foreground">Obs:</span> {fb.observations}</p>}
                      {!fb.city && !fb.reason && <p className="text-xs text-foreground">{fb.content}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Main Panel ─────────────────────────────────────────────────────────────
  const unreadFeedbacks = feedbacks.filter(f => !f.read_at);

  // Métricas
  // Filtro universal
  const leadDateBounds = leadDateRange(dateFilter, dateFrom, dateTo);
  const filteredLeads = leads.filter(l => {
    if (isSeller && memberIds.length > 0 && !memberIds.includes(l.assigned_to_id)) return false;
    if (filterStatus !== 'all' && (l.status_crm || 'novo') !== filterStatus) return false;
    if (filterSeller === 'unassigned' && l.assigned_to_id) return false;
    if (filterSeller !== 'all' && filterSeller !== 'unassigned' && l.assigned_to_id !== filterSeller) return false;
    if (leadDateBounds) {
      if (!l.created_at) return false;
      const ts = new Date(l.created_at).getTime();
      if (ts < leadDateBounds[0] || ts > leadDateBounds[1]) return false;
    }
    if (searchTerm) {
      const t = searchTerm.toLowerCase().trim();
      // Busca por telefone ignora +, espaços e traço — o banco guarda só dígitos
      // (ex.: "5512997812133@s.whatsapp.net"). Assim "+55 12 99781-2133",
      // "99781-2133" ou "997812133" encontram o mesmo lead.
      const tDigits = t.replace(/\D/g, '');
      const jid = (l.remote_jid || '').toLowerCase();
      const phoneMatch = tDigits.length >= 4 && jid.replace(/\D/g, '').includes(tDigits);
      if (!(l.lead_name || '').toLowerCase().includes(t) && !jid.includes(t) && !phoneMatch) return false;
    }
    return true;
  });

  // ── Diagnóstico: leads SEM vendedor (sem transferência) ───────────────────────
  // Espinha do painel: derivada dos leads já carregados (funciona desde já).
  // Enriquecida com o motivo vindo de pedro_transfer_failures quando existir.
  const isLeadSemVendedor = (l: CrmLead): boolean =>
    sellerStatusForLead(l).status === 'none' && l.status !== 'transferido';
  const semVendedorTotal = leads.filter(isLeadSemVendedor).length;

  // ── "Aguardando o vendedor" (o que o CRM mostra) ───────────────────────────
  // O painel acima (isLeadSemVendedor) EXCLUI de proposito os leads transferido/
  // pendentes — por isso "nao batia" com o CRM. Aqui surfacemos exatamente o que
  // o gerente ve como "Aguardando" pra reconciliar as duas telas:
  //   • orfaos: status='transferido' sem vendedor de verdade e sem transfer pendente
  //             (a transferencia expirou e ninguem reprocessou) -> PRESO
  //   • pendentes: transfer 'pending' aguardando o vendedor responder "Ok"
  const transferidoOrfaoLeads = leads.filter(
    l => l.status === 'transferido' && sellerStatusForLead(l).status === 'none'
  );
  const aguardandoPendingLeads = leads.filter(
    l => sellerStatusForLead(l).status === 'pending'
  );
  const aguardandoPendingVencidos = aguardandoPendingLeads.filter(l => {
    const p = pendingTransfers.get(l.id);
    return !!p?.confirmation_timeout_at && new Date(p.confirmation_timeout_at).getTime() < Date.now();
  }).length;
  const aguardandoTotal = transferidoOrfaoLeads.length + aguardandoPendingLeads.length;
  const failureByLeadId = new Map<string, TransferFailure>();
  for (const f of transferFailures) {
    if (f.lead_id && !failureByLeadId.has(f.lead_id)) failureByLeadId.set(f.lead_id, f);
  }
  const diagAgents = Array.from(
    new Map(leads.filter(l => l.agent && (l as any).agent_id).map(l => [(l as any).agent_id as string, l.agent!.name])).entries()
  );
  const diagLeads = leads.filter(l => {
    if (!isLeadSemVendedor(l)) return false;
    if (leadDateBounds) {
      if (!l.created_at) return false;
      const ts = new Date(l.created_at).getTime();
      if (ts < leadDateBounds[0] || ts > leadDateBounds[1]) return false;
    }
    if (searchTerm) {
      const t = searchTerm.toLowerCase().trim();
      // Busca por telefone ignora +, espaços e traço — o banco guarda só dígitos
      // (ex.: "5512997812133@s.whatsapp.net"). Assim "+55 12 99781-2133",
      // "99781-2133" ou "997812133" encontram o mesmo lead.
      const tDigits = t.replace(/\D/g, '');
      const jid = (l.remote_jid || '').toLowerCase();
      const phoneMatch = tDigits.length >= 4 && jid.replace(/\D/g, '').includes(tDigits);
      if (!(l.lead_name || '').toLowerCase().includes(t) && !jid.includes(t) && !phoneMatch) return false;
    }
    if (diagClass !== 'all' && (l.status_crm || 'novo') !== diagClass) return false;
    if (diagAgent !== 'all' && (l as any).agent_id !== diagAgent) return false;
    return true;
  });
  const diagReasonOf = (l: CrmLead): string | null => failureByLeadId.get(l.id)?.reason_code ?? null;
  const diagChartData = [
    ...TRANSFER_FAILURE_REASONS.map(r => ({
      name: r.short, fill: r.hex,
      count: diagLeads.filter(l => diagReasonOf(l) === r.value).length,
    })).filter(d => d.count > 0),
    ...(() => {
      const n = diagLeads.filter(l => !diagReasonOf(l)).length;
      return n > 0 ? [{ name: 'Não registrado', fill: '#64748b', count: n }] : [];
    })(),
  ];
  const diagLeadsFiltered = diagReason === 'all'
    ? diagLeads
    : diagReason === 'nao_registrado'
      ? diagLeads.filter(l => !diagReasonOf(l))
      : diagLeads.filter(l => diagReasonOf(l) === diagReason);

  // ── TAREFA 2 (29/05/2026): cards do topo refletem o vendedor selecionado ──────
  // Aplica-se SOMENTE ao painel do Marcos (isMarcosCrm). No Pedro o comportamento
  // fica intacto (cards sempre = total geral do banco). Regra:
  //   • filterSeller === 'all'  -> usa leadMetrics (count queries do banco, exatas)
  //   • vendedor específico      -> conta a partir dos leads carregados (assigned_to_id)
  //   • 'unassigned'             -> leads sem vendedor
  // Faixas de data IDÊNTICAS às queries: hoje=meia-noite, semana=segunda (ISO),
  // mês=dia 1. Não há escrita no banco; é só recontagem em memória.
  const displayMetrics = (() => {
    if (!isMarcosCrm || filterSeller === 'all') return leadMetrics;
    const dToday = new Date(); dToday.setHours(0, 0, 0, 0);
    const dWeek = new Date(dToday); dWeek.setDate(dWeek.getDate() - ((dWeek.getDay() + 6) % 7));
    const dMonth = new Date(dToday.getFullYear(), dToday.getMonth(), 1);
    const sellerLeads = leads.filter(l =>
      filterSeller === 'unassigned' ? !l.assigned_to_id : l.assigned_to_id === filterSeller
    );
    const since = (from: Date) => sellerLeads.filter(l => l.created_at && new Date(l.created_at) >= from).length;
    return { total: sellerLeads.length, today: since(dToday), week: since(dWeek), month: since(dMonth) };
  })();

  // Fase 6 Feature C: cálculo de inativo + handlers de seleção/disparo
  const INATIVO_DIAS = 7;
  const inativoCutoffMs = Date.now() - INATIVO_DIAS * 24 * 60 * 60 * 1000;
  const isLeadInativo = (l: CrmLead): boolean => {
    const lastReply = l.last_user_reply_at ? new Date(l.last_user_reply_at).getTime() : 0;
    const created = new Date(l.created_at).getTime();
    const ref = lastReply || created;
    return ref < inativoCutoffMs
      && l.status_crm !== 'qualificado'
      && l.status_crm !== 'transferido';
  };
  const inativosCount = leads.filter(isLeadInativo).length;
  const enterSelectionMode = () => {
    const pre = new Set(leads.filter(isLeadInativo).map(l => l.id));
    setSelectedLeadIds(pre);
    setSelectionMode(true);
    toast({
      title: '📋 Modo seleção ativo',
      description: `${pre.size} inativo(s) pré-marcado(s). Marque/desmarque qualquer card.`,
    });
  };
  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedLeadIds(new Set());
  };
  const toggleLeadSelection = (leadId: string) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  };
  const selectAllVisible = () => {
    setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
  };
  const selectNone = () => setSelectedLeadIds(new Set());
  const handleDispararCampanha = () => {
    const selected = leads.filter(l => selectedLeadIds.has(l.id));
    if (selected.length === 0) {
      toast({ title: 'Nenhum lead selecionado', variant: 'destructive' });
      return;
    }
    // Unificado 01/06/2026: Pedro E Marcos mandam o MESMO payload RICO
    // (id, name, phone, origem) pra tela de disparo CRIAR/SALVAR a lista.
    // Antes o Pedro so passava telefones (banner copy/paste) e nao deixava
    // criar lista — agora segue o mesmo caminho do Marcos.
    const agent: 'pedro' | 'marcos' = isMarcosCrm ? 'marcos' : 'pedro';
    const agentName = isMarcosCrm ? 'Marcos' : 'Pedro';
    const contacts = selected
      .map(l => {
        const phone = (l.remote_jid || '').replace(/@.*/, '').replace(/\D/g, '');
        if (!phone) return null;
        // Origem: Marcos usa crm_leads.source; Pedro usa crm_leads.origem.
        const origemLabel = isMarcosCrm
          ? (MARCOS_ORIGEM_OPTIONS.find(o => o.value === (l.source || '').toString())?.label || (l.source || '').toString() || 'manual')
          : (leadOrigemLabel((l as any).origem) || 'manual');
        return {
          id: l.id,
          name: l.lead_name || phone,
          phone,
          origem: origemLabel,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; phone: string; origem: string }>;
    if (contacts.length === 0) {
      toast({ title: 'Nenhum telefone valido nos leads selecionados', variant: 'destructive' });
      return;
    }
    try {
      sessionStorage.setItem('marcos_campaign_contacts', JSON.stringify({
        contacts,
        agent,
        label: `CRM ${agentName} — ${contacts.length} lead(s) selecionado(s)`,
        source: `${agent}_selecionados`,
        created_at: new Date().toISOString(),
      }));
      sessionStorage.removeItem('pedro_campaign_phones'); // limpa banner legado
    } catch {
      // sessionStorage pode falhar em modo privacy — ignora, segue redirect
    }
    toast({
      title: `📢 ${contacts.length} contato(s) pre-carregado(s) do ${agentName}`,
      description: 'Indo pro disparo em massa...',
    });
    setTimeout(() => { window.location.href = '/whatsapp/broadcast'; }, 600);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* ── Métricas ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',  value: displayMetrics.total,  icon: Users,       color: 'text-blue-400' },
          { label: 'Hoje',         value: displayMetrics.today,  icon: Clock,       color: 'text-emerald-400' },
          { label: 'Na Semana',    value: displayMetrics.week,   icon: TrendingUp,  color: 'text-cyan-400' },
          { label: 'No Mês',       value: displayMetrics.month,  icon: BarChart3,   color: 'text-purple-400' },
        ].map(m => (
          <div key={m.label} className="bg-card border border-border/50 rounded-xl px-4 py-3 flex items-center gap-3">
            <m.icon className={`h-5 w-5 ${m.color} shrink-0`} />
            <div>
              <p className="text-xl font-bold text-foreground leading-none">{m.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Sub-nav + busca + refresh ────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-muted/40 rounded-lg p-1">
          {[
            { id: 'pipeline',  label: 'Pipeline',   icon: ArrowRightLeft, badge: 0 },
            // TAREFA 1 (29/05/2026): no painel do Marcos (isMarcosCrm) o CRM mostra
            // SOMENTE o Pipeline. As views Lista, Feedbacks e Vendedores continuam
            // existindo e ativas no painel do Pedro (mode='pedro') — só ficam ocultas
            // aqui. Nada de dado removido; apenas os botoes de navegacao sao filtrados.
            ...(!isMarcosCrm ? [
              { id: 'leads',     label: 'Lista',      icon: Users,          badge: 0 },
            ] : []),
            // Feedbacks: master E vendedor (o vendedor vê só os DELE, pra bater com o master).
            ...(!isMarcosCrm ? [
              { id: 'feedbacks', label: 'Feedbacks',  icon: BellRing,       badge: unreadFeedbacks.length },
            ] : []),
            // Diagnóstico e Vendedores: ferramentas do gerente — só master.
            ...(!isSeller && !isMarcosCrm ? [
              { id: 'diagnostico', label: 'Diagnóstico', icon: AlertTriangle, badge: semVendedorTotal },
              { id: 'sellers', label: 'Vendedores', icon: Users,      badge: 0 },
            ] : []),
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
        <div className="flex items-center gap-1.5">
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="🔍 Buscar..."
            className="h-7 text-xs w-40"
          />
          {/* Filtro de data — vendedor E master, pipeline e lista de leads */}
          {(view === 'pipeline' || view === 'leads') && (
            <>
              <Select value={dateFilter} onValueChange={v => setDateFilter(v as LeadDatePreset)}>
                <SelectTrigger className="h-7 text-xs w-36" title="Filtra os leads por quando chegaram">
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="Período" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {LEAD_DATE_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dateFilter === 'custom' && (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="h-7 text-xs rounded-md border border-input bg-background px-2"
                    title="Data inicial"
                  />
                  <span className="text-xs text-muted-foreground">até</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="h-7 text-xs rounded-md border border-input bg-background px-2"
                    title="Data final"
                  />
                </div>
              )}
            </>
          )}
          {!isSeller && teamMembers.length > 0 && (view === 'pipeline' || view === 'leads') && (
            <Select value={filterSeller} onValueChange={setFilterSeller}>
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="Vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                <SelectItem value="unassigned" className="text-xs text-muted-foreground">Sem vendedor</SelectItem>
                {teamMembers.filter(m => m.active_in_system !== false).map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Fase 6 Feature C + M3: modo seleção pro disparo em massa (Pedro E Marcos) */}
          {(view === 'pipeline' || view === 'leads') && (
            <>
              {!selectionMode ? (
                <Button
                  variant="outline" size="sm"
                  onClick={enterSelectionMode}
                  className="h-7 px-2.5 text-xs gap-1.5 border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                  title={`Entra em modo seleção — pré-marca leads sem resposta há ${INATIVO_DIAS}+ dias`}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Selecionar p/ disparo
                  {inativosCount > 0 && (
                    <span className="ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-orange-500 text-white">{inativosCount}</span>
                  )}
                </Button>
              ) : (
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-orange-500/10 border border-orange-500/30">
                  <span className="text-[10px] text-orange-300 font-medium">Selec:</span>
                  <span className="text-xs font-bold text-orange-300">{selectedLeadIds.size}</span>
                  <button onClick={selectAllVisible} className="text-[10px] text-orange-400 hover:text-orange-300 underline ml-1" title="Marca todos visíveis">Todos</button>
                  <button onClick={selectNone} className="text-[10px] text-orange-400 hover:text-orange-300 underline ml-1" title="Desmarca todos">Nenhum</button>
                  <button onClick={exitSelectionMode} className="text-orange-400 hover:text-orange-300 ml-1" title="Sair"><X className="h-3 w-3" /></button>
                </div>
              )}
              {/* Botao Disparar: master E seller podem em AMBOS os CRMs
                  (Pedro e Marcos). Atualizado 01/06/2026 — antes o seller
                  nao tinha o botao no Pedro; agora segue o mesmo caminho do
                  Marcos (seleciona leads -> cria/salva lista -> dispara). */}
              {selectionMode && selectedLeadIds.size > 0 && (
                <Button
                  size="sm"
                  onClick={handleDispararCampanha}
                  className="h-7 px-2.5 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                  title="Pré-carrega os selecionados no disparo em massa"
                >
                  <Send className="h-3.5 w-3.5" />
                  Disparar ({selectedLeadIds.size})
                </Button>
              )}
            </>
          )}
          {/* Follow-up IA (reativação automática do agente Pedro): SÓ MASTER.
              Vendedor não vê nem configura o follow-up automático do agente. */}
          {!isMarcosCrm && !isSeller && (
            <Button
              variant="outline" size="sm"
              onClick={() => setFollowupIAModalOpen(true)}
              disabled={triggerLoading}
              title={`Configurar reativação automática (Follow-up IA está ${isFollowupActive ? 'ATIVO' : 'PAUSADO'})`}
              className={`h-7 px-2.5 text-xs gap-1.5 transition-all ${
                isFollowupActive
                  ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10 hover:text-emerald-300'
                  : 'border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10'
              }`}
            >
              {triggerLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className={`h-3.5 w-3.5 ${isFollowupActive ? 'text-emerald-400 fill-emerald-400/20' : 'text-zinc-500'}`} />
              )}
              Follow-up IA
              <span className={`h-1.5 w-1.5 rounded-full ${isFollowupActive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
            </Button>
          )}
          {/* Modal de config do Follow-up IA. "Iniciar agora" chama o MOTOR DE
              REATIVACAO (pedro-auto-followup): dispara na coluna de inativos
              respeitando as regras do painel (horario, teto/dia, intervalo, pausa),
              gera a mensagem por IA e o cron continua o lote espacado. */}
          {!isMarcosCrm && !isSeller && (
            <FollowupIAConfigModal
              open={followupIAModalOpen}
              onOpenChange={(val) => {
                setFollowupIAModalOpen(val);
                if (!val) fetchData(true); // Atualiza status ao fechar o modal
              }}
              onStartFollowup={async () => {
                await handleStartReactivation();
                fetchData(true);
              }}
            />
          )}
          {!isSeller && !isMarcosCrm && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClassifyLeads}
              disabled={classifyLoading}
              title="Re-classifica leads nos 3 níveis SDR (Inativo / Pouco Qualificado / Qualificado) com base em respostas do cliente e dados coletados"
              className="h-7 px-2.5 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            >
              {classifyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>🤖</span>}
              Reclassificar IA
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => fetchData(true)} disabled={refreshing} className="h-7 w-7 p-0 text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          {/* Spec 28/05/2026: "Adicionar Lead" disponivel pra Pedro tambem
              (antes era so Marcos). Pedro form mostra apenas origem
              read-only "Trafego Pago"; Marcos mantem as 6 opcoes + custom. */}
          <Button
            variant={addLeadOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setAddLeadOpen(!addLeadOpen)}
            className="h-7 px-2.5 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            {addLeadOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {addLeadOpen ? 'Fechar' : 'Adicionar Lead'}
          </Button>
          {/* Importar Planilha continua so no Marcos por ora — bulk import
              tem logica especifica de mapping/origem que so faz sentido la. */}
          {isMarcosCrm && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => bulkFileRef.current?.click()}
                className="h-7 px-2.5 text-xs gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Importar Planilha
              </Button>
              <input
                ref={bulkFileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleBulkFileChange}
                className="hidden"
              />
            </>
          )}
        </div>
      </div>

      {/* ── Formulário adicionar lead ─────────────────────────────────── */}
      {addLeadOpen && (
        <div className="bg-card border border-emerald-500/20 rounded-xl p-3 space-y-2">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[140px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Nome</label>
              <Input
                value={addLeadName}
                onChange={e => setAddLeadName(e.target.value)}
                placeholder="Nome do lead"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Telefone (WhatsApp)</label>
              <Input
                value={addLeadPhone}
                onChange={e => setAddLeadPhone(e.target.value)}
                placeholder="5511999999999"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">Origem</label>
              {isMarcosCrm ? (
                // Marcos: 7 origens fixas + "Outra" personalizada (spec 28/05/2026;
                // + Redes Sociais 29/05/2026)
                <Select
                  value={addLeadOrigem || '__none__'}
                  onValueChange={(v) => {
                    if (v === '__none__') {
                      setAddLeadOrigem('');
                      setAddLeadSourceId(null);
                      setAddLeadSourceName('');
                      setAddLeadCustomOrigem('');
                      setAddLeadCustomOrigemCreateColumn(false);
                    } else if (v === '__custom__') {
                      // Modo personalizado — pede texto livre + checkbox
                      setAddLeadOrigem('__custom__');
                      setAddLeadSourceId(null);
                      setAddLeadSourceName('');
                    } else {
                      setAddLeadOrigem(v);
                      setAddLeadSourceId(null);
                      const opt = MARCOS_ORIGEM_OPTIONS.find(o => o.value === v);
                      setAddLeadSourceName(opt?.label || v);
                      setAddLeadCustomOrigem('');
                      setAddLeadCustomOrigemCreateColumn(false);
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione a origem" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARCOS_ORIGEM_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                        {opt.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__" className="text-xs border-t border-border/40 mt-1 pt-1">
                      ➕ Outra origem (personalizada)
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                // Pedro: spec 28/05/2026 — somente "Tráfego Pago" como label read-only.
                // Pedro CRM serve so pra leads vindos de campanhas de tráfego pago;
                // outros canais ficam no Marcos CRM.
                <div className="h-8 px-2.5 text-xs flex items-center rounded-md border border-input bg-muted/30 text-foreground/80 select-none">
                  🎯 Tráfego Pago
                </div>
              )}
            </div>
            <Button
              onClick={handleAddLeadManual}
              disabled={
                addLeadSaving
                || !addLeadName.trim()
                || !addLeadPhone.trim()
                || (isMarcosCrm && addLeadOrigem === '__custom__' && !addLeadCustomOrigem.trim())
              }
              size="sm"
              className="h-8 px-4 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {addLeadSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Salvar
            </Button>
          </div>
          {/* Spec 28/05/2026: input pra origem personalizada do Marcos quando
              "__custom__" eh selecionado no select acima. Texto livre +
              checkbox pra (opcional) criar nova coluna no Kanban. */}
          {isMarcosCrm && addLeadOrigem === '__custom__' && (
            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-emerald-500/20">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground font-medium">
                  ➕ Nome da origem personalizada
                </label>
                <Input
                  value={addLeadCustomOrigem}
                  onChange={e => setAddLeadCustomOrigem(e.target.value)}
                  placeholder="Ex: Feira do automóvel, Site próprio, Indicação do João..."
                  className="h-8 text-xs"
                  maxLength={60}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addLeadCustomOrigemCreateColumn}
                  onChange={e => setAddLeadCustomOrigemCreateColumn(e.target.checked)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-[11px] text-muted-foreground">
                  Criar uma coluna no Kanban com esse nome (se ainda não existir)
                </span>
              </label>
            </div>
          )}
          {/* Fase 6.4: removido o input "Especificar origem" — vendedor agora cadastra
              origem nova direto pelo botão "+ Adicionar novo(a)" no select acima */}

          {/* Fase 6 Feature B: 3 campos extras (linha 2 do form, todos opcionais) */}
          <div className="flex flex-wrap gap-2 items-end mt-2 pt-2 border-t border-border/30">
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">📍 Cidade (opcional)</label>
              <Input
                value={addLeadCity}
                onChange={e => setAddLeadCity(e.target.value)}
                placeholder="Ex: Taubaté"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[180px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">🚗 Carro de interesse (opcional)</label>
              <Input
                value={addLeadVehicle}
                onChange={e => setAddLeadVehicle(e.target.value)}
                placeholder="Ex: Onix 2022, Tracker Premier"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">📅 Data da visita (opcional)</label>
              <Input
                type="datetime-local"
                value={addLeadVisit}
                onChange={e => setAddLeadVisit(e.target.value)}
                className="h-8 text-xs"
                title="Quando o cliente vem na loja"
              />
            </div>
            <div className="flex-1 min-w-[160px] space-y-1">
              <label className="text-[10px] text-muted-foreground font-medium">📆 Data que o lead chegou (opcional)</label>
              <Input
                type="date"
                value={addLeadArrived}
                onChange={e => setAddLeadArrived(e.target.value)}
                className="h-8 text-xs"
                title="Se o lead chegou em outro dia (ex: porta no domingo), marque aqui. Vazio = hoje."
              />
            </div>
          </div>
        </div>
      )}

      {/* ── PIPELINE (Kanban) com Drag & Drop ──────────────────────── */}
      {view === 'pipeline' && (
        <DragDropContext
          onDragStart={startBoardAutoScroll}
          onDragEnd={(result) => { stopBoardAutoScroll(); handleDragEnd(result); }}
        >
          <div ref={boardScrollRef} className="overflow-x-auto pb-2 -mx-4 px-4">
            <div className="flex gap-3 min-w-max">
              {pipelineColumns.map(col => {
                const colLeads = filteredLeads.filter(l => normalizeStatus(l.status_crm || 'novo') === col.id);
                // Destaque da etapa de venda (Pedro: id 'fechado'; Marcos: etapa "Venda concluída").
                const isWin = col.id === 'fechado' || normalizeStageName(col.title || '').startsWith('venda conclu');
                // Cor configurada (hex) tem prioridade sobre o estilo fixo por nome.
                // Aplicada via style inline porque o Tailwind não gera classe de cor
                // arbitrária em runtime. isWin mantém o destaque verde próprio.
                const hex = col.color || null;
                const useHex = !!hex && !isWin;
                return (
                  <div
                    key={col.id}
                    onDragOver={event => event.preventDefault()}
                    onDrop={() => {
                      const draggedId = draggedColumnIdRef.current;
                      draggedColumnIdRef.current = null;
                      if (draggedId) handleColumnReorder(draggedId, col.id);
                    }}
                    className={`w-[260px] shrink-0 rounded-xl border ${useHex ? '' : col.border} bg-card/50 ${isWin ? 'border-emerald-400/60 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-500/20' : ''}`}
                    style={useHex ? { borderColor: `${hex}4d` } : undefined}
                  >
                    {/* Column header */}
                    <div
                      draggable
                      onDragStart={event => {
                        draggedColumnIdRef.current = col.id;
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        draggedColumnIdRef.current = null;
                      }}
                      className={`px-3 py-2.5 rounded-t-xl ${isWin ? 'bg-emerald-500/25' : (useHex ? '' : col.bg)} flex items-center justify-between cursor-grab active:cursor-grabbing`}
                      style={useHex ? { backgroundColor: `${hex}1a` } : undefined}
                      title="Arraste para reorganizar esta coluna"
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span className="text-sm">{col.emoji}</span>
                        <span className={`text-xs font-semibold ${isWin ? 'text-emerald-200' : 'text-foreground'}`}>{col.title}</span>
                        {isWin && (
                          <span className="text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-100">
                            Venda
                          </span>
                        )}
                      </div>
                      <span className={`w-5 h-5 rounded-full ${useHex ? '' : col.bg} flex items-center justify-center text-[10px] font-bold text-foreground`}
                        style={useHex ? { backgroundColor: `${hex}26` } : undefined}>
                        {colLeads.length}
                      </span>
                    </div>
                    {/* Column body — droppable */}
                    <Droppable droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`p-2 space-y-2 max-h-[60vh] overflow-y-auto min-h-[60px] transition-colors ${
                            snapshot.isDraggingOver ? 'bg-blue-500/5' : ''
                          }`}
                        >
                          {colLeads.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-center text-[10px] text-muted-foreground py-6">Nenhum lead</p>
                          )}
                          {colLeads.map((lead, index) => (
                            <Draggable key={lead.id} draggableId={lead.id} index={index}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  className={`w-full text-left bg-background border rounded-lg p-3 transition-all space-y-2 group ${
                                    dragSnapshot.isDragging
                                      ? 'border-blue-500/60 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/30'
                                      : 'border-border/40 hover:border-blue-500/40 hover:bg-blue-500/5'
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    {/* Fase 6 Feature C: checkbox de seleção (só aparece em modo seleção) */}
                                    {selectionMode && (
                                      <input
                                        type="checkbox"
                                        checked={selectedLeadIds.has(lead.id)}
                                        onChange={() => toggleLeadSelection(lead.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 h-3.5 w-3.5 rounded border-orange-500/50 accent-orange-500 cursor-pointer"
                                        title="Marcar pra disparo"
                                      />
                                    )}
                                    <div
                                      {...dragProvided.dragHandleProps}
                                      className="mt-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                                    >
                                      <GripVertical className="h-3.5 w-3.5" />
                                    </div>
                                    <button
                                      onClick={() => loadLeadDetail(lead)}
                                      className="flex-1 text-left min-w-0"
                                    >
                                      <p className="text-xs font-semibold text-foreground truncate">{lead.lead_name || 'Lead'}</p>
                                      <p className="text-[10px] text-muted-foreground">{lead.remote_jid?.replace(/@.*/, '')}</p>
                                    </button>
                                  </div>
                                  {/* Item 2: BANNER laranja FORTE quando visita é hoje */}
                                  {(() => {
                                    const vsa = (lead as any).visit_scheduled_at;
                                    if (!vsa) return null;
                                    const visitDate = new Date(vsa);
                                    const today = new Date();
                                    const isToday = visitDate.getFullYear() === today.getFullYear()
                                                 && visitDate.getMonth() === today.getMonth()
                                                 && visitDate.getDate() === today.getDate();
                                    if (!isToday) return null;
                                    const hhmm = `${String(visitDate.getHours()).padStart(2,'0')}:${String(visitDate.getMinutes()).padStart(2,'0')}`;
                                    return (
                                      <div className="px-2 py-1 rounded-md bg-orange-500/20 border border-orange-500/40 flex items-center gap-1.5 animate-pulse">
                                        <span className="text-sm">📅</span>
                                        <span className="text-[10px] font-bold text-orange-300 uppercase tracking-wide">Visita HOJE</span>
                                        <span className="text-[10px] text-orange-300/80 ml-auto">{hhmm}</span>
                                      </div>
                                    );
                                  })()}
                                  {/* Fase 6 badges enriched — só renderiza se algum tem valor */}
                                  {(lead.client_city || lead.vehicle_interest || lead.visit_scheduled || (isMarcosCrm && lead.consignado_modelo)) && (
                                    <div className="flex flex-wrap gap-1">
                                      {lead.client_city ? (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium truncate max-w-[100px]" title={`Cidade: ${lead.client_city}`}>
                                          📍 {lead.client_city}
                                        </span>
                                      ) : null}
                                      {lead.vehicle_interest ? (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-medium truncate max-w-[120px]" title={`Carro: ${lead.vehicle_interest}`}>
                                          🚗 {lead.vehicle_interest}
                                        </span>
                                      ) : null}
                                      {lead.visit_scheduled ? (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium truncate max-w-[110px]" title={`Visita: ${lead.visit_scheduled}`}>
                                          📅 {String(lead.visit_scheduled).slice(0, 18)}
                                        </span>
                                      ) : null}
                                      {/* Marcos Consignado: badge indica que o form do veiculo do cliente
                                          ja foi (parcialmente) preenchido. So aparece no CRM do Marcos. */}
                                      {isMarcosCrm && lead.consignado_modelo ? (
                                        <span
                                          className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 font-medium truncate max-w-[140px] border border-purple-500/30"
                                          title={`Consignado: ${lead.consignado_modelo}${lead.consignado_ano ? ` ${lead.consignado_ano}` : ''}${lead.consignado_km ? ` · ${lead.consignado_km.toLocaleString('pt-BR')}km` : ''}`}
                                        >
                                          🚙 Consig. {lead.consignado_modelo}
                                        </span>
                                      ) : null}
                                    </div>
                                  )}
                                  {lead.summary && (
                                    <button onClick={() => loadLeadDetail(lead)} className="w-full text-left">
                                      <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 whitespace-pre-line">{lead.summary}</p>
                                    </button>
                                  )}
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1.5">
                                      {lead.member && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium truncate max-w-[80px]">
                                          {lead.member.name}
                                        </span>
                                      )}
                                      {/* BUG-NOVO-04: badge amarela 'Aguardando confirmacao' quando transfer pending */}
                                      {!lead.member && (() => {
                                        const sellerStatus = sellerStatusForLead(lead);
                                        if (sellerStatus.status !== 'pending') return null;
                                        return (
                                          <span
                                            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium truncate max-w-[120px] border border-amber-500/30"
                                            title={`Vendedor ${sellerStatus.member_name} ${sellerStatus.pending_since ? formatPendingAge(sellerStatus.pending_since) : ''} — aguardando confirmacao via WhatsApp (ate 15min, depois reescala)`}
                                          >
                                            ⏳ {sellerStatus.member_name}
                                          </span>
                                        );
                                      })()}
                                      {lead.seller_notes_count > 0 && (
                                        <span className="flex items-center gap-0.5 text-[9px] text-yellow-400">
                                          <StickyNote className="h-2.5 w-2.5" />{lead.seller_notes_count}
                                        </span>
                                      )}
                                    </div>
                                    {!isSeller && !lead.member && sellerStatusForLead(lead).status === 'none' && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium">
                                        {sellerLabelForLead(lead)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* ── Popup: registrar venda (carro + data) ao concluir ──────────── */}
      <Dialog open={!!vendaDialog} onOpenChange={(o) => { if (!o) setVendaDialog(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>✅</span> Registrar venda
            </DialogTitle>
            <DialogDescription>
              {vendaDialog?.nome} — preencha o carro e a data da venda. Isso atualiza o Painel Geral.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Carro vendido</label>
              <input
                type="text"
                value={vendaCarro}
                onChange={(e) => setVendaCarro(e.target.value)}
                placeholder="Ex.: Onix 2022 prata"
                className="w-full bg-background border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Data da venda</label>
                <input
                  type="date"
                  value={vendaData}
                  onChange={(e) => setVendaData(e.target.value)}
                  className="w-full bg-background border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Valor (opcional)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={vendaValor}
                  onChange={(e) => setVendaValor(e.target.value)}
                  placeholder="Ex.: 65000"
                  className="w-full bg-background border border-border/60 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setVendaDialog(null)} disabled={vendaSaving}>
              Agora não
            </Button>
            <Button size="sm" onClick={saveVenda} disabled={vendaSaving || !vendaData}>
              {vendaSaving ? 'Salvando...' : 'Salvar venda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── LISTA de Leads ──────────────────────────────────────────── */}
      {view === 'leads' && (
        <div className="space-y-2">
          {view === 'leads' && filterStatus === 'all' && (
            <div className="flex gap-1 flex-wrap mb-2">
              {(isMarcosCrm ? pipelineColumns.map(c => ({ value: c.id, label: c.title, color: 'text-blue-400' })) : STATUS_CRM_OPTIONS).map(opt => {
                const count = leads.filter(l => normalizeStatus(l.status_crm || 'novo') === opt.value).length;
                if (!count) return null;
                return (
                  <button key={opt.value} onClick={() => setFilterStatus(opt.value)}
                    className={`text-[10px] px-2 py-1 rounded-full border border-border/40 hover:bg-accent/60 transition-colors ${opt.color}`}>
                    {opt.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
          {filterStatus !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setFilterStatus('all')} className="h-6 px-2 text-[10px] text-muted-foreground mb-1">
              ← Todos os status
            </Button>
          )}
          {filteredLeads.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              {leads.length === 0 ? 'Nenhum lead encontrado.' : 'Nenhum lead corresponde aos filtros.'}
            </div>
          )}
          {filteredLeads.map(lead => {
            // "Sem vendedor" de verdade = sem membro, sem transferência pendente
            // e que NÃO está no meio de uma transferência (status 'transferido').
            const unassigned = sellerStatusForLead(lead).status === 'none' && lead.status !== 'transferido';
            return (
            <div
              key={lead.id}
              role="button"
              tabIndex={0}
              onClick={() => loadLeadDetail(lead)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); loadLeadDetail(lead); } }}
              className={`w-full text-left border rounded-xl px-4 py-3 transition-all group cursor-pointer ${
                unassigned
                  ? 'bg-amber-500/5 border-amber-500/40 hover:border-amber-500/60'
                  : 'bg-card border-border/50 hover:border-blue-500/40 hover:bg-blue-500/5'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${
                    unassigned ? 'bg-amber-500/10 border-amber-500/30' : 'bg-blue-500/10 border-blue-500/20'
                  }`}>
                    {unassigned
                      ? <AlertTriangle className="h-4 w-4 text-amber-400" />
                      : <Users className="h-4 w-4 text-blue-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{lead.lead_name || lead.remote_jid}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {unassigned
                        ? <span className="text-amber-400 font-medium">Sem vendedor</span>
                        : sellerLabelForLead(lead)} · {fmtDate(lead.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                  {unassigned && !isSeller && (
                    <Button
                      size="sm"
                      onClick={e => { e.stopPropagation(); startQueueTransfer(lead); }}
                      className="h-7 px-2.5 text-[11px] gap-1.5 bg-amber-500/90 hover:bg-amber-500 text-white"
                      title="Transferir este lead pro próximo vendedor da fila"
                    >
                      <Send className="h-3 w-3" /> Transferir
                    </Button>
                  )}
                  {lead.seller_notes_count > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-yellow-400"><StickyNote className="h-3 w-3" />{lead.seller_notes_count}</span>
                  )}
                  {lead.next_followup_at && (
                    <span className="flex items-center gap-1 text-[10px] text-cyan-400"><Clock className="h-3 w-3" />{fmtDate(lead.next_followup_at)}</span>
                  )}
                  {/* Badge discreto de follow-up (reativacao): so um sinal pra bater o olho. */}
                  {lead.reactivation_status === 'transferred' ? (
                    <span className="text-[10px] text-emerald-400" title="Recuperado pelo follow-up">♻️ recuperado</span>
                  ) : (lead.reactivation_status === 'sent' || lead.reactivation_status === 'responded') ? (
                    <span className="text-[10px] text-cyan-400" title="Em follow-up de reativação">♻️ follow-up</span>
                  ) : null}
                  <Badge variant="outline" className="text-[10px] h-5 capitalize">{lead.status_crm || 'novo'}</Badge>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Confirmação de transferência manual pro próximo da fila */}
      <Dialog open={!!confirmQueueTransfer} onOpenChange={o => { if (!o && !queueTransferring) setConfirmQueueTransfer(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-amber-400" /> Transferir lead pro próximo vendedor?
            </DialogTitle>
            <DialogDescription>
              O lead vai pro próximo da fila e recebe o briefing no WhatsApp na hora. O gerente também é avisado.
            </DialogDescription>
          </DialogHeader>
          {confirmQueueTransfer && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm space-y-1.5">
              <p><span className="text-muted-foreground">Lead:</span> <span className="font-medium">{confirmQueueTransfer.lead.lead_name || confirmQueueTransfer.lead.remote_jid}</span></p>
              <p className="flex items-center gap-2">
                <span className="text-muted-foreground">Vai para:</span>
                <span className="font-medium text-emerald-400">{confirmQueueTransfer.seller.name}</span>
              </p>
              {confirmQueueTransfer.seller.whatsapp_number && (
                <p className="text-[11px] text-muted-foreground">WhatsApp do vendedor: {confirmQueueTransfer.seller.whatsapp_number}</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmQueueTransfer(null)} disabled={queueTransferring}>
              Cancelar
            </Button>
            <Button onClick={confirmQueueTransferNow} disabled={queueTransferring} className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5">
              {queueTransferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Confirmar transferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resgatar leads presos (órfãos) — prévia (dry-run) + confirmação ── */}
      <Dialog open={rescueOpen} onOpenChange={o => { if (!o && !rescueRunning) { setRescueOpen(false); setRescuePreview(null); } }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-red-400" /> Resgatar leads presos
            </DialogTitle>
            <DialogDescription>
              Estes leads foram transferidos mas ficaram sem vendedor (a transferência expirou). Vou reencaminhar
              cada um pro próximo vendedor da fila e avisar no WhatsApp. Confira a prévia antes de confirmar.
            </DialogDescription>
          </DialogHeader>

          {rescueLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando prévia…
            </div>
          )}

          {!rescueLoading && rescuePreview && (() => {
            const det = (rescuePreview.detalhe || []) as any[];
            const reencaminhar = det.filter(d => d.acao === 'reencaminharia');
            const semVendedor = det.filter(d => d.acao === 'sem_vendedor');
            return (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                    {reencaminhar.length} vão ser reencaminhados
                  </span>
                  {semVendedor.length > 0 && (
                    <span className="px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-300">
                      {semVendedor.length} sem vendedor ativo
                    </span>
                  )}
                  {rescuePreview.pulados_com_pending > 0 && (
                    <span className="px-2 py-1 rounded-full bg-muted/40 border border-border/60 text-muted-foreground">
                      {rescuePreview.pulados_com_pending} já aguardando
                    </span>
                  )}
                </div>

                {reencaminhar.length > 0 && (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{rescueSelected.size} de {reencaminhar.length} selecionados</span>
                      <div className="flex gap-2">
                        <button type="button" className="text-emerald-400 hover:underline"
                          onClick={() => setRescueSelected(new Set(reencaminhar.map((x: any) => x.lead_id).filter(Boolean)))}>
                          Selecionar todos
                        </button>
                        <span className="text-muted-foreground/40">·</span>
                        <button type="button" className="text-muted-foreground hover:underline"
                          onClick={() => setRescueSelected(new Set())}>
                          Limpar
                        </button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 divide-y divide-border/40">
                      {reencaminhar.map((d, i) => {
                        const checked = rescueSelected.has(d.lead_id);
                        return (
                          <label key={i} className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-opacity ${checked ? '' : 'opacity-45'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setRescueSelected(prev => {
                                const n = new Set(prev);
                                if (n.has(d.lead_id)) n.delete(d.lead_id); else n.add(d.lead_id);
                                return n;
                              })}
                              className="h-3.5 w-3.5 rounded border-emerald-500/50 accent-emerald-500 cursor-pointer shrink-0"
                            />
                            <span className="font-medium truncate flex-1">{d.lead_name || 'Sem nome'}</span>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                              <ArrowRightLeft className="h-3 w-3" />
                              <span className="text-emerald-400 font-medium">{d.vendedor}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                {semVendedor.length > 0 && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5">
                    <p className="text-[11px] text-red-300 mb-1.5 font-medium">Sem vendedor ativo (não dá pra reencaminhar):</p>
                    <div className="space-y-1">
                      {semVendedor.map((d, i) => (
                        <p key={i} className="text-xs text-muted-foreground truncate">• {d.lead_name || 'Sem nome'}</p>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">Ative um vendedor em Pedro &gt; Vendedores pra resgatar esses.</p>
                  </div>
                )}

                {!rescuePreview.dentro_do_horario && (
                  <p className="text-[11px] text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
                    ⏰ Agora está fora do horário de repasse ({rescuePreview.janela}). Se você confirmar mesmo assim,
                    o envio é <strong>forçado</strong> e os vendedores recebem as mensagens agora.
                  </p>
                )}
              </div>
            );
          })()}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => { setRescueOpen(false); setRescuePreview(null); }} disabled={rescueRunning}>
              Cancelar
            </Button>
            <Button
              onClick={handleRescueConfirm}
              disabled={rescueRunning || rescueLoading || !rescuePreview || rescueSelected.size === 0}
              className="bg-red-500 hover:bg-red-600 text-white gap-1.5"
            >
              {rescueRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Confirmar e resgatar {rescueSelected.size || ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Feedbacks ── Master: todos + comparação + filtro por vendedor. Vendedor: SÓ os DELE. */}
      {view === 'feedbacks' && (
        <div className="space-y-3">
          {/* Resumo da qualificação de TODOS os leads pela IA — só master */}
          {!isSeller && (
            <QualificacaoResumo masterUserId={effectiveUserIdState || userId || ''} />
          )}
          {/* Dashboard analítico: feedback do vendedor x IA. Master vê todos (e filtra por vendedor);
              vendedor vê só os DELE (hideSellerFilter), pra conferir o que chegou no master. */}
          {feedbacks.length > 0 && (
            <FeedbackAnalytics
              feedbacks={feedbacks as any}
              hideSellerFilter={isSeller}
              sellers={isSeller ? undefined : teamMembers.map((m: any) => ({ id: m.id, name: m.name, memberIds: m._allIds || [m.id] }))}
            />
          )}
          {feedbacks.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <BellRing className="h-8 w-8 mx-auto mb-3 opacity-30" />
              {isSeller ? 'Você ainda não deu nenhum feedback.' : 'Nenhum feedback recebido ainda.'}
            </div>
          )}
          {feedbacks.map(fb => {
            const pCfg = priorityCfg(fb.priority);
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
                    {fb.city && <p className="text-xs"><span className="text-muted-foreground">Cidade:</span> {fb.city}</p>}
                    {fb.reason && <p className="text-xs"><span className="text-muted-foreground">Motivo:</span> {fb.reason}</p>}
                    {fb.observations && <p className="text-xs"><span className="text-muted-foreground">Obs:</span> {fb.observations}</p>}
                    {!fb.city && !fb.reason && <p className="text-xs text-foreground leading-relaxed">{fb.content}</p>}
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

      {/* ── Diagnóstico: Leads sem Transferência (gerente apenas) ────── */}
      {view === 'diagnostico' && !isSeller && (
        <div className="space-y-3">
          {/* Cabeçalho + resumo */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-foreground">Leads sem Transferência — Diagnóstico</h3>
            </div>
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-amber-400">{diagLeads.length}</span> lead(s) sem vendedor no período
            </span>
          </div>

          {/* ── "Aguardando o vendedor" — reconcilia com o CRM ──────────────────
              O bloco de motivos abaixo conta SO leads que nunca foram transferidos.
              Os leads que o gerente ve no CRM como "Aguardando" (transferido preso
              ou aguardando o "Ok" do vendedor) apareciam ZERO aqui. Este card
              traz esse grupo de volta pra a informacao bater. */}
          {aguardandoTotal > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span className="text-sm font-semibold text-foreground">
                    Aguardando o vendedor: <span className="text-amber-400">{aguardandoTotal}</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {transferidoOrfaoLeads.length > 0 && (
                    <span className="text-[10px] px-2 py-1 rounded-full border border-red-500/40 text-red-300">
                      Presos (transferido sem vendedor): <span className="font-bold">{transferidoOrfaoLeads.length}</span>
                    </span>
                  )}
                  {aguardandoPendingLeads.length > 0 && (
                    <span className="text-[10px] px-2 py-1 rounded-full border border-amber-500/40 text-amber-300">
                      Aguardando confirmar: <span className="font-bold">{aguardandoPendingLeads.length}</span>
                      {aguardandoPendingVencidos > 0 && <> · <span className="font-bold">{aguardandoPendingVencidos}</span> vencido(s)</>}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                Estes leads aparecem como <span className="text-amber-300">"Aguardando"</span> no CRM e
                {' '}<span className="text-foreground">não</span> entram na contagem de motivos abaixo (que é só de leads nunca transferidos).
                Os <span className="text-red-300">"presos"</span> tiveram a transferência expirada e precisam de repasse para outro vendedor.
              </p>
              {transferidoOrfaoLeads.length > 0 && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    onClick={handleRescuePreview}
                    disabled={rescueLoading || rescueRunning}
                    className="bg-red-500/90 hover:bg-red-600 text-white gap-1.5 h-8"
                  >
                    {rescueLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                    Resgatar {transferidoOrfaoLeads.length} lead(s) preso(s)
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Mostra uma prévia antes de enviar. Reencaminha pro próximo vendedor da fila.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Filtros: período · motivo · agente · classificação */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Select value={dateFilter} onValueChange={v => setDateFilter(v as LeadDatePreset)}>
              <SelectTrigger className="h-7 text-xs w-36" title="Filtra por quando o lead chegou">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Período" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {LEAD_DATE_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dateFilter === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2" title="Data inicial" />
                <span className="text-xs text-muted-foreground">até</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="h-7 text-xs rounded-md border border-input bg-background px-2" title="Data final" />
              </div>
            )}
            <Select value={diagReason} onValueChange={setDiagReason}>
              <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Motivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos os motivos</SelectItem>
                {TRANSFER_FAILURE_REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                ))}
                <SelectItem value="nao_registrado" className="text-xs text-muted-foreground">Não registrado</SelectItem>
              </SelectContent>
            </Select>
            {diagAgents.length > 1 && (
              <Select value={diagAgent} onValueChange={setDiagAgent}>
                <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Agente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos os agentes</SelectItem>
                  {diagAgents.map(([id, name]) => (
                    <SelectItem key={id} value={id} className="text-xs">{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={diagClass} onValueChange={setDiagClass}>
              <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Classificação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todas classificações</SelectItem>
                {STATUS_CRM_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contadores de volume por motivo (chips) */}
          {diagChartData.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] px-2 py-1 rounded-full border border-border/50 text-foreground">
                Total: <span className="font-bold">{diagLeads.length}</span>
              </span>
              {diagChartData.map(d => (
                <span key={d.name} className="text-[10px] px-2 py-1 rounded-full border border-border/40 text-muted-foreground">
                  {d.name}: <span className="font-bold" style={{ color: d.fill }}>{d.count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Gráfico de distribuição por motivo */}
          {diagChartData.length > 0 && (
            <div className="bg-card border border-border/50 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Distribuição por motivo
              </p>
              <ResponsiveContainer width="100%" height={Math.max(110, diagChartData.length * 40)}>
                <BarChart data={diagChartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => [`${v} lead(s)`, 'Total']}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {diagChartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Lista de leads sem transferência */}
          {diagLeadsFiltered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40 text-emerald-400" />
              {diagLeads.length === 0
                ? 'Nenhum lead parado sem vendedor no período. 🎉'
                : 'Nenhum lead corresponde aos filtros.'}
            </div>
          ) : (
            diagLeadsFiltered.map(lead => {
              const f = failureByLeadId.get(lead.id);
              const rc = reasonCfg(f?.reason_code);
              return (
                <div
                  key={lead.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => loadLeadDetail(lead)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); loadLeadDetail(lead); } }}
                  className="border rounded-xl px-4 py-3 bg-amber-500/5 border-amber-500/40 hover:border-amber-500/60 cursor-pointer transition-all group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg border bg-amber-500/10 border-amber-500/30 flex items-center justify-center shrink-0">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{lead.lead_name || lead.remote_jid}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {lead.remote_jid} · {fmtDate(lead.created_at)}{lead.agent?.name ? ` · ${lead.agent.name}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      {rc ? (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${rc.bg} ${rc.color}`} title={f?.reason_detail || rc.label}>
                          {rc.short}
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400"
                          title="Motivo ainda não registrado — será preenchido quando o monitoramento de falhas estiver ativo">
                          Não registrado
                        </span>
                      )}
                      <Badge variant="outline" className="text-[10px] h-5 capitalize">{lead.status_crm || 'novo'}</Badge>
                      <Button
                        size="sm"
                        onClick={e => { e.stopPropagation(); startQueueTransfer(lead); }}
                        className="h-7 px-2.5 text-[11px] gap-1.5 bg-amber-500/90 hover:bg-amber-500 text-white"
                        title="Transferir este lead pro próximo vendedor da fila"
                      >
                        <Send className="h-3 w-3" /> Transferir
                      </Button>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Tráfego / Campanhas (gerente apenas) ─────────────────────── */}
      {view === 'trafego' && !isSeller && (
        <CampanhaAnalytics masterUserId={effectiveUserIdState || userId || ''} />
      )}

      {/* ── Sellers (gerente apenas) ────────────────────────────────── */}
      {view === 'sellers' && !isSeller && (
        <div className="space-y-2">
          {teamMembers.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
              Nenhum vendedor cadastrado.
            </div>
          )}
          {teamMembers.map(m => (
            <div
              key={m.id}
              className="bg-card border border-border/50 rounded-xl px-4 py-3 hover:border-blue-500/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                    m.active_in_system !== false
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-muted text-muted-foreground border border-border/40'
                  }`}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                      {m.active_in_system !== false ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold">ATIVO</span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 font-semibold">PAUSADO</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {m.whatsapp_number ?? 'Sem WhatsApp'}
                      {m.last_lead_received_at && ` · Último lead: ${fmtDate(m.last_lead_received_at)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-base font-bold text-foreground leading-none">{m.leadsCount ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">leads</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-emerald-400 leading-none">{m.qualifiedCount ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">qualificados</p>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => toggleSellerActive(m.id, m.active_in_system !== false)}
                    className={`h-8 px-2.5 text-[11px] gap-1 ${
                      m.active_in_system !== false
                        ? 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
                        : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {m.active_in_system !== false ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {m.active_in_system !== false ? 'Pausar' : 'Ativar'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog: Importar Planilha em Massa ──────────────────────── */}
      <Dialog open={bulkDialogOpen} onOpenChange={(open) => { if (!bulkSaving) setBulkDialogOpen(open); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5 text-amber-400" />
              Importar Leads em Massa
            </DialogTitle>
            <DialogDescription className="text-xs">
              Confira os dados abaixo antes de importar. A planilha deve ter colunas de <strong>Nome</strong> e <strong>Telefone</strong>.
            </DialogDescription>
          </DialogHeader>

          {/* Summary */}
          <div className="flex items-center gap-4 py-2">
            <div className="flex items-center gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Total:</span>
              <span className="font-bold text-foreground">{bulkLeads.length}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-muted-foreground">Válidos:</span>
              <span className="font-bold text-emerald-400">{bulkLeads.filter(l => l.valid).length}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <XCircle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-muted-foreground">Inválidos:</span>
              <span className="font-bold text-red-400">{bulkLeads.filter(l => !l.valid).length}</span>
            </div>
          </div>

          {/* Data de chegada do lote (porta/dia passado). Aplica a TODOS os leads. */}
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <label className="text-xs text-muted-foreground font-medium">📆 Data que estes leads chegaram (opcional):</label>
            <Input
              type="date"
              value={bulkArrived}
              onChange={e => setBulkArrived(e.target.value)}
              className="h-8 text-xs w-40"
              title="Ex: leads de porta do domingo. Vazio = data de hoje (cadastro)."
            />
            <span className="text-[10px] text-muted-foreground">Vazio = hoje. Vale pra todos do lote.</span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto border border-border/50 rounded-lg min-h-0">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
                <tr>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium w-8">#</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Nome</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Telefone</th>
                  <th className="text-center px-3 py-2 text-muted-foreground font-medium w-16">Status</th>
                </tr>
              </thead>
              <tbody>
                {bulkLeads.map((row, i) => (
                  <tr key={i} className={`border-t border-border/30 ${!row.valid ? 'bg-red-500/5' : ''}`}>
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2 text-foreground">{row.name || <span className="text-red-400 italic">vazio</span>}</td>
                    <td className="px-3 py-2 text-foreground font-mono">{row.phone || <span className="text-red-400 italic">vazio</span>}</td>
                    <td className="px-3 py-2 text-center">
                      {row.valid ? (
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400 mx-auto" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Info */}
          {bulkLeads.some(l => !l.valid) && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              Linhas inválidas (nome muito curto ou telefone fora do formato) serão ignoradas na importação.
            </p>
          )}

          {/* Progress */}
          {bulkSaving && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Importando leads...</span>
                <span>{bulkProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${bulkProgress}%` }} />
              </div>
            </div>
          )}

          {/* Result */}
          {bulkResult && (
            <div className="flex items-center gap-3 py-1">
              <span className="text-xs text-emerald-400 font-medium">{bulkResult.success} importado(s)</span>
              {bulkResult.failed > 0 && <span className="text-xs text-red-400 font-medium">{bulkResult.failed} falharam</span>}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setBulkDialogOpen(false); setBulkLeads([]); setBulkResult(null); setBulkArrived(''); }}
              disabled={bulkSaving}
              className="text-xs"
            >
              {bulkResult ? 'Fechar' : 'Cancelar'}
            </Button>
            {!bulkResult && (
              <Button
                size="sm"
                onClick={handleBulkInsert}
                disabled={bulkSaving || bulkLeads.filter(l => l.valid).length === 0}
                className="text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
              >
                {bulkSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Importar {bulkLeads.filter(l => l.valid).length} Lead(s)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

// Tabs do gerente (master) — todas as abas
// Performance é filtrada pela feature flag FEATURES.agentPerformanceTab
// (default false — métricas consolidadas vivem em /painel-geral pra master).
// Spec 27/05/2026: "Painel ao Vivo" antes do "CRM Avançado" no agente Pedro.
const MASTER_TABS = [
  { id: 'performance',  label: 'Performance',  icon: BarChart3,     emoji: '📊' },
  // "Painel ao Vivo" saiu do Pedro — virou item do sistema na sidebar (/dashboard-tv).
  { id: 'crm',          label: 'CRM Avançado', icon: NotebookPen,   emoji: '🗒️' },
  { id: 'inbox-ia',     label: 'Conversas IA', icon: Inbox,         emoji: '📨' },
  { id: 'agente',       label: 'Agente IA',    icon: Bot,           emoji: '🤖' },
  { id: 'vendedores',   label: 'Vendedores',   icon: Users,         emoji: '👥' },
].filter(t => t.id !== 'performance' || FEATURES.agentPerformanceTab);

// Todas as tabs possíveis para o seller (filtradas por visible_features)
const ALL_SELLER_TABS = [
  { id: 'performance', label: 'Performance',  icon: BarChart3,     emoji: '📊', featureKey: 'tab_performance' },
  // "Painel ao Vivo" saiu do Pedro — virou item do sistema na sidebar (/dashboard-tv).
  { id: 'crm',         label: 'Meus Leads',   icon: NotebookPen,   emoji: '🗒️', featureKey: 'tab_crm' },
  { id: 'inbox-ia',    label: 'Conversas IA', icon: Inbox,         emoji: '📨', featureKey: 'tab_inbox_ia' },
  { id: 'agente',      label: 'Agente IA',    icon: Bot,           emoji: '🤖', featureKey: 'tab_agente_ia' },
  { id: 'vendedores',  label: 'Vendedores',   icon: Users,         emoji: '👥', featureKey: 'tab_vendedores' },
  { id: 'inbox',       label: 'Conversas',    icon: MessageSquare, emoji: '💬', featureKey: 'tab_inbox' },
].filter(t => t.id !== 'performance' || FEATURES.agentPerformanceTab);

export default function PedroSDR() {
  const { user } = useAuth();
  const { isSeller, seller, masterUserId, memberIds, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  // Dono dos dados: master usa o proprio id; vendedor usa o id do master (os
  // agentes/leads/inbox ficam gravados sob o master, nao sob o auth do vendedor).
  const inboxOwnerId = masterUserId || user?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  // Seller: filtra tabs por visible_features | Master: todas
  const tabs = isSeller
    ? ALL_SELLER_TABS.filter(t => (visibleFeatures as any)[t.featureKey])
    : MASTER_TABS;
  // Default tab — quando agentPerformanceTab está off (decisão 27/05/2026),
  // o master cai em 'crm'. Se reativar a flag, 'performance' volta a ser default.
  const masterDefaultTab = FEATURES.agentPerformanceTab ? 'performance' : 'crm';
  const defaultTab = isSeller ? (tabs[0]?.id || 'crm') : (tabParam || masterDefaultTab);
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Sincroniza activeTab → URL. Assim, mesmo se o ErrorBoundary remontar
  // a página, a URL ainda carrega o tab atual e o useEffect abaixo restaura.
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', newTab);
      return next;
    }, { replace: true });
  };

  // Se tab param mudar (ex: vendedor clicando no sidebar, ou remontagem do ErrorBoundary)
  useEffect(() => {
    if (tabParam && tabs.some(t => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam, tabs]);

  if (sellerLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 lg:px-6 pt-1 pb-2">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Bot className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-foreground leading-tight">Pedro</h1>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1.5 inline-block" />
                Agente Online
              </Badge>
              {isSeller && (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                  Vendedor: {seller?.name}
                </Badge>
              )}
            </div>
            <p className="text-[11px] leading-normal text-muted-foreground">
              {isSeller ? 'Painel do Vendedor — seus leads e atendimentos' : 'Funil do Agente — Qualificação de Leads & Automação Comercial'}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
          <div className="px-4 lg:px-6 border-b border-border/40">
            <TabsList className="h-auto bg-transparent p-0 gap-1">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-500 data-[state=active]:bg-transparent text-muted-foreground hover:text-foreground transition-all"
                >
                  <span>{tab.emoji}</span>
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {/* Performance — desativada via FEATURES.agentPerformanceTab (27/05/2026).
                Conteúdo consolidado vive em /painel-geral pra master. */}
            {FEATURES.agentPerformanceTab && (!isSeller || visibleFeatures.tab_performance) && (
              <TabsContent value="performance" className="mt-0">
                <PerformanceTab userId={user?.id} />
              </TabsContent>
            )}

            {/* CRM / Meus Leads */}
            <TabsContent value="crm" className="mt-0">
              <CrmAvancadoTab userId={user?.id} />
            </TabsContent>

            {/* Conversas IA — conversas do agente com pause/resume */}
            <TabsContent value="inbox-ia" className="mt-0 h-full">
              {inboxOwnerId && (
                <AgentInboxTab
                  userId={inboxOwnerId}
                  isSeller={isSeller}
                  sellerMemberIds={memberIds}
                  readOnly={isSeller}
                />
              )}
            </TabsContent>

            {/* Vendedores */}
            {(!isSeller || visibleFeatures.tab_vendedores) && (
              <TabsContent value="vendedores" className="mt-0 space-y-4">
                {/* Config de entrega de feedbacks ao gerente — só pra master */}
                {!isSeller && <ManagerFeedbackConfigCard />}
                {user?.id && <SellerManagerTab userId={user.id} />}
              </TabsContent>
            )}

            <Suspense fallback={<TabLoader />}>
              {/* Agente IA — Funil do Agente vive DENTRO do modal de cada agente
                  (aba SDR), porque cada agente tem suas próprias regras. */}
              {(!isSeller || visibleFeatures.tab_agente_ia) && (
                <TabsContent value="agente" className="mt-0 h-full">
                  <WhatsAppAIAgent embedded />
                </TabsContent>
              )}

              {/* "Painel ao Vivo" saiu do agente Pedro (28/06): agora é item do
                  sistema na sidebar, rota /dashboard-tv (mesmo DashboardTV). */}

              {/* Inbox */}
              {(!isSeller || visibleFeatures.tab_inbox) && (
                <TabsContent value="inbox" className="mt-0 h-full">
                  <WhatsAppInbox embedded />
                </TabsContent>
              )}
            </Suspense>
          </div>
        </Tabs>
      </div>
    </MainLayout>
  );
}
