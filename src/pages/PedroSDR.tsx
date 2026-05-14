import { useState, useEffect, useMemo, useRef, lazy, Suspense, useCallback, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Bot, MonitorPlay, BarChart3, Loader2, Users, MessageSquare, Inbox,
  ArrowRightLeft, TrendingUp, Clock, CheckCircle2, AlertCircle,
  Zap, PhoneCall, NotebookPen, Send, CalendarClock, Flag,
  ChevronRight, StickyNote, BellRing, RefreshCw, Eye, EyeOff,
  Pin, PinOff, Image, Mic, Video, Smartphone, Upload, X, Trash2,
  Plus, GripVertical, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle,
  Pencil, Check,
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
const CrmAoVivo          = lazy(() => import('./CrmAoVivo'));
const WhatsAppInstances  = lazy(() => import('./WhatsAppInstances'));
const WhatsAppInbox      = lazy(() => import('./WhatsAppInbox'));
import { FollowupFunnelBuilder } from '@/components/pedro/FollowupFunnelBuilder';
import { SellerManagerTab } from '@/components/pedro/SellerManagerTab';
import { AgentInboxTab } from '@/components/pedro/AgentInboxTab';
import FunilDoAgenteTab from '@/components/pedro/FunilDoAgenteTab';
import { useSellerProfile } from '@/hooks/useSellerProfile';

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
  vendedores: { nome: string; leads: number; qualificados: number; whatsapp: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  novo:               '#3B82F6',
  pouco_qualificado:  '#EF4444',
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
            .select('id, status, status_crm, assigned_to_id, agent_id, created_at')
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
          totalRespostas, agentesAtivos, leadsPorStatus,
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

// Potencial de compra do lead — quanto mais "quente", maior a chance de fechar venda.
// Mantemos os valores internos low/normal/high/urgent para compatibilidade com o banco;
// só os labels mudaram para refletir potencial em vez de prioridade.
const PRIORITY_CONFIG = {
  low:    { label: '❄️ Frio',                color: 'text-slate-400',  bg: 'bg-slate-500/10',  desc: 'Pouco interesse — apenas olhando' },
  normal: { label: '🌡️ Morno',                color: 'text-blue-400',   bg: 'bg-blue-500/10',   desc: 'Tem interesse, pode comprar' },
  high:   { label: '🔥 Quente',              color: 'text-orange-400', bg: 'bg-orange-500/10', desc: 'Alto interesse, perto de fechar' },
  urgent: { label: '🚀 Pronto pra comprar',  color: 'text-red-400',    bg: 'bg-red-500/10',    desc: 'Vai comprar agora — atende já' },
} as const;

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
  { value: 'pouco_qualificado',  label: 'Pouco Qualificado', color: 'text-orange-400'  },
  { value: 'medio_qualificado',  label: 'Médio Qualificado', color: 'text-amber-400'   },
  { value: 'qualificado',        label: 'Qualificado',       color: 'text-emerald-400' },
  { value: 'em_atendimento',     label: 'Agendamento',       color: 'text-cyan-400'    },
  { value: 'negociacao',         label: 'Negociação',        color: 'text-purple-400'  },
  { value: 'fechado',            label: 'Fechado',           color: 'text-green-400'   },
  { value: 'perdido',            label: 'Perdido',           color: 'text-red-400'     },
];

// Mapeia status legacy "interessado" → exibe como "novo" no kanban (compat retroativa)
const STATUS_DISPLAY_MAP: Record<string, string> = {
  interessado: 'novo',
};
function normalizeStatus(status: string): string {
  return STATUS_DISPLAY_MAP[status] || status;
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Tab CRM Avançado ─────────────────────────────────────────────────────────

const PIPELINE_COLUMNS = [
  { id: 'novo',               title: 'Novo',               emoji: '🔰', border: 'border-slate-500/30',   bg: 'bg-slate-500/10',   dot: 'bg-slate-400'   },
  { id: 'pouco_qualificado',  title: 'Pouco Qualif.',      emoji: '🧊', border: 'border-orange-500/30',  bg: 'bg-orange-500/10',  dot: 'bg-orange-400'  },
  { id: 'medio_qualificado',  title: 'Médio Qualif.',      emoji: '🌡️', border: 'border-amber-500/30',   bg: 'bg-amber-500/10',   dot: 'bg-amber-400'   },
  { id: 'qualificado',        title: 'Qualificado',        emoji: '🎯', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' },
  { id: 'em_atendimento',     title: 'Agendamento',        emoji: '📅', border: 'border-cyan-500/30',    bg: 'bg-cyan-500/10',    dot: 'bg-cyan-400'   },
  { id: 'negociacao',         title: 'Negociação',         emoji: '🤝', border: 'border-purple-500/30',  bg: 'bg-purple-500/10',  dot: 'bg-purple-400'  },
  { id: 'fechado',            title: 'Fechado',            emoji: '✅', border: 'border-green-500/30',   bg: 'bg-green-500/10',   dot: 'bg-green-400'   },
  { id: 'perdido',            title: 'Perdido',            emoji: '❌', border: 'border-red-500/30',     bg: 'bg-red-500/10',     dot: 'bg-red-400'     },
];

interface CrmLead {
  id: string;
  lead_name: string;
  remote_jid: string;
  status_crm: string;
  summary?: string | null;
  next_followup_at: string | null;
  seller_notes_count: number;
  assigned_to_id: string | null;
  member?: { id: string; name: string } | null;
  agent?: { name: string } | null;
  created_at: string;
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
  lead_id: string;
  content: string;
  city?: string | null;
  reason?: string | null;
  observations?: string | null;
  priority: string;
  read_at: string | null;
  created_at: string;
  member?: { name: string } | null;
  lead?: { lead_name: string } | null;
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

interface FollowupSchedule {
  id: string;
  lead_id: string;
  scheduled_at: string;
  message_template: string;
  status: string;
  created_at: string;
}

interface TeamMember {
  id: string;
  name: string;
  whatsapp_number: string | null;
  is_active: boolean;
  last_lead_received_at: string | null;
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

export function CrmAvancadoTab({ userId }: { userId: string | undefined }) {
  const { toast } = useToast();
  const [isSeller, setIsSeller] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [leadMetrics, setLeadMetrics] = useState<LeadMetrics>({ total: 0, today: 0, week: 0, month: 0 });
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [schedules, setSchedules] = useState<FollowupSchedule[]>([]);
  const [transfers, setTransfers] = useState<LeadTransfer[]>([]);
  const [view, setView] = useState<'pipeline' | 'leads' | 'feedbacks' | 'sellers'>('pipeline');

  // filter states
  const [filterStatus, setFilterStatus]   = useState<string>('all');
  const [filterSeller, setFilterSeller]   = useState<string>('all');
  const [searchTerm,   setSearchTerm]     = useState('');

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
  const [funnelOpen, setFunnelOpen]       = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
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

  const fetchData = async (silent = false) => {
    if (!userId) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

      const leadCountQuery = (from?: Date) => {
        let query = (supabase as any)
          .from('ai_crm_leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', effectiveUserId);

        if (from) query = query.gte('created_at', from.toISOString());
        if (isSeller && memberIds.length > 0) query = query.in('assigned_to_id', memberIds);

        return query;
      };

      // Seller: filtra por assigned_to_id (todos os member IDs do vendedor) no banco
      // Master: busca os 100 mais recentes (sem filtro de seller)
      const leadsQuery = (supabase as any)
        .from('ai_crm_leads')
        .select('id, lead_name, remote_jid, status_crm, summary, next_followup_at, seller_notes_count, assigned_to_id, created_at, member:ai_team_members(id, name), agent:wa_ai_agents(name)')
        .eq('user_id', effectiveUserId)
        .order('created_at', { ascending: false });
      if (isSeller && memberIds.length > 0) {
        leadsQuery.in('assigned_to_id', memberIds);
      } else {
        leadsQuery.limit(100);
      }

      const [leadsRes, fbRes, instRes, teamRes, totalCountRes, todayCountRes, weekCountRes, monthCountRes] = await Promise.all([
        leadsQuery,
        (supabase as any)
          .from('pedro_manager_feedback')
          .select('id, lead_id, content, city, reason, observations, priority, read_at, created_at, member:ai_team_members(name), lead:ai_crm_leads(lead_name)')
          .eq('user_id', isSeller ? userId : effectiveUserId)
          .order('created_at', { ascending: false })
          .limit(50),
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
          .select('id, name, whatsapp_number, is_active, last_lead_received_at, agent_id')
          .eq('user_id', effectiveUserId)
          .order('is_active', { ascending: false })
          .order('name', { ascending: true }),
        leadCountQuery(),
        leadCountQuery(todayStart),
        leadCountQuery(weekStart),
        leadCountQuery(monthStart),
      ]);

      const leadsData: CrmLead[] = leadsRes.data || [];
      const teamData:  TeamMember[] = teamRes.data || [];

      // Deduplica vendedores pelo whatsapp_number (mesmo vendedor pode estar em vários agentes)
      const deduped = new Map<string, TeamMember>();
      for (const m of teamData) {
        const key = m.whatsapp_number || m.id; // fallback para id se sem número
        const existing = deduped.get(key);
        if (!existing) {
          deduped.set(key, m);
        } else {
          // Mantém o mais recente / ativo; junta IDs para contagem
          if (m.is_active && !existing.is_active) {
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
      setFeedbacks(fbRes.data || []);
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

  const loadLeadDetail = async (lead: CrmLead) => {
    setSelectedLead(lead);
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

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Apagar esta anotação? Esta ação não pode ser desfeita.')) return;
    try {
      const { error } = await (supabase as any).from('pedro_crm_notes').delete().eq('id', noteId);
      if (error) throw error;
      setNotes(prev => prev.filter(n => n.id !== noteId));
      toast({ title: 'Anotação apagada.' });
    } catch (err: any) {
      toast({ title: 'Erro ao apagar', description: err.message, variant: 'destructive' });
    }
  };

  const toggleNotePin = async (noteId: string, currentPinned: boolean) => {
    try {
      await (supabase as any).from('pedro_crm_notes').update({ is_pinned: !currentPinned }).eq('id', noteId);
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
    if (!fuMsg.trim() || !fuDate || !selectedLead || !userId) return;
    setFuLoading(true);
    try {
      const mediaType = fuMediaFile ? fuMediaFile.type.split('/')[0] : null; // 'image' | 'video' | 'audio'
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

  const handleSendFeedback = async () => {
    if (!selectedLead || !userId) return;
    // Validações do formulário estruturado
    if (!fbCity) {
      toast({ title: 'Selecione a cidade do cliente', variant: 'destructive' });
      return;
    }
    if (fbCity === 'Outros' && !fbCityCustom.trim()) {
      toast({ title: 'Digite a cidade do cliente', variant: 'destructive' });
      return;
    }
    if (!fbReason) {
      toast({ title: 'Selecione o motivo da não-compra', variant: 'destructive' });
      return;
    }
    setFbLoading(true);
    try {
      const finalCity = fbCity === 'Outros' ? fbCityCustom.trim() : fbCity;
      // Monta content legível para compatibilidade
      const contentLines = [
        `Cidade: ${finalCity}`,
        `Motivo: ${fbReason}`,
      ];
      if (fbObservations.trim()) contentLines.push(`Obs: ${fbObservations.trim()}`);
      const content = contentLines.join(' | ');

      const res = await supabase.functions.invoke('pedro-process-feedback', {
        body: {
          lead_id:      selectedLead.id,
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
      const { data } = await (supabase as any)
        .from('pedro_manager_feedback')
        .select('id, lead_id, content, city, reason, observations, priority, read_at, created_at, member:ai_team_members(name)')
        .eq('lead_id', leadId)
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
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status_crm: newStatus })
        .eq('id', selectedLead.id);
      if (error) throw error;
      setSelectedLead({ ...selectedLead, status_crm: newStatus });
      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, status_crm: newStatus } : l));
      toast({ title: '✅ Status atualizado!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setStatusUpdating(false);
    }
  };

  const reassignLead = async (leadId: string, newMemberId: string | null) => {
    setReassigning(leadId);
    try {
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ assigned_to_id: newMemberId })
        .eq('id', leadId);
      if (error) throw error;
      const newMember = newMemberId ? teamMembers.find(m => m.id === newMemberId) ?? null : null;
      setLeads(prev => prev.map(l => l.id === leadId ? {
        ...l,
        assigned_to_id: newMemberId,
        member: newMember ? { id: newMember.id, name: newMember.name } : null,
      } : l));
      toast({ title: '✅ Lead reatribuído!' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setReassigning(null);
    }
  };

  const toggleSellerActive = async (memberId: string, currentActive: boolean) => {
    try {
      // Encontra todos os IDs deste vendedor (pode ter múltiplos agent_id)
      const member = teamMembers.find(m => m.id === memberId);
      const allIds: string[] = (member as any)?._allIds || [memberId];

      // Atualiza todos os registros do mesmo vendedor
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ is_active: !currentActive })
        .in('id', allIds);
      if (error) throw error;
      setTeamMembers(prev => prev.map(m => m.id === memberId ? { ...m, is_active: !currentActive } : m));
      toast({ title: currentActive ? '⛔ Vendedor pausado' : '✅ Vendedor ativado' });
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

  // ── Estados e handlers: adicionar lead manual, apagar lead, drag-drop ────
  const [addLeadOpen, setAddLeadOpen]   = useState(false);
  const [addLeadName, setAddLeadName]   = useState('');
  const [addLeadPhone, setAddLeadPhone] = useState('');
  const [addLeadSaving, setAddLeadSaving] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);
  const [editingLead, setEditingLead] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // ── Bulk upload states ──
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkLeads, setBulkLeads] = useState<{ name: string; phone: string; valid: boolean }[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkResult, setBulkResult] = useState<{ success: number; failed: number } | null>(null);
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

        // Detect columns: look for name/nome and phone/telefone/whatsapp/numero
        let nameCol = -1;
        let phoneCol = -1;
        const headerRow = (rows[0] || []).map((h: any) => String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
        headerRow.forEach((h: string, i: number) => {
          if (nameCol === -1 && (h.includes('nome') || h.includes('name') || h.includes('cliente') || h.includes('lead'))) nameCol = i;
          if (phoneCol === -1 && (h.includes('telefone') || h.includes('phone') || h.includes('whatsapp') || h.includes('celular') || h.includes('numero') || h.includes('fone'))) phoneCol = i;
        });
        // Fallback: first col = name, second col = phone
        if (nameCol === -1) nameCol = 0;
        if (phoneCol === -1) phoneCol = nameCol === 0 ? 1 : 0;

        const startRow = headerRow.some((h: string) => h.includes('nome') || h.includes('name') || h.includes('telefone') || h.includes('phone') || h.includes('whatsapp')) ? 1 : 0;

        const parsed: { name: string; phone: string; valid: boolean }[] = [];
        for (let i = startRow; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const rawName = String(row[nameCol] || '').trim();
          const rawPhone = String(row[phoneCol] || '').replace(/\D/g, '');
          if (!rawName && !rawPhone) continue;
          const valid = rawName.length >= 2 && rawPhone.length >= 10 && rawPhone.length <= 15;
          parsed.push({ name: rawName, phone: rawPhone, valid });
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
          remote_jid:  `${l.phone}@s.whatsapp.net`,
          status_crm:  'novo',
          status:      'novo',
          assigned_to_id: memberId || null,
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
      const remoteJid = `${cleanPhone}@s.whatsapp.net`;
      const effectiveUserId = isSeller
        ? (await (supabase as any).from('ai_team_members').select('user_id').eq('auth_user_id', userId).limit(1)).data?.[0]?.user_id ?? userId
        : userId;

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

      const { error } = await (supabase as any).from('ai_crm_leads').insert({
        user_id:     effectiveUserId,
        agent_id:    agentId,
        lead_name:   addLeadName.trim(),
        remote_jid:  remoteJid,
        status_crm:  'novo',
        status:      'novo',
        assigned_to_id: memberId || null,
      });
      if (error) throw error;
      toast({ title: '✅ Lead adicionado ao CRM!' });
      setAddLeadName(''); setAddLeadPhone(''); setAddLeadOpen(false);
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
    setEditingLead(true);
  };

  const handleSaveLeadEdit = async () => {
    if (!selectedLead) return;
    setEditSaving(true);
    try {
      const cleanPhone = editPhone.replace(/\D/g, '');
      const newJid = cleanPhone ? `${cleanPhone}@s.whatsapp.net` : selectedLead.remote_jid;
      const updateData: Record<string, string> = {};
      if (editName !== (selectedLead.lead_name || '')) updateData.lead_name = editName;
      if (newJid !== selectedLead.remote_jid) updateData.remote_jid = newJid;
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
      // Remove notas, followups e feedbacks associados primeiro
      await Promise.all([
        (supabase as any).from('pedro_crm_notes').delete().eq('lead_id', leadId),
        (supabase as any).from('pedro_followup_schedules').delete().eq('lead_id', leadId),
        (supabase as any).from('pedro_manager_feedback').delete().eq('lead_id', leadId),
      ]);
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

  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId;
    // Atualiza localmente de imediato (optimistic)
    setLeads(prev => prev.map(l => l.id === draggableId ? { ...l, status_crm: newStatus } : l));
    try {
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ status_crm: newStatus })
        .eq('id', draggableId);
      if (error) throw error;
      toast({ title: `✅ Lead movido para ${PIPELINE_COLUMNS.find(c => c.id === newStatus)?.title || newStatus}` });
    } catch (err: any) {
      toast({ title: 'Erro ao mover lead', description: err.message, variant: 'destructive' });
      await fetchData(true); // Revert on failure
    }
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
          <div className="flex-1 min-w-0">
            {editingLead ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
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
                  <Button variant="ghost" size="sm" onClick={handleSaveLeadEdit} disabled={editSaving} className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                    {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingLead(false)} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{selectedLead.member?.name ?? 'Sem vendedor'} · {fmtDate(selectedLead.created_at)}</p>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground truncate">{selectedLead.lead_name || selectedLead.remote_jid}</h2>
                  <p className="text-xs text-muted-foreground">
                    {(() => { const p = selectedLead.remote_jid?.split('@')[0]?.replace(/\D/g, '') || ''; return p.length >= 12 ? `📱 (${p.slice(2,4)}) ${p.slice(4,9)}-${p.slice(9)}` : p.length >= 10 ? `📱 (${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}` : p ? `📱 ${p}` : ''; })()}
                    {selectedLead.remote_jid && ' · '}{selectedLead.member?.name ?? 'Sem vendedor'} · {fmtDate(selectedLead.created_at)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={startEditLead} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0 mt-0.5" title="Editar lead">
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
                {STATUS_CRM_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    <span className={opt.color}>{opt.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isSeller && teamMembers.length > 0 && (
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
                  {teamMembers.filter(m => m.is_active).map(m => (
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
            3) Fallback "via cron" — texto curto antigo. */}
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
                <Button
                  variant="outline" size="sm"
                  onClick={() => setFunnelOpen(!funnelOpen)}
                  className="h-7 text-[10px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                >
                  <Zap className="h-3 w-3" />
                  {funnelOpen ? 'Fechar Funil' : 'Funil Automático'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Funil automático */}
              {funnelOpen && selectedLead && (
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
                placeholder="Mensagem a enviar ao lead..."
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
              <Button
                onClick={handleScheduleFollowup}
                disabled={fuLoading || !fuMsg.trim() || !fuDate}
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

        {/* ── Feedback Estruturado para Gerente ──────────────────────── */}
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

            {/* Pergunta 1: Cidade */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">1. Cliente veio de qual cidade?</p>
              <Select value={fbCity} onValueChange={v => { setFbCity(v); if (v !== 'Outros') setFbCityCustom(''); }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a cidade..." />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CITIES.map(c => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                  <SelectItem value="Outros" className="text-xs font-medium text-orange-400">Outros...</SelectItem>
                </SelectContent>
              </Select>
              {fbCity === 'Outros' && (
                <Input
                  value={fbCityCustom}
                  onChange={e => setFbCityCustom(e.target.value)}
                  placeholder="Digite a cidade..."
                  className="h-8 text-xs"
                />
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

            {/* Potencial de compra + Enviar */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">
                  🎯 Potencial de compra do lead
                </span>
                <span className="text-[10px] text-muted-foreground/70 italic">
                  (quão perto está de fechar a venda)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Select value={fbPriority} onValueChange={v => setFbPriority(v as any)}>
                  <SelectTrigger className="h-9 text-xs w-56" title="Indique o quão próximo este lead está de comprar">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(PRIORITY_CONFIG) as [string, typeof PRIORITY_CONFIG[keyof typeof PRIORITY_CONFIG]][]).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">
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
                  const pCfg = PRIORITY_CONFIG[fb.priority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.normal;
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
  const filteredLeads = leads.filter(l => {
    if (isSeller && memberIds.length > 0 && !memberIds.includes(l.assigned_to_id)) return false;
    if (filterStatus !== 'all' && (l.status_crm || 'novo') !== filterStatus) return false;
    if (filterSeller === 'unassigned' && l.assigned_to_id) return false;
    if (filterSeller !== 'all' && filterSeller !== 'unassigned' && l.assigned_to_id !== filterSeller) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      if (!(l.lead_name || '').toLowerCase().includes(t) && !(l.remote_jid || '').toLowerCase().includes(t)) return false;
    }
    return true;
  });

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* ── Métricas ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',  value: leadMetrics.total,  icon: Users,       color: 'text-blue-400' },
          { label: 'Hoje',         value: leadMetrics.today,  icon: Clock,       color: 'text-emerald-400' },
          { label: 'Na Semana',    value: leadMetrics.week,   icon: TrendingUp,  color: 'text-cyan-400' },
          { label: 'No Mês',       value: leadMetrics.month,  icon: BarChart3,   color: 'text-purple-400' },
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
            { id: 'leads',     label: 'Lista',      icon: Users,          badge: 0 },
            { id: 'feedbacks', label: 'Feedbacks',   icon: BellRing,      badge: unreadFeedbacks.length },
            ...(!isSeller ? [{ id: 'sellers', label: 'Vendedores', icon: Users, badge: 0 }] : []),
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
          {!isSeller && teamMembers.length > 0 && (view === 'pipeline' || view === 'leads') && (
            <Select value={filterSeller} onValueChange={setFilterSeller}>
              <SelectTrigger className="h-7 text-xs w-36">
                <SelectValue placeholder="Vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos</SelectItem>
                <SelectItem value="unassigned" className="text-xs text-muted-foreground">Sem vendedor</SelectItem>
                {teamMembers.filter(m => m.is_active).map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline" size="sm"
            onClick={handleTriggerFollowups}
            disabled={triggerLoading}
            className="h-7 px-2.5 text-xs gap-1.5 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
          >
            {triggerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Follow-ups
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fetchData(true)} disabled={refreshing} className="h-7 w-7 p-0 text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant={addLeadOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setAddLeadOpen(!addLeadOpen)}
            className="h-7 px-2.5 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            {addLeadOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {addLeadOpen ? 'Fechar' : 'Adicionar Lead'}
          </Button>
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
        </div>
      </div>

      {/* ── Formulário adicionar lead ─────────────────────────────────── */}
      {addLeadOpen && (
        <div className="flex items-end gap-2 bg-card border border-emerald-500/20 rounded-xl p-3">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium">Nome</label>
            <Input
              value={addLeadName}
              onChange={e => setAddLeadName(e.target.value)}
              placeholder="Nome do lead"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-[10px] text-muted-foreground font-medium">Telefone (WhatsApp)</label>
            <Input
              value={addLeadPhone}
              onChange={e => setAddLeadPhone(e.target.value)}
              placeholder="5511999999999"
              className="h-8 text-xs"
            />
          </div>
          <Button
            onClick={handleAddLeadManual}
            disabled={addLeadSaving || !addLeadName.trim() || !addLeadPhone.trim()}
            size="sm"
            className="h-8 px-4 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {addLeadSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Salvar
          </Button>
        </div>
      )}

      {/* ── PIPELINE (Kanban) com Drag & Drop ──────────────────────── */}
      {view === 'pipeline' && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto pb-2 -mx-4 px-4">
            <div className="flex gap-3 min-w-max">
              {PIPELINE_COLUMNS.map(col => {
                const colLeads = filteredLeads.filter(l => normalizeStatus(l.status_crm || 'novo') === col.id);
                return (
                  <div key={col.id} className={`w-[260px] shrink-0 rounded-xl border ${col.border} bg-card/50`}>
                    {/* Column header */}
                    <div className={`px-3 py-2.5 rounded-t-xl ${col.bg} flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{col.emoji}</span>
                        <span className="text-xs font-semibold text-foreground">{col.title}</span>
                      </div>
                      <span className={`w-5 h-5 rounded-full ${col.bg} flex items-center justify-center text-[10px] font-bold text-foreground`}>
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
                                  {lead.summary && (
                                    <button onClick={() => loadLeadDetail(lead)} className="w-full text-left">
                                      <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">{lead.summary}</p>
                                    </button>
                                  )}
                                  <div className="flex items-center justify-between gap-1">
                                    <div className="flex items-center gap-1.5">
                                      {lead.member && (
                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium truncate max-w-[80px]">
                                          {lead.member.name}
                                        </span>
                                      )}
                                      {lead.seller_notes_count > 0 && (
                                        <span className="flex items-center gap-0.5 text-[9px] text-yellow-400">
                                          <StickyNote className="h-2.5 w-2.5" />{lead.seller_notes_count}
                                        </span>
                                      )}
                                    </div>
                                    {!isSeller && !lead.member && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium">
                                        Sem vendedor
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

      {/* ── LISTA de Leads ──────────────────────────────────────────── */}
      {view === 'leads' && (
        <div className="space-y-2">
          {view === 'leads' && filterStatus === 'all' && (
            <div className="flex gap-1 flex-wrap mb-2">
              {STATUS_CRM_OPTIONS.map(opt => {
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
          {filteredLeads.map(lead => (
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
                    <p className="text-sm font-medium text-foreground truncate">{lead.lead_name || lead.remote_jid}</p>
                    <p className="text-[11px] text-muted-foreground">{lead.member?.name ?? 'Sem vendedor'} · {fmtDate(lead.created_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.seller_notes_count > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-yellow-400"><StickyNote className="h-3 w-3" />{lead.seller_notes_count}</span>
                  )}
                  {lead.next_followup_at && (
                    <span className="flex items-center gap-1 text-[10px] text-cyan-400"><Clock className="h-3 w-3" />{fmtDate(lead.next_followup_at)}</span>
                  )}
                  <Badge variant="outline" className="text-[10px] h-5 capitalize">{lead.status_crm || 'novo'}</Badge>
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
                    m.is_active
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-muted text-muted-foreground border border-border/40'
                  }`}>
                    {m.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                      {m.is_active ? (
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
                    onClick={() => toggleSellerActive(m.id, m.is_active)}
                    className={`h-8 px-2.5 text-[11px] gap-1 ${
                      m.is_active
                        ? 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
                        : 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    {m.is_active ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {m.is_active ? 'Pausar' : 'Ativar'}
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
              onClick={() => { setBulkDialogOpen(false); setBulkLeads([]); setBulkResult(null); }}
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

// ─── Wrapper "Agente IA" com sub-tabs (Lista de Agentes + Funil do Agente) ──
// Master vê 2 sub-tabs:
//   1) "Lista de Agentes" → renderiza WhatsAppAIAgent (comportamento atual)
//   2) "Funil do Agente" → seletor de agente IA + FunilDoAgenteTab (novo)
function AgenteIAWithFunnel({ userId }: { userId: string | undefined }) {
  const [subTab, setSubTab] = useState<'lista' | 'funil'>('lista');
  const [agents, setAgents] = useState<{ id: string; name: string; use_funnel_config: boolean }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    if (!userId || subTab !== 'funil') return;
    let cancelled = false;
    (async () => {
      setLoadingAgents(true);
      try {
        const { data } = await (supabase as any)
          .from('wa_ai_agents')
          .select('id, name, use_funnel_config')
          .eq('user_id', userId)
          .order('created_at', { ascending: true });
        if (cancelled) return;
        const list = (data || []) as { id: string; name: string; use_funnel_config: boolean }[];
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) setSelectedAgentId(list[0].id);
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, subTab, selectedAgentId]);

  return (
    <div className="space-y-3">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border/40">
        <button
          onClick={() => setSubTab('lista')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-all ${
            subTab === 'lista'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          🤖 Lista de Agentes
        </button>
        <button
          onClick={() => setSubTab('funil')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-all ${
            subTab === 'funil'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          🧠 Funil do Agente
        </button>
      </div>

      {/* Conteúdo */}
      {subTab === 'lista' && <WhatsAppAIAgent embedded />}

      {subTab === 'funil' && (
        <div className="space-y-3">
          {loadingAgents ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
            </div>
          ) : agents.length === 0 ? (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="pt-6 pb-6 text-center text-xs text-muted-foreground">
                Nenhum agente IA encontrado. Crie um agente em "Lista de Agentes" antes de configurar o funil.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Configurar funil para:</span>
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger className="text-xs h-8 w-64">
                    <SelectValue placeholder="Selecione um agente" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">
                        {a.name} {a.use_funnel_config && <span className="ml-1 text-emerald-400">●</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedAgentId && userId && (
                <FunilDoAgenteTab agentId={selectedAgentId} userId={userId} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

// Tabs do gerente (master) — todas as abas
const MASTER_TABS = [
  { id: 'performance',  label: 'Performance',  icon: BarChart3,     emoji: '📊' },
  { id: 'crm',          label: 'CRM Avançado', icon: NotebookPen,   emoji: '🗒️' },
  { id: 'inbox-ia',     label: 'Inbox IA',     icon: Inbox,         emoji: '📨' },
  { id: 'agente',       label: 'Agente IA',    icon: Bot,           emoji: '🤖' },
  { id: 'ao-vivo',      label: 'CRM ao Vivo',  icon: MonitorPlay,   emoji: '📺' },
  { id: 'instancias',   label: 'Instâncias',   icon: Smartphone,    emoji: '📱' },
  { id: 'vendedores',   label: 'Vendedores',   icon: Users,         emoji: '👥' },
];

// Todas as tabs possíveis para o seller (filtradas por visible_features)
const ALL_SELLER_TABS = [
  { id: 'performance', label: 'Performance',  icon: BarChart3,     emoji: '📊', featureKey: 'tab_performance' },
  { id: 'crm',         label: 'Meus Leads',   icon: NotebookPen,   emoji: '🗒️', featureKey: 'tab_crm' },
  { id: 'agente',      label: 'Agente IA',    icon: Bot,           emoji: '🤖', featureKey: 'tab_agente_ia' },
  { id: 'ao-vivo',     label: 'CRM ao Vivo',  icon: MonitorPlay,   emoji: '📺', featureKey: 'tab_crm_ao_vivo' },
  { id: 'instancias',  label: 'Instâncias',   icon: Smartphone,    emoji: '📱', featureKey: 'tab_instancias' },
  { id: 'vendedores',  label: 'Vendedores',   icon: Users,         emoji: '👥', featureKey: 'tab_vendedores' },
  { id: 'inbox',       label: 'Inbox',        icon: MessageSquare, emoji: '💬', featureKey: 'tab_inbox' },
];

export default function PedroSDR() {
  const { user } = useAuth();
  const { isSeller, seller, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

  // Seller: filtra tabs por visible_features | Master: todas
  const tabs = isSeller
    ? ALL_SELLER_TABS.filter(t => (visibleFeatures as any)[t.featureKey])
    : MASTER_TABS;
  const defaultTab = isSeller ? (tabs[0]?.id || 'crm') : (tabParam || 'performance');
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
              {isSeller && (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
                  Vendedor: {seller?.name}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isSeller ? 'Painel do Vendedor — seus leads e atendimentos' : 'Funil do Agente — Qualificação de Leads & Automação Comercial'}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
          <div className="border-b border-border/40">
            <TabsList className="h-auto bg-transparent p-0 gap-1">
              {tabs.map(tab => (
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
            {/* Performance */}
            {(!isSeller || visibleFeatures.tab_performance) && (
              <TabsContent value="performance" className="mt-0">
                <PerformanceTab userId={user?.id} />
              </TabsContent>
            )}

            {/* CRM / Meus Leads */}
            <TabsContent value="crm" className="mt-0">
              <CrmAvancadoTab userId={user?.id} />
            </TabsContent>

            {/* Inbox IA — conversas do agente com pause/resume */}
            <TabsContent value="inbox-ia" className="mt-0 h-full">
              {user?.id && <AgentInboxTab userId={user.id} />}
            </TabsContent>

            {/* Vendedores */}
            {(!isSeller || visibleFeatures.tab_vendedores) && (
              <TabsContent value="vendedores" className="mt-0">
                {user?.id && <SellerManagerTab userId={user.id} />}
              </TabsContent>
            )}

            <Suspense fallback={<TabLoader />}>
              {/* Agente IA */}
              {(!isSeller || visibleFeatures.tab_agente_ia) && (
                <TabsContent value="agente" className="mt-0 h-full">
                  {isSeller ? (
                    <WhatsAppAIAgent embedded />
                  ) : (
                    <AgenteIAWithFunnel userId={user?.id} />
                  )}
                </TabsContent>
              )}

              {/* CRM ao Vivo */}
              {(!isSeller || visibleFeatures.tab_crm_ao_vivo) && (
                <TabsContent value="ao-vivo" className="mt-0 h-full">
                  <CrmAoVivo embedded />
                </TabsContent>
              )}

              {/* Instâncias */}
              {(!isSeller || visibleFeatures.tab_instancias) && (
                <TabsContent value="instancias" className="mt-0 h-full">
                  <WhatsAppInstances embedded />
                </TabsContent>
              )}

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
