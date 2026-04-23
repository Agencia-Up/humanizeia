import { useState, useEffect, useCallback, useRef } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Search, Send, Loader2, CheckCheck, Check,
  Sparkles, ArrowLeft, MessageCircle, Bot, Phone,
  Wifi, WifiOff, ChevronDown, MoreVertical, Smile,
  Paperclip, Tag, UserCheck
} from 'lucide-react';
import { TagBadge } from '@/components/whatsapp/TagBadge';
import { TagSelector } from '@/components/whatsapp/TagSelector';
import { TagFilter } from '@/components/whatsapp/TagFilter';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/* ── Tipos ──────────────────────────────────────────────────────────── */
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
  key: string;           // `${phone}::${instance_id}`
  phone: string;
  instance_id: string | null;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  ai_category: string | null;
  has_ai_message: boolean;
}

interface WaInstance {
  id: string;
  instance_name: string;
  friendly_name: string | null;
  phone_number: string | null;
  status: string;
  is_active: boolean;
}

/* ── Helpers ──────────────────────────────────────────────────────── */
const CATEGORY_COLORS: Record<string, string> = {
  interested: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  question:   'bg-blue-500/15 text-blue-700 border-blue-300',
  'opt-out':  'bg-red-500/15 text-red-700 border-red-300',
  positive:   'bg-green-500/15 text-green-700 border-green-300',
  negative:   'bg-orange-500/15 text-orange-700 border-orange-300',
  neutral:    'bg-gray-100 text-gray-600 border-gray-300',
  spam:       'bg-yellow-500/15 text-yellow-700 border-yellow-300',
};

const CATEGORY_LABELS: Record<string, string> = {
  interested: 'Interessado', question: 'Pergunta', 'opt-out': 'Opt-out',
  positive: 'Positivo', negative: 'Negativo', neutral: 'Neutro', spam: 'Spam',
};

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-amber-500', 'bg-red-500',
];

function avatarColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d))     return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Ontem';
  return format(d, 'dd/MM', { locale: ptBR });
}

