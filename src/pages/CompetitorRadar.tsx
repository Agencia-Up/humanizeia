import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Radar,
  Search,
  Image,
  Video,
  Layers,
  PenTool,
  Palette,
  Calendar,
  TrendingUp,
  ExternalLink,
  Eye,
  Filter,
  Clock,
  Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';

// ── Types ────────────────────────────────────────────────────────────────────

type Platform = 'Meta' | 'Google' | 'TikTok';
type AdType = 'Imagem' | 'Vídeo' | 'Carrossel';
type PerformanceLevel = 'Alto' | 'Médio' | 'Baixo';

interface CompetitorAd {
  id: string;
  competitor: string;
  platform: Platform;
  type: AdType;
  performance: PerformanceLevel;
  firstSeen: string;
  headline: string;
  description: string;
  impressions: string;
  cta: string;
}

// ── Demo Data ────────────────────────────────────────────────────────────────

const demoAds: CompetitorAd[] = [
  {
    id: '1',
    competitor: 'MarketFlow Digital',
    platform: 'Meta',
    type: 'Imagem',
    performance: 'Alto',
    firstSeen: '2026-03-15',
    headline: 'Triplique suas vendas em 30 dias',
    description: 'Descubra o método que já gerou R$50M em vendas para nossos clientes. Vagas limitadas para o programa intensivo.',
    impressions: '2.4M',
    cta: 'Saiba Mais',
  },
  {
    id: '2',
    competitor: 'GrowthHack Labs',
    platform: 'Google',
    type: 'Vídeo',
    performance: 'Alto',
    firstSeen: '2026-03-12',
    headline: 'Automação de marketing que funciona',
    description: 'Pare de perder tempo com tarefas manuais. Nossa plataforma automatiza todo seu funil de vendas.',
    impressions: '1.8M',
    cta: 'Teste Grátis',
  },
  {
    id: '3',
    competitor: 'Adstream Pro',
    platform: 'TikTok',
    type: 'Vídeo',
    performance: 'Médio',
    firstSeen: '2026-03-10',
    headline: 'De 0 a 100K seguidores em 90 dias',
    description: 'Estratégia de conteúdo validada com mais de 200 marcas. Resultados garantidos ou devolvemos seu investimento.',
    impressions: '950K',
    cta: 'Começar Agora',
  },
  {
    id: '4',
    competitor: 'BrandForce Agency',
    platform: 'Meta',
    type: 'Carrossel',
    performance: 'Alto',
    firstSeen: '2026-03-08',
    headline: 'Criativos que convertem 3x mais',
    description: 'Nosso time de designers cria peças otimizadas com IA. Mais de 10.000 criativos entregues este ano.',
    impressions: '3.1M',
    cta: 'Ver Portfólio',
  },
  {
    id: '5',
    competitor: 'FunnelMaster',
    platform: 'Google',
    type: 'Imagem',
    performance: 'Baixo',
    firstSeen: '2026-03-18',
    headline: 'Landing pages que vendem sozinhas',
    description: 'Templates prontos para qualquer nicho. Arraste, solte e publique em minutos.',
    impressions: '320K',
    cta: 'Ver Templates',
  },
  {
    id: '6',
    competitor: 'ScaleUp Digital',
    platform: 'TikTok',
    type: 'Vídeo',
    performance: 'Médio',
    firstSeen: '2026-03-14',
    headline: 'ROI de 12x com tráfego pago',
    description: 'Metodologia exclusiva para e-commerce. Gestão completa de Meta, Google e TikTok Ads.',
    impressions: '1.2M',
    cta: 'Agendar Call',
  },
  {
    id: '7',
    competitor: 'ConvertLab',
    platform: 'Meta',
    type: 'Vídeo',
    performance: 'Alto',
    firstSeen: '2026-03-06',
    headline: 'A IA que escreve seus anúncios',
    description: 'Gere copies vencedoras em segundos. Treinada com milhões de anúncios de alta performance.',
    impressions: '4.7M',
    cta: 'Experimentar',
  },
  {
    id: '8',
    competitor: 'NexTrend Marketing',
    platform: 'Google',
    type: 'Carrossel',
    performance: 'Médio',
    firstSeen: '2026-03-19',
    headline: 'Relatórios automatizados para agências',
    description: 'Integre todas as plataformas e gere relatórios profissionais em 1 clique. Impressione seus clientes.',
    impressions: '680K',
    cta: 'Demo Grátis',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const platformColor: Record<Platform, string> = {
  Meta: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  Google: 'bg-red-500/15 text-red-400 border-red-500/30',
  TikTok: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
};

const performanceConfig: Record<PerformanceLevel, { color: string; bg: string }> = {
  Alto: { color: 'text-emerald-400', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  Médio: { color: 'text-amber-400', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  Baixo: { color: 'text-red-400', bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const typeIcon: Record<AdType, typeof Image> = {
  Imagem: Image,
  Vídeo: Video,
  Carrossel: Layers,
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CompetitorRadar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [performanceFilter, setPerformanceFilter] = useState<string>('all');

  const filtered = demoAds.filter((ad) => {
    if (searchQuery && !ad.competitor.toLowerCase().includes(searchQuery.toLowerCase()) && !ad.headline.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (platformFilter !== 'all' && ad.platform !== platformFilter) return false;
    if (typeFilter !== 'all' && ad.type !== typeFilter) return false;
    if (performanceFilter !== 'all' && ad.performance !== performanceFilter) return false;
    return true;
  });

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* ── Banner Em breve ──────────────────────────────────────────────── */}
        <div className="flex items-start gap-4 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
            <Clock className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-amber-400 text-sm">Funcionalidade em desenvolvimento</p>
              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wider">Em breve</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              O Radar de Concorrentes está sendo integrado às APIs de inteligência de mercado. Os dados exibidos abaixo são <strong>demonstrativos</strong> — a versão real vai monitorar anúncios da concorrência em tempo real automaticamente.
            </p>
          </div>
          <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3">
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-400">Preview</span>
          </div>
        </div>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/20">
              <Radar className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Radar de Concorrentes</h1>
              <p className="text-sm text-muted-foreground">
                Monitore anúncios da concorrência e transforme insights em criativos vencedores
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nome do concorrente ou URL..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button className="gradient-primary text-primary-foreground shrink-0">
                <Radar className="h-4 w-4 mr-2" />
                Monitorar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />
            Filtros:
          </div>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="Plataforma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="Meta">Meta</SelectItem>
              <SelectItem value="Google">Google</SelectItem>
              <SelectItem value="TikTok">TikTok</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="Imagem">Imagem</SelectItem>
              <SelectItem value="Vídeo">Vídeo</SelectItem>
              <SelectItem value="Carrossel">Carrossel</SelectItem>
            </SelectContent>
          </Select>

          <Select value={performanceFilter} onValueChange={setPerformanceFilter}>
            <SelectTrigger className="w-[150px] h-9 text-sm">
              <SelectValue placeholder="Performance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="Alto">Alto</SelectItem>
              <SelectItem value="Médio">Médio</SelectItem>
              <SelectItem value="Baixo">Baixo</SelectItem>
            </SelectContent>
          </Select>

          <Badge variant="outline" className="text-xs text-muted-foreground">
            {filtered.length} anúncio{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Ad Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtered.map((ad, index) => {
            const TypeIcon = typeIcon[ad.type];
            const perf = performanceConfig[ad.performance];

            return (
              <motion.div
                key={ad.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <Card className="border-border/50 bg-card/50 hover:border-border hover:shadow-lg transition-all duration-200 group h-full flex flex-col">
                  <CardContent className="p-0 flex flex-col h-full">
                    {/* Ad Image Placeholder */}
                    <div className="relative h-40 bg-muted/30 rounded-t-lg flex items-center justify-center overflow-hidden">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
                        <TypeIcon className="h-10 w-10" />
                        <span className="text-xs font-medium">{ad.type}</span>
                      </div>
                      {/* Platform Badge */}
                      <Badge
                        variant="outline"
                        className={`absolute top-3 left-3 text-[10px] font-semibold ${platformColor[ad.platform]}`}
                      >
                        {ad.platform}
                      </Badge>
                      {/* Performance Badge */}
                      <Badge
                        variant="outline"
                        className={`absolute top-3 right-3 text-[10px] font-semibold ${perf.bg}`}
                      >
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {ad.performance}
                      </Badge>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-3 flex-1 flex flex-col">
                      {/* Competitor name */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {ad.competitor}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      {/* Headline & Description */}
                      <div className="space-y-1 flex-1">
                        <h3 className="text-sm font-semibold leading-snug line-clamp-2">{ad.headline}</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{ad.description}</p>
                      </div>

                      {/* Meta info */}
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {ad.impressions}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(ad.firstSeen)}
                        </span>
                      </div>

                      {/* CTA preview */}
                      <div className="text-xs">
                        <span className="text-muted-foreground">CTA: </span>
                        <span className="font-medium text-primary">{ad.cta}</span>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs h-8 hover:bg-blue-500/10 hover:text-blue-400 hover:border-blue-500/30 transition-colors"
                        >
                          <PenTool className="h-3 w-3 mr-1.5" />
                          Inspirar PAULO
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs h-8 hover:bg-purple-500/10 hover:text-purple-400 hover:border-purple-500/30 transition-colors"
                        >
                          <Palette className="h-3 w-3 mr-1.5" />
                          Inspirar MARIA
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Empty State */}
        {filtered.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Radar className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground">Nenhum anúncio encontrado com os filtros selecionados</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setPlatformFilter('all');
                setTypeFilter('all');
                setPerformanceFilter('all');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        )}

        {/* Info Banner */}
        <Card className="border-orange-500/20 bg-orange-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Radar className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-orange-400">Modo Demo</p>
              <p className="text-xs text-muted-foreground">
                Atualmente exibindo dados de demonstração. Quando o módulo de scraping estiver ativo,
                os anúncios serão capturados automaticamente das bibliotecas de anúncios do Meta, Google e TikTok.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
