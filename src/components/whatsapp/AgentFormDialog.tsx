import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Brain, Settings2, Clock, Shield } from 'lucide-react';

interface Instance {
  id: string;
  friendly_name: string;
  instance_name: string;
  is_active: boolean;
  provider: string;
}

interface AIAgent {
  id: string;
  name: string;
  system_prompt: string;
  is_active: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
  reply_delay_ms: number;
  business_hours_only: boolean;
  business_hours_start: string;
  business_hours_end: string;
  blocked_categories: string[];
  total_replies: number;
  instance_id: string | null;
  instance_ids: string[];
  created_at: string;
}

interface AgentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AIAgent | null;
  instances: Instance[];
  onSaved: () => void;
}

const DEFAULT_PROMPT = `Você é um atendente humanizado que conversa pelo WhatsApp como uma pessoa real. Seu objetivo é:

1. Acolher o cliente com naturalidade — como um amigo que trabalha na empresa
2. Entender o que ele precisa sem interrogatório
3. Apresentar soluções de forma conversacional, não como um catálogo
4. Qualificar o lead naturalmente durante a conversa
5. Guiar para o próximo passo sem pressão

Personalidade:
- Simpático mas profissional, como um vendedor top de loja
- Usa linguagem do dia a dia, nada corporativo demais
- Sabe ouvir e responde no ritmo do cliente
- Tem senso de humor leve quando cabe
- Fala como gente, não como manual

Comportamento:
- Frases curtas, como mensagens reais de WhatsApp
- Nunca manda textão — divide em blocos se precisar
- Não repete a mesma abertura em mensagens consecutivas
- Adapta o tom conforme o cliente (formal/informal)
- Se não sabe algo, é honesto e diz que vai verificar
- Usa emojis com parcimônia (1-2 por mensagem no máximo)

Informações do produto/serviço:
[EDITE AQUI COM AS INFORMAÇÕES DO SEU NEGÓCIO]`;

const MODEL_OPTIONS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (Rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Balanceado)' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini (Balanceado)' },
  { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano (Econômico)' },
];

