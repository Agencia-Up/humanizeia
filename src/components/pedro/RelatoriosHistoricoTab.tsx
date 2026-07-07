import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { FileText, Loader2, Download, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';

// ── Histórico dos relatórios que a IA produziu ───────────────────────────────
// Substitui o antigo "Feedbacks" manual. Lista o que o Cérebro de Feedback gerou
// e enviou (feedback_relatorios), com resumo do dia e download do PDF (via edge
// feedback-relatorio-download, que assina a URL do bucket privado).

interface Relatorio {
  id: string;
  data_ref: string;
  loja: string;
  status: string;
  enviado_em: string | null;
  resumo: any;
}

const QORDER = ['1_alto', '2_medio', '3_baixo', '4_nao_lead', 'sem'] as const;
const QMAP: Record<string, { label: string; cls: string }> = {
  '1_alto':     { label: 'forte',       cls: 'text-emerald-400' },
  '2_medio':    { label: 'bom',         cls: 'text-sky-400' },
  '3_baixo':    { label: 'difícil',     cls: 'text-amber-400' },
  '4_nao_lead': { label: 'não era lead', cls: 'text-rose-400' },
  'sem':        { label: 'sem análise', cls: 'text-muted-foreground' },
};

const STATUS: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  enviado:  { label: 'Enviado',  cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: CheckCircle2 },
  gerado:   { label: 'Gerado',   cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',       icon: Clock },
  pendente: { label: 'Pendente', cls: 'bg-muted text-muted-foreground border-border/40',          icon: Clock },
  falhou:   { label: 'Falhou',   cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30',          icon: AlertTriangle },
};

function fmtData(d: string): string {
  const p = (d || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

export function RelatoriosHistoricoTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Relatorio[]>([]);
  const [baixando, setBaixando] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).from('feedback_relatorios')
        .select('id, data_ref, loja, status, enviado_em, resumo')
        .order('data_ref', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(90);
      if (error) throw error;
      setRows(data || []);
    } catch (e: any) {
      toast({ title: 'Erro ao carregar relatórios', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const baixar = async (id: string) => {
    setBaixando(id);
    try {
      const { data, error } = await supabase.functions.invoke('feedback-relatorio-download', { body: { relatorio_id: id } });
      if (error) throw error;
      if (!data?.ok || !data?.url) throw new Error(data?.error || 'Não foi possível abrir o PDF');
      window.open(data.url, '_blank');
    } catch (e: any) {
      toast({ title: 'Não deu pra baixar', description: e?.message, variant: 'destructive' });
    } finally {
      setBaixando(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
          <FileText className="h-4 w-4 text-blue-400" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground leading-tight">Relatórios de atendimento</h3>
          <p className="text-xs text-muted-foreground">O histórico do que a IA gerou e enviou. Clique pra baixar o PDF de cada dia.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando relatórios...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          Ainda não há relatórios. O primeiro sai automaticamente às 08:30, para quem estiver marcado com “Atendimento” em Configurações → Responsáveis.
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const st = STATUS[r.status] || STATUS.pendente;
            const StIcon = st.icon;
            const resumo = r.resumo || {};
            const porQ = resumo.por_qualidade || {};
            const dests: any[] = Array.isArray(resumo.destinatarios) ? resumo.destinatarios : [];
            return (
              <div key={r.id} className="bg-card border border-border/50 rounded-xl px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{fmtData(r.data_ref)}</span>
                      <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border ${st.cls}`}>
                        <StIcon className="h-3 w-3" /> {st.label}
                      </span>
                      {typeof resumo.leads_analisados === 'number' && (
                        <span className="text-[11px] text-muted-foreground">{resumo.leads_analisados} leads analisados</span>
                      )}
                    </div>
                    {Object.keys(porQ).length > 0 && (
                      <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
                        {QORDER.filter((k) => porQ[k]).map((k) => (
                          <span key={k} className={QMAP[k].cls}>
                            <span className="font-semibold">{porQ[k]}</span> {QMAP[k].label}
                          </span>
                        ))}
                      </div>
                    )}
                    {dests.length > 0 && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        Enviado para: {dests.map((d) => d.nome || d.num).join(', ')}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => baixar(r.id)}
                    disabled={baixando === r.id}
                    className="gap-1.5 shrink-0"
                  >
                    {baixando === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Baixar PDF
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
