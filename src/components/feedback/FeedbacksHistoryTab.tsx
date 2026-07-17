/**
 * Histórico de feedbacks enviados ao gerente — aba compartilhada Pedro + Marcos.
 *
 * Objetivo (dono, 16/07/2026): o vendedor precisa CONSULTAR depois e COMPROVAR
 * que enviou. Por isso a coluna "Envio" é o coração da tela, não enfeite: ela é
 * o que responde "eu mandei ou não mandei?".
 *
 * SEGURANÇA — esta query ESPELHA a RLS de pedro_manager_feedback, não a contorna:
 *   owner_read_feedback    : user_id  = auth.uid()             → master vê a conta toda
 *   seller_manage_feedback : member_id do próprio auth.uid()   → vendedor vê só o dele
 * O filtro explícito abaixo é defesa em profundidade (mesmo predicado da RLS): se
 * a RLS cair, a tela não vira vazamento. Regra: só ESPELHAR o predicado — nunca
 * inventar condição nova aqui, senão esconde linha que a RLS permitiria.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Loader2, MapPin,
  MessageSquare, Search, X,
} from 'lucide-react';
import { descricaoErro } from '@/lib/erroAmigavel';

/* ─────────────────── tipos ─────────────────── */

interface FeedbackRow {
  id: string;
  lead_id: string | null;
  crm_lead_id: string | null;
  member_id: string | null;
  content: string | null;
  priority: string | null;
  city: string | null;
  reason: string | null;
  observations: string | null;
  created_at: string;
  sent_to_manager_at: string | null;
  pending_send: boolean | null;
  failed_at: string | null;
  failed_attempts: number | null;
  member: { name: string | null } | null;
  lead: { lead_name: string | null; remote_jid: string | null } | null;
  crm: { name: string | null; phone: string | null } | null;
}

interface Props {
  /** Dono dos dados: master usa o próprio id; vendedor usa o id do master. */
  ownerUserId: string | undefined;
  isSeller: boolean;
  /** Ids do vendedor na matriz (1 linha por agente) — vazio = não mostra nada. */
  memberIds: string[];
}

/* ─────────────────── classificação ───────────────────
 * O tipo do feedback vive no campo `reason`, por PREFIXO — é assim que o envio
 * 2.0 (PedroSDR.handleSendFeedback) grava:
 *     lost        → reason = motivo cru            ("Preço alto")   ← sem prefixo
 *     negotiation → reason = "Em negociacao - ..."
 *     sold_later  → reason = "Comprou depois - ..."
 * Conferido contra os dados de prod em 16/07 (159 linhas, todas caem em bucket):
 *     143 motivo legível      → Lead perdido
 *      15 reason NULL (📌)    → Anotação
 *       1 código de máquina   → Sistema/IA  (cliente_perdido_followup_ia)
 *       0 com prefixo novo    → o envio 2.0 ainda não subiu (falta Rebuild)
 * Os dois primeiros buckets são o "fallback" pra base antiga: nada fica órfão.
 */
type TipoKey = 'perdido' | 'negociacao' | 'comprou' | 'anotacao' | 'sistema';

