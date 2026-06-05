// ============================================================================
// SecurityRuleProfileForm — formulário completo de um perfil de regras (FASE 3)
// 7 seções. Sliders + input numérico sincronizados, toggles e horários.
// ============================================================================
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Loader2, Send, MessageCircle, MessageSquare, Clock, Bot, ShieldAlert } from 'lucide-react';
import {
  DEFAULT_SECURITY_RULE_PROFILE, RULE_RANGES,
  type SecurityRuleProfile, type SecurityRuleProfileInput,
} from '@/types/securityRules';

function toInput(p?: SecurityRuleProfile | null): SecurityRuleProfileInput {
  if (!p) return { ...DEFAULT_SECURITY_RULE_PROFILE };
  const { id, master_account_id, created_at, updated_at, ...rest } = p as any;
  return rest as SecurityRuleProfileInput;
}

function SliderField({
  label, field, value, unit, onChange, disabled,
}: {
  label: string; field: string; value: number; unit?: string;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  const r = RULE_RANGES[field] || { min: 0, max: 100 };
  return (
    <div className={`space-y-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm">{label}</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number" min={r.min} max={r.max} value={value}
            onChange={(e) => onChange(Math.max(r.min, Math.min(r.max, Number(e.target.value) || r.min)))}
            className="h-8 w-20 text-right text-sm"
          />
          {unit && <span className="text-xs text-muted-foreground w-16">{unit}</span>}
        </div>
      </div>
      <Slider value={[value]} min={r.min} max={r.max} step={r.step || 1}
        onValueChange={(v) => onChange(v[0])} />
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>{r.min}</span><span>{r.max}</span></div>
    </div>
  );
}

function Section({ icon: Icon, title, desc, enabled, onToggle, children }: {
  icon: any; title: string; desc?: string; enabled?: boolean;
  onToggle?: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-bold text-foreground">{title}</h3>
              {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
            </div>
          </div>
          {onToggle && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{enabled ? 'Ativo' : 'Desligado'}</span>
              <Switch checked={!!enabled} onCheckedChange={onToggle} />
            </div>
          )}
        </div>
        <div className={onToggle && !enabled ? 'opacity-50 pointer-events-none' : ''}>{children}</div>
      </CardContent>
    </Card>
  );
}

export function SecurityRuleProfileForm({
  initial, saving, onSave, onCancel,
}: {
  initial?: SecurityRuleProfile | null; saving?: boolean;
  onSave: (p: SecurityRuleProfileInput) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<SecurityRuleProfileInput>(() => toInput(initial));
  const set = (patch: Partial<SecurityRuleProfileInput>) => setF((cur) => ({ ...cur, ...patch }));
  const nameError = useMemo(() => (f.name.trim().length < 2 ? 'Dê um nome ao perfil.' : ''), [f.name]);

  const hhmm = (t: string) => (t || '').slice(0, 5);
  const toTime = (v: string) => (v ? `${v}:00` : '08:00:00');

  return (
    <div className="space-y-4">
      {/* 1. Geral */}
      <Section icon={ShieldAlert} title="Geral">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-sm">Nome do perfil</Label>
            <Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex: Regras padrão da equipe" />
            {nameError && <p className="text-xs text-destructive">{nameError}</p>}
          </div>
          <div className="flex items-center gap-2 pb-2">
            <span className="text-sm text-muted-foreground">{f.is_active ? 'Perfil ativo' : 'Perfil inativo'}</span>
            <Switch checked={f.is_active} onCheckedChange={(v) => set({ is_active: v })} />
          </div>
        </div>
      </Section>

      {/* 2. Disparo em massa */}
      <Section icon={Send} title="Disparo em Massa" desc="Protege o número nos disparos." enabled={f.bulk_send_enabled} onToggle={(v) => set({ bulk_send_enabled: v })}>
        <div className="space-y-5">
          <SliderField label="Limite diário de disparos por número" field="bulk_send_daily_limit" unit="por dia" value={f.bulk_send_daily_limit} onChange={(v) => set({ bulk_send_daily_limit: v })} />
          <SliderField label="Intervalo mínimo entre mensagens" field="bulk_send_min_interval_sec" unit="segundos" value={f.bulk_send_min_interval_sec} onChange={(v) => set({ bulk_send_min_interval_sec: v })} />
          <SliderField label="Máximo de contatos por lote" field="bulk_send_max_batch" unit="contatos" value={f.bulk_send_max_batch} onChange={(v) => set({ bulk_send_max_batch: v })} />
        </div>
      </Section>

      {/* 3. Follow-up manual */}
      <Section icon={MessageCircle} title="Follow-up Manual" desc="Limita os follow-ups feitos pela equipe." enabled={f.manual_followup_enabled} onToggle={(v) => set({ manual_followup_enabled: v })}>
        <div className="space-y-5">
          <SliderField label="Limite diário por vendedor" field="manual_followup_daily_limit" unit="por dia" value={f.manual_followup_daily_limit} onChange={(v) => set({ manual_followup_daily_limit: v })} />
          <SliderField label="Intervalo mínimo para o mesmo contato" field="manual_followup_min_interval_min" unit="minutos" value={f.manual_followup_min_interval_min} onChange={(v) => set({ manual_followup_min_interval_min: v })} />
        </div>
      </Section>

      {/* 4. Mensagens individuais */}
      <Section icon={MessageSquare} title="Mensagens Individuais">
        <div className="space-y-5">
          <SliderField label="Limite diário por número" field="individual_msg_daily_limit" unit="por dia" value={f.individual_msg_daily_limit} onChange={(v) => set({ individual_msg_daily_limit: v })} />
          <SliderField label="Intervalo mínimo entre mensagens" field="individual_msg_min_interval_sec" unit="segundos" value={f.individual_msg_min_interval_sec} onChange={(v) => set({ individual_msg_min_interval_sec: v })} />
        </div>
      </Section>

      {/* 5. Horários permitidos */}
      <Section icon={Clock} title="Horários Permitidos" desc="Janela em que o envio é permitido.">
        <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
          <div className="space-y-1.5"><Label className="text-sm">Início</Label>
            <Input type="time" value={hhmm(f.allowed_send_start_time)} onChange={(e) => set({ allowed_send_start_time: toTime(e.target.value) })} /></div>
          <div className="space-y-1.5"><Label className="text-sm">Fim</Label>
            <Input type="time" value={hhmm(f.allowed_send_end_time)} onChange={(e) => set({ allowed_send_end_time: toTime(e.target.value) })} /></div>
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={f.block_weekends} onCheckedChange={(v) => set({ block_weekends: v })} />
            <span className="text-sm text-muted-foreground">Bloquear fins de semana</span>
          </div>
        </div>
      </Section>

      {/* 6. Automação */}
      <Section icon={Bot} title="Automação" desc="Mensagens automáticas do sistema." enabled={f.automation_enabled} onToggle={(v) => set({ automation_enabled: v })}>
        <SliderField label="Limite diário de mensagens automáticas por número" field="automation_daily_limit" unit="por dia" value={f.automation_daily_limit} onChange={(v) => set({ automation_daily_limit: v })} />
      </Section>

      {/* 7. Anti-spam */}
      <Section icon={ShieldAlert} title="Proteção Anti-Spam">
        <div className="space-y-5">
          <SliderField label="Máximo de mensagens idênticas por hora" field="antispam_max_identical_per_hour" unit="por hora" value={f.antispam_max_identical_per_hour} onChange={(v) => set({ antispam_max_identical_per_hour: v })} />
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div><p className="text-sm font-medium">Bloquear ao atingir o limite</p>
              <p className="text-xs text-muted-foreground">{f.antispam_block_on_limit ? 'Bloqueia o envio ao bater o limite.' : 'Apenas alerta, sem bloquear.'}</p></div>
            <Switch checked={f.antispam_block_on_limit} onCheckedChange={(v) => set({ antispam_block_on_limit: v })} />
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-0 bg-background/80 backdrop-blur py-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={() => !nameError && onSave(f)} disabled={saving || !!nameError}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {initial ? 'Salvar alterações' : 'Criar perfil'}
        </Button>
      </div>
    </div>
  );
}
