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
import { useSocialMedia, CarouselSlide } from '@/hooks/useSocialMedia';
import { useAgentChat } from '@/contexts/AgentChatContext';
import {
  Instagram, Zap, Loader2, Clock, CheckCircle2, XCircle, ChevronRight,
  Copy, Trash2, FolderOpen, Layers, Send, Link, ChevronLeft, Palette,
  Brain, AlertTriangle, PenTool
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';

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
  slides?: CarouselSlide[];
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

const CAROUSEL_TEMPLATES = [
  { id: 'dark_pro',  name: 'Dark Pro', bg: '#0D0D0D', accent: '#7C3AED', text: '#FFFFFF', sub: '#A1A1AA' },
  { id: 'gold',      name: 'Gold',     bg: '#1A1000', accent: '#DAA520', text: '#FFFFFF', sub: '#B8860B' },
  { id: 'ocean',     name: 'Ocean',    bg: '#0C1445', accent: '#00B4D8', text: '#FFFFFF', sub: '#90E0EF' },
  { id: 'forest',    name: 'Forest',   bg: '#0D1F0D', accent: '#22C55E', text: '#FFFFFF', sub: '#86EFAC' },
  { id: 'sunset',    name: 'Sunset',   bg: '#1F0D0D', accent: '#F97316', text: '#FFFFFF', sub: '#FED7AA' },
  { id: 'royal',     name: 'Royal',    bg: '#1A0D1F', accent: '#EC4899', text: '#FFFFFF', sub: '#F9A8D4' },
  { id: 'minimal',   name: 'Minimal',  bg: '#FFFFFF', accent: '#18181B', text: '#18181B', sub: '#71717A' },
  { id: 'rose',      name: 'Rose',     bg: '#1F0D15', accent: '#F43F5E', text: '#FFFFFF', sub: '#FDA4AF' },
] as const;

type TemplateId = typeof CAROUSEL_TEMPLATES[number]['id'];

// ─── Carousel Viewer ─────────────────────────────────────────────────────────

interface CarouselViewerProps {
  slides: CarouselSlide[];
  templateId: TemplateId;
  onTemplateChange: (id: TemplateId) => void;
}

function CarouselViewer({ slides, templateId, onTemplateChange }: CarouselViewerProps) {
  const [current, setCurrent] = useState(0);
  const tpl = CAROUSEL_TEMPLATES.find(t => t.id === templateId) ?? CAROUSEL_TEMPLATES[0];
  const slide = slides[current];
  if (!slide) return null;

  return (
    <div className="mt-3 space-y-2">
      {/* Slide display */}
      <div
        className="relative rounded-xl overflow-hidden mx-auto"
        style={{ backgroundColor: tpl.bg, width: 280, height: 280 }}
      >
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 w-full h-[3px]" style={{ backgroundColor: tpl.accent }} />
        {/* Slide counter */}
        <div className="absolute top-3 right-3 text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ backgroundColor: tpl.accent + '33', color: tpl.accent }}>
          {current + 1}/{slides.length}
        </div>
        {/* Content */}
        <div className="flex flex-col justify-center h-full px-6 py-10 gap-3">
          <h3 className="text-base font-bold leading-tight" style={{ color: tpl.text }}>
            {slide.headline}
          </h3>
          <p className="text-xs leading-relaxed" style={{ color: tpl.sub }}>
            {slide.body}
          </p>
          {slide.cta && (
            <span className="self-start mt-1 px-3 py-1 rounded-lg text-[11px] font-semibold"
              style={{ backgroundColor: tpl.accent, color: tpl.bg }}>
              {slide.cta}
            </span>
          )}
        </div>
        {/* Left arrow */}
        {current > 0 && (
          <button onClick={() => setCurrent(p => p - 1)}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: tpl.accent + '55' }}>
            <ChevronLeft className="h-4 w-4" style={{ color: tpl.text }} />
          </button>
        )}
        {/* Right arrow */}
        {current < slides.length - 1 && (
          <button onClick={() => setCurrent(p => p + 1)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center"
            style={{ backgroundColor: tpl.accent + '55' }}>
            <ChevronRight className="h-4 w-4" style={{ color: tpl.text }} />
          </button>
        )}
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-1.5">
        {slides.map((_, i) => (
          <button key={i} onClick={() => setCurrent(i)}
            className={`h-1.5 rounded-full transition-all duration-200 ${i === current ? 'w-4 bg-pink-400' : 'w-1.5 bg-border hover:bg-muted-foreground'}`}
          />
        ))}
      </div>

      {/* Template picker */}
      <div className="flex items-center gap-2 justify-center">
        <Palette className="h-3 w-3 text-muted-foreground shrink-0" />
        <div className="flex gap-1.5">
          {CAROUSEL_TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onTemplateChange(t.id as TemplateId)} title={t.name}
              className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${t.id === templateId ? 'scale-125 border-white shadow-lg' : 'border-transparent opacity-60 hover:opacity-100 hover:scale-110'}`}
              style={{ backgroundColor: t.accent }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const { posts, schedulePost, saveDraft, fetchPosts, generateCarousel } = useSocialMedia();
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
  const [library, setLibrary] = useState<GeneratedContent[]>([]);
  const [autoModeRunning, setAutoModeRunning] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>('dark_pro');
  const [clientContext, setClientContext] = useState<{ name: string; produto: string; publico: string } | null>(null);
  const [briefingAlerta, setBriefingAlerta] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
          .single();
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

  // ─── Load posts ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPosts();
  }, []);

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
    if (contentType === 'carousel') {
      // Use structured carousel generator
      addDaviMessage('🎠 Gerando carrossel visual com slides estruturados...');
      const carousel = await generateCarousel({
        topic: text,
        audience: clientContext?.publico || 'empreendedores digitais',
        tone: 'persuasivo',
        slide_count: 7,
        include_cta: true,
        brand_name: clientContext?.name,
      });

      if (!carousel) return;

      const generated: GeneratedContent = {
        id: Date.now().toString(),
        type: 'carousel',
        title: `Carrossel — ${text.slice(0, 30)}`,
        preview: carousel.cover_headline || carousel.slides[0]?.headline || text,
        fullContent: carousel.caption + (carousel.hashtags?.length ? '\n\n' + carousel.hashtags.join(' ') : ''),
        slides: carousel.slides,
        templateId: selectedTemplate,
        createdAt: new Date(),
        platform,
      };

      const msgId = addDaviMessage(`✅ Carrossel criado com ${carousel.slides.length} slides! Use as setas para navegar e escolha um tema visual:`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, contentCard: generated } : m));
      addToLibrary(generated);
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

Com base nas pautas do Daniel abaixo, crie opções de conteúdo de social media divididas obrigatoriamente por blocos de tipo: [TIPO: POST_ESTATICO], [TIPO: CARROSSEL] e [TIPO: REEL].

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
      // Pegar a última geração do Paulo
      const lastPaulo = pauloMsgs[pauloMsgs.length - 1];
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
      toast({ title: '✅ Copy do Paulo importada!', description: 'Conteúdo adicionado à sua biblioteca.' });
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

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-background/95 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-600/20 border border-pink-500/30 flex items-center justify-center">
                <Instagram className="h-5 w-5 text-pink-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-foreground">DAVI</h1>
                  <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse mr-1.5 inline-block" />
                    Social Media IA
                  </Badge>
                </div>
                {clientContext && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Cliente: <span className="text-pink-400 font-medium">{clientContext.name}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap justify-end">
              {/* Platform selector */}
              <div className="flex gap-1">
                {PLATFORMS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setPlatform(p.value)}
                    className={`px-2 py-1 rounded-lg text-xs border transition-all ${platform === p.value ? 'bg-pink-500/20 text-pink-400 border-pink-500/40' : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-border'}`}
                  >
                    {p.emoji} {p.label}
                  </button>
                ))}
              </div>

              {/* Content type selector */}
              <div className="flex gap-1">
                {CONTENT_TYPES.map(ct => (
                  <button
                    key={ct.value}
                    onClick={() => setContentType(ct.value)}
                    className={`px-2 py-1 rounded-lg text-xs border transition-all ${contentType === ct.value ? 'bg-purple-500/20 text-purple-400 border-purple-500/40' : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-border'}`}
                  >
                    {ct.emoji} {ct.label}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                onClick={handleImportPaulo}
                disabled={autoModeRunning || loading}
                className="bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border-violet-500/30 gap-2 font-semibold text-xs"
              >
                <PenTool className="h-3.5 w-3.5" />
                Importar Paulo
              </Button>

              <Button
                onClick={() => {
                  if (!clientContext?.produto) {
                    setBriefingAlerta(true);
                    toast({ title: '⚠️ Briefing não preenchido', description: 'Preencha o briefing no Salomão antes de rodar o Fluxo Automático.', variant: 'destructive' });
                    return;
                  }
                  addUserMessage('⚡ Modo Automático');
                  detectAndProcess('__auto__');
                }}
                disabled={autoModeRunning || loading}
                className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white font-semibold gap-2 shadow-lg shadow-pink-500/20"
              >
                {autoModeRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Modo Automático
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
                            {/* Carousel visual viewer */}
                            {message.contentCard.slides && message.contentCard.slides.length > 0 ? (
                              <CarouselViewer
                                slides={message.contentCard.slides}
                                templateId={(message.contentCard.templateId as TemplateId) ?? 'dark_pro'}
                                onTemplateChange={(tid) => updateContentCardTemplate(message.id, tid)}
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
                          {/* Carousel visual viewer */}
                          {message.contentCard.slides && message.contentCard.slides.length > 0 ? (
                            <CarouselViewer
                              slides={message.contentCard.slides}
                              templateId={(message.contentCard.templateId as TemplateId) ?? 'dark_pro'}
                              onTemplateChange={(tid) => updateContentCardTemplate(message.id, tid)}
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

          {/* Mini Calendar strip */}
          <div className="px-6 py-2 border-t border-border/30 bg-background/50 shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0 mr-2">Calendário:</span>
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
          </div>

          {/* Input area */}
          <div className="px-4 pb-4 pt-2 border-t border-border/40 shrink-0">
            {/* Quick actions */}
            <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1">
              {[
                { emoji: '🎠', label: 'Criar Carrossel', action: 'Crie um carrossel viral de 7 slides' },
                { emoji: '🎬', label: 'Script de Reel', action: 'Escreva um script de Reel de 30 segundos com hook forte' },
                { emoji: '📊', label: 'Post de Autoridade', action: 'Crie um post educativo que demonstre autoridade no nicho' },
                { emoji: '🔥', label: 'Post Viral', action: 'Crie um post com alto potencial de viralização e compartilhamento' },
                { emoji: '💬', label: 'Story Interativo', action: 'Crie uma sequência de 3 Stories interativos com perguntas' },
              ].map(qa => (
                <button
                  key={qa.label}
                  onClick={() => { setInput(qa.action); inputRef.current?.focus(); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-pink-500/40 text-[11px] text-muted-foreground hover:text-foreground transition-all whitespace-nowrap"
                >
                  {qa.emoji} {qa.label}
                </button>
              ))}
            </div>

            {/* Main input */}
            <div className="relative flex items-end gap-2 bg-muted/30 border border-border/50 rounded-2xl p-2 focus-within:border-pink-500/50 transition-colors">
              {/* File/link upload button */}
              <button
                onClick={() => fileRef.current?.click()}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Anexar arquivo"
              >
                <Link className="h-4 w-4" />
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="image/*,video/*,audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setInput(prev => prev + ` [arquivo: ${file.name}]`);
                }}
              />

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
                placeholder="Cole um link do Instagram, descreva o conteúdo ou peça qualquer coisa... (Enter para enviar)"
                className="flex-1 min-h-[44px] max-h-[100px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm py-2 px-1"
                rows={1}
              />

              <Button
                onClick={handleSend}
                disabled={!input.trim() || loading || autoModeRunning}
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-pink-600 to-purple-600 hover:from-pink-700 hover:to-purple-700 text-white disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
              Cole links do Instagram para análise automática de estilo · Shift+Enter para nova linha
            </p>
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
                  <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{item.preview}</p>
                  {item.scheduled && (
                    <p className="text-[10px] text-emerald-400 mb-1.5">
                      📅 {item.scheduled.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => navigator.clipboard.writeText(item.fullContent).then(() => toast({ title: '📋 Copiado!' }))}
                  >
                    <Copy className="h-3 w-3" /> Copiar Conteúdo
                  </Button>
                </div>
              ))}
            </div>

            {/* Scheduled posts section */}
            {posts.filter(p => p.status === 'scheduled').length > 0 && (
              <div className="px-3 pb-3">
                <Separator className="my-2" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
                  Agendados ({posts.filter(p => p.status === 'scheduled').length})
                </p>
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
