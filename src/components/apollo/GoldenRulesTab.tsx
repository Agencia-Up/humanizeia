import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Shield, Zap, Target, Plus, Trash2, Edit, Play, Pause } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuleMetric = 'ROAS' | 'CPA' | 'CPC' | 'CTR' | 'Frequência' | 'Gasto Diário';
export type RuleOperator = '>' | '<' | '>=' | '<=' | '=';
export type RuleAction =
  | 'Aumentar Orçamento'
  | 'Reduzir Orçamento'
  | 'Pausar Campanha'
  | 'Ativar Campanha'
  | 'Notificar';
export type RuleFrequency = '1h' | '2h' | '6h' | '24h';

export interface GoldenRule {
  id: string;
  name: string;
  metric: RuleMetric;
  operator: RuleOperator;
  value: number;
  action: RuleAction;
  actionParam: number | null;
  frequency: RuleFrequency;
  active: boolean;
  isTemplate?: boolean;
}

const STORAGE_KEY = 'logosia-golden-rules';

const FREQUENCY_LABELS: Record<RuleFrequency, string> = {
  '1h': 'A cada 1h',
  '2h': 'A cada 2h',
  '6h': 'A cada 6h',
  '24h': 'Diariamente',
};

const ACTION_NEEDS_PARAM: Record<RuleAction, boolean> = {
  'Aumentar Orçamento': true,
  'Reduzir Orçamento': true,
  'Pausar Campanha': false,
  'Ativar Campanha': false,
  'Notificar': false,
};

