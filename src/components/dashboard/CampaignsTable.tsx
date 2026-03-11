import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Campaign } from '@/data/mockData';

interface CampaignsTableProps {
  campaigns: Campaign[];
}

export function CampaignsTable({ campaigns }: CampaignsTableProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('pt-BR').format(value);
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Top Campanhas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground">Campanha</TableHead>
                <TableHead className="text-muted-foreground">Plataforma</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-right text-muted-foreground">Gasto</TableHead>
                <TableHead className="text-right text-muted-foreground">Conversões</TableHead>
                <TableHead className="text-right text-muted-foreground">CPA</TableHead>
                <TableHead className="text-right text-muted-foreground">ROAS</TableHead>
                <TableHead className="text-center text-muted-foreground">Tendência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const TrendIcon =
                  campaign.trend === 'up'
                    ? TrendingUp
                    : campaign.trend === 'down'
                    ? TrendingDown
                    : Minus;
                const trendColor =
                  campaign.trend === 'up'
                    ? 'text-success'
                    : campaign.trend === 'down'
                    ? 'text-destructive'
                    : 'text-muted-foreground';

                return (
                  <TableRow
                    key={campaign.id}
                    className="border-border/50 transition-colors hover:bg-muted/30"
                  >
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          campaign.platform === 'meta'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-red-500/20 text-red-400'
                        }
                      >
                        {campaign.platform === 'meta' ? 'Meta' : 'Google'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={campaign.status === 'active' ? 'default' : 'secondary'}
                        className={
                          campaign.status === 'active'
                            ? 'bg-success/20 text-success'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {campaign.status === 'active' ? 'Ativo' : 'Pausado'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(campaign.spend)}</TableCell>
                    <TableCell className="text-right">{formatNumber(campaign.conversions)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(campaign.cpa)}</TableCell>
                    <TableCell className="text-right font-medium">{campaign.roas.toFixed(1)}x</TableCell>
                    <TableCell className="text-center">
                      <TrendIcon className={`mx-auto h-5 w-5 ${trendColor}`} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
