import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useSocialMedia, CarouselSlide, SocialPost } from '@/hooks/useSocialMedia';
import {
  Calendar, CheckCircle, ChevronLeft, ChevronRight, Clock, Copy,
  Eye, Hash, Heart, Layers, Loader2, MessageCircle,
  RefreshCw, Send, Share2, Sparkles, Trash2, Instagram, Zap,
} from 'lucide-react';

// Slide Preview Card
function SlidePreview({ slide, isActive }: { slide: CarouselSlide; isActive?: boolean }) {
  const bg = slide.bg_color || '#1A237E';
  const accent = slide.accent_color || '#DAA520';

  return (
    <div
      className={`relative rounded-xl overflow-hidden aspect-square flex flex-col justify-between p-4 transition-all ${isActive ? 'ring-2 ring-primary shadow-lg scale-105' : 'opacity-80 hover:opacity-100 hover:scale-102'}`}
      style={{ background: `linear-gradient(135deg, ${bg} 0%, ${bg}CC 100%)` }}
    >
      {/* Accent bar */}
      <div className="h-0.5 w-12 rounded-full mb-2" style={{ background: accent }} />

      {/* Order badge */}
      <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
        style={{ background: accent, color: bg }}>
        {slide.order}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col justify-center gap-2">
        <h3 className="text-white font-bold text-sm leading-tight">{slide.headline}</h3>
        <p className="text-white/80 text-[11px] leading-snug">{slide.body}</p>
      </div>

      {/* CTA */}
      {slide.cta && (
        <div className="mt-2 py-1.5 px-3 rounded-lg text-center text-[11px] font-bold"
          style={{ background: accent, color: bg }}>
          {slide.cta}
        </div>
      )}
    </div>
  );
}

// Post Status Badge
function StatusBadge({ status }: { status: SocialPost['status'] }) {
  const map = {
    draft: { label: 'Rascunho', className: 'bg-muted text-muted-foreground' },
    scheduled: { label: 'Agendado', className: 'bg-blue-500/20 text-blue-400' },
    published: { label: 'Publicado', className: 'bg-emerald-500/20 text-emerald-400' },
    failed: { label: 'Falhou', className: 'bg-red-500/20 text-red-400' },
  };
  const { label, className } = map[status];
  return <Badge className={`text-[10px] ${className}`}>{label}</Badge>;
}

const TONES = [
  { value: 'profissional', label: '👔 Profissional' },
  { value: 'descontraido', label: '😊 Descontraído' },
  { value: 'educativo', label: '📚 Educativo' },
  { value: 'vendas', label: '💰 Vendas' },
  { value: 'inspiracional', label: '✨ Inspiracional' },
  { value: 'urgente', label: '🔥 Urgente' },
];

