import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { TagBadge } from '@/components/whatsapp/TagBadge';
import { TagSelector } from '@/components/whatsapp/TagSelector';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Bot, Send, Loader2, Search, ArrowLeft, ArrowRight, Pause, Play,
  MessageCircle, User, Phone, Clock, CheckCheck, Wifi,
  Paperclip, Mic, FileText, Download, Trash2, X, Square, Eye,
  Tag, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, ZoomIn, ZoomOut,
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
  created_at: string | null;
  arrived_at: string | null;
  last_interaction_at: string | null;
  summary: string | null;
  // Origem do lead no inbox unificado: 'pedro' (ai_crm_leads, tráfego) | 'marcos' (crm_leads, manual).
  origem?: 'pedro' | 'marcos';
  // Vendedor atribuido (ai_crm_leads.assigned_to_id / crm_leads.assigned_to) — mostrado no card p/ o master.
  assigned_to_id?: string | null;
}

interface Message {
  id: string;
  phone: string;
  instance_id: string | null;
  direction: 'incoming' | 'outgoing';
  content: string | null;
  message_type: string;
  media_url: string | null;
  remote_message_id?: string | null;
  media_list?: { file?: string; url?: string; type?: string; caption?: string }[] | null;
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
  // Somente leitura (consulta): esconde pausar IA, compositor e gravacao.
  // O vendedor so visualiza a conversa dos leads atribuidos a ele.
  readOnly?: boolean;
  // Abre automaticamente a conversa de um lead vindo do CRM.
  focusLeadId?: string | null;
  focusPhone?: string | null;
  // UNIFICADO (aba "Conversas"): além dos leads do Pedro (ai_crm_leads), traz também
  // os leads MANUAIS do Marcos (crm_leads) e mostra o filtro de origem (Todos/Pedro/Marcos).
  // Default false = comportamento atual do Pedro inalterado.
  unified?: boolean;
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

function contactProfilePicture(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).profile_picture_url;
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}

