import { useState, useRef, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Brain, Layers, ChevronDown, ChevronUp, Send, Trash2,
  RefreshCw, Copy, CheckCircle2, Zap, ArrowRight,
  Image, LayoutGrid, RotateCcw, Eye, EyeOff, Clock
} from 'lucide-react';
import { useAgentChat } from '@/contexts/AgentChatContext';
import { useAgentTasks } from '@/contexts/AgentTasksContext';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CarouselSlide {
  slide_number: number;
  type: 'cover' | 'content' | 'cta';
  headline: string;
  subtext?: string;
  image_prompt: string;
}

export interface PauloCarousel {
  id?: string;               // uuid from Supabase (present after save)
  user_id?: string;
  title: string;
  niche: string;
  angle: string;
  caption: string;
  hashtags: string[];
  slides: CarouselSlide[];
  source: 'manual' | 'daniel_import';
  status: 'draft' | 'ready_for_davi' | 'in_production';
  created_at?: string;
  daniel_research_id?: string;
}

type AngleType = 'storytelling' | 'lista' | 'provocacao' | 'mito_vs_verdade' | 'passo_a_passo' | 'polemica';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  carousels?: PauloCarousel[];
  isLoading?: boolean;
}

interface ClientContext {
  clientName: string;
  produto: string;
  publico: string;
  oferta: string;
  diferencial: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ANGLES: { value: AngleType; label: string; emoji: string; desc: string }[] = [
  { value: 'storytelling',    label: 'Storytelling',     emoji: '📖', desc: 'Narrativa com gancho emocional' },
  { value: 'lista',           label: 'Lista',             emoji: '📋', desc: 'X coisas que você precisa saber' },
  { value: 'provocacao',      label: 'Provocação',        emoji: '⚡', desc: 'Afirmação ousada que gera debate' },
  { value: 'mito_vs_verdade', label: 'Mito vs Verdade',   emoji: '🔍', desc: 'Quebre crenças do público' },
  { value: 'passo_a_passo',   label: 'Passo a Passo',     emoji: '👣', desc: 'Guia prático e acionável' },
  { value: 'polemica',        label: 'Polêmico',          emoji: '🔥', desc: 'Opinião contrária ao senso comum' },
];

const DEMO_CLIENT: ClientContext = {
  clientName: 'Demo — Conecte um cliente via Salomão',
  produto: 'Consultoria de Marketing Digital',
  publico: 'Empreendedores e PMEs que querem crescer online',
  oferta: 'Pacote completo de estratégia + execução por R$ 2.997/mês',
  diferencial: 'Resultado garantido em 90 dias ou devolução total',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCarouselsFromResponse(text: string): PauloCarousel[] {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ||
                    text.match(/\{[\s\S]*"carousels"[\s\S]*\}/) ||
                    text.match(/(\{[\s\S]*\})/);

  let jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
  jsonStr = jsonStr.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.carousels && Array.isArray(parsed.carousels)) {
      return parsed.carousels.map((c: any) => ({
        title: c.title || 'Carrossel sem título',
        niche: c.niche || '',
        angle: c.angle || 'storytelling',
        caption: c.caption || '',
        hashtags: Array.isArray(c.hashtags) ? c.hashtags : [],
        slides: Array.isArray(c.slides) ? c.slides : [],
        source: 'manual' as const,
        status: 'draft' as const,
      }));
    }
  } catch {
    // If JSON parse fails, return empty array — error will show in chat
  }
  return [];
}

