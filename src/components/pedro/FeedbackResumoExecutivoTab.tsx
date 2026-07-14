import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle, BarChart3, CheckCircle2, ClipboardList, FileText, Loader2,
  PackageSearch, ShieldCheck, Sparkles, Target, TrendingUp, Users,
} from 'lucide-react';

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
  oportunidades_perdidas: any[] | null;
  houve_venda: string | null;
  vehicle_interest: string | null;
  confianca_analise?: string | null; // Fase 3 (só leitura)
  motivo_confianca?: string | null;
}

interface Produto {
  produto: string;
  total: number;
  qualificados: number;
  pouco_qualificados: number;
  ruins: number;
  nao_lead: number;
  pct_qualificado: number;
}

interface Rollup {
  vendedor_id: string;
  periodo: string;
  conversas: number;
  score_medio: number | null;
  notas_por_dimensao: Record<string, number>;
  taxa_conflito_rotulagem: number | null;
}

interface Relatorio {
  id: string;
  data_ref: string;
  status: string;
  resumo: any;
}

interface FeedbackHealth {
  ok?: boolean;
  analises?: {
    total?: number;
    concluidas?: number;
    falharam?: number;
    processando?: number;
    pedro?: number;
    marcos?: number;
  };
  transcricoes?: {
    total?: number;
    ok?: number;
    falhas?: number;
  };
  jobs?: {
    total?: number;
    falhas?: number;
  };
  relatorios?: {
    total?: number;
    falhas?: number;
    ultimo_envio?: string | null;
  };
  pendentes_estimados?: number;
}

const DIMS: Record<string, string> = {
  A: 'conexao',
  B1: 'situacao',
  B2: 'problema',
  B3: 'solucao',
  B4: 'consequencia',
  B5: 'qualificacao',
  C: 'apresentacao',
  D: 'compromisso',
  E1: 'tom',
  E2: 'escuta',
  E3: 'objecao',
  E4: 'ritmo',
};

function score0(c: Conversa): number {
  return Number(c.score) || 0;
}