function initials(name: string) {
  const parts = name.trim().split(' ');
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/* ── Componente principal ────────────────────────────────────────── */
export default function WhatsAppInbox({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [instances, setInstances]             = useState<WaInstance[]>([]);
  const [allInstances, setAllInstances]       = useState<WaInstance[]>([]);
  const [activeInstanceTab, setActiveInstanceTab] = useState<string>('all');
  const [conversations, setConversations]     = useState<Conversation[]>([]);
  const [messages, setMessages]               = useState<InboxMessage[]>([]);
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState('');
  const [replyText, setReplyText]             = useState('');
  const [sending, setSending]                 = useState(false);
  const [loading, setLoading]                 = useState(true);
  const [loadingMsgs, setLoadingMsgs]         = useState(false);
  const [filterTags, setFilterTags]           = useState<string[]>([]);
  const [contactTags, setContactTags]         = useState<Record<string, string[]>>({});
  const [teamMembers, setTeamMembers]         = useState<any[]>([]);
  const [sendInstanceId, setSendInstanceId]   = useState<string>('');
  const [isMobileChat, setIsMobileChat]       = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  /* ── Fetch instâncias (conectadas + não conectadas para exibir) ── */
  const fetchInstances = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('wa_instances')
      .select('id, instance_name, friendly_name, phone_number, status, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('instance_name');
    const all = (data || []) as unknown as WaInstance[];
    setAllInstances(all);
    setInstances(all.filter(i => i.status === 'connected'));
  }, [user]);

  /* ── Fetch conversas agrupadas ─────────────────────────────────── */
  const fetchConversations = useCallback(async (isInitial = false) => {
    if (!user) return;
    if (isInitial) setLoading(true);

    let query = supabase
      .from('wa_inbox')
      .select('phone, contact_name, content, ai_category, is_read, created_at, instance_id, direction')
      .eq('user_id', user.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(500);

    if (activeInstanceTab !== 'all') {
      query = query.eq('instance_id', activeInstanceTab);
    }

    const { data } = await query;

    // Agrupar por (phone, instance_id)
    const convMap = new Map<string, Conversation>();
    for (const msg of (data || [])) {
      const key = `${msg.phone}::${msg.instance_id ?? 'null'}`;
      if (!convMap.has(key)) {
        convMap.set(key, {
          key, phone: msg.phone, instance_id: msg.instance_id,
          contact_name: msg.contact_name, last_message: msg.content,
          last_message_at: msg.created_at, unread_count: 0,
          ai_category: msg.ai_category, has_ai_message: false,
        });
      }
      const c = convMap.get(key)!;
      if (!msg.is_read && msg.direction === 'incoming') c.unread_count++;
      if (!c.contact_name && msg.contact_name) c.contact_name = msg.contact_name;
      if (msg.ai_category) c.ai_category = msg.ai_category;
    }

    setConversations(Array.from(convMap.values()));
    if (isInitial) setLoading(false);
  }, [user, activeInstanceTab]);

  /* ── Fetch mensagens da conversa selecionada ───────────────────── */
  const fetchMessages = useCallback(async (phone: string, instanceId: string | null) => {
    if (!user) return;
    setLoadingMsgs(true);

    let query = supabase
      .from('wa_inbox')
      .select('*')
      .eq('user_id', user.id)
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(300);

    if (instanceId) query = query.eq('instance_id', instanceId);

    const { data } = await query;
    if (data) {
      setMessages(data as unknown as InboxMessage[]);
      // Marcar como lidas
      await supabase
        .from('wa_inbox')
        .update({ is_read: true } as any)
        .eq('user_id', user.id)
        .eq('phone', phone)
        .eq('is_read', false);
    }
    setLoadingMsgs(false);
  }, [user]);

  /* ── Fetch tags dos contatos ───────────────────────────────────── */
  const fetchContactTags = useCallback(async () => {
    if (!user || conversations.length === 0) return;
    const phones = [...new Set(conversations.map(c => c.phone))];
    const { data } = await supabase
      .from('wa_contacts')
      .select('phone, tags')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (data) {
      const map: Record<string, string[]> = {};
      for (const c of data) if (c.tags?.length) map[c.phone] = c.tags as string[];
      setContactTags(map);
    }
  }, [user, conversations]);

  /* ── Fetch vendedores (equipe) ────────────────────────────────── */
  const fetchTeamMembers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('ai_team_members')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('name');
    setTeamMembers(data || []);
  }, [user]);

  const updateContactTags = async (phone: string, tags: string[]) => {
    if (!user) return;
    await supabase.from('wa_contacts').update({ tags } as any).eq('user_id', user.id).eq('phone', phone);
    setContactTags(prev => ({ ...prev, [phone]: tags }));
  };

  /* ── Effects ───────────────────────────────────────────────────── */
  useEffect(() => { fetchInstances(); }, [fetchInstances]);
  useEffect(() => { fetchConversations(true); }, [fetchConversations]);
  useEffect(() => { fetchContactTags(); }, [fetchContactTags]);
  useEffect(() => { fetchTeamMembers(); }, [fetchTeamMembers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /* ── Realtime ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel('wa-inbox-rt')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'wa_inbox',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const msg = payload.new as unknown as InboxMessage;
        fetchConversations(false);
        if (selectedConvKey) {
          const [selPhone, selInst] = selectedConvKey.split('::');
          if (msg.phone === selPhone && (selInst === 'null' || selInst === msg.instance_id)) {
            setMessages(prev => [...prev, msg]);
            supabase.from('wa_inbox').update({ is_read: true } as any).eq('id', msg.id).then(() => {});
          }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, selectedConvKey, fetchConversations]);

  /* ── Selecionar conversa ───────────────────────────────────────── */
  const selectConversation = (conv: Conversation) => {
    setSelectedConvKey(conv.key);
    setIsMobileChat(true);
    fetchMessages(conv.phone, conv.instance_id);

    // Pre-selecionar instância para envio
    const inst = allInstances.find(i => i.id === conv.instance_id && i.status === 'connected');
    if (inst) setSendInstanceId(inst.id);
    else if (instances.length > 0) setSendInstanceId(instances[0].id);
  };

  /* ── Enviar mensagem ───────────────────────────────────────────── */
  const handleSend = async () => {
    if (!replyText.trim() || !selectedConvKey || !user || sending) return;
    const [phone] = selectedConvKey.split('::');
    const instId = sendInstanceId || instances[0]?.id;
    if (!instId) {
      toast({ title: 'Selecione uma instância conectada', variant: 'destructive' });
      return;
    }

    const text = replyText.trim();
    setReplyText('');
    setSending(true);

    // Optimistic
    const opt: InboxMessage = {
      id: crypto.randomUUID(),
      user_id: user.id,
      instance_id: instId,
      phone,
      contact_name: null,
      direction: 'outgoing',
      message_type: 'text',
      content: text,
      media_url: null,
      ai_category: null,
      ai_sentiment: null,
      is_read: true,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, opt]);

    try {
      const { error } = await supabase.functions.invoke('wa-send-reply', {
        body: { instance_id: instId, phone, content: text },
      });
      if (error) throw error;
      
      // Clear textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
      setMessages(prev => prev.filter(m => m.id !== opt.id));
      setReplyText(text); // Restore text on error
    } finally {
      setSending(false);
    }
  };

  const handleTransfer = async (memberId: string) => {
    if (!selectedConvKey || !user) return;
    const [phone] = selectedConvKey.split('::');
    const jid = `${phone}@s.whatsapp.net`;
    const member = teamMembers.find(m => m.id === memberId);

    try {
      // 1. Buscar ou criar o lead
      const { data: lead } = await supabase
        .from('ai_crm_leads')
        .select('id')
        .eq('user_id', user.id)
        .eq('remote_jid', jid)
        .maybeSingle();

      let leadId = lead?.id;

      if (!leadId) {
        const { data: newLead, error: createError } = await (supabase as any)
          .from('ai_crm_leads')
          .insert({
            user_id: user.id,
            remote_jid: jid,
            lead_name: selectedConv?.contact_name || phone,
            status: 'transferido',
            assigned_to_member_id: memberId,
            transferred_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (createError) throw createError;
        leadId = newLead.id;
      } else {
        await supabase
          .from('ai_crm_leads')
          .update({
            status: 'transferido',
            assigned_to_member_id: memberId,
            transferred_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', leadId);
      }

      // 2. Registrar a transferência
      await supabase.from('ai_lead_transfers').insert({
        user_id: user.id,
        lead_id: leadId,
        to_member_id: memberId,
        transfer_reason: 'manual',
        notes: 'Transferência manual via Inbox',
      } as any);

      toast({ title: 'Lead transferido!', description: `Conversa atribuída a ${member?.name}.` });
    } catch (err: any) {
      toast({ title: 'Erro ao transferir', description: err.message, variant: 'destructive' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Dados derivados ───────────────────────────────────────────── */
  const selectedConv = conversations.find(c => c.key === selectedConvKey) ?? null;

  const filteredConversations = conversations.filter(c => {
    if (filterTags.length > 0) {
      const cTags = contactTags[c.phone] || [];
      if (!filterTags.some(ft => cTags.includes(ft))) return false;
    }
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.phone.includes(q) || c.contact_name?.toLowerCase().includes(q) || c.last_message?.toLowerCase().includes(q);
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);

  const instName = (id: string | null) => {
    if (!id) return null;
    const inst = allInstances.find(i => i.id === id);
    return inst ? (inst.friendly_name || inst.instance_name) : null;
  };

  /* ── Wrapper ───────────────────────────────────────────────────── */
  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : MainLayout;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <Wrapper>
      <div className="flex flex-col h-full overflow-hidden">

        {/* ══════════════════════════════════════════════════════════
            TOPO: seletor de instância (tabs)
        ══════════════════════════════════════════════════════════ */}
        <div className="border-b border-border/40 bg-muted/20 px-4 pt-3 pb-0 shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">

            {/* Tab "Todas" */}
            <button
              onClick={() => { setActiveInstanceTab('all'); setSelectedConvKey(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                activeInstanceTab === 'all'
                  ? 'border-primary text-primary bg-background'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Todas
              {totalUnread > 0 && (
                <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {totalUnread}
                </span>
              )}
            </button>

            {/* Tab por instância */}
            {allInstances.map(inst => {
              const unread = conversations.filter(c => c.instance_id === inst.id).reduce((s, c) => s + c.unread_count, 0);
              const connected = inst.status === 'connected';
              return (
                <button
                  key={inst.id}
                  onClick={() => { setActiveInstanceTab(inst.id); setSelectedConvKey(null); }}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                    activeInstanceTab === inst.id
                      ? 'border-primary text-primary bg-background'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  {connected
                    ? <Wifi className="h-3 w-3 text-emerald-500" />
                    : <WifiOff className="h-3 w-3 text-red-400" />
                  }
                  <span className="max-w-[120px] truncate">{inst.friendly_name || inst.instance_name}</span>
                  {inst.phone_number && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {inst.phone_number.replace(/\D/g, '').slice(-4)}
                    </span>
                  )}
                  {unread > 0 && (
                    <span className="bg-primary text-primary-foreground text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            CORPO: lista de conversas + área de chat
        ══════════════════════════════════════════════════════════ */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Lista de conversas ─────────────────────────────────── */}
          <div className={`w-full md:w-[320px] lg:w-[360px] border-r border-border/40 flex flex-col shrink-0 ${isMobileChat ? 'hidden md:flex' : 'flex'}`}>

            {/* Busca + filtro de tags */}
            <div className="p-3 border-b border-border/40 space-y-2 bg-background">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar contatos ou mensagens..."
                  className="pl-8 h-8 text-xs bg-muted/30 border-0 focus-visible:ring-1"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <TagFilter activeTags={filterTags} onFilterChange={setFilterTags} />
            </div>

            {/* Lista */}
            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="text-center py-16 px-4 text-muted-foreground">
                  <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">Nenhuma conversa</p>
                  <p className="text-xs mt-1 opacity-70">
                    {activeInstanceTab === 'all' ? 'Mensagens aparecerão aqui.' : 'Nenhuma conversa nesta instância.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {filteredConversations.map(conv => {
                    const label = conv.contact_name || conv.phone;
                    const tags  = contactTags[conv.phone] || [];
                    const iName = instName(conv.instance_id);
                    const isSelected = selectedConvKey === conv.key;

                    return (
                      <button
                        key={conv.key}
                        onClick={() => selectConversation(conv)}
                        className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-muted/50 ${
                          isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="relative shrink-0">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold ${avatarColor(label)}`}>
                              {initials(label)}
                            </div>
                            {conv.has_ai_message && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-violet-500 border-2 border-background flex items-center justify-center">
                                <Bot className="h-2 w-2 text-white" />
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Linha 1: nome + hora */}
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-sm truncate ${conv.unread_count > 0 ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                                {label}
                              </span>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                                {formatTime(conv.last_message_at)}
                              </span>
                            </div>

                            {/* Linha 2: última msg + badge unread */}
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <p className={`text-xs truncate ${conv.unread_count > 0 ? 'text-foreground/70' : 'text-muted-foreground'}`}>
                                {conv.last_message || '📎 Mídia'}
                              </p>
                              {conv.unread_count > 0 && (
                                <span className="bg-primary text-primary-foreground text-[10px] rounded-full h-5 min-w-5 px-1 flex items-center justify-center font-bold shrink-0">
                                  {conv.unread_count}
                                </span>
                              )}
                            </div>

                            {/* Linha 3: instância + categoria + tags */}
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {iName && activeInstanceTab === 'all' && (
                                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
                                  <Wifi className="h-2.5 w-2.5" />
                                  {iName}
                                </span>
                              )}
                              {conv.ai_category && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${CATEGORY_COLORS[conv.ai_category] || ''}`}>
                                  {CATEGORY_LABELS[conv.ai_category] || conv.ai_category}
                                </span>
                              )}
                              {tags.slice(0, 2).map(tag => (
                                <TagBadge key={tag} name={tag} color="#7c3aed" size="sm" />
                              ))}
                              {tags.length > 2 && (
                                <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* ── Área de chat ────────────────────────────────────────── */}
          <div className={`flex-1 flex flex-col min-w-0 ${!isMobileChat && !selectedConvKey ? 'hidden md:flex' : 'flex'}`}>

            {!selectedConvKey ? (
              /* Empty state */
              <div className="flex-1 flex items-center justify-center bg-muted/10">
                <div className="text-center max-w-sm px-6">
                  <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
                    <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
                  </div>
                  <h3 className="font-semibold text-foreground/70 mb-1">Nenhuma conversa aberta</h3>
                  <p className="text-sm text-muted-foreground">Selecione uma conversa na lista ao lado para começar.</p>
                </div>
              </div>
            ) : (
              <>
                {/* ── Header do chat ── */}
                <div className="px-4 py-3 border-b border-border/40 bg-background flex items-center gap-3 shrink-0">
                  {/* Voltar mobile */}
                  <button
                    className="md:hidden p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground"
                    onClick={() => { setIsMobileChat(false); setSelectedConvKey(null); }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>

                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold ${avatarColor(selectedConv?.contact_name || selectedConv?.phone || '')}`}>
                      {initials(selectedConv?.contact_name || selectedConv?.phone || '?')}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">
                      {selectedConv?.contact_name || selectedConv?.phone}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{selectedConv?.phone}</span>
                      {instName(selectedConv?.instance_id ?? null) && (
                        <>
                          <span className="text-muted-foreground/30 text-xs">·</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Wifi className="h-3 w-3 text-emerald-500" />
                            {instName(selectedConv?.instance_id ?? null)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Ações direita */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {selectedConv?.ai_category && (
                      <Badge variant="outline" className={`text-[10px] gap-1 ${CATEGORY_COLORS[selectedConv.ai_category] || ''}`}>
                        <Sparkles className="h-2.5 w-2.5" />
                        {CATEGORY_LABELS[selectedConv.ai_category] || selectedConv.ai_category}
                      </Badge>
                    )}
                    
                    {teamMembers.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 text-[11px] gap-1.5 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/5 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-500/10">
                            <UserCheck className="h-3.5 w-3.5" />
                            Transferir
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel className="text-[10px]">Escolha o vendedor</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {teamMembers.map(m => (
                            <DropdownMenuItem key={m.id} onClick={() => handleTransfer(m.id)} className="text-xs gap-2 cursor-pointer">
                              <UserCheck className="h-3 w-3 text-muted-foreground" />
                              {m.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    <TagSelector
                      selectedTags={contactTags[selectedConv?.phone || ''] || []}
                      onTagsChange={(tags) => updateContactTags(selectedConv!.phone, tags)}
                    />
                  </div>
                </div>

                {/* ── Mensagens ── */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1 bg-muted/10" style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--muted)) 1px, transparent 1px)', backgroundSize: '20px 20px', backgroundRepeat: 'repeat' }}>
                  {loadingMsgs ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg, idx) => {
                        const isOut = msg.direction === 'outgoing';
                        const prevMsg = messages[idx - 1];
                        const showDate = !prevMsg || format(new Date(msg.created_at), 'dd/MM/yyyy') !== format(new Date(prevMsg.created_at), 'dd/MM/yyyy');
                        const sameDir = prevMsg && prevMsg.direction === msg.direction;
                        const gap = sameDir ? 'mt-0.5' : 'mt-3';

                        return (
                          <div key={msg.id}>
                            {/* Divisor de data */}
                            {showDate && (
                              <div className="flex items-center justify-center my-4">
                                <span className="bg-background/80 backdrop-blur text-xs text-muted-foreground px-3 py-1 rounded-full border border-border/40 shadow-sm">
                                  {isToday(new Date(msg.created_at)) ? 'Hoje' : isYesterday(new Date(msg.created_at)) ? 'Ontem' : format(new Date(msg.created_at), "dd 'de' MMMM", { locale: ptBR })}
                                </span>
                              </div>
                            )}

                            <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} ${gap}`}>
                              <div className={`max-w-[72%] flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                                <div className={`px-3.5 py-2 rounded-2xl shadow-sm ${
                                  isOut
                                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                                    : 'bg-background text-foreground rounded-bl-sm border border-border/30'
                                }`}>
                                  {msg.content && (
                                    <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                                  )}
                                  {msg.media_url && !msg.content && (
                                    <p className="text-sm opacity-70 flex items-center gap-1">
                                      <Paperclip className="h-3.5 w-3.5" />
                                      {msg.message_type}
                                    </p>
                                  )}

                                  {/* Rodapé da mensagem: hora + status */}
                                  <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                    {isOut && msg.instance_id && allInstances.length > 1 && (
                                      <span className="text-[9px] opacity-50">{instName(msg.instance_id)}</span>
                                    )}
                                    <span className={`text-[10px] ${isOut ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                                      {format(new Date(msg.created_at), 'HH:mm')}
                                    </span>
                                    {isOut && (
                                      msg.is_read
                                        ? <CheckCheck className="h-3 w-3 text-primary-foreground/60" />
                                        : <Check className="h-3 w-3 text-primary-foreground/60" />
                                    )}
                                  </div>
                                </div>

                                {/* Badge categoria IA */}
                                {msg.ai_category && !isOut && (
                                  <div className="mt-1">
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 w-fit ${CATEGORY_COLORS[msg.ai_category] || ''}`}>
                                      <Sparkles className="h-2.5 w-2.5" />
                                      {CATEGORY_LABELS[msg.ai_category] || msg.ai_category}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* ── Input de resposta ── */}
                <div className="border-t border-border/40 bg-background shrink-0">
                  {/* Seletor de instância (se há mais de uma) */}
                  {instances.length > 1 && (
                    <div className="px-4 pt-2.5 pb-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-medium whitespace-nowrap">Enviar via:</span>
                        <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-1">
                          {instances.map(inst => (
                            <button
                              key={inst.id}
                              onClick={() => setSendInstanceId(inst.id)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all border ${
                                (sendInstanceId || instances[0]?.id) === inst.id
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/40 hover:text-foreground'
                              }`}
                            >
                              <Wifi className="h-2.5 w-2.5" />
                              {inst.friendly_name || inst.instance_name}
                              {inst.phone_number && (
                                <span className="opacity-60">·{inst.phone_number.replace(/\D/g,'').slice(-4)}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {instances.length === 1 && (
                    <div className="px-4 pt-2 flex items-center gap-1.5">
                      <Wifi className="h-3 w-3 text-emerald-500" />
                      <span className="text-[11px] text-muted-foreground">
                        {instances[0].friendly_name || instances[0].instance_name}
                        {instances[0].phone_number ? ` · ${instances[0].phone_number}` : ''}
                      </span>
                    </div>
                  )}
                  {instances.length === 0 && (
                    <div className="px-4 pt-2 flex items-center gap-1.5 text-destructive">
                      <WifiOff className="h-3 w-3" />
                      <span className="text-[11px]">Nenhuma instância conectada</span>
                    </div>
                  )}

                  {/* Campo de texto */}
                  <div className="flex items-end gap-2 p-3">
                    <div className="flex-1 bg-muted/30 rounded-2xl border border-border/40 px-4 py-2.5 focus-within:border-primary/50 focus-within:bg-background transition-all">
                      <Textarea
                        ref={textareaRef}
                        placeholder="Digite uma mensagem..."
                        value={replyText}
                        onChange={e => {
                          setReplyText(e.target.value);
                          if (textareaRef.current) {
                            textareaRef.current.style.height = 'auto';
                            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 128)}px`;
                          }
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={sending || instances.length === 0}
                        rows={1}
                        className="resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto"
                      />
                    </div>
                    <button
                      onClick={handleSend}
                      disabled={sending || !replyText.trim() || instances.length === 0}
                      className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      {sending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Send className="h-4 w-4" />
                      }
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
