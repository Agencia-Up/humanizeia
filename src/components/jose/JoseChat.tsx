import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { toast } from 'sonner';
import {
  Send, Loader2, Bot, User, Sparkles, BarChart3, Zap, Target,
  TrendingUp, MessageCircle, Plus, ChevronLeft, Trash2, Clock,
  Brain, RefreshCw, DollarSign, AlertTriangle,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

// ── Quick shortcuts ─────────────────────────────────────────────────────────────
const SHORTCUTS = [
  { icon: BarChart3, label: 'Analisar campanhas', prompt: 'Analise meus dados e me diga: qual é a ação de maior impacto que eu posso fazer AGORA nas minhas campanhas? Seja específico com números.' },
  { icon: TrendingUp, label: 'Melhorar ROAS', prompt: 'Como posso melhorar meu ROAS agora? Quais campanhas estão abaixo do esperado e o que fazer?' },
  { icon: DollarSign, label: 'Otimizar orçamento', prompt: 'Analise minha distribuição de orçamento. Onde estou desperdiçando dinheiro e onde devo investir mais?' },
  { icon: AlertTriangle, label: 'Problemas críticos', prompt: 'Quais são os problemas mais urgentes nas minhas campanhas hoje? Liste em ordem de prioridade.' },
  { icon: Target, label: 'Melhor público', prompt: 'Qual público está performando melhor? Devo criar lookalikes ou explorar novos segmentos?' },
  { icon: Zap, label: 'Próxima ação', prompt: 'Se eu pudesse fazer apenas UMA coisa agora para melhorar meus resultados, o que seria? Explique com dados.' },
  { icon: RefreshCw, label: 'Fadiga de criativos', prompt: 'Minhas campanhas estão com fadiga de criativo? Como identificar e quando trocar os anúncios?' },
  { icon: Brain, label: 'Estratégia semanal', prompt: 'Monte uma estratégia de otimização para essa semana com base nas métricas atuais.' },
];

// ── Helper: format relative time ────────────────────────────────────────────────
function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}m atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

// ── Props ───────────────────────────────────────────────────────────────────────
interface JoseChatProps {
  session?: any | null; // ApolloSession
  currencySymbol?: string;
  accountId?: string;
}

