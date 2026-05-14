import { useState, useEffect, useRef, useMemo } from 'react';
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
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Brain, Settings2, Clock, Shield, Building2, Webhook, UserCheck, Target, QrCode, CheckCircle, Trash2, RefreshCw, BookOpen } from 'lucide-react';
import { KnowledgeBaseManager } from '@/components/whatsapp/KnowledgeBaseManager';
import { AgentCrmEquipeTab } from '@/components/whatsapp/AgentCrmEquipeTab';
import FunilDoAgenteTab from '@/components/pedro/FunilDoAgenteTab';

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
  agents: AIAgent[]; // Novo prop para filtrar instâncias em uso
  onSaved: () => void;
  onRefreshData?: () => void;
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
  { value: 'anthropic/claude-3-5-sonnet-20241022', label: '🏆 Claude 3.5 Sonnet (Melhor p/ SDR)' },
  { value: 'openai/gpt-4o', label: '⭐ GPT-4o (Alta Qualidade)' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (Custo-Beneficio)' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Google Premium)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Rapido e Economico)' },
];

const AGENT_TYPES = [
  { value: 'generic', label: '🤖 Genérico' },
  { value: 'sdr', label: '📞 SDR (Pré-vendas)' },
  { value: 'support', label: '🛠️ Suporte' },
  { value: 'sales', label: '💰 Vendas' },
];

const PROMPT_TEMPLATES: Record<string, string> = {
  generic: DEFAULT_PROMPT,
  sdr: `Você é o {{NAME}}, consultor de pré-vendas (SDR) da {{COMPANY}}. Atuamos no nicho de {{NICHE}}. 

Seu objetivo é qualificar leads interessados em {{PRODUCT}} e agendar uma conversa com um especialista.

Regras de Ouro:
1. Seja humano, amigável e empático. Evite linguagem comercial agressiva.
2. Mantenha frases curtas (máximo 2-3 linhas no WhatsApp).
3. Nunca faça um interrogatório. Faça apenas uma pergunta por vez.
4. Se o cliente tiver dúvidas, responda com autoridade mas seja acessível.

Funil de Qualificação:
- Pergunte sobre a dor principal do cliente hoje.
- Identifique se ele já tentou outras soluções.
- Se houver interesse real e fit, ofereça 2 horários para uma call rápida.

Persona: Especialista prestativo, rápido e focado em ajudar o cliente a resolver o problema dele.`,
  support: `Você é o {{NAME}}, especialista de suporte ao cliente da {{COMPANY}} no nicho de {{NICHE}}. 

Seu objetivo é sanar dúvidas sobre {{PRODUCT}} e garantir a melhor experiência para o cliente.

Diretrizes:
1. Respostas rápidas e precisas.
2. Use tom empático, especialmente se o cliente estiver frustrado.
3. Se não puder resolver imediatamente, explique o processo de solução.
4. Instruções passo a passo são melhores que textos longos.

Objetivo: Resolver o problema no primeiro contato ou encaminhar para o suporte técnico avançado se necessário.`,
  sales: `Você é o {{NAME}}, consultor de vendas sênior da {{COMPANY}} ({{NICHE}}). 

Seu objetivo é fechar vendas de {{PRODUCT}} e converter interessados em clientes satisfeitos.

Técnicas:
1. Foco total em ROI e benefícios, não apenas funcionalidades.
2. Use prova social e gatilhos de escassez/urgência quando apropriado.
3. Identifique o momento de compra (fase do funil) e adapte o fechamento.
4. Seja direto e confiante ao falar de preços e planos.

Mantenha a conversa fluida, natural e foque em resolver a necessidade real do cliente.`,
};

