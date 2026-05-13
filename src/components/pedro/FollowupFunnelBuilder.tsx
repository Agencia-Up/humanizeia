import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Zap, ArrowDown, X } from 'lucide-react';

interface FunnelStep {
  message: string;
  delayMinutes: number;
}

const DELAY_OPTIONS = [
  { value: 0,     label: 'Enviar imediatamente' },
  { value: 5,     label: 'Após 5 minutos' },
  { value: 10,    label: 'Após 10 minutos' },
  { value: 30,    label: 'Após 30 minutos' },
  { value: 60,    label: 'Após 1 hora' },
  { value: 180,   label: 'Após 3 horas' },
  { value: 1440,  label: 'Após 1 dia' },
  { value: 4320,  label: 'Após 3 dias' },
  { value: 10080, label: 'Após 7 dias' },
];

interface FollowupFunnelBuilderProps {
  leadId: string;
  userId: string;
  memberId: string | null;
  instanceId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FollowupFunnelBuilder({
  leadId, userId, memberId, instanceId, onClose, onSaved,
}: FollowupFunnelBuilderProps) {
  const { toast } = useToast();
  // Chave por lead — cada lead tem seu próprio draft persistido
  const draftKey = `followup_draft_${leadId}`;

  // Inicializa com rascunho salvo no localStorage (se existir) ou step vazio
  const [steps, setSteps] = useState<FunnelStep[]>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {/* ignore */}
    return [{ message: '', delayMinutes: 0 }];
  });
  const [saving, setSaving] = useState(false);

  // Persiste o draft sempre que steps mudar (rascunho permanece se usuário sair e voltar)
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(steps));
    } catch {/* ignore */}
  }, [draftKey, steps]);

  const addStep = () => {
    setSteps(prev => [...prev, { message: '', delayMinutes: 10 }]);
  };

  const removeStep = (index: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, field: keyof FunnelStep, value: string | number) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const handleSave = async () => {
    const valid = steps.every(s => s.message.trim());
    if (!valid) {
      toast({ title: 'Preencha todas as mensagens do funil', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      let cursor = new Date();
      const records = steps.map(step => {
        cursor = new Date(cursor.getTime() + step.delayMinutes * 60 * 1000);
        return {
          lead_id: leadId,
          user_id: userId,
          member_id: memberId,
          scheduled_at: cursor.toISOString(),
          message_template: step.message.trim(),
          instance_id: instanceId || null,
          status: 'pending',
        };
      });

      const { error } = await (supabase as any)
        .from('pedro_followup_schedules')
        .insert(records);
      if (error) throw error;

      // Atualiza next_followup_at do lead com a primeira etapa
      await (supabase as any)
        .from('ai_crm_leads')
        .update({ next_followup_at: records[0].scheduled_at })
        .eq('id', leadId);

      toast({ title: `✅ Funil criado com ${steps.length} etapa(s)!` });
      // Limpa o rascunho salvo após sucesso
      try { localStorage.removeItem(draftKey); } catch {/* ignore */}
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: 'Erro ao criar funil', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold text-foreground">Funil Automático de Follow-up</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Monte uma sequência automática de mensagens. Cada etapa será enviada após o tempo configurado em relação à etapa anterior.
      </p>

      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="flex items-center justify-center py-1">
                <ArrowDown className="h-3.5 w-3.5 text-muted-foreground/40" />
              </div>
            )}
            <div className="bg-background/60 border border-border/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Etapa {i + 1}
                </span>
                {steps.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeStep(i)} className="h-6 w-6 p-0 text-red-400 hover:text-red-500">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select
                value={String(step.delayMinutes)}
                onValueChange={v => updateStep(i, 'delayMinutes', Number(v))}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELAY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={step.message}
                onChange={e => updateStep(i, 'message', e.target.value)}
                placeholder={`Mensagem da etapa ${i + 1}...`}
                className="min-h-[50px] text-xs resize-none"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={addStep} className="h-7 text-xs gap-1 flex-1">
          <Plus className="h-3 w-3" /> Adicionar Etapa
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || steps.some(s => !s.message.trim())}
          className="h-7 text-xs gap-1 flex-1"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Salvar Funil ({steps.length} etapa{steps.length > 1 ? 's' : ''})
        </Button>
      </div>
    </div>
  );
}
