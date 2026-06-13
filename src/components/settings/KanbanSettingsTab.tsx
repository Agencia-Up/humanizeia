// ============================================================================
// KanbanSettingsTab — Tabela de Configuracoes do Kanban do Marcos
// ----------------------------------------------------------------------------
// MELHORIA 2 (spec 29/05/2026). Tabela editavel das colunas do Kanban.
//
// DECISAO (aprovada): estende crm_pipeline_stages (fonte de verdade do board)
// em vez de criar a tabela kanban_configuracoes do spec — assim as mudancas
// refletem imediatamente no board (useFluxCRM), sem migrar dados.
//
// Edicao em LOTE: o master altera varias linhas e clica "Salvar configuracoes".
// So entao persiste (1 upsert atomico + deletes), e o board reflete via
// invalidacao da query ['crm-stages'] do react-query.
//
// Master only. Campos por coluna (linha da tabela):
//   Ordem (↑/↓)        -> position        Cor               -> color
//   Nome               -> name            Tipo              -> tipo (entrada|em_andamento|saida)
//   Responsavel padrao -> responsavel_padrao_id (ai_team_members.id)
//   Ativo (toggle)     -> ativo (inativo some do board, sem apagar leads)
//   Excluir            -> so se 0 leads na coluna
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, KanbanSquare, Save, Eye, EyeOff } from 'lucide-react';

type Tipo = '' | 'entrada' | 'em_andamento' | 'saida';

interface Row {
  id: string;                      // uuid real ou temp ('new-...') ate salvar
  name: string;
  color: string;
  position: number;
  tipo: Tipo;
  ativo: boolean;
  responsavel_padrao_id: string;   // '' = nenhum
  is_default: boolean;
  leads_count: number;
  _isNew?: boolean;
  _dirty?: boolean;
}

interface SellerOpt { id: string; name: string; }

const TIPO_OPTIONS: { value: Tipo; label: string }[] = [
  { value: '', label: '—' },
  { value: 'entrada', label: 'Entrada' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'saida', label: 'Saída' },
];

const selectCls =
  'h-8 w-full rounded-md border border-border/40 bg-background/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';

let tempCounter = 0;

