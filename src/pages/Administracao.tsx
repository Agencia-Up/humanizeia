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
  UserCheck, CalendarCheck, Inbox,
} from 'lucide-react';

// ── Painel de Administracao (donos: Douglas + Wander) ────────────────────────
// Organizado em ABAS pra facilitar a leitura de quem nao e tecnico. Cada aba = 1 bloco.
//  - Saude: qualidade do atendimento por agente (alertas + drill-down).  [pedro-v2-health-monitor]
//  - Operacao: volume/atividade por agente (leads, visitas, turnos).     [admin_pedro_ops_overview]
// Cliente NUNCA ve (rota AdminRoute + sidebar so admin). Custo fica no /admin/margem.

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
        Custo e margem por cliente ficam em <span className="font-medium">Margem (IA)</span>.
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
