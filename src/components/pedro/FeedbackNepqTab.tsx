import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
} from 'recharts';
import { Gauge, Loader2, AlertTriangle, TrendingUp, Users, Lightbulb, Target, BookOpen } from 'lucide-react';

// ── Feedbacks > NEPQ / Desempenho (o "Power BI") ─────────────────────────────
// Nível 1 (gestor): ranking com semáforo + KPIs da equipe + alerta de conflito
// de rotulagem. Nível 2: radar das 12 dimensões NEPQ do vendedor escolhido.
// Lê o rollup (feedback_rollup_por_vendedor). O drill-down conversa a conversa +
// coaching verbatim fica na aba "Por vendedor".

interface Rollup {
  vendedor_id: string;
  periodo: string;
  conversas: number;
  score_medio: number | null;
  notas_por_dimensao: Record<string, number>;
  taxa_conflito_rotulagem: number | null;
  distribuicao_veredicto: Record<string, number>;
  distribuicao_qualidade: Record<string, number>;
}

const DIMS: { cod: string; label: string }[] = [
  { cod: 'A', label: 'Conexão' }, { cod: 'B1', label: 'Situação' }, { cod: 'B2', label: 'Problema' },
  { cod: 'B3', label: 'Solução' }, { cod: 'B4', label: 'Consequência' }, { cod: 'B5', label: 'Qualificação' },
  { cod: 'C', label: 'Apresentação' }, { cod: 'D', label: 'Compromisso' }, { cod: 'E1', label: 'Tom' },
  { cod: 'E2', label: 'Escuta' }, { cod: 'E3', label: 'Objeção' }, { cod: 'E4', label: 'Ritmo' },
];
const QLABEL: Record<string, string> = { '1_alto': 'forte', '2_medio': 'bom', '3_baixo': 'difícil', '4_nao_lead': 'não era lead', sem: 'sem análise' };
const VLABEL: Record<string, string> = {
  venda_realizada: 'vendeu', perda_legitima: 'perda ok', falha_atendimento: 'falha atend.',
  lead_ruim: 'lead ruim', rotulagem_incorreta: 'rotulou errado', sem: 'sem veredito',
};

function semaforo(score: number | null): { dot: string; txt: string; label: string } {
  if (score == null) return { dot: 'bg-muted-foreground/40', txt: 'text-muted-foreground', label: 'sem NEPQ' };
  if (score >= 70) return { dot: 'bg-emerald-400', txt: 'text-emerald-400', label: 'verde' };
  if (score >= 45) return { dot: 'bg-amber-400', txt: 'text-amber-400', label: 'amarelo' };
  return { dot: 'bg-rose-400', txt: 'text-rose-400', label: 'vermelho' };
}
function explicarDimensao(label: string): { impacto: string; acao: string } {
  const l = label.toLowerCase();
  if (l.includes('escuta')) return { impacto: 'O cliente sente que precisa repetir informacoes.', acao: 'Confirmar o que o cliente ja disse antes de fazer nova pergunta.' };
  if (l.includes('obje')) return { impacto: 'Objeções podem virar encerramento da conversa.', acao: 'Responder a objeção e conduzir para uma proxima etapa concreta.' };
  if (l.includes('qualifica')) return { impacto: 'O vendedor nao entende se o lead esta pronto para comprar.', acao: 'Coletar forma de pagamento, troca, prazo e preferencia sem interrogatorio.' };
  if (l.includes('compromisso')) return { impacto: 'A conversa fica sem combinacao de proximo passo.', acao: 'Sempre fechar com visita, simulacao, envio de proposta ou retorno combinado.' };
  if (l.includes('ritmo')) return { impacto: 'Atendimento lento ou travado reduz conversao.', acao: 'Responder com frases curtas e avancar uma etapa por mensagem.' };
  return { impacto: 'Esse ponto reduz a clareza do atendimento.', acao: 'Revisar conversas de baixa nota e padronizar a abordagem.' };
}

