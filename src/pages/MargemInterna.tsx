import { useEffect, useState, useCallback } from 'react';
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
  TrendingUp, DollarSign, Wallet, RefreshCcw, Users, Coins, Info, AlertTriangle,
} from 'lucide-react';

// ── Painel INTERNO de margem de IA (FASE 4) ──────────────────────────────────
// So o superadmin acessa (gate na rota via AdminRoute + gate no RPC). Mostra o
// CUSTO REAL de IA por cliente (derivado do Pedro, sem tocar nele) vs a RECEITA
// do plano => MARGEM. Nada disso e mostrado ao cliente; e visao de operacao.
// Le tudo de uma RPC SECURITY DEFINER (admin_ia_margem_overview).

/* ── helpers de formatacao (dinheiro NUMERIC, nunca arredonda escondido) ── */
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
function pct(n: unknown) {
  return nf(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function dataHora(s: unknown) {
  if (!s) return '—';
  try { return new Date(String(s)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(s); }
}

interface Cliente {
  cliente_id: string;
  cliente_nome: string;
  cliente_phone: string | null;
  plan_id: string;
  receita_brl: number;
  leads_atendidos: number;
  total_tokens: number;
  custo_usd: number;
  custo_brl: number;
  margem_brl: number;
  custo_brl_por_atendimento: number;
}
interface Overview {
  config: {
    cambio_usd_brl?: number; cambio_fonte?: string; cambio_atualizado_em?: string;
    markup?: number; pedro_split_input?: number; gpt4o_usd_in?: number; gpt4o_usd_out?: number;
  };
  totais: {
    n_clientes?: number; n_clientes_com_custo?: number; leads_atendidos?: number;
    total_tokens?: number; custo_usd?: number; custo_brl?: number;
    receita_brl?: number; margem_brl?: number;
  };
  clientes: Cliente[];
  gerado_em?: string;
}

const PLANO_LABEL: Record<string, string> = { basico: 'Básico', pro: 'Pro', enterprise: 'Pro Max' };

export default function MargemInterna() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data: res, error } = await (supabase as any).rpc('admin_ia_margem_overview');
      if (error) throw error;
      setData(res as Overview);
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar o painel de margem.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const t = data?.totais ?? {};
  const c = data?.config ?? {};
  const receita = nf(t.receita_brl);
  const custo = nf(t.custo_brl);
  const margem = nf(t.margem_brl);
  const margemPct = receita > 0 ? (margem / receita) * 100 : 0;
  const custoMedioAtend = nf(t.leads_atendidos) > 0 ? custo / nf(t.leads_atendidos) : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">

      {/* ── Cabecalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Wallet className="h-6 w-6 text-primary" />
            Margem Interna (IA)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Custo real de IA por cliente vs receita do plano. Visão de operação — o cliente não vê estes valores.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* ── Erro ── */}
      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* ── Faixa de config (cambio + parametros) ── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <ConfigItem label="Câmbio USD→BRL" value={loading ? null : brl(c.cambio_usd_brl, 4)}
            hint={loading ? '' : `${c.cambio_fonte ?? '—'} · ${dataHora(c.cambio_atualizado_em)}`} />
          <ConfigItem label="Markup" value={loading ? null : `${nf(c.markup).toLocaleString('pt-BR')}x`}
            hint="referência — não debita ninguém" />
          <ConfigItem label="Split Pedro (input)" value={loading ? null : pct(nf(c.pedro_split_input) * 100)}
            hint="aprox. input/output do total" />
          <ConfigItem label="gpt-4o (1M tokens)" value={loading ? null : `${usd(c.gpt4o_usd_in, 2)} / ${usd(c.gpt4o_usd_out, 2)}`}
            hint="input / output" />
        </CardContent>
      </Card>

      {/* ── Cards de totais ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={DollarSign} cor="text-emerald-500" titulo="Receita (ciclo)"
          valor={loading ? null : brl(receita)} sub={`${int(t.n_clientes)} clientes`} />
        <TotalCard icon={Coins} cor="text-amber-500" titulo="Custo real de IA"
          valor={loading ? null : brl(custo, 4)} sub={`${usd(t.custo_usd)} · piso real`} />
        <TotalCard icon={TrendingUp} cor="text-primary" titulo="Margem"
          valor={loading ? null : brl(margem)} sub={loading ? '' : pct(margemPct) + ' da receita'} />
        <TotalCard icon={Users} cor="text-sky-500" titulo="Atendimentos"
          valor={loading ? null : int(t.leads_atendidos)}
          sub={loading ? '' : `${brl(custoMedioAtend, 4)} / atend.`} />
      </div>

      {/* ── Nota da aproximacao ── */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          O custo do Pedro é um <strong>piso real</strong>: vem do total de tokens que ele já registra por
          atendimento (cérebro gpt-4o), com divisão input/output aproximada pelo split configurado. Chamadas
          auxiliares (mini, embeddings) não entram, então o custo verdadeiro é igual ou um pouco maior. Câmbio e
          preços são editáveis e auditáveis. Nada aqui debita o saldo do cliente.
        </AlertDescription>
      </Alert>

      {/* ── Tabela por cliente ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por cliente — ciclo atual</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead className="text-right">Atend.</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Custo USD</TableHead>
                  <TableHead className="text-right">Custo R$</TableHead>
                  <TableHead className="text-right">Custo/atend.</TableHead>
                  <TableHead className="text-right">Receita</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (data?.clientes ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum cliente no ciclo atual.
                    </TableCell>
                  </TableRow>
                ) : (
                  (data?.clientes ?? []).map((cli) => {
                    const temCusto = nf(cli.custo_brl) > 0;
                    return (
                      <TableRow key={cli.cliente_id} className={temCusto ? '' : 'opacity-70'}>
                        <TableCell className="max-w-[200px]">
                          <div className="truncate font-medium">{cli.cliente_nome}</div>
                          {cli.cliente_phone && (
                            <div className="truncate text-[11px] text-muted-foreground">{cli.cliente_phone}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[11px]">
                            {PLANO_LABEL[cli.plan_id] ?? cli.plan_id}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{int(cli.leads_atendidos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{int(cli.total_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(cli.custo_usd)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(cli.custo_brl, 4)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {brl(cli.custo_brl_por_atendimento, 4)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(cli.receita_brl)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                          {brl(cli.margem_brl)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {data?.gerado_em && !loading && (
        <p className="text-right text-[11px] text-muted-foreground">
          Gerado em {dataHora(data.gerado_em)}
        </p>
      )}
    </div>
  );
}

/* ── subcomponentes ─────────────────────────────────────────────────────── */
function ConfigItem({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">{label}</p>
      {value === null
        ? <Skeleton className="mt-1 h-5 w-24" />
        : <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
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
