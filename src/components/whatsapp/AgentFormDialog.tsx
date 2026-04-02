import { useState, useEffect, useRef } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Brain, Settings2, Clock, Shield, Building2, Webhook, UserCheck, Target, QrCode, CheckCircle, Trash2 } from 'lucide-react';

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
  agent_type?: string;
  company_name?: string;
  services?: string;
  address?: string;
  human_whatsapp?: string;
  n8n_webhook_url?: string;
  sdr_goal?: string;
  qualification_questions?: string[];
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
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (Premium)' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (Rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Balanceado)' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini (Balanceado)' },
  { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano (Econômico)' },
];

const AGENT_TYPES = [
  { value: 'generic', label: '🤖 Genérico' },
  { value: 'sdr', label: '📞 SDR (Pré-vendas)' },
  { value: 'support', label: '🛠️ Suporte' },
  { value: 'sales', label: '💰 Vendas' },
];

export function AgentFormDialog({ open, onOpenChange, agent, instances, onSaved }: AgentFormDialogProps) {
  useEffect(() => {
    if (open) {
      console.info("!!! HUMANIZEIA UAZAPI DEBUG V4.1 ACTIVE !!!");
    }
  }, [open]);
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [name, setName] = useState('Agente IA');
  const [agentType, setAgentType] = useState('generic');
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

  // SDR fields
  const [companyName, setCompanyName] = useState('');
  const [services, setServices] = useState('');
  const [address, setAddress] = useState('');
  const [humanWhatsapp, setHumanWhatsapp] = useState('');
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState('');
  const [sdrGoal, setSdrGoal] = useState('');
  const [qualificationStr, setQualificationStr] = useState('');

  // QR Code states
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isInstanceConnected, setIsInstanceConnected] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const generateSlug = (nameStr: string) =>
    nameStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const startPolling = () => {
    stopPolling();
    console.log('[polling] Início do rastreamento de QR Code...');
    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-evolution-qrcode', {
          body: { user_id: user!.id },
        });
        if (error) {
          console.error('[polling] Erro na Edge Function:', error);
          return;
        }
        
        console.log('[polling] Resposta do QR Code:', { 
          hasQr: !!data?.qr_code, 
          connected: data?.connected,
          qrLength: data?.qr_code?.length 
        });

        if (data?.connected) {
          stopPolling();
          setIsInstanceConnected(true);
          setQrCode(null);
          
          // Auto link the instance
          const { data: latestInst } = await supabase.from('wa_instances')
             .select('id')
             .eq('user_id', user!.id)
             .order('created_at', { ascending: false })
             .limit(1)
             .single();
          
          if (latestInst) {
             setSelectedInstanceIds(prev => prev.includes(latestInst.id) ? prev : [...prev, latestInst.id]);
          }
          toast({ title: "WhatsApp Conectado com Sucesso!", className: "bg-green-500 text-white" });
        } else if (data?.qr_code) {
          setQrCode(data.qr_code);
        }
      } catch (err) {
        console.error('[polling] Erro fatal no catch:', err);
      }
    }, 5000);
  };

  const handleGenerateQr = async () => {
    if (!name.trim()) { toast({ title: "Preencha o nome do agente primeiro", variant: "destructive" }); return; }
    setIsGeneratingQr(true);
    setQrCode(null); // Reset
    const slug = generateSlug(name) || `agente-${Date.now()}`;
    console.log('[QR] Gerando instância:', slug);
    try {
      const { data, error } = await supabase.functions.invoke('create-evolution-instance', {
        body: {
          provider: 'evolution',
          instance_name: slug,
          friendly_name: `WhatsApp - ${name}`,
          user_id: user!.id,
        },
      });
      if (error) throw error;
      
      console.log('[QR] Resposta Create:', data);
      
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar instância');
      
      if (data.qr_code) {
        setQrCode(data.qr_code);
      }
      
      startPolling();
    } catch (err: any) {
      console.error('[QR] Erro na criação:', err);
      toast({ title: 'Erro ao gerar QR Code', description: err.message, variant: 'destructive' });
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleDeleteInstance = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Deseja realmente excluir esta instância de WhatsApp?')) return;

    setDeletingId(id);
    try {
      const { data, error } = await supabase.functions.invoke('delete-evolution-instance', {
        body: { instance_id: id, user_id: user?.id }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao excluir');
      
      toast({ title: "Instância excluída com sucesso" });
      onSaved(); // Refresh lists
    } catch (err: any) {
      toast({ title: "Falha ao excluir", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setAgentType(agent.agent_type || 'generic');
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
      setCompanyName(agent.company_name || '');
      setServices(agent.services || '');
      setAddress(agent.address || '');
      setHumanWhatsapp(agent.human_whatsapp || '');
      setN8nWebhookUrl(agent.n8n_webhook_url || '');
      setSdrGoal(agent.sdr_goal || '');
      setQualificationStr((agent.qualification_questions || []).join('\n'));
    } else {
      setName('Agente IA');
      setAgentType('generic');
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
      setCompanyName('');
      setServices('');
      setAddress('');
      setHumanWhatsapp('');
      setN8nWebhookUrl('');
      setSdrGoal('');
      setQualificationStr('');
      setQrCode(null);
      setIsInstanceConnected(false);
      stopPolling();
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

  const buildPayload = () => ({
    user_id: user!.id,
    name: name.trim() || 'Agente IA',
    agent_type: agentType,
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
    company_name: companyName,
    services,
    address,
    human_whatsapp: humanWhatsapp,
    n8n_webhook_url: n8nWebhookUrl,
    sdr_goal: sdrGoal,
    qualification_questions: qualificationStr.split('\n').map(q => q.trim()).filter(Boolean),
    updated_at: new Date().toISOString(),
  });

  const syncToN8n = async (payload: Record<string, unknown>) => {
    if (!n8nWebhookUrl.trim()) return;

    setSyncing(true);
    try {
      const instanceNames = selectedInstanceIds
        .map(id => instances.find(i => i.id === id)?.friendly_name || id)
        .join(', ');

      const syncData = {
        agent_name: payload.name,
        agent_type: payload.agent_type,
        company_name: payload.company_name,
        services: payload.services,
        address: payload.address,
        human_whatsapp: payload.human_whatsapp,
        system_prompt: payload.system_prompt,
        model: payload.model,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens,
        is_active: payload.is_active,
        business_hours_only: payload.business_hours_only,
        business_hours_start: payload.business_hours_start,
        business_hours_end: payload.business_hours_end,
        instance_ids: payload.instance_ids,
        instance_names: instanceNames,
      };

      const resp = await fetch(n8nWebhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syncData),
      });

      if (!resp.ok) {
        console.warn('n8n sync returned non-ok status:', resp.status);
        toast({ title: '⚠️ Sync n8n', description: `Webhook retornou status ${resp.status}`, variant: 'destructive' });
      } else {
        toast({ title: '✅ Sincronizado com n8n' });
      }
    } catch (err) {
      console.error('n8n sync error:', err);
      toast({ title: '⚠️ Erro ao sincronizar com n8n', description: 'Verifique a URL do webhook', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const payload = buildPayload();

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
      // Sync to n8n after successful save
      await syncToN8n(payload);
      onSaved();
    }
    setSaving(false);
  };

  const isSdr = agentType === 'sdr';

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
          <Tabs defaultValue="general" className="space-y-4">
            <TabsList className="w-full">
              <TabsTrigger value="general" className="flex-1 gap-1.5">
                <Brain className="h-3.5 w-3.5" /> Geral
              </TabsTrigger>
              <TabsTrigger value="business" className="flex-1 gap-1.5 hidden sm:flex">
                <Building2 className="h-3.5 w-3.5" /> Empresa
              </TabsTrigger>
              <TabsTrigger value="sdr" className="flex-1 gap-1.5">
                <Target className="h-3.5 w-3.5" /> Funil SDR
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1 gap-1.5 hidden sm:flex">
                <Settings2 className="h-3.5 w-3.5" /> Modelo
              </TabsTrigger>
              <TabsTrigger value="integrations" className="flex-1 gap-1.5">
                <Webhook className="h-3.5 w-3.5" /> n8n
              </TabsTrigger>
            </TabsList>

            {/* ── Tab: General ── */}
            <TabsContent value="general" className="space-y-6 mt-0">
              {/* Name, Type & Active */}
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

              <div className="space-y-2">
                <Label>Tipo do agente</Label>
                <Select value={agentType} onValueChange={setAgentType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* WhatsApp Connection */}
              <div className="space-y-4 border rounded-lg p-4 bg-muted/10">
                <Label className="text-sm font-semibold">Conexão WhatsApp</Label>
                <p className="text-xs text-muted-foreground">
                  Conecte um número exclusivo gerando um QR Code, ou selecione um já conectado.
                </p>

                {isInstanceConnected ? (
                  <div className="flex flex-col items-center justify-center p-4 border rounded-lg bg-green-500/10 border-green-500/20">
                    <CheckCircle className="w-8 h-8 text-green-500 mb-2" />
                    <span className="font-medium text-sm text-green-600">WhatsApp Conectado e Ativo!</span>
                    <span className="text-xs text-green-600/80">O número foi vinculado a este agente. Lembre-se de salvar.</span>
                  </div>
                ) : qrCode ? (
                  <div className="flex flex-col items-center gap-4 p-4 border rounded-lg bg-white">
                    <img
                      src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                      className="w-48 h-48 rounded shadow-sm"
                      alt="QR Code"
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" /> Aguardando leitura no celular...
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <Button 
                      type="button"
                      onClick={handleGenerateQr} 
                      disabled={isGeneratingQr || !name.trim()} 
                      variant="outline" 
                      className="w-full border-primary/50 hover:bg-primary/5 text-primary"
                    >
                      {isGeneratingQr ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                      Gerar QR Code para o Agente
                    </Button>
                    
                    {instances.length > 0 && (
                      <div className="pt-2 border-t mt-2">
                        <Label className="text-xs mb-2 block">Ou use um número já conectado:</Label>
                        <div className="space-y-2 max-h-[120px] overflow-y-auto">
                          {instances.map(inst => (
                            <div key={inst.id} className="flex items-center gap-3 p-1 hover:bg-muted/50 rounded-md group">
                              <Checkbox
                                checked={selectedInstanceIds.includes(inst.id)}
                                onCheckedChange={() => toggleInstance(inst.id)}
                              />
                              <div className="flex-1 text-sm">{inst.friendly_name}</div>
                              <Badge variant={inst.is_active ? 'default' : 'secondary'} className="text-[10px]">
                                {inst.is_active ? 'Online' : 'Offline'}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:bg-red-50 transition-colors"
                                onClick={(e) => handleDeleteInstance(inst.id, e)}
                                disabled={deletingId === inst.id}
                              >
                                {deletingId === inst.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Trash2 className="h-3 w-3" />}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
            </TabsContent>

            {/* ── Tab: Business / SDR ── */}
            <TabsContent value="business" className="space-y-5 mt-0">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4 text-primary" />
                  Informações da Empresa
                </div>
                <p className="text-xs text-muted-foreground">
                  Essas informações são usadas pelo agente SDR e sincronizadas com o n8n.
                </p>

                <div className="space-y-2">
                  <Label>Nome da empresa</Label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Ex: LogosIA" />
                </div>

                <div className="space-y-2">
                  <Label>Lista de serviços / produtos</Label>
                  <Textarea
                    value={services}
                    onChange={e => setServices(e.target.value)}
                    placeholder="Ex: Gestão de tráfego, Automação de WhatsApp, Criação de landing pages..."
                    className="min-h-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Endereço</Label>
                  <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Ex: Rua Exemplo, 123 - São Paulo/SP" />
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4" /> WhatsApp do contato humano
                  </Label>
                  <Input value={humanWhatsapp} onChange={e => setHumanWhatsapp(e.target.value)} placeholder="Ex: 5511999999999" />
                  <p className="text-xs text-muted-foreground">
                    Número para onde o agente encaminha quando precisa de um humano.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: SDR Funnel ── */}
            <TabsContent value="sdr" className="space-y-5 mt-0">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Target className="h-4 w-4 text-primary" />
                  Qualificação do Lead (Cérebro do Agente)
                </div>
                <p className="text-xs text-muted-foreground">
                  Instrua a inteligência do agente sobre o que ele deve fazer e quais perguntas precisa fazer ao cliente para considerá-lo qualificado. Essa lógica roda 100% autônoma via IA (sem depender do n8n).
                </p>

                <div className="space-y-2 pt-2">
                  <Label>Objetivo Final (SDR Goal)</Label>
                  <Input 
                    value={sdrGoal} 
                    onChange={e => setSdrGoal(e.target.value)} 
                    placeholder="Ex: Agendar reunião, Enviar link de pagamento com o nome do cliente..." 
                  />
                  <p className="text-[10px] text-muted-foreground w-full">O objetivo que a IA deve cumprir silenciosamente na conversa.</p>
                </div>

                <div className="space-y-2 pt-2">
                  <Label>Perguntas Obrigatórias para Qualificação</Label>
                  <Textarea
                    value={qualificationStr}
                    onChange={e => setQualificationStr(e.target.value)}
                    placeholder="Ex:&#10;Qual a dor principal do cliente?&#10;Vende produto físico ou digital?&#10;Já tem CRM atualmente?"
                    className="min-h-[120px]"
                  />
                  <p className="text-[10px] text-muted-foreground">Insira uma pergunta por linha. O Agente não avançará para o fechamento até obter as respostas dessas perguntas listadas.</p>
                </div>
              </div>
            </TabsContent>

            {/* ── Tab: Model Settings ── */}
            <TabsContent value="settings" className="space-y-4 mt-0">
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
            </TabsContent>

            {/* ── Tab: n8n Integration ── */}
            <TabsContent value="integrations" className="space-y-5 mt-0">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Webhook className="h-4 w-4 text-primary" />
                  Integração n8n
                </div>
                <p className="text-xs text-muted-foreground">
                  Cole a URL do webhook do seu workflow n8n. Ao salvar o agente, todas as configurações são enviadas automaticamente para o n8n.
                </p>

                <div className="space-y-2">
                  <Label>URL do Webhook n8n</Label>
                  <Input
                    value={n8nWebhookUrl}
                    onChange={e => setN8nWebhookUrl(e.target.value)}
                    placeholder="https://seu-n8n.app/webhook/..."
                    type="url"
                  />
                </div>

                {n8nWebhookUrl.trim() && (
                  <div className="text-xs text-muted-foreground bg-background rounded p-3 space-y-1">
                    <p className="font-medium text-foreground">📤 Dados enviados ao n8n ao salvar:</p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li>Nome do agente, tipo, status</li>
                      <li>Nome da empresa, serviços, endereço</li>
                      <li>WhatsApp do contato humano</li>
                      <li>System prompt completo</li>
                      <li>Modelo, temperatura, max tokens</li>
                      <li>Horário comercial</li>
                      <li>IDs e nomes das instâncias</li>
                    </ul>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || syncing}>
            {(saving || syncing) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {syncing ? 'Sincronizando...' : agent ? 'Salvar' : 'Criar Agente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
