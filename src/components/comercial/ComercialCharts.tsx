// ============================================================================
// ComercialCharts — 3 gráficos do bloco comercial (recharts):
//   1) Vendas por origem (donut) — recorte do período.
//   2) Vendas por mês (barras) — o ano todo (contexto).
//   3) Evolução da meta no mês (linha acumulada + linha da meta).
// Tudo já recebe as vendas FILTRADAS pelo recorte ativo (geral ou 1 vendedor).
// ============================================================================
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, ReferenceLine,
} from 'recharts';
import { ORIGENS, ORIGEM_COR, ORIGEM_LABEL, type OrigemVenda, type VendaComercial } from '@/types/comercial';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface Props {
  vendasPeriodo: VendaComercial[];
  vendasAno: VendaComercial[];
  metaRef: number;
  refDate: Date;
}

export function ComercialCharts({ vendasPeriodo, vendasAno, metaRef, refDate }: Props) {
  // 1) Origem (donut)
  const porOrigem = ORIGENS.map(o => ({
    name: o.label,
    origem: o.value as OrigemVenda,
    value: vendasPeriodo.filter(v => v.origem === o.value).length,
  })).filter(d => d.value > 0);

  // 2) Vendas por mês (ano)
  const porMes = MESES.map((m, i) => ({
    mes: m,
    vendas: vendasAno.filter(v => new Date(v.data_venda + 'T12:00:00').getMonth() === i).length,
  }));

  // 3) Evolução da meta no mês de referência (acumulado por dia)
  const ano = refDate.getFullYear();
  const mes = refDate.getMonth();
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const vendasDoMes = vendasAno.filter(v => {
    const d = new Date(v.data_venda + 'T12:00:00');
    return d.getFullYear() === ano && d.getMonth() === mes;
  });
  let acc = 0;
  const evolucao = Array.from({ length: diasNoMes }, (_, i) => {
    const dia = i + 1;
    acc += vendasDoMes.filter(v => new Date(v.data_venda + 'T12:00:00').getDate() === dia).length;
    return { dia, acumulado: acc };
  });

  const cardCls = 'bg-card border-border/50';
  const titleCls = 'text-sm font-semibold';
  const vazio = (txt: string) => <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">{txt}</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* 1) Origem */}
      <Card className={cardCls}>
        <CardHeader className="pb-2"><CardTitle className={titleCls}>Vendas por origem</CardTitle></CardHeader>
        <CardContent>
          {porOrigem.length === 0 ? vazio('Sem vendas no período') : (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={porOrigem} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
                  {porOrigem.map((d) => <Cell key={d.origem} fill={ORIGEM_COR[d.origem]} />)}
                </Pie>
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${v} vendas`, ORIGEM_LABEL[p?.payload?.origem as OrigemVenda] || '']} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 justify-center">
            {porOrigem.map(d => (
              <span key={d.origem} className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="h-2 w-2 rounded-full inline-block" style={{ background: ORIGEM_COR[d.origem] }} />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 2) Vendas por mês */}
      <Card className={cardCls}>
        <CardHeader className="pb-2"><CardTitle className={titleCls}>Vendas por mês ({ano})</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={porMes} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any) => [`${v} vendas`, '']} />
              <Bar dataKey="vendas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* 3) Evolução da meta no mês */}
      <Card className={cardCls}>
        <CardHeader className="pb-2"><CardTitle className={titleCls}>Atingimento da meta no mês</CardTitle></CardHeader>
        <CardContent>
          {vendasDoMes.length === 0 && metaRef === 0 ? vazio('Sem meta/vendas no mês') : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={evolucao} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: any) => [`${v} vendas`, 'Acumulado']} labelFormatter={(l) => `Dia ${l}`} />
                {metaRef > 0 && (
                  <ReferenceLine y={metaRef} stroke="#f59e0b" strokeDasharray="4 4"
                    label={{ value: `Meta ${metaRef}`, fontSize: 10, fill: '#f59e0b', position: 'insideTopRight' }} />
                )}
                <Line type="monotone" dataKey="acumulado" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
