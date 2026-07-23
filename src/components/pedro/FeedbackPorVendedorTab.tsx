import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, Loader2, Download, Trophy, AlertTriangle, Clock, Star, MessageSquareQuote,
  CheckCircle2, ClipboardList, Target,
} from 'lucide-react';
import { ConfiancaAnaliseBadge } from './ConfiancaAnaliseBadge';

// ── Feedbacks > Por vendedor ─────────────────────────────────────────────────
// A visão que faltava: filtra por vendedor e mostra, conversa a conversa, COMO
// ele atendeu — nota (score), qualidade do lead, tempo até a 1ª resposta, se
// vendeu / perdeu uma chance boa, e a frase de coaching (o "depoimento"). Lê a
// RPC feedback_relatorio_por_vendedor (resolve o tenant do próprio master) e
// baixa o relatório completo daquele vendedor (edge feedback-relatorio-pdf).

interface Conversa {
  fc_id: string;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  lead_name: string | null;
  score: number | null;
  qualidade_lead: string | null;
  potencial_compra: string | null;
  temperature: string | null;
  frase_coaching: string | null;
  resumo_executivo: string | null;
  evidencia_principal: string | null;
  risco_perda: string | null;
  acao_gestor: string | null;
  acao_vendedor: string | null;
  proxima_pergunta_ideal: string | null;
  oportunidades_perdidas: string[] | null;
  tempo_resposta_min: number | null;
  houve_venda: string | null;
  vehicle_interest: string | null;
  confianca_analise?: string | null; // Fase 3 (só leitura)
  motivo_confianca?: string | null;
}

