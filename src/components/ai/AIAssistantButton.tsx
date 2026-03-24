import { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, X, Send, Sparkles, Brain, Zap, BarChart3, PenTool, Target, Palette, ChevronDown, Loader2, Mic, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion, AnimatePresence } from 'framer-motion';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { useMetaInsights } from '@/hooks/useMetaInsights';
import { useMetaConnection } from '@/hooks/useMetaConnection';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  context?: string;
  agentName?: string;
}

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  prompt: string;
  context: string;
}

const AGENT_LABELS: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  assistant: { name: 'LogosIA', icon: <Sparkles className="h-3 w-3" />, color: 'text-blue-400' },
  midas: { name: 'Apollo', icon: <Brain className="h-3 w-3" />, color: 'text-amber-400' },
  copywriter: { name: 'Copywriter', icon: <PenTool className="h-3 w-3" />, color: 'text-emerald-400' },
  optimizer: { name: 'Otimizador', icon: <Target className="h-3 w-3" />, color: 'text-red-400' },
  insights: { name: 'Insights', icon: <BarChart3 className="h-3 w-3" />, color: 'text-purple-400' },
  creative: { name: 'Criativo', icon: <Palette className="h-3 w-3" />, color: 'text-pink-400' },
};

const QUICK_ACTIONS: QuickAction[] = [
  { icon: <BarChart3 className="h-4 w-4" />, label: 'Relatório do dia', prompt: 'Me dê um relatório completo de performance das minhas campanhas hoje. Inclua spend, CPA, ROAS, CTR e classifique cada campanha com semáforo 🔴🟡🟢.', context: 'midas' },
  { icon: <Target className="h-4 w-4" />, label: 'Diagnosticar campanhas', prompt: 'Faça um diagnóstico completo de todas as minhas campanhas ativas. Identifique problemas, oportunidades e me dê os próximos passos priorizados.', context: 'optimizer' },
  { icon: <PenTool className="h-4 w-4" />, label: 'Criar copies', prompt: 'Preciso de 5 variações de copy para meus anúncios. Use frameworks diferentes (PAS, AIDA, BAB). Me pergunte sobre o produto/serviço antes de criar.', context: 'copywriter' },
  { icon: <Zap className="h-4 w-4" />, label: 'O que fazer agora?', prompt: 'Analise meus dados e me diga: qual é a ação de maior impacto que eu posso fazer AGORA nas minhas campanhas? Seja específico com números.', context: 'midas' },
];

// Intent detection: analyze user message and route to the right agent
function detectContext(message: string): string {
  const msg = message.toLowerCase();

  // Copywriting
  if (/\b(copy|copies|headline|texto|escreva|crie.*anúncio|gere.*variação|redação|título|descrição.*ad|gancho|hook|cta)\b/.test(msg)) return 'copywriter';

  // Creative / Visual
  if (/\b(criativo|visual|imagem|vídeo|design|banner|carrossel|stories|reels|formato|briefing.*visual|thumbnail)\b/.test(msg)) return 'creative';

  // Optimization / Diagnosis
  if (/\b(otimiz|diagnóst|melhorar|problem|corrig|ajust|pausar|escalar|bid|lance|orçamento|budget|alocar|redistribu|audiência|segmentação|público)\b/.test(msg)) return 'optimizer';

  // Insights / Reports
  if (/\b(relatório|report|resumo|overview|dashboard|comparar|tendência|evolução|histórico|semana|mês|ontem|hoje|performance|resultado)\b/.test(msg)) return 'insights';

  // Apollo/MIDAS deep analysis
  if (/\b(apollo|midas|sala.*guerra|brain.*trust|estratég|plano|escala|crescer|meta|kpi|roas|cpa|ctr|cpc|cpm|benchmark|funil)\b/.test(msg)) return 'midas';

  // Default: general assistant
  return 'assistant';
}

