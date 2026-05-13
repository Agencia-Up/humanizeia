import { useState, useRef, useCallback, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { SUPABASE_PUBLIC_KEY, supabase } from '@/integrations/supabase/client';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Maximize2,
  Download,
  Save,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ImagePlus,
} from 'lucide-react';

interface SavedCreative {
  id: string;
  file_url: string;
  name: string;
}

const EDIT_IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/edit-image`;

const aspectRatios = [
  { value: '1:1', label: '1:1 Quadrado', width: 1080, height: 1080 },
  { value: '4:5', label: '4:5 Feed', width: 1080, height: 1350 },
  { value: '5:4', label: '5:4 Paisagem', width: 1350, height: 1080 },
  { value: '9:16', label: '9:16 Stories', width: 1080, height: 1920 },
  { value: '16:9', label: '16:9 Widescreen', width: 1920, height: 1080 },
  { value: '3:4', label: '3:4 Retrato', width: 1080, height: 1440 },
  { value: '4:3', label: '4:3 Landscape', width: 1440, height: 1080 },
];

export function ResizeTab() {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [originalImage, setOriginalImage] = usePersistedState<string | null>('cs-resize-original', null, 500);
  const [originalName, setOriginalName] = usePersistedState('cs-resize-name', '');
  const [selectedRatio, setSelectedRatio] = usePersistedState<string | null>('cs-resize-ratio', null);
  const [resultImage, setResultImage] = usePersistedState<string | null>('cs-resize-result', null, 500);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedImages, setSavedImages] = useState<SavedCreative[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);

  useEffect(() => {
    if (user) fetchSavedImages();
  }, [user]);

  const fetchSavedImages = async () => {
    if (!user) return;
    setLoadingSaved(true);
    try {
      const { data, error } = await supabase
        .from('creatives')
        .select('id, file_url, name')
        .eq('user_id', user.id)
        .eq('type', 'image')
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error && data) {
        setSavedImages(data);
      }
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleSelectSavedImage = useCallback((image: SavedCreative) => {
    setOriginalImage(image.file_url);
    setOriginalName(image.name);
    setResultImage(null);
    setSelectedRatio(null);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setOriginalImage(reader.result as string);
      setOriginalName(file.name.replace(/\.[^.]+$/, ''));
      setResultImage(null);
      setSelectedRatio(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleResize = async () => {
    if (!originalImage || !selectedRatio) return;

    const ratio = aspectRatios.find((r) => r.value === selectedRatio);
    if (!ratio) return;

    setIsProcessing(true);
    setResultImage(null);

    try {
      const prompt = `IMPORTANT: You MUST change the aspect ratio of this image to ${ratio.value} (${ratio.width}x${ratio.height} pixels). The original image is in a different aspect ratio. You need to EXTEND the canvas to fit the new ${ratio.value} aspect ratio and use generative fill / outpainting to create new content in the extended areas. The new content must seamlessly blend with the original image — matching colors, lighting, textures, and context. Do NOT simply return the original image unchanged. Do NOT crop. Do NOT add black bars or borders. The output MUST be in ${ratio.value} aspect ratio.`;

      const response = await fetch(EDIT_IMAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
        },
        body: JSON.stringify({ image: originalImage, prompt, model: 'google/gemini-3-pro-image-preview' }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde e tente novamente.', variant: 'destructive' });
        return;
      }
      if (response.status === 402) {
        toast({ title: 'Créditos insuficientes', description: 'Adicione créditos para continuar.', variant: 'destructive' });
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao redimensionar');

      if (data.image) {
        setResultImage(data.image);
        toast({ title: '✅ Imagem redimensionada!', description: `Convertida para ${ratio.value} com preenchimento por IA.` });
      } else {
        toast({ title: 'Erro', description: 'IA não retornou imagem. Tente novamente.', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Resize error:', err);
      toast({ title: 'Erro ao redimensionar', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `${originalName}-${selectedRatio?.replace(':', 'x')}.png`;
    link.click();
  };

  const handleSave = async () => {
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
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: 'image/png' });

      const fileName = `${user.id}/${Date.now()}-resized.png`;
      const { error: uploadError } = await supabase.storage
        .from('creatives')
        .upload(fileName, blob, { contentType: 'image/png' });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('creatives').getPublicUrl(fileName);

      const ratio = aspectRatios.find((r) => r.value === selectedRatio);
      const { error: dbError } = await supabase.from('creatives').insert({
        user_id: user.id,
        name: `Resize ${selectedRatio} - ${new Date().toLocaleDateString('pt-BR')}`,
        file_url: publicUrl,
        type: 'image' as const,
        style: 'resized',
        dimensions: ratio ? `${ratio.width}x${ratio.height}` : selectedRatio || '',
        description: `Imagem redimensionada para ${selectedRatio} com preenchimento por IA`,
        tags: ['resized', selectedRatio || ''],
      });
      if (dbError) throw dbError;

      toast({ title: '✅ Imagem salva!', description: 'Disponível na aba Imagens.' });
    } catch (err) {
      console.error('Save error:', err);
      toast({ title: 'Erro ao salvar', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* Left panel - Config */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Maximize2 className="h-5 w-5" />
            Redimensionar com IA
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A IA preenche automaticamente as áreas novas com conteúdo coerente
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Upload */}
          <div className="space-y-2">
            <Label>Imagem Original</Label>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            {originalImage ? (
              <div className="relative group rounded-lg overflow-hidden border border-border/50">
                <img src={originalImage} alt="Original" className="w-full h-auto max-h-48 object-contain bg-muted/30" />
                <Button
                  size="sm"
                  variant="secondary"
                  className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Trocar
                </Button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border-2 border-dashed border-border/50 p-8 text-center hover:border-primary/50 transition-colors"
              >
               <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Clique para fazer upload</p>
              </button>
            )}
          </div>

          {/* Saved Images */}
          {savedImages.length > 0 && (
            <div className="space-y-2">
              <Label>Ou selecione uma imagem salva</Label>
              <ScrollArea className="w-full rounded-lg border border-border/50 p-3">
                <div className="flex gap-2">
                  <AnimatePresence>
                    {savedImages.map((img) => (
                      <motion.div
                        key={img.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                      >
                        <button
                          onClick={() => handleSelectSavedImage(img)}
                          className={`flex-shrink-0 h-20 w-20 rounded-lg overflow-hidden border-2 transition-all ${
                            originalImage === img.file_url
                              ? 'border-primary ring-2 ring-primary/30'
                              : 'border-border/50 hover:border-primary/50'
                          }`}
                        >
                          <img src={img.file_url} alt={img.name} className="h-full w-full object-cover" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
          )}

          {/* Aspect Ratio Selection */}
          {originalImage && (
            <div className="space-y-2">
              <Label>Novo Aspect Ratio</Label>
              <div className="grid grid-cols-2 gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.value}
                    onClick={() => { setSelectedRatio(ratio.value); setResultImage(null); }}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left text-sm transition-all ${
                      selectedRatio === ratio.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/50 hover:border-primary/30'
                    }`}
                  >
                    <div
                      className="flex-shrink-0 rounded border border-current"
                      style={{
                        width: ratio.width > ratio.height ? 28 : 28 * (ratio.width / ratio.height),
                        height: ratio.height > ratio.width ? 28 : 28 * (ratio.height / ratio.width),
                      }}
                    />
                    <div>
                      <div className="font-medium">{ratio.value}</div>
                      <div className="text-xs text-muted-foreground">{ratio.width}x{ratio.height}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate button */}
          {originalImage && selectedRatio && (
            <Button
              className="w-full gradient-primary"
              size="lg"
              onClick={handleResize}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Redimensionando com IA...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Redimensionar com IA
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Right panel - Result */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-lg">Resultado</CardTitle>
        </CardHeader>
        <CardContent>
          {isProcessing ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                A IA está preenchendo as áreas novas da imagem...
              </div>
              <Skeleton className="aspect-square w-full rounded-lg" />
            </div>
          ) : resultImage ? (
            <div className="space-y-4">
              {/* Before / After */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Badge variant="outline">Original</Badge>
                  <img src={originalImage!} alt="Original" className="w-full rounded-lg border border-border/50 object-contain bg-muted/30" />
                </div>
                <div className="space-y-2">
                  <Badge className="bg-primary/20 text-primary border-primary/30">
                    {selectedRatio}
                  </Badge>
                  <img src={resultImage} alt="Redimensionada" className="w-full rounded-lg border border-border/50 object-contain bg-muted/30" />
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleDownload}>
                  <Download className="mr-2 h-4 w-4" />
                  Baixar
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Salvar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-80 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <ImagePlus className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 font-semibold">Nenhuma imagem redimensionada</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Faça upload de uma imagem, escolha o novo aspect ratio e a IA preencherá as áreas novas com conteúdo coerente
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
