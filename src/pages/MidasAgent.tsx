import { useState, useRef, useEffect } from 'react';
import { useSuperGestor, ChatMessage } from '@/hooks/useSuperGestor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MainLayout } from '@/components/layout/MainLayout';
import { ApolloSidebar } from '@/components/apollo/ApolloSidebar';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import { 
  Send, 
  Sparkles, 
  Brain, 
  Trash2, 
  Loader2, 
  Rocket,
  BarChart3,
  Lightbulb,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Activity,
  Shield,
  Zap,
  MessageSquarePlus,
  History,
  ChevronLeft,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ApolloAgent = () => {
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    messages,
    isLoading,
    isExecuting,
    strategy,
    chat,
    executeStrategy,
    clearChat,
    conversations,
    activeConversationId,
    isLoadingConversations,
    isLoadingMessages,
    selectConversation,
    newConversation,
  } = useSuperGestor();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const message = input;
    setInput('');
    await chat(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickSuggestions = [
    { label: "Diagnóstico do funil", icon: Activity, prompt: "Faça um diagnóstico completo da saúde do meu funil de vendas" },
    { label: "Alertas ativos", icon: AlertTriangle, prompt: "Quais alertas estão ativos nas minhas campanhas? Identifique anomalias." },
    { label: "Otimizar ROAS", icon: Zap, prompt: "Analise minhas campanhas e sugira otimizações para melhorar o ROAS" },
    { label: "Criar campanha", icon: Sparkles, prompt: "Crie uma estratégia completa de campanha para meu produto" },
  ];

  const handleExecuteStrategy = async () => {
    if (!strategy) return;
    await executeStrategy(strategy, { dryRun: false });
  };

  const handleSimulateStrategy = async () => {
    if (!strategy) return;
    await executeStrategy(strategy, { dryRun: true });
  };

  const handleAlertAction = (alertId: string, action: string) => {
    chat(`Executar ação "${action}" para o alerta ${alertId}`);
  };

  return (
    <MainLayout>
      <div className="flex h-[calc(100vh-80px)] max-h-[calc(100vh-80px)]">
        {/* Conversation History Panel */}
        {historyOpen && (
          <div className="w-72 border-r border-border/50 flex flex-col bg-muted/30">
            <div className="flex items-center justify-between p-3 border-b border-border/50">
              <span className="text-sm font-semibold text-foreground">Conversas</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={newConversation}>
                  <MessageSquarePlus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHistoryOpen(false)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {isLoadingConversations && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { selectConversation(conv.id); setHistoryOpen(false); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      activeConversationId === conv.id
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    }`}
                  >
                    <p className="truncate font-medium">{conv.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(conv.updated_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </button>
                ))}
                {!isLoadingConversations && conversations.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhuma conversa salva</p>
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Main Chat Area */}
        <div className="flex flex-col flex-1 min-w-0">
          
          {/* HEADER */}
          <div className="flex items-center justify-between p-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setHistoryOpen(!historyOpen)}
                className="text-muted-foreground hover:text-foreground h-9 w-9"
                title="Histórico de conversas"
              >
                <History className="w-5 h-5" />
              </Button>
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg shadow-primary/20">
                <Brain className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
                  Apollo 2.0
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                </h1>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Sistema de Inteligência Estratégica
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={newConversation}
                className="text-muted-foreground hover:text-foreground"
                title="Nova conversa"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearChat}
                className="text-muted-foreground hover:text-foreground"
                title="Apagar conversa"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* MESSAGE AREA */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto">
              
              {messages.length === 0 && (
                <div className="text-center py-10">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-5 ring-1 ring-primary/20">
                    <Brain className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2">
                    Apollo 2.0 — Super Gestor
                  </h2>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                    Sistema de inteligência que monitora, diagnostica e otimiza todo o funil — 
                    do anúncio à conversão e pós-venda.
                  </p>

                  <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto">
                    {quickSuggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => chat(s.prompt)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-3 py-2.5 bg-muted/50 hover:bg-accent rounded-lg text-sm text-muted-foreground 
                                   transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left border border-border/30 hover:border-primary/30"
                      >
                        <s.icon className="w-4 h-4 shrink-0 text-primary" />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble 
                  key={msg.id} 
                  message={msg} 
                  onExecute={handleExecuteStrategy}
                  onSimulate={handleSimulateStrategy}
                  isExecuting={isExecuting}
                />
              ))}

              {isLoading && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Apollo está analisando</span>
                    <span className="flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* INPUT */}
          <div className="p-4 border-t border-border/50">
            <div className="max-w-3xl mx-auto">
              
              <div className="flex gap-2 mb-2.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => chat('Faça um diagnóstico completo do meu funil e identifique gargalos')}
                  disabled={isLoading}
                  className="text-xs h-7 gap-1.5"
                >
                  <Activity className="w-3.5 h-3.5" />
                  Diagnosticar Funil
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => chat('Analise a performance de todas as minhas campanhas ativas')}
                  disabled={isLoading}
                  className="text-xs h-7 gap-1.5"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Analisar Performance
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => chat('Me dê 3 sugestões de otimização para escalar com segurança')}
                  disabled={isLoading}
                  className="text-xs h-7 gap-1.5"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  Sugestões
                </Button>
              </div>

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Pergunte ao Apollo..."
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="px-5"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Diagnostic Sidebar */}
        <ApolloSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onAlertAction={handleAlertAction}
        />
      </div>
    </MainLayout>
  );
};

// ===== MESSAGE BUBBLE =====

interface MessageBubbleProps {
  message: ChatMessage;
  onExecute?: () => void;
  onSimulate?: () => void;
  isExecuting?: boolean;
}

const MessageBubble = ({ message, onExecute, onSimulate, isExecuting }: MessageBubbleProps) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
        isUser 
          ? 'bg-muted' 
          : 'bg-gradient-to-br from-primary to-primary/60'
      }`}>
        {isUser ? (
          <span className="text-xs">👤</span>
        ) : (
          <Brain className="w-3.5 h-3.5 text-primary-foreground" />
        )}
      </div>

      <div className={`max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block rounded-2xl px-4 py-2.5 ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted/60 text-foreground border border-border/30'
        }`}>
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm prose-sm">
              <MarkdownRenderer content={message.content} />
            </div>
          )}
        </div>

        {message.type === 'strategy' && message.data && (
          <StrategyCard 
            strategy={message.data} 
            onExecute={onExecute}
            onSimulate={onSimulate}
            isExecuting={isExecuting}
          />
        )}

        {message.type === 'validation' && message.data && (
          <ValidationCard validation={message.data} />
        )}

        {message.type === 'execution' && message.data && (
          <ExecutionCard execution={message.data} />
        )}

        <p className={`text-[10px] text-muted-foreground mt-1 ${isUser ? 'text-right' : ''}`}>
          {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
};

// ===== STRATEGY CARD =====

const StrategyCard = ({ strategy, onExecute, onSimulate, isExecuting }: any) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="mt-2 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 overflow-hidden">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Estratégia Gerada</span>
        </div>

        {strategy.optimization?.budgetAllocation && (
          <div className="mb-3">
            <p className="text-[11px] text-muted-foreground mb-1.5">Distribuição de Orçamento</p>
            <div className="flex gap-1.5">
              {Object.entries(strategy.optimization.budgetAllocation).map(([platform, percent]) => (
                <span 
                  key={platform}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                    platform === 'meta' ? 'bg-blue-500/20 text-blue-300' :
                    platform === 'google' ? 'bg-red-500/20 text-red-300' :
                    'bg-purple-500/20 text-purple-300'
                  }`}
                >
                  {platform.toUpperCase()} {String(percent)}%
                </span>
              ))}
            </div>
          </div>
        )}

        {expanded && strategy.copies?.headlines && (
          <div className="mb-3">
            <p className="text-[11px] text-muted-foreground mb-1.5">Headlines Sugeridos</p>
            <div className="space-y-1">
              {strategy.copies.headlines.slice(0, 3).map((h: string, i: number) => (
                <p key={i} className="text-xs text-foreground bg-muted/50 px-2.5 py-1 rounded">
                  {h}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-border/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground h-7"
          >
            {expanded ? 'Menos' : 'Detalhes'}
          </Button>
          
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="sm" onClick={onSimulate} disabled={isExecuting} className="h-7 text-xs">
              Simular
            </Button>
            <Button size="sm" onClick={onExecute} disabled={isExecuting} className="h-7 text-xs">
              {isExecuting ? (
                <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Executando...</>
              ) : (
                <><Rocket className="w-3 h-3 mr-1.5" /> Publicar</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

// ===== VALIDATION CARD =====

const ValidationCard = ({ validation }: any) => {
  const scoreColor = validation.score >= 80 ? 'text-emerald-400' : 
                     validation.score >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <Card className="mt-2 bg-card border-border/50 overflow-hidden">
      <div className="p-3">
        <div className="flex items-center gap-3 mb-3">
          <div className={`text-3xl font-bold ${scoreColor}`}>{validation.score}</div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {validation.isValid ? '✅ Aprovado' : '⚠️ Revisar'}
            </p>
            <p className="text-xs text-muted-foreground">Score de validação</p>
          </div>
        </div>

        {validation.issues?.length > 0 && (
          <div className="mb-2">
            {validation.issues.map((issue: any, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-foreground mb-1">
                {issue.severity === 'high' ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        {validation.suggestions?.length > 0 && (
          <div>
            {validation.suggestions.map((sug: string, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-foreground mb-1">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>{sug}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

// ===== EXECUTION CARD =====

const ExecutionCard = ({ execution }: any) => {
  const successRate = Math.round((execution.successful / execution.total) * 100);

  return (
    <Card className="mt-2 bg-card border-border/50 overflow-hidden">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-foreground">Execução Concluída</span>
          <span className={`text-xs ${execution.failed === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {successRate}% sucesso
          </span>
        </div>

        <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
          <div 
            className="h-full bg-gradient-to-r from-primary to-emerald-500"
            style={{ width: `${successRate}%` }}
          />
        </div>

        <div className="space-y-1.5">
          {execution.results?.map((result: any, i: number) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              {result.success ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className="text-foreground">
                {result.platform.toUpperCase()}: {result.action}
              </span>
              {result.result?.id && (
                <span className="text-[10px] text-muted-foreground">ID: {result.result.id}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

export default ApolloAgent;