export function AIAssistantButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Olá! Sou a **LogosIA**, sua central de inteligência para tráfego pago.\n\nPosso te ajudar com:\n• 📊 Relatórios e análises em tempo real\n• 🎯 Diagnóstico e otimização de campanhas\n• ✍️ Criação de copies e criativos\n• 🧠 Estratégias avançadas com Apollo\n• ⚡ Ações automáticas nos seus anúncios\n\nPergunte qualquer coisa ou use os atalhos abaixo!',
      timestamp: new Date(),
      context: 'assistant',
      agentName: 'LogosIA',
    },
  ]);
  const [input, setInput] = useState('');
  const [activeContext, setActiveContext] = useState<string>('assistant');
  const [showQuickActions, setShowQuickActions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { connectedAccount } = useMetaConnection();

  const { data: accountData } = useMetaInsights({
    accountId: connectedAccount?.account_id,
    datePreset: 'last_7d',
    fields: 'spend,impressions,clicks,ctr,actions,action_values,cpc,cpm,conversions,cost_per_action_type',
    enabled: !!connectedAccount && isOpen,
  });

  const metricsData = useMemo(() => {
    const raw = accountData?.data?.[0] || accountData?.[0] || {};
    return {
      ...raw,
      _accountName: connectedAccount?.account_name || '',
      _accountId: connectedAccount?.account_id || '',
      _dateRange: 'Últimos 7 dias',
    };
  }, [accountData, connectedAccount]);

  const { sendMessage, isLoading, cancel } = useClaudeChat({
    context: activeContext as any,
    config: { metricsData },
    onDelta: (delta) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: m.content + delta } : m);
        }
        return prev;
      });
    },
    onComplete: (fullResponse) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.id.startsWith('streaming-')) {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, id: Date.now().toString(), content: fullResponse } : m);
        }
        return prev;
      });
    },
    onError: (error) => {
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `❌ **Erro:** ${error}\n\nTente novamente ou reformule sua pergunta.`,
        timestamp: new Date(),
        context: activeContext,
      }]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSend = async (overrideInput?: string, overrideContext?: string) => {
    const text = overrideInput || input.trim();
    if (!text || isLoading) return;

    // Detect intent and set context
    const detectedContext = overrideContext || detectContext(text);
    setActiveContext(detectedContext);
    setShowQuickActions(false);

    const agentInfo = AGENT_LABELS[detectedContext] || AGENT_LABELS.assistant;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const streamMsg: Message = {
      id: `streaming-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      context: detectedContext,
      agentName: agentInfo.name,
    };

    setMessages(prev => [...prev, userMsg, streamMsg]);
    setInput('');

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    const history = [...messages, userMsg]
      .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.id.startsWith('streaming-')))
      .map(m => ({ role: m.role, content: m.content }));

    try {
      await sendMessage(history, { metricsData });
    } catch { /* handled by onError */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  // Simple markdown rendering
  const renderContent = (content: string) => {
    if (!content) return null;
    return content.split('\n').map((line, i) => {
      // Bold
      let processed = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Bullet points
      if (processed.startsWith('• ') || processed.startsWith('- ')) {
        processed = `<span class="ml-2">${processed}</span>`;
      }
      // Headers
      if (processed.startsWith('## ')) {
        return <h3 key={i} className="font-semibold text-sm mt-2 mb-1" dangerouslySetInnerHTML={{ __html: processed.slice(3) }} />;
      }
      if (processed.startsWith('### ')) {
        return <h4 key={i} className="font-medium text-xs mt-2 mb-1 text-muted-foreground" dangerouslySetInnerHTML={{ __html: processed.slice(4) }} />;
      }
      return <p key={i} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: processed }} />;
    });
  };

  return (
    <>
      {/* Floating button */}
      <motion.div
        className="fixed bottom-6 right-6 z-50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring' }}
      >
        <Button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            "h-14 w-14 rounded-full shadow-lg transition-all duration-300",
            isOpen
              ? "bg-muted hover:bg-muted/80"
              : "gradient-primary glow-primary hover:scale-105"
          )}
          size="icon"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </Button>
        {/* Notification dot */}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-amber-400 border-2 border-background animate-pulse" />
        )}
      </motion.div>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-24 right-6 z-50 w-[420px] max-h-[600px] overflow-hidden rounded-2xl border border-border/50 bg-card shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border/50 bg-gradient-to-r from-[hsl(231,75%,30%)] to-[hsl(231,60%,20%)] p-4">
              <div className="relative">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
                  <Brain className="h-5 w-5 text-amber-300" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-[hsl(231,75%,30%)]" />
              </div>
              <div className="flex-1">
                <h3 className="font-heading font-semibold text-white text-sm">LogosIA Central</h3>
                <p className="text-[11px] text-white/60">
                  {connectedAccount ? `${connectedAccount.account_name} • Online` : 'Conecte sua conta Meta'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {isLoading && (
                  <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                    <Loader2 className="h-3 w-3 animate-spin text-amber-300" />
                    <span className="text-[10px] text-white/70">Pensando...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 h-[380px] p-4" ref={scrollRef}>
              <div className="flex flex-col gap-3">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5",
                      m.role === 'user'
                        ? 'bg-gradient-to-r from-[hsl(231,75%,35%)] to-[hsl(231,60%,25%)] text-white rounded-br-md'
                        : 'bg-muted/50 border border-border/30 rounded-bl-md'
                    )}>
                      {/* Agent label for assistant messages */}
                      {m.role === 'assistant' && m.agentName && (
                        <div className={cn("flex items-center gap-1 mb-1", AGENT_LABELS[m.context || 'assistant']?.color || 'text-blue-400')}>
                          {AGENT_LABELS[m.context || 'assistant']?.icon}
                          <span className="text-[10px] font-medium uppercase tracking-wider">{m.agentName}</span>
                        </div>
                      )}
                      <div className="text-sm whitespace-pre-wrap">
                        {m.role === 'assistant' ? renderContent(m.content) : m.content}
                        {m.id.startsWith('streaming-') && isLoading && (
                          <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 rounded-sm" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Actions */}
              {showQuickActions && messages.length <= 1 && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {QUICK_ACTIONS.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(action.prompt, action.context)}
                      className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted/30 p-3 text-left hover:bg-muted/60 hover:border-primary/30 transition-all group"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                        {action.icon}
                      </div>
                      <span className="text-xs font-medium leading-tight">{action.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Input area */}
            <div className="border-t border-border/50 p-3 bg-card/50">
              {/* Active agent indicator */}
              {activeContext !== 'assistant' && (
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <div className={cn("flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px]", AGENT_LABELS[activeContext]?.color)}>
                    {AGENT_LABELS[activeContext]?.icon}
                    <span className="font-medium">{AGENT_LABELS[activeContext]?.name}</span>
                  </div>
                  <button
                    onClick={() => setActiveContext('assistant')}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    ← Voltar ao geral
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleTextareaInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Pergunte qualquer coisa..."
                    className="w-full resize-none rounded-xl border border-border/50 bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 min-h-[40px] max-h-[120px]"
                    rows={1}
                    disabled={isLoading}
                  />
                </div>
                {isLoading ? (
                  <Button
                    onClick={cancel}
                    size="icon"
                    variant="outline"
                    className="h-10 w-10 rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSend()}
                    size="icon"
                    className="h-10 w-10 rounded-xl bg-gradient-to-br from-[hsl(231,75%,35%)] to-[hsl(45,100%,50%)] hover:opacity-90 transition-opacity"
                    disabled={!input.trim()}
                  >
                    <Send className="h-4 w-4 text-white" />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
