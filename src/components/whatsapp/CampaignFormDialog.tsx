import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2, Plus, Eye, Sparkles, Clock, RotateCcw, CalendarIcon,
  Image, Video, FileText, Music, X, Tag, Pencil, Smartphone,
} from 'lucide-react';

export interface CampaignFormData {
  name: string;
  prompt_base: string;
  message_template: string;
  list_ids: string[];
  min_delay_seconds: number;
  max_delay_seconds: number;
  rotation_messages_per_instance: number;
  scheduled_at: string | null;
  instance_id: string | null;
  media_url: string;
  media_type: string;
  tags: string[];
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

export function CampaignFormDialog({
  open, onOpenChange, onSubmit, onGeneratePreview,
  contactLists, instances, saving, aiLoading, editingCampaign,
}: CampaignFormDialogProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState('');
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(15);
  const [rotation, setRotation] = useState(10);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState('08:00');
  const [instanceId, setInstanceId] = useState<string>('auto');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const isEditing = !!editingCampaign;

  useEffect(() => {
    if (open && editingCampaign) {
      setName(editingCampaign.name);
      setPrompt(editingCampaign.prompt_base || '');
      setTemplate(editingCampaign.message_template || '');
      setSelectedLists(editingCampaign.list_ids || []);
      setDelayMin(editingCampaign.min_delay_seconds);
      setDelayMax(editingCampaign.max_delay_seconds);
      setRotation(editingCampaign.rotation_messages_per_instance);
      setInstanceId(editingCampaign.instance_id || 'auto');
      setMediaUrl(editingCampaign.media_url || '');
      setMediaType(editingCampaign.media_type || '');
      setTags(editingCampaign.tags || []);
      if (editingCampaign.scheduled_at) {
        const d = new Date(editingCampaign.scheduled_at);
        setScheduledDate(d);
        setScheduledTime(format(d, 'HH:mm'));
      } else {
        setScheduledDate(undefined);
        setScheduledTime('08:00');
      }
    } else if (open && !editingCampaign) {
      resetForm();
    }
  }, [open, editingCampaign]);

  const resetForm = () => {
    setName(''); setPrompt(''); setTemplate('');
    setSelectedLists([]); setDelayMin(5); setDelayMax(15);
    setRotation(10); setScheduledDate(undefined); setScheduledTime('08:00');
    setInstanceId('auto'); setMediaUrl(''); setMediaType('');
    setTags([]); setTagInput('');
  };

  const handleSubmit = async () => {
    let scheduled_at: string | null = null;
    if (scheduledDate) {
      const [h, m] = scheduledTime.split(':').map(Number);
      const d = new Date(scheduledDate);
      d.setHours(h, m, 0, 0);
      scheduled_at = d.toISOString();
    }

    await onSubmit({
      name, prompt_base: prompt, message_template: template,
      list_ids: selectedLists, min_delay_seconds: delayMin,
      max_delay_seconds: delayMax, rotation_messages_per_instance: rotation,
      scheduled_at, instance_id: instanceId === 'auto' ? null : instanceId,
      media_url: mediaUrl, media_type: mediaType, tags,
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

        <div className="space-y-5 py-2">
          {/* Nome */}
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Nome da Campanha *</Label>
            <Input id="campaign-name" placeholder="Ex: Black Friday 2026" value={name} onChange={e => setName(e.target.value)} maxLength={100} />
          </div>

          {/* Listas */}
          <div className="space-y-2">
            <Label>Listas de Contatos</Label>
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

          {/* Prompt IA */}
          <div className="space-y-2">
            <Label htmlFor="prompt-base" className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              Prompt Base para IA
            </Label>
            <Textarea id="prompt-base" placeholder="Descreva a intenção da mensagem..." value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} maxLength={2000} />
            <p className="text-xs text-muted-foreground">A IA gerará variações únicas para cada envio com base neste prompt.</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onGeneratePreview(prompt)} disabled={aiLoading || !prompt.trim()}>
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Pré-visualizar Variações
            </Button>
          </div>

          {/* Template fixo */}
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

          {/* Agendamento */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              Agendamento (opcional)
            </Label>
            <div className="flex items-center gap-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-[200px] justify-start text-left font-normal", !scheduledDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {scheduledDate ? format(scheduledDate, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecionar data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={scheduledDate} onSelect={setScheduledDate} disabled={d => d < new Date()} initialFocus className={cn("p-3 pointer-events-auto")} />
                </PopoverContent>
              </Popover>
              <Input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className="w-28" />
              {scheduledDate && (
                <Button variant="ghost" size="icon" onClick={() => setScheduledDate(undefined)} title="Remover agendamento">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Delay */}
          <div className="space-y-3">
            <Label className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Delay entre mensagens
            </Label>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Mínimo: {delayMin}s</span>
                <Slider value={[delayMin]} onValueChange={([v]) => { setDelayMin(v); if (v > delayMax) setDelayMax(v); }} min={1} max={120} step={1} />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Máximo: {delayMax}s</span>
                <Slider value={[delayMax]} onValueChange={([v]) => { setDelayMax(v); if (v < delayMin) setDelayMin(v); }} min={1} max={120} step={1} />
              </div>
            </div>
          </div>

          {/* Rodízio */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <RotateCcw className="h-4 w-4 text-muted-foreground" />
              Rodízio de Instâncias
            </Label>
            <div className="flex items-center gap-3">
              <Input type="number" min={1} max={500} value={rotation} onChange={e => setRotation(Math.max(1, parseInt(e.target.value) || 1))} className="w-24" />
              <span className="text-sm text-muted-foreground">mensagens por instância antes de trocar</span>
            </div>
          </div>

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
