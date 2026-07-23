import { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import { descricaoErro } from '@/lib/erroAmigavel';
import {
  Search, Send, Loader2, CheckCheck, Check,
  Sparkles, ArrowLeft, MessageCircle, Bot, Phone,
  Wifi, WifiOff, ChevronDown, MoreVertical, Smile,
  Paperclip, Tag, UserCheck, Mic, FileText, Download, Trash2,
  CalendarDays, X, Image as ImageIcon, Video, AlertCircle,
  Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, ZoomIn, ZoomOut
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
  media_list?: Array<{ type?: string; file?: string; url?: string }> | null;
  remote_message_id?: string | null;
  ai_category: string | null;
  ai_sentiment: string | null;
  is_read: boolean;
  created_at: string;
  // Quem falou (da RPC): 'cliente' | 'ia' | 'vendedor'. Cobre o Pedro V3.
  actor?: string | null;
}

interface Conversation {
  key: string;           // `${phone}::${instance_id}`
  phone: string;
  instance_id: string | null;
  contact_name: string | null;
  last_message: string | null;
  last_message_at: string;
  lead_arrived_at: string | null;
  lead_created_at: string | null;
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
  seller_member_id: string | null;
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

function dateInputValue(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function conversationArrivalIso(conv: Pick<Conversation, 'lead_arrived_at' | 'lead_created_at' | 'last_message_at'>) {
  return conv.lead_arrived_at || conv.lead_created_at || conv.last_message_at;
}

function formatArrivalDate(value: string | null | undefined) {
  if (!value) return 'sem data';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'sem data';
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
}

function initials(name: string) {
  const parts = name.trim().split(' ');
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function mediaKind(type: string | null | undefined): 'image' | 'audio' | 'video' | 'document' | null {
  const t = (type || '').toLowerCase();
  if (t === 'image' || t === 'sticker') return 'image';
  if (t === 'audio' || t === 'ptt' || t === 'voice') return 'audio';
  if (t === 'video') return 'video';
  if (t === 'document' || t === 'file') return 'document';
  return null;
}

function isRenderableMedia(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.startsWith('data:') || u.startsWith('blob:')) return true;
  if (u.includes('mmg.whatsapp.net') || u.includes('.enc')) return false;
  return /^https?:\/\//.test(u);
}

function msgHasRenderableMedia(msg: Pick<InboxMessage, 'media_url' | 'media_list'>): boolean {
  return isRenderableMedia(msg.media_url)
    || Boolean(msg.media_list?.some((m) => isRenderableMedia(m.file || m.url)));
}

function primaryMediaUrl(msg: Pick<InboxMessage, 'media_url' | 'media_list'>): string | null {
  if (isRenderableMedia(msg.media_url)) return msg.media_url || null;
  const item = msg.media_list?.find((m) => isRenderableMedia(m.file || m.url));
  return item ? (item.file || item.url || null) : null;
}

function isPlaceholderContent(content: string | null | undefined) {
  const c = (content || '').trim().toLowerCase();
  return c.startsWith('[imagem recebida')
    || c.startsWith('[mensagem de audio recebida')
    || c.startsWith('[audio recebido')
    || c.startsWith('[áudio recebido');
}

function mediaPreviewText(messageType: string | null | undefined, content: string | null | undefined, mediaUrl?: string | null) {
  const kind = mediaKind(messageType);
  if (!kind) return content || '';
  if (kind === 'image') return content && !isPlaceholderContent(content) ? content : 'Imagem recebida';
  if (kind === 'audio') return content && !isPlaceholderContent(content) ? `Audio: ${content}` : 'Audio recebido';
  if (kind === 'video') return content && !isPlaceholderContent(content) ? content : 'Video recebido';
  if (kind === 'document') return content || (mediaUrl ? 'Arquivo recebido' : 'Arquivo');
  return content || '';
}

function contactProfilePicture(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).profile_picture_url;
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

/* ── Componente principal ────────────────────────────────────────── */
/* Chave canônica de telefone p/ casar lead × conversa, tolerante ao 9º dígito BR.
   Ex.: "5512997423129" e "551297423129" → "1297423129". */
function leadKey(raw: string | null | undefined): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);              // tira DDI
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);  // tira 9º dígito
  return d;
}