export function KanbanSettingsTab() {
  const { user } = useAuth();
  // Dono efetivo das ETAPAS (são do master e compartilhadas): master usa o próprio
  // uid; vendedor usa o uid do MASTER. Sem isso, a coluna criada por um vendedor
  // caía sob o uid dele e não aparecia no CRM (que lê as etapas do master).
  const { isSeller, masterUserId, loading: sellerLoading } = useSellerProfile(user?.id);
  const ownerId = sellerLoading ? null : (isSeller ? masterUserId : (user?.id || null));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [sellers, setSellers] = useState<SellerOpt[]>([]);

  const dirty = useMemo(
    () => deletedIds.length > 0 || rows.some(r => r._isNew || r._dirty),
    [rows, deletedIds],
  );

  const load = async () => {
    if (!ownerId) return;
    setLoading(true);
    try {
      // 1. stages do master (TODAS — inclui inativas, que somem do board mas
      //    permanecem aqui pra reativar)
      const { data: stagesRaw, error: stErr } = await (supabase as any)
        .from('crm_pipeline_stages')
        .select('id, name, color, position, tipo, ativo, responsavel_padrao_id, is_default')
        .eq('user_id', ownerId)
        .order('position', { ascending: true });
      if (stErr) throw stErr;
      const list = (stagesRaw || []) as any[];

      // 2. contagem de leads por stage (N queries head:true — usa index, rapido)
      const ids = list.map(s => s.id);
      const countsMap = new Map<string, number>();
      if (ids.length) {
        const counts = await Promise.all(ids.map(id =>
          (supabase as any).from('crm_leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', ownerId).eq('stage_id', id)
            .then((r: any) => ({ id, count: r.count || 0 }))
        ));
        for (const c of counts) countsMap.set(c.id, c.count);
      }

      // 3. vendedores ATIVOS no sistema (dedupe por whatsapp_number — 1 vendedor
      //    tem 1 row por agente). Guarda 1 id representativo.
      const { data: sellersRaw } = await (supabase as any)
        .from('ai_team_members')
        .select('id, name, whatsapp_number, active_in_system')
        .eq('user_id', ownerId)
        .eq('active_in_system', true);
      const seenWa = new Map<string, SellerOpt>();
      for (const s of (sellersRaw || [])) {
        const key = s.whatsapp_number || s.id;
        if (!seenWa.has(key)) seenWa.set(key, { id: s.id, name: s.name || s.whatsapp_number || 'Vendedor' });
      }
      setSellers([...seenWa.values()].sort((a, b) => a.name.localeCompare(b.name)));

      setRows(list.map((s, i) => ({
        id: s.id,
        name: s.name,
        color: s.color || '#64748b',
        position: typeof s.position === 'number' ? s.position : i,
        tipo: (s.tipo || '') as Tipo,
        ativo: s.ativo !== false,
        responsavel_padrao_id: s.responsavel_padrao_id || '',
        is_default: !!s.is_default,
        leads_count: countsMap.get(s.id) || 0,
      })));
      setDeletedIds([]);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar configurações', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ownerId]);

  // ── edicao LOCAL (nao persiste ate "Salvar configuracoes") ────────────────
  const patch = (id: string, p: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p, _dirty: true } : r)));

  const addRow = () => {
    const maxPos = rows.reduce((m, r) => Math.max(m, r.position), -1);
    setRows(prev => [...prev, {
      id: `new-${++tempCounter}`,
      name: '', color: '#64748b', position: maxPos + 1,
      tipo: '', ativo: true, responsavel_padrao_id: '', is_default: false,
      leads_count: 0, _isNew: true,
    }]);
  };

  const removeRow = (id: string) => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    if (!r._isNew && r.leads_count > 0) {
      toast({ title: 'Coluna não está vazia', description: `Mova os ${r.leads_count} lead(s) pra outra coluna antes de excluir.`, variant: 'destructive' });
      return;
    }
    if (!r._isNew) setDeletedIds(prev => [...prev, id]);
    setRows(prev => prev.filter(x => x.id !== id));
  };

  const move = (id: string, dir: 'up' | 'down') => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      const swap = dir === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[swap]] = [copy[swap], copy[idx]];
      copy[idx] = { ...copy[idx], _dirty: true };
      copy[swap] = { ...copy[swap], _dirty: true };
      return copy;
    });
  };

  const toggleAtivo = (id: string) => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    if (r.ativo && r.leads_count > 0) {
      toast({ title: 'Coluna será ocultada', description: `${r.leads_count} lead(s) ficarão ocultos no board até reativar (nada é apagado).` });
    }
    patch(id, { ativo: !r.ativo });
  };

  // ── persistencia em LOTE (atomica) ────────────────────────────────────────
  const saveAll = async () => {
    if (!ownerId) return;
    const trimmed = rows.map(r => ({ ...r, name: r.name.trim() }));
    if (trimmed.some(r => !r.name)) {
      toast({ title: 'Toda coluna precisa de um nome', variant: 'destructive' });
      return;
    }
    const lower = trimmed.map(r => r.name.toLowerCase());
    const dupIdx = lower.findIndex((n, i) => lower.indexOf(n) !== i);
    if (dupIdx >= 0) {
      toast({ title: 'Nome de coluna duplicado', description: `Existe mais de uma coluna chamada "${trimmed[dupIdx].name}".`, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // 1. excluir colunas removidas (a UI ja garante 0 leads)
      if (deletedIds.length) {
        const del = await (supabase as any).from('crm_pipeline_stages')
          .delete().eq('user_id', ownerId).in('id', deletedIds).select('id');
        if (del.error) throw new Error('Falha ao excluir coluna(s): ' + del.error.message);
      }

      // 2. upsert ATOMICO de todas as linhas. position = indice (contiguo 0..n-1).
      //    uuid client-side pras novas; onConflict 'id' atualiza as existentes.
      //    Atomico: se algo violar o unique (user_id,name), nada e gravado.
      const nowIso = new Date().toISOString();
      const payload = trimmed.map((r, i) => ({
        id: r._isNew ? crypto.randomUUID() : r.id,
        user_id: ownerId,
        name: r.name,
        color: r.color,
        position: i,
        tipo: r.tipo || null,
        ativo: r.ativo,
        responsavel_padrao_id: r.responsavel_padrao_id || null,
        is_default: r.is_default ?? false,
        updated_at: nowIso,
      }));
      const up = await (supabase as any).from('crm_pipeline_stages')
        .upsert(payload, { onConflict: 'id' }).select('id');
      if (up.error) throw new Error('Falha ao salvar configurações: ' + up.error.message);

      // 3. board reflete imediatamente (useFluxCRM usa ['crm-stages', uid])
      queryClient.invalidateQueries({ queryKey: ['crm-stages'] });
      toast({ title: '✅ Configurações salvas', description: 'O board do Kanban já reflete as mudanças.' });
      await load();
    } catch (err: any) {
      toast({ title: 'Erro ao salvar configurações', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KanbanSquare className="h-4 w-4 text-purple-400" />
            Configurações do Kanban Marcos
          </CardTitle>
          <CardDescription className="text-xs">
            Configure as colunas do funil: ordem, cor, nome, tipo, responsável padrão e ativação.
            Clique em <strong>Salvar configurações</strong> pra aplicar — as mudanças refletem
            imediatamente no board, inclusive para os vendedores vinculados a esta conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tabela de configuracoes */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-semibold px-2 py-2 w-16">Ordem</th>
                  <th className="text-left font-semibold px-2 py-2 w-12">Cor</th>
                  <th className="text-left font-semibold px-2 py-2 min-w-[150px]">Nome</th>
                  <th className="text-left font-semibold px-2 py-2 w-36">Tipo</th>
                  <th className="text-left font-semibold px-2 py-2 min-w-[150px]">Responsável padrão</th>
                  <th className="text-center font-semibold px-2 py-2 w-24">Ativo</th>
                  <th className="text-left font-semibold px-2 py-2 w-20">Leads</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted-foreground py-6 text-sm">
                      Nenhuma coluna cadastrada. Adicione a primeira abaixo.
                    </td>
                  </tr>
                ) : rows.map((r, idx) => (
                  <tr key={r.id} className={`border-t border-border/30 ${!r.ativo ? 'opacity-50' : ''}`}>
                    {/* Ordem */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold text-muted-foreground w-4 text-center tabular-nums">{idx + 1}</span>
                        <div className="flex flex-col">
                          <button onClick={() => move(r.id, 'up')} disabled={idx === 0 || saving}
                            className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed" title="Subir">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => move(r.id, 'down')} disabled={idx === rows.length - 1 || saving}
                            className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed" title="Descer">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>
                    {/* Cor */}
                    <td className="px-2 py-1.5">
                      <input type="color" value={r.color} onChange={e => patch(r.id, { color: e.target.value })} disabled={saving}
                        className="h-7 w-8 cursor-pointer rounded border border-border/40 bg-transparent p-0.5 disabled:opacity-50" title={r.color} />
                    </td>
                    {/* Nome */}
                    <td className="px-2 py-1.5">
                      <Input value={r.name} onChange={e => patch(r.id, { name: e.target.value })} disabled={saving}
                        placeholder="Nome da coluna" className="h-8 text-sm" />
                    </td>
                    {/* Tipo */}
                    <td className="px-2 py-1.5">
                      <select value={r.tipo} onChange={e => patch(r.id, { tipo: e.target.value as Tipo })} disabled={saving} className={selectCls}>
                        {TIPO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    {/* Responsavel padrao */}
                    <td className="px-2 py-1.5">
                      <select value={r.responsavel_padrao_id} onChange={e => patch(r.id, { responsavel_padrao_id: e.target.value })} disabled={saving} className={selectCls}>
                        <option value="">— Nenhum —</option>
                        {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        {r.responsavel_padrao_id && !sellers.some(s => s.id === r.responsavel_padrao_id) && (
                          <option value={r.responsavel_padrao_id}>(vendedor inativo)</option>
                        )}
                      </select>
                    </td>
                    {/* Ativo */}
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleAtivo(r.id)} disabled={saving}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${r.ativo ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                        title={r.ativo ? 'Coluna ativa — clique pra desativar (some do board)' : 'Coluna inativa — clique pra ativar'}>
                        {r.ativo ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {r.ativo ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    {/* Leads */}
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {r.leads_count} {r.leads_count === 1 ? 'lead' : 'leads'}
                    </td>
                    {/* Excluir */}
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeRow(r.id)} disabled={saving || (!r._isNew && r.leads_count > 0)}
                        className="h-7 w-7 inline-flex items-center justify-center text-red-400 hover:text-red-300 disabled:opacity-20 disabled:cursor-not-allowed"
                        title={(!r._isNew && r.leads_count > 0) ? `Mova os ${r.leads_count} lead(s) antes de excluir` : 'Excluir coluna'}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Adicionar + Salvar */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <Button variant="outline" size="sm" onClick={addRow} disabled={saving} className="h-8 text-xs gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Adicionar coluna
            </Button>
            <div className="flex items-center gap-3">
              {dirty && <span className="text-[11px] text-amber-400">Alterações não salvas</span>}
              <Button size="sm" onClick={saveAll} disabled={saving || !dirty} className="h-8 text-xs gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar configurações
              </Button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground italic leading-relaxed">
            <strong>Tipo</strong> classifica a etapa (entrada / em andamento / saída).
            <strong> Responsável padrão</strong> é o vendedor sugerido para a coluna.
            <strong> Ativo</strong> desligado oculta a coluna do board, sem apagar os leads — basta reativar.
            Excluir só é permitido quando a coluna está com 0 leads.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
