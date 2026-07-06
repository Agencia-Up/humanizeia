import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Loader2, RefreshCw, DollarSign, Target, MapPin, Users, Award,
  TrendingUp, MousePointerClick, MessageCircle, Gauge, CheckCircle2, Info,
  Wallet, Sparkles, Car, X, CalendarDays, Power,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { CampanhaAnalytics } from '@/components/pedro/CampanhaAnalytics';

// ── Bloco A — Cabine de Comando (cards fixos). Lê tudo do edge jose-dashboard (mesma
// camada de dados do chat -> nunca divergem). Foco: QUALQUER LEIGO entender de relance.
// Reskin premium (indigo + dourado) no padrão dos mockups do dono — a LÓGICA e os
// DADOS são os mesmos; mudou só a apresentação.
const db = supabase as any;

interface CabineCardsProps {
  configActions?: Array<{ key: string; label: string; icon: ReactNode; content: ReactNode }>;
  adAccountId?: string | null;
}

interface Cards {
  periodo: string; moeda: string;
  gasto: number; impressoes: number; cliques: number;
  cpm: number; cpc: number; ctr: number;
  conversas: number; cpl: number | null;
  leads_recebidos: number;
  leads_bom: number; leads_classificados: number; custo_por_lead_bom: number | null;
  vendas: number; custo_por_venda: number | null;
  idade: Array<{ faixa: string; gasto: number; conversas: number; cpl: number | null }>;
  regiao_entrega: Array<{ regiao: string; gasto: number; conversas: number }>;
  regiao_origem: Array<{ cidade: string; leads: number; leads_bom: number }>;
  por_publico: Array<{ nome: string; gasto: number; conversas: number }>;
  por_criativo: Array<{ nome: string; gasto: number; conversas: number; cpm: number; custo_conversa: number | null; status: string | null; thumbnail_url: string | null; leads_bom: number | null; leads_ruim: number | null; pct_bom: number | null; por_que_ruim: string | null; fb_alta: number | null; fb_baixa: number | null }>;
  anuncios: Array<{ ad_name: string | null; ad_key_kind: string; leads_total: number; leads_bom: number; leads_ruim: number; vendas: number; pct_bom: number | null; ativo: boolean }>;
  atribuicao: { por_ad_id: number; por_titulo: number; sem_origem: number };
}

// Data YYYY-MM-DD em BRT (America/Sao_Paulo) com deslocamento de dias — MESMA lógica do server
// (presetToRange) pra a janela do filtro mestre bater igual nos cards e no painel de tráfego.
function brtDateStr(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
function presetRange(preset: string): { since: string; until: string } {
  const until = brtDateStr(0);
  if (preset === 'yesterday') { const y = brtDateStr(-1); return { since: y, until: y }; }
  if (preset === 'last_30d') return { since: brtDateStr(-29), until };
  if (preset === 'last_7d') return { since: brtDateStr(-6), until };
  return { since: until, until }; // today
}

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
];

// Tiles de ícone coloridos (strings completas p/ o Tailwind enxergar — nada dinâmico).
const TILE: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-400 ring-blue-400/20',
  emerald: 'bg-emerald-500/15 text-emerald-400 ring-emerald-400/20',
  amber: 'bg-amber-500/15 text-amber-400 ring-amber-400/20',
  violet: 'bg-violet-500/15 text-violet-400 ring-violet-400/20',
  cyan: 'bg-cyan-500/15 text-cyan-400 ring-cyan-400/20',
};

