// ============================================================================
// ConsignadoVehicleForm
// ----------------------------------------------------------------------------
// Marcos CRM — Formulário inline com 6 campos do veículo do cliente que aparece
// SÓ quando o lead está na coluna "Consignado" do kanban.
//
// Spec (27/05/2026): Modelo / Ano / Versão / KM / Cor / Estado geral.
// Todos opcionais (vendedor preenche o que souber). Autosave on blur.
// Persiste em public.crm_leads colunas consignado_* (migration
// 20260527240000_marcos_consignado.sql).
//
// NÃO renderizar pra Pedro — só pra Marcos. A checagem de mode='marcos' +
// stage.name='Consignado' deve ser feita pelo componente pai.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Car, Loader2 } from 'lucide-react';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ConsignadoVehicleData {
  consignado_modelo: string | null;
  consignado_ano: number | null;
  consignado_versao: string | null;
  consignado_km: number | null;
  consignado_cor: string | null;
  consignado_estado: 'bom' | 'medio' | 'ruim' | null;
}

const EMPTY: ConsignadoVehicleData = {
  consignado_modelo: null,
  consignado_ano: null,
  consignado_versao: null,
  consignado_km: null,
  consignado_cor: null,
  consignado_estado: null,
};

const ESTADO_OPTIONS = [
  { value: 'bom',   label: 'Bom' },
  { value: 'medio', label: 'Médio' },
  { value: 'ruim',  label: 'Ruim' },
] as const;

// Helper pra detectar se algum campo está preenchido (usado pelo badge no card).
export function hasConsignadoData(d: Partial<ConsignadoVehicleData> | null | undefined): boolean {
  if (!d) return false;
  return !!(
    d.consignado_modelo ||
    d.consignado_ano ||
    d.consignado_versao ||
    d.consignado_km ||
    d.consignado_cor ||
    d.consignado_estado
  );
}

// Bug 3 (spec 27/05/2026): formata número de KM com separador de milhar
// pt-BR (150000 → "150.000"). Valor salvo no banco é sempre o número puro.
function formatKmDisplay(km: number | null | undefined): string {
  if (km == null || isNaN(km as number)) return '';
  return new Intl.NumberFormat('pt-BR').format(km);
}

