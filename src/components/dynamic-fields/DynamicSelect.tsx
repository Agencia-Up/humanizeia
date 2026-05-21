// Select genérico com opção "➕ Adicionar nova" embutida.
// Reusa Select/SelectItem do design system (shadcn).

import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useDynamicFields } from "@/hooks/useDynamicFields";
import { AddDynamicModal } from "./AddDynamicModal";
import type { DynamicEntity, DynamicRow } from "@/services/dynamicFields/dynamicFieldsService";

interface Props {
  entity: DynamicEntity;
  userId: string | null | undefined;
  value: string | null; // id da row selecionada (ou null)
  onChange: (id: string | null, row: DynamicRow | null) => void;
  placeholder?: string;
  allowCreate?: boolean;
  /** Permite filtrar (ex: só `category='manual'` em lead_sources pra UI do vendedor) */
  filter?: (row: DynamicRow) => boolean;
  /** Classes opcionais pro trigger */
  triggerClassName?: string;
  disabled?: boolean;
}

const ADD_NEW_VALUE = "__add_new__";
const CLEAR_VALUE = "__clear__";

export function DynamicSelect({
  entity,
  userId,
  value,
  onChange,
  placeholder,
  allowCreate = true,
  filter,
  triggerClassName,
  disabled,
}: Props) {
  const { rows, loading, reload } = useDynamicFields(entity, userId);
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!filter) return rows;
    return rows.filter(filter);
  }, [rows, filter]);

  const handleValueChange = (v: string) => {
    if (v === ADD_NEW_VALUE) {
      setModalOpen(true);
      return;
    }
    if (v === CLEAR_VALUE) {
      onChange(null, null);
      return;
    }
    const row = filtered.find((r) => r.id === v) || null;
    onChange(v, row);
  };

  const handleCreated = async (row: DynamicRow) => {
    await reload();
    onChange(row.id, row);
  };

  return (
    <>
      <Select value={value || ""} onValueChange={handleValueChange} disabled={disabled || !userId}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={loading ? "Carregando..." : placeholder || "Selecione..."} />
        </SelectTrigger>
        <SelectContent>
          {filtered.length === 0 && !loading && (
            <SelectItem value="__empty__" disabled>
              Nenhum cadastrado ainda
            </SelectItem>
          )}
          {filtered.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="flex items-center gap-1.5">
                {(r as any).icon && <span>{(r as any).icon}</span>}
                {r.name}
              </span>
            </SelectItem>
          ))}
          {value && (
            <SelectItem value={CLEAR_VALUE} className="text-muted-foreground italic">
              — Limpar seleção —
            </SelectItem>
          )}
          {allowCreate && userId && (
            <SelectItem value={ADD_NEW_VALUE} className="text-primary font-medium">
              <span className="flex items-center gap-1.5">
                <Plus className="h-3 w-3" />
                Adicionar novo(a)
              </span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {userId && (
        <AddDynamicModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          entity={entity}
          userId={userId}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}
