import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  agent_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: any;
}

interface AgentChatContextType {
  getHistory: (agentId: string) => Promise<ChatMessage[]>;
  saveMessage: (agentId: string, role: 'user' | 'assistant', content: string, metadata?: any) => Promise<void>;
  clearHistory: (agentId: string) => Promise<void>;
}

const AgentChatContext = createContext<AgentChatContextType | undefined>(undefined);

export function AgentChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const getHistory = useCallback(async (agentId: string) => {
    if (!user) return [];
    
    const { data, error } = await supabase
      .from('agent_chat_history' as any)
      .select('*')
      .eq('user_id', user.id)
      .eq('agent_id', agentId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      console.error('Error fetching chat history:', error);
      return [];
    }
    
    return (data || []) as ChatMessage[];
  }, [user]);

  const saveMessage = async (agentId: string, role: 'user' | 'assistant', content: string, metadata: any = {}) => {
    if (!user) return;

    const { error } = await supabase
      .from('agent_chat_history')
      .insert({
        user_id: user.id,
        agent_id: agentId,
        role,
        content,
        metadata
      });

    if (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  };

  const clearHistory = async (agentId: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('agent_chat_history')
      .delete()
      .eq('user_id', user.id)
      .eq('agent_id', agentId);

    if (error) {
      console.error('Error clearing history:', error);
      throw error;
    }
  };

  return (
    <AgentChatContext.Provider value={{ getHistory, saveMessage, clearHistory }}>
      {children}
    </AgentChatContext.Provider>
  );
}

export function useAgentChat() {
  const context = useContext(AgentChatContext);
  if (context === undefined) {
    throw new Error('useAgentChat must be used within an AgentChatProvider');
  }
  return context;
}
