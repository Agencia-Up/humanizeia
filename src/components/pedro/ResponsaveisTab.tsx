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
  Users, UserPlus, Loader2, FileText, BarChart3, Bell, Crown, Info, Mail, Radar, Check,
} from 'lucide-react';
import { DEFAULT_SELLER_FEATURES, type VisibleFeatures } from '@/hooks/useSellerProfile';

// ── Responsáveis & entregas ──────────────────────────────────────────────────
// Lugar ÚNICO de pessoas + acessos da conta (mora em Configurações). Adicionar
// alguém = escolher o tipo (vendedor/gerente/tráfego), mandar convite por e-mail
// (invite-seller: cria o login), liberar o acesso certo (visible_features) e ligar
// os agentes/entregas. Leads são por agente (ai_team_members.is_active); entregas
// (atendimento/tráfego/alertas) em conta_responsaveis.

interface Props { userId: string; }

type Entrega = 'recebe_atendimento' | 'recebe_trafego' | 'recebe_alertas';
type Tipo = 'vendedor' | 'gerente' | 'trafego';

interface AgenteLead { agentId: string; nome: string; memberId: string; ativo: boolean; }
interface Pessoa {
  key: string; nome: string; whatsapp: string;
  papel: 'gerente' | 'vendedor' | 'externo';
  agentes: AgenteLead[];
  recebe_atendimento: boolean; recebe_trafego: boolean; recebe_alertas: boolean;
}

const onlyDigits = (s?: string | null) => (s || '').replace(/\D/g, '');
const last8 = (s?: string | null) => onlyDigits(s).slice(-8);
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

// Presets de acesso (visible_features).
const featKeys = Object.keys(DEFAULT_SELLER_FEATURES) as (keyof VisibleFeatures)[];
const allTrue = (): VisibleFeatures => Object.fromEntries(featKeys.map((k) => [k, true])) as VisibleFeatures;
const allFalse = (): VisibleFeatures => Object.fromEntries(featKeys.map((k) => [k, false])) as VisibleFeatures;
const GERENTE_FEATURES = allTrue();                                           // acesso total
const TRAFEGO_FEATURES: VisibleFeatures = { ...allFalse(), agent_jose: true, sidebar_dashboard: true }; // só José

const ENTREGAS: { campo: Entrega; label: string; icon: typeof FileText }[] = [
  { campo: 'recebe_atendimento', label: 'Atendimento', icon: FileText },
  { campo: 'recebe_trafego', label: 'Tráfego (José)', icon: BarChart3 },
  { campo: 'recebe_alertas', label: 'Alertas', icon: Bell },
];

