import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import {
  GraduationCap, Plus, Loader2, Trash2, Edit2, Play, Video, FolderPlus, Save,
  ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface TrainingSection {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  videos: TrainingVideo[];
}

interface TrainingVideo {
  id: string;
  section_id: string;
  title: string;
  description: string | null;
  video_url: string;
  platform: string;
  thumbnail_url: string | null;
  sort_order: number;
  audience: string; // 'all' | 'seller' | 'master'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/vimeo\.com/i.test(url)) return 'vimeo';
  if (/pandavideo/i.test(url)) return 'pandavideo';
  if (/loom\.com/i.test(url)) return 'loom';
  return 'other';
}

function getEmbedUrl(url: string): string {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;
  if (/pandavideo/i.test(url)) {
    return url.includes('/embed/') ? url : url.replace('/share/', '/embed/');
  }
  return url;
}

function getYoutubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function getThumbnail(url: string): string | null {
  const id = getYoutubeId(url);
  if (id) return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
  return null;
}

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  youtube: { label: 'YouTube', color: 'bg-red-500/10 text-red-400 border-red-500/30' },
  vimeo: { label: 'Vimeo', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  pandavideo: { label: 'Panda', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  loom: { label: 'Loom', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  other: { label: 'Video', color: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
};

// ── Card "estilo poster Netflix" ─────────────────────────────────────────────
// Card 16:9, hover escala/sombra, título sobreposto no rodapé do thumb. Sem
// thumbnail = capa branded com gradient roxo + LOGOS|IA em dourado + título.
function PosterCard({
  video, onPlay, isAdmin, onDelete,
}: {
  video: TrainingVideo;
  onPlay: (v: TrainingVideo) => void;
  isAdmin: boolean;
  onDelete: (id: string) => void;
}) {
  const pInfo = PLATFORM_LABELS[video.platform] || PLATFORM_LABELS.other;
  return (
    <div
      className="group relative shrink-0 w-[260px] sm:w-[300px] md:w-[320px] cursor-pointer transition-transform duration-300 ease-out hover:scale-[1.06] hover:z-10"
      onClick={() => onPlay(video)}
    >
      <div
        className="relative aspect-video rounded-md overflow-hidden bg-black ring-0 group-hover:ring-2 group-hover:ring-violet-400/70 transition-all"
        style={{ boxShadow: '0 6px 20px -6px rgba(0,0,0,0.45)' }}
      >
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          // Capa padrão "poster Logos IA" — gradient profundo + marca + título
          <div className="absolute inset-0 flex flex-col justify-between p-4"
            style={{ background: 'linear-gradient(160deg, #5B21B6 0%, #312E81 45%, #0F2647 100%)' }}>
            <span className="text-[10px] font-black tracking-widest text-white/90 self-start">
              LOGOS<span style={{ color: 'var(--brand-gold)' }}>|IA</span>
            </span>
            <div>
              <span className="block text-base sm:text-lg font-extrabold text-white leading-tight line-clamp-3" style={{ fontFamily: 'var(--font-display)' }}>
                {video.title}
              </span>
              <span className="block mt-1.5 text-[9px] uppercase tracking-[0.25em] text-white/55">Aula</span>
            </div>
          </div>
        )}

        {/* Gradiente embaixo p/ legibilidade do título quando aparece on-hover */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        {/* Botão play central */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-14 h-14 rounded-full bg-white/95 flex items-center justify-center shadow-2xl">
            <Play className="h-6 w-6 text-black ml-0.5" fill="currentColor" />
          </div>
        </div>

        {/* Title overlay on hover (Netflix vibe) */}
        <div className="absolute inset-x-0 bottom-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <p className="text-white font-semibold text-sm leading-tight line-clamp-2">{video.title}</p>
        </div>

        {/* Plataforma top-right */}
        <Badge variant="outline" className={`absolute top-2 right-2 text-[9px] backdrop-blur-sm ${pInfo.color}`}>
          {pInfo.label}
        </Badge>

        {/* Indicador de público pro admin */}
        {isAdmin && video.audience !== 'all' && (
          <span className="absolute top-2 left-2 inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/30 text-white border border-violet-400/40 backdrop-blur-sm">
            {video.audience === 'seller' ? 'Vendedor' : 'Master'}
          </span>
        )}

        {/* Ações do admin (excluir / abrir) na parte inferior, on-hover */}
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={video.video_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/90"
            title="Abrir no YouTube"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(video.id); }}
              className="h-7 w-7 rounded-full bg-black/60 hover:bg-red-600/80 flex items-center justify-center text-white/90"
              title="Excluir vídeo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Título debaixo do card (sempre visível, complementa o overlay) */}
      <p className="mt-2 text-[13px] font-medium text-foreground/90 leading-snug line-clamp-2">{video.title}</p>
      {video.description && (
        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">{video.description}</p>
      )}
    </div>
  );
}

// ── Fileira Netflix (scroll horizontal + setas) ──────────────────────────────
function NetflixRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scroll = (dir: 'left' | 'right') => {
    const el = ref.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.85);
    el.scrollBy({ left: dir === 'left' ? -delta : delta, behavior: 'smooth' });
  };
  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={() => scroll('left')}
        aria-label="Anterior"
        className="hidden md:flex absolute left-0 top-0 bottom-10 z-20 w-12 items-center justify-center bg-gradient-to-r from-background/95 via-background/70 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
      >
        <span className="h-10 w-10 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center text-white">
          <ChevronLeft className="h-6 w-6" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => scroll('right')}
        aria-label="Próximo"
        className="hidden md:flex absolute right-0 top-0 bottom-10 z-20 w-12 items-center justify-center bg-gradient-to-l from-background/95 via-background/70 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
      >
        <span className="h-10 w-10 rounded-full bg-black/70 hover:bg-black/90 flex items-center justify-center text-white">
          <ChevronRight className="h-6 w-6" />
        </span>
      </button>
      <div
        ref={ref}
        className="overflow-x-auto overflow-y-visible scroll-smooth pb-6"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as any}
      >
        <style>{`.tre-hide-scroll::-webkit-scrollbar{display:none}`}</style>
        <div className="tre-hide-scroll flex gap-4 px-4 md:px-12 min-w-max">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Componente Principal ─────────────────────────────────────────────────────

