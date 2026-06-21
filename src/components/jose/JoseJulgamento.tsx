import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Scale, BookOpen, Trophy, AlertTriangle, ThumbsDown, HelpCircle, Plus, Trash2 } from 'lucide-react';

// José v3.1 — Fase 1 (Núcleo de Julgamento). Veredito em pirâmide (Negócio > Sinal
// > Vitrine) + Base de Inteligência por nicho. Tabelas jose_* fora dos tipos -> any.
const db = supabase as any;

const NICHOS = [
  { key: 'automoveis', label: 'Automóveis' },
  { key: 'imoveis', label: 'Imóveis' },
  { key: 'generico', label: 'Genérico' },
];
const TIPOS = [
  { key: 'heuristica', label: 'Heurística' },
  { key: 'armadilha', label: 'Armadilha' },
  { key: 'benchmark', label: 'Benchmark' },
  { key: 'principio', label: 'Princípio' },
];

const veredictMeta: Record<string, { label: string; cls: string; Icon: any }> = {
  bom: { label: 'BOM', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', Icon: Trophy },
  atencao: { label: 'ATENÇÃO', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', Icon: AlertTriangle },
  ruim: { label: 'RUIM', cls: 'bg-red-500/15 text-red-400 border-red-500/30', Icon: ThumbsDown },
  dados_insuficientes: { label: 'DADOS INSUFICIENTES', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30', Icon: HelpCircle },
};

const fmtPct = (v: any) => (v == null ? '—' : `${(Number(v) * 100).toFixed(0)}%`);
const fmtBRL = (v: any) => (v == null ? '—' : `R$ ${Number(v).toFixed(2)}`);
const fmtNum = (v: any) => (v == null ? '—' : String(v));

export function JoseJulgamento() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sub, setSub] = useState('veredito');
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);
  if (!userId) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Carregando…</div>;

  return (
    <Tabs value={sub} onValueChange={setSub} className="w-full">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="veredito" className="gap-1 text-xs"><Scale className="h-3 w-3" />Veredito da campanha</TabsTrigger>
        <TabsTrigger value="base" className="gap-1 text-xs"><BookOpen className="h-3 w-3" />Base de Inteligência</TabsTrigger>
      </TabsList>
      <TabsContent value="veredito" className="mt-4"><VereditoSection userId={userId} /></TabsContent>
      <TabsContent value="base" className="mt-4"><BaseSection userId={userId} /></TabsContent>
    </Tabs>
  );
}

