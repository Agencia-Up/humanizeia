import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Send, Bot, User, Sparkles, TrendingUp, Target, DollarSign,
  BarChart3, Loader2, Trash2, Database, MessageCircle, Lightbulb,
  CheckCircle2, X, Zap, Search, Scale, Brain,
} from 'lucide-react';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { MidasDataForm } from '@/components/midas/MidasDataForm';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  insight?: InsightData | null;
}

interface InsightData {
  title: string;
  description: string;
  type: 'opportunity' | 'warning' | 'action';
  actionLabel?: string;
  dismissed?: boolean;
  applied?: boolean;
}

const quickChips = [
  { label: '📊 Como estão minhas campanhas?', prompt: 'Como estão minhas campanhas? Faça um resumo rápido da performance atual.' },
  { label: '💰 Onde posso economizar?', prompt: 'Analisando meus dados, onde posso economizar sem perder performance?' },
  { label: '🚀 Qual campanha escalar?', prompt: 'Qual das minhas campanhas tem mais potencial para escalar agora?' },
  { label: '🎯 Analise meu CPA', prompt: 'Analise meu CPA atual e compare com os benchmarks do mercado.' },
];

const suggestedPrompts = [
  {
    icon: BarChart3,
    title: 'Analisar Campanhas',
    description: 'Veja como suas campanhas estão performando',
    prompt: 'Quero analisar minhas campanhas do Meta Ads. Vou te passar os dados de performance.',
    action: 'prompt' as const,
  },
  {
    icon: TrendingUp,
    title: 'Gerar Copies',
    description: 'Crie textos que convertem mais',
    prompt: 'Preciso de 5 variações de copy para um anúncio de produto. Qual informação você precisa?',
    action: 'prompt' as const,
  },
  {
    icon: DollarSign,
    title: 'Otimizar Orçamento',
    description: 'Distribua melhor seu investimento',
    prompt: 'Tenho R$10.000/mês para investir em tráfego pago. Como devo distribuir entre Meta e Google?',
    action: 'prompt' as const,
  },
  {
    icon: Target,
    title: 'Estratégia de Escala',
    description: 'Aumente seus resultados com segurança',
    prompt: 'Minha campanha está dando bons resultados. Como escalar sem perder performance?',
    action: 'prompt' as const,
  },
  {
    icon: Database,
    title: 'Alimentar Brain Trust',
    description: 'Envie dados para análise completa',
    prompt: '',
    action: 'openForm' as const,
  },
  {
    icon: Search,
    title: 'Diagnóstico Completo',
    description: 'Análise profunda de toda a conta',
    prompt: 'Faça um diagnóstico completo da minha conta de anúncios. Quais são os pontos críticos?',
    action: 'prompt' as const,
  },
];

