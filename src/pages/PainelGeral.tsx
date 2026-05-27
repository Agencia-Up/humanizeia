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
import { Navigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2, Users, Trophy, ArrowRightLeft, BarChart3, Bot, Layers,
  Calendar as CalendarIcon, TrendingUp, CheckCircle2, AlertCircle, UserCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

// ─── Tipos ──────────────────────────────────────────────────────────────────

// Opções do filtro de período (spec 27/05/2026):
// today = dia atual; week = semana atual seg→dom; month = mês atual;
// custom = intervalo personalizado via date picker.
type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

interface CustomRange { start: string; end: string }

interface SourceBreakdown {
  total: number;
  hoje: number;
  atribuidos: number;
  taxaAtribuicao: number;
  qualidadeMedia: number;
  qualificados: number;
}

// Apenas KPIs + comparativo + atividade. O ranking foi separado em
// RankingRow[] com seu próprio fetch (filtros independentes).
interface MainData {
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
}

interface RankingRow {
  id: string;
  nome: string;
  pedroLeads: number;
  marcosLeads: number;
  total: number;
  qualificados: number;
  qualidadeMedia: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveDateRange(preset: PeriodPreset, custom: CustomRange): { start: string; end: string; label: string } {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Hoje' };
  }
  if (preset === 'week') {
    // Semana atual: segunda 00:00 até domingo 23:59:59.999
    const dow = now.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const s = new Date(now); s.setDate(now.getDate() + diffToMonday); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(s.getDate() + 6); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Esta semana' };
  }
  if (preset === 'month') {
    // Mês atual: dia 1 00:00 até último dia 23:59:59.999
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Este mês' };
  }
  const s = custom.start ? new Date(custom.start + 'T00:00:00') : new Date();
  const e = custom.end   ? new Date(custom.end   + 'T23:59:59.999') : new Date();
  return { start: s.toISOString(), end: e.toISOString(), label: 'Personalizado' };
}

// Opções pra renderizar os botões segmentados (compartilhado global+ranking).
const PERIOD_OPTIONS: ReadonlyArray<{ id: PeriodPreset; label: string }> = [
  { id: 'today', label: 'Dia' },
  { id: 'week',  label: 'Semana' },
  { id: 'month', label: 'Mês' },
  { id: 'custom', label: 'Personalizado' },
];

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
function qualLabel(score: number, has: boolean): MainData['combined']['qualidadeLabel'] {
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
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL params (persistência entre navegações) ──────────────────────────
  // GLOBAL: ?period=today|week|month|custom   (default 'today')
  //         ?from=YYYY-MM-DD & ?to=YYYY-MM-DD (só quando period=custom)
  //         (filtro de vendedor global REMOVIDO — agora vive só no Ranking)
  // RANKING: ?rankPeriod, ?rankSeller, ?rankFrom, ?rankTo
  const urlPeriod = (searchParams.get('period') as PeriodPreset | null) || 'today';
  const urlRankPeriod = (searchParams.get('rankPeriod') as PeriodPreset | null) || 'month';
  const urlRankSeller = searchParams.get('rankSeller') || 'all';

  // ── State GLOBAL (KPIs + comparativo + atividade) ───────────────────────
  const [period, setPeriod] = useState<PeriodPreset>(urlPeriod);
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    return {
      start: searchParams.get('from') || toDateInput(weekAgo),
      end: searchParams.get('to') || toDateInput(today),
    };
  });
  const [appliedCustomRange, setAppliedCustomRange] = useState<CustomRange>(customRange);

  // ── State RANKING (independente do global) ──────────────────────────────
  const [rankPeriod, setRankPeriod] = useState<PeriodPreset>(urlRankPeriod);
  const [rankSellerId, setRankSellerId] = useState<string>(urlRankSeller);
  const [rankCustomRange, setRankCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 29);
    return {
      start: searchParams.get('rankFrom') || toDateInput(monthAgo),
      end: searchParams.get('rankTo') || toDateInput(today),
    };
  });
  const [rankAppliedCustomRange, setRankAppliedCustomRange] = useState<CustomRange>(rankCustomRange);

  // ── Data states ─────────────────────────────────────────────────────────
  const [mainData, setMainData] = useState<MainData | null>(null);
  const [mainLoading, setMainLoading] = useState(true);
  const [ranking, setRanking] = useState<RankingRow[] | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);

  // Lista de TODOS os vendedores (pra dropdown do ranking). Uma fetch só.
  const [allSellers, setAllSellers] = useState<Array<{ id: string; name: string }>>([]);

  const dateRange = resolveDateRange(period, appliedCustomRange);
  const rankDateRange = resolveDateRange(rankPeriod, rankAppliedCustomRange);

  // ── Handlers GLOBAL ─────────────────────────────────────────────────────
  const handlePeriodChange = (next: PeriodPreset) => {
    setPeriod(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('period', next);
      if (next !== 'custom') { u.delete('from'); u.delete('to'); }
      return u;
    }, { replace: true });
  };

  const handleApplyCustom = () => {
    setAppliedCustomRange(customRange);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('period', 'custom');
      u.set('from', customRange.start);
      u.set('to', customRange.end);
      return u;
    }, { replace: true });
  };

  // ── Handlers RANKING (independentes) ────────────────────────────────────
  const handleRankPeriodChange = (next: PeriodPreset) => {
    setRankPeriod(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankPeriod', next);
      if (next !== 'custom') { u.delete('rankFrom'); u.delete('rankTo'); }
      return u;
    }, { replace: true });
  };

  const handleRankSellerChange = (next: string) => {
    setRankSellerId(next);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankSeller', next);
      return u;
    }, { replace: true });
  };

  const handleApplyRankCustom = () => {
    setRankAppliedCustomRange(rankCustomRange);
    setSearchParams(prev => {
      const u = new URLSearchParams(prev);
      u.set('rankPeriod', 'custom');
      u.set('rankFrom', rankCustomRange.start);
      u.set('rankTo', rankCustomRange.end);
      return u;
    }, { replace: true });
  };

  // Fetch lista de vendedores ao montar (1×).
  useEffect(() => {
    if (!user?.id || profileLoading || isSeller) return;
    let cancelled = false;
    (async () => {
      const { data: sellersData } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, is_active')
        .eq('user_id', user.id).eq('is_active', true)
        .order('name', { ascending: true });
      if (cancelled) return;
      setAllSellers((sellersData || []) as Array<{ id: string; name: string }>);
    })();
    return () => { cancelled = true; };
  }, [user?.id, profileLoading, isSeller]);

  // ── useEffect MAIN: KPIs + comparativo Pedro/Marcos + atividade ─────────
  // Depende SÓ do período global (filtro de vendedor não existe mais aqui).
  useEffect(() => {
    if (!user?.id || profileLoading || isSeller) return;

    let cancelled = false;
    async function load() {
      setMainLoading(true);
      try {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

        const [pedroRes, marcosRes] = await Promise.all([
          (supabase as any).from('ai_crm_leads')
            .select('id, status_crm, assigned_to_id, seller_notes_count, created_at')
            .eq('user_id', user!.id)
            .gte('created_at', dateRange.start).lte('created_at', dateRange.end),
          (supabase as any).from('crm_leads')
            .select('id, stage_id, assigned_to, seller_notes_count, created_at, stage:crm_pipeline_stages(name)')
            .eq('user_id', user!.id)
            .gte('created_at', dateRange.start).lte('created_at', dateRange.end),
        ]);
        if (cancelled) return;

        type PedroLead = { id: string; status_crm: string | null; assigned_to_id: string | null; seller_notes_count: number | null; created_at: string };
        type MarcosLead = { id: string; stage_id: string | null; assigned_to: string | null; seller_notes_count: number | null; created_at: string; stage: { name: string } | null };

        const pedroLeads = (pedroRes.data || []) as PedroLead[];
        const marcosLeads = (marcosRes.data || []) as MarcosLead[];

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

        const pedroScores: number[] = pedroLeads.map(l => {
          const ia = scorePedroStatus(l.status_crm);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          return combineQuality(ia, fb, scoreNotes(l.seller_notes_count));
        });
        const marcosScores: number[] = marcosLeads.map(l => {
          const ia = scoreMarcosStage(l.stage?.name);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          return combineQuality(ia, fb, scoreNotes(l.seller_notes_count));
        });

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
        const marcosQualificados = marcosLeads.filter(l => scoreMarcosStage(l.stage?.name) >= 60).length;
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

        // Atividade dos últimos 7 dias
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const atividade = Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
          d.setHours(0, 0, 0, 0);
          const fim = new Date(d.getTime() + 24 * 60 * 60 * 1000);
          const pedroDay = pedroLeads.filter(l => { const t = new Date(l.created_at); return t >= d && t < fim; }).length;
          const marcosDay = marcosLeads.filter(l => { const t = new Date(l.created_at); return t >= d && t < fim; }).length;
          return { dia: dias[d.getDay()], pedro: pedroDay, marcos: marcosDay, total: pedroDay + marcosDay };
        });

        setMainData({
          pedro, marcos,
          combined: {
            totalLeads, leadsHoje, atribuidos, taxaAtribuicao: taxaAtrib,
            qualidadeMedia: qMedia, qualidadeLabel: qLabel,
            qualificados, pctQualificados: pctQual,
          },
          atividade,
        });
      } catch (err) {
        console.error('[PainelGeral] erro main:', err);
      } finally {
        if (!cancelled) setMainLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user?.id, profileLoading, isSeller, dateRange.start, dateRange.end]);

  // ── useEffect RANKING: filtros INDEPENDENTES (rankPeriod + rankSellerId) ──
  useEffect(() => {
    if (!user?.id || profileLoading || isSeller) return;

    let cancelled = false;
    async function loadRanking() {
      setRankingLoading(true);
      try {
        const pedroQ = (supabase as any).from('ai_crm_leads')
          .select('id, status_crm, assigned_to_id, seller_notes_count')
          .eq('user_id', user!.id)
          .gte('created_at', rankDateRange.start).lte('created_at', rankDateRange.end);
        const marcosQ = (supabase as any).from('crm_leads')
          .select('id, stage_id, assigned_to, seller_notes_count, stage:crm_pipeline_stages(name)')
          .eq('user_id', user!.id)
          .gte('created_at', rankDateRange.start).lte('created_at', rankDateRange.end);
        const sellersQ = (supabase as any).from('ai_team_members')
          .select('id, name')
          .eq('user_id', user!.id).eq('is_active', true);

        if (rankSellerId !== 'all') {
          pedroQ.eq('assigned_to_id', rankSellerId);
          marcosQ.eq('assigned_to', rankSellerId);
        }

        const [pedroRes, marcosRes, sellersRes] = await Promise.all([pedroQ, marcosQ, sellersQ]);
        if (cancelled) return;

        type PedroLeadR = { id: string; status_crm: string | null; assigned_to_id: string | null; seller_notes_count: number | null };
        type MarcosLeadR = { id: string; stage_id: string | null; assigned_to: string | null; seller_notes_count: number | null; stage: { name: string } | null };

        const pedroLeads = (pedroRes.data || []) as PedroLeadR[];
        const marcosLeads = (marcosRes.data || []) as MarcosLeadR[];
        const sellers = (sellersRes.data || []) as Array<{ id: string; name: string }>;

        // Feedbacks pra calcular qualidade
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

        const pedroScores: number[] = pedroLeads.map(l => {
          const ia = scorePedroStatus(l.status_crm);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          return combineQuality(ia, fb, scoreNotes(l.seller_notes_count));
        });
        const marcosScores: number[] = marcosLeads.map(l => {
          const ia = scoreMarcosStage(l.stage?.name);
          const fb = fbByLead.get(l.id) ? scoreFb(fbByLead.get(l.id)) : null;
          return combineQuality(ia, fb, scoreNotes(l.seller_notes_count));
        });

        const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

        // Quando filtra por vendedor X: só ele aparece no ranking.
        // Quando 'all': todos os vendedores ativos, mesmo com 0 leads.
        const sellerMap = new Map<string, {
          id: string; nome: string; pedroLeads: number; marcosLeads: number;
          scores: number[]; qualificados: number;
        }>();
        const targetSellers = rankSellerId === 'all'
          ? sellers
          : sellers.filter(s => s.id === rankSellerId);
        for (const s of targetSellers) {
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
        const rankRows: RankingRow[] = Array.from(sellerMap.values())
          .map(s => ({
            id: s.id, nome: s.nome,
            pedroLeads: s.pedroLeads, marcosLeads: s.marcosLeads,
            total: s.pedroLeads + s.marcosLeads,
            qualificados: s.qualificados,
            qualidadeMedia: avg(s.scores),
          }))
          .sort((a, b) => b.total - a.total);

        setRanking(rankRows);
      } catch (err) {
        console.error('[PainelGeral] erro ranking:', err);
      } finally {
        if (!cancelled) setRankingLoading(false);
      }
    }

    loadRanking();
    return () => { cancelled = true; };
  }, [user?.id, profileLoading, isSeller, rankDateRange.start, rankDateRange.end, rankSellerId]);

  // Vendedor não pode ver — redireciona
  if (!profileLoading && isSeller) {
    return <Navigate to="/dashboard" replace />;
  }

  if (mainLoading || !mainData) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  const { pedro, marcos, combined, atividade } = mainData;
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

          {/* ── Filtro GLOBAL de Data (Dia/Semana/Mês/Personalizado) ──
              Vendedor MOVIDO pro card de Ranking (filtros independentes). */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              <CalendarIcon className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" />
              Período
            </span>
            <div className="flex items-center gap-1 bg-card/60 rounded-lg p-1 border border-border/50">
              {PERIOD_OPTIONS.map(opt => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => handlePeriodChange(opt.id)}
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
                <Button
                  size="sm"
                  onClick={handleApplyCustom}
                  disabled={
                    !customRange.start || !customRange.end ||
                    (customRange.start === appliedCustomRange.start &&
                     customRange.end === appliedCustomRange.end)
                  }
                  className="h-7 px-3 text-xs"
                >
                  Aplicar
                </Button>
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

        {/* ── Ranking de Equipe (filtros INDEPENDENTES do global) ────────── */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-cyan-400" />
                  Ranking de Equipe
                </CardTitle>
                <CardDescription className="text-xs">
                  Leads recebidos por vendedor — {rankDateRange.label.toLowerCase()}
                </CardDescription>
              </div>

              {/* Filtros próprios do Ranking (vendedor + período) */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Vendedor */}
                <Select value={rankSellerId} onValueChange={handleRankSellerChange}>
                  <SelectTrigger className="w-[180px] bg-card/60 border-border/50 h-8 text-xs">
                    <UserCircle2 className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                    <SelectValue placeholder="Todos os vendedores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os vendedores</SelectItem>
                    {allSellers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Período do ranking — botões segmentados compactos */}
                <div className="flex items-center gap-1 bg-card/60 rounded-lg p-1 border border-border/50">
                  {PERIOD_OPTIONS.map(opt => {
                    const active = rankPeriod === opt.id;
                    // label compacto pra caber: "Personalizado" → "Custom"
                    const compactLabel = opt.id === 'custom' ? 'Custom' : opt.label;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleRankPeriodChange(opt.id)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                          active
                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
                        }`}
                      >
                        {compactLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Custom date inputs do ranking (quando rankPeriod=custom) */}
            {rankPeriod === 'custom' && (
              <div className="flex items-center gap-1.5 text-xs mt-2 flex-wrap">
                <input type="date" value={rankCustomRange.start} max={rankCustomRange.end}
                  onChange={e => setRankCustomRange(r => ({ ...r, start: e.target.value }))}
                  className="bg-card/60 border border-border/50 rounded px-2 py-1" />
                <span className="text-muted-foreground">até</span>
                <input type="date" value={rankCustomRange.end} min={rankCustomRange.start}
                  onChange={e => setRankCustomRange(r => ({ ...r, end: e.target.value }))}
                  className="bg-card/60 border border-border/50 rounded px-2 py-1" />
                <Button
                  size="sm"
                  onClick={handleApplyRankCustom}
                  disabled={
                    !rankCustomRange.start || !rankCustomRange.end ||
                    (rankCustomRange.start === rankAppliedCustomRange.start &&
                     rankCustomRange.end === rankAppliedCustomRange.end)
                  }
                  className="h-7 px-3 text-xs"
                >
                  Aplicar
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {rankingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
              </div>
            ) : !ranking || ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {rankSellerId === 'all'
                  ? 'Nenhum vendedor ativo no período.'
                  : 'Esse vendedor não recebeu leads no período.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Rank</th>
                      <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Vendedor</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-blue-400 font-bold">Pedro</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-purple-400 font-bold">Marcos</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-foreground font-bold">Leads Recebidos</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Qualif.</th>
                      <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wider text-amber-400 font-bold">Qualidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((v, idx) => (
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
        {!mainData && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <AlertCircle className="h-8 w-8 opacity-40" />
            <p className="text-sm">Não foi possível carregar dados.</p>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
