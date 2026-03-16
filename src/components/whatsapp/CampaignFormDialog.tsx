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
  onGeneratePreview: (prompt: string) => Promise<void>;
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
  const [includeOptoutButtons, setIncludeOptoutButtons] = useState(false);
  const [replyAutoTag, setReplyAutoTag] = useState('');
  const [replyAutoMessage, setReplyAutoMessage] = useState('');

  const isEditing = !!editingCampaign;

  useEffect(() => {
    if (open && editingCampaign) {
      setName(editingCampaign.name);
      setPrompt(editingCampaign.prompt_base || '');
      setTemplate(editingCampaign.message_template || '');
      setSelectedLists(editingCampaign.listas_alvo || []);
      setDelayMin(editingCampaign.regras_delay?.min ?? 35);
      setDelayMax(editingCampaign.regras_delay?.max ?? 89);
      setRotationMsgs(editingCampaign.regras_rodizio?.mensagens_por_instancia ?? 10);
      setRotationPause(editingCampaign.regras_rodizio?.pausa_entre_instancias ?? 300);
      setWarmupEnabled(editingCampaign.regras_aquecimento?.enabled ?? false);
      setWarmupInitial(editingCampaign.regras_aquecimento?.initial_messages ?? 20);
      setInstanceId(editingCampaign.instance_id || 'auto');
      setMediaUrl(editingCampaign.media_url || '');
      setMediaType(editingCampaign.media_type || '');
      setTags(editingCampaign.tags || []);
      setVariationLevel(editingCampaign.variation_level || 'medium');
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
    setStartDate(undefined); setStartTime('08:00');
    setEndDate(undefined); setEndTime('18:00');
    setInstanceId('auto'); setMediaUrl(''); setMediaType('');
    setTags([]); setTagInput('');
    setVariationLevel('medium');
    setIncludeOptoutButtons(false);
    setReplyAutoTag('');
    setReplyAutoMessage('');
  };

  const buildTimestamp = (date: Date | undefined, time: string): string | null => {
    if (!date) return null;
    const [h, m] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  const handleSubmit = async () => {
    await onSubmit({
      name,
      prompt_base: prompt,
      message_template: template,
      listas_alvo: selectedLists,
      regras_delay: { min: delayMin, max: delayMax },
      regras_rodizio: { mensagens_por_instancia: rotationMsgs, pausa_entre_instancias: rotationPause },
      regras_aquecimento: { enabled: warmupEnabled, initial_messages: warmupInitial },
      start_time: buildTimestamp(startDate, startTime),
      end_time: buildTimestamp(endDate, endTime),
      instance_id: instanceId === 'auto' ? null : instanceId,
      media_url: mediaUrl,
      media_type: mediaType,
      tags,
      variation_level: variationLevel,
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

            {/* Prompt IA (Claude AI) */}
            <div className="space-y-2">
              <Label htmlFor="prompt-base" className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                Prompt Base para IA (Claude AI)
              </Label>
              <Textarea
                id="prompt-base"
                placeholder="Descreva a intenção da mensagem para a IA gerar variações personalizadas..."
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
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
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onGeneratePreview(prompt)} disabled={aiLoading || !prompt.trim()}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select value={mediaType || 'none'} onValueChange={v => setMediaType(v === 'none' ? '' : v)}>
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
                {mediaType && (
                  <Input placeholder="URL da mídia" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
                )}
              </div>
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
                      <Calendar mode="single" selected={startDate} onSelect={setStartDate} disabled={d => d < new Date()} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-28" />
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
                      <Calendar mode="single" selected={endDate} onSelect={setEndDate} disabled={d => d < new Date()} initialFocus className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-28" />
                  {endDate && (
                    <Button variant="ghost" size="icon" onClick={() => setEndDate(undefined)} title="Remover data fim">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
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
                <div className="space-y-1.5">
                  <Label className="text-xs">Mensagens iniciais (ramp-up)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={warmupInitial}
                    onChange={e => setWarmupInitial(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-32"
                  />
                  <p className="text-xs text-muted-foreground">
                    A campanha começará enviando até {warmupInitial} mensagens antes de acelerar para o ritmo normal.
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground italic">
                Salvo como: {`{ "enabled": ${warmupEnabled}, "initial_messages": ${warmupInitial} }`}
              </p>
            </div>

            <Separator />

            {/* Opt-in / Opt-out Buttons */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                ✋ Botões de Opt-in / Opt-out
              </Label>
              <p className="text-xs text-muted-foreground">
                Adiciona botões interativos na primeira mensagem para novos leads, permitindo que eles optem por continuar ou parar de receber mensagens. Leads que clicarem em "Não quero mais" serão automaticamente movidos para a blacklist.
              </p>
              <div className="flex items-center gap-3">
                <Switch checked={includeOptoutButtons} onCheckedChange={setIncludeOptoutButtons} id="optout-buttons" />
                <Label htmlFor="optout-buttons" className="text-sm cursor-pointer">
                  {includeOptoutButtons ? 'Botões ativados' : 'Botões desativados'}
                </Label>
              </div>
              {includeOptoutButtons && (
                <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-xs">
                  <p className="font-medium">Prévia dos botões:</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">✅ Quero Continuar Recebendo</Badge>
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20">❌ Não Quero Mais Receber</Badge>
                  </div>
                  <p className="text-muted-foreground mt-1">
                    Contatos que clicarem em "Não quero mais" serão adicionados à blacklist e excluídos de futuros disparos.
                  </p>
                </div>
              )}
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
          <Button onClick={handleSubmit} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEditing ? 'Salvar Alterações' : 'Criar Campanha'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
