import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, AlertTriangle, Wand2, Clock, RotateCcw, ImagePlus, Video, X, Upload } from 'lucide-react';

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
}

interface WAInstance {
  id: string;
  friendly_name: string;
  phone_number: string | null;
  is_active: boolean;
  health_score: number;
  provider: string;
}

interface NewCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  lists: ContactList[];
  instances: WAInstance[];
  onCreated: () => void;
}

export function NewCampaignDialog({ open, onOpenChange, userId, lists, instances, onCreated }: NewCampaignDialogProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [messageTemplate, setMessageTemplate] = useState('');
  const [promptBase, setPromptBase] = useState('');
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [minDelay, setMinDelay] = useState(5);
  const [maxDelay, setMaxDelay] = useState(15);
  const [variationLevel, setVariationLevel] = useState('medium');
  const [useAI, setUseAI] = useState(true);
  const [rotationLimit, setRotationLimit] = useState(10);

  // Media state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const totalContacts = lists
    .filter(l => selectedLists.includes(l.id))
    .reduce((sum, l) => sum + l.contact_count, 0);

  const handleMediaSelect = (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      toast({ title: 'Formato inválido', description: 'Envie uma imagem (PNG, JPG, WebP) ou vídeo (MP4, MOV)', variant: 'destructive' });
      return;
    }
    const maxSize = isVideo ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ title: 'Arquivo muito grande', description: `Máximo ${isVideo ? '16' : '5'}MB`, variant: 'destructive' });
      return;
    }
    setMediaFile(file);
    setMediaType(isImage ? 'image' : 'video');
    setMediaPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
    setMediaType(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadMedia = async (): Promise<string | null> => {
    if (!mediaFile) return null;
    setIsUploadingMedia(true);
    try {
      const ext = mediaFile.name.split('.').pop() || 'bin';
      const path = `campaign-media/${userId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('creatives').upload(path, mediaFile, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('creatives').getPublicUrl(path);
      return publicUrl;
    } catch (err: any) {
      toast({ title: 'Erro no upload', description: err.message, variant: 'destructive' });
      return null;
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !messageTemplate.trim() || selectedLists.length === 0) return;
    setIsSaving(true);

    try {
      // Upload media first if present
      let uploadedMediaUrl: string | null = null;
      if (mediaFile) {
        uploadedMediaUrl = await uploadMedia();
        if (!uploadedMediaUrl && mediaFile) {
          setIsSaving(false);
          return; // Upload failed, abort
        }
      }

      const { error } = await supabase.from('wa_campaigns').insert({
        user_id: userId,
        instance_id: selectedInstance || null,
        name: name.trim(),
        message_template: messageTemplate.trim(),
        prompt_base: useAI ? (promptBase.trim() || messageTemplate.trim()) : null,
        listas_alvo: selectedLists,
        list_ids: selectedLists,
        total_contacts: totalContacts,
        min_delay_seconds: minDelay,
        max_delay_seconds: maxDelay,
        variation_level: variationLevel,
        rotation_messages_per_instance: rotationLimit,
        regras_delay: { min: minDelay, max: maxDelay },
        regras_rodizio: { mensagens_por_instancia: rotationLimit },
        media_url: uploadedMediaUrl,
        media_type: mediaType,
        status: 'draft',
      });

      if (error) throw error;

      toast({ title: '✅ Campanha criada com sucesso!' });
      resetForm();
      onCreated();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setName('');
    setMessageTemplate('');
    setPromptBase('');
    setSelectedLists([]);
    setSelectedInstance('');
    setMinDelay(5);
    setMaxDelay(15);
    setVariationLevel('medium');
    setUseAI(true);
    setRotationLimit(10);
    removeMedia();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Nova Campanha de Disparo
          </DialogTitle>
          <DialogDescription>
            Configure mensagem, listas e comportamento do disparo
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto max-h-[60vh] pr-2">
          {/* Name */}
          <div className="space-y-2">
            <Label className="font-semibold">Nome da campanha</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Prospecção Março 2026"
              maxLength={100}
            />
          </div>

          {/* Message */}
          <div className="space-y-2">
            <Label className="font-semibold">Mensagem base</Label>
            <Textarea
              value={messageTemplate}
              onChange={e => setMessageTemplate(e.target.value)}
              placeholder="Olá {{nome}}! Temos uma oportunidade especial..."
              rows={4}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground">
              Use {'{{nome}}'} para personalizar. Máx 1000 caracteres.
            </p>
          </div>

          {/* Media Upload */}
          <div className="space-y-2">
            <Label className="font-semibold flex items-center gap-2">
              <ImagePlus className="h-4 w-4" />
              Mídia (opcional)
            </Label>
            {mediaPreview ? (
              <div className="relative rounded-lg border border-border overflow-hidden bg-muted/30">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full bg-background/80 hover:bg-destructive hover:text-destructive-foreground"
                  onClick={removeMedia}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </Button>
                {mediaType === 'image' ? (
                  <img src={mediaPreview} alt="Preview" className="max-h-40 w-full object-contain" />
                ) : (
                  <video src={mediaPreview} className="max-h-40 w-full object-contain" controls />
                )}
                <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground border-t border-border">
                  {mediaType === 'image' ? <ImagePlus className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
                  <span className="truncate">{mediaFile?.name}</span>
                  <Badge variant="secondary" className="text-[10px] ml-auto">
                    {((mediaFile?.size || 0) / 1024 / 1024).toFixed(1)}MB
                  </Badge>
                </div>
              </div>
            ) : (
              <div
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 px-4 py-6 transition-colors hover:border-primary/50 hover:bg-muted/30"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Arraste ou clique para enviar</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Imagem (PNG, JPG, WebP até 5MB) ou Vídeo (MP4, MOV até 16MB)
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleMediaSelect(file);
              }}
            />
          </div>

          {/* AI Section */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                <Label className="font-semibold">Variação por IA</Label>
              </div>
              <Switch checked={useAI} onCheckedChange={setUseAI} />
            </div>

            {useAI && (
              <>
                <p className="text-xs text-muted-foreground">
                  A IA reescreve cada mensagem de forma única para evitar bloqueios e aumentar engajamento
                </p>
                <div className="space-y-2">
                  <Label className="text-sm">Prompt de personalização (opcional)</Label>
                  <Textarea
                    value={promptBase}
                    onChange={e => setPromptBase(e.target.value)}
                    placeholder="Ex: Foque em gerar curiosidade sobre nosso serviço de marketing digital. Tom amigável e direto."
                    rows={2}
                    maxLength={500}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Nível de variação</Label>
                  <Select value={variationLevel} onValueChange={setVariationLevel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">🔒 Baixo — Pequenas mudanças de sinônimos</SelectItem>
                      <SelectItem value="medium">⚡ Médio — Reescrita moderada (recomendado)</SelectItem>
                      <SelectItem value="high">🚀 Alto — Reescrita criativa completa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          {/* Contact Lists */}
          <div className="space-y-2">
            <Label className="font-semibold">Listas de contatos</Label>
            {lists.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3 border border-dashed border-border rounded-lg text-center">
                Nenhuma lista disponível. Importe contatos primeiro.
              </p>
            ) : (
              <div className="space-y-2 max-h-36 overflow-y-auto rounded-lg border border-border p-2">
                {lists.map(list => (
                  <label key={list.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                    <Checkbox
                      checked={selectedLists.includes(list.id)}
                      onCheckedChange={() => {
                        setSelectedLists(prev =>
                          prev.includes(list.id) ? prev.filter(l => l !== list.id) : [...prev, list.id]
                        );
                      }}
                    />
                    <span className="text-sm flex-1">{list.name}</span>
                    <Badge variant="secondary" className="text-xs">{list.contact_count}</Badge>
                  </label>
                ))}
              </div>
            )}
            {totalContacts > 0 && (
              <p className="text-xs font-medium text-primary">
                Total: {totalContacts} contatos selecionados
              </p>
            )}
          </div>

          {/* Instance selection */}
          <div className="space-y-2">
            <Label className="font-semibold flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Instância WhatsApp
            </Label>
            <Select value={selectedInstance} onValueChange={setSelectedInstance}>
              <SelectTrigger>
                <SelectValue placeholder="Auto (rodízio inteligente)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">🔄 Auto — Rodízio inteligente</SelectItem>
                {instances.map(i => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.friendly_name} {i.phone_number ? `(${i.phone_number})` : ''} 
                    <span className="text-xs ml-1">— {i.provider} • HP:{i.health_score}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {instances.length === 0 && (
              <p className="text-xs text-yellow-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Nenhuma instância ativa. Configure em Ajustes.
              </p>
            )}
          </div>

          {/* Rotation settings */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <Label className="font-semibold flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Rodízio de números
            </Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Msgs por instância antes de trocar</span>
                <span className="font-mono font-medium">{rotationLimit}</span>
              </div>
              <Slider
                value={[rotationLimit]}
                onValueChange={([v]) => setRotationLimit(v)}
                min={3}
                max={50}
                step={1}
              />
            </div>
          </div>

          {/* Delay settings */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <Label className="font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Intervalo entre mensagens: {minDelay}s - {maxDelay}s
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Mínimo</span>
                <Slider
                  value={[minDelay]}
                  onValueChange={([v]) => setMinDelay(v)}
                  min={3}
                  max={30}
                  step={1}
                />
                <span className="text-xs font-mono">{minDelay}s</span>
              </div>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Máximo</span>
                <Slider
                  value={[maxDelay]}
                  onValueChange={([v]) => setMaxDelay(Math.max(v, minDelay + 1))}
                  min={5}
                  max={120}
                  step={1}
                />
                <span className="text-xs font-mono">{maxDelay}s</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Intervalos aleatórios simulam comportamento humano e evitam bloqueios
            </p>
          </div>

          <Button
            onClick={handleCreate}
            disabled={isSaving || !name.trim() || !messageTemplate.trim() || selectedLists.length === 0}
            className="w-full"
            size="lg"
          >
            {isSaving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Criar Campanha ({totalContacts} contatos)</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