function parseInsights(content: string): InsightData | null {
  // Detect insight patterns in Apollo's response
  const patterns = [
    { regex: /🔴\s*(CRÍTICO|ESTANCAR)/i, type: 'warning' as const },
    { regex: /🟢\s*(ESCALAR|SAUDÁVEL)/i, type: 'opportunity' as const },
    { regex: /🟡\s*(ATENÇÃO|AJUSTAR)/i, type: 'action' as const },
    { regex: /💡\s*(?:Oportunidade|Recomendação|Insight)/i, type: 'opportunity' as const },
    { regex: /⚠️\s*(?:Alerta|Atenção|Problema)/i, type: 'warning' as const },
  ];

  for (const { regex, type } of patterns) {
    const match = content.match(regex);
    if (match) {
      // Extract a short description from nearby text
      const lineIndex = content.indexOf(match[0]);
      const nearbyText = content.slice(lineIndex, lineIndex + 200).split('\n')[0];
      return {
        title: type === 'warning' ? '⚠️ Atenção Necessária' : type === 'opportunity' ? '💡 Oportunidade Detectada' : '🎯 Ação Recomendada',
        description: nearbyText.replace(/[#*]/g, '').trim().slice(0, 120),
        type,
        actionLabel: type === 'opportunity' ? 'Ver detalhes' : type === 'warning' ? 'Resolver agora' : 'Aplicar',
      };
    }
  }
  return null;
}

function InsightCard({ insight, onApply, onDismiss }: { insight: InsightData; onApply: () => void; onDismiss: () => void }) {
  if (insight.dismissed || insight.applied) return null;

  const borderColor = insight.type === 'warning'
    ? 'border-destructive/50'
    : insight.type === 'opportunity'
      ? 'border-warning/50'
      : 'border-primary/50';

  const bgColor = insight.type === 'warning'
    ? 'bg-destructive/5'
    : insight.type === 'opportunity'
      ? 'bg-warning/5'
      : 'bg-primary/5';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn('rounded-xl border-2 p-4 mt-2', borderColor, bgColor)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <p className="font-semibold text-sm text-foreground">{insight.title}</p>
          <p className="text-xs text-muted-foreground">{insight.description}</p>
        </div>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-2 mt-3">
        <Button size="sm" onClick={onApply} className="h-7 text-xs gradient-primary text-primary-foreground">
          <Zap className="h-3 w-3 mr-1" />
          {insight.actionLabel || 'Aplicar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} className="h-7 text-xs">
          Ignorar
        </Button>
      </div>
    </motion.div>
  );
}

export default function MidasAgent() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [dataFormOpen, setDataFormOpen] = useState(false);
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, isLoading, cancel } = useClaudeChat({
    context: 'midas',
    onDelta: (delta) => {
      setStreamingContent((prev) => prev + delta);
    },
    onComplete: (fullResponse) => {
      const insight = parseInsights(fullResponse);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: fullResponse, timestamp: new Date(), insight },
      ]);
      setStreamingContent('');
    },
    onError: (error) => {
      setStreamingContent('');
      toast({ title: 'Erro no Apollo', description: error, variant: 'destructive' });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  const dispatchMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { role: 'user', content: text.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const allMessages = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
    try {
      await sendMessage(allMessages);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleSend = () => dispatchMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedPrompt = (item: (typeof suggestedPrompts)[number]) => {
    if (item.action === 'openForm') {
      setDataFormOpen(true);
    } else {
      dispatchMessage(item.prompt);
    }
  };

  const handleDataFormSubmit = (formattedMessage: string) => {
    dispatchMessage(formattedMessage);
  };

  const clearChat = () => {
    setMessages([]);
    setStreamingContent('');
  };

  const handleInsightApply = (index: number) => {
    toast({ title: '✅ Ação registrada!', description: 'O Apollo vai detalhar a implementação.' });
    setMessages((prev) =>
      prev.map((m, i) =>
        i === index && m.insight ? { ...m, insight: { ...m.insight, applied: true } } : m
      )
    );
    dispatchMessage('Detalhe o passo a passo para implementar essa recomendação que você acabou de fazer.');
  };

  const handleInsightDismiss = (index: number) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === index && m.insight ? { ...m, insight: { ...m.insight, dismissed: true } } : m
      )
    );
  };

  const getLastAssistantMessage = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].content;
    }
    return null;
  };

  const sendReportToWhatsApp = async () => {
    const lastReport = getLastAssistantMessage();
    if (!lastReport) {
      toast({ title: 'Nenhum relatório', description: 'Peça ao Apollo gerar um relatório primeiro.', variant: 'destructive' });
      return;
    }
    setIsSendingWhatsApp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: { action: 'send_report', reportContent: `📊 *RELATÓRIO APOLLO*\n\n${lastReport}` },
      });
      if (error) throw error;
      if (data?.success) {
        toast({ title: '✅ Relatório enviado!', description: 'Confira seu WhatsApp.' });
      } else {
        throw new Error(data?.error || 'Falha ao enviar');
      }
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const hasMessages = messages.length > 0 || !!streamingContent;

  return (
    <MainLayout>
      <div className="flex flex-col h-[calc(100vh-80px)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Apollo Avatar - Ciano with orange border */}
            <div className="relative">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl gradient-primary ring-2 ring-warning/60 ring-offset-2 ring-offset-background">
                <Bot className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success ring-2 ring-background" />
            </div>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <span className="gradient-text">APOLLO</span>
                <Badge className="bg-warning/10 text-warning border-warning/30 text-[10px]">
                  ✦ AI Agent
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                Analista Senior de Performance • Online agora
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDataFormOpen(true)} className="h-8 text-xs">
              <Database className="h-3.5 w-3.5 mr-1.5" />
              <span className="hidden sm:inline">Alimentar Dados</span>
            </Button>
            {hasMessages && (
              <>
                <Button variant="outline" size="sm" onClick={sendReportToWhatsApp} disabled={isSendingWhatsApp}
                  className="h-8 text-xs border-success/30 text-success hover:bg-success/10">
                  {isSendingWhatsApp ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5 mr-1.5" />}
                  <span className="hidden sm:inline">WhatsApp</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={clearChat} className="h-8 text-xs text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Chat Container */}
        <Card className="flex-1 flex flex-col overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            <ScrollArea className="flex-1 p-4">
              {!hasMessages ? (
                /* Empty State */
                <div className="flex flex-col items-center justify-center h-full py-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200 }}
                    className="relative mb-6"
                  >
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl gradient-primary ring-4 ring-warning/30 ring-offset-4 ring-offset-background">
                      <Brain className="h-10 w-10 text-primary-foreground" />
                    </div>
                    <motion.div
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ repeat: Infinity, duration: 3 }}
                      className="absolute -right-2 -top-2"
                    >
                      <Sparkles className="h-6 w-6 text-warning" />
                    </motion.div>
                  </motion.div>

                  <h2 className="text-xl font-bold mb-1">Olá! Eu sou o <span className="gradient-text">Apollo</span> 🔥</h2>
                  <p className="text-sm text-muted-foreground text-center max-w-md mb-6">
                    Seu Analista Senior de Mídia Paga. Pergunte qualquer coisa sobre suas campanhas!
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 w-full max-w-3xl">
                    {suggestedPrompts.map((item, index) => (
                      <motion.button
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.08 }}
                        onClick={() => handleSuggestedPrompt(item)}
                        className={cn(
                          'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all hover:shadow-md',
                          item.action === 'openForm'
                            ? 'border-warning/40 bg-warning/5 hover:bg-warning/10 hover:border-warning/60'
                            : 'border-border/50 bg-card/80 hover:bg-accent hover:border-primary/40'
                        )}
                      >
                        <div className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                          item.action === 'openForm' ? 'bg-warning/20' : 'bg-primary/10'
                        )}>
                          <item.icon className={cn('h-4 w-4', item.action === 'openForm' ? 'text-warning' : 'text-primary')} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">{item.description}</p>
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Messages */
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn('flex gap-3', message.role === 'user' ? 'justify-end' : 'justify-start')}
                    >
                      {message.role === 'assistant' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-primary ring-1 ring-warning/40">
                          <Bot className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                      <div className="max-w-[80%] space-y-0">
                        <div
                          className={cn(
                            'rounded-2xl px-4 py-3',
                            message.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-br-md'
                              : 'bg-muted rounded-bl-md'
                          )}
                        >
                          {message.role === 'assistant' ? (
                            <MarkdownRenderer content={message.content} />
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                          )}
                          <p className="text-[10px] opacity-40 mt-1.5">
                            {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>

                        {/* Inline Insight Card */}
                        <AnimatePresence>
                          {message.insight && !message.insight.dismissed && !message.insight.applied && (
                            <InsightCard
                              insight={message.insight}
                              onApply={() => handleInsightApply(index)}
                              onDismiss={() => handleInsightDismiss(index)}
                            />
                          )}
                        </AnimatePresence>
                      </div>

                      {message.role === 'user' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/80">
                          <User className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </motion.div>
                  ))}

                  {/* Streaming message */}
                  {streamingContent && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-primary ring-1 ring-warning/40">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-3 bg-muted">
                        <MarkdownRenderer content={streamingContent} />
                      </div>
                    </motion.div>
                  )}

                  {/* Loading indicator */}
                  {isLoading && !streamingContent && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-primary ring-1 ring-warning/40">
                        <Bot className="h-4 w-4 text-primary-foreground" />
                      </div>
                      <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-muted">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="text-xs text-muted-foreground">Apollo está analisando...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              )}
            </ScrollArea>

            {/* Quick Chips - shown when chat has messages */}
            {hasMessages && (
              <div className="border-t border-border/30 px-4 py-2">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {quickChips.map((chip, i) => (
                    <button
                      key={i}
                      onClick={() => dispatchMessage(chip.prompt)}
                      disabled={isLoading}
                      className="shrink-0 rounded-full border border-border/50 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/40 transition-all disabled:opacity-50"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-border/50 p-3">
              <div className="flex gap-2 items-end">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pergunte ao Apollo sobre suas campanhas..."
                  className="min-h-[44px] max-h-[150px] resize-none text-sm rounded-xl"
                  disabled={isLoading}
                />
                <Button
                  onClick={isLoading ? cancel : handleSend}
                  disabled={!input.trim() && !isLoading}
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl gradient-primary text-primary-foreground"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
                ✦ Apollo usa IA para análise • Sempre valide com seus dados reais ✦
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <MidasDataForm open={dataFormOpen} onOpenChange={setDataFormOpen} onSubmit={handleDataFormSubmit} />
    </MainLayout>
  );
}
