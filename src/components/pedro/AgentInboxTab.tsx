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
  Paperclip, Mic, FileText, Download, Trash2, X, Square,
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
  // Dono dos dados (master). Para vendedor, e o user_id do master, nao o auth
  // id do vendedor — senao os filtros .eq('user_id', ...) voltam vazios, pois
  // agentes/leads/inbox ficam todos gravados sob o id do master.
  userId: string;
  // Quando vendedor, escopa os leads aos atribuidos a ele (assigned_to_id).
  isSeller?: boolean;
  sellerMemberIds?: string[];
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

function mediaTypeFromMime(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

/* Valor "coringa" do seletor: mostra os leads de TODOS os agentes (paridade com
   o CRM, que filtra so por user_id). Sem isso, o inbox filtrava por agent_id e a
   lista vinha vazia quando o lead estava sob outro agente (ou agent_id null). */
const ALL_AGENTS = '__all__';

/* ── Componente Principal ──────────────────────────────────────────── */
export function AgentInboxTab({ userId, isSeller = false, sellerMemberIds = [] }: AgentInboxTabProps) {
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

  // Midia (anexos + audio)
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordPaused, setRecordPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<{
    blob: Blob;
    filename: string;
    mediaType: 'image' | 'audio' | 'video' | 'document';
    previewUrl: string;
    mime: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCancelRef = useRef(false);

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
      // Default "Todos os agentes": garante que a lista de conversas apareca
      // mesmo quando os leads estao sob agentes variados (ou agent_id null).
      if (list.length > 0 && !selectedAgentId) {
        setSelectedAgentId(ALL_AGENTS);
      }
      setLoadingAgents(false);
    }
    load();
  }, [userId]);

  /* ── Fetch leads for selected agent ──────────────────────────── */
  const fetchLeads = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoadingLeads(true);
    let query = (supabase as any)
      .from('ai_crm_leads')
      // message_count NÃO está no SELECT porque a coluna não existe em ai_crm_leads.
      // O valor é calculado dinamicamente abaixo via wa_chat_history (useEffect).
      .select('id, remote_jid, lead_name, status, ai_paused, instance_id, agent_id, last_interaction_at, summary')
      .eq('user_id', userId);
    // Filtra por agente so quando um agente especifico esta selecionado. No modo
    // "Todos os agentes" escopa apenas por user_id (igual ao CRM, que funciona).
    if (selectedAgentId !== ALL_AGENTS) {
      query = query.eq('agent_id', selectedAgentId);
    }
    // Vendedor só vê os leads atribuídos a ele (paridade com o CRM). Se ainda não
    // tem nenhum lead atribuído, mostra vazio (não cai pro inbox inteiro do master).
    if (isSeller) {
      query = sellerMemberIds.length > 0
        ? query.in('assigned_to_id', sellerMemberIds)
        : query.eq('assigned_to_id', '00000000-0000-0000-0000-000000000000');
    }
    const { data } = await query.order('last_interaction_at', { ascending: false });
    setLeads(data || []);
    setLoadingLeads(false);
  }, [selectedAgentId, userId, isSeller, sellerMemberIds]);

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
      let inboxQuery = (supabase as any)
        .from('wa_inbox')
        .select('id, phone, instance_id, direction, content, message_type, media_url, created_at, contact_name')
        .eq('user_id', userId)
        .in('phone', phoneCandidates(selectedLeadPhone));

      if (selectedLeadInstanceId) {
        inboxQuery = inboxQuery.eq('instance_id', selectedLeadInstanceId);
      }

      const { data: inboxData } = await inboxQuery
        .order('created_at', { ascending: true })
        .range(0, 999);
      const inboxRows: Message[] = inboxData || [];

      // Pedro v2 grava as mensagens (entrada role:"user" / saida role:"assistant")
      // em wa_chat_history, NAO em wa_inbox. Sem isto a conversa do Pedro v2 abre
      // vazia ("Nenhuma mensagem"). Buscamos as duas fontes e fundimos por horario.
      // Defensivo: qualquer erro aqui (ex.: RLS) nao quebra a exibicao do wa_inbox.
      let historyRows: Message[] = [];
      try {
        const { data: histData } = await (supabase as any)
          .from('wa_chat_history')
          .select('id, remote_jid, role, content, created_at')
          .eq('user_id', userId)
          .in('remote_jid', phoneCandidates(selectedLeadPhone))
          .order('created_at', { ascending: true })
          .range(0, 999);
        historyRows = (histData || []).map((r: any): Message => ({
          id: `wch-${r.id}`,
          phone: cleanPhone(r.remote_jid),
          // wa_chat_history guarda o NOME da instancia, nao o UUID -> nunca usar
          // pra envio. Deixamos null pra nao poluir o resolveInstanceId().
          instance_id: null,
          direction: r.role === 'assistant' ? 'outgoing' : 'incoming',
          content: r.content ?? '',
          message_type: 'text',
          media_url: null,
          created_at: r.created_at,
          contact_name: null,
        }));
      } catch {
        // silencioso — mantem somente o wa_inbox
      }

      // Evita balao duplicado quando a mesma mensagem existe nas duas fontes
      // (mesma direcao + mesmo texto dentro de ~2min). Prioriza o wa_inbox (tem midia).
      const historyToAdd = historyRows.filter(h =>
        !inboxRows.some(r =>
          r.direction === h.direction &&
          (r.content || '').trim() === (h.content || '').trim() &&
          Math.abs(new Date(r.created_at).getTime() - new Date(h.created_at).getTime()) < 120000
        )
      );

      const rows: Message[] = [...inboxRows, ...historyToAdd].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    // Preserva mensagens otimistas (id "opt-") que ainda nao apareceram no banco.
    // Sem isso o polling de 7s (e o refetch pos-envio) substitui a lista pelas
    // linhas do banco e apaga o balao recem-enviado ate o registro real chegar,
    // causando piscada. Mantem a otimista ate existir uma linha real equivalente
    // (mesma direcao, conteudo/midia, dentro de ~90s) ou ela expirar (>2min).
    setMessages(prev => {
      const optimistic = prev.filter(m => typeof m.id === 'string' && m.id.startsWith('opt-'));
      if (optimistic.length === 0) return rows;
      const matched = (o: Message, r: Message) => {
        if (r.direction !== o.direction) return false;
        const dt = Math.abs(new Date(r.created_at).getTime() - new Date(o.created_at).getTime());
        if (dt > 90000) return false;
        if (o.media_url || o.message_type !== 'text') return r.message_type === o.message_type;
        return (r.content || '') === (o.content || '');
      };
      const stillPending = optimistic.filter(o =>
        Date.now() - new Date(o.created_at).getTime() < 120000 &&
        !rows.some(r => matched(o, r))
      );
      return stillPending.length > 0 ? [...rows, ...stillPending] : rows;
    });
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

  /* ── Limpeza da gravacao ao desmontar ──────────────────────────── */
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (recordStreamRef.current) recordStreamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* ── Revoga a previa do anexo ao trocar/remover ────────────────── */
  useEffect(() => {
    if (!pendingAttachment) return;
    return () => { URL.revokeObjectURL(pendingAttachment.previewUrl); };
  }, [pendingAttachment]);

  /* ── Limpa anexo pendente ao trocar de lead ────────────────────── */
  useEffect(() => {
    setPendingAttachment(null);
  }, [selectedLeadId]);

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

  /* ── Resolver instancia vinculada ao lead ────────────────────────── */
  const resolveInstanceId = (): string | null => {
    if (!selectedLead) return null;
    const agentForLead = agents.find(a => a.id === selectedLead.agent_id);
    return selectedLead.instance_id
      || [...messages].reverse().find(m => m.instance_id)?.instance_id
      || agentForLead?.instance_id
      || agentForLead?.instance_ids?.[0]
      || null;
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

    const instId = resolveInstanceId();
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
      // Remove o balao otimista pra nao deixar "fantasma" de msg que falhou.
      setMessages(prev => prev.filter(m => m.id !== opt.id));
      toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  /* ── Enviar anexo (imagem, audio, video, documento) ──────────────── */
  const sendMediaMessage = async (blob: Blob, filename: string, caption = ''): Promise<boolean> => {
    if (!selectedLead) return false;
    if (!selectedLead.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return false;
    }
    const instId = resolveInstanceId();
    if (!instId) {
      toast({ title: 'Sem instancia vinculada a este lead', variant: 'destructive' });
      return false;
    }

    const mime = blob.type || 'application/octet-stream';
    const mediaType = mediaTypeFromMime(mime);
    const phone = cleanPhone(selectedLead.remote_jid);
    const ext = (filename.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'bin';
    const optId = `opt-${Date.now()}`;

    setUploadingMedia(true);
    try {
      const path = `${userId}/inbox/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('creatives')
        .upload(path, blob, { contentType: mime, upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('creatives').getPublicUrl(path);
      const mediaUrl = pub.publicUrl;

      // Optimistic message
      const opt: Message = {
        id: optId,
        phone,
        instance_id: instId,
        direction: 'outgoing',
        content: caption || '',
        message_type: mediaType,
        media_url: mediaUrl,
        created_at: new Date().toISOString(),
        contact_name: null,
      };
      setMessages(prev => [...prev, opt]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

      const { error } = await supabase.functions.invoke('wa-send-reply', {
        body: { instance_id: instId, phone, media_url: mediaUrl, media_type: mediaType, content: caption || '' },
      });
      if (error) throw error;
      await fetchMessages(true);
      return true;
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== optId));
      toast({ title: 'Erro ao enviar anexo', description: err.message, variant: 'destructive' });
      return false;
    } finally {
      setUploadingMedia(false);
    }
  };

  /* ── Previa do anexo antes de enviar ─────────────────────────────── */
  const stageAttachment = (blob: Blob, filename: string) => {
    const mime = blob.type || 'application/octet-stream';
    const mediaType = mediaTypeFromMime(mime);
    const previewUrl = URL.createObjectURL(blob);
    setPendingAttachment({ blob, filename, mediaType, previewUrl, mime });
  };

  const removePendingAttachment = () => {
    setPendingAttachment(null);
  };

  const handleSendPending = async () => {
    if (!pendingAttachment || uploadingMedia) return;
    const caption = replyText.trim();
    const ok = await sendMediaMessage(pendingAttachment.blob, pendingAttachment.filename, caption);
    if (ok) {
      setPendingAttachment(null);
      setReplyText('');
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'O limite e 16 MB.', variant: 'destructive' });
      return;
    }
    stageAttachment(file, file.name);
  };

  /* ── Gravacao de audio ────────────────────────────────────────────── */
  const startRecording = async () => {
    if (!selectedLead?.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      recordCancelRef.current = false;

      let mimeType = '';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        if (recordStreamRef.current) {
          recordStreamRef.current.getTracks().forEach(t => t.stop());
          recordStreamRef.current = null;
        }
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        setRecording(false);
        setRecordPaused(false);
        setRecordSeconds(0);
        if (recordCancelRef.current) {
          recordChunksRef.current = [];
          return;
        }
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(recordChunksRef.current, { type });
        recordChunksRef.current = [];
        const ext = type.includes('ogg') ? 'ogg' : 'webm';
        // Mostra previa para ouvir/excluir antes de enviar (igual WhatsApp)
        stageAttachment(blob, `audio-${Date.now()}.${ext}`);
      };

      rec.start();
      setRecording(true);
      setRecordPaused(false);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err: any) {
      toast({ title: 'Nao consegui acessar o microfone', description: 'Verifique a permissao do navegador.', variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    recordCancelRef.current = false;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const pauseRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'recording') {
      rec.pause();
      setRecordPaused(true);
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    }
  };

  const resumeRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === 'paused') {
      rec.resume();
      setRecordPaused(false);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    }
  };

  const cancelRecording = () => {
    recordCancelRef.current = true;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop();
    } else {
      if (recordStreamRef.current) {
        recordStreamRef.current.getTracks().forEach(t => t.stop());
        recordStreamRef.current = null;
      }
      if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
      setRecording(false);
      setRecordPaused(false);
      setRecordSeconds(0);
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
    <div className="flex flex-col h-[calc(100vh-230px)] bg-card rounded-xl border border-border/50 overflow-hidden">
      {/* ── Top Bar: Seletor de Agente ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-muted/30">
        <Bot className="h-5 w-5 text-violet-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <Select value={selectedAgentId} onValueChange={v => { setSelectedAgentId(v); setSelectedLead(null); }}>
            <SelectTrigger className="h-8 text-xs w-full max-w-[280px]">
              <SelectValue placeholder="Selecionar agente..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_AGENTS} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                  Todos os agentes
                </span>
              </SelectItem>
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
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate whitespace-pre-line">{lead.summary}</p>
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
                    {selectedLead.message_count ?? 0} msgs
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
                              <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
                                <img src={msg.media_url} alt="" className="max-w-full rounded-lg mb-1.5 max-h-48 object-cover" />
                              </a>
                            )}
                            {msg.media_url && (msg.message_type === 'audio' || msg.message_type === 'ptt' || msg.message_type === 'voice') && (
                              <audio controls src={msg.media_url} className="max-w-full mb-1.5" />
                            )}
                            {msg.media_url && msg.message_type === 'video' && (
                              <video controls src={msg.media_url} className="max-w-full rounded-lg mb-1.5 max-h-48" />
                            )}
                            {msg.media_url && (msg.message_type === 'document' || msg.message_type === 'file') && (
                              <a
                                href={msg.media_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2 rounded-lg bg-background/60 px-2.5 py-2 mb-1.5 hover:bg-background/80 transition-colors"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="text-xs truncate flex-1">{msg.content || 'Arquivo'}</span>
                                <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              </a>
                            )}
                            {msg.content && msg.message_type !== 'document' && msg.message_type !== 'file' && (
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            )}
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  className="hidden"
                  onChange={handleFilePick}
                />
                {pendingAttachment ? (
                  <div className="space-y-2">
                    {/* Previa do anexo (ouvir / ver / excluir antes de enviar) */}
                    <div className="flex items-start gap-2 rounded-xl border border-border/50 bg-background p-2.5">
                      <div className="flex-1 min-w-0">
                        {pendingAttachment.mediaType === 'image' && (
                          <img src={pendingAttachment.previewUrl} alt="" className="max-h-44 rounded-lg object-contain" />
                        )}
                        {pendingAttachment.mediaType === 'audio' && (
                          <audio controls src={pendingAttachment.previewUrl} className="w-full" />
                        )}
                        {pendingAttachment.mediaType === 'video' && (
                          <video controls src={pendingAttachment.previewUrl} className="max-h-44 rounded-lg" />
                        )}
                        {pendingAttachment.mediaType === 'document' && (
                          <div className="flex items-center gap-2 py-1">
                            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                            <span className="text-xs truncate">{pendingAttachment.filename}</span>
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 rounded-lg text-red-400 hover:bg-red-500/10 shrink-0"
                        onClick={removePendingAttachment}
                        disabled={uploadingMedia}
                        title="Remover anexo"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {/* Legenda + enviar */}
                    <div className="flex items-end gap-2">
                      <div className="flex-1 rounded-xl border border-border/50 bg-background px-3 py-2">
                        <Textarea
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendPending(); }
                          }}
                          placeholder={pendingAttachment.mediaType === 'audio'
                            ? 'Audio pronto — toque para ouvir e envie.'
                            : 'Escreva uma mensagem junto (opcional)...'
                          }
                          rows={1}
                          disabled={uploadingMedia || pendingAttachment.mediaType === 'audio'}
                          className="resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-9 w-9 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                        onClick={handleSendPending}
                        disabled={uploadingMedia}
                        title="Enviar"
                      >
                        {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ) : recording ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 p-0 rounded-xl text-red-400 hover:bg-red-500/10 shrink-0"
                      onClick={cancelRecording}
                      title="Cancelar gravacao"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="flex-1 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5">
                      <span className={`w-2 h-2 rounded-full bg-red-500 ${recordPaused ? '' : 'animate-pulse'}`} />
                      <span className="text-sm text-red-300 font-medium">{recordPaused ? 'Pausado' : 'Gravando...'}</span>
                      <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                        {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
                      </span>
                    </div>
                    {recordPaused ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0 rounded-xl text-emerald-400 hover:bg-emerald-500/10 shrink-0"
                        onClick={resumeRecording}
                        title="Continuar gravacao"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0 rounded-xl text-amber-400 hover:bg-amber-500/10 shrink-0"
                        onClick={pauseRecording}
                        title="Pausar gravacao"
                      >
                        <Pause className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-9 w-9 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                      onClick={stopRecording}
                      title="Concluir gravacao"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 p-0 rounded-xl text-muted-foreground hover:text-foreground shrink-0"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!selectedLead.ai_paused || uploadingMedia}
                      title="Anexar arquivo"
                    >
                      {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </Button>
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
                    {replyText.trim() ? (
                      <Button
                        size="sm"
                        className="h-9 w-9 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                        onClick={handleSend}
                        disabled={!selectedLead.ai_paused || sending}
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-9 w-9 p-0 rounded-xl bg-primary hover:bg-primary/90 shrink-0"
                        onClick={startRecording}
                        disabled={!selectedLead.ai_paused || uploadingMedia}
                        title="Gravar audio"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                {!selectedLead.ai_paused && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                    <Bot className="h-3 w-3 text-violet-400" />
                    IA ativa — pause a IA para responder, anexar arquivo ou gravar audio.
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
