import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2, Plus, Eye, Sparkles, Clock, RotateCcw, CalendarIcon,
  Image, Video, FileText, Music, X, Tag, Pencil, Smartphone,
  Flame, Info, Zap, MessageSquare, Upload, Trash2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface CampaignFormData {
  name: string;
  prompt_base: string;
  message_template: string;
  listas_alvo: string[];
  regras_delay: { min: number; max: number };
  regras_rodizio: { mensagens_por_instancia: number; pausa_entre_instancias: number };
  regras_aquecimento: { enabled: boolean; initial_messages: number };
  start_time: string | null;
  end_time: string | null;
  instance_id: string | null;
  media_url: string;
  media_type: string;
  tags: string[];
  variation_level: string;
  ai_model: string;
  include_optout_buttons: boolean;
  reply_auto_tag: string;
  reply_auto_message: string;
}

interface ContactList {
  id: string;
  name: string;
  contact_count: number;
}

interface WaInstance {
  id: string;
  friendly_name: string;
  phone_number: string | null;
  status: string;
}

interface CampaignFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CampaignFormData) => Promise<void>;
  onGeneratePreview: (prompt: string, variationLevel?: string, aiModel?: string) => Promise<void>;
  contactLists: ContactList[];
  instances: WaInstance[];
  saving: boolean;
  aiLoading: boolean;
  editingCampaign?: CampaignFormData & { id: string } | null;
}

const mediaTypeOptions = [
  { value: 'image', label: 'Imagem', icon: Image },
  { value: 'video', label: 'Vídeo', icon: Video },
  { value: 'document', label: 'Documento', icon: FileText },
  { value: 'audio', label: 'Áudio', icon: Music },
];

const promptExamples = [
  'Envie uma mensagem amigável oferecendo 20% de desconto para clientes inativos há mais de 30 dias.',
  'Crie uma mensagem de boas-vindas para novos clientes que acabaram de se cadastrar.',
  'Lembre o cliente sobre o carrinho abandonado de forma gentil e personalizada.',
  'Divulgue nosso evento presencial do próximo sábado com tom entusiasmado.',
];

const MIN_SCHEDULE_WINDOW_MS = 10 * 60 * 1000;

const isGeneratedAITemplate = (value?: string | null) => /^\[IA\]\s*/i.test((value || '').trim());