const TIPO_CFG: Record<TipoKey, { label: string; cls: string }> = {
  perdido:    { label: 'Lead perdido',  cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  negociacao: { label: 'Em negociação', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  comprou:    { label: 'Comprou depois',cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  anotacao:   { label: 'Anotação',      cls: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  sistema:    { label: 'Registro da IA',cls: 'bg-muted text-muted-foreground border-border' },
};

function classificarTipo(reason: string | null): TipoKey {
  const r = (reason || '').trim();
  if (!r) return 'anotacao';
  if (/^em\s+negocia/i.test(r)) return 'negociacao';
  if (/^comprou\s+depois/i.test(r)) return 'comprou';
  // reason que é código de máquina (snake_case) veio de motor, não de gente.
  if (/^[a-z][a-z0-9_]*$/.test(r)) return 'sistema';
  return 'perdido';
}

/* ─────────────────── status de envio ───────────────────
 * Sem inventar: "Registrado" é o estado honesto de quem não tem marca nenhuma
 * (18 linhas em prod, incl. as que a IA gravou). Dizer "Enviado" ali seria mentir
 * — e mentir aqui é justamente o que essa aba existe pra impedir.
 */
type EnvioKey = 'enviado' | 'pendente' | 'falhou' | 'registrado';

const ENVIO_CFG: Record<EnvioKey, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  enviado:    { label: 'Enviado',    cls: 'text-emerald-400', Icon: CheckCircle2 },
  pendente:   { label: 'Pendente',   cls: 'text-amber-400',   Icon: Clock },
  falhou:     { label: 'Falhou',     cls: 'text-red-400',     Icon: AlertTriangle },
  registrado: { label: 'Registrado', cls: 'text-muted-foreground', Icon: FileText },
};

function classificarEnvio(fb: FeedbackRow): EnvioKey {
  if (fb.sent_to_manager_at) return 'enviado';
  if (fb.failed_at) return 'falhou';
  if (fb.pending_send) return 'pendente';
  return 'registrado';
}

/* ─────────────────── potencial (priority) ─────────────────── */
const POTENCIAL_CFG: Record<string, { label: string; cls: string }> = {
  high:   { label: 'Quente', cls: 'text-red-400' },
  normal: { label: 'Morno',  cls: 'text-amber-400' },
  low:    { label: 'Frio',   cls: 'text-sky-400' },
};

/* ─────────────────── helpers ─────────────────── */

/** Pedro guarda `remote_jid` (5512999999999@s.whatsapp.net); Marcos, `phone`. */
function formatarTelefone(bruto: string | null | undefined): string {
  if (!bruto) return '';
  const num = bruto.split('@')[0].replace(/\D/g, '');
  if (!num) return '';
  const sem55 = num.startsWith('55') && num.length >= 12 ? num.slice(2) : num;
  if (sem55.length === 11) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 7)}-${sem55.slice(7)}`;
  if (sem55.length === 10) return `(${sem55.slice(0, 2)}) ${sem55.slice(2, 6)}-${sem55.slice(6)}`;
  return num;
}

function fmtDataHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

const PERIODOS = [
  { value: 'todos', label: 'Todo o período' },
  { value: '7',     label: 'Últimos 7 dias' },
  { value: '30',    label: 'Últimos 30 dias' },
  { value: '90',    label: 'Últimos 90 dias' },
];

/* ─────────────────── componente ─────────────────── */

export default function FeedbacksHistoryTab({ ownerUserId, isSeller, memberIds }: Props) {
  const [rows, setRows]       = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState<string | null>(null);
  const [aberto, setAberto]   = useState<FeedbackRow | null>(null);

  // filtros
  const [busca, setBusca]         = useState('');
  const [fVendedor, setFVendedor] = useState('todos');
  const [fTipo, setFTipo]         = useState('todos');
  const [fOrigem, setFOrigem]     = useState('todos');
  const [fEnvio, setFEnvio]       = useState('todos');
  const [fPeriodo, setFPeriodo]   = useState('todos');

  const carregar = useCallback(async () => {
    if (!ownerUserId) return;               // sem dono ainda: não afirma "vazio"
    setLoading(true); setErro(null);
    try {
      // Campos explícitos (nada de select *). Embeds usam as FKs que existem:
      // lead_id→ai_crm_leads, crm_lead_id→crm_leads, member_id→ai_team_members.
      let q = (supabase as any)
        .from('pedro_manager_feedback')
        .select(`
          id, lead_id, crm_lead_id, member_id, content, priority, city, reason,
          observations, created_at, sent_to_manager_at, pending_send, failed_at,
          failed_attempts,
          member:ai_team_members(name),
          lead:ai_crm_leads(lead_name, remote_jid),
          crm:crm_leads(name, phone)
        `)
        .order('created_at', { ascending: false })
        .limit(500);

      // Espelho da RLS (defesa em profundidade — mesmo predicado, nada novo).
      if (isSeller) q = q.in('member_id', memberIds);
      else          q = q.eq('user_id', ownerUserId);

      const { data, error } = await q;
      if (error) throw error;
      setRows((data || []) as FeedbackRow[]);
    } catch (e: any) {
      setErro(descricaoErro(e));
    } finally {
      setLoading(false);
    }
  }, [ownerUserId, isSeller, memberIds]);

  useEffect(() => {
    // Vendedor sem member_id não tem o que mostrar — e `.in('member_id', [])`
    // devolveria vazio de qualquer jeito. Falha fechado, sem query inútil.
    if (isSeller && memberIds.length === 0) { setRows([]); setLoading(false); return; }
    carregar();
  }, [carregar, isSeller, memberIds.length]);

  /* ---- derivados ---- */
  const enriquecidas = useMemo(() => rows.map(fb => {
    const origem = fb.crm_lead_id ? 'marcos' : 'pedro';
    const nome   = (origem === 'marcos' ? fb.crm?.name : fb.lead?.lead_name) || '';
    const fone   = formatarTelefone(origem === 'marcos' ? fb.crm?.phone : fb.lead?.remote_jid);
    return {
      fb, origem, nome, fone,
      tipo:     classificarTipo(fb.reason),
      envio:    classificarEnvio(fb),
      vendedor: fb.member?.name || '',
    };
  }), [rows]);

  const vendedores = useMemo(() => {
    const s = new Set<string>();
    enriquecidas.forEach(e => { if (e.vendedor) s.add(e.vendedor); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [enriquecidas]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const soDigitos = termo.replace(/\D/g, '');
    const limite = fPeriodo === 'todos'
      ? null
      : Date.now() - Number(fPeriodo) * 24 * 60 * 60 * 1000;

    return enriquecidas.filter(e => {
      if (fVendedor !== 'todos' && e.vendedor !== fVendedor) return false;
      if (fTipo     !== 'todos' && e.tipo     !== fTipo)     return false;
      if (fOrigem   !== 'todos' && e.origem   !== fOrigem)   return false;
      if (fEnvio    !== 'todos' && e.envio    !== fEnvio)    return false;
      if (limite && new Date(e.fb.created_at).getTime() < limite) return false;
      if (termo) {
        const achouNome = e.nome.toLowerCase().includes(termo);
        const achouFone = soDigitos.length >= 3 && e.fone.replace(/\D/g, '').includes(soDigitos);
        if (!achouNome && !achouFone) return false;
      }
      return true;
    });
  }, [enriquecidas, busca, fVendedor, fTipo, fOrigem, fEnvio, fPeriodo]);

  const temFiltro = busca || [fVendedor, fTipo, fOrigem, fEnvio, fPeriodo].some(v => v !== 'todos');
  const limparFiltros = () => {
    setBusca(''); setFVendedor('todos'); setFTipo('todos');
    setFOrigem('todos'); setFEnvio('todos'); setFPeriodo('todos');
  };

  /* ---- render ---- */
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            Feedbacks enviados ao gerente
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSeller
              ? 'Tudo que você enviou fica registrado aqui, com a data e se chegou ao gerente.'
              : 'Todos os feedbacks que a sua equipe enviou, com data, vendedor e status de envio.'}
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {filtradas.length === enriquecidas.length
            ? `${enriquecidas.length} feedback${enriquecidas.length === 1 ? '' : 's'}`
            : `${filtradas.length} de ${enriquecidas.length}`}
        </span>
      </div>

      {erro && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {erro}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone do lead"
            className="h-9 pl-8 text-xs"
          />
        </div>

        {!isSeller && vendedores.length > 0 && (
          <Select value={fVendedor} onValueChange={setFVendedor}>
            <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              {vendedores.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <Select value={fTipo} onValueChange={setFTipo}>
          <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {(Object.keys(TIPO_CFG) as TipoKey[]).map(k => (
              <SelectItem key={k} value={k}>{TIPO_CFG[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fEnvio} onValueChange={setFEnvio}>
          <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Qualquer envio</SelectItem>
            {(Object.keys(ENVIO_CFG) as EnvioKey[]).map(k => (
              <SelectItem key={k} value={k}>{ENVIO_CFG[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={fOrigem} onValueChange={setFOrigem}>
          <SelectTrigger className="h-9 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as origens</SelectItem>
            <SelectItem value="pedro">Pedro</SelectItem>
            <SelectItem value="marcos">Marcos</SelectItem>
          </SelectContent>
        </Select>

        <Select value={fPeriodo} onValueChange={setFPeriodo}>
          <SelectTrigger className="h-9 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODOS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {temFiltro && (
          <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-9 text-xs">
            <X className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        )}
      </div>

      {/* Vazio */}
      {filtradas.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium">
              {enriquecidas.length === 0 ? 'Nenhum feedback ainda' : 'Nada com esses filtros'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {enriquecidas.length === 0
                ? 'Quando um feedback for enviado ao gerente pelo card do lead, ele aparece aqui.'
                : 'Tente limpar os filtros pra ver tudo.'}
            </p>
            {enriquecidas.length > 0 && temFiltro && (
              <Button variant="outline" size="sm" onClick={limparFiltros} className="mt-3 text-xs">
                Limpar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Desktop: tabela ── */}
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border/60 bg-muted/30">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Lead</th>
                    {!isSeller && <th className="px-3 py-2 font-medium">Vendedor</th>}
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Motivo</th>
                    <th className="px-3 py-2 font-medium">Origem</th>
                    <th className="px-3 py-2 font-medium">Envio</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(e => {
                    const env = ENVIO_CFG[e.envio];
                    return (
                      <tr
                        key={e.fb.id}
                        onClick={() => setAberto(e.fb)}
                        className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtDataHora(e.fb.created_at)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{e.nome || '—'}</div>
                          {e.fone && <div className="text-[10px] text-muted-foreground tabular-nums">{e.fone}</div>}
                        </td>
                        {!isSeller && <td className="px-3 py-2 text-muted-foreground">{e.vendedor || '—'}</td>}
                        <td className="px-3 py-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TIPO_CFG[e.tipo].cls}`}>
                            {TIPO_CFG[e.tipo].label}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-muted-foreground">
                          {e.tipo === 'sistema' ? 'Registrado automaticamente' : (e.fb.reason || '—')}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {e.origem === 'marcos' ? 'Marcos' : 'Pedro'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 font-medium ${env.cls}`}>
                            <env.Icon className="h-3 w-3" /> {env.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Mobile: cards ── */}
          <div className="space-y-2 md:hidden">
            {filtradas.map(e => {
              const env = ENVIO_CFG[e.envio];
              return (
                <Card
                  key={e.fb.id}
                  onClick={() => setAberto(e.fb)}
                  className="cursor-pointer active:bg-muted/40"
                >
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.nome || '—'}</p>
                        {e.fone && <p className="text-[11px] text-muted-foreground tabular-nums">{e.fone}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TIPO_CFG[e.tipo].cls}`}>
                        {TIPO_CFG[e.tipo].label}
                      </span>
                    </div>
                    {e.tipo !== 'sistema' && e.fb.reason && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{e.fb.reason}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="tabular-nums">{fmtDataHora(e.fb.created_at)}</span>
                      <span>{e.origem === 'marcos' ? 'Marcos' : 'Pedro'}</span>
                      {!isSeller && e.vendedor && <span>{e.vendedor}</span>}
                      <span className={`ml-auto inline-flex items-center gap-1 font-medium ${env.cls}`}>
                        <env.Icon className="h-3 w-3" /> {env.label}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Detalhe */}
      <Dialog open={!!aberto} onOpenChange={o => !o && setAberto(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {aberto && (() => {
            const origem = aberto.crm_lead_id ? 'marcos' : 'pedro';
            const nome   = (origem === 'marcos' ? aberto.crm?.name : aberto.lead?.lead_name) || '—';
            const fone   = formatarTelefone(origem === 'marcos' ? aberto.crm?.phone : aberto.lead?.remote_jid);
            const tipo   = classificarTipo(aberto.reason);
            const envio  = classificarEnvio(aberto);
            const env    = ENVIO_CFG[envio];
            const pot    = POTENCIAL_CFG[aberto.priority || 'normal'];
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-primary" />
                    {nome}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${TIPO_CFG[tipo].cls}`}>
                      {TIPO_CFG[tipo].label}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${env.cls}`}>
                      <env.Icon className="h-3 w-3" /> {env.label}
                    </span>
                    {pot && <span className={`text-[11px] font-medium ${pot.cls}`}>Potencial: {pot.label}</span>}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Enviado em</dt>
                      <dd className="tabular-nums">{fmtDataHora(aberto.created_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Origem</dt>
                      <dd>{origem === 'marcos' ? 'Agente Marcos' : 'Agente Pedro'}</dd>
                    </div>
                    {fone && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Telefone</dt>
                        <dd className="tabular-nums">{fone}</dd>
                      </div>
                    )}
                    {aberto.city && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Cidade</dt>
                        <dd className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" />{aberto.city}</dd>
                      </div>
                    )}
                    {!isSeller && aberto.member?.name && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Vendedor</dt>
                        <dd>{aberto.member.name}</dd>
                      </div>
                    )}
                    {aberto.sent_to_manager_at && (
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Chegou ao gerente</dt>
                        <dd className="tabular-nums">{fmtDataHora(aberto.sent_to_manager_at)}</dd>
                      </div>
                    )}
                  </dl>

                  {tipo !== 'sistema' && aberto.reason && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Motivo</p>
                      <p className="rounded-md bg-muted/30 px-2 py-1.5 text-xs">{aberto.reason}</p>
                    </div>
                  )}

                  {aberto.observations && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Observações</p>
                      <p className="whitespace-pre-line rounded-md bg-muted/30 px-2 py-1.5 text-xs">{aberto.observations}</p>
                    </div>
                  )}

                  {aberto.content && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Mensagem enviada ao gerente
                      </p>
                      <p className="whitespace-pre-line rounded-md bg-muted/30 px-2 py-1.5 text-xs">
                        {aberto.content}
                      </p>
                    </div>
                  )}

                  {envio === 'pendente' && (
                    <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-400">
                      Ainda não confirmamos a entrega ao gerente. O registro está salvo — avise o gerente se for urgente.
                    </p>
                  )}
                  {envio === 'falhou' && (
                    <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
                      A entrega ao gerente falhou{aberto.failed_attempts ? ` após ${aberto.failed_attempts} tentativa(s)` : ''}.
                      O registro está salvo — avise o gerente por outro canal.
                    </p>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