export function AgentFormDialog({ open, onOpenChange, agent, instances, onSaved }: AgentFormDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('Agente IA');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isActive, setIsActive] = useState(false);
  const [model, setModel] = useState('google/gemini-3-flash-preview');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [replyDelay, setReplyDelay] = useState(3000);
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false);
  const [businessStart, setBusinessStart] = useState('08:00');
  const [businessEnd, setBusinessEnd] = useState('18:00');
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<string[]>([]);
  const [blockedCategories, setBlockedCategories] = useState<string[]>(['opt-out', 'spam']);

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setPrompt(agent.system_prompt);
      setIsActive(agent.is_active);
      setModel(agent.model);
      setTemperature(Number(agent.temperature));
      setMaxTokens(agent.max_tokens);
      setReplyDelay(agent.reply_delay_ms);
      setBusinessHoursOnly(agent.business_hours_only);
      setBusinessStart(agent.business_hours_start?.slice(0, 5) || '08:00');
      setBusinessEnd(agent.business_hours_end?.slice(0, 5) || '18:00');
      setSelectedInstanceIds(agent.instance_ids?.length ? agent.instance_ids : (agent.instance_id ? [agent.instance_id] : []));
      setBlockedCategories(agent.blocked_categories || ['opt-out', 'spam']);
    } else {
      setName('Agente IA');
      setPrompt(DEFAULT_PROMPT);
      setIsActive(false);
      setModel('google/gemini-3-flash-preview');
      setTemperature(0.7);
      setMaxTokens(500);
      setReplyDelay(3000);
      setBusinessHoursOnly(false);
      setBusinessStart('08:00');
      setBusinessEnd('18:00');
      setSelectedInstanceIds([]);
      setBlockedCategories(['opt-out', 'spam']);
    }
  }, [agent, open]);

  const toggleInstance = (id: string) => {
    setSelectedInstanceIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleCategory = (cat: string) => {
    setBlockedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const payload = {
      user_id: user.id,
      name: name.trim() || 'Agente IA',
      system_prompt: prompt,
      is_active: isActive,
      model,
      temperature,
      max_tokens: maxTokens,
      reply_delay_ms: replyDelay,
      business_hours_only: businessHoursOnly,
      business_hours_start: businessStart,
      business_hours_end: businessEnd,
      instance_id: selectedInstanceIds.length === 1 ? selectedInstanceIds[0] : null,
      instance_ids: selectedInstanceIds,
      blocked_categories: blockedCategories,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (agent?.id) {
      ({ error } = await (supabase as any).from('wa_ai_agents').update(payload).eq('id', agent.id));
    } else {
      ({ error } = await (supabase as any).from('wa_ai_agents').insert(payload));
    }

    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: agent?.id ? 'Agente atualizado!' : 'Agente criado! 🤖' });
      onSaved();
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {agent ? 'Editar Agente' : 'Novo Agente IA'}
          </DialogTitle>
          <DialogDescription>Configure como o agente responde e quais números ele atende</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="space-y-6 py-2">
            {/* Name & Active */}
            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label>Nome do agente</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Agente de Vendas" />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <Label className="text-sm">{isActive ? 'Ativo' : 'Inativo'}</Label>
              </div>
            </div>

            {/* Instance multi-select */}
            <div className="space-y-2">
              <Label>Números WhatsApp atribuídos</Label>
              <p className="text-xs text-muted-foreground">
                Selecione quais números este agente deve atender. Sem seleção = todas as instâncias.
              </p>
              {instances.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nenhuma instância conectada</p>
              ) : (
                <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                  {instances.map(inst => (
                    <div key={inst.id} className="flex items-center gap-3">
                      <Checkbox
                        checked={selectedInstanceIds.includes(inst.id)}
                        onCheckedChange={() => toggleInstance(inst.id)}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">{inst.friendly_name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({inst.provider})</span>
                      </div>
                      <Badge variant={inst.is_active ? 'default' : 'secondary'} className="text-xs">
                        {inst.is_active ? 'Online' : 'Offline'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="space-y-2">
              <Label>System Prompt</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Descreva como o agente deve se comportar..."
                className="min-h-[200px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Inclua informações do seu produto, preços, políticas e tom de voz.
              </p>
            </div>

            {/* Model & Settings */}
            <div className="space-y-4">
              <Label className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> Configurações do Modelo</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Modelo de IA</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODEL_OPTIONS.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Max tokens: {maxTokens}</Label>
                  <Input type="number" value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} min={50} max={2000} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Criatividade: {temperature.toFixed(1)}</Label>
                <Slider value={[temperature]} onValueChange={([v]) => setTemperature(v)} min={0} max={1} step={0.1} />
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Delay antes de responder: {(replyDelay / 1000).toFixed(1)}s</Label>
                <Slider value={[replyDelay]} onValueChange={([v]) => setReplyDelay(v)} min={1000} max={15000} step={500} />
              </div>
            </div>

            {/* Business Hours */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2"><Clock className="h-4 w-4" /> Horário comercial</Label>
                <Switch checked={businessHoursOnly} onCheckedChange={setBusinessHoursOnly} />
              </div>
              {businessHoursOnly && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Início</Label>
                    <Input type="time" value={businessStart} onChange={e => setBusinessStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fim</Label>
                    <Input type="time" value={businessEnd} onChange={e => setBusinessEnd(e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {/* Blocked categories */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Shield className="h-4 w-4" /> Categorias bloqueadas</Label>
              <div className="flex flex-wrap gap-2">
                {['opt-out', 'spam', 'negative'].map(cat => (
                  <Badge
                    key={cat}
                    variant={blockedCategories.includes(cat) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleCategory(cat)}
                  >
                    {cat === 'opt-out' ? '🚫 Opt-out' : cat === 'spam' ? '🗑️ Spam' : '👎 Negativo'}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {agent ? 'Salvar' : 'Criar Agente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
