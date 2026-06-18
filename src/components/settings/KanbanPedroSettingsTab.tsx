// ============================================================================
// KanbanPedroSettingsTab — Configurações do Kanban do agente PEDRO
// ----------------------------------------------------------------------------
// Igual ao Kanban do Marcos (KanbanSettingsTab), mas sobre ai_crm_pipeline_stages.
// DIFERENÇA: cada etapa tem um `status_key` (o valor que o MOTOR do Pedro usa em
// ai_crm_leads.status_crm). As colunas do motor (is_engine=true) têm nome/cor/ordem
// editáveis, mas NÃO podem ser excluídas nem trocar de status_key (senão reativação,
// classificação e triggers quebram). Colunas novas (is_engine=false) são livres.
//
// Permissões do vendedor: iguais ao Marcos — só adiciona coluna + renomeia colunas
// fora do Painel ao Vivo; cor/tipo/responsável/ativo/ordem/Painel ao Vivo/excluir
// são master-only. Master edita tudo (menos excluir as do motor).
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
import { Loader2, Plus, Trash2, ChevronUp, ChevronDown, KanbanSquare, Save, Eye, EyeOff, Lock } from 'lucide-react';

type Tipo = '' | 'entrada' | 'em_andamento' | 'saida';

interface Row {
  id: string;                      // uuid real ou temp ('new-...') ate salvar
  status_key: string;              // valor de ai_crm_leads.status_crm (imutavel se motor)
  name: string;
  color: string;
  position: number;
  tipo: Tipo;
  ativo: boolean;
  responsavel_padrao_id: string;   // '' = nenhum
  show_in_live: boolean;
  is_engine: boolean;              // coluna do motor — nao exclui, status_key travado
  leads_count: number;
  _isNew?: boolean;
  _dirty?: boolean;
}

interface SellerOpt { id: string; name: string; }

// Colunas padrao do Pedro (espelha PIPELINE_COLUMNS) — usadas como fallback de
// exibicao quando a conta ainda nao tem linhas em ai_crm_pipeline_stages.
const ENGINE_DEFAULTS: Array<{ status_key: string; name: string; color: string }> = [
  { status_key: 'novo',                 name: 'Novo',                 color: '#3B82F6' },
  { status_key: 'inativo',              name: 'Lead Inativo',         color: '#9CA3AF' },
  { status_key: 'carro_nao_disponivel', name: 'Carro não disponível', color: '#EF4444' },
  { status_key: 'em_atendimento',       name: 'Agendamento',          color: '#06B6D4' },
  { status_key: 'negociacao',           name: 'Negociação',           color: '#8B5CF6' },
  { status_key: 'fechado',              name: 'Venda concluída',      color: '#10B981' },
  { status_key: 'perdido',              name: 'Perdido',              color: '#6B7280' },
];

const TIPO_OPTIONS: { value: Tipo; label: string }[] = [
  { value: '', label: '—' },
  { value: 'entrada', label: 'Entrada' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'saida', label: 'Saída' },
];

const selectCls =
  'h-8 w-full rounded-md border border-border/40 bg-background/60 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';

let tempCounter = 0;

