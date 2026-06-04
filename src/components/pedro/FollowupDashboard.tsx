/**
 * FollowupDashboard — mini-painel de métricas dos follow-ups do agente Pedro.
 *
 * Fonte de dados: tabela `pedro_followup_schedules` (1 linha por disparo).
 *   - status 'sent'      => follow-up REALIZADO (horário em `sent_at`)
 *   - status 'pending'   => agendado, ainda não enviado
 *   - status 'cancelled' => cancelado
 *
 * Isolamento multi-tenant: tudo filtrado por `user_id` = dono da conta
 * (o master). O RLS da tabela já garante que ninguém vê dados de outra conta;
 * o filtro explícito é só uma segunda camada.
 *
 * Aditivo: este componente NÃO altera o painel de follow-up existente nem
 * toca em nenhuma edge function. É somente leitura.
 *
 * Fuso: o "dia" é sempre o dia de São Paulo (UTC-3 fixo — o Brasil não tem
 * mais horário de verão desde 2019), calculado sem dependência externa.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  CalendarClock, RefreshCw, CheckCircle2, Clock, CalendarDays, Loader2, Phone,
} from 'lucide-react';

/* ── Fuso São Paulo (UTC-3 fixo) ───────────────────────────────────────── */
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' do "hoje" em São Paulo. */
function spTodayStr(): string {
  const sp = new Date(Date.now() - SP_OFFSET_MS);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}`;
}
/** Limites UTC (ISO) do dia 'YYYY-MM-DD' em São Paulo. */
function spDayBoundsISO(dateStr: string) {
  return {
    startISO: new Date(`${dateStr}T00:00:00.000-03:00`).toISOString(),
    endISO: new Date(`${dateStr}T23:59:59.999-03:00`).toISOString(),
  };
}
/** Limites UTC (ISO) do mês que contém 'YYYY-MM-DD', em São Paulo. */
function spMonthBoundsISO(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    startISO: new Date(`${pad(y)}-${pad(m)}-01T00:00:00.000-03:00`).toISOString(),
    endISO: new Date(`${ny}-${pad(nm)}-01T00:00:00.000-03:00`).toISOString(),
  };
}
/** Hora (0-23) de um instante UTC, lida no fuso de São Paulo. */
function spHour(iso: string): number {
  return new Date(new Date(iso).getTime() - SP_OFFSET_MS).getUTCHours();
}
/** 'HH:mm' de um instante UTC, no fuso de São Paulo. */
function spHourMin(iso: string): string {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** 'DD/MM' a partir de 'YYYY-MM-DD'. */
function brShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
/** Formata o número do WhatsApp a partir do remote_jid (LGPD: só exibido ao dono). */
function fmtPhone(remoteJid?: string | null): string {
  if (!remoteJid) return '—';
  const digits = (remoteJid.split('@')[0] || '').replace(/\D/g, '');
  let d = digits;
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits || '—';
}

/* ── Tipos ─────────────────────────────────────────────────────────────── */
interface DayItem {
  id: string;
  hora: string;
  nome: string;
  fone: string;
}
interface HourBucket {
  hora: string;
  count: number;
}

/* ── Componente ────────────────────────────────────────────────────────── */
export default function FollowupDashboard({ userId }: { userId?: string | null }) {
  const [selectedDate, setSelectedDate] = useState<string>(spTodayStr());
  const [loading, setLoading] = useState(true);
  const [dayCount, setDayCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [items, setItems] = useState<DayItem[]>([]);

  const todayStr = spTodayStr();
  const isToday = selectedDate === todayStr;

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { startISO, endISO } = spDayBoundsISO(selectedDate);
      const month = spMonthBoundsISO(selectedDate);

      const [sentRes, monthRes, pendingRes] = await Promise.all([
        // Follow-ups REALIZADOS no dia selecionado (gráfico + lista)
        (supabase as any)
          .from('pedro_followup_schedules')
          .select('id, sent_at, lead_id')
          .eq('user_id', userId)
          .eq('status', 'sent')
          .gte('sent_at', startISO)
          .lte('sent_at', endISO)
          .order('sent_at', { ascending: true }),
        // Total feitos no mês do dia selecionado
        (supabase as any)
          .from('pedro_followup_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'sent')
          .gte('sent_at', month.startISO)
          .lt('sent_at', month.endISO),
        // Agendados ainda pendentes (não enviados)
        (supabase as any)
          .from('pedro_followup_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'pending'),
      ]);

      const sent: Array<{ id: string; sent_at: string | null; lead_id: string | null }> =
        sentRes.data || [];

      // Busca os leads (nome + número) num segundo passo — evita depender de
      // embed/relacionamento do PostgREST e mantém o RLS simples.
      const leadIds = Array.from(new Set(sent.map((s) => s.lead_id).filter(Boolean))) as string[];
      let leadMap: Record<string, { lead_name: string | null; remote_jid: string | null }> = {};
      if (leadIds.length) {
        const { data: leads } = await (supabase as any)
          .from('ai_crm_leads')
          .select('id, lead_name, remote_jid')
          .in('id', leadIds);
        leadMap = Object.fromEntries(
          (leads || []).map((l: any) => [l.id, { lead_name: l.lead_name, remote_jid: l.remote_jid }]),
        );
      }

      // Histograma por hora (00h..23h)
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hora: `${pad(h)}h`,
        count: 0,
      }));
      for (const s of sent) {
        if (s.sent_at) buckets[spHour(s.sent_at)].count++;
      }

      // Lista detalhada do dia
      const list: DayItem[] = sent.map((s) => ({
        id: s.id,
        hora: s.sent_at ? spHourMin(s.sent_at) : '—',
        nome: (s.lead_id && leadMap[s.lead_id]?.lead_name) || 'Lead',
        fone: fmtPhone(s.lead_id ? leadMap[s.lead_id]?.remote_jid : null),
      }));

      setDayCount(sent.length);
      setMonthCount(monthRes.count || 0);
      setPendingCount(pendingRes.count || 0);
      setHourly(buckets);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [userId, selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasData = dayCount > 0;

  return (
    <div className="space-y-4">
      {/* Cabeçalho + seletor de dia */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-600/20 border border-blue-500/30 flex items-center justify-center">
            <CalendarClock className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Dashboard de Follow-ups</h2>
            <p className="text-[11px] text-muted-foreground">Volume e ritmo dos disparos do Pedro</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            max={todayStr}
            onChange={(e) => setSelectedDate(e.target.value || todayStr)}
            className="h-8 text-xs w-40 [&::-webkit-calendar-picker-indicator]:invert"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={fetchData}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {isToday ? 'Feitos hoje' : `Feitos em ${brShortDate(selectedDate)}`}
                </p>
                <p className="text-3xl font-bold text-foreground mt-1">{loading ? '—' : dayCount}</p>
              </div>
              <CheckCircle2 className="h-7 w-7 text-emerald-400/80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Feitos no mês</p>
                <p className="text-3xl font-bold text-foreground mt-1">{loading ? '—' : monthCount}</p>
              </div>
              <CalendarDays className="h-7 w-7 text-blue-400/80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Agendados pendentes</p>
                <p className="text-3xl font-bold text-foreground mt-1">{loading ? '—' : pendingCount}</p>
              </div>
              <Clock className="h-7 w-7 text-cyan-400/80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico por hora */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Follow-ups por horário {isToday ? '(hoje)' : `(${brShortDate(selectedDate)})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : hasData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="hora"
                    interval={1}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted)/0.3)' }}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(h) => `Horário ${h}`}
                    formatter={(v: any) => [`${v} follow-up(s)`, 'Enviados']}
                  />
                  <Bar dataKey="count" name="Enviados" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center gap-2">
              <CalendarClock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhum follow-up realizado nesta data.</p>
              {!isToday && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedDate(todayStr)}>
                  Voltar para hoje
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista detalhada do dia */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Detalhe do dia</span>
            {hasData && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {dayCount} {dayCount === 1 ? 'envio' : 'envios'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hasData ? (
            <div className="divide-y divide-border/40">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-3 py-2">
                  <span className="text-xs font-mono text-blue-400 w-12 shrink-0">{it.hora}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{it.nome}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5" /> {it.fone}
                    </p>
                  </div>
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] shrink-0">
                    Enviado
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum follow-up realizado nesta data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