// ── Component ───────────────────────────────────────────────────────────────────
export function JoseChat({ session, currencySymbol = 'R$', accountId }: JoseChatProps) {
  const { user } = useAuth();

  // ── State ──
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Build context string from campaign session ──
  const buildContext = useCallback(() => {
    if (!session) return '';
    const campaigns = session.campaigns || [];
    const topCamps = campaigns.slice(0, 5).map((c: any) =>
      `- ${c.name}: score ${c.health_score}, ROAS ${c.roas?.toFixed(2) || 0}x, CTR ${c.ctr?.toFixed(2) || 0}%, spend ${currencySymbol} ${c.spend?.toFixed(0) || 0}, CPC ${currencySymbol} ${c.cpc?.toFixed(2) || 0}`
    ).join('\n');
    const actions = (session.actions || []).slice(0, 3).map((a: any) =>
      `- [${a.priority?.toUpperCase()}] ${a.action_type?.replace(/_/g, ' ')} em "${a.campaign_name}": ${a.reason}`
    ).join('\n');
    return `
CONTEXTO ATUAL DAS CAMPANHAS (${new Date().toLocaleDateString('pt-BR')}):
Score geral: ${session.health_score ?? 'N/D'}/100
Total campanhas: ${campaigns.length}
Período: ${session.date_preset || 'últimos 30 dias'}

TOP CAMPANHAS:
${topCamps || 'Nenhuma disponível'}

AÇÕES RECOMENDADAS PELO SISTEMA:
${actions || 'Nenhuma ação pendente'}

${session.summary ? `RESUMO EXECUTIVO:\n${session.summary}` : ''}
    `.trim();
  }, [session, currencySymbol]);

  // ── Claude chat hook ──
  const { sendMessage } = useClaudeChat({
    context: 'midas',
    config: {
      metricsData: session,
      campaignData: session?.campaigns,
      description: buildContext(),
    },
    onDelta: (delta) => setStreaming(prev => prev + delta),
    onComplete: () => {},
    onError: (err) => toast.error(`Erro: ${err}`),
  });

  // ── Scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // ── Load conversations list ──
  const loadConversations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('apollo_conversations')
      .select('id, title, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (data) setConversations(data);
  }, [user]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // ── Load messages for a conversation ──
  const loadMessages = useCallback(async (convId: string) => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('apollo_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as ChatMessage[]);
    setLoadingHistory(false);
  }, []);

  const selectConversation = useCallback((convId: string) => {
    setActiveConvId(convId);
    loadMessages(convId);
    setShowSidebar(false);
  }, [loadMessages]);

  // ── Create new conversation ──
  const createConversation = useCallback(async (firstMessage: string): Promise<string | null> => {
    if (!user) return null;
    const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? '…' : '');
    const { data, error } = await supabase
      .from('apollo_conversations')
      .insert({ user_id: user.id, title, updated_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error || !data) return null;
    await loadConversations();
    return data.id;
  }, [user, loadConversations]);

  // ── Save a message to DB ──
  const saveMessage = useCallback(async (convId: string, role: 'user' | 'assistant', content: string) => {
    if (!user) return;
    const { data } = await supabase
      .from('apollo_messages')
      .insert({
        conversation_id: convId,
        user_id: user.id,
        role,
        content,
        message_type: 'chat',
        data: null,
      })
      .select('id, role, content, created_at')
      .single();
    // Update conversation's updated_at
    await (supabase as any)
      .from('apollo_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);
    return data;
  }, [user]);

  // ── Send message ──
  const handleSend = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isThinking) return;
    setInput('');

    // Add user message locally
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setStreaming('');
    setIsThinking(true);

    // Get or create conversation
    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation(userText);
      if (!convId) {
        toast.error('Erro ao criar conversa');
        setIsThinking(false);
        return;
      }
      setActiveConvId(convId);
    }

    // Save user message to DB
    await saveMessage(convId, 'user', userText);

    // Build message history for the LLM (exclude only the pending user temp message)
    const history = messages
      .filter(m => m.id !== tempUserMsg.id)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Inject context as system note in first message if session exists
    const contextNote = buildContext();
    const userMsgWithContext = contextNote
      ? `[CONTEXTO DAS CAMPANHAS]\n${contextNote}\n\n[PERGUNTA DO USUÁRIO]\n${userText}`
      : userText;

    const messagesForLLM = [
      ...history,
      { role: 'user' as const, content: userMsgWithContext },
    ];

    let fullResponse = '';
    try {
      fullResponse = await sendMessage(messagesForLLM, {
        description: `Você é JOSÉ, o agente especialista em tráfego pago da LogosIA. Responda em português do Brasil. Seja direto, use dados quando disponíveis, formate em Markdown com headers e listas quando útil. Foque em ações concretas e números reais.`,
      });
    } catch {
      fullResponse = 'Desculpe, houve um erro ao processar sua mensagem. Tente novamente.';
    }

    setStreaming('');
    setIsThinking(false);

    // Add assistant message locally and save to DB
    const ts = Date.now();
    const assistantMsg: ChatMessage = {
      id: `msg-assist-${ts}`,
      role: 'assistant',
      content: fullResponse,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [
      ...prev.filter(m => m.id !== tempUserMsg.id),
      { ...tempUserMsg, id: `msg-user-${ts}` },
      assistantMsg,
    ]);

    await saveMessage(convId, 'assistant', fullResponse);
    await loadConversations();

    inputRef.current?.focus();
  }, [input, isThinking, activeConvId, messages, buildContext, createConversation, saveMessage, sendMessage, loadConversations]);

  // ── Start new chat ──
  const handleNewChat = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setStreaming('');
    setShowSidebar(false);
    inputRef.current?.focus();
  }, []);

  // ── Delete conversation ──
  const handleDelete = useCallback(async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('apollo_messages').delete().eq('conversation_id', convId);
    await supabase.from('apollo_conversations').delete().eq('id', convId);
    if (activeConvId === convId) handleNewChat();
    await loadConversations();
  }, [activeConvId, handleNewChat, loadConversations]);

  const isWelcome = messages.length === 0 && !streaming;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[680px] rounded-xl border border-border/50 bg-[#0d0d0f] overflow-hidden">

      {/* ── Sidebar: conversation history ── */}
      <div className={`flex flex-col border-r border-border/30 bg-[#111113] transition-all duration-300 ${showSidebar ? 'w-64' : 'w-0 overflow-hidden'}`}>
        <div className="flex items-center justify-between p-3 border-b border-border/20">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Histórico</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setShowSidebar(false)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="p-2">
          <Button onClick={handleNewChat} variant="outline" size="sm" className="w-full gap-2 text-xs border-border/40">
            <Plus className="h-3.5 w-3.5" /> Nova conversa
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma conversa ainda</p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`group flex items-start justify-between gap-2 rounded-lg p-2.5 cursor-pointer transition-colors ${activeConvId === conv.id ? 'bg-orange-500/15 border border-orange-500/20' : 'hover:bg-white/5'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate leading-snug">{conv.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />{relativeTime(conv.updated_at)}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                  onClick={(e) => handleDelete(conv.id, e)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/20 bg-[#111113]">
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => setShowSidebar(s => !s)}
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                <Brain className="h-3.5 w-3.5 text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-none">JOSÉ</p>
                <p className="text-[10px] text-muted-foreground">Central de Inteligência · Tráfego Pago</p>
              </div>
            </div>
            <Badge className="text-[10px] bg-orange-500/15 text-orange-400 border-orange-500/25 hidden sm:flex">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse mr-1 inline-block" />
              {session ? `Score ${session.health_score ?? '—'}/100` : 'Online'}
            </Badge>
          </div>
          <Button onClick={handleNewChat} variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground h-7">
            <Plus className="h-3.5 w-3.5" /> Novo chat
          </Button>
        </div>

        {/* ── Messages area ── */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">

            {/* Welcome screen */}
            {isWelcome && (
              <div className="flex flex-col items-center justify-center py-8 gap-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/20 to-red-600/20 border border-orange-500/30 flex items-center justify-center">
                    <Brain className="h-7 w-7 text-orange-400" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-lg text-foreground">Oi! Sou o JOSÉ</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      Sua central de inteligência para tráfego pago. Posso analisar campanhas, sugerir otimizações e responder qualquer pergunta sobre seus anúncios.
                    </p>
                  </div>
                  {!session && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Clique em "Nova Análise" para eu ver seus dados de campanha
                    </div>
                  )}
                </div>

                {/* Shortcuts grid */}
                <div className="w-full max-w-2xl grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SHORTCUTS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      disabled={isThinking}
                      className="group flex flex-col gap-2 rounded-xl border border-border/30 bg-white/3 p-3 text-left text-xs hover:border-orange-500/40 hover:bg-orange-500/5 transition-all disabled:opacity-50"
                    >
                      <s.icon className="h-4 w-4 text-orange-400" />
                      <span className="text-foreground font-medium leading-tight">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading history */}
            {loadingHistory && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Messages */}
            {messages.map(msg => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                {/* Avatar */}
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
                  msg.role === 'assistant'
                    ? 'bg-orange-500/15 border-orange-500/30'
                    : 'bg-blue-500/15 border-blue-500/30'
                }`}>
                  {msg.role === 'assistant'
                    ? <Bot className="h-4 w-4 text-orange-400" />
                    : <User className="h-4 w-4 text-blue-400" />
                  }
                </div>

                {/* Bubble */}
                <div className={`max-w-[78%] rounded-2xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600/25 border border-blue-500/20 rounded-tr-sm'
                    : 'bg-white/5 border border-border/20 rounded-tl-sm'
                }`}>
                  {msg.role === 'assistant'
                    ? <MarkdownRenderer content={msg.content} className="text-sm leading-relaxed prose-p:my-1 prose-headings:my-2" />
                    : <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  }
                  <p className="text-[10px] text-muted-foreground/60 mt-1.5">{relativeTime(msg.created_at)}</p>
                </div>
              </div>
            ))}

            {/* Streaming (thinking) bubble */}
            {(isThinking || streaming) && (
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center border bg-orange-500/15 border-orange-500/30">
                  <Bot className="h-4 w-4 text-orange-400" />
                </div>
                <div className="max-w-[78%] rounded-2xl rounded-tl-sm px-4 py-3 bg-white/5 border border-border/20">
                  {streaming
                    ? <MarkdownRenderer content={streaming} className="text-sm leading-relaxed prose-p:my-1" />
                    : (
                      <div className="flex items-center gap-2 py-1">
                        <span className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )
                  }
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* ── Shortcuts bar (when chat has messages) ── */}
        {!isWelcome && (
          <div className="px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {SHORTCUTS.slice(0, 4).map(s => (
              <button
                key={s.label}
                onClick={() => handleSend(s.prompt)}
                disabled={isThinking}
                className="shrink-0 flex items-center gap-1.5 rounded-full border border-border/30 bg-white/3 px-3 py-1.5 text-[11px] text-muted-foreground hover:border-orange-500/40 hover:text-orange-400 transition-colors disabled:opacity-50"
              >
                <s.icon className="h-3 w-3" />{s.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Input area ── */}
        <div className="px-4 pb-4">
          <div className="flex items-end gap-2 rounded-2xl border border-border/30 bg-white/3 px-4 py-3 focus-within:border-orange-500/40 transition-colors">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Pergunte sobre suas campanhas..."
              disabled={isThinking}
              className="border-0 bg-transparent p-0 text-sm placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
            />
            <Button
              onClick={() => handleSend()}
              disabled={!input.trim() || isThinking}
              size="icon"
              className="h-8 w-8 rounded-xl bg-orange-500 hover:bg-orange-600 shrink-0 disabled:opacity-40"
            >
              {isThinking
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
            {session ? `Analisando ${session.campaigns?.length || 0} campanhas · Score ${session.health_score ?? '—'}/100` : 'JOSÉ · Agente de Tráfego Pago'}
          </p>
        </div>
      </div>
    </div>
  );
}
