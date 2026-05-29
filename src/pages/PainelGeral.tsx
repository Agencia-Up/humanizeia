// ============================================================================
// PainelGeral
// ----------------------------------------------------------------------------
// Dashboard executivo MASTER-ONLY que SOMA + média Pedro + Marcos.
//
// Não é o Dashboard TV (esse é pra projetar em TV). Painel Geral é uma página
// admin tradicional com:
//   • KPIs combinados (totais e médias dos 2 CRMs)
//   • Comparativo lado a lado: Pedro vs Marcos
//   • Ranking unificado de vendedores (soma leads dos 2 CRMs)
//   • Filtro de período (Hoje/Ontem/7d/30d/Custom)
//
// Acesso: SÓ master (vendedor redirecionado).
// Sidebar: grupo Dashboard, item "Painel Geral".
// ============================================================================

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2, Users, Trophy, ArrowRightLeft, BarChart3, Bot, Layers,
  Calendar as CalendarIcon, TrendingUp, CheckCircle2, AlertCircle,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

// ─── Tipos ──────────────────────────────────────────────────────────────────

type PeriodPreset = 'today' | 'yesterday' | '7days' | '30days' | 'custom';

interface CustomRange { start: string; end: string }

interface SourceBreakdown {
  total: number;
  hoje: number;
  atribuidos: number;
  taxaAtribuicao: number;
  qualidadeMedia: number;
  qualificados: number;
}

