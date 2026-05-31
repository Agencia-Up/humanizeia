// ============================================================================
// CampanhaAnalytics — Relatório de Tráfego para o gestor de tráfego pago
// ----------------------------------------------------------------------------
// Renderizado dentro do Pedro → aba "Tráfego" (apenas Master).
//
// Cruza CAMPANHA/UTM/ORIGEM × QUALIFICAÇÃO DA IA (status_crm):
//   - Qualificado        (qualificado)        — respondeu tudo, dados completos
//   - Pouco qualificado  (pouco_qualificado)  — conversou mas não completou
//   - Inativo            (inativo)            — não respondeu / transferido por inatividade
//
// Assim o gestor de tráfego vê QUAL campanha traz lead que FECHA, não só volume.
//
// Fonte de dados (busca própria, escopada no master):
//   - ai_crm_leads (leads do Pedro): id, remote_jid, origem, origem_outros,
//     status_crm, created_at
//   - wa_contacts: phone + utm_source/utm_campaign/utm_medium/utm_content
//     (preenchido pelo wa-inbox-webhook em anúncios Click-to-WhatsApp)
//   - Join lead↔UTM é feito pelo telefone (remote_jid ↔ phone), client-side.
//
// Leads sem UTM (orgânico/manual) caem no agrupamento por `origem`.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TrendingUp, Users, Target, Filter, Loader2, Info, Award, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// ─── Tipos ──────────────────────────────────────────────────────────────────
interface RawLead {
  id: string;
  remote_jid: string | null;
  origem: string | null;
  origem_outros: string | null;
  status_crm: string | null;
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
  qualificado:       { label: 'Qualificado',       color: '#34d399' }, // emerald-400
  pouco_qualificado: { label: 'Pouco qualificado', color: '#fbbf24' }, // amber-400
  inativo:           { label: 'Inativo',           color: '#94a3b8' }, // slate-400
} as const;

type QualKey = keyof typeof QUAL;

function bucket(statusCrm: string | null): QualKey | 'outros' {
  const s = (statusCrm || '').toLowerCase();
  if (s === 'qualificado') return 'qualificado';
  if (s === 'pouco_qualificado') return 'pouco_qualificado';
  if (s === 'inativo') return 'inativo';
  return 'outros'; // novo + estágios manuais (em_atendimento, negociacao, fechado...)
}

// ─── Origem (rótulos amigáveis) ─────────────────────────────────────────────
const ORIGEM_LABELS: Record<string, string> = {
  trafico_pago: 'Tráfego Pago',
  trafego_pago: 'Tráfego Pago',
  organico: 'Orgânico',
  instagram: 'Instagram',
  facebook: 'Facebook',
  redes_sociais: 'Redes Sociais',
  whatsapp: 'WhatsApp',
  porta: 'Porta / Loja',
  olx: 'OLX',
  marketplace: 'Marketplace',
  site: 'Site',
  indicacao: 'Indicação',
  importacao: 'Importação',
  outros: 'Outros',
};
function origemLabel(origem: string | null, origemOutros: string | null): string {
  if (origemOutros && origemOutros.trim()) return origemOutros.trim();
  const o = (origem || '').toLowerCase();
  if (ORIGEM_LABELS[o]) return ORIGEM_LABELS[o];
  if (o) return o.charAt(0).toUpperCase() + o.slice(1);
  return 'Sem origem';
}

