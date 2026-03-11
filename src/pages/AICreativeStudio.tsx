import { useState } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { 
  Sparkles, 
  Download, 
  Save,
  RefreshCw, 
  ImagePlus,
  Eraser,
  Maximize2,
  Layers,
  Eye,
  Image as ImageIcon,
  X,
  Plus,
  Trash2,
  Pencil,
} from 'lucide-react';
import { SwipeFileTab } from '@/components/copywriter/SwipeFileTab';
import { SavedImagesTab } from '@/components/creative-studio/SavedImagesTab';
import { RemoveBackgroundTab } from '@/components/creative-studio/RemoveBackgroundTab';
import { ImageEditorTab } from '@/components/creative-studio/ImageEditorTab';
import { ResizeTab } from '@/components/creative-studio/ResizeTab';
import { motion, AnimatePresence } from 'framer-motion';
import { StudioHeader } from '@/components/layout/StudioHeader';

const formats = [
  { value: 'feed-1x1', label: 'Feed 1:1 (1080x1080)' },
  { value: 'feed-4x5', label: 'Feed 4:5 (1080x1350)' },
  { value: 'stories-9x16', label: 'Stories 9:16 (1080x1920)' },
  { value: 'landscape-16x9', label: 'Landscape 16:9 (1920x1080)' },
  { value: 'display-300x250', label: 'Display 300x250' },
  { value: 'display-728x90', label: 'Display 728x90' },
];

const styles = [
  { value: 'photorealistic', label: 'Fotorrealista' },
  { value: 'illustration', label: 'Ilustração' },
  { value: 'flat', label: 'Flat Design' },
  { value: '3d', label: '3D' },
  { value: 'minimal', label: 'Minimalista' },
  { value: 'neon', label: 'Neon' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'lifestyle', label: 'Lifestyle' },
];

