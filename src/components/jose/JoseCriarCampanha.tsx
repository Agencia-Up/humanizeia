import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Sparkles, Target, Users, Image as ImageIcon, DollarSign } from 'lucide-react';

// José v3.1 — Fase 4. Pede um rascunho de campanha em linguagem natural; José gera
// objetivo/público/criativo/orçamento + simulação. Não cria na Meta (gate + CampanhaCreator).
const db = supabase as any;
const fmtBRL = (v: any) => (v == null ? '—' : `R$ ${Number(v).toFixed(2)}`);
const fmtNum = (v: any) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));

function DraftCard({ d }: { d: any }) {
  const p = d.payload || {}, pub = p.publico || {}, cri = p.criativo || {}, sim = d.simulacao || {};
  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px]">{String(d.status || 'rascunho').toUpperCase()}</Badge>
          <span className="text-[11px] text-muted-foreground">{d.created_at ? new Date(d.created_at).toLocaleString('pt-BR') : ''}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Target className="h-3.5 w-3.5" />Objetivo</p>
            <p>{p.objetivo || d.objetivo || '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Users className="h-3.5 w-3.5" />Público</p>
            <p className="text-xs">{[pub.localizacao, (pub.idade_min && pub.idade_max) ? `${pub.idade_min}-${pub.idade_max} anos` : null, pub.genero].filter(Boolean).join(' · ')}</p>
            {Array.isArray(pub.interesses) && pub.interesses.length > 0 && (
              <div className="flex flex-wrap gap-1">{pub.interesses.slice(0, 8).map((i: string) => <Badge key={i} variant="secondary" className="text-[10px]">{i}</Badge>)}</div>
            )}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" />Criativo</p>
            {cri.titulo && <p className="font-medium">{cri.titulo}</p>}
            {cri.texto && <p className="text-xs text-muted-foreground">{cri.texto}</p>}
            {cri.cta && <Badge variant="outline" className="text-[10px] mt-1">{cri.cta}</Badge>}
          </div>
        </div>
        <div className="rounded-lg bg-card/60 border border-border/50 p-3">
          <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground mb-2"><DollarSign className="h-3.5 w-3.5" />Simulação ({sim.periodo_dias || 7} dias) · orçamento {fmtBRL(p.orcamento_diario_brl)}/dia</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span><span className="text-muted-foreground">Investimento:</span> <strong>{fmtBRL(sim.investimento_total)}</strong></span>
            <span><span className="text-muted-foreground">Impressões:</span> <strong>{fmtNum(sim.impressoes_estimadas)}</strong></span>
            <span><span className="text-muted-foreground">Cliques:</span> <strong>{fmtNum(sim.cliques_estimados)}</strong></span>
            <span><span className="text-muted-foreground">Leads est.:</span> <strong>{fmtNum(sim.leads_estimados)}</strong></span>
          </div>
          {sim.observacao && <p className="text-[10px] text-muted-foreground mt-1.5 italic">{sim.observacao}</p>}
        </div>
        {p.justificativa && <p className="text-xs text-muted-foreground">{p.justificativa}</p>}
      </CardContent>
    </Card>
  );
}

export function JoseCriarCampanha() {
  const [userId, setUserId] = useState<string | null>(null);
  const [contas, setContas] = useState<any[]>([]);
  const [contaId, setContaId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [gerando, setGerando] = useState(false);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await db.from('jose_generated_campaigns').select('*').order('created_at', { ascending: false }).limit(8);
    setDrafts(data || []); setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    db.from('ad_accounts').select('id, account_name').eq('platform', 'meta').eq('is_active', true)
      .then(({ data }: any) => { setContas(data || []); if (data?.[0]) setContaId(data[0].id); });
    load();
  }, [load]);

  const gerar = async () => {
    if (prompt.trim().length < 5) { toast.error('Descreva a campanha que você quer'); return; }
    setGerando(true);
    const { data, error } = await supabase.functions.invoke('jose-generate-campaign', { body: { ad_account_id: contaId || null, prompt } });
    setGerando(false);
    if (error || (data && data.ok === false)) { toast.error((data && data.error) || 'Erro ao gerar'); return; }
    toast.success('Rascunho gerado pelo José'); setPrompt(''); load();
  };

  if (!userId) return <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Carregando…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4" />Criar campanha com o José</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {contas.length > 1 && (
            <div className="space-y-1.5 max-w-xs">
              <Label className="text-xs">Conta de anúncio</Label>
              <Select value={contaId} onValueChange={setContaId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{contas.map((c) => <SelectItem key={c.id} value={c.id}>{c.account_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">O que você quer anunciar?</Label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
              placeholder="ex.: Campanha pra vender Onix seminovo em Uberlândia, foco em parcela baixa, R$50 por dia." />
          </div>
          <Button onClick={gerar} disabled={gerando} className="gap-2">{gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Gerar rascunho</Button>
          <p className="text-[11px] text-muted-foreground">O José gera um rascunho com simulação. Ele <strong>não publica sozinho</strong> — você revisa e cria pela tela de campanha (com aprovação).</p>
        </CardContent>
      </Card>

      {loading ? <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
        : drafts.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum rascunho ainda. Peça o primeiro acima.</CardContent></Card>
        : drafts.map((d) => <DraftCard key={d.id} d={d} />)}
    </div>
  );
}