const QMAP: Record<string, { label: string; cls: string }> = {
  '1_alto':     { label: 'lead forte',    cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300' },
  '2_medio':    { label: 'lead bom',      cls: 'bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300' },
  '3_baixo':    { label: 'lead difícil',  cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300' },
  '4_nao_lead': { label: 'não era lead',  cls: 'bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300' },
};

// Potencial do lead: qualidade oficial > potencial do especialista > temperatura.
function potDe(c: Conversa): 'forte' | 'bom' | 'dificil' | 'nao' | 'sem' {
  const q = c.qualidade_lead;
  if (q === '1_alto') return 'forte';
  if (q === '2_medio') return 'bom';
  if (q === '3_baixo') return 'dificil';
  if (q === '4_nao_lead') return 'nao';
  const pc = String(c.potencial_compra || '').toLowerCase();
  if (pc === 'alto') return 'forte';
  if (pc === 'medio') return 'bom';
  if (pc === 'baixo') return 'dificil';
  if (pc === 'nao_lead') return 'nao';
  const t = String(c.temperature || '').toLowerCase();
  if (t === 'quente') return 'bom';
  if (t === 'frio') return 'dificil';
  return 'sem';
}
const ehBom = (c: Conversa) => { const p = potDe(c); return p === 'forte' || p === 'bom'; };
const vendeu = (c: Conversa) => c.houve_venda === 'true';
// Regras canônicas (mesmas do relatório do WhatsApp / PDF completo), pra a tela
// não divergir: bem atendido = lead bom E nota>=50; perdeu chance = lead bom,
// nota<45 e sem venda (nunca é injusto com quem só pegou lead fraco).
const LIMIAR_BEM = 50;
const LIMIAR_PERDEU = 45;
const score0 = (c: Conversa) => Number(c.score) || 0;
const bemAtendido = (c: Conversa) => ehBom(c) && score0(c) >= LIMIAR_BEM;
const perdeuChanceBoa = (c: Conversa) => ehBom(c) && score0(c) < LIMIAR_PERDEU && !vendeu(c);
function riscoGerencial(c: Conversa): number {
  let r = 0;
  const p = potDe(c);
  if (p === 'forte') r += 45;
  if (p === 'bom') r += 30;
  if (score0(c) < LIMIAR_PERDEU) r += 35;
  if (!vendeu(c)) r += 10;
  if (Array.isArray(c.oportunidades_perdidas) && c.oportunidades_perdidas.length) r += 10;
  const riscoLLM = String(c.risco_perda || '').toLowerCase();
  if (riscoLLM === 'alto') r += 25;
  if (riscoLLM === 'medio') r += 10;
  return r;
}

function textoAcao(c?: Conversa | null): string {
  return c?.acao_gestor
    || c?.acao_vendedor
    || c?.proxima_pergunta_ideal
    || c?.frase_coaching
    || 'Treinar escuta ativa, confirmacao das informacoes ja ditas e proximo passo claro.';
}

function textoProva(c?: Conversa | null): string {
  if (!c) return 'Sem conversa critica identificada.';
  if (c.evidencia_principal) return c.evidencia_principal;
  const ops = Array.isArray(c.oportunidades_perdidas) ? c.oportunidades_perdidas : [];
  const primeira = ops
    .map((op: any) => (typeof op === 'string' ? op : op?.texto || op?.trecho || op?.resumo || ''))
    .filter(Boolean)[0];
  return primeira || c.resumo_executivo || c.frase_coaching || `Revisar primeiro a conversa de ${c.lead_name || 'lead sem nome'} (nota ${score0(c)}).`;
}

function fmtMin(mRaw: number): string {
  const m = Math.round(mRaw);
  if (m <= 0) return '—';
  if (m >= 2880) return `${Math.round(m / 1440)} dias`;
  if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h${String(mm).padStart(2, '0')}` : `${h}h`; }
  return `${m} min`;
}
function scoreCls(s: number): string {
  if (s >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (s >= 50) return 'text-sky-600 dark:text-sky-400';
  if (s >= 30) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
function decisaoScore(s: number): { label: string; cls: string } {
  if (s >= 70) return { label: 'Atendimento forte', cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/25 dark:text-emerald-300' };
  if (s >= 50) return { label: 'Atendimento ok', cls: 'text-sky-700 bg-sky-500/10 border-sky-500/25 dark:text-sky-300' };
  if (s >= 30) return { label: 'Precisa ajuste', cls: 'text-amber-700 bg-amber-500/10 border-amber-500/25 dark:text-amber-300' };
  return { label: 'Risco de perda', cls: 'text-rose-700 bg-rose-500/10 border-rose-500/25 dark:text-rose-300' };
}
function vendedorInsight(v: Vendedor): { resumo: string; risco: string; acao: string; prova: string } {
  const pctBem = v.bons ? Math.round((v.bemAtendidos / v.bons) * 100) : 0;
  const pior = [...v.convs].sort((a, b) => score0(a) - score0(b))[0];
  const melhor = [...v.convs].sort((a, b) => score0(b) - score0(a))[0];
  const prova = textoProva(pior);

  if (v.perdeuChance > 0) {
    return {
      resumo: `${v.nome} tem ${v.perdeuChance} chance boa com risco real de perda.`,
      risco: 'Lead bom foi atendido com nota baixa e nao virou venda.',
      acao: textoAcao(pior) || 'Abrir as conversas criticas, corrigir abordagem e alinhar o criterio de classificacao.',
      prova,
    };
  }
  if (v.bons > 0 && pctBem < 60) {
    return {
      resumo: `${v.nome} esta recebendo leads bons, mas ainda entrega pouco atendimento forte.`,
      risco: `Somente ${pctBem}% dos leads bons foram bem atendidos.`,
      acao: textoAcao(pior) || 'Treinar a passagem de necessidade para proposta e reduzir perguntas repetidas.',
      prova,
    };
  }
  if (v.scoreMedio >= 70) {
    return {
      resumo: `${v.nome} esta com atendimento consistente.`,
      risco: 'Sem alerta critico no periodo.',
      acao: melhor?.lead_name ? `Usar a conversa de ${melhor.lead_name} como exemplo para o time.` : 'Manter acompanhamento semanal.',
      prova,
    };
  }
  return {
    resumo: `${v.nome} precisa de acompanhamento, mas sem sinal de perda critica agora.`,
    risco: 'A nota media ainda esta abaixo do ideal.',
    acao: 'Escolher uma conversa ruim por dia e registrar um ponto de melhoria objetivo.',
    prova,
  };
}

interface Vendedor {
  id: string;
  nome: string;
  convs: Conversa[];
  analisados: number;
  bons: number;
  bemAtendidos: number;
  vendas: number;
  perdeuChance: number;
  scoreMedio: number;
}

export function FeedbackPorVendedorTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [convs, setConvs] = useState<Conversa[]>([]);
  const [sel, setSel] = useState<string>('');
  const [baixando, setBaixando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await (supabase as any).rpc('feedback_relatorio_por_vendedor');
      if (error) throw error;
      const arr: Conversa[] = Array.isArray(data) ? data : [];
      setConvs(arr.filter((c) => c.vendedor_id)); // exclui "(sem vendedor)"
    } catch (e: any) {
      setConvs([]);
      setErrorMsg(e?.message || 'Nao foi possivel carregar o desempenho por vendedor.');
      toast({ title: 'Erro ao carregar', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const vendedores = useMemo<Vendedor[]>(() => {
    const m = new Map<string, Conversa[]>();
    for (const c of convs) {
      const id = String(c.vendedor_id);
      (m.get(id) || m.set(id, []).get(id)!).push(c);
    }
    const list: Vendedor[] = [];
    for (const [id, cs] of m) {
      const bons = cs.filter(ehBom).length;
      const bemAtendidos = cs.filter(bemAtendido).length;
      const vendas = cs.filter(vendeu).length;
      const perdeuChance = cs.filter(perdeuChanceBoa).length;
      const scoreMedio = cs.length ? Math.round(cs.reduce((a, c) => a + (Number(c.score) || 0), 0) / cs.length) : 0;
      list.push({
        id, nome: cs[0]?.vendedor_nome || '(vendedor)', convs: cs,
        analisados: cs.length, bons, bemAtendidos, vendas, perdeuChance, scoreMedio,
      });
    }
    return list.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [convs]);

  // Seleciona o primeiro vendedor assim que a lista chega.
  useEffect(() => {
    if (!sel && vendedores.length) setSel(vendedores[0].id);
  }, [vendedores, sel]);

  const atual = vendedores.find((v) => v.id === sel) || null;
  const conversasOrdenadas = useMemo(
    () => atual ? [...atual.convs].sort((a, b) => riscoGerencial(b) - riscoGerencial(a) || score0(a) - score0(b)) : [],
    [atual],
  );
  const conversaCritica = conversasOrdenadas[0] || null;
  const melhorConversa = useMemo(
    () => atual ? [...atual.convs].sort((a, b) => score0(b) - score0(a))[0] || null : null,
    [atual],
  );
  const conversaComProva = conversasOrdenadas.find((c) => Array.isArray(c.oportunidades_perdidas) && c.oportunidades_perdidas.length) || conversaCritica;

  const baixarPdf = async () => {
    if (!atual) return;
    setBaixando(true);
    try {
      const { data, error } = await supabase.functions.invoke('feedback-relatorio-pdf', { body: { vendedor_id: atual.id } });
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error(data?.error || 'Não foi possível gerar o PDF');
      window.open(data.url, '_blank');
    } catch (e: any) {
      toast({ title: 'Não deu pra baixar', description: e?.message, variant: 'destructive' });
    } finally {
      setBaixando(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando desempenho dos vendedores...
      </div>
    );
  }

  if (!vendedores.length) {
    if (errorMsg) {
      return (
        <div className="border border-rose-500/25 bg-rose-500/10 rounded-2xl p-5 text-sm text-rose-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-300 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <div className="font-semibold">Nao consegui carregar a aba por vendedor.</div>
              <div className="text-rose-100/80">{errorMsg}</div>
              <Button variant="outline" size="sm" onClick={load} className="mt-1">
                Tentar novamente
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
        Ainda não há conversas analisadas por vendedor. As análises entram automaticamente conforme os leads são atendidos.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Users className="h-4 w-4 text-violet-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground leading-tight">Desempenho por vendedor</h3>
          <p className="text-xs text-muted-foreground">Escolha um vendedor e veja, conversa a conversa, como ele atendeu.</p>
        </div>
      </div>

      {/* Seletor + baixar PDF */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Select value={sel} onValueChange={setSel}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="Escolha um vendedor" />
          </SelectTrigger>
          <SelectContent>
            {vendedores.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.nome} · {v.analisados} lead{v.analisados > 1 ? 's' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {atual && (
          <Button variant="outline" size="sm" onClick={baixarPdf} disabled={baixando} className="gap-1.5">
            {baixando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Baixar relatório completo deste vendedor
          </Button>
        )}
      </div>

      {atual && (
        <>
          {(() => {
            const ins = vendedorInsight(atual);
            const status = decisaoScore(atual.scoreMedio);
            return (
              <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${status.cls}`}>
                      <Target className="h-3.5 w-3.5" />
                      {status.label}
                    </div>
                    <div>
                      <h4 className="text-base font-semibold text-foreground">Leitura do gestor</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{ins.resumo}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3 lg:w-[62%]">
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> Risco
                      </div>
                      <p className="mt-1 text-xs text-amber-100/80">{ins.risco}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Acao
                      </div>
                      <p className="mt-1 text-xs text-emerald-100/80">{ins.acao}</p>
                    </div>
                    <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                        <ClipboardList className="h-3.5 w-3.5" /> Prova
                      </div>
                      <p className="mt-1 text-xs text-sky-100/80">{ins.prova}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="grid gap-3 lg:grid-cols-3">
            <MiniAcao
              titulo="1. Olhar agora"
              subtitulo={conversaCritica?.lead_name || 'Sem lead critico'}
              texto={conversaCritica
                ? `Maior risco gerencial: nota ${score0(conversaCritica)} com ${potDe(conversaCritica) === 'forte' ? 'lead forte' : potDe(conversaCritica) === 'bom' ? 'lead bom' : 'lead em analise'}.`
                : 'Nao ha conversa critica para priorizar neste vendedor.'}
              tom="red"
            />
            <MiniAcao
              titulo="2. Usar como exemplo"
              subtitulo={melhorConversa?.lead_name || 'Sem exemplo positivo'}
              texto={melhorConversa
                ? `Melhor conversa do periodo: nota ${score0(melhorConversa)}. Use para mostrar o comportamento esperado.`
                : 'Ainda falta volume para escolher uma conversa modelo.'}
              tom="green"
            />
            <MiniAcao
              titulo="3. Ponto de coaching"
              subtitulo="Mensagem pronta para alinhar"
              texto={textoAcao(conversaComProva)}
              tom="blue"
            />
          </div>

          {/* Resumo do vendedor */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {[
              { lb: 'Nota média', v: atual.scoreMedio, cls: scoreCls(atual.scoreMedio), ic: Star },
              { lb: 'Leads analisados', v: atual.analisados, cls: 'text-foreground', ic: Users },
              { lb: 'Leads bons', v: atual.bons, cls: 'text-sky-600 dark:text-sky-400', ic: Trophy },
              { lb: 'Bem atendidos', v: atual.bemAtendidos, cls: 'text-emerald-600 dark:text-emerald-400', ic: Star },
              { lb: 'Vendas', v: atual.vendas, cls: 'text-emerald-600 dark:text-emerald-400', ic: Trophy },
            ].map((t) => {
              const Ic = t.ic;
              return (
                <div key={t.lb} className="bg-card border border-border/50 rounded-xl px-3 py-2.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                    <Ic className="h-3 w-3" /> {t.lb}
                  </div>
                  <div className={`text-lg font-semibold ${t.cls}`}>{t.v}</div>
                </div>
              );
            })}
          </div>
          {atual.perdeuChance > 0 && (
            <div className="flex items-center gap-2 text-xs bg-rose-500/10 border border-rose-500/25 text-rose-300 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Perdeu <span className="font-semibold">{atual.perdeuChance}</span> chance{atual.perdeuChance > 1 ? 's' : ''} boa{atual.perdeuChance > 1 ? 's' : ''} (lead bom com atendimento fraco e sem venda).
            </div>
          )}

          {/* Conversas priorizadas por risco gerencial. */}
          <div className="space-y-2.5">
            {conversasOrdenadas.map((c) => {
              const score = Number(c.score) || 0;
              const q = c.qualidade_lead && QMAP[c.qualidade_lead];
              const venda = vendeu(c);
              const perdeu = perdeuChanceBoa(c);
              const ops = Array.isArray(c.oportunidades_perdidas)
                ? c.oportunidades_perdidas
                    .map((op: any) => (typeof op === 'string' ? op : op?.texto || op?.trecho || op?.resumo || ''))
                    .filter(Boolean)
                : [];
              return (
                <div key={c.fc_id} className="bg-card border border-border/50 rounded-xl px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{c.lead_name || '(sem nome)'}</span>
                        {q && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${q.cls}`}>{q.label}</span>
                        )}
                        {venda && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Vendeu</span>
                        )}
                        {perdeu && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-rose-500/15 text-rose-300 border-rose-500/30">Perdeu chance boa</span>
                        )}
                        <ConfiancaAnaliseBadge confianca={c.confianca_analise} motivo={c.motivo_confianca} showMotivo={false} className="text-[10px]" />
                      </div>
                      {c.vehicle_interest && (
                        <div className="text-[11px] text-muted-foreground truncate">Interesse: {c.vehicle_interest}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className={`text-lg font-semibold leading-none ${scoreCls(score)}`}>{score}</div>
                        <div className="text-[9px] text-muted-foreground">nota</div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-xs text-foreground leading-none">
                          <Clock className="h-3 w-3 text-muted-foreground" /> {fmtMin(Number(c.tempo_resposta_min) || 0)}
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">1ª resposta</div>
                      </div>
                    </div>
                  </div>
                  {c.frase_coaching && (
                    <div className="flex gap-2 text-[12px] text-foreground/90 bg-muted/40 rounded-lg px-3 py-2">
                      <MessageSquareQuote className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                      <span className="italic">“{c.frase_coaching}”</span>
                    </div>
                  )}
                  {c.evidencia_principal && (
                    <div className="flex gap-2 text-[12px] text-foreground/90 bg-muted/40 rounded-lg px-3 py-2">
                      <MessageSquareQuote className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                      <span className="italic">"{c.evidencia_principal}"</span>
                    </div>
                  )}
                  {(c.acao_gestor || c.acao_vendedor || c.proxima_pergunta_ideal) && (
                    <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                      {(c.acao_gestor || c.acao_vendedor) && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-100/85">
                          <span className="font-semibold text-emerald-300">Acao sugerida: </span>
                          {c.acao_gestor || c.acao_vendedor}
                        </div>
                      )}
                      {c.proxima_pergunta_ideal && (
                        <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sky-100/85">
                          <span className="font-semibold text-sky-300">Pergunta ideal: </span>
                          {c.proxima_pergunta_ideal}
                        </div>
                      )}
                    </div>
                  )}
                  {ops.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      <span className="text-amber-400 font-medium">Oportunidades perdidas:</span> {ops.slice(0, 3).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function MiniAcao({ titulo, subtitulo, texto, tom }: {
  titulo: string;
  subtitulo: string;
  texto: string;
  tom: 'red' | 'green' | 'blue';
}) {
  const cls = {
    red: 'border-rose-500/20 bg-rose-500/10 text-rose-100',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
    blue: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
  }[tom];
  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{titulo}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{subtitulo}</div>
      <p className="mt-2 text-xs leading-relaxed opacity-85">{texto}</p>
    </div>
  );
}
