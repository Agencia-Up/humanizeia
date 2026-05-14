import { useState, useRef, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Eraser, Download, RefreshCw, Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SUPABASE_PUBLIC_KEY, supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ImageUploadArea } from './ImageUploadArea';

const REMOVE_BG_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/remove-bg`;

interface SavedCreative {
  id: string;
  file_url: string;
  name: string;
}

interface RemoveBackgroundTabProps {
  initialImage?: { url: string; name: string } | null;
  onImageConsumed?: () => void;
}

export function RemoveBackgroundTab({ initialImage, onImageConsumed }: RemoveBackgroundTabProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [originalImage, setOriginalImage] = usePersistedState<string | null>('cs-rmbg-original', null, 500);
  const [resultImage, setResultImage] = usePersistedState<string | null>('cs-rmbg-result', null, 500);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = usePersistedState('cs-rmbg-filename', '');
  const [savedImages, setSavedImages] = useState<SavedCreative[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [useUrlMode, setUseUrlMode] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Handle initial image passed from parent (e.g. generated image)
  useEffect(() => {
    if (initialImage) {
      setOriginalImage(initialImage.url);
      setFileName(initialImage.name);
      setResultImage(null);
      setSelectedFile(null);

      // If it's a base64 data URL, convert to File for upload
      if (initialImage.url.startsWith('data:')) {
        const base64Data = initialImage.url.split(',')[1];
        if (base64Data) {
          const byteString = atob(base64Data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: 'image/png' });
          const file = new File([blob], `${initialImage.name}.png`, { type: 'image/png' });
          setSelectedFile(file);
          setUseUrlMode(false);
          setSelectedUrl(null);
        }
      } else {
        setUseUrlMode(true);
        setSelectedUrl(initialImage.url);
      }

      onImageConsumed?.();
    }
  }, [initialImage]);

  useEffect(() => {
    if (user) fetchSavedImages();
  }, [user]);

  const fetchSavedImages = async () => {
    if (!user) return;
    setLoadingSaved(true);
    try {
      const { data, error } = await supabase
        .from('creatives')
        .select('id, file_url, name, tags')
        .eq('user_id', user.id)
        .eq('type', 'image')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && data) {
        // Filter out images that already have background removed
        const filtered = data.filter(img => !img.tags?.includes('remove-bg'));
        setSavedImages(filtered);
      }
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: 'Arquivo inválido', description: 'Selecione um arquivo de imagem.', variant: 'destructive' });
      return;
    }

    if (file.size > 12 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'O limite é 12MB.', variant: 'destructive' });
      return;
    }

    setSelectedFile(file);
    setFileName(file.name);
    setResultImage(null);
    setUseUrlMode(false);
    setSelectedUrl(null);

    const reader = new FileReader();
    reader.onload = (ev) => setOriginalImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSelectSavedImage = (image: SavedCreative) => {
    setOriginalImage(image.file_url);
    setFileName(image.name);
    setResultImage(null);
    setSelectedFile(null);
    setUseUrlMode(true);
    setSelectedUrl(image.file_url);
  };

  const handleRemoveBackground = async () => {
    if (!selectedFile && !selectedUrl) {
      toast({ title: 'Selecione uma imagem', variant: 'destructive' });
      return;
    }

    setIsProcessing(true);
    setResultImage(null);

    try {
      const formData = new FormData();

      if (useUrlMode && selectedUrl) {
        formData.append('image_url', selectedUrl);
      } else if (selectedFile) {
        formData.append('image_file', selectedFile);
      }

      const response = await fetch(REMOVE_BG_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao remover fundo');
      }

      setResultImage(data.image);
      toast({ title: '✅ Fundo removido!', description: `Créditos usados: ${data.credits_charged}` });
    } catch (err) {
      console.error('Remove BG error:', err);
      toast({
        title: 'Erro ao remover fundo',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `sem-fundo-${fileName.replace(/\.[^/.]+$/, '')}.png`;
    link.click();
  };

  const handleSaveResult = async () => {
    if (!resultImage || !user) {
      toast({ title: 'Faça login para salvar', variant: 'destructive' });
      return;
    }

    setIsSaving(true);
    try {
      const base64Data = resultImage.split(',')[1];
      if (!base64Data) throw new Error('Imagem inválida');

      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });

      const storageFileName = `${user.id}/${Date.now()}-nobg.png`;
      const { error: uploadError } = await supabase.storage
        .from('creatives')
        .upload(storageFileName, blob, { contentType: 'image/png' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('creatives')
        .getPublicUrl(storageFileName);

      const { error: dbError } = await supabase.from('creatives').insert({
        user_id: user.id,
        name: `Sem Fundo - ${fileName || new Date().toLocaleDateString('pt-BR')}`,
        file_url: publicUrl,
        type: 'image' as const,
        style: 'remove-bg',
        tags: ['remove-bg', 'sem-fundo'],
      });

      if (dbError) throw dbError;

      toast({ title: '✅ Imagem salva!', description: 'Disponível na aba Imagens.' });
    } catch (err) {
      console.error('Save error:', err);
      toast({
        title: 'Erro ao salvar',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setOriginalImage(null);
    setResultImage(null);
    setSelectedFile(null);
    setSelectedUrl(null);
    setUseUrlMode(false);
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="p-6">
        <AnimatePresence mode="wait">
          {!originalImage ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4"
            >
              <ImageUploadArea
                title="Envie sua imagem para remover o fundo"
                onFileSelect={(file) => {
                  setSelectedFile(file);
                  setFileName(file.name);
                  setResultImage(null);
                  setUseUrlMode(false);
                  setSelectedUrl(null);
                  const reader = new FileReader();
                  reader.onload = (ev) => setOriginalImage(ev.target?.result as string);
                  reader.readAsDataURL(file);
                }}
                onSavedImageSelect={handleSelectSavedImage}
                savedImages={savedImages}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileSelect}
              />
            </motion.div>
          ) : (
            <motion.div
              key="editor"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Top actions */}
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleReset} variant="ghost" className="ml-auto">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Nova Imagem
                </Button>
              </div>

              {/* Image comparison */}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Original</p>
                  <div className="relative overflow-hidden rounded-lg border border-border/50 bg-muted/30">
                    <img
                      src={originalImage}
                      alt="Imagem original"
                      className="h-auto w-full object-contain"
                      style={{ maxHeight: '500px' }}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Sem Fundo</p>
                  <div
                    className="group relative overflow-hidden rounded-lg border border-border/50"
                    style={{
                      backgroundImage: 'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, transparent 0% 50%)',
                      backgroundSize: '20px 20px',
                      minHeight: '200px',
                    }}
                  >
                    {isProcessing ? (
                      <div className="flex h-80 items-center justify-center">
                        <div className="text-center">
                          <RefreshCw className="mx-auto h-8 w-8 animate-spin text-primary" />
                          <p className="mt-3 text-sm text-muted-foreground">
                            Removendo fundo com IA...
                          </p>
                        </div>
                      </div>
                    ) : resultImage ? (
                      <div className="relative">
                        <motion.img
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          src={resultImage}
                          alt="Sem fundo"
                          className="h-auto w-full object-contain"
                          style={{ maxHeight: '500px' }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button onClick={handleDownload} variant="secondary">
                            <Download className="mr-2 h-4 w-4" />
                            Baixar
                          </Button>
                          <Button onClick={handleSaveResult} variant="secondary" disabled={isSaving}>
                            {isSaving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-80 items-center justify-center">
                        <Button
                          onClick={handleRemoveBackground}
                          disabled={isProcessing}
                          className="gradient-primary"
                          size="lg"
                        >
                          <Eraser className="mr-2 h-4 w-4" />
                          Remover Fundo
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
