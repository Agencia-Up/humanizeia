import { useState, useRef, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Send, Copy, Trash2, BookmarkPlus, RefreshCw,
  PenTool, Target, MessageSquare,
  Link, X,
  Instagram, Mail, Phone,
  Brain
} from 'lucide-react';

import { useAgentTasks } from '@/contexts/AgentTasksContext';
import { useAgentChat } from '@/contexts/AgentChatContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type StyleType = 'profissional' | 'persuasivo' | 'agressivo' | 'descontraido' | 'zoeira';
type IntensityType = 1 | 2 | 3;
type PlatformType = 'meta' | 'google' | 'whatsapp' | 'email' | 'sms';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  saved?: boolean;
}

interface SavedCopy {
  id: string;
  content: string;
  platform: PlatformType;
  style: StyleType;
  savedAt: Date;
  label: string;
}

interface ClientContext {
  clientName: string;
  produto: string;
  publico: string;
  oferta: string;
  diferencial: string;
  // Daniel's strategy — loaded from latest orchestrator_tasks execution
  danielStrategy?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STYLES: { value: StyleType; label: string; emoji: string; color: string }[] = [
  { value: 'profissional', label: 'Profissional', emoji: '👔', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  { value: 'persuasivo', label: 'Persuasivo', emoji: '🎯', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  { value: 'agressivo', label: 'Agressivo', emoji: '🔥', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { value: 'descontraido', label: 'Descontraído', emoji: '😎', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  { value: 'zoeira', label: 'Zoeira', emoji: '😂', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
];

const INTENSITY_LABELS: Record<IntensityType, { label: string; desc: string; color: string }> = {
  1: { label: 'Leve', desc: 'Suave e convidativo', color: 'text-green-400' },
  2: { label: 'Médio', desc: 'Direto e convincente', color: 'text-orange-400' },
  3: { label: 'Forte', desc: 'Impactante e urgente', color: 'text-red-400' },
};

const PLATFORMS: { value: PlatformType; label: string; icon: React.ReactNode }[] = [
  { value: 'meta', label: 'Meta Ads', icon: <Instagram className="h-3 w-3" /> },
  { value: 'google', label: 'Google', icon: <Target className="h-3 w-3" /> },
  { value: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare className="h-3 w-3" /> },
  { value: 'email', label: 'Email', icon: <Mail className="h-3 w-3" /> },
  { value: 'sms', label: 'SMS', icon: <Phone className="h-3 w-3" /> },
];

const DEMO_CLIENT: ClientContext = {
  clientName: 'Demo — Conecte um cliente via Salomão',
  produto: 'Consultoria de Marketing Digital',
  publico: 'Empreendedores e PMEs que querem crescer online',
  oferta: 'Pacote completo de estratégia + execução por R$ 2.997/mês',
  diferencial: 'Resultado garantido em 90 dias ou devolução total',
};

const QUICK_ACTIONS = [
  { id: 'create_ad', label: 'Criar Anúncio', emoji: '🎯', prompt: (p: PlatformType) => `Crie um anúncio completo para ${p === 'meta' ? 'Meta Ads (Facebook/Instagram)' : p === 'google' ? 'Google Ads' : p === 'whatsapp' ? 'WhatsApp' : p === 'email' ? 'Email Marketing' : 'SMS'}` },
  { id: 'variations', label: 'Gerar Variações', emoji: '🔄', prompt: () => 'Gere 3 variações da última copy com frameworks diferentes (PAS, AIDA e BAB)' },
  { id: 'improve', label: 'Melhorar Copy', emoji: '✨', prompt: () => 'Analise a última copy gerada e reescreva com melhorias de conversão' },
  { id: 'hook', label: 'Só o Hook', emoji: '⚡', prompt: () => 'Gere apenas 5 opções de hooks/primeiras linhas impactantes para capturar atenção no scroll' },
  { id: 'cta', label: 'Opções de CTA', emoji: '🚀', prompt: () => 'Gere 6 opções de CTA irresistíveis em diferentes tons: urgência, benefício, curiosidade, comando, pergunta e exclusividade' },
  { id: 'objections', label: 'Quebrar Objeções', emoji: '🛡️', prompt: () => 'Crie copy focada em quebrar as 3 principais objeções do público-alvo antes que elas apareçam' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PauloAgente() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { createTask } = useAgentTasks();
  const { getHistory, saveMessage, clearHistory } = useAgentChat();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [style, setStyle] = useState<StyleType>('persuasivo');
  const [intensity, setIntensity] = useState<IntensityType>(2);
  const [platform, setPlatform] = useState<PlatformType>('meta');
  const [showReference, setShowReference] = useState(false);
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState(false);
  const [isDemo, setIsDemo] = useState(true);
  const [clientContext, setClientContext] = useState<ClientContext>(DEMO_CLIENT);
  const [library, setLibrary] = useState<SavedCopy[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load client context on mount
  useEffect(() => {
    loadClientContext();
  }, [user]);

  // Carregar histórico ao montar
  useEffect(() => {
    const loadHistory = async () => {
      const history = await getHistory('paulo');
      if (history.length > 0) {
        setMessages(history.map(m => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.created_at || Date.now()),
        })));
      } else {
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          content: '👋 Oi! Sou o Paulo — já tenho o contexto do cliente carregado via Salomão.\n\nPode me pedir qualquer copy: anúncio, email, WhatsApp, SMS, headline, variações... Só me fala o que precisa e já entrego estruturado.\n\nUse os atalhos rápidos abaixo ou me escreva diretamente. 🎯',
          timestamp: new Date(),
        }]);
      }
    };
    loadHistory();
  }, [getHistory, clearHistory]);

  const handleClearHistory = async () => {
    try {
      await clearHistory('paulo');
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: 'Histórico limpo! Como posso te ajudar agora? 🎯',
        timestamp: new Date(),
      }]);
      toast({ title: 'Histórico limpo' });
    } catch (err: any) {
      toast({ title: 'Erro ao limpar', description: err.message, variant: 'destructive' });
    }
  };

  const loadClientContext = async () => {
    if (!user) return;
    try {
      // 1. Load briefing from Salomão (base knowledge)
      const { data: briefingData } = await supabase
        .from('client_briefings' as any)
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // 2. Load latest Daniel strategy from orchestrator_tasks (invisible context enrichment)
      let danielStrategy: string | undefined;
      try {
        const { data: taskData } = await supabase
          .from('orchestrator_tasks' as any)
          .select('context, result, stage, updated_at')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();

        if (taskData) {
          const ctx = (taskData as any).context || {};
          const result = (taskData as any).result || {};
          // Extract Daniel's output from either context or result
          const rawDaniel = ctx.daniel_output || result.daniel;
          if (rawDaniel) {
            danielStrategy = typeof rawDaniel === 'string'
              ? rawDaniel.slice(0, 600)
              : JSON.stringify(rawDaniel).slice(0, 600);
          }
        }
      } catch {
        // No orchestrator task yet — fine, just skip
      }

      if (briefingData) {
        setClientContext({
          clientName: (briefingData as any).client_name || (briefingData as any).business_name || 'Cliente',
          produto: (briefingData as any).product_service || (briefingData as any).produto || '',
          publico: (briefingData as any).target_audience || (briefingData as any).publico || '',
          oferta: (briefingData as any).main_offer || (briefingData as any).oferta || '',
          diferencial: (briefingData as any).differentiators || (briefingData as any).diferencial || '',
          danielStrategy,
        });
        setIsDemo(false);
      } else {
        setClientContext(DEMO_CLIENT);
        setIsDemo(true);
      }
    } catch {
      setClientContext(DEMO_CLIENT);
      setIsDemo(true);
    }
  };

  const processMessageRequest = async (displayContent: string, actualPrompt: string) => {
    if (loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: displayContent,
      timestamp: new Date(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      // 1. Salvar mensagem visual do usuário no histórico persistente
      await saveMessage('paulo', 'user', displayContent);

      const ctx = clientContext || DEMO_CLIENT;
      const contextStr = `
Cliente: ${ctx.clientName}
Produto/Serviço: ${ctx.produto}
Público-alvo: ${ctx.publico}
Oferta principal: ${ctx.oferta}
Diferencial: ${ctx.diferencial}
${ctx.danielStrategy ? `\nEstratégia do Daniel (pipeline Salomão): ${ctx.danielStrategy}` : ''}
${reference ? `\nReferência para analisar: ${reference}` : ''}`;

      const systemWithContext = `Contexto do cliente (vindo do Salomão):
${contextStr}

Estilo atual: ${STYLES.find(s => s.value === style)?.label}
Intensidade atual: ${INTENSITY_LABELS[intensity].label} — ${INTENSITY_LABELS[intensity].desc}
Plataforma atual: ${PLATFORMS.find(p => p.value === platform)?.label}`;

      // 2. Criar tarefa em segundo plano
      const taskId = await createTask('paulo', 'generate_copy', {
        input: actualPrompt,
        platform,
        style,
        intensity,
        context: ctx
      });

      // Substitui o displayContent pelo actualPrompt para a API do Claude visualizar a instrução completa
      const apiMessages = newMessages.map(m => ({ 
        role: m.role, 
        content: m.id === userMessage.id ? actualPrompt : m.content 
      }));

      const { data, error } = await supabase.functions.invoke('claude-chat', {
        body: {
          messages: apiMessages,
          context: 'paulo',
          stream: false,
          task_id: taskId, // Passar task_id para a Edge Function
          config: {
            product: ctx.produto,
            description: systemWithContext,
            tone: style,
            creativity: intensity === 1 ? 0.5 : intensity === 2 ? 0.75 : 0.95,
            platform,
            variations: 1,
          },
        },
      });

      if (error) throw new Error(error.message);

      const content = data?.choices?.[0]?.message?.content || 'Erro ao gerar copy. Tente novamente.';

      // 3. Salvar resposta do assistente no histórico persistente
      await saveMessage('paulo', 'assistant', content);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      toast({ title: 'Erro ao chamar Paulo', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    await processMessageRequest(input.trim(), input.trim());
  };

  const handleQuickAction = (action: typeof QUICK_ACTIONS[0]) => {
    const prompt = action.id === 'create_ad' ? action.prompt(platform) : action.prompt(platform);
    setInput(prompt);
    inputRef.current?.focus();
  };

  const handleSaveToLibrary = (message: ChatMessage) => {
    const saved: SavedCopy = {
      id: Date.now().toString(),
      content: message.content,
      platform,
      style,
      savedAt: new Date(),
      label: message.content.slice(0, 120).replace(/\n/g, ' '),
    };
    setLibrary(prev => [saved, ...prev]);
    toast({ title: 'Salvo na biblioteca!', description: 'Copy salva com sucesso.' });
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, saved: true } : m));
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Copiado!', description: 'Copy copiada para a área de transferência.' });
  };

  const removeFromLibrary = (id: string) => {
    setLibrary(prev => prev.filter(item => item.id !== id));
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

        const actualPrompt = `Acabei de importar as pesquisas de tendência do Daniel para o nicho "${research.niche}".\n\nBaseado nas pautas do Daniel abaixo, crie as copies completas para redes sociais e anúncios, focando nas dores, desejos e objeções do público:\n\n${pautasStr}`;
        const displayPrompt = `🎯 Importando pesquisas e pautas do Daniel sobre "${research.niche}"...\nPor favor, crie as copies baseadas nessas tendências.`;
        
        toast({ title: 'Pesquisa do Daniel importada!', description: 'Iniciando criação das copies...' });
        
        // Remove loading antes de chamar processMessageRequest para não dar conflito state
        setLoading(false); 
        await processMessageRequest(displayPrompt, actualPrompt);
        
      } else {
        toast({ 
          title: 'Nenhuma pesquisa encontrada', 
          description: 'Acesse o agente DANIEL e gere a Busca de Tendências (Pesquisa) primeiro para importar depois!', 
          variant: 'destructive' 
        });
        setLoading(false);
      }
    } catch (err: any) {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
      setLoading(false);
    }
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-full">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-background/95 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 border border-violet-500/30 flex items-center justify-center">
              <PenTool className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-foreground">PAULO</h1>
                <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse mr-1.5 inline-block" />
                  Copywriter IA
                </Badge>
              </div>
              {clientContext && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-muted-foreground">Cliente:</span>
                  <span className="text-xs font-medium text-violet-400">{clientContext.clientName}</span>
                  {isDemo && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-yellow-500/40 text-yellow-500">
                      Demo
                    </Badge>
                  )}
                  {clientContext.danielStrategy && !isDemo && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-blue-500/40 text-blue-400">
                      + Daniel
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearHistory}
              className="text-muted-foreground hover:text-destructive gap-1.5 text-xs h-8"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowReference(!showReference)}
              className={`gap-1.5 text-xs h-8 ${showReference ? 'text-violet-400 bg-violet-500/10' : 'text-muted-foreground'}`}
            >
              <Link className="h-3.5 w-3.5" />
              Referência
            </Button>
            <Badge variant="outline" className="text-xs h-8">
              {messages.filter(m => m.role === 'assistant').length} copies
            </Badge>
          </div>
        </div>

        {/* ── Reference bar ────────────────────────────────────────────────── */}
        {showReference && (
          <div className="px-6 py-3 bg-violet-500/5 border-b border-border/40 flex items-center gap-3 shrink-0">
            <Link className="h-4 w-4 text-violet-400 shrink-0" />
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cole uma URL ou texto de referência para o Paulo analisar o tom e estilo..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {reference && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                onClick={() => setReference('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

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
                        <div className="max-w-[75%] bg-muted/60 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground">
                          {message.content}
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0 mt-1">
                          <PenTool className="h-4 w-4 text-violet-400" />
                        </div>
                        <div className="flex-1">
                          <div className="bg-violet-500/5 border border-violet-500/10 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-foreground whitespace-pre-wrap">
                            {message.content}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => handleCopy(message.content)}
                            >
                              <Copy className="h-3 w-3" />
                              {copied ? 'Copiado!' : 'Copiar'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 text-xs gap-1.5 ${message.saved ? 'text-violet-400' : 'text-muted-foreground hover:text-violet-400'}`}
                              onClick={() => handleSaveToLibrary(message)}
                              disabled={message.saved}
                            >
                              <BookmarkPlus className="h-3 w-3" />
                              {message.saved ? 'Salvo' : 'Salvar'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {loading && (
                  <div className="flex gap-3">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center shrink-0 mt-1">
                      <PenTool className="h-4 w-4 text-violet-400" />
                    </div>
                    <div className="bg-violet-500/5 border border-violet-500/10 rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-400" />
                        Paulo está escrevendo
                        <span className="flex gap-0.5">
                          <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                          <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                          <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={scrollRef} />
              </div>
            </ScrollArea>

            {/* ── Quick actions ─────────────────────────────────────────── */}
            <div className="px-4 py-2 border-t border-border/30 shrink-0">
              <ScrollArea className="w-full">
                <div className="flex gap-2 pb-2 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleImportDanielResearch}
                    disabled={loading}
                    className="flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-full bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border-cyan-500/30 text-[11px] font-medium transition-colors"
                  >
                    <Brain className="h-3.5 w-3.5" />
                    Importar Busca do Daniel
                  </Button>
                  <Separator orientation="vertical" className="h-5 mx-1 opacity-50" />
                  {QUICK_ACTIONS.map(action => (
                    <button
                      key={action.id}
                      onClick={() => handleQuickAction(action)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/40 hover:bg-muted/70 border border-border/40 hover:border-violet-500/40 text-[11px] text-muted-foreground hover:text-foreground transition-all whitespace-nowrap"
                    >
                      <span>{action.emoji}</span>
                      <span>{action.label}</span>
                    </button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>

            {/* ── Termômetro (style + intensity + platform) ─────────────── */}
            <div className="px-4 py-3 border-t border-border/40 bg-background/50 space-y-3 shrink-0">
              {/* Style selector */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider w-16 shrink-0">Estilo</span>
                <div className="flex gap-1.5 flex-wrap">
                  {STYLES.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setStyle(s.value)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                        style === s.value
                          ? s.color
                          : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-border'
                      }`}
                    >
                      {s.emoji} {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intensity + Platform row */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider w-16 shrink-0">Força</span>
                  <div className="flex gap-1 items-center">
                    {([1, 2, 3] as IntensityType[]).map(i => (
                      <button
                        key={i}
                        onClick={() => setIntensity(i)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold border transition-all ${
                          intensity === i
                            ? i === 1
                              ? 'bg-green-500/20 text-green-400 border-green-500/40'
                              : i === 2
                              ? 'bg-orange-500/20 text-orange-400 border-orange-500/40'
                              : 'bg-red-500/20 text-red-400 border-red-500/40'
                            : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-border'
                        }`}
                      >
                        {i === 1 ? '○' : i === 2 ? '◐' : '●'}
                      </button>
                    ))}
                    <span className={`ml-1 text-[11px] self-center ${INTENSITY_LABELS[intensity].color}`}>
                      {INTENSITY_LABELS[intensity].label}
                    </span>
                  </div>
                </div>

                <Separator orientation="vertical" className="h-6" />

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">Para</span>
                  <div className="flex gap-1 flex-wrap">
                    {PLATFORMS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setPlatform(p.value)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-all ${
                          platform === p.value
                            ? 'bg-violet-500/20 text-violet-400 border-violet-500/40'
                            : 'bg-muted/30 text-muted-foreground border-border/40 hover:border-border'
                        }`}
                      >
                        {p.icon} {p.label}
                      </button>
                    ))}
                  </div>
                </div>
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
                  placeholder="Descreva o que precisa... (Enter para enviar, Shift+Enter para nova linha)"
                  className="flex-1 min-h-[44px] max-h-[120px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 py-2 px-2"
                  rows={1}
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
                Paulo analisa o contexto do Salomão automaticamente. Shift+Enter para nova linha.
              </p>
            </div>
          </div>

          {/* ── Library panel (right) ─────────────────────────────────────── */}
          <div className="w-72 border-l border-border/50 flex flex-col bg-muted/5 shrink-0">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookmarkPlus className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-semibold text-foreground">Biblioteca</span>
              </div>
              <Badge variant="outline" className="text-[10px]">{library.length} salvas</Badge>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {library.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <BookmarkPlus className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">Salve copies aqui para usar depois</p>
                  </div>
                )}
                {library.map(item => (
                  <div
                    key={item.id}
                    className="bg-background/60 border border-border/50 rounded-xl p-3 group hover:border-violet-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex gap-1 flex-wrap">
                        <Badge className="text-[9px] py-0 px-1.5 bg-violet-500/15 text-violet-400 border-violet-500/20">
                          {item.platform}
                        </Badge>
                        <Badge className="text-[9px] py-0 px-1.5 bg-muted/50 text-muted-foreground border-border/30">
                          {item.style}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 text-destructive/70 hover:text-destructive"
                        onClick={() => removeFromLibrary(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{item.label}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={() => handleCopy(item.content)}
                    >
                      <Copy className="h-3 w-3" /> Copiar Copy
                    </Button>
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