export default function WhatsAppInbox({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { isSeller, seller, masterUserId, memberIds, visibleFeatures, loading: sellerLoading } = useSellerProfile(user?.id);
  const blockSellerAccess = !sellerLoading && isSeller && !visibleFeatures.marcos_inbox && !embedded;
  const focusPhone = searchParams.get('phone');

  // O userId efetivo para queries: vendedor usa o ID do master
  const effectiveUserId = (isSeller && masterUserId) ? masterUserId : user?.id;

  const [instances, setInstances]             = useState<WaInstance[]>([]);
  const [allInstances, setAllInstances]       = useState<WaInstance[]>([]);
  const [activeInstanceTab, setActiveInstanceTab] = useState<string>('all');
  const [conversations, setConversations]     = useState<Conversation[]>([]);
  const [messages, setMessages]               = useState<InboxMessage[]>([]);
  const [selectedConvKey, setSelectedConvKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState('');
  const [arrivalDateFilter, setArrivalDateFilter] = useState('');
  const [replyText, setReplyText]             = useState('');
  const [sending, setSending]                 = useState(false);
  const [loading, setLoading]                 = useState(true);
  const [loadingMsgs, setLoadingMsgs]         = useState(false);
  const [filterTags, setFilterTags]           = useState<string[]>([]);
  const [contactTags, setContactTags]         = useState<Record<string, string[]>>({});
  const [contactProfilePictures, setContactProfilePictures] = useState<Record<string, string>>({});
  const [teamMembers, setTeamMembers]         = useState<any[]>([]);
  const [sendInstanceId, setSendInstanceId]   = useState<string>('');
  const [isMobileChat, setIsMobileChat]       = useState(false);
  const [sellerLeadPhones, setSellerLeadPhones] = useState<Set<string> | null>(null);
  const [sellerLeads, setSellerLeads]         = useState<any[]>([]);
  // Master: telefones (chave canônica) de TODOS os leads do CRM — usado p/ mostrar só
  // conversas de leads nas instâncias dos vendedores (auditoria sem poluição).
  const [masterLeadPhones, setMasterLeadPhones] = useState<Set<string> | null>(null);
  const [uploadingMedia, setUploadingMedia]   = useState(false);
  const [resolvingMediaIds, setResolvingMediaIds] = useState<Set<string>>(new Set());
  const [recording, setRecording]             = useState(false);
  const [recordSeconds, setRecordSeconds]     = useState(0);
  const [chatExpanded, setChatExpanded]       = useState(false);
  const [sidebarCompact, setSidebarCompact]   = useState(false);
  const [chatZoom, setChatZoom]               = useState<'sm' | 'md' | 'lg'>('md');
  const [syncingLabels, setSyncingLabels]     = useState(false);
  const lastFocusedPhoneRef = useRef<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef  = useRef<Blob[]>([]);
  const recordStreamRef  = useRef<MediaStream | null>(null);
  const recordTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordCancelRef  = useRef<(() => void) | null>(null);
  const mediaResolveAttemptsRef = useRef<Set<string>>(new Set());
  const profilePhotoAttemptsRef = useRef<Set<string>>(new Set());

  /* ── Fetch phones dos leads atribuídos ao vendedor ────────────── */
  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      let pedroQuery = (supabase as any)
        .from('ai_crm_leads')
        .select('id, remote_jid, lead_name, created_at, arrived_at, last_interaction_at, instance_id, summary')
        .eq('user_id', effectiveUserId);

      let marcosQuery = (supabase as any)
        .from('crm_leads')
        .select('id, phone, name, notes, created_at, arrived_at, assigned_to')
        .eq('user_id', effectiveUserId);
      
      if (isSeller) {
        if (!seller) return;
        if (memberIds && memberIds.length > 0) {
          pedroQuery = pedroQuery.in('assigned_to_id', memberIds);
          marcosQuery = marcosQuery.in('assigned_to', memberIds);
        } else {
          pedroQuery = pedroQuery.eq('assigned_to_id', seller.id);
          marcosQuery = marcosQuery.eq('assigned_to', seller.id);
        }
      }

      const [pedroRes, marcosRes] = await Promise.all([pedroQuery, marcosQuery]);
      const pedroLeads = pedroRes.data || [];
      const marcosLeads = (marcosRes.data || []).map((lead: any) => ({
        id: lead.id,
        remote_jid: lead.phone,
        lead_name: lead.name || lead.phone || 'Lead',
        created_at: lead.created_at,
        arrived_at: lead.arrived_at || null,
        last_interaction_at: lead.created_at,
        instance_id: null,
        summary: lead.notes || null,
      }));
      const leadsList = [...pedroLeads, ...marcosLeads];
      setSellerLeads(leadsList);

      const phones = new Set<string>();
      for (const l of leadsList) {
        const k = leadKey(l.remote_jid);
        if (k) phones.add(k);
      }
      if (isSeller) {
        setSellerLeadPhones(phones);
      }
    })();
  }, [isSeller, seller, effectiveUserId, memberIds]);

  /* ── Master: telefones de TODOS os leads do CRM ────────────────────
   * Nas instâncias dos vendedores o inbox mostra SÓ conversas com leads do CRM
   * (não os contatos pessoais do vendedor). Paginado p/ não ser cortado em 1000. */
  useEffect(() => {
    if (isSeller || !effectiveUserId) return;
    let cancelled = false;
    (async () => {
      const keys = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from('ai_crm_leads')
          .select('remote_jid')
          .eq('user_id', effectiveUserId)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const l of data) { const k = leadKey(l.remote_jid); if (k) keys.add(k); }
        if (data.length < PAGE) break;
      }
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await (supabase as any)
          .from('crm_leads')
          .select('phone')
          .eq('user_id', effectiveUserId)
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        for (const l of data) { const k = leadKey(l.phone); if (k) keys.add(k); }
        if (data.length < PAGE) break;
      }
      if (!cancelled) setMasterLeadPhones(keys);
    })();
    return () => { cancelled = true; };
  }, [isSeller, effectiveUserId]);

  /* ── Fetch instâncias (vendedor só vê as DELE; master vê só sem dono) ──
   * Inbox é PESSOAL: cada usuário vê apenas inbox das instâncias que pertencem
   * a ele. Vendedor: WHERE seller_member_id = seller.id. Master: WHERE
   * seller_member_id IS NULL (instâncias do próprio master, não dos vendedores).
   */
  const fetchInstances = useCallback(async () => {
    if (!effectiveUserId) return;
    let query = (supabase as any)
      .from('wa_instances')
      .select('id, instance_name, friendly_name, phone_number, status, is_active, seller_member_id')
      .eq('user_id', effectiveUserId as string)
      .eq('is_active', true)
      .order('instance_name');
    if (isSeller && seller?.id) {
      if (memberIds && memberIds.length > 0) {
        const memberIdsStr = memberIds.join(',');
        query = query.or(`seller_member_id.in.(${memberIdsStr}),seller_member_id.is.null`);
      } else {
        query = query.or(`seller_member_id.eq.${seller.id},seller_member_id.is.null`);
      }
    }
    // Master: vê TODAS as instâncias da conta (próprias + as dos vendedores), pra
    // acompanhar as conversas de WhatsApp de cada vendedor. As abas por número
    // (incluindo o de cada vendedor) deixam escolher de qual ver as conversas.
    const { data } = await query;
    const all = (data || []) as unknown as WaInstance[];
    setAllInstances(all);
    setInstances(all.filter(i => i.status === 'connected'));
  }, [effectiveUserId, isSeller, seller, memberIds]);

  /* ── Fetch conversas agrupadas ─────────────────────────────────── */
  // PRIVACIDADE (server-side): a lista vem SÓ da RPC segura get_allowed_lead_inbox
  // (lead-only). Nunca lê wa_inbox direto aqui — a RPC escopa por atribuição
  // (vendedor vê só os leads dele; master vê os do tenant) e EXCLUI qualquer
  // conversa interna (vendedor/gerente/responsavel/instancia). Preview e não-lidas
  // vêm agregados no servidor por chave de telefone.
  const fetchConversations = useCallback(async (isInitial = false) => {
    if (!effectiveUserId) return;
    if (isInitial) setLoading(true);

    const { data, error } = await (supabase as any).rpc('get_allowed_lead_inbox', { p_limit: 500 });
    let convList: Conversation[] = [];
    if (!error && Array.isArray(data)) {
      convList = (data as any[]).map((r): Conversation => ({
        key: `${r.phone}::${r.instance_id ?? 'null'}`,
        phone: r.phone,
        instance_id: r.instance_id ?? null,
        contact_name: r.lead_name ?? null,
        last_message: r.last_message
          ? mediaPreviewText(r.last_message_type, r.last_message, r.last_media_url)
          : 'Conversa iniciada',
        last_message_at: r.last_message_at,
        lead_arrived_at: r.lead_arrived_at ?? null,
        lead_created_at: r.lead_created_at ?? null,
        unread_count: r.unread_count ?? 0,
        ai_category: r.ai_category ?? null,
        has_ai_message: true,
      }));
    }

    // Aba por instância: filtra client-side pela última instância da conversa.
    if (activeInstanceTab !== 'all') {
      convList = convList.filter(c => c.instance_id === activeInstanceTab);
    }

    setConversations(convList);
    if (isInitial) setLoading(false);
  }, [effectiveUserId, activeInstanceTab]);

  /* ── Fetch mensagens da conversa selecionada ───────────────────── */
  const fetchMessages = useCallback(async (phone: string, instanceId: string | null) => {
    if (!effectiveUserId || !phone) return;
    setLoadingMsgs(true);

    try {
      // PRIVACIDADE (server-side): timeline via RPC segura get_allowed_lead_messages.
      // A RPC revalida que o telefone é de um LEAD permitido e NUNCA devolve conversa
      // interna. Sem leitura direta de wa_inbox aqui.
      const { data: rpcRows } = await (supabase as any).rpc('get_allowed_lead_messages', {
        p_phone: phone,
        p_instance_id: instanceId || null,
        p_limit: 500,
      });
      const inboxRows: InboxMessage[] = [];
      const historyRows: InboxMessage[] = [];
      for (const r of ((rpcRows || []) as any[])) {
        if (r.source === 'chat') {
          const mediaList = Array.isArray(r.metadata?.media) ? r.metadata.media : null;
          const firstMedia = mediaList?.[0] || null;
          historyRows.push({
            id: `wch-${r.id}`,
            user_id: effectiveUserId as string,
            instance_id: null,
            phone,
            contact_name: null,
            direction: r.direction === 'outgoing' ? 'outgoing' : 'incoming',
            message_type: firstMedia ? (firstMedia.type || 'image') : (r.message_type || 'text'),
            content: r.content ?? null,
            media_url: firstMedia ? (firstMedia.file || firstMedia.url || null) : (r.media_url ?? null),
            media_list: mediaList,
            remote_message_id: null,
            ai_category: null,
            ai_sentiment: null,
            is_read: true,
            created_at: r.created_at,
            actor: r.actor || null,
          });
        } else {
          inboxRows.push({
            id: r.id,
            user_id: effectiveUserId as string,
            instance_id: r.instance_id ?? null,
            phone,
            contact_name: null,
            direction: r.direction,
            message_type: r.message_type || 'text',
            content: r.content ?? null,
            media_url: r.media_url ?? null,
            media_list: null,
            remote_message_id: r.remote_message_id ?? null,
            ai_category: null,
            ai_sentiment: null,
            is_read: true,
            created_at: r.created_at,
            actor: r.actor || null,
          });
        }
      }

      const sameMessage = (a: InboxMessage, b: InboxMessage) => {
        if (a.direction !== b.direction) return false;
        if (Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) > 120000) return false;
        const aMedia = mediaKind(a.message_type) !== null;
        const bMedia = mediaKind(b.message_type) !== null;
        if (aMedia && bMedia) return mediaKind(a.message_type) === mediaKind(b.message_type);
        return (a.content || '').trim() === (b.content || '').trim();
      };

      const merged: InboxMessage[] = [...inboxRows];
      for (const h of historyRows) {
        const idx = merged.findIndex((row) => sameMessage(row, h));
        if (idx === -1) {
          merged.push(h);
          continue;
        }
        if (msgHasRenderableMedia(h) && !msgHasRenderableMedia(merged[idx])) {
          merged[idx] = { ...h, id: merged[idx].id };
        }
      }

      setMessages(merged.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ));

      // Marcar como lidas (write operacional — mantido; policy de UPDATE preservada).
      await supabase
        .from('wa_inbox')
        .update({ is_read: true } as any)
        .eq('user_id', effectiveUserId as string)
        .eq('phone', phone)
        .eq('is_read', false);

    } catch (err) {
      console.error('Erro geral no fetchMessages:', err);
    } finally {
      setLoadingMsgs(false);
    }
  }, [effectiveUserId]);

  /* ── Fetch tags dos contatos ───────────────────────────────────── */
  // Usa ref para conversations para evitar recriar o callback (e re-executar o
  // useEffect) a cada mensagem nova recebida via Realtime — o que gerava
  // dezenas de queries desnecessárias por sessão.
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  const fetchContactTags = useCallback(async () => {
    const convs = conversationsRef.current;
    if (!effectiveUserId || convs.length === 0) return;
    const phones = [...new Set(convs.map(c => c.phone))];
    const { data } = await supabase
      .from('wa_contacts')
      .select('phone, tags, metadata')
      .eq('user_id', effectiveUserId as string)
      .in('phone', phones);
    if (data) {
      const map: Record<string, string[]> = {};
      const profileMap: Record<string, string> = {};
      for (const c of data as any[]) {
        if (c.tags?.length) map[c.phone] = c.tags as string[];
        const picture = contactProfilePicture(c.metadata);
        if (picture) {
          profileMap[c.phone] = picture;
          const canonical = leadKey(c.phone);
          if (canonical) profileMap[canonical] = picture;
        }
      }
      setContactTags(map);
      setContactProfilePictures(profileMap);
    }
  }, [effectiveUserId]); // conversations removido das deps — usa ref acima

  /* ── Fetch vendedores (equipe) ────────────────────────────────── */
  const fetchTeamMembers = useCallback(async () => {
    if (!effectiveUserId) return;
    const { data } = await supabase
      .from('ai_team_members')
      .select('*')
      .eq('user_id', effectiveUserId as string)
      .eq('is_active', true)
      .order('name');
    setTeamMembers(data || []);
  }, [effectiveUserId]);

  const updateContactTags = async (phone: string, tags: string[]) => {
    if (!effectiveUserId) return;
    await supabase.from('wa_contacts').update({ tags } as any).eq('user_id', effectiveUserId as string).eq('phone', phone);
    setContactTags(prev => ({ ...prev, [phone]: tags }));

    const instanceId = selectedConv?.instance_id || sendInstanceId || instances[0]?.id || null;
    if (!instanceId) return;

    setSyncingLabels(true);
    const { data, error } = await supabase.functions.invoke('wa-sync-chat-labels', {
      body: {
        user_id: effectiveUserId,
        phone,
        instance_id: instanceId,
        labels: tags,
      },
    }).finally(() => setSyncingLabels(false));

    if (error || (data as any)?.ok === false) {
      toast({
        title: 'Etiqueta salva na Logos',
        description: 'Nao consegui refletir todas as etiquetas no WhatsApp. Verifique se elas existem na UAZAPI.',
        variant: 'destructive',
      });
    }
  };

  /* ── Effects ───────────────────────────────────────────────────── */
  useEffect(() => { fetchInstances(); }, [fetchInstances]);
  useEffect(() => { fetchConversations(true); }, [fetchConversations]);
  // Busca tags só quando a quantidade de conversas muda, não a cada referência nova
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchContactTags(); }, [fetchContactTags, conversations.length]);
  useEffect(() => { fetchTeamMembers(); }, [fetchTeamMembers]);

  useEffect(() => {
    if (!effectiveUserId || conversations.length === 0) return;
    const missing = conversations.filter(conv => {
      const canonical = leadKey(conv.phone);
      return conv.phone
        && !contactProfilePictures[conv.phone]
        && !contactProfilePictures[canonical]
        && !profilePhotoAttemptsRef.current.has(conv.phone);
    });
    if (missing.length === 0) return;

    for (const conv of missing.slice(0, 6)) {
      profilePhotoAttemptsRef.current.add(conv.phone);
      supabase.functions.invoke('wa-sync-profile-photo', {
        body: {
          user_id: effectiveUserId,
          phone: conv.phone,
          instance_id: conv.instance_id,
        },
      }).then(({ data, error }) => {
        const picture = !error && typeof data?.profile_picture_url === 'string'
          ? data.profile_picture_url
          : null;
        if (!picture) return;
        setContactProfilePictures(prev => ({
          ...prev,
          [conv.phone]: picture,
          [leadKey(conv.phone)]: picture,
        }));
      }).catch(() => {
        // Foto de perfil e melhoria visual: falha aqui nao deve quebrar o inbox.
      });
    }
  }, [effectiveUserId, conversations, contactProfilePictures]);

  // Limpa gravação de áudio em andamento se o componente desmontar
  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recordStreamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const recoverable = messages.filter(msg => {
      const kind = mediaKind(msg.message_type);
      return kind
        && msg.remote_message_id
        && !isRenderableMedia(msg.media_url)
        && !mediaResolveAttemptsRef.current.has(msg.id)
        && !resolvingMediaIds.has(msg.id);
    });
    if (recoverable.length === 0) return;

    for (const msg of recoverable.slice(0, 4)) {
      mediaResolveAttemptsRef.current.add(msg.id);
      setResolvingMediaIds(prev => new Set(prev).add(msg.id));
      supabase.functions.invoke('wa-resolve-media', {
        body: { message_id: msg.id },
      }).then(({ data, error }) => {
        if (!error && data?.media_url) {
          setMessages(prev => prev.map(item =>
            item.id === msg.id ? { ...item, media_url: data.media_url } : item
          ));
        }
      }).finally(() => {
        setResolvingMediaIds(prev => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
      });
    }
  }, [messages, resolvingMediaIds]);

  /* ── Realtime ──────────────────────────────────────────────────── */
  // Refs estáveis — subscription recriada apenas quando user muda, não a cada render
  const fetchConversationsRef = useRef(fetchConversations);
  useEffect(() => { fetchConversationsRef.current = fetchConversations; }, [fetchConversations]);
  const fetchMessagesRef = useRef(fetchMessages);
  useEffect(() => { fetchMessagesRef.current = fetchMessages; }, [fetchMessages]);
  const selectedConvKeyRef = useRef(selectedConvKey);
  useEffect(() => { selectedConvKeyRef.current = selectedConvKey; }, [selectedConvKey]);
  // Debounce dos sinais v3 do realtime (o V3 emite vários eventos por turno).
  const v3DebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref de instâncias visíveis — usada pelo realtime pra ignorar inbox alheia
  const allInstancesRef = useRef(allInstances);
  useEffect(() => { allInstancesRef.current = allInstances; }, [allInstances]);

  useEffect(() => {
    if (!effectiveUserId) return;
    const ch = supabase
      .channel(`wa-inbox-rt-${effectiveUserId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'wa_inbox',
        filter: `user_id=eq.${effectiveUserId}`,
      }, (payload) => {
        // ENDURECIDO (privacidade): o payload bruto de wa_inbox NUNCA é anexado ao
        // estado nem renderizado. Os campos de payload.new são usados só como SINAL
        // (roteamento: "chegou algo nesta conversa?"). A lista e a timeline vêm
        // SEMPRE das RPCs seguras (lead-only) — que revalidam autorização no servidor.
        const sig = payload.new as { phone?: string; instance_id?: string | null };
        const sigPhone = sig?.phone || '';
        const sigInstance = sig?.instance_id ?? null;
        // Defesa: ignora sinal de instâncias que não são visíveis ao user
        const visibleIds = allInstancesRef.current.map(i => i.id);
        if (sigInstance && !visibleIds.includes(sigInstance)) return;
        // Vendedor: ignora sinal de leads que não são dele (só roteamento)
        if (isSeller && sellerLeadPhones && !sellerLeadPhones.has(sigPhone)) return;
        // Reconsulta a lista (preview/não-lidas) pela RPC.
        fetchConversationsRef.current(false);
        // Se a conversa aberta é a que recebeu algo, revalida a timeline pela RPC
        // segura (que também marca como lida por telefone). Sem setMessages(payload).
        const convKey = selectedConvKeyRef.current;
        if (convKey) {
          const [selPhone, selInst] = convKey.split('::');
          if (sigPhone === selPhone && (selInst === 'null' || selInst === sigInstance)) {
            fetchMessagesRef.current(selPhone, selInst === 'null' ? null : selInst);
          }
        }
      });

    // Pedro V3 — eventos v3 são SÓ SINAL (sem phone no payload; nada é lido do
    // evento): re-consulta a lista e a timeline aberta pelas RPCs seguras, com
    // debounce (o V3 emite vários eventos por turno). Vendedor não recebe esses
    // eventos (RLS v3 = tenant/master), mas a fase pós-transferência dele vive
    // no wa_inbox, coberto pelo sinal acima.
    const v3Signal = () => {
      if (v3DebounceRef.current) clearTimeout(v3DebounceRef.current);
      v3DebounceRef.current = setTimeout(() => {
        fetchConversationsRef.current(false);
        const convKey = selectedConvKeyRef.current;
        if (convKey) {
          const [selPhone, selInst] = convKey.split('::');
          fetchMessagesRef.current(selPhone, selInst === 'null' ? null : selInst);
        }
      }, 1200);
    };
    ch
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'v3_inbox', filter: `tenant_id=eq.${effectiveUserId}` }, v3Signal)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'v3_effect_outbox', filter: `tenant_id=eq.${effectiveUserId}` }, v3Signal)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'v3_conversation_state', filter: `tenant_id=eq.${effectiveUserId}` }, v3Signal)
      .subscribe();
    return () => {
      if (v3DebounceRef.current) clearTimeout(v3DebounceRef.current);
      supabase.removeChannel(ch);
    };
  }, [effectiveUserId, isSeller, sellerLeadPhones]); // refs garantem acesso à versão atual

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

  useEffect(() => {
    if (!focusPhone || loading || conversations.length === 0) return;
    const targetKey = leadKey(focusPhone);
    if (!targetKey) return;
    if (lastFocusedPhoneRef.current === targetKey && selectedConvKey) return;
    if (activeInstanceTab !== 'all') {
      setActiveInstanceTab('all');
      return;
    }

    const match = conversations.find(c => leadKey(c.phone) === targetKey);
    if (!match) return;

    lastFocusedPhoneRef.current = targetKey;
    setSearchQuery('');
    selectConversation(match);
  }, [focusPhone, loading, conversations, selectedConvKey, activeInstanceTab]);

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
      id: `temp-${crypto.randomUUID()}`,
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
      toast({ title: 'Erro ao enviar', description: descricaoErro(err), variant: 'destructive' });
      setMessages(prev => prev.filter(m => m.id !== opt.id));
      setReplyText(text); // Restore text on error
    } finally {
      setSending(false);
    }
  };

  /* ── Envio de mídia (áudio, imagem, arquivo) ───────────────────── */
  // O backend (wa-send-reply) já aceita media_url + media_type e salva no
  // histórico. Aqui só subimos o arquivo num bucket público e mandamos a URL.
  const mediaTypeFromMime = (mime: string): 'image' | 'audio' | 'video' | 'document' => {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    return 'document';
  };

  const sendMediaMessage = async (blob: Blob, filename: string, caption = '') => {
    if (!selectedConvKey || !user) return;
    const [phone] = selectedConvKey.split('::');
    const instId = sendInstanceId || instances[0]?.id;
    if (!instId) {
      toast({ title: 'Selecione uma instância conectada', variant: 'destructive' });
      return;
    }
    const mime = blob.type || 'application/octet-stream';
    const mediaType = mediaTypeFromMime(mime);
    const tempId = `temp-${crypto.randomUUID()}`;
    setUploadingMedia(true);
    try {
      // 1) Upload pro bucket público "creatives" (UazAPI busca a URL pra enviar)
      const ext = filename.includes('.') ? filename.split('.').pop() : (mime.split('/')[1] || 'bin');
      const path = `${user.id}/wa-inbox/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('creatives')
        .upload(path, blob, { contentType: mime, upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('creatives').getPublicUrl(path);

      // 2) Mensagem otimista (aparece na hora; o realtime reconcilia depois)
      const opt: InboxMessage = {
        id: tempId, user_id: user.id, instance_id: instId, phone,
        contact_name: null, direction: 'outgoing', message_type: mediaType,
        content: caption || null, media_url: publicUrl, ai_category: null,
        ai_sentiment: null, is_read: true, created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, opt]);

      // 3) Envia de fato
      const { error } = await supabase.functions.invoke('wa-send-reply', {
        body: { instance_id: instId, phone, media_url: publicUrl, media_type: mediaType, content: caption },
      });
      if (error) {
        let message = error.message || 'Falha ao enviar mídia';
        const context = (error as any).context;
        if (context && typeof context.json === 'function') {
          try { const body = await context.json(); message = body?.error || message; } catch {}
        }
        throw new Error(message);
      }
    } catch (err: any) {
      toast({ title: 'Erro ao enviar mídia', description: descricaoErro(err), variant: 'destructive' });
      setMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ''; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'O limite por arquivo é 16 MB.', variant: 'destructive' });
      return;
    }
    await sendMediaMessage(file, file.name);
  };

  /* ── Gravação de áudio (nota de voz, igual WhatsApp) ───────────── */
  const startRecording = async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast({ title: 'Gravação não suportada', description: 'Seu navegador não permite gravar áudio. Use o anexo para enviar um arquivo de áudio.', variant: 'destructive' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '');
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recordChunksRef.current = [];
      const cancelled = { current: false };
      recordCancelRef.current = () => { cancelled.current = true; };
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) recordChunksRef.current.push(ev.data); };
      rec.onstop = async () => {
        recordStreamRef.current?.getTracks().forEach(t => t.stop());
        recordStreamRef.current = null;
        if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
        setRecording(false);
        setRecordSeconds(0);
        if (cancelled.current) return;
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 0) await sendMediaMessage(blob, `audio-${Date.now()}.webm`);
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err: any) {
      toast({ title: 'Não foi possível acessar o microfone', description: descricaoErro(err) || 'Permita o uso do microfone no navegador.', variant: 'destructive' });
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop(); // dispara onstop → envia
  };

  const cancelRecording = () => {
    recordCancelRef.current?.();
    stopRecording();
  };

  const handleTransfer = async (memberId: string) => {
    if (!selectedConvKey || !effectiveUserId) return;
    const [phone] = selectedConvKey.split('::');
    const jid = `${phone}@s.whatsapp.net`;
    const member = teamMembers.find(m => m.id === memberId);

    try {
      // Busca lead existente (se houver) pra reusar agent_id/lead_name
      const { data: lead } = await supabase
        .from('ai_crm_leads')
        .select('id, agent_id, lead_name')
        .eq('user_id', effectiveUserId as string)
        .eq('remote_jid', jid)
        .maybeSingle();

      // Resolve agent_id: lead existente > member.agent_id > primeiro agente ativo
      let agentId = lead?.agent_id || member?.agent_id || null;
      if (!agentId) {
        const { data: firstAgent } = await (supabase as any)
          .from('wa_ai_agents').select('id').eq('user_id', effectiveUserId).eq('is_active', true).limit(1).maybeSingle();
        agentId = firstAgent?.id || null;
      }

      // Chama edge function manual-transfer:
      // - cria/atualiza lead em ai_crm_leads
      // - envia briefing IA pro vendedor via WhatsApp
      // - envia relatório de transferência pro gerente
      // - registra em ai_lead_transfers
      const { data, error } = await supabase.functions.invoke('manual-transfer', {
        body: {
          leadId: lead?.id || null,
          memberId,
          notes: 'Transferência manual via Conversas IA',
          remoteJid: jid,
          agentId,
          leadName: lead?.lead_name || selectedConv?.contact_name || phone,
          ownerUserId: effectiveUserId,
        }
      });
      if (error) {
        let message = error.message || 'Falha ao transferir';
        const context = (error as any).context;
        if (context && typeof context.json === 'function') {
          try { const body = await context.json(); message = body?.error || message; } catch {}
        }
        throw new Error(message);
      }

      // BUG-NOVO-03: respeitar deduplicated=true do backend (clique duplo < 30s)
      if ((data as any)?.deduplicated) {
        toast({
          title: 'ℹ️ Já estava transferido',
          description: 'Clique anterior detectado (< 30s). Vendedor não recebeu mensagem duplicada.',
        });
      } else {
        toast({
          title: '✅ Lead transferido!',
          description: `${member?.name} recebeu o briefing IA via WhatsApp. Gerente notificado.`,
        });
      }
    } catch (err: any) {
      toast({ title: 'Erro ao transferir', description: descricaoErro(err), variant: 'destructive' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Dados derivados ───────────────────────────────────────────── */
  const selectedConv = conversations.find(c => c.key === selectedConvKey) ?? null;
  const selectedProfilePicture = selectedConv
    ? contactProfilePictures[selectedConv.phone] || contactProfilePictures[leadKey(selectedConv.phone)] || null
    : null;

  const filteredConversations = conversations.filter(c => {
    if (filterTags.length > 0) {
      const cTags = contactTags[c.phone] || [];
      if (!filterTags.some(ft => cTags.includes(ft))) return false;
    }
    if (arrivalDateFilter && dateInputValue(conversationArrivalIso(c)) !== arrivalDateFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return c.phone.includes(q) || c.contact_name?.toLowerCase().includes(q) || c.last_message?.toLowerCase().includes(q);
  });

  const totalUnread = conversations.reduce((s, c) => s + c.unread_count, 0);
  const zoomClasses = {
    sm: { bubble: 'text-[13.5px]', input: 'text-sm', media: 'max-w-[240px] max-h-[280px]' },
    md: { bubble: 'text-[14.5px]', input: 'text-sm', media: 'max-w-[280px] max-h-[320px]' },
    lg: { bubble: 'text-[15.5px]', input: 'text-base', media: 'max-w-[340px] max-h-[380px]' },
  }[chatZoom];
  const sidebarWidthClass = sidebarCompact
    ? 'md:w-[272px] lg:w-[296px]'
    : 'md:w-[320px] lg:w-[360px]';
  const shellClass = chatExpanded
    ? 'fixed inset-3 md:inset-6 z-50 h-auto flex flex-col rounded-2xl border border-border/60 bg-background shadow-2xl'
    : `flex flex-col ${embedded ? 'h-[calc(100vh-210px)]' : 'h-[calc(100vh-120px)]'}`;

  const instName = (id: string | null) => {
    if (!id) return null;
    const inst = allInstances.find(i => i.id === id);
    return inst ? (inst.friendly_name || inst.instance_name) : null;
  };

  // Nome do vendedor dono da instância (quando a conversa é numa instância de vendedor).
  const sellerForInstance = (id: string | null) => {
    if (!id) return null;
    const inst = allInstances.find(i => i.id === id);
    if (!inst?.seller_member_id) return null;
    return teamMembers.find((m: any) => m.id === inst.seller_member_id)?.name
      || inst.friendly_name || inst.instance_name || 'Vendedor';
  };

  /* ── Wrapper ───────────────────────────────────────────────────── */
  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : MainLayout;

  /* ── Render ─────────────────────────────────────────────────────── */

  // Bloqueia vendedor sem permissão marcos_inbox (acesso direto via URL)
  if (blockSellerAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Wrapper>
      <div className={`${shellClass} overflow-hidden`}>

        {/* ══════════════════════════════════════════════════════════
            TOPO: seletor de instância (tabs)
        ══════════════════════════════════════════════════════════ */}
        <div className="border-b border-[#222d35] bg-[#111b21] px-4 pt-3 pb-0 shrink-0">
          <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">

            {/* Tab "Todas" */}
            <button
              onClick={() => { setActiveInstanceTab('all'); setSelectedConvKey(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-all whitespace-nowrap ${
                activeInstanceTab === 'all'
                  ? 'border-[#00a884] text-[#00a884] bg-[#202c33]'
                  : 'border-transparent text-[#8696a0] hover:text-[#e9edef] hover:bg-[#202c33]/70'
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
                      ? 'border-[#00a884] text-[#00a884] bg-[#202c33]'
                      : 'border-transparent text-[#8696a0] hover:text-[#e9edef] hover:bg-[#202c33]/70'
                  }`}
                >
                  {connected
                    ? <Wifi className="h-3 w-3 text-emerald-500" />
                    : <WifiOff className="h-3 w-3 text-red-400" />
                  }
                  <span className="max-w-[120px] truncate">{
                    inst.seller_member_id
                      ? (teamMembers.find((m: any) => m.id === inst.seller_member_id)?.name || inst.friendly_name || inst.instance_name)
                      : (inst.friendly_name || inst.instance_name)
                  }</span>
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
          <div className="hidden md:flex items-center gap-1 pb-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#8696a0] hover:bg-[#202c33] hover:text-[#e9edef]"
              onClick={() => setSidebarCompact(v => !v)}
              title={sidebarCompact ? 'Aumentar lista lateral' : 'Diminuir lista lateral'}
            >
              {sidebarCompact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#8696a0] hover:bg-[#202c33] hover:text-[#e9edef]"
              onClick={() => setChatZoom(z => z === 'lg' ? 'md' : z === 'md' ? 'sm' : 'sm')}
              disabled={chatZoom === 'sm'}
              title="Diminuir zoom do chat"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#8696a0] hover:bg-[#202c33] hover:text-[#e9edef]"
              onClick={() => setChatZoom(z => z === 'sm' ? 'md' : z === 'md' ? 'lg' : 'lg')}
              disabled={chatZoom === 'lg'}
              title="Aumentar zoom do chat"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#8696a0] hover:bg-[#202c33] hover:text-[#e9edef]"
              onClick={() => setChatExpanded(v => !v)}
              title={chatExpanded ? 'Sair do modo tela cheia' : 'Expandir conversas'}
            >
              {chatExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            CORPO: lista de conversas + área de chat
        ══════════════════════════════════════════════════════════ */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Lista de conversas ─────────────────────────────────── */}
          <div className={`w-full ${sidebarWidthClass} border-r border-[#222d35] bg-[#111b21] flex flex-col shrink-0 transition-[width] duration-200 ${isMobileChat ? 'hidden md:flex' : 'flex'}`}>

            {/* Busca + filtro de tags */}
            <div className="p-3 border-b border-[#222d35] space-y-2 bg-[#111b21]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Buscar contatos ou mensagens..."
                  className="pl-8 h-9 text-xs bg-[#0b141a] border-[#222d35] text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-[#00a884]"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#222d35] bg-[#0b141a] px-2.5 py-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">Chegou em</span>
                  <Input
                    type="date"
                    value={arrivalDateFilter}
                    onChange={e => setArrivalDateFilter(e.target.value)}
                    className="h-7 min-w-0 border-0 bg-transparent p-0 text-xs text-[#e9edef] focus-visible:ring-0"
                  />
                </div>
                {arrivalDateFilter && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground"
                    onClick={() => setArrivalDateFilter('')}
                    title="Limpar data"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {arrivalDateFilter && (
                <p className="text-[11px] text-muted-foreground">
                  Mostrando {filteredConversations.length} de {conversations.length} conversa{conversations.length !== 1 ? 's' : ''}.
                </p>
              )}
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
                    const profilePicture = contactProfilePictures[conv.phone] || contactProfilePictures[leadKey(conv.phone)] || null;
                    const iName = instName(conv.instance_id);
                    const isSelected = selectedConvKey === conv.key;

                    return (
                      <button
                        key={conv.key}
                        onClick={() => selectConversation(conv)}
                        className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-[#202c33] ${
                          isSelected ? 'bg-[#202c33] border-l-2 border-l-[#00a884]' : 'border-l-2 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="relative shrink-0">
                            <Avatar className="w-10 h-10 border border-white/10">
                              {profilePicture && <AvatarImage src={profilePicture} alt={label} className="object-cover" />}
                              <AvatarFallback className={`text-white text-sm font-semibold ${avatarColor(label)}`}>
                                {initials(label)}
                              </AvatarFallback>
                            </Avatar>
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
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Chegou: {formatArrivalDate(conversationArrivalIso(conv))}
                            </p>
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              {sellerForInstance(conv.instance_id) ? (
                                <span className="flex items-center gap-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full" title="Atendimento do vendedor (auditoria)">
                                  <UserCheck className="h-2.5 w-2.5" />
                                  {sellerForInstance(conv.instance_id)}
                                </span>
                              ) : (iName && activeInstanceTab === 'all' && (
                                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
                                  <Wifi className="h-2.5 w-2.5" />
                                  {iName}
                                </span>
                              ))}
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
                <div className="px-4 py-3 border-b border-[#222d35] bg-[#202c33] flex items-center gap-3 shrink-0">
                  {/* Voltar mobile */}
                  <button
                    className="md:hidden p-1.5 rounded-lg hover:bg-[#111b21] text-[#8696a0]"
                    onClick={() => { setIsMobileChat(false); setSelectedConvKey(null); }}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>

                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <Avatar className="w-9 h-9 border border-white/10">
                      {selectedProfilePicture && (
                        <AvatarImage
                          src={selectedProfilePicture}
                          alt={selectedConv?.contact_name || selectedConv?.phone || 'Contato'}
                          className="object-cover"
                        />
                      )}
                      <AvatarFallback className={`text-white text-sm font-semibold ${avatarColor(selectedConv?.contact_name || selectedConv?.phone || '')}`}>
                        {initials(selectedConv?.contact_name || selectedConv?.phone || '?')}
                      </AvatarFallback>
                    </Avatar>
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
                      {sellerForInstance(selectedConv?.instance_id ?? null) && (
                        <>
                          <span className="text-muted-foreground/30 text-xs">·</span>
                          <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400" title="Atendimento do vendedor (auditoria)">
                            <UserCheck className="h-3 w-3" />
                            Vendedor: {sellerForInstance(selectedConv?.instance_id ?? null)}
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
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 border-[#00a884]/35 bg-[#00a884]/10 text-[#7ee2b8] hover:bg-[#00a884]/20"
                          title="Etiquetas da conversa"
                        >
                          {syncingLabels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                          <span className="hidden lg:inline">Etiquetas</span>
                        </Button>
                      }
                    />
                  </div>
                </div>

                {/* ── Mensagens ── */}
                <div
                  className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1"
                  style={{
                    backgroundColor: '#0b141a',
                    backgroundImage: 'radial-gradient(circle, rgba(134,150,160,.18) 1px, transparent 1px)',
                    backgroundSize: '22px 22px',
                    backgroundRepeat: 'repeat',
                  }}
                >
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
                        // Balão da IA (Pedro V3/V2 e instâncias da IA) = roxo, igual ao
                        // inbox do Pedro; vendedor segue verde. actor vem da RPC segura.
                        const isAi = isOut && (msg.actor === 'ia' || String(msg.id).startsWith('wch-'));
                        const prevMsg = messages[idx - 1];
                        const showDate = !prevMsg || format(new Date(msg.created_at), 'dd/MM/yyyy') !== format(new Date(prevMsg.created_at), 'dd/MM/yyyy');
                        const sameDir = prevMsg && prevMsg.direction === msg.direction;
                        const gap = sameDir ? 'mt-0.5' : 'mt-3';
                        const kind = mediaKind(msg.message_type);
                        const renderableMediaUrl = primaryMediaUrl(msg);
                        const hasMedia = Boolean(renderableMediaUrl);
                        const isResolvingMedia = resolvingMediaIds.has(msg.id);
                        const showText = Boolean(msg.content)
                          && msg.message_type !== 'document'
                          && !(kind && isPlaceholderContent(msg.content));
                        const showMediaBlock = Boolean(kind && (hasMedia || !showText));

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
                              <div className={`max-w-[84%] sm:max-w-[74%] flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                                <div className={`relative px-3 py-2 rounded-lg shadow-md overflow-hidden ${
                                  isAi
                                    ? 'bg-[#4a3f6b] text-[#e9edef] rounded-tr-sm border border-violet-400/30'
                                    : isOut
                                    ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-sm'
                                    : 'bg-[#202c33] text-[#e9edef] rounded-tl-sm border border-white/5'
                                }`}>
                                  {showMediaBlock && kind && (
                                    <div className={showText ? 'mb-2' : 'mb-0'}>
                                      {kind === 'image' && hasMedia ? (
                                        <a href={renderableMediaUrl!} target="_blank" rel="noopener noreferrer" className="block group">
                                          <img
                                            src={renderableMediaUrl!}
                                            alt="Imagem recebida"
                                            loading="lazy"
                                            className={`rounded-xl ${zoomClasses.media} object-cover border border-white/10 group-hover:opacity-95 transition-opacity`}
                                          />
                                        </a>
                                      ) : kind === 'audio' && hasMedia ? (
                                        <div className={`rounded-xl px-3 py-2 min-w-[260px] ${isOut ? 'bg-white/10' : 'bg-[#111b21]'}`}>
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <span className={`h-8 w-8 rounded-full flex items-center justify-center ${isOut ? 'bg-[#25d366]/20' : 'bg-[#00a884]/15'}`}>
                                              <Mic className="h-4 w-4 text-[#00a884]" />
                                            </span>
                                            <span className="text-xs font-semibold opacity-80">Audio</span>
                                          </div>
                                          <audio controls src={renderableMediaUrl!} className="h-9 w-full max-w-[280px] accent-[#00a884]" />
                                        </div>
                                      ) : kind === 'video' && hasMedia ? (
                                        <video controls src={renderableMediaUrl!} className={`rounded-xl ${zoomClasses.media} border border-white/10`} />
                                      ) : kind === 'document' && hasMedia ? (
                                        <a
                                          href={renderableMediaUrl!} target="_blank" rel="noopener noreferrer"
                                          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm min-w-[240px] ${isOut ? 'bg-primary-foreground/10' : 'bg-muted/60'}`}
                                        >
                                          <FileText className="h-4 w-4 shrink-0" />
                                          <span className="truncate max-w-[190px]">{msg.content || 'Arquivo recebido'}</span>
                                          <Download className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                        </a>
                                      ) : (
                                        <div className={`rounded-xl px-3 py-2 min-w-[230px] border ${isOut ? 'bg-white/10 border-white/10' : 'bg-[#111b21] border-white/10'}`}>
                                          <div className="flex items-center gap-2">
                                            {kind === 'image' ? <ImageIcon className="h-4 w-4 opacity-80" /> : kind === 'audio' ? <Mic className="h-4 w-4 opacity-80" /> : kind === 'video' ? <Video className="h-4 w-4 opacity-80" /> : <FileText className="h-4 w-4 opacity-80" />}
                                            <span className="text-sm font-semibold">
                                              {kind === 'image' ? 'Imagem recebida' : kind === 'audio' ? 'Audio recebido' : kind === 'video' ? 'Video recebido' : 'Arquivo recebido'}
                                            </span>
                                          </div>
                                          <div className="flex items-start gap-1.5 mt-1 text-[11px] opacity-70 leading-snug">
                                            {isResolvingMedia ? <Loader2 className="h-3 w-3 mt-0.5 shrink-0 animate-spin" /> : <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />}
                                            <span>{isResolvingMedia ? 'Recuperando arquivo da conversa...' : 'Arquivo ainda nao disponivel para visualizacao.'}</span>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {showText && (
                                    <p className={`${zoomClasses.bubble} whitespace-pre-wrap break-words leading-relaxed`}>{msg.content}</p>
                                  )}

                                  {/* Rodapé da mensagem: hora + status */}
                                  <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                    {isOut && msg.instance_id && allInstances.length > 1 && (
                                      <span className="text-[9px] opacity-50">{instName(msg.instance_id)}</span>
                                    )}
                                    <span className={`text-[10px] ${isOut ? 'text-[#d1f4e5]/65' : 'text-[#8696a0]'}`}>
                                      {format(new Date(msg.created_at), 'HH:mm')}
                                    </span>
                                    {isOut && (
                                      msg.is_read
                                        ? <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
                                        : <Check className="h-3 w-3 text-[#d1f4e5]/65" />
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
                <div className="border-t border-[#222d35] bg-[#202c33] shrink-0">
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
                                  ? 'bg-[#00a884] text-[#111b21] border-[#00a884]'
                                  : 'bg-[#111b21] text-[#8696a0] border-[#222d35] hover:border-[#00a884]/50 hover:text-[#e9edef]'
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

                  {/* Input escondido pra anexar arquivo/imagem/áudio */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                    className="hidden"
                    onChange={handleFilePick}
                  />

                  {recording ? (
                    /* Barra de gravação de áudio */
                    <div className="flex items-center gap-3 p-3">
                      <button
                        onClick={cancelRecording}
                        className="h-10 w-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted/70 transition-colors"
                        title="Cancelar gravação"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="flex-1 flex items-center gap-2 text-sm font-medium text-red-500">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                        Gravando… {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, '0')}
                      </div>
                      <button
                        onClick={stopRecording}
                        disabled={uploadingMedia}
                        className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                        title="Enviar áudio"
                      >
                        {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                  ) : (
                    /* Campo de texto + anexo + áudio/enviar */
                    <div className="flex items-end gap-2 p-3">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingMedia || instances.length === 0}
                        className="h-11 w-11 rounded-full text-[#8696a0] flex items-center justify-center shrink-0 hover:bg-[#111b21] hover:text-[#e9edef] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Anexar arquivo"
                      >
                        {uploadingMedia ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                      </button>

                      <div className="flex-1 bg-[#111b21] rounded-2xl border border-[#222d35] px-4 py-2.5 focus-within:border-[#00a884]/60 transition-all">
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
                          className={`resize-none border-0 bg-transparent p-0 ${zoomClasses.input} text-[#e9edef] placeholder:text-[#8696a0] focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto`}
                        />
                      </div>

                      {replyText.trim() ? (
                        <button
                          onClick={handleSend}
                          disabled={sending || instances.length === 0}
                          className="h-11 w-11 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center shrink-0 hover:bg-[#06cf9c] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                          title="Enviar"
                        >
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        </button>
                      ) : (
                        <button
                          onClick={startRecording}
                          disabled={uploadingMedia || instances.length === 0}
                          className="h-11 w-11 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center shrink-0 hover:bg-[#06cf9c] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                          title="Gravar áudio"
                        >
                          <Mic className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Wrapper>
  );
}