// Duracao humana curta: "8 min", "2h15", "3 dias". Metrica de tempo ate o 1o contato.
function fmtDur(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d} dia${d > 1 ? 's' : ''}`;
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

/* Numero BR canonico = DDD(2) + 8 digitos, sem DDI 55 e sem o 9o digito do celular.
   Ex.: "5512991097564" e "12991097564" -> "1291097564". Usado pra deduplicar leads
   Pedro×Marcos por telefone independente do formato. */
function phoneCanonical(value: string | null | undefined): string {
  let core = cleanPhone(value);
  if (core.startsWith('55') && core.length > 11) core = core.slice(2);
  if (core.length === 11 && core[2] === '9') core = core.slice(0, 2) + core.slice(3);
  return core;
}

/* TODAS as variacoes plausiveis do mesmo numero (com/sem DDI 55, com/sem 9o digito),
   pra casar no .in('phone', ...) do wa_inbox. O crm_leads (Marcos) guarda o telefone
   sem o 55, enquanto o wa_inbox guarda com o 55 -> sem isto a conversa abre VAZIA. */
function phoneVariantsBR(value: string | null | undefined): string[] {
  const base = phoneCandidates(value);
  const core = phoneCanonical(value);
  if (core.length !== 10) return base;                 // nao e celular BR reconhecivel
  const dd = core.slice(0, 2);
  const rest = core.slice(2);                          // 8 digitos
  const with9 = `${dd}9${rest}`;                       // 11 digitos (com 9o)
  const out = new Set<string>(base);
  for (const f of [core, with9, `55${core}`, `55${with9}`]) {
    out.add(f);
    out.add(`${f}@s.whatsapp.net`);
  }
  return Array.from(out);
}

function displayPhone(value: string | null | undefined) {
  return cleanPhone(value) || value || '';
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

function leadArrivalIso(lead: Pick<Lead, 'arrived_at' | 'created_at' | 'last_interaction_at'>) {
  return lead.arrived_at || lead.created_at || lead.last_interaction_at;
}

function formatArrivalDate(value: string | null | undefined) {
  if (!value) return 'sem data';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'sem data';
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
}

function mediaTypeFromMime(mime: string): 'image' | 'audio' | 'video' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

/* URLs que o navegador NÃO consegue abrir: o blob criptografado do WhatsApp
   (mmg.whatsapp.net / *.enc). Tratadas como "sem mídia" no inbox — assim caímos
   no fallback (base64 do Pedro V2 ou placeholder) em vez de quebrar a imagem. */
function isRenderableMedia(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.startsWith('data:') || u.startsWith('blob:')) return true;
  if (u.includes('mmg.whatsapp.net') || u.includes('.enc')) return false;
  return /^https?:\/\//.test(u);
}

function msgHasRenderableMedia(m: Pick<Message, 'media_url' | 'media_list'>): boolean {
  if (isRenderableMedia(m.media_url)) return true;
  return (m.media_list || []).some(x => isRenderableMedia(x?.file || x?.url));
}

/* Texto a exibir no balao: remove os rotulos automaticos de midia recebida
   ("[Imagem recebida]", "[áudio recebido]", "Legenda:") para nao poluir, mas
   preserva legendas reais e transcricoes de audio. */
function displayText(content: string | null | undefined): string {
  const s = (content || '').trim();
  if (!s) return '';
  const imgLegenda = s.match(/^\[Imagem recebida[^\]]*\]\s*(?:\n?Legenda:\s*)?([\s\S]*)$/i);
  if (imgLegenda) return imgLegenda[1].trim();
  if (/^\[[^\]]*\]$/.test(s)) return ''; // placeholder puro: [áudio recebido], [Arquivo recebido: x]
  return s;
}

const MEDIA_PLACEHOLDER: Record<string, string> = {
  image: '🖼️ Imagem',
  audio: '🎤 Áudio',
  ptt: '🎤 Áudio',
  voice: '🎤 Áudio',
  video: '🎬 Vídeo',
  document: '📎 Arquivo',
  file: '📎 Arquivo',
  sticker: '🌟 Figurinha',
};

/* Valor "coringa" do seletor: mostra os leads de TODOS os agentes (paridade com
   o CRM, que filtra so por user_id). Sem isso, o inbox filtrava por agent_id e a
   lista vinha vazia quando o lead estava sob outro agente (ou agent_id null). */
const ALL_AGENTS = '__all__';
const ALL_SELLERS = '__all_sellers__'; // filtro "todos" do dropdown de vendedor (só master)

/* ── Componente Principal ──────────────────────────────────────────── */
export function AgentInboxTab({ userId, isSeller = false, sellerMemberIds = [], readOnly = false, focusLeadId = null, focusPhone = null, unified = false }: AgentInboxTabProps) {
  const { toast } = useToast();
  const lastFocusedLeadRef = useRef<string | null>(null);

  // Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(ALL_AGENTS);
  // Divisor arrastavel da lista de conversas (modo Conversas), estilo WhatsApp
  const paneRef = useRef<HTMLDivElement>(null);
  const [listW, setListW] = useState<number>(() => {
    try { const v = parseInt(localStorage.getItem('conversas_list_w') || '', 10); if (v >= 280 && v <= 560) return v; } catch { /* ignore */ }
    return 380;
  });
  const startListDrag = (e: { preventDefault(): void }) => {
    e.preventDefault();
    let lastW = listW;
    const onMove = (ev: MouseEvent) => {
      const rect = paneRef.current?.getBoundingClientRect();
      if (!rect) return;
      lastW = Math.min(560, Math.max(280, ev.clientX - rect.left));
      setListW(lastW);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('conversas_list_w', String(lastW)); } catch { /* ignore */ }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  // Filtro por vendedor (só master): acompanhar os leads/conversas de um vendedor.
  const [sellers, setSellers] = useState<{ key: string; name: string; memberIds: string[] }[]>([]);
  const [sellerFilter, setSellerFilter] = useState<string>(ALL_SELLERS);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // Leads (conversations)
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // Filtro de origem no inbox unificado (chips Todos/Pedro/Marcos).
  const [originFilter, setOriginFilter] = useState<'all' | 'pedro' | 'marcos'>('all');
  const [arrivalDateFilter, setArrivalDateFilter] = useState('');

  // Chat
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [resolvingMediaIds, setResolvingMediaIds] = useState<Set<string>>(new Set());
  // FASE 1: momento da transferencia IA->vendedor (ai_lead_transfers.confirmed_at) do lead aberto,
  // pra marcar "Atendimento IA" antes e o divisor de transferencia. So no modo Conversas e no Pedro.
  const [transferInfo, setTransferInfo] = useState<{ at: string; toMemberId: string | null } | null>(null);
  // Modelo B: numero (instancia conectada) do PROPRIO vendedor atribuido, pra o follow-up do lead
  // do Pedro sair do numero dele (nao do numero da empresa). null = vendedor sem numero conectado.
  const [sellerSendInstanceId, setSellerSendInstanceId] = useState<string | null>(null);
  // Se ja terminamos de checar a instancia do vendedor (pra nao mostrar "nao conectado" antes de saber).
  const [sellerInstanceLoaded, setSellerInstanceLoaded] = useState(false);

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
  const profilePhotoAttemptsRef = useRef<Set<string>>(new Set());
  const [leadProfilePictures, setLeadProfilePictures] = useState<Record<string, string>>({});
  const [contactTags, setContactTags] = useState<Record<string, string[]>>({});
  const [syncingLabels, setSyncingLabels] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [chatZoom, setChatZoom] = useState<'sm' | 'md' | 'lg'>('md');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaResolveAttemptsRef = useRef<Set<string>>(new Set());

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

  /* ── Vendedores do master (filtro de acompanhamento) ──────────── */
  useEffect(() => {
    if (isSeller || !userId) { setSellers([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, whatsapp_number, active_in_system')
        .eq('user_id', userId)
        .neq('active_in_system', false);
      if (cancelled) return;
      // Agrupa por whatsapp: 1 vendedor pode ter 1 row por agente (member ids vários).
      const byKey = new Map<string, { key: string; name: string; memberIds: string[] }>();
      for (const s of ((data || []) as any[])) {
        const key = s.whatsapp_number || s.id;
        if (!byKey.has(key)) byKey.set(key, { key, name: s.name || 'Vendedor', memberIds: [] });
        byKey.get(key)!.memberIds.push(s.id);
      }
      setSellers([...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => { cancelled = true; };
  }, [isSeller, userId]);

  /* ── Fetch leads for selected agent ──────────────────────────── */
  const fetchLeads = useCallback(async () => {
    if (!selectedAgentId) return;
    setLoadingLeads(true);
    let query = (supabase as any)
      .from('ai_crm_leads')
      // message_count NÃO está no SELECT porque a coluna não existe em ai_crm_leads.
      // O valor é calculado dinamicamente abaixo via wa_chat_history (useEffect).
      .select('id, remote_jid, lead_name, status, ai_paused, instance_id, agent_id, created_at, arrived_at, last_interaction_at, summary, assigned_to_id')
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
    // Master filtrando por um vendedor: escopa aos member ids dele (todos os rows
    // do mesmo whatsapp). Sem vendedor selecionado = todos os leads (atual).
    if (!isSeller && sellerFilter !== ALL_SELLERS) {
      const ids = sellers.find(s => s.key === sellerFilter)?.memberIds || [];
      query = ids.length > 0
        ? query.in('assigned_to_id', ids)
        : query.eq('assigned_to_id', '00000000-0000-0000-0000-000000000000');
    }
    const { data } = await query.order('last_interaction_at', { ascending: false });
    const pedroLeads: Lead[] = (data || []).map((l: any) => ({ ...l, origem: 'pedro' as const }));

    // UNIFICADO: junta os leads MANUAIS do Marcos (crm_leads), sem duplicar por telefone
    // (um lead que já veio do Pedro/tráfego não repete). Mensagens continuam sendo por
    // telefone, então o resto do inbox funciona igual pras duas origens.
    let marcosLeads: Lead[] = [];
    if (unified) {
      let mq = (supabase as any)
        .from('crm_leads')
        .select('id, name, phone, assigned_to, created_at, arrived_at')
        .eq('user_id', userId);
      if (isSeller) {
        mq = sellerMemberIds.length > 0
          ? mq.in('assigned_to', sellerMemberIds)
          : mq.eq('assigned_to', '00000000-0000-0000-0000-000000000000');
      } else if (sellerFilter !== ALL_SELLERS) {
        const ids = sellers.find(s => s.key === sellerFilter)?.memberIds || [];
        mq = ids.length > 0
          ? mq.in('assigned_to', ids)
          : mq.eq('assigned_to', '00000000-0000-0000-0000-000000000000');
      }
      const { data: mData } = await mq.order('arrived_at', { ascending: false }).limit(2000);
      const pedroPhones = new Set(pedroLeads.map(l => phoneCanonical(l.remote_jid)));
      marcosLeads = (mData || [])
        .filter((c: any) => { const k = phoneCanonical(c.phone); return !!k && !pedroPhones.has(k); })
        .map((c: any): Lead => ({
          id: c.id,
          remote_jid: c.phone || '',
          lead_name: c.name || null,
          status: 'manual',
          ai_paused: true,           // lead manual não tem IA rodando
          instance_id: null,
          agent_id: '',
          message_count: 0,
          created_at: c.created_at,
          arrived_at: c.arrived_at,
          last_interaction_at: c.arrived_at || c.created_at,
          summary: null,
          assigned_to_id: c.assigned_to || null,
          origem: 'marcos',
        }));
    }

    const merged = [...pedroLeads, ...marcosLeads].sort((a, b) => {
      const ta = new Date(a.last_interaction_at || a.arrived_at || a.created_at || 0).getTime();
      const tb = new Date(b.last_interaction_at || b.arrived_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    setLeads(merged);
    setLoadingLeads(false);
  }, [selectedAgentId, userId, isSeller, sellerMemberIds, sellerFilter, sellers, unified]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    if (!userId || leads.length === 0) return;
    const phones = Array.from(new Set(leads.map(lead => cleanPhone(lead.remote_jid)).filter(Boolean)));
    if (phones.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from('wa_contacts')
        .select('phone, metadata, tags')
        .eq('user_id', userId)
        .in('phone', phones);
      if (cancelled) return;

      const next: Record<string, string> = {};
      const tagMap: Record<string, string[]> = {};
      for (const c of (data || []) as any[]) {
        const picture = contactProfilePicture(c.metadata);
        if (picture) {
          next[c.phone] = picture;
          next[phoneCanonical(c.phone)] = picture;
        }
        if (Array.isArray(c.tags) && c.tags.length > 0) {
          tagMap[c.phone] = c.tags;
          tagMap[phoneCanonical(c.phone)] = c.tags;
        }
      }
      if (Object.keys(next).length > 0) {
        setLeadProfilePictures(prev => ({ ...prev, ...next }));
      }
      if (Object.keys(tagMap).length > 0) {
        setContactTags(prev => ({ ...prev, ...tagMap }));
      }
    })();

    return () => { cancelled = true; };
  }, [userId, leads.length]);

  useEffect(() => {
    if (!userId || leads.length === 0) return;
    const missing = leads.filter(lead => {
      const phone = cleanPhone(lead.remote_jid);
      const canonical = phoneCanonical(phone);
      return phone
        && !leadProfilePictures[phone]
        && !leadProfilePictures[canonical]
        && !profilePhotoAttemptsRef.current.has(phone);
    });
    if (missing.length === 0) return;

    for (const lead of missing.slice(0, 6)) {
      const phone = cleanPhone(lead.remote_jid);
      profilePhotoAttemptsRef.current.add(phone);
      supabase.functions.invoke('wa-sync-profile-photo', {
        body: {
          user_id: userId,
          phone,
          instance_id: lead.instance_id,
        },
      }).then(({ data, error }) => {
        const picture = !error && typeof data?.profile_picture_url === 'string'
          ? data.profile_picture_url
          : null;
        if (!picture) return;
        setLeadProfilePictures(prev => ({
          ...prev,
          [phone]: picture,
          [phoneCanonical(phone)]: picture,
        }));
      }).catch(() => {
        // Foto de perfil e melhoria visual: falha aqui nao deve quebrar o inbox.
      });
    }
  }, [userId, leads, leadProfilePictures]);

  const updateLeadTags = async (lead: Lead, tags: string[]) => {
    const phone = cleanPhone(lead.remote_jid);
    if (!phone) return;

    const canonical = phoneCanonical(phone);
    setContactTags(prev => ({
      ...prev,
      [phone]: tags,
      ...(canonical ? { [canonical]: tags } : {}),
    }));

    const { data: existing } = await (supabase as any)
      .from('wa_contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await (supabase as any)
        .from('wa_contacts')
        .update({ tags })
        .eq('id', existing.id);
    } else {
      await (supabase as any)
        .from('wa_contacts')
        .insert({
          user_id: userId,
          phone,
          name: lead.lead_name || phone,
          source: lead.origem === 'marcos' ? 'marcos_inbox' : 'pedro_inbox',
          tags,
          last_message_at: lead.last_interaction_at || new Date().toISOString(),
        });
    }

    const latestInstanceId = [...messages].reverse().find(m => m.instance_id)?.instance_id || null;
    const instanceId = lead.instance_id || sellerSendInstanceId || latestInstanceId;
    if (!instanceId) {
      toast({
        title: 'Etiqueta salva na Logos',
        description: 'Nao encontrei uma instancia conectada nessa conversa para refletir no WhatsApp.',
      });
      return;
    }

    setSyncingLabels(true);
    const { data, error } = await supabase.functions.invoke('wa-sync-chat-labels', {
      body: {
        user_id: userId,
        phone,
        instance_id: instanceId,
        labels: tags,
      },
    }).finally(() => setSyncingLabels(false));

    if (error || (data as any)?.ok === false) {
      toast({
        title: 'Etiqueta salva na Logos',
        description: 'Nao consegui refletir todas as etiquetas no WhatsApp. Verifique a conexao da UAZAPI.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    const focusPhoneCanonical = phoneCanonical(focusPhone);
    const focusKey = focusLeadId || focusPhoneCanonical;
    if (!focusKey || loadingLeads || leads.length === 0) return;
    if (lastFocusedLeadRef.current === focusKey && (
      selectedLead?.id === focusLeadId
      || (!!focusPhoneCanonical && phoneCanonical(selectedLead?.remote_jid) === focusPhoneCanonical)
    )) return;
    const lead = leads.find(l => (
      (!!focusLeadId && l.id === focusLeadId)
      || (!!focusPhoneCanonical && phoneCanonical(l.remote_jid) === focusPhoneCanonical)
    ));
    if (!lead) return;
    lastFocusedLeadRef.current = focusKey;
    setSelectedLead(lead);
    setSearchTerm('');
  }, [focusLeadId, focusPhone, loadingLeads, leads, selectedLead?.id, selectedLead?.remote_jid]);

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
        .select('id, phone, instance_id, direction, content, message_type, media_url, remote_message_id, created_at, contact_name')
        .eq('user_id', userId)
        .in('phone', unified ? phoneVariantsBR(selectedLeadPhone) : phoneCandidates(selectedLeadPhone));

      // Modelo Conversas (unified): a conversa com o lead pode estar em VARIOS numeros — o da
      // empresa (fase IA) e o do PROPRIO vendedor (follow-up). Nao filtramos por instancia pra
      // trazer a timeline completa; fora do unified, mantem o filtro do inbox do Pedro.
      if (!unified && selectedLeadInstanceId) {
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
          .select('id, remote_jid, role, content, metadata, created_at')
          .eq('user_id', userId)
          .in('remote_jid', unified ? phoneVariantsBR(selectedLeadPhone) : phoneCandidates(selectedLeadPhone))
          .order('created_at', { ascending: true })
          .range(0, 999);
        historyRows = (histData || []).map((r: any): Message => {
          const mediaList = r.metadata?.media || null;
          const firstMedia = mediaList?.[0] || null;
          return {
            id: `wch-${r.id}`,
            phone: cleanPhone(r.remote_jid),
            // wa_chat_history guarda o NOME da instancia, nao o UUID -> nunca usar
            // pra envio. Deixamos null pra nao poluir o resolveInstanceId().
            instance_id: null,
            direction: r.role === 'assistant' ? 'outgoing' : 'incoming',
            content: r.content ?? '',
            message_type: firstMedia ? (firstMedia.type || 'image') : 'text',
            media_url: firstMedia ? (firstMedia.file || firstMedia.url) : null,
            media_list: mediaList,
            created_at: r.created_at,
            contact_name: null,
          };
        });
      } catch {
        // silencioso — mantem somente o wa_inbox
      }

      // Funde as duas fontes evitando balao duplicado. Considera "mesma mensagem"
      // quando: mesma direcao + janela de ~2min + (mesmo texto OU ambas sao midia
      // do mesmo tipo). Ao deduplicar, MANTEM a linha com midia RENDERIZAVEL — a
      // entrada do lead via wa_inbox grava a URL .enc (nao abre), enquanto o Pedro
      // V2 as vezes guarda o base64 tocavel em wa_chat_history. Sem isto, audio/
      // imagem do lead somem do inbox.
      const sameMessage = (a: Message, b: Message) => {
        if (a.direction !== b.direction) return false;
        if (Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) > 120000) return false;
        const aMedia = a.message_type !== 'text';
        const bMedia = b.message_type !== 'text';
        if (aMedia && bMedia) return a.message_type === b.message_type;
        return (a.content || '').trim() === (b.content || '').trim();
      };
      const merged: Message[] = [...inboxRows];
      for (const h of historyRows) {
        const idx = merged.findIndex(r => sameMessage(r, h));
        if (idx === -1) { merged.push(h); continue; }
        // Troca pela linha do history só quando ela tem midia boa e a atual nao.
        if (msgHasRenderableMedia(h) && !msgHasRenderableMedia(merged[idx])) {
          merged[idx] = { ...h, id: merged[idx].id };
        }
      }

      const rows: Message[] = merged.sort(
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
  }, [selectedLeadId, selectedLeadPhone, selectedLeadInstanceId, userId, unified]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // FASE 1: busca a transferencia confirmada do lead aberto (so no modo Conversas e leads do Pedro).
  // Marcos nao passa pela IA -> sem transferencia -> sem marcacao.
  useEffect(() => {
    if (!unified || !selectedLead || selectedLead.origem === 'marcos') { setTransferInfo(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from('ai_lead_transfers')
        .select('confirmed_at, to_member_id')
        .eq('lead_id', selectedLead.id)
        .eq('is_confirmed', true)
        .not('confirmed_at', 'is', null)
        .order('confirmed_at', { ascending: true })
        .limit(1);
      if (cancelled) return;
      const row = (data || [])[0];
      setTransferInfo(row ? { at: row.confirmed_at as string, toMemberId: (row.to_member_id as string) || null } : null);
    })();
    return () => { cancelled = true; };
  }, [unified, selectedLead?.id, selectedLead?.origem]);

  // Modelo B: resolve o numero (instancia conectada) do vendedor atribuido ao lead aberto,
  // pra o envio manual sair do numero dele. So no modo Conversas.
  useEffect(() => {
    const memberId = selectedLead?.assigned_to_id;
    if (!unified || !memberId) { setSellerSendInstanceId(null); setSellerInstanceLoaded(false); return; }
    let cancelled = false;
    setSellerInstanceLoaded(false);
    (async () => {
      const { data } = await (supabase as any)
        .from('wa_instances')
        .select('id')
        .eq('seller_member_id', memberId)
        .eq('status', 'connected')
        .limit(1);
      if (cancelled) return;
      setSellerSendInstanceId((data && data[0]?.id) || null);
      setSellerInstanceLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [unified, selectedLead?.id, selectedLead?.assigned_to_id]);

  useEffect(() => {
    const recoverable = messages.filter(msg => {
      const mt = (msg.message_type || '').toLowerCase();
      const isMedia = mt === 'image' || mt === 'audio' || mt === 'ptt' || mt === 'voice' || mt === 'video' || mt === 'document' || mt === 'file';
      return isMedia
        && msg.remote_message_id
        && !msgHasRenderableMedia(msg)
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
    // Modelo B (Conversas): follow-up do lead do Pedro sai do numero do PROPRIO vendedor quando
    // ele tem instancia conectada. Marcos ja resolve pela instancia das mensagens dele.
    if (unified && selectedLead.origem !== 'marcos' && sellerSendInstanceId) {
      return sellerSendInstanceId;
    }
    const agentForLead = agents.find(a => a.id === selectedLead.agent_id);
    return selectedLead.instance_id
      || [...messages].reverse().find(m => m.instance_id)?.instance_id
      || agentForLead?.instance_id
      || agentForLead?.instance_ids?.[0]
      || null;
  };

  /* ── Modo Conversas (unified): vendedor assume o controle ─────────────
     Ao responder por aqui num lead do Pedro que ainda estava com a IA ativa,
     pausa a IA silenciosamente pra ela nao responder por cima do vendedor.
     Marcos nao tem IA -> no-op. Reversivel na aba do Pedro. */
  const ensureManualControlUnified = async () => {
    if (!unified || !selectedLead) return;
    if (selectedLead.origem === 'marcos') return;
    if (selectedLead.ai_paused) return;
    const { error } = await supabase
      .from('ai_crm_leads')
      .update({ ai_paused: true })
      .eq('id', selectedLead.id);
    if (!error) {
      setLeads(prev => prev.map(l => (l.id === selectedLead.id ? { ...l, ai_paused: true } : l)));
      setSelectedLead(prev => (prev ? { ...prev, ai_paused: true } : prev));
    }
  };

  /* ── Enviar resposta manual ──────────────────────────────────────── */
  const handleSend = async () => {
    if (!replyText.trim() || !selectedLead || sending) return;
    if (!unified && !selectedLead.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return;
    }
    if (unified) await ensureManualControlUnified();
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
    if (!unified && !selectedLead.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return false;
    }
    if (unified) await ensureManualControlUnified();
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
    if (!unified && !selectedLead?.ai_paused) {
      toast({
        title: 'Pause a IA primeiro',
        description: 'Assim o agente nao responde junto com voce nesta conversa.',
        variant: 'destructive',
      });
      return;
    }
    if (unified) await ensureManualControlUnified();
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
    if (unified && originFilter !== 'all' && (l.origem || 'pedro') !== originFilter) return false;
    if (arrivalDateFilter && dateInputValue(leadArrivalIso(l)) !== arrivalDateFilter) return false;
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

  if (agents.length === 0 && !unified) {
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
  // Mapa member_id -> nome do vendedor, pra mostrar quem atende cada lead no card (so master).
  const sellerNameById = new Map<string, string>();
  for (const s of sellers) for (const id of s.memberIds) sellerNameById.set(id, s.name);
  // FASE 1: limite temporal da transferencia e nome do vendedor que recebeu, pro divisor da timeline.
  const transferAtMs = transferInfo ? new Date(transferInfo.at).getTime() : null;
  const transferSellerName = transferInfo?.toMemberId ? (sellerNameById.get(transferInfo.toMemberId) || null) : null;
  const selectedAssignedSeller = selectedLead?.assigned_to_id ? (sellerNameById.get(selectedLead.assigned_to_id) || null) : null;
  // Metrica de tempo ate o 1o contato: do OK (confirmed_at) ate a 1a mensagem ENVIADA depois dele.
  const firstPostIdx = transferAtMs != null ? messages.findIndex(m => new Date(m.created_at).getTime() >= transferAtMs) : -1;
  const firstContactMsg = transferAtMs != null ? messages.find(m => m.direction === 'outgoing' && new Date(m.created_at).getTime() >= transferAtMs) : null;
  const firstContactMs = firstContactMsg ? new Date(firstContactMsg.created_at).getTime() : null;
  const handoffDelayMs = transferAtMs == null ? null : (firstContactMs != null ? firstContactMs - transferAtMs : Date.now() - transferAtMs);
  const handoffColor = handoffDelayMs == null ? '' : handoffDelayMs <= 15 * 60000 ? 'text-emerald-300' : handoffDelayMs <= 60 * 60000 ? 'text-amber-300' : 'text-red-300';
  const selectedLeadTags = selectedLead
    ? (contactTags[cleanPhone(selectedLead.remote_jid)] || contactTags[phoneCanonical(selectedLead.remote_jid)] || [])
    : [];
  const zoomClasses = {
    sm: { bubble: 'text-[13.5px]', input: 'text-sm', media: 'max-w-[240px] max-h-[260px]' },
    md: { bubble: 'text-[14.5px]', input: 'text-sm', media: 'max-w-[300px] max-h-[320px]' },
    lg: { bubble: 'text-[15.5px]', input: 'text-base', media: 'max-w-[360px] max-h-[390px]' },
  }[chatZoom];
  const shellClass = chatExpanded
    ? 'fixed inset-3 md:inset-6 z-50 flex flex-col h-auto bg-card rounded-2xl border border-border/70 overflow-hidden shadow-2xl'
    : unified
      ? 'flex h-full min-h-0 flex-col overflow-hidden bg-[#0b141a] sm:border-y sm:border-[#1f2c34]'
      : 'flex flex-col h-[calc(100vh-210px)] bg-card rounded-xl border border-border/50 overflow-hidden';
  const handoffCard = (transferAtMs != null && transferInfo) ? (
    <div className="flex justify-center my-3">
      <div className="max-w-[88%] text-center bg-[#182229] rounded-xl px-4 py-2.5 shadow-sm border border-white/5">
        <p className="text-[11px] text-[#8696a0] flex items-center justify-center gap-1.5">
          <ArrowRight className="h-3 w-3" /> Transferido{transferSellerName ? ` para ${transferSellerName}` : ''}
        </p>
        <p className="text-[11px] text-emerald-300/90 mt-1 flex items-center justify-center gap-1">
          <CheckCheck className="h-3 w-3" /> Vendedor confirmou (OK) · {format(new Date(transferInfo.at), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </p>
        {firstContactMs != null ? (
          <p className={`text-[11px] mt-0.5 font-semibold ${handoffColor}`}>
            1º contato do vendedor · {fmtDur(handoffDelayMs as number)} depois do OK
          </p>
        ) : (sellerInstanceLoaded && !sellerSendInstanceId) ? (
          <p className="text-[11px] mt-0.5 text-amber-200/80">
            Número do vendedor não conectado à Logos — o 1º contato dele não aparece aqui
          </p>
        ) : (
          <p className={`text-[11px] mt-0.5 font-semibold ${handoffColor}`}>
            Aguardando 1º contato · {fmtDur(handoffDelayMs as number)} desde o OK
          </p>
        )}
      </div>
    </div>
  ) : null;

  /* ── RENDER ──────────────────────────────────────────────────────── */
  return (
    <div className={shellClass}>
      {/* ── Top Bar: Seletor de Agente (Pedro) / titulo Conversas (unified) ── */}
      <div className={`${unified ? 'hidden' : 'flex'} items-center gap-3 px-4 py-3 border-b border-border/50 bg-muted/30`}>
        {unified ? (
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground">Conversas</span>
          </div>
        ) : (
          <>
            <Bot className="h-5 w-5 text-violet-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <Select value={selectedAgentId} onValueChange={v => { setSelectedAgentId(v); setSelectedLead(null); }}>
                <SelectTrigger className="h-9 text-sm w-full max-w-[300px]">
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
          </>
        )}
        {!isSeller && sellers.length > 0 && (
          <Select value={sellerFilter} onValueChange={v => { setSellerFilter(v); setSelectedLead(null); }}>
            <SelectTrigger className="h-9 text-sm w-[200px] shrink-0" title="Acompanhar as conversas de um vendedor">
              <SelectValue placeholder="Vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SELLERS} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                  Todos os vendedores
                </span>
              </SelectItem>
              {sellers.map(s => (
                <SelectItem key={s.key} value={s.key} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px] shrink-0">
          {arrivalDateFilter ? `${filteredLeads.length}/${leads.length}` : leads.length} conversa{leads.length !== 1 ? 's' : ''}
        </Badge>
        {unified && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setSidebarCompact(v => !v)} title={sidebarCompact ? 'Aumentar lista lateral' : 'Diminuir lista lateral'}>
              {sidebarCompact ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setChatZoom(z => z === 'lg' ? 'md' : z === 'md' ? 'sm' : 'sm')} disabled={chatZoom === 'sm'} title="Diminuir zoom do chat">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setChatZoom(z => z === 'sm' ? 'md' : z === 'md' ? 'lg' : 'lg')} disabled={chatZoom === 'lg'} title="Aumentar zoom do chat">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setChatExpanded(v => !v)} title={chatExpanded ? 'Sair do modo tela cheia' : 'Expandir conversas'}>
              {chatExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>

      <div ref={paneRef} className="flex flex-1 overflow-hidden">
        {/* ── Painel Esquerdo: Lista de Conversas ── */}
        <div
          className={`${selectedLead ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-[380px] border-r border-border/40 ${unified ? 'min-h-0 md:!w-[var(--conv-lw)] shrink-0 bg-[#111b21]' : ''}`}
          style={unified ? ({ ['--conv-lw']: `${sidebarCompact ? Math.min(listW, 300) : listW}px` } as any) : undefined}
        >
          {unified && (
            <div className="border-b border-[#1f2c34] bg-[#0f1722] px-3 py-3 sm:px-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-[#e9edef]">Conversas</h2>
                  <p className="mt-0.5 text-[11px] text-[#8696a0] md:hidden">Toque em um lead para atender</p>
                </div>
                <Badge className="shrink-0 border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                  {arrivalDateFilter ? `${filteredLeads.length}/${leads.length}` : leads.length} conversas
                </Badge>
              </div>
              {!isSeller && sellers.length > 0 && (
                <Select value={sellerFilter} onValueChange={v => { setSellerFilter(v); setSelectedLead(null); }}>
                  <SelectTrigger className="mt-3 h-9 w-full rounded-xl border-[#243241] bg-[#0b111d] text-sm text-[#d1d7db]">
                    <SelectValue placeholder="Todos os vendedores" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SELLERS} className="text-xs">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                        Todos os vendedores
                      </span>
                    </SelectItem>
                    {sellers.map(s => (
                      <SelectItem key={s.key} value={s.key} className="text-xs">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {/* Search */}
          <div className={`${unified ? 'border-b border-[#1f2c34] bg-[#0f1722] p-2.5 sm:p-3' : 'p-3 border-b border-border/30'}`}>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou telefone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className={`${unified ? 'h-10 rounded-xl border-[#243241] bg-[#0a0f1a] pl-10 text-sm text-[#e9edef] placeholder:text-[#8696a0]' : 'h-9 pl-9 text-sm'}`}
              />
            </div>
            {unified && (
              <div className="mobile-tabs-scroll mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {([['all', 'Todos'], ['pedro', 'Pedro'], ['marcos', 'Marcos']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => { setOriginFilter(val); setSelectedLead(null); }}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      originFilter === val
                        ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                        : 'border-border/50 text-muted-foreground hover:bg-accent/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-border/60 bg-background px-2.5 py-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">Chegou em</span>
                <Input
                  type="date"
                  value={arrivalDateFilter}
                  onChange={e => setArrivalDateFilter(e.target.value)}
                  className="h-7 min-w-0 border-0 bg-transparent p-0 text-xs focus-visible:ring-0"
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
                const phone = cleanPhone(lead.remote_jid);
                const profilePicture = leadProfilePictures[phone] || leadProfilePictures[phoneCanonical(phone)] || null;
                const tags = contactTags[phone] || contactTags[phoneCanonical(phone)] || [];
                return (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`w-full text-left px-3 py-3.5 border-b transition-colors sm:px-4 ${
                      unified
                        ? `border-[#1f2c34] hover:bg-[#17212b] ${isSelected ? 'bg-[#182536] border-l-2 border-l-[#3f5cff]' : 'border-l-2 border-l-transparent'}`
                        : `border-border/20 hover:bg-accent/40 ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : ''}`
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className={`${unified ? 'h-12 w-12' : 'h-11 w-11'} shrink-0 ring-1 ring-white/5`}>
                        {profilePicture && (
                          <AvatarImage
                            src={profilePicture}
                            alt={lead.lead_name || lead.remote_jid}
                            className="object-cover"
                          />
                        )}
                        <AvatarFallback className={`text-xs font-bold ${
                          unified
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : lead.ai_paused
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                        }`}>
                          {initials(lead.lead_name, lead.remote_jid)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`${unified ? 'text-[15px] text-[#f4f6f8]' : 'text-[15px] text-foreground'} font-semibold truncate`}>
                            {lead.lead_name || lead.remote_jid}
                          </p>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {lead.last_interaction_at ? fmtTime(lead.last_interaction_at) : ''}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <p className={`${unified ? 'text-[13px] text-[#aebac1]' : 'text-xs text-muted-foreground'} min-w-0 flex-1 truncate`}>
                            {lead.summary ? lead.summary.replace(/\r?\n|\r/g, ' ') : displayPhone(lead.remote_jid)}
                          </p>
                          {lead.message_count > 0 && (
                            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">
                              {lead.message_count}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${st.color}`}>
                            {st.label}
                          </span>
                          {unified ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                              {lead.origem === 'marcos' ? 'Marcos' : 'Pedro'}
                            </span>
                          ) : lead.ai_paused ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 flex items-center gap-0.5">
                              <Pause className="h-2.5 w-2.5" /> Manual
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 flex items-center gap-0.5">
                              <Bot className="h-2.5 w-2.5" /> IA
                            </span>
                          )}
                          {unified && !isSeller && lead.assigned_to_id && sellerNameById.get(lead.assigned_to_id) && (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary flex items-center gap-0.5">
                              <User className="h-2.5 w-2.5" /> {sellerNameById.get(lead.assigned_to_id)}
                            </span>
                          )}
                          {tags.slice(0, 1).map(tag => (
                            <TagBadge key={tag} name={tag} color="#7c3aed" size="sm" />
                          ))}
                          {tags.length > 1 && (
                            <span className="text-[10px] text-muted-foreground">+{tags.length - 1}</span>
                          )}
                        </div>
                        {!unified && <p className="text-[11px] text-muted-foreground mt-1">
                          Chegou: {formatArrivalDate(leadArrivalIso(lead))}
                        </p>}
                        {!unified && lead.summary && (
                          <p className="text-xs text-muted-foreground mt-1 truncate block whitespace-nowrap overflow-hidden text-ellipsis w-full" title={lead.summary}>
                            {lead.summary.replace(/\r?\n|\r/g, ' ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </ScrollArea>
        </div>

        {/* Divisor arrastavel (estilo WhatsApp) — so no modo Conversas, desktop */}
        {unified && (
          <div
            onMouseDown={startListDrag}
            className="hidden md:flex w-1.5 cursor-col-resize items-center justify-center shrink-0 group"
            title="Arraste para ajustar a largura"
          >
            <div className="h-8 w-[3px] rounded-full bg-transparent group-hover:bg-primary/50 transition-colors" />
          </div>
        )}

        {/* ── Painel Direito: Chat ── */}
        <div className={`${selectedLead ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          {!selectedLead ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground">
              {unified ? (
                <MessageCircle className="h-16 w-16 opacity-20 mb-4" />
              ) : (
                <Bot className="h-16 w-16 opacity-20 mb-4" />
              )}
              <p className="text-sm font-medium">{unified ? 'Conversas' : 'Conversas IA'}</p>
              <p className="text-xs mt-1">Selecione uma conversa para visualizar</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className={`${unified ? 'bg-[#111b21] border-[#1f2c34] px-2.5 py-2.5 sm:px-5 sm:py-3' : 'bg-muted/20 border-border/50 px-4 py-3'} flex items-center gap-2.5 border-b sm:gap-3`}>
                <Button
                  variant="ghost" size="sm"
                  className="h-8 w-8 p-0 md:hidden"
                  onClick={() => setSelectedLead(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>

                <Avatar className="h-10 w-10 shrink-0 ring-1 ring-white/5 sm:h-11 sm:w-11">
                  {(leadProfilePictures[cleanPhone(selectedLead.remote_jid)] || leadProfilePictures[phoneCanonical(selectedLead.remote_jid)]) && (
                    <AvatarImage
                      src={leadProfilePictures[cleanPhone(selectedLead.remote_jid)] || leadProfilePictures[phoneCanonical(selectedLead.remote_jid)]}
                      alt={selectedLead.lead_name || selectedLead.remote_jid}
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback className={`text-xs font-bold ${
                    unified
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : selectedLead.ai_paused
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
                  }`}>
                    {initials(selectedLead.lead_name, selectedLead.remote_jid)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className={`${unified ? 'text-[15px] text-[#f4f6f8] sm:text-[16px]' : 'text-base'} font-semibold truncate`}>{selectedLead.lead_name || selectedLead.remote_jid}</p>
                  <p className={`${unified ? 'text-[11px] text-[#aebac1] sm:text-[12px]' : 'text-xs text-muted-foreground'} flex min-w-0 items-center gap-1 truncate`}>
                    <Phone className="h-2.5 w-2.5" />
                    {displayPhone(selectedLead.remote_jid)}
                    {unified && (
                      <>
                        <span className="mx-1 hidden text-[#3a4650] sm:inline">|</span>
                        <span className="hidden items-center gap-1 text-emerald-400 sm:inline-flex">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online
                        </span>
                      </>
                    )}
                    <span className="mx-1 hidden text-[#3a4650] sm:inline">|</span>
                    <span className="truncate">{selectedAssignedSeller ? `Vendedor: ${selectedAssignedSeller}` : `${selectedLead.message_count ?? 0} msgs`}</span>
                  </p>
                  {selectedLeadTags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selectedLeadTags.slice(0, 4).map(tag => (
                        <TagBadge key={tag} name={tag} color="#7c3aed" size="sm" />
                      ))}
                      {selectedLeadTags.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{selectedLeadTags.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Pause / Resume button — so no inbox do Pedro; escondido no modo Conversas e em consulta */}
                {unified && (
                  <TagSelector
                    selectedTags={selectedLeadTags}
                    onTagsChange={(tags) => updateLeadTags(selectedLead, tags)}
                    trigger={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 w-9 shrink-0 rounded-full border-[#2a3942] bg-transparent p-0 text-[#aebac1] hover:bg-[#202c33] hover:text-[#e9edef]"
                        disabled={syncingLabels}
                        title="Adicionar etiqueta na Logos e no WhatsApp"
                      >
                        {syncingLabels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                      </Button>
                    }
                  />
                )}
                {unified && (
                  <>
                    <Button type="button" variant="ghost" size="icon" className="hidden h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#202c33] hover:text-[#e9edef] md:inline-flex" title="Buscar na conversa">
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="hidden h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#202c33] hover:text-[#e9edef] md:inline-flex" title="Abrir no WhatsApp">
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="hidden h-9 w-9 rounded-full text-[#aebac1] hover:bg-[#202c33] hover:text-[#e9edef] md:inline-flex" onClick={() => setChatExpanded(v => !v)} title={chatExpanded ? 'Sair do modo tela cheia' : 'Expandir conversa'}>
                      {chatExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  </>
                )}

                {!unified && (readOnly ? (
                  <Badge variant="outline" className="h-8 px-3 text-xs gap-1.5 shrink-0 border-border/60 text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" />
                    Somente leitura
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant={selectedLead.ai_paused ? 'default' : 'outline'}
                    className={`h-9 text-sm gap-1.5 shrink-0 ${
                      selectedLead.ai_paused
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                    }`}
                    onClick={() => handleTogglePause(selectedLead)}
                    disabled={togglingPause}
                  >
                    {togglingPause ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : selectedLead.ai_paused ? (
                      <>
                        <Play className="h-4 w-4" />
                        Reativar IA
                      </>
                    ) : (
                      <>
                        <Pause className="h-4 w-4" />
                        Pausar IA
                      </>
                    )}
                  </Button>
                ))}
              </div>

              {/* AI status banner */}
              {!unified && !readOnly && selectedLead.ai_paused && (
                <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
                  <Pause className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">
                    <strong>IA pausada</strong> — Voce esta no controle manual. O agente IA nao vai responder nesta conversa ate voce reativar.
                  </p>
                </div>
              )}

              {/* Messages */}
              <ScrollArea
                className={`${unified ? 'bg-[#0b141a] px-2.5 py-3 sm:px-5 lg:px-8 lg:py-4' : 'bg-[#0b141a] px-4 py-3'} flex-1`}
                style={unified ? {
                  backgroundImage:
                    'radial-gradient(circle at 12px 12px, rgba(134,150,160,0.11) 1.2px, transparent 1.4px), linear-gradient(180deg, rgba(11,20,26,0.96), rgba(11,20,26,0.96))',
                  backgroundSize: '32px 32px, auto',
                } : undefined}
              >
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
                    {messages.map((msg, idx) => {
                      const isOutgoing = msg.direction === 'outgoing';
                      // FASE 1: fase da IA = mensagens ANTES da transferencia confirmada.
                      const curIa = transferAtMs != null && new Date(msg.created_at).getTime() < transferAtMs;
                      const showIaHeader = transferAtMs != null && idx === 0 && curIa;
                      // Cartao de handoff antes da 1a mensagem pos-transferencia.
                      const showHandoff = transferAtMs != null && idx === firstPostIdx;
                      const album = (msg.media_list || []).filter(m => isRenderableMedia(m?.file || m?.url));
                      const mt = msg.message_type;
                      const isAudio = mt === 'audio' || mt === 'ptt' || mt === 'voice';
                      const isDoc = mt === 'document' || mt === 'file';
                      const isMediaType = mt !== 'text' && mt !== '';
                      const mainOk = isRenderableMedia(msg.media_url);
                      const isResolvingMedia = resolvingMediaIds.has(msg.id);
                      // Mídia presente mas não-renderizável (ex.: URL .enc do WhatsApp).
                      const mediaUnavailable = isMediaType && album.length === 0 && !mainOk && !isDoc;
                      const caption = displayText(msg.content);
                      return (
                        <Fragment key={msg.id}>
                          {showIaHeader && (
                            <div className="flex justify-center my-2">
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-200/90 bg-[#2a2340] px-3 py-1 rounded-full shadow-sm">
                                <Bot className="h-3 w-3 text-violet-300" /> Atendimento IA — qualificação
                              </span>
                            </div>
                          )}
                          {showHandoff && handoffCard}
                        <div data-media-resolving={isResolvingMedia || undefined} className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
                          <div className={`${unified ? 'max-w-[88%] rounded-2xl px-3.5 py-2.5 sm:max-w-[76%] sm:px-4 lg:max-w-[68%]' : 'max-w-[78%] rounded-lg px-3 py-2'} ${zoomClasses.bubble} leading-relaxed shadow-md ${
                            isOutgoing
                              ? (curIa ? 'bg-[#4a3f6b] text-[#e9edef] rounded-tr-sm' : 'bg-[#075e54] text-[#e9edef] rounded-tr-sm')
                              : (curIa ? 'bg-[#241f33] text-[#e9edef] rounded-tl-sm border border-violet-500/20' : 'bg-[#202c33] text-[#e9edef] rounded-tl-sm border border-white/5')
                          }`}>
                            {album.length > 0 ? (
                              <div className={`grid ${album.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 mb-2 max-w-[min(76vw,360px)]`}>
                                {album.map((m: any, idx: number) => {
                                  const url = m.file || m.url;
                                  return (
                                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className={`overflow-hidden rounded-xl block aspect-square border border-border/30 bg-muted/20 ${zoomClasses.media}`}>
                                      <img src={url} alt="" loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform duration-200" />
                                    </a>
                                  );
                                })}
                              </div>
                            ) : (
                              mainOk && mt === 'image' && (
                                <a href={msg.media_url!} target="_blank" rel="noopener noreferrer">
                                  <img src={msg.media_url!} alt="" loading="lazy" className={`max-w-full rounded-xl mb-2 object-cover ${zoomClasses.media}`} />
                                </a>
                              )
                            )}
                            {mainOk && isAudio && (
                              <audio controls src={msg.media_url!} className={`mb-1.5 w-full min-w-[210px] accent-[#00a884] sm:min-w-[240px] ${chatZoom === 'lg' ? 'sm:min-w-[300px]' : ''}`} />
                            )}
                            {mainOk && mt === 'video' && (
                              <video controls src={msg.media_url!} className={`max-w-full rounded-xl mb-2 ${zoomClasses.media}`} />
                            )}
                            {mainOk && isDoc && (
                              <a
                                href={msg.media_url!}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2.5 rounded-xl bg-background/60 px-3 py-2.5 mb-1.5 hover:bg-background/80 transition-colors"
                              >
                                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                                <span className="text-sm truncate flex-1">{caption || 'Arquivo'}</span>
                                <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </a>
                            )}
                            {mediaUnavailable && (
                              <span className="inline-flex items-center gap-1.5 rounded-lg bg-background/50 px-2.5 py-1.5 mb-1.5 text-xs text-muted-foreground">
                                {isResolvingMedia ? 'Recuperando midia...' : (MEDIA_PLACEHOLDER[mt] || 'Midia recebida')}
                              </span>
                            )}
                            {caption && !isDoc && (
                              <p className="whitespace-pre-wrap break-words">{caption}</p>
                            )}
                            <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${
                              isOutgoing ? 'text-[#d1f4e5]/65 justify-end' : 'text-[#8696a0]'
                            }`}>
                              {fmtTime(msg.created_at)}
                              {isOutgoing && <CheckCheck className="h-3 w-3" />}
                            </p>
                          </div>
                        </div>
                        </Fragment>
                      );
                    })}
                    {transferAtMs != null && firstPostIdx === -1 && handoffCard}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </ScrollArea>

              {/* Rodapé somente-leitura (consulta do vendedor) */}
              {readOnly && (
                <div className="px-4 py-3 border-t border-border/50 bg-muted/20 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Eye className="h-3.5 w-3.5" />
                  Somente leitura — consulta da conversa
                </div>
              )}

              {/* Reply input */}
              {!readOnly && (
              <div className={`${unified ? 'border-[#1f2c34] bg-[#111b21] px-2.5 py-2.5 sm:px-5 sm:py-4' : 'border-border/50 bg-muted/20 px-4 py-3'} border-t`}>
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
                          className={`resize-none border-0 bg-transparent p-0 ${zoomClasses.input} focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto`}
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
                    <div className="flex items-end gap-2 sm:gap-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`${unified ? 'h-10 w-10 rounded-full text-[#aebac1] hover:bg-[#202c33] hover:text-[#e9edef] sm:h-11 sm:w-11' : 'h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground'} p-0 shrink-0`}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={(!unified && !selectedLead.ai_paused) || uploadingMedia}
                        title="Anexar arquivo"
                    >
                      {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    </Button>
                    <div className={`${unified ? 'rounded-2xl border-[#243241] bg-[#0b111d] px-3 py-2.5 shadow-inner sm:px-4 sm:py-3' : 'rounded-xl border-border/50 bg-background px-3 py-2'} flex-1 border`}>
                      <Textarea
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                          unified ? 'Digite uma mensagem'
                          : selectedLead.ai_paused ? 'Digite sua resposta manual...'
                          : 'Pause a IA para responder manualmente...'
                        }
                        disabled={!unified && !selectedLead.ai_paused}
                        rows={1}
                        className={`resize-none border-0 bg-transparent p-0 ${zoomClasses.input} focus-visible:ring-0 min-h-0 max-h-32 leading-relaxed overflow-y-auto`}
                      />
                    </div>
                    {replyText.trim() ? (
                      <Button
                        size="sm"
                        className={`${unified ? 'h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#06cf9c] sm:h-11 sm:w-11' : 'h-9 w-9 rounded-xl bg-primary hover:bg-primary/90'} p-0 shrink-0`}
                        onClick={handleSend}
                        disabled={(!unified && !selectedLead.ai_paused) || sending}
                      >
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className={`${unified ? 'h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#06cf9c] sm:h-11 sm:w-11' : 'h-9 w-9 rounded-xl bg-primary hover:bg-primary/90'} p-0 shrink-0`}
                        onClick={startRecording}
                        disabled={(!unified && !selectedLead.ai_paused) || uploadingMedia}
                        title="Gravar audio"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                {!unified && !selectedLead.ai_paused && (
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
