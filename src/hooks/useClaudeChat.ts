import { useState, useCallback, useRef } from 'react';
import { SUPABASE_PUBLIC_KEY, supabase } from '@/integrations/supabase/client';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeChatConfig {
  platform?: string;
  adType?: string;
  tone?: string;
  objective?: string;
  includeEmojis?: boolean;
  includeCTA?: boolean;
  creativity?: number;
  variations?: number;
  product?: string;
  description?: string;
  campaignData?: unknown;
  metricsData?: unknown;
  format?: string;
  style?: string;
  swipeFileExamples?: string;
}

type ContextType = 'copywriter' | 'assistant' | 'optimizer' | 'insights' | 'creative' | 'midas' | 'jose';

interface UseClaudeChatOptions {
  context: ContextType;
  config?: ClaudeChatConfig;
  onDelta?: (delta: string) => void;
  onComplete?: (fullResponse: string) => void;
  onError?: (error: string) => void;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claude-chat`;

async function getSessionToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || SUPABASE_PUBLIC_KEY;
}

export function useClaudeChat(options: UseClaudeChatOptions) {
  const { context, config, onDelta, onComplete, onError } = options;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (messages: Message[], overrideConfig?: ClaudeChatConfig): Promise<string> => {
    setIsLoading(true);
    setError(null);
    
    abortControllerRef.current = new AbortController();
    
    try {
      const token = await getSessionToken();
      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_PUBLIC_KEY,
        },
        body: JSON.stringify({
          messages,
          context,
          config: { ...config, ...overrideConfig },
          stream: true
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || `HTTP error: ${response.status}`;
        setError(errorMessage);
        onError?.(errorMessage);
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let buffer = '';
      let streamError: string | null = null;
      let streamShouldStop = false;

      const applyPayload = (jsonStr: string) => {
        if (jsonStr === '[DONE]') {
          streamShouldStop = true;
          return;
        }

        const parsed = JSON.parse(jsonStr);

        // Some providers send streaming errors inside the SSE stream
        if (parsed?.error) {
          const msg =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error?.message || parsed.error?.error || 'Erro interno do provedor de IA';
          streamError = msg;
          streamShouldStop = true;
          return;
        }

        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) {
          fullResponse += content;
          onDelta?.(content);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process OpenAI-compatible SSE format (Lovable AI Gateway)
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();

          try {
            applyPayload(jsonStr);
            if (streamShouldStop) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              break;
            }
          } catch {
            // Incomplete JSON, put it back
            buffer = line + '\n' + buffer;
            break;
          }
        }

        if (streamShouldStop) break;
      }

      // Final flush (best-effort)
      if (!streamShouldStop && buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          try {
            applyPayload(jsonStr);
          } catch {
            // ignore
          }
          if (streamShouldStop) break;
        }
      }

      if (streamError) {
        setError(streamError);
        onError?.(streamError);
        throw new Error(streamError);
      }

      if (!fullResponse.trim()) {
        const emptyMsg = 'Não consegui gerar uma resposta agora (resposta vazia). Tente novamente.';
        setError(emptyMsg);
        onError?.(emptyMsg);
        throw new Error(emptyMsg);
      }

      onComplete?.(fullResponse);
      return fullResponse;

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Request cancelled');
        return '';
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onError?.(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [context, config, onDelta, onComplete, onError]);

  const sendSingleMessage = useCallback(async (content: string, overrideConfig?: ClaudeChatConfig): Promise<string> => {
    return sendMessage([{ role: 'user', content }], overrideConfig);
  }, [sendMessage]);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  return {
    sendMessage,
    sendSingleMessage,
    cancel,
    isLoading,
    error
  };
}
