import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Loader2, RefreshCw, DollarSign, Target, MapPin, Users, Award,
  TrendingUp, MousePointerClick, MessageCircle, Gauge, CheckCircle2, Info,
} from 'lucide-react';

// ── Bloco A — Cabine de Comando (cards fixos). Lê tudo do edge jose-dashboard (mesma
// camada de dados do chat -> nunca divergem). Foco: QUALQUER LEIGO entender de relance.
// Estilo neutro (shadcn) de propósito — a identidade visual da marca entra depois.
const db = supabase as any;

interface Cards {
  periodo: string; moeda: string;
  gasto: number; impressoes: number; cliques: number;
  cpm: number; cpc: number; ctr: number;
  conversas: number; cpl: number | null;
  leads_bom: number; leads_classificados: number; custo_por_lead_bom: number | null;
  idade: Array<{ faixa: string; gasto: number; conversas: number; cpl: number | null }>;
  regiao_entrega: Array<{ regiao: string; gasto: number; conversas: number }>;
  regiao_origem: Array<{ cidade: string; leads: number; leads_bom: number }>;
  anuncios: Array<{ ad_name: string | null; ad_key_kind: string; leads_total: number; leads_bom: number; leads_ruim: number; pct_bom: number | null }>;
  atribuicao: { por_ad_id: number; por_titulo: number; sem_origem: number };
}

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
];

