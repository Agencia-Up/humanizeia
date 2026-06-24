import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import {
  Activity, Coins, DollarSign, Users, RefreshCcw, Info, AlertTriangle, ScanSearch, Siren,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Aba SUPERADMIN — Auditoria de Consumo de IA (god-view) ───────────────────
// Vive dentro de /administracao. Cruza TODOS os clientes/agentes: tokens, custo,
// quebra por tipo de disparo, serie por dia, traces com loop e flags de anomalia.
// SO-REGISTRO: nada corta o atendimento. Le tudo de RPCs SECURITY DEFINER
// (admin_ai_audit_overview / _loops / _anomaly_flags) gated por superadmin.

const nf = (n: unknown) => (typeof n === 'number' ? n : Number(n ?? 0)) || 0;
function brl(n: unknown, casas = 2) {
  return nf(n).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas,
  });
}
function usd(n: unknown, casas = 4) {
  return '$ ' + nf(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: casas });
}
function int(n: unknown) {
  return Math.round(nf(n)).toLocaleString('pt-BR');
}
function dataHora(s: unknown) {
  if (!s) return '—';
  try { return new Date(String(s)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(s); }
}
function diaCurto(s: unknown) {
  const str = String(s ?? '');
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : str;
}

const DISPARO_LABEL: Record<string, string> = {
  inbound_pedro: 'Pedro (conversa)',
  followup_auto: 'Follow-up automático',
  reativacao: 'Reativação',
  broadcast_marcos: 'Disparo em massa',
  jose_apollo: 'José (tráfego)',
  social_media: 'Social media',
  claude_chat: 'Chat / assistente',
  transcricao_audio: 'Transcrição de áudio',
  embedding: 'Busca semântica',
  manual_test: 'Teste manual',
  outro: 'Outro',
};
const RULE_LABEL: Record<string, string> = {
  spike_vs_7d_avg: 'Pico vs média 7d',
  subcall_loop: 'Loop de chamadas',
  absolute_daily_cap: 'Teto diário',
};
const PROVEDOR_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  lovable: 'Lovable',
  deepseek: 'Deepseek',
};

interface PorCliente {
  user_id: string; cliente_nome: string; operacoes: number; tokens: number; custo_usd: number; custo_brl: number;
}
interface PorAgente {
  agent_id: string; agente: string; cliente_nome: string;
  turnos: number; chamadas: number; chamadas_por_turno: number;
  tokens: number; input_tokens: number; output_tokens: number; custo_brl: number;
}
interface PorDisparo {
  disparo_tipo: string; operacoes: number; tokens: number; custo_usd: number; custo_brl: number;
}
interface PorModelo {
  provedor: string; modelo: string; chamadas: number;
  tokens: number; input_tokens: number; output_tokens: number; custo_brl: number;
}
interface SerieDia { dia: string; operacoes: number; tokens: number; custo_brl: number; }
interface SerieDiaAgente { dia: string; agent_id: string | null; agente: string; tokens: number; custo_brl: number; }
interface Overview {
  periodo_dias: number;
  config: { cambio_usd_brl?: number; gpt4o_usd_in?: number; gpt4o_usd_out?: number };
  totais: {
    operacoes?: number; turnos?: number; chamadas?: number; tokens?: number;
    input_tokens?: number; output_tokens?: number; custo_usd?: number; custo_brl?: number;
    n_clientes?: number; n_agentes?: number;
  };
  por_cliente: PorCliente[];
  por_agente: PorAgente[];
  por_disparo: PorDisparo[];
  por_modelo: PorModelo[];
  serie_dia: SerieDia[];
  serie_dia_agente?: SerieDiaAgente[];
  gerado_em?: string;
}
interface Flag {
  id: string; created_at: string; rule: string; severity: string; cliente_nome: string;
  trace_id: string | null; metric_value: number | null; threshold_value: number | null; details: any;
}
interface Loop {
  trace_id: string; cliente_nome: string; agente: string | null; n_subcalls: number;
  linhas: number; tokens: number; ultima: string;
}

const PERIODOS = [7, 30, 90];

