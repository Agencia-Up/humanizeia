// ============================================================================
// CampanhaAnalytics — Dashboard de Tráfego Pago / Inteligência de Leads
// ----------------------------------------------------------------------------
// Renderizado dentro do Pedro → aba "Tráfego" (apenas Master).
//
// ANÁLISES DISPONÍVEIS (sem precisar da API do Meta):
//
// 1. Veículos de Interesse × Qualificação
//    → ai_crm_leads.vehicle_interest (preenchido automaticamente pelo agente)
//    → Revela quais modelos trazem leads que fecham
//
// 2. Forma de Pagamento × Qualificação
//    → ai_crm_leads.payment_method (à vista / financiado / troca)
//    → Perfil financeiro dos leads
//
// 3. Cidades × Qualificação
//    → ai_crm_leads.client_city (coletado pelo agente na conversa)
//    → Geolocalização de leads com maior ROI
//
// 4. Canal de Origem × Qualificação
//    → ai_crm_leads.origem + origem_outros
//    → ROI por canal (tráfego pago, orgânico, porta, OLX...)
//
// 5. Campanha/UTM × Qualificação (para leads Meta Cloud API)
//    → wa_contacts.utm_source/utm_campaign (Click-to-WhatsApp)
//    → Dados de campanha paga quando disponível
//
// 6. Evolução Temporal de Leads
//    → Volume + qualificação por semana/mês
//
// Fonte de dados: ai_crm_leads + wa_contacts (join por telefone)
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Cell, PieChart, Pie, LineChart, Line, AreaChart, Area,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  TrendingUp, Users, Target, Filter, Loader2, Info, Award, Download, FileText,
  Car, CreditCard, MapPin, BarChart3, Zap, Activity,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { downloadReportPdf } from './reportPdf';

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface RawLead {
  id: string;
  remote_jid: string | null;
  origem: string | null;
  origem_outros: string | null;
  status_crm: string | null;
  status: string | null;
  vehicle_interest: string | null;
  client_city: string | null;
  payment_method: string | null;
  created_at: string;
}
interface UtmRecord {
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_content: string | null;
}

type Period = 'today' | '7d' | '30d' | '90d' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: '90d', label: '90 dias' },
  { id: 'all', label: 'Tudo' },
];

