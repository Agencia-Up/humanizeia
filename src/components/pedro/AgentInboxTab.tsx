import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Bot, Send, Loader2, Search, ArrowLeft, Pause, Play,
  MessageCircle, User, Phone, Clock, CheckCheck, Wifi,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/* ── Tipos ──────────────────────────────────────────────────────────── */
interface Agent {
  id: string;
  name: string;
  is_active: boolean;
  instance_ids: string[] | null;
  instance_id: string | null;
}

interface Lead {
  id: string;
  remote_jid: string;
  lead_name: string | null;
  status: string;
  ai_paused: boolean;
  instance_id: string | null;
  agent_id: string;
  message_count: number;
  last_interaction_at: string | null;
  summary: string | null;
}

interface Message {
  id: string;
  phone: string;
  instance_id: string | null;
  direction: 'incoming' | 'outgoing';
  content: string | null;
  message_type: string;
  media_url: string | null;
  created_at: string;
  contact_name: string | null;
}

interface AgentInboxTabProps {
  userId: string;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmtTime(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'HH:mm', { locale: ptBR });
  if (isYesterday(d)) return 'Ontem ' + format(d, 'HH:mm', { locale: ptBR });
  return format(d, 'dd/MM HH:mm', { locale: ptBR });
}

function initials(name: string | null, phone: string) {
  if (name && name.length >= 2) return name.slice(0, 2).toUpperCase();
  return cleanPhone(phone).slice(-2);
}

