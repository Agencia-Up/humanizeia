import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  ShieldAlert, Power, SlidersHorizontal, KeyRound, DollarSign, ToggleLeft,
  Loader2, CheckCircle, XCircle, Clock, AlertTriangle,
  PauseCircle, TrendingUp, TrendingDown, PlusCircle, Image as ImageIcon, Users, MessageCircle, Info,
} from 'lucide-react';

// ── Governança do José (Fase 0). Tudo escopado por usuário via RLS (auth.uid()).
// Sub-abas: Aprovações (Realtime), Limites+kill-switch, Permissões, Custo, Flags.
// As tabelas jose_* ainda não estão nos tipos gerados -> (supabase as any).
const db = supabase as any;

// Ações que o José pode tomar (nível de autonomia por tipo).
const TIPOS_ACAO: { key: string; label: string }[] = [
  { key: 'pausar_campanha',   label: 'Pausar campanha' },
  { key: 'escalar_orcamento', label: 'Aumentar orçamento' },
  { key: 'reduzir_orcamento', label: 'Reduzir orçamento' },
  { key: 'criar_campanha',    label: 'Criar campanha' },
  { key: 'publicar_criativo', label: 'Publicar criativo' },
  { key: 'ajustar_publico',   label: 'Ajustar público' },
];
const NIVEIS = [
  { key: 'desligado',  label: 'Desligado (nem analisa)' },
  { key: 'analisar',   label: 'Só analisa' },
  { key: 'recomendar', label: 'Recomenda (pede SIM/NÃO)' },
  { key: 'executar',   label: 'Executa sozinho (dentro do teto)' },
];