export default function Treinamento() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { isSeller } = useSellerProfile(user?.id);
  const { toast } = useToast();
  const [sections, setSections] = useState<TrainingSection[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [sectionDialog, setSectionDialog] = useState(false);
  const [videoDialog, setVideoDialog] = useState(false);
  const [playerDialog, setPlayerDialog] = useState<TrainingVideo | null>(null);
  const [editingSection, setEditingSection] = useState<TrainingSection | null>(null);
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null);

  // Form states
  const [sectionTitle, setSectionTitle] = useState('');
  const [sectionDesc, setSectionDesc] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoDesc, setVideoDesc] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoAudience, setVideoAudience] = useState<'all' | 'seller' | 'master'>('all');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: secs } = await (supabase as any)
        .from('training_sections')
        .select('id, title, description, sort_order')
        .eq('is_global', true)
        .order('sort_order', { ascending: true });

      const sectionIds = (secs || []).map((s: any) => s.id);
      let videos: any[] = [];
      if (sectionIds.length > 0) {
        const { data: vids } = await (supabase as any)
          .from('training_videos')
          .select('id, section_id, title, description, video_url, platform, thumbnail_url, sort_order, audience')
          .in('section_id', sectionIds)
          .order('sort_order', { ascending: true });
        videos = vids || [];
      }

      // Vendedor não vê aulas marcadas só pra master; master e superadmin veem todas.
      const podeVer = (v: any) => !isSeller || isAdmin || v.audience !== 'master';
      let enriched = (secs || []).map((s: any) => ({
        ...s,
        videos: videos.filter((v: any) => v.section_id === s.id && podeVer(v)),
      }));
      // Pro vendedor, esconde seção sem aula visível. Admin vê tudo pra gerenciar.
      if (isSeller && !isAdmin) enriched = enriched.filter((s: any) => s.videos.length > 0);
      setSections(enriched);
    } finally {
      setLoading(false);
    }
  }, [user, isSeller, isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── CRUD ──
  const openNewSection = () => { setEditingSection(null); setSectionTitle(''); setSectionDesc(''); setSectionDialog(true); };
  const openEditSection = (sec: TrainingSection) => { setEditingSection(sec); setSectionTitle(sec.title); setSectionDesc(sec.description || ''); setSectionDialog(true); };
  const handleSaveSection = async () => {
    if (!sectionTitle.trim() || !user) return;
    setSaving(true);
    try {
      if (editingSection) {
        await (supabase as any).from('training_sections')
          .update({ title: sectionTitle.trim(), description: sectionDesc.trim() || null, updated_at: new Date().toISOString() })
          .eq('id', editingSection.id);
        toast({ title: 'Seção atualizada!' });
      } else {
        await (supabase as any).from('training_sections')
          .insert({ user_id: user.id, title: sectionTitle.trim(), description: sectionDesc.trim() || null, sort_order: sections.length, is_global: true });
        toast({ title: 'Seção criada!' });
      }
      setSectionDialog(false); await fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };
  const handleDeleteSection = async (id: string) => {
    if (!confirm('Excluir esta seção e todos os vídeos dela?')) return;
    await (supabase as any).from('training_sections').delete().eq('id', id);
    toast({ title: 'Seção excluída!' }); await fetchData();
  };
  const openAddVideo = (sectionId: string) => {
    setTargetSectionId(sectionId); setVideoTitle(''); setVideoDesc(''); setVideoUrl(''); setVideoAudience('all'); setVideoDialog(true);
  };
  const handleSaveVideo = async () => {
    if (!videoUrl.trim() || !videoTitle.trim() || !targetSectionId || !user) return;
    setSaving(true);
    try {
      const platform = detectPlatform(videoUrl);
      const thumbnail = getThumbnail(videoUrl);
      const section = sections.find((s) => s.id === targetSectionId);
      await (supabase as any).from('training_videos').insert({
        section_id: targetSectionId, user_id: user.id, is_global: true,
        title: videoTitle.trim(), description: videoDesc.trim() || null,
        video_url: videoUrl.trim(), platform, thumbnail_url: thumbnail,
        sort_order: section ? section.videos.length : 0, audience: videoAudience,
      });
      toast({ title: 'Vídeo adicionado!' });
      setVideoDialog(false); await fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally { setSaving(false); }
  };
  const handleDeleteVideo = async (id: string) => {
    if (!confirm('Excluir este vídeo?')) return;
    await (supabase as any).from('training_videos').delete().eq('id', id);
    toast({ title: 'Vídeo excluído!' }); await fetchData();
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  // Hero/destaque: primeira aula da primeira seção (se houver) — estilo Netflix.
  const firstSection = sections.find((s) => s.videos.length > 0);
  const featured = firstSection?.videos[0] || null;

  return (
    <MainLayout>
      {/* Container full-bleed pro feel Netflix (sem max-w nas fileiras) */}
      <div className="-mx-4 md:-mx-6 -my-4 md:-my-6">

        {/* ── HERO/Destaque ── */}
        {featured ? (
          <section
            className="relative w-full overflow-hidden cursor-pointer"
            style={{ minHeight: '38vh' }}
            onClick={() => setPlayerDialog(featured)}
          >
            {/* Background: thumbnail expandida com overlay escuro */}
            {featured.thumbnail_url ? (
              <img
                src={featured.thumbnail_url.replace('/mqdefault.jpg', '/hqdefault.jpg')}
                alt=""
                className="absolute inset-0 w-full h-full object-cover scale-110 blur-[1px] opacity-40"
              />
            ) : (
              <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #5B21B6 0%, #312E81 50%, #0F2647 100%)' }} />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/20" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

            <div className="relative px-4 md:px-12 py-10 md:py-14 max-w-3xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/30 to-purple-600/20 border border-violet-500/40 flex items-center justify-center">
                  <GraduationCap className="h-4 w-4 text-violet-300" />
                </div>
                <span className="text-xs uppercase tracking-[0.25em] text-violet-300/90 font-semibold">Treinamento Logos IA</span>
              </div>
              <h1
                className="text-3xl md:text-5xl font-extrabold text-foreground leading-[1.1] mb-3"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {featured.title}
              </h1>
              {featured.description && (
                <p className="text-sm md:text-base text-muted-foreground max-w-xl leading-relaxed mb-5 line-clamp-3">
                  {featured.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  onClick={(e) => { e.stopPropagation(); setPlayerDialog(featured); }}
                  className="bg-white text-black hover:bg-white/90 font-semibold gap-2"
                >
                  <Play className="h-5 w-5" fill="currentColor" /> Assistir
                </Button>
                {isAdmin && (
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); openNewSection(); }}
                    className="gap-2"
                  >
                    <FolderPlus className="h-4 w-4" /> Nova Seção
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : (
          // Sem nenhuma aula — header simples
          <section className="px-4 md:px-12 py-10">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 flex items-center justify-center">
                  <GraduationCap className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Treinamento</h1>
                  <p className="text-xs text-muted-foreground">
                    {isAdmin ? 'Gerencie as aulas — visível para todas as contas.' : 'Aprenda a usar a Logos IA — aulas em vídeo.'}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <Button onClick={openNewSection} className="gap-2"><FolderPlus className="h-4 w-4" /> Nova Seção</Button>
              )}
            </div>
          </section>
        )}

        {/* ── Empty State ── */}
        {sections.length === 0 && (
          <div className="px-4 md:px-12 py-10">
            <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 p-16 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                <Video className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-lg">{isAdmin ? 'Nenhum treinamento ainda' : 'As aulas estão chegando'}</h3>
              <p className="text-muted-foreground text-sm mt-2 mb-6 max-w-sm mx-auto">
                {isAdmin
                  ? 'Crie seções e adicione vídeos do YouTube, Vimeo ou PandaVideo para montar a área de treinamento.'
                  : 'Em breve os vídeos de como usar a Logos IA aparecem aqui.'}
              </p>
              {isAdmin && (
                <Button onClick={openNewSection} className="gap-2"><FolderPlus className="h-4 w-4" /> Criar Primeira Seção</Button>
              )}
            </div>
          </div>
        )}

        {/* ── Fileiras das Seções (estilo Netflix) ── */}
        <div className="pt-6 md:pt-10 pb-12 space-y-10 md:space-y-14">
          {sections.map((section) => (
            <section key={section.id} className="space-y-3">
              {/* Cabeçalho da fileira */}
              <div className="px-4 md:px-12 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg md:text-2xl font-bold text-foreground leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
                    {section.title}
                  </h2>
                  {section.description && (
                    <p className="text-xs md:text-sm text-muted-foreground mt-1 max-w-2xl">{section.description}</p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openAddVideo(section.id)} className="h-8 px-2 text-xs gap-1 text-primary">
                      <Plus className="h-3.5 w-3.5" /> Vídeo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditSection(section)} className="h-8 w-8 p-0 text-muted-foreground">
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDeleteSection(section.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Fileira de cards */}
              {section.videos.length === 0 ? (
                <div className="px-4 md:px-12">
                  <div className="rounded-xl border border-dashed border-border/40 bg-card/20 p-6 text-center">
                    <p className="text-xs text-muted-foreground mb-2">{isAdmin ? 'Nenhum vídeo nesta seção' : 'Aulas em breve nesta seção'}</p>
                    {isAdmin && (
                      <Button variant="outline" size="sm" onClick={() => openAddVideo(section.id)} className="text-xs gap-1">
                        <Plus className="h-3 w-3" /> Adicionar Vídeo
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <NetflixRow>
                  {section.videos.map((video) => (
                    <PosterCard
                      key={video.id}
                      video={video}
                      onPlay={(v) => setPlayerDialog(v)}
                      isAdmin={isAdmin}
                      onDelete={handleDeleteVideo}
                    />
                  ))}
                </NetflixRow>
              )}
            </section>
          ))}
        </div>
      </div>

      {/* ── Dialog: Nova/Editar Seção ── */}
      <Dialog open={sectionDialog} onOpenChange={setSectionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingSection ? 'Editar Seção' : 'Nova Seção'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Título da Seção</Label>
              <Input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} placeholder="Ex: Módulo 1 - Introdução" />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Textarea value={sectionDesc} onChange={(e) => setSectionDesc(e.target.value)} placeholder="Descreva o conteúdo desta seção..." className="min-h-[80px] resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSectionDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveSection} disabled={saving || !sectionTitle.trim()} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Adicionar Vídeo ── */}
      <Dialog open={videoDialog} onOpenChange={setVideoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar Vídeo</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL do Vídeo</Label>
              <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=... ou Vimeo, PandaVideo..." />
              {videoUrl && (
                <Badge variant="outline" className={`text-[10px] ${(PLATFORM_LABELS[detectPlatform(videoUrl)] || PLATFORM_LABELS.other).color}`}>
                  {(PLATFORM_LABELS[detectPlatform(videoUrl)] || PLATFORM_LABELS.other).label} detectado
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              <Label>Título</Label>
              <Input value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} placeholder="Nome do vídeo" />
            </div>
            <div className="space-y-2">
              <Label>Descrição (opcional)</Label>
              <Textarea value={videoDesc} onChange={(e) => setVideoDesc(e.target.value)} placeholder="O que este vídeo ensina..." className="min-h-[60px] resize-none" />
            </div>
            <div className="space-y-2">
              <Label>Quem vê esta aula</Label>
              <div className="flex gap-2">
                {([['all', 'Todos'], ['seller', 'Vendedores'], ['master', 'Só Master']] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setVideoAudience(val)}
                    className={`flex-1 h-8 rounded-md border text-xs transition-colors ${videoAudience === val ? 'border-violet-500 bg-violet-500/15 text-violet-300' : 'border-border/40 text-muted-foreground hover:border-border'}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Vendedor vê "Todos" + "Vendedores". "Só Master" o vendedor não enxerga.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVideoDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveVideo} disabled={saving || !videoUrl.trim() || !videoTitle.trim()} className="gap-1">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Player ── */}
      <Dialog open={!!playerDialog} onOpenChange={() => setPlayerDialog(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          {playerDialog && (
            <>
              <div className="aspect-video w-full bg-black">
                <iframe
                  src={getEmbedUrl(playerDialog.video_url)}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={playerDialog.title}
                />
              </div>
              <div className="p-4 space-y-1">
                <h3 className="font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{playerDialog.title}</h3>
                {playerDialog.description && (
                  <p className="text-sm text-muted-foreground">{playerDialog.description}</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
