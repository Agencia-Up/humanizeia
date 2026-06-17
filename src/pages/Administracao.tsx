import { useCallback, useEffect, useState } from 'react';
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
  Activity, Users, BadgeCheck,
} from 'lucide-react';

// ── Painel de Administracao (donos: Douglas + Wander) ────────────────────────
// BLOCO 1: saude/qualidade do Pedro v2 POR AGENTE de cliente. Le do edge function
// pedro-v2-health-monitor (per_agent), que valida superadmin/dono no JWT. O cliente
// NUNCA ve (rota AdminRoute + item de sidebar so p/ admin). Custo/margem fica no /admin/margem.

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
interface MonitorResp {
  ok: boolean;
  report?: { window_hours: number; total_turns: number; counts: Record<string, number> };
  agents?: AgentHealth[];
  error?: string;
}

// Assinaturas monitoradas. `problem`=true conta como problema; grounding e metrica (rede de seguranca).
const SIGNATURES: { key: string; label: string; problem: boolean; hint: string }[] = [
  { key: 'unsolicited_photos', label: 'Fotos s/ pedir', problem: true, hint: 'Enviou fotos sem o lead pedir' },
  { key: 'ctwa_ad_lost', label: 'Anúncio perdido', problem: true, hint: 'Lead de anúncio cujo contexto se perdeu' },
  { key: 'ad_vehicle_unresolved', label: 'Anúncio n/ resolvido', problem: true, hint: 'Anúncio presente mas veículo não identificado' },
  { key: 'byok_block', label: 'Sem chave IA', problem: true, hint: 'Conta sem chave de IA — não respondeu' },
  { key: 'provider_error', label: 'Falha de IA', problem: true, hint: 'Sem crédito / chave inválida no provedor' },
  { key: 'grounding_corrected', label: 'Alucinação barrada', problem: false, hint: 'Validador pegou e corrigiu (métrica, não erro)' },
];
const PROBLEM_KEYS = SIGNATURES.filter((s) => s.problem).map((s) => s.key);

