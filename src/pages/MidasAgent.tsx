import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Send, Bot, User, Sparkles, TrendingUp, Target, DollarSign, BarChart3, Loader2, Trash2, Database, MessageCircle } from 'lucide-react';
import { useClaudeChat } from '@/hooks/useClaudeChat';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { MidasDataForm } from '@/components/midas/MidasDataForm';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const suggestedPrompts = [
  {
    icon: BarChart3,
    title: 'Analisar Campanhas',
    prompt: 'Quero analisar minhas campanhas do Meta Ads. Vou te passar os dados de performance.',
    action: 'prompt' as const,
  },
  {
    icon: TrendingUp,
    title: 'Gerar Copies',
    prompt: 'Preciso de 5 variações de copy para um anúncio de produto. Qual informação você precisa?',
    action: 'prompt' as const,
  },
  {
    icon: DollarSign,
    title: 'Otimizar Orçamento',
    prompt: 'Tenho R$10.000/mês para investir em tráfego pago. Como devo distribuir entre Meta e Google?',
    action: 'prompt' as const,
  },
  {
    icon: Target,
    title: 'Estratégia de Escala',
    prompt: 'Minha campanha está dando bons resultados. Como escalar sem perder performance?',
    action: 'prompt' as const,
  },
  {
    icon: Database,
    title: 'Alimentar Brain Trust',
    prompt: '',
    action: 'openForm' as const,
  },
];

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
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: fullResponse, timestamp: new Date() },
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

    const allMessages = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

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
      setInput(item.prompt);
      textareaRef.current?.focus();
    }
  };

  const handleDataFormSubmit = (formattedMessage: string) => {
    dispatchMessage(formattedMessage);
  };

  const clearChat = () => {
    setMessages([]);
    setStreamingContent('');
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
      toast({ title: 'Nenhum relatório para enviar', description: 'Peça ao Apollo gerar um relatório primeiro.', variant: 'destructive' });
      return;
    }

    setIsSendingWhatsApp(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: {
          action: 'send_report',
          reportContent: `📊 *RELATÓRIO APOLLO*\n\n${lastReport}`,
        },
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

  return (
    <MainLayout>
      <div className="flex flex-col h-[calc(100vh-80px)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-yellow-600 shadow-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold gradient-text flex items-center gap-2">
                APOLLO
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600">
                  AI Agent
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground">
                Seu Analista Senior de Mídia Paga com 15 anos de experiência
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDataFormOpen(true)}>
              <Database className="h-4 w-4 mr-2" />
              Alimentar Dados
            </Button>
            {messages.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendReportToWhatsApp}
                  disabled={isSendingWhatsApp}
                  className="border-green-500/30 text-green-600 hover:bg-green-500/10"
                >
                  {isSendingWhatsApp ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <MessageCircle className="h-4 w-4 mr-2" />
                  )}
                  Enviar WhatsApp
                </Button>
                <Button variant="outline" size="sm" onClick={clearChat}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Limpar Chat
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Chat Container */}
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="border-b py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-muted-foreground">Apollo está online e pronto para ajudar</span>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            <ScrollArea className="flex-1 p-4">
              {messages.length === 0 && !streamingContent ? (
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/20 to-yellow-600/20 mb-6">
                    <Sparkles className="h-10 w-10 text-amber-500" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">Olá! Eu sou o Apollo 🔥</h2>
                  <p className="text-muted-foreground text-center max-w-md mb-8">
                    Seu Analista Senior de Mídia Paga. Gerenciei mais de R$500 milhões em Meta Ads e Google Ads.
                    Como posso ajudar você hoje?
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-3xl">
                    {suggestedPrompts.map((item, index) => (
                      <button
                        key={index}
                        onClick={() => handleSuggestedPrompt(item)}
                        className={cn(
                          'flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-accent transition-colors text-left',
                          item.action === 'openForm' && 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                        )}
                      >
                        <div className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-lg',
                          item.action === 'openForm' ? 'bg-amber-500/20' : 'bg-amber-500/10'
                        )}>
                          <item.icon className="h-5 w-5 text-amber-600" />
                        </div>
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {item.action === 'openForm'
                              ? 'Envie dados estruturados para análise'
                              : item.prompt}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {message.role === 'assistant' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-yellow-600">
                          <Bot className="h-4 w-4 text-white" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                        }`}
                      >
                        {message.role === 'assistant' ? (
                          <MarkdownRenderer content={message.content} />
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        )}
                        <p className="text-[10px] opacity-50 mt-1">
                          {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      {message.role === 'user' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
                          <User className="h-4 w-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  ))}

                  {streamingContent && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-yellow-600">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-muted">
                        <MarkdownRenderer content={streamingContent} />
                      </div>
                    </div>
                  )}

                  {isLoading && !streamingContent && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-yellow-600">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <div className="rounded-2xl px-4 py-3 bg-muted">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                          <span className="text-sm text-muted-foreground">MIDAS está analisando...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>
              )}
            </ScrollArea>

            {/* Input Area */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite sua pergunta para o MIDAS..."
                  className="min-h-[50px] max-h-[150px] resize-none"
                  disabled={isLoading}
                />
                <Button
                  onClick={isLoading ? cancel : handleSend}
                  disabled={!input.trim() && !isLoading}
                  className="bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                MIDAS usa IA para análise de campanhas. Sempre valide recomendações com seus dados reais.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Form Sheet */}
      <MidasDataForm
        open={dataFormOpen}
        onOpenChange={setDataFormOpen}
        onSubmit={handleDataFormSubmit}
      />
    </MainLayout>
  );
}
