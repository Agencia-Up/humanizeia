import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ShieldCheck, RefreshCcw, AlertTriangle, ChevronDown, ChevronRight,
  Activity, Users, BadgeCheck, Home, HeartPulse, ClipboardList,
  UserCheck, CalendarCheck, Inbox, Building2, KeyRound, Power, Cpu, Zap, Wallet, BellRing, MessagesSquare,
} from 'lucide-react';
import AdminMargemTab from '@/components/admin/AdminMargemTab';
import AdminAuditoriaTab from '@/components/admin/AdminAuditoriaTab';
import AdminDailyAuditTab from '@/components/admin/AdminDailyAuditTab';
import AdminFeedbackConfigTab from '@/components/admin/AdminFeedbackConfigTab';

// ── Painel de Administracao (donos: Douglas + Wander) ────────────────────────
// Organizado em ABAS pra facilitar a leitura de quem nao e tecnico. Cada aba = 1 bloco.
//  - Saude: qualidade do atendimento por agente (alertas + drill-down).  [pedro-v2-health-monitor]
//  - Operacao: volume/atividade por agente (leads, visitas, turnos).     [admin_pedro_ops_overview]
//  - Consumo: auditoria de tokens/custo de IA por cliente/agente (god-view).    [AdminAuditoriaTab]
//  - Margem: receita dos clientes pagantes − custos fixos − custo de IA do Jose. [AdminMargemTab]
// Cliente NUNCA ve (rota AdminRoute + sidebar so admin).

