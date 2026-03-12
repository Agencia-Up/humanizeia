import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Inbox, Search, Send, Loader2, Check, CheckCheck,
  Sparkles, User, Archive, ArrowLeft, MessageCircle,
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface InboxMessage {
  id: string;
  user_id: string;
  instance_id: string | null;
  phone: string;
  contact_name: string | null;
  direction: 'incoming' | 'outgoing';
  message_type: string;
  content: string | null;
  media_url: string | null;
  ai_category: string | null;
  ai_sentiment: string | null;
  is_read: boolean;
  created_at: string;
}

interface Conversation {
  phone: string;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  ai_category: string | null;
}

interface WaInstance {
  id: string;
  instance_name: string;
  friendly_name: string | null;
  status: string;
  is_active: boolean;
}

const categoryColors: Record<string, string> = {
  interested: 'bg-green-500/10 text-green-700 border-green-200',
  question: 'bg-blue-500/10 text-blue-700 border-blue-200',
  'opt-out': 'bg-red-500/10 text-red-700 border-red-200',
  positive: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  negative: 'bg-orange-500/10 text-orange-700 border-orange-200',
  neutral: 'bg-muted text-muted-foreground border-border',
  spam: 'bg-yellow-500/10 text-yellow-700 border-yellow-200',
};

const categoryLabels: Record<string, string> = {
  interested: 'Interessado',
  question: 'Pergunta',
  'opt-out': 'Opt-out',
  positive: 'Positivo',
  negative: 'Negativo',
  neutral: 'Neutro',
  spam: 'Spam',
};

function formatMessageTime(dateStr: string) {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Ontem';
  return format(date, 'dd/MM', { locale: ptBR });
}

