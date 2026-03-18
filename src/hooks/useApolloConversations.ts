import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ApolloConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ApolloMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  message_type: string;
  data?: unknown;
  created_at: string;
}

export function useApolloConversations() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ApolloConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApolloMessage[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  // Load conversations list
  const loadConversations = useCallback(async () => {
    if (!user) return;
    setIsLoadingConversations(true);
    try {
      const { data, error } = await supabase
        .from('apollo_conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (!error && data) setConversations(data);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [user]);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId: string) => {
    if (!user) return;
    setIsLoadingMessages(true);
    try {
      const { data, error } = await supabase
        .from('apollo_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (!error && data) setMessages(data);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [user]);

  // Create a new conversation
  const createConversation = useCallback(async (title?: string): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('apollo_conversations')
      .insert({ user_id: user.id, title: title || 'Nova conversa' })
      .select('id')
      .single();
    if (error || !data) return null;
    await loadConversations();
    return data.id;
  }, [user, loadConversations]);

  // Save a message to the database
  const saveMessage = useCallback(async (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    messageType = 'text',
    data?: unknown,
  ): Promise<string | null> => {
    if (!user) return null;
    const { data: inserted, error } = await supabase
      .from('apollo_messages')
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role,
        content,
        message_type: messageType,
        data: data ? (data as any) : null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving message:', error);
      return null;
    }

    // Update conversation title from first user message
    if (role === 'user') {
      const shortTitle = content.length > 60 ? content.substring(0, 57) + '...' : content;
      // Only update title if it's still the default
      await supabase
        .from('apollo_conversations')
        .update({ title: shortTitle, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('title', 'Nova conversa');

      // Always update updated_at
      await supabase
        .from('apollo_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    return inserted?.id || null;
  }, [user]);

  // Delete a conversation
  const deleteConversation = useCallback(async (conversationId: string) => {
    if (!user) return;
    await supabase
      .from('apollo_conversations')
      .delete()
      .eq('id', conversationId)
      .eq('user_id', user.id);
    if (activeConversationId === conversationId) {
      setActiveConversationId(null);
      setMessages([]);
    }
    await loadConversations();
  }, [user, activeConversationId, loadConversations]);

  // Select a conversation
  const selectConversation = useCallback(async (conversationId: string) => {
    setActiveConversationId(conversationId);
    await loadMessages(conversationId);
  }, [loadMessages]);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    activeConversationId,
    messages,
    isLoadingConversations,
    isLoadingMessages,
    createConversation,
    saveMessage,
    deleteConversation,
    selectConversation,
    setActiveConversationId,
    setMessages,
    loadConversations,
  };
}
