import { useState, useMemo, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderOpen, Search, Grid, List, Image, LinkIcon, Sparkles, Trophy, TrendingUp, DollarSign, Copy, Loader2, Zap, Upload, Library } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMetaApi } from '@/hooks/useMetaApi';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { useMetaCachedQuery } from '@/hooks/useMetaCachedQuery';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useNavigate } from 'react-router-dom';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { toast } from 'sonner';
import { CreativeUploadPanel } from '@/components/creative-library/CreativeUploadPanel';

export default function CreativeLibrary() {
  const [activeTab, setActiveTab] = useState('my-creatives');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedAd, setSelectedAd] = useState<any | null>(null);
  const [isVariationOpen, setIsVariationOpen] = useState(false);
  const [variationResult, setVariationResult] = useState('');
  const [previewAd, setPreviewAd] = useState<any | null>(null);
  const { connectedAccount, isLoading: isLoadingConn } = useMetaConnection();
  const isConnected = !!connectedAccount;
  const { callMetaApi } = useMetaApi();
  const navigate = useNavigate();

  const { sendSingleMessage, isLoading: isGenerating } = useClaudeChat({
    context: 'assistant',
    onDelta: (delta) => setVariationResult(prev => prev + delta),
  });

  const fetchAds = useCallback(async () => {
    const adsResult = await callMetaApi({
      endpoint: `act_{ad_account_id}/ads`,
      params: {
        fields: 'name,status,effective_status,creative{title,body,thumbnail_url,image_url,id},insights.date_preset(last_30d){impressions,clicks,ctr,cpc,cpm,spend}',
        limit: '50',
      },
    });

    const creativeIds = [...new Set(
      (adsResult?.data || [])
        .map((ad: any) => ad.creative?.id)
        .filter(Boolean)
    )] as string[];

    const hiResMap: Record<string, string> = {};
    if (creativeIds.length > 0) {
      try {
        const crResult = await callMetaApi({
          endpoint: '',
          params: { ids: creativeIds.join(','), fields: 'thumbnail_url', thumbnail_width: '960', thumbnail_height: '960' },
        });
        if (crResult && typeof crResult === 'object') {
          for (const [id, data] of Object.entries(crResult as Record<string, any>)) {
            if (data?.thumbnail_url) hiResMap[id] = data.thumbnail_url;
          }
        }
      } catch {}
    }

    if (adsResult?.data) {
      for (const ad of adsResult.data) {
        if (ad.creative?.id && hiResMap[ad.creative.id]) {
          ad.creative.hi_res_thumbnail = hiResMap[ad.creative.id];
        }
      }
    }
    return adsResult;
  }, [callMetaApi]);

  const getAdImage = (ad: any) => {
    return ad.creative?.hi_res_thumbnail || ad.creative?.image_url || ad.full_picture || ad.creative?.thumbnail_url || '';
  };

  const accountId = connectedAccount?.account_id;
  const { data: adsData, isLoading, isRefreshing, lastUpdated, refresh, error: adsError } = useMetaCachedQuery({
    cacheKey: accountId ? `ads_creatives_v2:${accountId}` : 'ads_creatives_v2',
    fetchFn: fetchAds,
    enabled: isConnected,
    alwaysReadCache: true,
  });

  const allAds = adsData?.data || [];

  const { sortedAds, activeCount, topCtrAd, totalSpend } = useMemo(() => {
    let filtered = allAds.filter((ad: any) =>
      ad.name?.toLowerCase().includes(search.toLowerCase())
    );
    if (statusFilter !== 'all') {
      filtered = filtered.filter((ad: any) => ad.effective_status === statusFilter);
    }
    const activeCount = allAds.filter((ad: any) => ad.effective_status === 'ACTIVE').length;
    const totalSpend = allAds.reduce((sum: number, ad: any) => sum + Number(ad.insights?.data?.[0]?.spend || 0), 0);
    let topCtrAd: any = null;
    let maxCtr = 0;
    allAds.forEach((ad: any) => {
      const ctr = Number(ad.insights?.data?.[0]?.ctr || 0);
      if (ctr > maxCtr) { maxCtr = ctr; topCtrAd = ad; }
    });
    const getScore = (ad: any) => {
      const insights = ad.insights?.data?.[0];
      const ctr = Number(insights?.ctr || 0);
      const impressions = Number(insights?.impressions || 1);
      const spend = Number(insights?.spend || 1);
      return (ctr * 0.4) + (Math.log10(impressions) * 0.3) + (Math.log10(spend) * 0.3);
    };
    const sorted = [...filtered].sort((a: any, b: any) => {
      if (a.effective_status === 'ACTIVE' && b.effective_status !== 'ACTIVE') return -1;
      if (b.effective_status === 'ACTIVE' && a.effective_status !== 'ACTIVE') return 1;
      return getScore(b) - getScore(a);
    });
    return { sortedAds: sorted, activeCount, topCtrAd, totalSpend };
  }, [allAds, search, statusFilter]);

  const handleGenerateVariations = async (ad: any) => {
    setSelectedAd(ad);
    setVariationResult('');
    setIsVariationOpen(true);
    const title = ad.creative?.title || ad.name || '';
    const body = ad.creative?.body || '';
    const insights = ad.insights?.data?.[0];
    const metricsText = insights
      ? `CTR: ${Number(insights.ctr).toFixed(2)}%, CPC: R$${Number(insights.cpc || 0).toFixed(2)}, Impressões: ${Number(insights.impressions || 0).toLocaleString('pt-BR')}`
      : '';
    const prompt = `Gere 3 variações de copy para este anúncio do Meta Ads. Mantenha a mesma intenção e produto, mas varie o tom, hook e CTA.\n\n**Título original:** ${title}\n**Texto original:** ${body}\n${metricsText ? `**Métricas atuais:** ${metricsText}` : ''}\n\nPara cada variação, forneça:\n1. **Variação 1 (Tom Urgente)**: Com senso de urgência e escassez\n2. **Variação 2 (Tom Emocional)**: Focado em benefícios emocionais e transformação\n3. **Variação 3 (Tom Direto)**: Mais objetivo e focado em dados/resultados\n\nFormate cada variação com título e texto completo pronto para usar.\n\nResponda em Markdown formatado com headers (##), **negrito** para títulos e CTAs, e separadores (---) entre variações. NÃO retorne JSON.`;
    try { await sendSingleMessage(prompt); } catch {}
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copiado para a área de transferência!');
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Biblioteca de Criativos</h1>
            <p className="text-muted-foreground">Gerencie seus criativos e materiais de marketing</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="my-creatives" className="gap-2">
              <Upload className="h-4 w-4" />
              Meus Criativos
            </TabsTrigger>
            <TabsTrigger value="meta-ads" className="gap-2">
              <Library className="h-4 w-4" />
              Meta Ads
            </TabsTrigger>
          </TabsList>

          {/* TAB: Meus Criativos (uploads) */}
          <TabsContent value="my-creatives" className="mt-6">
            <CreativeUploadPanel />
          </TabsContent>

          {/* TAB: Meta Ads */}
          <TabsContent value="meta-ads" className="mt-6">
            {!isConnected && !isLoadingConn && allAds.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-20">
                <LinkIcon className="h-12 w-12 text-muted-foreground" />
                <h2 className="text-xl font-semibold">Conecte seu Meta Ads</h2>
                <p className="text-muted-foreground text-center max-w-md">Para ver seus criativos do Meta, conecte sua conta.</p>
                <Button onClick={() => navigate('/settings')} className="gradient-primary">Ir para Configurações</Button>
              </div>
            ) : (
              <div className="space-y-6">
                {!isConnected && !isLoadingConn && allAds.length > 0 && (
                  <Card className="border-yellow-500/30 bg-yellow-500/10">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <LinkIcon className="h-5 w-5 text-yellow-500" />
                        <div>
                          <p className="text-sm font-medium">Conta Meta desconectada</p>
                          <p className="text-xs text-muted-foreground">Exibindo dados do cache. Reconecte para atualizar.</p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => navigate('/settings')} className="border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">Reconectar</Button>
                    </CardContent>
                  </Card>
                )}

                {/* Filters */}
                <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar anúncios..." className="pl-10" />
                      </div>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="ACTIVE">Ativos</SelectItem>
                          <SelectItem value="PAUSED">Pausados</SelectItem>
                          <SelectItem value="ARCHIVED">Arquivados</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex gap-1 rounded-lg border border-border p-1">
                        <Button size="icon" variant={view === 'grid' ? 'default' : 'ghost'} className="h-8 w-8" onClick={() => setView('grid')}><Grid className="h-4 w-4" /></Button>
                        <Button size="icon" variant={view === 'list' ? 'default' : 'ghost'} className="h-8 w-8" onClick={() => setView('list')}><List className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI Cards */}
                <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20"><FolderOpen className="h-5 w-5 text-primary" /></div>
                      <div><p className="text-2xl font-bold">{allAds.length}</p><p className="text-xs text-muted-foreground">Total de Anúncios</p></div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20"><Zap className="h-5 w-5 text-green-500" /></div>
                      <div><p className="text-2xl font-bold">{activeCount}</p><p className="text-xs text-muted-foreground">Ativos</p></div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/20"><TrendingUp className="h-5 w-5 text-yellow-500" /></div>
                      <div><p className="text-2xl font-bold">{topCtrAd ? `${Number(topCtrAd.insights?.data?.[0]?.ctr || 0).toFixed(2)}%` : '—'}</p><p className="text-xs text-muted-foreground truncate max-w-[120px]">Melhor CTR</p></div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20"><DollarSign className="h-5 w-5 text-blue-500" /></div>
                      <div><p className="text-2xl font-bold">R$ {totalSpend.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</p><p className="text-xs text-muted-foreground">Gasto (30d)</p></div>
                    </CardContent>
                  </Card>
                </div>

                {/* Ads Grid */}
                {isLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
                  </div>
                ) : sortedAds.length === 0 ? (
                  <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardContent className="flex flex-col items-center gap-3 py-16">
                      <Image className="h-12 w-12 text-muted-foreground" />
                      <p className="text-muted-foreground">Nenhum anúncio encontrado.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-3'}>
                    {sortedAds.map((ad: any, index: number) => {
                      const thumbnail = getAdImage(ad);
                      const insights = ad.insights?.data?.[0];
                      const ctr = Number(insights?.ctr || 0);
                      const cpc = Number(insights?.cpc || 0);
                      const cpm = Number(insights?.cpm || 0);
                      const spend = Number(insights?.spend || 0);
                      const impressions = Number(insights?.impressions || 0);
                      const body = ad.creative?.body || '';
                      const isTop3 = index < 3;

                      return (
                        <motion.div key={ad.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.03 }}>
                          <Card className="group relative border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-all hover:border-primary/30 hover:shadow-lg">
                            {index < 10 && (
                              <div className={`absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${isTop3 ? 'bg-yellow-500/90 text-yellow-950' : 'bg-muted/80 text-foreground'}`}>
                                {isTop3 && <Trophy className="h-3 w-3" />}
                                #{index + 1}
                              </div>
                            )}
                            {thumbnail && (
                              <div className="relative aspect-[4/5] cursor-pointer" onClick={() => setPreviewAd(ad)}>
                                <img src={thumbnail} alt={ad.name} loading="lazy" className="h-full w-full object-cover"
                                  onError={(e) => {
                                    const target = e.currentTarget;
                                    const originalThumb = ad.creative?.thumbnail_url;
                                    if (originalThumb && target.src !== originalThumb) target.src = originalThumb;
                                  }}
                                />
                              </div>
                            )}
                            <CardContent className="p-3 space-y-2">
                              <p className="font-medium truncate text-sm">{ad.name}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="secondary" className={
                                  ad.effective_status === 'ACTIVE' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                                  ad.effective_status === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                                  'bg-muted text-muted-foreground'
                                }>{ad.effective_status}</Badge>
                              </div>
                              {insights && (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                  <span>CTR: <strong className="text-foreground">{ctr.toFixed(2)}%</strong></span>
                                  <span>CPC: <strong className="text-foreground">R${cpc.toFixed(2)}</strong></span>
                                  <span>CPM: <strong className="text-foreground">R${cpm.toFixed(0)}</strong></span>
                                  <span>Gasto: <strong className="text-foreground">R${spend.toFixed(0)}</strong></span>
                                  <span className="col-span-2">{impressions.toLocaleString('pt-BR')} impressões</span>
                                </div>
                              )}
                              {body && <p className="text-xs text-muted-foreground line-clamp-2">{body}</p>}
                              <Button size="sm" variant="outline" className="w-full mt-1 gap-1.5 text-xs" onClick={() => handleGenerateVariations(ad)}>
                                <Sparkles className="h-3.5 w-3.5" /> Gerar Variações
                              </Button>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewAd} onOpenChange={(open) => !open && setPreviewAd(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          {previewAd && (() => {
            const img = getAdImage(previewAd);
            const ins = previewAd.insights?.data?.[0];
            return (
              <div>
                {img && <img src={img} alt={previewAd.name} className="w-full max-h-[60vh] object-contain bg-muted/20" />}
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">{previewAd.name}</h2>
                    <Badge variant="secondary" className={
                      previewAd.effective_status === 'ACTIVE' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
                      previewAd.effective_status === 'PAUSED' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
                      'bg-muted text-muted-foreground'
                    }>{previewAd.effective_status}</Badge>
                  </div>
                  {previewAd.creative?.body && <p className="text-sm text-muted-foreground">{previewAd.creative.body}</p>}
                  {ins && (
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div><span className="text-muted-foreground">CTR</span><p className="font-semibold">{Number(ins.ctr || 0).toFixed(2)}%</p></div>
                      <div><span className="text-muted-foreground">CPC</span><p className="font-semibold">R$ {Number(ins.cpc || 0).toFixed(2)}</p></div>
                      <div><span className="text-muted-foreground">CPM</span><p className="font-semibold">R$ {Number(ins.cpm || 0).toFixed(0)}</p></div>
                      <div><span className="text-muted-foreground">Gasto</span><p className="font-semibold">R$ {Number(ins.spend || 0).toFixed(2)}</p></div>
                      <div><span className="text-muted-foreground">Impressões</span><p className="font-semibold">{Number(ins.impressions || 0).toLocaleString('pt-BR')}</p></div>
                      <div><span className="text-muted-foreground">Cliques</span><p className="font-semibold">{Number(ins.clicks || 0).toLocaleString('pt-BR')}</p></div>
                    </div>
                  )}
                  <Button className="w-full gap-1.5" onClick={() => { setPreviewAd(null); handleGenerateVariations(previewAd); }}>
                    <Sparkles className="h-4 w-4" /> Gerar Variações
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Variation Dialog */}
      <Dialog open={isVariationOpen} onOpenChange={setIsVariationOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Variações de Copy
            </DialogTitle>
          </DialogHeader>
          {selectedAd && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1">Copy Original</p>
                <p className="text-sm font-medium">{selectedAd.creative?.title || selectedAd.name}</p>
                {selectedAd.creative?.body && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedAd.creative.body}</p>
                )}
              </div>
              <div className="min-h-[200px]">
                {isGenerating && !variationResult && (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Gerando variações...
                  </div>
                )}
                {variationResult && (
                  <div className="space-y-3">
                    <MarkdownRenderer content={variationResult} />
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copyToClipboard(variationResult)}>
                      <Copy className="h-3.5 w-3.5" /> Copiar Tudo
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
