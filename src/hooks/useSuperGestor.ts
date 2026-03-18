import { useState, useCallback, useEffect } from 'react';
import { useClaudeService } from '@/services/claude/useClaudeService';
import { useApolloConversations } from '@/hooks/useApolloConversations';
import type {
  CampaignContext,
  StrategyResponse,
  ValidationResponse,
  AgentInstruction,
} from '@/services/claude/types';
import {
  campaignAgent,
  type ExecutionSummary,
  type ExecutionResult,
} from '@/services/campaign/campaignAgent';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type?: 'text' | 'strategy' | 'validation' | 'optimization' | 'execution';
  data?: unknown;
}

function generateId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function useSuperGestor() {
  const claude = useClaudeService();
  const persistence = useApolloConversations();
  const [isExecuting, setIsExecuting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [strategy, setStrategy] = useState<StrategyResponse | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [lastExecution, setLastExecution] = useState<ExecutionSummary | null>(null);

  // Sync messages from persistence when a conversation is selected
  useEffect(() => {
    if (persistence.messages.length > 0) {
      const mapped: ChatMessage[] = persistence.messages.map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
        type: (m.message_type || 'text') as ChatMessage['type'],
        data: m.data,
      }));
      setMessages(mapped);
    }
  }, [persistence.messages]);

  const addMessage = useCallback(async (
    role: 'user' | 'assistant',
    content: string,
    type?: ChatMessage['type'],
    data?: unknown
  ) => {
    const msg: ChatMessage = {
      id: generateId(),
      role,
      content,
      timestamp: new Date(),
      type: type || 'text',
      data,
    };
    setMessages(prev => [...prev, msg]);

    // Persist to database
    if (persistence.activeConversationId) {
      await persistence.saveMessage(
        persistence.activeConversationId,
        role,
        content,
        type || 'text',
        data,
      );
    }

    return msg;
  }, [persistence]);

  // Ensure there's an active conversation (create one if needed)
  const ensureConversation = useCallback(async (): Promise<string | null> => {
    if (persistence.activeConversationId) return persistence.activeConversationId;
    const id = await persistence.createConversation();
    if (id) {
      persistence.setActiveConversationId(id);
    }
    return id;
  }, [persistence]);

  // Gerar estratégia completa
  const generateStrategy = useCallback(async (context: CampaignContext) => {
    await ensureConversation();
    await addMessage('user', `🎯 Criar estratégia para: ${context.product} (${context.objective})`);

    const result = await claude.generateStrategy(context);
    setStrategy(result);

    if (result) {
      await addMessage('assistant', `✨ **Estratégia gerada com sucesso!**\n\n${result.strategy.summary}`, 'strategy', result);
    } else {
      await addMessage('assistant', `❌ **Erro:** ${claude.error || 'Não foi possível gerar a estratégia.'}`);
    }

    return result;
  }, [claude, addMessage, ensureConversation]);

  // Validar campanha
  const validateCampaign = useCallback(async (campaign: unknown, context: CampaignContext) => {
    await ensureConversation();
    await addMessage('user', '✅ Validar estratégia antes de publicar');

    const result = await claude.validateCampaign(campaign, context);
    setValidation(result);

    if (result) {
      const emoji = result.isValid ? '✅' : '⚠️';
      const text = result.isValid ? 'Aprovado' : 'Precisa de ajustes';
      await addMessage('assistant', `${emoji} **Validação: ${result.score}/100** - ${text}`, 'validation', result);
    } else {
      await addMessage('assistant', `❌ **Erro:** ${claude.error || 'Erro ao validar'}`);
    }

    return result;
  }, [claude, addMessage, ensureConversation]);

  // Analisar performance
  const analyzePerformance = useCallback(async (campaigns: unknown[], performanceData: unknown) => {
    await ensureConversation();
    await addMessage('user', '📊 Analisar performance das campanhas');

    const result = await claude.analyzeAndOptimize(campaigns, performanceData);

    if (result) {
      await addMessage('assistant', `📊 **Análise de Performance**\n\n${result.analysis}`, 'optimization', result);
    } else {
      await addMessage('assistant', `❌ **Erro:** ${claude.error || 'Erro ao analisar'}`);
    }

    return result;
  }, [claude, addMessage, ensureConversation]);

  // Chat livre
  const chat = useCallback(async (message: string, context?: CampaignContext) => {
    if (!message.trim()) return null;
    await ensureConversation();
    await addMessage('user', message);

    const response = await claude.chat(message, context);

    if (response) {
      if (typeof response === 'object' && response !== null && 'agentInstructions' in response && 'strategy' in response) {
        const strategyResponse = response as StrategyResponse;
        setStrategy(strategyResponse);
        await addMessage(
          'assistant',
          `✨ **Estratégia gerada com sucesso!**\n\n${strategyResponse.strategy.summary}\n\n` +
          `📋 **${strategyResponse.agentInstructions.length} ações** prontas para execução.\n` +
          `Clique em **Publicar** para criar a campanha real ou **Simular** para testar.`,
          'strategy',
          strategyResponse
        );
      } else {
        await addMessage('assistant', response as string);
      }
    } else {
      await addMessage('assistant', `❌ **Erro:** ${claude.error || 'Erro ao enviar mensagem'}`);
    }

    return response;
  }, [claude, addMessage, ensureConversation]);

  // Executar estratégia
  const executeStrategy = useCallback(async (
    strategyToExecute: StrategyResponse,
    options?: { dryRun?: boolean }
  ) => {
    if (!strategyToExecute?.agentInstructions?.length) {
      await addMessage('assistant', '❌ Estratégia não contém instruções para executar');
      return null;
    }

    setIsExecuting(true);
    const modeText = options?.dryRun ? '(Modo Simulação)' : '';
    await addMessage('user', `🚀 Executar estratégia e criar campanhas ${modeText}`);

    try {
      const summary = await campaignAgent.executeInstructions(
        strategyToExecute.agentInstructions,
        {
          dryRun: options?.dryRun,
          stopOnError: false,
          onProgress: (result: ExecutionResult) => {
            console.log('Progresso:', result.action, result.success ? '✅' : '❌');
          },
        }
      );

      setLastExecution(summary);

      const emoji = summary.failed === 0 ? '✅' : '⚠️';
      const startMs = new Date(summary.startedAt).getTime();
      const endMs = new Date(summary.completedAt).getTime();
      const elapsed = Math.round((endMs - startMs) / 1000);

      await addMessage(
        'assistant',
        `${emoji} **Execução ${options?.dryRun ? 'simulada ' : ''}concluída!**\n\n` +
        `• Total de ações: ${summary.total}\n` +
        `• Sucesso: ${summary.successful}\n` +
        `• Falhas: ${summary.failed}\n` +
        `• Tempo: ${elapsed}s`,
        'execution',
        summary
      );

      return summary;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Erro na execução';
      await addMessage('assistant', `❌ **Erro na execução:** ${errorMsg}`);
      return null;
    } finally {
      setIsExecuting(false);
    }
  }, [addMessage]);

  // Executar instruções avulsas
  const executeInstructions = useCallback(async (
    instructions: AgentInstruction[],
    options?: { dryRun?: boolean }
  ) => {
    setIsExecuting(true);
    try {
      const summary = await campaignAgent.executeInstructions(instructions, {
        dryRun: options?.dryRun,
        stopOnError: false,
      });
      setLastExecution(summary);
      return summary;
    } finally {
      setIsExecuting(false);
    }
  }, []);

  // Start new conversation
  const newConversation = useCallback(async () => {
    setMessages([]);
    setStrategy(null);
    setValidation(null);
    setLastExecution(null);
    claude.clearHistory();
    persistence.setActiveConversationId(null);
    persistence.setMessages([]);
    const id = await persistence.createConversation();
    if (id) {
      persistence.setActiveConversationId(id);
    }
  }, [claude, persistence]);

  // Clear chat (delete current conversation)
  const clearChat = useCallback(async () => {
    if (persistence.activeConversationId) {
      await persistence.deleteConversation(persistence.activeConversationId);
    }
    setMessages([]);
    setStrategy(null);
    setValidation(null);
    setLastExecution(null);
    claude.clearHistory();
  }, [claude, persistence]);

  // Select existing conversation
  const selectConversation = useCallback(async (conversationId: string) => {
    setStrategy(null);
    setValidation(null);
    setLastExecution(null);
    claude.clearHistory();
    await persistence.selectConversation(conversationId);
  }, [claude, persistence]);

  return {
    isLoading: claude.isLoading,
    isExecuting,
    error: claude.error,
    messages,
    strategy,
    validation,
    lastExecution,

    // Conversation management
    conversations: persistence.conversations,
    activeConversationId: persistence.activeConversationId,
    isLoadingConversations: persistence.isLoadingConversations,
    isLoadingMessages: persistence.isLoadingMessages,
    selectConversation,
    newConversation,

    generateStrategy,
    validateCampaign,
    analyzePerformance,
    chat,

    executeStrategy,
    executeInstructions,

    clearChat,
  };
}
