import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface CampaignRow {
  id: string;
  name: string;
  platform: string;
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  reach: number;
  frequency: number;
}

interface FunnelTableProps {
  data: CampaignRow[];
  isLoading?: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n);
const fmtCur = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

function getCtrColor(ctr: number): string {
  if (ctr >= 2) return 'text-success font-bold';
  if (ctr >= 1) return 'text-foreground';
  return 'text-destructive';
}

export function FunnelTable({ data, isLoading }: FunnelTableProps) {
  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Performance por Campanha</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
    );
  }

  if (!data.length) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle className="text-lg">Performance por Campanha</CardTitle></CardHeader>
        <CardContent><p className="text-center text-muted-foreground py-10">Nenhuma campanha encontrada.</p></CardContent>
      </Card>
    );
  }

  const totals = data.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      spend: acc.spend + r.spend,
      reach: acc.reach + r.reach,
    }),
    { impressions: 0, clicks: 0, spend: 0, reach: 0 },
  );

  const maxSpend = Math.max(...data.map(r => r.spend));

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Performance por Campanha</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead>Campanha</TableHead>
                <TableHead className="text-right">Impressões</TableHead>
                <TableHead className="text-right">Alcance</TableHead>
                <TableHead className="text-right">Freq.</TableHead>
                <TableHead className="text-right">CPM</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right min-w-[140px]">Gasto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => {
                const spendPct = maxSpend > 0 ? (row.spend / maxSpend) * 100 : 0;
                return (
                  <TableRow key={row.id} className="border-border/50 transition-colors hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-primary/20 text-primary">Meta</Badge>
                        <span className="font-medium text-sm truncate max-w-[200px]">{row.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.impressions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(row.reach)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.frequency.toFixed(1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCur(row.cpm)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${getCtrColor(row.ctr)}`}>{row.ctr.toFixed(2)}%</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCur(row.cpc)}</TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-1">
                        <span className="tabular-nums text-sm font-medium">{fmtCur(row.spend)}</span>
                        <Progress value={spendPct} className="h-1.5" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-border/50 bg-muted/20 font-bold">
                <TableCell>TOTAL</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.impressions)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(totals.reach)}</TableCell>
                <TableCell className="text-right tabular-nums">—</TableCell>
                <TableCell className="text-right tabular-nums">{totals.impressions > 0 ? fmtCur((totals.spend / totals.impressions) * 1000) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0'}%</TableCell>
                <TableCell className="text-right tabular-nums">{totals.clicks > 0 ? fmtCur(totals.spend / totals.clicks) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtCur(totals.spend)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