export default function AdminAuditoriaTab() {
  const { toast } = useToast();
  const [dias, setDias] = useState(30);
  const [ov, setOv] = useState<Overview | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loops, setLoops] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Grafico: agente selecionado ('todos' = visao global) + metrica exibida (tokens | custo R$).
  const [agenteSel, setAgenteSel] = useState<string>('todos');
  const [metrica, setMetrica] = useState<'tokens' | 'custo'>('tokens');

  const carregar = useCallback(async (periodo: number) => {
    setLoading(true);
    setErro(null);
    try {
      const [ovRes, flRes, lpRes] = await Promise.all([
        (supabase as any).rpc('admin_ai_audit_overview', { p_days: periodo }),
        (supabase as any).rpc('admin_ai_anomaly_flags', { p_days: Math.min(periodo, 30) }),
        (supabase as any).rpc('admin_ai_audit_loops', { p_days: Math.min(periodo, 30) }),
      ]);
      if (ovRes.error) throw ovRes.error;
      setOv(ovRes.data as Overview);
      setFlags((flRes.data as Flag[]) ?? []);
      setLoops((lpRes.data as Loop[]) ?? []);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar a auditoria de consumo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(dias); }, [carregar, dias]);

  const rodarDeteccao = useCallback(async () => {
    setRodando(true);
    try {
      const { data, error } = await (supabase as any).rpc('admin_run_ai_anomaly', { p_window: 'daily', p_dry_run: false });
      if (error) throw error;
      const f = data?.flags ?? {};
      toast({
        title: 'Detecção concluída',
        description: `Picos: ${f.spike_vs_7d_avg ?? 0} · Loops: ${f.subcall_loop ?? 0} · Teto: ${f.absolute_daily_cap ?? 0}`,
      });
      await carregar(dias);
    } catch (e: any) {
      toast({ title: 'Erro ao rodar detecção', description: e?.message || 'Falha', variant: 'destructive' });
    } finally {
      setRodando(false);
    }
  }, [carregar, dias, toast]);

  const t = ov?.totais ?? {};
  const serie = ov?.serie_dia ?? [];

  // Agentes disponíveis no dropdown (só os com id, em ordem de consumo).
  const agentesList = useMemo(
    () => (ov?.por_agente ?? []).filter((a) => a.agent_id),
    [ov?.por_agente],
  );
  // A RPC precisa devolver `serie_dia_agente` (migration 20260624) pro filtro por agente funcionar.
  const temSerieAgente = (ov?.serie_dia_agente ?? []).length > 0;
  // Série do gráfico: 'todos' usa a global; um agente filtra a série por agente, ALINHADA ao eixo de
  // dias global (preenche 0 nos dias sem consumo daquele agente) pra o eixo X ficar consistente.
  const chartData = useMemo(() => {
    if (agenteSel === 'todos' || !temSerieAgente) {
      return serie.map((d) => ({ dia: d.dia, tokens: nf(d.tokens), custo_brl: nf(d.custo_brl) }));
    }
    const byDay = new Map<string, { tokens: number; custo_brl: number }>();
    for (const r of ov?.serie_dia_agente ?? []) {
      if (String(r.agent_id) !== agenteSel) continue;
      byDay.set(String(r.dia), { tokens: nf(r.tokens), custo_brl: nf(r.custo_brl) });
    }
    return serie.map((d) => {
      const v = byDay.get(String(d.dia));
      return { dia: d.dia, tokens: v?.tokens ?? 0, custo_brl: v?.custo_brl ?? 0 };
    });
  }, [agenteSel, serie, ov?.serie_dia_agente, temSerieAgente]);
  const agenteNome = agenteSel === 'todos'
    ? 'Todos os agentes'
    : (agentesList.find((a) => String(a.agent_id) === agenteSel)?.agente ?? 'Agente');

  return (
    <div className="space-y-6">

      {/* Cabecalho da aba */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Quanto cada cliente e agente consome de IA — só registra, não corta nada.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border">
            {PERIODOS.map((p) => (
              <button
                key={p}
                onClick={() => setDias(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  dias === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={rodarDeteccao} disabled={rodando}>
            <ScanSearch className={`mr-2 h-4 w-4 ${rodando ? 'animate-pulse' : ''}`} />
            Rodar detecção
          </Button>
          <Button variant="outline" size="sm" onClick={() => carregar(dias)} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* Cards de totais */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Activity} cor="text-sky-500" titulo="Turnos"
          valor={loading ? null : int(t.turnos ?? t.operacoes)}
          sub={loading ? '' : `${int(t.chamadas)} chamadas IA · ${int(t.n_agentes)} agentes`} />
        <TotalCard icon={Coins} cor="text-violet-500" titulo="Tokens"
          valor={loading ? null : int(t.tokens)}
          sub={loading ? '' : `entrada ${int(t.input_tokens)} / saída ${int(t.output_tokens)}`} />
        <TotalCard icon={DollarSign} cor="text-amber-500" titulo="Custo (USD)"
          valor={loading ? null : usd(t.custo_usd)} sub={`${int(t.n_clientes)} clientes · ${dias}d`} />
        <TotalCard icon={Users} cor="text-emerald-500" titulo="Custo (R$)"
          valor={loading ? null : brl(t.custo_brl, 2)}
          sub={loading ? '' : `câmbio ${brl(ov?.config?.cambio_usd_brl, 4)}`} />
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          Cada conversa do Pedro vira <strong>1 linha por turno</strong> (somando as sub-chamadas). O custo em USD
          é calculado pela tabela de preços por modelo; o R$ usa o câmbio atual. É uma camada de auditoria — não
          mexe na cobrança do cliente nem bloqueia atendimento.
        </AlertDescription>
      </Alert>

      {/* Por agente — visão diagnóstica (aponta o agente fora da curva sozinho) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por agente</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            "Ch/turno" alto = idas-e-voltas de ferramenta encarecendo o turno. "Entrada" muito maior que "Saída" = prompt grande re-enviado a cada chamada.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Turnos</TableHead>
                  <TableHead className="text-right">Chamadas</TableHead>
                  <TableHead className="text-right">Ch/turno</TableHead>
                  <TableHead className="text-right">Entrada</TableHead>
                  <TableHead className="text-right">Saída</TableHead>
                  <TableHead className="text-right">Custo R$</TableHead>
                  <TableHead className="text-right">R$/turno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (ov?.por_agente ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      Sem dados ainda — enche conforme o Pedro atende.
                    </TableCell>
                  </TableRow>
                ) : (
                  (ov?.por_agente ?? []).map((a) => (
                    <TableRow key={a.agent_id ?? a.agente}>
                      <TableCell className="max-w-[150px] truncate font-medium">{a.agente}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">{a.cliente_nome}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(a.turnos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(a.chamadas)}</TableCell>
                      <TableCell className="text-right tabular-nums"><ChTurno v={a.chamadas_por_turno} /></TableCell>
                      <TableCell className="text-right tabular-nums">{int(a.input_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{int(a.output_tokens)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{brl(a.custo_brl, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{nf(a.turnos) > 0 ? brl(nf(a.custo_brl) / nf(a.turnos), 3) : '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Grafico: tokens/custo por dia — filtravel por agente, tooltip com tokens + R$ */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {metrica === 'tokens' ? 'Tokens por dia' : 'Custo por dia (R$)'}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle: Tokens / Custo R$ */}
              <div className="flex rounded-md border border-border">
                {(['tokens', 'custo'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetrica(m)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      metrica === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {m === 'tokens' ? 'Tokens' : 'Custo R$'}
                  </button>
                ))}
              </div>
              {/* Dropdown: filtrar por agente */}
              <Select value={agenteSel} onValueChange={setAgenteSel}>
                <SelectTrigger className="h-8 w-[190px] text-xs">
                  <SelectValue placeholder="Todos os agentes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os agentes</SelectItem>
                  {agentesList.map((a) => (
                    <SelectItem key={String(a.agent_id)} value={String(a.agent_id)}>
                      {a.agente}{a.cliente_nome && a.cliente_nome !== '—' ? ` · ${a.cliente_nome}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {agenteSel !== 'todos' && !temSerieAgente && (
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Filtro por agente fica disponível após aplicar a atualização do banco (serie_dia_agente).
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sem consumo registrado no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="dia" tickFormatter={diaCurto} tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (metrica === 'tokens' ? int(v) : brl(v, 0))}
                  width={metrica === 'tokens' ? 64 : 72}
                />
                <Tooltip cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} content={<ChartTooltip nomeAgente={agenteNome} />} />
                <Bar dataKey={metrica === 'tokens' ? 'tokens' : 'custo_brl'} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Flags de anomalia */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Siren className="h-4 w-4 text-destructive" />
            Anomalias detectadas
            {!loading && flags.length > 0 && (
              <Badge variant="destructive" className="text-[11px]">{flags.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Regra</TableHead>
                  <TableHead>Gravidade</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Limite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : flags.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma anomalia no período.
                    </TableCell>
                  </TableRow>
                ) : (
                  flags.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dataHora(f.created_at)}</TableCell>
                      <TableCell className="max-w-[200px] truncate font-medium">{f.cliente_nome}</TableCell>
                      <TableCell className="text-xs">{RULE_LABEL[f.rule] ?? f.rule}</TableCell>
                      <TableCell><SeverityBadge sev={f.severity} /></TableCell>
                      <TableCell className="text-right tabular-nums">{int(f.metric_value)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{int(f.threshold_value)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Por cliente + por disparo */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top clientes</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Oper.</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Custo R$</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 4 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (ov?.por_cliente ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Sem dados.</TableCell></TableRow>
                  ) : (
                    (ov?.por_cliente ?? []).map((c) => (
                      <TableRow key={c.user_id}>
                        <TableCell className="max-w-[180px] truncate font-medium">{c.cliente_nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(c.operacoes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(c.tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(c.custo_brl, 2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Por tipo de disparo</CardTitle></CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Oper.</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead className="text-right">Custo R$</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 4 }).map((__, j) => (
                          <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (ov?.por_disparo ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">Sem dados.</TableCell></TableRow>
                  ) : (
                    (ov?.por_disparo ?? []).map((d) => (
                      <TableRow key={d.disparo_tipo}>
                        <TableCell className="font-medium">{DISPARO_LABEL[d.disparo_tipo] ?? d.disparo_tipo}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(d.operacoes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(d.tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(d.custo_brl, 2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Por modelo (espelha a fatura da OpenAI: gpt-4o vs mini vs embeddings) */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Por modelo</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plataforma</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Chamadas</TableHead>
                  <TableHead className="text-right">Entrada</TableHead>
                  <TableHead className="text-right">Saída</TableHead>
                  <TableHead className="text-right">Custo R$</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (<TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>))}
                    </TableRow>
                  ))
                ) : (ov?.por_modelo ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sem dados.</TableCell></TableRow>
                ) : (
                  (ov?.por_modelo ?? []).map((m) => (
                    <TableRow key={`${m.provedor}/${m.modelo}`}>
                      <TableCell className="text-xs">{PROVEDOR_LABEL[m.provedor] ?? m.provedor}</TableCell>
                      <TableCell className="font-medium">{m.modelo}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(m.chamadas)}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(m.input_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{int(m.output_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(m.custo_brl, 2)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Traces com loop */}
      {!loading && loops.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Turnos com muitas chamadas (possível loop)</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead className="text-right">Sub-chamadas</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead>Trace</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loops.map((l) => (
                    <TableRow key={l.trace_id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dataHora(l.ultima)}</TableCell>
                      <TableCell className="max-w-[160px] truncate font-medium">{l.cliente_nome}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">{l.agente ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">{int(l.n_subcalls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{int(l.tokens)}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{l.trace_id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {ov?.gerado_em && !loading && (
        <p className="text-right text-[11px] text-muted-foreground">Gerado em {dataHora(ov.gerado_em)}</p>
      )}
    </div>
  );
}

// Tooltip do gráfico: mostra SEMPRE tokens E o valor em R$ correspondente (pedido do dono), mesmo
// quando a barra está em "Custo" — pra cruzar quantidade de tokens × custo de relance.
function ChartTooltip({ active, payload, label, nomeAgente }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{diaCurto(label)}</p>
      {nomeAgente && nomeAgente !== 'Todos os agentes' && (
        <p className="mb-1 text-[10px] text-muted-foreground">{nomeAgente}</p>
      )}
      <p className="text-muted-foreground">
        Tokens: <span className="font-medium text-foreground">{int(d.tokens)}</span>
      </p>
      <p className="text-muted-foreground">
        Custo: <span className="font-medium text-emerald-600 dark:text-emerald-400">{brl(d.custo_brl, 2)}</span>
      </p>
    </div>
  );
}

function ChTurno({ v }: { v: number }) {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  const cls = n >= 5
    ? 'text-destructive font-semibold'
    : n >= 3 ? 'text-amber-600 font-medium dark:text-amber-400' : '';
  return <span className={cls}>{n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>;
}

function SeverityBadge({ sev }: { sev: string }) {
  if (sev === 'critical') return <Badge variant="destructive" className="text-[11px]">Crítico</Badge>;
  if (sev === 'warn') return <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-600 text-[11px] dark:text-amber-400">Atenção</Badge>;
  return <Badge variant="secondary" className="text-[11px]">Info</Badge>;
}

function TotalCard({
  icon: Icon, cor, titulo, valor, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  cor: string; titulo: string; valor: string | null; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
          <Icon className={`h-4 w-4 ${cor}`} />
        </div>
        {valor === null
          ? <Skeleton className="mt-2 h-7 w-28" />
          : <p className="mt-1 text-2xl font-bold text-foreground">{valor}</p>}
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
