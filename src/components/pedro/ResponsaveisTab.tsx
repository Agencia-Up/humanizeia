import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Users, UserPlus, Loader2, FileText, BarChart3, Bell, Crown, Info,
} from 'lucide-react';

// ── Responsáveis & entregas ──────────────────────────────────────────────────
// Fonte ÚNICA de "quem recebe o quê" na conta. Cada pessoa aparece UMA vez
// (dedup pelos últimos 8 dígitos do WhatsApp); as entregas de conta (relatório
// de atendimento do Cérebro, relatório do tráfego do José, alertas) ficam em
// `conta_responsaveis`. Os leads continuam na matriz por agente (aba Vendedores),
// aqui aparecem só como referência. Substitui o número do gerente espalhado em
// wa_ai_agents.gerente_phone / feedback_config.numero_gerente.

interface Props { userId: string; }

type Entrega = 'recebe_atendimento' | 'recebe_trafego' | 'recebe_alertas';

interface Pessoa {
  key: string;              // últimos 8 dígitos (chave de pessoa)
  nome: string;
  whatsapp: string;         // dígitos canônicos
  papel: 'gerente' | 'vendedor' | 'externo';
  agentesLead: string[];    // agentes onde recebe lead (is_active)
  recebe_atendimento: boolean;
  recebe_trafego: boolean;
  recebe_alertas: boolean;
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

const ENTREGAS: { campo: Entrega; label: string; icon: typeof FileText }[] = [
  { campo: 'recebe_atendimento', label: 'Atendimento', icon: FileText },
  { campo: 'recebe_trafego', label: 'Tráfego (José)', icon: BarChart3 },
  { campo: 'recebe_alertas', label: 'Alertas', icon: Bell },
];

export function ResponsaveisTab({ userId }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoTel, setNovoTel] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, agentsRes, respRes] = await Promise.all([
        (supabase as any).from('ai_team_members')
          .select('name, whatsapp_number, is_manager, is_active, agent_id').eq('user_id', userId),
        (supabase as any).from('wa_ai_agents')
          .select('id, name, gerente_phone, gerente_phone_2').eq('user_id', userId),
        (supabase as any).from('conta_responsaveis')
          .select('nome, whatsapp, recebe_atendimento, recebe_trafego, recebe_alertas').eq('user_id', userId),
      ]);
      const members = membersRes.data || [];
      const agents = agentsRes.data || [];
      const resp = respRes.data || [];
      const agentName = new Map<string, string>(agents.map((a: any) => [a.id, a.name || 'Agente']));

      const map = new Map<string, Pessoa>();
      const ensure = (k: string, nome: string, wa: string, papel: Pessoa['papel']): Pessoa => {
        let p = map.get(k);
        if (!p) {
          p = { key: k, nome: nome || '', whatsapp: onlyDigits(wa), papel,
            agentesLead: [], recebe_atendimento: false, recebe_trafego: false, recebe_alertas: false };
          map.set(k, p);
        }
        if (!p.nome && nome) p.nome = nome;
        return p;
      };

      // 1) Vendedores (números reais; ignora o placeholder do Gerente).
      for (const m of members) {
        const wn = m.whatsapp_number || '';
        if (!wn || wn.startsWith('gerente-')) continue;
        const k = last8(wn);
        if (!k) continue;
        const p = ensure(k, m.name || '', wn, 'vendedor');
        if (m.is_active && m.agent_id) {
          const an = agentName.get(m.agent_id);
          if (an && !p.agentesLead.includes(an)) p.agentesLead.push(an);
        }
      }
      // 2) Número(s) do gerente (hoje soltos em wa_ai_agents).
      for (const a of agents) {
        for (const gp of [a.gerente_phone, a.gerente_phone_2]) {
          const k = last8(gp);
          if (!k) continue;
          const p = ensure(k, 'Gerente', gp, 'gerente');
          if (p.papel !== 'vendedor') p.papel = 'gerente';
        }
      }
      // 3) conta_responsaveis: externos + as marcações de entrega (fonte da verdade).
      for (const r of resp) {
        const k = last8(r.whatsapp);
        if (!k) continue;
        const p = ensure(k, r.nome || '', r.whatsapp, 'externo');
        p.recebe_atendimento = !!r.recebe_atendimento;
        p.recebe_trafego = !!r.recebe_trafego;
        p.recebe_alertas = !!r.recebe_alertas;
      }

      const arr = [...map.values()].sort((a, b) => {
        const rank = (x: Pessoa) => (x.papel === 'gerente' ? 0 : x.papel === 'vendedor' ? 1 : 2);
        return rank(a) - rank(b) || a.nome.localeCompare(b.nome);
      });
      setPessoas(arr);
    } catch (e: any) {
      toast({ title: 'Erro ao carregar responsáveis', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => { if (userId) load(); }, [userId, load]);

  const toggle = async (p: Pessoa, campo: Entrega) => {
    const novo = !p[campo];
    setSaving(p.key + campo);
    setPessoas(prev => prev.map(x => x.key === p.key ? { ...x, [campo]: novo } : x));
    try {
      const { error } = await (supabase as any).from('conta_responsaveis').upsert({
        user_id: userId, whatsapp: p.whatsapp, nome: p.nome || null, [campo]: novo,
      }, { onConflict: 'user_id,whatsapp' });
      if (error) throw error;
    } catch (e: any) {
      setPessoas(prev => prev.map(x => x.key === p.key ? { ...x, [campo]: !novo } : x));
      toast({ title: 'Não deu pra salvar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const addExterno = async () => {
    const d = onlyDigits(novoTel);
    if (!novoNome.trim() || d.length < 10) {
      toast({ title: 'Preencha o nome e um número válido (com DDD)', variant: 'destructive' });
      return;
    }
    setSaving('add');
    try {
      const { error } = await (supabase as any).from('conta_responsaveis').upsert({
        user_id: userId, whatsapp: d, nome: novoNome.trim(),
      }, { onConflict: 'user_id,whatsapp' });
      if (error) throw error;
      setAddOpen(false); setNovoNome(''); setNovoTel('');
      await load();
      toast({ title: 'Responsável adicionado', description: 'Agora marque o que ele recebe.' });
    } catch (e: any) {
      toast({ title: 'Não deu pra adicionar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  const papelLabel = (p: Pessoa) =>
    p.papel === 'gerente' ? 'gerente / conta master' : p.papel === 'vendedor' ? 'vendedor' : 'parceiro externo';

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground leading-tight">Responsáveis &amp; entregas</h3>
            <p className="text-xs text-muted-foreground">Cadastre a pessoa uma vez. Marque o que ela recebe.</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" /> Adicionar responsável
        </Button>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border/40 rounded-lg px-3 py-2">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Os leads continuam sendo distribuídos pelos agentes (aba Vendedores). Aqui você controla os relatórios e alertas — o disparo sai sempre do número da IA.
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando responsáveis...
        </div>
      ) : pessoas.length === 0 ? (
        <div className="text-center py-10 text-sm text-muted-foreground">
          Nenhum responsável ainda. Clique em “Adicionar responsável”.
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 divide-y divide-border/50 overflow-hidden">
          {pessoas.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-4 px-3 py-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-[200px] flex-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0
                  ${p.papel === 'gerente' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'}`}>
                  {p.papel === 'gerente' ? <Crown className="h-4 w-4" /> : iniciais(p.nome)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{p.nome || 'Sem nome'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {fmtTel(p.whatsapp)} · {papelLabel(p)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {/* Leads (referência, controlado na aba Vendedores) */}
                <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border
                  ${p.agentesLead.length ? 'bg-sky-500/10 text-sky-300 border-sky-500/25' : 'text-muted-foreground/60 border-border/40'}`}
                  title={p.agentesLead.length ? `Recebe lead em: ${p.agentesLead.join(', ')}` : 'Não recebe leads'}>
                  <Users className="h-3 w-3" />
                  {p.agentesLead.length ? `Leads · ${p.agentesLead.join(', ')}` : 'Leads'}
                </span>

                {/* Entregas de conta (toggle) */}
                {ENTREGAS.map(({ campo, label, icon: Icon }) => {
                  const on = p[campo];
                  const busy = saving === p.key + campo;
                  return (
                    <button
                      key={campo}
                      onClick={() => toggle(p, campo)}
                      disabled={busy}
                      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border transition-colors
                        ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'text-muted-foreground border-border/50 hover:bg-accent/40'} ${busy ? 'opacity-60' : ''}`}
                      title={`${on ? 'Recebe' : 'Não recebe'} ${label}`}
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog: adicionar responsável externo (ex.: gestor de tráfego parceiro) */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Adicionar responsável</DialogTitle>
            <DialogDescription>
              Para alguém que só recebe relatórios/alertas (ex.: gestor de tráfego parceiro).
              Vendedores continuam sendo adicionados na aba Vendedores.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nome</label>
              <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex.: Ana (gestora de tráfego)" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">WhatsApp (com DDD)</label>
              <Input value={novoTel} onChange={(e) => setNovoTel(e.target.value)} placeholder="Ex.: 11 97777-1200" inputMode="tel" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={saving === 'add'}>Cancelar</Button>
            <Button size="sm" onClick={addExterno} disabled={saving === 'add'}>
              {saving === 'add' ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
