// ============================================================================
// DashboardTV
// ----------------------------------------------------------------------------
// Dashboard comercial em tempo real pra projetar em TV (fullscreen F11).
// Mostra produção do dia agregando leads do Pedro (ai_crm_leads) +
// Marcos (crm_leads) por vendedor e por origem.
//
// Regras de agregação (spec 27/05/2026 Bug 1: 5 colunas, OLX e Outros removidos):
//   • TRÁFEGO PAGO = ai_crm_leads com assigned_to_id IS NOT NULL
//   • PORTA        = crm_leads WHERE origem='porta'
//   • MARKETPLACE  = crm_leads WHERE origem='marketplace'
//   • CONSIGNADO   = crm_leads WHERE origem='consignado'
//   • INDICAÇÃO    = crm_leads WHERE origem='indicacao'
// Leads com origem='olx', 'outros', 'instagram' ou NULL são IGNORADOS.
//
// Período: apenas leads do dia atual (created_at >= 00:00 local).
// Atualização: polling a cada 30s + relógio digital atualiza a cada 1s.
// Permissão: APENAS master (vendedor redirecionado pra /dashboard).
// Branding: usa colunas profiles.dashboard_tv_* (configurável na Etapa 3).
//
// Layout inspirado em painel ICOM Motors — mas marca/cores customizáveis.
// ============================================================================

import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithReauth } from '@/lib/invokeWithReauth';
import { Calendar, Clock, DollarSign, Loader2, Target, DoorOpen, ShoppingBag, Globe, Users, Phone, Trophy, Maximize2, Minimize2, RefreshCw, Tag, Instagram, Inbox, ChevronUp, ChevronDown, ListOrdered } from 'lucide-react';
import { CplComparativo } from '@/components/pedro/CplComparativo';
import { toast } from 'sonner';

// ─── Types ─────────────────────────────────────────────────────────────────

interface VendedorData {
  id: string;
  name: string;
  /** Foto exibida no card. Prioridade: profiles.avatar_url (vendedor) > ai_team_members.profile_picture (master) > null (fallback iniciais). */
  effective_avatar: string | null;
  rank: number;
  // Spec 27/05/2026 Bug 1: removidas OLX e Outros do painel. Tipos mantidos
  // como propriedades obrigatórias do agg pra simplicidade.
  // MELHORIA 1 (29/05/2026): + Redes Sociais → 6 colunas:
  // Tráfego Pago / Porta / Marketplace / Consignado / Indicação / Redes Sociais.
  trafico_pago: number;
  porta: number;
  marketplace: number;
  consignado: number;
  indicacao: number;
  redes_sociais: number;
  /** Vendas concluídas do vendedor no período (lead movido pra etapa
   *  "Venda concluída" no CRM do Pedro/Marcos). NÃO entra no `total` de
   *  leads — é um resultado, não uma origem. */
  venda_concluida: number;
  /** Leads que o vendedor ASSUMIU no período via transferência/resgate
   *  (ai_lead_transfers). São re-atribuições — NÃO contam como tráfego pago
   *  novo nem entram no `total`. Indicador informativo separado. */
  repassados: number;
  /** Contagem por COLUNA do Kanban do Marcos (chave = nome da coluna). Origens
   *  dinâmicas: o painel reflete as colunas configuradas no Marcos. Tráfego Pago
   *  (Pedro) e Venda concluída (resultado) seguem em campos próprios. */
  por_coluna: Record<string, number>;
  total: number;
}

/** Uma coluna/origem do Marcos exibida no painel (vem das stages do Kanban). */
interface ColunaOrigem { key: string; label: string; color: string; }

interface KPIsData {
  total_leads: number;
  /** Leads contados no total_leads que NÃO estão atribuídos a nenhum vendedor.
   *  Não aparecem em vendedor específico, mas precisam aparecer no KPI total
   *  pra TV refletir TUDO que foi cadastrado no dia. */
  nao_atribuidos: number;
  por_origem: Record<string, number>;
  percentuais: Record<string, number>;
  /** Colunas/origens DINÂMICAS (do Kanban do Marcos) exibidas no painel, na
   *  ordem das stages. Não inclui Tráfego Pago nem Venda concluída (fixos). */
  colunas: ColunaOrigem[];
  /** 0-100 — média ponderada IA(50%) + Feedback(30%) + Notas(20%) */
  qualidade_media: number;
  qualidade_label: 'Ótimo' | 'Bom' | 'Médio' | 'Baixo' | 'Sem dados';
  /** % de leads Pedro que foram transferidos pra vendedor humano */
  taxa_transferencia: number;
  taxa_transferencia_texto: string; // "32 de 44 leads"
  total_spend: number;
  custo_por_lead: number;
  /** Resultado que o Meta MOSTRA no período (conversas/leads do anúncio). */
  meta_total: number;
  /** Custo por lead segundo o Painel do Meta = gasto ÷ meta_total. */
  custo_por_lead_meta: number;
  /** Vendas concluídas no MÊS CORRENTE (não acompanha o filtro de período —
   *  é sempre o mês atual, ex.: 3 de 30). */
  vendas_mes: number;
  /** Meta de vendas do mês corrente (loja, ou individual se vendedor logado). */
  meta_mes: number;
}

interface LeadNaoTransferido {
  id: string;
  nome: string;
  telefone: string;
  remote_jid: string | null;
  agent_id: string | null;
}

// ─── Cálculo de qualidade do lead (50% IA + 30% Feedback + 20% Notas) ────────

/** Score 0-100 baseado em status_crm do Pedro */
function scorePedroStatus(status: string | null | undefined): number {
  if (!status) return 0;
  const map: Record<string, number> = {
    qualificado: 100, medio_qualificado: 70, pouco_qualificado: 40,
    transferido: 100, em_atendimento: 50, novo: 20, inativo: 0,
    fechado: 100, perdido: 0,
  };
  return map[status] ?? 20;
}

/** Score 0-100 baseado no nome da stage do Marcos */
function scoreMarcosStage(stageName: string | null | undefined): number {
  if (!stageName) return 0;
  const n = stageName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const map: Record<string, number> = {
    'fechado': 100, 'venda concluida': 100, 'negociacao': 85, 'agendamento': 60, 'porta/loja': 30,
    'marketing place': 20, 'leads inativos': 0, 'nao tem no estoque': 0, 'leads perdidos': 0,
    // legados (caso ainda exista em algum master)
    'novo lead': 20, 'proposta': 75, 'qualificado': 80, 'perdido': 0,
    'lead inativo': 0, 'carro nao disponivel': 0, 'porta': 30,
  };
  return map[n] ?? 20;
}

/** Score 0-100 baseado em priority do pedro_manager_feedback */
function scoreFeedbackPriority(priority: string | null | undefined): number {
  if (!priority) return 0;
  const map: Record<string, number> = {
    urgent: 100, high: 75, normal: 50, low: 25,
  };
  return map[priority] ?? 0;
}

/** Score 0-100 baseado em quantidade de notas do vendedor */
function scoreNotasCount(count: number | null | undefined): number {
  const c = count || 0;
  if (c >= 3) return 100;
  if (c >= 1) return 60;
  return 0;
}

/** Combina os 3 scores com pesos 50% / 30% / 20% */
function combineLeadScore(iaScore: number, fbScore: number | null, notesScore: number): number {
  // Se NÃO tiver feedback, redistribui os 30% pros outros 2 (IA 70% + Notas 30%)
  if (fbScore === null) {
    return Math.round((iaScore * 0.7) + (notesScore * 0.3));
  }
  return Math.round((iaScore * 0.5) + (fbScore * 0.3) + (notesScore * 0.2));
}

function qualidadeLabel(score: number, hasData: boolean): KPIsData['qualidade_label'] {
  if (!hasData) return 'Sem dados';
  if (score >= 80) return 'Ótimo';
  if (score >= 60) return 'Bom';
  if (score >= 40) return 'Médio';
  return 'Baixo';
}

interface BrandingConfig {
  logo_url: string | null;
  company_name: string;
  primary_color: string;
  secondary_color: string;
}

// ─── Config visual das origens (ordem da imagem ICOM) ───────────────────────

