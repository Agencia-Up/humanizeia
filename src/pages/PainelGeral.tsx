// ============================================================================
// PainelGeral
// ----------------------------------------------------------------------------
// Dashboard executivo que SOMA + média Pedro + Marcos.
//
// Não é o Dashboard TV (esse é pra projetar em TV). Painel Geral é uma página
// admin tradicional com:
//   • KPIs combinados (totais e médias dos 2 CRMs)
//   • Comparativo lado a lado: Pedro vs Marcos
//   • Ranking unificado de vendedores (soma leads dos 2 CRMs)
//   • Filtro de período (Hoje/Ontem/7d/30d/Custom)
//
// Acesso (29/05/2026):
//   • master   → agregado de TODOS os vendedores + ranking geral.
//   • vendedor → MESMA página re-escopada: vê SÓ os próprios leads
//                (assigned_to ∈ ids dele em ai_team_members); ranking de
//                colegas oculto. Liberado pelo master via
//                visible_features.sidebar_painel_geral.
// Sidebar: grupo "Painel", item "Painel Geral".
// ============================================================================

import { useEffect, useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { ComercialSection } from '@/components/comercial/ComercialSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Users, Trophy, ArrowRightLeft, BarChart3, Bot, Layers,
  Calendar as CalendarIcon, TrendingUp, CheckCircle2, AlertCircle,
  UserCheck, Megaphone, Target, Clock, Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
// [Unificado 05/06/2026] Reaproveita hook de dados + componentes do antigo
// Dashboard (CommercialDashboard) — funis, alertas, origem, transferencias,
// retomadas — pra tudo viver dentro do Painel Geral, sem duplicar grafico/ranking.
import { useCommercialDashboardData, CompactKpi, FunnelPanel } from './CommercialDashboard';

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
    /** Funil de vendas (Pedro + Marcos) — período selecionado. */
    perdidos: number;
    vendas: number;          // vendas concluídas (comercial_vendas) no período
    conversao: number;       // % = vendas / atendidos (atribuídos)
    /** Tempo médio (dias) entre a entrada do lead e a venda. 0 se sem dados. */
    tempoMedioDias: number;
  };
  /** [{ dia, pedro, marcos, total }] últimos 7 dias */
  atividade: Array<{ dia: string; pedro: number; marcos: number; total: number }>;
  /** Ranking unificado por vendedor (soma dos 2 CRMs) */
  vendedores: Array<{
    id: string;
    nome: string;
    pedroLeads: number;
    marcosLeads: number;
    total: number;           // atendidos (leads atribuídos ao vendedor)
    qualificados: number;
    perdidos: number;
    vendas: number;
    conversao: number;       // % = vendas / atendidos
    qualidadeMedia: number;
  }>;
  /** Rastreamento das vendas concluídas no período (auditoria: data + vendedor + dias até a venda). */
  vendasList: Array<{ id: string; data: string; sellerNome: string; origemLabel: string; valor: number; dias: number | null }>;
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
    'fechado': 100, 'venda concluida': 100, 'negociacao': 85, 'agendamento': 60, 'porta/loja': 30,
    'marketing place': 20, 'leads inativos': 0, 'nao tem no estoque': 0,
    'novo lead': 20, 'proposta': 75, 'perdido': 0, 'leads perdidos': 0,
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

