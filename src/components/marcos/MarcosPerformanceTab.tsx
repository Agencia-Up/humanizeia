// ============================================================================
// MarcosPerformanceTab
// ----------------------------------------------------------------------------
// Aba "Performance" do agente Marcos (CRM manual + WhatsApp).
// Espelha a Performance do Pedro mas adaptada ao modelo do Marcos:
//   • Lê de crm_leads (não ai_crm_leads)
//   • Não tem "Respostas IA" / "Agentes Ativos" (Marcos não tem IA)
//   • Tem "Leads por Etapa" (em vez de "Leads por Status")
//   • Qualidade calculada com fórmula 50/30/20 adaptada às stages do Marcos
// ============================================================================

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import {
  BarChart3, Loader2, Users, Zap, ArrowRightLeft, CheckCircle2,
  AlertCircle, Trophy, Layers,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

interface PerfData {
  totalLeads: number;
  leadsHoje: number;
  atribuidos: number;
  taxaAtribuicao: number;
  /** 0-100 — média ponderada IA 50% + Feedback 30% + Notas 20% */
  qualidadeMedia: number;
  qualidadeLabel: 'Ótimo' | 'Bom' | 'Médio' | 'Baixo' | 'Sem dados';
  leadsPorStage: { name: string; value: number; color: string }[];
  atividadeSemanal: { dia: string; leads: number }[];
  vendedores: { nome: string; leads: number; qualificados: number }[];
}

// ─── Cálculo de qualidade (mesma fórmula 50/30/20 do Pedro/DashboardTV) ────

function scoreMarcosStage(name: string | null | undefined): number {
  if (!name) return 0;
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const map: Record<string, number> = {
    'fechado': 100, 'negociacao': 85, 'agendamento': 60, 'porta/loja': 30,
    'marketing place': 20, 'leads inativos': 0, 'nao tem no estoque': 0,
    'novo lead': 20, 'proposta': 75, 'qualificado': 80, 'perdido': 0,
    'lead inativo': 0, 'carro nao disponivel': 0, 'porta': 30,
  };
  return map[n] ?? 20;
}

function scoreFeedbackPriority(p: string | null | undefined): number {
  if (!p) return 0;
  const map: Record<string, number> = { urgent: 100, high: 75, normal: 50, low: 25 };
  return map[p] ?? 0;
}

function scoreNotes(c: number | null | undefined): number {
  const n = c || 0;
  if (n >= 3) return 100;
  if (n >= 1) return 60;
  return 0;
}

function combineQuality(ia: number, fb: number | null, notes: number): number {
  if (fb === null) return Math.round((ia * 0.7) + (notes * 0.3));
  return Math.round((ia * 0.5) + (fb * 0.3) + (notes * 0.2));
}

function qualLabel(score: number, hasData: boolean): PerfData['qualidadeLabel'] {
  if (!hasData) return 'Sem dados';
  if (score >= 80) return 'Ótimo';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Médio';
  return 'Baixo';
}

// ─── Hook de dados ─────────────────────────────────────────────────────────

function useMarcosPerfData() {
  const { user } = useAuth();
  const { isSeller, seller, masterUserId } = useSellerProfile(user?.id);
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve scope (master vs vendedor)
  const effectiveUserId = isSeller ? masterUserId : user?.id;
  const sellerMemberId = isSeller ? seller?.id || null : null;

  useEffect(() => {
    if (!user?.id || !effectiveUserId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        // Queries em paralelo
        let leadsQuery = (supabase as any)
          .from('crm_leads')
          .select('id, assigned_to, stage_id, seller_notes_count, created_at, stage:crm_pipeline_stages(name, color)')
          .eq('user_id', effectiveUserId);
        if (sellerMemberId) leadsQuery = leadsQuery.eq('assigned_to', sellerMemberId);

        const sellersQuery = (supabase as any)
          .from('ai_team_members')
          .select('id, name, is_active')
          .eq('user_id', effectiveUserId)
          .eq('is_active', true);

        const [leadsRes, sellersRes] = await Promise.all([leadsQuery, sellersQuery]);
        if (cancelled) return;

        const leads = (leadsRes.data || []) as Array<{
          id: string; assigned_to: string | null; stage_id: string | null;
          seller_notes_count: number | null; created_at: string;
          stage: { name: string; color: string | null } | null;
        }>;
        const sellers = (sellersRes.data || []) as Array<{ id: string; name: string; is_active: boolean }>;

        // KPIs básicos
        const totalLeads = leads.length;
        const leadsHoje  = leads.filter(l => new Date(l.created_at) >= hoje).length;
        const atribuidos = leads.filter(l => l.assigned_to).length;
        const taxaAtribuicao = totalLeads > 0 ? Math.round((atribuidos / totalLeads) * 100) : 0;

        // Busca feedbacks dos leads (pra qualidade — peso 30%)
        const leadIds = leads.map(l => l.id);
        const fbByLead = new Map<string, string>();
        if (leadIds.length > 0) {
          const { data: fbRows } = await (supabase as any)
            .from('pedro_manager_feedback')
            .select('crm_lead_id, priority, created_at')
            .in('crm_lead_id', leadIds)
            .order('created_at', { ascending: false });
          for (const fb of (fbRows || []) as Array<{ crm_lead_id: string; priority: string }>) {
            if (!fbByLead.has(fb.crm_lead_id)) fbByLead.set(fb.crm_lead_id, fb.priority);
          }
        }

        // Qualidade média (IA 50% + Feedback 30% + Notas 20%)
        const scores = leads.map(l => {
          const ia = scoreMarcosStage(l.stage?.name);
          const fbPri = fbByLead.get(l.id);
          const fb = fbPri ? scoreFeedbackPriority(fbPri) : null;
          const notes = scoreNotes(l.seller_notes_count);
          return combineQuality(ia, fb, notes);
        });
        const qualidadeMedia = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;
        const qualidadeLabel = qualLabel(qualidadeMedia, scores.length > 0);

        // Leads por etapa (donut)
        const stageMap = new Map<string, { name: string; value: number; color: string }>();
        for (const l of leads) {
          const sName = l.stage?.name || 'Sem etapa';
          const sColor = l.stage?.color || '#64748b';
          const cur = stageMap.get(sName) || { name: sName, value: 0, color: sColor };
          cur.value++;
          stageMap.set(sName, cur);
        }
        const leadsPorStage = Array.from(stageMap.values()).sort((a, b) => b.value - a.value);

        // Atividade últimos 7 dias
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const atividadeSemanal = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          d.setHours(0, 0, 0, 0);
          const fim = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          return {
            dia: dias[d.getDay()],
            leads: leads.filter(l => {
              const t = new Date(l.created_at);
              return t >= d && t < fim;
            }).length,
          };
        });

        // Ranking de vendedores (leads + qualificados=stage de alto valor)
        const sellerLeadsMap = new Map<string, { nome: string; leads: number; qualificados: number }>();
        for (const s of sellers) {
          sellerLeadsMap.set(s.id, { nome: s.name, leads: 0, qualificados: 0 });
        }
        for (const l of leads) {
          if (!l.assigned_to) continue;
          const sObj = sellerLeadsMap.get(l.assigned_to);
          if (!sObj) continue;
          sObj.leads++;
          const stageScore = scoreMarcosStage(l.stage?.name);
          if (stageScore >= 60) sObj.qualificados++; // Agendamento/Negociação/Fechado contam
        }
        const vendedoresRank = Array.from(sellerLeadsMap.values())
          .sort((a, b) => b.leads - a.leads);

        setData({
          totalLeads, leadsHoje, atribuidos, taxaAtribuicao,
          qualidadeMedia, qualidadeLabel,
          leadsPorStage, atividadeSemanal,
          vendedores: vendedoresRank,
        });
      } catch (err) {
        console.error('[MarcosPerformanceTab] erro:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user?.id, effectiveUserId, sellerMemberId]);

  return { data, loading };
}

// ─── MetricCard reutilizado ─────────────────────────────────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
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
      </CardContent>
    </Card>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function MarcosPerformanceTab() {
  const { data, loading } = useMarcosPerfData();

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
        <p className="text-sm">Não foi possível carregar a performance do Marcos.</p>
      </div>
    );
  }

  const qualidadeColor =
    data.qualidadeMedia >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
    data.qualidadeMedia >= 60 ? 'bg-blue-500/15 text-blue-400' :
    data.qualidadeMedia >= 40 ? 'bg-amber-500/15 text-amber-400' :
    'bg-red-500/15 text-red-400';

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* ── KPIs principais ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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
          label="Leads Atribuídos"
          value={data.atribuidos}
          sub="com vendedor responsável"
          icon={ArrowRightLeft}
          color="bg-purple-500/15 text-purple-400"
        />
        <MetricCard
          label="Taxa Atribuição"
          value={`${data.taxaAtribuicao}%`}
          sub="atribuídos / total"
          icon={CheckCircle2}
          color="bg-emerald-500/15 text-emerald-400"
        />
        <MetricCard
          label="Qualidade Média"
          value={data.qualidadeLabel === 'Sem dados' ? '—' : `${data.qualidadeMedia}%`}
          sub={data.qualidadeLabel}
          icon={Trophy}
          color={qualidadeColor}
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
            {data.atividadeSemanal.every(d => d.leads === 0) ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum lead no período
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.atividadeSemanal} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: '#f3f4f6' }}
                  />
                  <Bar dataKey="leads" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Leads por Etapa (donut) */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-400" />
              Leads por Etapa
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.leadsPorStage.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum lead
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.leadsPorStage}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {data.leadsPorStage.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
                    labelStyle={{ color: '#f3f4f6' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ranking de Vendedores ──────────────────────────────── */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-cyan-400" />
            Ranking de Vendedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.vendedores.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhum vendedor ativo</p>
          ) : (
            <div className="space-y-2">
              {data.vendedores.map((v, idx) => {
                const totalLeads = v.leads;
                const pctQualificados = totalLeads > 0 ? Math.round((v.qualificados / totalLeads) * 100) : 0;
                return (
                  <div key={idx} className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                    <span className="text-xs font-bold text-muted-foreground w-6 text-center tabular-nums">
                      {idx + 1}º
                    </span>
                    <span className="flex-1 text-sm font-medium truncate">{v.nome}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{v.leads} leads</span>
                    <span className="text-xs text-emerald-400 tabular-nums">{v.qualificados} qualificados</span>
                    <span className="text-xs text-blue-400 tabular-nums">{pctQualificados}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