function potDe(c: Conversa): 'forte' | 'bom' | 'dificil' | 'nao' | 'sem' {
  if (c.qualidade_lead === '1_alto') return 'forte';
  if (c.qualidade_lead === '2_medio') return 'bom';
  if (c.qualidade_lead === '3_baixo') return 'dificil';
  if (c.qualidade_lead === '4_nao_lead') return 'nao';
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

function isBom(c: Conversa): boolean {
  const p = potDe(c);
  return p === 'forte' || p === 'bom';
}

function isVenda(c: Conversa): boolean {
  return c.houve_venda === 'true';
}

function riscoDaConversa(c: Conversa): number {
  let r = 0;
  if (potDe(c) === 'forte') r += 45;
  else if (potDe(c) === 'bom') r += 30;
  if (score0(c) < 45) r += 35;
  if (score0(c) < 25) r += 15;
  if (!isVenda(c)) r += 10;
  if (Array.isArray(c.oportunidades_perdidas) && c.oportunidades_perdidas.length) r += 10;
  const riscoLLM = String(c.risco_perda || '').toLowerCase();
  if (riscoLLM === 'alto') r += 25;
  if (riscoLLM === 'medio') r += 10;
  return r;
}

function textoOportunidade(c?: Conversa | null): string {
  if (!c) return 'Sem conversa critica suficiente para destacar agora.';
  if (c.evidencia_principal) return c.evidencia_principal;
  const ops = Array.isArray(c.oportunidades_perdidas) ? c.oportunidades_perdidas : [];
  const primeira = ops
    .map((op: any) => (typeof op === 'string' ? op : op?.texto || op?.trecho || op?.resumo || ''))
    .filter(Boolean)[0];
  return primeira || c.resumo_executivo || c.frase_coaching || 'Abrir a conversa e revisar a abordagem usada com este lead.';
}

function textoAcao(c?: Conversa | null): string {
  return c?.acao_gestor
    || c?.acao_vendedor
    || c?.proxima_pergunta_ideal
    || 'Abrir a conversa, alinhar abordagem e registrar o aprendizado para o vendedor.';
}

function classeScore(score: number | null): string {
  const s = Number(score) || 0;
  if (s >= 70) return 'text-emerald-300';
  if (s >= 50) return 'text-sky-300';
  if (s >= 30) return 'text-amber-300';
  return 'text-rose-300';
}

function nivelConfianca(qtd: number, parcial = false): { label: string; cls: string; desc: string } {
  if (qtd >= 30 && !parcial) return {
    label: 'Confianca alta',
    cls: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    desc: 'Ha volume suficiente para orientar decisao.',
  };
  if (qtd >= 10) return {
    label: 'Confianca media',
    cls: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
    desc: 'Bom para direcionar, mas ainda vale conferir os detalhes.',
  };
  return {
    label: 'Confianca baixa',
    cls: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    desc: 'Pouco volume. Use como sinal inicial, nao como conclusao final.',
  };
}

export function FeedbackResumoExecutivoTab() {
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [rollup, setRollup] = useState<Rollup[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [health, setHealth] = useState<FeedbackHealth | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [conv, prod, nepq, team, hist, status] = await Promise.all([
        (supabase as any).rpc('feedback_relatorio_por_vendedor'),
        (supabase as any).rpc('feedback_produtos_qualidade', { p_dias: 30 }),
        (supabase as any).rpc('feedback_rollup_por_vendedor'),
        (supabase as any).from('ai_team_members').select('id, name'),
        (supabase as any).from('feedback_relatorios').select('id, data_ref, status, resumo').order('data_ref', { ascending: false }).limit(7),
        (supabase as any).rpc('feedback_status_operacional'),
      ]);
      if (conv.error) throw conv.error;
      if (prod.error) throw prod.error;
      if (nepq.error) throw nepq.error;
      if (hist.error) throw hist.error;
      const map: Record<string, string> = {};
      for (const m of (team.data || [])) map[m.id] = m.name;
      setConversas(Array.isArray(conv.data) ? conv.data.filter((c: Conversa) => c.vendedor_id) : []);
      setProdutos(Array.isArray(prod.data) ? prod.data : []);
      setRollup(Array.isArray(nepq.data) ? nepq.data : []);
      setNomes(map);
      setRelatorios(hist.data || []);
      setHealth(status?.error ? null : (status?.data || null));
    } catch (e: any) {
      setErro(e?.message || 'Nao foi possivel carregar o resumo executivo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const leitura = useMemo(() => {
    const leadsBons = conversas.filter(isBom);
    const emRisco = leadsBons.filter((c) => score0(c) < 45 && !isVenda(c));
    const piorRisco = [...emRisco].sort((a, b) => riscoDaConversa(b) - riscoDaConversa(a))[0] || null;

    const porVendedor = new Map<string, Conversa[]>();
    for (const c of conversas) {
      const id = String(c.vendedor_id || '');
      if (!id) continue;
      (porVendedor.get(id) || porVendedor.set(id, []).get(id)!).push(c);
    }
    const vendedores = [...porVendedor.entries()].map(([id, cs]) => {
      const bons = cs.filter(isBom).length;
      const risco = cs.filter((c) => isBom(c) && score0(c) < 45 && !isVenda(c)).length;
      const media = cs.length ? Math.round(cs.reduce((s, c) => s + score0(c), 0) / cs.length) : 0;
      return { id, nome: cs[0]?.vendedor_nome || nomes[id] || '(vendedor)', conversas: cs.length, bons, risco, media };
    });
    const treinar = [...vendedores].sort((a, b) => (b.risco - a.risco) || (a.media - b.media))[0] || null;
    const elogiar = [...vendedores].filter((v) => v.conversas >= 2).sort((a, b) => b.media - a.media)[0] || null;

    const melhorProduto = [...produtos]
      .filter((p) => Number(p.total) > 0)
      .sort((a, b) => (b.qualificados - a.qualificados) || (b.pct_qualificado - a.pct_qualificado))[0] || null;
    const produtoRisco = [...produtos]
      .filter((p) => Number(p.total) >= 2)
      .sort((a, b) => (b.ruins + b.nao_lead) - (a.ruins + a.nao_lead))[0] || null;

    const periodo = rollup.map((r) => r.periodo).sort().slice(-1)[0] || '';
    const rollMes = rollup.filter((r) => r.periodo === periodo);
    const piorNepq = [...rollMes].filter((r) => r.score_medio != null).sort((a, b) => Number(a.score_medio) - Number(b.score_medio))[0] || null;
    const fraca = piorNepq
      ? Object.entries(piorNepq.notas_por_dimensao || {}).sort((a, b) => Number(a[1]) - Number(b[1]))[0]
      : null;

    const ultimoRelatorio = relatorios[0] || null;
    const relatoriosComFalha = relatorios.filter((r) => r.status === 'falhou').length;
    const confianca = nivelConfianca(conversas.length, produtos.length === 0);

    // Fase 3 — quantas análises têm confiança calculada e quantas são parciais.
    // NULL (análise antiga sem cálculo) não entra na conta.
    const comConfianca = conversas.filter((c) => !!c.confianca_analise);
    const analisesParciais = comConfianca.filter((c) => c.confianca_analise === 'media' || c.confianca_analise === 'baixa').length;

    return {
      total: conversas.length,
      leadsBons: leadsBons.length,
      emRisco: emRisco.length,
      piorRisco,
      treinar,
      elogiar,
      melhorProduto,
      produtoRisco,
      piorNepq,
      fraca,
      ultimoRelatorio,
      relatoriosComFalha,
      confianca,
      analisesComConfianca: comConfianca.length,
      analisesParciais,
    };
  }, [conversas, nomes, produtos, relatorios, rollup]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Montando leitura executiva...
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-rose-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
          <div>
            <div className="font-semibold">Nao consegui montar o resumo executivo.</div>
            <p className="mt-1 text-rose-100/80">{erro}</p>
            <button onClick={load} className="mt-3 rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-semibold text-rose-50 hover:bg-rose-500/10">
              Tentar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  const prioridade = leitura.piorRisco;
  const vendedorTreino = leitura.treinar;
  const dimFraca = leitura.fraca ? DIMS[leitura.fraca[0]] || leitura.fraca[0] : 'sem dimensao';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/12 via-card to-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Leitura em 30 segundos
              </div>
              <h3 className="text-xl font-semibold text-foreground">O que merece sua atencao agora</h3>
              <p className="max-w-2xl text-sm text-muted-foreground">
                {prioridade
                  ? `Existe lead bom em risco. Comece por ${prioridade.lead_name || 'este lead'} com ${prioridade.vendedor_nome || 'o vendedor responsavel'}.`
                  : leitura.total
                    ? 'Nao encontrei perda critica neste recorte. Use os cards abaixo para treinar consistencia.'
                    : 'Ainda nao ha conversas analisadas suficientes para uma decisao segura.'}
              </p>
              {leitura.analisesParciais > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-500 dark:text-amber-300/90">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {leitura.analisesParciais} de {leitura.analisesComConfianca} análises recentes são parciais — leia com cautela (faltou parte da conversa ou do áudio).
                </p>
              )}
            </div>
            <div className={`rounded-xl border px-3 py-2 text-xs ${leitura.confianca.cls}`}>
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" /> {leitura.confianca.label}
              </div>
              <p className="mt-1 opacity-85">{leitura.confianca.desc}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <KpiCard icon={ClipboardList} label="Conversas analisadas" value={leitura.total} tone="default" />
          <KpiCard icon={Target} label="Leads bons" value={leitura.leadsBons} tone="blue" />
          <KpiCard icon={AlertTriangle} label="Bons em risco" value={leitura.emRisco} tone={leitura.emRisco ? 'red' : 'green'} />
          <KpiCard icon={FileText} label="Falhas em relatorio" value={leitura.relatoriosComFalha} tone={leitura.relatoriosComFalha ? 'red' : 'green'} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <DecisionCard
          icon={AlertTriangle}
          title="Corrigir primeiro"
          tone="red"
          headline={prioridade ? `${prioridade.lead_name || 'Lead'} esta em risco` : 'Sem perda critica agora'}
          body={prioridade
            ? `${prioridade.vendedor_nome || 'Vendedor'} pegou um lead com perfil de compra, mas a conversa ficou com nota ${score0(prioridade)}.`
            : 'Continue monitorando os atendimentos de baixa nota para evitar repeticao.'}
          proof={textoOportunidade(prioridade)}
          action={prioridade ? textoAcao(prioridade) : 'Manter acompanhamento diario.'}
        />
        <DecisionCard
          icon={Users}
          title="Treinar vendedor"
          tone="amber"
          headline={vendedorTreino ? vendedorTreino.nome : 'Sem vendedor critico'}
          body={vendedorTreino
            ? `${vendedorTreino.risco} conversa(s) com risco e media ${vendedorTreino.media}.`
            : 'Ainda nao ha volume suficiente para apontar um vendedor.'}
          proof={leitura.piorNepq ? `Ponto NEPQ mais fraco: ${dimFraca}.` : 'Use a aba Qualidade para abrir as dimensoes quando houver dados.'}
          action={prioridade?.acao_vendedor || prioridade?.proxima_pergunta_ideal || 'Treinar uma habilidade por vez: escuta, confirmacao de dados e proximo passo.'}
        />
        <DecisionCard
          icon={PackageSearch}
          title="Produto e campanha"
          tone="blue"
          headline={leitura.melhorProduto?.produto || 'Sem produto dominante'}
          body={leitura.melhorProduto
            ? `${leitura.melhorProduto.qualificados} lead(s) qualificado(s) em ${leitura.melhorProduto.total} conversa(s).`
            : 'Quando houver volume, aqui aparece o produto/campanha mais promissor.'}
          proof={leitura.produtoRisco
            ? `Atencao em ${leitura.produtoRisco.produto}: ${leitura.produtoRisco.ruins + leitura.produtoRisco.nao_lead} lead(s) fraco(s)/sem perfil.`
            : 'Sem alerta de produto com volume suficiente.'}
          action="Conferir se o anuncio, estoque e atendimento estao falando do mesmo carro."
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            O que repetir
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {leitura.elogiar
              ? `${leitura.elogiar.nome} teve a melhor media entre vendedores com volume minimo (${leitura.elogiar.media}). Use uma conversa boa dele como exemplo para o time.`
              : 'Ainda falta volume minimo para apontar um exemplo positivo com seguranca.'}
          </p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" />
            Saude da rotina
          </div>
          <HealthSummary health={health} fallback={leitura.ultimoRelatorio
            ? `Ultimo relatorio: ${leitura.ultimoRelatorio.data_ref} com status "${leitura.ultimoRelatorio.status}".`
            : 'Nenhum relatorio diario encontrado ainda. Verifique se a rotina de feedback esta ativa para esta conta.'}
          />
        </div>
      </div>
    </div>
  );
}

