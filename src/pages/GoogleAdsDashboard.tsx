import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGoogleAds, GoogleCampaign } from '@/hooks/useGoogleAds';
import {
  Activity, ArrowDown, ArrowUp, BarChart3, DollarSign, Eye, HelpCircle,
  Loader2, MousePointerClick, Pause, Play, RefreshCw, Search, ShoppingCart,
  Target, TrendingUp, Zap,
} from 'lucide-react';

const healthColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 45 ? 'text-amber-400' : 'text-red-400';
const healthBg = (s: number) => s >= 70 ? 'bg-emerald-500/10 border-emerald-500/20' : s >= 45 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';
const healthLabel = (s: number) => s >= 70 ? 'Saudavel' : s >= 45 ? 'Atencao' : 'Critico';
const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

const channelIcon = (type: string) => {
  const icons: Record<string, JSX.Element> = {
    SEARCH: <Search className="h-4 w-4" />,
    DISPLAY: <Eye className="h-4 w-4" />,
    SHOPPING: <ShoppingCart className="h-4 w-4" />,
    VIDEO: <Play className="h-4 w-4" />,
    PERFORMANCE_MAX: <Zap className="h-4 w-4" />,
  };
  return icons[type] || <BarChart3 className="h-4 w-4" />;
};

const channelLabel = (type: string) => ({
  SEARCH: 'Pesquisa', DISPLAY: 'Display', SHOPPING: 'Shopping',
  VIDEO: 'Video', PERFORMANCE_MAX: 'Performance Max', MULTI_CHANNEL: 'Multi-canal',
}[type] || type);

const DATE_RANGES = [
  { value: 'TODAY', label: 'Hoje' },
  { value: 'YESTERDAY', label: 'Ontem' },
  { value: 'LAST_7_DAYS', label: 'Ultimos 7 dias' },
  { value: 'LAST_14_DAYS', label: 'Ultimos 14 dias' },
  { value: 'LAST_30_DAYS', label: 'Ultimos 30 dias' },
  { value: 'THIS_MONTH', label: 'Este mes' },
];

export default function GoogleAdsDashboard() {
  const { loading, data, error, fetchCampaigns, updateCampaignStatus } = useGoogleAds();
  const [dateRange, setDateRange] = useState('LAST_30_DAYS');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => { fetchCampaigns(dateRange); }, [dateRange]);

  const handleStatusChange = async (campaign: GoogleCampaign) => {
    setActionLoading(campaign.id);
    const newStatus = campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    await updateCampaignStatus(campaign.id, newStatus);
    await fetchCampaigns(dateRange);
    setActionLoading(null);
  };

  const totalSpend = data?.campaigns?.reduce((s, c) => s + c.spend, 0) || 0;
  const totalClicks = data?.campaigns?.reduce((s, c) => s + c.clicks, 0) || 0;
  const totalConversions = data?.campaigns?.reduce((s, c) => s + c.conversions, 0) || 0;
  const totalRevenue = data?.campaigns?.reduce((s, c) => s + c.revenue, 0) || 0;
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const currency = data?.account?.currency === 'USD' ? 'US$' : 'R$';

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#4285F4"/>
                  <path d="M2 17l10 5 10-5" stroke="#34A853" strokeWidth="2"/>
                  <path d="M2 12l10 5 10-5" stroke="#FBBC05" strokeWidth="2"/>
                </svg>
              </div>
              Google Ads
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {data?.account ? `${data.account.name} (${data.account.id})` : 'Gerencie suas campanhas Google Ads'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_RANGES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => fetchCampaigns(dateRange)} disabled={loading} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3 w-3" /> Investimento
              </div>
              <p className="text-xl font-bold">{currency} {fmt(totalSpend)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <MousePointerClick className="h-3 w-3" /> Cliques
              </div>
              <p className="text-xl font-bold">{totalClicks.toLocaleString('pt-BR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3 w-3" /> Conversoes
              </div>
              <p className="text-xl font-bold">{totalConversions.toLocaleString('pt-BR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3 w-3" /> ROAS
              </div>
              <p className="text-xl font-bold">{overallRoas > 0 ? `${fmt(overallRoas)}x` : '-'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Activity className="h-3 w-3" /> Health Score
              </div>
              <p className={`text-xl font-bold ${healthColor(data?.health_score || 0)}`}>
                {data?.health_score ?? '-'}/100
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Loading / Error */}
        {loading && !data && (
          <Card><CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
            <p className="text-muted-foreground">Carregando campanhas Google Ads...</p>
          </CardContent></Card>
        )}

        {error && !data && (
          <Card><CardContent className="py-12 text-center">
            <p className="text-red-400 mb-2">{error}</p>
            <Button variant="outline" onClick={() => fetchCampaigns(dateRange)}>Tentar novamente</Button>
          </CardContent></Card>
        )}

        {/* Campaign List */}
        {data?.campaigns && data.campaigns.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Campanhas ({data.campaigns.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3">
                  {data.campaigns.map(campaign => (
                    <div key={campaign.id} className={`p-4 rounded-lg border ${healthBg(campaign.health_score)} transition-colors`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${campaign.health_score >= 70 ? 'bg-emerald-500/20' : campaign.health_score >= 45 ? 'bg-amber-500/20' : 'bg-red-500/20'}`}>
                            {channelIcon(campaign.channel_type)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{campaign.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{channelLabel(campaign.channel_type)}</Badge>
                              <Badge variant={campaign.status === 'ENABLED' ? 'default' : 'secondary'} className="text-[10px]">
                                {campaign.status === 'ENABLED' ? 'Ativa' : 'Pausada'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-lg font-bold ${healthColor(campaign.health_score)}`}>
                            {campaign.health_score}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleStatusChange(campaign)}
                            disabled={actionLoading === campaign.id}
                          >
                            {actionLoading === campaign.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : campaign.status === 'ENABLED' ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 md:grid-cols-7 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground">Investimento</p>
                          <p className="font-medium">{currency} {fmt(campaign.spend)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Impressoes</p>
                          <p className="font-medium">{campaign.impressions.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Cliques</p>
                          <p className="font-medium">{campaign.clicks.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">CTR</p>
                          <p className="font-medium">{fmt(campaign.ctr)}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">CPC</p>
                          <p className="font-medium">{currency} {fmt(campaign.cpc)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Conversoes</p>
                          <p className="font-medium">{campaign.conversions}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">ROAS</p>
                          <p className="font-medium">{campaign.roas > 0 ? `${fmt(campaign.roas)}x` : '-'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {data?.campaigns?.length === 0 && (
          <Card><CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-muted-foreground">Nenhuma campanha Google Ads encontrada</p>
            <p className="text-xs text-muted-foreground mt-1">Conecte sua conta em Configurações {'>'} Contas Conectadas</p>
          </CardContent></Card>
        )}
      </div>
    </MainLayout>
  );
}