// Metadados visuais por ação (ícone + cor + explicação p/ leigo) — padrão do mockup.
const ACAO_META: Record<string, { icon: any; tile: string; desc: string }> = {
  pausar_campanha:   { icon: PauseCircle,  tile: 'bg-blue-500/15 text-blue-400 ring-blue-400/25',     desc: 'O José identifica que a campanha está gastando muito e recomenda pausar.' },
  escalar_orcamento: { icon: TrendingUp,   tile: 'bg-emerald-500/15 text-emerald-400 ring-emerald-400/25', desc: 'O José vê oportunidade de escalar e recomenda aumentar o orçamento.' },
  reduzir_orcamento: { icon: TrendingDown, tile: 'bg-orange-500/15 text-orange-400 ring-orange-400/25', desc: 'O José identifica que o custo está alto e recomenda reduzir o orçamento.' },
  criar_campanha:    { icon: PlusCircle,   tile: 'bg-violet-500/15 text-violet-400 ring-violet-400/25', desc: 'O José sugere uma nova campanha com base em dados e objetivos.' },
  publicar_criativo: { icon: ImageIcon,    tile: 'bg-amber-500/15 text-amber-400 ring-amber-400/25',   desc: 'O José sugere um criativo e recomenda publicar após análise.' },
  ajustar_publico:   { icon: Users,        tile: 'bg-cyan-500/15 text-cyan-400 ring-cyan-400/25',       desc: 'O José propõe ajustes no público para melhorar resultados.' },
};
// O selo "o que significa" derivado do nível escolhido.
function significaSelo(nivel: string): { label: string; cls: string } {
  if (nivel === 'executar')  return { label: 'Executa sozinho', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
  if (nivel === 'analisar')  return { label: 'Só analisa',       cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  if (nivel === 'desligado') return { label: 'Desligado',        cls: 'bg-muted text-muted-foreground border-border' };
  return { label: 'Pede aprovação', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
}
const FEATURES: { key: string; label: string; desc: string }[] = [
  { key: 'reasoning_core',      label: 'Núcleo de julgamento', desc: 'Veredito por hierarquia de verdade (venda > lead > vitrine)' },
  { key: 'voz',                 label: 'Voz (áudio)',          desc: 'Responder e entender áudios no WhatsApp' },
  { key: 'criativo_whatsapp',   label: 'Criativo via WhatsApp', desc: 'Analisar imagem/vídeo enviados e publicar' },
  { key: 'criacao_campanha',    label: 'Criação de campanha',  desc: 'Gerar rascunho de campanha com simulação' },
  { key: 'google_ads',          label: 'Google Ads',           desc: 'Operar Google Ads com a mesma governança' },
  { key: 'otimizacao_proativa', label: 'Otimização proativa',  desc: 'Sugerir escala/oportunidades sem pedir' },
];

const riscoBadge = (r: string) => ({
  baixo:   'bg-blue-500/15 text-blue-400 border-blue-500/30',
  medio:   'bg-amber-500/15 text-amber-400 border-amber-500/30',
  alto:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  critico: 'bg-red-500/15 text-red-400 border-red-500/30',
}[r] || 'bg-muted text-muted-foreground');

export function JoseGovernanca() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sub, setSub] = useState('aprovacoes');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  if (!userId) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…</div>;
  }

  return (
    <Tabs value={sub} onValueChange={setSub} className="w-full">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="aprovacoes" className="gap-1 text-xs"><ShieldAlert className="h-3 w-3" />Aprovações</TabsTrigger>
        <TabsTrigger value="limites" className="gap-1 text-xs"><SlidersHorizontal className="h-3 w-3" />Limites e segurança</TabsTrigger>
        <TabsTrigger value="permissoes" className="gap-1 text-xs"><KeyRound className="h-3 w-3" />Permissões</TabsTrigger>
        <TabsTrigger value="custo" className="gap-1 text-xs"><DollarSign className="h-3 w-3" />Custo de IA</TabsTrigger>
        <TabsTrigger value="flags" className="gap-1 text-xs"><ToggleLeft className="h-3 w-3" />Recursos</TabsTrigger>
      </TabsList>

      <TabsContent value="aprovacoes" className="mt-4"><AprovacoesSection userId={userId} /></TabsContent>
      <TabsContent value="limites" className="mt-4"><LimitesSection userId={userId} /></TabsContent>
      <TabsContent value="permissoes" className="mt-4"><PermissoesSection userId={userId} /></TabsContent>
      <TabsContent value="custo" className="mt-4"><CustoSection userId={userId} /></TabsContent>
      <TabsContent value="flags" className="mt-4"><FlagsSection userId={userId} /></TabsContent>
    </Tabs>
  );
}

