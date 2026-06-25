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
// Radix Tabs removido — debug ao vivo via Chrome MCP provou que TabsTrigger
// não disparava onValueChange dentro do DialogContent. Substituído por
// botões nativos + render condicional (mais simples, funciona 100%).
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import { Save, Loader2, Brain, Settings2, Clock, Shield, Building2, UserCheck, Target, QrCode, CheckCircle, Trash2, RefreshCw, BookOpen, MessageSquare } from 'lucide-react';
import { KnowledgeBaseManager } from '@/components/whatsapp/KnowledgeBaseManager';
import { AgentCrmEquipeTab } from '@/components/whatsapp/AgentCrmEquipeTab';
import FunilDoAgenteTab from '@/components/pedro/FunilDoAgenteTab';
import { WhatsAppQrCode } from '@/components/uazapi/WhatsAppQrCode';
import { UazapiConnectDialog } from '@/components/uazapi/UazapiConnectDialog';
import { Smartphone } from 'lucide-react';

interface Instance {
  id: string;
  friendly_name: string;
  instance_name: string;
  is_active: boolean;
  provider: string;
  purpose?: string | null;
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
  { value: 'anthropic/claude-haiku-4-5', label: '🏆 Claude Haiku 4.5 (Recomendado p/ SDR)' },
  { value: 'openai/gpt-4o', label: '⭐ GPT-4o (Alta Qualidade)' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (Custo-Beneficio)' },
];

const AGENT_TYPES = [
  { value: 'generic', label: '🤖 Genérico' },
  { value: 'sdr', label: '🚗 SDR - Automóveis' },
  { value: 'sdr_geral', label: '🎯 SDR - Geral' },
];

// Etiquetas disponiveis nos modelos de mensagem (mostradas na ajuda da tela).
const MSG_TAGS: { tag: string; desc: string }[] = [
  { tag: '{nome}', desc: 'nome do lead' },
  { tag: '{telefone}', desc: 'telefone do lead' },
  { tag: '{link}', desc: 'link pra abrir a conversa (wa.me)' },
  { tag: '{cidade}', desc: 'cidade do lead' },
  { tag: '{temperatura}', desc: 'quente / morno / frio' },
  { tag: '{interesse}', desc: 'modelo/carro de interesse' },
  { tag: '{veiculo}', desc: 'veículo apresentado' },
  { tag: '{pagamento}', desc: 'forma de pagamento' },
  { tag: '{entrada}', desc: 'valor de entrada' },
  { tag: '{troca}', desc: 'carro na troca' },
  { tag: '{resumo}', desc: 'resumo da conversa' },
  { tag: '{vendedor}', desc: 'nome do vendedor' },
  { tag: '{telefone_vendedor}', desc: 'WhatsApp do vendedor' },
  { tag: '{agente}', desc: 'nome do agente (Pedro)' },
  { tag: '{classificacao}', desc: 'classificação do lead' },
  { tag: '{horario}', desc: 'horário da transferência' },
];

// Modelo pronto da mensagem do VENDEDOR (ponto de partida pra editar). Linhas
// com etiqueta vazia somem sozinhas no envio.
const DEFAULT_MSG_VENDEDOR = `🚗 *Novo lead pra você, {vendedor}!*

*Nome:* {nome}
*Telefone:* {telefone}
*Cidade:* {cidade}
*Temperatura:* {temperatura}
*Interesse:* {interesse}
*Forma de pagamento:* {pagamento}
*Entrada:* {entrada}
*Troca:* {troca}
*Resumo:* {resumo}

👉 *Atender agora:* {link}
⏰ Responda em até 15 minutos pra confirmar o recebimento.`;

// Modelo pronto do RELATÓRIO do GERENTE.
const DEFAULT_MSG_GERENTE = `📊 *Relatório de lead — {agente}*

🕐 {horario}
👤 *Lead:* {nome}
📱 *Telefone:* {link}
🏙️ *Cidade:* {cidade}
🌡️ *Temperatura:* {temperatura}
📊 *Classificação:* {classificacao}
🚗 *Interesse:* {interesse}
💰 *Pagamento:* {pagamento}
💵 *Entrada:* {entrada}
🔄 *Troca:* {troca}
📝 *Resumo:* {resumo}

🎯 *Enviado para:* {vendedor}
📲 *WhatsApp vendedor:* {telefone_vendedor}`;

const PROMPT_TEMPLATES: Record<string, string> = {
  generic: DEFAULT_PROMPT,
  sdr: `Você é o {{NAME}}, consultor de pré-vendas (SDR) de automóveis da {{COMPANY}}.

Seu objetivo é qualificar o interesse do cliente em um veículo e conduzi-lo até o vendedor ou uma visita à loja.

Regras de Ouro:
1. Seja humano, amigável e empático. Evite linguagem comercial agressiva.
2. Mantenha frases curtas (máximo 2-3 linhas no WhatsApp).
3. Nunca faça um interrogatório. Faça apenas uma pergunta por vez.
4. Entenda o que o cliente procura (modelo, faixa de preço, forma de pagamento) e tire dúvidas sobre o estoque com autoridade.

Funil de Qualificação:
- Descubra qual veículo ele procura e o momento de compra.
- Identifique forma de pagamento (à vista, financiamento, troca).
- Quando houver interesse real e fit, conduza para o vendedor ou agende uma visita.

Persona: Especialista prestativo, rápido e focado em ajudar o cliente a encontrar o carro certo.`,
  sdr_geral: `Você é o {{NAME}}, SDR da {{COMPANY}}, no nicho de {{NICHE}}.

Seu objetivo NÃO é vender — é QUALIFICAR o lead e AGENDAR uma reunião/demonstração com um especialista.

Regras de Ouro:
1. Seja humano, consultivo e empático. Mensagens curtas, UMA pergunta por vez.
2. Personalize: use o nome do lead e o que ele já disse. Nunca repita uma pergunta já respondida.
3. Não despeje informação — gere CURIOSIDADE para o lead querer ver a solução na prática.

Funil em 4 fases:
1. Conexão — saudação por horário + descubra o cargo e o segmento da empresa.
2. Descoberta — entenda a dor principal e como funciona a operação hoje.
3. Valor/Curiosidade — conecte a dor ao diferencial de {{PRODUCT}}, sem entregar tudo.
4. Agendamento — quando houver fit, ofereça 2 horários e marque a reunião.

Persona: Especialista que faz perguntas certeiras, escuta, espelha a dor e desperta o interesse em conhecer a solução.`,
};

export function AgentFormDialog({ open, onOpenChange, agent, instances, agents, onSaved, onRefreshData }: AgentFormDialogProps) {
  // NOTA: removido reset de setActiveTab no useEffect [open] — estava
  // disparando em re-renders e revertendo a aba pra 'general' quando user
  // clicava em SDR. Reset agora é feito no handleDialogOpenChange (só
  // quando o modal de fato fecha).
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

  // activeTab persistido em sessionStorage — Investigação ao vivo via Chrome
  // MCP provou que o AgentFormDialog é REMONTADO após cliques de aba
  // (provavelmente o WhatsAppAIAgent re-renderiza com nova reference, ou
  // algum efeito do Dialog/FunilDoAgenteTab causa unmount/remount). useState
  // sozinho perde o valor a cada remount → aba volta pra 'general'.
  // Solução: ler do sessionStorage no initial (sobrevive remount, dá reset
  // explícito no fechamento via handleDialogOpenChange).
  const ACTIVE_TAB_KEY = `agentFormDialog_activeTab_${agent?.id || 'new'}`;
  const [activeTab, setActiveTabState] = useState<string>(() => {
    try { return sessionStorage.getItem(ACTIVE_TAB_KEY) || 'general'; }
    catch { return 'general'; }
  });
  const setActiveTab = (v: string) => {
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, v); } catch {}
    setActiveTabState(v);
  };

  const [name, setName] = useState('Agente IA');
  const [agentType, setAgentType] = useState('generic');
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [isActive, setIsActive] = useState(false);
  const [model, setModel] = useState('anthropic/claude-haiku-4-5');
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

  // Mensagens personalizadas (vendedor / gerente). Toggle off = mensagem
  // automatica de sempre (salva null). Toggle on = usa o texto com etiquetas.
  const [customVendedorMsg, setCustomVendedorMsg] = useState(false);
  const [templateVendedorMsg, setTemplateVendedorMsg] = useState(DEFAULT_MSG_VENDEDOR);
  const [customGerenteMsg, setCustomGerenteMsg] = useState(false);
  const [templateGerenteMsg, setTemplateGerenteMsg] = useState(DEFAULT_MSG_GERENTE);
  // Feedback do gerente na transferência: false = resumido (atual), true = completo
  // (o MESMO briefing do vendedor + qual vendedor está atendendo).
  const [gerenteFeedbackCompleto, setGerenteFeedbackCompleto] = useState(false);
  // Enviar as mensagens de transferência (vendedor/gerente) SEM emojis (texto limpo).
  const [mensagensSemEmoji, setMensagensSemEmoji] = useState(false);

  // ── Regras de automacao (Pedro v2): follow-up + transferencia ──
  // NULL no banco = comportamento legado (5/8/12, transfere, 10min, janela fixa).
  const [ruFollowupEnabled, setRuFollowupEnabled] = useState(true);
  const [ruT1, setRuT1] = useState(5);
  const [ruT2, setRuT2] = useState(8);
  const [ruT3, setRuT3] = useState(12);
  const [ruT3Transfers, setRuT3Transfers] = useState(true);
  const [ruTransferEnabled, setRuTransferEnabled] = useState(true);
  const [ruSellerRespMin, setRuSellerRespMin] = useState(10);
  const [ruWindowCustom, setRuWindowCustom] = useState(false);
  const [ruWindowStart, setRuWindowStart] = useState('10:11');
  const [ruWindowEnd, setRuWindowEnd] = useState('19:29');

  // QR Code states
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isInstanceConnected, setIsInstanceConnected] = useState(false);
  // Dialog de conexão NOVO (QR UAZAPI OU Meta Oficial). Substitui o botão antigo
  // de "Gerar QR Code" que só fazia UAZAPI.
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
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
          .select('business_name, offering_details')
          .eq('user_id', effectiveUserId)
          .maybeSingle();

        setNicheData({
          niche: (quizData as any)?.nicho_identificado || 'Seu Nicho',
          business: (briefingData as any)?.business_name || 'Sua Empresa',
          product: (briefingData as any)?.offering_details || 'Nossos Serviços',
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
        const { data, error } = await supabase.functions.invoke('get-uazapi-qrcode', {
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
          const { data, error } = await supabase.functions.invoke('sync-uazapi-webhook', {
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
      const { data, error } = await supabase.functions.invoke('create-uazapi-instance', {
        body: {
          provider: 'uazapi',
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
          const { data: qrData, error: qrErr } = await supabase.functions.invoke('get-uazapi-qrcode', {
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
      const { data, error: funcError } = await supabase.functions.invoke('delete-uazapi-instance', {
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
      
      const { data, error } = await supabase.functions.invoke('sync-uazapi-webhook', {
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
      // Mensagens personalizadas: se ja houver template salvo, liga o toggle e
      // carrega o texto; senao, fica desligado com o modelo pronto pra editar.
      const tplV = (agent as any).briefing_template_vendedor || '';
      setCustomVendedorMsg(!!tplV.trim());
      setTemplateVendedorMsg(tplV.trim() ? tplV : DEFAULT_MSG_VENDEDOR);
      const tplG = (agent as any).briefing_template_gerente || '';
      setCustomGerenteMsg(!!tplG.trim());
      setTemplateGerenteMsg(tplG.trim() ? tplG : DEFAULT_MSG_GERENTE);
      setGerenteFeedbackCompleto((agent as any).gerente_feedback_completo === true);
      setMensagensSemEmoji((agent as any).mensagens_sem_emoji === true);
      // Regras de automacao (default = comportamento legado se nao houver nada salvo)
      const ar: any = (agent as any).automation_rules || {};
      const arF: any = ar.followup || {}; const arT: any = ar.transfer || {};
      setRuFollowupEnabled(arF.enabled !== false);
      setRuT1(Number(arF.t1_min) > 0 ? Number(arF.t1_min) : 5);
      setRuT2(Number(arF.t2_min) > 0 ? Number(arF.t2_min) : 8);
      setRuT3(Number(arF.t3_min) > 0 ? Number(arF.t3_min) : 12);
      setRuT3Transfers(arF.t3_transfers !== false);
      setRuTransferEnabled(arT.enabled !== false);
      setRuSellerRespMin(Number(arT.seller_response_min) > 0 ? Number(arT.seller_response_min) : 10);
      const arW: any = arT.window;
      setRuWindowCustom(!!arW);
      setRuWindowStart(arW?.start || '10:11');
      setRuWindowEnd(arW?.end || '19:29');
    } else {
      setName('Agente IA');
      setAgentType('generic');
      setPrompt(DEFAULT_PROMPT);
      setIsActive(false);
      setModel('anthropic/claude-haiku-4-5');
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
      setCustomVendedorMsg(false); setTemplateVendedorMsg(DEFAULT_MSG_VENDEDOR);
      setCustomGerenteMsg(false); setTemplateGerenteMsg(DEFAULT_MSG_GERENTE);
      setRuFollowupEnabled(true); setRuT1(5); setRuT2(8); setRuT3(12); setRuT3Transfers(true);
      setRuTransferEnabled(true); setRuSellerRespMin(10);
      setRuWindowCustom(false); setRuWindowStart('10:11'); setRuWindowEnd('19:29');
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
    briefing_template_vendedor: customVendedorMsg ? (templateVendedorMsg.trim() || null) : null,
    briefing_template_gerente: customGerenteMsg ? (templateGerenteMsg.trim() || null) : null,
    gerente_feedback_completo: gerenteFeedbackCompleto,
    mensagens_sem_emoji: mensagensSemEmoji,
    automation_rules: (() => {
      const t1 = Math.max(1, Math.round(Number(ruT1)) || 5);
      const t2 = Math.max(t1 + 1, Math.round(Number(ruT2)) || 8);
      const t3 = Math.max(t2 + 1, Math.round(Number(ruT3)) || 12);
      return {
        followup: { enabled: ruFollowupEnabled, t1_min: t1, t2_min: t2, t3_min: t3, t3_transfers: ruT3Transfers },
        transfer: {
          enabled: ruTransferEnabled,
          seller_response_min: Math.max(1, Math.round(Number(ruSellerRespMin)) || 10),
          window: ruWindowCustom ? { enabled: true, start: ruWindowStart, end: ruWindowEnd } : null,
        },
      };
    })(),
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
      // ISOLAMENTO: marca os números escolhidos como finalidade 'agent', pra eles
      // ficarem fora do disparo em massa e o webhook tratá-los como números de IA.
      if (selectedInstanceIds.length > 0) {
        await (supabase as any).from('wa_instances').update({ purpose: 'agent' }).in('id', selectedInstanceIds);
      }
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
      // Reset explícito + limpa sessionStorage (próxima abertura começa em Geral)
      try { sessionStorage.removeItem(ACTIVE_TAB_KEY); } catch {}
      setActiveTab('general');
    }
    onOpenChange(val);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[92vh] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {agent ? 'Editar Agente' : 'Novo Agente IA'}
            <Badge variant="outline" className="ml-2 text-[10px] font-mono">
              Aba: {activeTab}
            </Badge>
          </DialogTitle>
          <DialogDescription>Configure como o agente responde e quais números ele atende</DialogDescription>
        </DialogHeader>

        {/* ScrollArea (Radix) substituído por div nativa — Radix ScrollArea
            tinha conflito com Tabs aninhada que fazia conteúdo da SDR sumir */}
        <div className="max-h-[72vh] overflow-y-auto pr-4">
          {/* Tabs implementadas como buttons nativos — investigação ao vivo no
              navegador (Chrome MCP) provou que Radix TabsTrigger NÃO disparava
              onValueChange dentro deste DialogContent (provavelmente conflito
              de portal/event-delegation). Botões nativos com onClick direto
              funcionam 100% e são mais simples. Mantém data-[state=active]
              equivalente via className condicional. */}
          <div className="space-y-6">
            <div className="w-full pb-4 border-b">
              <div className="flex flex-wrap h-auto w-full items-center justify-start gap-1.5 bg-transparent p-0 border-none shadow-none">
                {[
                  { v: 'general',      label: 'Geral',       Icon: Brain,       activeCls: 'bg-primary/10 text-primary border-primary/20' },
                  { v: 'business',     label: 'Empresa',     Icon: Building2,   activeCls: 'bg-primary/10 text-primary border-primary/20' },
                  { v: 'sdr',          label: 'SDR',         Icon: Target,      activeCls: 'bg-primary/10 text-primary border-primary/20' },
                  { v: 'settings',     label: 'Modelo',      Icon: Settings2,   activeCls: 'bg-primary/10 text-primary border-primary/20' },
                  { v: 'knowledge',    label: 'Base',        Icon: BookOpen,    activeCls: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
                  { v: 'equipe',       label: 'Vendedores',  Icon: UserCheck,   activeCls: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
                  { v: 'rules',        label: 'Regras',      Icon: Clock,       activeCls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' },
                  { v: 'mensagens',    label: 'Mensagens',   Icon: MessageSquare, activeCls: 'bg-orange-500/10 text-orange-500 border-orange-500/20' },
                ].map(({ v, label, Icon, activeCls }) => {
                  const isActive = activeTab === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setActiveTab(v)}
                      className={
                        `flex-1 min-w-[100px] gap-2 rounded-md transition-all py-2 border ` +
                        `inline-flex items-center justify-center text-sm font-medium px-3 ` +
                        (isActive
                          ? `${activeCls} shadow-sm`
                          : `bg-muted/50 border-transparent hover:bg-muted/70`)
                      }
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Tab: Vendedores (Repasse) ── */}
            {activeTab === 'equipe' && <div className="space-y-6 mt-0">
               <AgentCrmEquipeTab agentId={agent?.id || null} userId={effectiveUserId || ''} />
            </div>}

            {/* ── Tab: Regras (follow-up + transferencia) ── */}
            {activeTab === 'rules' && <div className="space-y-6 mt-0">
              <p className="text-xs text-muted-foreground">
                Controle os follow-ups automáticos e o repasse de leads para os vendedores. Vale para este agente.
              </p>

              {/* Follow-up */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> Follow-up automático</h3>
                    <p className="text-xs text-muted-foreground">Mensagens quando o cliente para de responder.</p>
                  </div>
                  <Switch checked={ruFollowupEnabled} onCheckedChange={setRuFollowupEnabled} />
                </div>
                {ruFollowupEnabled && <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label className="text-xs">1º (min)</Label><Input type="number" min={1} value={ruT1} onChange={e => setRuT1(Number(e.target.value))} /></div>
                    <div><Label className="text-xs">2º (min)</Label><Input type="number" min={1} value={ruT2} onChange={e => setRuT2(Number(e.target.value))} /></div>
                    <div><Label className="text-xs">3º (min)</Label><Input type="number" min={1} value={ruT3} onChange={e => setRuT3(Number(e.target.value))} /></div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Contados desde a última resposta do agente. Devem ser crescentes (1º &lt; 2º &lt; 3º) — ajusto automaticamente se não forem.</p>
                  <div className="flex items-center justify-between pt-1">
                    <Label className="text-sm">No 3º follow-up, transferir para um vendedor</Label>
                    <Switch checked={ruT3Transfers} onCheckedChange={setRuT3Transfers} disabled={!ruTransferEnabled} />
                  </div>
                  {!ruTransferEnabled && <p className="text-[11px] text-amber-500">Transferência desativada abaixo — o 3º follow-up só manda a despedida, sem transferir.</p>}
                  {ruT3Transfers && ruTransferEnabled && <p className="text-[11px] text-muted-foreground">No 3º tempo o agente se despede e transfere o lead. Se desligar, ele só se despede.</p>}
                </div>}
              </div>

              {/* Transferência */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2"><UserCheck className="h-4 w-4" /> Transferência para vendedor</h3>
                    <p className="text-xs text-muted-foreground">Repasse automático e rodízio na fila.</p>
                  </div>
                  <Switch checked={ruTransferEnabled} onCheckedChange={setRuTransferEnabled} />
                </div>
                {ruTransferEnabled ? <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Tempo de resposta do vendedor (min)</Label>
                    <Input type="number" min={1} value={ruSellerRespMin} onChange={e => setRuSellerRespMin(Number(e.target.value))} />
                    <p className="text-[11px] text-muted-foreground mt-1">Tempo que cada vendedor da fila tem para responder "Ok" antes do lead passar para o próximo.</p>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Label className="text-sm">Horário de repasse personalizado</Label>
                    <Switch checked={ruWindowCustom} onCheckedChange={setRuWindowCustom} />
                  </div>
                  {ruWindowCustom ? <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs">Início</Label><Input type="time" value={ruWindowStart} onChange={e => setRuWindowStart(e.target.value)} /></div>
                    <div><Label className="text-xs">Fim</Label><Input type="time" value={ruWindowEnd} onChange={e => setRuWindowEnd(e.target.value)} /></div>
                  </div> : <p className="text-[11px] text-muted-foreground">Usando o horário padrão do sistema. Ative para definir um horário próprio (dentro do horário comercial).</p>}
                </div> : <p className="text-[11px] text-muted-foreground">Com a transferência desligada, o agente atende sozinho: não repassa por qualificação, nem por inatividade, nem faz rodízio. A transferência manual no portal continua disponível.</p>}
              </div>
            </div>}

            {/* ── Tab: Mensagens (templates vendedor / gerente) ── */}
            {activeTab === 'mensagens' && <div className="space-y-6 mt-0">
              <p className="text-xs text-muted-foreground">
                Personalize o texto que o Pedro envia ao <b>vendedor</b> (na transferência do lead) e ao <b>gerente</b> (relatório). Deixe desligado para usar a mensagem automática do sistema.
              </p>

              {/* Com / sem emojis — vale pras mensagens de vendedor E gerente */}
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="pr-3">
                  <p className="text-sm font-medium">Enviar mensagens sem emojis</p>
                  <p className="text-[11px] text-muted-foreground">Ligado: as mensagens do Pedro pro <b>vendedor e gerente</b> vão em texto limpo, sem emojis. Desligado: com emojis (padrão).</p>
                </div>
                <Switch checked={mensagensSemEmoji} onCheckedChange={setMensagensSemEmoji} />
              </div>

              {/* Ajuda: etiquetas */}
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                <p className="text-xs font-semibold mb-2 flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5 text-orange-500" /> Etiquetas que você pode usar</p>
                <p className="text-[11px] text-muted-foreground mb-2">Escreva a mensagem do seu jeito e use estas etiquetas onde quiser que entrem os dados do lead. O sistema troca cada uma pelo valor real. Se um dado não existir, a linha some sozinha.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {MSG_TAGS.map(t => (
                    <div key={t.tag} className="flex items-baseline gap-2 text-[11px]">
                      <code className="font-mono text-orange-600 dark:text-orange-400 shrink-0">{t.tag}</code>
                      <span className="text-muted-foreground truncate">{t.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mensagem do vendedor */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2"><UserCheck className="h-4 w-4" /> Mensagem para o vendedor</h3>
                    <p className="text-xs text-muted-foreground">O que o vendedor recebe quando o lead é transferido pra ele.</p>
                  </div>
                  <Switch checked={customVendedorMsg} onCheckedChange={setCustomVendedorMsg} />
                </div>
                {customVendedorMsg ? (
                  <div className="space-y-2">
                    <Textarea
                      value={templateVendedorMsg}
                      onChange={e => setTemplateVendedorMsg(e.target.value)}
                      placeholder="Escreva a mensagem do vendedor usando as etiquetas acima..."
                      className="min-h-[220px] font-mono text-xs"
                    />
                    <button type="button" onClick={() => setTemplateVendedorMsg(DEFAULT_MSG_VENDEDOR)}
                      className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline">
                      Restaurar modelo padrão
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Desligado: usando a mensagem automática do sistema. Ligue para escrever a sua.</p>
                )}
              </div>

              {/* Mensagem do gerente */}
              <div className="rounded-lg border p-4 space-y-3">
                {/* Resumido (atual) x Completo (mesmo briefing do vendedor + qual vendedor atende) */}
                <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-2">
                  <div className="pr-3">
                    <p className="text-sm font-medium">Feedback completo para o gerente</p>
                    <p className="text-[11px] text-muted-foreground">Ligado: o gerente recebe o <b>mesmo briefing do vendedor</b> + qual vendedor está atendendo. Desligado: o resumo curto (atual).</p>
                  </div>
                  <Switch checked={gerenteFeedbackCompleto} onCheckedChange={setGerenteFeedbackCompleto} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4" /> Relatório para o gerente</h3>
                    <p className="text-xs text-muted-foreground">{gerenteFeedbackCompleto ? 'No modo completo, o texto personalizado abaixo é ignorado.' : 'O resumo que o gerente recebe a cada lead transferido.'}</p>
                  </div>
                  <Switch checked={customGerenteMsg} onCheckedChange={setCustomGerenteMsg} disabled={gerenteFeedbackCompleto} />
                </div>
                {customGerenteMsg ? (
                  <div className="space-y-2">
                    <Textarea
                      value={templateGerenteMsg}
                      onChange={e => setTemplateGerenteMsg(e.target.value)}
                      placeholder="Escreva o relatório do gerente usando as etiquetas acima..."
                      className="min-h-[220px] font-mono text-xs"
                    />
                    <button type="button" onClick={() => setTemplateGerenteMsg(DEFAULT_MSG_GERENTE)}
                      className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline">
                      Restaurar modelo padrão
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">Desligado: usando o relatório automático do sistema. Ligue para escrever o seu.</p>
                )}
              </div>
            </div>}

            {/* ── Tab: General ── */}
            {activeTab === 'general' && <div className="space-y-6 mt-0">
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
                    <WhatsAppQrCode value={qrCode} className="w-48 h-48 rounded shadow-sm" size={192} />
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
                    {/* Botão único — abre o seletor de provider (UAZAPI QR Code ou
                        Meta API Oficial). A escolha + conexão acontecem dentro do
                        UazapiConnectDialog, e ao concluir a instância é vinculada
                        automaticamente a este agente via agentId. */}
                    <Button
                      type="button"
                      onClick={() => {
                        if (!name.trim()) { toast({ title: 'Preencha o nome do agente primeiro', variant: 'destructive' }); return; }
                        setConnectDialogOpen(true);
                      }}
                      disabled={!name.trim()}
                      variant="outline"
                      className="w-full border-primary/50 hover:bg-primary/5 text-primary"
                    >
                      <Smartphone className="w-4 h-4 mr-2" />
                      Conectar WhatsApp ao agente
                    </Button>
                    <p className="text-[11px] text-muted-foreground text-center -mt-1">
                      Você escolhe: <strong>QR Code</strong> (UAZAPI) ou <strong>API Oficial do Meta</strong>.
                    </p>
                    
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

                                // ISOLAMENTO: número de disparo em massa / teste NÃO pode virar
                                // número de agente — fica fora da seleção.
                                if (inst.purpose === 'bulk_sender' || inst.purpose === 'test') return false;

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
            </div>}

            {/* ── Tab: Business / SDR ── */}
            {activeTab === 'business' && <div className="space-y-5 mt-0">
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
            </div>}

            {/* ── Tab: SDR Funnel ──
                O Funil moveu pra página dedicada /agente/:id/funil porque
                o componente dentro do modal sofria re-mounts intermitentes
                que faziam o conteúdo desaparecer (debugado ao vivo via
                Chrome MCP). Aba aqui só direciona pra essa rota. */}
            {activeTab === 'sdr' && <div className="space-y-5 mt-0">
              {agent?.id ? (
                <div className="rounded-lg border border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 p-6 text-center">
                  <Target className="h-8 w-8 text-blue-400 mx-auto mb-2" />
                  <div className="text-base font-medium mb-1">Funil do Agente</div>
                  <p className="text-xs text-muted-foreground mb-4">
                    Configure os 8 blocos do funil SDR (Identidade, Abordagem, Qualificação,
                    Ramificações, Critérios, Transferência, Regras, Empresa). Os dados existentes
                    do agente já vêm pré-preenchidos.
                  </p>
                  <Button
                    onClick={() => {
                      // Fecha o modal antes de navegar
                      onOpenChange(false);
                      window.location.href = `/agente/${agent.id}/funil`;
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
                  >
                    🧠 Abrir Funil do Agente
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
                  <Target className="h-8 w-8 text-amber-400 mx-auto mb-2" />
                  <div className="text-sm font-medium mb-1">Salve o agente primeiro</div>
                  <p className="text-xs text-muted-foreground">
                    Preencha as abas Geral e Empresa, clique em Salvar, depois acesse o
                    Funil pelo botão "🧠 Funil" no card do agente.
                  </p>
                </div>
              )}
            </div>}

            {/* ── Tab: Model Settings ── */}
            {activeTab === 'settings' && <div className="space-y-4 mt-0">
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
            </div>}

            {/* ── Tab: Knowledge Base ── */}
            {activeTab === 'knowledge' && <div className="space-y-4 mt-0">
              <KnowledgeBaseManager
                agentId={agent?.id || null}
                userId={effectiveUserId || ''}
              />
            </div>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || syncing}>
            {(saving || syncing) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {syncing ? 'Sincronizando...' : agent ? 'Salvar' : 'Criar Agente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Dialog de conexão (QR UAZAPI ou Meta Oficial). Ao conectar, vincula a
        instância nova a este agente (via agentId) e atualiza o estado local. */}
    <UazapiConnectDialog
      open={connectDialogOpen}
      onOpenChange={setConnectDialogOpen}
      agentId={agent?.id}
      initialFriendlyName={name ? `WhatsApp - ${name}` : undefined}
      onConnected={(instId) => {
        if (instId) {
          setSelectedInstanceIds((prev) => prev.includes(instId) ? prev : [...prev, instId]);
          setIsInstanceConnected(true);
        }
        onRefreshData?.();
      }}
    />
    </>
  );
}
