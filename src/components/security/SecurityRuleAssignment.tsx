// ============================================================================
// SecurityRuleAssignment — a quem o perfil se aplica (FASE 3)
// Obs: a plataforma não distingue "vendedor" de "colaborador" hoje; usamos uma
// lista única de membros vinculados (target_type fica preparado pra separar).
// ============================================================================
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Users, UserCheck } from 'lucide-react';
import type { AssignmentTargetType } from '@/types/securityRules';
import type { TeamMember } from '@/hooks/useSecurityRules';

export function SecurityRuleAssignment({
  members, initial, saving, onSave, onSkip,
}: {
  members: TeamMember[];
  initial?: { target_type: AssignmentTargetType; target_member_id: string | null }[];
  saving?: boolean;
  onSave: (target_type: AssignmentTargetType, member_ids: string[]) => void;
  onSkip: () => void;
}) {
  const startAll = !initial || initial.length === 0 || initial.some((a) => a.target_type === 'all');
  const [mode, setMode] = useState<'all' | 'specific'>(startAll ? 'all' : 'specific');
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set((initial || []).map((a) => a.target_member_id).filter(Boolean) as string[]),
  );
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const count = selected.size;
  const canSave = mode === 'all' || count > 0;

  const Radio = ({ active, icon: Icon, title, sub, onClick }: any) => (
    <button onClick={onClick} className={`flex-1 text-left rounded-xl border p-4 transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/40'}`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon className="h-4 w-4" /></div>
        <div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-muted-foreground">{sub}</p></div>
      </div>
    </button>
  );

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-sm font-semibold">Atribuição</Label>
        <p className="text-xs text-muted-foreground mt-1">Defina a quem este perfil de regras se aplica.</p>
      </div>
      <div className="flex gap-3">
        <Radio active={mode === 'all'} icon={Users} title="Todos os vinculados" sub="Vale para toda a equipe" onClick={() => setMode('all')} />
        <Radio active={mode === 'specific'} icon={UserCheck} title="Membros específicos" sub="Você escolhe quem" onClick={() => setMode('specific')} />
      </div>

      {mode === 'specific' && (
        <div className="rounded-xl border border-border/60 p-2 max-h-64 overflow-y-auto">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum membro vinculado encontrado.</p>
          ) : members.map((m) => (
            <label key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer">
              <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{m.name || 'Sem nome'}</p>
                {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">{mode === 'all' ? 'Aplica para toda a equipe' : `${count} membro(s) selecionado(s)`}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSkip} disabled={saving}>Depois</Button>
          <Button onClick={() => onSave(mode === 'all' ? 'all' : 'seller', Array.from(selected))} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar atribuição
          </Button>
        </div>
      </div>
    </div>
  );
}