// ── Pirâmide de verdade ───────────────────────────────────────────────────────
function Piramide({ v }: { v: any }) {
  const n1 = v.nivel1 || {}, n2 = v.nivel2 || {}, n3 = v.nivel3 || {};
  const levels = [
    {
      w: 'w-[55%]', cls: 'bg-emerald-500/10 border-emerald-500/30',
      tag: 'Nível 3 — Negócio (a verdade)', itens: [
        ['Vendas', fmtNum(n3.vendas)], ['Leads qualificados', fmtNum(n3.leads_qualificados)],
        ['Custo/venda', fmtBRL(n3.custo_por_venda)], ['Custo/lead qualif.', fmtBRL(n3.custo_por_lead_qualificado)],
      ],
    },
    {
      w: 'w-[78%]', cls: 'bg-blue-500/10 border-blue-500/30',
      tag: 'Nível 2 — Sinal', itens: [
        ['% qualificado', fmtPct(n2.pct_qualificado)], ['Taxa iniciação', fmtPct(n2.taxa_iniciacao_conversa)],
        ['Avanço de funil', fmtPct(n2.avanco_funil)], ['Leads', fmtNum(n2.total_leads)],
      ],
    },
    {
      w: 'w-full', cls: 'bg-slate-700/20 border-slate-600/40',
      tag: 'Nível 1 — Vitrine (hipótese)', itens: [
        ['CPM', fmtBRL(n1.cpm)], ['CTR', fmtPct(n1.ctr)], ['CPL vitrine', fmtBRL(n1.cpl_vitrine)], ['Volume', fmtNum(n1.volume)],
      ],
    },
  ];
  return (
    <div className="flex flex-col items-center gap-1.5">
      {levels.map((l) => (
        <div key={l.tag} className={`${l.w} rounded-lg border ${l.cls} px-3 py-2`}>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{l.tag}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {l.itens.map(([k, val]) => (
              <span key={k}><span className="text-muted-foreground">{k}:</span> <span className="font-semibold tabular-nums">{val}</span></span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function VerdictCard({ v }: { v: any }) {
  const m = veredictMeta[v.veredito] || veredictMeta.dados_insuficientes;
  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className={`${m.cls} gap-1`}><m.Icon className="h-3.5 w-3.5" />{m.label}</Badge>
          <span className="text-[11px] text-muted-foreground">
            {v.nicho} · confiança {Math.round((Number(v.confianca) || 0) * 100)}% · {v.created_at ? new Date(v.created_at).toLocaleString('pt-BR') : ''}
          </span>
        </div>
        <Piramide v={v} />
        {v.justificativa && (
          <div className="rounded-lg bg-card/60 border border-border/50 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Justificativa do José</p>
            <p className="text-sm leading-relaxed">{v.justificativa}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VereditoSection({ userId }: { userId: string }) {
  const [contas, setContas] = useState<any[]>([]);
  const [contaId, setContaId] = useState<string>('');
  const [gerando, setGerando] = useState(false);
  const [verdicts, setVerdicts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadVerdicts = useCallback(async () => {
    const { data } = await db.from('jose_campaign_verdict').select('*').order('created_at', { ascending: false }).limit(10);
    setVerdicts(data || []); setLoading(false);
  }, []);

  useEffect(() => {
    db.from('ad_accounts').select('id, account_name, platform').eq('user_id', userId).eq('platform', 'meta').eq('is_active', true)
      .then(({ data }: any) => { setContas(data || []); if (data?.[0]) setContaId(data[0].id); });
    loadVerdicts();
  }, [userId, loadVerdicts]);

  const gerar = async () => {
    setGerando(true);
    const { data, error } = await supabase.functions.invoke('jose-reasoning-core', {
      body: { ad_account_id: contaId || null, campaign_id: 'conta-geral' },
    });
    setGerando(false);
    if (error || (data && data.ok === false)) { toast.error((data && data.error) || 'Erro ao gerar veredito'); return; }
    toast.success(`Veredito: ${String(data?.veredito || '').toUpperCase()}`);
    loadVerdicts();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Gerar veredito</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 min-w-[220px]">
            <Label className="text-xs">Conta de anúncio</Label>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
              <SelectContent>{contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.account_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={gerar} disabled={gerando} className="gap-2">
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}Gerar veredito
          </Button>
          <p className="text-[11px] text-muted-foreground basis-full">
            O veredito julga pela hierarquia de verdade: <strong>venda &gt; lead qualificado pelo Pedro &gt; vitrine</strong>. Os níveis 2 e 3 são do nível da conta (atribuição por campanha é evolução futura).
          </p>
        </CardContent>
      </Card>

      {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        : verdicts.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum veredito ainda. Gere o primeiro acima.</CardContent></Card>
        : verdicts.map((v) => <VerdictCard key={v.id} v={v} />)}
    </div>
  );
}

// ── Base de Inteligência ──────────────────────────────────────────────────────
function BaseSection({ userId }: { userId: string }) {
  const [nicho, setNicho] = useState('automoveis');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [novo, setNovo] = useState<{ tipo: string; titulo: string; conteudo: string }>({ tipo: 'principio', titulo: '', conteudo: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from('jose_knowledge_base').select('*').eq('nicho', nicho).eq('ativo', true)
      .order('origem', { ascending: true }).order('confianca', { ascending: false }).limit(200);
    setRows(data || []); setLoading(false);
  }, [nicho]);
  useEffect(() => { load(); }, [load]);

  const criar = async () => {
    if (!novo.titulo.trim() || !novo.conteudo.trim()) { toast.error('Preencha título e conteúdo'); return; }
    setSaving(true);
    const { error } = await db.from('jose_knowledge_base').insert({
      user_id: userId, nicho, tipo: novo.tipo, titulo: novo.titulo.trim(), conteudo: novo.conteudo.trim(),
      origem: 'curado', confianca: 0.7, criado_por: 'dono',
    });
    setSaving(false);
    if (error) { toast.error('Erro ao salvar'); return; }
    toast.success('Conhecimento adicionado'); setNovo({ tipo: 'principio', titulo: '', conteudo: '' }); load();
  };
  const desativar = async (id: string) => {
    await db.from('jose_knowledge_base').update({ ativo: false }).eq('id', id);
    toast.success('Removido'); load();
  };

  const tipoLabel = (t: string) => TIPOS.find((x) => x.key === t)?.label || t;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-xs">Nicho:</Label>
        <Select value={nicho} onValueChange={setNicho}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>{NICHOS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" />Adicionar conhecimento</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5 w-[160px]">
              <Label className="text-xs">Tipo</Label>
              <Select value={novo.tipo} onValueChange={(v) => setNovo((p) => ({ ...p, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 flex-1 min-w-[220px]">
              <Label className="text-xs">Título</Label>
              <Input value={novo.titulo} onChange={(e) => setNovo((p) => ({ ...p, titulo: e.target.value }))} placeholder="ex.: Criativo com preço filtra curioso" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Conteúdo</Label>
            <Textarea value={novo.conteudo} onChange={(e) => setNovo((p) => ({ ...p, conteudo: e.target.value }))} rows={3}
              placeholder="A regra/experiência que o José deve usar pra julgar campanhas deste nicho." />
          </div>
          <Button onClick={criar} disabled={saving} className="gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Adicionar</Button>
        </CardContent>
      </Card>

      {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div> : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">{tipoLabel(r.tipo)}</Badge>
                      <Badge variant="outline" className={`text-[10px] ${r.origem === 'curado' ? 'text-amber-400 border-amber-500/30' : 'text-violet-400 border-violet-500/30'}`}>
                        {r.origem === 'curado' ? 'Curado' : 'Aprendido'}
                      </Badge>
                      {r.user_id == null && <Badge variant="outline" className="text-[10px] text-slate-400">Global</Badge>}
                      <span className="text-[10px] text-muted-foreground">confiança {Math.round((Number(r.confianca) || 0) * 100)}%{r.evidencia_casos ? ` · ${r.evidencia_casos} casos` : ''}</span>
                    </div>
                    <p className="text-sm font-medium">{r.titulo}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.conteudo}</p>
                  </div>
                  {r.user_id === userId && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-400" onClick={() => desativar(r.id)} title="Remover">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