const TEMPLATE_RULES: Omit<GoldenRule, 'id'>[] = [
  {
    name: 'Escala Segura',
    metric: 'ROAS',
    operator: '>',
    value: 2.5,
    action: 'Aumentar Orçamento',
    actionParam: 15,
    frequency: '2h',
    active: false,
    isTemplate: true,
  },
  {
    name: 'Proteção de Orçamento',
    metric: 'CPA',
    operator: '>',
    value: 0,
    action: 'Pausar Campanha',
    actionParam: null,
    frequency: '1h',
    active: false,
    isTemplate: true,
  },
  {
    name: 'Rotação de Criativo',
    metric: 'Frequência',
    operator: '>',
    value: 3.5,
    action: 'Notificar',
    actionParam: null,
    frequency: '6h',
    active: false,
    isTemplate: true,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadRules(): GoldenRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRules(rules: GoldenRule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

function genId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function conditionLabel(r: GoldenRule) {
  return `${r.metric} ${r.operator} ${r.value}`;
}

function actionLabel(r: GoldenRule) {
  if (r.actionParam != null) return `${r.action} em ${r.actionParam}%`;
  return r.action;
}

// ── Empty form state ──────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  metric: RuleMetric | '';
  operator: RuleOperator | '';
  value: string;
  action: RuleAction | '';
  actionParam: string;
  frequency: RuleFrequency | '';
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  metric: '',
  operator: '',
  value: '',
  action: '',
  actionParam: '',
  frequency: '',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function GoldenRulesTab() {
  const [rules, setRules] = useState<GoldenRule[]>(loadRules);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof RuleFormState, string>>>({});
  const { toast } = useToast();

  // Persist on change
  useEffect(() => {
    saveRules(rules);
  }, [rules]);

  // ── Form helpers ────────────────────────────────────────────────────────────

  function openNew() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(rule: GoldenRule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      metric: rule.metric,
      operator: rule.operator,
      value: String(rule.value),
      action: rule.action,
      actionParam: rule.actionParam != null ? String(rule.actionParam) : '',
      frequency: rule.frequency,
    });
    setErrors({});
    setDialogOpen(true);
  }

  function validate(): boolean {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = 'Obrigatório';
    if (!form.metric) e.metric = 'Selecione';
    if (!form.operator) e.operator = 'Selecione';
    if (!form.value || isNaN(Number(form.value))) e.value = 'Valor inválido';
    if (!form.action) e.action = 'Selecione';
    if (form.action && ACTION_NEEDS_PARAM[form.action as RuleAction]) {
      if (!form.actionParam || isNaN(Number(form.actionParam))) e.actionParam = 'Valor inválido';
    }
    if (!form.frequency) e.frequency = 'Selecione';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSave() {
    if (!validate()) return;

    const rule: GoldenRule = {
      id: editingId ?? genId(),
      name: form.name.trim(),
      metric: form.metric as RuleMetric,
      operator: form.operator as RuleOperator,
      value: Number(form.value),
      action: form.action as RuleAction,
      actionParam: ACTION_NEEDS_PARAM[form.action as RuleAction] ? Number(form.actionParam) : null,
      frequency: form.frequency as RuleFrequency,
      active: true,
    };

    if (editingId) {
      setRules((prev) => prev.map((r) => (r.id === editingId ? rule : r)));
      toast({ title: 'Regra atualizada', description: rule.name });
    } else {
      setRules((prev) => [...prev, rule]);
      toast({ title: 'Regra criada', description: rule.name });
    }
    setDialogOpen(false);
  }

  function toggleActive(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
  }

  function deleteRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    toast({ title: 'Regra removida' });
  }

  function activateTemplate(tpl: (typeof TEMPLATE_RULES)[number]) {
    const exists = rules.some(
      (r) => r.name === tpl.name && r.metric === tpl.metric && r.operator === tpl.operator
    );
    if (exists) {
      toast({ title: 'Regra já existe', description: `"${tpl.name}" já está na sua lista.`, variant: 'destructive' });
      return;
    }
    const rule: GoldenRule = { ...tpl, id: genId(), active: true };
    setRules((prev) => [...prev, rule]);
    toast({ title: 'Regra ativada', description: tpl.name });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-amber-400" />
          <h3 className="text-sm font-semibold">Regras de Ouro</h3>
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
              {activeCount} ativa{activeCount !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={openNew} className="gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Nova Regra
        </Button>
      </div>

      {/* Templates */}
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-amber-400 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            Regras Pré-configuradas
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {TEMPLATE_RULES.map((tpl, i) => {
            const alreadyAdded = rules.some(
              (r) => r.name === tpl.name && r.metric === tpl.metric && r.operator === tpl.operator
            );
            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/50 p-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tpl.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Se {tpl.metric} {tpl.operator} {tpl.value}
                    {tpl.name === 'Proteção de Orçamento' ? ' (2x meta)' : ''}
                    {' → '}
                    {tpl.actionParam != null
                      ? `${tpl.action} ${tpl.actionParam}%`
                      : tpl.action}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {FREQUENCY_LABELS[tpl.frequency]}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={alreadyAdded ? 'secondary' : 'default'}
                  disabled={alreadyAdded}
                  onClick={() => activateTemplate(tpl)}
                  className="gap-1 text-xs shrink-0"
                >
                  {alreadyAdded ? (
                    <>Adicionada</>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      Ativar
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Rules list */}
      {rules.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Shield className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Nenhuma regra criada ainda.</p>
            <p className="text-xs text-muted-foreground">
              Crie regras personalizadas ou ative os templates acima.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card
              key={rule.id}
              className={`transition-colors ${
                rule.active
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-border/40 opacity-60'
              }`}
            >
              <CardContent className="flex items-center gap-3 py-3 px-4">
                <Switch
                  checked={rule.active}
                  onCheckedChange={() => toggleActive(rule.id)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{rule.name}</p>
                    <Badge
                      variant={rule.active ? 'default' : 'secondary'}
                      className="text-[9px] h-4 px-1.5"
                    >
                      {rule.active ? (
                        <><Play className="h-2.5 w-2.5 mr-0.5" />Ativa</>
                      ) : (
                        <><Pause className="h-2.5 w-2.5 mr-0.5" />Inativa</>
                      )}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Target className="h-3 w-3" />
                      Se {conditionLabel(rule)}
                    </span>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      {actionLabel(rule)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {FREQUENCY_LABELS[rule.frequency]}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openEdit(rule)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-400 hover:text-red-300"
                    onClick={() => deleteRule(rule.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Form dialog */}
      <RuleFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        errors={errors}
        isEditing={!!editingId}
        onSave={handleSave}
      />
    </div>
  );
}

// ── Form Dialog ───────────────────────────────────────────────────────────────

function RuleFormDialog({
  open,
  onOpenChange,
  form,
  setForm,
  errors,
  isEditing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: RuleFormState;
  setForm: React.Dispatch<React.SetStateAction<RuleFormState>>;
  errors: Partial<Record<keyof RuleFormState, string>>;
  isEditing: boolean;
  onSave: () => void;
}) {
  const showParam =
    form.action && ACTION_NEEDS_PARAM[form.action as RuleAction];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4 text-amber-400" />
            {isEditing ? 'Editar Regra' : 'Nova Regra de Ouro'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label className="text-xs">Nome da Regra</Label>
            <Input
              placeholder="Ex: Escala Agressiva ROAS Alto"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-[10px] text-red-400">{errors.name}</p>}
          </div>

          {/* Condition row */}
          <div className="space-y-1.5">
            <Label className="text-xs">Condição (Se...)</Label>
            <div className="grid grid-cols-3 gap-2">
              {/* Metric */}
              <div>
                <Select
                  value={form.metric}
                  onValueChange={(v) => setForm((f) => ({ ...f, metric: v as RuleMetric }))}
                >
                  <SelectTrigger className={`text-xs ${errors.metric ? 'border-red-500' : ''}`}>
                    <SelectValue placeholder="Métrica" />
                  </SelectTrigger>
                  <SelectContent>
                    {(['ROAS', 'CPA', 'CPC', 'CTR', 'Frequência', 'Gasto Diário'] as RuleMetric[]).map(
                      (m) => (
                        <SelectItem key={m} value={m} className="text-xs">
                          {m}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
                {errors.metric && <p className="text-[10px] text-red-400">{errors.metric}</p>}
              </div>

              {/* Operator */}
              <div>
                <Select
                  value={form.operator}
                  onValueChange={(v) => setForm((f) => ({ ...f, operator: v as RuleOperator }))}
                >
                  <SelectTrigger className={`text-xs ${errors.operator ? 'border-red-500' : ''}`}>
                    <SelectValue placeholder="Op." />
                  </SelectTrigger>
                  <SelectContent>
                    {(['>', '<', '>=', '<=', '='] as RuleOperator[]).map((op) => (
                      <SelectItem key={op} value={op} className="text-xs">
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.operator && <p className="text-[10px] text-red-400">{errors.operator}</p>}
              </div>

              {/* Value */}
              <div>
                <Input
                  type="number"
                  step="any"
                  placeholder="Valor"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  className={`text-xs ${errors.value ? 'border-red-500' : ''}`}
                />
                {errors.value && <p className="text-[10px] text-red-400">{errors.value}</p>}
              </div>
            </div>
          </div>

          {/* Action */}
          <div className="space-y-1.5">
            <Label className="text-xs">Ação</Label>
            <Select
              value={form.action}
              onValueChange={(v) => setForm((f) => ({ ...f, action: v as RuleAction }))}
            >
              <SelectTrigger className={`text-xs ${errors.action ? 'border-red-500' : ''}`}>
                <SelectValue placeholder="Selecione a ação" />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    'Aumentar Orçamento',
                    'Reduzir Orçamento',
                    'Pausar Campanha',
                    'Ativar Campanha',
                    'Notificar',
                  ] as RuleAction[]
                ).map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.action && <p className="text-[10px] text-red-400">{errors.action}</p>}
          </div>

          {/* Action param */}
          {showParam && (
            <div className="space-y-1.5">
              <Label className="text-xs">Porcentagem (%)</Label>
              <Input
                type="number"
                step="1"
                min="1"
                max="100"
                placeholder="Ex: 20"
                value={form.actionParam}
                onChange={(e) => setForm((f) => ({ ...f, actionParam: e.target.value }))}
                className={`text-xs ${errors.actionParam ? 'border-red-500' : ''}`}
              />
              {errors.actionParam && (
                <p className="text-[10px] text-red-400">{errors.actionParam}</p>
              )}
            </div>
          )}

          {/* Frequency */}
          <div className="space-y-1.5">
            <Label className="text-xs">Frequência de Verificação</Label>
            <Select
              value={form.frequency}
              onValueChange={(v) => setForm((f) => ({ ...f, frequency: v as RuleFrequency }))}
            >
              <SelectTrigger className={`text-xs ${errors.frequency ? 'border-red-500' : ''}`}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {(Object.entries(FREQUENCY_LABELS) as [RuleFrequency, string][]).map(
                  ([val, label]) => (
                    <SelectItem key={val} value={val} className="text-xs">
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
            {errors.frequency && <p className="text-[10px] text-red-400">{errors.frequency}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={onSave} className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            {isEditing ? 'Salvar Alterações' : 'Criar Regra'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
