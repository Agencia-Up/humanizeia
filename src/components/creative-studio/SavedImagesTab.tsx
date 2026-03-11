import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Download, Trash2, ImagePlus, Eye, Calendar, Tag, Eraser, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface SavedCreative {
  id: string;
  name: string;
  file_url: string;
  type: string;
  style: string | null;
  dimensions: string | null;
  description: string | null;
  tags: string[];
  created_at: string | null;
}

export function SavedImagesTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [images, setImages] = useState<SavedCreative[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<SavedCreative | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const fetchImages = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('creatives')
      .select('id, name, file_url, type, style, dimensions, description, tags, created_at')
      .eq('user_id', user.id)
      .eq('type', 'image')
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Erro ao carregar imagens', description: error.message, variant: 'destructive' });
    } else {
      setImages(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchImages();
  }, [user]);

  const handleDelete = async (creative: SavedCreative) => {
    if (!user) return;

    // Delete from storage
    const path = creative.file_url.split('/creatives/')[1];
    if (path) {
      await supabase.storage.from('creatives').remove([path]);
    }

    // Delete from database
    const { error } = await supabase.from('creatives').delete().eq('id', creative.id);
    if (error) {
      toast({ title: 'Erro ao excluir', description: error.message, variant: 'destructive' });
    } else {
      setImages((prev) => prev.filter((img) => img.id !== creative.id));
      if (selectedImage?.id === creative.id) setSelectedImage(null);
      toast({ title: 'Imagem excluída com sucesso' });
    }
  };

  const handleDownload = (image: SavedCreative) => {
    const link = document.createElement('a');
    link.href = image.file_url;
    link.download = `${image.name}.png`;
    link.target = '_blank';
    link.click();
  };

  if (loading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader><CardTitle>Imagens Salvas</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Imagens Salvas ({images.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {images.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <ImagePlus className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-semibold">Nenhuma imagem salva</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Gere criativos na aba "Gerar do Zero" e salve-os aqui
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              <AnimatePresence>
                {images.map((image, index) => (
                   <motion.div
                     key={image.id}
                     initial={{ opacity: 0, scale: 0.9 }}
                     animate={{ opacity: 1, scale: 1 }}
                     exit={{ opacity: 0, scale: 0.9 }}
                     transition={{ delay: index * 0.05 }}
                     className="group relative aspect-square overflow-hidden rounded-lg border-2 cursor-pointer transition-all border-border/50 hover:border-primary/50"
                     onClick={() => setLightboxImage(image.file_url)}
                   >
                    <img
                      src={image.file_url}
                      alt={image.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                       <Button size="icon" variant="secondary" onClick={(e) => { e.stopPropagation(); setLightboxImage(image.file_url); }}>
                         <Eye className="h-4 w-4" />
                       </Button>
                       <Button size="icon" variant="secondary" onClick={(e) => { e.stopPropagation(); handleDownload(image); }}>
                         <Download className="h-4 w-4" />
                       </Button>
                       <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="destructive" onClick={(e) => e.stopPropagation()}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir imagem?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta ação não pode ser desfeita. A imagem será removida permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(image)}>Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {image.tags?.includes('remove-bg') && (
                      <Badge className="absolute right-2 top-2 bg-accent text-accent-foreground text-xs gap-1">
                        <Eraser className="h-3 w-3" />
                        Sem Fundo
                      </Badge>
                    )}
                    {image.style && !image.tags?.includes('remove-bg') && (
                      <Badge className="absolute left-2 top-2 bg-black/50 text-xs">
                        {image.style}
                      </Badge>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={() => setLightboxImage(null)}
          >
            <Button
              className="absolute right-4 top-4 z-10"
              variant="ghost"
              size="icon"
              onClick={() => setLightboxImage(null)}
            >
              <X className="h-6 w-6" />
            </Button>
            <motion.img
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              src={lightboxImage}
              alt="Fullscreen"
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
