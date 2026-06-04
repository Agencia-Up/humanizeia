/**
 * CampaignDeliveryReport — relatório de confirmação de um disparo em massa.
 *
 * Vive DENTRO da área de Disparo em Massa (aberto pelo card da campanha).
 * Fonte: tabela wa_queue (1 linha por contato da campanha). Mostra, por contato:
 * nome, telefone, dados do cliente (contact_metadata), horário do disparo (sent_at)
 * e a CONFIRMAÇÃO de entrega; e quem falhou (status=failed) com o motivo resumido.
 *
 * Confirmação: o status do envio fica em `status` (sent/failed/pending); a entrega
 * confirmada vem dos timestamps delivered_at / read_at / delivery_confirmed_at.
 *
 * Somente leitura — não altera nada.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  CheckCircle2, Send, XCircle, Clock, RefreshCw, Loader2, Phone, Search, FileBarChart,
} from 'lucide-react';

type Cat = 'entregue' | 'enviado' | 'falhou' | 'pendente';

interface QueueRow {
  id: string;
  phone: string | null;
  contact_name: string | null;
  contact_metadata: Record<string, unknown> | null;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  delivery_confirmed_at: string | null;
}

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');
function fmtSP(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() - SP_OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function fmtPhone(phone?: string | null): string {
  if (!phone) return '—';
  let d = (phone.split('@')[0] || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone.replace(/\D/g, '') || '—';
}
function categorize(r: QueueRow): Cat {
  if (r.status === 'failed') return 'falhou';
  if (r.status === 'sent') {
    return (r.delivered_at || r.read_at || r.delivery_confirmed_at) ? 'entregue' : 'enviado';
  }
  return 'pendente'; // pending / processing / scheduled / paused
}
function clientData(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== 'object') return '';
  return Object.entries(meta)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}

const CAT_META: Record<Cat, { label: string; color: string; badge: string; Icon: any }> = {
  entregue: { label: 'Entregue', color: 'hsl(142, 71%, 45%)', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', Icon: CheckCircle2 },
  enviado: { label: 'Enviado (sem confirmação)', color: 'hsl(217, 91%, 60%)', badge: 'bg-blue-500/15 text-blue-400 border-blue-500/30', Icon: Send },
  falhou: { label: 'Falhou', color: 'hsl(0, 72%, 51%)', badge: 'bg-red-500/15 text-red-400 border-red-500/30', Icon: XCircle },
  pendente: { label: 'Na fila', color: 'hsl(215, 14%, 50%)', badge: 'bg-muted text-muted-foreground border-border', Icon: Clock },
};

export function CampaignDeliveryReport({
  campaignId, campaignName, open, onOpenChange,
}: {
  campaignId: string;
  campaignName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [filter, setFilter] = useState<Cat | 'todos'>('todos');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const { data } = await (supabase as any)
        .from('wa_queue')
        .select('id, phone, contact_name, contact_metadata, status, error_message, sent_at, delivered_at, read_at, delivery_confirmed_at')
        .eq('campaign_id', campaignId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(2000);
      setRows((data || []) as QueueRow[]);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const counts = useMemo(() => {
    const c: Record<Cat, number> = { entregue: 0, enviado: 0, falhou: 0, pendente: 0 };
    for (const r of rows) c[categorize(r)]++;
    return c;
  }, [rows]);

  const pieData = useMemo(
    () => (['entregue', 'enviado', 'falhou', 'pendente'] as Cat[])
      .map((k) => ({ name: CAT_META[k].label, value: counts[k], color: CAT_META[k].color }))
      .filter((d) => d.value > 0),
    [counts],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'todos' && categorize(r) !== filter) return false;
      if (!q) return true;
      return (r.contact_name || '').toLowerCase().includes(q) || (r.phone || '').includes(q);
    });
  }, [rows, filter, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileBarChart className="h-4 w-4 text-primary" />
            Relatório de Disparo — {campaignName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-16 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            {/* Resumo + gráfico */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid grid-cols-2 gap-2 content-start">
                {(['entregue', 'enviado', 'falhou', 'pendente'] as Cat[]).map((k) => {
                  const M = CAT_META[k];
                  return (
                    <button
                      key={k}
                      onClick={() => setFilter(filter === k ? 'todos' : k)}
                      className={`rounded-lg border p-2 text-left transition-colors ${filter === k ? 'border-primary bg-primary/5' : 'border-border/50 hover:bg-muted/40'}`}
                    >
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <M.Icon className="h-3 w-3" /> {M.label}
                      </div>
                      <div className="text-xl font-bold text-foreground">{counts[k]}</div>
                    </button>
                  );
                })}
              </div>
              <div className="h-36">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={34} outerRadius={56} paddingAngle={2}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                        formatter={(v: any, n: any) => [`${v} contato(s)`, n]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Sem dados</div>
                )}
              </div>
            </div>

            {/* Busca + refresh */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="h-8 text-xs pl-8"
                />
              </div>
              {filter !== 'todos' && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFilter('todos')}>Limpar filtro</Button>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={fetchData}>
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar
              </Button>
            </div>

            {/* Lista detalhada */}
            <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-border/50 divide-y divide-border/40">
              {visible.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-10">Nenhum contato nesta visão.</p>
              ) : (
                visible.map((r) => {
                  const cat = categorize(r);
                  const M = CAT_META[cat];
                  const dados = clientData(r.contact_metadata);
                  return (
                    <div key={r.id} className="flex items-start gap-3 px-3 py-2">
                      <div className="w-20 shrink-0">
                        <span className="text-[11px] font-mono text-muted-foreground">{fmtSP(r.sent_at)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{r.contact_name || 'Sem nome'}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Phone className="h-2.5 w-2.5" /> {fmtPhone(r.phone)}
                        </p>
                        {dados && <p className="text-[10px] text-muted-foreground/80 truncate">{dados}</p>}
                        {cat === 'falhou' && r.error_message && (
                          <p className="text-[10px] text-red-400/90 mt-0.5 line-clamp-2">Motivo: {r.error_message}</p>
                        )}
                      </div>
                      <Badge className={`${M.badge} text-[10px] shrink-0`}>{M.label}</Badge>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              {rows.length} contato(s){rows.length >= 2000 ? ' (mostrando os 2000 mais recentes)' : ''}.
              Entrega confirmada vem do WhatsApp; "sem confirmação" não significa erro — pode ainda estar a caminho.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