// Parser inverso: aceita "150.000", "150000", "150 000" e retorna 150000.
function parseKmInput(s: string): number | null {
  const digits = (s || '').replace(/\D/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ConsignadoVehicleFormProps {
  leadId: string;
  initialData?: Partial<ConsignadoVehicleData> | null;
  /** Callback após autosave bem-sucedido. Útil pra atualizar badge no card. */
  onUpdated?: (data: ConsignadoVehicleData) => void;
  className?: string;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function ConsignadoVehicleForm({
  leadId, initialData, onUpdated, className,
}: ConsignadoVehicleFormProps) {
  const { toast } = useToast();
  const [data, setData] = useState<ConsignadoVehicleData>(() => ({
    consignado_modelo: initialData?.consignado_modelo ?? null,
    consignado_ano: initialData?.consignado_ano ?? null,
    consignado_versao: initialData?.consignado_versao ?? null,
    consignado_km: initialData?.consignado_km ?? null,
    consignado_cor: initialData?.consignado_cor ?? null,
    consignado_estado: (initialData?.consignado_estado as any) ?? null,
  }));
  const [savingField, setSavingField] = useState<keyof ConsignadoVehicleData | null>(null);

  // Sincroniza state se o lead muda (parent passa initialData diferente).
  useEffect(() => {
    setData({
      consignado_modelo: initialData?.consignado_modelo ?? null,
      consignado_ano: initialData?.consignado_ano ?? null,
      consignado_versao: initialData?.consignado_versao ?? null,
      consignado_km: initialData?.consignado_km ?? null,
      consignado_cor: initialData?.consignado_cor ?? null,
      consignado_estado: (initialData?.consignado_estado as any) ?? null,
    });
    setAnoText(initialData?.consignado_ano != null ? String(initialData.consignado_ano) : '');
    setKmText(formatKmDisplay(initialData?.consignado_km));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Bug 2+3 (spec 27/05/2026): inputs de Ano e KM agora são type="text" pra
  // remover setas de incremento (UX ruim no number) e permitir formatação
  // visual da KM. State texto separado pra controle do display.
  const [anoText, setAnoText] = useState<string>(
    initialData?.consignado_ano != null ? String(initialData.consignado_ano) : ''
  );
  const [kmText, setKmText] = useState<string>(formatKmDisplay(initialData?.consignado_km));

  // Autosave de um campo específico. Chamado on blur (text) ou on change (select).
  const persistField = useCallback(async (
    field: keyof ConsignadoVehicleData,
    value: string | number | null,
  ) => {
    setSavingField(field);
    try {
      const patch: Partial<ConsignadoVehicleData> = { [field]: value as any };
      const { error } = await (supabase as any)
        .from('crm_leads')
        .update(patch)
        .eq('id', leadId);
      if (error) {
        console.error('[ConsignadoVehicleForm] erro autosave:', error);
        toast({
          title: 'Erro ao salvar',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }
      const next = { ...data, [field]: value } as ConsignadoVehicleData;
      setData(next);
      onUpdated?.(next);
    } finally {
      setSavingField(null);
    }
  }, [leadId, data, onUpdated, toast]);

  // Handlers de texto: state local muda on change, persiste on blur (autosave).
  const handleTextBlur = (field: keyof ConsignadoVehicleData) =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const newValue = e.target.value.trim() || null;
      // Só persiste se mudou
      if (newValue !== (data[field] ?? null)) {
        persistField(field, newValue);
      }
    };

  return (
    <div className={`rounded-lg border border-purple-500/30 bg-purple-500/5 p-4 ${className || ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Car className="h-4 w-4 text-purple-400" />
          <span>🚗 Informações do Veículo</span>
        </h4>
        {savingField && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Salvando…
          </span>
        )}
      </div>

      {/* Grid 2 colunas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Modelo */}
        <div className="space-y-1">
          <Label htmlFor={`consig-modelo-${leadId}`} className="text-[11px] text-muted-foreground">
            Modelo do carro
          </Label>
          <Input
            id={`consig-modelo-${leadId}`}
            type="text"
            defaultValue={data.consignado_modelo ?? ''}
            placeholder="Ex: Civic, Corolla, HB20..."
            onBlur={handleTextBlur('consignado_modelo')}
            className="h-8 text-xs"
          />
        </div>

        {/* Ano — Bug 2: type=text + inputMode numeric pra remover setas do number */}
        <div className="space-y-1">
          <Label htmlFor={`consig-ano-${leadId}`} className="text-[11px] text-muted-foreground">
            Ano
          </Label>
          <Input
            id={`consig-ano-${leadId}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={anoText}
            onChange={(e) => setAnoText(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => {
              const raw = anoText.trim();
              const newValue = raw === '' ? null : Number(raw);
              if (newValue !== null && (isNaN(newValue) || newValue < 1900 || newValue > 2030)) {
                toast({ title: 'Ano inválido', description: 'Use um ano entre 1900 e 2030.', variant: 'destructive' });
                setAnoText(data.consignado_ano != null ? String(data.consignado_ano) : '');
                return;
              }
              if (newValue !== (data.consignado_ano ?? null)) {
                persistField('consignado_ano', newValue);
              }
            }}
            placeholder="Ex: 2021"
            className="h-8 text-xs"
          />
        </div>

        {/* Versão */}
        <div className="space-y-1">
          <Label htmlFor={`consig-versao-${leadId}`} className="text-[11px] text-muted-foreground">
            Versão
          </Label>
          <Input
            id={`consig-versao-${leadId}`}
            type="text"
            defaultValue={data.consignado_versao ?? ''}
            placeholder="Ex: LT, XEi, Comfort..."
            onBlur={handleTextBlur('consignado_versao')}
            className="h-8 text-xs"
          />
        </div>

        {/* KM — Bug 3: type=text + inputMode numeric + formatação visual milhar + sufixo "km" */}
        <div className="space-y-1">
          <Label htmlFor={`consig-km-${leadId}`} className="text-[11px] text-muted-foreground">
            Quilometragem aproximada
          </Label>
          <div className="relative">
            <Input
              id={`consig-km-${leadId}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={kmText}
              onChange={(e) => {
                // Mantém só dígitos, mas mostra formatado on-the-fly
                const parsed = parseKmInput(e.target.value);
                setKmText(parsed != null ? formatKmDisplay(parsed) : '');
              }}
              onBlur={() => {
                const parsed = parseKmInput(kmText);
                if (parsed !== (data.consignado_km ?? null)) {
                  persistField('consignado_km', parsed);
                }
              }}
              placeholder="Ex: 85.000"
              className="h-8 text-xs pr-9"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground pointer-events-none select-none">
              km
            </span>
          </div>
        </div>

        {/* Cor */}
        <div className="space-y-1">
          <Label htmlFor={`consig-cor-${leadId}`} className="text-[11px] text-muted-foreground">
            Cor
          </Label>
          <Input
            id={`consig-cor-${leadId}`}
            type="text"
            defaultValue={data.consignado_cor ?? ''}
            placeholder="Ex: Preto, Branco, Prata..."
            onBlur={handleTextBlur('consignado_cor')}
            className="h-8 text-xs"
            list={`consig-cor-list-${leadId}`}
          />
          <datalist id={`consig-cor-list-${leadId}`}>
            <option value="Preto" />
            <option value="Branco" />
            <option value="Prata" />
            <option value="Cinza" />
            <option value="Vermelho" />
            <option value="Azul" />
            <option value="Verde" />
            <option value="Marrom" />
          </datalist>
        </div>

        {/* Estado geral */}
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Estado geral
          </Label>
          <Select
            value={data.consignado_estado ?? '__none__'}
            onValueChange={(v) => persistField('consignado_estado', v === '__none__' ? null : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Não informado —</SelectItem>
              {ESTADO_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Nota de contexto */}
      <p className="mt-3 text-[10px] text-muted-foreground italic leading-relaxed">
        Mesmo que o cliente não queira vender agora, essas informações permitem uma abordagem assertiva nos próximos meses.
      </p>
    </div>
  );
}

export default ConsignadoVehicleForm;
