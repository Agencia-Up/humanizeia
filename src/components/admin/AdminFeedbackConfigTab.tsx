import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  RefreshCcw, AlertTriangle, Brain, Bell, FileBarChart, Radar, Save,
  ChevronDown, ChevronRight, FileText, DollarSign, Users,
} from 'lucide-react';

// ── Admin do Cérebro de Feedback (superadmin) ────────────────────────────────
// Liga/desliga por TENANT: analise / alertas / relatorio / feed_jose, e ajusta os
// tetos (cap_analises_dia, cap_custo_mes_usd) e os canais de alerta. Escreve SÓ em
// feedback_config, via RPC SECURITY DEFINER (feedback_config_admin_set) — NÃO toca em
// transferência/CRM/follow-up. Também mostra QUEM recebe o relatório diário
// (recebe_atendimento) e o alerta de perda de venda (recebe_alertas) por conta.

interface Row {
  tenant_id: string | null; email: string | null; tem_config: boolean;
  analise: boolean; alertas: boolean; relatorio: boolean; feed_jose: boolean;
  cap_analises_dia: number; cap_custo_mes_usd: number; canais_alerta: string[];
}
interface Resp { nome: string; whatsapp: string; recebe_atendimento: boolean; recebe_alertas: boolean; ativo: boolean; }

const FLAGS: { key: 'analise' | 'alertas' | 'relatorio' | 'feed_jose'; label: string; desc: string; icon: typeof Brain }[] = [
  { key: 'analise', label: 'Análise de atendimento', desc: 'A IA avalia cada conversa (NEPQ/score). É o que alimenta tudo.', icon: Brain },
  { key: 'relatorio', label: 'Relatório diário', desc: 'Envia o resumo do dia no WhatsApp de quem tem "Atendimento".', icon: FileBarChart },
  { key: 'alertas', label: 'Alerta de perda de venda', desc: 'Avisa na hora quando um cliente bom foi mal atendido e não vendeu.', icon: Bell },
  { key: 'feed_jose', label: 'Feed do José', desc: 'Manda a qualidade do lead por anúncio de volta pro José (tráfego).', icon: Radar },
];
const CANAIS: { key: string; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'painel_flag', label: 'Painel (aviso na tela)' },
];
const keyOf = (r: { tenant_id: string | null }) => r.tenant_id || '__global__';
const fmtTel = (w: string) => { const d = String(w || '').replace(/\D/g, ''); const n = d.startsWith('55') ? d.slice(2) : d; return n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : (w || '—'); };