function dataHora(s: unknown) {
  if (!s) return '—';
  try { return new Date(String(s)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(s); }
}
function horaCurta(s: unknown) {
  if (!s) return '—';
  try { return new Date(String(s)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return String(s); }
}
const problemTotal = (counts: Record<string, number>) =>
  PROBLEM_KEYS.reduce((n, k) => n + (counts?.[k] || 0), 0);

export default function Administracao() {
  const [hours, setHours] = useState(24);
  const [agents, setAgents] = useState<AgentHealth[]>([]);
  const [report, setReport] = useState<MonitorResp['report'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await supabase.functions.invoke('pedro-v2-health-monitor', {
        body: { hours, per_agent: true, dry_run: true },
      });
      if (error) throw error;
      const resp = data as MonitorResp;
      if (!resp?.ok) throw new Error(resp?.error || 'Falha ao carregar o relatório.');
      setAgents(Array.isArray(resp.agents) ? resp.agents : []);
      setReport(resp.report ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErro(msg.includes('forbidden') ? 'Acesso restrito aos administradores.' : (msg || 'Falha ao carregar.'));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => { carregar(); }, [carregar]);

  const totalConversas = report?.total_turns ?? agents.reduce((n, a) => n + a.total_turns, 0);
  const agentesComProblema = agents.filter((a) => problemTotal(a.counts) > 0).length;
  const alucinacoesBarradas = agents.reduce((n, a) => n + (a.counts?.grounding_corrected || 0), 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      {/* ── Cabecalho ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Administração — Saúde dos Agentes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Qualidade do atendimento do Pedro v2 por agente de cliente. Visão de operação — só administradores.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            {[{ h: 24, l: '24h' }, { h: 168, l: '7 dias' }].map((opt) => (
              <button
                key={opt.h}
                onClick={() => setHours(opt.h)}
                className={`rounded px-3 py-1 text-sm transition-colors ${hours === opt.h ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {opt.l}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* ── Cards de totais ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard icon={Users} cor="text-sky-500" titulo="Agentes ativos"
          valor={loading ? null : String(agents.length)} sub={`janela de ${hours === 24 ? '24h' : '7 dias'}`} />
        <TotalCard icon={Activity} cor="text-primary" titulo="Conversas"
          valor={loading ? null : totalConversas.toLocaleString('pt-BR')} sub="turnos atendidos" />
        <TotalCard icon={AlertTriangle} cor={agentesComProblema > 0 ? 'text-amber-500' : 'text-emerald-500'} titulo="Agentes com alerta"
          valor={loading ? null : String(agentesComProblema)} sub={agentesComProblema > 0 ? 'precisam de atenção' : 'tudo limpo'} />
        <TotalCard icon={BadgeCheck} cor="text-emerald-500" titulo="Alucinações barradas"
          valor={loading ? null : String(alucinacoesBarradas)} sub="grounding (rede de segurança)" />
      </div>

      {/* ── Tabela por agente ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Por agente</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Agente / Cliente</TableHead>
                  <TableHead className="text-right">Conversas</TableHead>
                  {SIGNATURES.map((s) => (
                    <TableHead key={s.key} className="text-center text-[11px]" title={s.hint}>{s.label}</TableHead>
                  ))}
                  <TableHead className="text-right">Última atividade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 4 + SIGNATURES.length }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : agents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4 + SIGNATURES.length} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma atividade de agente nesta janela.
                    </TableCell>
                  </TableRow>
                ) : (
                  agents.map((a) => {
                    const key = a.agent_id || a.agent_name;
                    const isOpen = expanded === key;
                    const probs = problemTotal(a.counts);
                    return (
                      <>
                        <TableRow
                          key={key}
                          className={`cursor-pointer ${probs > 0 ? 'bg-amber-500/5' : ''}`}
                          onClick={() => setExpanded(isOpen ? null : key)}
                        >
                          <TableCell className="text-muted-foreground">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="max-w-[220px]">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{a.agent_name}</span>
                              {probs > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{probs}</Badge>}
                            </div>
                            {a.client_name && <div className="truncate text-[11px] text-muted-foreground">{a.client_name}</div>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{a.total_turns.toLocaleString('pt-BR')}</TableCell>
                          {SIGNATURES.map((s) => {
                            const n = a.counts?.[s.key] || 0;
                            const color = n === 0 ? 'text-muted-foreground/40'
                              : s.problem ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-sky-600 dark:text-sky-400';
                            return <TableCell key={s.key} className={`text-center tabular-nums ${color}`}>{n || '·'}</TableCell>;
                          })}
                          <TableCell className="text-right text-[11px] text-muted-foreground">{horaCurta(a.last_activity)}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={key + '-drill'} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={3 + SIGNATURES.length} className="py-3">
                              <DrillDown agent={a} />
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Telefones aparecem mascarados (últimos 4 dígitos). "Alucinação barrada" é a rede de segurança funcionando
        (não é erro). Custo e margem por cliente ficam em <span className="font-medium">Margem (IA)</span>.
      </p>
    </div>
  );
}

/* ── drill-down: amostras por assinatura do agente ── */
function DrillDown({ agent }: { agent: AgentHealth }) {
  const blocks = SIGNATURES
    .map((s) => ({ ...s, items: agent.samples?.[s.key] || [] }))
    .filter((b) => b.items.length > 0);

  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada nesta janela. 👍</p>;
  }
  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <div key={b.key}>
          <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${b.problem ? 'text-amber-600 dark:text-amber-400' : 'text-sky-600 dark:text-sky-400'}`}>
            {b.label} · {b.items.length}
          </p>
          <div className="space-y-1">
            {b.items.slice(0, 10).map((s, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]">
                <span className="text-muted-foreground tabular-nums">{horaCurta(s.at)}</span>
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

/* ── card de total ── */
function TotalCard({
  icon: Icon, cor, titulo, valor, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  cor: string; titulo: string; valor: string | null; sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
          <Icon className={`h-4 w-4 ${cor}`} />
        </div>
        {valor === null
          ? <Skeleton className="mt-2 h-7 w-20" />
          : <p className="mt-1 text-2xl font-bold text-foreground">{valor}</p>}
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