// ── Aprovações pendentes (Realtime) ─────────────────────────────────────────
function AprovacoesSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await db.from('jose_action_approvals')
      .select('*').eq('status', 'pendente').order('created_at', { ascending: false });
    setRows(data || []); setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel('jose-approvals-' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jose_action_approvals' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  const [responding, setResponding] = useState<string | null>(null);
  const responder = async (id: string, aprovar: boolean) => {
    setResponding(id);
    // Chama o handler: aprovar EXECUTA a ação guardada; rejeitar só marca.
    const { data, error } = await supabase.functions.invoke('jose-approval-handler', {
      body: { approval_id: id, decision: aprovar ? 'aprovado' : 'rejeitado' },
    });
    setResponding(null);
    if (error || (data && data.ok === false)) {
      toast.error((data && data.error) || 'Erro ao responder');
      load();
      return;
    }
    toast.success(aprovar ? 'Aprovado e executado' : 'Rejeitado');
    load();
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;
  if (!rows.length) return (
    <Card><CardContent className="py-10 text-center text-muted-foreground">
      <CheckCircle className="h-8 w-8 mx-auto mb-2 text-emerald-400/70" />
      Nenhuma aprovação pendente. O José age dentro dos limites e só te chama quando precisa do seu OK.
    </CardContent></Card>
  );

  return (
    <div className="space-y-3">
      {rows.map((a) => (
        <Card key={a.id} className="border-l-4" style={{ borderLeftColor: 'var(--brand-gold, #D4A017)' }}>
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={riscoBadge(a.risco)}>{a.risco}</Badge>
                  <span className="text-xs text-muted-foreground">{a.tipo_acao}</span>
                </div>
                <p className="text-sm font-medium">{a.resumo_humano || 'Ação aguardando aprovação'}</p>
                {a.expira_em && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> expira {new Date(a.expira_em).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="gap-1" disabled={responding === a.id} onClick={() => responder(a.id, false)}>
                  <XCircle className="h-4 w-4" />Não
                </Button>
                <Button size="sm" className="gap-1" disabled={responding === a.id} onClick={() => responder(a.id, true)}>
                  {responding === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}Sim
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// helper: lê a linha do usuário (ad_account_id NULL = nível conta) e insere/atualiza
async function readRow(table: string, userId: string, extra: Record<string, any> = {}) {
  let q = db.from(table).select('*').eq('user_id', userId).is('ad_account_id', null);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { data } = await q.maybeSingle();
  return data;
}

// ── Limites + kill-switch ────────────────────────────────────────────────────
function LimitesSection({ userId }: { userId: string }) {
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { readRow('jose_spend_caps', userId).then((r) => { setRow(r || {}); setLoading(false); }); }, [userId]);

  const setField = (k: string, v: any) => setRow((p: any) => ({ ...p, [k]: v }));

  const save = async (patch?: Record<string, any>) => {
    setSaving(true);
    const body = { ...row, ...(patch || {}), user_id: userId, ad_account_id: null, updated_at: new Date().toISOString() };
    const num = (x: any) => (x === '' || x === null || x === undefined || Number.isNaN(Number(x)) ? null : Number(x));
    const payload = {
      user_id: userId, ad_account_id: null,
      kill_switch: !!body.kill_switch,
      limite_gasto_alterado_dia: num(body.limite_gasto_alterado_dia),
      limite_acoes_dia: num(body.limite_acoes_dia),
      limite_minutos_voz_mes: num(body.limite_minutos_voz_mes),
      exige_aprovacao_acima_de: num(body.exige_aprovacao_acima_de),
      teto_custo_ia_mes_usd: num(body.teto_custo_ia_mes_usd),
      aprovacao_whatsapp: (String(body.aprovacao_whatsapp || '').trim()) || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (row?.id) ({ error } = await db.from('jose_spend_caps').update(payload).eq('id', row.id));
    else {
      const ins = await db.from('jose_spend_caps').insert(payload).select('id').maybeSingle();
      error = ins.error; if (ins.data?.id) setRow((p: any) => ({ ...p, id: ins.data.id }));
    }
    setSaving(false);
    if (error) toast.error('Erro ao salvar'); else toast.success('Limites salvos');
  };

  const toggleKill = async (v: boolean) => { setField('kill_switch', v); await save({ kill_switch: v }); };

  if (loading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <Card className={row?.kill_switch ? 'border-red-500/40 bg-red-500/5' : ''}>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Power className={`h-4 w-4 ${row?.kill_switch ? 'text-red-400' : 'text-emerald-400'}`} />Botão de emergência (kill-switch)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Quando ligado, <strong>paralisa toda ação autônoma do José</strong> imediatamente. Use se algo sair do controle.</p>
            <Switch checked={!!row?.kill_switch} onCheckedChange={toggleKill} />
          </div>
          {row?.kill_switch && <p className="text-xs text-red-400 mt-2 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />José está PARADO. Nenhuma ação automática vai rodar.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Tetos de segurança</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="WhatsApp do responsável (aprovações)" hint="Recebe o 'Responda SIM/NÃO' do José por aqui (DDD + número, ex.: 34999080815).">
              <Input value={row?.aprovacao_whatsapp ?? ''} onChange={(e) => setField('aprovacao_whatsapp', e.target.value)} placeholder="DDD + número" />
            </Field>
          </div>
          <Field label="Máx. de ações por dia" hint="Acima disso, pede aprovação">
            <Input type="number" value={row?.limite_acoes_dia ?? ''} onChange={(e) => setField('limite_acoes_dia', e.target.value)} placeholder="ex.: 20" />
          </Field>
          <Field label="Pedir SIM/NÃO acima de (R$)" hint="Mudança de orçamento que exige aprovação">
            <Input type="number" value={row?.exige_aprovacao_acima_de ?? ''} onChange={(e) => setField('exige_aprovacao_acima_de', e.target.value)} placeholder="ex.: 100" />
          </Field>
          <Field label="Máx. de gasto alterado por dia (R$)" hint="Limite de mudança de orçamento no dia">
            <Input type="number" value={row?.limite_gasto_alterado_dia ?? ''} onChange={(e) => setField('limite_gasto_alterado_dia', e.target.value)} placeholder="ex.: 500" />
          </Field>
          <Field label="Teto de custo de IA no mês (US$)" hint="Acima disso, José para de gastar IA">
            <Input type="number" value={row?.teto_custo_ia_mes_usd ?? ''} onChange={(e) => setField('teto_custo_ia_mes_usd', e.target.value)} placeholder="ex.: 50" />
          </Field>
          <Field label="Máx. de minutos de voz no mês" hint="Limite de áudio (STT+TTS)">
            <Input type="number" value={row?.limite_minutos_voz_mes ?? ''} onChange={(e) => setField('limite_minutos_voz_mes', e.target.value)} placeholder="ex.: 300" />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => save()} disabled={saving} className="w-full">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar tetos'}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Permissões por tipo de ação ──────────────────────────────────────────────
function PermissoesSection({ userId }: { userId: string }) {
  const [map, setMap] = useState<Record<string, { id?: string; nivel: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.from('jose_permissions').select('id, tipo_acao, nivel').eq('user_id', userId).is('ad_account_id', null)
      .then(({ data }: any) => {
        const m: Record<string, any> = {};
        for (const t of TIPOS_ACAO) m[t.key] = { nivel: 'recomendar' };
        for (const r of (data || [])) m[r.tipo_acao] = { id: r.id, nivel: r.nivel };
        setMap(m); setLoading(false);
      });
  }, [userId]);

  const setNivel = async (tipo: string, nivel: string) => {
    setMap((p) => ({ ...p, [tipo]: { ...p[tipo], nivel } }));
    const existing = map[tipo];
    if (existing?.id) {
      await db.from('jose_permissions').update({ nivel, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      const ins = await db.from('jose_permissions').insert({ user_id: userId, ad_account_id: null, tipo_acao: tipo, nivel }).select('id').maybeSingle();
      if (ins.data?.id) setMap((p) => ({ ...p, [tipo]: { ...p[tipo], id: ins.data.id } }));
    }
    toast.success('Permissão atualizada');
  };

  if (loading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-bold flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Nível de autonomia por ação</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Escolha como o José deve agir em cada situação. Você mantém o controle final.</p>
      </div>

      <Card className="border-primary/20">
        <CardContent className="p-0">
          {/* Cabeçalho (desktop) */}
          <div className="hidden md:grid grid-cols-[1.7fr_150px_190px_230px] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/50">
            <span>Ação</span><span>O que significa</span><span>Como ele solicita</span><span>Nível de autonomia</span>
          </div>
          <div className="divide-y divide-border/40">
            {TIPOS_ACAO.map((t) => {
              const meta = ACAO_META[t.key];
              const nivel = map[t.key]?.nivel || 'recomendar';
              const selo = significaSelo(nivel);
              const Icon = meta?.icon || KeyRound;
              return (
                <div key={t.key} className="grid grid-cols-1 md:grid-cols-[1.7fr_150px_190px_230px] gap-3 px-4 py-3.5 md:items-center hover:bg-muted/30 transition-colors">
                  {/* Ação */}
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${meta?.tile || 'bg-muted text-muted-foreground'}`}><Icon className="h-5 w-5" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{t.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{meta?.desc}</p>
                    </div>
                  </div>
                  {/* O que significa */}
                  <div><Badge variant="outline" className={`text-[10px] font-medium ${selo.cls}`}>{selo.label}</Badge></div>
                  {/* Como ele solicita */}
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    {nivel === 'recomendar'
                      ? (<><MessageCircle className="h-3.5 w-3.5 text-emerald-400" /> WhatsApp do responsável</>)
                      : nivel === 'executar' ? 'Executa direto (com log)'
                      : nivel === 'analisar' ? 'Só mostra no painel' : '—'}
                  </div>
                  {/* Nível de autonomia */}
                  <div>
                    <Select value={nivel} onValueChange={(v) => setNivel(t.key, v)}>
                      <SelectTrigger className="w-full md:w-[220px] h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{NIVEIS.map((n) => <SelectItem key={n.key} value={n.key}>{n.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Info className="h-3 w-3" /> Você pode alterar o nível de cada ação a qualquer momento.</p>
    </div>
  );
}

// ── Custo de IA (ledger) ──────────────────────────────────────────────────────
function CustoSection({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [porCap, setPorCap] = useState<Record<string, number>>({});

  useEffect(() => {
    const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    db.from('jose_usage_ledger').select('capability, custo_usd').gte('created_at', start)
      .then(({ data }: any) => {
        let t = 0; const cap: Record<string, number> = {};
        for (const r of (data || [])) { const c = Number(r.custo_usd || 0); t += c; cap[r.capability] = (cap[r.capability] || 0) + c; }
        setTotal(t); setPorCap(cap); setLoading(false);
      });
  }, [userId]);

  if (loading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;

  const capLabel: Record<string, string> = { llm: 'Texto (LLM)', vision: 'Visão', stt: 'Transcrição', tts: 'Voz' };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Custo de IA do mês</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">US$ {total.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground mt-1">Soma de todas as chamadas de IA do José neste mês (mês corrente, UTC).</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Por capacidade</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(porCap).length === 0 && <p className="text-sm text-muted-foreground">Nenhum consumo registrado ainda.</p>}
          {Object.entries(porCap).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span>{capLabel[k] || k}</span>
              <span className="font-medium">US$ {v.toFixed(4)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Feature flags (recursos) ──────────────────────────────────────────────────
function FlagsSection({ userId }: { userId: string }) {
  const [map, setMap] = useState<Record<string, { id?: string; on: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.from('jose_feature_flags').select('id, feature, habilitado').eq('user_id', userId)
      .then(({ data }: any) => {
        const m: Record<string, any> = {};
        for (const f of FEATURES) m[f.key] = { on: false };
        for (const r of (data || [])) m[r.feature] = { id: r.id, on: !!r.habilitado };
        setMap(m); setLoading(false);
      });
  }, [userId]);

  const toggle = async (feature: string, on: boolean) => {
    setMap((p) => ({ ...p, [feature]: { ...p[feature], on } }));
    const existing = map[feature];
    if (existing?.id) {
      await db.from('jose_feature_flags').update({ habilitado: on, updated_at: new Date().toISOString() }).eq('id', existing.id);
    } else {
      const ins = await db.from('jose_feature_flags').insert({ user_id: userId, feature, habilitado: on, rollout_pct: 100 }).select('id').maybeSingle();
      if (ins.data?.id) setMap((p) => ({ ...p, [feature]: { ...p[feature], id: ins.data.id } }));
    }
    toast.success(on ? 'Recurso ligado' : 'Recurso desligado');
  };

  if (loading) return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Recursos do José</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {FEATURES.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 border-b border-border/40 pb-3 last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-medium">{f.label}</p>
              <p className="text-xs text-muted-foreground">{f.desc}</p>
            </div>
            <Switch checked={!!map[f.key]?.on} onCheckedChange={(v) => toggle(f.key, v)} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
