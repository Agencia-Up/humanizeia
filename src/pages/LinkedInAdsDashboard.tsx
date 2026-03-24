import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLinkedInAds, LinkedInCampaign } from '@/hooks/useLinkedInAds';
import {
  Activity, BarChart3, DollarSign, Loader2, MousePointerClick,
  Pause, Play, RefreshCw, Target, TrendingUp, Users, Zap,
} from 'lucide-react';

const healthColor = (s: number) => s >= 70 ? 'text-emerald-400' : s >= 45 ? 'text-amber-400' : 'text-red-400';
const healthBg = (s: number) => s >= 70 ? 'bg-emerald-500/10 border-emerald-500/20' : s >= 45 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-red-500/10 border-red-500/20';
const fmt = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

const objectiveLabel = (obj: string) => ({
  BRAND_AWARENESS: 'Reconhecimento',
  WEBSITE_VISITS: 'Visitas ao Site',
  ENGAGEMENT: 'Engajamento',
  VIDEO_VIEWS: 'Visualizações',
  LEAD_GENERATION: 'Geração de Leads',
  WEBSITE_CONVERSIONS: 'Conversões',
  JOB_APPLICANTS: 'Candidatos',
}[obj] || obj);

const campaignTypeLabel = (type: string) => ({
  TEXT_AD: 'Anúncio de Texto',
  SPONSORED_UPDATES: 'Conteúdo Patrocinado',
  SPONSORED_INMAILS: 'InMail Patrocinado',
  DYNAMIC: 'Dinâmico',
}[type] || type);

const DATE_RANGES = [
  { value: 'TODAY', label: 'Hoje' },
  { value: 'YESTERDAY', label: 'Ontem' },
  { value: 'LAST_7_DAYS', label: 'Últimos 7 dias' },
  { value: 'LAST_14_DAYS', label: 'Últimos 14 dias' },
  { value: 'LAST_30_DAYS', label: 'Últimos 30 dias' },
  { value: 'THIS_MONTH', label: 'Este mês' },
];

// LinkedIn logo SVG inline
const LinkedInLogo = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#0A66C2">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

export default function LinkedInAdsDashboard() {
  const { loading, data, error, fetchCampaigns, updateCampaignStatus } = useLinkedInAds();
  const [dateRange, setDateRange] = useState('LAST_30_DAYS');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => { fetchCampaigns(dateRange); }, [dateRange]);

  const handleStatusChange = async (campaign: LinkedInCampaign) => {
    setActionLoading(campaign.id);
    const newStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await updateCampaignStatus(campaign.id, newStatus);
    await fetchCampaigns(dateRange);
    setActionLoading(null);
  };

  const totalSpend = data?.campaigns?.reduce((s, c) => s + c.spend, 0) || 0;
  const totalClicks = data?.campaigns?.reduce((s, c) => s + c.clicks, 0) || 0;
  const totalLeads = data?.campaigns?.reduce((s, c) => s + c.leads, 0) || 0;
  const totalImpressions = data?.campaigns?.reduce((s, c) => s + c.impressions, 0) || 0;
  const avgCPL = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const currency = data?.account?.currency === 'USD' ? 'US$' : 'R$';

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-lg bg-blue-600/10">
                <LinkedInLogo />
              </div>
              LinkedIn Ads
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {data?.account ? `${data.account.name} (${data.account.id})` : 'Gerencie suas campanhas LinkedIn Ads'}
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
                <Users className="h-3 w-3" /> Leads
              </div>
              <p className="text-xl font-bold">{totalLeads.toLocaleString('pt-BR')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3 w-3" /> CPL Médio
              </div>
              <p className="text-xl font-bold">{avgCPL > 0 ? `${currency} ${fmt(avgCPL)}` : '-'}</p>
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
            <p className="text-muted-foreground">Carregando campanhas LinkedIn Ads...</p>
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
                            <TrendingUp className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{campaign.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{objectiveLabel(campaign.objective)}</Badge>
                              <Badge variant="outline" className="text-[10px]">{campaignTypeLabel(campaign.type)}</Badge>
                              <Badge variant={campaign.status === 'ACTIVE' ? 'default' : 'secondary'} className="text-[10px]">
                                {campaign.status === 'ACTIVE' ? 'Ativa' : 'Pausada'}
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
                            ) : campaign.status === 'ACTIVE' ? (
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
                          <p className="text-muted-foreground">Impressões</p>
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
                          <p className="text-muted-foreground">Leads</p>
                          <p className="font-medium">{campaign.leads}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">CPL</p>
                          <p className="font-medium">{campaign.cost_per_lead > 0 ? `${currency} ${fmt(campaign.cost_per_lead)}` : '-'}</p>
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
            <p className="text-muted-foreground">Nenhuma campanha LinkedIn Ads encontrada</p>
            <p className="text-xs text-muted-foreground mt-1">Conecte sua conta em Configurações {'>'} Contas Conectadas</p>
          </CardContent></Card>
        )}
      </div>
    </MainLayout>
  );
}