// ─── Funil de vendas (regras acordadas) ─────────────────────────────────────
// Rótulo da origem comercial (comercial_vendas.origem) -> texto amigável.
const ORIGEM_VENDA_LABEL: Record<string, string> = {
  trafego: 'Tráfego', portais: 'Portais', porta: 'Porta', particular: 'Particular',
};
function brlMoney(n: number): string {
  return (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function normStage(name: string | null | undefined): string {
  return (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
// PEDRO qualificado = "qualquer grau + em diante": tudo que saiu de novo/inativo/
// perdido/carro indisponível (pouco/médio/qualificado, agendamento, negociação, venda).
function pedroEhQualificado(status: string | null | undefined): boolean {
  return !!status && !['novo', 'inativo', 'perdido', 'carro_nao_disponivel'].includes(status);
}
// MARCOS perdido = etapa cujo nome contém "perdid" (Perdido / Leads Perdidos).
function marcosEhPerdido(stageName: string | null | undefined): boolean {
  return normStage(stageName).includes('perdid');
}
// Dias entre a entrada do lead e a venda (datas 'YYYY-MM-DD'). null se faltar dado.
function diasEntre(criado?: string | null, venda?: string | null): number | null {
  if (!criado || !venda) return null;
  const ms = new Date(venda + 'T00:00:00').getTime() - new Date(criado + 'T00:00:00').getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
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
  const { isSeller, masterUserId, memberIds, loading: profileLoading } = useSellerProfile(user?.id);

  const [period, setPeriod] = useState<PeriodPreset>('30days');
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date(); const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 29);
    return { start: toDateInput(weekAgo), end: toDateInput(today) };
  });
  const [data, setData] = useState<CombinedData | null>(null);
  const [loading, setLoading] = useState(true);
  // Realtime: incrementa pra forçar o load() a rodar de novo quando um lead/venda muda.
  const [reloadTrigger, setReloadTrigger] = useState(0);
  // Filtro GLOBAL de vendedor (só master): re-escopa o painel inteiro pra um vendedor.
  // null = todos (loja). Vendedor logado não usa (já vê só os próprios dados).
  const [globalSellerId, setGlobalSellerId] = useState<string | null>(null);

  const dateRange = resolveDateRange(period, customRange);

  // [Unificado] Dados extras do antigo Dashboard (funis, alertas, origem,
  // transferencias, retomadas), no MESMO periodo selecionado aqui.
  const navigate = useNavigate();
  const { data: dashData } = useCommercialDashboardData(user?.id, dateRange, isSeller ? null : globalSellerId);

  useEffect(() => {
    if (!user?.id || profileLoading) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

        // Escopo dos dados:
        //   • master   → user_id = próprio id; vê todos os vendedores (ranking).
        //   • vendedor → user_id = master (dono dos leads) e filtra só os DELE
        //                (assigned_to ∈ ids dele em ai_team_members). Ranking oculto.
        //                Mesmo padrão de PedroSDR/FluxCRM (memberIds por auth_user_id).
        let ownerId = user!.id;
        let memberIds: string[] = [];
        if (isSeller) {
          const { data: memberRows } = await (supabase as any)
            .from('ai_team_members')
            .select('id, user_id')
            .eq('auth_user_id', user!.id);
          if (cancelled) return;
          const rows = (memberRows || []) as Array<{ id: string; user_id: string }>;
          memberIds = rows.map(r => r.id);
          ownerId = rows[0]?.user_id || masterUserId || user!.id;
        }
        // UUID-sentinela: vendedor sem vínculo → 0 resultados (nunca varre o master).
        const safeIds = memberIds.length > 0 ? memberIds : ['00000000-0000-0000-0000-000000000000'];

        let pedroQuery = (supabase as any).from('ai_crm_leads')
          .select('id, status_crm, assigned_to_id, seller_notes_count, created_at')
          .eq('user_id', ownerId)
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end);
        // NOTA: crm_leads NÃO tem seller_notes_count (só ai_crm_leads do Pedro).
        // Pedir essa coluna fazia a query inteira falhar em silêncio -> Marcos 0.
        let marcosQuery = (supabase as any).from('crm_leads')
          .select('id, stage_id, assigned_to, created_at, stage:crm_pipeline_stages(name)')
          .eq('user_id', ownerId)
          .gte('created_at', dateRange.start).lte('created_at', dateRange.end);
        if (isSeller) {
          pedroQuery = pedroQuery.in('assigned_to_id', safeIds);
          marcosQuery = marcosQuery.in('assigned_to', safeIds);
        } else if (globalSellerId) {
          // Master com filtro global de vendedor: re-escopa tudo pra ele.
          pedroQuery = pedroQuery.eq('assigned_to_id', globalSellerId);
          marcosQuery = marcosQuery.eq('assigned_to', globalSellerId);
        }
        // Ranking de vendedores só pro master — vendedor não enxerga colegas.
        const sellersPromise = isSeller
          ? Promise.resolve({ data: [] as any[] })
          : (supabase as any).from('ai_team_members').select('*').eq('user_id', ownerId);

        // Vendas concluídas do período (comercial_vendas = cruza Pedro+Marcos+manual,
        // com data e vendedor). Filtra por data_venda (YYYY-MM-DD).
        const periodStartKey = toDateInput(new Date(dateRange.start));
        const periodEndKey = toDateInput(new Date(dateRange.end));
        let vendasQuery = (supabase as any).from('comercial_vendas')
          .select('id, seller_id, data_venda, origem, valor, lead_criado_em')
          .eq('user_id', ownerId)
          .gte('data_venda', periodStartKey).lte('data_venda', periodEndKey);
        if (isSeller) vendasQuery = vendasQuery.in('seller_id', safeIds);
        else if (globalSellerId) vendasQuery = vendasQuery.eq('seller_id', globalSellerId);

        // 4 queries paralelas
        const [pedroRes, marcosRes, sellersRes, vendasRes] = await Promise.all([
          pedroQuery, marcosQuery, sellersPromise, vendasQuery,
        ]);
        if (cancelled) return;

        type PedroLead = { id: string; status_crm: string | null; assigned_to_id: string | null; seller_notes_count: number | null; created_at: string };
        type MarcosLead = { id: string; stage_id: string | null; assigned_to: string | null; seller_notes_count: number | null; created_at: string; stage: { name: string } | null };

        const pedroLeads = (pedroRes.data || []) as PedroLead[];
        const marcosLeads = (marcosRes.data || []) as MarcosLead[];
        // Vendedores ATIVOS NO SISTEMA (não filtra pelo status do agente de IA).
        const sellers = ((sellersRes.data || []) as any[]).filter((s: any) => s.active_in_system !== false) as Array<{ id: string; name: string }>;

        // Vendas concluídas do período (comercial_vendas). Conta por vendedor e
        // monta a lista de rastreamento (data + vendedor + origem + valor).
        const vendas = (vendasRes.data || []) as Array<{ id: string; seller_id: string | null; data_venda: string; origem: string | null; valor: number | string | null; lead_criado_em: string | null }>;
        const sellerNameById = new Map(sellers.map(s => [s.id, s.name]));
        const vendasBySeller = new Map<string, number>();
        for (const v of vendas) {
          if (v.seller_id) vendasBySeller.set(v.seller_id, (vendasBySeller.get(v.seller_id) || 0) + 1);
        }
        const vendasTotal = vendas.length;
        // Tempo médio até a venda (só vendas que têm a data de entrada do lead).
        const temposVenda = vendas
          .map(v => diasEntre(v.lead_criado_em, v.data_venda))
          .filter((d): d is number => d !== null);
        const tempoMedioDias = temposVenda.length > 0
          ? Math.round(temposVenda.reduce((a, b) => a + b, 0) / temposVenda.length)
          : 0;
        const vendasList = [...vendas]
          .sort((a, b) => (b.data_venda || '').localeCompare(a.data_venda || ''))
          .slice(0, 50)
          .map(v => ({
            id: v.id,
            data: v.data_venda,
            sellerNome: (v.seller_id && sellerNameById.get(v.seller_id)) || 'Vendedor',
            origemLabel: ORIGEM_VENDA_LABEL[v.origem || ''] || 'Particular',
            valor: Number(v.valor) || 0,
            dias: diasEntre(v.lead_criado_em, v.data_venda),
          }));

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
        const pedroQualificados = pedroLeads.filter(l => pedroEhQualificado(l.status_crm)).length;
        const pedroPerdidos = pedroLeads.filter(l => l.status_crm === 'perdido').length;
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
          return score >= 60; // Agendamento / Negociação / Venda concluída
        }).length;
        const marcosPerdidos = marcosLeads.filter(l => marcosEhPerdido(l.stage?.name)).length;
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
        // Funil de vendas: perdidos (Pedro+Marcos) e conversão = vendas ÷ atendidos
        // (atendidos = leads atribuídos a vendedor). Trata divisão por zero.
        const perdidos = pedroPerdidos + marcosPerdidos;
        const conversao = atribuidos > 0 ? Math.round((vendasTotal / atribuidos) * 100) : 0;

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

        // Ranking unificado de vendedores (+ funil: qualificados/perdidos/vendas/conversão)
        const sellerMap = new Map<string, {
          id: string; nome: string; pedroLeads: number; marcosLeads: number;
          scores: number[]; qualificados: number; perdidos: number;
        }>();
        for (const s of sellers) {
          sellerMap.set(s.id, { id: s.id, nome: s.name, pedroLeads: 0, marcosLeads: 0, scores: [], qualificados: 0, perdidos: 0 });
        }
        pedroLeads.forEach((l, idx) => {
          if (!l.assigned_to_id) return;
          const sObj = sellerMap.get(l.assigned_to_id);
          if (!sObj) return;
          sObj.pedroLeads++;
          sObj.scores.push(pedroScores[idx]);
          if (pedroEhQualificado(l.status_crm)) sObj.qualificados++;
          if (l.status_crm === 'perdido') sObj.perdidos++;
        });
        marcosLeads.forEach((l, idx) => {
          if (!l.assigned_to) return;
          const sObj = sellerMap.get(l.assigned_to);
          if (!sObj) return;
          sObj.marcosLeads++;
          sObj.scores.push(marcosScores[idx]);
          if (scoreMarcosStage(l.stage?.name) >= 60) sObj.qualificados++;
          if (marcosEhPerdido(l.stage?.name)) sObj.perdidos++;
        });
        const vendedoresRank = Array.from(sellerMap.values())
          .map(s => {
            const atend = s.pedroLeads + s.marcosLeads;
            const vendasSeller = vendasBySeller.get(s.id) || 0;
            return {
              id: s.id, nome: s.nome,
              pedroLeads: s.pedroLeads, marcosLeads: s.marcosLeads,
              total: atend,
              qualificados: s.qualificados,
              perdidos: s.perdidos,
              vendas: vendasSeller,
              conversao: atend > 0 ? Math.round((vendasSeller / atend) * 100) : 0,
              qualidadeMedia: avg(s.scores),
            };
          })
          .sort((a, b) => b.total - a.total);

        setData({
          pedro, marcos,
          combined: {
            totalLeads, leadsHoje, atribuidos, taxaAtribuicao: taxaAtrib,
            qualidadeMedia: qMedia, qualidadeLabel: qLabel,
            qualificados, pctQualificados: pctQual,
            perdidos, vendas: vendasTotal, conversao, tempoMedioDias,
          },
          atividade,
          vendedores: vendedoresRank,
          vendasList,
        });
      } catch (err) {
        console.error('[PainelGeral] erro:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [user?.id, profileLoading, isSeller, masterUserId, dateRange.start, dateRange.end, reloadTrigger, globalSellerId]);

  // ── Realtime: atualiza o painel quando muda lead (Pedro/Marcos) ou venda.
  // Recarrega via reloadTrigger (debounce 1s pra agrupar bursts). Escopo = loja.
  useEffect(() => {
    if (!user?.id || profileLoading) return;
    const ownerId = isSeller ? (masterUserId || user.id) : user.id;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => setReloadTrigger(t => t + 1), 1000); };
    const channel = supabase
      .channel(`painel-geral-${ownerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_crm_leads', filter: `user_id=eq.${ownerId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_leads', filter: `user_id=eq.${ownerId}` }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comercial_vendas', filter: `user_id=eq.${ownerId}` }, bump)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [user?.id, profileLoading, isSeller, masterUserId]);

  if (loading || !data) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  const { pedro, marcos, combined, atividade, vendedores, vendasList } = data;
  const qColor =
    combined.qualidadeMedia >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
    combined.qualidadeMedia >= 60 ? 'bg-blue-500/15 text-blue-400' :
    combined.qualidadeMedia >= 40 ? 'bg-amber-500/15 text-amber-400' :
    'bg-red-500/15 text-red-400';

  // [Unificado] Origem e conversao (derivado dos dados do antigo Dashboard).
  const dTotal = dashData.pedroTotal + dashData.marcosTotal;
  const paidShare = dTotal > 0 ? Math.round((dashData.pedroTotal / dTotal) * 100) : 0;
  const manualShare = dTotal > 0 ? 100 - paidShare : 0;
  // Casa pelo nome novo ("Venda concluída") e pelo legado ("Fechado").
  const isClosedLabel = (l: string) => { const n = (l || '').toLowerCase(); return n.includes('venda conclu') || n.includes('fechado'); };
  const closedPedro = dashData.pedroFunnel.find(i => isClosedLabel(i.label))?.value || 0;
  const closedMarcos = dashData.marcosFunnel.find(i => isClosedLabel(i.label))?.value || 0;
  const closedCount = closedPedro + closedMarcos;
  // "Fechados" é CONVERSÃO (vendas / total de leads), não divisão de origem.
  // Quando é < 1% (mas > 0), mostra 1 casa decimal pra não arredondar pra "0%"
  // enganoso (ex.: 3 de 1.112 = 0,27% -> "0,3%").
  const closedPct = dTotal > 0 ? (closedCount / dTotal) * 100 : 0;
  const closedRateLabel = closedPct > 0 && closedPct < 1
    ? `${closedPct.toFixed(1).replace('.', ',')}%`
    : `${Math.round(closedPct)}%`;
  const originCards = [
    { label: 'IA / Pago', value: `${paidShare}%`, sub: `${dashData.pedroTotal} leads do Pedro`, color: 'bg-blue-500/15 text-blue-300' },
    { label: 'Manual', value: `${manualShare}%`, sub: `${dashData.marcosTotal} leads do Marcos`, color: 'bg-purple-500/15 text-purple-300' },
    { label: 'Vendas fechadas', value: `${closedCount}`, sub: `${closedRateLabel} de conversão · de ${dTotal.toLocaleString('pt-BR')} leads`, color: 'bg-emerald-500/15 text-emerald-300' },
  ];

  return (
    <MainLayout>
      <div className="space-y-6 p-4 lg:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Painel Geral</h1>
            <p className="text-sm text-muted-foreground">
              {isSeller
                ? 'Seus leads — Pedro (Tráfego Pago) + Marcos (Outros canais)'
                : 'Soma e média Pedro (Tráfego Pago) + Marcos (Outros canais)'}
            </p>
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
            {/* Filtro GLOBAL de vendedor — re-escopa o painel inteiro (só master). */}
            {!isSeller && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Vendedor</span>
                <Select value={globalSellerId || '__all__'} onValueChange={(v) => setGlobalSellerId(v === '__all__' ? null : v)}>
                  <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Vendedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos os vendedores</SelectItem>
                    {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {/* ── Gestão Comercial (vendas/metas) — bloco integrado ────────────── */}
        {!profileLoading && (isSeller ? masterUserId : user?.id) && (
          <ComercialSection
            periodStart={dateRange.start}
            periodEnd={dateRange.end}
            periodLabel={dateRange.label}
            isSeller={isSeller}
            ownerUserId={(isSeller ? masterUserId : user?.id) as string}
            currentSellerId={isSeller ? (memberIds[0] || null) : null}
            externalSellerId={isSeller ? undefined : globalSellerId}
          />
        )}

        {/* ── Funil de vendas por vendedor (Pedro + Marcos) ────────────────── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Target className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-bold">Funil de vendas por vendedor</h2>
            <span className="text-xs text-muted-foreground">Pedro + Marcos · {dateRange.label}</span>
          </div>

          {/* Resumo do funil (período) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard label="Atendidos" value={combined.atribuidos} sub="leads atribuídos a vendedor" icon={UserCheck} color="bg-blue-500/15 text-blue-400" />
            <MetricCard label="Qualificados" value={combined.qualificados} sub={`${combined.pctQualificados}% do total`} icon={CheckCircle2} color="bg-emerald-500/15 text-emerald-400" />
            <MetricCard label="Perdidos" value={combined.perdidos} sub="marcados como perdido" icon={AlertCircle} color="bg-red-500/15 text-red-400" />
            <MetricCard label="Vendas" value={combined.vendas} sub="vendas concluídas" icon={TrendingUp} color="bg-violet-500/15 text-violet-400" />
            <MetricCard label="Conversão média" value={`${combined.conversao}%`} sub="vendas / atendidos" icon={Target} color="bg-amber-500/15 text-amber-400" />
            <MetricCard label="Tempo até vender" value={combined.tempoMedioDias > 0 ? `${combined.tempoMedioDias} d` : '—'} sub="média lead → venda" icon={Clock} color="bg-cyan-500/15 text-cyan-400" />
          </div>

          {/* Desempenho por vendedor — só master */}
          {!isSeller && (
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" /> Desempenho por vendedor
                  <span className="text-[11px] text-muted-foreground font-normal">· ordenado por conversão</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                      <th className="py-2 pr-2">Vendedor</th>
                      <th className="py-2 px-2 text-center">Atendidos</th>
                      <th className="py-2 px-2 text-center">Qualif.</th>
                      <th className="py-2 px-2 text-center">Perdidos</th>
                      <th className="py-2 px-2 text-center">Vendas</th>
                      <th className="py-2 pl-2 text-center">Conversão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendedores.length === 0 && (
                      <tr><td colSpan={6} className="py-6 text-center text-muted-foreground text-xs">Nenhum vendedor com leads no período.</td></tr>
                    )}
                    {[...vendedores].filter(v => !globalSellerId || v.id === globalSellerId).sort((a, b) => (b.conversao - a.conversao) || (b.vendas - a.vendas)).map(v => (
                      <tr key={v.id} className="border-b border-border/30 hover:bg-muted/30 transition-colors">
                        <td className="py-2 pr-2 font-medium truncate max-w-[200px]">{v.nome}</td>
                        <td className="py-2 px-2 text-center tabular-nums">{v.total}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-emerald-400">{v.qualificados}</td>
                        <td className="py-2 px-2 text-center tabular-nums text-red-400">{v.perdidos}</td>
                        <td className="py-2 px-2 text-center tabular-nums font-semibold text-violet-300">{v.vendas}</td>
                        <td className="py-2 pl-2 text-center">
                          <span className={`tabular-nums font-bold ${v.conversao >= 20 ? 'text-emerald-400' : v.conversao >= 10 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                            {v.total > 0 ? `${v.conversao}%` : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Rastreamento de vendas concluídas (auditoria: data + vendedor) */}
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Vendas concluídas no período
                <span className="text-[11px] text-muted-foreground font-normal">· {vendasList.length} no período</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vendasList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nenhuma venda concluída no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
                        <th className="py-2 pr-2">Data</th>
                        <th className="py-2 px-2">Vendedor</th>
                        <th className="py-2 px-2">Origem</th>
                        <th className="py-2 px-2 text-center">Dias até vender</th>
                        <th className="py-2 pl-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendasList.map(v => (
                        <tr key={v.id} className="border-b border-border/30">
                          <td className="py-2 pr-2 tabular-nums text-muted-foreground">{(v.data || '').split('-').reverse().join('/')}</td>
                          <td className="py-2 px-2 font-medium">{v.sellerNome}</td>
                          <td className="py-2 px-2 text-muted-foreground">{v.origemLabel}</td>
                          <td className="py-2 px-2 text-center tabular-nums text-cyan-300">{v.dias !== null ? `${v.dias} d` : '—'}</td>
                          <td className="py-2 pl-2 text-right tabular-nums">{v.valor > 0 ? brlMoney(v.valor) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
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

        {/* ── [Unificado] Operação: Transferências + Retomadas ─────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CompactKpi title="Transferencias" value={dashData.pedroTransferred} sub={`${dashData.pedroWaiting} aguardando acao`} icon={UserCheck} accent="bg-cyan-500/15 text-cyan-300" />
          <CompactKpi title="Retomadas" value={dashData.marcosFollowups} sub={`${dashData.marcosCampaigns} campanhas ativas`} icon={Megaphone} accent="bg-amber-500/15 text-amber-300" />
        </div>

        {/* ── [Unificado] Funil Pedro + Funil Marcos ───────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <FunnelPanel title="Funil Pedro" badge="IA responde e transfere" items={dashData.pedroFunnel} />
          <FunnelPanel title="Funil Marcos" badge="CRM manual" items={dashData.marcosFunnel} />
        </div>

        {/* ── [Unificado] Origem e conversão + Alertas inteligentes ────────── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
              <Target className="h-4 w-4 text-primary" />
              Origem e conversao
            </h3>
            <div className="grid gap-3">
              {originCards.map(card => (
                <div key={card.label} className="flex items-center justify-between rounded-xl border border-border/40 bg-background/35 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{card.label}</p>
                    <p className="text-xs text-muted-foreground">{card.sub}</p>
                  </div>
                  <span className={`rounded-xl px-3 py-1.5 text-xl font-bold ${card.color}`}>{card.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/70 p-5">
            <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
              <AlertCircle className="h-4 w-4 text-amber-300" />
              Alertas inteligentes
            </h3>
            <div className="space-y-3">
              {dashData.alerts.map(alert => {
                const Icon = alert.tone === 'good' ? CheckCircle2 : alert.tone === 'warn' ? AlertCircle : Clock;
                const tone = alert.tone === 'good'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : alert.tone === 'warn'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
                return (
                  <div key={alert.title} className={`flex gap-3 rounded-xl border p-3 ${tone}`}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{alert.title}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{alert.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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

        {/* ── Ranking de Vendedores (unificado) — só master (vendedor não vê colegas) ── */}
        {!isSeller && (
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
                    {vendedores.filter(v => !globalSellerId || v.id === globalSellerId).map((v, idx) => (
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
        )}

        {/* ── [Unificado] Ações sugeridas ──────────────────────────────────── */}
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-yellow-300" />
              Ações sugeridas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <button onClick={() => navigate('/pedro?tab=crm')} className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-left transition-colors hover:bg-blue-500/15">
                <p className="text-sm font-semibold text-foreground">Revisar leads do Pedro</p>
                <p className="text-xs text-muted-foreground">Acompanhar IA, transferencias e vendedores.</p>
              </button>
              <button onClick={() => navigate('/marcos?tab=performance')} className="rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-left transition-colors hover:bg-purple-500/15">
                <p className="text-sm font-semibold text-foreground">Ver performance do Marcos</p>
                <p className="text-xs text-muted-foreground">Campanhas, listas, follow-ups e CRM manual.</p>
              </button>
              <button onClick={() => navigate('/whatsapp/broadcast')} className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/15">
                <p className="text-sm font-semibold text-foreground">Criar campanha</p>
                <p className="text-xs text-muted-foreground">Retomar leads parados com seguranca.</p>
              </button>
            </div>
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