export function CampaignFormDialog({
  open, onOpenChange, onSubmit, onGeneratePreview,
  contactLists, instances, saving, aiLoading, editingCampaign,
}: CampaignFormDialogProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState('');
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [delayMin, setDelayMin] = useState(35);
  const [delayMax, setDelayMax] = useState(89);
  const [rotationMsgs, setRotationMsgs] = useState(10);
  const [rotationPause, setRotationPause] = useState(300);
  const [warmupEnabled, setWarmupEnabled] = useState(false);
  const [warmupInitial, setWarmupInitial] = useState(20);
  // 28/05/2026 — keys que o backend (process-whatsapp-queue) realmente le.
  // Sem elas, o warmup nunca era aplicado mesmo com o toggle ligado.
  const [warmupDailyLimit, setWarmupDailyLimit] = useState(50);
  const [warmupRampDays, setWarmupRampDays] = useState(14);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [startTime, setStartTime] = useState('08:00');
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [endTime, setEndTime] = useState('18:00');
  const [instanceId, setInstanceId] = useState<string>('auto');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [variationLevel, setVariationLevel] = useState<string>('medium');
  const [aiModel, setAiModel] = useState<string>('gpt-4o');
  const [includeOptoutButtons, setIncludeOptoutButtons] = useState(false);
  const [replyAutoTag, setReplyAutoTag] = useState('');
  const [replyAutoMessage, setReplyAutoMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!editingCampaign;

  useEffect(() => {
    if (open && editingCampaign) {
      setName(editingCampaign.name);
      setPrompt(editingCampaign.prompt_base || '');
      setTemplate(
        editingCampaign.prompt_base && isGeneratedAITemplate(editingCampaign.message_template)
          ? ''
          : editingCampaign.message_template || ''
      );
      setSelectedLists(editingCampaign.listas_alvo || []);
      setDelayMin(editingCampaign.regras_delay?.min ?? 35);
      setDelayMax(editingCampaign.regras_delay?.max ?? 89);
      setRotationMsgs(editingCampaign.regras_rodizio?.mensagens_por_instancia ?? 10);
      setRotationPause(editingCampaign.regras_rodizio?.pausa_entre_instancias ?? 300);
      setWarmupEnabled(editingCampaign.regras_aquecimento?.enabled ?? false);
      setWarmupInitial(editingCampaign.regras_aquecimento?.initial_messages ?? 20);
      setWarmupDailyLimit((editingCampaign.regras_aquecimento as any)?.limite_diario_inicial ?? 50);
      setWarmupRampDays((editingCampaign.regras_aquecimento as any)?.dias_rampa ?? 14);
      setInstanceId(editingCampaign.instance_id || 'auto');
      setMediaUrl(editingCampaign.media_url || '');
      setMediaType(editingCampaign.media_type || '');
      setTags(editingCampaign.tags || []);
      setVariationLevel(editingCampaign.variation_level || 'medium');
      setAiModel(editingCampaign.ai_model || 'gpt-4o');
      setIncludeOptoutButtons(editingCampaign.include_optout_buttons ?? false);
      setReplyAutoTag(editingCampaign.reply_auto_tag || '');
      setReplyAutoMessage(editingCampaign.reply_auto_message || '');
      if (editingCampaign.start_time) {
        const d = new Date(editingCampaign.start_time);
        setStartDate(d);
        setStartTime(format(d, 'HH:mm'));
      } else {
        setStartDate(undefined);
        setStartTime('08:00');
      }
      if (editingCampaign.end_time) {
        const d = new Date(editingCampaign.end_time);
        setEndDate(d);
        setEndTime(format(d, 'HH:mm'));
      } else {
        setEndDate(undefined);
        setEndTime('18:00');
      }
    } else if (open && !editingCampaign) {
      resetForm();
    }
  }, [open, editingCampaign]);

  const resetForm = () => {
    setName(''); setPrompt(''); setTemplate('');
    setSelectedLists([]); setDelayMin(35); setDelayMax(89);
    setRotationMsgs(10); setRotationPause(300);
    setWarmupEnabled(false); setWarmupInitial(20);
    setWarmupDailyLimit(50); setWarmupRampDays(14);
    setStartDate(undefined); setStartTime('08:00');
    setEndDate(undefined); setEndTime('18:00');
    setInstanceId('auto'); setMediaUrl(''); setMediaType('');
    setTags([]); setTagInput('');
    setVariationLevel('medium');
    setAiModel('gpt-4o');
    setIncludeOptoutButtons(false);
    setReplyAutoTag('');
    setReplyAutoMessage('');
    setScheduleError('');
  };

  const buildTimestamp = (date: Date | undefined, time: string): string | null => {
    if (!date) return null;
    const [h, m] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const handleSubmit = async () => {
    if (isUploading || (mediaType && !mediaUrl)) return;
    const startTimestamp = buildTimestamp(startDate, startTime);
    const endTimestamp = buildTimestamp(endDate, endTime);
    const nextScheduleError =
      endTimestamp && !startTimestamp
        ? 'Para definir o fim da campanha, escolha tambem a data de inicio.'
        : startTimestamp && endTimestamp && new Date(endTimestamp).getTime() - new Date(startTimestamp).getTime() < MIN_SCHEDULE_WINDOW_MS
          ? 'O agendamento precisa ter pelo menos 10 minutos entre inicio e fim.'
          : '';

    if (nextScheduleError) {
      setScheduleError(nextScheduleError);
      return;
    }

    setScheduleError('');

    await onSubmit({
      name,
      prompt_base: prompt,
      message_template: template,
      listas_alvo: selectedLists,
      regras_delay: { min: delayMin, max: delayMax },
      regras_rodizio: { mensagens_por_instancia: rotationMsgs, pausa_entre_instancias: rotationPause },
      regras_aquecimento: {
        enabled: warmupEnabled,
        initial_messages: warmupInitial,
        limite_diario_inicial: warmupDailyLimit,
        dias_rampa: warmupRampDays,
      } as any,
      start_time: startTimestamp,
      end_time: endTimestamp,
      instance_id: instanceId === 'auto' ? null : instanceId,
      media_url: mediaUrl,
      media_type: mediaType,
      tags,
      variation_level: variationLevel,
      ai_model: aiModel,
      include_optout_buttons: includeOptoutButtons,
      reply_auto_tag: replyAutoTag,
      reply_auto_message: replyAutoMessage,
    });
  };

  const toggleList = (id: string) => {
    setSelectedLists(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t]);
      setTagInput('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {isEditing ? 'Editar Campanha' : 'Criar Nova Campanha'}
          </DialogTitle>
        </DialogHeader>

        <TooltipProvider>
          <div className="space-y-5 py-2">
            {/* Nome */}
            <div className="space-y-2">
              <Label htmlFor="campaign-name">Nome da Campanha *</Label>
              <Input id="campaign-name" placeholder="Ex: Black Friday 2026" value={name} onChange={e => setName(e.target.value)} maxLength={100} />
            </div>

            {/* Listas de Contatos Alvo */}
            <div className="space-y-2">
              <Label>Listas de Contatos Alvo *</Label>
              {contactLists.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma lista encontrada. Crie listas na página de Contatos.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded-md p-3">
                  {contactLists.map(list => (
                    <label key={list.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded p-1.5">
                      <Checkbox checked={selectedLists.includes(list.id)} onCheckedChange={() => toggleList(list.id)} />
                      <span className="truncate">{list.name}</span>
                      <Badge variant="secondary" className="ml-auto text-xs">{list.contact_count}</Badge>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Selecione uma ou mais listas. Os contatos destas listas receberão a campanha.</p>
            </div>

            {/* Instância WhatsApp */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                Instância WhatsApp
              </Label>
              <Select value={instanceId} onValueChange={setInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">🔄 Automático (rodízio)</SelectItem>
                  {instances.map(inst => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.friendly_name} {inst.phone_number ? `(${inst.phone_number})` : ''}
                      {inst.status !== 'connected' && ' ⚠️'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Prompt IA */}
            <div className="space-y-2">
              <Label htmlFor="prompt-base" className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                Prompt Base para IA
              </Label>
              <Textarea
                id="prompt-base"
                placeholder="Descreva a intenção da mensagem para a IA gerar variações personalizadas..."
                value={prompt}
                onChange={e => {
                  setPrompt(e.target.value);
                  if (isGeneratedAITemplate(template)) setTemplate('');
                }}
                rows={4}
                maxLength={2000}
              />
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  A IA gerará variações únicas para cada envio com base neste prompt, usando dados do contato (nome, dados_extras) para personalização.
                </p>
                <div className="bg-muted/50 rounded-md p-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3" /> Exemplos de prompts:
                  </p>
                  {promptExamples.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      className="block w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded px-2 py-1 transition-colors"
                      onClick={() => setPrompt(ex)}
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onGeneratePreview(prompt, variationLevel, aiModel)} disabled={aiLoading || !prompt.trim()}>
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Pré-visualizar Variações
              </Button>

              {/* Nível de Variação (Polimorfismo) */}
              <div className="space-y-2 mt-3">
                <Label className="text-xs font-medium">Nível de Variação da IA</Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'low', label: 'Conservador', desc: 'Pequenas variações de sinônimos' },
                    { value: 'medium', label: 'Moderado', desc: 'Reescrita balanceada' },
                    { value: 'high', label: 'Criativo', desc: 'Reescrita totalmente livre' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVariationLevel(opt.value)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs transition-all",
                        variationLevel === opt.value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/30 text-muted-foreground"
                      )}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-center leading-tight">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Inteligência da IA (modelo OpenAI) */}
              <div className="space-y-2 mt-3">
                <Label className="text-xs font-medium">Inteligência da IA (modelo OpenAI)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'gpt-4o', label: '🧠 Mais Inteligente', desc: 'Melhor qualidade de copy (GPT-4o)' },
                    { value: 'gpt-4o-mini', label: '⚡ Econômico', desc: 'Mais rápido e gasta menos tokens (GPT-4o mini)' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAiModel(opt.value)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-xs transition-all",
                        aiModel === opt.value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/30 text-muted-foreground"
                      )}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-center leading-tight">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Mensagem Fixa */}
            <div className="space-y-2">
              <Label htmlFor="message-template">Mensagem Fixa (opcional se usar IA)</Label>
              <Textarea id="message-template" placeholder="Mensagem fixa caso não queira usar variações de IA..." value={template} onChange={e => setTemplate(e.target.value)} rows={3} maxLength={4000} />
            </div>

            {/* Mídia */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Image className="h-4 w-4 text-muted-foreground" />
                Anexo de Mídia (opcional)
              </Label>
              <Select value={mediaType || 'none'} onValueChange={v => { setMediaType(v === 'none' ? '' : v); if (v === 'none') { setMediaUrl(''); } }}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo de mídia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem mídia</SelectItem>
                  {mediaTypeOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {mediaType && !mediaUrl && (
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={
                      mediaType === 'image' ? 'image/png,image/jpeg,image/webp' :
                      mediaType === 'video' ? 'video/mp4,video/quicktime' :
                      mediaType === 'audio' ? 'audio/mpeg,audio/ogg,audio/wav' :
                      mediaType === 'document' ? '.pdf,.doc,.docx,.xls,.xlsx' : '*/*'
                    }
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      const maxSize = mediaType === 'video' ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
                      if (file.size > maxSize) {
                        alert(`Arquivo muito grande. Máximo: ${mediaType === 'video' ? '16MB' : '5MB'}`);
                        return;
                      }

                      setIsUploading(true);
                      try {
                        const ext = file.name.split('.').pop() || 'bin';
                        const filePath = `campaign-media/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                        const { error: uploadError } = await supabase.storage
                          .from('creatives')
                          .upload(filePath, file, { contentType: file.type });

                        if (uploadError) throw uploadError;

                        const { data: urlData } = supabase.storage
                          .from('creatives')
                          .getPublicUrl(filePath);

                        setMediaUrl(urlData.publicUrl);
                      } catch (err: any) {
                        alert('Erro no upload: ' + (err.message || 'Tente novamente'));
                      } finally {
                        setIsUploading(false);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }
                    }}
                  />
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Enviando arquivo...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">Clique para fazer upload</p>
                      <p className="text-xs text-muted-foreground">
                        {mediaType === 'image' && 'PNG, JPG, WebP • Máx 5MB'}
                        {mediaType === 'video' && 'MP4, MOV • Máx 16MB'}
                        {mediaType === 'audio' && 'MP3, OGG, WAV • Máx 5MB'}
                        {mediaType === 'document' && 'PDF, DOC, XLS • Máx 5MB'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {mediaType && mediaUrl && (
                <div className="border border-border rounded-lg p-3 flex items-center gap-3">
                  {mediaType === 'image' ? (
                    <img src={mediaUrl} alt="Preview" className="h-16 w-16 object-cover rounded" />
                  ) : (
                    <div className="h-16 w-16 bg-muted rounded flex items-center justify-center">
                      {mediaType === 'video' && <Video className="h-6 w-6 text-muted-foreground" />}
                      {mediaType === 'audio' && <Music className="h-6 w-6 text-muted-foreground" />}
                      {mediaType === 'document' && <FileText className="h-6 w-6 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {mediaType === 'image' ? 'Imagem' : mediaType === 'video' ? 'Vídeo' : mediaType === 'audio' ? 'Áudio' : 'Documento'} anexado
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{mediaUrl.split('/').pop()}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => { setMediaUrl(''); setMediaType(''); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* Período da Campanha (start_time / end_time) */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                Período da Campanha (opcional)
              </Label>

              {/* Start */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Início</span>
                <div className="flex items-center gap-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-[180px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Data início'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={startDate} onSelect={(date) => { setStartDate(date); setScheduleError(''); }} disabled={d => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  <Input type="time" value={startTime} onChange={e => { setStartTime(e.target.value); setScheduleError(''); }} className="w-28" />
                  {startDate && (
                    <Button variant="ghost" size="icon" onClick={() => setStartDate(undefined)} title="Remover data início">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* End */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Fim</span>
                <div className="flex items-center gap-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-[180px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {endDate ? format(endDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Data fim'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={endDate} onSelect={(date) => { setEndDate(date); setScheduleError(''); }} disabled={d => { const today = new Date(); today.setHours(0,0,0,0); return d < today; }} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  <Input type="time" value={endTime} onChange={e => { setEndTime(e.target.value); setScheduleError(''); }} className="w-28" />
                  {endDate && (
                    <Button variant="ghost" size="icon" onClick={() => setEndDate(undefined)} title="Remover data fim">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              {scheduleError && (
                <p className="text-xs font-medium text-destructive">{scheduleError}</p>
              )}
            </div>

            <Separator />

            {/* Delays Dinâmicos (regras_delay) */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Configuração de Delays Dinâmicos
              </Label>
              <p className="text-xs text-muted-foreground">
                Intervalo aleatório entre cada mensagem enviada. Valores maiores reduzem risco de bloqueio.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Mínimo: {delayMin}s</span>
                  <Slider value={[delayMin]} onValueChange={([v]) => { setDelayMin(v); if (v > delayMax) setDelayMax(v); }} min={5} max={300} step={1} />
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">Máximo: {delayMax}s</span>
                  <Slider value={[delayMax]} onValueChange={([v]) => { setDelayMax(v); if (v < delayMin) setDelayMin(v); }} min={5} max={300} step={1} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Salvo como: {`{ "min": ${delayMin}, "max": ${delayMax} }`}
              </p>
            </div>

            {/* Rodízio de Instâncias (regras_rodizio) */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
                Configuração de Rodízio de Instâncias
              </Label>
              <p className="text-xs text-muted-foreground">
                Define quantas mensagens cada instância envia antes de trocar, e a pausa entre trocas.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Mensagens por instância</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={rotationMsgs}
                    onChange={e => setRotationMsgs(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pausa entre instâncias (s)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={3600}
                    value={rotationPause}
                    onChange={e => setRotationPause(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Salvo como: {`{ "mensagens_por_instancia": ${rotationMsgs}, "pausa_entre_instancias": ${rotationPause} }`}
              </p>
            </div>

            {/* Aquecimento (regras_aquecimento) */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-muted-foreground" />
                Configuração de Aquecimento (Opcional)
              </Label>
              <p className="text-xs text-muted-foreground">
                Inicia a campanha com um volume menor de envios e aumenta gradualmente para evitar bloqueios.
              </p>
              <div className="flex items-center gap-3">
                <Switch checked={warmupEnabled} onCheckedChange={setWarmupEnabled} id="warmup-enabled" />
                <Label htmlFor="warmup-enabled" className="text-sm cursor-pointer">
                  {warmupEnabled ? 'Aquecimento ativado' : 'Aquecimento desativado'}
                </Label>
              </div>
              {warmupEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-muted/30 rounded-lg p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mensagens iniciais</Label>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      value={warmupInitial}
                      onChange={e => setWarmupInitial(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Mensagens da primeira leva (ramp-up).
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Limite diário máximo</Label>
                    <Input
                      type="number"
                      min={10}
                      max={5000}
                      value={warmupDailyLimit}
                      onChange={e => setWarmupDailyLimit(Math.max(10, parseInt(e.target.value) || 10))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Teto de mensagens/dia por instância após rampa.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Dias até atingir o teto</Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={warmupRampDays}
                      onChange={e => setWarmupRampDays(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Dias de aceleração gradual até o limite cheio.
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground italic">
                Salvo como: {`{ "enabled": ${warmupEnabled}, "initial_messages": ${warmupInitial}, "limite_diario_inicial": ${warmupDailyLimit}, "dias_rampa": ${warmupRampDays} }`}
              </p>
            </div>

            <Separator />

            {/* Auto-Tag & Auto-Reply on Response */}
            <div className="space-y-4">
              <Label className="flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-primary" />
                Automações ao Receber Resposta
              </Label>
              <p className="text-xs text-muted-foreground">
                Configure ações automáticas quando um contato responder ao disparo desta campanha.
              </p>

              {/* Auto-Tag */}
              <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  Tag automática ao responder
                </Label>
                <Input
                  placeholder="Ex: tem interesse, respondeu campanha..."
                  value={replyAutoTag}
                  onChange={e => setReplyAutoTag(e.target.value)}
                  maxLength={50}
                />
                <p className="text-[11px] text-muted-foreground">
                  Quando o contato responder, esta tag será adicionada automaticamente ao contato.
                </p>
              </div>

              {/* Auto-Reply Message */}
              <div className="space-y-2 bg-muted/30 rounded-lg p-3">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  Mensagem automática de follow-up
                </Label>
                <Textarea
                  placeholder="Ex: Que bom que você se interessou! Vou te passar mais detalhes..."
                  value={replyAutoMessage}
                  onChange={e => setReplyAutoMessage(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
                <p className="text-[11px] text-muted-foreground">
                  Uma mensagem de continuidade será enviada automaticamente quando o contato responder ao disparo.
                </p>
              </div>
            </div>

            <Separator />

            {/* Tags */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Tag className="h-4 w-4 text-muted-foreground" />
                Tags
              </Label>
              <div className="flex items-center gap-2">
                <Input placeholder="Adicionar tag..." value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} className="flex-1" />
                <Button variant="outline" size="sm" onClick={addTag} disabled={!tagInput.trim()}>Adicionar</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tags.map(t => (
                    <Badge key={t} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setTags(prev => prev.filter(x => x !== t))}>
                      {t} <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TooltipProvider>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || isUploading || !!(mediaType && !mediaUrl)} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEditing ? 'Salvar Alterações' : 'Criar Campanha'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
