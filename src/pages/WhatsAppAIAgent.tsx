import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Bot, Save, Loader2, MessageSquare, Clock, Shield, Sparkles, Settings2,
  ToggleLeft, Brain, Zap,
} from 'lucide-react';

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
  created_at: string;
}

interface Instance {
  id: string;
  friendly_name: string;
  instance_name: string;
  is_active: boolean;
  provider: string;
}

const DEFAULT_PROMPT = `Você é um atendente virtual inteligente e humanizado. Seu objetivo é:

1. **Acolher** o cliente com empatia e cordialidade
2. **Entender** a necessidade ou dúvida do cliente
3. **Apresentar** soluções e benefícios do nosso produto/serviço de forma natural
4. **Qualificar** o lead identificando nível de interesse e momento de compra
5. **Direcionar** para o fechamento ou próximo passo

Regras de comportamento:
- Seja sempre educado, profissional e amigável
- Use linguagem natural, como uma conversa real no WhatsApp
- Evite textos longos demais — seja objetivo mas acolhedor
- Faça perguntas abertas para entender melhor o cliente
- Nunca invente informações que você não sabe
- Se não souber responder, diga que vai verificar e retornar
- Use emojis com moderação para humanizar a conversa
- Trate cada pessoa pelo nome quando disponível
- Adapte o tom de acordo com o perfil do cliente

Informações do produto/serviço:
[EDITE AQUI COM AS INFORMAÇÕES DO SEU NEGÓCIO]

Exemplos de respostas:
- Saudação: "Olá, [nome]! 😊 Tudo bem? Vi que você se interessou pelo nosso [produto]. Como posso te ajudar?"
- Dúvida: "Ótima pergunta! O [produto] funciona assim... Quer que eu te explique mais detalhes?"
- Interesse: "Que legal que você se interessou! 🎯 Posso te enviar mais informações ou agendar uma demonstração?"`;

const MODEL_OPTIONS = [
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (Rápido)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Balanceado)' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Avançado)' },
  { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini (Balanceado)' },
  { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano (Econômico)' },
];

export default function WhatsAppAIAgent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [agent, setAgent] = useState<AIAgent | null>(null);

  // Form state
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
  const [selectedInstance, setSelectedInstance] = useState<string>('all');
  const [blockedCategories, setBlockedCategories] = useState<string[]>(['opt-out', 'spam']);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: inst }, { data: agents }] = await Promise.all([
      supabase
        .from('wa_instances')
        .select('id, friendly_name, instance_name, is_active, provider')
        .eq('user_id', user.id),
      (supabase as any)
        .from('wa_ai_agents')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    setInstances((inst as Instance[]) || []);

    if (agents && agents.length > 0) {
      const a = agents[0] as unknown as AIAgent;
      setAgent(a);
      setName(a.name);
      setPrompt(a.system_prompt);
      setIsActive(a.is_active);
      setModel(a.model);
      setTemperature(Number(a.temperature));
      setMaxTokens(a.max_tokens);
      setReplyDelay(a.reply_delay_ms);
      setBusinessHoursOnly(a.business_hours_only);
      setBusinessStart(a.business_hours_start || '08:00');
      setBusinessEnd(a.business_hours_end || '18:00');
      setSelectedInstance(a.instance_id || 'all');
      setBlockedCategories(a.blocked_categories || ['opt-out', 'spam']);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      instance_id: selectedInstance === 'all' ? null : selectedInstance,
      blocked_categories: blockedCategories,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (agent?.id) {
      ({ error } = await (supabase as any)
        .from('wa_ai_agents')
        .update(payload)
        .eq('id', agent.id));
    } else {
      ({ error } = await (supabase as any)
        .from('wa_ai_agents')
        .insert(payload));
    }

    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: isActive ? 'Agente IA ativado! 🤖' : 'Configurações salvas!' });
      fetchData();
    }
    setSaving(false);
  };

  const toggleCategory = (cat: string) => {
    setBlockedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Bot className="h-7 w-7 text-primary" />
              Agente IA WhatsApp
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Configure um assistente de IA para responder automaticamente seus leads no WhatsApp
            </p>
          </div>
          <div className="flex items-center gap-3">
            {agent && (
              <Badge variant="secondary" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                {agent.total_replies} respostas enviadas
              </Badge>
            )}
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </div>

        {/* Activation Card */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-full ${isActive ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'}`}>
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">
                  {isActive ? 'Agente IA está ativo' : 'Agente IA está desativado'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isActive
                    ? 'Respondendo automaticamente todas as mensagens recebidas'
                    : 'Ative para começar a responder automaticamente'}
                </p>
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </CardContent>
        </Card>

        {/* Prompt */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Prompt do Agente
            </CardTitle>
            <CardDescription>
              Defina como o agente deve se comportar, quais informações fornecer e como atender seus clientes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome do agente</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Assistente de Vendas" />
            </div>
            <div className="space-y-2">
              <Label>System Prompt</Label>
              <Textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Descreva como o agente deve se comportar..."
                className="min-h-[300px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Dica: Inclua informações sobre seu produto, preços, políticas e tom de voz desejado.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Model & Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Configurações do Modelo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Modelo de IA</Label>
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
                <Label>Instância WhatsApp</Label>
                <Select value={selectedInstance} onValueChange={setSelectedInstance}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as instâncias</SelectItem>
                    {instances.map(inst => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.friendly_name} ({inst.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Criatividade (Temperatura): {temperature.toFixed(1)}</Label>
              </div>
              <Slider
                value={[temperature]}
                onValueChange={([v]) => setTemperature(v)}
                min={0}
                max={1}
                step={0.1}
              />
              <p className="text-xs text-muted-foreground">
                Menor = respostas mais previsíveis e consistentes. Maior = mais criativas e variadas.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Máximo de tokens por resposta</Label>
                <Input
                  type="number"
                  value={maxTokens}
                  onChange={e => setMaxTokens(Number(e.target.value))}
                  min={50}
                  max={2000}
                />
              </div>
              <div className="space-y-2">
                <Label>Delay antes de responder (ms)</Label>
                <Input
                  type="number"
                  value={replyDelay}
                  onChange={e => setReplyDelay(Number(e.target.value))}
                  min={1000}
                  max={30000}
                  step={500}
                />
                <p className="text-xs text-muted-foreground">
                  Simula tempo de digitação ({(replyDelay / 1000).toFixed(1)}s)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business Hours & Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Horário e Filtros
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <Label>Responder apenas em horário comercial</Label>
                <p className="text-sm text-muted-foreground">
                  Fora do horário, as mensagens serão ignoradas pelo agente
                </p>
              </div>
              <Switch checked={businessHoursOnly} onCheckedChange={setBusinessHoursOnly} />
            </div>

            {businessHoursOnly && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Início</Label>
                  <Input type="time" value={businessStart} onChange={e => setBusinessStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fim</Label>
                  <Input type="time" value={businessEnd} onChange={e => setBusinessEnd(e.target.value)} />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Categorias bloqueadas (não responder)
              </Label>
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
              <p className="text-xs text-muted-foreground">
                Mensagens classificadas nessas categorias não receberão resposta automática
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Como funciona
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <h4 className="font-medium text-sm">1. Mensagem recebida</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Cliente envia mensagem para seu WhatsApp
                </p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <Brain className="h-8 w-8 mx-auto mb-2 text-primary" />
                <h4 className="font-medium text-sm">2. IA processa</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Analisa contexto, histórico e gera resposta humanizada
                </p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/50">
                <Zap className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
                <h4 className="font-medium text-sm">3. Resposta automática</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Envia resposta natural pelo WhatsApp em segundos
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