// ─── Qualificação (3 níveis SDR) ────────────────────────────────────────────
const QUAL = {
  qualificado:       { label: 'Qualificado',       color: '#34d399', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  pouco_qualificado: { label: 'Pouco qualificado', color: '#fbbf24', bg: 'bg-amber-500/15',   text: 'text-amber-400'   },
  inativo:           { label: 'Inativo',           color: '#94a3b8', bg: 'bg-slate-500/15',   text: 'text-slate-400'   },
} as const;
type QualKey = keyof typeof QUAL;

function bucket(statusCrm: string | null): QualKey | 'outros' {
  const s = (statusCrm || '').toLowerCase();
  if (s === 'qualificado') return 'qualificado';
  if (s === 'pouco_qualificado') return 'pouco_qualificado';
  if (s === 'inativo') return 'inativo';
  return 'outros';
}

// ─── Labels de origem ───────────────────────────────────────────────────────
const ORIGEM_LABELS: Record<string, string> = {
  trafico_pago: 'Tráfego Pago', trafego_pago: 'Tráfego Pago',
  organico: 'Orgânico', instagram: 'Instagram', facebook: 'Facebook',
  redes_sociais: 'Redes Sociais', whatsapp: 'WhatsApp',
  porta: 'Porta / Loja', olx: 'OLX', marketplace: 'Marketplace',
  site: 'Site', indicacao: 'Indicação', importacao: 'Importação', outros: 'Outros',
};
function origemLabel(origem: string | null, origemOutros: string | null): string {
  if (origemOutros?.trim()) return origemOutros.trim();
  const o = (origem || '').toLowerCase();
  return ORIGEM_LABELS[o] || (o ? o.charAt(0).toUpperCase() + o.slice(1) : 'Sem origem');
}

// ─── Labels de pagamento ────────────────────────────────────────────────────
const PAYMENT_LABELS: Record<string, string> = {
  'a_vista': 'À Vista', 'avista': 'À Vista', 'à vista': 'À Vista',
  'financiado': 'Financiado', 'financiamento': 'Financiado',
  'troca': 'Troca/Permuta', 'permuta': 'Troca/Permuta',
  'consorcio': 'Consórcio',
};
const PAYMENT_COLORS: Record<string, string> = {
  'À Vista': '#34d399', 'Financiado': '#60a5fa', 'Troca/Permuta': '#a78bfa',
  'Consórcio': '#fbbf24',
};
function paymentLabel(p: string | null): string {
  if (!p) return 'Não informado';
  const l = p.toLowerCase();
  for (const [k, v] of Object.entries(PAYMENT_LABELS)) {
    if (l.includes(k)) return v;
  }
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// ─── Telefone (normalização + chaves de match) ──────────────────────────────
function digits(s: string | null | undefined): string { return (s || '').replace(/\D/g, ''); }
function phoneKeys(d: string): string[] {
  const keys: string[] = [];
  if (d) keys.push(d);
  if (d.length >= 8) keys.push(d.slice(-8));
  return keys;
}

function periodCutoff(period: Period): number {
  const now = Date.now();
  switch (period) {
    case 'today': return new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    case '7d': return now - 7 * 24 * 60 * 60 * 1000;
    case '30d': return now - 30 * 24 * 60 * 60 * 1000;
    case '90d': return now - 90 * 24 * 60 * 60 * 1000;
    case 'all': return 0;
  }
}

function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Tooltip customizado ────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2.5 shadow-xl min-w-[120px]">
      {label && <p className="text-[10px] text-slate-400 mb-1.5 font-medium">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <div className="h-2 w-2 rounded-full shrink-0" style={{ background: p.fill || p.color || p.stroke }} />
          <span className="text-slate-300">{p.name ? `${p.name}: ` : ''}</span>
          <span className="font-bold text-white">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

interface GroupRow {
  key: string; label: string; sub: string; isUtm: boolean;
  total: number; qualificado: number; pouco_qualificado: number; inativo: number; outros: number;
}

interface VehicleRow { veiculo: string; total: number; qualificado: number; pouco_qualificado: number; inativo: number; }
interface CityRow { cidade: string; total: number; qualificado: number; pct: number; }
interface PaymentRow { metodo: string; total: number; qualificado: number; pct: number; fill: string; }
interface WeekRow { semana: string; total: number; qualificado: number; pouco_qualificado: number; inativo: number; }

export function CampanhaAnalytics({ masterUserId }: { masterUserId: string }) {
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<RawLead[]>([]);
  const [utmByPhone, setUtmByPhone] = useState<Map<string, UtmRecord>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!masterUserId) { setLoading(false); return; }
      setLoading(true);
      try {
        const [leadsRes, contactsRes] = await Promise.all([
          (supabase as any)
            .from('ai_crm_leads')
            .select('id, remote_jid, origem, origem_outros, status_crm, status, vehicle_interest, client_city, payment_method, created_at')
            .eq('user_id', masterUserId)
            .order('created_at', { ascending: false })
            .limit(10000),
          (supabase as any)
            .from('wa_contacts')
            .select('phone, utm_source, utm_campaign, utm_medium, utm_content')
            .eq('user_id', masterUserId)
            .limit(20000),
        ]);
        if (cancelled) return;

        const map = new Map<string, UtmRecord>();
        for (const c of (contactsRes.data || []) as any[]) {
          if (!c.utm_source && !c.utm_campaign) continue;
          const rec: UtmRecord = {
            utm_source: c.utm_source ?? null, utm_campaign: c.utm_campaign ?? null,
            utm_medium: c.utm_medium ?? null, utm_content: c.utm_content ?? null,
          };
          for (const k of phoneKeys(digits(c.phone))) {
            if (!map.has(k)) map.set(k, rec);
          }
        }
        setUtmByPhone(map);
        setLeads((leadsRes.data || []) as RawLead[]);
      } catch {
        if (!cancelled) { setLeads([]); setUtmByPhone(new Map()); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [masterUserId]);

  const utmFor = (remoteJid: string | null): UtmRecord | null => {
    for (const k of phoneKeys(digits(remoteJid))) {
      const hit = utmByPhone.get(k);
      if (hit) return hit;
    }
    return null;
  };

  const data = useMemo(() => {
    const cutoff = periodCutoff(period);
    const filtered = leads.filter(l => new Date(l.created_at).getTime() >= cutoff);

    // ── KPIs principais ──────────────────────────────────────────────────────
    const totalLeads = filtered.length;
    let totQ = 0, totP = 0, totI = 0, totO = 0, comUtm = 0;

    // ── Campanhas/Origem × Qualificação ──────────────────────────────────────
    const campGroups = new Map<string, GroupRow>();
    for (const lead of filtered) {
      const b = bucket(lead.status_crm);
      if (b === 'qualificado') totQ++;
      else if (b === 'pouco_qualificado') totP++;
      else if (b === 'inativo') totI++;
      else totO++;

      const utm = utmFor(lead.remote_jid);
      let key: string, label: string, sub: string, isUtm: boolean;
      if (utm && (utm.utm_campaign || utm.utm_source)) {
        const camp = utm.utm_campaign || '(sem nome de campanha)';
        const src = utm.utm_source || '—';
        key = `utm|${src}|${camp}`; label = camp; sub = `UTM · ${src}`; isUtm = true; comUtm++;
      } else {
        const o = origemLabel(lead.origem, lead.origem_outros);
        key = `origem|${o}`; label = o; sub = 'Origem'; isUtm = false;
      }
      let row = campGroups.get(key);
      if (!row) { row = { key, label, sub, isUtm, total: 0, qualificado: 0, pouco_qualificado: 0, inativo: 0, outros: 0 }; campGroups.set(key, row); }
      row.total++;
      row[b]++;
    }
    const campRows = Array.from(campGroups.values()).sort((a, b) => b.total - a.total);
    const totalClassificados = totQ + totP + totI;
    const pctQualificado = totalClassificados > 0 ? Math.round((totQ / totalClassificados) * 100) : 0;
    const topCampRow = [...campRows].sort((a, b) => {
      if (b.qualificado !== a.qualificado) return b.qualificado - a.qualificado;
      const ra = a.qualificado / Math.max(1, a.qualificado + a.pouco_qualificado + a.inativo);
      const rb = b.qualificado / Math.max(1, b.qualificado + b.pouco_qualificado + b.inativo);
      return rb - ra;
    })[0];

    // ── Veículos de Interesse ────────────────────────────────────────────────
    const vehicleMap = new Map<string, VehicleRow>();
    let leadsComVeiculo = 0;
    for (const lead of filtered) {
      const v = (lead.vehicle_interest || '').trim();
      if (!v) continue;
      leadsComVeiculo++;
      // Normaliza: pega só as primeiras 3 palavras (evita ruído de versões)
      const vNorm = v.split(/\s+/).slice(0, 3).join(' ');
      let row = vehicleMap.get(vNorm);
      if (!row) { row = { veiculo: vNorm, total: 0, qualificado: 0, pouco_qualificado: 0, inativo: 0 }; vehicleMap.set(vNorm, row); }
      row.total++;
      const b = bucket(lead.status_crm);
      if (b === 'qualificado') row.qualificado++;
      else if (b === 'pouco_qualificado') row.pouco_qualificado++;
      else if (b === 'inativo') row.inativo++;
    }
    const topVehicles = Array.from(vehicleMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Top veículo mais qualificado
    const topVehicleByQual = [...topVehicles].sort((a, b) => {
      const ra = a.qualificado / Math.max(1, a.qualificado + a.pouco_qualificado + a.inativo);
      const rb = b.qualificado / Math.max(1, b.qualificado + b.pouco_qualificado + b.inativo);
      return rb - ra;
    })[0];

    // ── Cidades ──────────────────────────────────────────────────────────────
    const cityMap = new Map<string, CityRow>();
    for (const lead of filtered) {
      const c = (lead.client_city || '').trim();
      if (!c) continue;
      const cNorm = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
      let row = cityMap.get(cNorm);
      if (!row) { row = { cidade: cNorm, total: 0, qualificado: 0, pct: 0 }; cityMap.set(cNorm, row); }
      row.total++;
      if (bucket(lead.status_crm) === 'qualificado') row.qualificado++;
    }
    // Calcula pct depois
    for (const row of cityMap.values()) {
      row.pct = row.total > 0 ? Math.round((row.qualificado / row.total) * 100) : 0;
    }
    const topCitiesByVolume = Array.from(cityMap.values()).sort((a, b) => b.total - a.total).slice(0, 8);
    const topCitiesByQual = Array.from(cityMap.values()).filter(c => c.total >= 2).sort((a, b) => b.pct - a.pct).slice(0, 6);
    const topCity = topCitiesByVolume[0]?.cidade || '—';

    // ── Pagamento ────────────────────────────────────────────────────────────
    const paymentMap = new Map<string, PaymentRow>();
    let leadsComPagamento = 0;
    for (const lead of filtered) {
      if (!lead.payment_method) continue;
      leadsComPagamento++;
      const pm = paymentLabel(lead.payment_method);
      let row = paymentMap.get(pm);
      if (!row) { row = { metodo: pm, total: 0, qualificado: 0, pct: 0, fill: PAYMENT_COLORS[pm] || '#94a3b8' }; paymentMap.set(pm, row); }
      row.total++;
      if (bucket(lead.status_crm) === 'qualificado') row.qualificado++;
    }
    for (const row of paymentMap.values()) {
      row.pct = row.total > 0 ? Math.round((row.qualificado / row.total) * 100) : 0;
    }
    const paymentData = Array.from(paymentMap.values()).sort((a, b) => b.total - a.total);

    // ── Evolução Temporal (por semana) ───────────────────────────────────────
    const weekMap = new Map<string, WeekRow>();
    for (const lead of filtered) {
      const d = new Date(lead.created_at);
      // Semana: Segunda-feira da semana do lead
      const dow = d.getDay(); // 0=dom
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((dow + 6) % 7));
      const weekKey = monday.toISOString().slice(0, 10);
      const weekLabel = monday.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      let row = weekMap.get(weekKey);
      if (!row) { row = { semana: weekLabel, total: 0, qualificado: 0, pouco_qualificado: 0, inativo: 0 }; weekMap.set(weekKey, row); }
      row.total++;
      const b = bucket(lead.status_crm);
      if (b === 'qualificado') row.qualificado++;
      else if (b === 'pouco_qualificado') row.pouco_qualificado++;
      else if (b === 'inativo') row.inativo++;
    }
    const weeklyData = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
      .slice(-12); // últimas 12 semanas

    // Chart campanha (top 8)
    const campChart = campRows.slice(0, 8).map(r => ({
      nome: r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label,
      Qualificado: r.qualificado,
      'Pouco qualificado': r.pouco_qualificado,
      Inativo: r.inativo,
    }));

    return {
      campRows, campChart, totalLeads, totQ, totP, totI, totO, totalClassificados,
      pctQualificado, comUtm, topCampRow,
      topVehicles, topVehicleByQual, leadsComVeiculo,
      topCitiesByVolume, topCitiesByQual, topCity,
      paymentData, leadsComPagamento,
      weeklyData,
    };
  }, [leads, utmByPhone, period]);

  // ─── Exportar CSV ────────────────────────────────────────────────────────
  function exportCsv() {
    const sep = ';';
    const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
    const lines: string[] = [];
    lines.push(cell('Relatório de Tráfego — Qualificação por Campanha/Origem'));
    lines.push(cell(`Período: ${periodLabel}`));
    lines.push(cell(`Gerado em: ${new Date().toLocaleString('pt-BR')}`));
    lines.push('');
    lines.push(['Campanha / Origem', 'Tipo', 'Fonte', 'Leads', 'Qualificados', 'Pouco qualificados', 'Inativos', 'Em andamento', '% Qualif.'].map(cell).join(sep));
    for (const r of data.campRows) {
      const classif = r.qualificado + r.pouco_qualificado + r.inativo;
      const pct = classif > 0 ? `${Math.round((r.qualificado / classif) * 100)}%` : '—';
      lines.push([r.label, r.isUtm ? 'UTM' : 'Origem', r.sub, r.total, r.qualificado, r.pouco_qualificado, r.inativo, r.outros, pct].map(cell).join(sep));
    }
    lines.push('');
    lines.push(cell('Top Veículos de Interesse'));
    lines.push(['Veículo', 'Total', 'Qualificados', 'Pouco qualif.', 'Inativos', '% Qualif.'].map(cell).join(sep));
    for (const v of data.topVehicles) {
      const classif = v.qualificado + v.pouco_qualificado + v.inativo;
      const pct = classif > 0 ? `${Math.round((v.qualificado / classif) * 100)}%` : '—';
      lines.push([v.veiculo, v.total, v.qualificado, v.pouco_qualificado, v.inativo, pct].map(cell).join(sep));
    }
    lines.push('');
    lines.push(cell('Top Cidades'));
    lines.push(['Cidade', 'Total', 'Qualificados', '% Qualif.'].map(cell).join(sep));
    for (const c of data.topCitiesByVolume) {
      lines.push([c.cidade, c.total, c.qualificado, `${c.pct}%`].map(cell).join(sep));
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-trafego-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
    const rows = data.campRows.map(r => {
      const classif = r.qualificado + r.pouco_qualificado + r.inativo;
      const pct = classif > 0 ? `${Math.round((r.qualificado / classif) * 100)}%` : '—';
      return [r.label, r.isUtm ? 'UTM' : 'Origem', r.sub, r.total, r.qualificado, r.pouco_qualificado, r.inativo, r.outros, pct];
    });
    const totClassif = data.totQ + data.totP + data.totI;
    const totPct = totClassif > 0 ? `${Math.round((data.totQ / totClassif) * 100)}%` : '—';
    await downloadReportPdf({
      title: 'Relatório de Tráfego — Qualidade por Campanha',
      subtitle: `Período: ${periodLabel}`,
      filename: `relatorio-trafego-${period}-${new Date().toISOString().slice(0, 10)}`,
      accentRgb: [234, 88, 12],
      orientation: 'landscape',
      columns: [
        { header: 'Campanha / Origem' }, { header: 'Tipo' }, { header: 'Fonte' },
        { header: 'Leads', align: 'right' }, { header: 'Qualificados', align: 'right' },
        { header: 'Pouco qualif.', align: 'right' }, { header: 'Inativos', align: 'right' },
        { header: 'Em andamento', align: 'right' }, { header: '% Qualif.', align: 'right' },
      ],
      rows,
      totalRow: ['TOTAL', '', '', data.totalLeads, data.totQ, data.totP, data.totI, data.totO, totPct],
      note:
        `${data.comUtm} de ${data.totalLeads} leads vieram com UTM rastreável (anúncios Click-to-WhatsApp Meta Cloud API). ` +
        `${data.leadsComVeiculo} leads revelaram veículo de interesse durante a conversa. ` +
        `Qualificação automática pela IA do agente.`,
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando inteligência de tráfego…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Header + Filtros ─────────────────────────────────────────────── */}
      <Card className="border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-amber-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-orange-400" />
                Inteligência de Tráfego & Leads
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Análise completa: veículos, cidades, pagamentos e campanhas cruzados com qualificação da IA
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {data.totalLeads > 0 && (
                <>
                  <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/25 transition-colors">
                    <Download className="h-3 w-3" /> Exportar CSV
                  </button>
                  <button onClick={exportPdf} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/25 transition-colors">
                    <FileText className="h-3 w-3" /> Exportar PDF
                  </button>
                </>
              )}
              <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
                <Filter className="h-3 w-3 text-muted-foreground ml-1" />
                {PERIODS.map(p => (
                  <button key={p.id} onClick={() => setPeriod(p.id)}
                    className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${period === p.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiCard icon={Users} label="Leads no período" value={data.totalLeads} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/20" />
            <KpiCard icon={Award} label="% Qualificados" value={`${data.pctQualificado}%`} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/20" />
            <KpiCard icon={MapPin} label="Top cidade" value={data.topCity} color="text-violet-400" bg="bg-violet-500/10 border-violet-500/20" small />
            <KpiCard icon={Car} label="Top veículo" value={data.topVehicles[0]?.veiculo || '—'} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/20" small />
          </div>
        </CardContent>
      </Card>

      {data.totalLeads === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-xs">
          Nenhum lead no período selecionado.
        </div>
      ) : (
        <>
          {/* ─── Linha 1: Veículos de Interesse ──────────────────────────────── */}
          {data.topVehicles.length > 0 && (
            <ChartCard
              icon={Car}
              title="Veículos de Interesse"
              subtitle={`${data.leadsComVeiculo} leads revelaram o veículo desejado durante a conversa com o agente`}
              color="text-blue-400"
              badge={data.topVehicleByQual ? `🏆 Mais qualificado: ${data.topVehicleByQual.veiculo}` : undefined}
            >
              <ResponsiveContainer width="100%" height={Math.max(220, data.topVehicles.length * 36)}>
                <BarChart data={data.topVehicles} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="gradQ" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#34d399" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
                    </linearGradient>
                    <linearGradient id="gradP" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#fbbf24" />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.8} />
                    </linearGradient>
                    <linearGradient id="gradI" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#94a3b8" />
                      <stop offset="100%" stopColor="#64748b" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.08} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="veiculo" stroke="hsl(var(--muted-foreground))" fontSize={10} width={180} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                  <Bar dataKey="qualificado" name="Qualificado" stackId="a" fill="url(#gradQ)" />
                  <Bar dataKey="pouco_qualificado" name="Pouco qualificado" stackId="a" fill="url(#gradP)" />
                  <Bar dataKey="inativo" name="Inativo" stackId="a" fill="url(#gradI)" radius={[0, 6, 6, 0]}
                    label={{ position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (_: any, __: any, ctx: any) => data.topVehicles[ctx?.index ?? -1]?.total }} />
                </BarChart>
              </ResponsiveContainer>
              {/* Legenda qualificação */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {(Object.keys(QUAL) as QualKey[]).map(k => (
                  <span key={k} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: QUAL[k].color }} />
                    {QUAL[k].label}
                  </span>
                ))}
              </div>
            </ChartCard>
          )}

          {/* ─── Linha 2: Pagamento + Cidades ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Forma de Pagamento */}
            {data.paymentData.length > 0 && (
              <ChartCard icon={CreditCard} title="Forma de Pagamento" subtitle={`${data.leadsComPagamento} leads informaram como pretendem pagar`} color="text-violet-400">
                <div className="flex items-stretch gap-3">
                  <div className="flex-1 min-w-0">
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={data.paymentData}
                          dataKey="total"
                          nameKey="metodo"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={76}
                          paddingAngle={3}
                          strokeWidth={0}
                        >
                          {data.paymentData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Pie>
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const item = payload[0];
                          return (
                            <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl">
                              <p className="text-[10px] text-slate-400">{item.name}</p>
                              <p className="text-sm font-bold" style={{ color: (item.payload as any).fill }}>{item.value} leads</p>
                              <p className="text-[10px] text-slate-400">{(item.payload as any).pct}% qualificados</p>
                            </div>
                          );
                        }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center gap-2 min-w-0">
                    {data.paymentData.map(d => (
                      <div key={d.metodo} className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.fill }} />
                        <span className="text-[10px] text-muted-foreground flex-1 truncate">{d.metodo}</span>
                        <div className="text-right">
                          <span className="text-[10px] font-bold text-foreground">{d.total}</span>
                          <span className="text-[9px] text-muted-foreground ml-1">({d.pct}% qualif.)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </ChartCard>
            )}

            {/* Cidades */}
            {data.topCitiesByVolume.length > 0 && (
              <ChartCard icon={MapPin} title="Cidades de Maior Volume" subtitle="Onde estão os leads — cruzado com qualificação da IA" color="text-violet-400">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.topCitiesByVolume} margin={{ left: 4, right: 8, top: 4, bottom: 36 }}>
                    <defs>
                      <linearGradient id="gradCity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                    <XAxis dataKey="cidade" stroke="hsl(var(--muted-foreground))" fontSize={9} angle={-35} textAnchor="end" interval={0} tickLine={false} axisLine={false} dy={4} />
                    <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const row = data.topCitiesByVolume.find(c => c.cidade === label);
                      return (
                        <div className="rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-sm px-3 py-2 shadow-xl">
                          <p className="text-[10px] text-slate-400 mb-1">{label}</p>
                          <p className="text-xs font-bold text-white">{row?.total} leads</p>
                          <p className="text-[10px] text-emerald-400">{row?.qualificado} qualificados ({row?.pct}%)</p>
                        </div>
                      );
                    }} />
                    <Bar dataKey="total" name="Total" fill="url(#gradCity)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>

          {/* ─── Linha 3: Evolução Temporal ──────────────────────────────────── */}
          {data.weeklyData.length > 1 && (
            <ChartCard icon={Activity} title="Evolução Semanal de Leads" subtitle="Volume e qualificação ao longo das semanas" color="text-blue-400">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.weeklyData} margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
                  <defs>
                    <linearGradient id="areaQ" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="areaP" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#fbbf24" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="areaI" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />
                  <XAxis dataKey="semana" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="inativo" name="Inativo" stackId="1" stroke="#94a3b8" fill="url(#areaI)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="pouco_qualificado" name="Pouco qualificado" stackId="1" stroke="#fbbf24" fill="url(#areaP)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="qualificado" name="Qualificado" stackId="1" stroke="#34d399" fill="url(#areaQ)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* ─── Linha 4: Campanha/UTM × Qualificação ────────────────────────── */}
          <ChartCard icon={Target} title="Qualificação por Campanha / Origem" subtitle="Top 8 por volume — cruzado com qualificação da IA" color="text-orange-400">
            <ResponsiveContainer width="100%" height={Math.max(220, data.campChart.length * 44)}>
              <BarChart data={data.campChart} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.08} horizontal={false} />
                <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="nome" stroke="hsl(var(--muted-foreground))" fontSize={10} width={150} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15 }} />
                <Bar dataKey="Qualificado" stackId="a" fill={QUAL.qualificado.color} />
                <Bar dataKey="Pouco qualificado" stackId="a" fill={QUAL.pouco_qualificado.color} />
                <Bar dataKey="Inativo" stackId="a" fill={QUAL.inativo.color} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {(Object.keys(QUAL) as QualKey[]).map(k => (
                <span key={k} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: QUAL[k].color }} />
                  {QUAL[k].label}
                </span>
              ))}
            </div>
          </ChartCard>

          {/* ─── Tabela detalhada de campanhas ───────────────────────────────── */}
          <div className="bg-background/40 border border-border/40 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40">
              <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                Detalhamento por Campanha / Origem
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground bg-muted/20">
                    <th className="text-left font-medium px-3 py-2">Campanha / Origem</th>
                    <th className="text-right font-medium px-2 py-2">Leads</th>
                    <th className="text-right font-medium px-2 py-2 text-emerald-400">Qualif.</th>
                    <th className="text-right font-medium px-2 py-2 text-amber-400">Pouco q.</th>
                    <th className="text-right font-medium px-2 py-2 text-slate-400">Inativo</th>
                    <th className="text-right font-medium px-3 py-2">% Qualif.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campRows.map(r => {
                    const classif = r.qualificado + r.pouco_qualificado + r.inativo;
                    const pct = classif > 0 ? Math.round((r.qualificado / classif) * 100) : 0;
                    const barW = r.total > 0 ? Math.round((r.total / (data.campRows[0]?.total || 1)) * 100) : 0;
                    return (
                      <tr key={r.key} className="border-b border-border/20 last:border-0 hover:bg-muted/20 group">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${r.isUtm ? 'bg-orange-500/15 text-orange-400' : 'bg-blue-500/15 text-blue-400'}`}>
                              {r.isUtm ? 'UTM' : 'ORIGEM'}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-foreground truncate font-medium">{r.label}</p>
                              {/* Barra de volume */}
                              <div className="mt-0.5 h-1 bg-muted/40 rounded-full overflow-hidden w-full max-w-[160px]">
                                <div className="h-full rounded-full bg-gradient-to-r from-orange-400/70 to-amber-400/50 transition-all" style={{ width: `${barW}%` }} />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right px-2 py-2.5 font-semibold text-foreground">{r.total}</td>
                        <td className="text-right px-2 py-2.5 text-emerald-400 font-medium">{r.qualificado}</td>
                        <td className="text-right px-2 py-2.5 text-amber-400 font-medium">{r.pouco_qualificado}</td>
                        <td className="text-right px-2 py-2.5 text-slate-400">{r.inativo}</td>
                        <td className="text-right px-3 py-2.5">
                          {classif > 0 ? (
                            <div className="inline-flex items-center gap-1">
                              <div className="h-1.5 w-8 bg-muted/40 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 50 ? '#34d399' : pct >= 25 ? '#fbbf24' : '#94a3b8' }} />
                              </div>
                              <span className={`font-semibold text-[10px] ${pct >= 50 ? 'text-emerald-400' : pct >= 25 ? 'text-amber-400' : 'text-muted-foreground'}`}>{pct}%</span>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Nota informativa ────────────────────────────────────────────── */}
          <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/20 border border-border/30 rounded-xl px-3 py-2.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
            <span>
              <strong>{data.comUtm}</strong> de {data.totalLeads} leads vieram com UTM rastreável (anúncios Click-to-WhatsApp via Meta Cloud API).{' '}
              <strong>{data.leadsComVeiculo}</strong> leads revelaram o veículo de interesse durante a conversa com o agente.{' '}
              <strong>{data.leadsComPagamento}</strong> leads informaram a forma de pagamento.{' '}
              Os demais leads são agrupados pela <strong>origem</strong> cadastrada. A qualificação é feita automaticamente pela IA.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, bg, small = false }: { icon: any; label: string; value: number | string; color: string; bg: string; small?: boolean }) {
  return (
    <div className={`border rounded-xl px-3 py-2.5 flex items-center gap-2.5 ${bg}`}>
      <div className={`rounded-lg p-1.5 ${bg}`}>
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`${small ? 'text-xs truncate leading-tight' : 'text-xl'} font-bold text-foreground leading-none`}>{value}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ChartCard({ icon: Icon, title, subtitle, children, color, badge }: {
  icon: any; title: string; subtitle?: string; children: React.ReactNode; color?: string; badge?: string;
}) {
  return (
    <div className="bg-background/40 border border-border/40 rounded-xl p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Icon className={`h-3.5 w-3.5 ${color || 'text-muted-foreground'}`} />
            {title}
          </p>
          {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {badge && (
          <span className="text-[9px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full shrink-0">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
