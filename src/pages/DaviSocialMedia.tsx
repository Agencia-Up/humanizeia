import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useSocialMedia } from '@/hooks/useSocialMedia';
import { useAgentChat } from '@/contexts/AgentChatContext';
import { CarouselPageViewer, TemplateId, CAROUSEL_TEMPLATES } from '@/components/davi/CarouselPageViewer';
import {
  Instagram, Zap, Loader2, Clock, CheckCircle2, XCircle, ChevronRight,
  Copy, Trash2, FolderOpen, Layers, Send, Link, Palette, Eye,
  Brain, AlertTriangle, PenTool, TrendingUp, BookOpen, MessageSquare, AlertCircle, Footprints, Flame,
  Camera, X as XIcon
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentSwitch = {
  daniel: boolean;
  paulo: boolean;
  maria: boolean;
  autoSchedule: boolean;
};

type AutoModeStep = {
  id: string;
  agent: 'daniel' | 'paulo' | 'maria' | 'davi';
  label: string;
  status: 'waiting' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'davi' | 'system';
  content: string;
  timestamp: Date;
  steps?: AutoModeStep[];
  contentCard?: GeneratedContent;
};

type GeneratedContent = {
  id: string;
  type: 'carousel' | 'reel_script' | 'post' | 'story';
  title: string;
  preview: string;
  fullContent: string;
  slides?: import('@/hooks/useSocialMedia').CarouselSlide[];
  clientImages?: string[];
  templateId?: string;
  createdAt: Date;
  scheduled?: Date;
  platform: 'instagram' | 'tiktok' | 'linkedin';
};

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_SWITCHES_DEFAULT: AgentSwitch = {
  daniel: true,
  paulo: true,
  maria: false,
  autoSchedule: false,
};

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', emoji: '📸' },
  { value: 'tiktok', label: 'TikTok', emoji: '🎵' },
  { value: 'linkedin', label: 'LinkedIn', emoji: '💼' },
] as const;

const CONTENT_TYPES = [
  { value: 'carousel', label: 'Carrossel', emoji: '🎠' },
  { value: 'reel_script', label: 'Script de Reel', emoji: '🎬' },
  { value: 'post', label: 'Post Estático', emoji: '🖼️' },
  { value: 'story', label: 'Story', emoji: '⭕' },
] as const;

const INSTAGRAM_REGEX = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/;

// Carousel type options for the V2 generator
const CAROUSEL_TYPES = [
  { value: 'educacional',  label: 'Educacional',    emoji: '📚', icon: BookOpen },
  { value: 'lista',        label: 'Lista',          emoji: '📋', icon: Layers },
  { value: 'storytelling', label: 'Storytelling',   emoji: '📖', icon: MessageSquare },
  { value: 'mitos',        label: 'Mitos & Verdades',emoji: '🔍', icon: AlertCircle },
  { value: 'passoapasso',  label: 'Passo a Passo',  emoji: '👣', icon: Footprints },
  { value: 'polemica',     label: 'Polêmico',       emoji: '🔥', icon: Flame },
] as const;

type CarouselTypeValue = typeof CAROUSEL_TYPES[number]['value'];

// CarouselViewer is now CarouselPageViewer from @/components/davi/CarouselPageViewer