// Spec 27/05/2026 Bug 1: colunas Trafego Pago / Porta / Marketplace /
// Consignado / Indicacao. OLX e Outros removidos.
// MELHORIA 1 (29/05/2026): + Redes Sociais ao final (ícone Instagram, rosa).
const ORIGENS = [
  { key: 'trafico_pago',  label: 'Tráfego Pago', icon: Target,      color: '#3b82f6' },
  { key: 'porta',         label: 'Porta',        icon: DoorOpen,    color: '#f59e0b' },
  { key: 'marketplace',   label: 'Marketplace',  icon: Globe,       color: '#a855f7' },
  { key: 'consignado',    label: 'Consignado',   icon: Phone,       color: '#06b6d4' },
  { key: 'indicacao',     label: 'Indicação',    icon: Users,       color: '#fb923c' },
  { key: 'redes_sociais', label: 'Redes Sociais', icon: Instagram,  color: '#ec4899' },
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashColor(id: string): string {
  // Hash determinístico: mesmo vendedor sempre tem mesma cor de avatar
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
  return colors[Math.abs(h) % colors.length];
}

// ─── Filtros de período ─────────────────────────────────────────────────────

type PeriodPreset = 'today' | 'yesterday' | '7days' | '30days' | 'custom';

interface CustomRange {
  start: string; // YYYY-MM-DD (date input format)
  end: string;
}

const PERIOD_STORAGE_KEY = 'dashboard_tv_period';

/** Retorna { start, end } em ISO baseado no preset e range custom */
function resolveDateRange(preset: PeriodPreset, custom: CustomRange): { start: string; end: string; label: string } {
  const now = new Date();
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Hoje' };
  }
  if (preset === 'yesterday') {
    const s = new Date(now); s.setDate(s.getDate() - 1); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setDate(e.getDate() - 1); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Ontem' };
  }
  if (preset === '7days') {
    const s = new Date(now); s.setDate(s.getDate() - 6); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 7 dias' };
  }
  if (preset === '30days') {
    const s = new Date(now); s.setDate(s.getDate() - 29); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { start: s.toISOString(), end: e.toISOString(), label: 'Últimos 30 dias' };
  }
  // custom
  const s = custom.start ? new Date(custom.start + 'T00:00:00') : new Date(now.setHours(0,0,0,0));
  const e = custom.end   ? new Date(custom.end   + 'T23:59:59.999') : new Date(now.setHours(23,59,59,999));
  return { start: s.toISOString(), end: e.toISOString(), label: 'Personalizado' };
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatPhone(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  const br = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (br.length === 11) return `(${br.slice(0, 2)}) ${br.slice(2, 7)}-${br.slice(7)}`;
  if (br.length === 10) return `(${br.slice(0, 2)}) ${br.slice(2, 6)}-${br.slice(6)}`;
  return br || 'Sem telefone';
}

function isoToDateKey(iso: string): string {
  return toDateInput(new Date(iso));
}

const RANK_COLORS: Record<number, string> = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7f32' };
function rankColor(rank: number): string {
  return RANK_COLORS[rank] || '#475569';
}

// ─── Componente principal ───────────────────────────────────────────────────

interface DashboardTVProps {
  /** Quando true, renderiza sem min-h-screen pra caber dentro de outra página (ex: tab do Pedro SDR). */
  embedded?: boolean;
}

export default function DashboardTV({ embedded = false }: DashboardTVProps = {}) {
  const { user } = useAuth();
  const { isSeller, seller, masterUserId, loading: profileLoading } = useSellerProfile(user?.id);
  const navigate = useNavigate();

  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [vendedores, setVendedores] = useState<VendedorData[]>([]);
  const [kpis, setKpis] = useState<KPIsData | null>(null);
  const [leadsNaoTransferidos, setLeadsNaoTransferidos] = useState<LeadNaoTransferido[]>([]);
  const [branding, setBranding] = useState<BrandingConfig>({
    logo_url: null,
    company_name: 'Painel Comercial',
    primary_color: '#3b82f6',
    secondary_color: '#f59e0b',
  });

  // Bolsão (Fase 2): leads sem dono que o gestor atribui no painel.
  const [poolLeads, setPoolLeads] = useState<Array<{ id: string; lead_name: string | null; remote_jid: string | null; status_crm: string | null; vehicle_interest: string | null; created_at: string; repasse_motivo: string | null }>>([]);
  const [poolPick, setPoolPick] = useState<Record<string, string>>({}); // lead_id -> vendedor escolhido
  const [assigningPoolId, setAssigningPoolId] = useState<string | null>(null);

  // Filtro de período (persistido em localStorage)
  const [period, setPeriod] = useState<PeriodPreset>(() => {
    try {
      const saved = localStorage.getItem(PERIOD_STORAGE_KEY) as PeriodPreset | null;
      return saved && ['today','yesterday','7days','30days','custom'].includes(saved) ? saved : 'today';
    } catch { return 'today'; }
  });
  const [customRange, setCustomRange] = useState<CustomRange>(() => {
    const today = new Date();
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    return { start: toDateInput(weekAgo), end: toDateInput(today) };
  });

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref do "canvas" do painel (modo TV/tela cheia).
  const contentRef = useRef<HTMLDivElement>(null);

  // Trigger pra refresh manual (incrementa = força reload)
  const [reloadTrigger, setReloadTrigger] = useState(0);

  // Edição da meta de vendas do mês (só master) direto no KPI "Vendas / Meta".
  const [metaEditing, setMetaEditing] = useState(false);
  const [metaDraft, setMetaDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);

  // Vendedores ativos (com last_lead_received_at) pro rodízio do clique-pra-transferir.
  const [queueSellers, setQueueSellers] = useState<any[]>([]);
  // Reordenação manual da fila (master): edita a ordem -> reescreve last_lead_received_at.
  const [editingQueue, setEditingQueue] = useState(false);
  const [queueOrder, setQueueOrder] = useState<any[]>([]);
  const [savingQueue, setSavingQueue] = useState(false);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  // Tick incrementado a cada evento realtime/poll — passado pros componentes
  // filhos (ex.: card Real vs Falso) re-buscarem junto, sem re-assinar o canal.
  const [liveTick, setLiveTick] = useState(0);

  // Tamanho da tela — pra ESCALAR o painel inteiro e caber 100% em tela cheia,
  // respeitando os formatos: 1920×1080 (deitado) / 1080×1920 (em pé/totem).
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1920,
    h: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onResize);
    };
  }, []);

  // ZOOM estilo navegador (modo TV/tela cheia) — escala o painel inteiro pra
  // CABER na tela. `auto` calcula o zoom ideal pela altura da tela; `manual` usa
  // o que o usuário definiu no slider. Tudo salvo no localStorage, então o ajuste
  // persiste quando a TV reinicia ou a página atualiza.
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem('dashtv_zoom') || '');
      return v >= 0.4 && v <= 2.5 ? v : 1;
    } catch { return 1; }
  });
  const [zoomMode, setZoomMode] = useState<'auto' | 'manual'>(() => {
    try { return localStorage.getItem('dashtv_zoom_mode') === 'manual' ? 'manual' : 'auto'; }
    catch { return 'auto'; }
  });
  useEffect(() => { try { localStorage.setItem('dashtv_zoom', String(zoom)); } catch { /* ignore */ } }, [zoom]);
  useEffect(() => { try { localStorage.setItem('dashtv_zoom_mode', zoomMode); } catch { /* ignore */ } }, [zoomMode]);

  // Orientação da TV (manual): 'landscape' (deitada) ou 'portrait' (em pé/totem).
  // Botão no controle de zoom. Persiste por dispositivo no localStorage, então a TV
  // lembra o formato. Em retrato o painel reflui em coluna e é enquadrado numa moldura
  // vertical 9:16; o auto-fit encaixa tudo na altura (nada fica de fora).
  // Vale pro TV (/dashboard-tv) E pro embutido (/painel-ao-vivo da sidebar), com
  // chaves SEPARADAS no localStorage (um não muda o outro).
  const orientKey = embedded ? 'dashtv_orientation_embed' : 'dashtv_orientation';
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(() => {
    try { return localStorage.getItem(embedded ? 'dashtv_orientation_embed' : 'dashtv_orientation') === 'portrait' ? 'portrait' : 'landscape'; }
    catch { return 'landscape'; }
  });
  useEffect(() => { try { localStorage.setItem(orientKey, orientation); } catch { /* ignore */ } }, [orientation, orientKey]);
  const isPortrait = orientation === 'portrait';
  // Altura natural (sem escala) do conteúdo — dimensiona a área de rolagem (altura
  // visual = contentH*zoom/zoomEmbed). A barra aparece quando o conteúdo passa da
  // tela, sem rolar pra espaço vazio. availH = altura útil do container embutido.
  const [contentH, setContentH] = useState(0);
  const [availH, setAvailH] = useState(0);

  // Zoom do modo EMBUTIDO (aba do Pedro). Separado do TV pra um não atropelar o
  // outro (o TV tem auto-fit; o embutido é manual). Default 100% = sem mudança.
  const [zoomEmbed, setZoomEmbed] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('dashtv_zoom_embed') || ''); return v >= 0.4 && v <= 2.5 ? v : 1; }
    catch { return 1; }
  });
  useEffect(() => { try { localStorage.setItem('dashtv_zoom_embed', String(zoomEmbed)); } catch { /* ignore */ } }, [zoomEmbed]);
  // Modo do zoom embutido: 'auto' = encaixa na altura da área (igual TV); 'manual'
  // = o que o usuário definir no controle. Default 'auto'.
  const [zoomEmbedMode, setZoomEmbedMode] = useState<'auto' | 'manual'>(() => {
    try { return localStorage.getItem('dashtv_zoom_embed_mode') === 'manual' ? 'manual' : 'auto'; }
    catch { return 'auto'; }
  });
  useEffect(() => { try { localStorage.setItem('dashtv_zoom_embed_mode', zoomEmbedMode); } catch { /* ignore */ } }, [zoomEmbedMode]);

  // Auto-ajuste: mede a altura real do painel e calcula o zoom que faz tudo caber
  // na altura da tela (a largura já é preenchida via width:100/zoom%). Converge em
  // poucos quadros e para quando estabiliza (guard de 0.012). Só roda no modo auto.
  useLayoutEffect(() => {
    if (embedded || zoomMode !== 'auto') return;
    const el = contentRef.current;
    if (!el) return;
    const fit = () => {
      const h = el.scrollHeight;
      if (!h) return;
      const ideal = Math.max(0.4, Math.min(2.5, (viewport.h * 0.99) / h));
      setZoom(prev => (Math.abs(prev - ideal) > 0.012 ? ideal : prev));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, zoomMode, viewport, profileLoading, loading, kpis, liveTick, orientation]);

  // Mede a altura natural do conteúdo (sem escala) p/ dimensionar a área de rolagem.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, orientation, zoom, zoomEmbed, viewport, profileLoading, loading, kpis, liveTick]);

  // Mede a altura útil do container EMBUTIDO (p/ a moldura 9:16 do retrato).
  useLayoutEffect(() => {
    if (!embedded) return;
    const cont = containerRef.current;
    if (!cont) return;
    const m = () => setAvailH(cont.clientHeight);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(cont);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, orientation, viewport, profileLoading, loading, kpis, liveTick]);

  // Auto-fit do modo EMBUTIDO (Painel ao Vivo na sidebar): encaixa o conteúdo na
  // ALTURA da área disponível (o container limitado pelo MainLayout). Mede a
  // altura real do conteúdo (transform:scale não afeta o layout) vs a do container.
  useLayoutEffect(() => {
    if (!embedded || zoomEmbedMode !== 'auto') return;
    const cont = containerRef.current;
    const el = contentRef.current;
    if (!cont || !el) return;
    const fit = () => {
      const avail = cont.clientHeight;
      const h = el.scrollHeight;
      if (!avail || !h) return;
      const ideal = Math.max(0.4, Math.min(1.5, (avail * 0.995) / h));
      setZoomEmbed(prev => (Math.abs(prev - ideal) > 0.012 ? ideal : prev));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    ro.observe(cont);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, zoomEmbedMode, viewport, profileLoading, loading, kpis, liveTick]);

  // Controle de zoom some sozinho: aparece quando o mouse mexe na tela e
  // desaparece após 5s de mouse parado (pra não atrapalhar a visualização na TV).
  const [controlsVisible, setControlsVisible] = useState(true);
  useEffect(() => {
    // Vale pro TV e pro embutido (Painel ao Vivo): o controle de zoom só aparece
    // quando o mouse mexe e some após 5s parado.
    let timer: number | undefined;
    const show = () => {
      setControlsVisible(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 5000);
    };
    window.addEventListener('mousemove', show);
    show(); // começa visível e já agenda o sumiço
    return () => {
      window.removeEventListener('mousemove', show);
      if (timer) window.clearTimeout(timer);
    };
  }, []);


  // Persiste período escolhido
  useEffect(() => {
    try { localStorage.setItem(PERIOD_STORAGE_KEY, period); } catch {}
  }, [period]);

  // Listener pra mudanças no fullscreen (ex: ESC sai do fullscreen)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('[DashboardTV] Fullscreen falhou:', err);
    }
  }, []);

  // Relógio digital ao vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Decisão de escopo (master vs vendedor):
  //   master:  effectiveUserId = user.id        | sellerMemberId = null  (vê tudo)
  //   seller:  effectiveUserId = masterUserId   | sellerMemberId = seller.id (vê só ele)
  const effectiveUserId = isSeller ? masterUserId : user?.id;
  const sellerMemberId = isSeller ? seller?.id || null : null;

  // Calcula range atual (usado tanto na query quanto no label da toolbar)
  const dateRange = resolveDateRange(period, customRange);

  // Carregar dados (1ª vez + polling 30s + realtime + manual refresh)
  useEffect(() => {
    if (!user?.id || profileLoading || !effectiveUserId) return;

    let cancelled = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        // Usa range do filtro atual (hoje/7d/30d/custom)
        const todayStart = dateRange.start;
        // Mês corrente (KPI Vendas/Meta NÃO acompanha o filtro — é sempre o mês atual).
        const nowD = new Date();
        const monthStartKey = toDateInput(new Date(nowD.getFullYear(), nowD.getMonth(), 1));
        const monthEndKey   = toDateInput(new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0));
        const todayEnd = dateRange.end;
        // Chaves YYYY-MM-DD do período (pro "Venda concluída" por vendedor) e o
        // range que cobre período + mês corrente (uma só query de vendas).
        const periodStartKey = isoToDateKey(todayStart);
        const periodEndKey   = isoToDateKey(todayEnd);
        const vendasStartKey = periodStartKey < monthStartKey ? periodStartKey : monthStartKey;
        const vendasEndKey   = periodEndKey   > monthEndKey   ? periodEndKey   : monthEndKey;

        // 1. Branding sempre do MASTER (mesmo pra vendedor logado vê branding do master dele)
        const profilePromise = (supabase as any)
          .from('profiles')
          .select('dashboard_tv_logo_url, dashboard_tv_company_name, dashboard_tv_primary_color, dashboard_tv_secondary_color, full_name, company_name')
          .eq('id', effectiveUserId)
          .maybeSingle();

        // 2. Vendedores ativos do master.
        //    Se for vendedor logado, filtra só ele próprio (member_id == seller.id).
        // select('*') + filtro client-side por active_in_system (ativo NO SISTEMA),
        // não pelo status do agente de IA. select('*') evita quebra se a migration
        // ainda não rodou; o filtro active_in_system !== false é aplicado abaixo.
        let sellersQuery = (supabase as any)
          .from('ai_team_members')
          .select('*')
          .eq('user_id', effectiveUserId);
        if (sellerMemberId) sellersQuery = sellersQuery.eq('id', sellerMemberId);

        // 3. Leads Pedro do período. +status_crm +seller_notes_count pra cálculo de qualidade.
        //    Pra "Taxa Transferência" precisamos contar TODOS leads Pedro (com e sem assigned_to_id).
        let pedroQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, lead_name, remote_jid, agent_id, assigned_to_id, status_crm, seller_notes_count')
          .eq('user_id', effectiveUserId)
          // Periodo pela DATA REAL DE CHEGADA: arrived_at quando o vendedor informou
          // (lead de porta/dia passado), senao created_at.
          .or(`and(arrived_at.gte.${todayStart},arrived_at.lte.${todayEnd}),and(arrived_at.is.null,created_at.gte.${todayStart},created_at.lte.${todayEnd})`);
        if (sellerMemberId) pedroQuery = pedroQuery.eq('assigned_to_id', sellerMemberId);
        // (sem filtro 'assigned_to_id not null' — preciso do total pra taxa)

        // 4. Leads Marcos do período. +stage_id + JOIN com stages pra nome.
        // FIX 28/05/2026: removida coluna `seller_notes_count` que NAO existe
        // em crm_leads (so existe em ai_crm_leads do Pedro). A query inteira
        // estava falhando silenciosamente, fazendo todo Painel mostrar 0 leads
        // do Marcos desde sempre. Bug exposto pelo banner de debug.
        let marcosQuery = (supabase as any)
          .from('crm_leads')
          .select('id, origem, assigned_to, stage_id, arrived_at, created_at, stage:crm_pipeline_stages(name, color, position, tipo)')
          .eq('user_id', effectiveUserId)
          // Periodo pela DATA REAL DE CHEGADA (arrived_at) quando informada, senao created_at.
          .or(`and(arrived_at.gte.${todayStart},arrived_at.lte.${todayEnd}),and(arrived_at.is.null,created_at.gte.${todayStart},created_at.lte.${todayEnd})`);
        if (sellerMemberId) marcosQuery = marcosQuery.eq('assigned_to', sellerMemberId);

        // IMPORTANTE: busca SÓ o nível 'campaign'. Os três níveis (campaign/adset/ad)
        // carregam o MESMO total do anúncio, mas 'ad' tem milhares de linhas e o
        // Supabase corta em 1000 por padrão — então somar "todos os níveis" trazia
        // valor INCOMPLETO em períodos longos (30 dias). Campaign tem poucas linhas
        // e o total completo (gasto + conversas + leads do Meta).
        let costsQuery = (supabase as any)
          .from('campaign_costs')
          .select('entity_level, spend, leads_meta, conversations_started, date')
          .eq('user_id', effectiveUserId)
          .eq('entity_level', 'campaign')
          .gte('date', isoToDateKey(todayStart))
          .lte('date', isoToDateKey(todayEnd));

        // 6. Vendas concluídas (comercial_vendas) — cobre período + mês corrente.
        //    Se vendedor logado, só as dele. (Cada lead "Venda concluída" no CRM
        //    vira 1 linha aqui via gatilho; lançamentos manuais também entram.)
        let vendasQuery = (supabase as any)
          .from('comercial_vendas')
          .select('seller_id, data_venda')
          .eq('user_id', effectiveUserId)
          .gte('data_venda', vendasStartKey)
          .lte('data_venda', vendasEndKey);
        if (sellerMemberId) vendasQuery = vendasQuery.eq('seller_id', sellerMemberId);

        // 7. Metas do mês corrente (loja + individuais).
        const metasQuery = (supabase as any)
          .from('comercial_metas')
          .select('seller_id, tipo, valor_meta')
          .eq('user_id', effectiveUserId)
          .eq('mes_referencia', monthStartKey);

        // 8. Repasses recebidos no período: leads que o vendedor ASSUMIU via
        //    REPASSE (saída de outro vendedor / resgate de lead preso) e que foram
        //    CONFIRMADOS. NÃO é tráfego pago novo nem transferência comum do rodízio
        //    — é re-atribuição. Indicador informativo, separado da contagem de origem.
        const REPASSE_REASONS = ['repasse_pedro', 'repasse_marcos', 'repasse_tf', 'repasse_nao_confirmado', 'orphan_rescue'];
        let transfersQuery = (supabase as any)
          .from('ai_lead_transfers')
          .select('to_member_id, lead_id, created_at')
          .eq('user_id', effectiveUserId)
          .eq('is_confirmed', true)
          .in('transfer_reason', REPASSE_REASONS)
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd);
        if (sellerMemberId) transfersQuery = transfersQuery.eq('to_member_id', sellerMemberId);

        // Leads do Pedro que foram assumidos/confirmados no período também precisam
        // entrar no Painel ao Vivo, mesmo quando o lead original nasceu ontem.
        // Sem isso, um lead qualificado no dia anterior e aceito hoje pelo vendedor
        // fica invisível na TV porque a query principal filtra por arrived_at/created_at.
        let confirmedPedroTransfersQuery = (supabase as any)
          .from('ai_lead_transfers')
          .select('to_member_id, lead_id, created_at, confirmed_at')
          .eq('user_id', effectiveUserId)
          .eq('is_confirmed', true)
          .gte('created_at', todayStart)
          .lte('created_at', todayEnd);
        if (sellerMemberId) confirmedPedroTransfersQuery = confirmedPedroTransfersQuery.eq('to_member_id', sellerMemberId);

        // Bolsão (Fase 2): leads sem dono, disponíveis pra o gestor atribuir.
        // No modo vendedor a RLS devolve vazio (a seção só aparece pro master).
        const poolQuery = (supabase as any)
          .from('ai_crm_leads')
          .select('id, lead_name, remote_jid, status_crm, vehicle_interest, created_at, repasse_motivo')
          .eq('user_id', effectiveUserId)
          .eq('disponivel_repasse', true)
          .order('created_at', { ascending: false })
          .limit(50);

        // Agentes da conta (pra mostrar a fila do rodízio POR AGENTE).
        const agentsQuery = (supabase as any)
          .from('wa_ai_agents').select('id, name, is_active').eq('user_id', effectiveUserId);

        // Colunas CONFIGURADAS do Kanban do Marcos = origens do painel. Vêm da
        // TABELA (não dos leads), então aparecem SEMPRE — mesmo com 0 lead no
        // período. Cada conta monta as colunas como quiser; o painel espelha.
        const stagesQuery = (supabase as any)
          .from('crm_pipeline_stages')
          .select('id, name, color, position, tipo, ativo, show_in_live')
          .eq('user_id', effectiveUserId)
          // Painel ao Vivo é a TV COMPARTILHADA da conta: só origens de nível conta
          // (seller_auth_id null). Coluna privada de vendedor nunca aparece aqui.
          .is('seller_auth_id', null)
          .order('position', { ascending: true });

        const [profileRes, sellersRes, pedroRes, marcosRes, costsRes, vendasRes, metasRes, transfersRes, confirmedPedroTransfersRes, poolRes, agentsRes, stagesRes] = await Promise.all([
          profilePromise, sellersQuery, pedroQuery, marcosQuery, costsQuery, vendasQuery, metasQuery, transfersQuery, confirmedPedroTransfersQuery, poolQuery, agentsQuery, stagesQuery,
        ]);
        if (!cancelled) setPoolLeads((poolRes?.data as any[]) || []);
        if (!cancelled) setAgentsList((agentsRes?.data as any[]) || []);

        if (cancelled) return;


        // 1. Branding (com fallbacks razoáveis)
        const p = profileRes.data || {};
        setBranding({
          logo_url: p.dashboard_tv_logo_url || null,
          company_name: p.dashboard_tv_company_name || p.company_name || p.full_name || 'Painel Comercial',
          primary_color: p.dashboard_tv_primary_color || '#3b82f6',
          secondary_color: p.dashboard_tv_secondary_color || '#f59e0b',
        });

        // 2. Carrega avatar_url do profile DE CADA VENDEDOR (prioridade > profile_picture do master)
        // Ativos NO SISTEMA (visibilidade no painel) — independe do status no agente de IA.
        // Painel ao Vivo: precisa estar ATIVO NO SISTEMA (active_in_system) E marcado
        // pra aparecer aqui (show_in_live, campo dedicado). O Gerente tem show_in_live=false
        // por padrão -> some do painel sem perder o acesso. Controlado na tela de Responsáveis.
        const sellersList = ((sellersRes.data || []) as any[]).filter((s: any) => s.active_in_system !== false && s.show_in_live !== false) as Array<{ id: string; name: string; profile_picture: string | null; auth_user_id: string | null }>;
        // Fila do rodízio do botão "Transferir (próximo da fila)": SÓ vendedores
        // ATIVOS NO AGENTE DE IA (is_active=true) — igual ao rodízio AUTOMÁTICO do
        // Pedro (transferRouter / uazapi-webhook / bulk-transfer). Diferente dos
        // CARDS, que mostram todos os ativos no sistema. Assim o botão nunca passa
        // lead pra quem está pausado no agente. Só no master (sem sellerMemberId).
        if (!sellerMemberId) {
          setQueueSellers((sellersList as any[]).filter((s: any) => s.is_active === true));
        }
        const authIds = sellersList.map(s => s.auth_user_id).filter((x): x is string => !!x);
        const profileAvatarMap = new Map<string, string>();
        if (authIds.length > 0) {
          const { data: avatarRows } = await (supabase as any)
            .from('profiles')
            .select('id, avatar_url')
            .in('id', authIds);
          for (const r of (avatarRows || []) as Array<{ id: string; avatar_url: string | null }>) {
            if (r.avatar_url) profileAvatarMap.set(r.id, r.avatar_url);
          }
        }

        // 3. Inicializa agregador por vendedor com avatar resolvido
        const agg: Record<string, VendedorData> = {};
        for (const s of sellersList) {
          const effectiveAvatar =
            (s.auth_user_id && profileAvatarMap.get(s.auth_user_id)) ||
            s.profile_picture ||
            null;
          agg[s.id] = {
            id: s.id, name: s.name, effective_avatar: effectiveAvatar, rank: 0,
            trafico_pago: 0, porta: 0, marketplace: 0, consignado: 0, indicacao: 0, redes_sociais: 0, venda_concluida: 0, repassados: 0, por_coluna: {}, total: 0,
          };
        }

        // Spec 27/05/2026 Bug integração Marcos: cria uma row virtual "Sem
        // vendedor" pros leads com assigned_to=NULL (Marcos importados em
        // planilha sem vendedor, ou criados pelo master sem auto-atribuir).
        // Sem isso esses leads cairiam em naoAtribuidos++ (subtexto invisível)
        // e nunca apareceriam no breakdown por origem. Filtrada do ranking
        // mais abaixo se ficar com total=0.
        const NAO_ATRIBUIDO_ID = '__nao_atribuido__';
        agg[NAO_ATRIBUIDO_ID] = {
          id: NAO_ATRIBUIDO_ID, name: 'Sem vendedor atribuído', effective_avatar: null, rank: 0,
          trafico_pago: 0, porta: 0, marketplace: 0, consignado: 0, indicacao: 0, redes_sociais: 0, venda_concluida: 0, repassados: 0, por_coluna: {}, total: 0,
        };

        // 4. Pedro: contar trafico_pago (precisa de assigned_to_id) E coletar dados pra qualidade/taxa
        const confirmedPedroTransferRows = (confirmedPedroTransfersRes?.data || []) as Array<{
          to_member_id: string | null; lead_id: string | null; created_at: string | null; confirmed_at: string | null;
        }>;
        const transferAssigneeByLead = new Map<string, string>();
        for (const tr of confirmedPedroTransferRows) {
          if (tr.lead_id && tr.to_member_id) transferAssigneeByLead.set(tr.lead_id, tr.to_member_id);
        }

        let pedroLeads = (pedroRes.data || []) as Array<{
          id: string; lead_name: string | null; remote_jid: string | null; agent_id: string | null; assigned_to_id: string | null; status_crm: string | null; seller_notes_count: number | null;
        }>;
        const pedroLeadIds = pedroLeads.map(l => l.id);
        // ────────────────────────────────────────────────────────────────────
        // REGRA DEFINITIVA (dono) — "TRÁFEGO PAGO" CONTA O LEAD UMA ÚNICA VEZ:
        // na 1ª ENTRADA dele na Logos (arrived_at/created_at DENTRO do período —
        // já filtrado pela pedroQuery). Lead TRANSFERIDO/REPASSADO (vendedor saiu,
        // re-atribuição, resgate de órfão, etc.) JÁ ESTÁ na Logos e NUNCA reconta
        // como tráfego pago novo — senão infla o Painel ao Vivo e derruba o custo
        // por lead das campanhas.
        //
        // POR ISSO NÃO PUXAMOS lead por EVENTO de transferência pra dentro da
        // contagem (`pedroLeads`). Este trecho existia e era a causa do bug: puxava
        // os leads de `confirmedPedroTransfersQuery` que a pedroQuery não pegou
        // (justamente por já serem antigos) e os somava como novos. REMOVIDO.
        //
        // ⚠️ NÃO reintroduzir um fetch de `ai_crm_leads` por `ai_lead_transfers`
        // aqui. Visibilidade de repasse tem seção própria (transfersRes) e não
        // pode virar contagem de tráfego pago. O mapa `transferAssigneeByLead`
        // (acima) permanece SÓ pra resolver o vendedor de um lead DO PERÍODO cujo
        // `assigned_to_id` ainda esteja null — nunca pra adicionar leads.
        // ────────────────────────────────────────────────────────────────────
        const pendingOrConfirmedTransferIds = new Set<string>();
        if (pedroLeadIds.length > 0) {
          const { data: transferRows } = await (supabase as any)
            .from('ai_lead_transfers')
            .select('lead_id, transfer_status')
            .in('lead_id', pedroLeadIds)
            .neq('transfer_status', 'expired');
          for (const row of (transferRows || []) as Array<{ lead_id: string | null }>) {
            if (row.lead_id) pendingOrConfirmedTransferIds.add(row.lead_id);
          }
        }
        const pedroNaoTransferidos: LeadNaoTransferido[] = [];
        let pedroTotal = 0;       // total leads Pedro no período (todos)
        let pedroAtribuidos = 0;  // leads Pedro com assigned_to_id != null
        let naoAtribuidos = 0;    // leads (Pedro+Marcos) que não foram pra vendedor — contam no total mas não no card de vendedor
        // pedroLeads = SÓ os leads do PERÍODO (pedroQuery por arrived_at/created_at).
        // Nenhum lead repassado/transferido entra aqui (ver regra acima), então
        // cada lead conta no máximo 1x como tráfego pago — na sua 1ª entrada.
        for (const l of pedroLeads) {
          pedroTotal++;
          const assignedToId = l.assigned_to_id || transferAssigneeByLead.get(l.id) || null;
          if (assignedToId) {
            pedroAtribuidos++;
            const v = agg[assignedToId];
            if (v) {
              v.trafico_pago++; v.total++;
            } else {
              // assigned_to_id aponta pra vendedor que sumiu — registra na row
              // virtual "Sem vendedor" pra aparecer no breakdown (Bug integração).
              agg[NAO_ATRIBUIDO_ID].trafico_pago++;
              agg[NAO_ATRIBUIDO_ID].total++;
              naoAtribuidos++;
            }
          } else if (!pendingOrConfirmedTransferIds.has(l.id)) {
            // Lead Pedro novo, ainda sem transfer. Tecnicamente não conta como
            // "Tráfego Pago" (já que essa categoria precisa de assigned_to_id),
            // mas pra visibilidade aparece no total da row "Sem vendedor".
            agg[NAO_ATRIBUIDO_ID].total++;
            naoAtribuidos++;
            pedroNaoTransferidos.push({
              id: l.id,
              nome: l.lead_name || formatPhone(l.remote_jid),
              telefone: formatPhone(l.remote_jid),
              remote_jid: l.remote_jid,
              agent_id: l.agent_id,
            });
          } else {
            agg[NAO_ATRIBUIDO_ID].total++;
            naoAtribuidos++;
          }
        }

        // 5. Marcos: agrupa por COLUNA do Kanban (crm_pipeline_stages) — DINÂMICO
        // (refactor 17/06/2026). As ORIGENS do painel = as colunas que o dono
        // configurou no Marcos (Configurações > Kanban Marcos). Qualquer coluna
        // conta; coluna removida some daqui. Tráfego Pago (Pedro) e Venda
        // concluída (resultado, de comercial_vendas) ficam FORA desta lista.
        const ORIGEM_PALETTE = ['#a855f7','#06b6d4','#fb923c','#ec4899','#84cc16','#eab308','#f97316','#14b8a6','#8b5cf6','#f43f5e'];
        const ORIGEM_FALLBACK_LABEL: Record<string,string> = {
          porta: 'Porta', marketplace: 'Marketplace', consignado: 'Consignado',
          indicacao: 'Indicação', redes_sociais: 'Redes Sociais',
        };
        // "Venda concluída" / etapa de saída não entra no MEIO — é resultado,
        // mostrado embaixo a partir de comercial_vendas.
        const isResultadoCol = (nome: string, tipo?: string | null) =>
          tipo === 'saida' || /venda\s*conclu/i.test(nome || '');
        // ORIGENS = COLUNAS CONFIGURADAS do Marcos (crm_pipeline_stages) que o dono
        // marcou pra aparecer no painel (show_in_live). Vêm da TABELA, então
        // aparecem SEMPRE — mesmo com 0 lead no período. Coluna removida/desmarcada
        // some daqui. (show_in_live ausente = true por default, não some nada.)
        const colunasOrigem: ColunaOrigem[] = ((stagesRes?.data || []) as any[])
          .filter((s) => s.ativo !== false && s.show_in_live !== false && !isResultadoCol(s.name, s.tipo))
          .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
          .map((s, i) => ({ key: String(s.name || '').trim(), label: String(s.name || '').trim(), color: s.color || ORIGEM_PALETTE[i % ORIGEM_PALETTE.length] }));
        const liveColSet = new Set(colunasOrigem.map((c) => c.key));
        const marcosLeads = (marcosRes.data || []) as Array<{
          id: string; origem: string | null; assigned_to: string | null; stage_id: string | null;
          stage: { name: string; color: string | null; position: number | null; tipo: string | null } | null;
        }>;
        for (const l of marcosLeads) {
          const v = agg[l.assigned_to || ''] || agg[NAO_ATRIBUIDO_ID];
          if (!l.assigned_to || !agg[l.assigned_to]) naoAtribuidos++;
          const stageName = (l.stage?.name || '').trim();
          // Conta SÓ nas colunas que o painel mostra (selecionadas pelo dono), pra
          // o total bater com a soma das linhas visíveis.
          let colName: string | null = null;
          if (stageName && liveColSet.has(stageName)) colName = stageName;
          else if (!stageName && l.origem && liveColSet.has(ORIGEM_FALLBACK_LABEL[l.origem] || '')) colName = ORIGEM_FALLBACK_LABEL[l.origem];
          if (colName) {
            v.por_coluna[colName] = (v.por_coluna[colName] || 0) + 1;
            v.total++;
          }
        }

        // 6. Busca feedbacks (priority) dos leads do período (Pedro + Marcos)
        //    Usado pra calcular o peso 30% da qualidade
        const allPedroIds  = pedroLeads.map(l => l.id);
        const allMarcosIds = marcosLeads.map(l => l.id);
        const feedbackByLead = new Map<string, string>(); // lead_id → priority (mais recente)
        if (allPedroIds.length > 0 || allMarcosIds.length > 0) {
          // Pedro: filter por lead_id IN
          if (allPedroIds.length > 0) {
            const { data: pedroFb } = await (supabase as any)
              .from('pedro_manager_feedback')
              .select('lead_id, priority, created_at')
              .in('lead_id', allPedroIds)
              .order('created_at', { ascending: false });
            for (const fb of (pedroFb || []) as Array<{ lead_id: string; priority: string }>) {
              if (!feedbackByLead.has(fb.lead_id)) feedbackByLead.set(fb.lead_id, fb.priority);
            }
          }
          // Marcos: filter por crm_lead_id IN
          if (allMarcosIds.length > 0) {
            const { data: marcosFb } = await (supabase as any)
              .from('pedro_manager_feedback')
              .select('crm_lead_id, priority, created_at')
              .in('crm_lead_id', allMarcosIds)
              .order('created_at', { ascending: false });
            for (const fb of (marcosFb || []) as Array<{ crm_lead_id: string; priority: string }>) {
              if (!feedbackByLead.has(fb.crm_lead_id)) feedbackByLead.set(fb.crm_lead_id, fb.priority);
            }
          }
        }

        // 7. Calcula score de qualidade de cada lead, depois média geral
        const scores: number[] = [];
        for (const l of pedroLeads) {
          const iaScore    = scorePedroStatus(l.status_crm);
          const fbPriority = feedbackByLead.get(l.id);
          const fbScore    = fbPriority ? scoreFeedbackPriority(fbPriority) : null;
          const notesScore = scoreNotasCount(l.seller_notes_count);
          scores.push(combineLeadScore(iaScore, fbScore, notesScore));
        }
        for (const l of marcosLeads) {
          const iaScore    = scoreMarcosStage(l.stage?.name);
          const fbPriority = feedbackByLead.get(l.id);
          const fbScore    = fbPriority ? scoreFeedbackPriority(fbPriority) : null;
          // seller_notes_count nao existe em crm_leads — passa null pra
          // calculo de qualidade nao quebrar.
          const notesScore = scoreNotasCount(null);
          scores.push(combineLeadScore(iaScore, fbScore, notesScore));
        }
        const qualidadeMedia = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;
        const qualidadeLbl = qualidadeLabel(qualidadeMedia, scores.length > 0);

        // 8. Taxa de Transferência (Pedro: leads atribuídos / total leads Pedro)
        const taxaTransf = pedroTotal > 0 ? Math.round((pedroAtribuidos / pedroTotal) * 1000) / 10 : 0;
        const taxaTransfTexto = `${pedroAtribuidos} de ${pedroTotal} leads do Pedro`;

        // 8.5. Comercial — vendas concluídas por vendedor (no PERÍODO) +
        //      "Vendas / Meta do mês" (sempre o MÊS CORRENTE, não segue o filtro).
        const vendasRows = (vendasRes?.data || []) as Array<{ seller_id: string | null; data_venda: string }>;
        let vendasMes = 0;
        for (const vd of vendasRows) {
          const dk = String(vd.data_venda).slice(0, 10);
          if (dk >= monthStartKey && dk <= monthEndKey) vendasMes++;
          if (dk >= periodStartKey && dk <= periodEndKey && vd.seller_id && agg[vd.seller_id]) {
            agg[vd.seller_id].venda_concluida++;
          }
        }
        const metasRows = (metasRes?.data || []) as Array<{ seller_id: string | null; tipo: string; valor_meta: number }>;
        let metaMes = 0;
        if (sellerMemberId) {
          const indi = metasRows.find(m => m.tipo === 'individual' && m.seller_id === sellerMemberId);
          metaMes = indi
            ? Number(indi.valor_meta) || 0
            : Number(metasRows.find(m => m.tipo === 'loja')?.valor_meta) || 0;
        } else {
          metaMes = Number(metasRows.find(m => m.tipo === 'loja' && !m.seller_id)?.valor_meta) || 0;
        }

        // 8.6. Repassados no período: leads DISTINTOS que cada vendedor assumiu via
        //      transferência/resgate (ai_lead_transfers). Re-atribuição, não tráfego pago.
        const transfersRows = (transfersRes?.data || []) as Array<{ to_member_id: string | null; lead_id: string | null }>;
        const repassadosPorVendedor = new Map<string, Set<string>>();
        for (const tr of transfersRows) {
          if (!tr.to_member_id || !tr.lead_id) continue;
          if (!repassadosPorVendedor.has(tr.to_member_id)) repassadosPorVendedor.set(tr.to_member_id, new Set());
          repassadosPorVendedor.get(tr.to_member_id)!.add(tr.lead_id);
        }
        for (const [sid, leadSet] of repassadosPorVendedor) {
          if (agg[sid]) agg[sid].repassados = leadSet.size;
        }

        // 9. Rank por total desc, tie-breaker alfabético.
        //    Spec usuario (30/05/2026): a row virtual "Sem vendedor atribuído"
        //    NUNCA aparece como card no ranking — nem quando tem leads. Leads sem
        //    vendedor (inclusive os de um vendedor EXCLUÍDO, cujos leads o painel
        //    desvincula) nao podem virar um card fantasma "Sem vendedor". Eles
        //    seguem contabilizados nos KPIs (Total + Origem) e no subtexto
        //    "(N sem vendedor atribuído)" — so nao ganham card proprio.
        // MATRIZ: o vendedor tem 1 linha por agente em ai_team_members → o agregador
        // teria 1 card por linha (vendedor EM DOBRO no ranking). Mescla por telefone,
        // somando os números (as linhas-fantasma vêm zeradas), e mantém 1 card por vendedor.
        const _pk = (n: any) => { const d = String(n || '').replace(/\D/g, ''); const l = d.slice(-10); return l.length === 10 ? l : l.slice(1); };
        const _phoneOf = new Map<string, string>();
        for (const s of sellersList) _phoneOf.set(s.id, _pk((s as any).whatsapp_number) || s.id);
        const _NUM: Array<keyof VendedorData> = ['trafico_pago','porta','marketplace','consignado','indicacao','redes_sociais','venda_concluida','repassados','total'];
        const _merged = new Map<string, VendedorData>();
        for (const v of Object.values(agg)) {
          if (v.id === NAO_ATRIBUIDO_ID) continue;
          const k = _phoneOf.get(v.id) || v.id;
          const cur = _merged.get(k);
          if (!cur) { _merged.set(k, { ...v, por_coluna: { ...v.por_coluna } }); continue; }
          for (const f of _NUM) (cur as any)[f] = ((cur as any)[f] || 0) + ((v as any)[f] || 0);
          for (const [c, n] of Object.entries(v.por_coluna || {})) (cur.por_coluna as any)[c] = ((cur.por_coluna as any)[c] || 0) + (n as number);
          if ((v.total || 0) > (cur.total || 0)) { cur.id = v.id; cur.name = v.name; cur.effective_avatar = v.effective_avatar; }
        }
        const sorted = Array.from(_merged.values())
          .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name))
          .map((v, i) => ({ ...v, rank: i + 1 }));
        setVendedores(sorted);

        // 10. KPIs gerais — 5 categorias visiveis. Spec 27/05/2026 Bug 1:
        //     OLX e Outros removidos. IMPORTANTE: os KPIs somam TODAS as rows
        //     (vendedores reais + virtual "Sem vendedor"), entao "Total de Leads"
        //     e "Origem dos Leads" continuam refletindo todos os leads mesmo
        //     agora que a row virtual saiu do ranking de cards (passo 9).
        const allRows = Object.values(agg); // reais + virtual "Sem vendedor"
        // Totais por origem = soma do por_coluna (dinâmico) de todas as rows.
        const porOrigem: Record<string, number> = {};
        for (const v of allRows) {
          for (const [c, n] of Object.entries(v.por_coluna)) {
            porOrigem[c] = (porOrigem[c] || 0) + n;
          }
        }
        // "Tráfego Pago" = TODOS os leads do Pedro (ai_crm_leads) no período:
        // atendidos pela IA + adicionados manual + transferidos. Inclui os ainda
        // NÃO atribuídos a vendedor. Assim bate com a contagem do CRM Avançado do
        // Pedro (que conta todos) e com o card "Real". Antes contava só atribuídos.
        porOrigem.trafico_pago = pedroTotal;
        // total_leads = soma dos v.total de todas as rows (vendedores reais
        // + virtual "Sem vendedor"). Sem duplo-contar: cada lead vai pra
        // exatamente uma row e incrementa apenas o v.total dela.
        const total = allRows.reduce((sum, v) => sum + v.total, 0);
        const percentuais: Record<string, number> = {};
        const baseParaPct = total > 0 ? total : 1;
        for (const k of Object.keys(porOrigem)) {
          percentuais[k] = Math.round((porOrigem[k] / baseParaPct) * 1000) / 10;
        }
        const costRows = Array.isArray(costsRes.data) ? costsRes.data : [];
        const costLevel = costRows.some((r: any) => r.entity_level === 'campaign')
          ? 'campaign'
          : costRows.some((r: any) => r.entity_level === 'adset')
            ? 'adset'
            : 'ad';
        const totalSpend = costRows
          .filter((r: any) => r.entity_level === costLevel)
          .reduce((sum: number, r: any) => sum + (Number(r.spend) || 0), 0);
        // Custo por Lead = gasto ÷ leads de TRÁFEGO PAGO (não todos os leads do
        // painel). Tráfego pago = leads do Pedro atribuídos (SDR + transferências
        // manuais + leads adicionados no Pedro). Não mistura porta/marketplace/etc.
        const custoPorLead = porOrigem.trafico_pago > 0 ? totalSpend / porOrigem.trafico_pago : 0;

        // Painel do Meta: resultado que o Facebook MOSTRA (conversas iniciadas,
        // senão leads do anúncio) e o custo por lead "de vitrine" do Meta.
        const metaOf = (r: any) => {
          const conv = Number(r.conversations_started) || 0;
          return conv > 0 ? conv : (Number(r.leads_meta) || 0);
        };
        const metaTotal = costRows
          .filter((r: any) => r.entity_level === costLevel)
          .reduce((sum: number, r: any) => sum + metaOf(r), 0);
        const custoPorLeadMeta = metaTotal > 0 ? totalSpend / metaTotal : 0;

        setLeadsNaoTransferidos(pedroNaoTransferidos);
        setKpis({
          total_leads: total,
          nao_atribuidos: naoAtribuidos,
          por_origem: porOrigem,
          percentuais,
          colunas: colunasOrigem,
          qualidade_media: qualidadeMedia,
          qualidade_label: qualidadeLbl,
          taxa_transferencia: taxaTransf,
          taxa_transferencia_texto: taxaTransfTexto,
          total_spend: totalSpend,
          custo_por_lead: custoPorLead,
          meta_total: metaTotal,
          custo_por_lead_meta: custoPorLeadMeta,
          vendas_mes: vendasMes,
          meta_mes: metaMes,
        });
        // Sincroniza os cards filhos (ex.: Real vs Falso) a cada reload —
        // mount, poll de 30s e realtime (lead novo) — sem re-assinar o canal.
        setLiveTick(t => t + 1);
      } catch (err) {
        console.error('[DashboardTV] erro ao carregar:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Reload com debounce (evita reload-storm quando vários eventos chegam em sequência)
    const debouncedReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { if (!cancelled) load(); }, 1000);
    };

    load();

    // Polling 30s como fallback (caso realtime caia)
    const pollT = setInterval(load, 30_000);

    // Realtime subscription: dispara reload sempre que algo muda em qualquer das 3 tabelas
    // (com debounce 1s pra agrupar bursts). Garante "ao vivo" sem esperar polling.
    const channel = supabase
      .channel(`dashboard-tv-${effectiveUserId}-${sellerMemberId || 'master'}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_team_members',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_crm_leads',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'ai_lead_transfers',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'campaign_costs',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'crm_leads',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'comercial_vendas',
        filter: `user_id=eq.${effectiveUserId}`,
      }, debouncedReload)
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(pollT);
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [user?.id, profileLoading, effectiveUserId, sellerMemberId, dateRange.start, dateRange.end, reloadTrigger]);

  // Refresh manual (botão na toolbar) — incrementa trigger pra forçar useEffect a rodar de novo
  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTrigger(t => t + 1);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // Salva a meta de vendas da LOJA do mês corrente (comercial_metas, tipo='loja').
  // Só master (RLS exige auth.uid()=user_id). Faz upsert manual: atualiza se já
  // existir a meta do mês, senão cria. Depois força reload pra refletir no KPI.
  const saveMeta = useCallback(async () => {
    const val = parseInt(metaDraft, 10);
    if (!Number.isFinite(val) || val < 0) {
      toast.error('Informe um número de vendas válido (ex.: 30).');
      return;
    }
    setSavingMeta(true);
    try {
      const now = new Date();
      const monthStartKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const { data: existing } = await (supabase as any)
        .from('comercial_metas')
        .select('id')
        .eq('user_id', effectiveUserId)
        .eq('tipo', 'loja')
        .eq('mes_referencia', monthStartKey)
        .maybeSingle();
      if (existing?.id) {
        const { error } = await (supabase as any)
          .from('comercial_metas').update({ valor_meta: val }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from('comercial_metas')
          .insert({ user_id: effectiveUserId, seller_id: null, tipo: 'loja', mes_referencia: monthStartKey, valor_meta: val });
        if (error) throw error;
      }
      setMetaEditing(false);
      setReloadTrigger(t => t + 1);
      toast.success('Meta do mês atualizada.');
    } catch (err) {
      console.error('[DashboardTV] erro ao salvar meta:', err);
      toast.error('Não consegui salvar a meta. Tente de novo.');
    } finally {
      setSavingMeta(false);
    }
  }, [metaDraft, effectiveUserId]);

  // ── Próximo vendedor da fila (rodízio): quem nunca recebeu primeiro, senão o
  // que recebeu há mais tempo. Espelha a lógica do CrmAoVivo/uazapi-webhook.
  const nextSeller = useMemo(() => {
    const list = (queueSellers || []) as any[];
    if (!list.length) return null;
    const never = list.filter(s => !s.last_lead_received_at);
    if (never.length) return never[0];
    return [...list].sort((a, b) =>
      new Date(a.last_lead_received_at).getTime() - new Date(b.last_lead_received_at).getTime()
    )[0] || null;
  }, [queueSellers]);

  // Próximo da fila POR AGENTE: cada agente (loja/número) tem sua própria fila entre
  // os vendedores ligados dele. 1 agente → 1 próximo; 2+ agentes → o próximo de cada.
  const nextSellerByAgent = useMemo(() => {
    const pickNext = (pool: any[]) => {
      if (!pool.length) return null;
      const never = pool.filter((s: any) => !s.last_lead_received_at);
      if (never.length) return never[0];
      return [...pool].sort((a: any, b: any) =>
        new Date(a.last_lead_received_at).getTime() - new Date(b.last_lead_received_at).getTime()
      )[0] || null;
    };
    const activeAgents = (agentsList || []).filter((a: any) => a.is_active !== false);
    if (activeAgents.length === 0) {
      // Sem lista de agentes: cai pro próximo único da conta.
      return nextSeller ? [{ agentId: null, agentName: '', seller: nextSeller }] : [];
    }
    return activeAgents.map((ag: any) => ({
      agentId: ag.id,
      agentName: ag.name,
      seller: pickNext((queueSellers || []).filter((s: any) => s.agent_id === ag.id)),
    }));
  }, [agentsList, queueSellers, nextSeller]);

  // Fila editável GERAL: vendedores ativos ÚNICOS (dedup por telefone — a matriz tem 1
  // linha por agente), na ordem atual do rodízio. Guarda os ids de cada pessoa (todas as
  // linhas dela) pra reescrever o "recebido por último" de TODAS ao salvar.
  const queueUnique = useMemo(() => {
    const byPhone = new Map<string, { name: string; ids: string[]; last: number | null }>();
    for (const s of (queueSellers || [])) {
      const key = String(s.whatsapp_number || '').replace(/\D/g, '') || `id:${s.id}`;
      const last = s.last_lead_received_at ? new Date(s.last_lead_received_at).getTime() : null;
      const cur = byPhone.get(key);
      if (cur) { cur.ids.push(s.id); if (last != null && (cur.last == null || last > cur.last)) cur.last = last; }
      else byPhone.set(key, { name: s.name, ids: [s.id], last });
    }
    return Array.from(byPhone.values()).sort((a, b) => {
      if (a.last == null && b.last != null) return -1;
      if (a.last != null && b.last == null) return 1;
      if (a.last == null && b.last == null) return 0;
      return (a.last as number) - (b.last as number);
    });
  }, [queueSellers]);

  const abrirEditarFila = () => { setQueueOrder([...queueUnique]); setEditingQueue(true); };
  const moverFila = (i: number, dir: -1 | 1) => setQueueOrder((prev) => {
    const arr = [...prev]; const j = i + dir;
    if (j < 0 || j >= arr.length) return arr;
    [arr[i], arr[j]] = [arr[j], arr[i]]; return arr;
  });
  const salvarFila = async () => {
    setSavingQueue(true);
    try {
      const now = Date.now(); const N = queueOrder.length;
      const ups: Promise<any>[] = [];
      queueOrder.forEach((p, i) => {
        const ts = new Date(now - (N - i) * 60000).toISOString(); // topo = mais antigo = próximo a receber
        for (const id of p.ids) ups.push((supabase as any).from('ai_team_members').update({ last_lead_received_at: ts }).eq('id', id));
      });
      await Promise.all(ups);
      setQueueSellers((prev: any[]) => prev.map((s: any) => {
        const idx = queueOrder.findIndex((p) => p.ids.includes(s.id));
        return idx >= 0 ? { ...s, last_lead_received_at: new Date(now - (N - idx) * 60000).toISOString() } : s;
      }));
      toast.success('Ordem da fila salva! O do topo recebe o próximo lead.');
      setEditingQueue(false);
    } catch { toast.error('Não consegui salvar a ordem agora.'); }
    finally { setSavingQueue(false); }
  };

  // Transfere o lead pro próximo da fila via manual-transfer (mesma função do
  // CRM). Confirma antes (envia WhatsApp real pro vendedor). Dedup de 30s no back.
  const handleTransferToNext = useCallback(async (lead: LeadNaoTransferido) => {
    const seller = nextSeller;
    if (!seller) { toast.warning('Nenhum vendedor ativo na fila pra receber.'); return; }
    const ok = window.confirm(`Transferir "${lead.nome}" para ${seller.name} (próximo da fila)?`);
    if (!ok) return;
    setTransferringId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke('manual-transfer', {
        body: {
          leadId: lead.id,
          memberId: seller.id,
          notes: '',
          remoteJid: lead.remote_jid,
          agentId: lead.agent_id,
          leadName: lead.nome,
          ownerUserId: effectiveUserId,
        },
      });
      if (error) {
        let message = error.message || 'Não foi possível transferir.';
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); message = b?.error || message; } catch { /* ignore */ } }
        throw new Error(message);
      }
      if ((data as any)?.deduplicated) {
        toast.info(`"${lead.nome}" já estava em transferência (clique recente).`);
      } else {
        toast.success(`"${lead.nome}" transferido para ${seller.name}.`, { description: 'Briefing enviado ao vendedor no WhatsApp.' });
      }
      setReloadTrigger(t => t + 1);
    } catch (e: any) {
      toast.error('Erro ao transferir', { description: e?.message || 'Verifique a instância do WhatsApp.' });
    } finally {
      setTransferringId(null);
    }
  }, [nextSeller, effectiveUserId]);

  // Atribui um lead do BOLSÃO (sem dono) a um vendedor escolhido. Chama
  // assign-pool-lead (atribui firme + avisa o vendedor no WhatsApp).
  const handleAssignPool = useCallback(async (leadId: string, sellerId: string, leadName: string | null) => {
    if (!sellerId) { toast.warning('Escolha um vendedor pra atribuir.'); return; }
    setAssigningPoolId(leadId);
    try {
      // invokeWithReauth: no 401 (sessão do gestor velha) revalida e tenta 1x.
      const { data, error } = await invokeWithReauth('assign-pool-lead', {
        body: { lead_id: leadId, to_member_id: sellerId, user_id: effectiveUserId },
      });
      if (error) {
        let message = error.message || 'Não foi possível atribuir.';
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); message = b?.error || message; } catch { /* ignore */ } }
        throw new Error(message);
      }
      toast.success(`"${leadName || 'Lead'}" atribuído.`, {
        description: (data as any)?.notificado ? 'Vendedor avisado no WhatsApp.' : 'Atribuído (vendedor sem WhatsApp conectado pra aviso).',
      });
      setPoolLeads(prev => prev.filter(l => l.id !== leadId));
      setReloadTrigger(t => t + 1);
    } catch (e: any) {
      toast.error('Erro ao atribuir', { description: e?.message });
    } finally {
      setAssigningPoolId(null);
    }
  }, [effectiveUserId]);

  // Vendedor sem master_id resolvido: redirect (RLS bloquearia tudo de qualquer jeito)
  if (!embedded && !profileLoading && isSeller && !masterUserId) {
    return <Navigate to="/dashboard" replace />;
  }

  // Embedded (tab do Pedro SDR): fluxo normal, cresce com o conteúdo.
  // Standalone (TV): preenche exatamente a viewport (100dvh/100dvw) como
  // coluna flex, sem scroll. ~2% de padding em cada eixo = margem de overscan
  // pra TVs que cortam as bordas. A área de vendedores (flex-1) absorve a sobra.
  const wrapperClass = embedded
    ? 'h-full overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white'
    : 'relative flex flex-col h-[100dvh] w-[100dvw] overflow-hidden px-[2vw] py-[2vh] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white';

  // Loading inicial (perfil + dados)
  if (profileLoading || (loading && !kpis)) {
    return (
      <div className={`${wrapperClass} flex items-center justify-center`}>
        <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
      </div>
    );
  }

  const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Conteúdo do painel — reusado no modo embedded (aba do Pedro) e no modo
  // TV/tela cheia (renderizado num canvas escalado pra caber 100% na tela).
  const panelContent = (
    <>
      {/* ───── Header ───── */}
      <header className="shrink-0 border-b border-blue-900/50 px-8 py-4 flex items-center justify-between bg-slate-900/40 backdrop-blur">
        <div className="flex items-center gap-5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="logo" className="h-14 w-auto object-contain" />
          ) : (
            <div
              className="h-14 w-14 rounded-xl flex items-center justify-center font-bold text-2xl"
              style={{ background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.secondary_color})` }}
            >
              {(branding.company_name || '?')[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider">{branding.company_name}</h1>
            <p className="text-xs uppercase tracking-widest text-blue-300/70 mt-0.5">Dashboard Comercial · Produção em Tempo Real</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Data
            </span>
            <span className="text-base font-bold tabular-nums">{dateStr}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest text-blue-300/60 flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> Hora
            </span>
            <span className="text-base font-bold tabular-nums">{timeStr}</span>
          </div>
          {/* Botões de ação */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={handleManualRefresh}
              className="h-9 w-9 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/50 flex items-center justify-center text-slate-300 transition-colors"
              title="Atualizar agora"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={toggleFullscreen}
              className="h-9 w-9 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/50 flex items-center justify-center text-slate-300 transition-colors"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia (F11)'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ───── Toolbar de filtro de período ───── */}
      <div className="shrink-0 px-8 py-3 border-b border-slate-800/60 bg-slate-900/30 flex items-center gap-4 flex-wrap">
        <span className="text-[10px] uppercase tracking-widest text-blue-300/60 font-bold">Período</span>
        <div className="flex items-center gap-1.5 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
          {([
            { id: 'today',     label: 'Hoje' },
            { id: 'yesterday', label: 'Ontem' },
            { id: '7days',     label: '7 dias' },
            { id: '30days',    label: '30 dias' },
            { id: 'custom',    label: 'Personalizado' },
          ] as const).map(opt => {
            const active = period === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setPeriod(opt.id)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={customRange.start}
              max={customRange.end}
              onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
            <span className="text-slate-500">até</span>
            <input
              type="date"
              value={customRange.end}
              min={customRange.start}
              onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
              className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-slate-200"
            />
          </div>
        )}
        <span className="text-[10px] text-slate-500 italic ml-auto">
          📊 {dateRange.label} · sincronização em tempo real ativa
        </span>
      </div>

      {/* ───── Bloco KPIs principais (5 cards lado a lado) ───── */}
      <section className={`shrink-0 px-8 py-[clamp(0.5rem,2.2vmin,1.5rem)] grid gap-4 ${isPortrait ? 'grid-cols-1' : 'grid-cols-5 portrait:grid-cols-1'}`}>
        {/* KPI 1: Leads Gerais */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Users className="h-7 w-7 text-blue-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">
            Leads Gerais · {dateRange.label}
          </p>
          <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color: branding.primary_color }}>
            {kpis?.total_leads ?? 0}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">Total de Leads</p>
          {(kpis?.nao_atribuidos ?? 0) > 0 && (
            <p className="text-[9px] text-amber-400/70 italic mt-1">
              ({kpis!.nao_atribuidos} sem vendedor atribuído)
            </p>
          )}
        </div>

        {/* KPI 2: Custo por Lead · Tráfego Pago — Real (chegou no Pedro) vs Painel
            do Meta, em duas colunas alinhadas. Segue o filtro de período. */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col justify-center">
          <div className="flex items-center justify-center gap-2 mb-[clamp(0.5rem,2vmin,1.25rem)]">
            <DollarSign className="h-5 w-5 text-emerald-400 shrink-0" />
            <p className="text-[10px] uppercase tracking-widest text-blue-300/70 font-semibold">Custo por Lead · Tráfego Pago</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-700/50">
            {/* REAL */}
            <div className="flex flex-col items-center text-center px-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90">Real</span>
              <p className="text-[clamp(1.3rem,4vmin,2.6rem)] portrait:text-[clamp(2rem,7vw,4.5rem)] font-black tabular-nums leading-none text-emerald-400 mt-1.5">
                {formatBRL(kpis?.custo_por_lead ?? 0)}
              </p>
              <span className="text-[10px] text-slate-400 mt-2">{kpis?.por_origem?.trafico_pago ?? 0} leads</span>
            </div>
            {/* META */}
            <div className="flex flex-col items-center text-center px-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400/90">Painel do Meta</span>
              <p className="text-[clamp(1.3rem,4vmin,2.6rem)] portrait:text-[clamp(2rem,7vw,4.5rem)] font-black tabular-nums leading-none text-orange-300 mt-1.5">
                {formatBRL(kpis?.custo_por_lead_meta ?? 0)}
              </p>
              <span className="text-[10px] text-slate-400 mt-2">{kpis?.meta_total ?? 0} no Meta</span>
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-[clamp(0.5rem,2vmin,1.25rem)] text-center">
            {formatBRL(kpis?.total_spend ?? 0)} investidos
          </p>
        </div>

        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          {(() => {
            const score = kpis?.qualidade_media ?? 0;
            const label = kpis?.qualidade_label ?? 'Sem dados';
            const color = score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <>
                <Trophy className="h-7 w-7 mb-2" style={{ color }} />
                <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Qualidade Média</p>
                <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color }}>
                  {score}<span className="text-[clamp(0.9rem,2.2vmin,1.5rem)] portrait:text-[clamp(1rem,3vw,2rem)] text-slate-500">%</span>
                </p>
                <p className="text-[10px] uppercase tracking-widest mt-3 font-bold" style={{ color }}>
                  {label}
                </p>
                <p className="text-[9px] text-slate-500 italic mt-1">IA 50% + Feedback 30% + Notas 20%</p>
              </>
            );
          })()}
        </div>

        {/* KPI 3: Taxa Transferência (% leads Pedro atribuídos a vendedor) */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-blue-900/40 flex flex-col items-center justify-center text-center">
          <Target className="h-7 w-7 text-purple-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Taxa Transferência</p>
          <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none" style={{ color: branding.secondary_color }}>
            {(kpis?.taxa_transferencia ?? 0).toFixed(1)}<span className="text-[clamp(0.9rem,2.2vmin,1.5rem)] portrait:text-[clamp(1rem,3vw,2rem)] text-slate-500">%</span>
          </p>
          <p className="text-[10px] uppercase tracking-widest text-blue-300/50 mt-3">
            {kpis?.taxa_transferencia_texto ?? '0 leads'}
          </p>
        </div>

        {/* KPI 5: Vendas / Meta do mês — vendas concluídas no MÊS CORRENTE sobre a
            meta da loja (ex.: 3/30). NÃO acompanha o filtro de período. */}
        <div className="bg-slate-900/60 rounded-2xl p-[clamp(0.75rem,2.5vmin,1.5rem)] border border-emerald-900/40 flex flex-col items-center justify-center text-center">
          <ShoppingBag className="h-7 w-7 text-emerald-400 mb-2" />
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-2 font-semibold">Vendas / Meta do mês</p>
          <p className="text-[clamp(2rem,6vmin,3.75rem)] portrait:text-[clamp(2.5rem,9vw,6rem)] font-black tabular-nums leading-none text-emerald-400">
            {kpis?.vendas_mes ?? 0}<span className="text-slate-500">/{kpis?.meta_mes ?? 0}</span>
          </p>
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/50 mt-3">
            {(() => {
              const m = kpis?.meta_mes ?? 0;
              const v = kpis?.vendas_mes ?? 0;
              return m > 0 ? `${Math.round((v / m) * 100)}% da meta` : 'Defina a meta do mês';
            })()}
          </p>
          {/* Editar a meta do mês — só master (vendedor não tem permissão na meta). */}
          {!sellerMemberId && (
            metaEditing ? (
              <div className="flex items-center justify-center gap-1.5 mt-2">
                <input
                  type="number"
                  min={0}
                  value={metaDraft}
                  autoFocus
                  onChange={e => setMetaDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') setMetaEditing(false); }}
                  className="w-16 bg-slate-800 border border-emerald-500/40 rounded px-2 py-1 text-center text-sm text-white tabular-nums focus:outline-none focus:border-emerald-400"
                  placeholder="30"
                />
                <button
                  onClick={saveMeta}
                  disabled={savingMeta}
                  className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {savingMeta ? '...' : 'Salvar'}
                </button>
                <button
                  onClick={() => setMetaEditing(false)}
                  className="text-[10px] px-1.5 py-1 rounded bg-slate-700/60 text-slate-300 hover:bg-slate-700"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setMetaDraft(String(kpis?.meta_mes || '')); setMetaEditing(true); }}
                className="mt-2 text-[10px] uppercase tracking-wider font-semibold text-emerald-300/70 hover:text-emerald-200 underline decoration-dotted underline-offset-2"
              >
                {(kpis?.meta_mes ?? 0) > 0 ? 'Editar meta' : 'Definir meta do mês'}
              </button>
            )
          )}
        </div>
      </section>

      {/* ───── Custo por Lead — Real vs Meta dos ÚLTIMOS 7 DIAS (FIXO) ─────
          Esta seção NÃO acompanha o filtro de período do painel: é sempre os
          últimos 7 dias, pra ter uma referência estável de comparação. Só master. */}
      {!sellerMemberId && (() => {
        const fixed7d = resolveDateRange('7days', customRange);
        return (
          <CplComparativo
            userId={effectiveUserId}
            reloadKey={liveTick}
            periodStart={fixed7d.start}
            periodEnd={fixed7d.end}
            periodLabel="Últimos 7 dias (fixo)"
          />
        );
      })()}

      {/* ───── Cards de Origem (linha completa abaixo) ───── */}
      <section className="shrink-0 px-8 pb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 mb-3 font-bold">Origem dos Leads</h2>
        <div className={`grid gap-3 ${isPortrait ? 'grid-cols-2' : 'grid-cols-6 portrait:grid-cols-2'}`}>
          {[{ key: 'trafico_pago', label: 'Tráfego Pago', color: '#3b82f6' }, ...(kpis?.colunas || [])].map(origem => {
            const valor = kpis?.por_origem[origem.key] ?? 0;
            const pct = kpis?.percentuais[origem.key] ?? 0;
            return (
              <div key={origem.key} className="bg-slate-900/60 rounded-xl p-[clamp(0.5rem,1.8vmin,1rem)] border border-slate-800 hover:border-slate-700 transition-colors">
                <span className="h-4 w-4 mb-2 rounded-full inline-block" style={{ background: origem.color }} />
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 truncate">{origem.label}</p>
                <p className="text-[clamp(1.25rem,3vmin,1.875rem)] font-black tabular-nums leading-none">{valor}</p>
                <p className="text-[10px] text-slate-500 mt-1.5">{pct.toFixed(2)}%</p>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: origem.color }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-center text-[10px] text-slate-500 italic mt-2">Dados atualizados automaticamente em tempo real via CRM</p>
      </section>

      {/* ───── PRODUÇÃO INDIVIDUAL DOS VENDEDORES ───── */}
      <section className="shrink-0 px-8 pb-6">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-[10px] uppercase tracking-widest text-amber-300/80 font-bold shrink-0">Leads Não Transferidos</h2>
          {/* Fila de Vendedores: próximo da fila de cada agente ativo */}
          {nextSellerByAgent.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-cyan-300/80 font-bold shrink-0">Fila de Vendedores</span>
              {nextSellerByAgent.map(({ agentId, agentName, seller }, i) => (
                <span key={agentId || i} className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-bold text-cyan-100">
                  {nextSellerByAgent.length > 1 && agentName && (
                    <span className="text-cyan-300/70 font-semibold">{agentName}:</span>
                  )}
                  {seller ? seller.name : 'sem vendedor ativo'}
                </span>
              ))}
              <button
                type="button"
                onClick={abrirEditarFila}
                className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/5 px-2 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/15 shrink-0"
                title="Reordenar a fila manualmente"
              >
                <ListOrdered className="h-3 w-3" /> Editar fila
              </button>
            </div>
          )}
          <p className="text-[10px] text-slate-500 italic shrink-0">{leadsNaoTransferidos.length} pendente(s) no período</p>
        </div>

        {editingQueue && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !savingQueue && setEditingQueue(false)}>
            <div className="w-full max-w-md rounded-2xl border border-cyan-500/30 bg-slate-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-cyan-100 mb-1">Editar ordem da fila</h3>
              <p className="text-[11px] text-slate-400 mb-3">O vendedor no <b className="text-cyan-200">topo</b> recebe o próximo lead. Use as setas pra reordenar.</p>
              <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
                {queueOrder.map((p, i) => (
                  <div key={p.ids[0]} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                    <span className="w-5 text-center text-xs font-bold text-cyan-300">{i + 1}</span>
                    <span className="flex-1 truncate text-sm font-semibold text-slate-100">{p.name}{i === 0 && <span className="ml-2 text-[10px] text-emerald-400">próximo</span>}</span>
                    <button disabled={i === 0 || savingQueue} onClick={() => moverFila(i, -1)} className="rounded p-1 text-slate-300 hover:text-cyan-200 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                    <button disabled={i === queueOrder.length - 1 || savingQueue} onClick={() => moverFila(i, 1)} className="rounded p-1 text-slate-300 hover:text-cyan-200 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                  </div>
                ))}
                {queueOrder.length === 0 && <p className="text-xs text-slate-500">Nenhum vendedor ativo na fila.</p>}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button disabled={savingQueue} onClick={() => setEditingQueue(false)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800">Cancelar</button>
                <button disabled={savingQueue || queueOrder.length === 0} onClick={salvarFila} className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-4 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50">
                  {savingQueue ? 'Salvando…' : 'Salvar ordem'}
                </button>
              </div>
            </div>
          </div>
        )}

        {leadsNaoTransferidos.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-5 text-center text-sm text-slate-500">
            Nenhum lead pendente de transferência.
          </div>
        ) : (
          <div className={`grid gap-3 max-h-44 overflow-y-auto pr-1 ${isPortrait ? 'grid-cols-1' : 'grid-cols-3 portrait:grid-cols-1'}`}>
            {leadsNaoTransferidos.map(lead => (
              <div
                key={lead.id}
                className="group rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 transition-colors hover:border-amber-400/60 hover:bg-amber-500/15"
              >
                <p className="truncate text-sm font-bold text-slate-100 group-hover:text-white">{lead.nome}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-amber-200/80">
                  <Phone className="h-3 w-3" />
                  {lead.telefone}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={transferringId === lead.id || !nextSeller}
                    onClick={() => handleTransferToNext(lead)}
                    className="flex-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-1.5 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title={nextSeller ? `Transferir para ${nextSeller.name} (próximo da fila)` : 'Sem vendedor ativo na fila'}
                  >
                    {transferringId === lead.id ? 'Transferindo…' : `→ Transferir${nextSeller ? ` (${nextSeller.name})` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/pedro?tab=crm&leadId=${lead.id}`)}
                    className="rounded-lg bg-slate-700/40 border border-slate-600/40 px-2 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-700/60 transition-colors"
                    title="Abrir no CRM Avançado"
                  >
                    CRM
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="shrink-0 px-8 pb-16">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[10px] uppercase tracking-widest text-blue-300/70 font-bold">Produção Individual dos Vendedores</h2>
          <p className="text-[10px] text-slate-500 italic">Total de Leads Trabalhados</p>
        </div>

        {vendedores.length === 0 ? (
          <div className="text-center text-slate-500 py-16 bg-slate-900/40 rounded-xl border border-slate-800">
            Nenhum vendedor ativo. Cadastre vendedores em Pedro SDR → Vendedores.
          </div>
        ) : (
          // auto-fit: os cards esticam pra preencher a largura inteira (menos
          // linhas em telas largas). Sem rolagem interna — o zoom da TV encaixa
          // tudo na tela. auto-rows-fr deixa as linhas com a mesma altura.
          <div className={`grid gap-3 auto-rows-fr ${isPortrait ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fit,minmax(180px,1fr))] portrait:grid-cols-2'}`}>
            {vendedores.slice(0, 12).map(v => (
              <VendedorCard key={v.id} v={v} secondary={branding.secondary_color} colunas={kpis?.colunas || []} />
            ))}
          </div>
        )}
      </section>

      {/* ───── Bolsão: leads sem dono pra o gestor atribuir (Repasse Fase 2) ───── */}
      {!sellerMemberId && poolLeads.length > 0 && (
        <section className="mt-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Inbox className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">Sem dono — bolsão</h2>
            <span className="text-[10px] font-bold bg-amber-500/15 text-amber-300 rounded-full px-2 py-0.5">{poolLeads.length}</span>
            <span className="text-[10px] text-slate-500">leads parados de quem saiu — escolha pra quem mandar</span>
          </div>
          <div className="space-y-1.5">
            {poolLeads.map(lead => {
              const sel = poolPick[lead.id] || '';
              const busy = assigningPoolId === lead.id;
              return (
                <div key={lead.id} className="flex items-center gap-2 bg-slate-900/40 border border-slate-800 rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-100 truncate flex items-center gap-1.5">
                      <span className="truncate">{lead.lead_name || 'Lead sem nome'}</span>
                      {lead.repasse_motivo === 'loop_watchdog' && (
                        <span className="shrink-0 text-[8px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300"
                          title="Ficou rodando entre vendedores sem ninguém assumir — atenda ou atribua">⚠ rodou sem dono</span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{lead.vehicle_interest || '—'}</p>
                  </div>
                  <select
                    value={sel}
                    onChange={e => setPoolPick(prev => ({ ...prev, [lead.id]: e.target.value }))}
                    disabled={busy}
                    className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 max-w-[160px]"
                  >
                    <option value="">Escolher vendedor…</option>
                    {vendedores.filter(v => v.id !== '__nao_atribuido__').map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleAssignPool(lead.id, sel, lead.lead_name)}
                    disabled={busy || !sel}
                    className="h-8 px-3 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    {busy ? '…' : 'Atribuir'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ───── Destaque do Dia (fixed bottom) — pula row virtual "Sem vendedor" ───── */}
      {(() => {
        const destaque = vendedores.find(v => v.id !== '__nao_atribuido__' && v.total > 0);
        if (!destaque) return null;
        return (
          <div className={`${embedded ? 'fixed bottom-4' : 'absolute bottom-[3vh]'} left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/40 rounded-full px-6 py-2.5 flex items-center gap-3 backdrop-blur shadow-2xl`}>
            <Trophy className="h-5 w-5 text-amber-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300">Destaque do Dia</span>
            <span className="text-sm font-bold">{destaque.name}</span>
            <span className="text-xs text-amber-300/80 font-semibold">· {destaque.total} leads</span>
          </div>
        );
      })()}
    </>
  );

  // Embedded (aba do Pedro SDR): agora escala como o modo TV — zoom próprio (CSS
  // `zoom`, que reflui o layout, sem buraco) + o MESMO controle de zoom. Default
  // 100% (igual ao de antes); o usuário ajusta pra caber no painel dele.
  if (embedded) {
    return (
      <div ref={containerRef} className={`relative ${wrapperClass}`}>
        {/* Rolagem vertical: se o conteúdo passar da área (ex.: retrato com muita
            informação), a barra lateral aparece e NADA fica cortado; quando cabe,
            o auto-ajuste encaixa e não há barra. */}
        <div
          className="h-full w-full overflow-y-auto overflow-x-hidden"
          style={{ scrollbarGutter: 'stable' }}
        >
          {/* Caixa do tamanho VISUAL (altura = contentH*zoomEmbed). Em RETRATO vira
              coluna 9:16 centralizada (totem); em PAISAGEM preenche a largura. */}
          <div
            className="relative mx-auto"
            style={{
              width: isPortrait && availH ? `min(100%, ${Math.round(availH * 9 / 16)}px)` : '100%',
              height: contentH ? `${Math.round(contentH * zoomEmbed)}px` : undefined,
            }}
          >
            <div
              ref={contentRef}
              className="absolute top-0 left-0 flex flex-col"
              style={{ width: `${100 / zoomEmbed}%`, transform: `scale(${zoomEmbed})`, transformOrigin: 'top left' }}
            >
              {panelContent}
            </div>
          </div>
        </div>
        <ZoomControl
          zoom={zoomEmbed}
          mode={zoomEmbedMode}
          visible={controlsVisible}
          orientation={orientation}
          onToggleOrientation={() => setOrientation(o => (o === 'portrait' ? 'landscape' : 'portrait'))}
          onZoom={(z) => { setZoomEmbed(z); setZoomEmbedMode('manual'); }}
          onAuto={() => setZoomEmbedMode('auto')}
        />
      </div>
    );
  }

  // TV / TELA CHEIA: ZOOM estilo navegador. O painel é escalado por `zoom` a partir
  // do canto superior esquerdo; a largura é compensada (100/zoom%) pra PREENCHER a
  // largura sem barra horizontal. O fundo cobre 100% da tela real. Sem barras de
  // rolagem (overflow-hidden). O controle de zoom fica por cima, fora da escala.
  return (
    <div ref={containerRef} className="relative h-[100dvh] w-[100dvw] overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Área da TV com ROLAGEM VERTICAL: se o conteúdo passar da altura da tela
          (ex.: retrato com muita informação, ou zoom ampliado), a barra lateral
          aparece e NADA fica cortado. Quando cabe, o auto-ajuste encaixa e não há barra. */}
      <div
        className="h-full w-full overflow-y-auto overflow-x-hidden"
        style={{ scrollbarGutter: 'stable' }}
      >
        {/* Caixa do tamanho VISUAL do conteúdo (altura já escalada = contentH*zoom).
            Em RETRATO vira uma coluna 9:16 centralizada (totem); em PAISAGEM preenche
            a largura. A altura fixa faz a barra rolar exatamente o conteúdo. */}
        <div
          className="relative mx-auto"
          style={{
            width: isPortrait ? `min(100dvw, ${Math.round(viewport.h * 9 / 16)}px)` : '100%',
            height: contentH ? `${Math.round(contentH * zoom)}px` : undefined,
          }}
        >
          <div
            ref={contentRef}
            className="absolute top-0 left-0 flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white"
            style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {panelContent}
          </div>
        </div>
      </div>
      <ZoomControl
        zoom={zoom}
        mode={zoomMode}
        visible={controlsVisible}
        orientation={orientation}
        onToggleOrientation={() => setOrientation(o => (o === 'portrait' ? 'landscape' : 'portrait'))}
        onZoom={(z) => { setZoom(z); setZoomMode('manual'); }}
        onAuto={() => setZoomMode('auto')}
      />
    </div>
  );
}

// ─── Controle de Zoom (modo TV) — slider + botões + Auto ─────────────────────
// Fica por cima do painel, FORA da área escalada. Discreto (some um pouco quando
// não está com o mouse em cima). Ajusta o zoom estilo navegador.
function ZoomControl({
  zoom, mode, onZoom, onAuto, visible, orientation, onToggleOrientation,
}: {
  zoom: number;
  mode: 'auto' | 'manual';
  onZoom: (z: number) => void;
  onAuto: () => void;
  visible: boolean;
  orientation?: 'landscape' | 'portrait';
  onToggleOrientation?: () => void;
}) {
  const pct = Math.round(zoom * 100);
  const step = (d: number) => onZoom(Math.max(0.4, Math.min(2.5, +(zoom + d).toFixed(2))));
  return (
    <div
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full bg-slate-900/85 border border-slate-700 px-3 py-1.5 backdrop-blur shadow-xl transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <button
        onClick={() => step(-0.02)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 text-lg leading-none"
        title="Diminuir zoom"
      >−</button>
      <input
        type="range"
        min={0.4}
        max={2.5}
        step={0.02}
        value={zoom}
        onChange={(e) => onZoom(parseFloat(e.target.value))}
        className="w-32 accent-blue-500 cursor-pointer"
        title="Ajustar zoom"
      />
      <button
        onClick={() => step(0.02)}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-200 hover:bg-slate-700 text-lg leading-none"
        title="Aumentar zoom"
      >+</button>
      <span className="text-[11px] tabular-nums text-slate-300 w-10 text-center">{pct}%</span>
      <button
        onClick={onAuto}
        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border transition-colors ${
          mode === 'auto'
            ? 'bg-blue-500/30 border-blue-400 text-blue-200'
            : 'border-slate-600 text-slate-300 hover:bg-slate-700'
        }`}
        title="Ajuste automático à tela"
      >Auto</button>
      {onToggleOrientation && (
        <>
          <span className="w-px h-5 bg-slate-700" />
          <div className="flex items-center rounded-full border border-slate-600 overflow-hidden" title="Formato da TV: deitada (paisagem) ou em pé (retrato)">
            <button
              onClick={() => { if (orientation !== 'landscape') onToggleOrientation(); }}
              className={`text-[11px] font-bold px-2.5 py-0.5 transition-colors ${orientation === 'landscape' ? 'bg-blue-500/30 text-blue-200' : 'text-slate-300 hover:bg-slate-700'}`}
            >Paisagem</button>
            <button
              onClick={() => { if (orientation !== 'portrait') onToggleOrientation(); }}
              className={`text-[11px] font-bold px-2.5 py-0.5 transition-colors ${orientation === 'portrait' ? 'bg-blue-500/30 text-blue-200' : 'text-slate-300 hover:bg-slate-700'}`}
            >Retrato</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Card individual de vendedor ────────────────────────────────────────────

function VendedorCard({ v, secondary, colunas }: { v: VendedorData; secondary: string; colunas: ColunaOrigem[] }) {
  const rColor = rankColor(v.rank);
  const avatarColor = hashColor(v.id);

  return (
    <div className="h-full flex flex-col bg-slate-900/60 rounded-xl p-[clamp(0.4rem,1.5vmin,0.75rem)] border border-slate-800">
      {/* Header: rank + nome */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-md"
          style={{ color: rColor, background: `${rColor}22`, border: `1px solid ${rColor}44` }}
        >
          {v.rank}º
        </span>
        <span className="text-sm font-bold uppercase truncate flex-1">{v.name}</span>
      </div>

      {/* Avatar — prioridade: profiles.avatar_url > ai_team_members.profile_picture > iniciais */}
      <div className="flex justify-center mb-3">
        {v.effective_avatar ? (
          <img
            src={v.effective_avatar}
            alt={v.name}
            className="h-16 w-16 portrait:h-12 portrait:w-12 rounded-full object-cover border-2"
            style={{ borderColor: rColor }}
            onError={(e) => {
              // Se URL quebrar (ex: foto deletada), esconde a img → React Fragment vazio mostra fallback no próximo render
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            className="h-16 w-16 portrait:h-12 portrait:w-12 rounded-full flex items-center justify-center font-bold text-xl border-2 text-white"
            style={{ background: avatarColor, borderColor: rColor }}
          >
            {getInitials(v.name)}
          </div>
        )}
      </div>

      {/* Breakdown por origem — Tráfego Pago (Pedro) fixo no topo + as COLUNAS
          do Kanban do Marcos (dinâmicas, refletem o que o dono configurou). */}
      <div className="space-y-1">
        <BreakdownRow label="Tráfego Pago" value={v.trafico_pago} color="#3b82f6" />
        {colunas.map(col => (
          <BreakdownRow key={col.key} label={col.label} value={v.por_coluna?.[col.key] ?? 0} color={col.color} />
        ))}
        {/* Resultado (não é origem): vendas concluídas do vendedor no período. */}
        <div className="pt-1 mt-1 border-t border-slate-800/70">
          <BreakdownRow label="Venda concluída" value={v.venda_concluida} color="#10b981" />
          {/* Leads que o vendedor ASSUMIU no período (transferência/resgate).
              Não é tráfego pago novo — re-atribuição. Só aparece quando há. */}
          {v.repassados > 0 && (
            <BreakdownRow label="Repasses recebidos" value={v.repassados} color="#22d3ee" />
          )}
        </div>
      </div>

      {/* Total */}
      <div className="mt-auto pt-2 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Total</span>
        <span className="text-[clamp(1.1rem,2.6vmin,1.5rem)] font-black tabular-nums" style={{ color: secondary }}>{v.total}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="flex-1 text-slate-400 truncate">{label}</span>
      <span className="font-bold tabular-nums" style={{ color: value > 0 ? '#ffffff' : '#475569' }}>{value}</span>
    </div>
  );
}