export function FeedbackNepqTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Rollup[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string>('');
  // Fase 3 (front-only) — selo agregado "X de Y análises parciais" por vendedor,
  // calculado a partir da confianca_analise já exposta em feedback_relatorio_por_vendedor.
  const [parcialPorVendedor, setParcialPorVendedor] = useState<Record<string, { parciais: number; total: number }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: roll, error: e1 }, { data: team }, { data: convs }] = await Promise.all([
        (supabase as any).rpc('feedback_rollup_por_vendedor'),
        (supabase as any).from('ai_team_members').select('id, name'),
        (supabase as any).rpc('feedback_relatorio_por_vendedor'), // só pra agregar confiança
      ]);
      if (e1) throw e1;
      const map: Record<string, string> = {};
      for (const m of (team || [])) map[m.id] = m.name;
      setNomes(map);
      setRows(Array.isArray(roll) ? roll : []);

      // Agrega confiança por vendedor (NULL/legado não conta).
      const pmap: Record<string, { parciais: number; total: number }> = {};
      for (const c of (Array.isArray(convs) ? convs : [])) {
        const conf = (c as any)?.confianca_analise;
        const vid = (c as any)?.vendedor_id;
        if (!conf || !vid) continue;
        const e = pmap[String(vid)] || (pmap[String(vid)] = { parciais: 0, total: 0 });
        e.total += 1;
        if (conf === 'media' || conf === 'baixa') e.parciais += 1;
      }
      setParcialPorVendedor(pmap);
    } catch (e: any) {
      toast({ title: 'Erro ao carregar NEPQ', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  // Usa o mês mais recente presente no rollup (uma linha por vendedor).
  const periodo = useMemo(() => rows.map((r) => r.periodo).sort().slice(-1)[0] || '', [rows]);
  const vendedoresBase = useMemo(() => {
    const doMes = rows.filter((r) => r.periodo === periodo);
    return doMes
      .map((r) => ({ ...r, nome: nomes[r.vendedor_id] || '(vendedor)' }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [rows, periodo, nomes]);
  const vendedores = useMemo(() => (
    vendedoresBase
      .filter((v) => v.score_medio != null)
      .sort((a, b) => (a.score_medio ?? 999) - (b.score_medio ?? 999) || a.nome.localeCompare(b.nome))
  ), [vendedoresBase]);
  const semNepq = useMemo(() => vendedoresBase.filter((v) => v.score_medio == null), [vendedoresBase]);

  useEffect(() => {
    if (!sel && vendedores.length) setSel(vendedores.find((v) => v.score_medio != null)?.vendedor_id || vendedores[0].vendedor_id);
  }, [vendedores, sel]);

  // KPIs da equipe.
  const kpis = useMemo(() => {
    const comNepq = vendedores;
    const scoreEquipe = comNepq.length ? Math.round(comNepq.reduce((a, v) => a + (v.score_medio || 0), 0) / comNepq.length) : null;
    const totalConv = vendedoresBase.reduce((a, v) => a + (v.conversas || 0), 0);
    const somaDist = (key: 'distribuicao_qualidade' | 'distribuicao_veredicto') => {
      const acc: Record<string, number> = {};
      for (const v of vendedoresBase) for (const [k, n] of Object.entries(v[key] || {})) acc[k] = (acc[k] || 0) + (n as number);
      return acc;
    };
    const vered = somaDist('distribuicao_veredicto');
    const conflitos = vered['rotulagem_incorreta'] || 0;
    return {
      scoreEquipe, totalConv, comNepq: comNepq.length,
      pctConflito: totalConv ? Math.round((conflitos / totalConv) * 100) : 0,
      conflitos,
      qualidade: somaDist('distribuicao_qualidade'),
      veredicto: vered,
    };
  }, [vendedores, vendedoresBase]);

  const atual = vendedores.find((v) => v.vendedor_id === sel) || null;
  const radarData = useMemo(() => {
    const nd = atual?.notas_por_dimensao || {};
    return DIMS.map((d) => ({ dim: d.label, nota: Number(nd[d.cod] ?? 0) }));
  }, [atual]);
  const pontoFraco = useMemo(() => {
    const validos = radarData.filter((d) => Number.isFinite(d.nota));
    return validos.length ? [...validos].sort((a, b) => a.nota - b.nota)[0] : null;
  }, [radarData]);
  const leituraPontoFraco = pontoFraco ? explicarDimensao(pontoFraco.dim) : null;
  const habilidadesPrioritarias = useMemo(() => {
    return [...radarData]
      .sort((a, b) => a.nota - b.nota)
      .slice(0, 3)
      .map((d) => ({ ...d, leitura: explicarDimensao(d.dim) }));
  }, [radarData]);

  const alertas = vendedoresBase.filter((v) => (v.taxa_conflito_rotulagem || 0) > 0);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando desempenho NEPQ...</div>;
  }
  if (!vendedoresBase.length) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <Gauge className="h-8 w-8 mx-auto mb-3 opacity-30" />
        Ainda não há dados NEPQ. Assim que as conversas forem analisadas, o ranking e o radar aparecem aqui.
      </div>
    );
  }

  const mesLabel = periodo ? (() => { const [y, m] = periodo.split('-'); return `${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][Number(m) - 1]}/${y}`; })() : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
          <Gauge className="h-4 w-4 text-indigo-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground leading-tight">Desempenho NEPQ da equipe</h3>
          <p className="text-xs text-muted-foreground">Qualidade do atendimento por método NEPQ · {mesLabel}. Ranking mostra quem precisa de coaching primeiro.</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-card border border-border/50 rounded-xl px-3 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Nota média da equipe</div>
          <div className={`text-lg font-semibold ${semaforo(kpis.scoreEquipe).txt}`}>{kpis.scoreEquipe ?? '—'}</div>
        </div>
        <div className="bg-card border border-border/50 rounded-xl px-3 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Conflito de rotulagem</div>
          <div className={`text-lg font-semibold ${kpis.pctConflito > 0 ? 'text-rose-400' : 'text-foreground'}`}>{kpis.pctConflito}%</div>
        </div>
        <div className="bg-card border border-border/50 rounded-xl px-3 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Vendedores avaliados</div>
          <div className="text-lg font-semibold text-foreground">{kpis.comNepq}/{vendedoresBase.length}</div>
        </div>
        <div className="bg-card border border-border/50 rounded-xl px-3 py-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Conversas analisadas</div>
          <div className="text-lg font-semibold text-foreground">{kpis.totalConv}</div>
        </div>
      </div>

      {atual && pontoFraco && leituraPontoFraco && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Target className="h-3.5 w-3.5" /> Onde treinar primeiro
            </div>
            <div className="mt-2 text-base font-semibold text-foreground">{atual.nome}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Menor dimensao: <span className="font-semibold text-foreground">{pontoFraco.dim}</span> ({pontoFraco.nota}/4).
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <BookOpen className="h-3.5 w-3.5" /> Impacto na venda
            </div>
            <p className="mt-2 text-sm text-amber-800/85 dark:text-amber-100/85">{leituraPontoFraco.impacto}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <Lightbulb className="h-3.5 w-3.5" /> Proxima acao
            </div>
            <p className="mt-2 text-sm text-emerald-800/85 dark:text-emerald-100/85">{leituraPontoFraco.acao}</p>
          </div>
        </div>
      )}

      {/* Alerta de conflito */}
      {alertas.length > 0 && (
        <div className="flex items-start gap-2 text-xs bg-rose-500/10 border border-rose-500/25 text-rose-700 rounded-lg px-3 py-2 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span><span className="font-semibold">Atenção:</span> {alertas.map((a) => nomes[a.vendedor_id] || '?').join(', ')} está marcando lead bom como ruim (conflito de rotulagem) — isso corrompe o aprendizado das campanhas. Priorize o alinhamento.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ranking */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Prioridade de coaching</div>
          {vendedores.map((v) => {
            const s = semaforo(v.score_medio);
            const on = v.vendedor_id === sel;
            return (
              <button
                key={v.vendedor_id}
                onClick={() => setSel(v.vendedor_id)}
                className={`w-full text-left bg-card border rounded-xl px-3 py-2.5 flex items-center gap-3 transition-colors ${on ? 'border-indigo-500/50 ring-1 ring-indigo-500/30' : 'border-border/50 hover:border-border'}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-foreground truncate">{v.nome}</span>
                  {(() => {
                    const parc = parcialPorVendedor[v.vendedor_id];
                    return parc && parc.parciais > 0 ? (
                      <span className="block text-[10px] text-amber-500 dark:text-amber-400 truncate">
                        {parc.parciais} de {parc.total} análises parciais
                      </span>
                    ) : null;
                  })()}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0">{v.conversas} conv.</span>
                <span className={`text-base font-semibold w-9 text-right shrink-0 ${s.txt}`}>{v.score_medio ?? '—'}</span>
              </button>
            );
          })}
          {semNepq.length > 0 && (
            <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Sem nota NEPQ suficiente</div>
              <div className="flex flex-wrap gap-2">
                {semNepq.map((v) => (
                  <span key={v.vendedor_id} className="text-[11px] px-2 py-1 rounded-full border border-border/60 text-muted-foreground">
                    {v.nome} · {v.conversas} conv.
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Radar do vendedor */}
        <div className="bg-card border border-border/50 rounded-xl p-3">
          {atual && atual.score_medio != null ? (
            <>
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold text-foreground">{atual.nome}</div>
                <div className={`text-sm font-semibold ${semaforo(atual.score_medio).txt}`}>{atual.score_medio} <span className="text-[10px] text-muted-foreground">/100</span></div>
              </div>
              <div className="mb-3 rounded-xl border border-primary/20 bg-primary/10 p-3">
                <div className="text-xs font-semibold text-primary">Traducao simples para o gestor</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {habilidadesPrioritarias.map((h, idx) => (
                    <div key={h.dim} className="rounded-lg border border-border/50 bg-background/35 p-2">
                      <div className="text-[11px] font-semibold text-foreground">{idx + 1}. {h.dim}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">Nota {h.nota}/4</div>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{h.leitura.acao}</p>
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="dim" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <PolarRadiusAxis domain={[0, 4]} tickCount={5} tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                  <Radar dataKey="nota" stroke="#818cf8" fill="#818cf8" fillOpacity={0.35} />
                </RadarChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground text-center">Cada eixo é uma dimensão NEPQ (0–4). Quanto mais preenchido, melhor o atendimento naquela etapa.</p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {radarData.map((d) => (
                  <div key={d.dim} className="rounded-lg bg-muted/25 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                      <span className="text-muted-foreground truncate">{d.dim}</span>
                      <span className="font-medium text-foreground">{d.nota}/4</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-background overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(0, Math.min(100, (d.nota / 4) * 100))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-center text-sm text-muted-foreground px-4">
              <div>
                <Users className="h-7 w-7 mx-auto mb-2 opacity-30" />
                {atual ? `${atual.nome} ainda não tem conversa analisada pelo NEPQ neste mês.` : 'Selecione um vendedor.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
