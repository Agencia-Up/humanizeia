import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  RefreshCcw, TrendingUp, DollarSign, Server, Plus, Trash2, Info, Wallet, Users,
} from 'lucide-react';

// ── Margem real (Administrativo) ─────────────────────────────────────────────
// Receita (clientes pagantes) − Custos fixos (editáveis) − Custo de IA do José
// (real, do ai_call_log) = Margem líquida. Mês corrente. Só superadmin.

const nf = (n: unknown) => (typeof n === 'number' ? n : Number(n ?? 0)) || 0;
function brl(n: unknown, casas = 2) {
  return nf(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: casas, maximumFractionDigits: casas });
}
const inputCls = 'w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary';

interface CustoFixo { id: string; nome: string; valor_brl: number; ativo: boolean; }
interface Conta { user_id: string; nome: string; receita_brl: number; pagante: boolean; custo_jose_brl: number; }
interface Overview {
  mes_inicio: string; cambio_usd_brl: number;
  custos_fixos: CustoFixo[]; contas: Conta[];
  totais: { receita_brl: number; custos_fixos_brl: number; custo_jose_brl: number };
  gerado_em: string;
}

export default function AdminMargemTab() {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [custoVal, setCustoVal] = useState<Record<string, string>>({});
  const [receitaVal, setReceitaVal] = useState<Record<string, string>>({});
  const [novoNome, setNovoNome] = useState('');
  const [novoValor, setNovoValor] = useState('');
  const [saving, setSaving] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data: res, error } = await (supabase as any).rpc('admin_margem_overview');
      if (error) throw error;
      setData(res as Overview);
      setCustoVal({}); setReceitaVal({});
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar a margem.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const rpc = useCallback(async (fn: string, args: any) => {
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc(fn, args);
      if (error) throw error;
      await carregar();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message || 'Falha', variant: 'destructive' });
    } finally { setSaving(false); }
  }, [carregar, toast]);

  const salvarCusto = (c: CustoFixo) =>
    rpc('admin_margem_set_custo', { p_id: c.id, p_nome: c.nome, p_valor: Number(custoVal[c.id] ?? c.valor_brl) || 0, p_ativo: c.ativo });
  const toggleCusto = (c: CustoFixo) =>
    rpc('admin_margem_set_custo', { p_id: c.id, p_nome: c.nome, p_valor: c.valor_brl, p_ativo: !c.ativo });
  const delCusto = (c: CustoFixo) => rpc('admin_margem_del_custo', { p_id: c.id });
  const addCusto = () => {
    if (!novoNome.trim()) return;
    rpc('admin_margem_set_custo', { p_id: null, p_nome: novoNome.trim(), p_valor: Number(novoValor) || 0, p_ativo: true })
      .then(() => { setNovoNome(''); setNovoValor(''); });
  };
  const salvarReceita = (c: Conta) =>
    rpc('admin_margem_set_cliente', { p_user_id: c.user_id, p_receita: Number(receitaVal[c.user_id] ?? c.receita_brl) || 0, p_ativo: c.pagante || Number(receitaVal[c.user_id] ?? c.receita_brl) > 0 });
  const togglePagante = (c: Conta) =>
    rpc('admin_margem_set_cliente', { p_user_id: c.user_id, p_receita: c.receita_brl, p_ativo: !c.pagante });

  const t = data?.totais;
  const receita = nf(t?.receita_brl), fixos = nf(t?.custos_fixos_brl), custoJose = nf(t?.custo_jose_brl);
  const margem = receita - fixos - custoJose;
  const margemPct = receita > 0 ? (margem / receita) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Margem do mês — receita dos clientes pagantes menos os custos fixos e o custo de IA do José.
        </p>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading || saving}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {erro && <Alert variant="destructive"><AlertDescription>{erro}</AlertDescription></Alert>}

      {/* Cards de totais */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={DollarSign} cor="text-emerald-500" titulo="Receita (mês)"
          valor={loading ? null : brl(receita)} sub="clientes pagantes" />
        <TotalCard icon={Server} cor="text-sky-500" titulo="Custos fixos"
          valor={loading ? null : brl(fixos)} sub="Hostinger + Supabase + UAZAPI…" />
        <TotalCard icon={Wallet} cor="text-amber-500" titulo="Custo IA (José)"
          valor={loading ? null : brl(custoJose)} sub="gasto real de token no mês" />
        <TotalCard icon={TrendingUp} cor={margem >= 0 ? 'text-primary' : 'text-destructive'} titulo="Margem líquida"
          valor={loading ? null : brl(margem)} sub={loading ? '' : `${margemPct.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% da receita`} />
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>Margem = Receita − Custos fixos − Custo IA do José.</strong> O custo de IA é só do José (gasto real de token medido).
          O valor do mês acumula ao longo dele, então no começo do mês o custo aparece menor. Câmbio {loading ? '—' : brl(data?.cambio_usd_brl, 4)}.
        </AlertDescription>
      </Alert>

      {/* Custos fixos editáveis */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4" /> Custos fixos (mensais)</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Custo</TableHead>
                  <TableHead className="text-right">Valor (R$/mês)</TableHead>
                  <TableHead className="text-center">Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 4 }).map((__, j) => (<TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>))}</TableRow>
                  ))
                ) : (
                  (data?.custos_fixos ?? []).map((c) => (
                    <TableRow key={c.id} className={c.ativo ? '' : 'opacity-60'}>
                      <TableCell className="font-medium">{c.nome}</TableCell>
                      <TableCell className="text-right">
                        <input type="number" step="0.01" className={inputCls}
                          value={custoVal[c.id] ?? String(c.valor_brl)}
                          onChange={(e) => setCustoVal((s) => ({ ...s, [c.id]: e.target.value }))} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant={c.ativo ? 'default' : 'outline'} size="sm" className="h-7 text-[11px]" onClick={() => toggleCusto(c)} disabled={saving}>
                          {c.ativo ? 'Sim' : 'Não'}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" className="h-7 text-[11px]" onClick={() => salvarCusto(c)} disabled={saving}>Salvar</Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => delCusto(c)} disabled={saving}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                {/* Adicionar novo */}
                <TableRow>
                  <TableCell>
                    <input className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Novo custo (ex: Domínio)" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                  </TableCell>
                  <TableCell className="text-right">
                    <input type="number" step="0.01" className={inputCls} placeholder="0,00" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={addCusto} disabled={saving || !novoNome.trim()}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Receita por conta */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Contas — receita & custo do José</CardTitle>
          <p className="text-[11px] text-muted-foreground">Marque "Pagante" só nos clientes reais e ponha a mensalidade. ADM, conta de teste e vendedores deixam desmarcado.</p>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-center">Pagante</TableHead>
                  <TableHead className="text-right">Receita (R$/mês)</TableHead>
                  <TableHead className="text-right">Custo José (mês)</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 5 }).map((__, j) => (<TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>))}</TableRow>
                  ))
                ) : (data?.contas ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Nenhuma conta com agente.</TableCell></TableRow>
                ) : (
                  (data?.contas ?? []).map((c) => (
                    <TableRow key={c.user_id} className={c.pagante ? '' : 'opacity-70'}>
                      <TableCell className="max-w-[220px] truncate font-medium">
                        {c.nome}
                        {c.pagante && <Badge variant="secondary" className="ml-2 text-[10px]">cliente</Badge>}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant={c.pagante ? 'default' : 'outline'} size="sm" className="h-7 text-[11px]" onClick={() => togglePagante(c)} disabled={saving}>
                          {c.pagante ? 'Sim' : 'Não'}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <input type="number" step="0.01" className={inputCls}
                          value={receitaVal[c.user_id] ?? String(c.receita_brl)}
                          onChange={(e) => setReceitaVal((s) => ({ ...s, [c.user_id]: e.target.value }))} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{brl(c.custo_jose_brl)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" className="h-7 text-[11px]" onClick={() => salvarReceita(c)} disabled={saving}>Salvar</Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
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
        {valor === null ? <Skeleton className="mt-2 h-7 w-28" /> : <p className="mt-1 text-2xl font-bold text-foreground">{valor}</p>}
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