function n(v: number | null | undefined) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function money(moeda: string, v: number | null | undefined) {
  return v == null ? '—' : `${moeda} ${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function int(v: number | null | undefined) { return n(v).toLocaleString('pt-BR'); }
function nomeRegiao(r: string) { return !r || r.toLowerCase() === 'unknown' ? 'Não identificado' : r; }

// Tijolo de número simples (label em cima, valor grande, ajuda embaixo).
function Stat({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-4 w-4" /> {label}</div>
        <div className="text-2xl font-bold mt-1 leading-none">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// Lista simples (linha = nome à esquerda, valor à direita).
function Lista({ titulo, ajuda, icon: Icon, vazio, linhas }: {
  titulo: string; ajuda: string; icon: any; vazio: string;
  linhas: Array<{ nome: string; valor: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div>
          <div className="text-sm font-semibold flex items-center gap-1.5"><Icon className="h-4 w-4" /> {titulo}</div>
          <div className="text-[11px] text-muted-foreground">{ajuda}</div>
        </div>
        {linhas.length === 0
          ? <p className="text-xs text-muted-foreground py-1">{vazio}</p>
          : (
            <div className="space-y-1.5">
              {linhas.map((l, i) => (
                <div key={i} className="flex justify-between gap-3 text-xs">
                  <span className="truncate">{l.nome}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">{l.valor}</span>
                </div>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}

export function CabineCards() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [cards, setCards] = useState<Cards | null>(null);
  const [periodo, setPeriodo] = useState('last_7d');

  const load = useCallback(async (preset: string) => {
    setLoading(true);
    try {
      const { data, error } = await db.functions.invoke('jose-dashboard', { body: { date_preset: preset } });
      if (error) throw error;
      setEnabled(data?.enabled !== false);
      setCards(data?.cards || null);
    } catch (e: any) {
      toast.error('Não consegui carregar a Cabine: ' + (e?.message || e));
      setCards(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  // Auto-esconde nas contas sem o recurso ligado.
  if (!loading && (!enabled || !cards)) return null;

  const periodoLabel = PRESETS.find((p) => p.value === periodo)?.label || '7 dias';
  const totalAtrib = cards ? n(cards.atribuicao.por_ad_id) + n(cards.atribuicao.por_titulo) + n(cards.atribuicao.sem_origem) : 0;
  const semPct = cards && totalAtrib > 0 ? Math.round(100 * n(cards.atribuicao.sem_origem) / totalAtrib) : 0;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold leading-none">Cabine de Comando</h2>
            <Badge variant="secondary" className="text-[10px]">a verdade por anúncio</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Os números que importam, sempre à vista — sem precisar pedir relatório.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <Button key={p.value} size="sm" variant={periodo === p.value ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setPeriodo(p.value)} disabled={loading}>{p.label}</Button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => load(periodo)} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {loading && !cards && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Calculando os números...
        </div>
      )}

      {cards && (
        <>
          {/* HERO — a vitrine vs a verdade, lado a lado */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-5">
                <div className="text-xs text-muted-foreground">Custo por lead — o que o Meta cobra</div>
                <div className="text-3xl font-bold mt-1">{money(cards.moeda, cards.cpl)}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{int(cards.conversas)} conversas iniciadas no Meta ({periodoLabel})</div>
              </CardContent>
            </Card>
            <Card className="border-emerald-500/40 bg-emerald-500/[0.04]">
              <CardContent className="p-5">
                <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Custo por lead BOM — o que vale de verdade</div>
                {cards.leads_bom > 0
                  ? (<>
                      <div className="text-3xl font-bold mt-1">{money(cards.moeda, cards.custo_por_lead_bom)}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">{int(cards.leads_bom)} leads aprovados pelo Pedro ({periodoLabel})</div>
                    </>)
                  : (<>
                      <div className="text-lg font-semibold mt-2 text-muted-foreground">Aguardando o Pedro classificar</div>
                      <div className="text-[11px] text-muted-foreground mt-1">Conforme o Pedro atende e marca os leads bons, este número aparece.</div>
                    </>)}
              </CardContent>
            </Card>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1 -mt-2">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            O Meta conta toda conversa como "lead". O José só conta como BOM o lead que o Pedro qualificou no atendimento — é o custo que importa de verdade.
          </p>

          {/* Resumo do investimento */}
          <div>
            <h3 className="text-sm font-semibold mb-2">Resumo do investimento ({periodoLabel})</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={DollarSign} label="Investido" value={money(cards.moeda, cards.gasto)} />
              <Stat icon={MessageCircle} label="Conversas" value={int(cards.conversas)} hint="pessoas que chamaram" />
              <Stat icon={TrendingUp} label="CPM" value={money(cards.moeda, cards.cpm)} hint="custo p/ mil pessoas verem" />
              <Stat icon={MousePointerClick} label="CPC" value={money(cards.moeda, cards.cpc)} hint="custo por clique" />
            </div>
          </div>

          {/* Anúncios por qualidade real */}
          <div>
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Award className="h-4 w-4" /> De qual anúncio vêm os bons clientes</h3>
            <p className="text-[11px] text-muted-foreground mb-2">Ranking pela qualidade REAL do lead (não por curtidas nem cliques).</p>
            <Card>
              <CardContent className="p-4">
                {cards.anuncios.length === 0
                  ? <p className="text-xs text-muted-foreground">Ainda sem leads classificados por anúncio. Conforme o Pedro atende, os anúncios aparecem aqui ordenados do melhor pro pior.</p>
                  : (
                    <div className="space-y-1.5">
                      {cards.anuncios.map((a, i) => {
                        const pct = n(a.pct_bom);
                        const cor = pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs border-b last:border-0 border-border/50 py-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${cor} shrink-0`} />
                            <span className="flex-1 truncate font-medium" title={a.ad_name || ''}>
                              {a.ad_name || '(sem nome)'}
                              {a.ad_key_kind === 'titulo' && <Badge variant="outline" className="ml-1.5 text-[9px] h-4 px-1 font-normal">aproximado</Badge>}
                            </span>
                            <span className="text-muted-foreground tabular-nums hidden sm:inline">{int(a.leads_total)} leads</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium tabular-nums">{int(a.leads_bom)} bons</span>
                            <span className="text-rose-600 dark:text-rose-400 tabular-nums">{int(a.leads_ruim)} ruins</span>
                            <span className="font-bold w-12 text-right tabular-nums">{a.pct_bom == null ? '—' : `${a.pct_bom}%`}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                {semPct > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-border/50">
                    Atribuição: {int(cards.atribuicao.por_ad_id)} precisos · {int(cards.atribuicao.por_titulo)} por título · {int(cards.atribuicao.sem_origem)} sem origem ({semPct}%). Fica preciso conforme as contas usam o WhatsApp oficial da Meta.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Público: região (alvo x real) + idade */}
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Users className="h-4 w-4" /> Quem está vendo e quem está chamando</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Lista
                icon={Target} titulo="Onde o anúncio aparece" ajuda="região que a Meta está mostrando (o alvo)" vazio="Sem dados no período."
                linhas={cards.regiao_entrega.slice(0, 6).map((r) => ({ nome: nomeRegiao(r.regiao), valor: money(cards.moeda, r.gasto) }))}
              />
              <Lista
                icon={MapPin} titulo="De onde os leads vêm" ajuda="cidade que o cliente realmente informou" vazio="Nenhum cliente informou a cidade ainda."
                linhas={cards.regiao_origem.slice(0, 6).map((r) => ({ nome: r.cidade, valor: `${int(r.leads)} leads` }))}
              />
              <Lista
                icon={Users} titulo="Por idade" ajuda="onde a verba foi gasta por faixa etária" vazio="Sem dados no período."
                linhas={cards.idade.slice(0, 6).map((r) => ({ nome: r.faixa, valor: money(cards.moeda, r.gasto) }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