interface CombinedData {
  pedro: SourceBreakdown;
  marcos: SourceBreakdown;
  combined: {
    totalLeads: number;
    leadsHoje: number;
    atribuidos: number;
    taxaAtribuicao: number;
    qualidadeMedia: number;
    qualidadeLabel: 'Ótimo' | 'Bom' | 'Médio' | 'Baixo' | 'Sem dados';
    qualificados: number;
    pctQualificados: number;
  };
  /** [{ dia, pedro, marcos, total }] últimos 7 dias */
  atividade: Array<{ dia: string; pedro: number; marcos: number; total: number }>;
  /** Ranking unificado por vendedor (soma dos 2 CRMs) */
  vendedores: Array<{
    id: string;
    nome: string;
    pedroLeads: number;
    marcosLeads: number;
    total: number;
    qualificados: number;
    qualidadeMedia: number;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveDateRange(preset: PeriodPreset, custom: CustomRange): { start: string; end: string; label: string } {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Hoje' };
  }
  if (preset === 'yesterday') {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Ontem' };
  }
  if (preset === '7days') {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 7 dias' };
  }
  if (preset === '30days') {
    const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 30 dias' };
  }
  const s = custom.start ? new Date(custom.start + 'T00:00:00') : new Date();
  const e = custom.end   ? new Date(custom.end   + 'T23:59:59.999') : new Date();
  return { start: s.toISOString(), end: e.toISOString(), label: 'Personalizado' };
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Score helpers (mesma fórmula 50/30/20 dos outros painéis)
function scorePedroStatus(s: string | null | undefined): number {
  if (!s) return 0;
  const map: Record<string, number> = {
    qualificado: 100, medio_qualificado: 70, pouco_qualificado: 40,
    transferido: 100, em_atendimento: 50, novo: 20, inativo: 0,
    fechado: 100, perdido: 0,
  };
  return map[s] ?? 20;
}
function scoreMarcosStage(n: string | null | undefined): number {
  if (!n) return 0;
  const k = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const map: Record<string, number> = {
    'fechado': 100, 'negociacao': 85, 'agendamento': 60, 'porta/loja': 30,
    'marketing place': 20, 'leads inativos': 0, 'nao tem no estoque': 0,
    'novo lead': 20, 'proposta': 75, 'perdido': 0,
    'lead inativo': 0, 'carro nao disponivel': 0, 'porta': 30,
  };
  return map[k] ?? 20;
}
function scoreFb(p: string | null | undefined): number {
  if (!p) return 0;
  return ({ urgent: 100, high: 75, normal: 50, low: 25 } as Record<string, number>)[p] ?? 0;
}
function scoreNotes(c: number | null | undefined): number {
  const n = c || 0; if (n >= 3) return 100; if (n >= 1) return 60; return 0;
}
function combineQuality(ia: number, fb: number | null, notes: number): number {
  if (fb === null) return Math.round(ia * 0.7 + notes * 0.3);
  return Math.round(ia * 0.5 + fb * 0.3 + notes * 0.2);
}
function qualLabel(score: number, has: boolean): CombinedData['combined']['qualidadeLabel'] {
  if (!has) return 'Sem dados';
  if (score >= 80) return 'Ótimo';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Médio';
  return 'Baixo';
}

// ─── MetricCard local (consistente com outros painéis) ─────────────────────

function MetricCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string | number; sub?: string; icon: React.ElementType; color: string;
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

// ─── Página principal ──────────────────────────────────────────────────────

export default function PainelGeral() {
  const { user } = useAuth();
  const { isSeller, loading: profileLoading } = useSellerProfile(user?.id);

  const [period, setPeriod] = useState<PeriodPreset>('30days');
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 29);
    return { start: toDateInput(weekAgo), end: toDateInput(today) };
  });
  const [data, setData] = useState<CombinedData | null>(null);
  const [loading, setLoading] = useState(true);

  const dateRange = resolveDateRange(period, customRange);

  useEffect(() => {
    if (!user?.id || profileLoading || isSeller) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

        // 4 queries paralelas
        const [pedroRes, marcosRes, sellersRes] = await Promise.all([
          (supabase as any).from('ai_crm_leads')
            .select('id, status_crm, assigned_to_id, seller_notes_count, created_at')
            .eq('user_id', user!.id)
            .gte('created_at', dateRange.start).lte('created_at', dateRange.end),
          (supabase as any).from('crm_leads')
            .select('id, stage_id, assigned_to, seller_notes_count, created_at, stage:crm_pipeline_stages(name)')
            .eq('user_id', user!.id)
            .gte('created_at', dateRange.start).lte('created_at', dateRange.end),
          (supabase as any).from('ai_team_members')
            .select('*')
            .eq('user_id', user!.id),
        ]);
        if (cancelled) return;

        type PedroLead = { id: string; status_crm: string | null; assigned_to_id: string | null; seller_notes_count: number | null; created_at: string };
        type MarcosLead = { id: string; stage_id: string | null; assigned_to: string | null; seller_notes_count: number | null; created_at: string; stage: { name: string } | null };

        const pedroLeads = (pedroRes.data || []) as PedroLead[];
        const marcosLeads = (marcosRes.data || []) as MarcosLead[];
        // Vendedores ATIVOS NO SISTEMA (não filtra pelo status do agente de IA).
        const sellers = ((sellersRes.data || []) as any[]).filter((s: any) => s.active_in_system !== false) as Array<{ id: string; name: string }>;

        // Busca feedbacks (uma query só com IN nos 2 ID sets)
        const fbByLead = new Map<string, string>();
        if (pedroLeads.length > 0) {
          const { data: fbRows } = await (supabase as any)
            .from('pedro_manager_feedback')
            .select('lead_id, priority, created_at')
            .in('lead_id', pedroLeads.map(l => l.id))
            .order('created_at', { ascending: false });
          for (const fb of (fbRows || []) as Array<{ lead_id: string; priority: string }>) {
            if (!fbByLead.has(fb.lead_id)) fbByLead.set(fb.lead_id, fb.priority);
          }
        }
        if (marcosLeads.length > 0) {
          const { data: fbRows } = await (supabase as any)
            .from('pedro_manager_feedback')
            .select('crm_lead_id, priority, created_at')
            .in('crm_lead_id', marcosLeads.map(l => l.id))
            .order('created_at', { ascending: false });
          for (const fb of (fbRows || []) as Array<{ crm_lead_id: string; priority: string }>) {
            if (!fbByLead.has(fb.crm_lead_id)) fbByLead.set(fb.crm_lead_id, fb.priority);
          }
        }

        // Scores por lead
        const pedroScores: number[] = [];
        for (const l of pedroLeads) {
          const ia = scorePedroStatus(l.status_crm);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          pedroScores.push(combineQuality(ia, fb, scoreNotes(l.seller_notes_count)));
        }
        const marcosScores: number[] = [];
        for (const l of marcosLeads) {
          const ia = scoreMarcosStage(l.stage?.name);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          marcosScores.push(combineQuality(ia, fb, scoreNotes(l.seller_notes_count)));
        }

        // Helpers de agregação
        const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

        // Breakdown Pedro
        const pedroAtribuidos = pedroLeads.filter(l => l.assigned_to_id).length;
        const pedroQualificados = pedroLeads.filter(l => l.status_crm === 'qualificado' || l.status_crm === 'transferido').length;
        const pedro: SourceBreakdown = {
          total: pedroLeads.length,
          hoje: pedroLeads.filter(l => new Date(l.created_at) >= hoje).length,
          atribuidos: pedroAtribuidos,
          taxaAtribuicao: pedroLeads.length > 0 ? Math.round((pedroAtribuidos / pedroLeads.length) * 100) : 0,
          qualidadeMedia: avg(pedroScores),
          qualificados: pedroQualificados,
        };

        // Breakdown Marcos
        const marcosAtribuidos = marcosLeads.filter(l => l.assigned_to).length;
        const marcosQualificados = marcosLeads.filter(l => {
          const score = scoreMarcosStage(l.stage?.name);
          return score >= 60; // Agendamento/Negociação/Fechado
        }).length;
        const marcos: SourceBreakdown = {
          total: marcosLeads.length,
          hoje: marcosLeads.filter(l => new Date(l.created_at) >= hoje).length,
          atribuidos: marcosAtribuidos,
          taxaAtribuicao: marcosLeads.length > 0 ? Math.round((marcosAtribuidos / marcosLeads.length) * 100) : 0,
          qualidadeMedia: avg(marcosScores),
          qualificados: marcosQualificados,
        };

        // Combinado
        const totalLeads = pedro.total + marcos.total;
        const leadsHoje = pedro.hoje + marcos.hoje;
        const atribuidos = pedro.atribuidos + marcos.atribuidos;
        const taxaAtrib = totalLeads > 0 ? Math.round((atribuidos / totalLeads) * 100) : 0;
        const allScores = [...pedroScores, ...marcosScores];
        const qMedia = avg(allScores);
        const qLabel = qualLabel(qMedia, allScores.length > 0);
        const qualificados = pedro.qualificados + marcos.qualificados;
        const pctQual = totalLeads > 0 ? Math.round((qualificados / totalLeads) * 100) : 0;

        // Atividade dos últimos 7 dias (sobreposto)
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const atividade = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          d.setHours(0, 0, 0, 0);
          const fim = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          const pedroDay = pedroLeads.filter(l => { const t = new Date(l.created_at); return t >= d && t < fim; }).length;
          const marcosDay = marcosLeads.filter(l => { const t = new Date(l.created_at); return t >= d && t < fim; }).length;
          return { dia: dias[d.getDay()], pedro: pedroDay, marcos: marcosDay, total: pedroDay + marcosDay };
        });

        // Ranking unificado de vendedores
        const sellerMap = new Map<string, {
          id: string; nome: string; pedroLeads: number; marcosLeads: number;
          scores: number[]; qualificados: number;
        }>();
        for (const s of sellers) {
          sellerMap.set(s.id, { id: s.id, nome: s.name, pedroLeads: 0, marcosLeads: 0, scores: [], qualificados: 0 });
        }
        pedroLeads.forEach((l, idx) => {
          if (!l.assigned_to_id) return;
          const sObj = sellerMap.get(l.assigned_to_id);
          if (!sObj) return;
          sObj.pedroLeads++;
          sObj.scores.push(pedroScores[idx]);
          if (l.status_crm === 'qualificado' || l.status_crm === 'transferido') sObj.qualificados++;
        });
        marcosLeads.forEach((l, idx) => {
          if (!l.assigned_to) return;
          const sObj = sellerMap.get(l.assigned_to);
          if (!sObj) return;
          sObj.marcosLeads++;
          sObj.scores.push(marcosScores[idx]);
          if (scoreMarcosStage(l.stage?.name) >= 60) sObj.qualificados++;
        });
        const vendedoresRank = Array.from(sellerMap.values())
          .map(s => ({
            id: s.id, nome: s.nome,
            pedroLeads: s.pedroLeads, marcosLeads: s.marcosLeads,
            total: s.pedroLeads + s.marcosLeads,
            qualificados: s.qualificados,
            qualidadeMedia: avg(s.scores),
          }))
          .sort((a, b) => b.total - a.total);

        setData({
          pedro, marcos,
          combined: {
            totalLeads, leadsHoje, atribuidos, taxaAtribuicao: taxaAtrib,
            qualidadeMedia: qMedia, qualidadeLabel: qLabel,
            qualificados, pctQualificados: pctQual,
          },
          atividade,
          vendedores: vendedoresRank,
        });
      } catch (err) {
        console.error('[PainelGeral] erro:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user?.id, profileLoading, isSeller, dateRange.start, dateRange.end]);

  // Vendedor não pode ver — redireciona
  if (!profileLoading && isSeller) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading || !data) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  const { pedro, marcos, combined, atividade, vendedores } = data;
  const qColor =
    combined.qualidadeMedia >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
    combined.qualidadeMedia >= 60 ? 'bg-blue-500/15 text-blue-400' :
    combined.qualidadeMedia >= 40 ? 'bg-amber-500/15 text-amber-400' :
    'bg-red-500/15 text-red-400';

  return (
    <MainLayout>
      <div className="space-y-6 p-4 lg:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Painel Geral</h1>
            <p className="text-sm text-muted-foreground">Soma e média Pedro (Tráfego Pago) + Marcos (Outros canais)</p>
          </div>

          {/* Filtro de período */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Período</span>
            <div className="flex items-center gap-1 bg-card/60 rounded-lg p-1 border border-border/50">
              {([
                { id: 'today',     label: 'Hoje' },
                { id: 'yesterday', label: 'Ontem' },
                { id: '7days',     label: '7 dias' },
                { id: '30days',    label: '30 dias' },
                { id: 'custom',    label: 'Custom' },
              ] as const).map(opt => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setPeriod(opt.id)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-primary/15 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {period === 'custom' && (
              <div className="flex items-center gap-1.5 text-xs">
                <input type="date" value={customRange.start} max={customRange.end}
                  onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
                  className="bg-card/60 border border-border/50 rounded px-2 py-1" />
                <span className="text-muted-foreground">até</span>
                <input type="date" value={customRange.end} min={customRange.start}
                  onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
                  className="bg-card/60 border border-border/50 rounded px-2 py-1" />
              </div>
            )}
          </div>
        </div>

        {/* ── 6 KPIs combinados ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard
            label={`Leads Totais · ${dateRange.label}`}
            value={combined.totalLeads}
            sub={`Pedro: ${pedro.total} · Marcos: ${marcos.total}`}
            icon={Users}
            color="bg-blue-500/15 text-blue-400"
          />
          <MetricCard
            label="Leads Hoje"
            value={combined.leadsHoje}
            sub="nas últimas 24h"
            icon={CalendarIcon}
            color="bg-cyan-500/15 text-cyan-400"
          />
          <MetricCard
            label="Leads Atribuídos"
            value={combined.atribuidos}
            sub={`${combined.taxaAtribuicao}% do total`}
            icon={ArrowRightLeft}
            color="bg-purple-500/15 text-purple-400"
          />
          <MetricCard
            label="Qualificados"
            value={combined.qualificados}
            sub={`${combined.pctQualificados}% do total`}
            icon={CheckCircle2}
            color="bg-emerald-500/15 text-emerald-400"
          />
          <MetricCard
            label="Qualidade Média"
            value={combined.qualidadeLabel === 'Sem dados' ? '—' : `${combined.qualidadeMedia}%`}
            sub={combined.qualidadeLabel}
            icon={Trophy}
            color={qColor}
          />
          <MetricCard
            label="Taxa Atribuição"
            value={`${combined.taxaAtribuicao}%`}
            sub="atribuídos / total"
            icon={TrendingUp}
            color="bg-amber-500/15 text-amber-400"
          />
        </div>

        {/* ── Comparativo Pedro vs Marcos ───────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pedro */}
          <Card className="bg-card border-blue-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-400" />
                Pedro (Tráfego Pago)
              </CardTitle>
              <CardDescription className="text-xs">Leads do WhatsApp IA</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-400 tabular-nums">{pedro.total}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Leads</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-400 tabular-nums">{pedro.qualificados}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Qualificados</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-400 tabular-nums">{pedro.qualidadeMedia}%</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Qualidade</p>
              </div>
            </CardContent>
          </Card>

          {/* Marcos */}
          <Card className="bg-card border-purple-500/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-400" />
                Marcos (Outros canais)
              </CardTitle>
              <CardDescription className="text-xs">Porta / OLX / Marketplace / Indicação / Consignado</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-400 tabular-nums">{marcos.total}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Leads</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-400 tabular-nums">{marcos.qualificados}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Qualificados</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-400 tabular-nums">{marcos.qualidadeMedia}%</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Qualidade</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Gráfico de atividade sobreposto ──────────────────────────────── */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" />
              Atividade — Últimos 7 Dias (Pedro + Marcos)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {atividade.every(d => d.total === 0) ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum lead nos últimos 7 dias
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={atividade} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="dia" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }} labelStyle={{ color: '#f3f4f6' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="pedro" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Pedro" />
                  <Bar dataKey="marcos" fill="#a855f7" radius={[6, 6, 0, 0]} name="Marcos" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ── Ranking de Vendedores (unificado) ─────────────────────────── */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              Ranking Geral de Vendedores
            </CardTitle>
            <CardDescription className="text-xs">Soma Pedro + Marcos por vendedor</CardDescription>
          </CardHeader>
          <CardContent>
            {vendedores.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum vendedor ativo</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Rank</th>
                      <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Vendedor</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-blue-400 font-bold">Pedro</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-purple-400 font-bold">Marcos</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-foreground font-bold">Total</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Qualif.</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-amber-400 font-bold">Qualidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedores.map((v, idx) => (
                      <tr key={v.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-2 text-xs font-bold text-muted-foreground tabular-nums">{idx + 1}º</td>
                        <td className="py-2 px-2 text-sm font-medium truncate max-w-[200px]">{v.nome}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-blue-400">{v.pedroLeads}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-purple-400">{v.marcosLeads}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-bold">{v.total}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-emerald-400">{v.qualificados}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-amber-400">
                          {v.total > 0 ? `${v.qualidadeMedia}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Erro silencioso fallback */}
        {!data && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8 opacity-40" />
            <p className="text-sm">Não foi possível carregar dados.</p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
