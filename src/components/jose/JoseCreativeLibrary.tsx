import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Image, Upload, Download, Loader2, Trash2,
  PlayCircle, PauseCircle,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JoseCreative {
  id: string;
  user_id: string;
  segment_slug: string | null;
  name: string;
  type: string | null;
  storage_path: string | null;
  public_url: string | null;
  meta_creative_id: string | null;
  meta_ad_id: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  status: string;
  performance: { ctr?: number; cpl?: number } | null;
  tags: string[] | null;
  created_at: string;
}

// ── Creative Card ─────────────────────────────────────────────────────────────

function CreativeCard({
  creative,
  onToggleStatus,
  onDelete,
  isDeleting,
  isToggling,
}: {
  creative: JoseCreative;
  onToggleStatus: (id: string, current: string) => void;
  onDelete: (id: string, storagePath: string | null) => void;
  isDeleting: boolean;
  isToggling: boolean;
}) {
  const isActive = creative.status === 'active';
  const isMeta = !!creative.meta_creative_id;

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden flex flex-col">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-muted/30 flex items-center justify-center overflow-hidden">
        {creative.public_url ? (
          creative.type === 'video' ? (
            <video
              src={creative.public_url}
              className="w-full h-full object-cover"
              muted
            />
          ) : (
            <img
              src={creative.public_url}
              alt={creative.name}
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <Image className="h-10 w-10 text-muted-foreground/30" />
        )}

        {/* Source badge */}
        <div className="absolute top-2 left-2">
          {isMeta ? (
            <Badge className="text-[10px] bg-blue-500/80 text-white border-0 px-1.5">Meta</Badge>
          ) : (
            <Badge className="text-[10px] bg-emerald-500/80 text-white border-0 px-1.5">Upload</Badge>
          )}
        </div>

        {/* Status badge */}
        <div className="absolute top-2 right-2">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 ${
              isActive
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-muted text-muted-foreground border-border/50'
            }`}
          >
            {isActive ? 'Ativo' : 'Pausado'}
          </Badge>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <p className="font-semibold text-sm leading-snug truncate" title={creative.name}>
          {creative.name}
        </p>

        {/* Performance */}
        {creative.performance && (creative.performance.ctr !== undefined || creative.performance.cpl !== undefined) && (
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            {creative.performance.ctr !== undefined && (
              <span>CTR <strong className="text-foreground">{creative.performance.ctr.toFixed(2)}%</strong></span>
            )}
            {creative.performance.cpl !== undefined && (
              <span>CPL <strong className="text-foreground">R$ {creative.performance.cpl.toFixed(2)}</strong></span>
            )}
          </div>
        )}

        {/* Headline */}
        {creative.headline && (
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="font-medium text-foreground">Título:</span> {creative.headline}
          </p>
        )}

        {/* Body text */}
        {creative.body && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {creative.body}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1 mt-auto">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-7 text-xs gap-1"
            onClick={() => onToggleStatus(creative.id, creative.status)}
            disabled={isToggling}
          >
            {isToggling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isActive ? (
              <PauseCircle className="h-3 w-3" />
            ) : (
              <PlayCircle className="h-3 w-3" />
            )}
            {isActive ? 'Pausar' : 'Ativar'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(creative.id, creative.storage_path)}
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface JoseCreativeLibraryProps {
  segmentSlug?: string | null;
  accountId?: string;
}

export function JoseCreativeLibrary({ segmentSlug, accountId }: JoseCreativeLibraryProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [creatives, setCreatives] = useState<JoseCreative[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [filterTab, setFilterTab] = useState('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadCreatives = async () => {
    if (!user) return;
    setIsLoading(true);

    const { data, error } = await supabase
      .from('jose_creative_library' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Erro ao carregar criativos', description: error.message, variant: 'destructive' });
    } else {
      setCreatives((data as unknown as JoseCreative[]) ?? []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    loadCreatives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from('jose-creatives')
        .upload(path, file, { upsert: false });

      if (uploadError) throw new Error(uploadError.message);

      const { data: urlData } = supabase.storage
        .from('jose-creatives')
        .getPublicUrl(path);

      const isVideo = file.type.startsWith('video/');

      const { error: insertError } = await supabase
        .from('jose_creative_library' as any)
        .insert({
          user_id: user.id,
          segment_slug: segmentSlug ?? null,
          name: file.name.replace(`.${ext}`, ''),
          type: isVideo ? 'video' : 'image',
          storage_path: path,
          public_url: urlData.publicUrl,
          status: 'active',
        });

      if (insertError) throw new Error(insertError.message);

      toast({ title: '✅ Upload concluído!', description: `${file.name} adicionado à biblioteca.` });
      await loadCreatives();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      toast({ title: 'Erro no upload', description: message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Import from Meta ───────────────────────────────────────────────────────
  const handleImportMeta = async () => {
    if (!accountId) {
      toast({ title: 'Nenhuma conta conectada', description: 'Conecte uma conta Meta Ads primeiro.', variant: 'destructive' });
      return;
    }
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('apollo-agent', {
        body: { action: 'get_meta_creatives', targetAccountId: accountId },
      });

      if (error) throw new Error(error.message);

      const items: Array<{
        id: string; ad_id?: string; name?: string; body?: string;
        title?: string; call_to_action_type?: string; image_url?: string;
      }> = Array.isArray(data?.creatives) ? data.creatives : [];

      if (items.length === 0) {
        toast({ title: 'Nenhum criativo encontrado', description: 'O Meta não retornou criativos para essa conta.' });
        return;
      }

      const rows = items.map(c => ({
        user_id: user!.id,
        segment_slug: segmentSlug ?? null,
        name: c.name ?? `Criativo ${c.id}`,
        type: 'image',
        meta_creative_id: c.id,
        meta_ad_id: c.ad_id ?? null,
        public_url: c.image_url ?? null,
        headline: c.title ?? null,
        body: c.body ?? null,
        cta: c.call_to_action_type ?? null,
        status: 'active',
      }));

      const { error: upsertError } = await supabase
        .from('jose_creative_library' as any)
        .upsert(rows, { onConflict: 'meta_creative_id' });

      if (upsertError) throw new Error(upsertError.message);

      toast({ title: `✅ ${rows.length} criativo(s) importados do Meta!` });
      await loadCreatives();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      toast({ title: 'Erro ao importar do Meta', description: message, variant: 'destructive' });
    } finally {
      setIsImporting(false);
    }
  };

  // ── Toggle status ──────────────────────────────────────────────────────────
  const handleToggleStatus = async (id: string, currentStatus: string) => {
    setTogglingId(id);
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    const { error } = await supabase
      .from('jose_creative_library' as any)
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      toast({ title: 'Erro ao atualizar status', description: error.message, variant: 'destructive' });
    } else {
      setCreatives(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
    }
    setTogglingId(null);
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string, storagePath: string | null) => {
    setDeletingId(id);
    try {
      if (storagePath) {
        await supabase.storage.from('jose-creatives').remove([storagePath]);
      }
      const { error } = await supabase
        .from('jose_creative_library' as any)
        .delete()
        .eq('id', id);

      if (error) throw new Error(error.message);

      setCreatives(prev => prev.filter(c => c.id !== id));
      toast({ title: 'Criativo removido.' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      toast({ title: 'Erro ao remover', description: message, variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = creatives.filter(c => {
    if (filterTab === 'active') return c.status === 'active';
    if (filterTab === 'paused') return c.status === 'paused';
    if (filterTab === 'meta') return !!c.meta_creative_id;
    return true;
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Image className="h-5 w-5 text-orange-400" />
          <h2 className="font-bold text-base">Biblioteca de Criativos</h2>
          <Badge variant="secondary" className="text-xs">
            {creatives.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Upload
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleImportMeta}
            disabled={isImporting}
          >
            {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Importar do Meta
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Tabs value={filterTab} onValueChange={setFilterTab}>
        <TabsList className="h-8">
          <TabsTrigger value="all" className="text-xs h-7">Todos</TabsTrigger>
          <TabsTrigger value="active" className="text-xs h-7">Ativos</TabsTrigger>
          <TabsTrigger value="paused" className="text-xs h-7">Pausados</TabsTrigger>
          <TabsTrigger value="meta" className="text-xs h-7">Do Meta</TabsTrigger>
        </TabsList>

        <TabsContent value={filterTab} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center py-16 gap-4">
                <Image className="h-12 w-12 text-muted-foreground/30" />
                <div className="text-center">
                  <p className="font-semibold text-sm">Nenhum criativo ainda</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Faça upload de imagens/vídeos ou importe diretamente do Meta Ads.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Fazer upload
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filtered.map(creative => (
                <CreativeCard
                  key={creative.id}
                  creative={creative}
                  onToggleStatus={handleToggleStatus}
                  onDelete={handleDelete}
                  isDeleting={deletingId === creative.id}
                  isToggling={togglingId === creative.id}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