export function KanbanPedroSettingsTab() {
  const { user } = useAuth();
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
      // 1. etapas do Pedro do master
      const { data: stagesRaw, error: stErr } = await (supabase as any)
        .from('ai_crm_pipeline_stages')
        .select('id, status_key, name, color, position, tipo, ativo, responsavel_padrao_id, show_in_live, is_engine')
        .eq('user_id', ownerId)
        .order('position', { ascending: true });
      if (stErr) throw stErr;
      let list = (stagesRaw || []) as any[];

      // Conta sem etapas ainda? Mostra os defaults do motor pra editar/salvar (cria as linhas).
      const seededLocally = list.length === 0;
      if (seededLocally) {
        list = ENGINE_DEFAULTS.map((d, i) => ({
          id: `new-${++tempCounter}`,
          status_key: d.status_key, name: d.name, color: d.color, position: i,
          tipo: '', ativo: true, responsavel_padrao_id: null, show_in_live: true, is_engine: true,
        }));
      }

      // 2. contagem de leads por status_crm (= status_key)
      const keys = list.map(s => s.status_key);
      const countsMap = new Map<string, number>();
      if (keys.length) {
        const counts = await Promise.all(keys.map(k =>
          (supabase as any).from('ai_crm_leads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', ownerId).eq('status_crm', k)
            .then((r: any) => ({ k, count: r.count || 0 }))
        ));
        for (const c of counts) countsMap.set(c.k, c.count);
      }

      // 3. vendedores ATIVOS (dedupe por whatsapp_number)
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
        status_key: s.status_key,
        name: s.name,
        color: s.color || '#64748b',
        position: typeof s.position === 'number' ? s.position : i,
        tipo: (s.tipo || '') as Tipo,
        ativo: s.ativo !== false,
        responsavel_padrao_id: s.responsavel_padrao_id || '',
        show_in_live: s.show_in_live !== false,
        is_engine: !!s.is_engine,
        leads_count: countsMap.get(s.status_key) || 0,
        _isNew: seededLocally ? true : undefined,
      })));
      setDeletedIds([]);
    } catch (err: any) {
      toast({ title: 'Erro ao carregar configurações', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ownerId]);

  const patch = (id: string, p: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p, _dirty: true } : r)));

  const addRow = () => {
    const maxPos = rows.reduce((m, r) => Math.max(m, r.position), -1);
    // status_key proprio (custom) — o motor ignora; leads movidos pra ca ficam parados aqui.
    const key = `custom_${Date.now().toString(36)}_${++tempCounter}`;
    setRows(prev => [...prev, {
      id: `new-${tempCounter}`,
      status_key: key,
      name: '', color: '#64748b', position: maxPos + 1,
      tipo: '', ativo: true, responsavel_padrao_id: '',
      // vendedor cria FORA do Painel ao Vivo (e assim consegue nomear a propria coluna)
      show_in_live: !isSeller,
      is_engine: false,
      leads_count: 0, _isNew: true,
    }]);
  };

  const removeRow = (id: string) => {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    if (r.is_engine) {
      toast({ title: 'Coluna do motor', description: 'Essa coluna é usada pelo Pedro pra funcionar — pode renomear, mas não excluir.', variant: 'destructive' });
      return;
    }
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
      if (deletedIds.length) {
        const del = await (supabase as any).from('ai_crm_pipeline_stages')
          .delete().eq('user_id', ownerId).in('id', deletedIds).select('id');
        if (del.error) throw new Error('Falha ao excluir coluna(s): ' + del.error.message);
      }

      const payload = trimmed.map((r, i) => ({
        id: r._isNew ? crypto.randomUUID() : r.id,
        user_id: ownerId,
        status_key: r.status_key,
        name: r.name,
        color: r.color,
        position: i,
        tipo: r.tipo || null,
        ativo: r.ativo,
        responsavel_padrao_id: r.responsavel_padrao_id || null,
        show_in_live: r.show_in_live ?? true,
        is_engine: r.is_engine ?? false,
        updated_at: new Date().toISOString(),
      }));
      const up = await (supabase as any).from('ai_crm_pipeline_stages')
        .upsert(payload, { onConflict: 'id' }).select('id');
      if (up.error) throw new Error('Falha ao salvar configurações: ' + up.error.message);

      queryClient.invalidateQueries({ queryKey: ['pedro-pipeline-stages'] });
      toast({ title: '✅ Configurações salvas', description: 'O board do Pedro reflete as mudanças ao reabrir.' });
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
            <KanbanSquare className="h-4 w-4 text-emerald-400" />
            Configurações do Kanban Pedro
          </CardTitle>
          <CardDescription className="text-xs">
            Configure as colunas do funil do Pedro: ordem, cor, nome, tipo, responsável padrão e ativação.
            As colunas marcadas com <Lock className="inline h-3 w-3 -mt-0.5" /> são usadas pelo Pedro ao vivo
            (follow-up, classificação) — você pode renomear/recolorir, mas não excluir. Clique em
            <strong> Salvar configurações</strong> pra aplicar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSeller && (
            <p className="text-[11px] text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 leading-relaxed">
              Como vendedor você pode <strong>adicionar colunas</strong> e <strong>renomear</strong> as que não estão no Painel ao Vivo. Cor, tipo, responsável padrão, ativação, ordem, Painel ao Vivo e exclusão são só do dono da conta.
            </p>
          )}
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
                  <th className="text-center font-semibold px-2 py-2 w-28">Painel ao Vivo</th>
                  <th className="text-left font-semibold px-2 py-2 w-20">Leads</th>
                  <th className="px-2 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted-foreground py-6 text-sm">
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
                          <button onClick={() => move(r.id, 'up')} disabled={idx === 0 || saving || isSeller}
                            className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed" title={isSeller ? 'Só o dono reordena' : 'Subir'}>
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => move(r.id, 'down')} disabled={idx === rows.length - 1 || saving || isSeller}
                            className="h-3.5 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed" title={isSeller ? 'Só o dono reordena' : 'Descer'}>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>
                    {/* Cor */}
                    <td className="px-2 py-1.5">
                      <input type="color" value={r.color} onChange={e => patch(r.id, { color: e.target.value })} disabled={saving || isSeller}
                        className="h-7 w-8 cursor-pointer rounded border border-border/40 bg-transparent p-0.5 disabled:opacity-50" title={isSeller ? 'Só o dono altera a cor' : r.color} />
                    </td>
                    {/* Nome (+ cadeado se motor) */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {r.is_engine && <Lock className="h-3 w-3 text-muted-foreground shrink-0" title="Coluna do motor do Pedro — pode renomear, não excluir" />}
                        <Input value={r.name} onChange={e => patch(r.id, { name: e.target.value })} disabled={saving || (isSeller && r.show_in_live && !r._isNew)}
                          title={(isSeller && r.show_in_live && !r._isNew) ? 'Coluna do Painel ao Vivo — só o dono pode renomear' : undefined}
                          placeholder="Nome da coluna" className="h-8 text-sm" />
                      </div>
                    </td>
                    {/* Tipo */}
                    <td className="px-2 py-1.5">
                      <select value={r.tipo} onChange={e => patch(r.id, { tipo: e.target.value as Tipo })} disabled={saving || isSeller} title={isSeller ? 'Só o dono define o tipo' : undefined} className={selectCls}>
                        {TIPO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    {/* Responsavel padrao */}
                    <td className="px-2 py-1.5">
                      <select value={r.responsavel_padrao_id} onChange={e => patch(r.id, { responsavel_padrao_id: e.target.value })} disabled={saving || isSeller} title={isSeller ? 'Só o dono define o responsável padrão' : undefined} className={selectCls}>
                        <option value="">— Nenhum —</option>
                        {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        {r.responsavel_padrao_id && !sellers.some(s => s.id === r.responsavel_padrao_id) && (
                          <option value={r.responsavel_padrao_id}>(vendedor inativo)</option>
                        )}
                      </select>
                    </td>
                    {/* Ativo */}
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => toggleAtivo(r.id)} disabled={saving || isSeller}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${r.ativo ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                        title={isSeller ? 'Só o dono ativa/desativa' : (r.ativo ? 'Coluna ativa — clique pra desativar' : 'Coluna inativa — clique pra ativar')}>
                        {r.ativo ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {r.ativo ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    {/* Painel ao Vivo — só master */}
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => patch(r.id, { show_in_live: !r.show_in_live })} disabled={saving || isSeller}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${r.show_in_live ? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                        title={isSeller ? 'Só o dono escolhe o que aparece no Painel ao Vivo' : (r.show_in_live ? 'Aparece no Painel ao Vivo — clique pra esconder' : 'Não aparece no Painel ao Vivo — clique pra mostrar')}>
                        {r.show_in_live ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {r.show_in_live ? 'Mostra' : 'Oculta'}
                      </button>
                    </td>
                    {/* Leads */}
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {r.leads_count} {r.leads_count === 1 ? 'lead' : 'leads'}
                    </td>
                    {/* Excluir */}
                    <td className="px-2 py-1.5 text-right">
                      <button onClick={() => removeRow(r.id)} disabled={saving || r.is_engine || (!r._isNew && r.leads_count > 0) || (isSeller && !r._isNew)}
                        className="h-7 w-7 inline-flex items-center justify-center text-red-400 hover:text-red-300 disabled:opacity-20 disabled:cursor-not-allowed"
                        title={r.is_engine ? 'Coluna do motor — não pode excluir' : ((isSeller && !r._isNew) ? 'Só o dono exclui colunas' : ((!r._isNew && r.leads_count > 0) ? `Mova os ${r.leads_count} lead(s) antes de excluir` : 'Excluir coluna'))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
            <Lock className="inline h-3 w-3 -mt-0.5" /> = coluna usada pelo Pedro ao vivo (renomeia/recolore, não exclui).
            <strong> Tipo</strong> classifica a etapa. <strong>Responsável padrão</strong> é o vendedor sugerido.
            <strong> Ativo</strong> desligado oculta a coluna do board sem apagar leads. Excluir só vale para colunas extras com 0 leads.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
