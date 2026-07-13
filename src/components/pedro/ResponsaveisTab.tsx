import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithReauth } from '@/lib/invokeWithReauth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Users, UserPlus, Loader2, FileText, BarChart3, Bell, Crown, Info, Mail, Radar, Check, Bot, MessageSquare, Trash2, Send,
} from 'lucide-react';
import { DEFAULT_SELLER_FEATURES, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { onlyDigits, normalizePhoneBR } from '@/lib/phoneBR';

// ── Responsáveis & entregas ──────────────────────────────────────────────────
// Lugar ÚNICO de pessoas + acessos da conta (mora em Configurações). Adicionar
// alguém = escolher o tipo (vendedor/gerente/tráfego), mandar convite por e-mail
// (invite-seller: cria o login), liberar o acesso certo (visible_features) e ligar
// os agentes/entregas. Leads são por agente (ai_team_members.is_active); entregas
// (atendimento/tráfego/alertas) em conta_responsaveis.

interface Props { userId: string; }

type Entrega = 'recebe_atendimento' | 'recebe_trafego' | 'recebe_alertas';
type Tipo = 'vendedor' | 'gerente' | 'trafego';
type Acesso = 'pedro_ia' | 'marcos_crm' | 'jose_trafego';
type InviteStatus = 'sem_email' | 'sem_convite' | 'convite_pendente' | 'confirmado' | 'ativo' | 'erro';

interface InviteStatusInfo {
  member_id: string;
  email: string | null;
  auth_user_id: string | null;
  status: InviteStatus;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}

interface AgenteLead { agentId: string; nome: string; memberId: string; ativo: boolean; }
interface Pessoa {
  key: string; nome: string; whatsapp: string;
  papel: 'gerente' | 'vendedor' | 'externo';
  email: string | null;
  authUserId: string | null;
  inviteStatus?: InviteStatus;
  emailConfirmedAt?: string | null;
  lastSignInAt?: string | null;
  memberIds: string[];
  acessos: Acesso[];
  aparece_paineis: boolean;
  agentes: AgenteLead[];
  recebe_atendimento: boolean; recebe_trafego: boolean; recebe_alertas: boolean;
}

// onlyDigits e normalizePhoneBR vem do helper unico @/lib/phoneBR. A chave de
// agrupamento das pessoas usa o numero nacional COMPLETO (normalizePhoneBR),
// nunca os ultimos 8 digitos — senao pessoas de DDDs diferentes com final igual
// seriam fundidas na mesma linha.
function fmtTel(d: string): string {
  const n = d.startsWith('55') ? d.slice(2) : d;
  if (n.length >= 10) return `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}`;
  return d || '';
}
function iniciais(nome: string): string {
  const p = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

const inviteStatusRank: Record<InviteStatus, number> = {
  erro: 0,
  sem_email: 1,
  sem_convite: 2,
  convite_pendente: 3,
  confirmado: 4,
  ativo: 5,
};

function statusConviteMeta(status?: InviteStatus) {
  switch (status) {
    case 'ativo': return { label: 'Conta ativa', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' };
    case 'confirmado': return { label: 'Confirmado', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/40' };
    case 'convite_pendente': return { label: 'Convite pendente', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };
    case 'sem_convite': return { label: 'Sem convite', cls: 'bg-muted/40 text-muted-foreground border-border/50' };
    case 'erro': return { label: 'Status indisponivel', cls: 'bg-red-500/10 text-red-300 border-red-500/30' };
    case 'sem_email':
    default: return { label: 'Sem e-mail', cls: 'bg-muted/40 text-muted-foreground border-border/50' };
  }
}

function melhorStatusConvite(infos: InviteStatusInfo[], fallbackEmail: string | null): Partial<Pessoa> {
  if (!infos.length) return { inviteStatus: fallbackEmail ? 'sem_convite' : 'sem_email' };
  const best = [...infos].sort((a, b) => inviteStatusRank[b.status] - inviteStatusRank[a.status])[0];
  return {
    inviteStatus: best.status,
    email: fallbackEmail || best.email || null,
    authUserId: best.auth_user_id || null,
    emailConfirmedAt: best.email_confirmed_at || null,
    lastSignInAt: best.last_sign_in_at || null,
  };
}

// Presets de acesso (visible_features).
const featKeys = Object.keys(DEFAULT_SELLER_FEATURES) as (keyof VisibleFeatures)[];
const allTrue = (): VisibleFeatures => Object.fromEntries(featKeys.map((k) => [k, true])) as VisibleFeatures;
const allFalse = (): VisibleFeatures => Object.fromEntries(featKeys.map((k) => [k, false])) as VisibleFeatures;
const GERENTE_FEATURES = allTrue();                                           // acesso total
// Só José (acesso RESTRITO): o marcador __restrito faz o useSellerProfile respeitar
// o que está OFF (senão o vendedor sempre veria o padrão Pedro+Marcos por cima).
const ACESSO_FEATURES: Record<Acesso, Partial<VisibleFeatures>> = {
  pedro_ia: {
    agent_pedro: true,
    tab_crm: true,
    tab_inbox: true,
    tab_inbox_ia: true,
    tab_crm_ao_vivo: true,
    sidebar_dashboard: true,
    sidebar_painel_geral: true,
  },
  marcos_crm: {
    agent_marcos: true,
    marcos_crm: true,
    marcos_contatos: true,
    marcos_inbox: true,
    sidebar_dashboard: true,
    sidebar_painel_geral: true,
  },
  jose_trafego: {
    agent_jose: true,
    sidebar_dashboard: true,
  },
};

const buildRestrictedFeatures = (acessos: Iterable<Acesso>): VisibleFeatures => {
  const features: any = { ...allFalse(), __restrito: true };
  for (const acesso of acessos) Object.assign(features, ACESSO_FEATURES[acesso]);
  return features as VisibleFeatures;
};

const defaultAcessosByTipo = (tipo: Tipo): Set<Acesso> => {
  if (tipo === 'gerente') return new Set(['pedro_ia', 'marcos_crm', 'jose_trafego']);
  if (tipo === 'trafego') return new Set(['jose_trafego']);
  return new Set(['pedro_ia', 'marcos_crm']);
};

const inferAcessos = (features: any, isManager: boolean): Acesso[] => {
  if (isManager) return ['pedro_ia', 'marcos_crm', 'jose_trafego'];
  const effective = features?.__restrito ? features : { ...DEFAULT_SELLER_FEATURES, ...(features || {}) };
  const acessos: Acesso[] = [];
  if (effective.agent_pedro || effective.tab_crm || effective.tab_inbox || effective.tab_inbox_ia) acessos.push('pedro_ia');
  if (effective.agent_marcos || effective.marcos_crm || effective.marcos_inbox || effective.marcos_contatos) acessos.push('marcos_crm');
  if (effective.agent_jose) acessos.push('jose_trafego');
  return acessos;
};

// 'recebe_trafego' foi removido: era um toggle fantasma (gravava mas nenhum motor lia —
// a entrega de relatório de tráfego do José por WhatsApp ainda não existe). Atendimento e
// Alertas são lidos de verdade (relatório do Cérebro / alertas). Ver ResponsaveisTab audit.
const ENTREGAS: { campo: Entrega; label: string; icon: typeof FileText }[] = [
  { campo: 'recebe_atendimento', label: 'Atendimento', icon: FileText },
  { campo: 'recebe_alertas', label: 'Alertas', icon: Bell },
];

const ACESSOS: { id: Acesso; label: string; desc: string; icon: typeof Users }[] = [
  { id: 'pedro_ia', label: 'Pedro / IA', desc: 'CRM, Conversas IA e Painel ao Vivo', icon: Bot },
  { id: 'marcos_crm', label: 'Marcos / CRM', desc: 'CRM, contatos e conversas manuais', icon: MessageSquare },
  { id: 'jose_trafego', label: 'Jose / Trafego', desc: 'Painel do gestor de trafego pago', icon: Radar },
];

const TIPOS: { id: Tipo; label: string; desc: string; icon: typeof Users }[] = [
  { id: 'vendedor', label: 'Vendedor', desc: 'Recebe leads. Acessos podem ser combinados abaixo.', icon: Users },
  { id: 'gerente', label: 'Gerente', desc: 'Acesso total ao painel + recebe relatórios.', icon: Crown },
  { id: 'trafego', label: 'Gestor de tráfego', desc: 'Acesso restrito ao José, podendo acompanhar Pedro/IA.', icon: Radar },
];

export function ResponsaveisTab({ userId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [agentesDisp, setAgentesDisp] = useState<{ id: string; nome: string }[]>([]);
  const [nGerentes, setNGerentes] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [nNome, setNNome] = useState('');
  const [nEmail, setNEmail] = useState('');
  const [nTel, setNTel] = useState('');
  const [nTipo, setNTipo] = useState<Tipo>('vendedor');
  const [nAcessos, setNAcessos] = useState<Set<Acesso>>(defaultAcessosByTipo('vendedor'));
  const [nAparecePaineis, setNAparecePaineis] = useState(true);
  const [nAgentes, setNAgentes] = useState<Set<string>>(new Set());
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});

  const [delAlvo, setDelAlvo] = useState<Pessoa | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, agentsRes, respRes] = await Promise.all([
        (supabase as any).from('ai_team_members')
          .select('id, name, email, auth_user_id, whatsapp_number, is_manager, is_active, active_in_system, show_in_live, agent_id, visible_features').eq('user_id', userId),
        (supabase as any).from('wa_ai_agents').select('id, name, gerente_phone, gerente_phone_2').eq('user_id', userId),
        (supabase as any).from('conta_responsaveis')
          .select('nome, whatsapp, recebe_atendimento, recebe_trafego, recebe_alertas').eq('user_id', userId),
      ]);
      const members = membersRes.data || [];
      const agents = agentsRes.data || [];
      const resp = respRes.data || [];
      const agentName = new Map<string, string>(agents.map((a: any) => [a.id, a.name || 'Agente']));
      setAgentesDisp(agents.map((a: any) => ({ id: a.id, nome: a.name || 'Agente' })));
      // Conta só gerentes REAIS (ignora os placeholders internos 'gerente-<uuid>').
      setNGerentes(members.filter((m: any) => m.is_manager && !(m.whatsapp_number || '').startsWith('gerente-')).length);

      const map = new Map<string, Pessoa>();
      const ensure = (k: string, nome: string, wa: string, papel: Pessoa['papel']): Pessoa => {
        let p = map.get(k);
        if (!p) { p = { key: k, nome: nome || '', whatsapp: onlyDigits(wa), papel, email: null, authUserId: null, memberIds: [], acessos: [], aparece_paineis: false, agentes: [], recebe_atendimento: false, recebe_trafego: false, recebe_alertas: false }; map.set(k, p); }
        if (!p.nome && nome) p.nome = nome;
        return p;
      };
      for (const m of members) {
        const wn = m.whatsapp_number || '';
        if (!wn || wn.startsWith('gerente-')) {
          if (m.is_manager && wn.startsWith('gerente-')) continue; // placeholder legado
          if (!wn) continue;
        }
        const k = normalizePhoneBR(wn);
        if (!k) continue;
        const p = ensure(k, m.name || '', wn, m.is_manager ? 'gerente' : 'vendedor');
        if (m.is_manager) p.papel = 'gerente';
        if (!p.email && m.email) p.email = m.email;
        if (!p.authUserId && m.auth_user_id) p.authUserId = m.auth_user_id;
        if (m.id && !p.memberIds.includes(m.id)) p.memberIds.push(m.id);
        if (m.show_in_live !== false) p.aparece_paineis = true;
        for (const acesso of inferAcessos(m.visible_features, !!m.is_manager)) {
          if (!p.acessos.includes(acesso)) p.acessos.push(acesso);
        }
        if (m.agent_id) p.agentes.push({ agentId: m.agent_id, nome: agentName.get(m.agent_id) || 'Agente', memberId: m.id, ativo: !!m.is_active });
      }
      for (const a of agents) {
        for (const gp of [a.gerente_phone, a.gerente_phone_2]) {
          const k = normalizePhoneBR(gp); if (!k) continue;
          const p = ensure(k, 'Gerente', gp, 'gerente');
          if (p.papel !== 'vendedor') p.papel = 'gerente';
        }
      }
      for (const r of resp) {
        const k = normalizePhoneBR(r.whatsapp); if (!k) continue;
        const p = ensure(k, r.nome || '', r.whatsapp, 'externo');
        p.recebe_atendimento = !!r.recebe_atendimento; p.recebe_trafego = !!r.recebe_trafego; p.recebe_alertas = !!r.recebe_alertas;
      }
      for (const p of map.values()) p.agentes.sort((a, b) => a.nome.localeCompare(b.nome));
      const arr = [...map.values()].sort((a, b) => {
        const rank = (x: Pessoa) => (x.papel === 'gerente' ? 0 : x.papel === 'vendedor' ? 1 : 2);
        return rank(a) - rank(b) || a.nome.localeCompare(b.nome);
      });
      const memberIds = arr.flatMap((p) => p.memberIds);
      let statusByMember = new Map<string, InviteStatusInfo>();
      if (memberIds.length) {
        try {
          const { data, error } = await invokeWithReauth('seller-invite-status', { body: { memberIds } });
          if (!error && Array.isArray((data as any)?.statuses)) {
            statusByMember = new Map((data as any).statuses.map((s: InviteStatusInfo) => [s.member_id, s]));
          }
        } catch {
          // Status de convite nao pode derrubar a area de responsaveis.
        }
      }
      const enriched = arr.map((p) => ({
        ...p,
        ...melhorStatusConvite(p.memberIds.map((id) => statusByMember.get(id)).filter(Boolean) as InviteStatusInfo[], p.email),
      }));
      setPessoas(enriched);
      setInviteEmails((prev) => {
        const next = { ...prev };
        for (const p of enriched) if (p.email && next[p.key] === undefined) next[p.key] = p.email;
        return next;
      });
    } catch (e: any) {
      toast({ title: 'Erro ao carregar responsáveis', description: e?.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [userId, toast]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const toggleEntrega = async (p: Pessoa, campo: Entrega) => {
    const novo = !p[campo];
    setSaving(p.key + campo);
    setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, [campo]: novo } : x));
    try {
      const { error } = await (supabase as any).from('conta_responsaveis').upsert({
        user_id: userId, whatsapp: p.whatsapp, nome: p.nome || null, [campo]: novo,
      }, { onConflict: 'user_id,whatsapp' });
      if (error) throw error;
    } catch (e: any) {
      setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, [campo]: !novo } : x));
      toast({ title: 'Não deu pra salvar', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  const toggleLead = async (p: Pessoa, ag: AgenteLead) => {
    const novo = !ag.ativo;
    setSaving(p.key + ag.memberId);
    setPessoas((prev) => prev.map((x) => x.key !== p.key ? x : { ...x, agentes: x.agentes.map((a) => a.memberId === ag.memberId ? { ...a, ativo: novo } : a) }));
    try {
      const { error } = await (supabase as any).from('ai_team_members').update({ is_active: novo }).eq('id', ag.memberId);
      if (error) throw error;
    } catch (e: any) {
      setPessoas((prev) => prev.map((x) => x.key !== p.key ? x : { ...x, agentes: x.agentes.map((a) => a.memberId === ag.memberId ? { ...a, ativo: !novo } : a) }));
      toast({ title: 'Não deu pra alterar o lead', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  const toggleAcesso = async (p: Pessoa, acesso: Acesso) => {
    if (p.papel === 'gerente') {
      toast({ title: 'Gerente ja tem acesso total', description: 'Para restringir, cadastre como vendedor ou gestor de trafego.' });
      return;
    }
    if (p.memberIds.length === 0) {
      toast({ title: 'Esta pessoa ainda nao tem acesso ao painel', description: 'Adicione novamente com e-mail para criar o login antes de liberar acessos.', variant: 'destructive' });
      return;
    }

    const atual = new Set(p.acessos);
    atual.has(acesso) ? atual.delete(acesso) : atual.add(acesso);
    const acessos = [...atual] as Acesso[];
    const features = buildRestrictedFeatures(acessos);
    setSaving(p.key + acesso);
    setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, acessos } : x));
    try {
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ visible_features: features })
        .in('id', p.memberIds);
      if (error) throw error;
    } catch (e: any) {
      setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, acessos: p.acessos } : x));
      toast({ title: 'Nao deu pra alterar o acesso', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  const toggleAparecePaineis = async (p: Pessoa) => {
    // Vale pra TODO mundo (inclusive Gerente): é só a visibilidade no Painel ao Vivo,
    // campo dedicado show_in_live — NÃO mexe no acesso/ativo no sistema (active_in_system).
    if (p.memberIds.length === 0) {
      toast({ title: 'Esta pessoa ainda nao tem cadastro no painel', description: 'Adicione com e-mail para criar o acesso antes de configurar os paineis.', variant: 'destructive' });
      return;
    }

    const novo = !p.aparece_paineis;
    setSaving(p.key + 'paineis');
    setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, aparece_paineis: novo } : x));
    try {
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ show_in_live: novo })
        .in('id', p.memberIds);
      if (error) throw error;
    } catch (e: any) {
      setPessoas((prev) => prev.map((x) => x.key === p.key ? { ...x, aparece_paineis: p.aparece_paineis } : x));
      toast({ title: 'Nao deu pra alterar os paineis', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  const reenviarConvite = async (p: Pessoa) => {
    const email = (inviteEmails[p.key] || p.email || '').trim().toLowerCase();
    if (!p.memberIds.length) {
      toast({ title: 'Sem cadastro de acesso', description: 'Esta pessoa nao possui registro em ai_team_members para receber convite.', variant: 'destructive' });
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: 'Informe um e-mail valido', description: 'Preencha o campo de e-mail antes de reenviar o convite.', variant: 'destructive' });
      return;
    }

    setSaving(p.key + 'invite');
    try {
      const { error: updateErr } = await (supabase as any)
        .from('ai_team_members')
        .update({ email })
        .in('id', p.memberIds);
      if (updateErr) throw updateErr;

      const { data, error } = await invokeWithReauth('invite-seller', { body: { memberId: p.memberIds[0], email } });
      if (error) throw error;
      if ((data as any)?.success === false) throw new Error((data as any)?.error || 'Falha ao reenviar convite');

      await load();
      toast({ title: 'Convite reenviado', description: `Enviamos um novo link para ${email}.` });
    } catch (e: any) {
      toast({ title: 'Nao deu pra reenviar', description: e?.message || 'Falha ao enviar convite.', variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const setTipo = (tipo: Tipo) => {
    setNTipo(tipo);
    setNAcessos(defaultAcessosByTipo(tipo));
    setNAparecePaineis(tipo === 'vendedor');
    if (tipo !== 'vendedor') setNAgentes(new Set());
  };

  const resetForm = () => { setNNome(''); setNEmail(''); setNTel(''); setTipo('vendedor'); setNAgentes(new Set()); setNAparecePaineis(true); };

  const addResponsavel = async () => {
    const d = onlyDigits(nTel);
    if (!nNome.trim() || d.length < 10) { toast({ title: 'Preencha nome e um número válido (com DDD)', variant: 'destructive' }); return; }
    if (nTipo === 'gerente' && nGerentes >= 4) { toast({ title: 'Limite de 4 gerentes atingido', description: 'Remova um gerente antes de adicionar outro.', variant: 'destructive' }); return; }
    if (nTipo === 'vendedor' && agentesDisp.length && nAgentes.size === 0) { toast({ title: 'Escolha em qual agente o vendedor recebe leads', variant: 'destructive' }); return; }
    if (nTipo !== 'gerente' && nAcessos.size === 0) { toast({ title: 'Escolha pelo menos um acesso do painel', variant: 'destructive' }); return; }

    setSaving('add');
    try {
      let features: VisibleFeatures; let isManager = false; let rowsAgentes: (string | null)[];
      if (nTipo === 'vendedor') { features = buildRestrictedFeatures(nAcessos); rowsAgentes = nAgentes.size ? [...nAgentes] : (agentesDisp.length ? agentesDisp.map((a) => a.id) : [null]); }
      else if (nTipo === 'gerente') { features = GERENTE_FEATURES; isManager = true; rowsAgentes = [null]; }
      else { features = buildRestrictedFeatures(nAcessos); rowsAgentes = [null]; }

      let firstMemberId: string | null = null;
      for (const ag of rowsAgentes) {
        const { data, error } = await (supabase as any).from('ai_team_members').insert({
          user_id: userId, agent_id: ag, name: nNome.trim(), whatsapp_number: d,
          email: nEmail.trim() || null, visible_features: features,
          is_manager: isManager, is_active: nTipo === 'vendedor',
          active_in_system: true, // ao cadastrar, a pessoa entra ATIVA no sistema (acesso/CRM)
          show_in_live: isManager ? false : nAparecePaineis, // Painel ao Vivo: gerente oculto por padrão; vendedor conforme a escolha
        }).select('id').single();
        if (error) throw error;
        if (!firstMemberId) firstMemberId = data.id;
      }

      // Convite por e-mail (cria o login) — só se tiver e-mail.
      let convite = 'sem e-mail (sem convite de acesso)';
      if (nEmail.trim() && firstMemberId) {
        const { error: invErr } = await invokeWithReauth('invite-seller', { body: { memberId: firstMemberId, email: nEmail.trim() } });
        convite = invErr ? `cadastrado, mas o convite falhou: ${invErr.message}` : 'convite enviado por e-mail';
      }

      // Entregas padrão por tipo.
      const entregas = nTipo === 'gerente' ? { recebe_atendimento: true, recebe_alertas: true }
        : nTipo === 'trafego' ? { recebe_atendimento: nAcessos.has('pedro_ia') } : null;
      if (entregas) {
        await (supabase as any).from('conta_responsaveis').upsert({ user_id: userId, whatsapp: d, nome: nNome.trim(), ...entregas }, { onConflict: 'user_id,whatsapp' });
      }

      setAddOpen(false); resetForm(); await load();
      toast({ title: 'Responsável adicionado', description: convite });
    } catch (e: any) {
      toast({ title: 'Não deu pra adicionar', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  // Exclui o responsavel (edge delete-responsavel): so o master, casando o numero
  // COMPLETO, tira acesso/fila/paineis/entregas e mantem o historico dos leads.
  const excluirResponsavel = async () => {
    if (!delAlvo) return;
    setDelBusy(true);
    try {
      const { data, error } = await invokeWithReauth('delete-responsavel', { body: { whatsapp: delAlvo.whatsapp } });
      if (error) throw new Error((error as any)?.message || 'Falha ao excluir');
      if (data && (data as any).success === false) throw new Error((data as any).error || 'Falha ao excluir');
      setDelAlvo(null);
      await load();
      toast({ title: 'Responsável excluído', description: 'Os leads dele ficaram sem vendedor (o histórico foi mantido).' });
    } catch (e: any) {
      toast({ title: 'Não deu pra excluir', description: e?.message, variant: 'destructive' });
    } finally { setDelBusy(false); }
  };

  const papelLabel = (p: Pessoa) => p.papel === 'gerente' ? 'gerente / conta master' : p.papel === 'vendedor' ? 'vendedor' : 'parceiro externo';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground leading-tight">Responsáveis &amp; entregas</h3>
            <p className="text-xs text-muted-foreground">Cadastre a pessoa uma vez, defina o acesso e o que ela recebe.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Adicionar responsável
        </Button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Clique nos botões pra ligar/desligar. Leads são por agente; relatórios e alertas saem sempre do número da IA.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando responsáveis...
        </div>
      ) : pessoas.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Nenhum responsável ainda. Clique em “Adicionar responsável”.</div>
      ) : (
        <div className="rounded-xl border border-border/50 divide-y divide-border/50 overflow-hidden">
          {pessoas.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-4 px-3 py-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-[200px] flex-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${p.papel === 'gerente' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'}`}>
                  {p.papel === 'gerente' ? <Crown className="h-4 w-4" /> : iniciais(p.nome)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{p.nome || 'Sem nome'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{fmtTel(p.whatsapp)} · {papelLabel(p)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border ${statusConviteMeta(p.inviteStatus).cls}`} title="Status real do convite/acesso no Supabase Auth">
                  <Mail className="h-3 w-3" /> {statusConviteMeta(p.inviteStatus).label}
                </span>
                {ACESSOS.map(({ id, label, icon: Icon }) => {
                  const on = p.acessos.includes(id);
                  const busy = saving === p.key + id;
                  const disabled = busy || p.papel === 'gerente' || p.memberIds.length === 0;
                  return (
                    <button key={id} onClick={() => toggleAcesso(p, id)} disabled={disabled}
                      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-violet-500/15 text-violet-300 border-violet-500/40' : 'text-muted-foreground border-border/50 hover:bg-accent/40'} ${disabled ? 'opacity-60' : ''}`}
                      title={p.papel === 'gerente' ? 'Gerente tem acesso total' : p.memberIds.length === 0 ? 'Sem login criado para acessar o painel' : `${on ? 'Acessa' : 'Nao acessa'} ${label}`}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />} Acesso · {label}
                    </button>
                  );
                })}
                <button onClick={() => toggleAparecePaineis(p)} disabled={saving === p.key + 'paineis' || p.memberIds.length === 0}
                  className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${p.aparece_paineis ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'text-muted-foreground border-border/50 hover:bg-accent/40'} ${(saving === p.key + 'paineis' || p.memberIds.length === 0) ? 'opacity-60' : ''}`}
                  title={p.aparece_paineis ? 'Aparece no Painel ao Vivo e no Painel Geral (clique para ocultar)' : 'Oculto do Painel ao Vivo e do Painel Geral (clique para mostrar)'}>
                  {saving === p.key + 'paineis' ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
                  {p.aparece_paineis ? 'Aparece nos painéis' : 'Oculto dos painéis'}
                </button>
                {p.agentes.length > 0 ? p.agentes.map((ag) => {
                  const busy = saving === p.key + ag.memberId;
                  return (
                    <button key={ag.memberId} onClick={() => toggleLead(p, ag)} disabled={busy}
                      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${ag.ativo ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'text-muted-foreground border-border/50 hover:bg-accent/40'} ${busy ? 'opacity-60' : ''}`}
                      title={`${ag.ativo ? 'Recebe' : 'Não recebe'} lead no agente ${ag.nome}`}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />} Leads · {ag.nome}
                    </button>
                  );
                }) : (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border text-muted-foreground/60 border-border/40" title="Não é vendedor (não recebe leads)">
                    <Users className="h-3 w-3" /> Sem leads
                  </span>
                )}
                {ENTREGAS.map(({ campo, label, icon: Icon }) => {
                  const on = p[campo]; const busy = saving === p.key + campo;
                  return (
                    <button key={campo} onClick={() => toggleEntrega(p, campo)} disabled={busy}
                      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'text-muted-foreground border-border/50 hover:bg-accent/40'} ${busy ? 'opacity-60' : ''}`}
                      title={`${on ? 'Recebe' : 'Não recebe'} ${label}`}>
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />} {label}
                    </button>
                  );
                })}
                <button onClick={() => setDelAlvo(p)}
                  className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors"
                  title="Excluir este responsável (mantém o histórico dos leads)">
                  <Trash2 className="h-3 w-3" /> Excluir
                </button>
              </div>
              <div className="basis-full flex items-end gap-2 flex-wrap pl-0 sm:pl-12 pt-1">
                <div className="space-y-1 flex-1 min-w-[220px] max-w-xl">
                  <label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3 w-3" /> E-mail de acesso
                  </label>
                  <Input
                    value={inviteEmails[p.key] ?? p.email ?? ''}
                    onChange={(e) => setInviteEmails((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    placeholder="email@empresa.com"
                    inputMode="email"
                    className="h-9"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={p.inviteStatus === 'ativo' ? 'outline' : 'default'}
                  className="gap-1.5"
                  disabled={saving === p.key + 'invite' || p.memberIds.length === 0}
                  onClick={() => reenviarConvite(p)}
                >
                  {saving === p.key + 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Reenviar convite
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {p.lastSignInAt ? 'Ja acessou o painel.' : p.emailConfirmedAt ? 'Criou a conta, mas ainda nao acessou.' : 'Use para reenviar quando o link expirar.'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog: adicionar responsável (completo) */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); resetForm(); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[480px] max-h-[calc(100vh-2rem)] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>Adicionar responsável</DialogTitle>
            <DialogDescription>
              Cadastre a pessoa, escolha o tipo e mande o convite por e-mail pra ela criar o acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 py-1 pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={nNome} onChange={(e) => setNNome(e.target.value)} placeholder="Ex.: Ana Souza" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">WhatsApp (com DDD)</label>
                <Input value={nTel} onChange={(e) => setNTel(e.target.value)} placeholder="Ex.: 11 97777-1200" inputMode="tel" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" /> E-mail (pra criar o acesso ao painel)</label>
              <Input value={nEmail} onChange={(e) => setNEmail(e.target.value)} placeholder="ana@empresa.com" inputMode="email" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo de acesso</label>
              <div className="grid gap-2">
                {TIPOS.map((t) => {
                  const Icon = t.icon; const sel = nTipo === t.id;
                  const bloq = t.id === 'gerente' && nGerentes >= 4;
                  return (
                    <button key={t.id} type="button" disabled={bloq} onClick={() => setTipo(t.id)}
                      className={`flex items-center gap-3 text-left rounded-lg border px-3 py-2 transition-colors ${sel ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border/50 hover:bg-accent/40'} ${bloq ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <Icon className={`h-4 w-4 shrink-0 ${sel ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{t.label}{bloq ? ' (limite de 4)' : ''}</div>
                        <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                      </div>
                      {sel && <Check className="h-4 w-4 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
            {nTipo !== 'gerente' && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Acessos liberados no painel</label>
                <div className="grid gap-2">
                  {ACESSOS.map((a) => {
                    const Icon = a.icon;
                    const on = nAcessos.has(a.id);
                    return (
                      <button key={a.id} type="button"
                        onClick={() => setNAcessos((prev) => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}
                        className={`flex items-center gap-3 text-left rounded-lg border px-3 py-2 transition-colors ${on ? 'border-violet-500/50 bg-violet-500/10' : 'border-border/50 hover:bg-accent/40'}`}>
                        <Icon className={`h-4 w-4 shrink-0 ${on ? 'text-violet-300' : 'text-muted-foreground'}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">{a.label}</div>
                          <div className="text-[11px] text-muted-foreground">{a.desc}</div>
                        </div>
                        {on && <Check className="h-4 w-4 text-violet-300 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {nTipo !== 'gerente' && (
              <button type="button" onClick={() => setNAparecePaineis((v) => !v)}
                className={`flex items-center gap-3 text-left rounded-lg border px-3 py-2 transition-colors ${nAparecePaineis ? 'border-amber-500/50 bg-amber-500/10' : 'border-border/50 hover:bg-accent/40'}`}>
                <BarChart3 className={`h-4 w-4 shrink-0 ${nAparecePaineis ? 'text-amber-300' : 'text-muted-foreground'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">Aparecer no Painel ao Vivo e Painel Geral</div>
                  <div className="text-[11px] text-muted-foreground">Desligue para marketing/gestor que supervisiona, mas nao recebe lead nem entra em ranking.</div>
                </div>
                {nAparecePaineis && <Check className="h-4 w-4 text-amber-300 shrink-0" />}
              </button>
            )}
            {nTipo === 'vendedor' && agentesDisp.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Recebe leads em quais agentes</label>
                <div className="flex flex-wrap gap-2">
                  {agentesDisp.map((a) => {
                    const on = nAgentes.has(a.id);
                    return (
                      <button key={a.id} type="button"
                        onClick={() => setNAgentes((prev) => { const n = new Set(prev); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border transition-colors ${on ? 'bg-sky-500/15 text-sky-300 border-sky-500/40' : 'text-muted-foreground border-border/50 hover:bg-accent/40'}`}>
                        {on && <Check className="h-3 w-3" />} {a.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 gap-2 border-t border-border/50 pt-4">
            <Button variant="outline" size="sm" onClick={() => { setAddOpen(false); resetForm(); }} disabled={saving === 'add'}>Cancelar</Button>
            <Button size="sm" onClick={addResponsavel} disabled={saving === 'add'}>
              {saving === 'add' ? 'Adicionando...' : 'Adicionar e convidar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!delAlvo} onOpenChange={(o) => { if (!o && !delBusy) setDelAlvo(null); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Excluir responsável</DialogTitle>
            <DialogDescription>
              {delAlvo ? (
                <>
                  Tem certeza que quer excluir <strong className="text-foreground">{delAlvo.nome || 'este responsável'}</strong>
                  {' '}({fmtTel(delAlvo.whatsapp)})? Ele perde o acesso ao painel e sai da fila de leads. Os leads dele
                  ficam sem vendedor, mas <strong className="text-foreground">o histórico de leads e conversas é mantido</strong>. Não dá para desfazer.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDelAlvo(null)} disabled={delBusy}>Cancelar</Button>
            <Button variant="destructive" size="sm" onClick={excluirResponsavel} disabled={delBusy}>
              {delBusy ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Excluindo...</> : 'Excluir responsável'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
