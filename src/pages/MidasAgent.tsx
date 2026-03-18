import { useState, useRef, useEffect } from 'react';
import { useSuperGestor, ChatMessage } from '@/hooks/useSuperGestor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MainLayout } from '@/components/layout/MainLayout';
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
} from 'lucide-react';

const ApolloAgent = () => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const {
    messages,
    isLoading,
    isExecuting,
    strategy,
    chat,
    executeStrategy,
    clearChat,
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
    "Como estão minhas campanhas?",
    "Qual campanha devo escalar?",
    "Analise meu CPA",
    "Sugira otimizações",
  ];

  const handleExecuteStrategy = async () => {
    if (!strategy) return;
    await executeStrategy(strategy, { dryRun: false });
  };

  const handleSimulateStrategy = async () => {
    if (!strategy) return;
    await executeStrategy(strategy, { dryRun: true });
  };

  return (
    <MainLayout>
      <div className="flex flex-col h-[calc(100vh-80px)] max-h-[calc(100vh-80px)]">
        
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
              <Brain className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                Super Gestor Apollo
                <span className="flex items-center gap-1 text-xs font-normal text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Online
                </span>
              </h1>
              <p className="text-sm text-muted-foreground">Powered by Claude AI</p>
            </div>
          </div>
          
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={clearChat}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {/* ÁREA DE MENSAGENS */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4 max-w-4xl mx-auto">
            
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mx-auto mb-6">
                  <Brain className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  👋 Olá! Sou o Apollo
                </h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Seu Super Gestor de Tráfego com IA. Posso criar campanhas completas, 
                  analisar performance e otimizar seus anúncios automaticamente.
                </p>

                <p className="text-muted-foreground/60 text-sm mb-4">Experimente perguntar:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickSuggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => chat(suggestion)}
                      disabled={isLoading}
                      className="px-4 py-2 bg-muted hover:bg-accent rounded-full text-sm text-muted-foreground 
                                 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {suggestion}
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
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
                </div>
                <span className="text-sm">Apollo está analisando...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* INPUT E AÇÕES */}
        <div className="p-4 border-t border-border">
          <div className="max-w-4xl mx-auto">
            
            <div className="flex gap-2 mb-3 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => chat('Crie uma estratégia completa de campanha para meu produto')}
                disabled={isLoading}
                className="text-primary border-primary/50 hover:bg-primary/10"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Criar Campanha
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => chat('Analise a performance de todas as minhas campanhas ativas e sugira otimizações')}
                disabled={isLoading}
                className="text-muted-foreground border-border hover:bg-accent"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Analisar Campanhas
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => chat('Me dê 3 sugestões de otimização para melhorar meu ROAS')}
                disabled={isLoading}
                className="text-muted-foreground border-border hover:bg-accent"
              >
                <Lightbulb className="w-4 h-4 mr-2" />
                Sugestões
              </Button>
            </div>

            <div className="flex gap-3">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pergunte algo ao Apollo..."
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="px-6"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

// ===== COMPONENTE DE MENSAGEM =====

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
      <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${
        isUser 
          ? 'bg-muted' 
          : 'bg-gradient-to-br from-primary to-primary/70'
      }`}>
        {isUser ? (
          <span className="text-sm">👤</span>
        ) : (
          <Brain className="w-4 h-4 text-primary-foreground" />
        )}
      </div>

      <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block rounded-2xl px-4 py-3 ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : 'bg-muted text-foreground'
        }`}>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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

        <p className={`text-xs text-muted-foreground mt-1 ${isUser ? 'text-right' : ''}`}>
          {message.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
};

// ===== CARD DE ESTRATÉGIA =====

const StrategyCard = ({ strategy, onExecute, onSimulate, isExecuting }: any) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="mt-3 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="font-semibold text-primary">Estratégia Gerada</span>
        </div>

        {strategy.optimization?.budgetAllocation && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-2">Distribuição de Orçamento</p>
            <div className="flex gap-2">
              {Object.entries(strategy.optimization.budgetAllocation).map(([platform, percent]) => (
                <span 
                  key={platform}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
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
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-2">Headlines Sugeridos</p>
            <div className="space-y-1">
              {strategy.copies.headlines.slice(0, 3).map((h: string, i: number) => (
                <p key={i} className="text-sm text-foreground bg-muted/50 px-3 py-1.5 rounded">
                  {h}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'Menos detalhes' : 'Ver detalhes'}
          </Button>
          
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onSimulate} disabled={isExecuting}>
              Simular
            </Button>
            <Button size="sm" onClick={onExecute} disabled={isExecuting}>
              {isExecuting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Executando...</>
              ) : (
                <><Rocket className="w-4 h-4 mr-2" /> Publicar</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};

// ===== CARD DE VALIDAÇÃO =====

const ValidationCard = ({ validation }: any) => {
  const scoreColor = validation.score >= 80 ? 'text-emerald-400' : 
                     validation.score >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <Card className="mt-3 bg-card border-border overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-4 mb-4">
          <div className={`text-4xl font-bold ${scoreColor}`}>{validation.score}</div>
          <div>
            <p className="font-medium text-foreground">
              {validation.isValid ? '✅ Aprovado' : '⚠️ Revisar'}
            </p>
            <p className="text-sm text-muted-foreground">Score de validação</p>
          </div>
        </div>

        {validation.issues?.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-red-400 mb-2">Problemas encontrados:</p>
            {validation.issues.map((issue: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm text-foreground mb-1">
                {issue.severity === 'high' ? (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        {validation.suggestions?.length > 0 && (
          <div>
            <p className="text-xs text-amber-400 mb-2">Sugestões:</p>
            {validation.suggestions.map((sug: string, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm text-foreground mb-1">
                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{sug}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

// ===== CARD DE EXECUÇÃO =====

const ExecutionCard = ({ execution }: any) => {
  const successRate = Math.round((execution.successful / execution.total) * 100);

  return (
    <Card className="mt-3 bg-card border-border overflow-hidden">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <span className="font-medium text-foreground">Execução Concluída</span>
          <span className={`text-sm ${execution.failed === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {successRate}% sucesso
          </span>
        </div>

        <div className="h-2 bg-muted rounded-full overflow-hidden mb-4">
          <div 
            className="h-full bg-gradient-to-r from-primary to-emerald-500"
            style={{ width: `${successRate}%` }}
          />
        </div>

        <div className="space-y-2">
          {execution.results?.map((result: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {result.success ? (
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span className="text-foreground">
                {result.platform.toUpperCase()}: {result.action}
              </span>
              {result.result?.id && (
                <span className="text-xs text-muted-foreground">ID: {result.result.id}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};

export default ApolloAgent;