interface GeneratedImage {
  imageUrl: string;
  description: string;
}

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-creative`;

const tabConfig = [
  { value: 'generate', label: 'Gerar', icon: ImagePlus },
  { value: 'edit', label: 'Editar', icon: Layers },
  { value: 'remove-bg', label: 'Remover Fundo', icon: Eraser },
  { value: 'resize', label: 'Redimensionar', icon: Maximize2 },
  { value: 'images', label: 'Imagens', icon: ImageIcon },
];

export default function AICreativeStudio() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = usePersistedState('cs-active-tab', 'generate');
  const [removeBgImage, setRemoveBgImage] = useState<{ url: string; name: string } | null>(null);

  const [format, setFormat] = useState('feed-1x1');
  const [style, setStyle] = useState('photorealistic');
  const [prompt, setPrompt] = useState('');
  const [headline, setHeadline] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [includeCTA, setIncludeCTA] = useState(true);
  const [colors, setColors] = useState(['#3B82F6', '#8B5CF6']);
  const [customStyle, setCustomStyle] = useState('');
  const [styleIntensity, setStyleIntensity] = useState([5]);
  const [variations, setVariations] = useState(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);


  const handleGenerate = async () => {
    if (!prompt) {
      toast({
        title: 'Campo obrigatório',
        description: 'Descreva a imagem que deseja gerar.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);
    setResults([]);
    setSelectedImage(null);

    try {
      const response = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          prompt,
          format,
          style: customStyle || style,
          headline,
          ctaText,
          includeLogo: false,
          includeCTA,
          primaryColor: colors[0] || '#3B82F6',
          secondaryColor: colors[1] || colors[0] || '#8B5CF6',
          styleIntensity: styleIntensity[0],
          variations,
        }),
      });

      if (response.status === 429) {
        toast({ title: 'Limite de requisições', description: 'Aguarde um momento e tente novamente.', variant: 'destructive' });
        return;
      }
      if (response.status === 402) {
        toast({ title: 'Créditos insuficientes', description: 'Adicione créditos para continuar gerando imagens.', variant: 'destructive' });
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao gerar imagens');
      }

      if (data.images && data.images.length > 0) {
        setResults(data.images);
        toast({
          title: '🎨 Criativos gerados!',
          description: `${data.images.length} imagem(ns) criada(s) com sucesso.`,
        });
      } else {
        toast({ title: 'Nenhuma imagem gerada', description: 'Tente novamente com outra descrição.', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Generate error:', err);
      toast({
        title: 'Erro ao gerar criativos',
        description: err instanceof Error ? err.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadImage = (image: GeneratedImage, index: number) => {
    const link = document.createElement('a');
    link.href = image.imageUrl;
    link.download = `creative-${format}-${index + 1}.png`;
    link.click();
  };

  const handleSave = async (image: GeneratedImage, index: number) => {
    if (!user) {
      toast({ title: 'Faça login para salvar', variant: 'destructive' });
      return;
    }

    setSavingIndex(index);
    try {
      const base64Data = image.imageUrl.split(',')[1];
      if (!base64Data) throw new Error('Imagem inválida');
      
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: 'image/png' });

      const fileName = `${user.id}/${Date.now()}-${index}.png`;
      const { error: uploadError } = await supabase.storage
        .from('creatives')
        .upload(fileName, blob, { contentType: 'image/png' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('creatives')
        .getPublicUrl(fileName);

      const formatDimensions: Record<string, string> = {
        'feed-1x1': '1080x1080',
        'feed-4x5': '1080x1350',
        'stories-9x16': '1080x1920',
        'landscape-16x9': '1920x1080',
        'display-300x250': '300x250',
        'display-728x90': '728x90',
      };

      const { error: dbError } = await supabase.from('creatives').insert({
        user_id: user.id,
        name: `Criativo ${format} - ${new Date().toLocaleDateString('pt-BR')}`,
        file_url: publicUrl,
        type: 'image' as const,
        style,
        dimensions: formatDimensions[format] || format,
        description: image.description || prompt,
        tags: [style, format],
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
      setSavingIndex(null);
    }
  };

  const handleSendToRemoveBg = (image: GeneratedImage) => {
    setRemoveBgImage({ url: image.imageUrl, name: `criativo-${Date.now()}` });
    setActiveTab('remove-bg');
  };

  const renderTabContent = () => (
    <>
      <TabsContent value="generate" className="mt-0 space-y-6">
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Form Column */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Configuração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Prompt — most important, comes first */}
              <div className="space-y-2">
                <Label>Descrição da Imagem</Label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Descreva a imagem que deseja criar... Ex: Produto cosmético elegante sobre fundo rosa com flores"
                  rows={3}
                />
              </div>

              {/* Format */}
              <div className="space-y-2">
                <Label>Formato</Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {formats.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Style — single input with dropdown suggestions */}
              <div className="space-y-2">
                <Label>Estilo Visual</Label>
                <div className="relative">
                  <Input
                    value={customStyle || styles.find(s => s.value === style)?.label || ''}
                    onChange={(e) => {
                      setCustomStyle(e.target.value);
                      setStyle('');
                    }}
                    placeholder="Ex: Fotorrealista, Neon, Minimalista..."
                  />
                  {!customStyle && (
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {styles.map((s) => (
                        <button
                          key={s.value}
                          onClick={() => { setStyle(s.value); setCustomStyle(''); }}
                          className={`rounded-full px-2.5 py-1 text-xs transition-colors border ${
                            style === s.value
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-muted/50 text-muted-foreground border-border/50 hover:border-primary/50 hover:text-foreground'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Style Intensity */}
              <div className="space-y-2">
                <Label>Intensidade do Estilo: {styleIntensity[0]}</Label>
                <Slider
                  value={styleIntensity}
                  onValueChange={setStyleIntensity}
                  min={1}
                  max={10}
                  step={1}
                />
              </div>

              {/* Variations */}
              <div className="space-y-2">
                <Label>Variações: {variations}</Label>
                <Slider
                  value={[variations]}
                  onValueChange={(v) => setVariations(v[0])}
                  min={1}
                  max={4}
                  step={1}
                />
              </div>

              {/* Colors — dynamic list */}
              <div className="space-y-2">
                <Label>Paleta de Cores</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {colors.map((color, i) => (
                    <div key={i} className="flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 p-1">
                      <Input
                        type="color"
                        value={color}
                        onChange={(e) => {
                          const updated = [...colors];
                          updated[i] = e.target.value;
                          setColors(updated);
                        }}
                        className="h-8 w-8 cursor-pointer rounded border-0 p-0"
                      />
                      {colors.length > 1 && (
                        <button
                          onClick={() => setColors(colors.filter((_, j) => j !== i))}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setColors([...colors, '#000000'])}
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-dashed border-border/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Headline */}
              <div className="space-y-2">
                <Label>Texto na Imagem (Headline)</Label>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Ex: Black Friday - 50% OFF"
                />
              </div>

              {/* CTA */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Incluir Botão CTA</Label>
                  <Switch checked={includeCTA} onCheckedChange={setIncludeCTA} />
                </div>
                {includeCTA && (
                  <Input
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    placeholder="Ex: Comprar Agora"
                  />
                )}
              </div>

              <Button
                className="w-full gradient-primary"
                size="lg"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Gerando com IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Gerar Criativo
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Results Column */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-lg">Resultados</CardTitle>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {isGenerating ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Gerando {variations} criativo(s) com IA... Isso pode levar alguns segundos.
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {Array.from({ length: variations }).map((_, i) => {
                        const skeletonAspect = format === 'feed-1x1' || format === 'display-300x250' ? 'aspect-square'
                          : format === 'feed-4x5' ? 'aspect-[4/5]'
                          : format === 'stories-9x16' ? 'aspect-[9/16]'
                          : format === 'landscape-16x9' || format === 'display-728x90' ? 'aspect-video'
                          : 'aspect-square';
                        return <Skeleton key={i} className={`${skeletonAspect} rounded-lg`} />;
                      })}
                    </div>
                  </div>
                ) : results.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {results.map((image, index) => (
                        <motion.div
                          key={index}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: index * 0.1 }}
                          className="group relative overflow-hidden rounded-lg border-2 cursor-pointer transition-all border-border/50 hover:border-primary/50"
                          onClick={() => setLightboxImage(image.imageUrl)}
                        >
                          <img
                            src={image.imageUrl}
                            alt={`Criativo gerado ${index + 1}`}
                            className="h-auto w-full object-contain transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button size="icon" variant="secondary" onClick={(e) => { e.stopPropagation(); handleDownloadImage(image, index); }}>
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              onClick={(e) => { e.stopPropagation(); handleSave(image, index); }}
                              disabled={savingIndex === index}
                            >
                              {savingIndex === index ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            </Button>
                            <Button size="icon" variant="secondary" onClick={(e) => { e.stopPropagation(); setLightboxImage(image.imageUrl); }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="secondary" title="Remover Fundo" onClick={(e) => { e.stopPropagation(); handleSendToRemoveBg(image); }}>
                              <Eraser className="h-4 w-4" />
                            </Button>
                          </div>
                          <Badge className="absolute left-2 top-2 bg-black/50">
                            #{index + 1}
                          </Badge>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-96 flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                      <ImagePlus className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 font-semibold">Nenhum criativo gerado ainda</h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Configure e clique em "Gerar Criativo" para criar imagens com IA
                    </p>
                  </div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="edit" className="mt-0 flex-1 flex flex-col min-h-0 overflow-hidden">
        <ImageEditorTab />
      </TabsContent>

      <TabsContent value="remove-bg" className="mt-0">
        <RemoveBackgroundTab initialImage={removeBgImage} onImageConsumed={() => setRemoveBgImage(null)} />
      </TabsContent>

      <TabsContent value="resize" className="mt-0">
        <ResizeTab />
      </TabsContent>

      <TabsContent value="images" className="mt-0">
        <SavedImagesTab />
      </TabsContent>

    </>
  );

  return (
    <MainLayout>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Unified Header with Pill Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 gap-2">
          <StudioHeader
            icon={Sparkles}
            title="Creative Studio"
            tabs={tabConfig}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {renderTabContent()}
        </Tabs>
      </div>

      {/* Fullscreen Lightbox */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setLightboxImage(null)}
          >
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-4 top-4 text-white hover:bg-white/20"
              onClick={() => setLightboxImage(null)}
            >
              <X className="h-6 w-6" />
            </Button>
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={lightboxImage}
              alt="Visualização em tela cheia"
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

    </MainLayout>
  );
}
