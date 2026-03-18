import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  CampaignContext,
  StrategyResponse,
  ValidationResponse,
  AnalysisResponse,
} from './types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-strategy`;

async function getSessionToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

export function useClaudeService() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);

  const generateStrategy = useCallback(async (
    context: CampaignContext
  ): Promise<StrategyResponse | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = await getSessionToken();
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'generateStrategy',
          context,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const data = await response.json();
      return data as StrategyResponse;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const validateCampaign = useCallback(async (
    campaign: unknown,
    context: CampaignContext
  ): Promise<ValidationResponse | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = await getSessionToken();
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'validateCampaign',
          campaign,
          context,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const data = await response.json();
      return data as ValidationResponse;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const analyzeAndOptimize = useCallback(async (
    campaigns: unknown[],
    performanceData: unknown
  ): Promise<AnalysisResponse | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = await getSessionToken();
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'analyzeAndOptimize',
          campaigns,
          performanceData,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const data = await response.json();
      return data as AnalysisResponse;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const chat = useCallback(async (
    message: string,
    context?: CampaignContext
  ): Promise<string | StrategyResponse | null> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = await getSessionToken();
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'chat',
          message,
          context,
          history: conversationHistory,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const data = await response.json();
      const responseText = data.response as string;
      
      setConversationHistory(data.history);

      // Try to detect structured strategy JSON in the response
      const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.agentInstructions && parsed.strategy) {
            // It's a strategy response - return it as StrategyResponse
            return parsed as StrategyResponse;
          }
        } catch {
          // Not valid JSON, return as text
        }
      }

      return responseText;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [conversationHistory]);

  const clearHistory = useCallback(() => {
    setConversationHistory([]);
  }, []);

  return {
    generateStrategy,
    validateCampaign,
    analyzeAndOptimize,
    chat,
    clearHistory,
    isLoading,
    error,
    conversationHistory,
  };
}
