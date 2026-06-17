import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useToast } from '@/hooks/use-toast';
import {
  GraduationCap, Plus, Loader2, Trash2, Edit2, Play, X,
  ChevronLeft, ChevronRight, Video, FolderPlus, Save, ExternalLink,
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
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  // Loom
  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;

  // PandaVideo — ja vem como embed normalmente
  if (/pandavideo/i.test(url)) {
    return url.includes('/embed/') ? url : url.replace('/share/', '/embed/');
  }

  return url;
}

function getThumbnail(url: string): string | null {
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg`;
  return null;
}

const PLATFORM_LABELS: Record<string, { label: string; color: string }> = {
  youtube: { label: 'YouTube', color: 'bg-red-500/10 text-red-400 border-red-500/30' },
  vimeo: { label: 'Vimeo', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  pandavideo: { label: 'Panda', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  loom: { label: 'Loom', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  other: { label: 'Video', color: 'bg-slate-500/10 text-slate-400 border-slate-500/30' },
};

// ── Componente Principal ─────────────────────────────────────────────────────

export default function Treinamento() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin(); // só o superadmin (Logos) edita; o resto só assiste
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
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Biblioteca GLOBAL: todas as contas veem o mesmo treinamento (is_global).
      // Só o superadmin edita (a RLS bloqueia escrita pra quem não é).
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
          .select('id, section_id, title, description, video_url, platform, thumbnail_url, sort_order')
          .in('section_id', sectionIds)
          .order('sort_order', { ascending: true });
        videos = vids || [];
      }

      const enriched = (secs || []).map((s: any) => ({
        ...s,
        videos: videos.filter((v: any) => v.section_id === s.id),
      }));
      setSections(enriched);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── CRUD Secoes ──

  const openNewSection = () => {
    setEditingSection(null);
    setSectionTitle('');
    setSectionDesc('');
    setSectionDialog(true);
  };

  const openEditSection = (sec: TrainingSection) => {
    setEditingSection(sec);
    setSectionTitle(sec.title);
    setSectionDesc(sec.description || '');
    setSectionDialog(true);
  };

  const handleSaveSection = async () => {
    if (!sectionTitle.trim() || !user) return;
    setSaving(true);
    try {
      if (editingSection) {
        await (supabase as any).from('training_sections')
          .update({ title: sectionTitle.trim(), description: sectionDesc.trim() || null, updated_at: new Date().toISOString() })
          .eq('id', editingSection.id);
        toast({ title: 'Secao atualizada!' });
      } else {
        await (supabase as any).from('training_sections')
          .insert({ user_id: user.id, title: sectionTitle.trim(), description: sectionDesc.trim() || null, sort_order: sections.length, is_global: true });
        toast({ title: 'Secao criada!' });
      }
      setSectionDialog(false);
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (id: string) => {
    if (!confirm('Excluir esta secao e todos os videos dela?')) return;
    await (supabase as any).from('training_sections').delete().eq('id', id);
    toast({ title: 'Secao excluida!' });
    await fetchData();
  };

  // ── CRUD Videos ──

  const openAddVideo = (sectionId: string) => {
    setTargetSectionId(sectionId);
    setVideoTitle('');
    setVideoDesc('');
    setVideoUrl('');
    setVideoDialog(true);
  };

  const handleSaveVideo = async () => {
    if (!videoUrl.trim() || !videoTitle.trim() || !targetSectionId || !user) return;
    setSaving(true);
    try {
      const platform = detectPlatform(videoUrl);
      const thumbnail = getThumbnail(videoUrl);
      const section = sections.find(s => s.id === targetSectionId);
      await (supabase as any).from('training_videos').insert({
        section_id: targetSectionId,
        user_id: user.id,
        is_global: true,
        title: videoTitle.trim(),
        description: videoDesc.trim() || null,
        video_url: videoUrl.trim(),
        platform,
        thumbnail_url: thumbnail,
        sort_order: section ? section.videos.length : 0,
      });
      toast({ title: 'Video adicionado!' });
      setVideoDialog(false);
      await fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    if (!confirm('Excluir este video?')) return;
    await (supabase as any).from('training_videos').delete().eq('id', id);
    toast({ title: 'Video excluido!' });
    await fetchData();
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

  return (
    <MainLayout>
      <div className="space-y-6 max-w-6xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Treinamento</h1>
              <p className="text-xs text-muted-foreground">
                {isAdmin ? 'Gerencie as aulas — visível para todas as contas.' : 'Aprenda a usar a Logos IA — aulas em vídeo.'}
              </p>
            </div>
          </div>
          {isAdmin && (
            <Button onClick={openNewSection} className="gap-2">
              <FolderPlus className="h-4 w-4" /> Nova Seção
            </Button>
          )}
        </div>

        {/* ── Empty State ── */}
        {sections.length === 0 && (
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
              <Button onClick={openNewSection} className="gap-2">
                <FolderPlus className="h-4 w-4" /> Criar Primeira Seção
              </Button>
            )}
          </div>
        )}

        {/* ── Secoes (Netflix-style) ── */}
        {sections.map(section => (
          <div key={section.id} className="space-y-3">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">{section.title}</h2>
                <Badge variant="outline" className="text-[10px]">{section.videos.length} videos</Badge>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openAddVideo(section.id)} className="h-7 px-2 text-xs gap-1 text-primary">
                    <Plus className="h-3 w-3" /> Vídeo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEditSection(section)} className="h-7 w-7 p-0 text-muted-foreground">
                    <Edit2 className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDeleteSection(section.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            {section.description && (
              <p className="text-xs text-muted-foreground -mt-1">{section.description}</p>
            )}

            {/* Video cards — horizontal scroll */}
            {section.videos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/40 bg-card/20 p-8 text-center">
                <p className="text-xs text-muted-foreground mb-2">{isAdmin ? 'Nenhum vídeo nesta seção' : 'Aulas em breve nesta seção'}</p>
                {isAdmin && (
                  <Button variant="outline" size="sm" onClick={() => openAddVideo(section.id)} className="text-xs gap-1">
                    <Plus className="h-3 w-3" /> Adicionar Vídeo
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto pb-2 -mx-1 px-1">
                <div className="flex gap-3 min-w-max">
                  {section.videos.map(video => {
                    const pInfo = PLATFORM_LABELS[video.platform] || PLATFORM_LABELS.other;
                    return (
                      <div
                        key={video.id}
                        className="w-[280px] shrink-0 rounded-xl border border-border/40 bg-card/60 overflow-hidden group hover:border-violet-500/40 transition-all cursor-pointer"
                        onClick={() => setPlayerDialog(video)}
                      >
                        {/* Thumbnail */}
                        <div className="relative aspect-video bg-muted/50 overflow-hidden">
                          {video.thumbnail_url ? (
                            <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Video className="h-10 w-10 text-muted-foreground/30" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                              <Play className="h-5 w-5 text-black ml-0.5" />
                            </div>
                          </div>
                          <Badge variant="outline" className={`absolute top-2 right-2 text-[9px] ${pInfo.color}`}>
                            {pInfo.label}
                          </Badge>
                        </div>
                        {/* Info */}
                        <div className="p-3 space-y-1">
                          <p className="text-sm font-medium text-foreground truncate">{video.title}</p>
                          {video.description && (
                            <p className="text-[11px] text-muted-foreground line-clamp-2">{video.description}</p>
                          )}
                          <div className="flex items-center justify-between pt-1">
                            {isAdmin ? (
                              <button
                                onClick={e => { e.stopPropagation(); handleDeleteVideo(video.id); }}
                                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                              >
                                <Trash2 className="h-2.5 w-2.5" /> Excluir
                              </button>
                            ) : <span />}
                            <a
                              href={video.video_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1"
                            >
                              <ExternalLink className="h-2.5 w-2.5" /> Abrir
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Dialog: Nova/Editar Secao ── */}
      <Dialog open={sectionDialog} onOpenChange={setSectionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSection ? 'Editar Secao' : 'Nova Secao'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Titulo da Secao</Label>
              <Input value={sectionTitle} onChange={e => setSectionTitle(e.target.value)} placeholder="Ex: Modulo 1 - Introducao" />
            </div>
            <div className="space-y-2">
              <Label>Descricao (opcional)</Label>
              <Textarea value={sectionDesc} onChange={e => setSectionDesc(e.target.value)} placeholder="Descreva o conteudo desta secao..." className="min-h-[80px] resize-none" />
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

      {/* ── Dialog: Adicionar Video ── */}
      <Dialog open={videoDialog} onOpenChange={setVideoDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Video</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>URL do Video</Label>
              <Input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/watch?v=... ou Vimeo, PandaVideo..." />
              {videoUrl && (
                <Badge variant="outline" className={`text-[10px] ${(PLATFORM_LABELS[detectPlatform(videoUrl)] || PLATFORM_LABELS.other).color}`}>
                  {(PLATFORM_LABELS[detectPlatform(videoUrl)] || PLATFORM_LABELS.other).label} detectado
                </Badge>
              )}
            </div>
            <div className="space-y-2">
              <Label>Titulo</Label>
              <Input value={videoTitle} onChange={e => setVideoTitle(e.target.value)} placeholder="Nome do video" />
            </div>
            <div className="space-y-2">
              <Label>Descricao (opcional)</Label>
              <Textarea value={videoDesc} onChange={e => setVideoDesc(e.target.value)} placeholder="O que este video ensina..." className="min-h-[60px] resize-none" />
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
                <h3 className="font-semibold text-foreground">{playerDialog.title}</h3>
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