export default function DaviSocialMedia() {
  const {
    loading, generating, posts, generatedCarousel,
    setGeneratedCarousel, fetchPosts, generateCarousel, saveDraft, schedulePost, publishNow, deleteDraft,
  } = useSocialMedia();

  // Generator form state
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState('profissional');
  const [slideCount, setSlideCount] = useState([7]);
  const [includeCta, setIncludeCta] = useState(true);
  const [brandName, setBrandName] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [activeTab, setActiveTab] = useState('gerador');

  useEffect(() => {
    fetchPosts();
  }, []);

  useEffect(() => {
    if (generatedCarousel) {
      setCaption(generatedCarousel.caption);
      setHashtags(generatedCarousel.hashtags.join(', '));
    }
  }, [generatedCarousel]);

  const handleGenerate = async () => {
    if (!topic.trim() || !audience.trim()) return;
    const result = await generateCarousel({
      topic: topic.trim(),
      audience: audience.trim(),
      tone,
      slide_count: slideCount[0],
      include_cta: includeCta,
      brand_name: brandName.trim() || undefined,
    });
    if (result) setActiveSlide(0);
  };

  const handleSaveDraft = async () => {
    if (!generatedCarousel) return;
    await saveDraft({
      platform: 'instagram',
      post_type: 'carousel',
      caption,
      hashtags: hashtags.split(',').map(h => h.trim()).filter(Boolean),
      slides: generatedCarousel.slides,
    });
    setActiveTab('posts');
  };

  const handleCopyCaption = () => {
    const full = caption + '\n\n' + hashtags.split(',').map(h => `#${h.trim()}`).join(' ');
    navigator.clipboard.writeText(full);
  };

  const draftCount = posts.filter(p => p.status === 'draft').length;
  const scheduledCount = posts.filter(p => p.status === 'scheduled').length;
  const publishedCount = posts.filter(p => p.status === 'published').length;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-500/20">
                <Instagram className="h-6 w-6 text-pink-400" />
              </div>
              DAVI — Social Media
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie carrosséis virais com IA e agende suas publicações Instagram
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" />
              DAVI Online
            </Badge>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{draftCount}</p>
              <p className="text-xs text-muted-foreground">Rascunhos</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{scheduledCount}</p>
              <p className="text-xs text-muted-foreground">Agendados</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{publishedCount}</p>
              <p className="text-xs text-muted-foreground">Publicados</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gerador" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Gerador IA
            </TabsTrigger>
            <TabsTrigger value="posts" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Meus Posts {posts.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{posts.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="calendario" className="gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Calendário
            </TabsTrigger>
          </TabsList>

          {/* ─── GENERATOR TAB ─── */}
          <TabsContent value="gerador" className="space-y-5 mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LEFT: Form */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-yellow-400" />
                      Configurar Carrossel
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tema do carrossel *</Label>
                      <Input
                        placeholder="ex: 5 erros no tráfego pago, Como criar copy que vende..."
                        value={topic}
                        onChange={e => setTopic(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Público-alvo *</Label>
                      <Input
                        placeholder="ex: empreendedores, gestores de tráfego, PMEs..."
                        value={audience}
                        onChange={e => setAudience(e.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Tom de voz</Label>
                      <Select value={tone} onValueChange={setTone}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Número de slides: {slideCount[0]}</Label>
                      <Slider
                        min={4} max={12} step={1}
                        value={slideCount}
                        onValueChange={setSlideCount}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome da marca (opcional)</Label>
                      <Input
                        placeholder="LogosIA, Minha Empresa..."
                        value={brandName}
                        onChange={e => setBrandName(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-between py-1">
                      <div>
                        <Label className="text-xs">Incluir CTA no último slide</Label>
                        <p className="text-[10px] text-muted-foreground">Call-to-action para converter</p>
                      </div>
                      <Switch checked={includeCta} onCheckedChange={setIncludeCta} />
                    </div>

                    <Button
                      className="w-full gradient-primary text-primary-foreground"
                      onClick={handleGenerate}
                      disabled={generating || !topic.trim() || !audience.trim()}
                    >
                      {generating ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando com IA...</>
                      ) : (
                        <><Sparkles className="h-4 w-4 mr-2" />Gerar Carrossel com DAVI</>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Caption Editor */}
                {generatedCarousel && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span>Legenda e Hashtags</span>
                        <Button size="sm" variant="ghost" onClick={handleCopyCaption}>
                          <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                        </Button>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <Textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        rows={6}
                        className="text-xs resize-none"
                        placeholder="Legenda do post..."
                      />
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          <Hash className="h-3 w-3" /> Hashtags (separadas por vírgula)
                        </Label>
                        <Textarea
                          value={hashtags}
                          onChange={e => setHashtags(e.target.value)}
                          rows={2}
                          className="text-xs resize-none"
                          placeholder="marketing, empreendedorismo, negócios..."
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button className="flex-1" onClick={handleSaveDraft} variant="outline">
                          Salvar Rascunho
                        </Button>
                        <Button className="flex-1 gradient-primary text-primary-foreground" onClick={handleSaveDraft}>
                          <Send className="h-4 w-4 mr-1" /> Publicar Agora
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* RIGHT: Preview */}
              <div className="space-y-4">
                {generatedCarousel ? (
                  <>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span>Preview — {generatedCarousel.slides.length} slides</span>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setActiveSlide(Math.max(0, activeSlide - 1))}
                              disabled={activeSlide === 0}
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              {activeSlide + 1}/{generatedCarousel.slides.length}
                            </span>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setActiveSlide(Math.min(generatedCarousel.slides.length - 1, activeSlide + 1))}
                              disabled={activeSlide === generatedCarousel.slides.length - 1}
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4">
                        {/* Main preview */}
                        <div className="max-w-[280px] mx-auto">
                          <SlidePreview slide={generatedCarousel.slides[activeSlide]} isActive />
                        </div>

                        {/* Thumbnail strip */}
                        <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
                          {generatedCarousel.slides.map((slide, i) => (
                            <button
                              key={i}
                              onClick={() => setActiveSlide(i)}
                              className="flex-shrink-0 w-16"
                            >
                              <SlidePreview slide={slide} isActive={i === activeSlide} />
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Cover headline */}
                    <Card className="border-primary/20 bg-primary/5">
                      <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Headline da Capa</p>
                        <p className="font-bold text-primary">{generatedCarousel.cover_headline}</p>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="border-dashed border-2 border-primary/20">
                    <CardContent className="py-20 text-center">
                      <Instagram className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-muted-foreground text-sm">
                        Preencha o formulário e gere seu carrossel com IA
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        DAVI vai criar slides prontos para o Instagram 🚀
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ─── POSTS TAB ─── */}
          <TabsContent value="posts" className="mt-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{posts.length} posts encontrados</p>
              <Button size="sm" variant="outline" onClick={() => fetchPosts()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>

            {loading && posts.length === 0 && (
              <div className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
                <p className="text-muted-foreground text-sm">Carregando posts...</p>
              </div>
            )}

            {!loading && posts.length === 0 && (
              <Card className="border-dashed border-2">
                <CardContent className="py-16 text-center">
                  <Layers className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-muted-foreground">Nenhum post encontrado</p>
                  <p className="text-xs text-muted-foreground mt-1">Gere seu primeiro carrossel na aba "Gerador IA"</p>
                  <Button size="sm" className="mt-4 gradient-primary text-primary-foreground" onClick={() => setActiveTab('gerador')}>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Gerar carrossel
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3">
              {posts.map(post => (
                <Card key={post.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <StatusBadge status={post.status} />
                          <Badge variant="outline" className="text-[10px]">
                            {post.post_type === 'carousel' ? `📱 Carrossel (${post.slides?.length || 0} slides)` : '🖼️ Imagem'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(post.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                        <p className="text-sm line-clamp-2 text-muted-foreground">{post.caption || 'Sem legenda'}</p>
                        {post.hashtags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {post.hashtags.slice(0, 4).map(tag => (
                              <span key={tag} className="text-[10px] text-primary">#{tag}</span>
                            ))}
                            {post.hashtags.length > 4 && (
                              <span className="text-[10px] text-muted-foreground">+{post.hashtags.length - 4}</span>
                            )}
                          </div>
                        )}
                        {post.scheduled_at && post.status === 'scheduled' && (
                          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-blue-400">
                            <Clock className="h-3 w-3" />
                            Agendado: {new Date(post.scheduled_at).toLocaleString('pt-BR')}
                          </div>
                        )}
                        {post.insights && (
                          <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{post.insights.impressions}</span>
                            <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{post.insights.likes}</span>
                            <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{post.insights.comments}</span>
                            <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{post.insights.shares}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {post.status === 'draft' && (
                          <>
                            <Button size="sm" variant="default" className="gradient-primary text-primary-foreground text-xs"
                              onClick={() => publishNow(post.id)} disabled={loading}>
                              <Send className="h-3 w-3 mr-1" /> Publicar
                            </Button>
                            <Button size="sm" variant="destructive" className="text-xs"
                              onClick={() => deleteDraft(post.id)}>
                              <Trash2 className="h-3 w-3 mr-1" /> Excluir
                            </Button>
                          </>
                        )}
                        {post.status === 'published' && (
                          <div className="flex items-center gap-1 text-xs text-emerald-400">
                            <CheckCircle className="h-3.5 w-3.5" /> Publicado
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ─── CALENDAR TAB ─── */}
          <TabsContent value="calendario" className="mt-5">
            <ContentCalendar posts={posts} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// ─── Mini Content Calendar ─────────────────────────────────────────────────
function ContentCalendar({ posts }: { posts: SocialPost[] }) {
  const today = new Date();
  const [currentWeek, setCurrentWeek] = useState(0);

  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + currentWeek * 7);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const getPostsForDay = (day: Date) =>
    posts.filter(p => {
      const date = p.scheduled_at ? new Date(p.scheduled_at) : new Date(p.created_at);
      return date.toDateString() === day.toDateString();
    });

  const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Calendário de Conteúdo
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCurrentWeek(w => w - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {days[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} –{' '}
              {days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setCurrentWeek(w => w + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, i) => {
            const dayPosts = getPostsForDay(day);
            const isToday = day.toDateString() === today.toDateString();

            return (
              <div key={i} className={`min-h-[120px] rounded-xl border p-2 transition-colors ${isToday ? 'border-primary/40 bg-primary/5' : 'border-border/50'}`}>
                <div className="flex flex-col items-center mb-2">
                  <span className="text-[10px] text-muted-foreground">{DAY_LABELS[day.getDay()]}</span>
                  <span className={`text-sm font-bold ${isToday ? 'text-primary' : ''}`}>
                    {day.getDate()}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayPosts.map(post => (
                    <div key={post.id} className={`text-[9px] rounded px-1 py-0.5 truncate ${post.status === 'scheduled' ? 'bg-blue-500/20 text-blue-400' : post.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      📱 {post.slides?.length || '?'}s
                    </div>
                  ))}
                  {dayPosts.length === 0 && (
                    <div className="text-[10px] text-muted-foreground/40 text-center mt-2">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/40" />Agendado</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/40" />Publicado</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-muted" />Rascunho</span>
        </div>
      </CardContent>
    </Card>
  );
}