// ─── Telefone (normalização + chaves de match) ──────────────────────────────
function digits(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}
function phoneKeys(d: string): string[] {
  const keys: string[] = [];
  if (d) keys.push(d);
  if (d.length >= 8) keys.push(d.slice(-8)); // fallback: últimos 8 dígitos (9º dígito/DDI)
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

// CSV: escapa valor (aspas, ;, quebra de linha) pro formato Excel/Sheets
function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface GroupRow {
  key: string;
  label: string;
  sub: string;
  isUtm: boolean;
  total: number;
  qualificado: number;
  pouco_qualificado: number;
  inativo: number;
  outros: number;
}

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
            .select('id, remote_jid, origem, origem_outros, status_crm, created_at')
            .eq('user_id', masterUserId)
            .order('created_at', { ascending: false })
            .limit(5000),
          (supabase as any)
            .from('wa_contacts')
            .select('phone, utm_source, utm_campaign, utm_medium, utm_content')
            .eq('user_id', masterUserId)
            .limit(20000),
        ]);
        if (cancelled) return;

        const map = new Map<string, UtmRecord>();
        for (const c of (contactsRes.data || []) as any[]) {
          // só indexa contatos que têm algum UTM (economiza memória e evita ruído)
          if (!c.utm_source && !c.utm_campaign) continue;
          const rec: UtmRecord = {
            utm_source: c.utm_source ?? null,
            utm_campaign: c.utm_campaign ?? null,
            utm_medium: c.utm_medium ?? null,
            utm_content: c.utm_content ?? null,
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

    const groups = new Map<string, GroupRow>();
    let totQ = 0, totP = 0, totI = 0, totO = 0;
    let comUtm = 0;

    for (const lead of filtered) {
      const utm = utmFor(lead.remote_jid);
      let key: string, label: string, sub: string, isUtm: boolean;
      if (utm && (utm.utm_campaign || utm.utm_source)) {
        const camp = utm.utm_campaign || '(sem nome de campanha)';
        const src = utm.utm_source || '—';
        key = `utm|${src}|${camp}`;
        label = camp;
        sub = `UTM · ${src}`;
        isUtm = true;
        comUtm++;
      } else {
        const o = origemLabel(lead.origem, lead.origem_outros);
        key = `origem|${o}`;
        label = o;
        sub = 'Origem';
        isUtm = false;
      }

      let row = groups.get(key);
      if (!row) {
        row = { key, label, sub, isUtm, total: 0, qualificado: 0, pouco_qualificado: 0, inativo: 0, outros: 0 };
        groups.set(key, row);
      }
      row.total++;
      const b = bucket(lead.status_crm);
      row[b]++;
      if (b === 'qualificado') totQ++;
      else if (b === 'pouco_qualificado') totP++;
      else if (b === 'inativo') totI++;
      else totO++;
    }

    const rows = Array.from(groups.values()).sort((a, b) => b.total - a.total);
    const totalLeads = filtered.length;
    const totalClassificados = totQ + totP + totI;
    const pctQualificado = totalClassificados > 0 ? Math.round((totQ / totalClassificados) * 100) : 0;

    // top campanha = mais qualificados (desempate por taxa de qualificação)
    const topRow = [...rows].sort((a, b) => {
      if (b.qualificado !== a.qualificado) return b.qualificado - a.qualificado;
      const ra = a.qualificado / Math.max(1, a.qualificado + a.pouco_qualificado + a.inativo);
      const rb = b.qualificado / Math.max(1, b.qualificado + b.pouco_qualificado + b.inativo);
      return rb - ra;
    })[0];

    // dados do gráfico (top 8 por total)
    const chart = rows.slice(0, 8).map(r => ({
      nome: r.label.length > 22 ? r.label.slice(0, 20) + '…' : r.label,
      Qualificado: r.qualificado,
      'Pouco qualificado': r.pouco_qualificado,
      Inativo: r.inativo,
    }));

    return {
      rows, chart, totalLeads, totQ, totP, totI, totO, pctQualificado,
      comUtm, topRow,
    };
  }, [leads, utmByPhone, period]);

  // ─── Exportar CSV (pra mandar pro gestor de tráfego no Excel/Sheets) ────────
  function exportCsv() {
    const sep = ';'; // Excel pt-BR usa ; como separador de coluna
    const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
    const lines: string[] = [];
    lines.push(cell('Relatório de Tráfego — Qualificação por Campanha'));
    lines.push(cell(`Período: ${periodLabel}`));
    lines.push(cell(`Gerado em: ${new Date().toLocaleString('pt-BR')}`));
    lines.push('');
    lines.push(
      ['Campanha / Origem', 'Tipo', 'Fonte', 'Leads', 'Qualificados',
       'Pouco qualificados', 'Inativos', 'Em andamento', '% Qualificação']
        .map(cell).join(sep),
    );
    for (const r of data.rows) {
      const classif = r.qualificado + r.pouco_qualificado + r.inativo;
      const pct = classif > 0 ? `${Math.round((r.qualificado / classif) * 100)}%` : '—';
      lines.push(
        [r.label, r.isUtm ? 'UTM' : 'Origem', r.sub, r.total, r.qualificado,
         r.pouco_qualificado, r.inativo, r.outros, pct].map(cell).join(sep),
      );
    }
    const totClassif = data.totQ + data.totP + data.totI;
    const totPct = totClassif > 0 ? `${Math.round((data.totQ / totClassif) * 100)}%` : '—';
    lines.push(
      ['TOTAL', '', '', data.totalLeads, data.totQ, data.totP, data.totI, data.totO, totPct]
        .map(cell).join(sep),
    );

    const csv = '﻿' + lines.join('\r\n'); // BOM p/ Excel ler acentos certo
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando relatório de tráfego…
      </div>
    );
  }

  return (
    <Card className="border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-400" />
              Relatório de Tráfego — Qualidade por Campanha
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Cada campanha/origem cruzada com a qualificação da IA. Mostra quem traz lead que <strong>fecha</strong>, não só volume.
            </CardDescription>
          </div>
          {/* Ações: exportar CSV + filtro de período */}
          <div className="flex items-center gap-2 flex-wrap">
            {data.totalLeads > 0 && (
              <button
                onClick={exportCsv}
                title="Baixar planilha (CSV) pra enviar ao gestor de tráfego pago"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 border border-orange-500/25 transition-colors"
              >
                <Download className="h-3 w-3" />
                Exportar CSV
              </button>
            )}
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              <Filter className="h-3 w-3 text-muted-foreground ml-1" />
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    period === p.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard icon={Users} label="Leads no período" value={data.totalLeads} color="text-blue-400" />
          <KpiCard icon={Award} label="% Qualificados" value={`${data.pctQualificado}%`} color="text-emerald-400" />
          <KpiCard icon={TrendingUp} label="Inativos (não engajaram)" value={data.totI} color="text-slate-400" />
          <KpiCard icon={Target} label="Top campanha (qualificados)" value={data.topRow ? data.topRow.label : '—'} color="text-orange-400" small />
        </div>

        {data.totalLeads === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs">
            Nenhum lead no período selecionado.
          </div>
        ) : (
          <>
            {/* Legenda das 3 qualificações */}
            <div className="flex items-center gap-3 flex-wrap text-[10px] text-muted-foreground">
              {(Object.keys(QUAL) as QualKey[]).map(k => (
                <span key={k} className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: QUAL[k].color }} />
                  {QUAL[k].label}
                </span>
              ))}
            </div>

            {/* Gráfico de barras empilhadas: campanha × qualificação */}
            <div className="bg-background/30 border border-border/40 rounded-lg p-3">
              <p className="text-xs font-medium text-foreground mb-2">Qualificação por campanha / origem (top 8 por volume)</p>
              <ResponsiveContainer width="100%" height={Math.max(220, data.chart.length * 42)}>
                <BarChart data={data.chart} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis type="category" dataKey="nome" stroke="hsl(var(--muted-foreground))" fontSize={10} width={150} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Qualificado" stackId="a" fill={QUAL.qualificado.color} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Pouco qualificado" stackId="a" fill={QUAL.pouco_qualificado.color} />
                  <Bar dataKey="Inativo" stackId="a" fill={QUAL.inativo.color} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Tabela detalhada */}
            <div className="bg-background/30 border border-border/40 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 text-muted-foreground">
                      <th className="text-left font-medium px-3 py-2">Campanha / Origem</th>
                      <th className="text-right font-medium px-2 py-2">Leads</th>
                      <th className="text-right font-medium px-2 py-2 text-emerald-400">Qualif.</th>
                      <th className="text-right font-medium px-2 py-2 text-amber-400">Pouco q.</th>
                      <th className="text-right font-medium px-2 py-2 text-slate-400">Inativo</th>
                      <th className="text-right font-medium px-3 py-2">% Qualif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(r => {
                      const classif = r.qualificado + r.pouco_qualificado + r.inativo;
                      const pct = classif > 0 ? Math.round((r.qualificado / classif) * 100) : 0;
                      return (
                        <tr key={r.key} className="border-b border-border/20 last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                                r.isUtm ? 'bg-orange-500/15 text-orange-400' : 'bg-blue-500/15 text-blue-400'
                              }`}>
                                {r.isUtm ? 'UTM' : 'ORIGEM'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-foreground truncate font-medium">{r.label}</p>
                                <p className="text-[9px] text-muted-foreground truncate">{r.sub}</p>
                              </div>
                            </div>
                          </td>
                          <td className="text-right px-2 py-2 font-semibold text-foreground">{r.total}</td>
                          <td className="text-right px-2 py-2 text-emerald-400">{r.qualificado}</td>
                          <td className="text-right px-2 py-2 text-amber-400">{r.pouco_qualificado}</td>
                          <td className="text-right px-2 py-2 text-slate-400">{r.inativo}</td>
                          <td className="text-right px-3 py-2">
                            <span className={`font-semibold ${pct >= 50 ? 'text-emerald-400' : pct >= 25 ? 'text-amber-400' : 'text-muted-foreground'}`}>
                              {classif > 0 ? `${pct}%` : '—'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Nota de cobertura de dados */}
            <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/20 border border-border/30 rounded-lg px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-400" />
              <span>
                <strong>{data.comUtm}</strong> de {data.totalLeads} leads no período vieram com UTM rastreável
                (anúncios Click-to-WhatsApp). Os demais são agrupados pela <strong>origem</strong> cadastrada.
                {data.totO > 0 && <> {data.totO} lead(s) ainda em andamento (novo / negociação) não entram no % de qualificação.</>}
                {' '}A qualificação (Qualificado / Pouco qualificado / Inativo) é feita automaticamente pela IA.
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers internos ────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, color, small = false }: { icon: any; label: string; value: number | string; color: string; small?: boolean }) {
  return (
    <div className="bg-background/50 border border-border/40 rounded-lg px-3 py-2 flex items-center gap-2">
      <Icon className={`h-4 w-4 ${color} shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className={`${small ? 'text-xs truncate' : 'text-lg'} font-bold text-foreground leading-tight`}>{value}</p>
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}