function HealthSummary({ health, fallback }: { health: FeedbackHealth | null; fallback: string }) {
  if (!health?.ok) {
    return <p className="mt-2 text-sm text-muted-foreground">{fallback}</p>;
  }

  const falhas = Number(health.analises?.falharam || 0)
    + Number(health.transcricoes?.falhas || 0)
    + Number(health.jobs?.falhas || 0)
    + Number(health.relatorios?.falhas || 0);

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-4">
      <MiniHealth label="Analises" value={Number(health.analises?.concluidas || 0)} hint={`${Number(health.analises?.pedro || 0)} Pedro / ${Number(health.analises?.marcos || 0)} Marcos`} />
      <MiniHealth label="Audios" value={Number(health.transcricoes?.ok || 0)} hint={`${Number(health.transcricoes?.falhas || 0)} falhas`} warn={Number(health.transcricoes?.falhas || 0) > 0} />
      <MiniHealth label="Pendentes" value={Number(health.pendentes_estimados || 0)} hint="para analisar" warn={Number(health.pendentes_estimados || 0) > 10} />
      <MiniHealth label="Alertas" value={falhas} hint="ultimos 7 dias" warn={falhas > 0} />
    </div>
  );
}

function MiniHealth({ label, value, hint, warn = false }: { label: string; value: number; hint: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${warn ? 'border-amber-500/25 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${warn ? 'text-amber-200' : 'text-emerald-200'}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, tone }: {
  icon: typeof ClipboardList;
  label: string;
  value: number;
  tone: 'default' | 'blue' | 'green' | 'red';
}) {
  const cls = {
    default: 'border-border/60 bg-card text-foreground',
    blue: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    red: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-[11px] opacity-80">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function DecisionCard({ icon: Icon, title, headline, body, proof, action, tone }: {
  icon: typeof AlertTriangle;
  title: string;
  headline: string;
  body: string;
  proof: string;
  action: string;
  tone: 'red' | 'amber' | 'blue';
}) {
  const styles = {
    red: {
      wrap: 'border-rose-500/25 bg-rose-500/10',
      icon: 'text-rose-300',
      chip: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
    },
    amber: {
      wrap: 'border-amber-500/25 bg-amber-500/10',
      icon: 'text-amber-300',
      chip: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    },
    blue: {
      wrap: 'border-sky-500/25 bg-sky-500/10',
      icon: 'text-sky-300',
      chip: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
    },
  }[tone];
  return (
    <div className={`rounded-2xl border p-4 ${styles.wrap}`}>
      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles.chip}`}>
        <Icon className={`h-3.5 w-3.5 ${styles.icon}`} />
        {title}
      </div>
      <h4 className="mt-3 text-base font-semibold text-foreground">{headline}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <div className="mt-3 rounded-xl border border-border/50 bg-background/35 p-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5" /> Prova
        </div>
        <p className="mt-1 text-xs text-foreground/85">{proof}</p>
      </div>
      <div className="mt-3 flex items-start gap-2 text-xs text-foreground/85">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
        <span>{action}</span>
      </div>
    </div>
  );
}