const TIPOS: { id: Tipo; label: string; desc: string; icon: typeof Users }[] = [
  { id: 'vendedor', label: 'Vendedor', desc: 'Recebe leads. Acessa Pedro + Marcos.', icon: Users },
  { id: 'gerente', label: 'Gerente', desc: 'Acesso total ao painel + recebe relatórios.', icon: Crown },
  { id: 'trafego', label: 'Só tráfego pago', desc: 'Acessa só o José. Recebe o relatório do tráfego.', icon: Radar },
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
  const [nAgentes, setNAgentes] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, agentsRes, respRes] = await Promise.all([
        (supabase as any).from('ai_team_members')
          .select('id, name, whatsapp_number, is_manager, is_active, agent_id').eq('user_id', userId),
        (supabase as any).from('wa_ai_agents').select('id, name, gerente_phone, gerente_phone_2').eq('user_id', userId),
        (supabase as any).from('conta_responsaveis')
          .select('nome, whatsapp, recebe_atendimento, recebe_trafego, recebe_alertas').eq('user_id', userId),
      ]);
      const members = membersRes.data || [];
      const agents = agentsRes.data || [];
      const resp = respRes.data || [];
      const agentName = new Map<string, string>(agents.map((a: any) => [a.id, a.name || 'Agente']));
      setAgentesDisp(agents.map((a: any) => ({ id: a.id, nome: a.name || 'Agente' })));
      setNGerentes(members.filter((m: any) => m.is_manager).length);

      const map = new Map<string, Pessoa>();
      const ensure = (k: string, nome: string, wa: string, papel: Pessoa['papel']): Pessoa => {
        let p = map.get(k);
        if (!p) { p = { key: k, nome: nome || '', whatsapp: onlyDigits(wa), papel, agentes: [], recebe_atendimento: false, recebe_trafego: false, recebe_alertas: false }; map.set(k, p); }
        if (!p.nome && nome) p.nome = nome;
        return p;
      };
      for (const m of members) {
        const wn = m.whatsapp_number || '';
        if (!wn || wn.startsWith('gerente-')) {
          if (m.is_manager && wn.startsWith('gerente-')) continue; // placeholder legado
          if (!wn) continue;
        }
        const k = last8(wn);
        if (!k) continue;
        const p = ensure(k, m.name || '', wn, m.is_manager ? 'gerente' : 'vendedor');
        if (m.is_manager) p.papel = 'gerente';
        if (m.agent_id) p.agentes.push({ agentId: m.agent_id, nome: agentName.get(m.agent_id) || 'Agente', memberId: m.id, ativo: !!m.is_active });
      }
      for (const a of agents) {
        for (const gp of [a.gerente_phone, a.gerente_phone_2]) {
          const k = last8(gp); if (!k) continue;
          const p = ensure(k, 'Gerente', gp, 'gerente');
          if (p.papel !== 'vendedor') p.papel = 'gerente';
        }
      }
      for (const r of resp) {
        const k = last8(r.whatsapp); if (!k) continue;
        const p = ensure(k, r.nome || '', r.whatsapp, 'externo');
        p.recebe_atendimento = !!r.recebe_atendimento; p.recebe_trafego = !!r.recebe_trafego; p.recebe_alertas = !!r.recebe_alertas;
      }
      for (const p of map.values()) p.agentes.sort((a, b) => a.nome.localeCompare(b.nome));
      const arr = [...map.values()].sort((a, b) => {
        const rank = (x: Pessoa) => (x.papel === 'gerente' ? 0 : x.papel === 'vendedor' ? 1 : 2);
        return rank(a) - rank(b) || a.nome.localeCompare(b.nome);
      });
      setPessoas(arr);
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

  const resetForm = () => { setNNome(''); setNEmail(''); setNTel(''); setNTipo('vendedor'); setNAgentes(new Set()); };

  const addResponsavel = async () => {
    const d = onlyDigits(nTel);
    if (!nNome.trim() || d.length < 10) { toast({ title: 'Preencha nome e um número válido (com DDD)', variant: 'destructive' }); return; }
    if (nTipo === 'gerente' && nGerentes >= 4) { toast({ title: 'Limite de 4 gerentes atingido', description: 'Remova um gerente antes de adicionar outro.', variant: 'destructive' }); return; }
    if (nTipo === 'vendedor' && agentesDisp.length && nAgentes.size === 0) { toast({ title: 'Escolha em qual agente o vendedor recebe leads', variant: 'destructive' }); return; }

    setSaving('add');
    try {
      let features: VisibleFeatures; let isManager = false; let rowsAgentes: (string | null)[];
      if (nTipo === 'vendedor') { features = { ...DEFAULT_SELLER_FEATURES }; rowsAgentes = nAgentes.size ? [...nAgentes] : (agentesDisp.length ? agentesDisp.map((a) => a.id) : [null]); }
      else if (nTipo === 'gerente') { features = GERENTE_FEATURES; isManager = true; rowsAgentes = [null]; }
      else { features = TRAFEGO_FEATURES; rowsAgentes = [null]; }

      let firstMemberId: string | null = null;
      for (const ag of rowsAgentes) {
        const { data, error } = await (supabase as any).from('ai_team_members').insert({
          user_id: userId, agent_id: ag, name: nNome.trim(), whatsapp_number: d,
          email: nEmail.trim() || null, visible_features: features,
          is_manager: isManager, is_active: nTipo === 'vendedor', active_in_system: true,
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
      const entregas = nTipo === 'gerente' ? { recebe_atendimento: true, recebe_trafego: true, recebe_alertas: true }
        : nTipo === 'trafego' ? { recebe_trafego: true } : null;
      if (entregas) {
        await (supabase as any).from('conta_responsaveis').upsert({ user_id: userId, whatsapp: d, nome: nNome.trim(), ...entregas }, { onConflict: 'user_id,whatsapp' });
      }

      setAddOpen(false); resetForm(); await load();
      toast({ title: 'Responsável adicionado', description: convite });
    } catch (e: any) {
      toast({ title: 'Não deu pra adicionar', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog: adicionar responsável (completo) */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) { setAddOpen(false); resetForm(); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Adicionar responsável</DialogTitle>
            <DialogDescription>
              Cadastre a pessoa, escolha o tipo e mande o convite por e-mail pra ela criar o acesso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
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
                    <button key={t.id} type="button" disabled={bloq} onClick={() => setNTipo(t.id)}
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
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setAddOpen(false); resetForm(); }} disabled={saving === 'add'}>Cancelar</Button>
            <Button size="sm" onClick={addResponsavel} disabled={saving === 'add'}>
              {saving === 'add' ? 'Adicionando...' : 'Adicionar e convidar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
