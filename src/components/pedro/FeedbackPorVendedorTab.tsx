import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, Loader2, Download, Trophy, AlertTriangle, Clock, Star, MessageSquareQuote,
} from 'lucide-react';

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
  oportunidades_perdidas: string[] | null;
  tempo_resposta_min: number | null;
  houve_venda: string | null;
  vehicle_interest: string | null;
}

const QMAP: Record<string, { label: string; cls: string }> = {
  '1_alto':     { label: 'lead forte',    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  '2_medio':    { label: 'lead bom',      cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  '3_baixo':    { label: 'lead difícil',  cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  '4_nao_lead': { label: 'não era lead',  cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
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

function fmtMin(mRaw: number): string {
  const m = Math.round(mRaw);
  if (m <= 0) return '—';
  if (m >= 2880) return `${Math.round(m / 1440)} dias`;
  if (m >= 60) { const h = Math.floor(m / 60), mm = m % 60; return mm ? `${h}h${String(mm).padStart(2, '0')}` : `${h}h`; }
  return `${m} min`;
}
function scoreCls(s: number): string {
  if (s >= 70) return 'text-emerald-400';
  if (s >= 50) return 'text-sky-400';
  if (s >= 30) return 'text-amber-400';
  return 'text-rose-400';
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
          {/* Resumo do vendedor */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {[
              { lb: 'Nota média', v: atual.scoreMedio, cls: scoreCls(atual.scoreMedio), ic: Star },
              { lb: 'Leads analisados', v: atual.analisados, cls: 'text-foreground', ic: Users },
              { lb: 'Leads bons', v: atual.bons, cls: 'text-sky-400', ic: Trophy },
              { lb: 'Bem atendidos', v: atual.bemAtendidos, cls: 'text-emerald-400', ic: Star },
              { lb: 'Vendas', v: atual.vendas, cls: 'text-emerald-400', ic: Trophy },
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

          {/* Conversas (nota mais baixa primeiro = onde olhar) */}
          <div className="space-y-2.5">
            {[...atual.convs].sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0)).map((c) => {
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