export default function WhatsAppInbox() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [instances, setInstances] = useState<WaInstance[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMobileShowChat, setIsMobileShowChat] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch conversations (grouped by phone)
  const fetchConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('wa_inbox')
      .select('phone, contact_name, content, ai_category, is_read, created_at')
      .eq('user_id', user.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch conversations error:', error);
      setLoading(false);
      return;
    }

    // Group by phone
    const convMap = new Map<string, Conversation>();
    for (const msg of (data || [])) {
      if (!convMap.has(msg.phone)) {
        convMap.set(msg.phone, {
          phone: msg.phone,
          contact_name: msg.contact_name,
          last_message: msg.content,
          last_message_at: msg.created_at,
          unread_count: 0,
          ai_category: msg.ai_category,
        });
      }
      const conv = convMap.get(msg.phone)!;
      if (!msg.is_read) conv.unread_count++;
      if (!conv.contact_name && msg.contact_name) conv.contact_name = msg.contact_name;
    }

    setConversations(Array.from(convMap.values()));
    setLoading(false);
  }, [user]);

  // Fetch instances
  const fetchInstances = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_instances')
      .select('id, instance_name, friendly_name, status, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .eq('status', 'connected');
    if (data) setInstances(data);
  }, [user]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (phone: string) => {
    if (!user) return;
    setLoadingMessages(true);

    const { data, error } = await supabase
      .from('wa_inbox')
      .select('*')
      .eq('user_id', user.id)
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(200);

    if (!error && data) {
      setMessages(data as unknown as InboxMessage[]);

      // Mark as read
      await supabase
        .from('wa_inbox')
        .update({ is_read: true } as any)
        .eq('user_id', user.id)
        .eq('phone', phone)
        .eq('is_read', false);
    }
    setLoadingMessages(false);
  }, [user]);

  useEffect(() => {
    fetchConversations();
    fetchInstances();
  }, [fetchConversations, fetchInstances]);

  useEffect(() => {
    if (selectedPhone) {
      fetchMessages(selectedPhone);
    }
  }, [selectedPhone, fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('wa-inbox-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_inbox', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const newMsg = payload.new as unknown as InboxMessage;

          // Update conversation list
          fetchConversations();

          // If viewing this conversation, add message
          if (selectedPhone && newMsg.phone === selectedPhone) {
            setMessages(prev => [...prev, newMsg]);

            // Auto-mark as read
            supabase
              .from('wa_inbox')
              .update({ is_read: true } as any)
              .eq('id', newMsg.id)
              .then(() => {});
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, selectedPhone, fetchConversations]);

  const handleSelectConversation = (phone: string) => {
    setSelectedPhone(phone);
    setIsMobileShowChat(true);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedPhone || !user) return;
    if (instances.length === 0) {
      toast({ title: 'Nenhuma instância conectada', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('wa-send-reply', {
        body: {
          instance_id: instances[0].id,
          phone: selectedPhone,
          content: replyText.trim(),
        },
      });
      if (error) throw error;
      setReplyText('');
      // Message will appear via realtime subscription or we add optimistically
      const optimisticMsg: InboxMessage = {
        id: crypto.randomUUID(),
        user_id: user.id,
        instance_id: instances[0].id,
        phone: selectedPhone,
        contact_name: null,
        direction: 'outgoing',
        message_type: 'text',
        content: replyText.trim(),
        media_url: null,
        ai_category: null,
        ai_sentiment: null,
        is_read: true,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, optimisticMsg]);
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const filteredConversations = conversations.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.phone.includes(q) ||
      c.contact_name?.toLowerCase().includes(q) ||
      c.last_message?.toLowerCase().includes(q)
    );
  });

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  return (
    <MainLayout>
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center gap-3">
          <Inbox className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Inbox Unificado</h1>
          <Badge variant="secondary" className="ml-auto">
            {conversations.reduce((sum, c) => sum + c.unread_count, 0)} não lidas
          </Badge>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Conversation List */}
          <div className={`w-full md:w-[360px] border-r flex flex-col ${isMobileShowChat ? 'hidden md:flex' : 'flex'}`}>
            {/* Search */}
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar conversas..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma conversa encontrada</p>
                </div>
              ) : (
                filteredConversations.map(conv => (
                  <button
                    key={conv.phone}
                    className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors ${
                      selectedPhone === conv.phone ? 'bg-muted' : ''
                    }`}
                    onClick={() => handleSelectConversation(conv.phone)}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-sm">
                          {(conv.contact_name || conv.phone).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm truncate">
                            {conv.contact_name || conv.phone}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {formatMessageTime(conv.last_message_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {conv.last_message || '📎 Mídia'}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {conv.ai_category && (
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColors[conv.ai_category] || ''}`}>
                                {categoryLabels[conv.ai_category] || conv.ai_category}
                              </Badge>
                            )}
                            {conv.unread_count > 0 && (
                              <span className="bg-primary text-primary-foreground text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold">
                                {conv.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div className={`flex-1 flex flex-col ${!isMobileShowChat && !selectedPhone ? 'hidden md:flex' : 'flex'} ${isMobileShowChat ? 'flex' : !selectedPhone ? '' : 'hidden md:flex'}`}>
            {!selectedPhone ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Inbox className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Selecione uma conversa para começar</p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat Header */}
                <div className="p-3 border-b flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => { setIsMobileShowChat(false); setSelectedPhone(null); }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {(selectedConv?.contact_name || selectedPhone).slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {selectedConv?.contact_name || selectedPhone}
                    </p>
                    <p className="text-xs text-muted-foreground">{selectedPhone}</p>
                  </div>
                  {selectedConv?.ai_category && (
                    <Badge variant="outline" className={`text-xs ${categoryColors[selectedConv.ai_category] || ''}`}>
                      <Sparkles className="h-3 w-3 mr-1" />
                      {categoryLabels[selectedConv.ai_category] || selectedConv.ai_category}
                    </Badge>
                  )}
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  {loadingMessages ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {messages.map(msg => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                              msg.direction === 'outgoing'
                                ? 'bg-primary text-primary-foreground rounded-br-md'
                                : 'bg-muted rounded-bl-md'
                            }`}
                          >
                            {msg.content && (
                              <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                            )}
                            {msg.media_url && (
                              <p className="text-xs opacity-70 mt-1">📎 {msg.message_type}</p>
                            )}
                            <div className={`flex items-center justify-end gap-1 mt-1 ${
                              msg.direction === 'outgoing' ? 'text-primary-foreground/60' : 'text-muted-foreground'
                            }`}>
                              <span className="text-[10px]">
                                {format(new Date(msg.created_at), 'HH:mm')}
                              </span>
                              {msg.direction === 'outgoing' && (
                                <CheckCheck className="h-3 w-3" />
                              )}
                            </div>
                            {msg.ai_category && msg.direction === 'incoming' && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] mt-1 px-1.5 py-0 ${categoryColors[msg.ai_category] || ''}`}
                              >
                                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                                {categoryLabels[msg.ai_category] || msg.ai_category}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </ScrollArea>

                {/* Reply Input */}
                <div className="p-3 border-t">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Digite sua mensagem..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={sending || instances.length === 0}
                      className="flex-1"
                    />
                    <Button
                      size="icon"
                      onClick={handleSendReply}
                      disabled={sending || !replyText.trim() || instances.length === 0}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                  {instances.length === 0 && (
                    <p className="text-xs text-destructive mt-1">Nenhuma instância conectada para enviar mensagens.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
