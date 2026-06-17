/**
 * FollowupDashboard — mini-painel dos DISPAROS de follow-up do agente Pedro.
 *
 * Fonte de dados: tabela `wa_chat_history` (1 linha por mensagem enviada).
 * Tanto o disparo automático (Follow-up IA / reativação) quanto o manual
 * gravam a mensagem aqui com um prefixo no conteúdo:
 *   - "[Follow-up IA] ..."     => disparo automático de reativação
 *   - "[Follow-up manual] ..." => disparo manual ("Iniciar Follow-up agora")
 * Filtramos por role='assistant' + content ILIKE '[Follow-up%'.
 *
 * Mostra, por dia: quantos disparos, pra quais leads (nome + telefone),
 * o intervalo de tempo entre um disparo e o seguinte, e qual VENDEDOR está
 * com cada lead (ai_crm_leads.assigned_to_member_id -> ai_team_members.name).
 *
 * Isolamento multi-tenant: tudo filtrado por `user_id` = dono da conta
 * (o master), além do RLS já existente nas tabelas.
 *
 * Aditivo / somente leitura: não altera nenhuma edge function nem o disparo.
 * Fuso: o "dia" é sempre o dia de São Paulo (UTC-3 fixo, sem horário de
 * verão desde 2019), calculado sem dependência externa.
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
  Send, RefreshCw, Users, CalendarDays, Loader2, Phone, UserCheck, Clock,
  ListChecks, CheckCircle2, MessageCircleReply,
} from 'lucide-react';

/* ── Fuso São Paulo (UTC-3 fixo) ───────────────────────────────────────── */
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function spTodayStr(): string {
  const sp = new Date(Date.now() - SP_OFFSET_MS);
  return `${sp.getUTCFullYear()}-${pad(sp.getUTCMonth() + 1)}-${pad(sp.getUTCDate())}`;
}
function spDayBoundsISO(dateStr: string) {
  return {
    startISO: new Date(`${dateStr}T00:00:00.000-03:00`).toISOString(),
    endISO: new Date(`${dateStr}T23:59:59.999-03:00`).toISOString(),
  };
}
function spMonthBoundsISO(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    startISO: new Date(`${pad(y)}-${pad(m)}-01T00:00:00.000-03:00`).toISOString(),
    endISO: new Date(`${ny}-${pad(nm)}-01T00:00:00.000-03:00`).toISOString(),
  };
}
function spHour(iso: string): number {
  return new Date(new Date(iso).getTime() - SP_OFFSET_MS).getUTCHours();
}
function spHourMin(iso: string): string {
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function brShortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}
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
interface DispatchItem {
  id: string;
  hora: string;
  nome: string;
  fone: string;
  vendedor: string;
  tipo: 'ia' | 'manual';
  intervaloMin: number | null; // minutos desde o disparo anterior (null no 1º)
  status?: string;
  errorMessage?: string | null;
}
interface HourBucket {
  hora: string;
  count: number;
}
interface QueueStatus {
  cycleStartedAt: string | null;
  total: number;
  enviados: number;
  restantes: number;
  responderam: number;
}

function spDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} às ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/* ── Componente ────────────────────────────────────────────────────────── */
export default function FollowupDashboard({ userId }: { userId?: string | null }) {
  const [selectedDate, setSelectedDate] = useState<string>(spTodayStr());
  const [loading, setLoading] = useState(true);
  const [dayCount, setDayCount] = useState(0);
  const [leadsCount, setLeadsCount] = useState(0);
  const [monthCount, setMonthCount] = useState(0);
  const [hourly, setHourly] = useState<HourBucket[]>([]);
  const [items, setItems] = useState<DispatchItem[]>([]);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);

  const todayStr = spTodayStr();
  const isToday = selectedDate === todayStr;

  const fetchData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { startISO, endISO } = spDayBoundsISO(selectedDate);
      const month = spMonthBoundsISO(selectedDate);

      let msgs: Array<{
        id: string;
        remote_jid: string | null;
        content: string | null;
        created_at: string;
        status?: string;
        error_message?: string | null;
        type?: string;
      }> = [];
      let totalMonth = 0;
      let usingLegacyFallback = false;

      // Busca híbrida: tenta ler logs detalhados e combina com histórico de chat
      const [logsRes, chatRes, logsMonthRes, chatMonthRes] = await Promise.all([
        (supabase as any)
          .from('pedro_followup_logs')
          .select('id, remote_jid, message, status, error_message, type, created_at')
          .eq('user_id', userId)
          .gte('created_at', startISO)
          .lte('created_at', endISO)
          .order('created_at', { ascending: true }),
        (supabase as any)
          .from('wa_chat_history')
          .select('id, remote_jid, content, created_at')
          .eq('user_id', userId)
          .eq('role', 'assistant')
          .ilike('content', '[Follow-up%')
          .gte('created_at', startISO)
          .lte('created_at', endISO)
          .order('created_at', { ascending: true }),
        (supabase as any)
          .from('pedro_followup_logs')
          .select('remote_jid, created_at')
          .eq('user_id', userId)
          .gte('created_at', month.startISO)
          .lt('created_at', month.endISO),
        (supabase as any)
          .from('wa_chat_history')
          .select('remote_jid, created_at')
          .eq('user_id', userId)
          .eq('role', 'assistant')
          .ilike('content', '[Follow-up%')
          .gte('created_at', month.startISO)
          .lt('created_at', month.endISO)
      ]);

      const dayLogs = logsRes.data || [];
      const dayChats = chatRes.data || [];
      const mLogs = logsMonthRes.data || [];
      const mChats = chatMonthRes.data || [];

      // 1. Processa e unifica os logs do dia
      const dayMsgs = dayLogs.map((l: any) => ({
        id: l.id,
        remote_jid: l.remote_jid,
        content: l.message,
        created_at: l.created_at,
        status: l.status,
        error_message: l.error_message,
        type: l.type
      }));

      for (const m of dayChats) {
        const isDupe = dayLogs.some((l: any) => 
          l.remote_jid === m.remote_jid && 
          Math.abs(new Date(l.created_at).getTime() - new Date(m.created_at).getTime()) < 15000
        );
        if (!isDupe) {
          dayMsgs.push({
            id: m.id,
            remote_jid: m.remote_jid,
            content: m.content,
            created_at: m.created_at,
            status: 'sent',
            type: (m.content || '').startsWith('[Follow-up IA]') ? 'ia' : 'manual'
          });
        }
      }

      dayMsgs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      msgs = dayMsgs;

      // 2. Calcula e unifica o total do mês
      let uniqueMonthCount = mLogs.length;
      for (const mc of mChats) {
        const isDupe = mLogs.some((ml: any) => 
          ml.remote_jid === mc.remote_jid && 
          Math.abs(new Date(ml.created_at).getTime() - new Date(mc.created_at).getTime()) < 15000
        );
        if (!isDupe) {
          uniqueMonthCount++;
        }
      }
      totalMonth = uniqueMonthCount;


      // Leads (nome + vendedor) por remote_jid
      const jids = Array.from(new Set(msgs.map((m) => m.remote_jid).filter(Boolean))) as string[];
      let leadMap: Record<string, { lead_name: string | null; member_id: string | null }> = {};
      if (jids.length) {
        const { data: leads } = await (supabase as any)
          .from('ai_crm_leads')
          .select('remote_jid, lead_name, assigned_to_member_id')
          .eq('user_id', userId)
          .in('remote_jid', jids);
        for (const l of leads || []) {
          if (!leadMap[l.remote_jid]) {
            leadMap[l.remote_jid] = { lead_name: l.lead_name, member_id: l.assigned_to_member_id };
          }
        }
      }

      // Nomes dos vendedores
      const memberIds = Array.from(
        new Set(Object.values(leadMap).map((l) => l.member_id).filter(Boolean)),
      ) as string[];
      let memberMap: Record<string, string> = {};
      if (memberIds.length) {
        const { data: members } = await (supabase as any)
          .from('ai_team_members')
          .select('id, name')
          .in('id', memberIds);
        memberMap = Object.fromEntries((members || []).map((m: any) => [m.id, m.name]));
      }

      // Histograma por hora
      const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
        hora: `${pad(h)}h`,
        count: 0,
      }));
      for (const m of msgs) buckets[spHour(m.created_at)].count++;

      // Lista detalhada com intervalo entre disparos consecutivos
      const list: DispatchItem[] = msgs.map((m, idx) => {
        const lead = m.remote_jid ? leadMap[m.remote_jid] : undefined;
        const memberId = lead?.member_id || null;
        const prev = idx > 0 ? msgs[idx - 1] : null;
        const intervaloMin = prev
          ? Math.round((new Date(m.created_at).getTime() - new Date(prev.created_at).getTime()) / 60000)
          : null;

        let tipo: 'ia' | 'manual' = 'ia';
        if (m.type) {
          tipo = m.type === 'manual' ? 'manual' : 'ia';
        } else {
          tipo = (m.content || '').startsWith('[Follow-up IA]') ? 'ia' : 'manual';
        }

        return {
          id: m.id,
          hora: spHourMin(m.created_at),
          nome: lead?.lead_name || 'Lead',
          fone: fmtPhone(m.remote_jid),
          vendedor: (memberId && memberMap[memberId]) || 'Sem vendedor',
          tipo,
          intervaloMin,
          status: m.status,
          errorMessage: m.error_message
        };
      });

      setDayCount(msgs.length);
      setLeadsCount(jids.length);
      setMonthCount(totalMonth);
      setHourly(buckets);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [userId, selectedDate]);

  // Andamento da fila de reativação (estado AGORA, não depende do dia).
  const fetchQueue = useCallback(async () => {
    if (!userId) return;
    setQueueLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .rpc('get_reactivation_queue_status', { p_user_id: userId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setQueue({
          cycleStartedAt: row.cycle_started_at ?? null,
          total: Number(row.total_fila ?? 0),
          enviados: Number(row.enviados_ciclo ?? 0),
          restantes: Number(row.restantes_ciclo ?? 0),
          responderam: Number(row.responderam_ciclo ?? 0),
        });
      } else {
        setQueue(null);
      }
    } catch (e) {
      console.error('[FollowupDashboard] erro ao buscar fila de reativação:', e);
      setQueue(null);
    } finally {
      setQueueLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const hasData = dayCount > 0;
  const queueProgress = queue && queue.total > 0
    ? Math.round((queue.enviados / queue.total) * 100)
    : 0;

  return (
    <div className="space-y-3">
      {/* Cabeçalho + seletor de dia */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Disparos de follow-up (automático + manual) feitos no dia, com lead, vendedor e intervalo.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Input
            type="date"
            value={selectedDate}
            max={todayStr}
            onChange={(e) => setSelectedDate(e.target.value || todayStr)}
            className="h-8 text-xs w-36 [&::-webkit-calendar-picker-indicator]:invert"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => { fetchData(); fetchQueue(); }}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* ── Andamento da fila de reativação (round-robin) ─────────────────── */}
      <Card className="bg-card border-primary/30">
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <ListChecks className="h-3.5 w-3.5 text-primary" />
            Andamento da fila de reativação
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3 space-y-3">
          {queueLoading ? (
            <div className="h-16 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : !queue || queue.total + queue.enviados === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Nenhum lead inativo elegível na fila no momento. Quando houver leads na coluna
              "Lead Inativo", o Pedro começa a percorrer a fila e o andamento aparece aqui.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border/50 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400/80" /> Já contatados
                  </p>
                  <p className="text-xl font-bold text-foreground mt-0.5">{queue.enviados}</p>
                </div>
                <div className="rounded-lg border border-border/50 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Clock className="h-3 w-3 text-amber-400/80" /> Faltam nesta volta
                  </p>
                  <p className="text-xl font-bold text-foreground mt-0.5">{queue.restantes}</p>
                </div>
                <div className="rounded-lg border border-border/50 p-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <MessageCircleReply className="h-3 w-3 text-cyan-400/80" /> Responderam
                  </p>
                  <p className="text-xl font-bold text-foreground mt-0.5">{queue.responderam}</p>
                </div>
              </div>

              {/* Barra de progresso da volta atual */}
              <div className="space-y-1">
                <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${queueProgress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {queue.enviados} de {queue.enviados + queue.restantes} contatados nesta volta
                    {' '}({queueProgress}%)
                  </span>
                  <span>Volta começou {spDateTime(queue.cycleStartedAt)}</span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {queue.restantes === 0
                  ? 'Volta completa: todos os leads da fila já foram contatados. O Pedro vai iniciar uma nova volta do começo.'
                  : `O Pedro contata todos os ${queue.enviados + queue.restantes} leads da fila uma vez antes de repetir qualquer um. Faltam ${queue.restantes} para fechar esta volta.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="bg-card border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  {isToday ? 'Disparos hoje' : `Disparos ${brShortDate(selectedDate)}`}
                </p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{loading ? '—' : dayCount}</p>
              </div>
              <Send className="h-6 w-6 text-blue-400/80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Leads atingidos</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{loading ? '—' : leadsCount}</p>
              </div>
              <Users className="h-6 w-6 text-cyan-400/80" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Disparos no mês</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{loading ? '—' : monthCount}</p>
              </div>
              <CalendarDays className="h-6 w-6 text-emerald-400/80" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico por hora */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-xs">
            Disparos por horário {isToday ? '(hoje)' : `(${brShortDate(selectedDate)})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {loading ? (
            <div className="h-44 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hasData ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                  <XAxis
                    dataKey="hora"
                    interval={2}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
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
                    formatter={(v: any) => [`${v} disparo(s)`, 'Disparos']}
                  />
                  <Bar dataKey="count" name="Disparos" fill="hsl(217, 91%, 60%)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-44 flex flex-col items-center justify-center text-center gap-2">
              <Send className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhum disparo de follow-up nesta data.</p>
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
        <CardHeader className="pb-1 pt-3">
          <CardTitle className="text-xs flex items-center justify-between">
            <span>Detalhe dos disparos</span>
            {hasData && (
              <Badge variant="outline" className="text-[10px] font-normal">
                {dayCount} {dayCount === 1 ? 'disparo' : 'disparos'}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          {loading ? (
            <div className="py-6 flex items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hasData ? (
            <div className="divide-y divide-border/40 max-h-72 overflow-auto">
              {items.map((it) => (
                <div key={it.id} className="flex items-center gap-2.5 py-2">
                  <div className="w-12 shrink-0">
                    <span className="text-xs font-mono text-blue-400">{it.hora}</span>
                    {it.intervaloMin != null && (
                      <span className="block text-[10px] text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />+{it.intervaloMin}m
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{it.nome}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Phone className="h-2.5 w-2.5" /> {it.fone}
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                      <UserCheck className="h-2.5 w-2.5" /> {it.vendedor}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge
                      className={
                        it.tipo === 'ia'
                          ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30 text-[10px]'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]'
                      }
                    >
                      {it.tipo === 'ia' ? 'IA' : 'Manual'}
                    </Badge>
                    {it.status === 'failed' && (
                      <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[9px]" title={it.errorMessage || 'Falha no envio'}>
                        Falhou
                      </Badge>
                    )}
                    {it.status === 'responded' && (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px]">
                        Respondido
                      </Badge>
                    )}
                    {it.status === 'delivered' && (
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[9px]">
                        Entregue
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground py-6">
              Nenhum disparo de follow-up nesta data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