export function AgentFormDialog({ open, onOpenChange, agent, instances, agents, onSaved, onRefreshData }: AgentFormDialogProps) {
  useEffect(() => {
    if (open) {
      console.info("!!! HUMANIZEIA UAZAPI DEBUG V5.3 ACTIVE (OpenAI + Stability) !!!");
    } else {
      // Ao fechar o modal, reseta a aba pra "general" (próxima abertura
      // sempre começa em Geral, não na última aba que ficou aberta).
      setActiveTab('general');
    }
  }, [open]);
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const effectiveUserId = useMemo(() => {
    if (sellerLoading) return null;
    if (isSeller && seller?.user_id) return seller.user_id;
    return user?.id || null;
  }, [sellerLoading, isSeller, seller, user]);
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Tabs controladas: garante que mudança não é resetada por re-renders
  // (modos uncontrolled remountam pra default em alguns cenários)
  const [activeTab, setActiveTab] = useState<string>('general');

  const [name, setName] = useState('Agente IA');
  const [agentType, setAgentType] = useState('generic');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isActive, setIsActive] = useState(false);
  const [model, setModel] = useState('openai/gpt-4o-mini');
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
  const [nicheData, setNicheData] = useState<{ niche: string; business: string; product: string } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannel = useRef<any>(null);
  const promptInitializedRef = useRef<string>('');
  const pendingInstanceRef = useRef<{ id?: string; slug?: string }>({});
  const connectionHandledRef = useRef(false);

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    if (realtimeChannel.current) { 
        console.log('[Realtime] Desconectando canal...');
        supabase.removeChannel(realtimeChannel.current); 
        realtimeChannel.current = null; 
    }
  };

  useEffect(() => {
    // Buscar dados do briefing/quiz para o prompt
    const fetchNicheData = async () => {
      if (!effectiveUserId) return;
      try {
        const { data: quizData } = await supabase
          .from('user_quiz_responses' as any)
          .select('nicho_identificado, respostas_completas')
          .eq('user_id', effectiveUserId)
          .maybeSingle();

        const { data: briefingData } = await supabase
          .from('client_briefings' as any)
          .select('business_name, product_service')
          .eq('user_id', effectiveUserId)
          .maybeSingle();

        setNicheData({
          niche: (quizData as any)?.nicho_identificado || 'Seu Nicho',
          business: (briefingData as any)?.business_name || 'Sua Empresa',
          product: (briefingData as any)?.product_service || 'Nossos Serviços',
        });
      } catch (e) {
        console.error('Erro ao buscar dados do quiz:', e);
      }
    };

    if (open) {
      fetchNicheData();
    }
    return () => stopPolling();
  }, [effectiveUserId, open]);

  // Efeito para atualizar prompt dinamicamente
  useEffect(() => {
    if (!open || !nicheData) return;
    
    // O problema estava aqui: o hook sobrescrevia o prompt do banco de dados quando abria.
    // Agora ele só aplica os templates (Baseados no Nicho, Nome e Tipo) se for um Agente NOVO.
    const isNewAgent = !agent?.id;
    
    if (isNewAgent) {
      const template = PROMPT_TEMPLATES[agentType || 'generic'] || DEFAULT_PROMPT;
      let finalPrompt = template
        .replace(/{{NAME}}/g, name || 'Agente')
        .replace(/{{COMPANY}}/g, nicheData?.business || 'Sua Empresa')
        .replace(/{{NICHE}}/g, nicheData?.niche || 'Seu Nicho')
        .replace(/{{PRODUCT}}/g, nicheData?.product || 'Nossos Serviços');
        
      // Previne overwrite enquanto o usuário digita na criação do Novo Agente
      // mas permite que mude se ele mudar o Tipo antes de editar livremente.
      if (!prompt.includes(name) && !prompt.includes(nicheData?.niche || '')) {
         setPrompt(finalPrompt);
      } else if (prompt === DEFAULT_PROMPT || prompt === '') {
         setPrompt(finalPrompt);
      }
    }
  }, [agentType, nicheData, open, agent?.id]);

  const generateSlug = (nameStr: string) =>
    nameStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const startPolling = (slug: string, instanceId?: string) => {
    stopPolling();
    pendingInstanceRef.current = { id: instanceId, slug };
    connectionHandledRef.current = false;
    console.log(`[polling] Monitorando conexão de: ${slug} (Realtime + Polling fallback)`);
    
    // 1. Realtime Subscription (Mais rápido)
    realtimeChannel.current = supabase
      .channel(`instance-status-${slug}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'wa_instances', filter: `instance_name=eq.${slug}` },
        (payload: any) => {
          console.log('[Realtime] Mudança detectada:', payload.new.status, payload.new.is_active);
          if (payload.new.is_active || payload.new.status === 'connected') {
            console.log('[Realtime] SINAL DE CONEXÃO RECEBIDO!');
            handleConnectionSuccess(payload.new.id, slug);
          }
        }
      )
      .subscribe();

    // 2. Polling Fallback (Caso o Realtime falhe)
    pollingRef.current = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-evolution-qrcode', {
          body: { user_id: effectiveUserId!, instance_name: slug },
        });
        if (error) {
          console.error('[polling] Erro na Edge Function:', error);
          return;
        }
        
        if (data?.connected) {
          handleConnectionSuccess(undefined, slug);
        } else if (data?.raw_response) {
          // Fallback: Smart Frontend Detection (V5.2)
          try {
            const raw = typeof data.raw_response === 'string' ? JSON.parse(data.raw_response) : data.raw_response;
            const rData = raw?.instance || raw;
            const isConnected = rData?.status === 'connected' || rData?.state === 'open' || rData?.connected === true || rData?.loggedIn === true;
            
            if (isConnected) {
              console.log('[polling] Detectado sucesso via Client-Side Logic!');
              handleConnectionSuccess(undefined, slug);
            }
          } catch (e) {
            console.warn('[polling] Erro ao processar raw_response fallback');
          }
        }
        
        if (data?.qr_code) {
          setQrCode(data.qr_code);
        }
      } catch (err) {
        console.error('[polling] Erro fatal no catch:', err);
      }
    }, 5000);
  };

  const handleConnectionSuccess = async (id?: string, slug?: string) => {
    if (connectionHandledRef.current) return;
    connectionHandledRef.current = true;
    console.log('[Connection] Finalizando processo de conexão bem-sucedida...');
    stopPolling();
    setQrCode(null);
    setIsInstanceConnected(true);

    // Buscar o ID se não foi passado (Fallback)
    let instId = id || pendingInstanceRef.current.id;
    if (!instId) {
        const activeSlug = slug || pendingInstanceRef.current.slug;
        let query = supabase.from('wa_instances')
            .select('id')
            .eq('user_id', effectiveUserId!);

        if (activeSlug) {
          query = query.eq('instance_name', activeSlug);
        } else {
          query = query.order('created_at', { ascending: false }).limit(1);
        }

        const { data: latestInst } = await query.maybeSingle();
        instId = latestInst?.id;
    }

    if (instId) {
        setSelectedInstanceIds([instId]); // Restringe a apenas uma
        if (agent?.id) {
          const { error: linkError } = await (supabase as any)
            .from('wa_ai_agents')
            .update({
              instance_id: instId,
              instance_ids: [instId],
              updated_at: new Date().toISOString(),
            })
            .eq('id', agent.id);

          if (linkError) {
            connectionHandledRef.current = false;
            throw new Error(`WhatsApp conectou, mas nao foi possivel vincular ao agente: ${linkError.message}`);
          }

          onRefreshData?.();
          console.log('[Connection] InstÃ¢ncia vinculada ao agente automaticamente:', instId);
        }

        try {
          const { data: { session } } = await supabase.auth.getSession();
          const { data, error } = await supabase.functions.invoke('sync-evolution-webhook', {
            body: { instance_id: instId, user_id: effectiveUserId },
            headers: {
              Authorization: `Bearer ${session?.access_token}`
            }
          });

          if (error || !data?.success) {
            throw new Error(data?.error || error?.message || 'Erro ao sincronizar webhook');
          }

          console.log('[Connection] Webhook sincronizado automaticamente:', instId);
        } catch (syncErr) {
          console.warn('[Connection] Falha ao sincronizar webhook automaticamente:', syncErr);
          toast({
            title: 'WhatsApp conectado, mas webhook falhou',
            description: 'A conexão foi feita, mas a sincronização do webhook não terminou. Tente sincronizar manualmente na instância.',
            variant: 'destructive'
          });
        }
    }
    toast({ title: "WhatsApp Conectado!", description: "Instância está online e pronta.", className: "bg-green-600 text-white" });
  };

  const handleGenerateQr = async () => {
    if (!name.trim()) { toast({ title: "Preencha o nome do agente primeiro", variant: "destructive" }); return; }
    setIsGeneratingQr(true);
    setQrCode(null); // Reset
    setIsInstanceConnected(false);
    connectionHandledRef.current = false;
    pendingInstanceRef.current = {};
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const slug = `${generateSlug(name) || 'agente'}-${randomSuffix}`;
    console.log('[QR] Gerando instância única:', slug);
    try {
      const { data, error } = await supabase.functions.invoke('create-evolution-instance', {
        body: {
          provider: 'evolution',
          instance_name: slug,
          friendly_name: `WhatsApp - ${name} (${randomSuffix})`,
          user_id: effectiveUserId!,
          agent_id: agent?.id,
        },
      });

      console.info("[QR] Resposta Create Completa:", JSON.stringify(data, null, 2));
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar instância');

      let finalQrCode = data?.qr_code;
      const createdInstanceId = data?.instance_id;
      pendingInstanceRef.current = { id: createdInstanceId, slug };

      // Fallback: Se o QR não veio no create, tenta buscar via instance_id
      if (!finalQrCode && createdInstanceId) {
          console.warn("[QR] QR Code não veio na resposta inicial. Tentando busca secundária via instance_id:", createdInstanceId);
          await new Promise(r => setTimeout(r, 3000));
          const { data: qrData, error: qrErr } = await supabase.functions.invoke('get-evolution-qrcode', {
              body: { instance_id: createdInstanceId, user_id: effectiveUserId! }
          });
          console.info("[QR] Resposta fallback:", JSON.stringify(qrData));
          if (qrErr) console.error("[QR] Erro no fallback:", qrErr);
          finalQrCode = qrData?.qr_code || qrData?.base64 || qrData?.qrcode;
          
          // Log da resposta bruta para diagnóstico
          if (!finalQrCode && qrData?.raw_response) {
            console.warn("[QR] Resposta bruta da Uazapi (fallback):", qrData.raw_response);
          }
      }

      if (finalQrCode) {
        setQrCode(finalQrCode);
        startPolling(slug, createdInstanceId);
      } else {
        startPolling(slug, createdInstanceId);
        toast({
            title: "Instância criada, mas o QR Code demorou",
            description: "A tela continuará tentando buscar o QR automaticamente por alguns segundos.",
            variant: "default"
        });
      }
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
    console.log('[Delete] Iniciando exclusão da instância:', id);
    try {
      // Step 1: Try Edge Function (Full cleanup)
      const { data, error: funcError } = await supabase.functions.invoke('delete-evolution-instance', {
        body: { instance_id: id, user_id: effectiveUserId }
      });
      
      console.log('[Delete] Resultado Edge Function:', JSON.stringify(data || funcError, null, 2));
      
      // Step 2: FALLBACK - If Edge Function fails (401/406/non-2xx), try deleting directly from DB
      if (funcError || !data?.success) {
        console.warn('[Delete] Edge Function falhou ou retornou erro. Tentando exclusão direta no banco de dados...');
        const { error: dbError } = await supabase
          .from('wa_instances')
          .delete()
          .eq('id', id);
          
        if (dbError) {
          console.error('[Delete] Erro na exclusão direta no banco:', dbError);
          throw new Error('Falha total na exclusão: ' + dbError.message);
        }
        console.log('[Delete] Exclusão direta no banco realizada com sucesso.');
      }
      
      toast({ title: "Instância removida com sucesso" });
      onSaved(); // Refresh lists
    } catch (err: any) {
      console.error('[Delete] Falha crítica:', err);
      toast({ title: "Falha ao excluir", description: "Tente novamente ou limpe o cache: " + err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSyncWebhook = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[Webhook] Sincronizando instância:', id);
    try {
      // Pega a sessão atual para garantir autenticação
      const { data: { session } } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('sync-evolution-webhook', {
        body: { instance_id: id, user_id: effectiveUserId },
        headers: {
            Authorization: `Bearer ${session?.access_token}`
        }
      });
      
      if (error || !data?.success) {
        throw new Error(data?.error || 'Erro ao sincronizar');
      }
      
      const details = data?.results ? data.results.join(' | ') : '';
      toast({ 
        title: "Webhook sincronizado!", 
        description: `Detalhes: ${details}. As mensagens agora devem ser processadas.` 
      });
    } catch (err: any) {
      console.error('[Webhook] Falha na sincronização:', err);
      toast({ title: "Falha ao sincronizar", description: err.message, variant: "destructive" });
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
    // Restringe apenas a um selecionado (estilo Radio Button)
    setSelectedInstanceIds(prev => prev.includes(id) ? [] : [id]);
  };

  const toggleCategory = (cat: string) => {
    setBlockedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const buildPayload = () => ({
    user_id: effectiveUserId!,
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
    if (!user || !effectiveUserId) {
      toast({ title: 'Sessao expirada', description: 'Faca login novamente para salvar o agente.', variant: 'destructive' });
      return;
    }
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
  const handleDialogOpenChange = (val: boolean) => {
    if (!val) {
      stopPolling();
      setQrCode(null);
      setIsGeneratingQr(false);
    }
    onOpenChange(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[92vh] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {agent ? 'Editar Agente' : 'Novo Agente IA'}
          </DialogTitle>
          <DialogDescription>Configure como o agente responde e quais números ele atende</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[72vh] pr-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="w-full pb-4 border-b">
              {/* Contêiner em grid/auto-wrap para garantir que as abas não cortem */}
              <TabsList className="flex flex-wrap h-auto w-full items-center justify-start gap-1.5 bg-transparent p-0 border-none shadow-none">
                <TabsTrigger value="general" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-primary/20">
                  <Brain className="h-4 w-4" /> Geral
                </TabsTrigger>
                <TabsTrigger value="business" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-primary/20">
                  <Building2 className="h-4 w-4" /> Empresa
                </TabsTrigger>
                <TabsTrigger value="sdr" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-primary/20">
                  <Target className="h-4 w-4" /> SDR
                </TabsTrigger>
                <TabsTrigger value="settings" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-primary/20">
                  <Settings2 className="h-4 w-4" /> Modelo
                </TabsTrigger>
                <TabsTrigger value="knowledge" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-500 data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-purple-500/20">
                  <BookOpen className="h-4 w-4" /> Base
                </TabsTrigger>
                <TabsTrigger value="equipe" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-blue-500/10 data-[state=active]:text-blue-500 data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-blue-500/20">
                  <UserCheck className="h-4 w-4" /> Vendedores
                </TabsTrigger>
                <TabsTrigger value="integrations" className="flex-1 min-w-[100px] gap-2 rounded-md bg-muted/50 data-[state=active]:bg-orange-500/10 data-[state=active]:text-orange-500 data-[state=active]:shadow-sm transition-all py-2 border border-transparent data-[state=active]:border-orange-500/20">
                  <Webhook className="h-4 w-4" /> n8n
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Tab: Vendedores (Repasse) ── */}
            <TabsContent value="equipe" className="space-y-6 mt-0">
               <AgentCrmEquipeTab agentId={agent?.id || null} userId={effectiveUserId || ''} />
            </TabsContent>

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
                    <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse mb-2">
                       <Loader2 className="w-3 h-3 animate-spin" /> Aguardando leitura no celular...
                    </div>
                    <div className="flex gap-2 w-full">
                       <Button 
                         variant="outline" 
                         size="sm"
                         className="flex-1 text-xs"
                         onClick={() => {
                            // Find the non-active instance to poll for it
                            const pending = pendingInstanceRef.current;
                            const inst = pending.id
                              ? instances.find(i => i.id === pending.id)
                              : instances.find(i => !i.is_active);
                            if (pending.slug) startPolling(pending.slug, pending.id);
                            else if (inst) startPolling(inst.instance_name, inst.id);
                            else toast({ title: "Tente gerar um novo QR Code" });
                         }}
                       >
                         <RefreshCw className="w-3 h-3 mr-1" /> Já escaneei
                       </Button>
                       <Button 
                         variant="ghost" 
                         size="sm"
                         className="flex-1 text-xs text-red-500"
                         onClick={() => {
                            setQrCode(null);
                            stopPolling();
                         }}
                       >
                         Cancelar
                       </Button>
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
                    
                    {(instances || []).length > 0 && (
                      <div className="pt-2 border-t mt-2">
                        <Label className="text-xs mb-2 block">Ou use um número já conectado:</Label>
                        <div className="space-y-2 max-h-[120px] overflow-y-auto">
                          {(instances || [])
                            .filter(inst => {
                                // Se for edição, mostra a atual + as livres
                                // Se for novo, mostra apenas as livres
                                const isCurrentAgentInstance = (selectedInstanceIds || []).includes(inst.id);
                                if (isCurrentAgentInstance) return true;
                                
                                const isInstanceInUse = (agents || []).some(a => 
                                    a?.id !== agent?.id && 
                                    (a?.instance_id === inst.id || a?.instance_ids?.includes(inst.id))
                                );
                                return !isInstanceInUse;
                            })
                            .map(inst => (
                            <div key={inst.id} className="flex items-center gap-3 p-1 hover:bg-muted/50 rounded-md group">
                              <Checkbox
                                checked={selectedInstanceIds.includes(inst.id)}
                                onCheckedChange={() => toggleInstance(inst.id)}
                              />
                              <div className="flex-1 text-sm">{inst.friendly_name}</div>
                              <Badge variant={inst.is_active ? 'default' : 'secondary'} className="text-[10px]">
                                {inst.is_active ? 'Online' : 'Offline'}
                              </Badge>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-blue-500 hover:bg-blue-50"
                                  onClick={(e) => handleSyncWebhook(inst.id, e)}
                                  title="Sincronizar Webhook"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:bg-red-50"
                                  onClick={(e) => handleDeleteInstance(inst.id, e)}
                                  disabled={deletingId === inst.id}
                                >
                                  {deletingId === inst.id ? <Loader2 className="h-3 w-3 animate-spin"/> : <Trash2 className="h-3 w-3" />}
                                </Button>
                              </div>
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
              {/* Funil do Agente — configuração estruturada de 9 blocos
                  POR AGENTE (cada agente tem suas próprias regras).
                  Só disponível depois que o agente foi salvo (precisa de agent.id). */}
              {agent?.id && effectiveUserId ? (
                <FunilDoAgenteTab agentId={agent.id} userId={effectiveUserId} />
              ) : (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
                  <Target className="h-8 w-8 text-amber-400 mx-auto mb-2" />
                  <div className="text-sm font-medium mb-1">Salve o agente primeiro</div>
                  <p className="text-xs text-muted-foreground">
                    Preencha as abas <span className="font-medium">Geral</span> e <span className="font-medium">Empresa</span>,
                    clique em <span className="font-medium">Salvar</span>, depois reabra para configurar o Funil do Agente
                    (as regras de qualificação ficam isoladas por agente).
                  </p>
                </div>
              )}
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
            {/* ── Tab: Knowledge Base ── */}
            <TabsContent value="knowledge" className="space-y-4 mt-0">
              <KnowledgeBaseManager
                agentId={agent?.id || null}
                userId={effectiveUserId || ''}
              />
            </TabsContent>
          </Tabs>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || syncing}>
            {(saving || syncing) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {syncing ? 'Sincronizando...' : agent ? 'Salvar' : 'Criar Agente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