function cleanPhone(value: string | null | undefined) {
  return (value || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function phoneCandidates(value: string | null | undefined) {
  const raw = (value || '').trim();
  const digits = cleanPhone(raw);
  const candidates = [raw, digits, digits ? `${digits}@s.whatsapp.net` : '']
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function displayPhone(value: string | null | undefined) {
  return cleanPhone(value) || value || '';
}

/* ── Componente Principal ──────────────────────────────────────────── */
export function AgentInboxTab({ userId }: AgentInboxTabProps) {
  const { toast } = useToast();

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Leads (conversations)
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Chat
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // Pause/Resume
  const [togglingPause, setTogglingPause] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Fetch agents ──────────────────────────────────────────────── */
  useEffect(() => {
    async function load() {
      setLoadingAgents(true);
      const { data } = await (supabase as any)
        .from('wa_ai_agents')
        .select('id, name, is_active, instance_ids, instance_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('name');
      const list = data || [];
      setAgents(list);
      if (list.length > 0 && !selectedAgentId) {
        setSelectedAgentId(list[0].id);
      }
      setLoadingAgents(false);
    }
    load();
  }, [userId]);

  /* ── Fetch leads for selected agent ──────────────────────────── */
  const fetchLeads = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoadingLeads(true);
    const { data } = await (supabase as any)
      .from('ai_crm_leads')
      // message_count NÃO está no SELECT porque a coluna não existe em ai_crm_leads.
      // O valor é calculado dinamicamente abaixo via wa_chat_history (useEffect).
      .select('id, remote_jid, lead_name, status, ai_paused, instance_id, agent_id, last_interaction_at, summary')
      .eq('agent_id', selectedAgentId)
      .eq('user_id', userId)
      .order('last_interaction_at', { ascending: false });
    setLeads(data || []);
    setLoadingLeads(false);
  }, [selectedAgentId, userId]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const selectedLeadId = selectedLead?.id || '';
  const selectedLeadPhone = selectedLead?.remote_jid || '';
  const selectedLeadInstanceId = selectedLead?.instance_id || null;

  /* ── Fetch messages for selected lead ──────────────────────────── */
  const fetchMessages = useCallback(async (silent = false) => {
    if (!selectedLeadId || !selectedLeadPhone) return;
    if (!silent) setLoadingMessages(true);
    try {
      let query = (supabase as any)
        .from('wa_inbox')
        .select('id, phone, instance_id, direction, content, message_type, media_url, created_at, contact_name')
        .eq('user_id', userId)
        .in('phone', phoneCandidates(selectedLeadPhone));

    if (selectedLeadInstanceId) {
      query = query.eq('instance_id', selectedLeadInstanceId);
    }

    const { data } = await query
      .order('created_at', { ascending: true })
      .range(0, 999);

    const rows = data || [];
    setMessages(rows);
    if (rows.length > 0) {
      const latestInstanceId = [...rows].reverse().find((m: Message) => m.instance_id)?.instance_id || null;
      setSelectedLead(prev => {
        if (!prev || prev.id !== selectedLeadId) return prev;
        const nextInstanceId = prev.instance_id || latestInstanceId;
        const nextMessageCount = Math.max(prev.message_count || 0, rows.length);
        if (prev.instance_id === nextInstanceId && prev.message_count === nextMessageCount) return prev;
        return { ...prev, instance_id: nextInstanceId, message_count: nextMessageCount };
      });

      setLeads(prev => prev.map(lead => {
        if (lead.id !== selectedLeadId) return lead;
        const nextInstanceId = lead.instance_id || latestInstanceId;
        const nextMessageCount = Math.max(lead.message_count || 0, rows.length);
        if (lead.instance_id === nextInstanceId && lead.message_count === nextMessageCount) return lead;
        return { ...lead, instance_id: nextInstanceId, message_count: nextMessageCount };
      }));
    }
    } finally {
      if (!silent) {
        setLoadingMessages(false);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    }
  }, [selectedLeadId, selectedLeadPhone, selectedLeadInstanceId, userId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  /* ── Polling para novas mensagens ──────────────────────────────── */
  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!selectedLeadId) return;

    pollingRef.current = setInterval(() => {
      fetchMessages(true);
    }, 7000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedLeadId, fetchMessages]);

  /* ── Pause / Resume AI ──────────────────────────────────────────── */
  const handleTogglePause = async (lead: Lead) => {
    setTogglingPause(true);
    const newPaused = !lead.ai_paused;
    try {
      const { error } = await (supabase as any)
        .from('ai_crm_leads')
        .update({ ai_paused: newPaused })
        .eq('id', lead.id);
      if (error) throw error;

      // Update local state
      setLeads(prev => prev.map(l =>
        l.id === lead.id ? { ...l, ai_paused: newPaused } : l
      ));
      if (selectedLead?.id === lead.id) {
        setSelectedLead({ ...lead, ai_paused: newPaused });
      }

      toast({
        title: newPaused ? 'IA pausada nesta conversa' : 'IA reativada nesta conversa',
        description: newPaused
          ? 'Agora voce pode responder manualmente. O agente IA nao vai interferir.'
          : 'O agente IA voltou a responder automaticamente nesta conversa.',
      });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setTogglingPause(false);
    }
  };

  /* ── Enviar resposta manual ──────────────────────────────────────── */
  const handleSend = async () => {
    if (!replyText.trim() || !selectedLead || sending) return;
    if (!selectedLead.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return;
    }
    setSending(true);

    // Find instance for this lead
    const agentForLead = agents.find(a => a.id === selectedLead.agent_id);
    const instId = selectedLead.instance_id
      || [...messages].reverse().find(m => m.instance_id)?.instance_id
      || agentForLead?.instance_id
      || agentForLead?.instance_ids?.[0]
      || null;
    if (!instId) {
      toast({ title: 'Sem instancia vinculada a este lead', variant: 'destructive' });
      setSending(false);
      return;
    }

    const text = replyText.trim();
    const phone = cleanPhone(selectedLead.remote_jid);
    setReplyText('');

    // Optimistic message
    const opt: Message = {
      id: `opt-${Date.now()}`,
      phone,
      instance_id: instId,
      direction: 'outgoing',
      content: text,
      message_type: 'text',
      media_url: null,
      created_at: new Date().toISOString(),
      contact_name: null,
    };
    setMessages(prev => [...prev, opt]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      const { error } = await supabase.functions.invoke('wa-send-reply', {
        body: { instance_id: instId, phone, content: text },
      });
      if (error) throw error;
      await fetchMessages(true);
    } catch (err: any) {
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Filtro de busca ──────────────────────────────────────────────── */
  const filteredLeads = leads.filter(l => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (l.lead_name || '').toLowerCase().includes(term)
      || l.remote_jid.includes(term)
      || cleanPhone(l.remote_jid).includes(term.replace(/\D/g, ''));
  });

  /* ── Status label ──────────────────────────────────────────────── */
  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; color: string }> = {
      novo:                { label: 'Novo',              color: 'bg-blue-500/15 text-blue-400' },
      interessado:         { label: 'Interessado',       color: 'bg-emerald-500/15 text-emerald-400' },
      pouco_qualificado:   { label: 'Pouco Qualif.',     color: 'bg-orange-500/15 text-orange-400' },
      medio_qualificado:   { label: 'Médio Qualif.',     color: 'bg-amber-500/15 text-amber-400' },
      qualificado:         { label: 'Qualificado',       color: 'bg-green-500/15 text-green-400' },
      aguardando:          { label: 'Aguardando',        color: 'bg-yellow-500/15 text-yellow-400' },
      transferido:         { label: 'Transferido',       color: 'bg-violet-500/15 text-violet-400' },
    };
    return map[s] || { label: s, color: 'bg-muted text-muted-foreground' };
  };

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loadingAgents) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Bot className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-1">Nenhum Agente IA Ativo</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Ative um agente IA na aba "Agente IA" para comecar a ver as conversas automatizadas aqui.
        </p>
      </div>
    );
  }

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  /* ── RENDER ──────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-[calc(100vh-180px)] bg-card rounded-xl border border-border/50 overflow-hidden">
      {/* ── Top Bar: Seletor de Agente ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-muted/30">
        <Bot className="h-5 w-5 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <Select value={selectedAgentId} onValueChange={v => { setSelectedAgentId(v); setSelectedLead(null); }}>
            <SelectTrigger className="h-8 text-xs w-full max-w-[280px]">
              <SelectValue placeholder="Selecionar agente..." />
            </SelectTrigger>
            <SelectContent>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] shrink-0">
          {leads.length} conversa{leads.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Painel Esquerdo: Lista de Conversas ── */}
        <div className={`${selectedLead ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 border-r border-border/40`}>
          {/* Search */}
          <div className="p-2 border-b border-border/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          {/* Conversation list */}
          <ScrollArea className="flex-1">
            {loadingLeads ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-xs">
                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Nenhuma conversa encontrada</p>
              </div>
            ) : (
              filteredLeads.map(lead => {
                const isSelected = selectedLead?.id === lead.id;
                const st = statusLabel(lead.status);
                return (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border/20 transition-colors hover:bg-accent/40 ${
                      isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className={`text-[10px] font-bold ${
                          lead.ai_paused
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                        }`}>
                          {initials(lead.lead_name, lead.remote_jid)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-sm font-medium truncate text-foreground">
                            {lead.lead_name || lead.remote_jid}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {lead.last_interaction_at ? fmtTime(lead.last_interaction_at) : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${st.color}`}>
                            {st.label}
                          </span>
                          {lead.ai_paused ? (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-0.5">
                              <Pause className="h-2.5 w-2.5" /> Manual
                            </span>
                          ) : (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 flex items-center gap-0.5">
                              <Bot className="h-2.5 w-2.5" /> IA
                            </span>
                          )}
                        </div>
                        {lead.summary && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{lead.summary}</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* ── Painel Direito: Chat ── */}
        <div className={`${selectedLead ? 'flex' : 'hidden md:flex'} flex-col flex-1`}>
          {!selectedLead ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
              <Bot className="h-16 w-16 opacity-20 mb-4" />
              <p className="text-sm font-medium">Inbox do Agente IA</p>
              <p className="text-xs mt-1">Selecione uma conversa para visualizar</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 bg-muted/20">
                <Button
                  variant="ghost" size="sm"
                  className="h-8 w-8 p-0 md:hidden"
                  onClick={() => setSelectedLead(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>

                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className={`text-[10px] font-bold ${
                    selectedLead.ai_paused
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                  }`}>
                    {initials(selectedLead.lead_name, selectedLead.remote_jid)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{selectedLead.lead_name || selectedLead.remote_jid}</p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Phone className="h-2.5 w-2.5" />
                    {displayPhone(selectedLead.remote_jid)}
                    <span className="mx-1">|</span>
                    <MessageCircle className="h-2.5 w-2.5" />
                    {selectedLead.message_count} msgs
                  </p>
                </div>

                {/* Pause / Resume button */}
                <Button
                  size="sm"
                  variant={selectedLead.ai_paused ? 'default' : 'outline'}
                  className={`h-8 text-xs gap-1.5 shrink-0 ${
                    selectedLead.ai_paused
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                  }`}
                  onClick={() => handleTogglePause(selectedLead)}
                  disabled={togglingPause}
                >
                  {togglingPause ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : selectedLead.ai_paused ? (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      Reativar IA
                    </>
                  ) : (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      Pausar IA
                    </>
                  )}
                </Button>
              </div>

              {/* AI status banner */}
              {selectedLead.ai_paused && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
                  <Pause className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">
                    <strong>IA pausada</strong> — Voce esta no controle manual. O agente IA nao vai responder nesta conversa ate voce reativar.
                  </p>
                </div>
              )}

              {/* Messages */}
              <ScrollArea className="flex-1 px-4 py-3">
                {loadingMessages ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-xs">
                    Nenhuma mensagem nesta conversa
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map(msg => {
                      const isOutgoing = msg.direction === 'outgoing';
                      return (
                        <div key={msg.id} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                            isOutgoing
                              ? 'bg-primary/20 text-foreground rounded-br-md'
                              : 'bg-muted/60 text-foreground rounded-bl-md'
                          }`}>
                            {msg.media_url && msg.message_type === 'image' && (
                              <img src={msg.media_url} alt="" className="max-w-full rounded-lg mb-1.5 max-h-48 object-cover" />
                            )}
                            {msg.media_url && msg.message_type === 'audio' && (
                              <audio controls src={msg.media_url} className="max-w-full mb-1.5" />
                            )}
                            {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                            <p className={`text-[9px] mt-1 flex items-center gap-1 ${
                              isOutgoing ? 'text-primary/50 justify-end' : 'text-muted-foreground/50'
                            }`}>
                              {fmtTime(msg.created_at)}
                              {isOutgoing && <CheckCheck className="h-3 w-3" />}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Reply input */}
              <div className="px-4 py-3 border-t border-border/50 bg-muted/20">
                <div className="flex items-end gap-2">
                  <div className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2">
                    <Textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={selectedLead.ai_paused
                        ? 'Digite sua resposta manual...'
                        : 'Pause a IA para responder manualmente...'
                      }
                      disabled={!selectedLead.ai_paused}
                      rows={1}
                      className="resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-9 w-9 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                    onClick={handleSend}
                    disabled={!selectedLead.ai_paused || !replyText.trim() || sending}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                {!selectedLead.ai_paused && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Bot className="h-3 w-3 text-violet-400" />
                    IA ativa — suas mensagens serao enviadas, mas o agente tambem pode responder automaticamente.
                    <button
                      onClick={() => handleTogglePause(selectedLead)}
                      className="text-amber-400 hover:underline font-medium"
                    >
                      Pausar IA
                    </button>
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