/* ── helpers ── */
function horaCurta(s: unknown) {
  if (!s) return '—';
  try { return new Date(String(s)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(s); }
}
const intBR = (n: unknown) => Math.round(Number(n ?? 0) || 0).toLocaleString('pt-BR');

/* ── shell com abas ── */
const TABS = [
  { key: 'saude', label: 'Saúde dos agentes', icon: HeartPulse },
  { key: 'operacao', label: 'Operação', icon: ClipboardList },
  { key: 'clientes', label: 'Clientes & Agentes', icon: Building2 },
  { key: 'provedores', label: 'Provedores de IA', icon: Cpu },
  { key: 'auditoria_diaria', label: 'Auditoria diária', icon: BellRing },
  { key: 'feedbacks', label: 'Feedbacks', icon: MessagesSquare },
  { key: 'consumo', label: 'Consumo de IA', icon: Activity },
  { key: 'margem', label: 'Margem (IA)', icon: Wallet },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function Administracao() {
  const [tab, setTab] = useState<TabKey>('saude');

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
      {/* ── Cabecalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Administração
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestão dos agentes e clientes. Visão de operação — só administradores (você e o Wander).
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/tela-inicial"><Home className="mr-2 h-4 w-4" /> Tela inicial</Link>
        </Button>
      </div>

      {/* ── Barra de abas ── */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'saude' && <SaudeTab />}
      {tab === 'operacao' && <OperacaoTab />}
      {tab === 'clientes' && <ClientesTab />}
      {tab === 'provedores' && <ProvedoresTab />}
      {tab === 'auditoria_diaria' && <AdminDailyAuditTab />}
      {tab === 'feedbacks' && <AdminFeedbackConfigTab />}
      {tab === 'consumo' && <AdminAuditoriaTab />}
      {tab === 'margem' && <AdminMargemTab />}
    </div>
  );
}

/* ════════════════════════ ABA: SAÚDE DOS AGENTES ════════════════════════ */
interface Sample { at: string; jid: string; in: string; [k: string]: unknown; }
interface AgentHealth {
  agent_id: string | null;
  agent_name: string;
  client_name: string | null;
  total_turns: number;
  last_activity: string | null;
  counts: Record<string, number>;
  samples: Record<string, Sample[]>;
  has_findings: boolean;
}
const SIGNATURES: { key: string; label: string; problem: boolean; hint: string }[] = [
  { key: 'unsolicited_photos', label: 'Fotos s/ pedir', problem: true, hint: 'Enviou fotos sem o lead pedir' },
  { key: 'ctwa_ad_lost', label: 'Anúncio perdido', problem: true, hint: 'Lead de anúncio cujo contexto se perdeu' },
  { key: 'ad_vehicle_unresolved', label: 'Anúncio n/ resolvido', problem: true, hint: 'Anúncio presente mas veículo não identificado' },
  { key: 'byok_block', label: 'Sem chave IA', problem: true, hint: 'Conta sem chave de IA — não respondeu' },
  { key: 'provider_error', label: 'Falha de IA', problem: true, hint: 'Sem crédito / chave inválida no provedor' },
  { key: 'grounding_corrected', label: 'Alucinação barrada', problem: false, hint: 'Validador pegou e corrigiu (métrica, não erro)' },
];
const PROBLEM_KEYS = SIGNATURES.filter((s) => s.problem).map((s) => s.key);
const problemTotal = (counts: Record<string, number>) =>
  PROBLEM_KEYS.reduce((n, k) => n + (counts?.[k] || 0), 0);

function SaudeTab() {
  const [hours, setHours] = useState(24);
  const [agents, setAgents] = useState<AgentHealth[]>([]);
  const [report, setReport] = useState<{ total_turns: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data, error } = await supabase.functions.invoke('pedro-v2-health-monitor', {
        body: { hours, per_agent: true, dry_run: true },
      });
      if (error) throw error;
      const resp = data as { ok: boolean; agents?: AgentHealth[]; report?: { total_turns: number }; error?: string };
      if (!resp?.ok) throw new Error(resp?.error || 'Falha ao carregar.');
      setAgents(Array.isArray(resp.agents) ? resp.agents : []);
      setReport(resp.report ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg.includes('forbidden') ? 'Acesso restrito aos administradores.' : (msg || 'Falha ao carregar.'));
    } finally { setLoading(false); }
  }, [hours]);
  useEffect(() => { carregar(); }, [carregar]);

  const totalConversas = report?.total_turns ?? agents.reduce((n, a) => n + a.total_turns, 0);
  const agentesComProblema = agents.filter((a) => problemTotal(a.counts) > 0).length;
  const alucinacoesBarradas = agents.reduce((n, a) => n + (a.counts?.grounding_corrected || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Qualidade do atendimento por agente — pega problema antes do cliente reclamar.</p>
        <div className="flex items-center gap-2">
          <JanelaToggle value={hours} onChange={setHours} options={[{ v: 24, l: '24h' }, { v: 168, l: '7 dias' }]} />
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      {erro && <ErroBox msg={erro} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Users} cor="text-sky-500" titulo="Agentes ativos" valor={loading ? null : intBR(agents.length)} sub={hours === 24 ? 'últimas 24h' : 'últimos 7 dias'} />
        <TotalCard icon={Activity} cor="text-primary" titulo="Conversas" valor={loading ? null : intBR(totalConversas)} sub="turnos atendidos" />
        <TotalCard icon={AlertTriangle} cor={agentesComProblema > 0 ? 'text-amber-500' : 'text-emerald-500'} titulo="Agentes com alerta" valor={loading ? null : intBR(agentesComProblema)} sub={agentesComProblema > 0 ? 'precisam de atenção' : 'tudo limpo'} />
        <TotalCard icon={BadgeCheck} cor="text-emerald-500" titulo="Alucinações barradas" valor={loading ? null : intBR(alucinacoesBarradas)} sub="rede de segurança" />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Por agente</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Agente / Cliente</TableHead>
                  <TableHead className="text-right">Conversas</TableHead>
                  {SIGNATURES.map((s) => <TableHead key={s.key} className="text-center text-[11px]" title={s.hint}>{s.label}</TableHead>)}
                  <TableHead className="text-right">Última atividade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? <LinhasSkeleton cols={4 + SIGNATURES.length} /> : agents.length === 0 ? (
                  <TableRow><TableCell colSpan={4 + SIGNATURES.length} className="py-8 text-center text-sm text-muted-foreground">Nenhuma atividade nesta janela.</TableCell></TableRow>
                ) : agents.map((a) => {
                  const key = a.agent_id || a.agent_name;
                  const isOpen = expanded === key;
                  const probs = problemTotal(a.counts);
                  return (
                    <>
                      <TableRow key={key} className={`cursor-pointer ${probs > 0 ? 'bg-amber-500/5' : ''}`} onClick={() => setExpanded(isOpen ? null : key)}>
                        <TableCell className="text-muted-foreground">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{a.agent_name}</span>
                            {probs > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{probs}</Badge>}
                          </div>
                          {a.client_name && <div className="truncate text-[11px] text-muted-foreground">{a.client_name}</div>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{intBR(a.total_turns)}</TableCell>
                        {SIGNATURES.map((s) => {
                          const n = a.counts?.[s.key] || 0;
                          const color = n === 0 ? 'text-muted-foreground/40' : s.problem ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-sky-600 dark:text-sky-400';
                          return <TableCell key={s.key} className={`text-center tabular-nums ${color}`}>{n || '·'}</TableCell>;
                        })}
                        <TableCell className="text-right text-[11px] text-muted-foreground">{horaCurta(a.last_activity)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow key={key + '-drill'} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={3 + SIGNATURES.length} className="py-3"><DrillDown agent={a} /></TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Telefones mascarados (últimos 4 dígitos). "Alucinação barrada" é a rede de segurança funcionando (não é erro).
        Receita, custos e margem ficam na aba <span className="font-medium">Margem (IA)</span>.
      </p>
    </div>
  );
}

function DrillDown({ agent }: { agent: AgentHealth }) {
  const blocks = SIGNATURES.map((s) => ({ ...s, items: agent.samples?.[s.key] || [] })).filter((b) => b.items.length > 0);
  if (blocks.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma ocorrência nesta janela. 👍</p>;
  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <div key={b.key}>
          <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${b.problem ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'}`}>{b.label} · {b.items.length}</p>
          <div className="space-y-1">
            {b.items.slice(0, 10).map((s, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
                <span className="tabular-nums text-muted-foreground">{horaCurta(s.at)}</span>
                <span className="font-mono text-muted-foreground">{s.jid}</span>
                {s.in && <span className="text-foreground/80">"{s.in}"</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════ ABA: OPERAÇÃO ════════════════════════ */
interface AgentOps {
  agent_id: string;
  agent_name: string;
  client_name: string | null;
  leads_total: number;
  leads_novos: number;
  com_vendedor: number;
  visitas: number;
  turnos: number;
  ultima_atividade: string | null;
}
function OperacaoTab() {
  const [days, setDays] = useState(7);
  const [agents, setAgents] = useState<AgentOps[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data, error } = await (supabase as any).rpc('admin_pedro_ops_overview', { p_days: days });
      if (error) throw error;
      setAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg.includes('forbidden') ? 'Acesso restrito aos administradores.' : (msg || 'Falha ao carregar.'));
    } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { carregar(); }, [carregar]);

  const totLeads = agents.reduce((n, a) => n + a.leads_total, 0);
  const totNovos = agents.reduce((n, a) => n + a.leads_novos, 0);
  const totVisitas = agents.reduce((n, a) => n + a.visitas, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Volume e atividade de cada agente — carteira de leads, novos no período, visitas e turnos da IA.</p>
        <div className="flex items-center gap-2">
          <JanelaToggle value={days} onChange={setDays} options={[{ v: 7, l: '7 dias' }, { v: 30, l: '30 dias' }]} />
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      {erro && <ErroBox msg={erro} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Users} cor="text-sky-500" titulo="Agentes" valor={loading ? null : intBR(agents.length)} sub="com atividade" />
        <TotalCard icon={Inbox} cor="text-primary" titulo="Leads (carteira)" valor={loading ? null : intBR(totLeads)} sub="total acumulado" />
        <TotalCard icon={Activity} cor="text-amber-500" titulo={`Leads novos (${days}d)`} valor={loading ? null : intBR(totNovos)} sub="no período" />
        <TotalCard icon={CalendarCheck} cor="text-emerald-500" titulo="Visitas agendadas" valor={loading ? null : intBR(totVisitas)} sub="total" />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Por agente</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente / Cliente</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Novos ({days}d)</TableHead>
                  <TableHead className="text-right">Com vendedor</TableHead>
                  <TableHead className="text-right">Visitas</TableHead>
                  <TableHead className="text-right">Turnos IA ({days}d)</TableHead>
                  <TableHead className="text-right">Última atividade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? <LinhasSkeleton cols={7} /> : agents.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nenhum agente com atividade.</TableCell></TableRow>
                ) : agents.map((a) => (
                  <TableRow key={a.agent_id}>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate font-medium">{a.agent_name}</div>
                      {a.client_name && <div className="truncate text-[11px] text-muted-foreground">{a.client_name}</div>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{intBR(a.leads_total)}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">{a.leads_novos > 0 ? intBR(a.leads_novos) : '·'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-1"><UserCheck className="h-3 w-3 text-muted-foreground" />{intBR(a.com_vendedor)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.visitas > 0 ? intBR(a.visitas) : '·'}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{intBR(a.turnos)}</TableCell>
                    <TableCell className="text-right text-[11px] text-muted-foreground">{horaCurta(a.ultima_atividade)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        "Com vendedor" = leads com um vendedor atribuído. "Turnos IA" = mensagens processadas pela IA no período.
        Leads e visitas são o total acumulado da carteira do agente.
      </p>
    </div>
  );
}

/* ════════════════════════ ABA: CLIENTES & AGENTES ════════════════════════ */
interface AgentCliente {
  agent_id: string;
  agent_name: string;
  is_active: boolean;
  model: string | null;
  agent_type: string | null;
  total_replies: number | null;
  client_name: string | null;
  grandfathered: boolean;
  has_own_key: boolean;
  own_key_providers: string | null;
  plan_id: string | null;
  plan_status: string | null;
  stock_sources: string | null;
}
const PLANO_LABEL: Record<string, string> = { basico: 'Básico', pro: 'Pro', enterprise: 'Pro Max' };
function aiKeyInfo(a: AgentCliente): { label: string; tone: 'good' | 'neutral' | 'warn'; detail?: string } {
  if (a.has_own_key) return { label: 'Própria (BYOK)', tone: 'good', detail: a.own_key_providers || undefined };
  if (a.grandfathered) return { label: 'Plataforma', tone: 'neutral' };
  return { label: 'Sem chave', tone: 'warn' };
}

function ClientesTab() {
  const [agents, setAgents] = useState<AgentCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data, error } = await (supabase as any).rpc('admin_clientes_overview');
      if (error) throw error;
      setAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg.includes('forbidden') ? 'Acesso restrito aos administradores.' : (msg || 'Falha ao carregar.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const ativos = agents.filter((a) => a.is_active).length;
  const comChavePropria = agents.filter((a) => a.has_own_key).length;
  const semChave = agents.filter((a) => !a.has_own_key && !a.grandfathered).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Carteira de clientes e seus agentes — status, plano, origem da chave de IA e fonte de estoque.</p>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {erro && <ErroBox msg={erro} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Building2} cor="text-sky-500" titulo="Agentes" valor={loading ? null : intBR(agents.length)} sub="na carteira" />
        <TotalCard icon={Power} cor="text-emerald-500" titulo="Ativos" valor={loading ? null : intBR(ativos)} sub={`de ${agents.length}`} />
        <TotalCard icon={KeyRound} cor="text-emerald-500" titulo="Chave própria (BYOK)" valor={loading ? null : intBR(comChavePropria)} sub="paga a própria IA" />
        <TotalCard icon={AlertTriangle} cor={semChave > 0 ? 'text-red-500' : 'text-emerald-500'} titulo="Sem chave de IA" valor={loading ? null : intBR(semChave)} sub={semChave > 0 ? 'não respondem!' : 'tudo certo'} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Por agente</CardTitle></CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agente / Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Chave de IA</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Estoque</TableHead>
                  <TableHead className="text-right">Respostas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? <LinhasSkeleton cols={7} /> : agents.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nenhum agente cadastrado.</TableCell></TableRow>
                ) : agents.map((a) => {
                  const key = aiKeyInfo(a);
                  const keyCls = key.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
                    : key.tone === 'warn' ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground';
                  return (
                    <TableRow key={a.agent_id} className={a.is_active ? '' : 'opacity-60'}>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate font-medium">{a.agent_name}</div>
                        {a.client_name && <div className="truncate text-[11px] text-muted-foreground">{a.client_name}</div>}
                      </TableCell>
                      <TableCell>
                        {a.is_active
                          ? <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 dark:text-emerald-400">Ativo</Badge>
                          : <Badge variant="secondary" className="text-muted-foreground">Pausado</Badge>}
                      </TableCell>
                      <TableCell><Badge variant="secondary" className="text-[11px]">{a.plan_id ? (PLANO_LABEL[a.plan_id] ?? a.plan_id) : '—'}</Badge></TableCell>
                      <TableCell>
                        <span className={`text-[12px] ${keyCls}`}>{key.label}</span>
                        {key.detail && <span className="ml-1 text-[10px] uppercase text-muted-foreground">{key.detail}</span>}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{a.model || '—'}</TableCell>
                      <TableCell className="text-[12px]">{a.stock_sources
                        ? <Badge variant="outline" className="text-[10px] uppercase">{a.stock_sources}</Badge>
                        : <span className="text-muted-foreground/50">—</span>}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{intBR(a.total_replies)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        "Plataforma" = conta antiga usando a nossa chave de IA (grandfathered). "Própria (BYOK)" = cliente novo
        pagando a própria IA. "Sem chave" = conta nova sem chave configurada — <span className="font-medium text-red-500">não responde</span> até configurar.
        O <span className="font-medium">Modelo</span> é o configurado no agente (pode estar sobreposto por um override global — ver aba de provedores).
      </p>
    </div>
  );
}

/* ════════════════════════ ABA: PROVEDORES DE IA ════════════════════════ */
interface ProviderState {
  name: string;
  has_key: boolean;
  status: string;
  code?: string;
  http?: number;
  in_use: { planner: boolean; reply: boolean };
}
interface ProvidersResp {
  ok: boolean;
  planner_provider: string;
  reply_force_provider: string | null;
  reply_note: string;
  providers: ProviderState[];
  recent_provider_errors_24h: number;
  error?: string;
}
const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', deepseek: 'DeepSeek', anthropic: 'Anthropic (Claude)' };
const STATUS_META: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' }> = {
  ok: { label: 'No ar', tone: 'good' },
  quota: { label: 'Sem crédito', tone: 'bad' },
  auth: { label: 'Chave inválida', tone: 'bad' },
  rate: { label: 'Limite de taxa', tone: 'warn' },
  down: { label: 'Fora do ar', tone: 'bad' },
  no_key: { label: 'Sem chave', tone: 'muted' },
  other: { label: 'Erro', tone: 'warn' },
};
const toneCls = (tone: string) =>
  tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400'
      : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground';
const dotCls = (tone: string) =>
  tone === 'good' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground/40';

function ProvedoresTab() {
  const [data, setData] = useState<ProvidersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data: resp, error } = await supabase.functions.invoke('admin-ai-providers', { body: {} });
      if (error) throw error;
      const r = resp as ProvidersResp;
      if (!r?.ok) throw new Error(r?.error || 'Falha ao carregar.');
      setData(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg.includes('forbidden') ? 'Acesso restrito aos administradores.' : (msg || 'Falha ao carregar.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const providers = data?.providers ?? [];
  // alerta critico: algum provedor EM USO esta com problema?
  const emUsoComProblema = providers.filter((p) => (p.in_use.planner || p.in_use.reply) && p.status !== 'ok');
  const replyEmUso = data?.reply_force_provider || 'por agente';
  const plannerEmUso = data?.planner_provider || '—';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Estado dos provedores de IA da plataforma (sondagem ao vivo) e qual está em uso de fato.</p>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Testar agora
        </Button>
      </div>

      {erro && <ErroBox msg={erro} />}

      {!loading && emUsoComProblema.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Provedor em uso com problema!</AlertTitle>
          <AlertDescription>
            {emUsoComProblema.map((p) => `${PROVIDER_LABEL[p.name] ?? p.name}: ${STATUS_META[p.status]?.label ?? p.status}`).join(' · ')}.
            O agente pode estar degradado. Considere trocar o provedor em uso.
          </AlertDescription>
        </Alert>
      )}

      {/* em uso */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Zap} cor="text-primary" titulo="Reply em uso" valor={loading ? null : (PROVIDER_LABEL[replyEmUso] ?? replyEmUso)} sub={data?.reply_note} />
        <TotalCard icon={Cpu} cor="text-sky-500" titulo="Planner em uso" valor={loading ? null : (PROVIDER_LABEL[plannerEmUso] ?? plannerEmUso)} sub="cérebro/decisão" />
        <TotalCard icon={BadgeCheck} cor="text-emerald-500" titulo="Provedores no ar" valor={loading ? null : `${providers.filter((p) => p.status === 'ok').length}/${providers.length}`} sub="sondagem ao vivo" />
        <TotalCard icon={AlertTriangle} cor={(data?.recent_provider_errors_24h ?? 0) > 0 ? 'text-amber-500' : 'text-emerald-500'} titulo="Erros de IA (24h)" valor={loading ? null : intBR(data?.recent_provider_errors_24h)} sub="quota/chave nos turnos" />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Provedores</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
          ) : providers.map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.other;
            const emUso = p.in_use.planner || p.in_use.reply;
            return (
              <div key={p.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${dotCls(meta.tone)}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{PROVIDER_LABEL[p.name] ?? p.name}</span>
                      {emUso && <Badge className="h-5 bg-primary/15 px-1.5 text-[10px] text-primary hover:bg-primary/15">EM USO</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {emUso
                        ? `${p.in_use.planner ? 'planner' : ''}${p.in_use.planner && p.in_use.reply ? ' + ' : ''}${p.in_use.reply ? 'reply' : ''}`
                        : (p.has_key ? 'disponível (não em uso)' : 'sem chave configurada')}
                    </div>
                  </div>
                </div>
                <div className={`text-sm font-semibold ${toneCls(meta.tone)}`}>
                  {meta.label}{p.code && p.status !== 'ok' ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">({p.code})</span> : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A sondagem faz uma chamada mínima a cada provedor (1 token) pra checar crédito/chave. "Reply/Planner em uso"
        reflete o override global (<span className="font-mono">PEDRO_REPLY_FORCE_PROVIDER</span> / <span className="font-mono">PEDRO_PLANNER_PROVIDER</span>);
        sem override, o reply segue o modelo configurado em cada agente.
      </p>
    </div>
  );
}

/* ── subcomponentes compartilhados ── */
function JanelaToggle<T extends number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`rounded px-3 py-1 text-sm transition-colors ${value === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
function ErroBox({ msg }: { msg: string }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Não foi possível carregar</AlertTitle>
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  );
}
function LinhasSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>{Array.from({ length: cols }).map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>
      ))}
    </>
  );
}
function TotalCard({ icon: Icon, cor, titulo, valor, sub }: { icon: React.ComponentType<{ className?: string }>; cor: string; titulo: string; valor: string | null; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
          <Icon className={`h-4 w-4 ${cor}`} />
        </div>
        {valor === null ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 text-2xl font-bold text-foreground">{valor}</p>}
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
