import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Users, UserPlus, Phone, Loader2, Trash2, Pencil, Check, X,
  Crown, Save, Mail, Send, Shield, StickyNote, Eye, EyeOff, Settings2, RefreshCw,
  MessageSquare, BarChart3, Bot, Radio, Smartphone, UserCog,
  LayoutGrid, FileText, MessageCircle, Zap, LayoutDashboard,
  GraduationCap, CreditCard, Plug, Settings, PanelLeft,
  CheckCircle2, Circle, RotateCcw, Sparkles, Radar,
  PenTool, Palette, Instagram, Brain,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { DEFAULT_SELLER_FEATURES, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { useSubscription } from '@/hooks/useSubscription';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** Lê o corpo de erro de uma edge function. O cliente Supabase encapsula o erro
 *  como Response cru em `error.context`; devolve a mensagem real do servidor
 *  ({ error: "..." }) ou '' se não conseguir ler. */
async function readFnError(error: any): Promise<string> {
  try {
    const ctxResp = (error as any)?.context;
    const respObj = ctxResp && typeof ctxResp.text === 'function' ? ctxResp : ctxResp?.response;
    if (respObj && typeof respObj.text === 'function') {
      const body = await respObj.text();
      try { const parsed = JSON.parse(body); return parsed.error || parsed.message || body; }
      catch { return body; }
    }
  } catch { /* ignore */ }
  return '';
}

interface SellerManagerTabProps {
  userId: string;
}

interface SellerMember {
  id: string;
  name: string;
  whatsapp_number: string;
  email: string | null;
  is_active: boolean;          // ativo no AGENTE de IA (distribuição automática de leads)
  active_in_system: boolean;   // ativo no SISTEMA (visibilidade no CRM e módulos) — fonte de verdade deste painel
  auth_user_id: string | null;
  agent_id: string | null;
  total_leads_received: number;
  /** Contagem REAL de leads atribuídos (calculada no fetch — a coluna
   *  total_leads_received não é mantida e fica sempre 0). */
  lead_count?: number;
  last_lead_received_at: string | null;
  created_at: string;
  visible_features: VisibleFeatures | null;
}

// ── Mapeamento de features para labels, ícones e descrições ─────────────────
type FeatureGroup = 'agents' | 'tab' | 'marcos' | 'sidebar';

interface FeatureItem {
  key: keyof VisibleFeatures;
  label: string;
  desc: string;
  icon: LucideIcon;
  group: FeatureGroup;
}

const FEATURE_LABELS: FeatureItem[] = [
  // ── Acesso aos Agentes (Dashboard + Sidebar) ──
  { key: 'agent_pedro',   label: 'Pedro',   desc: 'SDR & Atendimento',     icon: Bot,       group: 'agents' },
  { key: 'agent_marcos',  label: 'Marcos',  desc: 'CRM & WhatsApp',         icon: Users,     group: 'agents' },
  { key: 'agent_jose',    label: 'José',    desc: 'Tráfego Pago — Meta Ads', icon: Radar,     group: 'agents' },
  { key: 'agent_salomao', label: 'Salomão', desc: 'Orquestrador Central',   icon: Crown,     group: 'agents' },
  { key: 'agent_paulo',   label: 'Paulo',   desc: 'Copywriter',             icon: PenTool,   group: 'agents' },
  { key: 'agent_maria',   label: 'Maria',   desc: 'Design Criativo',        icon: Palette,   group: 'agents' },
  { key: 'agent_davi',    label: 'Davi',    desc: 'Social Media',           icon: Instagram, group: 'agents' },
  { key: 'agent_joao',    label: 'João',    desc: 'E-mail Marketing',       icon: Mail,      group: 'agents' },
  { key: 'agent_daniel',  label: 'Daniel',  desc: 'Estratégia',             icon: Brain,     group: 'agents' },
  // ── Abas do Pedro SDR ──
  { key: 'tab_crm',            label: 'Meus Leads',            desc: 'Pipeline de leads e CRM',        icon: Users,          group: 'tab' },
  { key: 'tab_inbox',          label: 'Conversas',              desc: 'Caixa de mensagens',             icon: MessageSquare,  group: 'tab' },
  { key: 'tab_inbox_ia',       label: 'Conversas IA',           desc: 'Consulta das conversas do agente (somente leitura)', icon: Bot,  group: 'tab' },
  { key: 'tab_performance',    label: 'Performance',            desc: 'Métricas e resultados',          icon: BarChart3,      group: 'tab' },
  { key: 'tab_agente_ia',      label: 'Agente IA',              desc: 'Configuração do agente',         icon: Bot,            group: 'tab' },
  { key: 'tab_crm_ao_vivo',    label: 'Painel ao Vivo',         desc: 'Leads em tempo real',            icon: Radio,          group: 'tab' },
  // 'tab_instancias' (aba Instâncias dentro do Pedro) foi removida no refactor
  // de isolamento — gestão de números de robô vive só em /whatsapp/instances
  // (controlada pelo toggle 'marcos_instancias' abaixo).
  { key: 'tab_vendedores',     label: 'Vendedores',             desc: 'Gestão da equipe',               icon: UserCog,        group: 'tab' },
  // ── CRM & WhatsApp (Marcos) ──
  { key: 'marcos_crm',         label: 'CRM Kanban',             desc: 'Pipeline visual de vendas',      icon: LayoutGrid,     group: 'marcos' },
  { key: 'marcos_formularios', label: 'Formulários',            desc: 'Captura de leads',               icon: FileText,       group: 'marcos' },
  { key: 'marcos_contatos',    label: 'Contatos',               desc: 'Base de contatos',               icon: Users,          group: 'marcos' },
  { key: 'marcos_disparo',     label: 'Disparo em Massa',       desc: 'Campanhas WhatsApp',             icon: Send,           group: 'marcos' },
  { key: 'marcos_inbox',       label: 'Conversas',              desc: 'Mensagens diretas',              icon: MessageCircle,  group: 'marcos' },
  { key: 'marcos_instancias',  label: 'Instâncias',             desc: 'Gerenciar conexões',             icon: Smartphone,     group: 'marcos' },
  { key: 'marcos_automacoes',  label: 'Automações',             desc: 'Fluxos automáticos',             icon: Zap,            group: 'marcos' },
  // ── Menu Lateral ──
  { key: 'sidebar_dashboard',     label: 'Dashboard',           desc: 'Painel principal',               icon: LayoutDashboard, group: 'sidebar' },
  { key: 'sidebar_painel_geral',  label: 'Painel Geral',        desc: 'Visão geral dos próprios leads', icon: BarChart3,       group: 'sidebar' },
  { key: 'sidebar_treinamento',   label: 'Treinamento',         desc: 'Base de conhecimento',           icon: GraduationCap,   group: 'sidebar' },
  { key: 'sidebar_meu_plano',     label: 'Meu Plano',           desc: 'Assinatura e tokens',            icon: CreditCard,      group: 'sidebar' },
  { key: 'sidebar_integracoes',   label: 'Integrações',         desc: 'Conexões externas',              icon: Plug,            group: 'sidebar' },
  { key: 'sidebar_configuracoes', label: 'Configurações',       desc: 'Opções do sistema',              icon: Settings,        group: 'sidebar' },
];

interface FeatureGroupStyle {
  key: FeatureGroup;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  // Card del grupo
  border: string;
  headerGradient: string;
  // Ícone do header (sempre colorido)
  iconColor: string;
  iconColorBright: string;
  // Estado ATIVO do card de feature
  activeBg: string;
  activeBorder: string;
  activeIconBg: string;
  // Hover/foco
  hoverAccent: string;
}

// Tier mínimo necessário por feature de agente (baseado em AgentHub.tsx)
const AGENT_TIER: Record<string, 'basico' | 'pro' | 'enterprise'> = {
  agent_pedro:   'basico',
  agent_marcos:  'pro',
  agent_jose:    'pro',
  agent_salomao: 'enterprise',
  agent_paulo:   'enterprise',
  agent_maria:   'enterprise',
  agent_davi:    'enterprise',
  agent_joao:    'enterprise',
  agent_daniel:  'enterprise',
};
const TIER_ORDER = { basico: 0, pro: 1, enterprise: 2 };

const FEATURE_GROUPS: FeatureGroupStyle[] = [
  {
    key: 'agents',
    title: 'Acesso aos Agentes',
    subtitle: 'Cards do Dashboard e itens do sidebar',
    icon: Sparkles,
    border: 'border-amber-500/30',
    headerGradient: 'bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5',
    iconColor: 'text-amber-400',
    iconColorBright: 'text-amber-300',
    activeBg: 'bg-amber-500/10',
    activeBorder: 'border-amber-500/40',
    activeIconBg: 'bg-amber-500/20',
    hoverAccent: 'hover:bg-amber-500/10 hover:text-amber-300',
  },
  {
    key: 'tab',
    title: 'Abas do Pedro SDR',
    subtitle: 'Abas visíveis no painel do vendedor',
    icon: LayoutDashboard,
    border: 'border-violet-500/30',
    headerGradient: 'bg-gradient-to-r from-violet-500/15 via-purple-500/10 to-violet-500/5',
    iconColor: 'text-violet-400',
    iconColorBright: 'text-violet-300',
    activeBg: 'bg-violet-500/10',
    activeBorder: 'border-violet-500/40',
    activeIconBg: 'bg-violet-500/20',
    hoverAccent: 'hover:bg-violet-500/10 hover:text-violet-300',
  },
  {
    key: 'marcos',
    title: 'Abas do Marcos CRM',
    subtitle: 'Abas do Marcos visíveis no painel do vendedor',
    icon: MessageSquare,
    border: 'border-emerald-500/30',
    headerGradient: 'bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-emerald-500/5',
    iconColor: 'text-emerald-400',
    iconColorBright: 'text-emerald-300',
    activeBg: 'bg-emerald-500/10',
    activeBorder: 'border-emerald-500/40',
    activeIconBg: 'bg-emerald-500/20',
    hoverAccent: 'hover:bg-emerald-500/10 hover:text-emerald-300',
  },
  {
    key: 'sidebar',
    title: 'Menu Lateral',
    subtitle: 'Itens do menu de navegação',
    icon: PanelLeft,
    border: 'border-blue-500/30',
    headerGradient: 'bg-gradient-to-r from-blue-500/15 via-sky-500/10 to-blue-500/5',
    iconColor: 'text-blue-400',
    iconColorBright: 'text-blue-300',
    activeBg: 'bg-blue-500/10',
    activeBorder: 'border-blue-500/40',
    activeIconBg: 'bg-blue-500/20',
    hoverAccent: 'hover:bg-blue-500/10 hover:text-blue-300',
  },
];

export function SellerManagerTab({ userId }: SellerManagerTabProps) {
  const { toast } = useToast();

  // Mostra so os AGENTES que o plano do master libera, e esconde o grupo do
  // Marcos quando o plano nao tem Marcos. Abas do Pedro e Menu Lateral sempre.
  const { subscription } = useSubscription();
  const masterTier = (subscription?.plan_id as 'basico' | 'pro' | 'enterprise') || 'enterprise';
  const masterTierRank = TIER_ORDER[masterTier] ?? TIER_ORDER.enterprise;
  const planHasMarcos = masterTierRank >= TIER_ORDER.pro;
  const availableFeatureLabels = FEATURE_LABELS.filter(f => {
    if (f.group === 'agents') return TIER_ORDER[AGENT_TIER[f.key] ?? 'enterprise'] <= masterTierRank;
    if (f.group === 'marcos') return planHasMarcos;
    return true;
  });

  const [loading, setLoading] = useState(true);
  const [sellers, setSellers] = useState<SellerMember[]>([]);
  const [agents, setAgents] = useState<any[]>([]);

  // Form state
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAgentId, setNewAgentId] = useState('');
  const [saving, setSaving] = useState(false);

  // Invite state
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Notes viewer state
  const [viewNotesFor, setViewNotesFor] = useState<string | null>(null);
  const [sellerNotes, setSellerNotes] = useState<any[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Repasse (redistribuir leads de um vendedor que saiu) state
  const [redistFor, setRedistFor] = useState<SellerMember | null>(null);
  const [redistLoading, setRedistLoading] = useState(false);   // calculando a prévia (dry-run)
  const [redistPreview, setRedistPreview] = useState<any | null>(null);
  const [redistRunning, setRedistRunning] = useState(false);   // executando de verdade

  // Feature config dialog state
  const [configSellerId, setConfigSellerId] = useState<string | null>(null);
  const [configFeatures, setConfigFeatures] = useState<VisibleFeatures>({ ...DEFAULT_SELLER_FEATURES });
  const [initialFeatures, setInitialFeatures] = useState<VisibleFeatures>({ ...DEFAULT_SELLER_FEATURES });
  const [savingConfig, setSavingConfig] = useState(false);

  const handleOpenConfig = (s: SellerMember) => {
    const features = { ...DEFAULT_SELLER_FEATURES, ...(s.visible_features || {}) };
    setConfigSellerId(s.id);
    setConfigFeatures(features);
    setInitialFeatures(features);
  };

  const handleResetChanges = () => {
    setConfigFeatures({ ...initialFeatures });
  };

  // Conta quantas features mudaram desde a abertura do dialog
  const changedCount = Object.keys(configFeatures).reduce((acc, key) => {
    const k = key as keyof VisibleFeatures;
    return acc + (configFeatures[k] !== initialFeatures[k] ? 1 : 0);
  }, 0);
  const hasChanges = changedCount > 0;

  const handleToggleFeature = (key: keyof VisibleFeatures) => {
    setConfigFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleToggleGroup = (group: FeatureGroup) => {
    const groupFeatures = availableFeatureLabels.filter(f => f.group === group);
    const allActive = groupFeatures.every(f => configFeatures[f.key]);
    setConfigFeatures(prev => {
      const next = { ...prev };
      for (const f of groupFeatures) next[f.key] = !allActive;
      return next;
    });
  };

  const handleSetAll = (value: boolean) => {
    setConfigFeatures(prev => {
      const next = { ...prev };
      for (const f of FEATURE_LABELS) next[f.key] = value;
      return next;
    });
  };

  const handleSaveConfig = async () => {
    if (!configSellerId) return;
    setSavingConfig(true);
    try {
      // Identifica TODOS os registros do mesmo vendedor (mesmo whatsapp_number
      // + mesmo master). Importante porque ele pode ter múltiplos registros
      // (um por agente de IA), e nem todos têm auth_user_id preenchido.
      const targetSeller = sellers.find(s => s.id === configSellerId);
      if (!targetSeller) throw new Error('Vendedor não encontrado');

      const sellerWhatsapp = targetSeller.whatsapp_number;
      const sellerMasterUserId = userId; // master logado

      // Atualiza TODOS os registros que pertencem a esse vendedor
      // (filtrando por whatsapp + master pra cobrir duplicados sem auth_user_id).
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ visible_features: configFeatures })
        .eq('user_id', sellerMasterUserId)
        .eq('whatsapp_number', sellerWhatsapp);
      if (error) throw error;

      // Update local state — atualiza todos os registros com mesmo whatsapp
      setSellers(prev => prev.map(s =>
        s.whatsapp_number === sellerWhatsapp
          ? { ...s, visible_features: configFeatures }
          : s
      ));
      setInitialFeatures({ ...configFeatures });
      toast({ title: '✅ Painel do vendedor configurado!' });
      setConfigSellerId(null);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSavingConfig(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sellersRes, agentsRes] = await Promise.all([
        (supabase as any)
          .from('ai_team_members')
          // select('*') (em vez de lista explícita) p/ incluir active_in_system
          // sem quebrar caso a migration ainda não esteja aplicada no banco.
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
        (supabase as any)
          .from('wa_ai_agents')
          .select('id, name')
          .eq('user_id', userId),
      ]);

      // Deduplicate by whatsapp_number — prefer record ativo no sistema.
      // Guarda TODOS os member ids do mesmo número: um vendedor pode ter 1 row
      // por agente, e os leads apontam pra rows diferentes (assigned_to_id).
      const deduped = new Map<string, SellerMember>();
      const memberIdsByKey = new Map<string, string[]>();
      for (const s of (sellersRes.data || [])) {
        const key = s.whatsapp_number || s.id;
        memberIdsByKey.set(key, [...(memberIdsByKey.get(key) || []), s.id]);
        const existing = deduped.get(key);
        if (!existing || ((existing.active_in_system === false) && (s.active_in_system !== false))) {
          deduped.set(key, s);
        }
      }
      const sellersList = Array.from(deduped.values());

      // Contagem REAL de leads por vendedor. A coluna total_leads_received não é
      // mantida (fica 0), então contamos direto: Pedro = ai_crm_leads.assigned_to_id,
      // Marcos = crm_leads.assigned_to. count exato (head: true) — não depende de
      // limite de linhas — somando todos os member ids do mesmo whatsapp.
      const withCounts = await Promise.all(sellersList.map(async (s) => {
        const key = s.whatsapp_number || s.id;
        const ids = memberIdsByKey.get(key) || [s.id];
        const [aiC, crmC] = await Promise.all([
          (supabase as any).from('ai_crm_leads')
            .select('id', { count: 'exact', head: true }).eq('user_id', userId).in('assigned_to_id', ids),
          (supabase as any).from('crm_leads')
            .select('id', { count: 'exact', head: true }).eq('user_id', userId).in('assigned_to', ids),
        ]);
        return { ...s, lead_count: (aiC?.count || 0) + (crmC?.count || 0) } as SellerMember;
      }));

      setSellers(withCounts);
      setAgents(agentsRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAddSeller = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      toast({ title: 'Preencha nome e WhatsApp do vendedor.', variant: 'destructive' });
      return;
    }
    if (!userId) {
      toast({ title: 'Sessão expirada', description: 'Faça login de novo (userId vazio).', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const cleanPhone = newPhone.replace(/\D/g, '');
      const payload = {
        user_id: userId,
        agent_id: newAgentId || null,
        name: newName.trim(),
        whatsapp_number: cleanPhone,
        email: newEmail.trim() || null,
      };
      // Fix 28/05/2026: usar .select() pra confirmar que o INSERT retornou row
      // (RLS silencioso = INSERT "passa" sem inserir, retorna [] sem erro).
      // E logar erro completo do Postgres (code + details + hint) — antes so
      // mostrava err.message que omite info do que quebrou.
      const { data, error } = await (supabase as any)
        .from('ai_team_members')
        .insert(payload)
        .select('id, name');
      if (error) {
        console.error('[SellerManager] handleAddSeller erro:', { error, payload });
        const detalhe = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
          .filter(Boolean).join(' | ');
        throw new Error(detalhe || 'Erro desconhecido ao cadastrar vendedor');
      }
      if (!Array.isArray(data) || data.length === 0) {
        console.error('[SellerManager] handleAddSeller silently dropped (RLS?). payload:', payload);
        throw new Error('Vendedor não foi inserido. Possível RLS bloqueando — confirme que você está logado como master.');
      }
      toast({ title: '✅ Vendedor cadastrado!' });
      setNewName(''); setNewPhone(''); setNewEmail(''); setNewAgentId('');
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao cadastrar vendedor', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleInviteSeller = async (member: SellerMember) => {
    const email = inviteEmails[member.id] || member.email || '';
    if (!email.trim()) {
      toast({ title: 'Digite o e-mail do vendedor para enviar o convite.', variant: 'destructive' });
      return;
    }
    setInvitingId(member.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-seller', {
        body: { memberId: member.id, email: email.trim() },
      });
      // Fix 28/05/2026 v2: cliente Supabase JS encapsula erro de edge function
      // como "Edge Function returned a non-2xx status code" generico, mascarando
      // o erro real do servidor. Em @supabase/supabase-js 2.x, FunctionsHttpError
      // expoe `error.context` que JA EH o Response object cru (nao tem .response).
      // Lemos o body pra extrair o JSON { error: "..." } enviado pela funcao.
      if (error) {
        let serverDetail = '';
        let serverDebug: any = null;
        try {
          // 2.x: error.context = Response (direct). 1.x: error.context.response.
          const ctxResp = (error as any)?.context;
          const respObj = ctxResp && typeof ctxResp.text === 'function' ? ctxResp : ctxResp?.response;
          if (respObj && typeof respObj.text === 'function') {
            const body = await respObj.text();
            try {
              const parsed = JSON.parse(body);
              serverDetail = parsed.error || parsed.message || body;
              serverDebug = parsed.debug || null;
            } catch {
              serverDetail = body;
            }
          }
        } catch (readErr) {
          console.warn('[SellerManager] handleInviteSeller — falha ao ler error body:', readErr);
        }
        // DEBUG 28/05/2026: log estruturado pro console mostrar attempts crus do GoTrue
        console.error('[SellerManager] handleInviteSeller erro completo:', {
          error,
          serverDetail,
          serverDebug,  // <-- ATTEMPTS do GoTrue com raw responses
          member: { id: member.id, name: member.name, email: member.email },
          emailUsed: email,
        });
        if (serverDebug?.attempts) {
          console.error('[SellerManager] GoTrue attempts (cada tipo de link):');
          console.table(serverDebug.attempts);
        }
        throw new Error(serverDetail || error.message || 'Erro desconhecido ao convidar');
      }
      toast({
        title: data?.action === 'linked' ? '🔗 Conta vinculada!' : '✅ Convite enviado!',
        description: data?.message || 'O vendedor receberá um e-mail para criar sua conta.',
      });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao convidar', description: err.message, variant: 'destructive' });
    } finally {
      setInvitingId(null);
    }
  };

  // Toggle do painel "Vendedores" = ativo NO SISTEMA (fonte de verdade).
  // Pausar no sistema também tira o vendedor da distribuição automática
  // (is_active=false) — um vendedor fora do sistema não pode receber leads.
  // Ativar restaura ambos (volta a aparecer em tudo e elegível a receber leads).
  // `current` = active_in_system atual.
  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      const target = sellers.find(s => s.id === id);
      const next = !current;
      const update = next
        ? { active_in_system: true, is_active: true }
        : { active_in_system: false, is_active: false };

      // Atualiza TODOS os registros do mesmo vendedor (pode ter 1 row por agente),
      // filtrando por whatsapp + master — igual ao handleSaveConfig.
      let q = (supabase as any).from('ai_team_members').update(update).eq('user_id', userId);
      q = target?.whatsapp_number ? q.eq('whatsapp_number', target.whatsapp_number) : q.eq('id', id);
      const { error } = await q;
      if (error) throw error;

      setSellers(prev => prev.map(s =>
        (target?.whatsapp_number ? s.whatsapp_number === target.whatsapp_number : s.id === id)
          ? { ...s, ...update }
          : s
      ));
      toast({ title: next ? '✅ Vendedor ativado' : '⛔ Vendedor pausado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir este vendedor da equipe? Os leads atribuídos a ele ficarão "sem vendedor". Esta ação não pode ser desfeita.')) return;
    try {
      const target = sellers.find(s => s.id === id);

      // 1. Resolver TODOS os ids deste vendedor. Um mesmo vendedor pode ter 1 row
      //    por agente (mesmo whatsapp_number), e leads de cada canal apontam pra
      //    rows diferentes — precisamos desvincular/excluir todas.
      let memberIds: string[] = [id];
      if (target?.whatsapp_number) {
        const { data: rows } = await (supabase as any)
          .from('ai_team_members')
          .select('id')
          .eq('user_id', userId)
          .eq('whatsapp_number', target.whatsapp_number);
        if (Array.isArray(rows) && rows.length) memberIds = rows.map((r: any) => r.id);
      }

      // 2. BLINDAGEM (fix 29/05/2026): desvincular os leads ANTES de excluir o
      //    vendedor. Sem isso o lead vira ORFAO e o painel renderiza um "Vendedor
      //    fantasma" (id que nao existe mais em ai_team_members). O painel le
      //    assigned_to || custom_fields.seller_member_id, entao zeramos os DOIS,
      //    em crm_leads (Marcos) E ai_crm_leads (Pedro). Se qualquer desvinculo
      //    falhar, ABORTAMOS a exclusao — melhor manter o vendedor do que criar
      //    um fantasma.
      // 2a. crm_leads.assigned_to (TEXT = ai_team_members.id)
      const detachCrm = await (supabase as any)
        .from('crm_leads').update({ assigned_to: null })
        .eq('user_id', userId).in('assigned_to', memberIds);
      if (detachCrm.error) throw new Error('Falha ao desvincular leads (crm_leads.assigned_to): ' + detachCrm.error.message);

      // 2b. crm_leads.custom_fields->>seller_member_id (fallback do painel) — limpa
      //     a chave por row, preservando o resto do JSON.
      for (const mid of memberIds) {
        const cfRes = await (supabase as any)
          .from('crm_leads').select('id, custom_fields')
          .eq('user_id', userId).eq('custom_fields->>seller_member_id', mid);
        if (cfRes.error) throw new Error('Falha ao buscar leads por custom_fields: ' + cfRes.error.message);
        for (const row of (cfRes.data || [])) {
          const cf = { ...(row.custom_fields || {}) };
          delete cf.seller_member_id;
          const upd = await (supabase as any).from('crm_leads').update({ custom_fields: cf }).eq('id', row.id);
          if (upd.error) throw new Error(`Falha ao limpar custom_fields do lead ${row.id}: ${upd.error.message}`);
        }
      }

      // 2c. ai_crm_leads.assigned_to_id (UUID = ai_team_members.id) — canal Pedro.
      const detachAi = await (supabase as any)
        .from('ai_crm_leads').update({ assigned_to_id: null }).in('assigned_to_id', memberIds);
      if (detachAi.error) throw new Error('Falha ao desvincular leads do Pedro (ai_crm_leads): ' + detachAi.error.message);

      // 3. Excluir TODAS as rows do vendedor (todas com o mesmo whatsapp_number).
      //    Fix 28/05/2026: .select() confirma que o DELETE removeu rows — RLS
      //    silenciosa retorna error=null + data=[] (zero afetados).
      let delQ = (supabase as any).from('ai_team_members').delete();
      delQ = target?.whatsapp_number
        ? delQ.eq('user_id', userId).eq('whatsapp_number', target.whatsapp_number)
        : delQ.eq('id', id);
      const { data, error } = await delQ.select('id');
      if (error) {
        console.error('[SellerManager] handleDelete erro:', { error, id, memberIds });
        const detalhe = [error.message, error.details, error.hint, error.code ? `code=${error.code}` : null]
          .filter(Boolean).join(' | ');
        throw new Error(detalhe || 'Erro desconhecido ao excluir vendedor');
      }
      if (!Array.isArray(data) || data.length === 0) {
        console.error('[SellerManager] handleDelete silently dropped (RLS?). id:', id);
        toast({
          title: 'Não foi possível excluir',
          description: 'O registro não foi removido — pode ser permissão (RLS) ou o vendedor pertence a outro master.',
          variant: 'destructive',
        });
        return;
      }
      setSellers(prev => prev.filter(s => target?.whatsapp_number ? s.whatsapp_number !== target.whatsapp_number : s.id !== id));
      toast({ title: '✅ Vendedor removido', description: 'Leads atribuídos a ele agora estão sem vendedor.' });
    } catch (err: any) {
      toast({ title: 'Erro ao excluir vendedor', description: err.message, variant: 'destructive' });
    }
  };

  // ── Repasse: abre a prévia (dry-run) dos leads ATIVOS deste vendedor ──
  // Mostra quem iria pra quem ANTES de mexer em qualquer coisa. Nada é enviado
  // nem movido até o gestor confirmar.
  const handleOpenRedistribute = async (seller: SellerMember) => {
    setRedistFor(seller);
    setRedistPreview(null);
    setRedistLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('redistribute-seller-leads', {
        body: { from_member_id: seller.id, dry_run: true },
      });
      if (error) throw new Error((await readFnError(error)) || error.message);
      setRedistPreview(data);
    } catch (err: any) {
      toast({ title: 'Erro ao calcular o repasse', description: err.message, variant: 'destructive' });
      setRedistFor(null);
    } finally {
      setRedistLoading(false);
    }
  };

  // ── Repasse: executa de verdade (envia WhatsApp + atribui aos outros) ──
  const handleConfirmRedistribute = async () => {
    if (!redistFor) return;
    setRedistRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('redistribute-seller-leads', {
        body: { from_member_id: redistFor.id, dry_run: false, force: true },
      });
      if (error) throw new Error((await readFnError(error)) || error.message);
      const n = data?.repassados ?? 0;
      const b = data?.bolsao ?? 0;
      toast({
        title: (n + b) > 0 ? `✅ ${n} repassado(s)${b > 0 ? ` + ${b} no bolsão` : ''}` : 'Nada para repassar',
        description: (n + b) > 0
          ? 'Ativos já estão no CRM dos outros vendedores (com a conversa). Os parados foram pro bolsão — atribua no Painel ao Vivo.'
          : 'Esse vendedor não tinha leads para repassar.',
      });
      setRedistFor(null);
      setRedistPreview(null);
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao repassar', description: err.message, variant: 'destructive' });
    } finally {
      setRedistRunning(false);
    }
  };

  const handleStartEdit = (s: SellerMember) => {
    setEditingId(s.id); setEditName(s.name); setEditPhone(s.whatsapp_number);
  };
  const handleCancelEdit = () => { setEditingId(null); setEditName(''); setEditPhone(''); };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim() || !editPhone.trim()) {
      toast({ title: 'Preencha nome e WhatsApp.', variant: 'destructive' });
      return;
    }
    setSavingEdit(true);
    try {
      const cleanPhone = editPhone.replace(/\D/g, '');
      await (supabase as any).from('ai_team_members')
        .update({ name: editName.trim(), whatsapp_number: cleanPhone }).eq('id', id);
      setSellers(prev => prev.map(s => s.id === id
        ? { ...s, name: editName.trim(), whatsapp_number: cleanPhone } : s));
      toast({ title: '✅ Vendedor atualizado!' });
      handleCancelEdit();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleViewNotes = async (memberId: string) => {
    if (viewNotesFor === memberId) { setViewNotesFor(null); return; }
    setViewNotesFor(memberId);
    setLoadingNotes(true);
    try {
      const { data } = await (supabase as any)
        .from('pedro_crm_notes')
        .select('id, content, is_pinned, created_at, lead:ai_crm_leads(lead_name)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(30);
      setSellerNotes(data || []);
    } finally {
      setLoadingNotes(false);
    }
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
        <Shield className="h-4 w-4 shrink-0" />
        <p className="leading-relaxed">
          <strong>Gestão de Vendedores:</strong> Cadastre os vendedores da equipe. Cada vendedor poderá criar uma conta e acessar apenas os leads, inbox e instância atribuídos a ele.
        </p>
      </div>

      {/* Formulário de cadastro */}
      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-emerald-400" />
            Cadastrar Vendedor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[140px] space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                placeholder="Ex: João Silva"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <Label className="text-xs">WhatsApp</Label>
              <Input
                placeholder="Ex: 5511999999999"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="flex-1 min-w-[140px] space-y-1">
              <Label className="text-xs">E-mail (para login)</Label>
              <Input
                placeholder="Ex: joao@empresa.com"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="h-8 text-xs"
                type="email"
              />
            </div>
            {agents.length > 0 && (
              <div className="w-40 space-y-1">
                <Label className="text-xs">Agente IA</Label>
                <Select value={newAgentId} onValueChange={setNewAgentId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs text-muted-foreground">Nenhum</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              size="sm" className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 shrink-0"
              onClick={handleAddSeller} disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
              Cadastrar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de vendedores */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-400" />
          Equipe ({sellers.length} vendedor{sellers.length !== 1 ? 'es' : ''})
        </h3>

        {sellers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm bg-card border border-border/50 rounded-xl">
            <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>Nenhum vendedor cadastrado ainda.</p>
            <p className="text-xs mt-1">Use o formulário acima para adicionar vendedores à equipe.</p>
          </div>
        ) : (
          sellers.map(s => {
            const isEditing = editingId === s.id;
            return (
              <div key={s.id} className="space-y-0">
                <div className={`bg-card border rounded-xl px-4 py-3 transition-colors ${
                  isEditing ? 'border-blue-500/60 bg-blue-500/5' : 'group hover:border-blue-500/30'
                } ${viewNotesFor === s.id ? 'rounded-b-none border-b-0' : ''}`}>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Pencil className="h-4 w-4 text-blue-400" />
                      </div>
                      <Input value={editName} onChange={e => setEditName(e.target.value)}
                        placeholder="Nome" className="h-8 text-xs flex-1" autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleSaveEdit(s.id)} />
                      <Input value={editPhone} onChange={e => setEditPhone(e.target.value)}
                        placeholder="WhatsApp" className="h-8 text-xs flex-1 font-mono"
                        onKeyDown={e => e.key === 'Enter' && handleSaveEdit(s.id)} />
                      <Button size="sm" className="h-8 px-3 gap-1.5 bg-green-600 hover:bg-green-700"
                        onClick={() => handleSaveEdit(s.id)} disabled={savingEdit}>
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 px-3 gap-1.5" onClick={handleCancelEdit}>
                        <X className="h-3.5 w-3.5" />
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            s.active_in_system !== false
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-muted text-muted-foreground border border-border/40'
                          }`}>
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{s.name}</p>
                              {s.active_in_system !== false ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold">ATIVO</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 font-semibold">PAUSADO</span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                              <Phone className="h-3 w-3" /> {s.whatsapp_number}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right hidden sm:block">
                            <p className="text-sm font-bold text-foreground leading-none">{s.lead_count ?? 0}</p>
                            <p className="text-[10px] text-muted-foreground">leads</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer" htmlFor={`act-${s.id}`}>
                              {s.active_in_system !== false ? 'Ativo' : 'Pausado'}
                            </Label>
                            <Switch id={`act-${s.id}`} checked={s.active_in_system !== false}
                              onCheckedChange={() => handleToggleActive(s.id, s.active_in_system !== false)} className="scale-90" />
                          </div>
                          <Button variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-violet-400 hover:text-violet-300"
                            onClick={() => handleOpenConfig(s)}
                            title="Configurar painel do vendedor">
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-yellow-400 hover:text-yellow-300"
                            onClick={() => handleViewNotes(s.id)}
                            title="Ver anotações do vendedor">
                            <StickyNote className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-cyan-400 hover:text-cyan-300"
                            onClick={() => handleOpenRedistribute(s)}
                            title="Repassar os leads ativos deste vendedor para os outros (folga, saída, demissão)">
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-blue-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleStartEdit(s)} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDelete(s.id)} title="Excluir">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Invite / account status */}
                      {s.auth_user_id ? (
                        <div className="flex items-center gap-2 px-1 flex-wrap">
                          <span className="text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Conta ativa
                          </span>
                          {s.email && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Mail className="h-2.5 w-2.5" /> {s.email}
                            </span>
                          )}
                          {s.email && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-2 text-[10px] text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/20 rounded-full"
                              onClick={() => handleInviteSeller(s)}
                              disabled={invitingId === s.id}
                              title="Reenviar e-mail de convite para criar senha"
                            >
                              {invitingId === s.id
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                                : <RefreshCw className="h-2.5 w-2.5 mr-1" />}
                              Reenviar convite
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="E-mail para convite de acesso..."
                            value={inviteEmails[s.id] ?? (s.email || '')}
                            onChange={e => setInviteEmails(prev => ({ ...prev, [s.id]: e.target.value }))}
                            className="h-7 text-xs flex-1"
                            type="email"
                          />
                          <Button size="sm"
                            className="h-7 px-3 shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-xs"
                            onClick={() => handleInviteSeller(s)}
                            disabled={invitingId === s.id}>
                            {invitingId === s.id
                              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              : <Send className="h-3 w-3 mr-1" />}
                            Enviar Convite
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Notes viewer panel */}
                {viewNotesFor === s.id && (
                  <div className="bg-card border border-t-0 border-border/50 rounded-b-xl px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Anotações de {s.name}
                      </p>
                      <Button variant="ghost" size="sm" onClick={() => setViewNotesFor(null)} className="h-5 w-5 p-0">
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    {loadingNotes ? (
                      <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                    ) : sellerNotes.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">Nenhuma anotação encontrada.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {sellerNotes.map(n => (
                          <div key={n.id} className={`rounded-lg p-2.5 text-xs ${n.is_pinned ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-muted/40'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              {n.is_pinned && <span className="text-[9px] text-yellow-400 font-semibold">📌 Fixada</span>}
                              <span className="text-[10px] text-blue-400 font-medium">{n.lead?.lead_name || 'Lead'}</span>
                              <span className="text-[10px] text-muted-foreground">· {fmtDate(n.created_at)}</span>
                            </div>
                            <p className="text-foreground leading-relaxed">{n.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Dialog: Repassar leads de um vendedor (folga/saída/demissão) ── */}
      <Dialog open={!!redistFor} onOpenChange={open => { if (!open) { setRedistFor(null); setRedistPreview(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-cyan-400" /> Repassar leads de {redistFor?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Os leads que <b>{redistFor?.name}</b> está atendendo vão para os outros vendedores ativos,
              levando a conversa junto. Use quando ele sair (folga, saída antecipada ou demissão).
            </DialogDescription>
          </DialogHeader>

          {redistLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculando o repasse...
            </div>
          ) : redistPreview ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
                <p><b className="text-cyan-400">{redistPreview.repassados || 0}</b> lead(s) ativo(s) serão repassados para os outros vendedores.</p>
                {(redistPreview.bolsao || 0) > 0 && (
                  <p className="text-amber-300 text-xs mt-1">
                    + <b>{redistPreview.bolsao}</b> lead(s) parado(s) vão pro <b>bolsão</b> (sem dono) — você atribui depois no Painel ao Vivo.
                  </p>
                )}
                {redistPreview.sem_vendedor > 0 && (
                  <p className="text-amber-400 text-xs mt-1">
                    ⚠ {redistPreview.sem_vendedor} sem outro vendedor disponível — vão continuar parados.
                  </p>
                )}
                {(redistPreview.ativos_encontrados || 0) === 0 && (redistPreview.bolsao || 0) === 0 && (
                  <p className="text-muted-foreground text-xs mt-1">Esse vendedor não tem leads pra repassar no momento.</p>
                )}
              </div>

              {Array.isArray(redistPreview.detalhe) && redistPreview.detalhe.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {redistPreview.detalhe.map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs border-b border-border/30 py-1">
                      <span className="truncate text-foreground">{d.lead_name || 'Lead'}</span>
                      <span className={`shrink-0 ml-2 ${d.vendedor ? 'text-cyan-400' : 'text-amber-300'}`}>
                        {d.acao === 'bolsao' ? '→ bolsão' : (d.vendedor ? `→ ${d.vendedor}` : 'sem vendedor')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setRedistFor(null); setRedistPreview(null); }}>
                  Cancelar
                </Button>
                <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700 text-white"
                  disabled={redistRunning || ((redistPreview.repassados || 0) === 0 && (redistPreview.bolsao || 0) === 0)}
                  onClick={handleConfirmRedistribute}>
                  {redistRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Confirmar e repassar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Configurar Permissões do Vendedor ── */}
      <Dialog open={!!configSellerId} onOpenChange={open => !open && setConfigSellerId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-hidden flex flex-col p-0 gap-0">
          {(() => {
            const currentSeller = sellers.find(s => s.id === configSellerId);
            const totalActive = Object.values(configFeatures).filter(Boolean).length;
            const totalFeatures = Object.keys(configFeatures).length;

            return (
              <>
                {/* ═══════════════════ HEADER COM IDENTIDADE ═══════════════════ */}
                <div className="relative overflow-hidden border-b border-border/40">
                  {/* Background gradient decorativo */}
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-transparent pointer-events-none" />

                  <DialogHeader className="relative px-6 pt-5 pb-4 space-y-0">
                    <div className="flex items-start gap-3">
                      {/* Avatar com iniciais (igual à lista) */}
                      <div className={`h-11 w-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                        currentSeller?.active_in_system !== false
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-muted text-muted-foreground border border-border/40'
                      }`}>
                        {currentSeller?.name?.slice(0, 2).toUpperCase() || '??'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <DialogTitle className="text-base flex items-center gap-2 flex-wrap">
                          <Shield className="h-4 w-4 text-violet-400 shrink-0" />
                          <span>Permissões de</span>
                          <span className="text-violet-300">{currentSeller?.name || 'Vendedor'}</span>
                          {currentSeller?.active_in_system !== false ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold border border-emerald-500/20">
                              ATIVO
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 font-semibold border border-slate-500/20">
                              PAUSADO
                            </span>
                          )}
                        </DialogTitle>
                        <DialogDescription className="text-xs mt-1">
                          Defina o que este vendedor pode ver no painel dele. As alterações sincronizam em todos os agentes do vendedor.
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>
                </div>

                {/* ═══════════════════ BARRA DE AÇÕES RÁPIDAS ═══════════════════ */}
                <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border/40 bg-muted/10 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetAll(true)}
                    className="text-[11px] h-7 gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 hover:border-emerald-500/50"
                  >
                    <Eye className="h-3 w-3" /> Ativar Tudo
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetAll(false)}
                    className="text-[11px] h-7 gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/50"
                  >
                    <EyeOff className="h-3 w-3" /> Desativar Tudo
                  </Button>
                  {hasChanges && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleResetChanges}
                      className="text-[11px] h-7 gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 hover:border-amber-500/50"
                      title="Reverter para o último estado salvo"
                    >
                      <RotateCcw className="h-3 w-3" /> Desfazer
                    </Button>
                  )}

                  <div className="ml-auto flex items-center gap-3">
                    {/* Progress visual */}
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-muted/60 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                          style={{ width: `${(totalActive / totalFeatures) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground font-medium tabular-nums">
                        <span className="text-foreground font-semibold">{totalActive}</span>
                        <span className="opacity-60">/{totalFeatures}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* ═══════════════════ CONTEÚDO SCROLLÁVEL ═══════════════════ */}
                <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
                  {FEATURE_GROUPS.map(group => {
                    const items = availableFeatureLabels.filter(f => f.group === group.key);
                    if (items.length === 0) return null; // grupo sem feature no plano: nao mostra
                    const activeCount = items.filter(f => configFeatures[f.key]).length;
                    const allActive = activeCount === items.length;
                    const noneActive = activeCount === 0;
                    const GroupIcon = group.icon;

                    return (
                      <div key={group.key} className={`rounded-xl border ${group.border} overflow-hidden bg-card/40`}>
                        {/* ── Cabeçalho do grupo com gradiente ── */}
                        <div className={`flex items-center justify-between px-4 py-3 ${group.headerGradient} border-b ${group.border}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-8 w-8 rounded-lg ${group.activeIconBg} border ${group.activeBorder} flex items-center justify-center shrink-0`}>
                              <GroupIcon className={`h-4 w-4 ${group.iconColorBright}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-foreground">{group.title}</h4>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] h-5 px-1.5 ${group.border} ${group.iconColorBright} font-bold tabular-nums`}
                                >
                                  {activeCount}/{items.length}
                                </Badge>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">{group.subtitle}</p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`h-7 text-[11px] gap-1 ${group.iconColor} ${group.hoverAccent} shrink-0`}
                            onClick={() => handleToggleGroup(group.key)}
                            title={allActive ? 'Desativar todas deste grupo' : 'Ativar todas deste grupo'}
                          >
                            {allActive
                              ? <><EyeOff className="h-3 w-3" /> Desativar</>
                              : noneActive
                                ? <><Sparkles className="h-3 w-3" /> Ativar Todos</>
                                : <><Eye className="h-3 w-3" /> Ativar Restantes</>
                            }
                          </Button>
                        </div>

                        {/* ── Grid de features ── */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2">
                          {items.map(f => {
                            const Icon = f.icon;
                            const isActive = configFeatures[f.key];
                            const isChanged = isActive !== initialFeatures[f.key];

                            return (
                              <button
                                key={f.key}
                                type="button"
                                onClick={() => handleToggleFeature(f.key)}
                                className={`group/feat relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-left
                                  ${isActive
                                    ? `${group.activeBg} border ${group.activeBorder} shadow-sm`
                                    : 'bg-muted/30 border border-border/30 hover:bg-muted/50 hover:border-border/50'
                                  }`}
                              >
                                {/* Indicador "alterado" — ponto amarelo */}
                                {isChanged && (
                                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" title="Alterado" />
                                )}

                                {/* Container do ícone */}
                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-all
                                  ${isActive
                                    ? `${group.activeIconBg} ${group.iconColorBright} border ${group.activeBorder}`
                                    : 'bg-muted/40 text-muted-foreground border border-transparent'
                                  }`}>
                                  <Icon className="h-4 w-4" />
                                </div>

                                {/* Texto */}
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-semibold leading-tight ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                                    {f.label}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground/80 truncate leading-tight mt-0.5">
                                    {f.desc}
                                  </p>
                                </div>

                                {/* Indicador on/off visual (substitui o Switch) */}
                                <div className="shrink-0">
                                  {isActive
                                    ? <CheckCircle2 className={`h-5 w-5 ${group.iconColorBright}`} />
                                    : <Circle className="h-5 w-5 text-muted-foreground/40 group-hover/feat:text-muted-foreground/70 transition-colors" />
                                  }
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ═══════════════════ FOOTER ═══════════════════ */}
                <div className="flex items-center justify-between px-6 py-3 border-t border-border/40 bg-muted/10">
                  <div className="flex items-center gap-2">
                    {hasChanges ? (
                      <>
                        <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[11px] text-amber-400 font-medium">
                          {changedCount} {changedCount === 1 ? 'alteração pendente' : 'alterações pendentes'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-[11px] text-muted-foreground">
                          Sem alterações pendentes
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfigSellerId(null)} className="text-xs h-8">
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveConfig}
                      disabled={savingConfig || !hasChanges}
                      className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-5 h-8 disabled:opacity-50"
                    >
                      {savingConfig
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        : <Save className="h-3.5 w-3.5 mr-1" />}
                      Salvar Permissões
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