function buildPauloSystemPrompt(ctx: ClientContext, angle: AngleType): string {
  return `Você é PAULO — Diretor Criativo de Carrosséis da LogosIA. Você é um mestre absoluto em criar carrosséis virais para Instagram que param o scroll, geram salvamentos em massa e constroem autoridade de marca.

## SEU NOVO PAPEL
Você não gera textos soltos. Você arquiteta carrosséis completos: cada slide com texto de alto impacto E um prompt de imagem AI-ready para o gerador de imagens.

## ESTILO DE REFERÊNCIA (grave isso no seu núcleo)
Analise estes exemplos de carrossel viral:

**Exemplo 1 — Storytelling com fato real:**
Slide 1 (capa): "Na Toyota, qualquer funcionário pode parar a fábrica INTEIRA apertando um botão."
Slide 2: "Não importa se é o cara do parafuso ou o estagiário do primeiro dia. Viu defeito? Puxa a corda."
Slide 3: "O resultado? A Toyota se tornou a montadora mais eficiente do planeta."
[Cada slide tem uma imagem fotorrealista que amplifica a narrativa]

**Exemplo 2 — Provocação + Reversão:**
Slide 1: "IA é perigosa, tem risco de segurança, vazamento de dados." 
Slide 2: "Essa é a maior objeção de quem ainda resiste. Vou te mandar a real: o problema não é a IA."
Slide 3: "O problema é quem tá operando. E eu vou te mostrar o passo a passo definitivo."

**Regras de ouro do estilo:**
- A COPY DE CADA SLIDE DEVE SER LONGA, PROFUNDA E DENSAMENTE PERSUASIVA. Esqueça carrosséis com apenas "uma frase". Eu quero parágrafos robustos que expliquem o "por que" de forma genial e mostrem domínio absoluto do assunto.
- Primeira linha do slide 1 = TUDO. Ela decide se rodam o dedo ou param. Tem que ser um soco no estômago (Hook agressivo/curioso).
- Cada slide de conteúdo (slides do meio) DEVE ter no mínimo 3 a 4 parágrafos de explicação técnica ou storytelling emocional. Nunca seja raso. Aprofunde-se na dor.
- Use fatos específicos, números reais e neurociência da persuasão — nunca generalizações vazias ou dicas de "ChatGPT genérico".
- O CTA final deve ser um Ultimato Irresistível.
- Legenda do post (Caption): ESCOLHA PALAVRAS AGRESSIVAS de marketing direto. O caption precisa ser um manifesto persuasivo de 5 parágrafos de puro valor, terminando com o CTA.

## CONTEXTO DO CLIENTE
Cliente: ${ctx.clientName}
Produto/Serviço: ${ctx.produto}
Público-alvo: ${ctx.publico}
Oferta principal: ${ctx.oferta}
Diferencial: ${ctx.diferencial}

## ÂNGULO SOLICITADO
${ANGLES.find(a => a.value === angle)?.label || angle}: ${ANGLES.find(a => a.value === angle)?.desc || ''}

## PROMPTS DE IMAGEM — NÍVEL DIRETOR DE ARTE (O MAIS IMPORTANTE)
Cada slide deve ter um prompt de imagem cinematográfico, denso e detalhado em INGLÊS.
Você deve agir como um fotógrafo premiado e um diretor de arte de agência de luxo.

**Estrutura obrigatória de cada prompt:**
1. **Sujeito e Ação**: Detalhe exatamente quem/o que está na cena.
2. **Ambiente e Composição**: Use termos como "ultra-wide angle", "macro close-up", "low angle shot".
3. **Iluminação**: Detalhe a luz: "volumetric lighting", "golden hour", "soft studio box", "cinematic moody shadows".
4. **Equipamento e Estilo**: Cite câmeras: "shot on Fujifilm GFX 100", "85mm lens", "f/1.2 bokeh".
5. **Atmosfera**: Adicione "minimalist luxury", "vibrant commercial photography", "hyper-realistic textures".

Exemplo de prompt RUIM: "A person working in a factory"
Exemplo de prompt PAULO (Obrigatório): "Cinematic side-profile shot of a high-tech robotic assembly line at night, volumetric blue laser lighting cutting through subtle fog, soft amber glow from sparks, shallow depth of field, minimalist industrial aesthetic, 8K resolution, photorealistic, premium corporate photography style, no text on image"

## FORMATO DE SAÍDA OBRIGATÓRIO
Responda APENAS com JSON válido, sem texto antes ou depois, sem markdown (sem \`\`\`):

{
  "carousels": [
    {
      "title": "Título interno para identificação",
      "niche": "Nicho específico do conteúdo",
      "angle": "storytelling",
      "caption": "Legenda completa para o Instagram. Primeira frase = hook do caption. Depois desenvolva. Termina com CTA claro e hashtags separados abaixo.",
      "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
      "slides": [
        {
          "slide_number": 1,
          "type": "cover",
          "headline": "Texto do slide — direto, bold, curto. Máx 2 linhas.",
          "subtext": "Texto de apoio opcional. Uma linha.",
          "image_prompt": "Prompt detalhado em inglês para geração de imagem AI"
        },
        {
          "slide_number": 2,
          "type": "content",
          "headline": "Desenvolvimento da narrativa",
          "subtext": "Detalhe ou dado que reforça o headline",
          "image_prompt": "Prompt específico para este slide"
        }
      ]
    }
  ]
}

REGRAS:
1. Gere exatamente o número de carrosséis solicitado
2. Cada carrossel deve ter de 4 a 8 slides (ajuste ao tamanho da ideia)
3. O primeiro slide é sempre do tipo "cover"
4. O último slide é sempre do tipo "cta"
5. JSON deve ser 100% válido — sem vírgulas extras, sem caracteres especiais fora de strings
6. NUNCA inclua texto fora do JSON`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PauloAgente() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { createTask } = useAgentTasks();
  const { getHistory } = useAgentChat();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [angle, setAngle] = useState<AngleType>('storytelling');
  const [isDemo, setIsDemo] = useState(true);
  const [clientContext, setClientContext] = useState<ClientContext>(DEMO_CLIENT);
  const [expandedSlides, setExpandedSlides] = useState<Record<string, boolean>>({});
  const [showImagePrompts, setShowImagePrompts] = useState<Record<string, boolean>>({});
  const [savedCarousels, setSavedCarousels] = useState<PauloCarousel[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [recentResearches, setRecentResearches] = useState<any[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load client context & saved carousels
  useEffect(() => {
    loadClientContext();
    loadSavedCarousels();
    loadRecentResearches();
  }, [user]);

  // Welcome & Import check
  useEffect(() => {
    setMessages([{
      id: 'welcome',
      role: 'assistant',
      content: '🎬 Oi! Sou o Paulo — seu Diretor Criativo de Carrosséis.\n\nImporte a pesquisa do Daniel ou me diga o tema, e eu crio o roteiro completo: slide a slide, com texto de impacto e prompt de imagem pronto para o Davi gerar o visual.\n\nVamos criar algo que para o scroll? 🚀',
      timestamp: new Date(),
    }]);

    const briefStr = localStorage.getItem('daniel_selected_brief');
    if (briefStr) {
      try {
        const brief = JSON.parse(briefStr);
        let text = `Tema: ${brief.title}`;
        if (brief.hook) text += `\nHook Sugerido: ${brief.hook}`;
        if (brief.slides_or_points) {
          text += `\nPontos:\n${brief.slides_or_points.map((p: string, i: number) => `${i+1}. ${p}`).join('\n')}`;
        }
        if (brief.cta) text += `\nCTA: ${brief.cta}`;
        
        setInput(text);
        if (brief.angle) {
          const matchedAngle = ANGLES.find(a => brief.angle.toLowerCase().includes(a.value))?.value || 'storytelling';
          setAngle(matchedAngle as AngleType);
        }
        
        toast({ title: 'Pauta importada!', description: 'Pauta do Daniel carregada. Clique em gerar!' });
      } catch (e) {
        console.error('Error parsing brief', e);
      } finally {
        localStorage.removeItem('daniel_selected_brief');
      }
    }
  }, []);

  const loadClientContext = async () => {
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
          clientName: (data as any).client_name || (data as any).business_name || 'Cliente',
          produto: (data as any).product_service || (data as any).produto || '',
          publico: (data as any).target_audience || (data as any).publico || '',
          oferta: (data as any).main_offer || (data as any).oferta || '',
          diferencial: (data as any).differentiators || (data as any).diferencial || '',
        });
        setIsDemo(false);
      }
    } catch {
      setClientContext(DEMO_CLIENT);
      setIsDemo(true);
    }
  };

  const loadRecentResearches = async () => {
    try {
      const history = await getHistory('daniel');
      const researches = [...history]
        .filter(m => m.metadata?.type === 'niche_research' && m.metadata?.research)
        .reverse()
        .slice(0, 5)
        .map(m => ({ id: m.id, date: m.timestamp, research: m.metadata!.research }));
      setRecentResearches(researches);
    } catch {
      setRecentResearches([]);
    }
  };

  const loadSavedCarousels = useCallback(async () => {
    if (!user) return;
    setLoadingSaved(true);
    try {
      const { data } = await supabase
        .from('paulo_carousels' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (data) setSavedCarousels(data as unknown as PauloCarousel[]);
    } catch {
      // Table might not exist yet
    } finally {
      setLoadingSaved(false);
    }
  }, [user]);

  const saveCarouselToDb = async (carousel: PauloCarousel): Promise<string | null> => {
    if (!user) return null;
    try {
      const { data, error } = await supabase
        .from('paulo_carousels' as any)
        .insert({
          user_id: user.id,
          title: carousel.title,
          niche: carousel.niche,
          angle: carousel.angle,
          caption: carousel.caption,
          hashtags: carousel.hashtags,
          slides: carousel.slides,
          source: carousel.source,
          status: carousel.status,
          daniel_research_id: carousel.daniel_research_id || null,
        })
        .select('id')
        .single();

      if (error) throw error;
      return (data as any)?.id || null;
    } catch (err) {
      console.error('Error saving carousel:', err);
      return null;
    }
  };

  const sendToDavi = async (carouselId: string) => {
    try {
      await supabase
        .from('paulo_carousels' as any)
        .update({ status: 'ready_for_davi' })
        .eq('id', carouselId)
        .eq('user_id', user?.id);

      setSavedCarousels(prev =>
        prev.map(c => c.id === carouselId ? { ...c, status: 'ready_for_davi' as const } : c)
      );
      toast({ title: '🎨 Enviado para o Davi!', description: 'O Davi já pode puxar esse carrossel para gerar o visual.' });
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeleteCarousel = async (carouselId: string) => {
    if (!user) return;
    try {
      await supabase
        .from('paulo_carousels' as any)
        .delete()
        .eq('id', carouselId)
        .eq('user_id', user.id);

      setSavedCarousels(prev => prev.filter(c => c.id !== carouselId));
      toast({ title: 'Ideia excluída!', description: 'O carrossel foi removido da sua biblioteca.' });
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err.message, variant: 'destructive' });
    }
  };

  const generateCarousels = async (
    userDisplayText: string,
    fullPrompt: string,
    source: 'manual' | 'daniel_import',
    danielResearchId?: string
  ) => {
    if (loading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userDisplayText,
      timestamp: new Date(),
    };

    const loadingMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const systemPrompt = buildPauloSystemPrompt(clientContext || DEMO_CLIENT, angle);

      const taskId = await createTask('paulo', 'generate_carousel', {
        input: fullPrompt,
        angle,
        source,
      });

      const { data, error } = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: [{ role: 'user', content: fullPrompt }],
          context: 'paulo',
          stream: false,
          task_id: taskId,
          config: {
            description: systemPrompt,
            creativity: 0.85,
          },
        },
      });

      if (error) throw new Error(error.message || 'Erro na Edge Function');
      if (!data?.choices?.[0]?.message?.content) throw new Error('Resposta vazia da IA');

      const rawContent = data.choices[0].message.content;
      const carousels = parseCarouselsFromResponse(rawContent);

      if (carousels.length === 0) {
        throw new Error(`A IA não retornou JSON válido. Resposta bruta: ${rawContent.slice(0, 200)}`);
      }

      // Enrich & save each carousel
      const savedCarouselsNew: PauloCarousel[] = [];
      for (const carousel of carousels) {
        const enriched: PauloCarousel = {
          ...carousel,
          source,
          status: 'draft',
          daniel_research_id: danielResearchId,
        };
        const newId = await saveCarouselToDb(enriched);
        savedCarouselsNew.push({ ...enriched, id: newId || undefined });
      }

      // Update loading message with results
      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? {
              ...m,
              isLoading: false,
              content: `✅ **${carousels.length} carrossel${carousels.length > 1 ? 'is' : ''} criado${carousels.length > 1 ? 's' : ''}!** Revise os slides abaixo, ajuste o que quiser e envie para o Davi gerar o visual.`,
              carousels: savedCarouselsNew,
            }
          : m
      ));

      setSavedCarousels(prev => [...savedCarouselsNew.filter(c => c.id), ...prev] as PauloCarousel[]);

    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === loadingMsg.id
          ? {
              ...m,
              isLoading: false,
              content: `🚨 **Erro ao gerar carrosséis:**\n${err?.message || 'Erro desconhecido'}\n\nTente novamente.`,
            }
          : m
      ));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const topic = input.trim();
    setInput('');

    const angleLabel = ANGLES.find(a => a.value === angle)?.label || angle;
    const fullPrompt = `Gere 1 carrossel no ângulo "${angleLabel}" sobre o seguinte tema para o nicho do cliente:

TEMA: ${topic}

CLIENTE: ${clientContext?.clientName || 'Demo'}
PRODUTO: ${clientContext?.produto || 'Produto'}
PÚBLICO: ${clientContext?.publico || 'Público geral'}
OFERTA: ${clientContext?.oferta || ''}
DIFERENCIAL: ${clientContext?.diferencial || ''}

Mantenha o número de slides entre 4 e 8, ajustando ao tamanho natural da ideia. Qualidade máxima. JSON puro.`;

    await generateCarousels(
      `🎯 Criando carrossel sobre: "${topic}" — Ângulo: ${angleLabel}`,
      fullPrompt,
      'manual'
    );
  };

  const handleImportDaniel = async (researchMsgId: string) => {
    if (loading) return;
    setLoading(true);

    try {
      const history = await getHistory('daniel');
      const researchMsg = history.find(m => m.id === researchMsgId);
      
      if (!researchMsg?.metadata?.research) {
        toast({
          title: 'Nenhuma pesquisa encontrada',
          description: 'Acesse o agente Daniel e gere uma pesquisa de tendências primeiro.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }

      const research = researchMsg.metadata.research;
      const niche = research.niche || 'nicho não identificado';

      // Build rich research context for Paulo
      let researchContext = `PESQUISA DO DANIEL — Nicho: ${niche}\n\n`;

      if (research.trending_topics?.length) {
        researchContext += `TENDÊNCIAS IDENTIFICADAS:\n`;
        research.trending_topics.slice(0, 8).forEach((t: any, i: number) => {
          const topic = typeof t === 'string' ? t : (t.topic || t.title || JSON.stringify(t));
          researchContext += `${i + 1}. ${topic}\n`;
        });
        researchContext += '\n';
      }

      if (research.pain_points?.length) {
        researchContext += `DORES DO PÚBLICO:\n`;
        research.pain_points.slice(0, 5).forEach((p: any) => {
          researchContext += `• ${typeof p === 'string' ? p : JSON.stringify(p)}\n`;
        });
        researchContext += '\n';
      }

      if (research.content_briefs?.length) {
        researchContext += `PAUTAS DO DANIEL:\n`;
        research.content_briefs.slice(0, 6).forEach((b: any, i: number) => {
          researchContext += `\nPauta ${i + 1}: ${b.title}\n`;
          if (b.hook) researchContext += `Hook sugerido: ${b.hook}\n`;
          if (b.slides_or_points?.length) {
            researchContext += `Pontos chave: ${b.slides_or_points.join(' | ')}\n`;
          }
        });
        researchContext += '\n';
      }

      if (research.viral_formats?.length) {
        researchContext += `FORMATOS VIRAIS QUE VOCÊ DEVE USAR ESTRITAMENTE COMO BASE:\n`;
        research.viral_formats.slice(0, 3).forEach((f: any) => {
          researchContext += `• ${typeof f === 'string' ? f : (f.format + ': ' + f.description + ' -> ' + f.example)}\n`;
        });
        researchContext += '\n';
      }

      const angleLabel = ANGLES.find(a => a.value === angle)?.label || angle;

      const fullPrompt = `Você é Paulo, Diretor Criativo de Carrosséis. Analise TODA a pesquisa do Daniel abaixo e gere 3 carrosséis DISTINTOS e COMPLEMENTARES. Cada um com um ângulo narrativo diferente, explorando diferentes facetas do nicho.

${researchContext}

CLIENTE: ${clientContext?.clientName || 'Demo'}
PRODUTO: ${clientContext?.produto || 'Produto'}
PÚBLICO: ${clientContext?.publico || 'Público geral'}
OFERTA: ${clientContext?.oferta || ''}
DIFERENCIAL: ${clientContext?.diferencial || ''}

INSTRUÇÕES CRÍTICAS:
1. Gere exatamente 3 carrosséis
2. Cada carrossel deve usar um ângulo diferente (storytelling, lista, provocação, mito, passo a passo, polêmico)
3. Explore diferentes tendências/dores da pesquisa em cada carrossel — não repita temas
4. Cada slide deve ter headline impactante + prompt de imagem cinematográfico detalhado em inglês
5. Entre 4 e 8 slides por carrossel — ajuste ao tamanho natural da ideia
6. Qualidade de diretor criativo sênior. Nada genérico.
7. JSON puro e válido. Sem texto fora do JSON.`;

      const displayText = `🧠 Importando pesquisa do Daniel sobre "${niche}"...\nGerando 3 carrosséis distintos com roteiro completo + prompts de imagem.`;

      setLoading(false); // Reset before generateCarousels sets it again
      await generateCarousels(displayText, fullPrompt, 'daniel_import', researchMsg.id);

    } catch (err: any) {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([{
      id: Date.now().toString(),
      role: 'assistant',
      content: 'Chat limpo! Me diga o tema ou importe a pesquisa do Daniel. 🎬',
      timestamp: new Date(),
    }]);
  };

  const handleCopyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copiado!', description: 'Prompt copiado para a área de transferência.' });
  };

  const toggleSlides = (msgId: string, carouselIdx: number) => {
    const key = `${msgId}-${carouselIdx}`;
    setExpandedSlides(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleImagePrompts = (key: string) => {
    setShowImagePrompts(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getSlideTypeColor = (type: CarouselSlide['type']) => {
    if (type === 'cover') return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
    if (type === 'cta') return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  };

  const getAngleColor = (a: string) => {
    const map: Record<string, string> = {
      storytelling: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
      lista: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
      provocacao: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
      mito_vs_verdade: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
      passo_a_passo: 'text-green-400 bg-green-500/10 border-green-500/20',
      polemica: 'text-red-400 bg-red-500/10 border-red-500/20',
    };
    return map[a] || 'text-slate-400 bg-slate-500/10 border-slate-500/20';
  };

  // ─── Render carousel card ─────────────────────────────────────────────────

  const renderCarouselCard = (carousel: PauloCarousel, msgId: string, idx: number) => {
    const key = `${msgId}-${idx}`;
    const isExpanded = expandedSlides[key] !== false; // default expanded
    const showPrompts = showImagePrompts[key] || false;

    return (
      <div
        key={key}
        className="border border-violet-500/20 rounded-2xl bg-background/60 overflow-hidden mt-3"
      >
        {/* Carousel header */}
        <div className="flex items-start justify-between px-4 py-3 bg-violet-500/5 border-b border-violet-500/10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge className={`text-[9px] px-2 py-0 border ${getAngleColor(carousel.angle)}`}>
                {ANGLES.find(a => a.value === carousel.angle)?.emoji} {ANGLES.find(a => a.value === carousel.angle)?.label || carousel.angle}
              </Badge>
              <Badge className="text-[9px] px-2 py-0 bg-slate-500/10 text-slate-400 border-slate-500/20">
                {carousel.slides.length} slides
              </Badge>
              {carousel.status === 'ready_for_davi' && (
                <Badge className="text-[9px] px-2 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                  Enviado ao Davi
                </Badge>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground truncate">{carousel.title}</p>
            {carousel.niche && (
              <p className="text-[11px] text-muted-foreground">Nicho: {carousel.niche}</p>
            )}
          </div>

          <div className="flex items-center gap-1 ml-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => toggleImagePrompts(key)}
              title={showPrompts ? 'Ocultar prompts' : 'Ver prompts de imagem'}
            >
              {showPrompts ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => toggleSlides(msgId, idx)}
            >
              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Slides */}
        {isExpanded && (
          <div className="divide-y divide-border/20">
            {carousel.slides.map((slide, si) => (
              <div key={si} className="px-4 py-3 group">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground w-6 text-center">
                      {slide.slide_number}
                    </span>
                    <Badge className={`text-[8px] px-1.5 py-0 border ${getSlideTypeColor(slide.type)}`}>
                      {slide.type === 'cover' ? 'CAPA' : slide.type === 'cta' ? 'CTA' : 'SLIDE'}
                    </Badge>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-snug">
                      {slide.headline}
                    </p>
                    {slide.subtext && (
                      <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                        {slide.subtext}
                      </p>
                    )}

                    {/* Image prompt (togglable) */}
                    {showPrompts && slide.image_prompt && (
                      <div className="mt-2 p-2.5 bg-slate-900/60 border border-slate-700/40 rounded-lg">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                            <Image className="h-2.5 w-2.5" />
                            Prompt de Imagem
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-slate-400 hover:text-slate-200"
                            onClick={() => handleCopyPrompt(slide.image_prompt)}
                          >
                            <Copy className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed font-mono">
                          {slide.image_prompt}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Caption preview */}
        {isExpanded && carousel.caption && (
          <div className="px-4 py-3 bg-muted/10 border-t border-border/20">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
              Legenda do Post
            </p>
            <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">
              {carousel.caption}
            </p>
            {carousel.hashtags.length > 0 && (
              <p className="text-[11px] text-violet-400/70 mt-1 line-clamp-1">
                {carousel.hashtags.map(h => `#${h}`).join(' ')}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/20 bg-background/40">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => handleCopyPrompt(JSON.stringify(carousel.slides, null, 2))}
          >
            <Copy className="h-3 w-3" />
            Copiar slides
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => handleCopyPrompt(carousel.caption)}
          >
            <Copy className="h-3 w-3" />
            Copiar legenda
          </Button>
          <div className="flex-1" />
          {carousel.id && carousel.status !== 'ready_for_davi' && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              onClick={() => sendToDavi(carousel.id!)}
            >
              <ArrowRight className="h-3 w-3" />
              Enviar ao Davi
            </Button>
          )}
          {carousel.status === 'ready_for_davi' && (
            <span className="text-[11px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              No Davi
            </span>
          )}
        </div>
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div className="flex flex-col h-full">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/20 bg-background/60 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 flex items-center justify-center shadow-inner">
              <Layers className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-black text-foreground tracking-tight uppercase flex items-center">
                  PAULO
                  <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse inline-block" />
                </h1>
                <Badge className="bg-violet-500/10 text-violet-400 border-violet-500/20 text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full">
                  Diretor Criativo
                </Badge>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[11px] text-muted-foreground font-medium">Cliente:</span>
                <span className="text-[11px] font-bold text-violet-400">{clientContext.clientName}</span>
                {isDemo && (
                  <Badge variant="outline" className="text-[8px] py-0 px-1 border-yellow-500/30 text-yellow-500 font-bold uppercase">
                    Demo
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearChat}
              className="h-8 px-3 text-muted-foreground hover:text-destructive gap-1.5 text-xs font-semibold"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpar
            </Button>
            <div className="h-8 flex items-center px-3 border border-border/20 rounded-full bg-muted/20 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              <LayoutGrid className="h-3 w-3 mr-1.5" />
              {savedCarousels.length} carrosséis
            </div>
          </div>
        </div>

        {/* ── Main area ─────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Chat panel (left) ─────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Messages */}
            <ScrollArea className="flex-1 px-4 py-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[75%] bg-muted/60 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground whitespace-pre-line">
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0 mt-1">
                          <Layers className="h-4 w-4 text-violet-400" />
                        </div>
                        <div className="flex-1">
                          {/* Loading state */}
                          {message.isLoading ? (
                            <div className="bg-violet-500/5 border border-violet-500/10 rounded-2xl rounded-tl-sm px-4 py-3">
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-400" />
                                Paulo está arquitetando os carrosséis
                                <span className="flex gap-0.5">
                                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                                Isso pode levar até 30 segundos para múltiplos carrosséis...
                              </p>
                            </div>
                          ) : (
                            <>
                              <div className="bg-violet-500/5 border border-violet-500/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-foreground">
                                <MarkdownRenderer content={message.content} />
                              </div>

                              {/* Carousel cards */}
                              {message.carousels && message.carousels.length > 0 && (
                                <div className="space-y-2 mt-1">
                                  {message.carousels.map((carousel, idx) =>
                                    renderCarouselCard(carousel, message.id, idx)
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {/* ── Action bar ─────────────────────────────────────────── */}
            <div className="px-4 py-2 border-t border-border/30 shrink-0">
              <div className="flex gap-2 pb-1 items-center overflow-x-auto">
                {/* Import Daniel */}
                {recentResearches.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={loading} className="flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[11px] font-semibold transition-colors">
                        <Brain className="h-3.5 w-3.5" />
                        Importar do Daniel <ChevronDown className="ml-1 h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[300px]">
                      <div className="p-2 text-xs font-semibold text-muted-foreground">Últimas pesquisas</div>
                      {recentResearches.map((r, idx) => (
                        <DropdownMenuItem key={r.id} onClick={() => handleImportDaniel(r.id)} className="flex flex-col items-start gap-1 p-3 cursor-pointer">
                          <span className="font-semibold text-sm truncate w-full">{r.research.niche}</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(r.date).toLocaleDateString()} - {r.research.content_briefs?.length || 0} pautas</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleImportDaniel('')}
                    disabled={loading}
                    className="flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[11px] font-semibold transition-colors"
                  >
                    <Brain className="h-3.5 w-3.5" />
                    Importar do Daniel
                  </Button>
                )}

                {/* Quick angle selectors */}
                {ANGLES.map(a => (
                  <button
                    key={a.value}
                    onClick={() => {
                      setAngle(a.value as AngleType);
                      if (!loading) inputRef.current?.focus();
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium whitespace-nowrap transition-all shrink-0 ${
                      angle === a.value
                        ? getAngleColor(a.value)
                        : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-violet-500/40 hover:text-foreground'
                    }`}
                  >
                    <span>{a.emoji}</span>
                    <span>{a.label}</span>
                  </button>
                ))}

              </div>
            </div>

            {/* ── Input area ────────────────────────────────────────────── */}
            <div className="px-4 pb-4 shrink-0">
              <div className="relative flex items-end gap-2 bg-muted/30 border border-border/50 rounded-2xl p-2 focus-within:border-violet-500/50 transition-colors">
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
                  placeholder={`Descreva o tema do carrossel... (ângulo: ${ANGLES.find(a => a.value === angle)?.label})`}
                  className="flex-1 min-h-[50px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px] placeholder:text-muted-foreground/50 py-3 px-3 leading-relaxed"
                  rows={1}
                  disabled={loading}
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40"
                >
                  {loading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
                Paulo gera roteiro completo: slide a slide com texto + prompt de imagem para o Davi. Shift+Enter para nova linha.
              </p>
            </div>
          </div>

          {/* ── Saved Carousels panel (right) ─────────────────────────────── */}
          <div className="w-72 border-l border-border/50 flex flex-col bg-muted/5 shrink-0">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-semibold text-foreground">Carrosséis</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {savedCarousels.length} salvos
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={loadSavedCarousels}
                  disabled={loadingSaved}
                >
                  <RotateCcw className={`h-3 w-3 ${loadingSaved ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {loadingSaved && (
                  <div className="text-center py-6 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 mx-auto mb-2 animate-spin opacity-40" />
                    <p className="text-xs">Carregando...</p>
                  </div>
                )}

                {!loadingSaved && savedCarousels.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <LayoutGrid className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">Nenhum carrossel ainda</p>
                    <p className="text-[11px] mt-1 opacity-60">Importe do Daniel ou crie um manualmente</p>
                  </div>
                )}

                {savedCarousels.map(carousel => (
                  <div
                    key={carousel.id}
                    className="bg-background/60 border border-border/50 rounded-xl p-3 hover:border-violet-500/30 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <Badge className={`text-[8px] px-1.5 py-0 border ${getAngleColor(carousel.angle)}`}>
                        {ANGLES.find(a => a.value === carousel.angle)?.emoji} {ANGLES.find(a => a.value === carousel.angle)?.label?.slice(0,10)}
                      </Badge>
                      <div className="flex items-center gap-0.5">
                        {carousel.status === 'ready_for_davi' ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Clock className="h-3 w-3 text-muted-foreground/50" />
                        )}
                      </div>
                    </div>

                    <p className="text-xs font-medium text-foreground line-clamp-2 mb-1">
                      {carousel.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {carousel.slides.length} slides · {carousel.niche?.slice(0, 20)}
                    </p>

                    {/* Action */}
                    {carousel.id && carousel.status !== 'ready_for_davi' && (
                      <div className="flex gap-1 mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="flex-1 h-6 text-[10px] text-emerald-400 hover:bg-emerald-500/10 gap-1"
                          onClick={() => sendToDavi(carousel.id!)}
                        >
                          <Zap className="h-2.5 w-2.5" />
                          Enviar ao Davi
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                          onClick={() => handleDeleteCarousel(carousel.id!)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {carousel.status === 'ready_for_davi' && (
                      <p className="text-[10px] text-emerald-400 mt-2 text-center flex items-center justify-center gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Pronto para o Davi
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
