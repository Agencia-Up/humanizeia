// ============================================================================
// KanbanSettingsTab
// ----------------------------------------------------------------------------
// Gerencia as colunas do Kanban do Marcos (tabela crm_pipeline_stages).
//
// Master only. Mudanças aparecem AUTOMATICAMENTE pros vendedores vinculados
// (vendedor lê stages com user_id = master_id via effectiveUserId).
//
// Funcionalidades:
//   • Lista colunas atuais (ordenadas por position)
//   • Renomear inline
//   • Mover ↑ / ↓ (swap de position com adjacente)
//   • Deletar (apenas se 0 leads na coluna)
//   • Adicionar nova coluna (input nome → INSERT)
// ============================================================================

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Pencil, Check, X, Trash2, ChevronUp, ChevronDown, KanbanSquare } from 'lucide-react';

interface StageRow {
  id: string;
  name: string;
  position: number;
  color: string | null;
  leads_count: number; // calculado via JOIN/COUNT
}

export function KanbanSettingsTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const loadStages = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // 1. Carrega stages do master
      const { data: stagesRaw } = await (supabase as any)
        .from('crm_pipeline_stages')
        .select('id, name, position, color')
        .eq('user_id', user.id)
        .order('position', { ascending: true });
      const stagesList = (stagesRaw || []) as Array<Omit<StageRow, 'leads_count'>>;

      // 2. Conta leads por stage (1 query agrupada)
      const stageIds = stagesList.map(s => s.id);
      let countsMap = new Map<string, number>();
      if (stageIds.length > 0) {
        // PostgREST não tem GROUP BY direto via supabase-js — fazemos N queries head:true (rápidas, usa index)
        const counts = await Promise.all(
          stageIds.map(id =>
            (supabase as any)
              .from('crm_leads')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('stage_id', id)
              .then((r: any) => ({ id, count: r.count || 0 }))
          ),
        );
        for (const c of counts) countsMap.set(c.id, c.count);
      }

      setStages(stagesList.map(s => ({ ...s, leads_count: countsMap.get(s.id) || 0 })));
    } catch (err: any) {
      toast({ title: 'Erro ao carregar colunas', description: err?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const startEdit = (s: StageRow) => {
    setEditingId(s.id);
    setEditName(s.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveRename = async (s: StageRow) => {
    const newNameTrim = editName.trim();
    if (!newNameTrim) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    if (newNameTrim === s.name) {
      cancelEdit();
      return;
    }
    setSavingId(s.id);
    try {
      const { error } = await (supabase as any)
        .from('crm_pipeline_stages')
        .update({ name: newNameTrim })
        .eq('id', s.id);
      if (error) throw error;
      setStages(prev => prev.map(x => x.id === s.id ? { ...x, name: newNameTrim } : x));
      cancelEdit();
      toast({ title: '✅ Coluna renomeada' });
    } catch (err: any) {
      toast({ title: 'Erro ao renomear', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  const handleMove = async (s: StageRow, direction: 'up' | 'down') => {
    const idx = stages.findIndex(x => x.id === s.id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= stages.length) return;
    const other = stages[swapIdx];

    setSavingId(s.id);
    try {
      // Swap positions (2 UPDATEs)
      const [r1, r2] = await Promise.all([
        (supabase as any).from('crm_pipeline_stages').update({ position: other.position }).eq('id', s.id),
        (supabase as any).from('crm_pipeline_stages').update({ position: s.position }).eq('id', other.id),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      // Atualiza local
      setStages(prev => {
        const copy = [...prev];
        const newS = { ...s, position: other.position };
        const newO = { ...other, position: s.position };
        copy[idx] = newO;
        copy[swapIdx] = newS;
        return copy.sort((a, b) => a.position - b.position);
      });
    } catch (err: any) {
      toast({ title: 'Erro ao mover', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (s: StageRow) => {
    if (s.leads_count > 0) {
      toast({ title: 'Coluna não está vazia', description: `Mova os ${s.leads_count} lead(s) pra outra coluna antes de deletar.`, variant: 'destructive' });
      return;
    }
    if (!confirm(`Deletar a coluna "${s.name}"? Esta ação não pode ser desfeita.`)) return;
    setSavingId(s.id);
    try {
      const { error } = await (supabase as any)
        .from('crm_pipeline_stages')
        .delete()
        .eq('id', s.id);
      if (error) throw error;
      setStages(prev => prev.filter(x => x.id !== s.id));
      toast({ title: '🗑️ Coluna deletada' });
    } catch (err: any) {
      toast({ title: 'Erro ao deletar', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingId(null);
    }
  };

  const handleAdd = async () => {
    if (!user?.id) return;
    const nameTrim = newName.trim();
    if (!nameTrim) {
      toast({ title: 'Nome obrigatório', variant: 'destructive' });
      return;
    }
    // Bloqueia nome duplicado (case-insensitive)
    if (stages.some(s => s.name.toLowerCase() === nameTrim.toLowerCase())) {
      toast({ title: 'Já existe uma coluna com esse nome', variant: 'destructive' });
      return;
    }
    setAdding(true);
    try {
      const nextPosition = stages.length > 0 ? Math.max(...stages.map(s => s.position)) + 1 : 0;
      const { data, error } = await (supabase as any)
        .from('crm_pipeline_stages')
        .insert({
          user_id: user.id,
          name: nameTrim,
          position: nextPosition,
          color: '#64748b', // slate-500 — neutro pra coluna nova
          is_default: false,
        })
        .select('id, name, position, color')
        .single();
      if (error) throw error;
      setStages(prev => [...prev, { ...data, leads_count: 0 }]);
      setNewName('');
      toast({ title: '✅ Coluna adicionada' });
    } catch (err: any) {
      toast({ title: 'Erro ao adicionar coluna', description: err?.message, variant: 'destructive' });
    } finally {
      setAdding(false);
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
            Colunas do Kanban Marcos
          </CardTitle>
          <CardDescription className="text-xs">
            Personalize as etapas do funil de vendas. Mudanças aparecem automaticamente para todos os vendedores vinculados a esta conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Lista */}
          {stages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma coluna cadastrada. Adicione a primeira abaixo.
            </p>
          ) : (
            <div className="space-y-1.5">
              {stages.map((s, idx) => {
                const isEditing = editingId === s.id;
                const isSaving = savingId === s.id;
                const canDelete = s.leads_count === 0;
                const canMoveUp = idx > 0;
                const canMoveDown = idx < stages.length - 1;
                return (
                  <div key={s.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-3 py-2">
                    {/* Posição */}
                    <span className="text-[10px] font-bold text-muted-foreground w-5 text-center tabular-nums">
                      {idx + 1}
                    </span>

                    {/* Move up/down */}
                    <div className="flex flex-col gap-0">
                      <button
                        onClick={() => handleMove(s, 'up')}
                        disabled={!canMoveUp || isSaving}
                        className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Mover pra cima"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleMove(s, 'down')}
                        disabled={!canMoveDown || isSaving}
                        className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                        title="Mover pra baixo"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Indicador de cor */}
                    <span
                      className="h-3 w-3 rounded-sm border border-border/40"
                      style={{ background: s.color || '#64748b' }}
                      title={s.color || ''}
                    />

                    {/* Nome (edit ou view) */}
                    {isEditing ? (
                      <>
                        <Input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveRename(s);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          className="h-8 text-sm flex-1"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" onClick={() => handleSaveRename(s)} disabled={isSaving} className="h-8 w-8 p-0 text-emerald-400 hover:text-emerald-300">
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={isSaving} className="h-8 w-8 p-0 text-muted-foreground">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-medium">{s.name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {s.leads_count} {s.leads_count === 1 ? 'lead' : 'leads'}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(s)} disabled={isSaving} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title="Renomear">
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(s)}
                          disabled={isSaving || !canDelete}
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-300 disabled:opacity-20 disabled:cursor-not-allowed"
                          title={canDelete ? 'Deletar coluna' : `Mova os ${s.leads_count} lead(s) antes de deletar`}
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Adicionar */}
          <div className="rounded-md border border-dashed border-border/50 bg-background/20 p-3">
            <Label className="text-xs text-muted-foreground mb-1.5 block">Adicionar nova coluna</Label>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Nome da coluna (ex: Em Análise)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
                className="h-8 text-sm flex-1"
                disabled={adding}
              />
              <Button size="sm" onClick={handleAdd} disabled={adding || !newName.trim()} className="h-8 text-xs gap-1.5">
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Adicionar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 italic">
              Aparece no Kanban Marcos como última coluna. Você pode mover depois com ↑ / ↓.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
