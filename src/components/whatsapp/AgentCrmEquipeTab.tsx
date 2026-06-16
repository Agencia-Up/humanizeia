import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Users, UserPlus, UserCheck, Phone, Loader2, Trash2, PhoneForwarded, Pencil, Check, X, Crown, Save, Mail, Send, RefreshCw, Plus } from 'lucide-react';
import { Label } from '@/components/ui/label';

interface AgentCrmEquipeTabProps {
  agentId: string | null;
  userId: string;
}

// Telefone só com dígitos (chave de comparação/dedupe do vendedor).
const normPhone = (p: string) => (p || '').replace(/\D/g, '');

export function AgentCrmEquipeTab({ agentId, userId }: AgentCrmEquipeTabProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  // Equipe State — DESTE agente (cada agente tem seu próprio time)
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  // Vendedores de OUTROS agentes da conta (para reaproveitar sem redigitar)
  const [otherSellers, setOtherSellers] = useState<any[]>([]);
  const [reusingId, setReusingId] = useState<string | null>(null);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerPhone, setNewSellerPhone] = useState('');
  const [newSellerEmail, setNewSellerEmail] = useState('');
  const [savingSeller, setSavingSeller] = useState(false);

  // Invite state
  const [invitingMemberId, setInvitingMemberId] = useState<string | null>(null);
  const [inviteEmailInputs, setInviteEmailInputs] = useState<Record<string, string>>({});

  // Gerente (manager) phone state — ate 2 gerentes recebem os relatorios
  const [gerentePhone, setGerentePhone] = useState('');
  const [gerentePhone2, setGerentePhone2] = useState('');
  const [showGerente2, setShowGerente2] = useState(false);
  const [savingGerente, setSavingGerente] = useState(false);

  // Estado de edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchData = useCallback(async () => {
    if (!agentId || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // EQUIPE = POR AGENTE: carrega só os vendedores DESTE agente. Cada agente
      // (cada loja/número) tem seu próprio time, sem vazar pro outro.
      const [{ data: teamData, error: teamErr }, { data: allData }, { data: agentData }] = await Promise.all([
        (supabase as any).from('ai_team_members').select('*').eq('agent_id', agentId).order('created_at', { ascending: true }),
        // Para o botão "reaproveitar": vendedores da conta que estão em OUTROS agentes.
        (supabase as any).from('ai_team_members').select('id, name, whatsapp_number, email, auth_user_id, agent_id').eq('user_id', userId),
        (supabase as any).from('wa_ai_agents').select('gerente_phone, gerente_phone_2').eq('id', agentId).single(),
      ]);

      if (teamErr) throw teamErr;
      setTeamMembers(teamData || []);

      // Outros vendedores (de outros agentes), deduplicados por telefone e sem os que já estão aqui.
      const thisPhones = new Set((teamData || []).map((m: any) => normPhone(m.whatsapp_number)));
      const seen = new Set<string>();
      const others: any[] = [];
      for (const m of (allData || [])) {
        const k = normPhone(m.whatsapp_number);
        if (!k || thisPhones.has(k) || seen.has(k)) continue;
        seen.add(k);
        others.push(m);
      }
      setOtherSellers(others);

      setGerentePhone(agentData?.gerente_phone || '');
      setGerentePhone2(agentData?.gerente_phone_2 || '');
      setShowGerente2(!!(agentData?.gerente_phone_2));

    } catch (err: any) {
      console.error('Erro ao carregar Equipe:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddSeller = async () => {
    if (!agentId) return;
    if (!newSellerName.trim() || !newSellerPhone.trim()) {
      toast({ title: 'Aviso', description: 'Preencha nome e WhatsApp do vendedor.' });
      return;
    }

    const cleanPhone = newSellerPhone.replace(/\D/g, ''); // Apenas números
    // Trava: não duplica o mesmo telefone DENTRO deste agente.
    if (teamMembers.some(m => normPhone(m.whatsapp_number) === cleanPhone)) {
      toast({ title: 'Esse vendedor já está neste agente' });
      return;
    }

    setSavingSeller(true);
    try {
      const { error } = await (supabase as any).from('ai_team_members').insert({
        user_id: userId,
        agent_id: agentId, // POR AGENTE: o vendedor recebe leads SÓ deste agente
        name: newSellerName.trim(),
        whatsapp_number: cleanPhone,
        email: newSellerEmail.trim() || null,
      });

      if (error) throw error;

      toast({ title: 'Vendedor adicionado!' });
      setNewSellerName('');
      setNewSellerPhone('');
      setNewSellerEmail('');
      fetchData();
    } catch (err: any) {
      const dup = /duplicate key|unique|23505/i.test(err?.message || '');
      toast({ title: dup ? 'Esse vendedor já está neste agente' : 'Erro', description: dup ? undefined : err.message, variant: dup ? undefined : 'destructive' });
    } finally {
      setSavingSeller(false);
    }
  };

  // Reaproveita um vendedor já cadastrado em OUTRO agente, sem redigitar — cria a
  // linha deste agente copiando nome/telefone/e-mail/conta. Times seguem separados.
  const handleReuseSeller = async (src: any) => {
    if (!agentId) return;
    const cleanPhone = normPhone(src.whatsapp_number);
    if (teamMembers.some(m => normPhone(m.whatsapp_number) === cleanPhone)) return;
    setReusingId(src.id);
    try {
      const { error } = await (supabase as any).from('ai_team_members').insert({
        user_id: userId,
        agent_id: agentId,
        name: src.name,
        whatsapp_number: cleanPhone,
        email: src.email || null,
        auth_user_id: src.auth_user_id || null,
        is_active: true,
      });
      if (error) throw error;
      toast({ title: 'Vendedor adicionado a este agente' });
      fetchData();
    } catch (err: any) {
      const dup = /duplicate key|unique|23505/i.test(err?.message || '');
      toast({ title: dup ? 'Já está neste agente' : 'Erro', description: dup ? undefined : err.message, variant: dup ? undefined : 'destructive' });
    } finally {
      setReusingId(null);
    }
  };

  const handleInviteSeller = async (member: any) => {
    const email = inviteEmailInputs[member.id] || member.email || '';
    if (!email.trim()) {
      toast({ title: 'Aviso', description: 'Digite o e-mail do vendedor para enviar o convite.' });
      return;
    }
    setInvitingMemberId(member.id);
    try {
      const { data, error } = await supabase.functions.invoke('invite-seller', {
        body: { memberId: member.id, email: email.trim() },
      });
      if (error) throw error;
      toast({ title: data?.action === 'linked' ? '🔗 Conta vinculada!' : '✅ Convite enviado!', description: data?.message || '' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro ao convidar', description: err.message, variant: 'destructive' });
    } finally {
      setInvitingMemberId(null);
    }
  };

  const handleToggleSellerStatus = async (id: string, currentStatus: boolean) => {
    try {
      await (supabase as any).from('ai_team_members').update({ is_active: !currentStatus }).eq('id', id);
      setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, is_active: !currentStatus } : m));
    } catch (err: any) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const handleSaveGerente = async () => {
    if (!agentId) return;
    setSavingGerente(true);
    try {
      const cleanPhone = gerentePhone.replace(/\D/g, '');
      const cleanPhone2 = (showGerente2 ? gerentePhone2 : '').replace(/\D/g, '');
      const { error } = await (supabase as any)
        .from('wa_ai_agents')
        .update({ gerente_phone: cleanPhone || null, gerente_phone_2: cleanPhone2 || null })
        .eq('id', agentId);
      if (error) throw error;
      setGerentePhone(cleanPhone);
      setGerentePhone2(cleanPhone2);
      toast({ title: '✅ Gerente(s) salvo(s)!', description: 'Recebem relatório a cada transferência de lead.' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar gerente', description: err.message, variant: 'destructive' });
    } finally {
      setSavingGerente(false);
    }
  };

  const handleDeleteSeller = async (id: string) => {
    if (!confirm('Excluir este vendedor da equipe?')) return;
    try {
      await (supabase as any).from('ai_team_members').delete().eq('id', id);
      setTeamMembers(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Vendedor removido' });
    } catch (err: any) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const handleStartEdit = (member: any) => {
    setEditingId(member.id);
    setEditName(member.name);
    setEditPhone(member.whatsapp_number);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPhone('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editName.trim() || !editPhone.trim()) {
      toast({ title: 'Aviso', description: 'Preencha nome e WhatsApp.' });
      return;
    }
    setSavingEdit(true);
    try {
      const cleanPhone = editPhone.replace(/\D/g, '');
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ name: editName.trim(), whatsapp_number: cleanPhone })
        .eq('id', id);
      if (error) throw error;
      setTeamMembers(prev =>
        prev.map(m => m.id === id ? { ...m, name: editName.trim(), whatsapp_number: cleanPhone } : m)
      );
      toast({ title: '✅ Vendedor atualizado!' });
      handleCancelEdit();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSavingEdit(false);
    }
  };

  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/20 border border-dashed rounded-xl">
        <Users className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
        <h3 className="text-sm font-semibold mb-1">Salve o agente primeiro</h3>
        <p className="text-xs text-muted-foreground max-w-[250px]">
          Você precisa criar o agente antes de cadastrar a equipe de transbordo.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
        <PhoneForwarded className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Equipe deste agente:</strong> os vendedores abaixo recebem os leads <strong>somente deste agente</strong> (deste número/loja). Cada agente tem o seu próprio time — o que você cadastra aqui não vai para os outros agentes. Quando o Pedro qualificar um lead, ele encaminha o resumo para um destes vendedores.
        </div>
      </div>

      {/* ── GERENTE — Relatório automático ──────────────── */}
      <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
        <div className="flex items-center gap-2">
          <Crown className="h-4 w-4 text-amber-400" />
          <h4 className="text-sm font-semibold text-amber-300">WhatsApp do Gerente</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          A cada lead transferido para um vendedor, o(s) gerente(s) receberão um relatório automático via WhatsApp com nome do lead, vendedor designado e hora da transferência. Até 2 gerentes.
        </p>
        <div className="space-y-2">
          {/* 1º gerente */}
          <div className="flex gap-2 items-center">
            <Input
              placeholder="1º gerente — Ex: 5511999990000 (com DDI)"
              value={gerentePhone}
              onChange={e => setGerentePhone(e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
            {!showGerente2 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 shrink-0 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                onClick={() => setShowGerente2(true)}
                title="Adicionar 2º gerente"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
          {/* 2º gerente (opcional) */}
          {showGerente2 && (
            <div className="flex gap-2 items-center">
              <Input
                placeholder="2º gerente (opcional) — Ex: 5511988880000"
                value={gerentePhone2}
                onChange={e => setGerentePhone2(e.target.value)}
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => { setShowGerente2(false); setGerentePhone2(''); }}
                title="Remover 2º gerente"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Button
            size="sm"
            className="h-8 px-4 w-full bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleSaveGerente}
            disabled={savingGerente}
          >
            {savingGerente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Salvar gerente(s)
          </Button>
        </div>
        {(gerentePhone || (showGerente2 && gerentePhone2)) && (
          <p className="text-[10px] text-amber-400/70">
            ✅ Gerente(s): {[gerentePhone, showGerente2 ? gerentePhone2 : ''].filter(Boolean).join('  ·  ')}
          </p>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-muted/30 p-3 rounded-xl border border-border flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[140px] space-y-1">
            <Label className="text-xs">Nome do Vendedor</Label>
            <Input
              placeholder="Ex: João Silva"
              value={newSellerName}
              onChange={e => setNewSellerName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1 min-w-[140px] space-y-1">
            <Label className="text-xs">Número WhatsApp</Label>
            <Input
              placeholder="Ex: 5511999999999"
              value={newSellerPhone}
              onChange={e => setNewSellerPhone(e.target.value)}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="flex-1 min-w-[160px] space-y-1">
            <Label className="text-xs">E-mail (opcional)</Label>
            <Input
              placeholder="Ex: joao@empresa.com"
              value={newSellerEmail}
              onChange={e => setNewSellerEmail(e.target.value)}
              className="h-8 text-xs"
              type="email"
            />
          </div>
          <Button size="sm" className="h-8 px-4 shrink-0 bg-blue-600 hover:bg-blue-700" onClick={handleAddSeller} disabled={savingSeller}>
            {savingSeller ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
            Adicionar
          </Button>
        </div>

        {/* ── Reaproveitar vendedor de outro agente (sem redigitar) ── */}
        {otherSellers.length > 0 && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-violet-300">
              <UserCheck className="h-4 w-4" /> Reaproveitar vendedor de outro agente
            </div>
            <p className="text-[11px] text-muted-foreground">
              Clique para adicionar a ESTE agente sem digitar de novo. Os times continuam separados por agente.
            </p>
            <div className="flex flex-wrap gap-2">
              {otherSellers.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleReuseSeller(s)}
                  disabled={reusingId === s.id}
                  className="text-xs px-2.5 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 flex items-center gap-1 disabled:opacity-50"
                  title="Adicionar este vendedor a este agente"
                >
                  {reusingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  {s.name} <span className="font-mono opacity-70">{s.whatsapp_number}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {teamMembers.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              A equipe deste agente está vazia.<br/>Adicione membros para permitir o transbordo ("Handoff") do Agente de IA.
            </div>
          ) : (
            teamMembers.map(member => {
              const isEditing = editingId === member.id;
              return (
                <div key={member.id} className={`p-3 border rounded-lg bg-card transition-colors ${isEditing ? 'border-blue-500/60 bg-blue-500/5' : 'group hover:border-blue-500/30'}`}>

                  {isEditing ? (
                    /* ── Modo edição inline ─────────────────────────── */
                    <div className="flex items-center gap-2">
                      <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Pencil className="h-4 w-4 text-blue-500" />
                      </div>
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        placeholder="Nome"
                        className="h-8 text-xs flex-1"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleSaveEdit(member.id)}
                      />
                      <Input
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        placeholder="Número WhatsApp"
                        className="h-8 text-xs flex-1 font-mono"
                        onKeyDown={e => e.key === 'Enter' && handleSaveEdit(member.id)}
                      />
                      <Button
                        size="sm"
                        className="h-8 w-8 p-0 bg-green-600 hover:bg-green-700 shrink-0"
                        onClick={() => handleSaveEdit(member.id)}
                        disabled={savingEdit}
                        title="Salvar"
                      >
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={handleCancelEdit}
                        title="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    /* ── Modo visualização ──────────────────────────── */
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                            <UserPlus className="h-4 w-4 text-blue-500" />
                          </div>
                          <div>
                            <h5 className="text-sm font-semibold">{member.name}</h5>
                            <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono mt-0.5">
                              <Phone className="h-3 w-3" /> {member.whatsapp_number}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer" htmlFor={`status-${member.id}`}>
                              {member.is_active ? 'Disponível' : 'Ausente'}
                            </Label>
                            <Switch
                              id={`status-${member.id}`}
                              checked={member.is_active}
                              onCheckedChange={() => handleToggleSellerStatus(member.id, member.is_active)}
                              className="scale-90"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-blue-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleStartEdit(member)}
                            title="Editar nome e número"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDeleteSeller(member.id)}
                            title="Excluir vendedor"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* ── Invite section ── */}
                      {member.auth_user_id ? (
                        <div className="flex items-center gap-2 mt-1 px-1 flex-wrap">
                          <span className="text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2 py-0.5 flex items-center gap-1">
                            <Check className="h-2.5 w-2.5" /> Conta ativa
                          </span>
                          {member.email && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Mail className="h-2.5 w-2.5" /> {member.email}
                            </span>
                          )}
                          {member.email && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 px-2 text-[10px] text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 border border-violet-500/20 rounded-full"
                              onClick={() => handleInviteSeller(member)}
                              disabled={invitingMemberId === member.id}
                              title="Reenviar e-mail de convite para criar senha"
                            >
                              {invitingMemberId === member.id
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                                : <RefreshCw className="h-2.5 w-2.5 mr-1" />}
                              Reenviar convite
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            placeholder="E-mail para convite..."
                            value={inviteEmailInputs[member.id] ?? (member.email || '')}
                            onChange={e => setInviteEmailInputs(prev => ({ ...prev, [member.id]: e.target.value }))}
                            className="h-7 text-xs flex-1"
                            type="email"
                          />
                          <Button
                            size="sm"
                            className="h-7 px-3 shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-xs"
                            onClick={() => handleInviteSeller(member)}
                            disabled={invitingMemberId === member.id}
                            title="Enviar convite por e-mail"
                          >
                            {invitingMemberId === member.id
                              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              : <Send className="h-3 w-3 mr-1" />}
                            Convidar
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