export default function AdminFeedbackConfigTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, Row>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resp, setResp] = useState<Record<string, Resp[] | null>>({});

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const { data, error } = await (supabase as any).rpc('feedback_config_admin_list');
      if (error) throw error;
      const list: Row[] = (data || []).map((d: any) => ({
        ...d,
        canais_alerta: Array.isArray(d.canais_alerta) ? d.canais_alerta : [],
        cap_custo_mes_usd: Number(d.cap_custo_mes_usd),
        cap_analises_dia: Number(d.cap_analises_dia),
      }));
      setRows(list);
      const dr: Record<string, Row> = {}; for (const r of list) dr[keyOf(r)] = { ...r };
      setDraft(dr);
    } catch (e: any) {
      const m = e?.message || String(e);
      setErro(m.includes('forbidden') ? 'Acesso restrito aos administradores.' : (m || 'Falha ao carregar.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const setField = (k: string, patch: Partial<Row>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));
  const toggleCanal = (k: string, canal: string) => setDraft((d) => {
    const cur = new Set(d[k].canais_alerta); cur.has(canal) ? cur.delete(canal) : cur.add(canal);
    return { ...d, [k]: { ...d[k], canais_alerta: [...cur] } };
  });

  const salvar = async (k: string) => {
    const r = draft[k]; setSaving(k);
    try {
      const { error } = await (supabase as any).rpc('feedback_config_admin_set', {
        p_tenant: r.tenant_id,
        p_analise: r.analise, p_alertas: r.alertas, p_relatorio: r.relatorio, p_feed_jose: r.feed_jose,
        p_cap_analises: Math.max(0, Math.round(Number(r.cap_analises_dia) || 0)),
        p_cap_custo: Math.max(0, Number(r.cap_custo_mes_usd) || 0),
        p_canais: r.canais_alerta.length ? r.canais_alerta : ['painel_flag'],
      });
      if (error) throw error;
      toast({ title: '✅ Configuração salva' });
      await carregar();
    } catch (e: any) {
      toast({ title: 'Não deu pra salvar', description: e?.message, variant: 'destructive' });
    } finally { setSaving(null); }
  };

  const alternarResp = async (r: Row) => {
    const k = keyOf(r);
    if (expanded === k) { setExpanded(null); return; }
    setExpanded(k);
    if (r.tenant_id && resp[k] === undefined) {
      setResp((s) => ({ ...s, [k]: null }));
      const { data } = await (supabase as any).rpc('feedback_config_admin_responsaveis', { p_tenant: r.tenant_id });
      setResp((s) => ({ ...s, [k]: Array.isArray(data) ? data : [] }));
    }
  };

  const dirty = (k: string) => JSON.stringify(draft[k]) !== JSON.stringify(rows.find((r) => keyOf(r) === k));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Liga/desliga o Cérebro de Feedback por conta (análise, relatório, alerta, feed do José), com tetos de custo e canais.
        </p>
        <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : rows.map((r) => {
        const k = keyOf(r); const d = draft[k]; if (!d) return null;
        const isGlobal = r.tenant_id === null;
        const isOpen = expanded === k;
        const lista = resp[k];
        return (
          <Card key={k} className={isGlobal ? 'border-primary/30 bg-primary/[0.03]' : ''}>
            <CardContent className="space-y-4 p-4">
              {/* Cabeçalho da conta */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">
                      {isGlobal ? 'Padrão global (todas as contas)' : (r.email || r.tenant_id?.slice(0, 8))}
                    </span>
                    {isGlobal
                      ? <Badge variant="secondary" className="text-[10px]">fallback</Badge>
                      : r.tem_config
                        ? <Badge className="bg-emerald-500/15 text-emerald-600 text-[10px] hover:bg-emerald-500/15 dark:text-emerald-400">config própria</Badge>
                        : <Badge variant="outline" className="text-[10px]">herda o global</Badge>}
                  </div>
                  {!isGlobal && <div className="truncate text-[11px] text-muted-foreground">{r.tenant_id}</div>}
                </div>
                <Button size="sm" onClick={() => salvar(k)} disabled={saving === k || !dirty(k)}>
                  <Save className="mr-2 h-4 w-4" /> {saving === k ? 'Salvando...' : dirty(k) ? 'Salvar' : 'Salvo'}
                </Button>
              </div>

              {/* Flags */}
              <div className="grid gap-2 sm:grid-cols-2">
                {FLAGS.map((f) => {
                  const Icon = f.icon;
                  return (
                    <label key={f.key} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
                      <Switch checked={!!d[f.key]} onCheckedChange={(v) => setField(k, { [f.key]: v } as Partial<Row>)} className="mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground"><Icon className="h-3.5 w-3.5 text-muted-foreground" /> {f.label}</div>
                        <div className="text-[11px] leading-snug text-muted-foreground">{f.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Tetos + canais */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Brain className="h-3 w-3" /> Análises por dia (teto)</label>
                  <Input type="number" min={0} value={d.cap_analises_dia}
                    onChange={(e) => setField(k, { cap_analises_dia: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><DollarSign className="h-3 w-3" /> Custo por mês (US$, teto)</label>
                  <Input type="number" min={0} step="0.01" value={d.cap_custo_mes_usd}
                    onChange={(e) => setField(k, { cap_custo_mes_usd: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Bell className="h-3 w-3" /> Canais de alerta</label>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {CANAIS.map((c) => {
                      const on = d.canais_alerta.includes(c.key);
                      return (
                        <button key={c.key} type="button" onClick={() => toggleCanal(k, c.key)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${on ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:bg-accent/40'}`}>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Quem recebe (só contas reais) */}
              {!isGlobal && (
                <div>
                  <button type="button" onClick={() => alternarResp(r)}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Quem recebe relatório / alerta
                  </button>
                  {isOpen && (
                    <div className="mt-2 rounded-lg border border-border/50 p-3">
                      {lista === null ? <Skeleton className="h-10 w-full" /> : (lista && lista.length > 0) ? (
                        <div className="space-y-1.5">
                          {lista.map((p, i) => (
                            <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                              <span className="flex items-center gap-1.5 text-foreground">
                                <Users className="h-3 w-3 text-muted-foreground" />
                                {p.nome || 'Sem nome'} <span className="text-muted-foreground">· {fmtTel(p.whatsapp)}</span>
                                {!p.ativo && <span className="text-[10px] text-muted-foreground">(inativo)</span>}
                              </span>
                              <span className="flex gap-1.5">
                                {p.recebe_atendimento && <Badge className="bg-sky-500/15 text-sky-600 text-[10px] hover:bg-sky-500/15 dark:text-sky-400"><FileText className="mr-1 h-3 w-3" />Relatório diário</Badge>}
                                {p.recebe_alertas && <Badge className="bg-amber-500/15 text-amber-600 text-[10px] hover:bg-amber-500/15 dark:text-amber-400"><Bell className="mr-1 h-3 w-3" />Alerta de perda</Badge>}
                                {!p.recebe_atendimento && !p.recebe_alertas && <span className="text-[11px] text-muted-foreground/60">não recebe nada</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          Ninguém marcado ainda. Configure em <span className="font-medium">Configurações → Responsáveis</span> (marque "Atendimento" para o relatório diário e "Alertas" para o alerta de perda de venda).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A <span className="font-medium">Análise</span> é o motor: sem ela, relatório e alerta não têm dados. O
        <span className="font-medium"> alerta de perda de venda</span> só dispara quando a IA achou o cliente bom, o
        atendimento teve nota baixa (&lt;45), não houve venda, há vendedor e ainda não avisou. Os tetos protegem o
        custo por conta. "Quem recebe" vem de <span className="font-medium">Responsáveis</span> (Atendimento = relatório; Alertas = alerta de perda).
      </p>
    </div>
  );
}
