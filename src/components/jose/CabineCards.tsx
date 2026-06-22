import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Loader2, RefreshCw, DollarSign, Target, Users, MapPin, Award,
  TrendingUp, MousePointerClick, MessageCircle, Gauge,
} from 'lucide-react';

// ── Cabine de Comando / Bloco A — cards fixos estilo Power BI.
// Lê tudo do edge jose-dashboard (mesma camada de dados do chat do José => o painel
// e o chat nunca divergem). Atrás do flag cabine_cards (o edge devolve enabled=false).
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
  return v == null ? '--' : `${moeda} ${n(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function int(v: number | null | undefined) { return n(v).toLocaleString('pt-BR'); }

function Tile({ icon: Icon, label, value, hint, tone }: {
  icon: any; label: string; value: string; hint?: string; tone?: 'green' | 'blue' | 'muted';
}) {
  const toneCls = tone === 'green' ? 'border-emerald-500/40 bg-emerald-500/5'
    : tone === 'blue' ? 'border-blue-500/40 bg-blue-500/5' : '';
  return (
    <Card className={toneCls}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <div className="text-xl font-bold mt-0.5">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function CabineCards() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [cards, setCards] = useState<Cards | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState('last_7d');

  const load = useCallback(async (preset: string) => {
    setLoading(true);
    try {
      const { data, error } = await db.functions.invoke('jose-dashboard', { body: { date_preset: preset } });
      if (error) throw error;
      setEnabled(data?.enabled !== false);
      setReason(data?.reason || null);
      setCards(data?.cards || null);
    } catch (e: any) {
      toast.error('Não consegui carregar a Cabine: ' + (e?.message || e));
      setCards(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(periodo); }, [periodo, load]);

  // Renderizado SEMPRE na tela principal do José -> fica invisível (null) quando o
  // recurso está desligado ou ainda não há dado, pra não poluir contas fora do piloto.
  void reason;
  if (loading || !enabled || !cards) return null;

  const totalAtrib = n(cards.atribuicao.por_ad_id) + n(cards.atribuicao.por_titulo) + n(cards.atribuicao.sem_origem);
  const semPct = totalAtrib > 0 ? Math.round(100 * n(cards.atribuicao.sem_origem) / totalAtrib) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold">Cabine de Comando</h2>
        <Badge variant="secondary" className="text-[10px]">a verdade por anúncio</Badge>
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {PRESETS.map(p => (
            <Button key={p.value} size="sm" variant={periodo === p.value ? 'default' : 'outline'} className="h-8 text-xs" onClick={() => setPeriodo(p.value)}>{p.label}</Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => load(periodo)}><RefreshCw className="h-3 w-3" /> Atualizar</Button>
      </div>

      {/* A VITRINE vs A VERDADE — lado a lado */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Tile icon={DollarSign} tone="muted" label="Custo por lead (vitrine Meta)" value={money(cards.moeda, cards.cpl)} hint={`${int(cards.conversas)} conversas no Meta`} />
        <Tile icon={Award} tone="green" label="Custo por lead BOM (verdade)" value={money(cards.moeda, cards.custo_por_lead_bom)} hint={`${int(cards.leads_bom)} leads bons classificados pelo Pedro`} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={DollarSign} label="Investido" value={money(cards.moeda, cards.gasto)} />
        <Tile icon={TrendingUp} label="CPM" value={money(cards.moeda, cards.cpm)} />
        <Tile icon={MousePointerClick} label="CPC" value={money(cards.moeda, cards.cpc)} />
        <Tile icon={MessageCircle} label="Conversas" value={int(cards.conversas)} />
      </div>

      {semPct > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Atribuição por anúncio: <b>{int(cards.atribuicao.por_ad_id)}</b> precisos (ID Meta), <b>{int(cards.atribuicao.por_titulo)}</b> por título, <b>{int(cards.atribuicao.sem_origem)} sem origem</b> ({semPct}%). Fica preciso conforme as contas migram pro WhatsApp oficial da Meta.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Award className="h-4 w-4" /> Anúncios por qualidade real do lead</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {cards.anuncios.length === 0 && <p className="text-sm text-muted-foreground">Ainda sem leads classificados por anúncio. Conforme o Pedro atende, aparece aqui.</p>}
          {cards.anuncios.map((a, i) => {
            const pct = n(a.pct_bom);
            const tone = pct >= 50 ? 'bg-emerald-500' : pct >= 25 ? 'bg-amber-500' : 'bg-rose-500';
            return (
              <div key={i} className="flex items-center gap-2 text-xs border-b last:border-0 py-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${tone} shrink-0`} />
                <span className="flex-1 truncate" title={a.ad_name || ''}>
                  {a.ad_name || '(sem nome)'}
                  {a.ad_key_kind === 'titulo' && <Badge variant="outline" className="ml-1 text-[9px] h-3.5 px-1">por título</Badge>}
                </span>
                <span className="text-muted-foreground">{int(a.leads_total)} leads</span>
                <span className="text-emerald-600 font-medium">{int(a.leads_bom)} bons</span>
                <span className="text-rose-600">{int(a.leads_ruim)} ruins</span>
                <span className="font-semibold w-10 text-right">{a.pct_bom == null ? '--' : `${a.pct_bom}%`}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Região de entrega (alvo)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {cards.regiao_entrega.length === 0 && <p className="text-muted-foreground">Sem dados.</p>}
            {cards.regiao_entrega.slice(0, 6).map((r, i) => (
              <div key={i} className="flex justify-between gap-2"><span className="truncate">{r.regiao}</span><span className="text-muted-foreground shrink-0">{money(cards.moeda, r.gasto)}</span></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" /> Origem dos leads (real)</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {cards.regiao_origem.length === 0 && <p className="text-muted-foreground">Sem cidade declarada ainda.</p>}
            {cards.regiao_origem.slice(0, 6).map((r, i) => (
              <div key={i} className="flex justify-between gap-2"><span className="truncate">{r.cidade}</span><span className="text-muted-foreground shrink-0">{int(r.leads)} ({int(r.leads_bom)} bons)</span></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Por idade</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs">
            {cards.idade.length === 0 && <p className="text-muted-foreground">Sem dados.</p>}
            {cards.idade.slice(0, 6).map((r, i) => (
              <div key={i} className="flex justify-between gap-2"><span>{r.faixa}</span><span className="text-muted-foreground shrink-0">{money(cards.moeda, r.gasto)}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