function n(v: number | null | undefined) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
function money(moeda: string, v: number | null | undefined) {
  return v == null ? '—' : `${moeda} ${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function int(v: number | null | undefined) { return n(v).toLocaleString('pt-BR'); }

// Atribuição por VEÍCULO: puxa da conversa (Pedro) qual carro o anúncio mostrava e usa como
// atribuição -> a tabela ANÚNCIO separa por carro real, não pelo título genérico. Diretriz do dono.
function AtribVeiculo({ onDone }: { onDone?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const rodar = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('jose-attrib-veiculo', { body: {} });
      if (error || (res as any)?.error) throw new Error((res as any)?.error || error?.message || 'falha');
      setData(res);
      toast.success(`${(res as any)?.ad_name_atualizados ?? 0} anúncios atribuídos por carro. Atualizando a tabela…`);
      setTimeout(() => onDone?.(), 600); // recarrega a Cabine -> a tabela ANÚNCIO passa a mostrar os carros
    } catch {
      toast.error('Não consegui atualizar a atribuição agora.');
    } finally { setLoading(false); }
  };
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Target className="h-4 w-4" /> Atribuição por veículo do anúncio</h3>
      <p className="text-[11px] text-muted-foreground mb-2.5">Puxa da conversa qual <strong className="text-foreground/80">carro</strong> o anúncio mostrava (ex.: "Creta 2025", "Toro Diesel") e usa como atribuição — aí a tabela de anúncio separa por carro real, não pelo título genérico "Fale com consultor".</p>
      <button onClick={rodar} disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
        {loading ? 'Puxando da conversa…' : 'Atualizar atribuição por veículo'}
      </button>
      {data && (
        <p className="text-[11px] text-muted-foreground mt-2">
          {data.leads_com_veiculo_extraido ?? 0} leads com carro identificado · <b className="text-emerald-400">{data.ad_name_atualizados ?? 0} atribuídos por veículo agora</b> (de {data.conversas_com_anuncio ?? 0} conversas com anúncio).
        </p>
      )}
    </div>
  );
}

// Galeria de criativos num POP-UP CONTROLADO (o botão fica na fileira de Configurações). Mostra
// todos os anúncios ativos com arte + gasto + custo/conversa + CPM + qualidade real (Pedro).
function GaleriaPopup({ open, onClose, criativos, moeda }: { open: boolean; onClose: () => void; criativos: any[]; moeda: string }) {
  if (!open) return null;
  return (
    <div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4" onClick={onClose}>
          <div className="my-8 w-full max-w-5xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between rounded-t-2xl border-b border-border/60 bg-card px-5 py-3">
              <h3 className="flex items-center gap-1.5 text-sm font-bold"><Award className="h-4 w-4 text-amber-400" /> Anúncios ativos ({criativos.length})</h3>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              {criativos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem anúncios ativos no período.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {criativos.map((c, i) => <CreativeCard key={i} c={c} moeda={moeda} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Guardião do estoque: o José compara anúncio ativo x estoque (BNDV) e lista o carro que já
// saiu do estoque mas continua anunciado. Fatia 1: só DETECTA (não pausa) — o dono valida antes.
function StockGuard() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const verificar = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('jose-stock-guard', { body: {} });
      if (error || (res as any)?.error) throw new Error((res as any)?.error || error?.message || 'falha');
      setData(res);
    } catch {
      toast.error('Não consegui verificar o estoque agora.');
    } finally { setLoading(false); }
  };
  return (
    <div>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5"><Car className="h-4 w-4" /> Guardião do estoque — carro vendido ainda no ar</h3>
      <p className="text-[11px] text-muted-foreground mb-2.5">O José compara cada anúncio ativo com o estoque. Se o carro já saiu do estoque mas o anúncio continua rodando, ele aparece aqui pra você pausar e parar de queimar verba.</p>
      <button onClick={verificar} disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Car className="h-3.5 w-3.5" />}
        {loading ? 'Comparando com o estoque…' : 'Verificar carros vendidos'}
      </button>
      {data && (
        <div className="mt-3">
          <p className="text-[11px] text-muted-foreground mb-2">
            <b className="text-rose-400">{data.resumo?.vendidos ?? 0} vendido(s) ainda no ar</b> · {data.resumo?.disponiveis ?? 0} ok · {data.resumo?.ignorados ?? 0} genéricos (de {data.total_ativos ?? 0} ativos)
          </p>
          {(data.vendidos || []).length === 0 ? (
            <p className="text-xs text-emerald-400">Nenhum carro vendido sendo anunciado. Tudo certo.</p>
          ) : (
            <div className="space-y-2">
              {(data.vendidos || []).map((v: any, i: number) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/5 p-2.5">
                  {v.thumbnail_url && <img src={v.thumbnail_url} alt="" className="h-14 w-14 rounded-lg object-cover bg-muted shrink-0" loading="lazy" />}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{v.ad_name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Anúncio: {String(v.extraido?.modelo || '—').slice(0, 60)}{v.extraido?.ano ? ` · ${v.extraido.ano}` : ''}{v.extraido?.preco ? ` · R$ ${Number(v.extraido.preco).toLocaleString('pt-BR')}` : ''}</p>
                    <p className="text-[11px] text-rose-300/90 mt-0.5">⚠ {v.motivo}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-2 italic">Por enquanto só detecta — não pausa nada. Valide se está certo; depois ligo a desativação com sua aprovação.</p>
        </div>
      )}
    </div>
  );
}

// Card da galeria de criativos: a arte + números + qualidade do Pedro, com botão pra
// o José OLHAR a arte (visão on-demand: só roda IA quando o dono clica -> custo controlado).
function CreativeCard({ c, moeda }: { c: any; moeda: string }) {
  const [analise, setAnalise] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const analisar = async () => {
    if (!c.thumbnail_url) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('jose-dashboard', {
        body: { action: 'analisar_criativo', image_url: c.thumbnail_url },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || 'falha');
      setAnalise((data as any).analise);
    } catch {
      toast.error('Não consegui analisar essa arte agora.');
    } finally { setLoading(false); }
  };
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm shadow-black/20">
      {c.thumbnail_url ? (
        <img src={c.thumbnail_url} alt={c.nome} loading="lazy" className="w-full h-28 object-cover bg-muted" />
      ) : (
        <div className="w-full h-28 bg-muted flex items-center justify-center text-[11px] text-muted-foreground">sem arte</div>
      )}
      <div className="p-2.5">
        {c.status === 'ACTIVE' && (
          <span className="inline-flex items-center gap-1 mb-1 rounded px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/15 text-emerald-400"><Power className="h-2.5 w-2.5" /> Ativo</span>
        )}
        <p className="text-xs font-medium truncate" title={c.nome}>{c.nome}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{int(c.conversas)} conv · {money(moeda, c.gasto)}</p>
        <p className="text-[10px] text-muted-foreground/80">
          {c.custo_conversa != null ? `${money(moeda, c.custo_conversa)}/conversa` : 'sem conversa'}{c.cpm ? ` · CPM ${money(moeda, c.cpm)}` : ''}
        </p>
        {(c.leads_bom != null || c.leads_ruim != null) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px]">
            {c.pct_bom != null && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold">{c.pct_bom}% bom</span>}
            {c.leads_bom != null && c.leads_bom > 0 && <span className="text-emerald-400">{c.leads_bom} bom</span>}
            {c.leads_ruim != null && c.leads_ruim > 0 && <span className="text-rose-400">{c.leads_ruim} ruim</span>}
          </div>
        )}
        {c.por_que_ruim && <p className="text-[10px] text-rose-300/80 mt-1 leading-tight">⚠ {c.por_que_ruim}</p>}
        {(c.fb_alta || c.fb_baixa) ? (
          <p className="text-[10px] mt-0.5"><span className="text-muted-foreground">Vendedor: </span>
            {c.fb_alta ? <span className="text-emerald-400 font-semibold">{c.fb_alta} alta</span> : null}
            {c.fb_alta && c.fb_baixa ? <span className="text-muted-foreground"> · </span> : null}
            {c.fb_baixa ? <span className="text-rose-400 font-semibold">{c.fb_baixa} baixa</span> : null}
          </p>
        ) : null}
        {analise ? (
          <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
            {analise.nota_geral != null && <p className="text-[11px] font-semibold text-amber-400">Nota do José: {analise.nota_geral}/10</p>}
            {analise.observacao && <p className="text-[10px] text-foreground/80 leading-snug">{analise.observacao}</p>}
            {Array.isArray(analise.tags) && analise.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {analise.tags.slice(0, 5).map((t: string, k: number) => <span key={k} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>)}
              </div>
            )}
          </div>
        ) : c.thumbnail_url ? (
          <button onClick={analisar} disabled={loading}
            className="mt-2 w-full flex items-center justify-center gap-1.5 text-[10px] font-medium text-amber-400 border border-amber-500/30 rounded-lg py-1.5 hover:bg-amber-500/10 disabled:opacity-50">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {loading ? 'Olhando a arte...' : 'Analisar arte com IA'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
function nomeRegiao(r: string) { return !r || r.toLowerCase() === 'unknown' ? 'Não identificado' : r; }

// Card-base premium (cantos, borda e sombra do padrão da marca).
function Panel({ children, className = '' }: { children: any; className?: string }) {
  return <div className={`rounded-xl border border-border/60 bg-card shadow-sm shadow-black/20 ${className}`}>{children}</div>;
}

// Tijolo de número (ícone em tile colorido + label + valor grande + ajuda).
function Stat({ icon: Icon, label, value, hint, tint = 'blue' }: { icon: any; label: string; value: string; hint?: string; tint?: string }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${TILE[tint]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">{label}{hint && <Info className="h-3 w-3 opacity-60" />}</div>
          <div className="text-xl font-bold leading-tight tabular-nums">{value}</div>
          {hint && <div className="text-[11px] text-muted-foreground leading-tight">{hint}</div>}
        </div>
      </div>
    </Panel>
  );
}

// Cores por bloco (barra + tile do ícone) — strings completas p/ o Tailwind enxergar.
const BAR: Record<string, { bar: string; tile: string }> = {
  blue:    { bar: 'bg-blue-500',    tile: 'bg-blue-500/15 text-blue-400 ring-blue-400/25' },
  cyan:    { bar: 'bg-cyan-500',    tile: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/25' },
  violet:  { bar: 'bg-violet-500',  tile: 'bg-violet-500/15 text-violet-300 ring-violet-400/25' },
  emerald: { bar: 'bg-emerald-500', tile: 'bg-emerald-500/15 text-emerald-400 ring-emerald-400/25' },
  amber:   { bar: 'bg-amber-500',   tile: 'bg-amber-500/15 text-amber-400 ring-amber-400/25' },
};

// Lista com BARRA proporcional (mini-gráfico) + "Ver todas" que EXPANDE de verdade.
function Lista({ titulo, ajuda, icon: Icon, vazio, linhas, verTodas, cor = 'blue' }: {
  titulo: string; ajuda: string; icon: any; vazio: string;
  linhas: Array<{ nome: string; valor: string; peso?: number }>; verTodas?: string; cor?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const c = BAR[cor] || BAR.blue;
  const LIM = 6;
  const max = Math.max(1, ...linhas.map((l) => Number(l.peso) || 0));
  const visiveis = aberto ? linhas : linhas.slice(0, LIM);
  return (
    <Panel className="p-4 flex flex-col">
      <div className="flex items-center gap-2.5">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${c.tile}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{titulo}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">{ajuda}</div>
        </div>
      </div>
      {linhas.length === 0
        ? <p className="text-xs text-muted-foreground py-3">{vazio}</p>
        : (
          <div className="mt-3.5 space-y-2.5 flex-1">
            {visiveis.map((l, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-foreground">{l.nome}</span>
                  <span className="shrink-0 tabular-nums font-semibold text-foreground">{l.valor}</span>
                </div>
                {l.peso != null && (
                  <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                    <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${Math.max(5, Math.round(100 * (Number(l.peso) || 0) / max))}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {linhas.length > LIM && (
        <button type="button" onClick={() => setAberto((a) => !a)} className="mt-3 pt-2.5 border-t border-border/40 text-[11px] font-semibold text-primary hover:text-primary/80 text-left transition-colors">
          {aberto ? '↑ Ver menos' : `${verTodas || 'Ver todas'} (${linhas.length})`}
        </button>
      )}
    </Panel>
  );
}

// Fileira de botões PADRÃO (config + ferramentas) + a área do botão ativo embaixo. Galeria abre
// pop-up; estoque/atribuição abrem painel inline. Sem card/título próprios: é renderizado DENTRO
// do card "Período da campanha" (pedido do dono). O chat saiu daqui (virou botão no header).
function JoseToolsButtons({ configActions, cards, reload }: {
  configActions?: Array<{ key: string; label: string; icon: ReactNode; content: ReactNode }>;
  cards: Cards | null;
  reload: () => void;
}) {
  const [painel, setPainel] = useState<string | null>(null);
  const [galeriaOpen, setGaleriaOpen] = useState(false);
  const toggle = (k: string) => setPainel((p) => (p === k ? null : k));
  const activeCfg = (configActions || []).find((a) => a.key === painel) || null;
  const criativos = cards?.por_criativo || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(configActions || []).map((a) => (
          <Button key={a.key} variant={painel === a.key ? 'default' : 'outline'} size="sm" className="gap-1.5" onClick={() => toggle(a.key)}>{a.icon}{a.label}</Button>
        ))}
        {cards && (
          <>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!criativos.length} onClick={() => setGaleriaOpen(true)}>
              <Award className="h-3.5 w-3.5" /> Anúncios ativos ({criativos.length})
            </Button>
            <Button variant={painel === 'estoque' ? 'default' : 'outline'} size="sm" className="gap-1.5" onClick={() => toggle('estoque')}>
              <Car className="h-3.5 w-3.5" /> Guardião do estoque
            </Button>
            <Button variant={painel === 'atrib' ? 'default' : 'outline'} size="sm" className="gap-1.5" onClick={() => toggle('atrib')}>
              <Target className="h-3.5 w-3.5" /> Atribuição por veículo
            </Button>
          </>
        )}
      </div>
      {activeCfg && <div className="pt-3 border-t border-border/50">{activeCfg.content}</div>}
      {painel === 'estoque' && cards && <div className="pt-3 border-t border-border/50"><StockGuard /></div>}
      {painel === 'atrib' && cards && <div className="pt-3 border-t border-border/50"><AtribVeiculo onDone={reload} /></div>}
      <GaleriaPopup open={galeriaOpen} onClose={() => setGaleriaOpen(false)} criativos={criativos} moeda={cards?.moeda || ''} />
    </div>
  );
}

async function edgeErrorMessage(error: any) {
  const fallback = error?.message || String(error || 'erro desconhecido');
  const context = error?.context;
  try {
    if (context?.json) {
      const body = await context.json();
      return body?.error || body?.message || fallback;
    }
    if (context?.text) {
      const text = await context.text();
      return text || fallback;
    }
  } catch (_e) {
    return fallback;
  }
  return fallback;
}

export function CabineCards({ configActions, adAccountId }: CabineCardsProps = {}) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const { user } = useAuth();
  const [cards, setCards] = useState<Cards | null>(null);
  const [periodo, setPeriodo] = useState('last_7d');
  const [desde, setDesde] = useState('');
  const [ate, setAte] = useState('');

  const loadSnapshotFallback = useCallback(async () => {
    try {
      let query = db
        .from('jose_dashboard_snapshots')
        .select('payload, computed_at')
        .order('computed_at', { ascending: false })
        .limit(1);

      if (adAccountId) query = query.eq('ad_account_id', adAccountId);

      const { data, error } = await query.maybeSingle();
      if (error || !data?.payload) return false;

      setEnabled(true);
      setCards(data.payload as Cards);
      return true;
    } catch (_e) {
      return false;
    }
  }, [adAccountId]);

  const load = useCallback(async (body: { date_preset?: string; time_range?: { since: string; until: string } }) => {
    setLoading(true);
    try {
      const requestBody = adAccountId ? { ...body, ad_account_id: adAccountId } : body;
      const { data, error } = await db.functions.invoke('jose-dashboard', { body: requestBody });
      if (error) throw error;
      setEnabled(data?.enabled !== false);
      setCards(data?.cards || null);
    } catch (e: any) {
      const recovered = await loadSnapshotFallback();
      if (recovered) {
        toast.warning('Cabine ao vivo indisponivel; mostrei o ultimo relatorio salvo.');
      } else {
        toast.error('Não consegui carregar a Cabine: ' + await edgeErrorMessage(e));
        setCards(null);
      }
    } finally { setLoading(false); }
  }, [adAccountId, loadSnapshotFallback]);

  // FILTRO MESTRE: o período vira UMA janela {since,until} (BRT) e governa TUDO — manda o mesmo
  // time_range pro server (cards/anúncios) e desce pro painel de Tráfego. Custom só vale com as 2 datas.
  const range = useMemo<{ since: string; until: string } | null>(() => {
    if (periodo === 'custom') return (desde && ate) ? (desde <= ate ? { since: desde, until: ate } : { since: ate, until: desde }) : null;
    return presetRange(periodo);
  }, [periodo, desde, ate]);

  useEffect(() => { if (range) load({ time_range: range }); }, [range, load]);
  const recarregar = useCallback(() => { if (range) load({ time_range: range }); }, [load, range]);

  // Auto-esconde os CARDS nas contas sem o recurso ligado — mas os botões de config continuam
  // acessíveis (não dependem do flag da Cabine). Sem cards = só config, sem ferramentas.
  if (!loading && (!enabled || !cards)) {
    return (
      <div className="space-y-6">
        <Card><CardContent className="p-4"><JoseToolsButtons configActions={configActions} cards={null} reload={recarregar} /></CardContent></Card>
      </div>
    );
  }

  const periodoLabel = periodo === 'custom' ? 'período escolhido' : (PRESETS.find((p) => p.value === periodo)?.label || '7 dias');
  const totalAtrib = cards ? n(cards.atribuicao.por_ad_id) + n(cards.atribuicao.por_titulo) + n(cards.atribuicao.sem_origem) : 0;
  const semPct = cards && totalAtrib > 0 ? Math.round(100 * n(cards.atribuicao.sem_origem) / totalAtrib) : 0;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-inset ring-primary/20"><Gauge className="h-5 w-5" /></div>
          <h2 className="text-2xl font-bold leading-none tracking-tight">Cabine de Comando</h2>
          <Badge variant="secondary" className="text-[10px]">a verdade por anúncio</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">Os números que importam, sempre à vista — sem precisar pedir relatório.</p>
      </div>

      {/* FILTRO MESTRE — um só, grande, governa TODO o painel do José (cards, anúncios e tráfego). */}
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm shadow-black/10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-inset ring-primary/25"><CalendarDays className="h-5 w-5" /></div>
            <div>
              <div className="text-sm font-bold leading-tight">Período da campanha</div>
              <div className="text-[11px] text-muted-foreground leading-tight">Um filtro só — vale pra tudo: métricas, anúncios e tráfego pago, juntos.</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/70 p-1">
              {PRESETS.map((p) => (
                <button key={p.value} onClick={() => setPeriodo(p.value)} disabled={loading}
                  className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${periodo === p.value ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>{p.label}</button>
              ))}
              <button onClick={() => setPeriodo('custom')} disabled={loading}
                className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${periodo === 'custom' ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>Personalizado</button>
            </div>
            <Button size="sm" variant="outline" className="h-10 w-10 p-0" onClick={recarregar} disabled={loading} title="Atualizar">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {periodo === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap text-sm mt-3 pt-3 border-t border-border/50">
            <span className="text-muted-foreground">De</span>
            {/* Cada campo mexe só na própria ponta; a ordem é normalizada ao montar o range
                (exige as 2 datas). Sem min/max travando o calendário. */}
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-9 rounded-lg border bg-background px-2.5 text-sm" />
            <span className="text-muted-foreground">até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9 rounded-lg border bg-background px-2.5 text-sm" />
            {(!desde || !ate) && <span className="text-[11px] text-muted-foreground">escolha as duas datas pra aplicar</span>}
          </div>
        )}

        {/* Botões do José (config + ferramentas) DENTRO do card do período (pedido do dono). */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <JoseToolsButtons configActions={configActions} cards={cards} reload={recarregar} />
        </div>
      </div>

      {loading && !cards && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Calculando os números...
        </div>
      )}

      {cards && (
        <>
          {/* HERO — vitrine vs verdade vs venda */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Custo por lead Meta */}
            <div className="relative overflow-hidden rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-transparent p-5 shadow-sm shadow-black/20">
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${TILE.blue}`}><DollarSign className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Custo por lead — o que o Meta cobra</div>
                  <div className="text-3xl font-bold mt-1 tabular-nums">{money(cards.moeda, cards.cpl)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">{int(cards.conversas)} conversas no Meta ({periodoLabel})</div>
                </div>
              </div>
            </div>
            {/* Custo por lead BOM */}
            <div className="relative overflow-hidden rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 to-transparent p-5 shadow-sm shadow-black/20">
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${TILE.emerald}`}><CheckCircle2 className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Custo por lead BOM</div>
                  {cards.leads_bom > 0
                    ? (<>
                        <div className="text-3xl font-bold mt-1 tabular-nums">{money(cards.moeda, cards.custo_por_lead_bom)}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{int(cards.leads_bom)} leads que avançaram no funil ({periodoLabel})</div>
                      </>)
                    : (<>
                        <div className="text-lg font-semibold mt-2 text-muted-foreground">Sem lead bom no período</div>
                        <div className="text-[11px] text-muted-foreground mt-1">Conta quem avançou: negociação, qualificado ou venda.</div>
                      </>)}
                </div>
              </div>
            </div>
            {/* Custo por VENDA */}
            <div className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-transparent p-5 shadow-sm shadow-black/20">
              <div className="flex items-start gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${TILE.amber}`}><Award className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-amber-600 dark:text-amber-400">Custo por VENDA</div>
                  {cards.vendas > 0
                    ? (<>
                        <div className="text-3xl font-bold mt-1 tabular-nums">{money(cards.moeda, cards.custo_por_venda)}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{int(cards.vendas)} venda(s) fechada(s) ({periodoLabel})</div>
                      </>)
                    : (<>
                        <div className="text-lg font-semibold mt-2 text-muted-foreground">Sem venda no período</div>
                        <div className="text-[11px] text-muted-foreground mt-1">Quando um lead vira "fechado" no CRM, aparece aqui.</div>
                      </>)}
                </div>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-start gap-1 -mt-3">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            O Meta conta toda conversa como "lead". O José só conta como BOM o lead que o Pedro qualificou no atendimento — é o custo que importa de verdade.
          </p>

          {/* Resumo do investimento */}
          <div>
            <h3 className="text-sm font-semibold mb-2.5">Resumo do investimento ({periodoLabel})</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Wallet} label="Investido" value={money(cards.moeda, cards.gasto)} tint="blue" />
              <Stat icon={MessageCircle} label="Conversas" value={int(cards.conversas)} hint="pessoas que chamaram" tint="cyan" />
              <Stat icon={TrendingUp} label="CPM" value={money(cards.moeda, cards.cpm)} hint="custo p/ mil pessoas verem" tint="blue" />
              <Stat icon={MousePointerClick} label="CPC" value={money(cards.moeda, cards.cpc)} hint="custo por clique" tint="violet" />
            </div>
          </div>

          {/* INTELIGÊNCIA DE TRÁFEGO & LEADS — fica ACIMA do chat/config (pedido do dono). Card único
              (funil + top cidade/veículo + seções recolhíveis), na mesma identidade visual do painel.
              O próprio card já se intitula, então sem h3 extra. */}
          <CampanhaAnalytics
              masterUserId={user?.id || ''} since={range?.since || ''} until={range?.until || ''} periodoLabel={periodoLabel}
              extraSections={[{
                key: 'anuncios',
                title: 'De qual anúncio vêm os bons clientes',
                subtitle: 'Qualidade REAL do lead (não curtidas nem cliques). Ativos primeiro — a otimização é neles.',
                icon: Award,
                node: cards.anuncios.length === 0
                  ? <p className="text-xs text-muted-foreground">Ainda sem leads classificados por anúncio. Conforme o Pedro atende, os anúncios aparecem aqui ordenados do melhor pro pior.</p>
                  : (
                    <div>
                      <div className="hidden sm:grid grid-cols-[1fr_60px_60px_60px_120px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground pb-2 border-b border-border/50">
                        <span>Anúncio</span><span className="text-center">Leads</span><span className="text-center text-emerald-500">Bons</span><span className="text-center text-rose-500">Ruins</span><span className="text-right">% Bons</span>
                      </div>
                      <div className="divide-y divide-border/40">
                        {cards.anuncios.map((a, i) => {
                          const pct = n(a.pct_bom);
                          const cor = pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
                          const dot = pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
                          return (
                            <div key={i} className="grid grid-cols-[1fr_60px_60px_60px_120px] gap-2 items-center py-2.5 text-xs">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className={`h-2.5 w-2.5 rounded-full ${dot} shrink-0`} />
                                <span className={`truncate font-medium ${a.ativo ? '' : 'text-muted-foreground'}`} title={a.ad_name || ''}>{a.ad_name || '(sem nome)'}</span>
                                {a.ativo && <Badge className="text-[9px] h-4 px-1 font-semibold shrink-0 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 gap-0.5"><Power className="h-2.5 w-2.5" />Ativo</Badge>}
                                {a.ad_key_kind === 'titulo' && <Badge variant="outline" className="text-[9px] h-4 px-1 font-normal shrink-0">aproximado</Badge>}
                              </span>
                              <span className="text-center tabular-nums text-muted-foreground">{int(a.leads_total)}</span>
                              <span className="text-center tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{int(a.leads_bom)}</span>
                              <span className="text-center tabular-nums text-rose-600 dark:text-rose-400">{int(a.leads_ruim)}</span>
                              <span className="flex items-center gap-2 justify-end">
                                <span className="font-bold tabular-nums w-11 text-right">{a.pct_bom == null ? '—' : `${a.pct_bom}%`}</span>
                                <span className="h-1.5 w-12 rounded-full bg-muted overflow-hidden hidden sm:block"><span className={`block h-full rounded-full ${cor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-border/50 flex items-start gap-1">
                        <Power className="h-3 w-3 mt-0.5 shrink-0 text-emerald-400" />
                        <span>O selo <strong className="text-emerald-400/90">Ativo</strong> marca o anúncio que ainda casa com os ativos na Meta — é onde a otimização acontece. Sem o selo = não confirmado ativo (a 2ª via oficial da Meta deixa o casamento exato).</span>
                      </p>
                      {semPct > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-2">
                          Atribuição: {int(cards.atribuicao.por_ad_id)} precisos · {int(cards.atribuicao.por_titulo)} por título · {int(cards.atribuicao.sem_origem)} sem origem ({semPct}%). Fica preciso conforme as contas usam o WhatsApp oficial da Meta.
                        </p>
                      )}
                    </div>
                  ),
              }, {
                key: 'publico',
                title: 'Quem está vendo e quem está chamando',
                subtitle: 'Região que a Meta mostra (o alvo), de onde os leads realmente vêm e por idade.',
                icon: Users,
                node: (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Lista
                      icon={Target} titulo="Onde o anúncio aparece" ajuda="região que a Meta está mostrando (o alvo)" vazio="Sem dados no período." verTodas="Ver todas as regiões →" cor="blue"
                      linhas={cards.regiao_entrega.map((r) => ({ nome: nomeRegiao(r.regiao), valor: money(cards.moeda, r.gasto), peso: r.gasto }))}
                    />
                    <Lista
                      icon={MapPin} titulo="De onde os leads vêm" ajuda="cidade que o cliente realmente informou" vazio="Nenhum cliente informou a cidade ainda." verTodas="Ver todas as cidades →" cor="emerald"
                      linhas={cards.regiao_origem.map((r) => ({ nome: r.cidade, valor: `${int(r.leads)} leads`, peso: r.leads }))}
                    />
                    <Lista
                      icon={Users} titulo="Por idade" ajuda="onde a verba foi gasta por faixa etária" vazio="Sem dados no período." verTodas="Ver todas as idades →" cor="cyan"
                      linhas={cards.idade.map((r) => ({ nome: r.faixa, valor: money(cards.moeda, r.gasto), peso: r.gasto }))}
                    />
                  </div>
                ),
              }]}
              funil={{ leads_recebidos: cards.leads_recebidos, leads_bom: cards.leads_bom, vendas: cards.vendas }}
            />
        </>
      )}
    </div>
  );
}