function getSmartScheduleTime(): Date {
  const now = new Date();
  const hour = now.getHours();
  const next = new Date(now);
  const bestHours = [9, 12, 15, 18, 20];
  const nextHour = bestHours.find(h => h > hour) ?? 9;
  if (nextHour <= hour) next.setDate(next.getDate() + 1);
  next.setHours(nextHour, 0, 0, 0);
  return next;
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#\w+/g);
  return matches ? matches.slice(0, 10) : [];
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DaviSocialMedia() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { posts, schedulePost, saveDraft, fetchPosts, generateCarousel, generateCarouselV2 } = useSocialMedia();
  const { getHistory } = useAgentChat();

  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'welcome',
    role: 'davi',
    content: '👋 Oi! Sou o DAVI — sua máquina automática de conteúdo viral. Cole um link do Instagram, me fale um tema ou clique em **Modo Automático** para eu criar tudo sozinho. 🚀',
    timestamp: new Date(),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [switches, setSwitches] = useState<AgentSwitch>(AGENT_SWITCHES_DEFAULT);
  const [platform, setPlatform] = useState<'instagram' | 'tiktok' | 'linkedin'>('instagram');
  const [contentType, setContentType] = useState<'carousel' | 'reel_script' | 'post' | 'story'>('carousel');
  const [library, setLibrary] = useState<GeneratedContent[]>(() => {
    try {
      const saved = localStorage.getItem('daviLibrary');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('daviLibrary', JSON.stringify(library));
  }, [library]);
  const [autoModeRunning, setAutoModeRunning] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('futurista_ia');
  const [carouselType, setCarouselType] = useState<CarouselTypeValue>('educacional');
  const [clientContext, setClientContext] = useState<{ name: string; produto: string; publico: string } | null>(null);
  const [briefingAlerta, setBriefingAlerta] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [pendingPauloCarousels, setPendingPauloCarousels] = useState<number>(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // ─── Instagram connection check ─────────────────────────────────────────
  const { data: igAccount } = useQuery({
    queryKey: ['ig-publisher-davi', user?.id],
    queryFn: async () => {
      // Prioridade: conexao dedicada "instagram_publisher"
      const { data } = await supabase
        .from('connected_accounts' as any)
        .select('*')
        .eq('platform', 'instagram_publisher')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (data) {
        const d = data as any;
        return { connected: true, ig_account_id: d.account_id, username: d.account_name };
      }

      // Fallback: antiga conexao via Meta Ads
      const { data: meta } = await supabase
        .from('ad_accounts' as any)
        .select('extra_data')
        .eq('platform', 'meta')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .maybeSingle();
        
      const m = meta as any;
      if (m?.extra_data?.ig_account_id) {
         return { connected: true, ig_account_id: m.extra_data.ig_account_id, username: 'meta' };
      }

      return { connected: false };
    },
    enabled: !!user,
  });

  // ─── Load client context ─────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('client_briefings' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          setClientContext({
            name: (data as any).client_name || (data as any).business_name || 'Cliente',
            produto: (data as any).product_service || (data as any).produto || '',
            publico: (data as any).target_audience || (data as any).publico || '',
          });
          setBriefingAlerta(false);
        } else {
          setBriefingAlerta(true);
        }
      } catch {
        // No client context available
      }
    };
    load();
  }, [user]);

  // ─── Load posts & Paulo queue ────────────────────────────────────────────────
  useEffect(() => {
    fetchPosts();
    checkPauloQueue();
    const interval = setInterval(checkPauloQueue, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const checkPauloQueue = async () => {
    if (!user) return;
    try {
      const { data, error, count } = await supabase
        .from('paulo_carousels' as any)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'ready_for_davi');
      if (!error && count !== null) {
        setPendingPauloCarousels(count);
      }
    } catch { }
  };

  // ─── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── Message helpers ─────────────────────────────────────────────────────

  const addDaviMessage = (content: string): string => {
    const id = Date.now().toString() + Math.random();
    setMessages(prev => [...prev, { id, role: 'davi', content, timestamp: new Date() }]);
    return id;
  };

  const addUserMessage = (content: string) => {
    const id = Date.now().toString() + Math.random();
    setMessages(prev => [...prev, { id, role: 'user', content, timestamp: new Date() }]);
  };

  const addStepsMessage = (steps: AutoModeStep[]): string => {
    const id = Date.now().toString() + Math.random();
    setMessages(prev => [...prev, { id, role: 'system', content: '', timestamp: new Date(), steps: [...steps] }]);
    return id;
  };

  const updateStep = (msgId: string, stepId: string, status: AutoModeStep['status'], output?: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.steps) return m;
      return { ...m, steps: m.steps.map(s => s.id === stepId ? { ...s, status, output: output || s.output } : s) };
    }));
  };

  const addContentCard = (msgId: string, content: GeneratedContent) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, contentCard: content } : m));
  };

  const addToLibrary = (content: GeneratedContent) => {
    setLibrary(prev => [content, ...prev]);
  };

  const updateContentCardTemplate = (msgId: string, templateId: TemplateId) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId || !m.contentCard) return m;
      return { ...m, contentCard: { ...m.contentCard, templateId } };
    }));
  };

  // ─── Upload multiple client photos ──────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !user) return;
    setUploadingPhoto(true);
    try {
      const newUrls: string[] = [];
      for (const file of files) {
        // Usa object URL para preview local imediato
        const objectUrl = URL.createObjectURL(file);
        newUrls.push(objectUrl);
      }
      setAttachedImages(prev => [...prev, ...newUrls]);
    } catch (err: any) {
      toast({ title: 'Erro', description: 'Erro ao processar imagem', variant: 'destructive' });
    } finally {
      setUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePublishNow = async (content: GeneratedContent) => {
    if (!igAccount?.connected) {
      toast({ title: '⚠️ Instagram não conectado', description: 'Vá em Integrações e conecte o Instagram Business para publicar.', variant: 'destructive' });
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const { data: post, error: saveError } = await supabase
        .from('social_posts' as any)
        .insert({
          user_id: user?.id,
          caption: content.fullContent || content.preview,
          hashtags: [],
          post_type: content.type === 'carousel' ? 'carousel' : 'single',
          platform: content.platform,
          status: 'draft',
          content_data: { slides: content.slides, title: content.title },
        } as any)
        .select('id')
        .single();

      if (saveError || !post) throw new Error('Erro ao salvar post');

      toast({ title: '📤 Publicando...', description: 'Enviando para o Instagram...' });

      const { data: publishResult, error: publishError } = await supabase.functions.invoke('social-media-api', {
        body: { action: 'publish_post', post_id: (post as any).id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (publishError || publishResult?.error) {
        throw new Error(publishResult?.error || publishError?.message || 'Erro ao publicar');
      }

      toast({ title: '✅ Publicado no Instagram!', description: `Post "${content.title}" publicado com sucesso.` });
    } catch (err: any) {
      toast({ title: 'Erro ao publicar', description: err.message, variant: 'destructive' });
    }
  };

  // ─── API Calls ───────────────────────────────────────────────────────────

  const callDanielApi = async (payload: Record<string, unknown>): Promise<any> => {
    const { data, error } = await supabase.functions.invoke('daniel-strategy-api', { body: payload });
    if (error) {
      const fallback = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: [{ role: 'user', content: `Como estrategista de marketing digital, ${JSON.stringify(payload).slice(0, 200)}` }],
          context: 'assistant',
        },
      });
      return fallback.data?.choices?.[0]?.message?.content || null;
    }
    return data;
  };

  const callPauloApi = async (prompt: string, sw: AgentSwitch): Promise<string> => {
    const ctx = clientContext;
    const contextStr = ctx
      ? `Cliente: ${ctx.name}\nProduto: ${ctx.produto}\nPúblico: ${ctx.publico}`
      : 'Contexto: agência de marketing digital';

    const { data, error } = await supabase.functions.invoke('claude-chat', {
      body: {
        messages: [{ role: 'user', content: prompt }],
        context: 'paulo',
        config: {
          description: contextStr,
          platform,
          tone: 'persuasivo',
          creativity: 0.85,
        },
      },
    });
    if (error) throw new Error(error.message);
    return data?.choices?.[0]?.message?.content || '';
  };

  // ─── Flow: Instagram link ─────────────────────────────────────────────────

  const processInstagramLink = async (url: string, postId: string) => {
    addDaviMessage(`🔍 Link do Instagram detectado! Vou analisar o estilo e criar algo similar para o cliente ${clientContext?.name || ''}...`);

    const steps: AutoModeStep[] = [
      { id: '1', agent: 'daniel', label: 'Daniel analisando estilo do post...', status: switches.daniel ? 'running' : 'skipped' },
      { id: '2', agent: 'paulo', label: 'Paulo criando conteúdo similar...', status: 'waiting' },
    ];

    const stepMsgId = addStepsMessage(steps);

    try {
      let danielAnalysis = '';

      if (switches.daniel) {
        updateStep(stepMsgId, '1', 'running');
        const danielResult = await callDanielApi({
          action: 'analyze_reference',
          reference_url: url,
          context: `Analise o estilo, tom, estrutura e tipo de conteúdo deste post do Instagram (ID: ${postId}). Extraia: formato, tom de voz, tamanho do texto, uso de emojis, tipo de hook, estrutura narrativa.`,
        });
        danielAnalysis = typeof danielResult === 'string'
          ? danielResult
          : danielResult?.analysis || JSON.stringify(danielResult || '');
        updateStep(stepMsgId, '1', 'completed', danielAnalysis.slice(0, 100) || 'Análise concluída');
      } else {
        updateStep(stepMsgId, '1', 'skipped');
      }

      if (switches.paulo) {
        updateStep(stepMsgId, '2', 'running');
        const prompt = `Analisei um post do Instagram (${url}). ${danielAnalysis ? `Estilo identificado: "${danielAnalysis.slice(0, 200)}". ` : ''}Com base no estilo, crie um ${contentType === 'carousel' ? 'carrossel de 7 slides' : contentType === 'reel_script' ? 'script de Reel de 30-60s' : 'post'} similar para ${clientContext?.name || 'nosso cliente'}. Produto: ${clientContext?.produto || 'nosso produto'}. Público: ${clientContext?.publico || 'nosso público'}.`;
        const pauloResult = await callPauloApi(prompt, switches);
        updateStep(stepMsgId, '2', 'completed', 'Copy criada!');

        const content: GeneratedContent = {
          id: Date.now().toString(),
          type: contentType,
          title: `Inspirado em Instagram — ${new Date().toLocaleDateString('pt-BR')}`,
          preview: pauloResult.slice(0, 120),
          fullContent: pauloResult,
          createdAt: new Date(),
          platform,
        };

        addContentCard(stepMsgId, content);
        addToLibrary(content);
      } else {
        updateStep(stepMsgId, '2', 'skipped');
      }
    } catch (err: any) {
      addDaviMessage(`❌ Erro ao processar o link: ${err.message}`);
    }
  };

  // ─── Flow: Auto Mode ──────────────────────────────────────────────────────

  const runAutoMode = async () => {
    if (autoModeRunning) return;

    // ── Verificação de briefing ──────────────────────
    if (!clientContext || !clientContext.produto) {
      setBriefingAlerta(true);
      toast({
        title: '⚠️ Briefing não preenchido',
        description: 'Vá ao Salomão e preencha o briefing do cliente antes de rodar o Fluxo Automático.',
        variant: 'destructive',
      });
      return;
    }

    setAutoModeRunning(true);

    const steps: AutoModeStep[] = [
      switches.daniel ? { id: 'daniel', agent: 'daniel' as const, label: '🧠 Daniel pesquisando tendências...', status: 'waiting' as const } : null,
      switches.paulo  ? { id: 'paulo',  agent: 'paulo'  as const, label: '✍️ Paulo escrevendo roteiro...',    status: 'waiting' as const } : null,
      switches.maria  ? { id: 'maria',  agent: 'maria'  as const, label: '🎨 Maria criando visual...',        status: 'waiting' as const } : null,
      switches.autoSchedule ? { id: 'davi', agent: 'davi' as const, label: '📅 DAVI agendando publicação...', status: 'waiting' as const } : null,
    ].filter(Boolean) as AutoModeStep[];

    addDaviMessage('⚡ Modo Automático iniciado! Acompanhe cada etapa em tempo real:');
    const stepMsgId = addStepsMessage(steps);

    try {
      let danielInsights = '';
      let pauloContent = '';

      // Step 1: Daniel
      if (switches.daniel) {
        updateStep(stepMsgId, 'daniel', 'running');
        const result = await callDanielApi({
          action: 'generate_strategy',
          briefing: {
            business: clientContext?.name || 'Agência',
            product: clientContext?.produto || 'Serviço',
            audience: clientContext?.publico || 'Empreendedores',
            platform,
            content_type: contentType,
            goal: 'Criar conteúdo viral para redes sociais com alta taxa de engajamento',
          },
        });
        // ── Fix: garantir que danielInsights é sempre string ──
        danielInsights = typeof result === 'string'
          ? result
          : typeof result?.strategy === 'string'
            ? result.strategy
            : typeof result?.content === 'string'
              ? result.content
              : result?.strategy || result?.content
                ? JSON.stringify(result?.strategy || result?.content)
                : 'Tendências identificadas';
        updateStep(stepMsgId, 'daniel', 'completed', String(danielInsights).slice(0, 80));
      }

      // Step 2: Paulo (or carousel generator)
      if (switches.paulo) {
        updateStep(stepMsgId, 'paulo', 'running');

        if (contentType === 'carousel') {
          const topic = danielInsights
            ? danielInsights.slice(0, 200)
            : clientContext?.produto || 'marketing digital';
          const carousel = await generateCarousel({
            topic,
            audience: clientContext?.publico || 'empreendedores',
            tone: 'persuasivo',
            slide_count: 7,
            include_cta: true,
            brand_name: clientContext?.name,
          });
          if (carousel) {
            pauloContent = carousel.caption + (carousel.hashtags?.length ? '\n\n' + carousel.hashtags.join(' ') : '');
            // Attach slides to the content to be saved
            const autoCarouselContent: GeneratedContent = {
              id: Date.now().toString(),
              type: 'carousel',
              title: `Carrossel Auto — ${new Date().toLocaleDateString('pt-BR')}`,
              preview: carousel.cover_headline || carousel.slides[0]?.headline || topic.slice(0, 80),
              fullContent: pauloContent,
              slides: carousel.slides,
              templateId: selectedTemplate,
              createdAt: new Date(),
              scheduled: switches.autoSchedule ? getSmartScheduleTime() : undefined,
              platform,
            };
            addContentCard(stepMsgId, autoCarouselContent);
            addToLibrary(autoCarouselContent);
          }
          updateStep(stepMsgId, 'paulo', 'completed', `${carousel?.slides.length || 0} slides criados!`);
        } else {
          const prompt = switches.daniel && danielInsights
            ? `Com base nesta estratégia do Daniel: "${danielInsights.slice(0, 300)}", crie um ${contentType === 'reel_script' ? 'script completo de Reel (30-60 segundos) com hook, desenvolvimento e CTA' : 'post completo com caption e hashtags'} para ${platform} sobre ${clientContext?.produto || 'nosso produto'}. Público: ${clientContext?.publico || 'nosso público'}.`
            : `Crie um ${contentType} para ${platform} sobre ${clientContext?.produto || 'nosso produto'}. Público: ${clientContext?.publico || 'nosso público'}.`;
          pauloContent = await callPauloApi(prompt, switches);
          updateStep(stepMsgId, 'paulo', 'completed', 'Roteiro pronto!');
        }
      }

      // Step 3: Maria
      if (switches.maria) {
        updateStep(stepMsgId, 'maria', 'running');
        await supabase.functions.invoke('generate-creative', {
          body: {
            prompt: `Brief para ${contentType} de ${platform}: ${pauloContent.slice(0, 300)}`,
            style: 'modern_dark',
            format: contentType === 'carousel' ? '1080x1080' : '1080x1920',
          },
        });
        updateStep(stepMsgId, 'maria', 'completed', 'Arte criada!');
      }

      // Step 4: DAVI schedules
      if (switches.autoSchedule && pauloContent) {
        updateStep(stepMsgId, 'davi', 'running');
        const scheduleTime = getSmartScheduleTime();

        // Save draft first to get a post ID, then schedule it
        const draft = await saveDraft({
          platform: platform === 'tiktok' || platform === 'linkedin' ? 'instagram' : platform,
          post_type: contentType === 'carousel' ? 'carousel' : contentType === 'reel_script' ? 'reel' : contentType === 'story' ? 'story' : 'single_image',
          caption: pauloContent.slice(0, 2000),
          hashtags: extractHashtags(pauloContent),
        });

        if (draft?.id) {
          await schedulePost(draft.id, scheduleTime.toISOString());
        }

        updateStep(stepMsgId, 'davi', 'completed', `Agendado para ${scheduleTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
      }

      // Save to library (only for non-carousel — carousel is handled in Step 2)
      if (contentType !== 'carousel') {
        const content: GeneratedContent = {
          id: Date.now().toString(),
          type: contentType,
          title: `${contentType === 'reel_script' ? 'Script Reel' : 'Post'} — ${new Date().toLocaleDateString('pt-BR')}`,
          preview: (pauloContent || danielInsights).slice(0, 120),
          fullContent: pauloContent || danielInsights,
          createdAt: new Date(),
          scheduled: switches.autoSchedule ? getSmartScheduleTime() : undefined,
          platform,
        };
        addContentCard(stepMsgId, content);
        addToLibrary(content);
      }

      addDaviMessage('✅ Modo Automático concluído! O conteúdo foi salvo na Biblioteca.');
    } catch (err: any) {
      addDaviMessage(`❌ Erro no Modo Automático: ${err.message}`);
    } finally {
      setAutoModeRunning(false);
    }
  };

  // ─── Flow: Manual Chat ────────────────────────────────────────────────────
  const runManualChat = async (text: string) => {
    const isActuallyCarousel = contentType === 'carousel' || text.toLowerCase().includes('carrossel'); 
    
    // If the user attached images and it's NOT a carousel, interpret it as a Native Canvas Product request.
    if (attachedImages.length > 0 && !isActuallyCarousel) {
      const progressId = addDaviMessage(`👨‍🎨 **Davi**: Fotos detectadas! Modelando layout comercial para a sua cópia...`);
      try {
        const _systemPrompt = `O usuário quer gerar um post de venda enviando fotos reais do produto/veículo e a descrição: "${text}". 
Sua tarefa é extrair e organizar isso em exatas 3 linhas (para um layout matemático de arte nativa).
Extraia as informações cruciais e responda EXATAMENTE com um objeto JSON e nada mais:
{
  "line1": "ex: NOME DO PRODUTO (max 20 chars, ex: TRACKER LT)",
  "line2": "ex: DESCRITIVO CURTO (ano, cor, km - ex: 2018 • 80mil km • Flex)",
  "line3": "ex: PREÇO (ex: R$ 107.990) ou CALL TO ACTION",
  "theme": "icom", // ou "minimal"
  "caption": "ex: Roteiro para a legenda social post"
}
Retorne APENAS JSON, sem \`\`\`json ou texto extra.`;

        const ctx = clientContext;
        const contextStr = ctx ? `Cliente: ${ctx.name}\nProduto: ${ctx.produto}` : '';

        // Import function dynamically to avoid circular issues
        const { generateNativeCanvas } = await import('@/components/davi/NativeCanvasRenderer');

        const { data, error } = await supabase.functions.invoke('claude-chat', {
          body: {
             messages: [{ role: 'user', content: _systemPrompt }],
             context: 'paulo',
             config: { description: contextStr, temperature: 0.2 }
          }
        });

        if (error) throw new Error(error.message);
        
        let resultJson = data?.choices?.[0]?.message?.content || '{}';
        // Clean markdown block if model disobeyed
        resultJson = resultJson.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const extracted = JSON.parse(resultJson);

        setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: `🖼️ **Layout Pronto!** Renderizando de forma nativa e ultra-rápida (Canvas)...` } : m));

        const base64Img = await generateNativeCanvas({
           images: attachedImages,
           line1: extracted.line1 || 'PRODUTO',
           line2: extracted.line2 || 'Detalhes do produto.',
           line3: extracted.line3 || 'Consulte preço',
           theme: extracted.theme || 'icom',
           footerText: clientContext?.name?.toUpperCase() || 'DAVI EXCLUSIVE'
        });

        const generated: GeneratedContent = {
           id: Date.now().toString(),
           type: 'post',
           title: `Oferta — ${text.slice(0, 20)}`,
           preview: base64Img,
           fullContent: extracted.caption || text,
           createdAt: new Date(),
           platform,
        };

        setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: `✨ **Arte de Produto Criada!** Zero atraso de IA e precisão máxima.`, contentCard: generated } : m));
        addToLibrary(generated);
        setAttachedImages([]); // Clear images after dispatch

        return;
      } catch (err: any) {
        setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: `❌ Falha ao processar imagens para a arte final: ${err.message}` } : m));
        return;
      }
    }

    if (isActuallyCarousel) {
      const progressId = addDaviMessage(`👨‍🎨 **Davi**: Analisando sua ideia e roteirizando as cenas do carrossel...`);
      const carousel = await generateCarouselV2({
        topic: text,
        audience: clientContext?.publico || 'empreendedores digitais',
        tone: 'persuasivo e direto',
        slide_count: 8,
        include_cta: true,
        brand_name: clientContext?.name,
        carousel_type: 'interativo',
        client_image_url: '',
      });

      if (!carousel) {
         setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: '❌ Erro ao gerar o roteiro visual. Verifique a conexão e tente novamente.' } : m));
         return;
      }

      setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: `🖼️ **Roteiro concluído!** Renderizando imagens (${carousel.slides.length} páginas)...` } : m));

      const generated: GeneratedContent = {
        id: Date.now().toString(),
        type: 'carousel',
        title: `Carrossel — ${text.slice(0, 30)}`,
        preview: carousel.cover_headline || carousel.slides[0]?.headline || text,
        fullContent: carousel.caption + (carousel.hashtags?.length ? '\n\n' + carousel.hashtags.map((h: string) => `#${h}`).join(' ') : ''),
        slides: carousel.slides,
        clientImages: attachedImages.length > 0 ? [...attachedImages] : [],
        templateId: selectedTemplate,
        createdAt: new Date(),
        platform,
      };

      setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: `✨ **Pronto!** Carrossel gerado e salvo na Biblioteca. Abra a lateral para visualizar.`, contentCard: generated } : m));
      addToLibrary(generated);
      if (attachedImages.length > 0) setAttachedImages([]);
    } else {
      const prompt = `Crie ${contentType === 'reel_script' ? `um script de Reel de 30-60 segundos para ${platform}` : `um post para ${platform}`} sobre: ${text}. Cliente: ${clientContext?.name || 'agência'}. Produto: ${clientContext?.produto || ''}. Público: ${clientContext?.publico || ''}.`;
      const content = await callPauloApi(prompt, switches);

      const generated: GeneratedContent = {
        id: Date.now().toString(),
        type: contentType,
        title: `${contentType} — ${text.slice(0, 30)}`,
        preview: content.slice(0, 120),
        fullContent: content,
        createdAt: new Date(),
        platform,
      };

      const msgId = addDaviMessage('✅ Aqui está o conteúdo criado:');
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, contentCard: generated } : m));
      addToLibrary(generated);
    }
  };

  const handleImportDanielResearch = async () => {
    try {
      setLoading(true);
      const history = await getHistory('daniel');
      const lastResearchMsg = [...history].reverse().find(m => m.metadata?.type === 'niche_research' && m.metadata?.research);
      
      if (lastResearchMsg && lastResearchMsg.metadata?.research) {
        const research = lastResearchMsg.metadata.research;
        
        let pautasStr = '';
        if (research.content_briefs && research.content_briefs.length > 0) {
          pautasStr = research.content_briefs.map((b: any, i: number) => {
            const hook = b.hook ? `Gancho: ${b.hook}\n` : '';
            const slides = b.slides_or_points ? `Estrutura do Carrossel:\n- ${b.slides_or_points.join('\n- ')}` : '';
            return `Pauta ${i + 1}: ${b.title}\n${hook}${slides}`;
          }).join('\n\n');
        } else {
          pautasStr = "Nenhuma pauta específica encontrada. Analise as tendências brutas.";
        }

        const actualPrompt = `Acabei de importar as pesquisas de tendência do Daniel para o nicho "${research.niche}".

Com base nas pautas do Daniel abaixo, crie opções de conteúdo de social media. 
**REGRA CRUCIAL:** PARA CADA PAUTA LISTADA, você deve criar obrigatoriamente um bloco [TIPO: POST_ESTATICO], um bloco [TIPO: CARROSSEL] e um bloco [TIPO: REEL]. Se houver 3 pautas, espero 3 blocos CARROSSEL no total.

Foque nas dores, desejos e objeções do público identificados na pesquisa:

${pautasStr}`;
        const displayPrompt = `🎯 Importando pesquisas do Daniel sobre "${research.niche}"...\nGerando posts, carrosséis e reels estratégicos.`;
        
        addUserMessage(displayPrompt);
        toast({ title: 'Pesquisa do Daniel importada!', description: 'Davi está processando os blocos de conteúdo...' });
        
        // Simular o envio do prompt estruturado
        const content = await callPauloApi(actualPrompt, switches);
        
        const generated: GeneratedContent = {
          id: Date.now().toString(),
          type: contentType, // Default visual do tipo selecionado no momento
          title: `Estratégia Daniel — ${research.niche}`,
          preview: content.slice(0, 120),
          fullContent: content,
          createdAt: new Date(),
          platform,
        };

        const msgId = addDaviMessage('✅ Pesquisa processada! Aqui estão as sugestões divididas por blocos:');
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, contentCard: generated } : m));
        addToLibrary(generated);
        
      } else {
        toast({ 
          title: 'Nenhuma pesquisa encontrada', 
          description: 'Gere a Busca de Tendências no DANIEL primeiro!', 
          variant: 'destructive' 
        });
      }
    } catch (err: any) {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleImportPaulo = async () => {
    try {
      setLoading(true);

      // ── 1. Try paulo_carousels table (Paulo 2.0 structured data) ────────
      const { data: pauloCarousels, error: pcError } = await supabase
        .from('paulo_carousels' as any)
        .select('*')
        .eq('user_id', user?.id)
        .eq('status', 'ready_for_davi')
        .order('created_at', { ascending: false })
        .limit(5);

      if (!pcError && pauloCarousels && pauloCarousels.length > 0) {
        const typeLabel = CAROUSEL_TYPES.find(t => t.value === carouselType)?.label || carouselType;
        addDaviMessage(`🎨 Paulo preparou **${pauloCarousels.length} carrossel(is)** prontos! Construindo o visual de cada um agora:`);

        for (let i = 0; i < pauloCarousels.length; i++) {
          const pauloCarousel = pauloCarousels[i] as any;
          const slides = pauloCarousel.slides || [];
          const progressMsgId = addDaviMessage(`🎨 Construindo visual de **${slides.length} slides** para o Carrossel: "${pauloCarousel.title}"...`);

          const isPersonal = attachedImages[0] || selectedTemplate === 'personal_brand';
          
          const visualSlides = await Promise.all(slides.map(async (slide: any, j: number) => {
            const order = slide.slide_number || (j + 1);
            const imgContext = slide.image_prompt || slide.headline || 'professional photography';
            const seed = ((slide.headline?.length || 10) * order * 42) % 100000;
            
            let bgImageUrlRaw = '';
            if (isPersonal) {
              const visualPrompt = encodeURIComponent(`${imgContext}, real editorial photography, authentic business professional, warm natural lighting, sharp focus, no text, 8K ultra detail`);
              bgImageUrlRaw = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1200&height=600&nologo=true&seed=${seed}&model=flux`;
            } else {
              const visualPrompt = encodeURIComponent(`${imgContext}, highly detailed photography, cinematic realistic, 4k resolution, professional, masterpiece, no text`);
              bgImageUrlRaw = `https://image.pollinations.ai/prompt/${visualPrompt}?width=1080&height=1350&nologo=true&seed=${seed}&model=flux`;
            }

            // Prefetch in parallel
            try {
              const img = new Image();
              img.src = bgImageUrlRaw;
            } catch (e) {}

            return {
              order,
              type: slide.type || (j === 0 ? 'cover' : j === slides.length - 1 ? 'cta' : 'content'),
              headline: slide.headline,
              body: slide.subtext || slide.body || '',
              cta: slide.type === 'cta' ? (slide.cta || 'Toque no link da bio') : '',
              image_prompt: slide.image_prompt,
              visual_cue: imgContext,
              image_url: bgImageUrlRaw,
            };
          }));

          const generated: GeneratedContent = {
            id: Date.now().toString() + i,
            type: 'carousel',
            title: `${pauloCarousel.title} — ${typeLabel}`,
            preview: slides[0]?.headline || pauloCarousel.title,
            fullContent: pauloCarousel.caption + (pauloCarousel.hashtags?.length ? '\n\n' + pauloCarousel.hashtags.map((h: string) => `#${h}`).join(' ') : ''),
            slides: visualSlides,
            templateId: selectedTemplate,
            createdAt: new Date(),
            platform,
            clientImages: attachedImages,
          };

          setMessages(prev => prev.map(m => m.id === progressMsgId ? {
            ...m,
            content: `✅ Carrossel ${i + 1}/${pauloCarousels.length} pronto! Navegue com as setas e escolha o template:`,
            contentCard: generated
          } : m));

          addToLibrary(generated);

          // Mark as in_production in paulo_carousels
          await supabase
            .from('paulo_carousels' as any)
            .update({ status: 'in_production' })
            .eq('id', pauloCarousel.id);

          if (i < pauloCarousels.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        setLoading(false);
        return;
      }

      // ── 2. Fallback: old chat history approach (Paulo 1.0 compatibility) ─
      const history = await getHistory('paulo');
      // Pega as últimas mensagens do assistente Paulo (excluir boas-vindas)
      const pauloMsgs = history.filter(m => m.role === 'assistant' && m.content.length > 50);
      if (pauloMsgs.length === 0) {
        toast({
          title: 'Nenhuma copy encontrada',
          description: 'Acesse o Paulo e gere algumas copies antes de importar aqui!',
          variant: 'destructive',
        });
        return;
      }
      
      const lastPaulo = pauloMsgs[pauloMsgs.length - 1];

      if (contentType === 'carousel') {
        const typeLabel = CAROUSEL_TYPES.find(t => t.value === carouselType)?.label || carouselType;
        
        // 1. Separar múltiplos carrosséis
        let rawBlocks = lastPaulo.content.match(/\[TIPO: CARROSSEL\]([\s\S]*?)(?=\[TIPO:|$)/gi);
        let carouselTexts: string[] = [];

        if (rawBlocks) {
          rawBlocks.forEach(block => {
            // Dividir internamente se houver "Pauta X:", "Ideia X:" ou "Opção X:" dentro do mesmo bloco
            const splits = block.split(/(?=Pauta \d|Ideia \d|Opção \d|\*\*(?:Pauta|Ideia|Opção) \d)/i);
            if (splits.length > 1) {
              splits.forEach(s => {
                if (s.replace(/\[TIPO: CARROSSEL\]/g, '').trim().length > 30) {
                  carouselTexts.push(s);
                }
              });
            } else {
              carouselTexts.push(block);
            }
          });
        } else {
          carouselTexts = [lastPaulo.content];
        }

        // Limite de segurança: no máximo 3 carrosséis por vez para não estourar tempo da Edge Function
        if (carouselTexts.length > 3) {
           carouselTexts = carouselTexts.slice(0, 3);
        }

        addDaviMessage(`🔄 Importando copy do Paulo. Encontramos **${carouselTexts.length} ideia(s)** de Carrossel. Vou construir o visual de cada um para você agora:`);
        
        for (let i = 0; i < carouselTexts.length; i++) {
          // Mensagem de progresso específica para este item
          const progressMsgId = addDaviMessage(`🎨 Criando visual do Carrossel ${i + 1}/${carouselTexts.length}...`);
          
          const copyText = carouselTexts[i];
          const carousel = await generateCarouselV2({
            topic: `Carrossel ${i + 1} baseado na copy do Paulo`,
            audience: clientContext?.publico || 'empreendedores digitais',
            tone: 'persuasivo e direto',
            slide_count: 8,
            include_cta: true,
            brand_name: clientContext?.name,
            carousel_type: carouselType,
            paul_copy: copyText,
          });

          // Se falhar um, avisa e continua para o próximo
          if (!carousel) {
             setMessages(prev => prev.map(m => m.id === progressMsgId ? { ...m, content: `❌ Falha ao gerar o visual do Carrossel ${i + 1}.` } : m));
             continue;
          }

          const generated: GeneratedContent = {
            id: Date.now().toString() + i,
            type: 'carousel',
            title: `Copy Paulo ${i + 1}/${carouselTexts.length} — ${typeLabel}`,
            preview: carousel.cover_headline || carousel.slides[0]?.headline || "Carrossel baseado na Copy",
            fullContent: carousel.caption + (carousel.hashtags?.length ? '\n\n' + carousel.hashtags.map((h: string) => `#${h}`).join(' ') : ''),
            slides: carousel.slides,
            templateId: selectedTemplate,
            createdAt: new Date(),
            platform,
          };

          // Atualiza a mensagem de progresso para a mensagem final com o card
          setMessages(prev => prev.map(m => m.id === progressMsgId ? { 
            ...m, 
            content: `✅ Carrossel ${i + 1}/${carouselTexts.length} pronto! Navegue com as setas e escolha o template:`,
            contentCard: generated 
          } : m));
          
          addToLibrary(generated);

          // Pequeno delay para não sobrecarregar e dar tempo do usuário ver
          if (i < carouselTexts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      } else {
        const generated: GeneratedContent = {
          id: Date.now().toString(),
          type: contentType,
          title: `Importado do Paulo — ${new Date().toLocaleDateString('pt-BR')}`,
          preview: lastPaulo.content.slice(0, 120),
          fullContent: lastPaulo.content,
          createdAt: new Date(),
          platform,
        };
        const msgId = addDaviMessage('✅ Copy do Paulo importada! Aqui está o conteúdo gerado:');
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, contentCard: generated } : m));
        addToLibrary(generated);
      }
      toast({ title: '✅ Importação concluída!', description: 'Conteúdo adicionado à sua biblioteca.' });
    } catch (err: any) {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ─── Main dispatch ────────────────────────────────────────────────────────

  const detectAndProcess = async (text: string) => {
    const instagramMatch = text.match(INSTAGRAM_REGEX);
    if (instagramMatch) {
      await processInstagramLink(text, instagramMatch[1]);
    } else if (text.toLowerCase().includes('modo automático') || text === '__auto__') {
      await runAutoMode();
    } else {
      await runManualChat(text);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || autoModeRunning) return;
    const text = input.trim();
    setInput('');
    addUserMessage(text);
    setLoading(true);
    try {
      await detectAndProcess(text);
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden">

        {/* ── LEFT PANEL ── */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Header Premium Clean */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/20 bg-background/60 backdrop-blur-xl shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-pink-500/10 to-purple-600/10 border border-pink-500/20 flex items-center justify-center shadow-inner">
                <Instagram className="h-5 w-5 text-pink-500" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h1 className="text-[17px] font-black text-foreground tracking-tight">DAVI</h1>
                  <span className="text-[9px] uppercase font-bold tracking-widest text-pink-500/80 bg-pink-500/10 px-2 py-0.5 rounded-full whitespace-nowrap border border-pink-500/20">
                    Social Media
                  </span>
                </div>
                {clientContext && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                    Briefing: <span className="text-pink-400 font-bold">{clientContext.name}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleImportPaulo}
                disabled={autoModeRunning || loading}
                className="h-9 px-4 bg-violet-500/5 hover:bg-violet-500/10 text-violet-400 border-violet-500/20 font-semibold text-xs rounded-full transition-all"
              >
                <PenTool className="h-3.5 w-3.5 mr-2" />
                Importar do Paulo
              </Button>

              {/* Client photo moved to chat input */ }

              <Button
                onClick={() => {
                  if (!clientContext?.produto) {
                    setBriefingAlerta(true);
                    toast({ title: '⚠️ Briefing não preenchido', description: 'Preencha o briefing no Salomão.', variant: 'destructive' });
                    return;
                  }
                  addUserMessage('⚡ Modo Automático');
                  detectAndProcess('__auto__');
                }}
                disabled={autoModeRunning || loading}
                className="h-9 px-5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold text-xs rounded-full shadow-md shadow-pink-500/20 transition-all transform hover:scale-105"
              >
                {autoModeRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5 fill-white" />}
                Auto-Piloto
              </Button>
            </div>
          </div>

          {/* Agent switches bar */}
          <div className="flex items-center gap-4 px-6 py-2 border-b border-border/30 bg-muted/5 flex-wrap">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Agentes ativos:</span>
            {([
              { key: 'daniel', emoji: '🧠', label: 'Daniel', color: 'text-blue-400' },
              { key: 'paulo', emoji: '✍️', label: 'Paulo', color: 'text-violet-400' },
              { key: 'maria', emoji: '🎨', label: 'Maria', color: 'text-pink-400' },
              { key: 'autoSchedule', emoji: '📅', label: 'Auto-Agendar', color: 'text-emerald-400' },
            ] as const).map(({ key, emoji, label, color }) => (
              <label key={key} className="flex items-center gap-1.5 cursor-pointer">
                <Switch
                  checked={switches[key]}
                  onCheckedChange={(v) => setSwitches(prev => ({ ...prev, [key]: v }))}
                  className="scale-75 data-[state=checked]:bg-pink-500"
                />
                <span className={`text-xs ${switches[key] ? color : 'text-muted-foreground/50'}`}>
                  {emoji} {label}
                </span>
              </label>
            ))}
          </div>

          {/* Alerta de briefing não preenchido */}
          {briefingAlerta && (
            <div className="mx-6 my-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center gap-3 text-sm text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Briefing não preenchido!</p>
                <p className="text-xs text-red-400/80">Para usar o Fluxo Automático, <a href="/salomao" className="underline font-medium">acesse o Salomão</a> e preencha o briefing do cliente.</p>
              </div>
            </div>
          )}

          {/* Instagram connection status */}
          {igAccount !== undefined && (
            <div className={`mx-6 my-2 rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-xs ${
              igAccount?.connected
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-400'
            }`}>
              <div className="flex items-center gap-2">
                <Instagram className="h-3.5 w-3.5 shrink-0" />
                {igAccount?.connected
                  ? `Instagram conectado${igAccount.username ? ` (@${igAccount.username})` : ''} — Davi pode publicar automaticamente`
                  : 'Instagram não conectado — conecte em Integrações para publicar'
                }
              </div>
              {!igAccount?.connected && (
                <a href="/integrations" className="text-amber-400 underline shrink-0">Conectar</a>
              )}
            </div>
          )}

          {/* Chat Area */}
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-4 max-w-3xl">
              {/* Notificação de Carrosséis do Paulo */}
              {pendingPauloCarousels > 0 && (
                <div className="bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-500/40 rounded-xl p-4 flex items-center justify-between mb-4 shadow-lg shadow-violet-500/10">
                  <div className="flex items-center gap-3">
                    <div className="bg-violet-500/20 p-2 rounded-lg">
                      <PenTool className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">
                        {pendingPauloCarousels} {pendingPauloCarousels === 1 ? 'Carrossel aprovado' : 'Carrosséis aprovados'} pelo Paulo!
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">O diretor criativo enviou novos roteiros. Quer gerar as imagens agora?</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleImportPaulo}
                    disabled={loading || autoModeRunning}
                    className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs border border-violet-500 px-4 h-9 shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all"
                  >
                    Gerar Visual Agora
                  </Button>
                </div>
              )}
              {messages.map(message => (
                <div key={message.id}>
                  {/* User message */}
                  {message.role === 'user' && (
                    <div className="flex justify-end">
                      <div className="max-w-[75%] bg-muted/60 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground">
                        {message.content}
                      </div>
                    </div>
                  )}

                  {/* DAVI message */}
                  {message.role === 'davi' && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-lg bg-pink-500/20 border border-pink-500/30 flex items-center justify-center shrink-0 mt-1">
                        <Instagram className="h-4 w-4 text-pink-400" />
                      </div>
                      <div className="flex-1">
                        <div className="bg-pink-500/5 border border-pink-500/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-foreground">
                          <MarkdownRenderer content={message.content} />
                        </div>
                        {/* Content card attached to davi message */}
                        {message.contentCard && (
                          <div className="mt-2 bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/20 rounded-xl p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <h4 className="text-sm font-semibold text-foreground">{message.contentCard.title}</h4>
                                <div className="flex gap-1 mt-1">
                                  <Badge className="text-[9px] py-0 px-1.5 bg-pink-500/20 text-pink-400 border-pink-500/20">{message.contentCard.platform}</Badge>
                                  <Badge className="text-[9px] py-0 px-1.5 bg-purple-500/20 text-purple-400 border-purple-500/20">{message.contentCard.type}</Badge>
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                                onClick={() => {
                                  navigator.clipboard.writeText(message.contentCard!.fullContent);
                                  toast({ title: '📋 Copiado!' });
                                }}
                              >
                                <Copy className="h-3 w-3" /> Copiar
                              </Button>
                            </div>
                            {message.contentCard.slides && message.contentCard.slides.length > 0 ? (
                              <div className="bg-background/50 rounded-xl p-4 flex flex-col items-center justify-center border border-border/50 shadow-inner">
                                <div className="text-4xl mb-2">📸</div>
                                <h5 className="font-bold text-sm text-foreground mb-1">Carrossel Salvo na Biblioteca!</h5>
                                <p className="text-[11px] text-muted-foreground text-center mb-3">
                                  As páginas do seu carrossel, incluindo a narrativa e visuais, foram geradas com sucesso.
                                </p>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 text-xs font-semibold w-full bg-pink-500/10 text-pink-400 hover:bg-pink-500/20"
                                >
                                  Abra a Biblioteca (lateral) para visualizar ou baixar
                                </Button>
                              </div>
                            ) : (
                              message.contentCard.preview.startsWith('data:image') ? (
                                <img src={message.contentCard.preview} alt="Gerado" className="rounded-lg shadow-sm border border-border/30 w-full object-contain max-h-[350px]" />
                              ) : (
                                <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{message.contentCard.preview}</p>
                              )
                            )}
                            {message.contentCard.scheduled && (
                              <p className="text-[10px] text-emerald-400 mt-2">
                                📅 Agendado para {message.contentCard.scheduled.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                              </p>
                            )}
                            <div className="mt-3">
                              <Button
                                size="sm"
                                className={`text-xs w-full ${igAccount?.connected ? 'gradient-primary text-primary-foreground' : 'opacity-50 cursor-not-allowed'}`}
                                onClick={() => message.contentCard && handlePublishNow(message.contentCard)}
                                title={igAccount?.connected ? 'Publicar agora no Instagram' : 'Conecte o Instagram primeiro'}
                              >
                                <Send className="h-3 w-3 mr-1" />
                                {igAccount?.connected ? 'Publicar no Instagram' : 'Instagram desconectado'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* System message with steps */}
                  {message.role === 'system' && message.steps && (
                    <div className="ml-11 space-y-2">
                      <div className="bg-background/60 border border-border/50 rounded-xl p-3 space-y-2">
                        {message.steps.map(step => (
                          <div key={step.id} className="flex items-center gap-2">
                            {step.status === 'waiting'   && <Clock        className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                            {step.status === 'running'   && <Loader2      className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />}
                            {step.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                            {step.status === 'failed'    && <XCircle      className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                            {step.status === 'skipped'   && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                            <span className={`text-xs ${step.status === 'running' ? 'text-foreground' : step.status === 'completed' ? 'text-emerald-400' : step.status === 'failed' ? 'text-red-400' : 'text-muted-foreground'}`}>
                              {step.label}
                            </span>
                            {step.output && (
                              <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">{step.output}</span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Generated content card */}
                      {message.contentCard && (
                        <div className="bg-gradient-to-br from-pink-500/10 to-purple-500/10 border border-pink-500/20 rounded-xl p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <h4 className="text-sm font-semibold text-foreground">{message.contentCard.title}</h4>
                              <div className="flex gap-1 mt-1">
                                <Badge className="text-[9px] py-0 px-1.5 bg-pink-500/20 text-pink-400 border-pink-500/20">{message.contentCard.platform}</Badge>
                                <Badge className="text-[9px] py-0 px-1.5 bg-purple-500/20 text-purple-400 border-purple-500/20">{message.contentCard.type}</Badge>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                navigator.clipboard.writeText(message.contentCard!.fullContent);
                                toast({ title: '📋 Copiado!' });
                              }}
                            >
                              <Copy className="h-3 w-3" /> Copiar
                            </Button>
                          </div>
                          {/* Carousel visual viewer - V2 page-based */}
                          {message.contentCard.slides && message.contentCard.slides.length > 0 ? (
                            <CarouselPageViewer
                              slides={message.contentCard.slides}
                              templateId={(message.contentCard.templateId as TemplateId) ?? 'futurista_ia'}
                              onTemplateChange={(tid) => updateContentCardTemplate(message.id, tid)}
                              brandName={clientContext?.name || 'Minha Marca'}
                              clientImages={message.contentCard.clientImages ?? []}
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{message.contentCard.preview}</p>
                          )}
                          {message.contentCard.scheduled && (
                            <p className="text-[10px] text-emerald-400 mt-2">
                              📅 Agendado para {message.contentCard.scheduled.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          )}
                          <div className="mt-3">
                            <Button
                              size="sm"
                              className={`text-xs w-full ${igAccount?.connected ? 'gradient-primary text-primary-foreground' : 'opacity-50 cursor-not-allowed'}`}
                              onClick={() => message.contentCard && handlePublishNow(message.contentCard)}
                              title={igAccount?.connected ? 'Publicar agora no Instagram' : 'Conecte o Instagram primeiro'}
                            >
                              <Send className="h-3 w-3 mr-1" />
                              {igAccount?.connected ? 'Publicar no Instagram' : 'Instagram desconectado'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/20 border border-pink-500/30 flex items-center justify-center shrink-0 mt-1">
                    <Instagram className="h-4 w-4 text-pink-400" />
                  </div>
                  <div className="bg-pink-500/5 border border-pink-500/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-pink-400" />
                    DAVI está criando...
                  </div>
                </div>
              )}

              <div ref={scrollRef} />
            </div>
          </ScrollArea>



          {/* Input Area Premium */}
          <div className="p-4 bg-background shrink-0 border-t border-border/20">
            <div className="max-w-3xl mx-auto flex flex-col gap-2 relative">
              
              <div className="relative flex flex-col bg-muted/20 border border-border/50 rounded-[24px] p-2 focus-within:border-pink-500/50 focus-within:ring-1 focus-within:ring-pink-500/20 transition-all shadow-sm">
                
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Cole ideias do Paulo, links do Instagram ou peça carrosséis..."
                  className="w-full min-h-[50px] max-h-[150px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm px-3 pt-3 pb-1"
                  rows={1}
                />

                <div className="flex items-center justify-between pt-2 px-1">
                  <div className="flex items-center gap-2">
                    <input
                      ref={photoRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                    
                    <button 
                      onClick={() => photoRef.current?.click()} 
                      className={`p-2 transition-colors rounded-full flex items-center justify-center ${
                        attachedImages.length > 0 ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                      title="Anexar Fotos do Produto (até 3 recomendadas) para Arte Premium"
                    >
                      {uploadingPhoto ? (
                         <Loader2 className="h-4 w-4 animate-spin" />
                      ) : attachedImages.length > 0 ? (
                         <Badge variant="secondary" className="bg-emerald-500 text-white border-0 py-0 px-1.5 rounded-full absolute -top-1 -right-1 text-[9px]">{attachedImages.length}</Badge>
                      ) : null}
                      <Camera className="h-4 w-4" />
                    </button>

                    {attachedImages.length > 0 && (
                      <div className="flex gap-1 items-center px-2 py-1 bg-muted/30 rounded-full border border-border/40">
                         {attachedImages.map((imgUrl, i) => (
                           <div key={i} className="relative w-6 h-6 rounded overflow-hidden shadow-sm group border border-border">
                             <img src={imgUrl} alt="Anexo" className="w-full h-full object-cover" />
                           </div>
                         ))}
                         <button
                           onClick={() => setAttachedImages([])}
                           className="text-red-500 p-1 hover:bg-red-500/10 rounded-full ml-1 m-0 transition-colors"
                           title="Remover todas as fotos anexadas"
                         >
                           <XIcon className="h-3 w-3" />
                         </button>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || loading || autoModeRunning}
                    size="icon"
                    className="h-9 w-9 rounded-full bg-pink-600 hover:bg-pink-700 text-white shadow-md disabled:opacity-40 transition-transform hover:scale-105"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
                  </Button>
                </div>
              </div>
              
              <p className="text-[10px] text-muted-foreground/40 text-center font-medium">
                Davi analisará o briefing e contexto automaticamente. Use Shift+Enter para quebrar linha.
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL (library) ── */}
        <div className="w-72 border-l border-border/50 flex flex-col bg-muted/5 shrink-0">
          <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-pink-400" />
              <span className="text-sm font-semibold">Biblioteca</span>
            </div>
            <Badge variant="outline" className="text-[10px]">{library.length} peças</Badge>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {library.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Layers className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Conteúdos gerados aparecem aqui</p>
                </div>
              )}
              {library.map(item => (
                <div
                  key={item.id}
                  className="bg-background/60 border border-border/50 rounded-xl p-3 group hover:border-pink-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div className="flex gap-1 flex-wrap">
                      <Badge className="text-[9px] py-0 px-1.5 bg-pink-500/15 text-pink-400 border-pink-500/20">{item.platform}</Badge>
                      <Badge className="text-[9px] py-0 px-1.5 bg-muted/50 text-muted-foreground border-border/30">{item.type}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive/70 hover:text-destructive"
                      onClick={() => setLibrary(prev => prev.filter(l => l.id !== item.id))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {item.preview?.startsWith('data:image') ? (
                    <img src={item.preview} alt="Arte" className="rounded-md w-full object-cover max-h-32 mb-2 border border-border/30 shadow-sm" />
                  ) : (
                    <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{item.preview}</p>
                  )}
                  {item.scheduled && (
                    <p className="text-[10px] text-emerald-400 mb-1.5">
                      📅 {new Date(item.scheduled).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  )}
                  {item.slides && item.slides.length > 0 ? (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full text-[10px] h-7 gap-1.5 mb-1 bg-pink-500/10 text-pink-400 hover:bg-pink-500/20"
                        >
                          <Eye className="h-3 w-3" /> Ver Carrossel Visual
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md bg-background/95 backdrop-blur-xl border-border/40 p-6 flex flex-col items-center max-h-[90vh] overflow-hidden">
                        <DialogHeader className="w-full text-center mb-2">
                          <DialogTitle className="text-sm font-bold">{item.title}</DialogTitle>
                        </DialogHeader>
                        <CarouselPageViewer
                          slides={item.slides}
                          templateId={(item.templateId as TemplateId) ?? 'futurista_ia'}
                          onTemplateChange={(tid) => {
                            // Update template in library item
                            setLibrary(prev => prev.map(l => l.id === item.id ? { ...l, templateId: tid } : l));
                            // Also update the message card if it exists
                            setMessages(prev => prev.map(m => m.contentCard?.id === item.id ? { ...m, contentCard: { ...m.contentCard, templateId: tid } } : m));
                          }}
                          brandName={clientContext?.name || 'Minha Marca'}
                          clientImages={item.clientImages ?? []}
                        />
                      </DialogContent>
                    </Dialog>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard.writeText(item.fullContent).then(() => toast({ title: '📋 Copiado!' }))}
                  >
                    <Copy className="h-3 w-3" /> {item.slides && item.slides.length > 0 ? 'Copiar Legenda' : 'Copiar Conteúdo'}
                  </Button>
                </div>
              ))}
            </div>

            {/* Scheduled posts section */}
            {posts.filter(p => p.status === 'scheduled').length > 0 && (
              <div className="px-3 pb-3">
                <Separator className="my-2" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                  Agendamentos para os próximos 7 dias
                </p>
                {/* Mini Calendar no Painel Lateral */}
                <div className="flex items-center gap-1 overflow-x-auto pb-3 mb-2">
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() + i);
                    const hasPost = posts.some(
                      p => p.status === 'scheduled' && new Date(p.scheduled_at || '').toDateString() === d.toDateString()
                    );
                    return (
                      <div
                        key={i}
                        className={`shrink-0 flex flex-col items-center px-2.5 py-1.5 rounded-lg cursor-pointer border transition-all ${hasPost ? 'bg-pink-500/20 border-pink-500/40' : 'bg-muted/30 border-border/40 hover:border-border'}`}
                      >
                        <span className="text-[9px] text-muted-foreground">{d.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase()}</span>
                        <span className={`text-sm font-bold ${hasPost ? 'text-pink-400' : 'text-foreground'}`}>{d.getDate()}</span>
                        {hasPost && <div className="w-1 h-1 rounded-full bg-pink-400 mt-0.5" />}
                      </div>
                    );
                  })}
                </div>
                {posts.filter(p => p.status === 'scheduled').slice(0, 3).map(post => (
                  <div key={post.id} className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 mb-1.5">
                    <p className="text-xs text-foreground line-clamp-2">{(post.caption || '').slice(0, 60)}...</p>
                    <p className="text-[10px] text-blue-400 mt-1">
                      📅 {new Date(post.scheduled_at || '').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

      </div>
    </MainLayout>
  );
}
