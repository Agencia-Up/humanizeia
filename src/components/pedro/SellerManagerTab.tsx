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
  Crown, Save, Mail, Send, Shield, StickyNote, Eye, Settings2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { DEFAULT_SELLER_FEATURES, type VisibleFeatures } from '@/hooks/useSellerProfile';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface SellerManagerTabProps {
  userId: string;
}

interface SellerMember {
  id: string;
  name: string;
  whatsapp_number: string;
  email: string | null;
  is_active: boolean;
  auth_user_id: string | null;
  agent_id: string | null;
  total_leads_received: number;
  last_lead_received_at: string | null;
  created_at: string;
  visible_features: VisibleFeatures | null;
}

// ── Mapeamento de features para labels legíveis ────────────────────────────
const FEATURE_LABELS: { key: keyof VisibleFeatures; label: string; group: 'tab' | 'sidebar' }[] = [
  { key: 'tab_crm',            label: 'Meus Leads (CRM)',        group: 'tab' },
  { key: 'tab_inbox',          label: 'Inbox',                   group: 'tab' },
  { key: 'tab_performance',    label: 'Performance',             group: 'tab' },
  { key: 'tab_agente_ia',      label: 'Agente IA',               group: 'tab' },
  { key: 'tab_crm_ao_vivo',    label: 'CRM ao Vivo',             group: 'tab' },
  { key: 'tab_instancias',     label: 'Instâncias WhatsApp',     group: 'tab' },
  { key: 'tab_vendedores',     label: 'Vendedores',              group: 'tab' },
  { key: 'sidebar_dashboard',     label: 'Dashboard',            group: 'sidebar' },
  { key: 'sidebar_treinamento',   label: 'Treinamento',          group: 'sidebar' },
  { key: 'sidebar_meu_plano',     label: 'Meu Plano',            group: 'sidebar' },
  { key: 'sidebar_integracoes',   label: 'Integrações',          group: 'sidebar' },
  { key: 'sidebar_configuracoes', label: 'Configurações',        group: 'sidebar' },
];

export function SellerManagerTab({ userId }: SellerManagerTabProps) {
  const { toast } = useToast();
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

  // Feature config dialog state
  const [configSellerId, setConfigSellerId] = useState<string | null>(null);
  const [configFeatures, setConfigFeatures] = useState<VisibleFeatures>({ ...DEFAULT_SELLER_FEATURES });
  const [savingConfig, setSavingConfig] = useState(false);

  const handleOpenConfig = (s: SellerMember) => {
    setConfigSellerId(s.id);
    setConfigFeatures({ ...DEFAULT_SELLER_FEATURES, ...(s.visible_features || {}) });
  };

  const handleToggleFeature = (key: keyof VisibleFeatures) => {
    setConfigFeatures(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSaveConfig = async () => {
    if (!configSellerId) return;
    setSavingConfig(true);
    try {
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ visible_features: configFeatures })
        .eq('id', configSellerId);
      if (error) throw error;
      // Update local state
      setSellers(prev => prev.map(s =>
        s.id === configSellerId ? { ...s, visible_features: configFeatures } : s
      ));
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
          .select('id, name, whatsapp_number, email, is_active, auth_user_id, agent_id, total_leads_received, last_lead_received_at, created_at, visible_features')
          .eq('user_id', userId)
          .order('created_at', { ascending: true }),
        (supabase as any)
          .from('wa_ai_agents')
          .select('id, name')
          .eq('user_id', userId),
      ]);

      // Deduplicate by whatsapp_number
      const deduped = new Map<string, SellerMember>();
      for (const s of (sellersRes.data || [])) {
        const key = s.whatsapp_number || s.id;
        if (!deduped.has(key)) {
          deduped.set(key, s);
        }
      }
      setSellers(Array.from(deduped.values()));
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
    setSaving(true);
    try {
      const cleanPhone = newPhone.replace(/\D/g, '');
      const { error } = await (supabase as any).from('ai_team_members').insert({
        user_id: userId,
        agent_id: newAgentId || null,
        name: newName.trim(),
        whatsapp_number: cleanPhone,
        email: newEmail.trim() || null,
      });
      if (error) throw error;
      toast({ title: '✅ Vendedor cadastrado!' });
      setNewName(''); setNewPhone(''); setNewEmail(''); setNewAgentId('');
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
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
      if (error) throw error;
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

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await (supabase as any).from('ai_team_members').update({ is_active: !current }).eq('id', id);
      setSellers(prev => prev.map(s => s.id === id ? { ...s, is_active: !current } : s));
      toast({ title: current ? '⛔ Vendedor pausado' : '✅ Vendedor ativado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir este vendedor da equipe? Esta ação não pode ser desfeita.')) return;
    try {
      await (supabase as any).from('ai_team_members').delete().eq('id', id);
      setSellers(prev => prev.filter(s => s.id !== id));
      toast({ title: 'Vendedor removido' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
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
                      <Button size="sm" className="h-8 w-8 p-0 bg-green-600 hover:bg-green-700"
                        onClick={() => handleSaveEdit(s.id)} disabled={savingEdit}>
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleCancelEdit}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            s.is_active
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-muted text-muted-foreground border border-border/40'
                          }`}>
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{s.name}</p>
                              {s.is_active ? (
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
                            <p className="text-sm font-bold text-foreground leading-none">{s.total_leads_received}</p>
                            <p className="text-[10px] text-muted-foreground">leads</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer" htmlFor={`act-${s.id}`}>
                              {s.is_active ? 'Ativo' : 'Pausado'}
                            </Label>
                            <Switch id={`act-${s.id}`} checked={s.is_active}
                              onCheckedChange={() => handleToggleActive(s.id, s.is_active)} className="scale-90" />
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
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Conta ativa
                          </span>
                          {s.email && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Mail className="h-2.5 w-2.5" /> {s.email}
                            </span>
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

      {/* ── Dialog: Configurar Painel do Vendedor ── */}
      <Dialog open={!!configSellerId} onOpenChange={open => !open && setConfigSellerId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-violet-400" />
              Configurar Painel do Vendedor
            </DialogTitle>
            <DialogDescription className="text-xs">
              Selecione o que este vendedor poderá ver no painel dele. As alterações são aplicadas imediatamente ao salvar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Tabs do Pedro */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Abas do Painel (Pedro SDR)
              </p>
              <div className="space-y-2">
                {FEATURE_LABELS.filter(f => f.group === 'tab').map(f => (
                  <div key={f.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                    <span className="text-sm text-foreground">{f.label}</span>
                    <Switch
                      checked={configFeatures[f.key]}
                      onCheckedChange={() => handleToggleFeature(f.key)}
                      className="scale-90"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Menu Lateral (Sidebar)
              </p>
              <div className="space-y-2">
                {FEATURE_LABELS.filter(f => f.group === 'sidebar').map(f => (
                  <div key={f.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                    <span className="text-sm text-foreground">{f.label}</span>
                    <Switch
                      checked={configFeatures[f.key]}
                      onCheckedChange={() => handleToggleFeature(f.key)}
                      className="scale-90"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setConfigSellerId(null)} className="text-xs">
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig}
              className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-4">
              {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Salvar Configuração
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
